import type { InventoryItem, InventoryItemType } from "@collection-tool/shared";

/**
 * "Recently added" is a rolling window, rather than a calendar-month bucket.
 * Keeping the duration here makes the view definition shared by filtering,
 * counts, descriptions, and tests.
 */
export const RECENTLY_ADDED_WINDOW_DAYS = 30;

export const inventoryViews = [
  "all",
  "raw",
  "graded",
  "missing-price",
  "missing-image",
  "recently-added"
] as const;

export type InventoryView = (typeof inventoryViews)[number];

export type InventoryViewDefinition = {
  id: InventoryView;
  label: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
  impliedItemType: InventoryItemType | null;
};

export type InventoryViewCounts = Record<InventoryView, number>;

export type InventoryViewOptions = {
  /** Milliseconds since the Unix epoch. Defaults to Date.now(). */
  referenceTimeMs?: number;
};

export type InventoryItemTypeFilter = InventoryItemType | "all";

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

export const inventoryViewDefinitions: Readonly<Record<InventoryView, InventoryViewDefinition>> = {
  all: {
    id: "all",
    label: "All",
    description: "Every raw and graded inventory row.",
    emptyTitle: "No cards yet.",
    emptyDescription: "Add or import a card to begin this collection.",
    impliedItemType: null
  },
  raw: {
    id: "raw",
    label: "Raw",
    description: "Inventory rows stored as ungraded cards.",
    emptyTitle: "No raw cards yet.",
    emptyDescription: "Add a raw card through search, manual entry, bulk list, or CSV import.",
    impliedItemType: "raw"
  },
  graded: {
    id: "graded",
    label: "Graded",
    description: "Inventory rows stored as graded cards or slabs.",
    emptyTitle: "No graded cards yet.",
    emptyDescription: "Import a certificate or add a graded card manually to track slab details.",
    impliedItemType: "graded"
  },
  "missing-price": {
    id: "missing-price",
    label: "Missing price",
    description:
      "Rows without a saved market price. Manual overrides and purchase prices do not count as market prices.",
    emptyTitle: "Every card has a market price.",
    emptyDescription: "There are no inventory rows waiting for market pricing.",
    impliedItemType: null
  },
  "missing-image": {
    id: "missing-image",
    label: "Missing image",
    description: "Rows whose saved card metadata has no usable image URL.",
    emptyTitle: "Every card has an image.",
    emptyDescription: "There are no inventory rows with missing card artwork.",
    impliedItemType: null
  },
  "recently-added": {
    id: "recently-added",
    label: "Recently added",
    description: `Rows created during the previous ${RECENTLY_ADDED_WINDOW_DAYS} days, based on createdAt. Invalid or future timestamps are excluded.`,
    emptyTitle: "No recent additions.",
    emptyDescription: `No inventory rows were created during the previous ${RECENTLY_ADDED_WINDOW_DAYS} days.`,
    impliedItemType: null
  }
};

export function isInventoryView(value: string): value is InventoryView {
  return inventoryViews.some((view) => view === value);
}

export function getInventoryViewDefinition(view: InventoryView): InventoryViewDefinition {
  return inventoryViewDefinitions[view];
}

export function inventoryItemMatchesView(
  item: InventoryItem,
  view: InventoryView,
  options: InventoryViewOptions = {}
): boolean {
  if (view === "all") {
    return true;
  }

  if (view === "raw" || view === "graded") {
    return item.itemType === view;
  }

  if (view === "missing-price") {
    return item.marketPriceCents === null;
  }

  if (view === "missing-image") {
    return !item.card.imageUrl?.trim();
  }

  const referenceTimeMs = getReferenceTime(options);
  const createdAtMs = Date.parse(item.createdAt);

  return (
    Number.isFinite(createdAtMs) &&
    createdAtMs <= referenceTimeMs &&
    createdAtMs >= getRecentlyAddedCutoffMs(referenceTimeMs)
  );
}

/**
 * Applies only the primary inventory view. Detailed query, language,
 * condition, storage, value, and sort filters should run on this result.
 */
export function applyInventoryView(
  items: readonly InventoryItem[],
  view: InventoryView,
  options: InventoryViewOptions = {}
): InventoryItem[] {
  const normalizedOptions = normalizeOptions(options);
  return items.filter((item) => inventoryItemMatchesView(item, view, normalizedOptions));
}

/** Counts inventory rows, not summed card quantity, for every primary view. */
export function getInventoryViewCounts(
  items: readonly InventoryItem[],
  options: InventoryViewOptions = {}
): InventoryViewCounts {
  const normalizedOptions = normalizeOptions(options);
  const counts = createEmptyInventoryViewCounts();

  for (const item of items) {
    for (const view of inventoryViews) {
      if (inventoryItemMatchesView(item, view, normalizedOptions)) {
        counts[view] += 1;
      }
    }
  }

  return counts;
}

export function getRecentlyAddedCutoffMs(referenceTimeMs = Date.now()): number {
  assertValidReferenceTime(referenceTimeMs);
  return referenceTimeMs - RECENTLY_ADDED_WINDOW_DAYS * DAY_IN_MILLISECONDS;
}

/**
 * Raw and Graded already imply an item type, so the detailed item-type
 * filter must be cleared to avoid redundant or contradictory UI state.
 * Cross-type views preserve the user's optional detailed type filter.
 */
export function reconcileItemTypeFilterForInventoryView(
  view: InventoryView,
  itemTypeFilter: InventoryItemTypeFilter
): InventoryItemTypeFilter {
  return inventoryViewDefinitions[view].impliedItemType ? "all" : itemTypeFilter;
}

function normalizeOptions(options: InventoryViewOptions): Required<InventoryViewOptions> {
  return {
    referenceTimeMs: getReferenceTime(options)
  };
}

function getReferenceTime(options: InventoryViewOptions): number {
  const referenceTimeMs = options.referenceTimeMs ?? Date.now();
  assertValidReferenceTime(referenceTimeMs);
  return referenceTimeMs;
}

function assertValidReferenceTime(referenceTimeMs: number) {
  if (!Number.isFinite(referenceTimeMs)) {
    throw new RangeError("referenceTimeMs must be a finite Unix timestamp in milliseconds.");
  }
}

function createEmptyInventoryViewCounts(): InventoryViewCounts {
  return {
    all: 0,
    raw: 0,
    graded: 0,
    "missing-price": 0,
    "missing-image": 0,
    "recently-added": 0
  };
}
