import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import type { AppConfig } from "../config.js";
import { createApp } from "../app.js";
import { openDatabase, type AppDatabase } from "../db.js";

type TestServer = {
  app: FastifyInstance;
  database: AppDatabase;
  root: string;
};

test("admin protections block disabling or demoting the last enabled admin", async () => {
  const server = await createTestServer();
  try {
    const { user, collections, cookie } = await bootstrapAdmin(server.app);
    const disableResponse = await server.app.inject({
      method: "POST",
      url: `/api/admin/users/${user.id}/disable`,
      headers: { cookie }
    });

    assert.equal(disableResponse.statusCode, 400);
    assert.match(disableResponse.json().error, /at least one enabled system admin/i);

    const demoteResponse = await server.app.inject({
      method: "PATCH",
      url: `/api/admin/users/${user.id}`,
      headers: { cookie },
      payload: {
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        systemRole: "user"
      }
    });

    assert.equal(demoteResponse.statusCode, 400);
    assert.match(demoteResponse.json().error, /at least one enabled system admin/i);
    assert.equal(collections.length, 1);
  } finally {
    await closeTestServer(server);
  }
});

test("disabled users cannot log in or keep active sessions", async () => {
  const server = await createTestServer();
  try {
    const { cookie: adminCookie } = await bootstrapAdmin(server.app);
    const created = await createAdminUser(server.app, adminCookie, {
      email: "reader@example.test",
      username: "reader",
      displayName: "Reader User",
      password: "reader-password",
      systemRole: "user"
    });

    const userLogin = await login(server.app, "reader", "reader-password");
    assert.equal(userLogin.user.username, "reader");

    const disableResponse = await server.app.inject({
      method: "POST",
      url: `/api/admin/users/${created.id}/disable`,
      headers: { cookie: adminCookie }
    });

    assert.equal(disableResponse.statusCode, 200);
    assert.ok(disableResponse.json().user.disabledAt);

    const rejectedLogin = await server.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { identifier: "reader", password: "reader-password" }
    });

    assert.equal(rejectedLogin.statusCode, 401);

    const sessionCheck = await server.app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: userLogin.cookie }
    });

    assert.equal(sessionCheck.statusCode, 200);
    assert.equal(sessionCheck.json().user, null);
  } finally {
    await closeTestServer(server);
  }
});

test("collection members require manager access and disabled users cannot be added", async () => {
  const server = await createTestServer();
  try {
    const { collections, cookie: adminCookie } = await bootstrapAdmin(server.app);
    const collectionId = collections[0].id;
    const viewer = await createAdminUser(server.app, adminCookie, {
      email: "viewer@example.test",
      username: "viewer",
      displayName: "Viewer User",
      password: "viewer-password",
      systemRole: "user"
    });
    const disabled = await createAdminUser(server.app, adminCookie, {
      email: "disabled@example.test",
      username: "disabled",
      displayName: "Disabled User",
      password: "disabled-password",
      systemRole: "user"
    });

    await server.app.inject({
      method: "POST",
      url: `/api/admin/users/${disabled.id}/disable`,
      headers: { cookie: adminCookie }
    });

    const addDisabledResponse = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/members`,
      headers: { cookie: adminCookie },
      payload: { userId: disabled.id, role: "viewer" }
    });

    assert.equal(addDisabledResponse.statusCode, 400);
    assert.match(addDisabledResponse.json().error, /enable this user/i);

    const addViewerResponse = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/members`,
      headers: { cookie: adminCookie },
      payload: { userId: viewer.id, role: "viewer" }
    });

    assert.equal(addViewerResponse.statusCode, 200);

    const viewerLogin = await login(server.app, "viewer", "viewer-password");
    const memberResponse = await server.app.inject({
      method: "GET",
      url: `/api/collections/${collectionId}/members`,
      headers: { cookie: viewerLogin.cookie }
    });

    assert.equal(memberResponse.statusCode, 403);
  } finally {
    await closeTestServer(server);
  }
});

