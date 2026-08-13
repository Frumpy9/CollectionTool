import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import type { NeedsAttentionCategory, NeedsAttentionResponse } from "@collection-tool/shared";
import { createApp } from "../app.js";
import type { AppConfig } from "../config.js";
import { openDatabase, type AppDatabase } from "../db.js";
import { buildNeedsAttentionResponse } from "../routes/needsAttentionRoutes.js";

type TestServer = { app: FastifyInstance; database: AppDatabase; root: string };

test("needs-attention classifies durable evidence without inventing import history", async () => {
  const server = await createTestServer();
  try {
    const { collectionId, cookie } = await bootstrap(server.app);
    const missing = await createItem(server.app, collectionId, cookie, {
      name: "Missing Price",
      cardNumber: "1",
      imageUrl: "https://example.test/1.png"
    });
    const stale = await createItem(server.app, collectionId, cookie, {
      name: "Stale Price",
      cardNumber: "2",
      imageUrl: "https://example.test/2.png"
    });
    savePrice(server.database, stale.id, "2026-07-13T12:00:00.000Z", "possible");

    const ignoredMissing = await createItem(server.app, collectionId, cookie, {
      name: "Ignored Missing",
      cardNumber: "3",
      imageUrl: "https://example.test/3.png"
    });
    ignorePricing(server.database, ignoredMissing.id);
    const ignoredStale = await createItem(server.app, collectionId, cookie, {
      name: "Ignored Stale",
      cardNumber: "4",
      imageUrl: "https://example.test/4.png"
    });
    savePrice(server.database, ignoredStale.id, "2020-01-01T00:00:00.000Z", "possible");
    ignorePricing(server.database, ignoredStale.id);

    const duplicateCertA = await createItem(server.app, collectionId, cookie, {
      name: "Slab A",
      cardNumber: "5",
      imageUrl: "https://example.test/5.png",
      itemType: "graded",
      grader: "PSA",
      grade: "10",
      certNumber: "12-345 678"
    });
    const duplicateCertB = await createItem(server.app, collectionId, cookie, {
      name: "Slab B",
      cardNumber: "6",
      imageUrl: "https://example.test/6.png",
      itemType: "graded",
      grader: "PSA",
      grade: "9",
      certNumber: "12345678"
    });
    savePrice(server.database, duplicateCertA.id, "2026-08-01T00:00:00.000Z", "exact");
    savePrice(server.database, duplicateCertB.id, "2026-08-01T00:00:00.000Z", "exact");

    const duplicateA = await createItem(server.app, collectionId, cookie, {
      name: "Pikachu",
      setCode: "BS",
      cardNumber: "058",
      imageUrl: "https://example.test/7.png",
      conditionLabel: "Near Mint",
      variantDetails: "Standard, Holo / Foil"
    });
    const duplicateB = await createItem(server.app, collectionId, cookie, {
      name: " pikachu ",
      setCode: "bs",
      cardNumber: "58",
      imageUrl: "https://example.test/8.png",
      conditionLabel: "near  mint",
      variantDetails: "Holo / Foil,Standard"
    });
    const distinctVariant = await createItem(server.app, collectionId, cookie, {
      name: "Pikachu",
      setCode: "BS",
      cardNumber: "58",
      imageUrl: "https://example.test/9.png",
      conditionLabel: "Near Mint",
      variantDetails: "1st Edition"
    });
    for (const item of [duplicateA, duplicateB, distinctVariant]) {
      savePrice(server.database, item.id, "2026-08-01T00:00:00.000Z", "exact");
    }

    const incomplete = await createItem(server.app, collectionId, cookie, {
      name: "Incomplete Slab",
      imageUrl: "",
      setName: "",
      setCode: "",
      cardNumber: "",
      itemType: "graded",
      grader: "CGC",
      grade: "1",
      certNumber: "incomplete-cert"
    });
    server.database.connection
      .prepare("UPDATE owned_items SET grader = NULL, grade = NULL, cert_number = NULL WHERE id = ?")
      .run(incomplete.id);
    savePrice(server.database, incomplete.id, "2026-08-01T00:00:00.000Z", "strong");

    queueJob(server.database, collectionId, missing.id, "failed", "Older failure", "2026-08-10T00:00:00.000Z");
    queueJob(server.database, collectionId, missing.id, "needs-review", "Choose a match", "2026-08-11T00:00:00.000Z");
    queueJob(server.database, collectionId, distinctVariant.id, "failed", "Old failure", "2026-08-10T00:00:00.000Z");
    queueJob(server.database, collectionId, distinctVariant.id, "saved", "Saved", "2026-08-11T00:00:00.000Z");

    const attention = buildNeedsAttentionResponse(
      server.database,
      collectionId,
      new Date("2026-08-12T12:00:00.000Z")
    );

    assert.deepEqual(itemIds(attention, "missing-price").sort(), [missing.id].sort());
    assert.deepEqual(itemIds(attention, "stale-price"), [stale.id]);
    assert.deepEqual(itemIds(attention, "low-confidence"), [stale.id]);
    assert.equal(itemIds(attention, "missing-image").includes(incomplete.id), true);
    assert.equal(itemIds(attention, "incomplete-metadata").includes(incomplete.id), true);
    assert.deepEqual(new Set(itemIds(attention, "duplicate-cert")), new Set([duplicateCertA.id, duplicateCertB.id]));
    assert.deepEqual(new Set(itemIds(attention, "possible-duplicate")), new Set([duplicateA.id, duplicateB.id]));
    assert.equal(itemIds(attention, "possible-duplicate").includes(distinctVariant.id), false);
    assert.equal(issues(attention, "duplicate-cert")[0].duplicateMatch?.kind, "cert-number");
    assert.deepEqual(
      issues(attention, "duplicate-cert")[0].duplicateMatch?.reasons.map((reason) => reason.code),
      ["cert-number"]
    );
    assert.equal(
      issues(attention, "possible-duplicate")[0].duplicateMatch?.reasons.some(
        (reason) => reason.code === "variants"
      ),
      true
    );

    const failedWork = issues(attention, "failed-work");
    assert.equal(failedWork.length, 1, "only the latest attention-status work per item remains");
    assert.equal(failedWork[0].items[0].id, missing.id);
    assert.equal(failedWork[0].work?.status, "needs-review");
    assert.equal(failedWork[0].work?.message, "Choose a match");
    assert.equal(attention.sources.importHistory.available, false);
    if (attention.sources.importHistory.available) assert.fail("Import history should be unavailable.");
    assert.match(attention.sources.importHistory.reason, /No persisted server-side/i);
    assert.equal(attention.thresholds.stalePriceDays, 30);
  } finally {
    await closeTestServer(server);
  }
});

