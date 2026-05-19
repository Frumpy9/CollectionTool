import type {
  AuthMeResponse,
  BackupSqliteResponse,
  BulkDeleteInventoryItemsRequest,
  BulkDeleteInventoryItemsResponse,
  BulkPriceQueueMode,
  BulkPriceQueueResponse,
  BulkUpdateInventoryVariantsRequest,
  BulkUpdateInventoryVariantsResponse,
  BootstrapStatusResponse,
  CardImageUploadRequest,
  CardImageUploadResponse,
  CardImageLookupResponse,
  CardLookupRequest,
  CardLookupResponse,
  CreateInventoryItemRequest,
  InventoryItem,
  InventoryListResponse,
  MarketPriceSnapshotsResponse,
  PsaCertLookupRequest,
  PsaCertLookupResponse,
  PricingHistoryResponse,
  RefreshPokemonPriceTrackerPricingResponse,
  RefreshPricingResponse,
  SelectPokemonPriceTrackerPricingRequest,
  SelectPricingRequest,
  UpdateInventoryItemRequest,
  UpdateInventoryItemImageRequest,
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
  listInventory: (collectionId: string) =>
    request<InventoryListResponse>(`/api/collections/${collectionId}/items`),
  getBulkPriceQueue: (collectionId: string) =>
    request<BulkPriceQueueResponse>(`/api/collections/${collectionId}/pricing/bulk/queue`),
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
  createSqliteBackup: (collectionId: string) =>
    request<BackupSqliteResponse>(`/api/collections/${collectionId}/backups/sqlite`, {
      method: "POST",
      body: JSON.stringify({})
    }),
  lookupCards: (payload: CardLookupRequest) =>
    request<CardLookupResponse>("/api/cards/lookup", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  lookupPokemonPriceTrackerImageCandidates: (collectionId: string, itemId: string) =>
    request<CardImageLookupResponse>(
      `/api/collections/${collectionId}/items/${itemId}/pricing/image-candidates`
    ),
  createInventoryItem: (collectionId: string, payload: CreateInventoryItemRequest) =>
    request<{ item: InventoryItem }>(`/api/collections/${collectionId}/items`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
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
