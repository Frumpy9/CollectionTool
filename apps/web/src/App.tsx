import {
  BarChart3,
  Camera,
  ChevronDown,
  CircleDollarSign,
  Database,
  Gem,
  Grid2X2,
  Image as ImageIcon,
  ListFilter,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Tags,
  Upload,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  AuthMeResponse,
  AuthUser,
  CardLanguage,
  CardLookupCandidate,
  CardLookupResponse,
  CollectionSummary,
  CreateInventoryItemRequest,
  InventoryItem,
  InventoryItemType,
  InventoryListResponse,
  PsaCertLookupResponse
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

const variantOptions = [
  "Standard",
  "Holo / Foil",
  "Reverse Holo",
  "Stamped",
  "1st Edition",
  "Promo",
  "Other"
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
  const [activePanel, setActivePanel] = useState<"lookup" | "manual" | "cert" | null>(null);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupLanguage, setLookupLanguage] = useState<CardLanguage | "all">("all");
  const [lookupResult, setLookupResult] = useState<CardLookupResponse | null>(null);
  const [lookupStatus, setLookupStatus] = useState<"idle" | "loading">("idle");
  const [lookupError, setLookupError] = useState("");

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

  async function handleLookup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLookupError("");
    setLookupResult(null);
    setLookupStatus("loading");
    setActivePanel("lookup");

    try {
      const response = await api.lookupCards({
        query: lookupQuery,
        language: lookupLanguage
      });
      setLookupResult(response);

      if (response.candidates.length === 0) {
        setLookupError("No matching cards found. Try a set code plus card number, or a card name.");
      }
    } catch (error) {
      setLookupError(error instanceof Error ? error.message : "Unable to look up cards.");
    } finally {
      setLookupStatus("idle");
    }
  }

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
              onClick={() => setActivePanel((panel) => (panel === "manual" ? null : "manual"))}
            >
              <Plus size={18} aria-hidden="true" />
              Add card
            </button>
          </div>
        </header>

        <form className="command-panel" aria-label="Add cards" onSubmit={handleLookup}>
          <div className="search-control">
            <Search size={20} aria-hidden="true" />
            <input
              aria-label="Search or add card"
              onChange={(event) => setLookupQuery(event.target.value)}
              placeholder="Enter a card name, PSA cert, or set/card number like s10a 073/071"
              value={lookupQuery}
            />
          </div>
          <div className="mode-actions">
            <select
              aria-label="Lookup language"
              onChange={(event) => setLookupLanguage(event.target.value as CardLanguage | "all")}
              value={lookupLanguage}
            >
              <option value="all">All</option>
              <option value="en">English</option>
              <option value="ja">Japanese</option>
            </select>
            <button disabled={lookupStatus === "loading"} type="submit">
              <Search size={18} aria-hidden="true" />
              {lookupStatus === "loading" ? "Looking..." : "Lookup"}
            </button>
            <button
              type="button"
              onClick={() => setActivePanel((panel) => (panel === "cert" ? null : "cert"))}
            >
              <ShieldCheck size={18} aria-hidden="true" />
              Cert
            </button>
            <button type="button">
              <Camera size={18} aria-hidden="true" />
              Scan
            </button>
          </div>
        </form>

        {activePanel === "lookup" && activeCollection ? (
          <CardLookupPanel
            collectionId={activeCollection.id}
            error={lookupError}
            result={lookupResult}
            status={lookupStatus}
            onAdded={(item) => {
              setInventory((current) => summarizeInventory([item, ...current.items]));
              setActivePanel(null);
              setLookupResult(null);
              setLookupQuery("");
            }}
          />
        ) : null}

        {activePanel === "manual" && activeCollection ? (
          <ManualAddPanel
            collectionId={activeCollection.id}
            onAdded={(item) => {
              setInventory((current) => summarizeInventory([item, ...current.items]));
              setActivePanel(null);
            }}
          />
        ) : null}

        {activePanel === "cert" && activeCollection ? (
          <PsaCertPanel
            collectionId={activeCollection.id}
            onAdded={(item) => {
              setInventory((current) => summarizeInventory([item, ...current.items]));
              setActivePanel(null);
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
          <InventoryGrid items={inventory.items} onSelect={setSelectedItem} />
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

        {activeCollection && selectedItem ? (
          <InventoryItemDetail
            collectionId={activeCollection.id}
            item={selectedItem}
            onClose={() => setSelectedItem(null)}
            onDeleted={(itemId) => {
              setInventory((current) => removeInventoryItem(current, itemId));
              setSelectedItem(null);
            }}
            onUpdated={(updatedItem) => {
              setInventory((current) => updateInventoryItem(current, updatedItem));
              setSelectedItem(updatedItem);
            }}
          />
        ) : null}
      </section>
    </main>
  );
}

function CardLookupPanel({
  collectionId,
  error,
  result,
  status,
  onAdded
}: {
  collectionId: string;
  error: string;
  result: CardLookupResponse | null;
  status: "idle" | "loading";
  onAdded: (item: InventoryItem) => void;
}) {
  const [itemType, setItemType] = useState<InventoryItemType>("raw");
  const [grader, setGrader] = useState("PSA");
  const [grade, setGrade] = useState("");
  const [certNumber, setCertNumber] = useState("");
  const [savingId, setSavingId] = useState("");
  const [saveError, setSaveError] = useState("");

  async function handleAdd(candidate: CardLookupCandidate) {
    setSaveError("");
    setSavingId(candidate.id);

    try {
      const payload: CreateInventoryItemRequest = {
        ...candidate.item,
        itemType,
        grader: itemType === "graded" ? grader : "",
        grade: itemType === "graded" ? grade : "",
        certNumber: itemType === "graded" ? certNumber : "",
        notes: [
          candidate.item.notes,
          `Lookup confidence: ${candidate.confidence}`
        ]
          .filter(Boolean)
          .join("\n")
      };

      const response = await api.createInventoryItem(collectionId, payload);
      onAdded(response.item);
    } catch (addError) {
      setSaveError(addError instanceof Error ? addError.message : "Unable to add lookup card.");
    } finally {
      setSavingId("");
    }
  }

  return (
    <section className="manual-panel lookup-panel" aria-label="Card lookup results">
      <div>
        <p className="eyebrow">Card lookup</p>
        <h3>Find and add a card</h3>
      </div>

      <div className="lookup-controls">
        <label>
          Add as
          <select
            onChange={(event) => setItemType(event.target.value as InventoryItemType)}
            value={itemType}
          >
            <option value="raw">Raw</option>
            <option value="graded">Graded</option>
          </select>
        </label>
        {itemType === "graded" ? (
          <>
            <label>
              Grader
              <select onChange={(event) => setGrader(event.target.value)} value={grader}>
                <option value="PSA">PSA</option>
                <option value="CGC">CGC</option>
                <option value="BGS">BGS</option>
                <option value="Other">Other</option>
              </select>
            </label>
            <label>
              Grade
              <input onChange={(event) => setGrade(event.target.value)} placeholder="10, 9.5..." value={grade} />
            </label>
            <label>
              Cert #
              <input onChange={(event) => setCertNumber(event.target.value)} placeholder="Optional" value={certNumber} />
            </label>
          </>
        ) : null}
      </div>

      {status === "loading" ? <p className="lookup-note">Searching free card databases...</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      {saveError ? <p className="form-error">{saveError}</p> : null}

      {result && result.candidates.length > 0 ? (
        <>
          <p className="lookup-note">
            {result.candidates.length} result{result.candidates.length === 1 ? "" : "s"} for{" "}
            <strong>{result.query}</strong>
          </p>
          <div className="lookup-results">
            {result.candidates.map((candidate) => (
              <article className="lookup-card" key={candidate.id}>
                <div className="lookup-image" aria-hidden="true">
                  {candidate.imageUrl ? <img alt="" src={candidate.imageUrl} /> : <Gem size={34} />}
                </div>
                <div className="lookup-copy">
                  <p className="eyebrow">
                    {candidate.language.toUpperCase()} · {candidate.source} · {candidate.confidence}
                  </p>
                  <h4>{candidate.name}</h4>
                  <p>
                    {[candidate.setCode, candidate.cardNumber, candidate.setName]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <div className="inventory-meta">
                    {candidate.rarity ? <span>{candidate.rarity}</span> : null}
                    <span>{candidate.sourceId}</span>
                  </div>
                </div>
                <button
                  className="primary-button"
                  disabled={savingId === candidate.id}
                  onClick={() => handleAdd(candidate)}
                  type="button"
                >
                  <Plus size={18} aria-hidden="true" />
                  {savingId === candidate.id ? "Adding..." : "Add"}
                </button>
              </article>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

function PsaCertPanel({
  collectionId,
  onAdded
}: {
  collectionId: string;
  onAdded: (item: InventoryItem) => void;
}) {
  const [certNumber, setCertNumber] = useState("");
  const [lookup, setLookup] = useState<PsaCertLookupResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "saving">("idle");
  const [error, setError] = useState("");

  async function handleLookup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLookup(null);
    setStatus("loading");

    try {
      const response = await api.lookupPsaCert({ certNumber });
      setLookup(response);

      if (!response.item) {
        setError(response.serverMessage);
      }
    } catch (lookupError) {
      setError(lookupError instanceof Error ? lookupError.message : "Unable to look up PSA cert.");
    } finally {
      setStatus("idle");
    }
  }

  async function handleAdd() {
    if (!lookup?.item) {
      return;
    }

    setStatus("saving");
    setError("");

    try {
      const response = await api.createInventoryItem(collectionId, lookup.item);
      onAdded(response.item);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to add PSA card.");
    } finally {
      setStatus("idle");
    }
  }

  return (
    <section className="manual-panel cert-panel" aria-label="PSA cert import">
      <div>
        <p className="eyebrow">PSA import</p>
        <h3>Add a graded card by cert number</h3>
      </div>
      <form className="cert-form" onSubmit={handleLookup}>
        <label>
          PSA cert number
          <input
            inputMode="numeric"
            onChange={(event) => setCertNumber(event.target.value)}
            placeholder="Enter the number on the slab"
            required
            value={certNumber}
          />
        </label>
        <button className="primary-button" disabled={status === "loading"} type="submit">
          {status === "loading" ? "Looking up..." : "Lookup cert"}
        </button>
      </form>

      {lookup?.item ? (
        <div className="cert-result">
          <div>
            <p className="eyebrow">Ready to add</p>
            <h3>{lookup.item.name}</h3>
            <p>
              PSA {lookup.item.grade ?? "grade unknown"} · Cert {lookup.certNumber}
            </p>
          </div>
          <div className="inventory-meta">
            {lookup.source.specId ? <span>Spec {lookup.source.specId}</span> : null}
            {lookup.source.population ? <span>Pop {lookup.source.population}</span> : null}
            {lookup.source.populationHigher ? (
              <span>Higher {lookup.source.populationHigher}</span>
            ) : null}
            {lookup.source.category ? <span>{lookup.source.category}</span> : null}
          </div>
          <button className="primary-button" disabled={status === "saving"} onClick={handleAdd} type="button">
            {status === "saving" ? "Adding..." : "Add PSA card"}
          </button>
        </div>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}
    </section>
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
      variantDetails: variantsFromFormData(formData),
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
      const imageFile = singleFileFromForm(formData.get("imageFile"));

      if (imageFile) {
        payload.imageUrl = await uploadCardImage(collectionId, imageFile);
      }

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
          Upload image
          <input accept="image/jpeg,image/png,image/webp,image/gif" name="imageFile" type="file" />
        </label>
        <label className="wide-field">
          Variants
          <CardVariantSelect />
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

function InventoryGrid({
  items,
  onSelect
}: {
  items: InventoryItem[];
  onSelect: (item: InventoryItem) => void;
}) {
  return (
    <section className="inventory-grid" id="collection" aria-label="Collection cards">
      {items.map((item) => (
        <article
          aria-label={`Open ${item.card.name} details`}
          className="inventory-card"
          key={item.id}
          onClick={() => onSelect(item)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelect(item);
            }
          }}
          role="button"
          tabIndex={0}
        >
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

function InventoryItemDetail({
  collectionId,
  item,
  onClose,
  onDeleted,
  onUpdated
}: {
  collectionId: string;
  item: InventoryItem;
  onClose: () => void;
  onDeleted: (itemId: string) => void;
  onUpdated: (item: InventoryItem) => void;
}) {
  const [imageUrl, setImageUrl] = useState(item.card.imageUrl ?? "");
  const [itemType, setItemType] = useState<InventoryItemType>(item.itemType);
  const [language, setLanguage] = useState<CardLanguage>(item.card.language);
  const [status, setStatus] = useState<"idle" | "saving" | "deleting">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    setImageUrl(item.card.imageUrl ?? "");
    setItemType(item.itemType);
    setLanguage(item.card.language);
    setError("");
    setStatus("idle");
  }, [item]);

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setStatus("saving");

    try {
      const formData = new FormData(event.currentTarget);
      const imageFile = singleFileFromForm(formData.get("imageFile"));
      const nextImageUrl = imageFile ? await uploadCardImage(collectionId, imageFile) : imageUrl;
      const response = await api.updateInventoryItem(collectionId, item.id, {
        name: String(formData.get("name") ?? ""),
        setName: String(formData.get("setName") ?? ""),
        setCode: String(formData.get("setCode") ?? ""),
        cardNumber: String(formData.get("cardNumber") ?? ""),
        language,
        rarity: String(formData.get("rarity") ?? ""),
        imageUrl: nextImageUrl,
        itemType,
        quantity: Number(formData.get("quantity") ?? 1),
        conditionLabel: String(formData.get("conditionLabel") ?? ""),
        conditionScore: optionalNumber(formData.get("conditionScore")),
        variantDetails: variantsFromFormData(formData),
        grader: itemType === "graded" ? String(formData.get("grader") ?? "") : "",
        grade: itemType === "graded" ? String(formData.get("grade") ?? "") : "",
        certNumber: itemType === "graded" ? String(formData.get("certNumber") ?? "") : "",
        purchasePriceCents: moneyToCents(formData.get("purchasePrice")),
        purchaseDate: String(formData.get("purchaseDate") ?? ""),
        valueOverrideCents: moneyToCents(formData.get("valueOverride")),
        storageLocation: String(formData.get("storageLocation") ?? ""),
        notes: String(formData.get("notes") ?? "")
      });

      onUpdated(response.item);
      event.currentTarget.reset();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save image.");
    } finally {
      setStatus("idle");
    }
  }

  async function handleClear() {
    setError("");
    setStatus("saving");

    try {
      const response = await api.updateInventoryItemImage(collectionId, item.id, {
        imageUrl: ""
      });

      onUpdated(response.item);
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : "Unable to clear image.");
    } finally {
      setStatus("idle");
    }
  }

  async function handleDelete() {
    const confirmed = window.confirm(`Delete ${item.card.name} from this collection?`);

    if (!confirmed) {
      return;
    }

    setError("");
    setStatus("deleting");

    try {
      await api.deleteInventoryItem(collectionId, item.id);
      onDeleted(item.id);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete card.");
      setStatus("idle");
    }
  }

  return (
    <div className="detail-backdrop" role="presentation" onClick={onClose}>
      <section
        aria-label={`${item.card.name} details`}
        className="detail-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="detail-header">
          <div>
            <p className="eyebrow">
              {item.card.language.toUpperCase()} · {item.itemType}
            </p>
            <h3>{item.card.name}</h3>
          </div>
          <button className="icon-button" onClick={onClose} type="button" aria-label="Close details">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="detail-content">
          <div className="detail-image">
            {item.card.imageUrl ? (
              <img alt={`${item.card.name} card art`} src={item.card.imageUrl} />
            ) : (
              <ImageIcon size={46} aria-hidden="true" />
            )}
          </div>

          <div className="detail-copy">
            <div className="inventory-meta">
              <span>Qty {item.quantity}</span>
              {item.card.setCode ? <span>{item.card.setCode}</span> : null}
              {item.card.cardNumber ? <span>{item.card.cardNumber}</span> : null}
              {item.card.setName ? <span>{item.card.setName}</span> : null}
              {item.grader && item.grade ? (
                <span>
                  {item.grader} {item.grade}
                </span>
              ) : null}
              {item.certNumber ? <span>Cert {item.certNumber}</span> : null}
            </div>

            <form className="image-edit-form detail-edit-form" key={item.id} onSubmit={handleSave}>
              <label>
                Card name
                <input defaultValue={item.card.name} name="name" required />
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
                Quantity
                <input defaultValue={item.quantity} min="1" name="quantity" required type="number" />
              </label>
              <label>
                Set code
                <input defaultValue={item.card.setCode ?? ""} name="setCode" />
              </label>
              <label>
                Card #
                <input defaultValue={item.card.cardNumber ?? ""} name="cardNumber" />
              </label>
              <label>
                Set name
                <input defaultValue={item.card.setName ?? ""} name="setName" />
              </label>
              <label>
                Rarity
                <input defaultValue={item.card.rarity ?? ""} name="rarity" />
              </label>
              <label>
                Condition
                <select defaultValue={item.conditionLabel ?? ""} name="conditionLabel">
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
                <input
                  defaultValue={item.conditionScore ?? ""}
                  max="10"
                  min="1"
                  name="conditionScore"
                  step="0.5"
                  type="number"
                />
              </label>
              {itemType === "graded" ? (
                <>
                  <label>
                    Grader
                    <select defaultValue={item.grader ?? ""} name="grader" required>
                      <option value="">Choose</option>
                      <option value="PSA">PSA</option>
                      <option value="CGC">CGC</option>
                      <option value="BGS">BGS</option>
                      <option value="Other">Other</option>
                    </select>
                  </label>
                  <label>
                    Grade
                    <input defaultValue={item.grade ?? ""} name="grade" required />
                  </label>
                  <label>
                    Cert #
                    <input defaultValue={item.certNumber ?? ""} name="certNumber" />
                  </label>
                </>
              ) : null}
              <label>
                Value $
                <input
                  defaultValue={centsToMoneyInput(item.valueOverrideCents)}
                  inputMode="decimal"
                  name="valueOverride"
                />
              </label>
              <label>
                Purchase $
                <input
                  defaultValue={centsToMoneyInput(item.purchasePriceCents)}
                  inputMode="decimal"
                  name="purchasePrice"
                />
              </label>
              <label>
                Purchase date
                <input defaultValue={item.purchaseDate ?? ""} name="purchaseDate" type="date" />
              </label>
              <label>
                Storage
                <input defaultValue={item.storageLocation ?? ""} name="storageLocation" />
              </label>
              <label>
                Image URL
                <input
                  onChange={(event) => setImageUrl(event.target.value)}
                  placeholder="/uploads/card-images/example.png or https://..."
                  value={imageUrl}
                />
              </label>
              <label>
                Upload image
                <input
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  name="imageFile"
                  type="file"
                />
              </label>
              <label>
                Variants
                <CardVariantSelect defaultValue={item.variantDetails ?? ""} />
              </label>
              <label>
                Notes
                <textarea defaultValue={item.notes ?? ""} name="notes" />
              </label>
              {error ? <p className="form-error">{error}</p> : null}
              <div className="detail-actions">
                <button className="primary-button" disabled={status !== "idle"} type="submit">
                  <Upload size={18} aria-hidden="true" />
                  {status === "saving" ? "Saving..." : "Save changes"}
                </button>
                <button disabled={status !== "idle"} onClick={handleClear} type="button">
                  Clear image
                </button>
                <button
                  className="danger-button"
                  disabled={status !== "idle"}
                  onClick={handleDelete}
                  type="button"
                >
                  {status === "deleting" ? "Deleting..." : "Delete card"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>
    </div>
  );
}

function CardVariantSelect({ defaultValue = "" }: { defaultValue?: string }) {
  const selectedValues = variantsFromText(defaultValue);
  const customValues = selectedValues.filter((variant) => !variantOptions.includes(variant));

  return (
    <div className="variant-picker">
      {variantOptions.map((variant) => (
        <label key={variant}>
          <input
            defaultChecked={selectedValues.includes(variant)}
            name="variantDetails"
            type="checkbox"
            value={variant}
          />
          {variant}
        </label>
      ))}
      {customValues.map((variant) => (
        <label key={variant}>
          <input defaultChecked name="variantDetails" type="checkbox" value={variant} />
          {variant}
        </label>
      ))}
    </div>
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

function updateInventoryItem(
  inventory: InventoryListResponse,
  updatedItem: InventoryItem
): InventoryListResponse {
  return summarizeInventory(
    inventory.items.map((item) => (item.id === updatedItem.id ? updatedItem : item))
  );
}

function removeInventoryItem(
  inventory: InventoryListResponse,
  removedItemId: string
): InventoryListResponse {
  return summarizeInventory(inventory.items.filter((item) => item.id !== removedItemId));
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

function centsToMoneyInput(cents: number | null) {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

function variantsFromFormData(formData: FormData) {
  return formData
    .getAll("variantDetails")
    .map((value) => String(value).trim())
    .filter(Boolean)
    .join(", ");
}

function variantsFromText(value: string) {
  return value
    .split(",")
    .map((variant) => variant.trim())
    .filter(Boolean);
}

function singleFileFromForm(value: FormDataEntryValue | null) {
  return value instanceof File && value.size > 0 ? value : null;
}

async function uploadCardImage(collectionId: string, file: File) {
  const dataBase64 = await readFileAsBase64(file);
  const response = await api.uploadCardImage({
    collectionId,
    fileName: file.name,
    mimeType: file.type,
    dataBase64
  });

  return response.imageUrl;
}

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.split(",")[1] : result);
    });
    reader.addEventListener("error", () => reject(new Error("Unable to read image file.")));
    reader.readAsDataURL(file);
  });
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
