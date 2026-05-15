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
