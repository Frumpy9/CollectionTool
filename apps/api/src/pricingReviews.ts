import type {
  InventoryItem,
  PricingCandidate,
  PricingReviewCandidate,
  PricingReviewComparison,
  PricingReviewEntry,
  PricingReviewsResponse
} from "@collection-tool/shared";
import type { AppDatabase } from "./db.js";

const pricingSource = "pokemonpricetracker" as const;

type ReviewRow = {
  owned_item_id: string;
  status: "open" | "resolved" | null;
  message: string | null;
  candidates_json: string | null;
  review_updated_at: string | null;
  source_card_id: string | null;
  source_variant_id: string | null;
  is_pinned: number | null;
  match_updated_at: string | null;
};

export type PricingSourceMatch = {
  sourceCardId: string;
  sourceVariantId: string;
  matchKind: "automatic" | "manual";
  confidence: "exact" | "strong" | "possible";
  isPinned: boolean;
};

export function saveOpenPricingReview(
  database: AppDatabase,
  itemId: string,
  candidates: PricingCandidate[],
  message: string
) {
  database.connection
    .prepare(
      `
        INSERT INTO item_price_match_reviews (
          owned_item_id,
          source,
          status,
          message,
          candidates_json,
          created_at,
          updated_at,
          resolved_at,
          resolved_by_user_id
        )
        VALUES (?, ?, 'open', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, NULL)
        ON CONFLICT(owned_item_id, source) DO UPDATE SET
          status = 'open',
          message = excluded.message,
          candidates_json = excluded.candidates_json,
          updated_at = CURRENT_TIMESTAMP,
          resolved_at = NULL,
          resolved_by_user_id = NULL
      `
    )
    .run(
      itemId,
      pricingSource,
      cleanMessage(message),
      JSON.stringify(sanitizeCandidates(candidates))
    );
}

export function invalidatePricingReviewForIdentityChange(
  database: AppDatabase,
  itemId: string
) {
  const needsStaleReview = Boolean(
    database.connection
      .prepare(
        `
          SELECT 1
          FROM item_price_source_matches
          WHERE owned_item_id = ? AND is_pinned = 1
          UNION ALL
          SELECT 1
          FROM item_price_match_reviews
          WHERE owned_item_id = ? AND status = 'open'
          LIMIT 1
        `
      )
      .get(itemId, itemId)
  );

  database.connection
    .prepare("DELETE FROM item_price_source_matches WHERE owned_item_id = ?")
    .run(itemId);
  database.connection.prepare("DELETE FROM item_price_history WHERE owned_item_id = ?").run(itemId);
  database.connection
    .prepare("DELETE FROM item_market_price_snapshots WHERE owned_item_id = ?")
    .run(itemId);
  if (needsStaleReview) {
    saveOpenPricingReview(
      database,
      itemId,
      [],
      "Card details changed. Refresh pricing to review matches for the updated card."
    );
  }
}

export function resolvePricingReview(
  database: AppDatabase,
  itemId: string,
  userId: string | null
) {
  database.connection
    .prepare(
      `
        UPDATE item_price_match_reviews
        SET
          status = 'resolved',
          message = ?,
          resolved_at = CURRENT_TIMESTAMP,
          resolved_by_user_id = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE owned_item_id = ? AND source = ?
      `
    )
    .run(
      userId ? "User confirmed this pricing match." : "Pricing refresh resolved this match.",
      userId,
      itemId,
      pricingSource
    );
}

export function unpinPricingSourceMatch(database: AppDatabase, itemId: string) {
  database.connection
    .prepare(
      `
        UPDATE item_price_source_matches
        SET
          is_pinned = 0,
          match_kind = 'automatic',
          confirmed_by_user_id = NULL,
          confirmed_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE owned_item_id = ? AND source = ?
      `
    )
    .run(itemId, pricingSource);

  database.connection
    .prepare("DELETE FROM item_price_match_reviews WHERE owned_item_id = ? AND source = ?")
    .run(itemId, pricingSource);
}

export function getPricingSourceMatch(
  database: AppDatabase,
  itemId: string
): PricingSourceMatch | null {
  const row = database.connection
    .prepare(
      `
        SELECT source_card_id, source_variant_id, match_kind, confidence, is_pinned
        FROM item_price_source_matches
        WHERE owned_item_id = ? AND source = ?
      `
    )
    .get(itemId, pricingSource) as
    | {
        source_card_id: string;
        source_variant_id: string;
        match_kind: "automatic" | "manual";
        confidence: "exact" | "strong" | "possible";
        is_pinned: number;
      }
    | undefined;

  return row
    ? {
        sourceCardId: row.source_card_id,
        sourceVariantId: row.source_variant_id,
        matchKind: row.match_kind,
        confidence: row.confidence,
        isPinned: row.is_pinned === 1
      }
    : null;
}

