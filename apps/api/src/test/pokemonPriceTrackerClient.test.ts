import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchPokemonPriceTrackerJson,
  PokemonPriceTrackerRateLimitError
} from "../pokemonPriceTrackerClient.js";

test("successful PokemonPriceTracker responses with zero remaining header do not start cooldown", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;

  globalThis.fetch = (async () => {
    requests += 1;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "60"
      }
    });
  }) as typeof fetch;

  try {
    await fetchPokemonPriceTrackerJson("https://example.test/cards", "test-token");

    await assert.doesNotReject(
      fetchPokemonPriceTrackerJson("https://example.test/cards", "test-token"),
      PokemonPriceTrackerRateLimitError
    );
    assert.equal(requests, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
