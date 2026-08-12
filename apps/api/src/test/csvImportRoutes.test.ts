import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CsvImportDuplicatePolicy, CsvImportJobResponse } from "@collection-tool/shared";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { createApp } from "../app.js";
import type { AppConfig } from "../config.js";
import { openDatabase, type AppDatabase } from "../db.js";
import {
  MAX_CSV_IMPORT_BYTES,
  parseInventoryCsvImport
} from "../inventoryCsvImportParser.js";

type TestServer = {
  app: FastifyInstance;
  database: AppDatabase;
  root: string;
};

test("atomic CSV dry-run preserves quoted multiline exports and commits accepted rows once", async () => {
  const server = await createTestServer();
  try {
    const { collectionId, cookie } = await bootstrapAdmin(server.app);
    const csv = [
      "name,set_name,set_code,card_number,language,item_type,quantity,notes",
      'Pikachu,"Base, Set",base1,58/102,en,raw,2,"First line',
      'second line with ""quotes"""',
      ",Broken,,,,raw,1,invalid",
      "=HYPERLINK,Formula,FORM,1,en,raw,0,unsafe"
    ].join("\n");
    const job = await createReadyJob(server.app, collectionId, cookie, csv, "skip");

    assert.equal(job.summary.totalRows, 3);
    assert.equal(job.summary.commitRows, 1);
    assert.equal(job.summary.invalidRows, 2);
    assert.equal(job.summary.excludedRows, 2);
    assert.equal(job.requiresExclusionAcknowledgement, true);
    assert.equal(countRows(server.database, "owned_items"), 0, "dry-run must not write inventory");
    assert.equal(countRows(server.database, "collection_value_snapshots"), 0);

    const noAcknowledgement = await commitJob(server.app, collectionId, cookie, job, false);
    assert.equal(noAcknowledgement.statusCode, 400);
    assert.match(noAcknowledgement.json().error, /acknowledge/i);
    assert.equal(countRows(server.database, "owned_items"), 0);

    const committed = await commitJob(server.app, collectionId, cookie, job, true);
    assert.equal(committed.statusCode, 200);
    assert.equal(committed.json().status, "completed");
    assert.equal(countRows(server.database, "owned_items"), 1);
    assert.equal(countRows(server.database, "collection_value_snapshots"), 1);
    const saved = server.database.connection
      .prepare(
        `SELECT c.name, c.set_name, oi.quantity, oi.notes
         FROM owned_items oi JOIN cards c ON c.id = oi.card_id`
      )
      .get() as { name: string; set_name: string; quantity: number; notes: string };
    assert.deepEqual({ ...saved }, {
      name: "Pikachu",
      set_name: "Base, Set",
      quantity: 2,
      notes: 'First line\nsecond line with "quotes"'
    });

    const report = await getErrorReport(server.app, collectionId, cookie, job.id);
    assert.equal(report.statusCode, 200);
    assert.match(report.body, /Card name must be at least 2 characters/);
    assert.match(report.body, /"'=HYPERLINK"/);
  } finally {
    await closeTestServer(server);
  }
});

test("PSA Vault CSV rows retain cert metadata, normalized names, and vault notes", async () => {
  const server = await createTestServer();
  try {
    const { collectionId, cookie } = await bootstrapAdmin(server.app);
    const csv = [
      "item_status,cert_number,grade_issuer,psa_estimate,vault_status,subject,set,variety,item,grade,card_number,year,my_cost,date_acquired,my_value,my_notes,category",
      'Active,12345678,PSA,$125.50,Vaulted,"Full Art / CHARIZARD EX - HOLO","POKEMON JAPANESE M1L-MEGA BRAVE","M1L-MEGA BRAVE - F.A.","#123 CHARIZARD EX MEGA BRAVE",10,123,2025,$80.00,8/1/2025,$130.00,"Long term",TCG Cards'
    ].join("\n");
    const job = await createReadyJob(server.app, collectionId, cookie, csv, "skip");

    assert.equal(job.summary.commitRows, 1);
    const committed = await commitJob(server.app, collectionId, cookie, job, false);
    assert.equal(committed.statusCode, 200);
    const item = server.database.connection
      .prepare(
        `SELECT c.name, c.set_name, c.set_code, c.language, c.release_year,
                oi.grader, oi.grade, oi.cert_number, oi.cert_estimate_cents,
                oi.purchase_price_cents, oi.purchase_date, oi.value_override_cents,
                oi.variant_details, oi.storage_location, oi.notes
         FROM owned_items oi JOIN cards c ON c.id = oi.card_id`
      )
      .get() as Record<string, unknown>;
    assert.equal(item.name, "Charizard EX");
    assert.equal(item.set_name, "Mega Brave (M1L)");
    assert.equal(item.set_code, "M1L");
    assert.equal(item.language, "ja");
    assert.equal(item.release_year, "2025");
    assert.equal(item.cert_number, "12345678");
    assert.equal(item.cert_estimate_cents, 12_550);
    assert.equal(item.purchase_price_cents, 8_000);
    assert.equal(item.purchase_date, "2025-08-01");
    assert.equal(item.value_override_cents, 13_000);
    assert.match(String(item.variant_details), /Full Art/);
    assert.equal(item.storage_location, "Vaulted");
    assert.match(String(item.notes), /Vault status: Vaulted/);
  } finally {
    await closeTestServer(server);
  }
});

