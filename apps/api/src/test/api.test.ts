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
