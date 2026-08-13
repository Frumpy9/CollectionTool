import type {
  AddCollectionMemberRequest,
  AdminUser,
  AdminUsersResponse,
  AuthMeResponse,
  BackupSqliteResponse,
  BulkDeleteInventoryItemsRequest,
  BulkDeleteInventoryItemsResponse,
  BulkPriceQueueMode,
  BulkPriceQueueResponse,
  BulkUpdateInventoryStorageLocationRequest,
  BulkUpdateInventoryStorageLocationResponse,
  BulkUpdateInventoryVariantsRequest,
  BulkUpdateInventoryVariantsResponse,
  BootstrapStatusResponse,
  CardImageUploadRequest,
  CardImageUploadResponse,
  CardImageLookupResponse,
  CardLookupRequest,
  CardLookupResponse,
  CollectionValueHistoryResponse,
  CollectionMember,
  CollectionMembersResponse,
  CollectionTransaction,
  CollectionTransactionsResponse,
  CollectionSettingsStatusResponse,
  CreateCollectionTransactionResponse,
  CreateAdminUserRequest,
  DatabaseIntegrityResponse,
  CreateInventoryItemRequest,
  CreateCollectionTransactionRequest,
  CreateCsvImportJobRequest,
  CsvImportJobResponse,
  CommitCsvImportJobRequest,
  InventoryItem,
  InventoryDuplicateCheckResponse,
  InventoryListResponse,
  MarketPriceSnapshotsResponse,
  NeedsAttentionResponse,
  PokemonPriceTrackerSetCardsResponse,
  PokemonPriceTrackerSetSearchResponse,
  PsaCertLookupRequest,
  PsaCertLookupResponse,
  PricingHistoryResponse,
  PricingReviewMutationResponse,
  PricingReviewsResponse,
  RefreshPokemonPriceTrackerPricingResponse,
  RefreshPricingResponse,
  SelectPokemonPriceTrackerPricingRequest,
  SelectPricingRequest,
  ResetAdminUserPasswordRequest,
  SystemAdminStatusResponse,
  UpdateAdminUserRequest,
  UpdateCollectionMemberRequest,
  UpdateInventoryItemRequest,
  UpdateInventoryItemImageRequest,
  UpdateCollectionTransactionRequest,
  ValueOverrideHistoryResponse
} from "@collection-tool/shared";

