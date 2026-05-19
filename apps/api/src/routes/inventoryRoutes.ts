import { randomUUID } from "node:crypto";
import type {
  BulkDeleteInventoryItemsRequest,
  BulkUpdateInventoryVariantsRequest,
  CardLanguage,
  CreateInventoryItemRequest,
  InventoryMarketPriceSource,
  InventoryItem,
  InventoryItemType,
  MarketPriceConfidence,
  UpdateInventoryItemRequest,
  UpdateInventoryItemImageRequest,
  ValueOverrideHistoryEntry,
  ValueOverrideHistoryResponse
} from "@collection-tool/shared";
import type { FastifyInstance } from "fastify";
import { getAuthContext, getCollectionRole } from "../auth.js";
import type { AppDatabase } from "../db.js";

type InventoryRow = {
  id: string;
  collection_id: string;
  card_id: string;
  item_type: InventoryItemType;
  quantity: number;
  condition_label: string | null;
  condition_score: number | null;
  variant_details: string | null;
  grader: string | null;
  grade: string | null;
  cert_number: string | null;
  purchase_price_cents: number | null;
  purchase_date: string | null;
  value_override_cents: number | null;
  market_price_cents: number | null;
  market_price_source: InventoryMarketPriceSource | null;
  market_price_updated_at: string | null;
  market_price_confidence: MarketPriceConfidence | null;
  market_price_matched_name: string | null;
  market_price_matched_set_name: string | null;
  market_price_matched_card_number: string | null;
  market_price_condition: string | null;
  market_price_printing: string | null;
  market_price_raw_payload: string | null;
  storage_location: string | null;
  notes: string | null;
  cert_url: string | null;
  cert_spec_id: string | null;
  cert_category: string | null;
  cert_population: string | null;
  cert_population_higher: string | null;
  cert_estimate_cents: number | null;
  cert_lookup_at: string | null;
  created_at: string;
  name: string;
  set_name: string | null;
  set_code: string | null;
  card_number: string | null;
  language: CardLanguage;
  rarity: string | null;
  release_year: string | null;
  image_url: string | null;
};

