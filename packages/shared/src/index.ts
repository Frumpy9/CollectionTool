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

export type InventoryMarketPriceSource = "justtcg";

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

export type JustTcgPricingCandidate = {
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
};

export type RefreshJustTcgPricingResponse = {
  status: "saved" | "needs-review";
  item: InventoryItem | null;
  candidates: JustTcgPricingCandidate[];
  message: string;
};

export type SelectJustTcgPricingRequest = {
  sourceCardId: string;
  sourceVariantId: string;
  candidate?: JustTcgPricingCandidate;
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
