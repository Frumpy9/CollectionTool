export type HealthResponse = {
  status: "ok";
  service: "api";
  timestamp: string;
  database: {
    path: string;
    migrationsApplied: number;
  };
};

export type CollectionSummary = {
  id: string;
  name: string;
  role: "owner" | "admin" | "editor" | "viewer";
  cardCount: number;
  estimatedValueCents: number;
};

export type AuthUser = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  systemRole: "admin" | "user";
};

export type BootstrapStatusResponse = {
  needsBootstrap: boolean;
};

export type AuthMeResponse = {
  user: AuthUser | null;
  collections: CollectionSummary[];
};

export type CollectionInvite = {
  id: string;
  collectionId: string;
  email: string;
  role: "admin" | "editor" | "viewer";
  token: string;
  expiresAt: string;
};

export type CardLanguage = "en" | "ja" | "other";

export type InventoryItemType = "raw" | "graded";

export type MarketPriceConfidence = "exact" | "strong" | "possible";

export type InventoryMarketPriceSource = "justtcg" | "pokemonpricetracker";

export type InventoryItem = {
  id: string;
  collectionId: string;
  cardId: string;
  itemType: InventoryItemType;
  quantity: number;
  conditionLabel: string | null;
  conditionScore: number | null;
  variantDetails: string | null;
  grader: string | null;
  grade: string | null;
  certNumber: string | null;
  purchasePriceCents: number | null;
  purchaseDate: string | null;
  valueOverrideCents: number | null;
  marketPriceCents: number | null;
  marketPriceSource: InventoryMarketPriceSource | null;
  marketPriceUpdatedAt: string | null;
  marketPriceConfidence: MarketPriceConfidence | null;
  marketPriceMatchedName: string | null;
  marketPriceMatchedSetName: string | null;
  marketPriceMatchedCardNumber: string | null;
  marketPriceCondition: string | null;
  marketPricePrinting: string | null;
  marketPriceSaleCount: number | null;
  storageLocation: string | null;
  notes: string | null;
  certUrl: string | null;
  certSpecId: string | null;
  certCategory: string | null;
  certPopulation: string | null;
  certPopulationHigher: string | null;
  certEstimateCents: number | null;
  certLookupAt: string | null;
  createdAt: string;
  card: {
    name: string;
    setName: string | null;
    setCode: string | null;
    cardNumber: string | null;
    language: CardLanguage;
    rarity: string | null;
    releaseYear: string | null;
    imageUrl: string | null;
  };
};

export type InventoryListResponse = {
  items: InventoryItem[];
  summary: {
    itemCount: number;
    cardCount: number;
    estimatedValueCents: number;
  };
};

export type BackupSqliteResponse = {
  ok: true;
  fileName: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
};

export type CreateInventoryItemRequest = {
  name: string;
  setName?: string;
  setCode?: string;
  cardNumber?: string;
  language: CardLanguage;
  rarity?: string;
  releaseYear?: string;
  imageUrl?: string;
  itemType: InventoryItemType;
  quantity: number;
  conditionLabel?: string;
  conditionScore?: number;
  variantDetails?: string;
  grader?: string;
  grade?: string;
  certNumber?: string;
  purchasePriceCents?: number;
  purchaseDate?: string;
  valueOverrideCents?: number;
  storageLocation?: string;
  notes?: string;
  certUrl?: string;
  certSpecId?: string;
  certCategory?: string;
  certPopulation?: string;
  certPopulationHigher?: string;
  certEstimateCents?: number;
  certLookupAt?: string;
};

export type UpdateInventoryItemRequest = CreateInventoryItemRequest;

export type UpdateInventoryItemImageRequest = {
  imageUrl: string;
};

export type BulkVariantEditMode = "set" | "add" | "remove";

export type BulkUpdateInventoryVariantsRequest = {
  itemIds: string[];
  mode: BulkVariantEditMode;
  variants: string[];
  clearMarketPrices?: boolean;
};

export type BulkUpdateInventoryVariantsResponse = {
  items: InventoryItem[];
  updatedItemIds: string[];
  notFoundItemIds: string[];
  clearedMarketPriceItemIds: string[];
};

export type BulkDeleteInventoryItemsRequest = {
  itemIds: string[];
};

export type BulkDeleteInventoryItemsResponse = {
  deletedItemIds: string[];
  notFoundItemIds: string[];
};