test("CSV duplicate policies are explicit and cert numbers are always deduplicated", async () => {
  const policies: Array<{
    policy: CsvImportDuplicatePolicy;
    commitRows: number;
    skippedRows: number;
    finalRows: number;
    finalQuantity: number;
  }> = [
    { policy: "skip", commitRows: 0, skippedRows: 2, finalRows: 1, finalQuantity: 1 },
    { policy: "merge", commitRows: 2, skippedRows: 0, finalRows: 1, finalQuantity: 6 },
    { policy: "separate", commitRows: 2, skippedRows: 0, finalRows: 3, finalQuantity: 6 }
  ];

  for (const expected of policies) {
    const server = await createTestServer();
    try {
      const { collectionId, cookie } = await bootstrapAdmin(server.app);
      await createItem(server.app, collectionId, cookie, "Psyduck", 1);
      const csv = [
        "name,set_code,card_number,language,item_type,quantity,condition_label,variant_details",
        "Psyduck,FO,53,en,raw,2,NM,1st Edition",
        "Psyduck,FO,53,en,raw,3,NM,1st Edition"
      ].join("\n");
      // The existing item needs the same full identity as the CSV rows.
      server.database.connection
        .prepare("UPDATE owned_items SET condition_label = 'NM', variant_details = '1st Edition'")
        .run();
      const job = await createReadyJob(server.app, collectionId, cookie, csv, expected.policy);
      assert.equal(job.summary.commitRows, expected.commitRows, expected.policy);
      assert.equal(job.summary.skippedRows, expected.skippedRows, expected.policy);
      const snapshotsBeforeCommit = countRows(server.database, "collection_value_snapshots");

      if (job.summary.commitRows > 0) {
        assert.equal(
          (await commitJob(server.app, collectionId, cookie, job, false)).statusCode,
          200
        );
      }
      assert.equal(
        countRows(server.database, "collection_value_snapshots"),
        snapshotsBeforeCommit + (job.summary.commitRows > 0 ? 1 : 0),
        `${expected.policy} must add exactly one job-level value snapshot`
      );
      assert.equal(countRows(server.database, "owned_items"), expected.finalRows, expected.policy);
      const quantity = server.database.connection
        .prepare("SELECT SUM(quantity) AS quantity FROM owned_items")
        .get() as { quantity: number };
      assert.equal(quantity.quantity, expected.finalQuantity, expected.policy);
    } finally {
      await closeTestServer(server);
    }
  }

  const certServer = await createTestServer();
  try {
    const { collectionId, cookie } = await bootstrapAdmin(certServer.app);
    const csv = [
      "name,language,item_type,quantity,grader,grade,cert_number",
      "Mew,en,graded,1,PSA,10,12-345-678",
      "Different Mew,en,graded,1,PSA,9,12345678"
    ].join("\n");
    const job = await createReadyJob(certServer.app, collectionId, cookie, csv, "separate");
    assert.equal(job.summary.commitRows, 1);
    assert.equal(job.summary.skippedRows, 1);
    assert.match(job.issues[0].messages[0], /Cert/);
  } finally {
    await closeTestServer(certServer);
  }
});

