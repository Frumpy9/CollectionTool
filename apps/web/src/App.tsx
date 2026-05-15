import {
  BarChart3,
  Camera,
  ChevronDown,
  CircleDollarSign,
  Database,
  Gem,
  Grid2X2,
  ListFilter,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Tags
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  AuthMeResponse,
  AuthUser,
  CardLanguage,
  CollectionSummary,
  CreateInventoryItemRequest,
  InventoryItem,
  InventoryItemType,
  InventoryListResponse
} from "@collection-tool/shared";
import { api } from "./api";

type HealthState =
  | { status: "loading" }
  | { status: "ok"; timestamp: string; migrationsApplied: number }
  | { status: "error"; message: string };

const roadmapItems = [
  "Manual card lookup",
  "Full accounts",
  "PSA slab import",
  "CGC cert drafts",
  "eBay sold comps",
  "Continuous scan mode"
];

export function App() {
  const [auth, setAuth] = useState<AuthMeResponse | null>(null);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [health, setHealth] = useState<HealthState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    Promise.all([api.bootstrapStatus(), api.me()])
      .then(([bootstrapStatus, me]) => {
        if (!cancelled) {
          setNeedsBootstrap(bootstrapStatus.needsBootstrap);
          setAuth(me);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAuth({ user: null, collections: [] });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAuthLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch("/health", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`API returned ${response.status}`);
        }
        return response.json() as Promise<{
          timestamp: string;
          database: { migrationsApplied: number };
        }>;
      })
      .then((payload) => {
        if (!cancelled) {
          setHealth({
            status: "ok",
            timestamp: payload.timestamp,
            migrationsApplied: payload.database.migrationsApplied
          });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setHealth({
            status: "error",
            message: error instanceof Error ? error.message : "Unable to reach API"
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const healthText = useMemo(() => {
    if (health.status === "loading") {
      return "Checking API";
    }

    if (health.status === "error") {
      return "API offline";
    }

    return "API online";
  }, [health]);

  if (authLoading) {
    return <LoadingScreen />;
  }

  if (!auth?.user) {
    return (
      <AuthScreen
        mode={needsBootstrap ? "bootstrap" : "login"}
        onAuthenticated={(nextAuth) => {
          setAuth(nextAuth);
          setNeedsBootstrap(false);
        }}
      />
    );
  }

  return (
    <WorkspaceShell
      authUser={auth.user}
      collections={auth.collections}
      health={health}
      healthText={healthText}
      onLogout={async () => {
        await api.logout();
        setAuth({ user: null, collections: [] });
      }}
    />
  );
}

function WorkspaceShell({
  authUser,
  collections,
  health,
  healthText,
  onLogout
}: {
  authUser: AuthUser;
  collections: CollectionSummary[];
  health: HealthState;
  healthText: string;
  onLogout: () => Promise<void>;
}) {
  const activeCollection = collections[0];
  const [inventory, setInventory] = useState<InventoryListResponse>({
    items: [],
    summary: {
      itemCount: 0,
      cardCount: activeCollection?.cardCount ?? 0,
      estimatedValueCents: activeCollection?.estimatedValueCents ?? 0
    }
  });
  const [inventoryStatus, setInventoryStatus] = useState<"idle" | "loading" | "error">("idle");
  const [inventoryError, setInventoryError] = useState("");
  const [isAddPanelOpen, setIsAddPanelOpen] = useState(false);

  useEffect(() => {
    if (!activeCollection) {
      return;
    }

    let cancelled = false;
    setInventoryStatus("loading");
    setInventoryError("");

    api
      .listInventory(activeCollection.id)
      .then((payload) => {
        if (!cancelled) {
          setInventory(payload);
          setInventoryStatus("idle");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setInventoryStatus("error");
          setInventoryError(error instanceof Error ? error.message : "Unable to load inventory.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeCollection?.id]);

  const workspaceStats = [
    { label: "Total cards", value: String(inventory.summary.cardCount), icon: Grid2X2 },
    {
      label: "Estimated value",
      value: formatCurrency(inventory.summary.estimatedValueCents),
      icon: CircleDollarSign
    },
    { label: "Inventory rows", value: String(inventory.summary.itemCount), icon: Sparkles },
    {
      label: "Inventory",
      value: inventoryStatus === "loading" ? "Loading" : "Local",
      icon: BarChart3
    }
  ];

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Collection navigation">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Gem size={22} aria-hidden="true" />
          </div>
          <div>
            <p className="eyebrow">Collection Tool</p>
            <h1>Pokemon Vault</h1>
          </div>
        </div>

        <button className="collection-switcher" type="button">
          <span>
            <strong>{activeCollection?.name ?? "No collection"}</strong>
            <small>
              {activeCollection
                ? `${activeCollection.role} workspace`
                : "Create a collection to begin"}
            </small>
          </span>
          <ChevronDown size={18} aria-hidden="true" />
        </button>

        <nav className="nav-stack" aria-label="Primary">
          <a className="nav-item active" href="#collection">
            <Grid2X2 size={18} aria-hidden="true" />
            Collection
          </a>
          <a className="nav-item" href="#graded">
            <ShieldCheck size={18} aria-hidden="true" />
            Graded cards
          </a>
          <a className="nav-item" href="#tags">
            <Tags size={18} aria-hidden="true" />
            Tags & storage
          </a>
          <a className="nav-item" href="#data">
            <Database size={18} aria-hidden="true" />
            Data sources
          </a>
        </nav>

        <div className={`system-card ${health.status}`}>
          <span className="pulse" aria-hidden="true" />
          <div>
            <strong>{healthText}</strong>
            <small>
              {health.status === "ok"
                ? `${health.migrationsApplied} migrations applied this run`
                : health.status === "error"
                  ? health.message
                  : "Waiting for /health"}
            </small>
          </div>
        </div>

        <div className="account-card">
          <span>
            <strong>{authUser.displayName}</strong>
            <small>@{authUser.username} · {authUser.email}</small>
          </span>
          <button type="button" onClick={onLogout}>
            Log out
          </button>
        </div>
      </aside>

      <section className="workspace" aria-labelledby="workspace-title">
        <header className="topbar">
          <div>
            <p className="eyebrow">First milestone</p>
            <h2 id="workspace-title">Collection workspace</h2>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" type="button" aria-label="Filter collection">
              <ListFilter size={20} aria-hidden="true" />
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() => setIsAddPanelOpen((isOpen) => !isOpen)}
            >
              <Plus size={18} aria-hidden="true" />
              Add card
            </button>
          </div>
        </header>

        <section className="command-panel" aria-label="Add cards">
          <div className="search-control">
            <Search size={20} aria-hidden="true" />
            <input
              aria-label="Search or add card"
              placeholder="Enter a card name, PSA cert, or set/card number like s10a 073/071"
            />
          </div>
          <div className="mode-actions">
            <button type="button">
              <Search size={18} aria-hidden="true" />
              Lookup
            </button>
            <button type="button">
              <ShieldCheck size={18} aria-hidden="true" />
              Cert
            </button>
            <button type="button">
              <Camera size={18} aria-hidden="true" />
              Scan
            </button>
          </div>
        </section>

        {isAddPanelOpen && activeCollection ? (
          <ManualAddPanel
            collectionId={activeCollection.id}
            onAdded={(item) => {
              setInventory((current) => summarizeInventory([item, ...current.items]));
              setIsAddPanelOpen(false);
            }}
          />
        ) : null}

        {inventoryStatus === "error" ? <p className="form-error">{inventoryError}</p> : null}

        <section className="stats-grid" aria-label="Collection summary">
          {workspaceStats.map((stat) => {
            const Icon = stat.icon;
            return (
              <article className="stat-tile" key={stat.label}>
                <Icon size={20} aria-hidden="true" />
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </article>
            );
          })}
        </section>

        {inventory.items.length > 0 ? (
          <InventoryGrid items={inventory.items} />
        ) : (
          <section className="empty-state" id="collection">
            <div className="empty-visual" aria-hidden="true">
              <div className="card-stack card-stack-one" />
              <div className="card-stack card-stack-two" />
              <div className="card-stack card-stack-three" />
            </div>
            <div className="empty-copy">
              <p className="eyebrow">Ready for inventory</p>
              <h3>Your collection will live here.</h3>
              <p>
                Add cards manually for now. API lookups, cert imports, comps, and scan
                drafts can plug into this same inventory later.
              </p>
            </div>
          </section>
        )}

        <section className="roadmap-panel" aria-label="Upcoming build milestones">
          {roadmapItems.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </section>
      </section>
    </main>
  );
}

function ManualAddPanel({
  collectionId,
  onAdded
}: {
  collectionId: string;
  onAdded: (item: InventoryItem) => void;
}) {
  const [itemType, setItemType] = useState<InventoryItemType>("raw");
  const [language, setLanguage] = useState<CardLanguage>("en");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const payload: CreateInventoryItemRequest = {
      name: String(formData.get("name") ?? ""),
      setName: String(formData.get("setName") ?? ""),
      setCode: String(formData.get("setCode") ?? ""),
      cardNumber: String(formData.get("cardNumber") ?? ""),
      language,
      rarity: String(formData.get("rarity") ?? ""),
      imageUrl: String(formData.get("imageUrl") ?? ""),
      itemType,
      quantity: Number(formData.get("quantity") ?? 1),
      conditionLabel: String(formData.get("conditionLabel") ?? ""),
      conditionScore: optionalNumber(formData.get("conditionScore")),
      variantDetails: String(formData.get("variantDetails") ?? ""),
      grader: itemType === "graded" ? String(formData.get("grader") ?? "") : "",
      grade: itemType === "graded" ? String(formData.get("grade") ?? "") : "",
      certNumber: itemType === "graded" ? String(formData.get("certNumber") ?? "") : "",
      purchasePriceCents: moneyToCents(formData.get("purchasePrice")),
      purchaseDate: String(formData.get("purchaseDate") ?? ""),
      valueOverrideCents: moneyToCents(formData.get("valueOverride")),
      storageLocation: String(formData.get("storageLocation") ?? ""),
      notes: String(formData.get("notes") ?? "")
    };

    try {
      const response = await api.createInventoryItem(collectionId, payload);
      onAdded(response.item);
      event.currentTarget.reset();
      setItemType("raw");
      setLanguage("en");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to add card.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="manual-panel" aria-label="Manual card entry">
      <div>
        <p className="eyebrow">Local entry</p>
        <h3>Add a card manually</h3>
      </div>
      <form className="manual-form" onSubmit={handleSubmit}>
        <label className="wide-field">
          Card name
          <input name="name" placeholder="Charizard, Pikachu, Umbreon VMAX..." required />
        </label>
        <label>
          Type
          <select
            name="itemType"
            onChange={(event) => setItemType(event.target.value as InventoryItemType)}
            value={itemType}
          >
            <option value="raw">Raw</option>
            <option value="graded">Graded</option>
          </select>
        </label>
        <label>
          Language
          <select
            name="language"
            onChange={(event) => setLanguage(event.target.value as CardLanguage)}
            value={language}
          >
            <option value="en">English</option>
            <option value="ja">Japanese</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          Set code
          <input name="setCode" placeholder="s10a" />
        </label>
        <label>
          Card #
          <input name="cardNumber" placeholder="073/071" />
        </label>
        <label>
          Set name
          <input name="setName" placeholder="Dark Phantasma" />
        </label>
        <label>
          Rarity
          <input name="rarity" placeholder="CHR, SR, holo..." />
        </label>
        <label>
          Quantity
          <input defaultValue="1" min="1" name="quantity" required type="number" />
        </label>
        <label>
          Condition
          <select name="conditionLabel">
            <option value="">Unknown</option>
            <option value="Near Mint">Near Mint</option>
            <option value="Lightly Played">Lightly Played</option>
            <option value="Moderately Played">Moderately Played</option>
            <option value="Heavily Played">Heavily Played</option>
            <option value="Damaged">Damaged</option>
          </select>
        </label>
        <label>
          Score
          <input max="10" min="1" name="conditionScore" step="0.5" type="number" />
        </label>
        {itemType === "graded" ? (
          <>
            <label>
              Grader
              <select name="grader" required>
                <option value="">Choose</option>
                <option value="PSA">PSA</option>
                <option value="CGC">CGC</option>
                <option value="BGS">BGS</option>
                <option value="Other">Other</option>
              </select>
            </label>
            <label>
              Grade
              <input name="grade" placeholder="10, 9.5..." required />
            </label>
            <label>
              Cert #
              <input name="certNumber" placeholder="Optional" />
            </label>
          </>
        ) : null}
        <label>
          Purchase $
          <input inputMode="decimal" name="purchasePrice" placeholder="Optional" />
        </label>
        <label>
          Value $
          <input inputMode="decimal" name="valueOverride" placeholder="Optional" />
        </label>
        <label>
          Purchase date
          <input name="purchaseDate" type="date" />
        </label>
        <label>
          Storage
          <input name="storageLocation" placeholder="Binder 1, Box A..." />
        </label>
        <label className="wide-field">
          Image URL
          <input name="imageUrl" placeholder="Optional local/reference image URL" />
        </label>
        <label className="wide-field">
          Variants
          <input name="variantDetails" placeholder="Reverse holo, stamped, print line, etc." />
        </label>
        <label className="wide-field">
          Notes
          <textarea name="notes" placeholder="Anything worth remembering" />
        </label>
        {error ? <p className="form-error wide-field">{error}</p> : null}
        <button className="primary-button wide-field" disabled={isSubmitting} type="submit">
          {isSubmitting ? "Adding..." : "Add to collection"}
        </button>
      </form>
    </section>
  );
}

function InventoryGrid({ items }: { items: InventoryItem[] }) {
  return (
    <section className="inventory-grid" id="collection" aria-label="Collection cards">
      {items.map((item) => (
        <article className="inventory-card" key={item.id}>
          <div className="inventory-image" aria-hidden="true">
            {item.card.imageUrl ? <img alt="" src={item.card.imageUrl} /> : <Gem size={38} />}
          </div>
          <div className="inventory-body">
            <div>
              <p className="eyebrow">
                {item.card.language.toUpperCase()} · {item.itemType}
              </p>
              <h3>{item.card.name}</h3>
              <p>
                {[item.card.setCode, item.card.cardNumber, item.card.setName]
                  .filter(Boolean)
                  .join(" · ") || "Manual card"}
              </p>
            </div>
            <div className="inventory-meta">
              <span>Qty {item.quantity}</span>
              {item.conditionLabel ? <span>{item.conditionLabel}</span> : null}
              {item.conditionScore ? <span>{item.conditionScore}/10</span> : null}
              {item.grader && item.grade ? (
                <span>
                  {item.grader} {item.grade}
                </span>
              ) : null}
              {item.storageLocation ? <span>{item.storageLocation}</span> : null}
            </div>
            <strong>
              {formatCurrency(
                (item.valueOverrideCents ?? item.purchasePriceCents ?? 0) * item.quantity
              )}
            </strong>
          </div>
        </article>
      ))}
    </section>
  );
}

function summarizeInventory(items: InventoryItem[]): InventoryListResponse {
  return {
    items,
    summary: items.reduce(
      (summary, item) => {
        summary.itemCount += 1;
        summary.cardCount += item.quantity;
        summary.estimatedValueCents +=
          (item.valueOverrideCents ?? item.purchasePriceCents ?? 0) * item.quantity;
        return summary;
      },
      { itemCount: 0, cardCount: 0, estimatedValueCents: 0 }
    )
  };
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(cents / 100);
}

function optionalNumber(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text ? Number(text) : undefined;
}

function moneyToCents(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim().replace(/[$,]/g, "");

  if (!text) {
    return undefined;
  }

  return Math.round(Number(text) * 100);
}

function LoadingScreen() {
  return (
    <main className="auth-layout">
      <section className="auth-panel">
        <p className="eyebrow">Collection Tool</p>
        <h1>Loading your vault</h1>
        <p>Checking the local API and account setup.</p>
      </section>
    </main>
  );
}

function AuthScreen({
  mode,
  onAuthenticated
}: {
  mode: "bootstrap" | "login";
  onAuthenticated: (auth: AuthMeResponse) => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isBootstrap = mode === "bootstrap";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const nextAuth = isBootstrap
        ? await api.bootstrap({ displayName, email, password, username })
        : await api.login({ identifier, password });
      onAuthenticated(nextAuth);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to sign in.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-panel">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Gem size={22} aria-hidden="true" />
          </div>
          <div>
            <p className="eyebrow">Pokemon Vault</p>
            <h1>{isBootstrap ? "Create the first admin" : "Welcome back"}</h1>
          </div>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {isBootstrap ? (
            <>
              <label>
                Display name
                <input
                  autoComplete="name"
                  minLength={2}
                  onChange={(event) => setDisplayName(event.target.value)}
                  required
                  value={displayName}
                />
              </label>
              <label>
                Username
                <input
                  autoComplete="username"
                  minLength={3}
                  onChange={(event) => setUsername(event.target.value)}
                  pattern="[A-Za-z0-9_-]{3,32}"
                  required
                  value={username}
                />
              </label>
            </>
          ) : null}
          {isBootstrap ? (
            <label>
              Email
              <input
                autoComplete="email"
                inputMode="email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </label>
          ) : (
            <label>
              Email or username
              <input
                autoComplete="username"
                onChange={(event) => setIdentifier(event.target.value)}
                required
                value={identifier}
              />
            </label>
          )}
          <label>
            Password
            <input
              autoComplete={isBootstrap ? "new-password" : "current-password"}
              minLength={isBootstrap ? 12 : undefined}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button className="primary-button" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Working..." : isBootstrap ? "Create admin" : "Log in"}
          </button>
        </form>
      </section>
    </main>
  );
}