export async function registerInventoryRoutes(app: FastifyInstance, database: AppDatabase) {
  app.get("/api/collections/:collectionId/items", async (request, reply) => {
    const auth = getAuthContext(request, database);

    if (!auth) {
      reply.code(401);
      return { error: "Unauthorized" };
    }

    const { collectionId } = request.params as { collectionId: string };
    const role = getCollectionRole(database, collectionId, auth.user.id);

    if (!role) {
      reply.code(403);
      return { error: "You do not have access to this collection." };
    }

    const items = listInventoryItems(database, collectionId);

    return {
      items,
      summary: summarizeItems(items)
    };
  });

  app.get("/api/collections/:collectionId/items/export.csv", async (request, reply) => {
    const auth = getAuthContext(request, database);

    if (!auth) {
      reply.code(401);
      return { error: "Unauthorized" };
    }

    const { collectionId } = request.params as { collectionId: string };
    const role = getCollectionRole(database, collectionId, auth.user.id);

    if (!role) {
      reply.code(403);
      return { error: "You do not have access to this collection." };
    }

    const items = listInventoryItems(database, collectionId);
    const fileName = `pokemon-vault-inventory-${new Date().toISOString().slice(0, 10)}.csv`;

    reply
      .type("text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${fileName}"`);

    return toInventoryCsv(items);
  });

  app.get(
    "/api/collections/:collectionId/items/:itemId/value-override-history",
    async (request, reply) => {
      const auth = getAuthContext(request, database);

      if (!auth) {
        reply.code(401);
        return { error: "Unauthorized" };
      }

      const { collectionId, itemId } = request.params as {
        collectionId: string;
        itemId: string;
      };
      const role = getCollectionRole(database, collectionId, auth.user.id);

      if (!role) {
        reply.code(403);
        return { error: "You do not have access to this collection." };
      }

      if (!inventoryItemExists(database, collectionId, itemId)) {
        reply.code(404);
        return { error: "Inventory item not found." };
      }

      const response: ValueOverrideHistoryResponse = {
        itemId,
        history: listValueOverrideHistory(database, itemId)
      };

      return response;
    }
  );

  app.post("/api/collections/:collectionId/items", async (request, reply) => {
    const auth = getAuthContext(request, database);

    if (!auth) {
      reply.code(401);
      return { error: "Unauthorized" };
    }

    const { collectionId } = request.params as { collectionId: string };
    const role = getCollectionRole(database, collectionId, auth.user.id);

    if (!role || role === "viewer") {
      reply.code(403);
      return { error: "You need editor access to add cards." };
    }

    const input = normalizeCreateInput(request.body as CreateInventoryItemRequest);
    const item = createInventoryItem(database, collectionId, input);

    reply.code(201);
    return { item };
  });

  app.patch("/api/collections/:collectionId/items/:itemId", async (request, reply) => {
    const auth = getAuthContext(request, database);

    if (!auth) {
      reply.code(401);
      return { error: "Unauthorized" };
    }

    const { collectionId, itemId } = request.params as {
      collectionId: string;
      itemId: string;
    };
    const role = getCollectionRole(database, collectionId, auth.user.id);

    if (!role || role === "viewer") {
      reply.code(403);
      return { error: "You need editor access to edit cards." };
    }

    const input = normalizeCreateInput(request.body as UpdateInventoryItemRequest);
    const item = updateInventoryItem(database, collectionId, itemId, input, auth.user.id);

    if (!item) {
      reply.code(404);
      return { error: "Inventory item not found." };
    }

    return { item };
  });

  app.patch("/api/collections/:collectionId/items/:itemId/image", async (request, reply) => {
    const auth = getAuthContext(request, database);

    if (!auth) {
      reply.code(401);
      return { error: "Unauthorized" };
    }

    const { collectionId, itemId } = request.params as {
      collectionId: string;
      itemId: string;
    };
    const role = getCollectionRole(database, collectionId, auth.user.id);

    if (!role || role === "viewer") {
      reply.code(403);
      return { error: "You need editor access to update card images." };
    }

    const imageUrl = normalizeImageUrl(
      (request.body as UpdateInventoryItemImageRequest).imageUrl
    );
    const item = updateInventoryItemImage(database, collectionId, itemId, imageUrl);

    if (!item) {
      reply.code(404);
      return { error: "Inventory item not found." };
    }

    return { item };
  });

  app.delete("/api/collections/:collectionId/items/:itemId", async (request, reply) => {
    const auth = getAuthContext(request, database);

    if (!auth) {
      reply.code(401);
      return { error: "Unauthorized" };
    }

    const { collectionId, itemId } = request.params as {
      collectionId: string;
      itemId: string;
    };
    const role = getCollectionRole(database, collectionId, auth.user.id);

    if (!role || role === "viewer") {
      reply.code(403);
      return { error: "You need editor access to delete cards." };
    }

    const deleted = deleteInventoryItem(database, collectionId, itemId);

    if (!deleted) {
      reply.code(404);
      return { error: "Inventory item not found." };
    }

    return { ok: true };
  });

  app.post("/api/collections/:collectionId/items/bulk/delete", async (request, reply) => {
    const auth = getAuthContext(request, database);

    if (!auth) {
      reply.code(401);
      return { error: "Unauthorized" };
    }

    const { collectionId } = request.params as { collectionId: string };
    const role = getCollectionRole(database, collectionId, auth.user.id);

    if (!role || role === "viewer") {
      reply.code(403);
      return { error: "You need editor access to delete cards." };
    }

    const itemIds = uniqueItemIds((request.body as BulkDeleteInventoryItemsRequest).itemIds);

    if (itemIds.length === 0) {
      reply.code(400);
      return { error: "Select at least one card before deleting." };
    }

    const deletedItemIds: string[] = [];
    const notFoundItemIds: string[] = [];

    for (const itemId of itemIds) {
      if (deleteInventoryItem(database, collectionId, itemId)) {
        deletedItemIds.push(itemId);
      } else {
        notFoundItemIds.push(itemId);
      }
    }

    return {
      deletedItemIds,
      notFoundItemIds
    };
  });

  app.post("/api/collections/:collectionId/items/bulk/variants", async (request, reply) => {
    const auth = getAuthContext(request, database);

    if (!auth) {
      reply.code(401);
      return { error: "Unauthorized" };
    }

    const { collectionId } = request.params as { collectionId: string };
    const role = getCollectionRole(database, collectionId, auth.user.id);

    if (!role || role === "viewer") {
      reply.code(403);
      return { error: "You need editor access to edit cards." };
    }

    const input = request.body as BulkUpdateInventoryVariantsRequest;
    const itemIds = uniqueItemIds(input.itemIds);
    const variants = normalizeVariants(input.variants);

    if (itemIds.length === 0) {
      reply.code(400);
      return { error: "Select at least one card before editing variants." };
    }

    if (!["set", "add", "remove"].includes(input.mode)) {
      reply.code(400);
      return { error: "Choose a valid variant edit mode." };
    }

    if (input.mode !== "set" && variants.length === 0) {
      reply.code(400);
      return { error: "Choose at least one variant to add or remove." };
    }

    const result = bulkUpdateInventoryVariants(database, collectionId, {
      itemIds,
      mode: input.mode,
      variants,
      clearMarketPrices: input.clearMarketPrices !== false
    });

    return result;
  });
}

const inventoryCsvColumns = [
  "inventory_id",
  "card_id",
  "name",
  "set_name",
  "set_code",
  "card_number",
  "language",
  "rarity",
  "image_url",
  "item_type",
  "quantity",
  "condition_label",
  "condition_score",
  "variant_details",
  "grader",
  "grade",
  "cert_number",
  "cert_url",
  "cert_spec_id",
  "cert_category",
  "cert_population",
  "cert_population_higher",
  "cert_lookup_at",
  "purchase_price_cents",
  "purchase_date",
  "value_override_cents",
  "market_price_cents",
  "market_price_source",
  "market_price_updated_at",
  "market_price_confidence",
  "market_price_matched_name",
  "market_price_matched_set_name",
  "market_price_matched_card_number",
  "market_price_condition",
  "market_price_printing",
  "storage_location",
  "notes",
  "created_at"
] as const;

function toInventoryCsv(items: InventoryItem[]) {
  const rows = items.map((item) => [
    item.id,
    item.cardId,
    item.card.name,
    item.card.setName,
    item.card.setCode,
    item.card.cardNumber,
    item.card.language,
    item.card.rarity,
    item.card.imageUrl,
    item.itemType,
    item.quantity,
    item.conditionLabel,
    item.conditionScore,
    item.variantDetails,
    item.grader,
    item.grade,
    item.certNumber,
    item.certUrl,
    item.certSpecId,
    item.certCategory,
    item.certPopulation,
    item.certPopulationHigher,
    item.certLookupAt,
    item.purchasePriceCents,
    item.purchaseDate,
    item.valueOverrideCents,
    item.marketPriceCents,
    item.marketPriceSource,
    item.marketPriceUpdatedAt,
    item.marketPriceConfidence,
    item.marketPriceMatchedName,
    item.marketPriceMatchedSetName,
    item.marketPriceMatchedCardNumber,
    item.marketPriceCondition,
    item.marketPricePrinting,
    item.storageLocation,
    item.notes,
    item.createdAt
  ]);

  return [inventoryCsvColumns, ...rows].map((row) => row.map(toCsvCell).join(",")).join("\n");
}

function toCsvCell(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);

  if (!/[",\n\r]/.test(text)) {
    return text;
  }

  return `"${text.replaceAll('"', '""')}"`;
}

function createInventoryItem(
  database: AppDatabase,
  collectionId: string,
  input: CreateInventoryItemRequest
) {
  const cardId = randomUUID();
  const itemId = randomUUID();

  database.connection.exec("BEGIN");
  try {
    database.connection
      .prepare(
        `
          INSERT INTO cards (
            id,
            name,
            set_name,
            set_code,
            card_number,
            language,
            rarity,
            release_year,
            image_url
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        cardId,
        input.name.trim(),
        nullIfBlank(input.setName),
        nullIfBlank(input.setCode),
        nullIfBlank(input.cardNumber),
        input.language,
        nullIfBlank(input.rarity),
        releaseYearForInput(input),
        nullIfBlank(input.imageUrl)
      );

    database.connection
      .prepare(
        `
          INSERT INTO owned_items (
            id,
            collection_id,
            card_id,
            item_type,
            quantity,
            condition_label,
            condition_score,
            variant_details,
            grader,
            grade,
            cert_number,
            purchase_price_cents,
            purchase_date,
            value_override_cents,
            storage_location,
            notes,
            cert_url,
            cert_spec_id,
            cert_category,
            cert_population,
            cert_population_higher,
            cert_estimate_cents,
            cert_lookup_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        itemId,
        collectionId,
        cardId,
        input.itemType,
        input.quantity,
        nullIfBlank(input.conditionLabel),
        input.conditionScore ?? null,
        nullIfBlank(input.variantDetails),
        nullIfBlank(input.grader),
        nullIfBlank(input.grade),
        nullIfBlank(input.certNumber),
        input.purchasePriceCents ?? null,
        nullIfBlank(input.purchaseDate),
        input.valueOverrideCents ?? null,
        nullIfBlank(input.storageLocation),
        nullIfBlank(input.notes),
        nullIfBlank(input.certUrl),
        nullIfBlank(input.certSpecId),
        nullIfBlank(input.certCategory),
        nullIfBlank(input.certPopulation),
        nullIfBlank(input.certPopulationHigher),
        input.certEstimateCents ?? null,
        nullIfBlank(input.certLookupAt)
      );

    database.connection.exec("COMMIT");
  } catch (error) {
    database.connection.exec("ROLLBACK");
    throw error;
  }

  return listInventoryItems(database, collectionId).find((item) => item.id === itemId);
}

function updateInventoryItem(
  database: AppDatabase,
  collectionId: string,
  itemId: string,
  input: UpdateInventoryItemRequest,
  changedByUserId: string | null = null
) {
  const row = database.connection
    .prepare(
      `
        SELECT
          oi.card_id,
          oi.item_type,
          oi.condition_label,
          oi.variant_details,
          oi.grader,
          oi.grade,
          oi.cert_number,
          oi.value_override_cents,
          c.name,
          c.set_name,
          c.set_code,
          c.card_number,
          c.language,
          c.release_year
        FROM owned_items oi
        JOIN cards c ON c.id = oi.card_id
        WHERE oi.id = ? AND oi.collection_id = ?
      `
    )
    .get(itemId, collectionId) as
    | {
        card_id: string;
        item_type: string;
        condition_label: string | null;
        variant_details: string | null;
        grader: string | null;
        grade: string | null;
        cert_number: string | null;
        value_override_cents: number | null;
        name: string;
        set_name: string | null;
        set_code: string | null;
        card_number: string | null;
        language: string;
        release_year: string | null;
      }
    | undefined;

  if (!row) {
    return null;
  }

  database.connection.exec("BEGIN");
  try {
    database.connection
      .prepare(
        `
          UPDATE cards
          SET
            name = ?,
            set_name = ?,
            set_code = ?,
            card_number = ?,
            language = ?,
            rarity = ?,
            release_year = ?,
            image_url = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `
      )
      .run(
        input.name.trim(),
        nullIfBlank(input.setName),
        nullIfBlank(input.setCode),
        nullIfBlank(input.cardNumber),
        input.language,
        nullIfBlank(input.rarity),
        releaseYearForInput(input),
        nullIfBlank(input.imageUrl),
        row.card_id
      );

    database.connection
      .prepare(
        `
          UPDATE owned_items
          SET
            item_type = ?,
            quantity = ?,
            condition_label = ?,
            condition_score = ?,
            variant_details = ?,
            grader = ?,
            grade = ?,
            cert_number = ?,
            purchase_price_cents = ?,
            purchase_date = ?,
            value_override_cents = ?,
            storage_location = ?,
            notes = ?,
            cert_url = ?,
            cert_spec_id = ?,
            cert_category = ?,
            cert_population = ?,
            cert_population_higher = ?,
            cert_estimate_cents = ?,
            cert_lookup_at = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND collection_id = ?
        `
      )
      .run(
        input.itemType,
        input.quantity,
        nullIfBlank(input.conditionLabel),
        input.conditionScore ?? null,
        nullIfBlank(input.variantDetails),
        nullIfBlank(input.grader),
        nullIfBlank(input.grade),
        nullIfBlank(input.certNumber),
        input.purchasePriceCents ?? null,
        nullIfBlank(input.purchaseDate),
        input.valueOverrideCents ?? null,
        nullIfBlank(input.storageLocation),
        nullIfBlank(input.notes),
        nullIfBlank(input.certUrl),
        nullIfBlank(input.certSpecId),
        nullIfBlank(input.certCategory),
        nullIfBlank(input.certPopulation),
        nullIfBlank(input.certPopulationHigher),
        input.certEstimateCents ?? null,
        nullIfBlank(input.certLookupAt),
        itemId,
        collectionId
      );

    const nextValueOverrideCents = input.valueOverrideCents ?? null;

    if (row.value_override_cents !== nextValueOverrideCents) {
      insertValueOverrideHistory(
        database,
        itemId,
        row.value_override_cents,
        nextValueOverrideCents,
        changedByUserId
      );
    }

    if (hasPricingIdentityChanged(row, input)) {
      clearPricingSourceMatches(database, itemId);
    }

    database.connection.exec("COMMIT");
  } catch (error) {
    database.connection.exec("ROLLBACK");
    throw error;
  }

  return listInventoryItems(database, collectionId).find((item) => item.id === itemId) ?? null;
}

function updateInventoryItemImage(
  database: AppDatabase,
  collectionId: string,
  itemId: string,
  imageUrl: string | null
) {
  const row = database.connection
    .prepare(
      `
        SELECT card_id
        FROM owned_items
        WHERE id = ? AND collection_id = ?
      `
    )
    .get(itemId, collectionId) as { card_id: string } | undefined;

  if (!row) {
    return null;
  }

  database.connection
    .prepare(
      `
        UPDATE cards
        SET image_url = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
    )
    .run(imageUrl, row.card_id);

  return listInventoryItems(database, collectionId).find((item) => item.id === itemId) ?? null;
}

function inventoryItemExists(database: AppDatabase, collectionId: string, itemId: string) {
  const row = database.connection
    .prepare(
      `
        SELECT id
        FROM owned_items
        WHERE id = ? AND collection_id = ?
      `
    )
    .get(itemId, collectionId) as { id: string } | undefined;

  return Boolean(row);
}

function insertValueOverrideHistory(
  database: AppDatabase,
  itemId: string,
  previousValueCents: number | null,
  nextValueCents: number | null,
  changedByUserId: string | null
) {
  database.connection
    .prepare(
      `
        INSERT INTO item_value_override_history (
          id,
          owned_item_id,
          previous_value_cents,
          next_value_cents,
          changed_by_user_id,
          changed_at
        )
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `
    )
    .run(randomUUID(), itemId, previousValueCents, nextValueCents, changedByUserId);
}

function listValueOverrideHistory(
  database: AppDatabase,
  itemId: string
): ValueOverrideHistoryEntry[] {
  const rows = database.connection
    .prepare(
      `
        SELECT
          h.id,
          h.owned_item_id,
          h.previous_value_cents,
          h.next_value_cents,
          h.changed_by_user_id,
          h.changed_at,
          u.display_name,
          u.username
        FROM item_value_override_history h
        LEFT JOIN users u ON u.id = h.changed_by_user_id
        WHERE h.owned_item_id = ?
        ORDER BY h.changed_at DESC
        LIMIT 25
      `
    )
    .all(itemId) as {
    id: string;
    owned_item_id: string;
    previous_value_cents: number | null;
    next_value_cents: number | null;
    changed_by_user_id: string | null;
    changed_at: string;
    display_name: string | null;
    username: string | null;
  }[];

  return rows.map((row) => ({
    id: row.id,
    itemId: row.owned_item_id,
    previousValueCents: row.previous_value_cents,
    nextValueCents: row.next_value_cents,
    changedByUserId: row.changed_by_user_id,
    changedByDisplayName: row.display_name,
    changedByUsername: row.username,
    changedAt: row.changed_at
  }));
}

function deleteInventoryItem(database: AppDatabase, collectionId: string, itemId: string) {
  const row = database.connection
    .prepare(
      `
        SELECT card_id
        FROM owned_items
        WHERE id = ? AND collection_id = ?
      `
    )
    .get(itemId, collectionId) as { card_id: string } | undefined;

  if (!row) {
    return false;
  }

  database.connection.exec("BEGIN");
  try {
    database.connection
      .prepare("DELETE FROM owned_items WHERE id = ? AND collection_id = ?")
      .run(itemId, collectionId);
    database.connection.prepare("DELETE FROM cards WHERE id = ?").run(row.card_id);
    database.connection.exec("COMMIT");
  } catch (error) {
    database.connection.exec("ROLLBACK");
    throw error;
  }

  return true;
}

function bulkUpdateInventoryVariants(
  database: AppDatabase,
  collectionId: string,
  input: {
    itemIds: string[];
    mode: "set" | "add" | "remove";
    variants: string[];
    clearMarketPrices: boolean;
  }
) {
  const updatedItemIds: string[] = [];
  const notFoundItemIds: string[] = [];
  const clearedMarketPriceItemIds: string[] = [];
  const currentVariantStatement = database.connection.prepare(
    `
      SELECT variant_details
      FROM owned_items
      WHERE id = ? AND collection_id = ?
    `
  );
  const updateVariantStatement = database.connection.prepare(
    `
      UPDATE owned_items
      SET variant_details = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND collection_id = ?
    `
  );
  const marketPriceStatement = database.connection.prepare(
    `
      SELECT owned_item_id
      FROM item_market_prices
      WHERE owned_item_id = ?
    `
  );
  const clearMarketPriceStatement = database.connection.prepare(
    `
      DELETE FROM item_market_prices
      WHERE owned_item_id = ?
    `
  );

  database.connection.exec("BEGIN");
  try {
    for (const itemId of input.itemIds) {
      const row = currentVariantStatement.get(itemId, collectionId) as
        | { variant_details: string | null }
        | undefined;

      if (!row) {
        notFoundItemIds.push(itemId);
        continue;
      }

      const nextVariants = applyVariantEdit(
        parseVariantDetails(row.variant_details),
        input.variants,
        input.mode
      );
      const nextVariantDetails = nextVariants.length > 0 ? nextVariants.join(", ") : null;

      updateVariantStatement.run(nextVariantDetails, itemId, collectionId);
      updatedItemIds.push(itemId);

      if (input.clearMarketPrices && marketPriceStatement.get(itemId)) {
        clearMarketPriceStatement.run(itemId);
        clearedMarketPriceItemIds.push(itemId);
      }

      clearPricingSourceMatches(database, itemId);
    }

    database.connection.exec("COMMIT");
  } catch (error) {
    database.connection.exec("ROLLBACK");
    throw error;
  }

  const updatedIdSet = new Set(updatedItemIds);
  const items = listInventoryItems(database, collectionId).filter((item) => updatedIdSet.has(item.id));

  return {
    items,
    updatedItemIds,
    notFoundItemIds,
    clearedMarketPriceItemIds
  };
}

function applyVariantEdit(
  currentVariants: string[],
  selectedVariants: string[],
  mode: "set" | "add" | "remove"
) {
  if (mode === "set") {
    return selectedVariants;
  }

  if (mode === "add") {
    return uniqueVariants([...currentVariants, ...selectedVariants]);
  }

  const selectedKeys = new Set(selectedVariants.map(normalizeVariantKey));
  return currentVariants.filter((variant) => !selectedKeys.has(normalizeVariantKey(variant)));
}

function parseVariantDetails(value: string | null) {
  return normalizeVariants(value?.split(",") ?? []);
}

function normalizeVariants(variants: string[] | undefined) {
  return uniqueVariants(
    (Array.isArray(variants) ? variants : [])
      .map((variant) => String(variant).trim())
      .filter(Boolean)
  );
}

function uniqueVariants(variants: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const variant of variants) {
    const key = normalizeVariantKey(variant);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(variant);
  }

  return unique;
}

function normalizeVariantKey(variant: string) {
  return variant.toLowerCase().replace(/\s+/g, " ").trim();
}

function hasPricingIdentityChanged(
  current: {
    item_type: string;
    condition_label: string | null;
    variant_details: string | null;
    grader: string | null;
    grade: string | null;
    cert_number: string | null;
    name: string;
    set_name: string | null;
    set_code: string | null;
    card_number: string | null;
    language: string;
  },
  input: UpdateInventoryItemRequest
) {
  return (
    normalizeIdentityValue(current.name) !== normalizeIdentityValue(input.name) ||
    normalizeIdentityValue(current.set_name) !== normalizeIdentityValue(input.setName) ||
    normalizeIdentityValue(current.set_code) !== normalizeIdentityValue(input.setCode) ||
    normalizeIdentityValue(current.card_number) !== normalizeIdentityValue(input.cardNumber) ||
    current.language !== input.language ||
    current.item_type !== input.itemType ||
    normalizeIdentityValue(current.condition_label) !==
      normalizeIdentityValue(input.conditionLabel) ||
    normalizeIdentityValue(current.variant_details) !==
      normalizeIdentityValue(input.variantDetails) ||
    normalizeIdentityValue(current.grader) !== normalizeIdentityValue(input.grader) ||
    normalizeIdentityValue(current.grade) !== normalizeIdentityValue(input.grade) ||
    normalizeIdentityValue(current.cert_number) !== normalizeIdentityValue(input.certNumber)
  );
}

function normalizeIdentityValue(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function clearPricingSourceMatches(database: AppDatabase, itemId: string) {
  database.connection
    .prepare("DELETE FROM item_price_source_matches WHERE owned_item_id = ?")
    .run(itemId);
  database.connection.prepare("DELETE FROM item_price_history WHERE owned_item_id = ?").run(itemId);
}

function uniqueItemIds(itemIds: string[] | undefined) {
  const seen = new Set<string>();

  return (Array.isArray(itemIds) ? itemIds : [])
    .map((itemId) => String(itemId).trim())
    .filter((itemId) => {
      if (!itemId || seen.has(itemId)) {
        return false;
      }

      seen.add(itemId);
      return true;
    });
}

export function listInventoryItems(database: AppDatabase, collectionId: string): InventoryItem[] {
  const rows = database.connection
    .prepare(
      `
        SELECT
          oi.id,
          oi.collection_id,
          oi.card_id,
          oi.item_type,
          oi.quantity,
          oi.condition_label,
          oi.condition_score,
          oi.variant_details,
          oi.grader,
          oi.grade,
          oi.cert_number,
          oi.purchase_price_cents,
          oi.purchase_date,
          oi.value_override_cents,
          imp.price_cents AS market_price_cents,
          imp.source AS market_price_source,
          imp.looked_up_at AS market_price_updated_at,
          imp.confidence AS market_price_confidence,
          imp.matched_name AS market_price_matched_name,
          imp.matched_set_name AS market_price_matched_set_name,
          imp.matched_card_number AS market_price_matched_card_number,
          imp.condition_label AS market_price_condition,
          imp.printing AS market_price_printing,
          imp.raw_payload AS market_price_raw_payload,
          oi.storage_location,
          oi.notes,
          oi.cert_url,
          oi.cert_spec_id,
          oi.cert_category,
          oi.cert_population,
          oi.cert_population_higher,
          oi.cert_estimate_cents,
          oi.cert_lookup_at,
          oi.created_at,
          c.name,
          c.set_name,
          c.set_code,
          c.card_number,
          c.language,
          c.rarity,
          c.release_year,
          c.image_url
        FROM owned_items oi
        INNER JOIN cards c ON c.id = oi.card_id
        LEFT JOIN item_market_prices imp ON imp.owned_item_id = oi.id
        WHERE oi.collection_id = ?
        ORDER BY oi.created_at DESC
      `
    )
    .all(collectionId) as InventoryRow[];

  return rows.map(mapInventoryRow);
}

function mapInventoryRow(row: InventoryRow): InventoryItem {
  return {
    id: row.id,
    collectionId: row.collection_id,
    cardId: row.card_id,
    itemType: row.item_type,
    quantity: row.quantity,
    conditionLabel: row.condition_label,
    conditionScore: row.condition_score,
    variantDetails: row.variant_details,
    grader: row.grader,
    grade: row.grade,
    certNumber: row.cert_number,
    purchasePriceCents: row.purchase_price_cents,
    purchaseDate: row.purchase_date,
    valueOverrideCents: row.value_override_cents,
    marketPriceCents: Number.isFinite(row.market_price_cents) ? row.market_price_cents : null,
    marketPriceSource: row.market_price_source ?? null,
    marketPriceUpdatedAt: row.market_price_updated_at ?? null,
    marketPriceConfidence: row.market_price_confidence ?? null,
    marketPriceMatchedName: row.market_price_matched_name ?? null,
    marketPriceMatchedSetName: row.market_price_matched_set_name ?? null,
    marketPriceMatchedCardNumber: row.market_price_matched_card_number ?? null,
    marketPriceCondition: row.market_price_condition ?? null,
    marketPricePrinting: row.market_price_printing ?? null,
    marketPriceSaleCount: marketPriceSaleCount(row.market_price_raw_payload),
    storageLocation: row.storage_location,
    notes: row.notes,
    certUrl: row.cert_url ?? null,
    certSpecId: row.cert_spec_id ?? null,
    certCategory: row.cert_category ?? null,
    certPopulation: row.cert_population ?? null,
    certPopulationHigher: row.cert_population_higher ?? null,
    certEstimateCents: Number.isFinite(row.cert_estimate_cents) ? row.cert_estimate_cents : null,
    certLookupAt: row.cert_lookup_at ?? null,
    createdAt: row.created_at,
    card: {
      name: row.name,
      setName: row.set_name,
      setCode: row.set_code,
      cardNumber: row.card_number,
      language: row.language,
      rarity: row.rarity,
      releaseYear: row.release_year ?? inferredReleaseYear(row),
      imageUrl: row.image_url
    }
  };
}

function marketPriceSaleCount(rawPayload: string | null) {
  if (!rawPayload) {
    return null;
  }

  type MarketPricePayload = {
    gradeSummary?: {
      count?: unknown;
    };
    selectedCandidate?: {
      saleCount?: unknown;
    };
  };
  let payload: MarketPricePayload;

  try {
    payload = JSON.parse(rawPayload) as MarketPricePayload;
  } catch {
    return null;
  }

  const count = Number(payload.gradeSummary?.count ?? payload.selectedCandidate?.saleCount);

  return Number.isFinite(count) && count >= 0 ? count : null;
}

function summarizeItems(items: InventoryItem[]) {
  return items.reduce(
    (summary, item) => {
      summary.itemCount += 1;
      summary.cardCount += item.quantity;
      summary.estimatedValueCents +=
        (item.valueOverrideCents ?? item.marketPriceCents ?? item.purchasePriceCents ?? 0) *
        item.quantity;
      return summary;
    },
    {
      itemCount: 0,
      cardCount: 0,
      estimatedValueCents: 0
    }
  );
}

function normalizeCreateInput(input: CreateInventoryItemRequest): CreateInventoryItemRequest {
  const name = input.name?.trim();

  if (!name || name.length < 2) {
    throw new Error("Card name must be at least 2 characters.");
  }

  const language = normalizeLanguage(input.language);
  const itemType = normalizeItemType(input.itemType);
  const quantity = Number(input.quantity);
  const conditionScore =
    input.conditionScore === undefined || input.conditionScore === null
      ? undefined
      : Number(input.conditionScore);

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
    throw new Error("Quantity must be between 1 and 999.");
  }

  if (
    conditionScore !== undefined &&
    (!Number.isFinite(conditionScore) || conditionScore < 1 || conditionScore > 10)
  ) {
    throw new Error("Condition score must be between 1 and 10.");
  }

  if (itemType === "graded" && !nullIfBlank(input.grader)) {
    throw new Error("Graded cards need a grader.");
  }

  return {
    ...input,
    name,
    language,
    itemType,
    quantity,
    conditionScore,
    purchasePriceCents: normalizeCents(input.purchasePriceCents),
    valueOverrideCents: normalizeCents(input.valueOverrideCents),
    certEstimateCents: normalizeCents(input.certEstimateCents),
    releaseYear: releaseYearForInput(input) ?? undefined
  };
}

function releaseYearForInput(input: CreateInventoryItemRequest | UpdateInventoryItemRequest) {
  return normalizeReleaseYear(input.releaseYear) ?? inferredReleaseYearFromValues([
    input.certCategory,
    input.setName,
    input.setCode,
    input.name,
    input.variantDetails
  ]);
}

function inferredReleaseYear(row: InventoryRow) {
  return inferredReleaseYearFromValues([
    row.cert_category,
    row.set_name,
    row.set_code,
    row.name,
    row.variant_details
  ]);
}

function inferredReleaseYearFromValues(values: Array<string | null | undefined>) {
  const directYear = values.map(extractYear).find(Boolean);

  if (directYear) {
    return directYear;
  }

  const text = values
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return knownSetReleaseYear(text);
}

function extractYear(value: string | null | undefined) {
  const match = String(value ?? "").match(/\b(19[5-9]\d|20[0-4]\d)\b/);
  return match?.[1] ?? null;
}

function normalizeReleaseYear(value: string | null | undefined) {
  const year = extractYear(value);
  return year ?? null;
}

function knownSetReleaseYear(text: string) {
  const knownSets: Array<[RegExp, string]> = [
    [/\b(base set|base1)\b/, "1999"],
    [/\b(jungle|base2)\b/, "1999"],
    [/\b(fossil|base3)\b/, "1999"],
    [/\b(team rocket|base5)\b/, "2000"],
    [/\b(gym heroes|gym1)\b/, "2000"],
    [/\b(neo destiny|neo4)\b/, "2002"],
    [/\b(expedition|ecard1)\b/, "2002"],
    [/\b(pop series 2|pop2)\b/, "2005"],
    [/\b(evolutions|xy12)\b/, "2016"],
    [/\b(generations|g1)\b/, "2016"],
    [/\b(celestial storm|sm7)\b/, "2018"],
    [/\b(forbidden light|sm6)\b/, "2018"],
    [/\b(hidden fates|sm115)\b/, "2019"],
    [/\b(sm210|hif elite trainer box|hidden fates elite trainer box)\b/, "2019"],
    [/\b(sword shield|sword & shield|swsh1)\b/, "2020"],
    [/\b(25th anniversary collection|s8a)\b/, "2021"],
    [/\b(vmax climax|vmaxクライマックス|s8b)\b/, "2021"],
    [/\b(pokemon go|pokémon go|s10b)\b/, "2022"],
    [/\b(151|sv3\.5|scarlet violet 151|scarlet & violet 151)\b/, "2023"],
    [/\b(phantasmal flames|me2)\b/, "2025"],
    [/\b(mega brave|m1l)\b/, "2025"]
  ];

  return knownSets.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

function normalizeLanguage(language: CardLanguage): CardLanguage {
  return ["en", "ja", "other"].includes(language) ? language : "en";
}

function normalizeItemType(itemType: InventoryItemType): InventoryItemType {
  return itemType === "graded" ? "graded" : "raw";
}

function normalizeCents(value: number | undefined) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const cents = Number(value);

  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error("Money fields must be positive whole cents.");
  }

  return cents;
}

function nullIfBlank(value: string | undefined | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeImageUrl(value: string | undefined | null) {
  const imageUrl = nullIfBlank(value);

  if (!imageUrl) {
    return null;
  }

  if (imageUrl.length > 2048) {
    throw new Error("Image URL is too long.");
  }

  if (
    imageUrl.startsWith("/uploads/card-images/") ||
    imageUrl.startsWith("https://") ||
    imageUrl.startsWith("http://")
  ) {
    return imageUrl;
  }

  throw new Error("Image URL must be a local upload or an HTTP/HTTPS URL.");
}