test("inventory creation persists PokemonPriceTracker pricing source hints", async () => {
  const server = await createTestServer();
  try {
    const { collections, cookie } = await bootstrapAdmin(server.app);
    const collectionId = collections[0].id;
    const createResponse = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/items`,
      headers: { cookie },
      payload: {
        name: "Articuno",
        setName: "Mystery of the Fossils",
        setCode: "23723",
        language: "ja",
        itemType: "raw",
        quantity: 1,
        notes: "PokemonPriceTracker card 575680",
        pricingSource: {
          source: "pokemonpricetracker",
          sourceCardId: "575680",
          confidence: "exact"
        }
      }
    });

    assert.equal(createResponse.statusCode, 201);
    const itemId = createResponse.json().item.id;
    const sourceMatch = server.database.connection
      .prepare(
        `
          SELECT source_card_id, source_variant_id, match_kind, confidence
          FROM item_price_source_matches
          WHERE owned_item_id = ? AND source = 'pokemonpricetracker'
        `
      )
      .get(itemId) as
      | {
          source_card_id: string;
          source_variant_id: string;
          match_kind: string;
          confidence: string;
        }
      | undefined;

    assert.deepEqual({ ...sourceMatch }, {
      source_card_id: "575680",
      source_variant_id: "",
      match_kind: "automatic",
      confidence: "exact"
    });
  } finally {
    await closeTestServer(server);
  }
});

test("collection summaries use the same value precedence as inventory totals", async () => {
  const server = await createTestServer();
  try {
    const { collections, cookie } = await bootstrapAdmin(server.app);
    const collectionId = collections[0].id;
    const createResponse = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/items`,
      headers: { cookie },
      payload: {
        name: "Pikachu",
        setName: "Base Set",
        setCode: "BS",
        cardNumber: "58",
        language: "en",
        itemType: "raw",
        quantity: 2,
        purchasePriceCents: 1_000
      }
    });

    assert.equal(createResponse.statusCode, 201);
    const itemId = createResponse.json().item.id;

    server.database.connection
      .prepare(
        `
          INSERT INTO item_market_prices (
            owned_item_id,
            source,
            source_card_id,
            source_variant_id,
            matched_name,
            matched_set_name,
            matched_card_number,
            price_cents,
            currency,
            confidence,
            looked_up_at,
            raw_payload
          )
          VALUES (?, 'pokemonpricetracker', 'price-card', 'near-mint', ?, ?, ?, 2500, 'USD', 'exact', ?, '{}')
        `
      )
      .run(itemId, "Pikachu", "Base Set", "58", new Date().toISOString());

    const marketSummaryResponse = await server.app.inject({
      method: "GET",
      url: "/api/collections",
      headers: { cookie }
    });

    assert.equal(marketSummaryResponse.statusCode, 200);
    assert.equal(marketSummaryResponse.json().collections[0].estimatedValueCents, 5_000);

    const overrideResponse = await server.app.inject({
      method: "PATCH",
      url: `/api/collections/${collectionId}/items/${itemId}`,
      headers: { cookie },
      payload: {
        name: "Pikachu",
        setName: "Base Set",
        setCode: "BS",
        cardNumber: "58",
        language: "en",
        itemType: "raw",
        quantity: 2,
        purchasePriceCents: 1_000,
        valueOverrideCents: 3_000
      }
    });

    assert.equal(overrideResponse.statusCode, 200);

    const overrideSummaryResponse = await server.app.inject({
      method: "GET",
      url: "/api/collections",
      headers: { cookie }
    });

    assert.equal(overrideSummaryResponse.statusCode, 200);
    assert.equal(overrideSummaryResponse.json().collections[0].estimatedValueCents, 6_000);
  } finally {
    await closeTestServer(server);
  }
});