test("cancelled and stale CSV plans cannot mutate inventory", async () => {
  const server = await createTestServer();
  try {
    const { collectionId, cookie } = await bootstrapAdmin(server.app);
    const manyRows = [
      "name,language,item_type,quantity",
      ...Array.from({ length: 5_000 }, (_, index) => `Card ${index},en,raw,1`)
    ].join("\n");
    const createResponse = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/csv-imports`,
      headers: { cookie },
      payload: { csvText: manyRows, duplicatePolicy: "skip" }
    });
    assert.equal(createResponse.statusCode, 202);
    const cancelResponse = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/csv-imports/${createResponse.json().id}/cancel`,
      headers: { cookie },
      payload: {}
    });
    assert.equal(cancelResponse.statusCode, 200);
    assert.equal(cancelResponse.json().status, "cancelled");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(countRows(server.database, "owned_items"), 0);
    assert.equal(countRows(server.database, "collection_value_snapshots"), 0);

    const staleJob = await createReadyJob(
      server.app,
      collectionId,
      cookie,
      "name,language,item_type,quantity\nBulbasaur,en,raw,1",
      "skip"
    );
    const wrongHash = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/csv-imports/${staleJob.id}/commit`,
      headers: { cookie },
      payload: { planHash: "not-the-previewed-plan", acknowledgeExclusions: false }
    });
    assert.equal(wrongHash.statusCode, 409);
    assert.match(wrongHash.json().error, /plan changed/i);
    assert.equal(countRows(server.database, "owned_items"), 0);

    await createItem(server.app, collectionId, cookie, "Squirtle", 1);
    const staleCommit = await commitJob(server.app, collectionId, cookie, staleJob, false);
    assert.equal(staleCommit.statusCode, 409);
    assert.match(staleCommit.json().error, /Inventory changed/);
    assert.equal(countNamedCards(server.database, "Bulbasaur"), 0);
  } finally {
    await closeTestServer(server);
  }
});

test("a mid-write SQLite error rolls back every row and the collection snapshot", async () => {
  const server = await createTestServer();
  try {
    const { collectionId, cookie } = await bootstrapAdmin(server.app);
    const csv = [
      "name,language,item_type,quantity,notes",
      "Charmander,en,raw,1,ok",
      "Charmeleon,en,raw,1,boom"
    ].join("\n");
    const job = await createReadyJob(server.app, collectionId, cookie, csv, "skip");
    server.database.connection.exec(`
      CREATE TRIGGER fail_csv_import
      BEFORE INSERT ON owned_items
      WHEN NEW.notes = 'boom'
      BEGIN
        SELECT RAISE(ABORT, 'private failure at /secret/database.sqlite');
      END;
    `);

    const committed = await commitJob(server.app, collectionId, cookie, job, false);
    assert.equal(committed.statusCode, 500);
    assert.match(committed.json().error, /No inventory changes were saved/);
    assert.doesNotMatch(committed.body, /secret|database\.sqlite/i);
    assert.equal(countRows(server.database, "cards"), 0);
    assert.equal(countRows(server.database, "owned_items"), 0);
    assert.equal(countRows(server.database, "collection_value_snapshots"), 0);

    const report = await getErrorReport(server.app, collectionId, cookie, job.id);
    assert.match(report.body, /CSV import/);
    assert.match(report.body, /No inventory changes were saved/);
    assert.doesNotMatch(report.body, /secret|database\.sqlite/i);
  } finally {
    await closeTestServer(server);
  }
});

test("a begin-time SQLite failure leaves a terminal safe job instead of committing", async () => {
  const server = await createTestServer();
  try {
    const { collectionId, cookie } = await bootstrapAdmin(server.app);
    const job = await createReadyJob(
      server.app,
      collectionId,
      cookie,
      "name,language,item_type,quantity\nEevee,en,raw,1",
      "skip"
    );
    server.database.connection.exec("BEGIN");
    const response = await commitJob(server.app, collectionId, cookie, job, false);
    assert.equal(response.statusCode, 500);
    server.database.connection.exec("ROLLBACK");
    const failed = await waitForJob(server.app, collectionId, cookie, job.id);
    assert.equal(failed.status, "failed");
    assert.match(failed.error ?? "", /No inventory changes were saved/);
    assert.equal(countRows(server.database, "owned_items"), 0);
    assert.equal(countRows(server.database, "collection_value_snapshots"), 0);
    const report = await getErrorReport(server.app, collectionId, cookie, job.id);
    assert.match(report.body, /No inventory changes were saved/);
    assert.doesNotMatch(report.body, /transaction|SQLite/i);
  } finally {
    await closeTestServer(server);
  }
});

test("parse failures have a downloadable bounded job diagnostic", async () => {
  const server = await createTestServer();
  try {
    const { collectionId, cookie } = await bootstrapAdmin(server.app);
    const failed = await createFinishedJob(
      server.app,
      collectionId,
      cookie,
      'name,notes\nPikachu,"unclosed',
      "skip"
    );
    assert.equal(failed.status, "failed");
    assert.match(failed.error ?? "", /unclosed quoted field/i);
    assert.equal(countRows(server.database, "owned_items"), 0);
    const report = await getErrorReport(server.app, collectionId, cookie, failed.id);
    assert.match(report.body, /job/);
    assert.match(report.body, /unclosed quoted field/i);
  } finally {
    await closeTestServer(server);
  }
});

test("CSV routes enforce editor authorization and scoped transport limits", async () => {
  const server = await createTestServer();
  try {
    const { collectionId, cookie } = await bootstrapAdmin(server.app);
    const unauthorized = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/csv-imports`,
      payload: { csvText: "name\nPikachu", duplicatePolicy: "skip" }
    });
    assert.equal(unauthorized.statusCode, 401);

    const { cookie: viewerCookie, userId: viewerUserId } = await createViewer(
      server.app,
      collectionId,
      cookie
    );
    const viewerResponse = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/csv-imports`,
      headers: { cookie: viewerCookie },
      payload: { csvText: "name\nPikachu", duplicatePolicy: "skip" }
    });
    assert.equal(viewerResponse.statusCode, 403);

    const rowNote = "x".repeat(230_000);
    const overDefaultLimit = [
      "name,language,item_type,quantity,notes",
      ...Array.from({ length: 5 }, (_, index) => `Card ${index},en,raw,1,${rowNote}`)
    ].join("\n");
    assert.ok(Buffer.byteLength(overDefaultLimit) > 1024 * 1024);
    assert.ok(Buffer.byteLength(overDefaultLimit) < MAX_CSV_IMPORT_BYTES);
    const accepted = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/csv-imports`,
      headers: { cookie },
      payload: { csvText: overDefaultLimit, duplicatePolicy: "skip" }
    });
    assert.equal(accepted.statusCode, 202);
    assert.equal(
      (await waitForJob(server.app, collectionId, cookie, accepted.json().id)).status,
      "ready"
    );
    const promoteResponse = await server.app.inject({
      method: "PATCH",
      url: `/api/collections/${collectionId}/members/${viewerUserId}`,
      headers: { cookie },
      payload: { role: "editor" }
    });
    assert.equal(promoteResponse.statusCode, 200);
    const otherEditorRead = await server.app.inject({
      method: "GET",
      url: `/api/collections/${collectionId}/csv-imports/${accepted.json().id}`,
      headers: { cookie: viewerCookie }
    });
    assert.equal(otherEditorRead.statusCode, 404, "jobs must remain creator-only");

    const parserTooLarge = "x".repeat(MAX_CSV_IMPORT_BYTES + 1);
    const parserRejected = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/csv-imports`,
      headers: { cookie },
      payload: { csvText: parserTooLarge, duplicatePolicy: "skip" }
    });
    assert.equal(parserRejected.statusCode, 202);
    assert.match(
      (await waitForJob(server.app, collectionId, cookie, parserRejected.json().id)).error ?? "",
      /5 MB or smaller/
    );

    const transportTooLarge = "x".repeat(MAX_CSV_IMPORT_BYTES + 70_000);
    const transportRejected = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/csv-imports`,
      headers: { cookie },
      payload: { csvText: transportTooLarge, duplicatePolicy: "skip" }
    });
    assert.equal(transportRejected.statusCode, 413);
    assert.throws(
      () => parseInventoryCsvImport("😀".repeat(Math.ceil(MAX_CSV_IMPORT_BYTES / 4) + 1)),
      /5 MB or smaller/
    );
    assert.throws(
      () => parseInventoryCsvImport(
        ["name", ...Array.from({ length: 5_001 }, (_, index) => `Card ${index}`)].join("\n")
      ),
      /at most 5000 data rows/i
    );
    assert.throws(
      () => parseInventoryCsvImport(Array.from({ length: 129 }, (_, index) => `column_${index}`).join(",")),
      /at most 128 columns/i
    );
  } finally {
    await closeTestServer(server);
  }
});

