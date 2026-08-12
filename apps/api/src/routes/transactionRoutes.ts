import { randomUUID } from "node:crypto";
import type {
  CollectionTransaction,
  CollectionTransactionSummary,
  CollectionTransactionType,
  CollectionTransactionsResponse,
  CreateCollectionTransactionRequest,
  UpdateCollectionTransactionRequest
} from "@collection-tool/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { getAuthContext, getCollectionRole } from "../auth.js";
import type { AppDatabase } from "../db.js";

const transactionTypes = new Set<CollectionTransactionType>([
  "purchase",
  "sale",
  "trade_received",
  "trade_given",
  "fee",
  "gift_received",
  "gift_given",
  "disposal"
]);

type TransactionRow = {
  id: string;
  collection_id: string;
  owned_item_id: string | null;
  transaction_type: CollectionTransactionType;
  quantity: number | null;
  amount_cents: number;
  fees_cents: number;
  allocated_cost_cents: number | null;
  currency: string;
  item_name: string;
  item_set_name: string | null;
  item_card_number: string | null;
  counterparty: string | null;
  notes: string | null;
  transacted_at: string;
  created_by_user_id: string | null;
  created_by_display_name: string | null;
  created_by_username: string | null;
  created_at: string;
  updated_at: string;
};

type TransactionInput = {
  itemId: string | null;
  type: CollectionTransactionType;
  quantity: number | null;
  amountCents: number;
  feesCents: number;
  allocatedCostCents: number | null;
  itemName: string;
  itemSetName: string | null;
  itemCardNumber: string | null;
  counterparty: string | null;
  notes: string | null;
  transactedAt: string;
};