test("collection value history stays immutable after valuation edits and deletion", async () => {
  const server = await createTestServer();
  try {
    const { collections, cookie } = await bootstrapAdmin(server.app);
    const collectionId = collections[0].id;
    const basePayload = {
      name: "Shaymin-EX",
      setName: "Roaring Skies",
      setCode: "ROS",
      cardNumber: "77",
      language: "en",
      itemType: "raw",
      quantity: 1,
      purchasePriceCents: 1_000
    };
    const createResponse = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/items`,
      headers: { cookie },
      payload: basePayload
    });

    assert.equal(createResponse.statusCode, 201);
    const itemId = createResponse.json().item.id;
    const firstHistory = await getCollectionValueHistory(server.app, collectionId, cookie);
    assert.equal(firstHistory.length, 1);
    assert.equal(firstHistory[0].valueCents, 1_000);
    assert.equal(firstHistory[0].itemQuantity, 1);
    assert.equal(firstHistory[0].reason, "inventory_add");
    const immutablePoint = JSON.stringify(firstHistory[0]);

    const quantityResponse = await server.app.inject({
      method: "PATCH",
      url: `/api/collections/${collectionId}/items/${itemId}`,
      headers: { cookie },
      payload: { ...basePayload, quantity: 2 }
    });

    assert.equal(quantityResponse.statusCode, 200);
    await assertHistoryPointUnchanged(
      server.app,
      collectionId,
      cookie,
      firstHistory[0].id,
      immutablePoint
    );

    const purchasePriceResponse = await server.app.inject({
      method: "PATCH",
      url: `/api/collections/${collectionId}/items/${itemId}`,
      headers: { cookie },
      payload: { ...basePayload, quantity: 2, purchasePriceCents: 1_500 }
    });

    assert.equal(purchasePriceResponse.statusCode, 200);
    await assertHistoryPointUnchanged(
      server.app,
      collectionId,
      cookie,
      firstHistory[0].id,
      immutablePoint
    );

    const overrideResponse = await server.app.inject({
      method: "PATCH",
      url: `/api/collections/${collectionId}/items/${itemId}`,
      headers: { cookie },
      payload: {
        ...basePayload,
        quantity: 2,
        purchasePriceCents: 1_500,
        valueOverrideCents: 2_000
      }
    });

    assert.equal(overrideResponse.statusCode, 200);
    await assertHistoryPointUnchanged(
      server.app,
      collectionId,
      cookie,
      firstHistory[0].id,
      immutablePoint
    );

    const deleteResponse = await server.app.inject({
      method: "DELETE",
      url: `/api/collections/${collectionId}/items/${itemId}`,
      headers: { cookie }
    });

    assert.equal(deleteResponse.statusCode, 200);
    const finalHistory = await getCollectionValueHistory(server.app, collectionId, cookie);
    const originalAfterDelete = finalHistory.find(
      (point: { id: string }) => point.id === firstHistory[0].id
    );
    assert.equal(JSON.stringify(originalAfterDelete), immutablePoint);
    assert.deepEqual(
      finalHistory.map(
        (point: { valueCents: number; itemQuantity: number; reason: string }) => ({
          valueCents: point.valueCents,
          itemQuantity: point.itemQuantity,
          reason: point.reason
        })
      ),
      [
        { valueCents: 1_000, itemQuantity: 1, reason: "inventory_add" },
        { valueCents: 2_000, itemQuantity: 2, reason: "inventory_update" },
        { valueCents: 3_000, itemQuantity: 2, reason: "inventory_update" },
        { valueCents: 4_000, itemQuantity: 2, reason: "inventory_update" },
        { valueCents: 0, itemQuantity: 0, reason: "inventory_delete" }
      ]
    );
  } finally {
    await closeTestServer(server);
  }
});

test("migration 19 preserves legacy price dates as clearly labeled approximate points", async () => {
  const server = await createTestServer();
  let migratedDatabase: AppDatabase | null = null;
  let appClosed = false;
  try {
    const { collections, cookie } = await bootstrapAdmin(server.app);
    const collectionId = collections[0].id;
    const createResponse = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/items`,
      headers: { cookie },
      payload: {
        name: "Pikachu",
        setName: "Base Set",
        setCode: "BS",
        cardNumber: "58",
        language: "en",
        itemType: "raw",
        quantity: 1,
        purchasePriceCents: 1_000
      }
    });

    assert.equal(createResponse.statusCode, 201);
    const itemId = createResponse.json().item.id;
    server.database.connection
      .prepare("UPDATE owned_items SET created_at = '2023-01-01 00:00:00' WHERE id = ?")
      .run(itemId);
    server.database.connection
      .prepare(
        `
          INSERT INTO item_market_prices (
            owned_item_id, source, source_card_id, source_variant_id, matched_name,
            price_cents, currency, confidence, looked_up_at, raw_payload
          )
          VALUES (?, 'pokemonpricetracker', 'legacy-card', 'near-mint', 'Pikachu',
            1400, 'USD', 'exact', '2024-02-01T00:00:00.000Z', '{}')
        `
      )
      .run(itemId);
    const insertLegacyPrice = server.database.connection.prepare(
      `
        INSERT INTO item_market_price_snapshots (
          id, owned_item_id, source, price_kind, source_card_id, source_variant_id,
          matched_name, price_cents, previous_price_cents, delta_cents, confidence, captured_at
        )
        VALUES (?, ?, 'pokemonpricetracker', 'raw', 'legacy-card', 'near-mint',
          'Pikachu', ?, ?, ?, 'exact', ?)
      `
    );
    insertLegacyPrice.run(
      "legacy-snapshot-1",
      itemId,
      1_200,
      null,
      null,
      "2024-01-01T00:00:00.000Z"
    );
    insertLegacyPrice.run(
      "legacy-snapshot-2",
      itemId,
      1_400,
      1_200,
      200,
      "2024-02-01T00:00:00.000Z"
    );

    server.database.connection.exec(`
      DROP TABLE collection_value_snapshots;
      DELETE FROM schema_migrations WHERE id = 19;
      UPDATE app_metadata SET value = '18' WHERE key = 'schema_version';
    `);
    await server.app.close();
    appClosed = true;

    migratedDatabase = openDatabase(server.database.path);
    assert.equal(migratedDatabase.migrationsApplied, 1);
    const legacyPoints = migratedDatabase.connection
      .prepare(
        `
          SELECT value_cents, item_quantity, reason, refreshed_item_count, captured_at
          FROM collection_value_snapshots
          WHERE collection_id = ?
          ORDER BY julianday(captured_at), created_at, rowid
        `
      )
      .all(collectionId);

    assert.deepEqual(
      legacyPoints.map((point) => ({ ...point })),
      [
        {
          value_cents: 1_200,
          item_quantity: 1,
          reason: "legacy_price_refresh",
          refreshed_item_count: 1,
          captured_at: "2024-01-01T00:00:00.000Z"
        },
        {
          value_cents: 1_400,
          item_quantity: 1,
          reason: "legacy_price_refresh",
          refreshed_item_count: 1,
          captured_at: "2024-02-01T00:00:00.000Z"
        }
      ]
    );
  } finally {
    migratedDatabase?.connection.close();

    if (!appClosed) {
      await server.app.close();
      server.database.connection.close();
    }

    rmSync(server.root, { recursive: true, force: true });
  }
});