async function createTestServer(): Promise<TestServer> {
  const root = mkdtempSync(join(tmpdir(), "collection-tool-csv-import-"));
  const databasePath = join(root, "collection.sqlite");
  const database = openDatabase(databasePath);
  const app = await createApp(testConfig(root, databasePath), database);
  return { app, database, root };
}

async function closeTestServer(server: TestServer) {
  await server.app.close();
  rmSync(server.root, { recursive: true, force: true });
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
    collectionId: response.json().collections[0].id as string,
    cookie: sessionCookie(response)
  };
}

async function createViewer(app: FastifyInstance, collectionId: string, adminCookie: string) {
  const created = await app.inject({
    method: "POST",
    url: "/api/admin/users",
    headers: { cookie: adminCookie },
    payload: {
      email: "viewer@example.test",
      username: "viewer",
      displayName: "Viewer",
      password: "viewer-password",
      systemRole: "user"
    }
  });
  assert.equal(created.statusCode, 200);
  const member = await app.inject({
    method: "POST",
    url: `/api/collections/${collectionId}/members`,
    headers: { cookie: adminCookie },
    payload: { userId: created.json().user.id, role: "viewer" }
  });
  assert.equal(member.statusCode, 200);
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { identifier: "viewer", password: "viewer-password" }
  });
  assert.equal(login.statusCode, 200);
  return { cookie: sessionCookie(login), userId: created.json().user.id as string };
}

