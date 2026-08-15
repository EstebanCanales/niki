import { Inject, Injectable, Logger } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";

import { AppConfigService } from "./app-config.service";

export interface StoredMemoryEntry {
  key: string;
  value: string;
  ttl?: number;
  updatedAt: string;
}

const UNREACHABLE_TTL_MS = 30_000;
/** Cuánto vive la lista de memoria en caché. Durante una llamada hay varios turnos
 *  seguidos del mismo usuario y cada uno pagaba dos round-trips a Upstash (KEYS + MGET)
 *  antes de que el modelo empezara a generar. Escribir invalida, así que el único
 *  desfase posible es frente a otro proceso escribiendo el mismo Redis. */
const ENTRIES_CACHE_TTL_MS = 30_000;

/**
 * Dónde vive la memoria cuando Upstash no está.
 *
 * La base de Upstash de este proyecto dejó de existir —su host da NXDOMAIN— y con ella
 * se fue toda la memoria persistente: Niki arrancaba en blanco cada vez. Guardarla en
 * disco, al lado del resto del estado del agente, la devuelve sin depender de que
 * alguien cree una base nueva.
 *
 * Upstash sigue siendo el primario si algún día vuelve a responder: esto es el respaldo,
 * no el reemplazo.
 */
const MEMORIA_LOCAL = path.resolve(__dirname, "..", "..", "..", "agent-home", "memoria");

