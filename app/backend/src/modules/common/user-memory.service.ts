import { Inject, Injectable, Logger } from "@nestjs/common";

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
    if (Date.now() < this.unreachableUntil) return [];

    const cached = this.entriesCache.get(userId);
    if (cached && Date.now() < cached.expiresAt) return cached.entries;

    const inFlight = this.entriesInFlight.get(userId);
    if (inFlight) return inFlight;

    const request = (async () => {
      try {
        const result = await this.listEntries(userId);
        this.unreachableUntil = 0;
        this.entriesCache.set(userId, {
          entries: result,
          expiresAt: Date.now() + ENTRIES_CACHE_TTL_MS,
        });
        return result;
      } catch (error) {
        this.unreachableUntil = Date.now() + UNREACHABLE_TTL_MS;
        this.logger.warn(`[memory] safeListEntries failed for ${userId}: ${String(error)}`);
        return [] as StoredMemoryEntry[];
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

  async setEntry(userId: string, key: string, value: string, ttl?: number) {
    const redisKey = `niki:memory:${userId}:${key}`;
    const entry: StoredMemoryEntry = {
      key,
      value,
      ttl,
      updatedAt: new Date().toISOString(),
    };
    const setPath = ttl
      ? `/set/${encodeURIComponent(redisKey)}/${encodeURIComponent(JSON.stringify(entry))}/ex/${ttl}`
      : `/set/${encodeURIComponent(redisKey)}/${encodeURIComponent(JSON.stringify(entry))}`;
    await this.upstashFetch(setPath);
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
    await this.upstashFetch(`/del/${encodeURIComponent(redisKey)}`);
    this.invalidateEntries(userId);
    return { ok: true };
  }
}