export function findPersistedReviewCandidate(
  database: AppDatabase,
  itemId: string,
  sourceCardId: string,
  sourceVariantId: string
) {
  const row = database.connection
    .prepare(
      `
        SELECT candidates_json
        FROM item_price_match_reviews
        WHERE owned_item_id = ? AND source = ? AND status = 'open'
      `
    )
    .get(itemId, pricingSource) as { candidates_json: string } | undefined;

  return (
    parseCandidates(row?.candidates_json ?? "[]").find(
      (candidate) =>
        candidate.sourceCardId === sourceCardId &&
        candidate.sourceVariantId === sourceVariantId
    ) ?? null
  );
}

export function listPricingReviews(
  database: AppDatabase,
  collectionId: string,
  items: InventoryItem[]
): PricingReviewsResponse {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const rows = database.connection
    .prepare(
      `
        SELECT
          oi.id AS owned_item_id,
          review.status,
          review.message,
          review.candidates_json,
          review.updated_at AS review_updated_at,
          match.source_card_id,
          match.source_variant_id,
          match.is_pinned,
          match.updated_at AS match_updated_at
        FROM owned_items oi
        LEFT JOIN item_price_match_reviews review
          ON review.owned_item_id = oi.id AND review.source = ?
        LEFT JOIN item_price_source_matches match
          ON match.owned_item_id = oi.id AND match.source = ?
        WHERE oi.collection_id = ?
          AND (review.status = 'open' OR match.is_pinned = 1)
        ORDER BY
          CASE WHEN review.status = 'open' THEN 0 ELSE 1 END,
          COALESCE(review.updated_at, match.updated_at) DESC
      `
    )
    .all(pricingSource, pricingSource, collectionId) as ReviewRow[];

  const reviews = rows.flatMap((row) => {
    const item = itemsById.get(row.owned_item_id);
    return item ? [reviewEntry(item, row)] : [];
  });

  return {
    reviews,
    summary: {
      needsReview: reviews.filter((review) => review.status === "needs-review").length,
      pinned: reviews.filter((review) => review.isPinned).length
    },
    message:
      reviews.length > 0
        ? "Loaded pricing matches that need review or are pinned."
        : "No pricing matches need review and no matches are pinned."
  };
}

function reviewEntry(item: InventoryItem, row: ReviewRow): PricingReviewEntry {
  const pinnedSourceCardId = row.is_pinned === 1 ? row.source_card_id : null;
  const pinnedSourceVariantId = row.is_pinned === 1 ? row.source_variant_id : null;
  const status = row.status === "open" ? "needs-review" : "pinned";
  let candidates = parseCandidates(row.candidates_json ?? "[]");

  if (status === "pinned" && candidates.length === 0) {
    const saved = savedMarketCandidate(item, pinnedSourceCardId, pinnedSourceVariantId);
    candidates = saved ? [saved] : [];
  }

  return {
    item,
    source: pricingSource,
    status,
    isPinned: row.is_pinned === 1,
    message:
      status === "pinned"
        ? "User-confirmed match. Automatic refreshes will stay on this source card and variant."
        : row.message ?? "Review the available pricing matches.",
    candidates: candidates.map((candidate) => ({
      ...candidate,
      comparisons: comparePricingCandidate(item, candidate),
      isPinned:
        candidate.sourceCardId === pinnedSourceCardId &&
        candidate.sourceVariantId === pinnedSourceVariantId
    })),
    pinnedSourceCardId,
    pinnedSourceVariantId,
    updatedAt: row.review_updated_at ?? row.match_updated_at ?? item.createdAt
  };
}

export function comparePricingCandidate(
  item: InventoryItem,
  candidate: PricingCandidate
): PricingReviewComparison[] {
  const setValue = [item.card.setName, item.card.setCode].filter(Boolean).join(" / ") || null;
  const conditionValue =
    item.itemType === "graded"
      ? [item.grader, item.grade].filter(Boolean).join(" ") || null
      : item.conditionLabel;
  const candidateCondition =
    candidate.priceKind === "graded"
      ? [candidate.grader, candidate.grade].filter(Boolean).join(" ") || null
      : candidate.condition;

  return [
    comparison("set", setValue, candidate.matchedSetName, (left, right) =>
      [item.card.setName, item.card.setCode].some(
        (value) => value && normalize(value) === normalize(right)
      )
    ),
    comparison("card-number", item.card.cardNumber, candidate.matchedCardNumber),
    comparison("variant", item.variantDetails, candidate.printing),
    comparison("language", languageLabel(item.card.language), candidate.language, languageMatches),
    comparison("condition", conditionValue, candidateCondition)
  ];
}

function comparison(
  field: PricingReviewComparison["field"],
  inventoryValue: string | null,
  candidateValue: string | null,
  matches: (left: string, right: string) => boolean = (left, right) =>
    normalize(left) === normalize(right)
): PricingReviewComparison {
  const left = cleanOptionalText(inventoryValue);
  const right = cleanOptionalText(candidateValue);
  return {
    field,
    inventoryValue: left,
    candidateValue: right,
    status: !left || !right ? "unknown" : matches(left, right) ? "match" : "disagreement"
  };
}

