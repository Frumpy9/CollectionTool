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
  disabledAt: string | null;
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
  marketPricePreviousCents: number | null;
  marketPriceChangeCents: number | null;
  marketPriceChangePercent: number | null;
  marketPriceSnapshotCount: number;
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

export type NeedsAttentionCategory =
  | "missing-price"
  | "stale-price"
  | "low-confidence"
  | "missing-image"
  | "incomplete-metadata"
  | "duplicate-cert"
  | "possible-duplicate"
  | "failed-work";

export type NeedsAttentionIssue = {
  id: string;
  category: NeedsAttentionCategory;
  title: string;
  reasons: string[];
  items: InventoryItem[];
  totalItemCount: number;
  itemsTruncated: boolean;
  work: {
    kind: "pricing";
    status: "needs-review" | "failed";
    message: string | null;
    updatedAt: string;
  } | null;
};

export type NeedsAttentionCategorySummary = {
  category: NeedsAttentionCategory;
  groupCount: number;
  itemCount: number;
  returnedGroupCount: number;
  truncated: boolean;
};

export type NeedsAttentionResponse = {
  collectionId: string;
  generatedAt: string;
  thresholds: {
    stalePriceDays: number;
  };
  summary: {
    totalGroupCount: number;
    attentionItemCount: number;
    categories: NeedsAttentionCategorySummary[];
  };
  results: {
    issues: NeedsAttentionIssue[];
    returnedGroupCount: number;
    returnedItemCount: number;
    truncated: boolean;
    limitPerCategory: number;
    itemLimitPerGroup: number;
  };
  sources: {
    inventory: { available: true };
    pricingQueue: { available: true };
    importHistory: { available: true } | { available: false; reason: string };
  };
};

export type CollectionTransactionType =
  | "purchase"
  | "sale"
  | "trade_received"
  | "trade_given"
  | "fee"
  | "gift_received"
  | "gift_given"
  | "disposal";

export type CollectionTransaction = {
  id: string;
  collectionId: string;
  itemId: string | null;
  type: CollectionTransactionType;
  quantity: number | null;
  amountCents: number;
  feesCents: number;
  allocatedCostCents: number | null;
  currency: string;
  itemName: string;
  itemSetName: string | null;
  itemCardNumber: string | null;
  counterparty: string | null;
  notes: string | null;
  transactedAt: string;
  createdByUserId: string | null;
  createdByDisplayName: string | null;
  createdByUsername: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CollectionTransactionSummary = {
  transactionCount: number;
  purchaseCostCents: number;
  grossSaleProceedsCents: number;
  totalFeesCents: number;
  cashInCents: number;
  cashOutCents: number;
  netCashFlowCents: number;
  realizedSaleCount: number;
  salesMissingCostBasisCount: number;
  realizedTradeCount: number;
  tradesMissingCostBasisCount: number;
  realizedProceedsCents: number;
  realizedCostBasisCents: number;
  realizedProfitCents: number;
  realizedTradeAssignedValueCents: number;
  realizedTradeCostBasisCents: number;
  realizedTradeProfitCents: number;
};

export type CollectionTransactionsResponse = {
  transactions: CollectionTransaction[];
  summary: CollectionTransactionSummary;
};

export type CreateCollectionTransactionRequest = {
  itemId?: string | null;
  type: CollectionTransactionType;
  quantity?: number;
  /** Total for this transaction, never a per-unit amount. */
  amountCents?: number;
  feesCents?: number;
  allocatedCostCents?: number;
  itemName?: string;
  counterparty?: string;
  notes?: string;
  transactedAt: string;
};

export type UpdateCollectionTransactionRequest = Partial<CreateCollectionTransactionRequest>;

export type BackupSqliteResponse = {
  ok: true;
  fileName: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
};

export type AdminUser = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  systemRole: "admin" | "user";
  disabledAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  collectionCount: number;
  activeSessionCount: number;
};

export type AdminUsersResponse = {
  users: AdminUser[];
};

export type CreateAdminUserRequest = {
  email: string;
  username: string;
  displayName: string;
  password: string;
  systemRole: "admin" | "user";
};

