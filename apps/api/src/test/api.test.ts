import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import type { PricingCandidate } from "@collection-tool/shared";
import type { AppConfig } from "../config.js";
import { createApp } from "../app.js";
import {
  DatabaseIntegrityDiagnosticError,
  openDatabase,
  runDatabaseIntegrityDiagnostics,
  type AppDatabase
} from "../db.js";
import { saveOpenPricingReview } from "../pricingReviews.js";

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

    const statusResponse = await server.app.inject({
      method: "GET",
      url: "/api/admin/status",
      headers: { cookie }
    });
    assert.equal(statusResponse.statusCode, 200);
    assert.equal(statusResponse.json().backups.scheduledEnabled, false);
    assert.deepEqual(
      statusResponse.json().providers.map((provider: { id: string; status: string }) => [
        provider.id,
        provider.status
      ]),
      [
        ["tcgdex", "available"],
        ["pokemontcg", "available"],
        ["pokemonpricetracker", "missing_credentials"],
        ["psa", "missing_credentials"]
      ]
    );

    const backupResponse = await server.app.inject({
      method: "POST",
      url: "/api/admin/backups/sqlite",
      headers: { cookie },
      payload: {}
    });
    assert.equal(backupResponse.statusCode, 200);
    assert.equal(backupResponse.json().ok, true);
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

test("collection admins can load collection settings but cannot access system administration", async () => {
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

    const statusResponse = await server.app.inject({
      method: "GET",
      url: "/api/admin/status",
      headers: { cookie: managerLogin.cookie }
    });
    assert.equal(statusResponse.statusCode, 403);

    const backupResponse = await server.app.inject({
      method: "POST",
      url: "/api/admin/backups/sqlite",
      headers: { cookie: managerLogin.cookie },
      payload: {}
    });
    assert.equal(backupResponse.statusCode, 403);

    const collectionSettingsResponse = await server.app.inject({
      method: "GET",
      url: `/api/collections/${collections[0].id}/settings/status`,
      headers: { cookie: managerLogin.cookie }
    });
    assert.equal(collectionSettingsResponse.statusCode, 200);
    assert.equal("backups" in collectionSettingsResponse.json(), false);
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

test("system admins can inspect every collection while foreign collections remain read-only", async () => {
  const server = await createTestServer();
  try {
    const { collections: adminCollections, cookie: adminCookie } = await bootstrapAdmin(server.app);
    await createAdminUser(server.app, adminCookie, {
      email: "collector@example.test",
      username: "collector",
      displayName: "Collector User",
      password: "collector-password",
      systemRole: "user"
    });
    const collectorLogin = await login(server.app, "collector", "collector-password");
    const createCollectionResponse = await server.app.inject({
      method: "POST",
      url: "/api/collections",
      headers: { cookie: collectorLogin.cookie },
      payload: { name: "Collector Cards", defaultLocale: "en" }
    });
    assert.equal(createCollectionResponse.statusCode, 200);
    const collectorCollectionId = createCollectionResponse.json().collection.id as string;

    const createItemResponse = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectorCollectionId}/items`,
      headers: { cookie: collectorLogin.cookie },
      payload: {
        name: "Debug Pikachu",
        language: "en",
        itemType: "raw",
        quantity: 1
      }
    });
    assert.equal(createItemResponse.statusCode, 201);

    const collectorMeResponse = await server.app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: collectorLogin.cookie }
    });
    assert.equal(collectorMeResponse.statusCode, 200);
    assert.deepEqual(
      collectorMeResponse.json().collections.map((collection: { id: string }) => collection.id),
      [collectorCollectionId]
    );

    const adminMeResponse = await server.app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: adminCookie }
    });
    assert.equal(adminMeResponse.statusCode, 200);
    assert.deepEqual(
      adminMeResponse
        .json()
        .collections.map((collection: { id: string; role: string }) => [collection.id, collection.role]),
      [
        [adminCollections[0].id, "owner"],
        [collectorCollectionId, "viewer"]
      ]
    );

    const inspectResponse = await server.app.inject({
      method: "GET",
      url: `/api/collections/${collectorCollectionId}/items`,
      headers: { cookie: adminCookie }
    });
    assert.equal(inspectResponse.statusCode, 200);
    assert.equal(inspectResponse.json().items[0].card.name, "Debug Pikachu");

    const mutateResponse = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectorCollectionId}/items`,
      headers: { cookie: adminCookie },
      payload: {
        name: "Should Not Save",
        language: "en",
        itemType: "raw",
        quantity: 1
      }
    });
    assert.equal(mutateResponse.statusCode, 403);

    const membershipResponse = await server.app.inject({
      method: "GET",
      url: `/api/collections/${collectorCollectionId}/members`,
      headers: { cookie: adminCookie }
    });
    assert.equal(membershipResponse.statusCode, 403);

    const settingsResponse = await server.app.inject({
      method: "GET",
      url: `/api/collections/${collectorCollectionId}/settings/status`,
      headers: { cookie: adminCookie }
    });
    assert.equal(settingsResponse.statusCode, 403);
  } finally {
    await closeTestServer(server);
  }
});