function sanitizeCandidates(candidates: PricingCandidate[]) {
  return candidates.slice(0, 5).map((candidate) => ({
    sourceCardId: cleanRequiredText(candidate.sourceCardId),
    sourceVariantId: cleanRequiredText(candidate.sourceVariantId),
    matchedName: cleanRequiredText(candidate.matchedName),
    matchedSetName: cleanOptionalText(candidate.matchedSetName),
    matchedCardNumber: cleanOptionalText(candidate.matchedCardNumber),
    condition: cleanOptionalText(candidate.condition),
    printing: cleanOptionalText(candidate.printing),
    language: cleanOptionalText(candidate.language),
    priceCents: Math.max(0, Math.round(candidate.priceCents)),
    currency: "USD" as const,
    confidence: candidate.confidence,
    score: Number.isFinite(candidate.score) ? candidate.score : 0,
    source: pricingSource,
    priceKind: candidate.priceKind,
    grader: cleanOptionalText(candidate.grader),
    grade: cleanOptionalText(candidate.grade),
    gradeBucket: cleanOptionalText(candidate.gradeBucket),
    saleCount: finiteNullableNumber(candidate.saleCount),
    averagePriceCents: finiteNullableNumber(candidate.averagePriceCents),
    medianPriceCents: finiteNullableNumber(candidate.medianPriceCents),
    minPriceCents: finiteNullableNumber(candidate.minPriceCents),
    maxPriceCents: finiteNullableNumber(candidate.maxPriceCents),
    marketTrend: cleanOptionalText(candidate.marketTrend),
    historyAvailable: candidate.historyAvailable === true
  }));
}

function parseCandidates(json: string): PricingCandidate[] {
  try {
    const value = JSON.parse(json) as unknown;
    return Array.isArray(value)
      ? value
          .filter(isPricingCandidate)
          .slice(0, 5)
          .map((candidate) => sanitizeCandidates([candidate])[0])
      : [];
  } catch {
    return [];
  }
}

function isPricingCandidate(value: unknown): value is PricingCandidate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PricingCandidate>;
  return (
    typeof candidate.sourceCardId === "string" &&
    typeof candidate.sourceVariantId === "string" &&
    typeof candidate.matchedName === "string" &&
    candidate.source === pricingSource &&
    (candidate.priceKind === "raw" || candidate.priceKind === "graded") &&
    Number.isFinite(candidate.priceCents) &&
    candidate.currency === "USD" &&
    (candidate.confidence === "exact" ||
      candidate.confidence === "strong" ||
      candidate.confidence === "possible")
  );
}

function savedMarketCandidate(
  item: InventoryItem,
  sourceCardId: string | null,
  sourceVariantId: string | null
): PricingCandidate | null {
  if (!sourceCardId || sourceVariantId === null || item.marketPriceCents === null) return null;
  return {
    sourceCardId,
    sourceVariantId,
    matchedName: item.marketPriceMatchedName ?? item.card.name,
    matchedSetName: item.marketPriceMatchedSetName,
    matchedCardNumber: item.marketPriceMatchedCardNumber,
    condition: item.marketPriceCondition,
    printing: item.marketPricePrinting,
    language: languageLabel(item.card.language),
    priceCents: item.marketPriceCents,
    currency: "USD",
    confidence: item.marketPriceConfidence ?? "possible",
    score: 0,
    source: pricingSource,
    priceKind: item.itemType,
    grader: item.itemType === "graded" ? item.grader : null,
    grade: item.itemType === "graded" ? item.grade : null,
    gradeBucket: null,
    saleCount: item.marketPriceSaleCount,
    averagePriceCents: null,
    medianPriceCents: null,
    minPriceCents: null,
    maxPriceCents: null,
    marketTrend: null,
    historyAvailable: item.marketPriceSnapshotCount > 0
  };
}

function languageLabel(language: InventoryItem["card"]["language"]) {
  return language === "en" ? "English" : language === "ja" ? "Japanese" : "Other";
}

function languageMatches(left: string, right: string) {
  return normalizeLanguage(left) === normalizeLanguage(right);
}

function normalizeLanguage(value: string) {
  const language = normalize(value);
  if (["en", "eng", "english"].includes(language)) return "english";
  if (["ja", "jp", "jpn", "japanese"].includes(language)) return "japanese";
  return language;
}

function cleanMessage(value: string) {
  return cleanRequiredText(value).slice(0, 500);
}

function cleanRequiredText(value: unknown) {
  return String(value ?? "").trim().slice(0, 500);
}

function cleanOptionalText(value: unknown) {
  const text = cleanRequiredText(value);
  return text || null;
}

function finiteNullableNumber(value: number | null) {
  return Number.isFinite(value) ? Number(value) : null;
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "").replace(/^0+(?=\d)/, "");
}
