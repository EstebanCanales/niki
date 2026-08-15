import assert from "node:assert/strict";
import test from "node:test";

import { UserMemoryService } from "./user-memory.service";

/**
 * El caché existe para sacar Upstash del camino crítico de un turno de voz: los tres
 * consumidores de memoria (prefetch, persona, runtime context) piden a la vez, y entre
 * turnos de una misma llamada no debería haber ninguna ida a la red. Lo que se prueba
 * acá es exactamente eso — cuántas veces se llega al almacén, no qué devuelve.
 */
function makeService() {
  let calls = 0;
  const service = new UserMemoryService({
    get: () => ({
      upstashRedisRestUrl: "https://example.invalid",
      upstashRedisRestToken: "token",
    }),
  } as never);

  // Interceptamos la capa de red, no safeListEntries: así el caché y el circuito
  // abierto que envuelven a listEntries quedan bajo prueba de verdad.
  (service as unknown as { listEntries: (userId: string) => Promise<unknown[]> }).listEntries =
    async (userId: string) => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 5));
      return [{ key: "k", value: `v-${userId}`, updatedAt: "2026-01-01T00:00:00.000Z" }];
    };

  return { service, calls: () => calls };
}

test("safeListEntries deduplica las lecturas concurrentes del mismo usuario", async () => {
  const { service, calls } = makeService();

  const [a, b, c] = await Promise.all([
    service.safeListEntries("u1"),
    service.safeListEntries("u1"),
    service.safeListEntries("u1"),
  ]);

  assert.equal(calls(), 1, "tres consumidores simultáneos deben compartir una sola lectura");
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
});

test("safeListEntries sirve del caché en llamadas posteriores", async () => {
  const { service, calls } = makeService();

  await service.safeListEntries("u1");
  await service.safeListEntries("u1");

  assert.equal(calls(), 1, "el segundo turno de una llamada no debe volver a Upstash");
});

test("safeListEntries no mezcla usuarios", async () => {
  const { service, calls } = makeService();

  await service.safeListEntries("u1");
  await service.safeListEntries("u2");

  assert.equal(calls(), 2);
});

test("escribir invalida el caché de ese usuario", async () => {
  const { service, calls } = makeService();
  let written = 0;
  (service as unknown as { upstashFetch: () => Promise<unknown> }).upstashFetch = async () => {
    written += 1;
    return { json: async () => ({ result: "OK" }) };
  };

  await service.safeListEntries("u1");
  await service.setEntry("u1", "gusto", "café");
  await service.safeListEntries("u1");

  assert.equal(written, 1, "la escritura tiene que llegar a Upstash");
  assert.equal(calls(), 2, "un hecho recién guardado debe forzar una relectura");
});

test("borrar invalida el caché de ese usuario", async () => {
  const { service, calls } = makeService();
  (service as unknown as { upstashFetch: () => Promise<unknown> }).upstashFetch = async () => ({
    json: async () => ({ result: 1 }),
  });

  await service.safeListEntries("u1");
  await service.deleteEntry("u1", "gusto");
  await service.safeListEntries("u1");

  assert.equal(calls(), 2);
});

test("la memoria sobrevive aunque Upstash no exista", async () => {
  // El caso real de este proyecto: el host de Upstash da NXDOMAIN, la base ya no está.
  // Antes de esto, safeListEntries devolvía [] y Niki arrancaba en blanco cada vez.
  const { UserMemoryService } = await import("./user-memory.service");
  const service = new UserMemoryService({
    get: () => ({ upstashRedisRestUrl: "", upstashRedisRestToken: "" }),
  } as never);

  const userId = `test-local-${process.pid}`;
  await service.setEntry(userId, "editor", "Zed");
  await service.setEntry(userId, "ciudad", "San José");

  // Un servicio nuevo: nada en memoria de proceso, todo tiene que venir del disco.
  const otro = new UserMemoryService({
    get: () => ({ upstashRedisRestUrl: "", upstashRedisRestToken: "" }),
  } as never);
  const entradas = await otro.safeListEntries(userId);

  assert.equal(entradas.length, 2, "las dos entradas tienen que volver del disco");
  assert.equal(entradas.find((e) => e.key === "editor")?.value, "Zed");
  await otro.deleteEntry(userId, "editor");
  assert.equal((await otro.safeListEntries(userId)).length, 1, "borrar tiene que persistir");
  await otro.deleteEntry(userId, "ciudad");
});

test("escribir dos veces la misma clave no duplica", async () => {
  const { UserMemoryService } = await import("./user-memory.service");
  const service = new UserMemoryService({
    get: () => ({ upstashRedisRestUrl: "", upstashRedisRestToken: "" }),
  } as never);
  const userId = `test-dup-${process.pid}`;
  await service.setEntry(userId, "color", "azul");
  await service.setEntry(userId, "color", "verde");
  const entradas = await service.safeListEntries(userId);
  assert.equal(entradas.length, 1);
  assert.equal(entradas[0].value, "verde", "gana el último valor");
  await service.deleteEntry(userId, "color");
});
