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
  storageLocation: string | null;
  notes: string | null;
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
};

export type UpdateInventoryItemRequest = CreateInventoryItemRequest;

export type UpdateInventoryItemImageRequest = {
  imageUrl: string;
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
  source: "pokemontcg" | "tcgdex" | "parsed";
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
};

export type CardLookupResponse = {
  query: string;
  parsed: {
    kind: "set-number" | "number" | "name";
    setCode: string | null;
    cardNumber: string | null;
    localId: string | null;
  };
  candidates: CardLookupCandidate[];
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
  };
};