type AuthPayload = {
  email?: string;
  identifier?: string;
  password: string;
  displayName?: string;
  username?: string;
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined)
  };

  if (options.body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(path, {
    ...options,
    credentials: "include",
    headers
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      message?: string;
    } | null;
    throw new Error(payload?.message ?? payload?.error ?? `Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function requestBlob(path: string): Promise<{ blob: Blob; fileName: string }> {
  const response = await fetch(path, {
    credentials: "include"
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      message?: string;
    } | null;
    throw new Error(payload?.message ?? payload?.error ?? `Request failed with ${response.status}`);
  }

  return {
    blob: await response.blob(),
    fileName: fileNameFromContentDisposition(response.headers.get("Content-Disposition"))
  };
}

export const api = {
  bootstrapStatus: () => request<BootstrapStatusResponse>("/api/auth/bootstrap-status"),
  me: () => request<AuthMeResponse>("/api/auth/me"),
  bootstrap: (payload: AuthPayload) =>
    request<AuthMeResponse>("/api/auth/bootstrap", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  login: (payload: AuthPayload) =>
    request<AuthMeResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  logout: () =>
    request<{ ok: true }>("/api/auth/logout", {
      method: "POST",
      body: JSON.stringify({})
    }),
  listAdminUsers: () => request<AdminUsersResponse>("/api/admin/users"),
  createAdminUser: (payload: CreateAdminUserRequest) =>
    request<{ user: AdminUser }>("/api/admin/users", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateAdminUser: (userId: string, payload: UpdateAdminUserRequest) =>
    request<{ user: AdminUser }>(`/api/admin/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  resetAdminUserPassword: (userId: string, payload: ResetAdminUserPasswordRequest) =>
    request<{ user: AdminUser }>(`/api/admin/users/${userId}/password`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  disableAdminUser: (userId: string) =>
    request<{ user: AdminUser }>(`/api/admin/users/${userId}/disable`, {
      method: "POST",
      body: JSON.stringify({})
    }),
  enableAdminUser: (userId: string) =>
    request<{ user: AdminUser }>(`/api/admin/users/${userId}/enable`, {
      method: "POST",
      body: JSON.stringify({})
    }),
  listCollectionMembers: (collectionId: string) =>
    request<CollectionMembersResponse>(`/api/collections/${collectionId}/members`),
  addCollectionMember: (collectionId: string, payload: AddCollectionMemberRequest) =>
    request<{ member: CollectionMember }>(`/api/collections/${collectionId}/members`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateCollectionMember: (
    collectionId: string,
    userId: string,
    payload: UpdateCollectionMemberRequest
  ) =>
    request<{ member: CollectionMember }>(`/api/collections/${collectionId}/members/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  removeCollectionMember: (collectionId: string, userId: string) =>
    request<{ ok: true }>(`/api/collections/${collectionId}/members/${userId}`, {
      method: "DELETE"
    }),
  getCollectionSettingsStatus: (collectionId: string) =>
    request<CollectionSettingsStatusResponse>(`/api/collections/${collectionId}/settings/status`),
  getSystemAdminStatus: () => request<SystemAdminStatusResponse>("/api/admin/status"),
  runDatabaseIntegrityCheck: () =>
    request<DatabaseIntegrityResponse>("/api/admin/database/integrity-check", {
      method: "POST",
      body: JSON.stringify({})
    }),
  listInventory: (collectionId: string) =>
    request<InventoryListResponse>(`/api/collections/${collectionId}/items`),
  getNeedsAttention: (collectionId: string) =>
    request<NeedsAttentionResponse>(`/api/collections/${collectionId}/attention`),
  listTransactions: (collectionId: string, itemId?: string) =>
    request<CollectionTransactionsResponse>(
      `/api/collections/${collectionId}/transactions${
        itemId ? `?itemId=${encodeURIComponent(itemId)}` : ""
      }`
    ),
  createTransaction: (collectionId: string, payload: CreateCollectionTransactionRequest) =>
    request<CreateCollectionTransactionResponse>(
      `/api/collections/${collectionId}/transactions`,
      { method: "POST", body: JSON.stringify(payload) }
    ),
  updateTransaction: (
    collectionId: string,
    transactionId: string,
    payload: UpdateCollectionTransactionRequest
  ) =>
    request<{ transaction: CollectionTransaction }>(
      `/api/collections/${collectionId}/transactions/${transactionId}`,
      { method: "PATCH", body: JSON.stringify(payload) }
    ),
  deleteTransaction: (collectionId: string, transactionId: string) =>
    request<{ ok: true }>(
      `/api/collections/${collectionId}/transactions/${transactionId}`,
      { method: "DELETE" }
    ),
  getBulkPriceQueue: (collectionId: string) =>
    request<BulkPriceQueueResponse>(`/api/collections/${collectionId}/pricing/bulk/queue`),
  getPricingReviews: (collectionId: string) =>
    request<PricingReviewsResponse>(`/api/collections/${collectionId}/pricing/reviews`),
  selectPricingReview: (
    collectionId: string,
    itemId: string,
    payload: { sourceCardId: string; sourceVariantId: string }
  ) =>
    request<PricingReviewMutationResponse>(
      `/api/collections/${collectionId}/pricing/reviews/${itemId}/select`,
      { method: "POST", body: JSON.stringify(payload) }
    ),
  unpinPricingReview: (collectionId: string, itemId: string) =>
    request<PricingReviewMutationResponse>(
      `/api/collections/${collectionId}/pricing/reviews/${itemId}/pin`,
      { method: "DELETE", body: JSON.stringify({}) }
    ),
  getCollectionValueHistory: (collectionId: string) =>
    request<CollectionValueHistoryResponse>(
      `/api/collections/${collectionId}/pricing/value-history`
    ),
  enqueueBulkPriceRefresh: (
    collectionId: string,
    payload: { itemIds: string[]; mode: BulkPriceQueueMode; includeExisting?: boolean }
  ) =>
    request<BulkPriceQueueResponse>(`/api/collections/${collectionId}/pricing/bulk/queue`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  resumeBulkPriceQueue: (collectionId: string) =>
    request<BulkPriceQueueResponse>(
      `/api/collections/${collectionId}/pricing/bulk/queue/resume`,
      {
        method: "POST",
        body: JSON.stringify({})
      }
    ),
  cancelBulkPriceQueue: (collectionId: string) =>
    request<BulkPriceQueueResponse>(
      `/api/collections/${collectionId}/pricing/bulk/queue/cancel`,
      {
        method: "POST",
        body: JSON.stringify({})
      }
    ),
  retryFailedBulkPriceQueue: (collectionId: string) =>
    request<BulkPriceQueueResponse>(
      `/api/collections/${collectionId}/pricing/bulk/queue/retry-failed`,
      {
        method: "POST",
        body: JSON.stringify({})
      }
    ),
  clearCompletedBulkPriceQueue: (collectionId: string) =>
    request<BulkPriceQueueResponse>(
      `/api/collections/${collectionId}/pricing/bulk/queue/clear-completed`,
      {
        method: "POST",
        body: JSON.stringify({})
      }
    ),
  ignorePriceRefreshForItem: (collectionId: string, itemId: string) =>
    request<BulkPriceQueueResponse>(
      `/api/collections/${collectionId}/items/${itemId}/pricing/ignore`,
      {
        method: "POST",
        body: JSON.stringify({})
      }
    ),
  exportInventoryCsv: (collectionId: string) =>
    requestBlob(`/api/collections/${collectionId}/items/export.csv`),
  createCsvImportJob: (collectionId: string, payload: CreateCsvImportJobRequest) =>
    request<CsvImportJobResponse>(`/api/collections/${collectionId}/csv-imports`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  getCsvImportJob: (collectionId: string, jobId: string) =>
    request<CsvImportJobResponse>(`/api/collections/${collectionId}/csv-imports/${jobId}`),
  commitCsvImportJob: (
    collectionId: string,
    jobId: string,
    payload: CommitCsvImportJobRequest
  ) =>
    request<CsvImportJobResponse>(
      `/api/collections/${collectionId}/csv-imports/${jobId}/commit`,
      { method: "POST", body: JSON.stringify(payload) }
    ),
  cancelCsvImportJob: (collectionId: string, jobId: string) =>
    request<CsvImportJobResponse>(
      `/api/collections/${collectionId}/csv-imports/${jobId}/cancel`,
      { method: "POST", body: JSON.stringify({}) }
    ),
  downloadCsvImportErrors: (collectionId: string, jobId: string) =>
    requestBlob(`/api/collections/${collectionId}/csv-imports/${jobId}/errors.csv`),
  createSqliteBackup: () =>
    request<BackupSqliteResponse>("/api/admin/backups/sqlite", {
      method: "POST",
      body: JSON.stringify({})
    }),
  lookupCards: (payload: CardLookupRequest) =>
    request<CardLookupResponse>("/api/cards/lookup", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  searchPokemonPriceTrackerSets: (search: string) =>
    request<PokemonPriceTrackerSetSearchResponse>(
      `/api/cards/pokemonpricetracker/sets?search=${encodeURIComponent(search)}`
    ),
  getPokemonPriceTrackerSetCards: (setName: string) =>
    request<PokemonPriceTrackerSetCardsResponse>(
      `/api/cards/pokemonpricetracker/sets/${encodeURIComponent(setName)}/cards`
    ),
  lookupInventoryImageCandidates: (collectionId: string, itemId: string) =>
    request<CardImageLookupResponse>(
      `/api/collections/${collectionId}/items/${itemId}/image-candidates`
    ),
  createInventoryItem: (collectionId: string, payload: CreateInventoryItemRequest) =>
    request<{ item: InventoryItem }>(`/api/collections/${collectionId}/items`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  checkInventoryDuplicate: (collectionId: string, payload: CreateInventoryItemRequest) =>
    request<InventoryDuplicateCheckResponse>(
      `/api/collections/${collectionId}/items/duplicate-check`,
      {
        method: "POST",
        body: JSON.stringify(payload)
      }
    ),
  updateInventoryItem: (
    collectionId: string,
    itemId: string,
    payload: UpdateInventoryItemRequest
  ) =>
    request<{ item: InventoryItem }>(`/api/collections/${collectionId}/items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  updateInventoryItemImage: (
    collectionId: string,
    itemId: string,
    payload: UpdateInventoryItemImageRequest
  ) =>
    request<{ item: InventoryItem }>(`/api/collections/${collectionId}/items/${itemId}/image`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  deleteInventoryItem: (collectionId: string, itemId: string) =>
    request<{ ok: true }>(`/api/collections/${collectionId}/items/${itemId}`, {
      method: "DELETE"
    }),
  bulkDeleteInventoryItems: (
    collectionId: string,
    payload: BulkDeleteInventoryItemsRequest
  ) =>
    request<BulkDeleteInventoryItemsResponse>(
      `/api/collections/${collectionId}/items/bulk/delete`,
      {
        method: "POST",
        body: JSON.stringify(payload)
      }
    ),
  bulkUpdateInventoryVariants: (
    collectionId: string,
    payload: BulkUpdateInventoryVariantsRequest
  ) =>
    request<BulkUpdateInventoryVariantsResponse>(
      `/api/collections/${collectionId}/items/bulk/variants`,
      {
        method: "POST",
        body: JSON.stringify(payload)
      }
    ),
  bulkUpdateInventoryStorageLocation: (
    collectionId: string,
    payload: BulkUpdateInventoryStorageLocationRequest
  ) =>
    request<BulkUpdateInventoryStorageLocationResponse>(
      `/api/collections/${collectionId}/items/bulk/storage-location`,
      {
        method: "POST",
        body: JSON.stringify(payload)
      }
    ),
  uploadCardImage: (payload: CardImageUploadRequest) =>
    request<CardImageUploadResponse>("/api/uploads/card-image", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  lookupPsaCert: (payload: PsaCertLookupRequest) =>
    request<PsaCertLookupResponse>("/api/psa/cert/lookup", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  refreshPricing: (collectionId: string, itemId: string) =>
    request<RefreshPricingResponse>(
      `/api/collections/${collectionId}/items/${itemId}/pricing/refresh`,
      {
        method: "POST",
        body: JSON.stringify({})
      }
    ),
  selectPricing: (collectionId: string, itemId: string, payload: SelectPricingRequest) =>
    request<RefreshPricingResponse>(
      `/api/collections/${collectionId}/items/${itemId}/pricing/select`,
      {
        method: "POST",
        body: JSON.stringify(payload)
      }
    ),
  getPricingHistory: (collectionId: string, itemId: string, days: number) =>
    request<PricingHistoryResponse>(
      `/api/collections/${collectionId}/items/${itemId}/pricing/history?days=${encodeURIComponent(
        String(days)
      )}`
    ),
  getMarketPriceSnapshots: (collectionId: string, itemId: string) =>
    request<MarketPriceSnapshotsResponse>(
      `/api/collections/${collectionId}/items/${itemId}/pricing/snapshots`
    ),
  getValueOverrideHistory: (collectionId: string, itemId: string) =>
    request<ValueOverrideHistoryResponse>(
      `/api/collections/${collectionId}/items/${itemId}/value-override-history`
    ),
  refreshPokemonPriceTrackerPricing: (collectionId: string, itemId: string) =>
    request<RefreshPokemonPriceTrackerPricingResponse>(
      `/api/collections/${collectionId}/items/${itemId}/pricing/pokemonpricetracker/refresh`,
      {
        method: "POST",
        body: JSON.stringify({})
      }
    ),
  selectPokemonPriceTrackerPricing: (
    collectionId: string,
    itemId: string,
    payload: SelectPokemonPriceTrackerPricingRequest
  ) =>
    request<RefreshPokemonPriceTrackerPricingResponse>(
      `/api/collections/${collectionId}/items/${itemId}/pricing/pokemonpricetracker/select`,
      {
        method: "POST",
        body: JSON.stringify(payload)
      }
    )
};

function fileNameFromContentDisposition(contentDisposition: string | null) {
  const fallback = `pokemon-vault-inventory-${new Date().toISOString().slice(0, 10)}.csv`;

  if (!contentDisposition) {
    return fallback;
  }

  const match = /filename="?(?<fileName>[^";]+)"?/i.exec(contentDisposition);
  return match?.groups?.fileName ?? fallback;
}