test("attention is viewer-readable but private to collection members", async () => {
  const server = await createTestServer();
  try {
    const { collectionId, cookie: ownerCookie } = await bootstrap(server.app);
    const viewer = await createUser(server.app, ownerCookie, "viewer");
    const outsider = await createUser(server.app, ownerCookie, "outsider");
    await addMember(server.app, collectionId, ownerCookie, viewer.id, "viewer");
    const viewerCookie = await login(server.app, "viewer");
    const outsiderCookie = await login(server.app, "outsider");

    const viewerRead = await server.app.inject({
      method: "GET",
      url: `/api/collections/${collectionId}/attention`,
      headers: { cookie: viewerCookie }
    });
    assert.equal(viewerRead.statusCode, 200);

    const outsiderRead = await server.app.inject({
      method: "GET",
      url: `/api/collections/${collectionId}/attention`,
      headers: { cookie: outsiderCookie }
    });
    assert.equal(outsiderRead.statusCode, 403);

    const unauthenticated = await server.app.inject({
      method: "GET",
      url: `/api/collections/${collectionId}/attention`
    });
    assert.equal(unauthenticated.statusCode, 401);
  } finally {
    await closeTestServer(server);
  }
});

test("attention category totals remain exact when returned groups are fairly bounded", async () => {
  const server = await createTestServer();
  try {
    const { collectionId, cookie } = await bootstrap(server.app);
    for (let index = 0; index < 55; index += 1) {
      await createItem(server.app, collectionId, cookie, {
        name: `Missing ${index}`,
        cardNumber: String(index + 1),
        imageUrl: `https://example.test/${index}.png`
      });
    }
    await createItem(server.app, collectionId, cookie, {
      name: "No Image",
      cardNumber: "999",
      imageUrl: ""
    });
    for (let index = 0; index < 30; index += 1) {
      const duplicate = await createItem(server.app, collectionId, cookie, {
        name: "Bounded Duplicate",
        cardNumber: "500",
        imageUrl: `https://example.test/duplicate-${index}.png`
      });
      savePrice(server.database, duplicate.id, "2026-08-01T00:00:00.000Z", "exact");
    }

    const response = await server.app.inject({
      method: "GET",
      url: `/api/collections/${collectionId}/attention`,
      headers: { cookie }
    });
    const attention = response.json() as NeedsAttentionResponse;
    const missingSummary = attention.summary.categories.find((entry) => entry.category === "missing-price")!;
    const imageSummary = attention.summary.categories.find((entry) => entry.category === "missing-image")!;
    const duplicateSummary = attention.summary.categories.find((entry) => entry.category === "possible-duplicate")!;

    assert.equal(missingSummary.groupCount, 56);
    assert.equal(missingSummary.itemCount, 56);
    assert.equal(missingSummary.returnedGroupCount, 50);
    assert.equal(missingSummary.truncated, true);
    assert.equal(issues(attention, "missing-price").length, 50);
    assert.equal(imageSummary.groupCount, 1);
    assert.equal(imageSummary.returnedGroupCount, 1, "later categories retain their own allowance");
    assert.equal(issues(attention, "missing-image").length, 1);
    assert.equal(duplicateSummary.groupCount, 1);
    assert.equal(duplicateSummary.itemCount, 30);
    assert.equal(issues(attention, "possible-duplicate")[0].totalItemCount, 30);
    assert.equal(issues(attention, "possible-duplicate")[0].items.length, 25);
    assert.equal(issues(attention, "possible-duplicate")[0].itemsTruncated, true);
    assert.equal(attention.results.truncated, true);
    assert.equal(attention.results.limitPerCategory, 50);
    assert.equal(attention.results.itemLimitPerGroup, 25);
  } finally {
    await closeTestServer(server);
  }
});