test("market price saves and bulk valuation changes append history without duplicate noise", async () => {
  const server = await createTestServer();
  try {
    const { collections, cookie } = await bootstrapAdmin(server.app);
    const collectionId = collections[0].id;
    const createResponse = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/items`,
      headers: { cookie },
      payload: {
        name: "Pikachu",
        setName: "Base Set",
        setCode: "BS",
        cardNumber: "58",
        language: "en",
        itemType: "raw",
        quantity: 1,
        purchasePriceCents: 1_000
      }
    });

    assert.equal(createResponse.statusCode, 201);
    const itemId = createResponse.json().item.id;
    const selectPrice = (priceCents: number) =>
      server.app.inject({
        method: "POST",
        url: `/api/collections/${collectionId}/items/${itemId}/pricing/select`,
        headers: { cookie },
        payload: pricingCandidate(priceCents)
      });

    assert.equal((await selectPrice(2_500)).statusCode, 200);
    let history = await getCollectionValueHistory(server.app, collectionId, cookie);
    assert.deepEqual(
      history.map((point) => [point.valueCents, point.reason]),
      [
        [1_000, "inventory_add"],
        [2_500, "market_price_update"]
      ]
    );

    assert.equal((await selectPrice(2_500)).statusCode, 200);
    history = await getCollectionValueHistory(server.app, collectionId, cookie);
    assert.equal(history.length, 2, "an unchanged price refresh should not add a value point");

    const variantResponse = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/items/bulk/variants`,
      headers: { cookie },
      payload: {
        itemIds: [itemId],
        mode: "set",
        variants: ["Holo"],
        clearMarketPrices: true
      }
    });

    assert.equal(variantResponse.statusCode, 200);
    history = await getCollectionValueHistory(server.app, collectionId, cookie);
    assert.deepEqual(
      history.map((point) => [point.valueCents, point.reason]),
      [
        [1_000, "inventory_add"],
        [2_500, "market_price_update"],
        [1_000, "inventory_update"]
      ]
    );

    const bulkDeleteResponse = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/items/bulk/delete`,
      headers: { cookie },
      payload: { itemIds: [itemId] }
    });

    assert.equal(bulkDeleteResponse.statusCode, 200);
    history = await getCollectionValueHistory(server.app, collectionId, cookie);
    assert.deepEqual(history.at(-1), {
      ...history.at(-1),
      valueCents: 0,
      itemQuantity: 0,
      reason: "inventory_delete"
    });
  } finally {
    await closeTestServer(server);
  }
});

test("bulk storage location updates selected inventory rows", async () => {
  const server = await createTestServer();
  try {
    const { collections, cookie } = await bootstrapAdmin(server.app);
    const collectionId = collections[0].id;
    const firstItemResponse = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/items`,
      headers: { cookie },
      payload: {
        name: "Psyduck",
        setName: "Fossil",
        setCode: "FO",
        cardNumber: "53",
        language: "en",
        itemType: "raw",
        quantity: 1,
        storageLocation: "Binder A"
      }
    });
    const secondItemResponse = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/items`,
      headers: { cookie },
      payload: {
        name: "Golduck",
        setName: "Fossil",
        setCode: "FO",
        cardNumber: "35",
        language: "en",
        itemType: "raw",
        quantity: 1,
        storageLocation: "Binder B"
      }
    });

    assert.equal(firstItemResponse.statusCode, 201);
    assert.equal(secondItemResponse.statusCode, 201);

    const firstItemId = firstItemResponse.json().item.id;
    const secondItemId = secondItemResponse.json().item.id;
    const updateResponse = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/items/bulk/storage-location`,
      headers: { cookie },
      payload: {
        itemIds: [firstItemId, secondItemId, "missing-item"],
        storageLocation: "Vault Box 2"
      }
    });

    assert.equal(updateResponse.statusCode, 200);
    assert.deepEqual(updateResponse.json().updatedItemIds, [firstItemId, secondItemId]);
    assert.deepEqual(updateResponse.json().notFoundItemIds, ["missing-item"]);
    assert.deepEqual(
      updateResponse
        .json()
        .items.map((item: { storageLocation: string | null }) => item.storageLocation),
      ["Vault Box 2", "Vault Box 2"]
    );

    const clearResponse = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/items/bulk/storage-location`,
      headers: { cookie },
      payload: {
        itemIds: [firstItemId],
        storageLocation: "   "
      }
    });

    assert.equal(clearResponse.statusCode, 200);
    assert.equal(clearResponse.json().items[0].storageLocation, null);
  } finally {
    await closeTestServer(server);
  }
});

async function createTestServer(): Promise<TestServer> {
  const root = mkdtempSync(join(tmpdir(), "collection-tool-api-"));
  const databasePath = join(root, "collection.sqlite");
  const database = openDatabase(databasePath);
  const app = await createApp(testConfig(root, databasePath), database);

  return { app, database, root };
}

async function getCollectionValueHistory(
  app: FastifyInstance,
  collectionId: string,
  cookie: string
) {
  const response = await app.inject({
    method: "GET",
    url: `/api/collections/${collectionId}/pricing/value-history`,
    headers: { cookie }
  });

  assert.equal(response.statusCode, 200);
  return response.json().points as Array<{
    id: string;
    capturedAt: string;
    valueCents: number;
    deltaCents: number | null;
    refreshedItemCount: number;
    itemQuantity: number;
    reason: string;
  }>;
}

async function assertHistoryPointUnchanged(
  app: FastifyInstance,
  collectionId: string,
  cookie: string,
  pointId: string,
  expectedJson: string
) {
  const points = await getCollectionValueHistory(app, collectionId, cookie);
  const point = points.find((candidate) => candidate.id === pointId);
  assert.equal(JSON.stringify(point), expectedJson);
}

function pricingCandidate(priceCents: number) {
  const candidate = {
    sourceCardId: "base-pikachu-58",
    sourceVariantId: "near-mint",
    matchedName: "Pikachu",
    matchedSetName: "Base Set",
    matchedCardNumber: "58",
    condition: "Near Mint",
    printing: "Normal",
    language: "English",
    priceCents,
    currency: "USD",
    confidence: "exact",
    score: 100,
    source: "pokemonpricetracker",
    priceKind: "raw",
    grader: null,
    grade: null,
    gradeBucket: null,
    saleCount: 5,
    averagePriceCents: priceCents,
    medianPriceCents: priceCents,
    minPriceCents: priceCents,
    maxPriceCents: priceCents,
    marketTrend: "stable",
    historyAvailable: true
  };

  return {
    sourceCardId: candidate.sourceCardId,
    sourceVariantId: candidate.sourceVariantId,
    source: candidate.source,
    candidate
  };
}

async function closeTestServer(server: TestServer) {
  await server.app.close();
  rmSync(server.root, { recursive: true, force: true });
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
    maxImageUploadBytes: 6 * 1024 * 1024,
    scheduledBackupsEnabled: false,
    backupIntervalHours: 24,
    backupRetentionDays: 30,
    scheduledPriceRefreshEnabled: false,
    priceRefreshIntervalHours: 12,
    priceRefreshBatchSize: 10
  };
}

async function bootstrapAdmin(app: FastifyInstance) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/bootstrap",
    payload: {
      email: "admin@example.test",
      username: "admin",
      displayName: "Dev Admin",
      password: "admin-password"
    }
  });

  assert.equal(response.statusCode, 200);

  return {
    ...response.json(),
    cookie: sessionCookie(response)
  } as {
    user: {
      id: string;
      email: string;
      username: string;
      displayName: string;
    };
    collections: Array<{ id: string; name: string }>;
    cookie: string;
  };
}

async function login(app: FastifyInstance, identifier: string, password: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { identifier, password }
  });

  assert.equal(response.statusCode, 200);

  return {
    ...response.json(),
    cookie: sessionCookie(response)
  } as {
    user: { username: string };
    cookie: string;
  };
}

async function createAdminUser(
  app: FastifyInstance,
  cookie: string,
  payload: {
    email: string;
    username: string;
    displayName: string;
    password: string;
    systemRole: "admin" | "user";
  }
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/admin/users",
    headers: { cookie },
    payload
  });

  assert.equal(response.statusCode, 200);

  return response.json().user as {
    id: string;
    email: string;
    username: string;
    displayName: string;
  };
}

function sessionCookie(response: LightMyRequestResponse) {
  const setCookie = response.headers["set-cookie"];
  const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;

  if (typeof cookie !== "string") {
    assert.fail("Expected session cookie.");
  }

  return cookie.split(";")[0];
}
