import type {
  AuthMeResponse,
  BootstrapStatusResponse,
  CreateInventoryItemRequest,
  InventoryItem,
  InventoryListResponse,
  PsaCertLookupRequest,
  PsaCertLookupResponse
} from "@collection-tool/shared";

type AuthPayload = {
  email?: string;
  identifier?: string;
  password: string;
  displayName?: string;
  username?: string;
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    }
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
  createInventoryItem: (collectionId: string, payload: CreateInventoryItemRequest) =>
    request<{ item: InventoryItem }>(`/api/collections/${collectionId}/items`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  lookupPsaCert: (payload: PsaCertLookupRequest) =>
    request<PsaCertLookupResponse>("/api/psa/cert/lookup", {
      method: "POST",
      body: JSON.stringify(payload)
    })
};