function issues(response: NeedsAttentionResponse, category: NeedsAttentionCategory) {
  return response.results.issues.filter((issue) => issue.category === category);
}

function itemIds(response: NeedsAttentionResponse, category: NeedsAttentionCategory) {
  return issues(response, category).flatMap((issue) => issue.items.map((item) => item.id));
}

async function createTestServer(): Promise<TestServer> {
  const root = mkdtempSync(join(tmpdir(), "collection-tool-attention-"));
  const databasePath = join(root, "collection.sqlite");
  const database = openDatabase(databasePath);
  const app = await createApp(testConfig(root, databasePath), database);
  return { app, database, root };
}

async function closeTestServer(server: TestServer) {
  await server.app.close();
  rmSync(server.root, { recursive: true, force: true });
}

async function bootstrap(app: FastifyInstance) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/bootstrap",
    payload: {
      email: "admin@example.test",
      username: "admin",
      displayName: "Admin",
      password: "admin-password"
    }
  });
  assert.equal(response.statusCode, 200);
  return { collectionId: response.json().collections[0].id as string, cookie: sessionCookie(response) };
}

async function createItem(
  app: FastifyInstance,
  collectionId: string,
  cookie: string,
  input: Record<string, unknown>
) {
  const response = await app.inject({
    method: "POST",
    url: `/api/collections/${collectionId}/items`,
    headers: { cookie },
    payload: {
      name: "Card",
      setName: "Test Set",
      setCode: "TST",
      cardNumber: "1",
      language: "en",
      itemType: "raw",
      quantity: 1,
      conditionLabel: "Near Mint",
      variantDetails: "Standard",
      ...input
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().item as { id: string };
}

function savePrice(database: AppDatabase, itemId: string, lookedUpAt: string, confidence: "exact" | "strong" | "possible") {
  database.connection.prepare(
    `INSERT INTO item_market_prices (
      owned_item_id, source, source_card_id, source_variant_id, matched_name,
      matched_set_name, matched_card_number, price_cents, confidence, looked_up_at, raw_payload
    ) VALUES (?, 'pokemonpricetracker', ?, 'variant', 'Card', 'Test Set', '1', 100, ?, ?, '{}')`
  ).run(itemId, `source-${itemId}`, confidence, lookedUpAt);
}

function ignorePricing(database: AppDatabase, itemId: string) {
  database.connection.prepare(
    "INSERT INTO item_price_refresh_ignores (owned_item_id, reason) VALUES (?, 'User decision')"
  ).run(itemId);
}

function queueJob(
  database: AppDatabase,
  collectionId: string,
  itemId: string,
  status: "failed" | "needs-review" | "saved",
  message: string,
  updatedAt: string
) {
  database.connection.prepare(
    `INSERT INTO bulk_price_queue (
      id, collection_id, owned_item_id, mode, status, attempts, include_existing,
      message, created_at, updated_at
    ) VALUES (?, ?, ?, 'auto', ?, 1, 0, ?, ?, ?)`
  ).run(randomUUID(), collectionId, itemId, status, message, updatedAt, updatedAt);
}

async function createUser(app: FastifyInstance, cookie: string, username: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/admin/users",
    headers: { cookie },
    payload: {
      email: `${username}@example.test`,
      username,
      displayName: username,
      password: "member-password",
      systemRole: "user"
    }
  });
  assert.equal(response.statusCode, 200);
  return response.json().user as { id: string };
}

async function addMember(
  app: FastifyInstance,
  collectionId: string,
  cookie: string,
  userId: string,
  role: "viewer"
) {
  const response = await app.inject({
    method: "POST",
    url: `/api/collections/${collectionId}/members`,
    headers: { cookie },
    payload: { userId, role }
  });
  assert.equal(response.statusCode, 200);
}

async function login(app: FastifyInstance, identifier: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { identifier, password: "member-password" }
  });
  assert.equal(response.statusCode, 200);
  return sessionCookie(response);
}

function sessionCookie(response: LightMyRequestResponse) {
  const header = response.headers["set-cookie"];
  const cookie = Array.isArray(header) ? header[0] : header;
  assert.equal(typeof cookie, "string");
  return cookie!.split(";")[0];
}

function testConfig(root: string, databasePath: string): AppConfig {
  return {
    nodeEnv: "test",
    isProduction: false,
    appUrl: "http://localhost:5173",
    databasePath,
    host: "127.0.0.1",
    port: 0,
    sessionSecret: "test-session-secret",
    cookieSecure: false,
    psaAccessToken: "",
    pokemonTcgApiKey: "",
    pokemonPriceTrackerApiKey: "",
    uploadsPath: join(root, "uploads"),
    maxImageUploadBytes: 1024,
    scheduledBackupsEnabled: false,
    backupIntervalHours: 24,
    backupRetentionDays: 30,
    scheduledPriceRefreshEnabled: false,
    priceRefreshIntervalHours: 12,
    priceRefreshBatchSize: 10
  };
}
