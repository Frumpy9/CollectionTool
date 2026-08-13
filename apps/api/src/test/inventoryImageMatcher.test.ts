import assert from "node:assert/strict";
import test from "node:test";
import type { CardLookupCandidate, CreateInventoryItemRequest } from "@collection-tool/shared";
import {
  imageCandidateMatchesInventory,
  inventoryImageLookupQueries,
  rankInventoryImageCandidates
} from "../inventoryImageMatcher.js";

test("image lookup builds bounded identity queries and removes PSA finish suffixes", () => {
  const queries = inventoryImageLookupQueries(
    payload({ name: "Charizard - Holo", setName: "Base Set", setCode: "BS", cardNumber: "4/102" })
  );

  assert.equal(queries.includes("Charizard - Holo Base Set 4/102"), true);
  assert.equal(queries.includes("Charizard Base Set 4/102"), true);
  assert.equal(queries.includes("BS 4/102"), true);
  assert.equal(queries.length, new Set(queries.map((query) => query.toLowerCase())).size);
});

test("image ranking returns structured reasons and puts the complete identity first", () => {
  const inventory = payload();
  const exact = candidate({ id: "exact", imageUrl: "https://img.test/exact.png" });
  const partial = candidate({
    id: "partial",
    imageUrl: "https://img.test/partial.png",
    setCode: null,
    setName: null,
    cardNumber: null,
    confidence: "strong",
    score: 10
  });

  const ranked = rankInventoryImageCandidates(inventory, [
    { candidate: partial, query: "Pikachu" },
    { candidate: exact, query: "Pikachu Base Set 58" }
  ]);

  assert.deepEqual(ranked.map((entry) => entry.id), ["exact", "partial"]);
  assert.equal(ranked[0].imageMatchConfidence, "exact");
  assert.equal(ranked[1].imageMatchConfidence, "possible");
  assert.equal(
    ranked[0].imageMatchReasons.find((reason) => reason.code === "card-number")?.status,
    "match"
  );
  assert.equal(
    ranked[0].imageMatchReasons.find((reason) => reason.code === "set-code")?.scoreDelta,
    50
  );
});

test("incompatible card numbers, names, and sets are rejected before ranking", () => {
  const inventory = payload();

  assert.equal(
    imageCandidateMatchesInventory(inventory, candidate({ cardNumber: "59/102" })),
    false
  );
  assert.equal(
    imageCandidateMatchesInventory(inventory, candidate({ name: "Raichu" })),
    false
  );
  assert.equal(
    imageCandidateMatchesInventory(inventory, candidate({ setName: "Jungle" })),
    false
  );
});

test("duplicate image URLs keep the highest-ranked metadata and aggregate query evidence", () => {
  const inventory = payload();
  const lower = candidate({
    id: "lower",
    imageUrl: "https://img.test/shared.png",
    confidence: "possible",
    score: 1
  });
  const higher = candidate({
    id: "higher",
    imageUrl: "https://img.test/shared.png",
    confidence: "exact",
    score: 50
  });

  const ranked = rankInventoryImageCandidates(inventory, [
    { candidate: lower, query: "Pikachu" },
    { candidate: higher, query: "BS 58" }
  ]);

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].id, "higher");
  assert.deepEqual(ranked[0].matchedQueries, ["Pikachu", "BS 58"]);
});

function payload(
  overrides: Partial<CreateInventoryItemRequest> = {}
): CreateInventoryItemRequest {
  return {
    name: "Pikachu",
    setName: "Base Set",
    setCode: "BS",
    cardNumber: "058/102",
    language: "en",
    itemType: "raw",
    quantity: 1,
    ...overrides
  };
}

function candidate(overrides: Partial<CardLookupCandidate> = {}): CardLookupCandidate {
  const item = payload({
    name: overrides.name ?? "Pikachu",
    setName: overrides.setName === undefined ? "Base Set" : overrides.setName ?? "",
    setCode: overrides.setCode === undefined ? "BS" : overrides.setCode ?? "",
    cardNumber: overrides.cardNumber === undefined ? "58/102" : overrides.cardNumber ?? "",
    language: overrides.language ?? "en",
    imageUrl: overrides.imageUrl ?? "https://img.test/default.png"
  });
  return {
    id: "candidate",
    source: "pokemontcg",
    sourceId: "source-card",
    confidence: "exact",
    name: "Pikachu",
    setName: "Base Set",
    setCode: "BS",
    cardNumber: "58/102",
    language: "en",
    rarity: "Common",
    imageUrl: "https://img.test/default.png",
    item,
    score: 20,
    ...overrides
  };
}
