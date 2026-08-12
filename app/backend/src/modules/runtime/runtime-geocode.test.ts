import assert from "node:assert/strict";
import { test } from "node:test";

import { geocodeAddress } from "./runtime-geocode";

test("returns coordinates from a successful Nominatim response", async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => [{ lat: "40.4167", lon: "-3.7033", display_name: "Madrid, España" }],
  });

  const result = await geocodeAddress("Madrid", fakeFetch as never);
  assert.ok(result);
  assert.equal(result?.lat, 40.4167);
  assert.equal(result?.lng, -3.7033);
  assert.equal(result?.displayName, "Madrid, España");
});

test("returns null when there are no results", async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => [] });
  const result = await geocodeAddress("un lugar que no existe en ningún mapa", fakeFetch as never);
  assert.equal(result, null);
});

test("returns null when the response is not ok", async () => {
  const fakeFetch = async () => ({ ok: false, json: async () => [] });
  const result = await geocodeAddress("Madrid", fakeFetch as never);
  assert.equal(result, null);
});

test("returns null instead of throwing when fetch rejects", async () => {
  const fakeFetch = async () => {
    throw new Error("network down");
  };
  const result = await geocodeAddress("Madrid", fakeFetch as never);
  assert.equal(result, null);
});

test("returns null for blank input without calling fetch", async () => {
  let called = false;
  const fakeFetch = async () => {
    called = true;
    return { ok: true, json: async () => [] };
  };
  const result = await geocodeAddress("   ", fakeFetch as never);
  assert.equal(result, null);
  assert.equal(called, false);
});

test("strips a leading Spanish article before querying (avoids false-positive street matches)", async () => {
  let seenUrl = "";
  const fakeFetch = async (url: string) => {
    seenUrl = url;
    return { ok: true, json: async () => [{ lat: "48.8582599", lon: "2.2945006", display_name: "Tour Eiffel, Paris, France" }] };
  };
  const result = await geocodeAddress("la Torre Eiffel de Paris", fakeFetch as never);
  assert.ok(result);
  assert.equal(result?.lat, 48.8582599);
  assert.ok(seenUrl.includes(encodeURIComponent("Torre Eiffel de Paris")));
  assert.ok(!seenUrl.includes(encodeURIComponent("la Torre Eiffel de Paris")));
});

test("returns null when lat/lon are not numeric", async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => [{ lat: "not-a-number", lon: "-3.7033", display_name: "x" }],
  });
  const result = await geocodeAddress("Madrid", fakeFetch as never);
  assert.equal(result, null);
});
