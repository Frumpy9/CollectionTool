import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import type { AppConfig } from "../config.js";
import { createApp } from "../app.js";
import {
  DatabaseIntegrityDiagnosticError,
  openDatabase,
  runDatabaseIntegrityDiagnostics,
  type AppDatabase
} from "../db.js";

type TestServer = {
  app: FastifyInstance;
  database: AppDatabase;
  root: string;
};

test("SQLite connections enforce foreign keys and use local concurrency safeguards", async () => {
  const server = await createTestServer();
  try {
    const foreignKeys = server.database.connection.prepare("PRAGMA foreign_keys").get() as {
      foreign_keys: number;
    };
    const busyTimeout = server.database.connection.prepare("PRAGMA busy_timeout").get() as {
      timeout: number;
    };
    const journalMode = server.database.connection.prepare("PRAGMA journal_mode").get() as {
      journal_mode: string;
    };

    assert.equal(foreignKeys.foreign_keys, 1);
    assert.equal(busyTimeout.timeout, 5_000);
    assert.equal(journalMode.journal_mode, "wal");
    assert.throws(
      () =>
        server.database.connection
          .prepare(
            `
              INSERT INTO collection_members (collection_id, user_id, role)
              VALUES ('missing-collection', 'missing-user', 'viewer')
            `
          )
          .run(),
      /FOREIGN KEY constraint failed/i
    );
  } finally {
    await closeTestServer(server);
  }
});

test("in-memory SQLite keeps its compatible journal mode", () => {
  const database = openDatabase(":memory:");
  try {
    const diagnostic = runDatabaseIntegrityDiagnostics(database);

    assert.equal(diagnostic.connection.journalMode, "memory");
    assert.equal(diagnostic.connection.foreignKeysEnabled, true);
    assert.equal(diagnostic.connection.busyTimeoutMs, 5_000);
  } finally {
    database.connection.close();
  }
});

test("system admins can run healthy database integrity diagnostics", async () => {
  const server = await createTestServer();
  try {
    const { cookie } = await bootstrapAdmin(server.app);
    const response = await server.app.inject({
      method: "POST",
      url: "/api/admin/database/integrity-check",
      headers: { cookie },
      payload: {}
    });

    assert.equal(response.statusCode, 200);
    const diagnostic = response.json();
    assert.equal(diagnostic.status, "healthy");
    assert.equal(diagnostic.connection.foreignKeysEnabled, true);
    assert.equal(diagnostic.connection.busyTimeoutMs, 5_000);
    assert.equal(diagnostic.connection.journalMode, "wal");
    assert.deepEqual(diagnostic.integrityCheck, {
      ok: true,
      messageCount: 1,
      messages: ["ok"],
      truncated: false
    });
    assert.deepEqual(diagnostic.foreignKeyCheck, {
      ok: true,
      violationCount: 0,
      violations: [],
      truncated: false
    });
    assert.ok(Number.isFinite(Date.parse(diagnostic.checkedAt)));
    assert.equal("path" in diagnostic.connection, false);
  } finally {
    await closeTestServer(server);
  }
});

test("database diagnostics report foreign-key violations without row contents", async () => {
  const server = await createTestServer();
  try {
    server.database.connection.exec("PRAGMA foreign_keys = OFF");
    server.database.connection
      .prepare(
        `
          INSERT INTO collection_members (collection_id, user_id, role)
          VALUES ('missing-collection', 'missing-user', 'viewer')
        `
      )
      .run();
    server.database.connection.exec("PRAGMA foreign_keys = ON");

    const diagnostic = runDatabaseIntegrityDiagnostics(server.database);

    assert.equal(diagnostic.status, "issues");
    assert.equal(diagnostic.integrityCheck.ok, true);
    assert.equal(diagnostic.foreignKeyCheck.ok, false);
    assert.equal(diagnostic.foreignKeyCheck.violationCount, 2);
    assert.ok(
      diagnostic.foreignKeyCheck.violations.every(
        (violation) => violation.table === "collection_members" && violation.rowId !== null
      )
    );
    assert.deepEqual(
      new Set(diagnostic.foreignKeyCheck.violations.map((violation) => violation.parentTable)),
      new Set(["collections", "users"])
    );
    assert.equal(
      JSON.stringify(diagnostic.foreignKeyCheck.violations).includes("missing-user"),
      false
    );
  } finally {
    await closeTestServer(server);
  }
});

test("collection admins cannot run system database diagnostics", async () => {
  const server = await createTestServer();
  try {
    const { collections, cookie: adminCookie } = await bootstrapAdmin(server.app);
    const manager = await createAdminUser(server.app, adminCookie, {
      email: "collection-admin@example.test",
      username: "collection-admin",
      displayName: "Collection Admin",
      password: "collection-admin-password",
      systemRole: "user"
    });
    const addMemberResponse = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collections[0].id}/members`,
      headers: { cookie: adminCookie },
      payload: { userId: manager.id, role: "admin" }
    });
    assert.equal(addMemberResponse.statusCode, 200);

    const managerLogin = await login(server.app, "collection-admin", "collection-admin-password");
    const response = await server.app.inject({
      method: "POST",
      url: "/api/admin/database/integrity-check",
      headers: { cookie: managerLogin.cookie },
      payload: {}
    });

    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: "Unauthorized" });
  } finally {
    await closeTestServer(server);
  }
});

test("database diagnostic failures use a stable message without leaking the cause", () => {
  const database = {
    path: "/private/example/collection.sqlite",
    migrationsApplied: 0,
    connection: {
      prepare() {
        throw new Error("sensitive sqlite detail at /private/example/collection.sqlite");
      }
    }
  } as unknown as AppDatabase;

  assert.throws(
    () => runDatabaseIntegrityDiagnostics(database),
    (error: unknown) => {
      assert.ok(error instanceof DatabaseIntegrityDiagnosticError);
      assert.equal(error.message, "Database integrity diagnostics could not be completed.");
      assert.doesNotMatch(error.message, /private|collection\.sqlite/i);
      return true;
    }
  );
});

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
