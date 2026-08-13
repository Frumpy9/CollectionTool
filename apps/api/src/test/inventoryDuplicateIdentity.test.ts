import assert from "node:assert/strict";
import test from "node:test";
import type { CreateInventoryItemRequest, InventoryItem } from "@collection-tool/shared";
import {
  findInventoryDuplicateMatches,
  groupInventoryDuplicates,
  inventoryDuplicateIdentityKey,
  inventoryIdentityFromItem,
  inventoryIdentityFromPayload
} from "../inventoryDuplicateIdentity.js";

test("exact inventory identity normalizes presentation without losing field reasons", () => {
  const item = inventoryItem({
    name: "Pikachu",
    setCode: "BS",
    cardNumber: "058",
    conditionLabel: "Near Mint",
    variantDetails: "Standard, Holo / Foil"
  });
  const payload = inventoryPayload({
    name: " pikachu ",
    setCode: "bs",
    cardNumber: "58",
    conditionLabel: "near  mint",
    variantDetails: "Holo / Foil, Standard"
  });

  assert.equal(
    inventoryDuplicateIdentityKey(inventoryIdentityFromItem(item)),
    inventoryDuplicateIdentityKey(inventoryIdentityFromPayload(payload))
  );

  const matches = findInventoryDuplicateMatches([item], payload);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].kind, "exact-identity");
  assert.equal(matches[0].mergeAllowed, true);
  assert.equal(matches[0].separateAllowed, true);
  assert.deepEqual(
    matches[0].reasons.map((reason) => reason.code),
    ["item-type", "language", "name", "set-code", "card-number", "condition", "variants"]
  );
});

test("variant-distinct cards remain separate identities", () => {
  const item = inventoryItem({ variantDetails: "Standard" });
  const payload = inventoryPayload({ variantDetails: "1st Edition" });

  assert.deepEqual(findInventoryDuplicateMatches([item], payload), []);
});

test("formatted cert matches take precedence and cannot be added separately", () => {
  const certItem = inventoryItem({
    id: "cert-match",
    name: "Charizard",
    itemType: "graded",
    grader: "PSA",
    grade: "10",
    certNumber: "12-345 678"
  });
  const exactWithoutCert = inventoryItem({ id: "identity-match" });
  const payload = inventoryPayload({
    name: "Different PSA label",
    itemType: "graded",
    grader: "PSA",
    grade: "9",
    certNumber: "12345678"
  });

  const matches = findInventoryDuplicateMatches([exactWithoutCert, certItem], payload);
  assert.deepEqual(matches.map((match) => match.item.id), ["cert-match"]);
  assert.equal(matches[0].kind, "cert-number");
  assert.equal(matches[0].mergeAllowed, true);
  assert.equal(matches[0].separateAllowed, false);
  assert.deepEqual(matches[0].reasons.map((reason) => reason.code), ["cert-number"]);
  assert.match(matches[0].reasons[0].message, /Certification number matches/);
});

test("duplicate grouping reports cert groups once and exact identity groups separately", () => {
  const certA = inventoryItem({ id: "cert-a", certNumber: "12-34", name: "Slab A" });
  const certB = inventoryItem({ id: "cert-b", certNumber: "1234", name: "Slab B" });
  const exactA = inventoryItem({ id: "exact-a", certNumber: null });
  const exactB = inventoryItem({ id: "exact-b", certNumber: null, cardNumber: "001" });
  const distinct = inventoryItem({ id: "distinct", certNumber: null, variantDetails: "Shadowless" });

  const groups = groupInventoryDuplicates([certA, certB, exactA, exactB, distinct]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.kind), ["cert-number", "exact-identity"]);
  assert.deepEqual(groups[0].items.map((item) => item.id), ["cert-a", "cert-b"]);
  assert.deepEqual(groups[1].items.map((item) => item.id), ["exact-a", "exact-b"]);
  assert.deepEqual(groups[0].reasons.map((reason) => reason.code), ["cert-number"]);
  assert.equal(groups[1].reasons.some((reason) => reason.code === "variants"), true);
});

function inventoryPayload(
  overrides: Partial<CreateInventoryItemRequest> = {}
): CreateInventoryItemRequest {
  return {
    name: "Bulbasaur",
    setName: "Base Set",
    setCode: "BS",
    cardNumber: "1",
    language: "en",
    itemType: "raw",
    quantity: 1,
    conditionLabel: "Near Mint",
    variantDetails: "Standard",
    ...overrides
  };
}

function inventoryItem(
  overrides: Partial<Omit<InventoryItem, "card">> & Partial<InventoryItem["card"]> = {}
): InventoryItem {
  const { name, setName, setCode, cardNumber, language, rarity, releaseYear, imageUrl, ...item } =
    overrides;
  return {
    id: "item-1",
    collectionId: "collection-1",
    cardId: "card-1",
    itemType: "raw",
    quantity: 1,
    conditionLabel: "Near Mint",
    conditionScore: null,
    variantDetails: "Standard",
    grader: null,
    grade: null,
    certNumber: null,
    purchasePriceCents: null,
    purchaseDate: null,
    valueOverrideCents: null,
    marketPriceCents: null,
    marketPriceSource: null,
    marketPriceUpdatedAt: null,
    marketPriceConfidence: null,
    marketPriceMatchedName: null,
    marketPriceMatchedSetName: null,
    marketPriceMatchedCardNumber: null,
    marketPriceCondition: null,
    marketPricePrinting: null,
    marketPriceSaleCount: null,
    marketPricePreviousCents: null,
    marketPriceChangeCents: null,
    marketPriceChangePercent: null,
    marketPriceSnapshotCount: 0,
    storageLocation: null,
    notes: null,
    certUrl: null,
    certSpecId: null,
    certCategory: null,
    certPopulation: null,
    certPopulationHigher: null,
    certEstimateCents: null,
    certLookupAt: null,
    createdAt: "2026-08-13T00:00:00.000Z",
    card: {
      name: name ?? "Bulbasaur",
      setName: setName ?? "Base Set",
      setCode: setCode ?? "BS",
      cardNumber: cardNumber ?? "1",
      language: language ?? "en",
      rarity: rarity ?? null,
      releaseYear: releaseYear ?? null,
      imageUrl: imageUrl ?? null
    },
    ...item
  };
}