export async function registerTransactionRoutes(
  app: FastifyInstance,
  database: AppDatabase
) {
  app.get("/api/collections/:collectionId/transactions", async (request, reply) => {
    const access = requireCollectionAccess(request, reply, database, false);
    if (!access) return accessError(reply, false);

    const itemId = optionalQueryItemId(request.query);
    const transactions = listTransactions(database, access.collectionId, itemId);
    const response: CollectionTransactionsResponse = {
      transactions,
      summary: summarizeTransactions(transactions)
    };
    return response;
  });

  app.post("/api/collections/:collectionId/transactions", async (request, reply) => {
    const access = requireCollectionAccess(request, reply, database, true);
    if (!access) return accessError(reply, true);

    const input = normalizeInput(
      database,
      access.collectionId,
      request.body as CreateCollectionTransactionRequest
    );
    const id = randomUUID();

    database.connection
      .prepare(
        `
          INSERT INTO collection_transactions (
            id, collection_id, owned_item_id, transaction_type, quantity,
            amount_cents, fees_cents, allocated_cost_cents, currency,
            item_name, item_set_name, item_card_number, counterparty, notes,
            transacted_at, created_by_user_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        id,
        access.collectionId,
        input.itemId,
        input.type,
        input.quantity,
        input.amountCents,
        input.feesCents,
        input.allocatedCostCents,
        input.itemName,
        input.itemSetName,
        input.itemCardNumber,
        input.counterparty,
        input.notes,
        input.transactedAt,
        access.userId
      );

    reply.code(201);
    return { transaction: getTransaction(database, access.collectionId, id) };
  });

  app.patch(
    "/api/collections/:collectionId/transactions/:transactionId",
    async (request, reply) => {
      const access = requireCollectionAccess(request, reply, database, true);
      if (!access) return accessError(reply, true);

      const { transactionId } = request.params as { transactionId: string };
      const current = getTransaction(database, access.collectionId, transactionId);
      if (!current) {
        reply.code(404);
        return { error: "Transaction not found." };
      }

      const body = (request.body ?? {}) as UpdateCollectionTransactionRequest;
      const nextItemId = hasOwn(body, "itemId") ? body.itemId : current.itemId ?? undefined;
      const linkedItemChanged =
        hasOwn(body, "itemId") && Boolean(body.itemId) && body.itemId !== current.itemId;
      const merged: CreateCollectionTransactionRequest = {
        itemId: nextItemId,
        type: body.type ?? current.type,
        quantity: hasOwn(body, "quantity") ? body.quantity : current.quantity ?? undefined,
        amountCents: hasOwn(body, "amountCents") ? body.amountCents : current.amountCents,
        feesCents: hasOwn(body, "feesCents") ? body.feesCents : current.feesCents,
        allocatedCostCents: hasOwn(body, "allocatedCostCents")
          ? body.allocatedCostCents
          : current.allocatedCostCents ?? undefined,
        itemName: linkedItemChanged ? body.itemName : body.itemName ?? current.itemName,
        counterparty: hasOwn(body, "counterparty") ? body.counterparty : current.counterparty ?? undefined,
        notes: hasOwn(body, "notes") ? body.notes : current.notes ?? undefined,
        transactedAt: body.transactedAt ?? current.transactedAt
      };
      const input = normalizeInput(database, access.collectionId, merged, {
        preserveItemSnapshot: linkedItemChanged ? undefined : current
      });

      database.connection
        .prepare(
          `
            UPDATE collection_transactions
            SET owned_item_id = ?, transaction_type = ?, quantity = ?, amount_cents = ?,
                fees_cents = ?, allocated_cost_cents = ?, item_name = ?, item_set_name = ?,
                item_card_number = ?, counterparty = ?, notes = ?, transacted_at = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND collection_id = ?
          `
        )
        .run(
          input.itemId,
          input.type,
          input.quantity,
          input.amountCents,
          input.feesCents,
          input.allocatedCostCents,
          input.itemName,
          input.itemSetName,
          input.itemCardNumber,
          input.counterparty,
          input.notes,
          input.transactedAt,
          transactionId,
          access.collectionId
        );

      return { transaction: getTransaction(database, access.collectionId, transactionId) };
    }
  );

  app.delete(
    "/api/collections/:collectionId/transactions/:transactionId",
    async (request, reply) => {
      const access = requireCollectionAccess(request, reply, database, true);
      if (!access) return accessError(reply, true);

      const { transactionId } = request.params as { transactionId: string };
      const result = database.connection
        .prepare("DELETE FROM collection_transactions WHERE id = ? AND collection_id = ?")
        .run(transactionId, access.collectionId);

      if (result.changes === 0) {
        reply.code(404);
        return { error: "Transaction not found." };
      }

      return { ok: true };
    }
  );
}

function requireCollectionAccess(
  request: Parameters<typeof getAuthContext>[0],
  reply: FastifyReply,
  database: AppDatabase,
  requireEditor: boolean
) {
  const auth = getAuthContext(request, database);
  if (!auth) {
    reply.code(401);
    return null;
  }

  const { collectionId } = request.params as { collectionId: string };
  const role = getCollectionRole(database, collectionId, auth.user.id);
  if (!role) {
    reply.code(403);
    return null;
  }

  if (requireEditor && role === "viewer") {
    reply.code(403);
    return null;
  }

  return { collectionId, userId: auth.user.id };
}

function accessError(reply: FastifyReply, requireEditor: boolean) {
  if (reply.statusCode === 401) return { error: "Unauthorized" };
  return {
    error: requireEditor
      ? "You need editor access to change transactions."
      : "You do not have access to this collection."
  };
}

function optionalQueryItemId(query: unknown) {
  const raw = (query as { itemId?: unknown } | undefined)?.itemId;
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") throw badRequest("itemId must be a string.");
  return raw;
}

function normalizeInput(
  database: AppDatabase,
  collectionId: string,
  raw: CreateCollectionTransactionRequest,
  options: { preserveItemSnapshot?: CollectionTransaction } = {}
): TransactionInput {
  if (!raw || typeof raw !== "object") throw badRequest("Enter transaction details.");
  if (!transactionTypes.has(raw.type)) throw badRequest("Choose a valid transaction type.");

  const itemId = normalizeOptionalText(raw.itemId, 100, "Item ID");
  const linkedItem = itemId ? getItemSnapshot(database, collectionId, itemId) : null;
  if (itemId && !linkedItem) throw badRequest("The linked inventory item was not found.");

  const quantity = optionalPositiveInteger(raw.quantity, "Quantity");
  if (raw.type !== "fee" && quantity === null) {
    throw badRequest("Quantity is required for item transactions.");
  }
  if (raw.type === "fee" && quantity !== null) {
    throw badRequest("Standalone fee entries do not use a quantity.");
  }

  const amountCents = nonNegativeInteger(raw.amountCents ?? 0, "Total amount");
  const feesCents = nonNegativeInteger(raw.feesCents ?? 0, "Fees");
  const allocatedCostCents = optionalNonNegativeInteger(raw.allocatedCostCents, "Allocated cost");
  if (raw.type === "fee" && feesCents !== 0) {
    throw badRequest("Standalone fee entries use total amount; additional fees must be zero.");
  }
  if (["purchase", "sale", "fee"].includes(raw.type) && amountCents === 0) {
    throw badRequest("Purchases, sales, and standalone fees require a positive total amount.");
  }
  if (!["sale", "trade_given"].includes(raw.type) && allocatedCostCents !== null) {
    throw badRequest("Allocated cost is only available for sales and items given in a trade.");
  }
  if (["gift_received", "gift_given", "disposal"].includes(raw.type) && amountCents !== 0) {
    throw badRequest("Gifts and disposals must have a zero total amount.");
  }

  const preserved = options.preserveItemSnapshot;
  const itemName =
    preserved?.itemName ??
    linkedItem?.itemName ??
    normalizeOptionalText(raw.itemName, 180, "Item name") ??
    (raw.type === "fee" ? "Fee" : "Unlinked item");
  const transactedAt = normalizeDate(raw.transactedAt);

  return {
    itemId,
    type: raw.type,
    quantity,
    amountCents,
    feesCents,
    allocatedCostCents,
    itemName,
    itemSetName: preserved?.itemSetName ?? linkedItem?.itemSetName ?? null,
    itemCardNumber: preserved?.itemCardNumber ?? linkedItem?.itemCardNumber ?? null,
    counterparty: normalizeOptionalText(raw.counterparty, 180, "Counterparty"),
    notes: normalizeOptionalText(raw.notes, 2_000, "Notes"),
    transactedAt
  };
}

function getItemSnapshot(database: AppDatabase, collectionId: string, itemId: string) {
  return database.connection
    .prepare(
      `
        SELECT c.name AS itemName, c.set_name AS itemSetName, c.card_number AS itemCardNumber
        FROM owned_items oi
        INNER JOIN cards c ON c.id = oi.card_id
        WHERE oi.id = ? AND oi.collection_id = ?
      `
    )
    .get(itemId, collectionId) as
    | { itemName: string; itemSetName: string | null; itemCardNumber: string | null }
    | undefined;
}

function listTransactions(database: AppDatabase, collectionId: string, itemId: string | null) {
  const where = itemId ? "AND t.owned_item_id = ?" : "";
  const params = itemId ? [collectionId, itemId] : [collectionId];
  const rows = database.connection
    .prepare(
      `
        SELECT t.*, u.display_name AS created_by_display_name, u.username AS created_by_username
        FROM collection_transactions t
        LEFT JOIN users u ON u.id = t.created_by_user_id
        WHERE t.collection_id = ? ${where}
        ORDER BY t.transacted_at DESC, t.created_at DESC
      `
    )
    .all(...params) as TransactionRow[];
  return rows.map(mapTransaction);
}

function getTransaction(database: AppDatabase, collectionId: string, id: string) {
  const row = database.connection
    .prepare(
      `
        SELECT t.*, u.display_name AS created_by_display_name, u.username AS created_by_username
        FROM collection_transactions t
        LEFT JOIN users u ON u.id = t.created_by_user_id
        WHERE t.collection_id = ? AND t.id = ?
      `
    )
    .get(collectionId, id) as TransactionRow | undefined;
  return row ? mapTransaction(row) : null;
}

function mapTransaction(row: TransactionRow): CollectionTransaction {
  return {
    id: row.id,
    collectionId: row.collection_id,
    itemId: row.owned_item_id,
    type: row.transaction_type,
    quantity: row.quantity,
    amountCents: row.amount_cents,
    feesCents: row.fees_cents,
    allocatedCostCents: row.allocated_cost_cents,
    currency: row.currency,
    itemName: row.item_name,
    itemSetName: row.item_set_name,
    itemCardNumber: row.item_card_number,
    counterparty: row.counterparty,
    notes: row.notes,
    transactedAt: row.transacted_at,
    createdByUserId: row.created_by_user_id,
    createdByDisplayName: row.created_by_display_name,
    createdByUsername: row.created_by_username,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function summarizeTransactions(
  transactions: CollectionTransaction[]
): CollectionTransactionSummary {
  let purchaseCostCents = 0;
  let grossSaleProceedsCents = 0;
  let totalFeesCents = 0;
  let cashInCents = 0;
  let cashOutCents = 0;
  let realizedSaleCount = 0;
  let salesMissingCostBasisCount = 0;
  let realizedTradeCount = 0;
  let tradesMissingCostBasisCount = 0;
  let realizedProceedsCents = 0;
  let realizedCostBasisCents = 0;
  let realizedTradeAssignedValueCents = 0;
  let realizedTradeCostBasisCents = 0;

  for (const transaction of transactions) {
    const incomingCash = transaction.type === "sale";
    const outgoingCash = transaction.type === "purchase";
    const standaloneFee = transaction.type === "fee" ? transaction.amountCents : 0;

    if (transaction.type === "purchase") purchaseCostCents += transaction.amountCents;
    if (transaction.type === "sale") grossSaleProceedsCents += transaction.amountCents;
    totalFeesCents += transaction.feesCents + standaloneFee;
    if (incomingCash) cashInCents += transaction.amountCents;
    if (outgoingCash) cashOutCents += transaction.amountCents;
    cashOutCents += transaction.feesCents + standaloneFee;

    if (transaction.type === "sale") {
      if (transaction.allocatedCostCents === null) {
        salesMissingCostBasisCount += 1;
      } else {
        realizedSaleCount += 1;
        realizedProceedsCents += transaction.amountCents - transaction.feesCents;
        realizedCostBasisCents += transaction.allocatedCostCents;
      }
    }

    if (transaction.type === "trade_given") {
      if (transaction.allocatedCostCents === null) {
        tradesMissingCostBasisCount += 1;
      } else {
        realizedTradeCount += 1;
        realizedTradeAssignedValueCents += transaction.amountCents - transaction.feesCents;
        realizedTradeCostBasisCents += transaction.allocatedCostCents;
      }
    }
  }

  return {
    transactionCount: transactions.length,
    purchaseCostCents,
    grossSaleProceedsCents,
    totalFeesCents,
    cashInCents,
    cashOutCents,
    netCashFlowCents: cashInCents - cashOutCents,
    realizedSaleCount,
    salesMissingCostBasisCount,
    realizedTradeCount,
    tradesMissingCostBasisCount,
    realizedProceedsCents,
    realizedCostBasisCents,
    realizedProfitCents: realizedProceedsCents - realizedCostBasisCents,
    realizedTradeAssignedValueCents,
    realizedTradeCostBasisCents,
    realizedTradeProfitCents: realizedTradeAssignedValueCents - realizedTradeCostBasisCents
  };
}

function normalizeDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw badRequest("Transaction date must use YYYY-MM-DD.");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw badRequest("Enter a valid transaction date.");
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw badRequest(`${label} must be a non-negative whole number of cents.`);
  }
  return value;
}

function optionalNonNegativeInteger(value: unknown, label: string) {
  return value === undefined || value === null ? null : nonNegativeInteger(value, label);
}

function optionalPositiveInteger(value: unknown, label: string) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw badRequest(`${label} must be a positive whole number.`);
  }
  return value;
}

function normalizeOptionalText(value: unknown, max: number, label: string) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw badRequest(`${label} must be text.`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > max) throw badRequest(`${label} must be ${max} characters or fewer.`);
  return normalized;
}

function hasOwn(value: object, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function badRequest(message: string) {
  return Object.assign(new Error(message), { statusCode: 400 });
}
