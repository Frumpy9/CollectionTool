import { randomUUID } from "node:crypto";
import type {
  CardLanguage,
  CreateInventoryItemRequest,
  InventoryMarketPriceSource,
  InventoryItem,
  InventoryItemType,
  MarketPriceConfidence,
  UpdateInventoryItemRequest,
  UpdateInventoryItemImageRequest
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
    const item = updateInventoryItem(database, collectionId, itemId, input);

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
            image_url
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
  input: UpdateInventoryItemRequest
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
      imageUrl: row.image_url
    }
  };
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
    certEstimateCents: normalizeCents(input.certEstimateCents)
  };
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