test("inventory duplicate preflight returns structured matches without mutating inventory", async () => {
  const server = await createTestServer();
  try {
    const { collections, cookie } = await bootstrapAdmin(server.app);
    const collectionId = collections[0].id;
    const payload = {
      name: "Pikachu",
      setName: "Base Set",
      setCode: "BS",
      cardNumber: "058",
      language: "en",
      itemType: "raw",
      quantity: 1,
      conditionLabel: "Near Mint",
      variantDetails: "Standard, Holo / Foil"
    };
    const createResponse = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/items`,
      headers: { cookie },
      payload
    });
    assert.equal(createResponse.statusCode, 201);

    const checkResponse = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/items/duplicate-check`,
      headers: { cookie },
      payload: {
        ...payload,
        name: " pikachu ",
        setCode: "bs",
        cardNumber: "58",
        conditionLabel: "near  mint",
        variantDetails: "Holo / Foil, Standard"
      }
    });
    assert.equal(checkResponse.statusCode, 200, checkResponse.body);
    assert.equal(checkResponse.json().matches.length, 1);
    assert.equal(checkResponse.json().matches[0].kind, "exact-identity");
    assert.deepEqual(
      checkResponse.json().matches[0].reasons.map((reason: { code: string }) => reason.code),
      ["item-type", "language", "name", "set-code", "card-number", "condition", "variants"]
    );

    const inventoryResponse = await server.app.inject({
      method: "GET",
      url: `/api/collections/${collectionId}/items`,
      headers: { cookie }
    });
    assert.equal(inventoryResponse.json().items.length, 1);
    const itemId = createResponse.json().item.id as string;

    const response = await server.app.inject({
      method: "GET",
      url: `/api/collections/${collectionId}/items/${itemId}/image-candidates`,
      headers: { cookie }
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json().candidates, []);
    assert.deepEqual(
      response.json().attempts.map((attempt: { provider: string; status: string }) => [
        attempt.provider,
        attempt.status
      ]),
      [
        ["pokemonpricetracker", "unavailable"],
        ["card-lookup", "empty"]
      ]
    );
    assert.match(response.json().message, /No compatible image candidates/i);

    const missing = await server.app.inject({
      method: "GET",
      url: `/api/collections/${collectionId}/items/missing/image-candidates`,
      headers: { cookie }
    });
    assert.equal(missing.statusCode, 404);
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

test("pricing review shows disagreements and pins only the persisted server candidate", async () => {
  const server = await createTestServer();
  try {
    const { user, collections, cookie } = await bootstrapAdmin(server.app);
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
        conditionLabel: "Near Mint",
        variantDetails: "Unlimited",
        purchasePriceCents: 1_000,
        valueOverrideCents: 4_000
      }
    });
    assert.equal(createResponse.statusCode, 201);
    const itemId = createResponse.json().item.id;
    const persisted = {
      ...pricingCandidate(2_500).candidate,
      matchedSetName: "Jungle",
      matchedCardNumber: "60",
      printing: "1st Edition",
      language: "Japanese",
      rawPayload: { secretProviderPayload: true }
    };
    saveOpenPricingReview(
      server.database,
      itemId,
      [persisted as PricingCandidate],
      "Choose the best pricing match."
    );
    const persistedJson = server.database.connection
      .prepare(
        "SELECT candidates_json FROM item_price_match_reviews WHERE owned_item_id = ?"
      )
      .get(itemId)!.candidates_json as string;
    assert.equal(persistedJson.includes("rawPayload"), false);
    assert.equal(persistedJson.includes("secretProviderPayload"), false);

    const listResponse = await server.app.inject({
      method: "GET",
      url: `/api/collections/${collectionId}/pricing/reviews`,
      headers: { cookie }
    });
    assert.equal(listResponse.statusCode, 200);
    const review = listResponse.json().reviews[0];
    assert.equal(review.status, "needs-review");
    assert.equal(review.candidates.length, 1);
    assert.equal("rawPayload" in review.candidates[0], false);
    assert.deepEqual(
      review.candidates[0].comparisons.map(
        (comparison: { field: string; status: string }) => [comparison.field, comparison.status]
      ),
      [
        ["set", "disagreement"],
        ["card-number", "disagreement"],
        ["variant", "disagreement"],
        ["language", "disagreement"],
        ["condition", "match"]
      ]
    );

    const selectResponse = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/pricing/reviews/${itemId}/select`,
      headers: { cookie },
      payload: {
        sourceCardId: persisted.sourceCardId,
        sourceVariantId: persisted.sourceVariantId,
        candidate: { ...persisted, priceCents: 999_999 }
      }
    });
    assert.equal(selectResponse.statusCode, 200);
    assert.equal(selectResponse.json().item.marketPriceCents, 2_500);
    assert.equal(
      selectResponse.json().item.valueOverrideCents,
      4_000,
      "manual override still wins over the newly saved market price"
    );
    assert.equal(selectResponse.json().reviews.summary.pinned, 1);

    const sourceMatch = server.database.connection
      .prepare(
        `
          SELECT match_kind, is_pinned, confirmed_by_user_id, confirmed_at
          FROM item_price_source_matches
          WHERE owned_item_id = ? AND source = 'pokemonpricetracker'
        `
      )
      .get(itemId) as {
      match_kind: string;
      is_pinned: number;
      confirmed_by_user_id: string | null;
      confirmed_at: string | null;
    };
    assert.equal(sourceMatch.match_kind, "manual");
    assert.equal(sourceMatch.is_pinned, 1);
    assert.equal(sourceMatch.confirmed_by_user_id, user.id);
    assert.ok(sourceMatch.confirmed_at);
  } finally {
    await closeTestServer(server);
  }
});

test("migration 21 backfills existing manual source matches as durable pins", async () => {
  const server = await createTestServer();
  let reopened: AppDatabase | null = null;
  let appClosed = false;
  try {
    const { collections, cookie } = await bootstrapAdmin(server.app);
    const collectionId = collections[0].id;
    const createResponse = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/items`,
      headers: { cookie },
      payload: {
        name: "Mewtwo",
        setName: "Base Set",
        cardNumber: "10",
        language: "en",
        itemType: "raw",
        quantity: 1
      }
    });
    const itemId = createResponse.json().item.id;
    server.database.connection
      .prepare(
        `
          INSERT INTO item_price_source_matches (
            owned_item_id, source, source_card_id, source_variant_id,
            match_kind, confidence, is_pinned, confirmed_at
          ) VALUES (?, 'pokemonpricetracker', 'mewtwo-10', 'near-mint',
            'manual', 'strong', 0, NULL)
        `
      )
      .run(itemId);

    server.database.connection.exec(`
      DROP TABLE item_price_match_reviews;
      ALTER TABLE item_price_source_matches DROP COLUMN confirmed_at;
      ALTER TABLE item_price_source_matches DROP COLUMN confirmed_by_user_id;
      ALTER TABLE item_price_source_matches DROP COLUMN is_pinned;
      DELETE FROM schema_migrations WHERE id = 21;
      UPDATE app_metadata SET value = '20' WHERE key = 'schema_version';
    `);
    await server.app.close();
    appClosed = true;

    reopened = openDatabase(server.database.path);
    assert.equal(reopened.migrationsApplied, 1);
    const migrated = reopened.connection
      .prepare(
        `
          SELECT match_kind, is_pinned, confirmed_at
          FROM item_price_source_matches WHERE owned_item_id = ?
        `
      )
      .get(itemId) as { match_kind: string; is_pinned: number; confirmed_at: string | null };
    assert.equal(migrated.match_kind, "manual");
    assert.equal(migrated.is_pinned, 1);
    assert.ok(migrated.confirmed_at);
    assert.ok(
      reopened.connection
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'item_price_match_reviews'"
        )
        .get()
    );
  } finally {
    reopened?.connection.close();
    if (!appClosed) await server.app.close();
    rmSync(server.root, { recursive: true, force: true });
  }
});

