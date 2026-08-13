import type {
  BulkPriceQueueStatus,
  InventoryItem,
  NeedsAttentionCategory,
  NeedsAttentionIssue,
  NeedsAttentionResponse
} from "@collection-tool/shared";
import type { FastifyInstance } from "fastify";
import { getAuthContext, getCollectionRole } from "../auth.js";
import type { AppDatabase } from "../db.js";
import { groupInventoryDuplicates } from "../inventoryDuplicateIdentity.js";
import { listInventoryItems } from "./inventoryRoutes.js";

const STALE_PRICE_DAYS = 30;
const ISSUE_GROUP_LIMIT_PER_CATEGORY = 50;
const ITEM_LIMIT_PER_GROUP = 25;
const CATEGORY_ORDER: NeedsAttentionCategory[] = [
  "failed-work",
  "duplicate-cert",
  "possible-duplicate",
  "missing-price",
  "stale-price",
  "low-confidence",
  "missing-image",
  "incomplete-metadata"
];

type AttentionQueueRow = {
  owned_item_id: string;
  status: Extract<BulkPriceQueueStatus, "needs-review" | "failed">;
  message: string | null;
  updated_at: string;
};

export async function registerNeedsAttentionRoutes(
  app: FastifyInstance,
  database: AppDatabase
) {
  app.get("/api/collections/:collectionId/attention", async (request, reply) => {
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

    return buildNeedsAttentionResponse(database, collectionId);
  });
}

export function buildNeedsAttentionResponse(
  database: AppDatabase,
  collectionId: string,
  now = new Date()
): NeedsAttentionResponse {
  const items = listInventoryItems(database, collectionId);
  const ignoredItemIds = new Set(
    (database.connection
      .prepare(
        `
          SELECT ignored.owned_item_id
          FROM item_price_refresh_ignores ignored
          JOIN owned_items item ON item.id = ignored.owned_item_id
          WHERE item.collection_id = ?
        `
      )
      .all(collectionId) as { owned_item_id: string }[]).map((row) => row.owned_item_id)
  );
  const queueRows = latestAttentionQueueRows(database, collectionId);
  const issues = classifyNeedsAttention(items, ignoredItemIds, queueRows, now);
  const issuesByCategory = new Map(
    CATEGORY_ORDER.map((category) => [
      category,
      issues.filter((issue) => issue.category === category)
    ])
  );
  const returnedIssues = CATEGORY_ORDER.flatMap((category) =>
    (issuesByCategory.get(category) ?? []).slice(0, ISSUE_GROUP_LIMIT_PER_CATEGORY)
  ).map((issue) => ({
    ...issue,
    items: issue.items.slice(0, ITEM_LIMIT_PER_GROUP),
    itemsTruncated: issue.items.length > ITEM_LIMIT_PER_GROUP
  }));
  const allItemIds = new Set(issues.flatMap((issue) => issue.items.map((item) => item.id)));
  const returnedItemIds = new Set(
    returnedIssues.flatMap((issue) => issue.items.map((item) => item.id))
  );

  return {
    collectionId,
    generatedAt: now.toISOString(),
    thresholds: { stalePriceDays: STALE_PRICE_DAYS },
    summary: {
      totalGroupCount: issues.length,
      attentionItemCount: allItemIds.size,
      categories: CATEGORY_ORDER.map((category) => {
        const matching = issuesByCategory.get(category) ?? [];
        return {
          category,
          groupCount: matching.length,
          itemCount: new Set(matching.flatMap((issue) => issue.items.map((item) => item.id))).size,
          returnedGroupCount: Math.min(matching.length, ISSUE_GROUP_LIMIT_PER_CATEGORY),
          truncated: matching.length > ISSUE_GROUP_LIMIT_PER_CATEGORY
        };
      })
    },
    results: {
      issues: returnedIssues,
      returnedGroupCount: returnedIssues.length,
      returnedItemCount: returnedItemIds.size,
      truncated:
        returnedIssues.length < issues.length || returnedIssues.some((issue) => issue.itemsTruncated),
      limitPerCategory: ISSUE_GROUP_LIMIT_PER_CATEGORY,
      itemLimitPerGroup: ITEM_LIMIT_PER_GROUP
    },
    sources: {
      inventory: { available: true },
      pricingQueue: { available: true },
      importHistory: {
        available: false,
        reason: "No persisted server-side CSV import failure evidence is currently available."
      }
    }
  };
}

