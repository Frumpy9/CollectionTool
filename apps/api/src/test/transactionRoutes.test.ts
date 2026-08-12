import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import type { AppConfig } from "../config.js";
import { createApp } from "../app.js";
import { openDatabase, type AppDatabase } from "../db.js";

type TestServer = { app: FastifyInstance; database: AppDatabase; root: string };

test("transaction ledger persists partial sales and computes only explicit realized P&L", async () => {
  const server = await createTestServer();
  try {
    const { collectionId, cookie } = await bootstrap(server.app);
    const itemId = await createItem(server.app, collectionId, cookie, 5);

    const purchase = await createTransaction(server.app, collectionId, cookie, {
      itemId,
      type: "purchase",
      quantity: 5,
      amountCents: 5_000,
      feesCents: 200,
      transactedAt: "2026-08-01"
    });
    assert.equal(purchase.statusCode, 201);

    const sale = await createTransaction(server.app, collectionId, cookie, {
      itemId,
      type: "sale",
      quantity: 2,
      amountCents: 3_000,
      feesCents: 300,
      allocatedCostCents: 2_000,
      transactedAt: "2026-08-05"
    });
    assert.equal(sale.statusCode, 201);

    const saleWithoutBasis = await createTransaction(server.app, collectionId, cookie, {
      itemId,
      type: "sale",
      quantity: 1,
      amountCents: 1_500,
      transactedAt: "2026-08-06"
    });
    assert.equal(saleWithoutBasis.statusCode, 201);

    const fee = await createTransaction(server.app, collectionId, cookie, {
      type: "fee",
      itemName: "Convention table fee",
      amountCents: 100,
      transactedAt: "2026-08-07"
    });
    assert.equal(fee.statusCode, 201);

    const response = await server.app.inject({
      method: "GET",
      url: `/api/collections/${collectionId}/transactions`,
      headers: { cookie }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().transactions.length, 4);
    assert.deepEqual(response.json().summary, {
      transactionCount: 4,
      purchaseCostCents: 5_000,
      grossSaleProceedsCents: 4_500,
      totalFeesCents: 600,
      cashInCents: 4_500,
      cashOutCents: 5_600,
      netCashFlowCents: -1_100,
      realizedSaleCount: 1,
      salesMissingCostBasisCount: 1,
      realizedTradeCount: 0,
      tradesMissingCostBasisCount: 0,
      realizedProceedsCents: 2_700,
      realizedCostBasisCents: 2_000,
      realizedProfitCents: 700,
      realizedTradeAssignedValueCents: 0,
      realizedTradeCostBasisCents: 0,
      realizedTradeProfitCents: 0
    });

    const inventory = await server.app.inject({
      method: "GET",
      url: `/api/collections/${collectionId}/items`,
      headers: { cookie }
    });
    assert.equal(inventory.json().items[0].quantity, 5, "ledger does not mutate inventory");
  } finally {
    await closeTestServer(server);
  }
});

test("viewers can read the ledger but only editors can change it", async () => {
  const server = await createTestServer();
  try {
    const { collectionId, cookie: ownerCookie } = await bootstrap(server.app);
    const viewer = await createUser(server.app, ownerCookie, "viewer");
    const editor = await createUser(server.app, ownerCookie, "editor");
    await addMember(server, collectionId, ownerCookie, viewer.id, "viewer");
    await addMember(server, collectionId, ownerCookie, editor.id, "editor");
    const viewerCookie = await login(server.app, "viewer", "member-password");
    const editorCookie = await login(server.app, "editor", "member-password");

    const viewerRead = await server.app.inject({
      method: "GET",
      url: `/api/collections/${collectionId}/transactions`,
      headers: { cookie: viewerCookie }
    });
    assert.equal(viewerRead.statusCode, 200);

    const viewerWrite = await createTransaction(server.app, collectionId, viewerCookie, {
      type: "fee",
      itemName: "Fee",
      amountCents: 100,
      transactedAt: "2026-08-01"
    });
    assert.equal(viewerWrite.statusCode, 403);

    const editorWrite = await createTransaction(server.app, collectionId, editorCookie, {
      type: "fee",
      itemName: "Fee",
      amountCents: 100,
      transactedAt: "2026-08-01"
    });
    assert.equal(editorWrite.statusCode, 201);
    const id = editorWrite.json().transaction.id;

    const editorPatch = await server.app.inject({
      method: "PATCH",
      url: `/api/collections/${collectionId}/transactions/${id}`,
      headers: { cookie: editorCookie },
      payload: { notes: "Updated" }
    });
    assert.equal(editorPatch.statusCode, 200);
    assert.equal(editorPatch.json().transaction.notes, "Updated");

    const viewerDelete = await server.app.inject({
      method: "DELETE",
      url: `/api/collections/${collectionId}/transactions/${id}`,
      headers: { cookie: viewerCookie }
    });
    assert.equal(viewerDelete.statusCode, 403);

    const editorDelete = await server.app.inject({
      method: "DELETE",
      url: `/api/collections/${collectionId}/transactions/${id}`,
      headers: { cookie: editorCookie }
    });
    assert.equal(editorDelete.statusCode, 200);
  } finally {
    await closeTestServer(server);
  }
});

test("transaction validation rejects ambiguous fees, invalid money, and cross-collection links", async () => {
  const server = await createTestServer();
  try {
    const { collectionId, cookie } = await bootstrap(server.app);
    const otherCollectionResponse = await server.app.inject({
      method: "POST",
      url: "/api/collections",
      headers: { cookie },
      payload: { name: "Other collection" }
    });
    const otherCollectionId = otherCollectionResponse.json().collection.id;
    const otherItemId = await createItem(server.app, otherCollectionId, cookie, 1);

    const crossCollection = await createTransaction(server.app, collectionId, cookie, {
      itemId: otherItemId,
      type: "purchase",
      quantity: 1,
      amountCents: 100,
      transactedAt: "2026-08-01"
    });
    assert.equal(crossCollection.statusCode, 400);
    assert.match(errorMessage(crossCollection), /linked inventory item/i);

    const doubleFee = await createTransaction(server.app, collectionId, cookie, {
      type: "fee",
      itemName: "Fee",
      amountCents: 100,
      feesCents: 50,
      transactedAt: "2026-08-01"
    });
    assert.equal(doubleFee.statusCode, 400);
    assert.match(errorMessage(doubleFee), /additional fees must be zero/i);

    const invalidMoney = await createTransaction(server.app, collectionId, cookie, {
      type: "sale",
      quantity: 1,
      amountCents: -1,
      transactedAt: "2026-08-01"
    });
    assert.equal(invalidMoney.statusCode, 400);
    assert.match(errorMessage(invalidMoney), /non-negative whole number/i);

    const invalidGift = await createTransaction(server.app, collectionId, cookie, {
      type: "gift_given",
      quantity: 1,
      amountCents: 100,
      transactedAt: "2026-08-01"
    });
    assert.equal(invalidGift.statusCode, 400);
    assert.match(errorMessage(invalidGift), /zero total amount/i);

    const zeroPurchase = await createTransaction(server.app, collectionId, cookie, {
      type: "purchase",
      quantity: 1,
      amountCents: 0,
      transactedAt: "2026-08-01"
    });
    assert.equal(zeroPurchase.statusCode, 400);
    assert.match(errorMessage(zeroPurchase), /positive total amount/i);

    const zeroFee = await createTransaction(server.app, collectionId, cookie, {
      type: "fee",
      itemName: "Fee",
      amountCents: 0,
      transactedAt: "2026-08-01"
    });
    assert.equal(zeroFee.statusCode, 400);
    assert.match(errorMessage(zeroFee), /positive total amount/i);

    const feeWithQuantity = await createTransaction(server.app, collectionId, cookie, {
      type: "fee",
      itemName: "Fee",
      quantity: 1,
      amountCents: 100,
      transactedAt: "2026-08-01"
    });
    assert.equal(feeWithQuantity.statusCode, 400);
    assert.match(errorMessage(feeWithQuantity), /do not use a quantity/i);

    const disposalWithoutQuantity = await createTransaction(server.app, collectionId, cookie, {
      type: "disposal",
      amountCents: 0,
      transactedAt: "2026-08-01"
    });
    assert.equal(disposalWithoutQuantity.statusCode, 400);
    assert.match(errorMessage(disposalWithoutQuantity), /quantity is required/i);
  } finally {
    await closeTestServer(server);
  }
});

test("trade assigned values never appear in cash flow", async () => {
  const server = await createTestServer();
  try {
    const { collectionId, cookie } = await bootstrap(server.app);
    await createTransaction(server.app, collectionId, cookie, {
      type: "trade_received",
      itemName: "Received card",
      quantity: 1,
      amountCents: 2_500,
      feesCents: 100,
      transactedAt: "2026-08-01"
    });
    await createTransaction(server.app, collectionId, cookie, {
      type: "trade_given",
      itemName: "Given card",
      quantity: 1,
      amountCents: 3_000,
      feesCents: 200,
      allocatedCostCents: 2_000,
      transactedAt: "2026-08-01"
    });

    const response = await server.app.inject({
      method: "GET",
      url: `/api/collections/${collectionId}/transactions`,
      headers: { cookie }
    });
    const summary = response.json().summary;
    assert.equal(summary.cashInCents, 0);
    assert.equal(summary.cashOutCents, 300, "only trade fees affect cash flow");
    assert.equal(summary.netCashFlowCents, -300);
    assert.equal(summary.realizedProfitCents, 0, "trade result is not cash-sale P&L");
    assert.equal(summary.realizedTradeAssignedValueCents, 2_800);
    assert.equal(summary.realizedTradeCostBasisCents, 2_000);
    assert.equal(summary.realizedTradeProfitCents, 800);
  } finally {
    await closeTestServer(server);
  }
});

test("ledger links can be cleared and identity history survives inventory deletion", async () => {
  const server = await createTestServer();
  try {
    const { collectionId, cookie } = await bootstrap(server.app);
    const itemId = await createItem(server.app, collectionId, cookie, 3);
    const created = await createTransaction(server.app, collectionId, cookie, {
      itemId,
      type: "purchase",
      quantity: 3,
      amountCents: 3_000,
      transactedAt: "2026-08-01"
    });
    const transactionId = created.json().transaction.id;
    assert.equal(created.json().transaction.itemName, "Pikachu");

    const renamed = await server.app.inject({
      method: "PATCH",
      url: `/api/collections/${collectionId}/items/${itemId}`,
      headers: { cookie },
      payload: {
        name: "Raichu",
        setName: "Base Set 2",
        cardNumber: "26",
        language: "en",
        itemType: "raw",
        quantity: 3
      }
    });
    assert.equal(renamed.statusCode, 200);

    const patch = await server.app.inject({
      method: "PATCH",
      url: `/api/collections/${collectionId}/transactions/${transactionId}`,
      headers: { cookie },
      payload: { notes: "Original purchase" }
    });
    assert.equal(patch.statusCode, 200);
    assert.equal(patch.json().transaction.itemName, "Pikachu");
    assert.equal(patch.json().transaction.itemSetName, "Base Set");

    const unlinked = await server.app.inject({
      method: "PATCH",
      url: `/api/collections/${collectionId}/transactions/${transactionId}`,
      headers: { cookie },
      payload: { itemId: null }
    });
    assert.equal(unlinked.statusCode, 200);
    assert.equal(unlinked.json().transaction.itemId, null);
    assert.equal(unlinked.json().transaction.itemName, "Pikachu");

    const relinked = await server.app.inject({
      method: "PATCH",
      url: `/api/collections/${collectionId}/transactions/${transactionId}`,
      headers: { cookie },
      payload: { itemId }
    });
    assert.equal(relinked.statusCode, 200);
    assert.equal(relinked.json().transaction.itemId, itemId);
    assert.equal(relinked.json().transaction.itemName, "Raichu");
    assert.equal(relinked.json().transaction.itemSetName, "Base Set 2");

    const deleted = await server.app.inject({
      method: "DELETE",
      url: `/api/collections/${collectionId}/items/${itemId}`,
      headers: { cookie }
    });
    assert.equal(deleted.statusCode, 200);

    const ledger = await server.app.inject({
      method: "GET",
      url: `/api/collections/${collectionId}/transactions`,
      headers: { cookie }
    });
    assert.equal(ledger.statusCode, 200);
    assert.equal(ledger.json().transactions[0].itemId, null);
    assert.equal(ledger.json().transactions[0].itemName, "Raichu");
    assert.equal(ledger.json().transactions[0].itemSetName, "Base Set 2");
    assert.equal(ledger.json().transactions[0].itemCardNumber, "26");
  } finally {
    await closeTestServer(server);
  }
});

async function createTestServer(): Promise<TestServer> {
  const root = mkdtempSync(join(tmpdir(), "collection-tool-ledger-"));
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
  return { collectionId: response.json().collections[0].id, cookie: sessionCookie(response) };
}

async function createItem(app: FastifyInstance, collectionId: string, cookie: string, quantity: number) {
  const response = await app.inject({
    method: "POST",
    url: `/api/collections/${collectionId}/items`,
    headers: { cookie },
    payload: {
      name: "Pikachu",
      setName: "Base Set",
      cardNumber: "58",
      language: "en",
      itemType: "raw",
      quantity
    }
  });
  assert.equal(response.statusCode, 201);
  return response.json().item.id as string;
}

async function createTransaction(
  app: FastifyInstance,
  collectionId: string,
  cookie: string,
  payload: Record<string, unknown>
) {
  return app.inject({
    method: "POST",
    url: `/api/collections/${collectionId}/transactions`,
    headers: { cookie },
    payload
  });
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
  server: TestServer,
  collectionId: string,
  cookie: string,
  userId: string,
  role: "viewer" | "editor"
) {
  const response = await server.app.inject({
    method: "POST",
    url: `/api/collections/${collectionId}/members`,
    headers: { cookie },
    payload: { userId, role }
  });
  assert.equal(response.statusCode, 200);
}

async function login(app: FastifyInstance, identifier: string, password: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { identifier, password }
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

function errorMessage(response: LightMyRequestResponse) {
  const body = response.json() as { error?: string; message?: string };
  return body.message ?? body.error ?? "";
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