@Injectable()
export class UserMemoryService {
  private readonly logger = new Logger(UserMemoryService.name);
  private unreachableUntil = 0;
  private readonly entriesCache = new Map<string, { entries: StoredMemoryEntry[]; expiresAt: number }>();
  /** Lecturas en vuelo por usuario: si tres llamadores piden memoria a la vez (que es
   *  justo lo que hace un turno), comparten una sola ida a Upstash en vez de tres. */
  private readonly entriesInFlight = new Map<string, Promise<StoredMemoryEntry[]>>();

  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
  ) {}

  private upstashFetch(path: string, init?: RequestInit) {
    const config = this.configService.get();
    const { upstashRedisRestUrl, upstashRedisRestToken } = config;
    if (!upstashRedisRestUrl || !upstashRedisRestToken) {
      throw new Error(
        "Upstash not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.",
      );
    }
    const url = `${upstashRedisRestUrl.replace(/\/+$/, "")}${path}`;
    return fetch(url, {
      ...init,
      signal: AbortSignal.timeout(1_500),
      headers: {
        Authorization: `Bearer ${upstashRedisRestToken}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  }

  async listEntries(userId: string) {
    const prefix = `niki:memory:${userId}:`;
    const keysRes = await this.upstashFetch(`/keys/${encodeURIComponent(prefix + "*")}`);
    const keysData = (await keysRes.json()) as { result?: string[] };
    const keys = keysData.result ?? [];

    if (!keys.length) return [];

    const mgetRes = await this.upstashFetch(
      "/mget/" + keys.map(encodeURIComponent).join("/"),
    );
    const mgetData = (await mgetRes.json()) as { result?: Array<string | null> };

    return keys
      .map((key, index) => {
        const raw = mgetData.result?.[index];
        if (!raw) return null;
        try {
          return JSON.parse(raw) as StoredMemoryEntry;
        } catch {
          return {
            key: key.replace(prefix, ""),
            value: raw,
            updatedAt: new Date().toISOString(),
          } satisfies StoredMemoryEntry;
        }
      })
      .filter((entry): entry is StoredMemoryEntry => entry !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async safeListEntries(userId: string) {
    // Cortacircuitos: mientras Upstash esté caído no se lo golpea. Antes esto devolvía
    // [] y era el motivo real de que la memoria local nunca se leyera — la línea corta
    // antes de llegar al respaldo. Ahora devuelve lo que hay en disco.
    if (Date.now() < this.unreachableUntil) return this.leerLocal(userId);

    const cached = this.entriesCache.get(userId);
    if (cached && Date.now() < cached.expiresAt) return cached.entries;

    const inFlight = this.entriesInFlight.get(userId);
    if (inFlight) return inFlight;

    const request = (async () => {
      try {
        if (!this.upstashDisponible) throw new Error("Upstash no disponible");
        const result = await this.listEntries(userId);
        this.unreachableUntil = 0;
        this.entriesCache.set(userId, {
          entries: result,
          expiresAt: Date.now() + ENTRIES_CACHE_TTL_MS,
        });
        return result;
      } catch (error) {
        this.unreachableUntil = Date.now() + UNREACHABLE_TTL_MS;
        // Antes esto devolvía [] y Niki quedaba sin memoria. Ahora cae al disco: la
        // memoria sobrevive aunque Upstash no exista.
        const locales = this.leerLocal(userId);
        this.logger.warn(
          `[memory] Upstash no respondió (${String(error).slice(0, 80)}); usando memoria local (${locales.length} entradas)`,
        );
        this.entriesCache.set(userId, { entries: locales, expiresAt: Date.now() + ENTRIES_CACHE_TTL_MS });
        return locales;
      } finally {
        this.entriesInFlight.delete(userId);
      }
    })();

    this.entriesInFlight.set(userId, request);
    return request;
  }

  /** Toda escritura tira la caché de ese usuario — si no, un hecho recién guardado no
   *  existiría para el modelo hasta 30 s después. */
  private invalidateEntries(userId: string) {
    this.entriesCache.delete(userId);
  }

  // ── Respaldo local ────────────────────────────────────────────────────────

  private archivoLocal(userId: string): string {
    const seguro = userId.replace(/[^a-zA-Z0-9_-]/g, "") || "anon";
    return path.join(MEMORIA_LOCAL, `${seguro}.json`);
  }

  private leerLocal(userId: string): StoredMemoryEntry[] {
    try {
      const crudo = fs.readFileSync(this.archivoLocal(userId), "utf8");
      const datos = JSON.parse(crudo) as StoredMemoryEntry[];
      if (!Array.isArray(datos)) return [];
      // Los TTL se respetan acá: en Redis los aplicaba el servidor.
      const ahora = Date.now();
      return datos.filter((e) => {
        if (!e.ttl) return true;
        return new Date(e.updatedAt).getTime() + e.ttl * 1000 > ahora;
      });
    } catch {
      return [];
    }
  }

  private escribirLocal(userId: string, entradas: StoredMemoryEntry[]) {
    try {
      // Sin entradas no queda archivo: un `[]` en disco no aporta nada y deja basura
      // por cada usuario que alguna vez guardó algo y después lo borró.
      if (entradas.length === 0) {
        fs.rmSync(this.archivoLocal(userId), { force: true });
        return;
      }
      fs.mkdirSync(MEMORIA_LOCAL, { recursive: true });
      fs.writeFileSync(this.archivoLocal(userId), JSON.stringify(entradas, null, 2));
    } catch (error) {
      this.logger.warn(`[memory] no se pudo escribir la memoria local: ${String(error)}`);
    }
  }

  /** ¿Hay Upstash configurado y respondiendo? */
  private get upstashDisponible(): boolean {
    const c = this.configService.get();
    return Boolean(c.upstashRedisRestUrl && c.upstashRedisRestToken) && Date.now() >= this.unreachableUntil;
  }

  async setEntry(userId: string, key: string, value: string, ttl?: number) {
    const redisKey = `niki:memory:${userId}:${key}`;
    const entry: StoredMemoryEntry = {
      key,
      value,
      ttl,
      updatedAt: new Date().toISOString(),
    };
    // Se escribe SIEMPRE en disco, aunque Upstash ande: es lo que hace que la memoria
    // sobreviva a que la base desaparezca, que es exactamente lo que pasó acá.
    const locales = this.leerLocal(userId).filter((e) => e.key !== key);
    this.escribirLocal(userId, [entry, ...locales]);

    if (this.upstashDisponible) {
      const setPath = ttl
        ? `/set/${encodeURIComponent(redisKey)}/${encodeURIComponent(JSON.stringify(entry))}/ex/${ttl}`
        : `/set/${encodeURIComponent(redisKey)}/${encodeURIComponent(JSON.stringify(entry))}`;
      try {
        await this.upstashFetch(setPath);
      } catch (error) {
        this.unreachableUntil = Date.now() + UNREACHABLE_TTL_MS;
        this.logger.warn(`[memory] no se pudo replicar a Upstash: ${String(error).slice(0, 80)}`);
      }
    }
    this.invalidateEntries(userId);
    return entry;
  }

  async setStructuredEntry(
    userId: string,
    key: string,
    payload: Record<string, unknown>,
    ttl?: number,
  ) {
    return this.setEntry(userId, key, JSON.stringify(payload), ttl);
  }

  async deleteEntry(userId: string, key: string) {
    const redisKey = `niki:memory:${userId}:${key}`;
    this.escribirLocal(userId, this.leerLocal(userId).filter((e) => e.key !== key));
    if (this.upstashDisponible) {
      try {
        await this.upstashFetch(`/del/${encodeURIComponent(redisKey)}`);
      } catch (error) {
        this.logger.warn(`[memory] no se pudo borrar en Upstash: ${String(error).slice(0, 80)}`);
      }
    }
    this.invalidateEntries(userId);
    return { ok: true };
  }
}