test("pricing reviews are viewer-readable but viewer mutations are forbidden", async () => {
  const server = await createTestServer();
  try {
    const { collections, cookie: adminCookie } = await bootstrapAdmin(server.app);
    const collectionId = collections[0].id;
    const createResponse = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/items`,
      headers: { cookie: adminCookie },
      payload: {
        name: "Eevee",
        setName: "Jungle",
        cardNumber: "51",
        language: "en",
        itemType: "raw",
        quantity: 1
      }
    });
    const itemId = createResponse.json().item.id;
    persistPricingReview(server.database, itemId, [
      { ...pricingCandidate(900).candidate, matchedName: "Eevee", matchedSetName: "Jungle" }
    ]);

    const viewer = await createAdminUser(server.app, adminCookie, {
      email: "pricing-viewer@example.test",
      username: "pricing-viewer",
      displayName: "Pricing Viewer",
      password: "pricing-viewer-password",
      systemRole: "user"
    });
    assert.equal(
      (
        await server.app.inject({
          method: "POST",
          url: `/api/collections/${collectionId}/members`,
          headers: { cookie: adminCookie },
          payload: { userId: viewer.id, role: "viewer" }
        })
      ).statusCode,
      200
    );
    const viewerLogin = await login(
      server.app,
      "pricing-viewer",
      "pricing-viewer-password"
    );

    assert.equal(
      (
        await server.app.inject({
          method: "GET",
          url: `/api/collections/${collectionId}/pricing/reviews`,
          headers: { cookie: viewerLogin.cookie }
        })
      ).statusCode,
      200
    );
    assert.equal(
      (
        await server.app.inject({
          method: "GET",
          url: `/api/collections/${collectionId}/pricing/bulk/queue`,
          headers: { cookie: viewerLogin.cookie }
        })
      ).statusCode,
      200
    );
    assert.equal(
      (
        await server.app.inject({
          method: "GET",
          url: `/api/collections/${collectionId}/pricing/value-history`,
          headers: { cookie: viewerLogin.cookie }
        })
      ).statusCode,
      200
    );
    assert.equal(
      (
        await server.app.inject({
          method: "POST",
          url: `/api/collections/${collectionId}/pricing/reviews/${itemId}/select`,
          headers: { cookie: viewerLogin.cookie },
          payload: { sourceCardId: "base-pikachu-58", sourceVariantId: "near-mint" }
        })
      ).statusCode,
      403
    );
  } finally {
    await closeTestServer(server);
  }
});

test("pricing review rejects raw guide prices for graded inventory", async () => {
  const server = await createTestServer();
  try {
    const { collections, cookie } = await bootstrapAdmin(server.app);
    const collectionId = collections[0].id;
    const createResponse = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/items`,
      headers: { cookie },
      payload: {
        name: "Charizard",
        setName: "Base Set",
        cardNumber: "4",
        language: "en",
        itemType: "graded",
        quantity: 1,
        grader: "PSA",
        grade: "10"
      }
    });
    const itemId = createResponse.json().item.id;
    const rawCandidate = pricingCandidate(100_000).candidate;
    persistPricingReview(server.database, itemId, [rawCandidate]);

    const response = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/pricing/reviews/${itemId}/select`,
      headers: { cookie },
      payload: {
        sourceCardId: rawCandidate.sourceCardId,
        sourceVariantId: rawCandidate.sourceVariantId
      }
    });
    assert.equal(response.statusCode, 400);
    assert.match(response.json().error, /raw guide prices cannot be applied to graded cards/i);
    assert.equal(
      server.database.connection
        .prepare("SELECT COUNT(*) AS count FROM item_market_prices WHERE owned_item_id = ?")
        .get(itemId)!.count,
      0
    );
  } finally {
    await closeTestServer(server);
  }
});

test("pricing identity edits invalidate pins and reopen a stale review", async () => {
  const server = await createTestServer();
  try {
    const { collections, cookie } = await bootstrapAdmin(server.app);
    const collectionId = collections[0].id;
    const basePayload = {
      name: "Pikachu",
      setName: "Base Set",
      setCode: "BS",
      cardNumber: "58",
      language: "en",
      itemType: "raw",
      quantity: 1,
      conditionLabel: "Near Mint",
      conditionScore: 9,
      variantDetails: "Unlimited"
    };
    const createResponse = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/items`,
      headers: { cookie },
      payload: basePayload
    });
    const itemId = createResponse.json().item.id;
    const unpricedEditResponse = await server.app.inject({
      method: "PATCH",
      url: `/api/collections/${collectionId}/items/${itemId}`,
      headers: { cookie },
      payload: { ...basePayload, conditionScore: 9.5 }
    });
    assert.equal(unpricedEditResponse.statusCode, 200);
    assert.equal(
      server.database.connection
        .prepare("SELECT COUNT(*) AS count FROM item_price_match_reviews WHERE owned_item_id = ?")
        .get(itemId)!.count,
      0,
      "editing an unpriced card should not create review noise"
    );
    const candidate = pricingCandidate(2_500).candidate;
    persistPricingReview(server.database, itemId, [candidate]);
    assert.equal(
      (
        await server.app.inject({
          method: "POST",
          url: `/api/collections/${collectionId}/pricing/reviews/${itemId}/select`,
          headers: { cookie },
          payload: {
            sourceCardId: candidate.sourceCardId,
            sourceVariantId: candidate.sourceVariantId
          }
        })
      ).statusCode,
      200
    );

    const updateResponse = await server.app.inject({
      method: "PATCH",
      url: `/api/collections/${collectionId}/items/${itemId}`,
      headers: { cookie },
      payload: { ...basePayload, conditionScore: 8 }
    });
    assert.equal(updateResponse.statusCode, 200);
    assert.equal(
      server.database.connection
        .prepare("SELECT COUNT(*) AS count FROM item_price_source_matches WHERE owned_item_id = ?")
        .get(itemId)!.count,
      0
    );
    const review = server.database.connection
      .prepare(
        "SELECT status, message, candidates_json FROM item_price_match_reviews WHERE owned_item_id = ?"
      )
      .get(itemId) as { status: string; message: string; candidates_json: string };
    assert.equal(review.status, "open");
    assert.match(review.message, /card details changed/i);
    assert.equal(review.candidates_json, "[]");
  } finally {
    await closeTestServer(server);
  }
});

