import { randomUUID } from "node:crypto";
import type { CollectionValueHistoryReason } from "@collection-tool/shared";
import type { AppDatabase } from "./db.js";

type CollectionValue = {
  valueCents: number;
  itemQuantity: number;
};

export function recordCollectionValueSnapshot(
  database: AppDatabase,
  collectionId: string,
  reason: CollectionValueHistoryReason,
  refreshedItemCount = 0,
  capturedAt = new Date().toISOString()
) {
  const current = getCollectionValue(database, collectionId);

  if (!current) {
    return null;
  }

  const latest = database.connection
    .prepare(
      `
        SELECT value_cents, item_quantity
        FROM collection_value_snapshots
        WHERE collection_id = ?
        ORDER BY julianday(captured_at) DESC, created_at DESC, rowid DESC
        LIMIT 1
      `
    )
    .get(collectionId) as
    | { value_cents: number; item_quantity: number }
    | undefined;

  if (
    latest?.value_cents === current.valueCents &&
    latest.item_quantity === current.itemQuantity
  ) {
    return null;
  }

  const id = randomUUID();

  database.connection
    .prepare(
      `
        INSERT INTO collection_value_snapshots (
          id,
          collection_id,
          value_cents,
          item_quantity,
          reason,
          refreshed_item_count,
          captured_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      id,
      collectionId,
      current.valueCents,
      current.itemQuantity,
      reason,
      Math.max(0, refreshedItemCount),
      capturedAt
    );

  return {
    id,
    ...current,
    reason,
    refreshedItemCount: Math.max(0, refreshedItemCount),
    capturedAt
  };
}

export function recordCollectionValueSnapshotForItem(
  database: AppDatabase,
  itemId: string,
  reason: CollectionValueHistoryReason,
  refreshedItemCount = 0,
  capturedAt = new Date().toISOString()
) {
  const row = database.connection
    .prepare("SELECT collection_id FROM owned_items WHERE id = ?")
    .get(itemId) as { collection_id: string } | undefined;

  return row
    ? recordCollectionValueSnapshot(
        database,
        row.collection_id,
        reason,
        refreshedItemCount,
        capturedAt
      )
    : null;
}

function getCollectionValue(
  database: AppDatabase,
  collectionId: string
): CollectionValue | null {
  const row = database.connection
    .prepare(
      `
        SELECT
          collections.id,
          COALESCE(SUM(
            COALESCE(
              owned_items.value_override_cents,
              item_market_prices.price_cents,
              owned_items.purchase_price_cents,
              0
            ) * owned_items.quantity
          ), 0) AS value_cents,
          COALESCE(SUM(owned_items.quantity), 0) AS item_quantity
        FROM collections
        LEFT JOIN owned_items ON owned_items.collection_id = collections.id
        LEFT JOIN item_market_prices ON item_market_prices.owned_item_id = owned_items.id
        WHERE collections.id = ?
        GROUP BY collections.id
      `
    )
    .get(collectionId) as
    | { id: string; value_cents: number; item_quantity: number }
    | undefined;

  return row
    ? {
        valueCents: row.value_cents,
        itemQuantity: row.item_quantity
      }
    : null;
}
