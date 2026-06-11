import assert from "node:assert/strict";
import test from "node:test";

import { HermesProbeCache } from "./hermes-probe-cache";

test("HermesProbeCache reuses fresh cached values within ttl", async () => {
  let now = 1_000;
  let calls = 0;
  const cache = new HermesProbeCache<string>(500, () => now);

  const first = await cache.get("sig-a", async () => {
    calls += 1;
    return `value-${calls}`;
  });

  now = 1_200;

  const second = await cache.get("sig-a", async () => {
    calls += 1;
    return `value-${calls}`;
  });

  assert.equal(first, "value-1");
  assert.equal(second, "value-1");
  assert.equal(calls, 1);
});

test("HermesProbeCache deduplicates concurrent loads for the same signature", async () => {
  let calls = 0;
  const cache = new HermesProbeCache<string>(500);

  const loader = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return `value-${calls}`;
  };

  const [first, second] = await Promise.all([
    cache.get("sig-a", loader),
    cache.get("sig-a", loader),
  ]);

  assert.equal(first, "value-1");
  assert.equal(second, "value-1");
  assert.equal(calls, 1);
});

test("HermesProbeCache invalidates on signature change and clear", async () => {
  let now = 2_000;
  let calls = 0;
  const cache = new HermesProbeCache<string>(250, () => now);

  const first = await cache.get("sig-a", async () => {
    calls += 1;
    return `value-${calls}`;
  });

  const second = await cache.get("sig-b", async () => {
    calls += 1;
    return `value-${calls}`;
  });

  cache.clear();

  const third = await cache.get("sig-b", async () => {
    calls += 1;
    return `value-${calls}`;
  });

  now = 2_500;

  const fourth = await cache.get("sig-b", async () => {
    calls += 1;
    return `value-${calls}`;
  });

  assert.equal(first, "value-1");
  assert.equal(second, "value-2");
  assert.equal(third, "value-3");
  assert.equal(fourth, "value-4");
  assert.equal(calls, 4);
});