test("ordinary price refresh honors a pinned source and keeps it manually confirmed", async () => {
  const server = await createTestServer({ pokemonPriceTrackerApiKey: "test-pricing-key" });
  const originalFetch = globalThis.fetch;
  try {
    const { user, collections, cookie } = await bootstrapAdmin(server.app);
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
        conditionLabel: "Near Mint"
      }
    });
    const itemId = createResponse.json().item.id;
    const initial = pricingCandidate(2_500).candidate;
    persistPricingReview(server.database, itemId, [initial]);
    assert.equal(
      (
        await server.app.inject({
          method: "POST",
          url: `/api/collections/${collectionId}/pricing/reviews/${itemId}/select`,
          headers: { cookie },
          payload: {
            sourceCardId: initial.sourceCardId,
            sourceVariantId: initial.sourceVariantId
          }
        })
      ).statusCode,
      200
    );

    let pinnedSourceAvailable = true;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      assert.match(url, /tcgPlayerId=base-pikachu-58|search=Pikachu/);
      return new Response(
        JSON.stringify(
          pinnedSourceAvailable
            ? {
                data: [
                  {
                    id: initial.sourceCardId,
                    name: "Pikachu",
                    setName: "Base Set",
                    setCode: "BS",
                    cardNumber: "58",
                    language: "english",
                    prices: {
                      "near-mint": {
                        marketPrice: 30,
                        printing: "Near Mint",
                        salesCount: 7
                      }
                    }
                  }
                ]
              }
            : { data: [] }
        ),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch;

    const refreshResponse = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/items/${itemId}/pricing/refresh`,
      headers: { cookie },
      payload: {}
    });
    assert.equal(refreshResponse.statusCode, 200);
    assert.equal(refreshResponse.json().status, "saved");
    assert.equal(refreshResponse.json().item.marketPriceCents, 3_000);
    assert.equal(
      server.database.connection
        .prepare("SELECT language FROM item_market_prices WHERE owned_item_id = ?")
        .get(itemId)!.language,
      "English"
    );

    const sourceMatch = server.database.connection
      .prepare(
        `
          SELECT source_card_id, source_variant_id, match_kind, is_pinned, confirmed_by_user_id
          FROM item_price_source_matches WHERE owned_item_id = ?
        `
      )
      .get(itemId) as {
      source_card_id: string;
      source_variant_id: string;
      match_kind: string;
      is_pinned: number;
      confirmed_by_user_id: string | null;
    };
    assert.deepEqual({ ...sourceMatch }, {
      source_card_id: initial.sourceCardId,
      source_variant_id: initial.sourceVariantId,
      match_kind: "manual",
      is_pinned: 1,
      confirmed_by_user_id: user.id
    });

    pinnedSourceAvailable = false;
    const unavailableResponse = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/items/${itemId}/pricing/refresh`,
      headers: { cookie },
      payload: {}
    });
    assert.equal(unavailableResponse.statusCode, 200);
    assert.equal(unavailableResponse.json().status, "needs-review");
    assert.match(unavailableResponse.json().message, /pinned source match is unavailable/i);
    assert.equal(
      server.database.connection
        .prepare("SELECT price_cents FROM item_market_prices WHERE owned_item_id = ?")
        .get(itemId)!.price_cents,
      3_000,
      "an unavailable pin must not replace the last saved price"
    );
    assert.equal(
      server.database.connection
        .prepare("SELECT is_pinned FROM item_price_source_matches WHERE owned_item_id = ?")
        .get(itemId)!.is_pinned,
      1
    );
    const unavailableReviews = await server.app.inject({
      method: "GET",
      url: `/api/collections/${collectionId}/pricing/reviews`,
      headers: { cookie }
    });
    assert.deepEqual(unavailableReviews.json().summary, { needsReview: 1, pinned: 1 });

    const unpinResponse = await server.app.inject({
      method: "DELETE",
      url: `/api/collections/${collectionId}/pricing/reviews/${itemId}/pin`,
      headers: { cookie }
    });
    assert.equal(unpinResponse.statusCode, 200);
    assert.equal(unpinResponse.json().reviews.summary.pinned, 0);
  } finally {
    globalThis.fetch = originalFetch;
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
    const selectPrice = (priceCents: number) => {
      const payload = pricingCandidate(priceCents);
      persistPricingReview(server.database, itemId, [payload.candidate]);
      return server.app.inject({
        method: "POST",
        url: `/api/collections/${collectionId}/items/${itemId}/pricing/select`,
        headers: { cookie },
        payload
      });
    };

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

async function createTestServer(configOverrides: Partial<AppConfig> = {}): Promise<TestServer> {
  const root = mkdtempSync(join(tmpdir(), "collection-tool-api-"));
  const databasePath = join(root, "collection.sqlite");
  const database = openDatabase(databasePath);
  const app = await createApp({ ...testConfig(root, databasePath), ...configOverrides }, database);

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

function persistPricingReview(
  database: AppDatabase,
  itemId: string,
  candidates: unknown[],
  message = "Choose the best pricing match."
) {
  database.connection
    .prepare(
      `
        INSERT INTO item_price_match_reviews (
          owned_item_id, source, status, message, candidates_json, created_at, updated_at
        )
        VALUES (?, 'pokemonpricetracker', 'open', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(owned_item_id, source) DO UPDATE SET
          status = 'open',
          message = excluded.message,
          candidates_json = excluded.candidates_json,
          updated_at = CURRENT_TIMESTAMP,
          resolved_at = NULL,
          resolved_by_user_id = NULL
      `
    )
    .run(itemId, message, JSON.stringify(candidates));
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