async function createReadyJob(
  app: FastifyInstance,
  collectionId: string,
  cookie: string,
  csvText: string,
  duplicatePolicy: CsvImportDuplicatePolicy
) {
  const job = await createFinishedJob(app, collectionId, cookie, csvText, duplicatePolicy);
  assert.equal(job.status, "ready", job.error ?? "job should be ready");
  assert.ok(job.planHash);
  return job;
}

async function createFinishedJob(
  app: FastifyInstance,
  collectionId: string,
  cookie: string,
  csvText: string,
  duplicatePolicy: CsvImportDuplicatePolicy
) {
  const response = await app.inject({
    method: "POST",
    url: `/api/collections/${collectionId}/csv-imports`,
    headers: { cookie },
    payload: { csvText, duplicatePolicy }
  });
  assert.equal(response.statusCode, 202);
  return waitForJob(app, collectionId, cookie, response.json().id);
}

async function waitForJob(
  app: FastifyInstance,
  collectionId: string,
  cookie: string,
  jobId: string
): Promise<CsvImportJobResponse> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const response = await app.inject({
      method: "GET",
      url: `/api/collections/${collectionId}/csv-imports/${jobId}`,
      headers: { cookie }
    });
    assert.equal(response.statusCode, 200);
    const job = response.json() as CsvImportJobResponse;
    if (!["queued", "validating", "committing"].includes(job.status)) return job;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("CSV import job did not finish in time.");
}

function commitJob(
  app: FastifyInstance,
  collectionId: string,
  cookie: string,
  job: CsvImportJobResponse,
  acknowledgeExclusions: boolean
) {
  return app.inject({
    method: "POST",
    url: `/api/collections/${collectionId}/csv-imports/${job.id}/commit`,
    headers: { cookie },
    payload: { planHash: job.planHash, acknowledgeExclusions }
  });
}

function getErrorReport(
  app: FastifyInstance,
  collectionId: string,
  cookie: string,
  jobId: string
) {
  return app.inject({
    method: "GET",
    url: `/api/collections/${collectionId}/csv-imports/${jobId}/errors.csv`,
    headers: { cookie }
  });
}

async function createItem(
  app: FastifyInstance,
  collectionId: string,
  cookie: string,
  name: string,
  quantity: number
) {
  const response = await app.inject({
    method: "POST",
    url: `/api/collections/${collectionId}/items`,
    headers: { cookie },
    payload: {
      name,
      setCode: "FO",
      cardNumber: "53",
      language: "en",
      itemType: "raw",
      quantity
    }
  });
  assert.equal(response.statusCode, 201);
}

function countRows(database: AppDatabase, table: string) {
  const allowedTables = new Set(["cards", "owned_items", "collection_value_snapshots"]);
  assert.ok(allowedTables.has(table));
  return (database.connection.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function countNamedCards(database: AppDatabase, name: string) {
  return (database.connection.prepare("SELECT COUNT(*) AS count FROM cards WHERE name = ?").get(name) as { count: number }).count;
}

function sessionCookie(response: LightMyRequestResponse) {
  const setCookie = response.headers["set-cookie"];
  const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
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
    maxImageUploadBytes: 6 * 1024 * 1024,
    scheduledBackupsEnabled: false,
    backupIntervalHours: 24,
    backupRetentionDays: 30,
    scheduledPriceRefreshEnabled: false,
    priceRefreshIntervalHours: 12,
    priceRefreshBatchSize: 10
  };
}