function classifyNeedsAttention(
  items: InventoryItem[],
  ignoredItemIds: Set<string>,
  queueRows: AttentionQueueRow[],
  now: Date
) {
  const issues: NeedsAttentionIssue[] = [];
  const itemById = new Map(items.map((item) => [item.id, item]));
  const staleCutoff = now.getTime() - STALE_PRICE_DAYS * 24 * 60 * 60 * 1_000;

  for (const row of queueRows) {
    const item = itemById.get(row.owned_item_id);
    if (!item) continue;
    issues.push({
      id: `failed-work:${item.id}`,
      category: "failed-work",
      title: row.status === "failed" ? "Pricing refresh failed" : "Pricing match needs review",
      reasons: [row.message || (row.status === "failed" ? "The latest pricing attempt failed." : "The latest pricing attempt needs a manual choice.")],
      items: [item],
      totalItemCount: 1,
      itemsTruncated: false,
      work: {
        kind: "pricing",
        status: row.status,
        message: row.message,
        updatedAt: row.updated_at
      }
    });
  }

  for (const group of groupInventoryDuplicates(items)) {
    const isCertMatch = group.kind === "cert-number";
    issues.push({
      id: isCertMatch
        ? `duplicate-cert:${group.key}`
        : `possible-duplicate:${stableIssueKey(group.key)}`,
      category: isCertMatch ? "duplicate-cert" : "possible-duplicate",
      title: isCertMatch
        ? `Cert ${group.items[0].certNumber} appears ${group.items.length} times`
        : `${group.items[0].card.name} has ${group.items.length} matching rows`,
      reasons: group.reasons.map((reason) => reason.message),
      items: group.items,
      totalItemCount: group.items.length,
      itemsTruncated: false,
      duplicateMatch: { kind: group.kind, reasons: group.reasons },
      work: null
    });
  }

  for (const item of items) {
    if (!ignoredItemIds.has(item.id)) {
      if (item.marketPriceCents === null) {
        issues.push(singleItemIssue("missing-price", item, "No market price", "No saved market price is available."));
      } else {
        const updatedAt = item.marketPriceUpdatedAt ? Date.parse(item.marketPriceUpdatedAt) : Number.NaN;
        if (!Number.isFinite(updatedAt) || updatedAt <= staleCutoff) {
          issues.push(singleItemIssue(
            "stale-price",
            item,
            "Market price is stale",
            Number.isFinite(updatedAt)
              ? `The saved market price is at least ${STALE_PRICE_DAYS} days old.`
              : "The saved market price has no usable refresh timestamp."
          ));
        }
        if (item.marketPriceConfidence === "possible") {
          issues.push(singleItemIssue("low-confidence", item, "Price match needs confirmation", "The saved price was based on a possible-confidence match."));
        }
      }
    }

    if (!item.card.imageUrl?.trim()) {
      issues.push(singleItemIssue("missing-image", item, "Missing card image", "No card image is saved."));
    }

    const metadataReasons = incompleteMetadataReasons(item);
    if (metadataReasons.length > 0) {
      issues.push({
        id: `incomplete-metadata:${item.id}`,
        category: "incomplete-metadata",
        title: "Incomplete card metadata",
        reasons: metadataReasons,
        items: [item],
        totalItemCount: 1,
        itemsTruncated: false,
        work: null
      });
    }
  }

  return issues.sort((left, right) => {
    const category = CATEGORY_ORDER.indexOf(left.category) - CATEGORY_ORDER.indexOf(right.category);
    return category || left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
  });
}

function latestAttentionQueueRows(database: AppDatabase, collectionId: string) {
  return database.connection
    .prepare(
      `
        SELECT queue.owned_item_id, queue.status, queue.message, queue.updated_at
        FROM bulk_price_queue queue
        WHERE queue.collection_id = ?
          AND queue.status IN ('needs-review', 'failed')
          AND queue.rowid = (
            SELECT candidate.rowid
            FROM bulk_price_queue candidate
            WHERE candidate.collection_id = queue.collection_id
              AND candidate.owned_item_id = queue.owned_item_id
            ORDER BY julianday(candidate.updated_at) DESC, candidate.rowid DESC
            LIMIT 1
          )
        ORDER BY julianday(queue.updated_at) DESC, queue.rowid DESC
      `
    )
    .all(collectionId) as AttentionQueueRow[];
}

function singleItemIssue(
  category: NeedsAttentionCategory,
  item: InventoryItem,
  title: string,
  reason: string
): NeedsAttentionIssue {
  return {
    id: `${category}:${item.id}`,
    category,
    title,
    reasons: [reason],
    items: [item],
    totalItemCount: 1,
    itemsTruncated: false,
    work: null
  };
}

function incompleteMetadataReasons(item: InventoryItem) {
  const reasons: string[] = [];
  if (!item.card.cardNumber?.trim()) reasons.push("Card number is missing.");
  if (!item.card.setName?.trim() && !item.card.setCode?.trim()) reasons.push("Set name and set code are both missing.");
  if (item.itemType === "graded") {
    if (!item.grader?.trim()) reasons.push("Grader is missing.");
    if (!item.grade?.trim()) reasons.push("Grade is missing.");
    if (!item.certNumber?.trim()) reasons.push("Certification number is missing.");
  }
  return reasons;
}

function stableIssueKey(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