export type UpdateAdminUserRequest = {
  email?: string;
  username?: string;
  displayName?: string;
  systemRole?: "admin" | "user";
};

export type ResetAdminUserPasswordRequest = {
  password: string;
};

export type CollectionMember = {
  userId: string;
  email: string;
  username: string;
  displayName: string;
  systemRole: "admin" | "user";
  disabledAt: string | null;
  role: "owner" | "admin" | "editor" | "viewer";
  createdAt: string;
  isOwner: boolean;
};

export type CollectionMemberCandidate = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  systemRole: "admin" | "user";
  disabledAt: string | null;
};

export type CollectionMembersResponse = {
  members: CollectionMember[];
  candidates: CollectionMemberCandidate[];
};

export type AddCollectionMemberRequest = {
  userId: string;
  role: "admin" | "editor" | "viewer";
};

export type UpdateCollectionMemberRequest = {
  role: "admin" | "editor" | "viewer";
};

export type AdminBackupSummary = {
  fileName: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
};

export type AdminIgnoredPriceRefreshItem = {
  itemId: string;
  name: string;
  setName: string | null;
  cardNumber: string | null;
  reason: string | null;
  ignoredAt: string;
};

export type AdminCollectionStatusResponse = {
  backups: {
    scheduledEnabled: boolean;
    intervalHours: number;
    retentionDays: number;
    latest: AdminBackupSummary[];
  };
  pricing: {
    scheduledEnabled: boolean;
    intervalHours: number;
    batchSize: number;
    runStartedAt: string | null;
    runCompletedAt: string | null;
    cursorItemId: string | null;
    updatedAt: string | null;
    nextDueAt: string | null;
    ignoredCount: number;
    ignoredItems: AdminIgnoredPriceRefreshItem[];
    queueSummary: BulkPriceQueueResponse["summary"];
  };
};

export type DatabaseIntegrityViolation = {
  table: string;
  rowId: number | null;
  parentTable: string;
  foreignKeyIndex: number;
};

export type DatabaseIntegrityResponse = {
  status: "healthy" | "issues";
  checkedAt: string;
  connection: {
    foreignKeysEnabled: boolean;
    busyTimeoutMs: number;
    journalMode: string;
  };
  integrityCheck: {
    ok: boolean;
    messageCount: number;
    messages: string[];
    truncated: boolean;
  };
  foreignKeyCheck: {
    ok: boolean;
    violationCount: number;
    violations: DatabaseIntegrityViolation[];
    truncated: boolean;
  };
};

export type ValueOverrideHistoryEntry = {
  id: string;
  itemId: string;
  previousValueCents: number | null;
  nextValueCents: number | null;
  changedByUserId: string | null;
  changedByDisplayName: string | null;
  changedByUsername: string | null;
  changedAt: string;
};

export type ValueOverrideHistoryResponse = {
  itemId: string;
  history: ValueOverrideHistoryEntry[];
};

export type MarketPriceSnapshot = {
  id: string;
  itemId: string;
  source: InventoryMarketPriceSource;
  priceKind: InventoryItemType;
  sourceCardId: string;
  sourceVariantId: string;
  matchedName: string;
  matchedSetName: string | null;
  matchedCardNumber: string | null;
  priceCents: number;
  previousPriceCents: number | null;
  deltaCents: number | null;
  confidence: MarketPriceConfidence;
  capturedAt: string;
};

export type MarketPriceSnapshotsResponse = {
  itemId: string;
  snapshots: MarketPriceSnapshot[];
};

export type CollectionValueHistoryReason =
  | "inventory_add"
  | "inventory_update"
  | "inventory_delete"
  | "market_price_update"
  | "legacy_price_refresh"
  | "migration_baseline";

export type CollectionValueHistoryPoint = {
  id: string;
  capturedAt: string;
  valueCents: number;
  deltaCents: number | null;
  refreshedItemCount: number;
  itemQuantity: number;
  reason: CollectionValueHistoryReason;
};