export type PricingCandidate = {
  sourceCardId: string;
  sourceVariantId: string;
  matchedName: string;
  matchedSetName: string | null;
  matchedCardNumber: string | null;
  condition: string | null;
  printing: string | null;
  language: string | null;
  priceCents: number;
  currency: "USD";
  confidence: MarketPriceConfidence;
  score: number;
  source: InventoryMarketPriceSource;
  priceKind: InventoryItemType;
  grader: string | null;
  grade: string | null;
  gradeBucket: string | null;
  saleCount: number | null;
  averagePriceCents: number | null;
  medianPriceCents: number | null;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  marketTrend: string | null;
  historyAvailable: boolean;
};

export type PokemonPriceTrackerPricingCandidate = PricingCandidate & {
  source: "pokemonpricetracker";
};

export type RefreshPokemonPriceTrackerPricingResponse = {
  status: "saved" | "needs-review" | "queued";
  item: InventoryItem | null;
  candidates: PokemonPriceTrackerPricingCandidate[];
  message: string;
  queue?: BulkPriceQueueResponse;
};

export type RefreshPricingResponse = {
  status: "saved" | "needs-review" | "queued";
  item: InventoryItem | null;
  candidates: PricingCandidate[];
  message: string;
  queue?: BulkPriceQueueResponse;
};

export type SelectPokemonPriceTrackerPricingRequest = {
  sourceCardId: string;
  sourceVariantId: string;
  candidate?: PokemonPriceTrackerPricingCandidate;
};

export type SelectPricingRequest = {
  sourceCardId: string;
  sourceVariantId: string;
  source?: InventoryMarketPriceSource;
  candidate?: PricingCandidate;
};

export type PricingHistoryPoint = {
  date: string;
  priceCents: number;
  source: InventoryMarketPriceSource;
  priceKind: InventoryItemType;
};

export type PricingHistoryResponse = {
  itemId: string;
  source: InventoryMarketPriceSource;
  days: number;
  points: PricingHistoryPoint[];
  cached: boolean;
  message: string;
};

export type BulkPriceQueueMode = "auto" | "raw" | "graded";

export type BulkPriceQueueStatus =
  | "queued"
  | "running"
  | "saved"
  | "needs-review"
  | "skipped"
  | "rate-limited"
  | "failed"
  | "cancelled";

export type BulkPriceQueueJob = {
  id: string;
  collectionId: string;
  itemId: string;
  mode: BulkPriceQueueMode;
  status: BulkPriceQueueStatus;
  attempts: number;
  includeExisting: boolean;
  message: string | null;
  nextAttemptAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  item: InventoryItem | null;
};

export type EnqueueBulkPriceRefreshRequest = {
  itemIds: string[];
  mode: BulkPriceQueueMode;
  includeExisting?: boolean;
};

export type BulkPriceQueueResponse = {
  jobs: BulkPriceQueueJob[];
  summary: {
    total: number;
    queued: number;
    running: number;
    saved: number;
    needsReview: number;
    skipped: number;
    rateLimited: number;
    failed: number;
    cancelled: number;
  };
  message: string;
};

export type CardImageUploadRequest = {
  collectionId: string;
  fileName: string;
  mimeType: string;
  dataBase64: string;
};

export type CardImageUploadResponse = {
  imageUrl: string;
};

export type CardLookupRequest = {
  query: string;
  language?: CardLanguage | "all";
};

export type CardLookupCandidate = {
  id: string;
  source: "pokemontcg" | "tcgdex" | "japanese-cache" | "parsed";
  sourceId: string;
  confidence: "exact" | "strong" | "possible";
  name: string;
  setName: string | null;
  setCode: string | null;
  cardNumber: string | null;
  language: CardLanguage;
  rarity: string | null;
  imageUrl: string | null;
  item: CreateInventoryItemRequest;
  score: number;
};

export type CardLookupResponse = {
  query: string;
  parsed: {
    kind: "set-number" | "number" | "name";
    setCode: string | null;
    cardNumber: string | null;
    printedNumber: string | null;
    setTotal: string | null;
    localId: string | null;
  };
  candidates: CardLookupCandidate[];
};

export type UpsertJapaneseCardCacheRequest = {
  source?: string;
  sourceId?: string;
  setCode: string;
  setName?: string;
  cardNumber: string;
  name: string;
  rarity?: string;
  imageUrl?: string;
};

export type JapaneseCardCacheResponse = {
  ok: true;
  id: string;
};

export type PsaCertLookupRequest = {
  certNumber: string;
};

export type PsaCertLookupResponse = {
  certNumber: string;
  isValidRequest: boolean;
  serverMessage: string;
  item: CreateInventoryItemRequest | null;
  source: {
    specId: string | null;
    year: string | null;
    brand: string | null;
    subject: string | null;
    variety: string | null;
    category: string | null;
    population: string | null;
    populationHigher: string | null;
    estimateCents: number | null;
  };
};