export type CollectionValueHistoryResponse = {
  collectionId: string;
  points: CollectionValueHistoryPoint[];
  message: string;
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
  pricingSource?: {
    source: "pokemonpricetracker";
    sourceCardId: string;
    sourceVariantId?: string;
    confidence?: MarketPriceConfidence;
  };
};

export type UpdateInventoryItemRequest = CreateInventoryItemRequest;

export type UpdateInventoryItemImageRequest = {
  imageUrl: string;
};

export type CsvImportDuplicatePolicy = "skip" | "merge" | "separate";

export type CsvImportJobStatus =
  | "queued"
  | "validating"
  | "ready"
  | "committing"
  | "completed"
  | "failed"
  | "cancelled";

export type CsvImportJobIssue = {
  lineNumber: number;
  name: string;
  disposition: "invalid" | "skipped";
  messages: string[];
};

export type CsvImportJobResponse = {
  id: string;
  collectionId: string;
  status: CsvImportJobStatus;
  duplicatePolicy: CsvImportDuplicatePolicy;
  progress: {
    processedRows: number;
    totalRows: number;
  };
  summary: {
    totalRows: number;
    commitRows: number;
    insertRows: number;
    mergeRows: number;
    invalidRows: number;
    skippedRows: number;
    excludedRows: number;
  };
  issues: CsvImportJobIssue[];
  issuesTruncated: boolean;
  planHash: string | null;
  requiresExclusionAcknowledgement: boolean;
  cancellationRequested: boolean;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type CreateCsvImportJobRequest = {
  csvText: string;
  duplicatePolicy: CsvImportDuplicatePolicy;
};

export type CommitCsvImportJobRequest = {
  planHash: string;
  acknowledgeExclusions: boolean;
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

export type BulkUpdateInventoryStorageLocationRequest = {
  itemIds: string[];
  storageLocation: string;
};

export type BulkUpdateInventoryStorageLocationResponse = {
  items: InventoryItem[];
  updatedItemIds: string[];
  notFoundItemIds: string[];
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
};

export type SelectPricingRequest = {
  sourceCardId: string;
  sourceVariantId: string;
  source?: InventoryMarketPriceSource;
};

export type PricingReviewComparisonField =
  | "set"
  | "card-number"
  | "variant"
  | "language"
  | "condition";

export type PricingReviewComparison = {
  field: PricingReviewComparisonField;
  inventoryValue: string | null;
  candidateValue: string | null;
  status: "match" | "disagreement" | "unknown";
};

export type PricingReviewCandidate = PricingCandidate & {
  comparisons: PricingReviewComparison[];
  isPinned: boolean;
};

export type PricingReviewEntry = {
  item: InventoryItem;
  source: "pokemonpricetracker";
  status: "needs-review" | "pinned";
  isPinned: boolean;
  message: string;
  candidates: PricingReviewCandidate[];
  pinnedSourceCardId: string | null;
  pinnedSourceVariantId: string | null;
  updatedAt: string;
};

export type PricingReviewsResponse = {
  reviews: PricingReviewEntry[];
  summary: {
    needsReview: number;
    pinned: number;
  };
  message: string;
};

export type SelectPricingReviewRequest = {
  sourceCardId: string;
  sourceVariantId: string;
};

export type PricingReviewMutationResponse = {
  item: InventoryItem;
  reviews: PricingReviewsResponse;
  message: string;
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
  source: "pokemontcg" | "tcgdex" | "japanese-cache" | "parsed" | "pokemonpricetracker";
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

export type PokemonPriceTrackerSetSummary = {
  id: string;
  name: string;
  displayName: string;
  series: string | null;
  releaseYear: string | null;
  cardCount: number | null;
};

export type PokemonPriceTrackerSetSearchResponse = {
  query: string;
  sets: PokemonPriceTrackerSetSummary[];
};

export type PokemonPriceTrackerSetCardsResponse = {
  setName: string;
  cards: CardLookupCandidate[];
};

export type CardImageLookupResponse = {
  candidates: CardLookupCandidate[];
  message: string;
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
