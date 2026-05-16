import {
  BarChart3,
  Camera,
  ChevronDown,
  CircleDollarSign,
  Database,
  ExternalLink,
  FileText,
  Gem,
  Grid2X2,
  Image as ImageIcon,
  ListFilter,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Tags,
  Upload,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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

type InventorySortMode = "newest" | "name" | "set" | "value" | "quantity";
type InventoryValueFilter = "all" | "with-value" | "missing-value";

type InventoryFilterState = {
  query: string;
  itemType: InventoryItemType | "all";
  language: CardLanguage | "all";
  variants: string[];
  conditionLabel: string;
  storageLocation: string;
  valueStatus: InventoryValueFilter;
  sort: InventorySortMode;
};

type InventoryFilterOptions = {
  conditions: string[];
  storageLocations: string[];
};

type InventoryFilterChip = {
  key: string;
  label: string;
  onRemove: () => void;
};

type BulkMode = "cards" | "psa";
type BulkRowStatus = "pending" | "searching" | "selected" | "needs-review" | "failed" | "added" | "skipped";

type BulkQueueRow = {
  id: string;
  term: string;
  status: BulkRowStatus;
  candidates: CardLookupCandidate[];
  selectedCandidateId: string;
  psaItem: CreateInventoryItemRequest | null;
  message: string;
};

type DuplicateDecisionChoice = "merge" | "separate" | "cancel";

type PendingDuplicateDecision = {
  id: string;
  existingItem: InventoryItem;
  payload: CreateInventoryItemRequest;
  resolve: (choice: DuplicateDecisionChoice) => void;
};

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
  "Error",
  "Misprint",
  "Other"
];

const defaultInventoryFilters: InventoryFilterState = {
  query: "",
  itemType: "all",
  language: "all",
  variants: [],
  conditionLabel: "",
  storageLocation: "",
  valueStatus: "all",
  sort: "newest"
};

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
  const [activePanel, setActivePanel] = useState<"lookup" | "manual" | "cert" | "bulk" | null>(
    null
  );
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [inventoryFilters, setInventoryFilters] =
    useState<InventoryFilterState>(defaultInventoryFilters);
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupLanguage, setLookupLanguage] = useState<CardLanguage | "all">("all");
  const [lookupResult, setLookupResult] = useState<CardLookupResponse | null>(null);
  const [lookupStatus, setLookupStatus] = useState<"idle" | "loading">("idle");
  const [lookupError, setLookupError] = useState("");
  const [duplicateDecision, setDuplicateDecision] = useState<PendingDuplicateDecision | null>(null);
  const inventoryRef = useRef(inventory);

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

  useEffect(() => {
    inventoryRef.current = inventory;
  }, [inventory]);

  function requestDuplicateDecision(
    existingItem: InventoryItem,
    payload: CreateInventoryItemRequest
  ) {
    return new Promise<DuplicateDecisionChoice>((resolve) => {
      setDuplicateDecision({
        id: crypto.randomUUID(),
        existingItem,
        payload,
        resolve
      });
    });
  }

  function resolveDuplicateDecision(choice: DuplicateDecisionChoice) {
    duplicateDecision?.resolve(choice);
    setDuplicateDecision(null);
  }

  async function createOrMergeInventoryItem(
    collectionId: string,
    payload: CreateInventoryItemRequest
  ) {
    const existingItem = findDuplicateInventoryItem(inventoryRef.current.items, payload);

    if (existingItem) {
      const decision = await requestDuplicateDecision(existingItem, payload);

      if (decision === "cancel") {
        return null;
      }

      if (decision === "merge") {
        const response = await api.updateInventoryItem(
          collectionId,
          existingItem.id,
          mergeDuplicateInventoryPayload(existingItem, payload)
        );
        setInventory((current) => updateInventoryItem(current, response.item));
        return response.item;
      }
    }

    const response = await api.createInventoryItem(collectionId, payload);
    setInventory((current) => summarizeInventory([response.item, ...current.items]));
    return response.item;
  }

  const filteredItems = useMemo(
    () => filterInventoryItems(inventory.items, inventoryFilters),
    [inventory.items, inventoryFilters]
  );
  const filterOptions = useMemo(() => getInventoryFilterOptions(inventory.items), [inventory.items]);
  const activeFilterChips = useMemo(
    () =>
      getInventoryFilterChips(inventoryFilters, {
        onClearQuery: () =>
          setInventoryFilters((current) => ({
            ...current,
            query: ""
          })),
        onClearItemType: () =>
          setInventoryFilters((current) => ({
            ...current,
            itemType: "all"
          })),
        onClearLanguage: () =>
          setInventoryFilters((current) => ({
            ...current,
            language: "all"
          })),
        onClearVariant: (variant) =>
          setInventoryFilters((current) => ({
            ...current,
            variants: current.variants.filter((selected) => selected !== variant)
          })),
        onClearCondition: () =>
          setInventoryFilters((current) => ({
            ...current,
            conditionLabel: ""
          })),
        onClearStorage: () =>
          setInventoryFilters((current) => ({
            ...current,
            storageLocation: ""
          })),
        onClearValueStatus: () =>
          setInventoryFilters((current) => ({
            ...current,
            valueStatus: "all"
          })),
        onClearSort: () =>
          setInventoryFilters((current) => ({
            ...current,
            sort: "newest"
          }))
      }),
    [inventoryFilters]
  );
  const hasActiveInventoryFilters = activeFilterChips.length > 0;

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
            <button
              className={`icon-button ${showFilters ? "active" : ""}`}
              type="button"
              aria-label="Filter collection"
              aria-expanded={showFilters}
              onClick={() => setShowFilters((isOpen) => !isOpen)}
            >
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
            <button
              type="button"
              onClick={() => setActivePanel((panel) => (panel === "bulk" ? null : "bulk"))}
            >
              <FileText size={18} aria-hidden="true" />
              Bulk
            </button>
            <button type="button">
              <Camera size={18} aria-hidden="true" />
              Scan
            </button>
          </div>
        </form>

        {showFilters ? (
          <InventoryFilterPanel
            chips={activeFilterChips}
            filters={inventoryFilters}
            options={filterOptions}
            resultCount={filteredItems.length}
            totalCount={inventory.items.length}
            onChange={setInventoryFilters}
            onClearAll={() => setInventoryFilters(defaultInventoryFilters)}
          />
        ) : null}

        {activePanel === "lookup" && activeCollection ? (
          <CardLookupPanel
            collectionId={activeCollection.id}
            error={lookupError}
            result={lookupResult}
            status={lookupStatus}
            onCreateItem={createOrMergeInventoryItem}
            onAdded={() => {
              setActivePanel(null);
              setLookupResult(null);
              setLookupQuery("");
            }}
          />
        ) : null}

        {activePanel === "manual" && activeCollection ? (
          <ManualAddPanel
            collectionId={activeCollection.id}
            onCreateItem={createOrMergeInventoryItem}
            onAdded={() => {
              setActivePanel(null);
            }}
          />
        ) : null}

        {activePanel === "cert" && activeCollection ? (
          <PsaCertPanel
            collectionId={activeCollection.id}
            onCreateItem={createOrMergeInventoryItem}
            onAdded={() => {
              setActivePanel(null);
            }}
          />
        ) : null}

        {activePanel === "bulk" && activeCollection ? (
          <BulkLookupPanel
            collectionId={activeCollection.id}
            onCreateItem={createOrMergeInventoryItem}
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
          <>
            <div className="inventory-list-header">
              <p>
                Showing <strong>{filteredItems.length}</strong> of{" "}
                <strong>{inventory.items.length}</strong>
              </p>
              {hasActiveInventoryFilters ? (
                <button type="button" onClick={() => setInventoryFilters(defaultInventoryFilters)}>
                  Clear filters
                </button>
              ) : null}
            </div>
            {filteredItems.length > 0 ? (
              <InventoryGrid items={filteredItems} onSelect={setSelectedItem} />
            ) : (
              <section className="empty-state filtered-empty" id="collection">
                <div className="empty-copy">
                  <p className="eyebrow">No visible matches</p>
                  <h3>No cards match those filters.</h3>
                  <p>Clear a filter or adjust the search text to bring cards back into view.</p>
                </div>
              </section>
            )}
          </>
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

        {duplicateDecision ? (
          <DuplicateMergeDialog
            decision={duplicateDecision}
            onResolve={resolveDuplicateDecision}
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
  onCreateItem,
  onAdded
}: {
  collectionId: string;
  error: string;
  result: CardLookupResponse | null;
  status: "idle" | "loading";
  onCreateItem: (
    collectionId: string,
    payload: CreateInventoryItemRequest
  ) => Promise<InventoryItem | null>;
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

      const item = await onCreateItem(collectionId, payload);

      if (item) {
        onAdded(item);
      }
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
                    {displayLookupSourceId(candidate) ? <span>{candidate.sourceId}</span> : null}
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

function BulkLookupPanel({
  collectionId,
  onCreateItem
}: {
  collectionId: string;
  onCreateItem: (
    collectionId: string,
    payload: CreateInventoryItemRequest
  ) => Promise<InventoryItem | null>;
}) {
  const [mode, setMode] = useState<BulkMode>("cards");
  const [bulkText, setBulkText] = useState("");
  const [queue, setQueue] = useState<BulkQueueRow[]>([]);
  const [status, setStatus] = useState<"idle" | "searching" | "adding">("idle");
  const [currentTerm, setCurrentTerm] = useState("");
  const [error, setError] = useState("");

  const counts = summarizeBulkQueue(queue);
  const canSearch = status === "idle" && parseBulkTerms(bulkText).length > 0;
  const selectedRows = queue.filter((row) => row.status === "selected");

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setBulkText(await file.text());
  }

  async function handleSearch() {
    const terms = parseBulkTerms(bulkText);

    if (terms.length === 0) {
      setError("Add at least one line to search.");
      return;
    }

    const nextQueue = terms.map((term) => createBulkRow(term));
    setQueue(nextQueue);
    setStatus("searching");
    setError("");

    for (const row of nextQueue) {
      setCurrentTerm(row.term);
      setQueue((current) =>
        current.map((candidate) =>
          candidate.id === row.id ? { ...candidate, status: "searching" } : candidate
        )
      );

      try {
        const searchedRow =
          mode === "cards" ? await searchBulkCardRow(row) : await searchBulkPsaRow(row);
        setQueue((current) =>
          current.map((candidate) => (candidate.id === row.id ? searchedRow : candidate))
        );
      } catch (searchError) {
        setQueue((current) =>
          current.map((candidate) =>
            candidate.id === row.id
              ? {
                  ...candidate,
                  status: "failed",
                  message:
                    searchError instanceof Error ? searchError.message : "Unable to search this line."
                }
              : candidate
          )
        );
      }

      await delay(250);
    }

    setCurrentTerm("");
    setStatus("idle");
  }

  async function handleAddSelected() {
    const rowsToAdd = queue.filter((row) => row.status === "selected");

    if (rowsToAdd.length === 0) {
      return;
    }

    setStatus("adding");
    setError("");

    for (const row of rowsToAdd) {
      try {
        const payload = bulkRowPayload(row, mode);
        const item = await onCreateItem(collectionId, payload);

        if (!item) {
          setQueue((current) =>
            current.map((candidate) =>
              candidate.id === row.id
                ? { ...candidate, status: "selected", message: "Add cancelled." }
                : candidate
            )
          );
          continue;
        }

        setQueue((current) =>
          current.map((candidate) =>
            candidate.id === row.id
              ? { ...candidate, status: "added", message: "Added or merged into inventory." }
              : candidate
          )
        );
      } catch (addError) {
        setQueue((current) =>
          current.map((candidate) =>
            candidate.id === row.id
              ? {
                  ...candidate,
                  status: "failed",
                  message: addError instanceof Error ? addError.message : "Unable to add this row."
                }
              : candidate
          )
        );
      }

      await delay(100);
    }

    setStatus("idle");
  }

  function handleModeChange(nextMode: BulkMode) {
    setMode(nextMode);
    setQueue([]);
    setError("");
    setCurrentTerm("");
  }

  function updateSelectedCandidate(rowId: string, candidateId: string) {
    setQueue((current) =>
      current.map((row) =>
        row.id === rowId
          ? {
              ...row,
              selectedCandidateId: candidateId,
              status: candidateId ? "selected" : "needs-review",
              message: candidateId ? "Selected for bulk add." : "Choose a candidate."
            }
          : row
      )
    );
  }

  function skipRow(rowId: string) {
    setQueue((current) =>
      current.map((row) =>
        row.id === rowId ? { ...row, status: "skipped", message: "Skipped." } : row
      )
    );
  }

  return (
    <section className="manual-panel bulk-panel" aria-label="Bulk lookup">
      <div className="bulk-header">
        <div>
          <p className="eyebrow">Bulk lookup</p>
          <h3>Search a newline list</h3>
        </div>
        <div className="bulk-mode-switch" aria-label="Bulk mode">
          <button
            className={mode === "cards" ? "selected" : ""}
            disabled={status !== "idle"}
            onClick={() => handleModeChange("cards")}
            type="button"
          >
            Card search list
          </button>
          <button
            className={mode === "psa" ? "selected" : ""}
            disabled={status !== "idle"}
            onClick={() => handleModeChange("psa")}
            type="button"
          >
            PSA cert list
          </button>
        </div>
      </div>

      <div className="bulk-input-grid">
        <label>
          Paste lines
          <textarea
            disabled={status !== "idle"}
            onChange={(event) => setBulkText(event.target.value)}
            placeholder={mode === "cards" ? "123/162\n165/132\n001/202" : "59711010\n55238572"}
            value={bulkText}
          />
        </label>
        <div className="bulk-file-box">
          <label>
            Upload .txt
            <input
              accept=".txt,text/plain"
              disabled={status !== "idle"}
              onChange={handleFileUpload}
              type="file"
            />
          </label>
          <p>
            {parseBulkTerms(bulkText).length} unique line
            {parseBulkTerms(bulkText).length === 1 ? "" : "s"} ready
          </p>
        </div>
      </div>

      <div className="bulk-actions">
        <button className="primary-button" disabled={!canSearch} onClick={handleSearch} type="button">
          {status === "searching" ? "Searching..." : "Start bulk lookup"}
        </button>
        <button disabled={status !== "idle" || selectedRows.length === 0} onClick={handleAddSelected} type="button">
          {status === "adding" ? "Adding..." : `Add selected (${selectedRows.length})`}
        </button>
        <button
          disabled={status !== "idle" || queue.length === 0}
          onClick={() =>
            setQueue((current) =>
              current.map((row) =>
                row.status === "failed" ? { ...row, status: "skipped", message: "Skipped." } : row
              )
            )
          }
          type="button"
        >
          Skip failed
        </button>
        <button
          disabled={status !== "idle"}
          onClick={() => {
            setBulkText("");
            setQueue([]);
            setError("");
            setCurrentTerm("");
          }}
          type="button"
        >
          Clear list
        </button>
      </div>

      {queue.length > 0 ? (
        <div className="bulk-progress">
          <span>
            {counts.done} / {queue.length} searched
          </span>
          <span>{counts.selected} ready</span>
          <span>{counts.review} review</span>
          <span>{counts.failed} failed</span>
          <span>{counts.skipped} skipped</span>
          {currentTerm ? <strong>Searching {currentTerm}</strong> : null}
        </div>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}

      {queue.length > 0 ? (
        <div className="bulk-results">
          {queue.map((row) => (
            <BulkQueueCard
              key={row.id}
              mode={mode}
              row={row}
              onSelectCandidate={updateSelectedCandidate}
              onSkip={skipRow}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function BulkQueueCard({
  mode,
  row,
  onSelectCandidate,
  onSkip
}: {
  mode: BulkMode;
  row: BulkQueueRow;
  onSelectCandidate: (rowId: string, candidateId: string) => void;
  onSkip: (rowId: string) => void;
}) {
  const selectedCandidate = row.candidates.find((candidate) => candidate.id === row.selectedCandidateId);

  return (
    <article className={`bulk-row ${row.status}`}>
      <div className="bulk-row-thumb" aria-hidden="true">
        {selectedCandidate?.imageUrl ? (
          <img alt="" src={selectedCandidate.imageUrl} />
        ) : row.psaItem?.imageUrl ? (
          <img alt="" src={row.psaItem.imageUrl} />
        ) : (
          <Gem size={28} />
        )}
      </div>

      <div className="bulk-row-body">
        <div className="bulk-row-header">
          <div>
            <p className="eyebrow">{row.status}</p>
            <h4>{row.term}</h4>
            <p>{row.message}</p>
          </div>
          {["selected", "needs-review", "failed"].includes(row.status) ? (
            <button onClick={() => onSkip(row.id)} type="button">
              Skip
            </button>
          ) : null}
        </div>

        {mode === "cards" && row.candidates.length > 0 ? (
          <>
            <label className="bulk-select">
              Candidate
              <select
                disabled={["added", "skipped", "searching"].includes(row.status)}
                onChange={(event) => onSelectCandidate(row.id, event.target.value)}
                value={row.selectedCandidateId}
              >
                <option value="">Choose a match</option>
                {row.candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name} · {[candidate.setCode, candidate.cardNumber, candidate.setName]
                      .filter(Boolean)
                      .join(" · ")} · {candidate.confidence}
                  </option>
                ))}
              </select>
            </label>
            {selectedCandidate ? (
              <div className="inventory-meta">
                <span>{selectedCandidate.language.toUpperCase()}</span>
                <span>{selectedCandidate.confidence}</span>
                {selectedCandidate.rarity ? <span>{selectedCandidate.rarity}</span> : null}
              </div>
            ) : null}
          </>
        ) : null}

        {mode === "psa" && row.psaItem ? (
          <div className="inventory-meta">
            <span>{row.psaItem.name}</span>
            {row.psaItem.grade ? <span>PSA {row.psaItem.grade}</span> : null}
            {row.psaItem.certNumber ? <span>Cert {row.psaItem.certNumber}</span> : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function PsaCertPanel({
  collectionId,
  onCreateItem,
  onAdded
}: {
  collectionId: string;
  onCreateItem: (
    collectionId: string,
    payload: CreateInventoryItemRequest
  ) => Promise<InventoryItem | null>;
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
      const item = await onCreateItem(collectionId, lookup.item);

      if (item) {
        onAdded(item);
      }
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
  onCreateItem,
  onAdded
}: {
  collectionId: string;
  onCreateItem: (
    collectionId: string,
    payload: CreateInventoryItemRequest
  ) => Promise<InventoryItem | null>;
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

      const item = await onCreateItem(collectionId, payload);

      if (item) {
        onAdded(item);
        event.currentTarget.reset();
        setItemType("raw");
        setLanguage("en");
      }
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

function InventoryFilterPanel({
  chips,
  filters,
  options,
  resultCount,
  totalCount,
  onChange,
  onClearAll
}: {
  chips: InventoryFilterChip[];
  filters: InventoryFilterState;
  options: InventoryFilterOptions;
  resultCount: number;
  totalCount: number;
  onChange: React.Dispatch<React.SetStateAction<InventoryFilterState>>;
  onClearAll: () => void;
}) {
  function updateFilter(next: Partial<InventoryFilterState>) {
    onChange((current) => ({
      ...current,
      ...next
    }));
  }

  function toggleVariant(variant: string) {
    onChange((current) => {
      const isSelected = current.variants.includes(variant);

      return {
        ...current,
        variants: isSelected
          ? current.variants.filter((selected) => selected !== variant)
          : [...current.variants, variant]
      };
    });
  }

  return (
    <section className="filter-panel" aria-label="Inventory filters">
      <div className="filter-panel-header">
        <div>
          <p className="eyebrow">Inventory filters</p>
          <h3>Find cards you already own</h3>
        </div>
        <p>
          Showing <strong>{resultCount}</strong> of <strong>{totalCount}</strong>
        </p>
      </div>

      <div className="filter-grid">
        <label className="wide-field">
          Search inventory
          <input
            onChange={(event) => updateFilter({ query: event.target.value })}
            placeholder="Name, set, number, cert, storage, notes..."
            value={filters.query}
          />
        </label>
        <label>
          Type
          <select
            onChange={(event) =>
              updateFilter({ itemType: event.target.value as InventoryItemType | "all" })
            }
            value={filters.itemType}
          >
            <option value="all">All cards</option>
            <option value="raw">Raw</option>
            <option value="graded">Graded</option>
          </select>
        </label>
        <label>
          Language
          <select
            onChange={(event) =>
              updateFilter({ language: event.target.value as CardLanguage | "all" })
            }
            value={filters.language}
          >
            <option value="all">All languages</option>
            <option value="en">English</option>
            <option value="ja">Japanese</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          Condition
          <select
            onChange={(event) => updateFilter({ conditionLabel: event.target.value })}
            value={filters.conditionLabel}
          >
            <option value="">Any condition</option>
            {options.conditions.map((condition) => (
              <option key={condition} value={condition}>
                {condition}
              </option>
            ))}
          </select>
        </label>
        <label>
          Storage
          <select
            onChange={(event) => updateFilter({ storageLocation: event.target.value })}
            value={filters.storageLocation}
          >
            <option value="">Any storage</option>
            {options.storageLocations.map((storage) => (
              <option key={storage} value={storage}>
                {storage}
              </option>
            ))}
          </select>
        </label>
        <label>
          Value
          <select
            onChange={(event) =>
              updateFilter({ valueStatus: event.target.value as InventoryValueFilter })
            }
            value={filters.valueStatus}
          >
            <option value="all">Any value</option>
            <option value="with-value">Has value</option>
            <option value="missing-value">Missing value</option>
          </select>
        </label>
        <label>
          Sort
          <select
            onChange={(event) => updateFilter({ sort: event.target.value as InventorySortMode })}
            value={filters.sort}
          >
            <option value="newest">Newest first</option>
            <option value="name">Name A-Z</option>
            <option value="set">Set/code</option>
            <option value="value">Highest value</option>
            <option value="quantity">Quantity</option>
          </select>
        </label>
      </div>

      <div className="filter-variants" aria-label="Variant filters">
        {variantOptions.map((variant) => (
          <button
            className={filters.variants.includes(variant) ? "selected" : ""}
            key={variant}
            onClick={() => toggleVariant(variant)}
            type="button"
          >
            {variant}
          </button>
        ))}
      </div>

      {chips.length > 0 ? (
        <div className="active-filters" aria-label="Active filters">
          {chips.map((chip) => (
            <button key={chip.key} onClick={chip.onRemove} type="button">
              <span>{chip.label}</span>
              <X size={14} aria-hidden="true" />
            </button>
          ))}
          <button className="clear-filter-button" onClick={onClearAll} type="button">
            Clear all
          </button>
        </div>
      ) : null}
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

function DuplicateMergeDialog({
  decision,
  onResolve
}: {
  decision: PendingDuplicateDecision;
  onResolve: (choice: DuplicateDecisionChoice) => void;
}) {
  const incomingQuantity = normalizeQuantity(decision.payload.quantity);
  const existingItem = decision.existingItem;
  const mergedQuantity = Math.min(999, existingItem.quantity + incomingQuantity);

  return (
    <div className="detail-backdrop" role="presentation">
      <section
        aria-labelledby={`duplicate-title-${decision.id}`}
        className="detail-panel duplicate-panel"
        role="dialog"
      >
        <div className="detail-header">
          <div>
            <p className="eyebrow">Possible duplicate</p>
            <h3 id={`duplicate-title-${decision.id}`}>This card looks familiar</h3>
          </div>
          <button
            aria-label="Cancel duplicate add"
            className="icon-button"
            onClick={() => onResolve("cancel")}
            type="button"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="duplicate-match">
          <div className="detail-image" aria-hidden="true">
            {existingItem.card.imageUrl ? (
              <img alt="" src={existingItem.card.imageUrl} />
            ) : (
              <Gem size={36} />
            )}
          </div>
          <div>
            <p className="eyebrow">
              {existingItem.card.language.toUpperCase()} · {existingItem.itemType}
            </p>
            <h4>{existingItem.card.name}</h4>
            <p>
              {[existingItem.card.setCode, existingItem.card.cardNumber, existingItem.card.setName]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <div className="inventory-meta">
              <span>Current qty {existingItem.quantity}</span>
              {existingItem.conditionLabel ? <span>{existingItem.conditionLabel}</span> : null}
              {existingItem.variantDetails ? <span>{existingItem.variantDetails}</span> : null}
              {existingItem.certNumber ? <span>Cert {existingItem.certNumber}</span> : null}
            </div>
          </div>
        </div>

        <p className="lookup-note">
          Do you want to increase this row to qty {mergedQuantity}, or keep this as a separate
          copy?
        </p>

        <div className="detail-actions">
          <button className="primary-button" onClick={() => onResolve("merge")} type="button">
            Increase quantity
          </button>
          <button onClick={() => onResolve("separate")} type="button">
            Add separate copy
          </button>
          <button onClick={() => onResolve("cancel")} type="button">
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

function GradedCertSummary({
  item,
  isRefreshing,
  onRefresh
}: {
  item: InventoryItem;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  const canRefreshPsa = item.grader === "PSA" && Boolean(item.certNumber);
  const lookupDate = item.certLookupAt ? new Date(item.certLookupAt) : null;
  const lookupLabel =
    lookupDate && !Number.isNaN(lookupDate.getTime())
      ? lookupDate.toLocaleDateString()
      : null;

  return (
    <section className="graded-cert-panel" aria-label="Graded cert details">
      <div className="graded-cert-header">
        <div>
          <p className="eyebrow">Slab details</p>
          <h4>
            {[item.grader, item.grade].filter(Boolean).join(" ") || "Graded card"}
          </h4>
        </div>
        <div className="graded-cert-actions">
          {item.certUrl ? (
            <a href={item.certUrl} rel="noreferrer" target="_blank">
              <ExternalLink size={16} aria-hidden="true" />
              Cert
            </a>
          ) : null}
          {canRefreshPsa ? (
            <button disabled={isRefreshing} onClick={onRefresh} type="button">
              <RefreshCw size={16} aria-hidden="true" />
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="graded-cert-stats">
        <div>
          <span>Cert #</span>
          <strong>{item.certNumber || "Not set"}</strong>
        </div>
        <div>
          <span>Population</span>
          <strong>{item.certPopulation ?? "Unknown"}</strong>
        </div>
        <div>
          <span>Pop higher</span>
          <strong>{item.certPopulationHigher ?? "Unknown"}</strong>
        </div>
      </div>

      <div className="inventory-meta">
        {item.certSpecId ? <span>Spec {item.certSpecId}</span> : null}
        {item.certCategory ? <span>{item.certCategory}</span> : null}
        {lookupLabel ? <span>Updated {lookupLabel}</span> : null}
      </div>
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
  const [status, setStatus] = useState<"idle" | "saving" | "deleting" | "refreshing">("idle");
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
    const form = event.currentTarget;
    setError("");
    setStatus("saving");

    try {
      const formData = new FormData(form);
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
        notes: String(formData.get("notes") ?? ""),
        certUrl: itemType === "graded" ? item.certUrl ?? "" : "",
        certSpecId: itemType === "graded" ? item.certSpecId ?? "" : "",
        certCategory: itemType === "graded" ? item.certCategory ?? "" : "",
        certPopulation: itemType === "graded" ? item.certPopulation ?? "" : "",
        certPopulationHigher: itemType === "graded" ? item.certPopulationHigher ?? "" : "",
        certEstimateCents: itemType === "graded" ? item.certEstimateCents ?? undefined : undefined,
        certLookupAt: itemType === "graded" ? item.certLookupAt ?? "" : ""
      });

      onUpdated(response.item);
      form.reset();
      onClose();
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

  async function handleRefreshCert() {
    if (item.grader !== "PSA" || !item.certNumber) {
      setError("Only PSA certs can be refreshed right now.");
      return;
    }

    setError("");
    setStatus("refreshing");

    try {
      const lookup = await api.lookupPsaCert({ certNumber: item.certNumber });

      if (!lookup.item) {
        throw new Error(lookup.serverMessage || "PSA did not return cert details.");
      }

      const response = await api.updateInventoryItem(
        collectionId,
        item.id,
        mergeCertRefreshPayload(item, lookup.item)
      );
      onUpdated(mergeCertLookupIntoInventoryItem(response.item, lookup));
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Unable to refresh PSA cert.");
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

            {itemType === "graded" ? (
              <GradedCertSummary
                item={item}
                isRefreshing={status === "refreshing"}
                onRefresh={handleRefreshCert}
              />
            ) : null}

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

function displayLookupSourceId(candidate: CardLookupCandidate) {
  if (candidate.source === "japanese-cache") {
    return false;
  }

  return Boolean(candidate.sourceId);
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

function findDuplicateInventoryItem(
  items: InventoryItem[],
  payload: CreateInventoryItemRequest
) {
  return items.find((item) => inventoryDuplicateKey(item) === payloadDuplicateKey(payload));
}

function mergeDuplicateInventoryPayload(
  existingItem: InventoryItem,
  payload: CreateInventoryItemRequest
): CreateInventoryItemRequest {
  const existingPayload = inventoryItemToPayload(existingItem);

  return {
    ...existingPayload,
    quantity: Math.min(999, existingItem.quantity + normalizeQuantity(payload.quantity)),
    imageUrl: existingItem.card.imageUrl || payload.imageUrl || ""
  };
}

function inventoryItemToPayload(item: InventoryItem): CreateInventoryItemRequest {
  return {
    name: item.card.name,
    setName: item.card.setName ?? "",
    setCode: item.card.setCode ?? "",
    cardNumber: item.card.cardNumber ?? "",
    language: item.card.language,
    rarity: item.card.rarity ?? "",
    imageUrl: item.card.imageUrl ?? "",
    itemType: item.itemType,
    quantity: item.quantity,
    conditionLabel: item.conditionLabel ?? "",
    conditionScore: item.conditionScore ?? undefined,
    variantDetails: item.variantDetails ?? "",
    grader: item.grader ?? "",
    grade: item.grade ?? "",
    certNumber: item.certNumber ?? "",
    purchasePriceCents: item.purchasePriceCents ?? undefined,
    purchaseDate: item.purchaseDate ?? "",
    valueOverrideCents: item.valueOverrideCents ?? undefined,
    storageLocation: item.storageLocation ?? "",
    notes: item.notes ?? "",
    certUrl: item.certUrl ?? "",
    certSpecId: item.certSpecId ?? "",
    certCategory: item.certCategory ?? "",
    certPopulation: item.certPopulation ?? "",
    certPopulationHigher: item.certPopulationHigher ?? "",
    certEstimateCents: item.certEstimateCents ?? undefined,
    certLookupAt: item.certLookupAt ?? ""
  };
}

function mergeCertRefreshPayload(
  item: InventoryItem,
  certPayload: CreateInventoryItemRequest
): CreateInventoryItemRequest {
  const current = inventoryItemToPayload(item);

  return {
    ...current,
    name: certPayload.name || current.name,
    setName: certPayload.setName ?? current.setName,
    cardNumber: certPayload.cardNumber ?? current.cardNumber,
    rarity: certPayload.rarity ?? current.rarity,
    imageUrl: current.imageUrl || certPayload.imageUrl || "",
    grader: certPayload.grader ?? current.grader,
    grade: certPayload.grade ?? current.grade,
    certNumber: certPayload.certNumber ?? current.certNumber,
    variantDetails: certPayload.variantDetails ?? current.variantDetails,
    certUrl: certPayload.certUrl ?? current.certUrl,
    certSpecId: certPayload.certSpecId ?? current.certSpecId,
    certCategory: certPayload.certCategory ?? current.certCategory,
    certPopulation: certPayload.certPopulation ?? current.certPopulation,
    certPopulationHigher: certPayload.certPopulationHigher ?? current.certPopulationHigher,
    certEstimateCents: certPayload.certEstimateCents ?? current.certEstimateCents,
    certLookupAt: certPayload.certLookupAt ?? current.certLookupAt
  };
}

function mergeCertLookupIntoInventoryItem(
  item: InventoryItem,
  lookup: PsaCertLookupResponse
): InventoryItem {
  const source = lookup.source;

  return {
    ...item,
    certUrl: item.certUrl ?? `https://www.psacard.com/cert/${lookup.certNumber}/psa`,
    certSpecId: item.certSpecId ?? source.specId,
    certCategory: item.certCategory ?? source.category,
    certPopulation: item.certPopulation ?? source.population,
    certPopulationHigher: item.certPopulationHigher ?? source.populationHigher,
    certEstimateCents:
      item.certEstimateCents ??
      (typeof source.estimateCents === "number" && Number.isFinite(source.estimateCents)
        ? source.estimateCents
        : null),
    certLookupAt: item.certLookupAt ?? new Date().toISOString()
  };
}

function inventoryDuplicateKey(item: InventoryItem) {
  return [
    item.itemType,
    normalizeText(item.card.language),
    normalizeText(item.card.name),
    normalizeText(item.card.setCode),
    normalizeCardNumber(item.card.cardNumber),
    normalizeText(item.conditionLabel),
    normalizeVariantDetails(item.variantDetails),
    normalizeText(item.grader),
    normalizeText(item.grade),
    normalizeText(item.certNumber)
  ].join("|");
}

function payloadDuplicateKey(payload: CreateInventoryItemRequest) {
  return [
    payload.itemType,
    normalizeText(payload.language),
    normalizeText(payload.name),
    normalizeText(payload.setCode),
    normalizeCardNumber(payload.cardNumber),
    normalizeText(payload.conditionLabel),
    normalizeVariantDetails(payload.variantDetails),
    normalizeText(payload.grader),
    normalizeText(payload.grade),
    normalizeText(payload.certNumber)
  ].join("|");
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeCardNumber(value: unknown) {
  return normalizeText(value).replace(/\b0+(\d)/g, "$1");
}

function normalizeVariantDetails(value: unknown) {
  return normalizeText(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .sort()
    .join(",");
}

function normalizeQuantity(value: unknown) {
  const quantity = Number(value);
  return Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
}

function parseBulkTerms(value: string) {
  const seen = new Set<string>();
  const terms: string[] = [];

  for (const line of value.split(/\r?\n/)) {
    const term = line.trim();

    if (!term || seen.has(term)) {
      continue;
    }

    seen.add(term);
    terms.push(term);
  }

  return terms;
}

function createBulkRow(term: string): BulkQueueRow {
  return {
    id: crypto.randomUUID(),
    term,
    status: "pending",
    candidates: [],
    selectedCandidateId: "",
    psaItem: null,
    message: "Waiting to search."
  };
}

async function searchBulkCardRow(row: BulkQueueRow): Promise<BulkQueueRow> {
  const result = await api.lookupCards({
    query: row.term,
    language: "all"
  });
  const exactCandidates = result.candidates.filter((candidate) => candidate.confidence === "exact");

  if (exactCandidates.length === 1) {
    return {
      ...row,
      candidates: result.candidates,
      selectedCandidateId: exactCandidates[0].id,
      status: "selected",
      message: "One exact match auto-selected."
    };
  }

  if (result.candidates.length > 0) {
    return {
      ...row,
      candidates: result.candidates,
      selectedCandidateId: "",
      status: "needs-review",
      message:
        exactCandidates.length > 1
          ? "Multiple exact matches. Choose the right card."
          : "Choose the best available match."
    };
  }

  return {
    ...row,
    status: "failed",
    message: "No matches found."
  };
}

async function searchBulkPsaRow(row: BulkQueueRow): Promise<BulkQueueRow> {
  const result = await api.lookupPsaCert({ certNumber: row.term });

  if (result.item) {
    return {
      ...row,
      status: "selected",
      psaItem: result.item,
      message: "Valid PSA cert staged for import."
    };
  }

  return {
    ...row,
    status: "failed",
    message: result.serverMessage || "PSA cert did not return an importable card."
  };
}

function bulkRowPayload(row: BulkQueueRow, mode: BulkMode): CreateInventoryItemRequest {
  if (mode === "psa" && row.psaItem) {
    return row.psaItem;
  }

  const selectedCandidate = row.candidates.find(
    (candidate) => candidate.id === row.selectedCandidateId
  );

  if (!selectedCandidate) {
    throw new Error("Choose a card before adding this row.");
  }

  return {
    ...selectedCandidate.item,
    itemType: "raw",
    notes: [
      selectedCandidate.item.notes,
      `Bulk import term: ${row.term}`,
      `Lookup confidence: ${selectedCandidate.confidence}`
    ]
      .filter(Boolean)
      .join("\n")
  };
}

function summarizeBulkQueue(queue: BulkQueueRow[]) {
  return queue.reduce(
    (summary, row) => {
      if (!["pending", "searching"].includes(row.status)) {
        summary.done += 1;
      }

      if (row.status === "selected") {
        summary.selected += 1;
      }

      if (row.status === "needs-review") {
        summary.review += 1;
      }

      if (row.status === "failed") {
        summary.failed += 1;
      }

      if (row.status === "skipped") {
        summary.skipped += 1;
      }

      return summary;
    },
    {
      done: 0,
      selected: 0,
      review: 0,
      failed: 0,
      skipped: 0
    }
  );
}

function filterInventoryItems(items: InventoryItem[], filters: InventoryFilterState) {
  const queryTokens = normalizeSearchText(filters.query).split(" ").filter(Boolean);
  const filtered = items.filter((item) => {
    if (filters.itemType !== "all" && item.itemType !== filters.itemType) {
      return false;
    }

    if (filters.language !== "all" && item.card.language !== filters.language) {
      return false;
    }

    if (filters.conditionLabel && item.conditionLabel !== filters.conditionLabel) {
      return false;
    }

    if (filters.storageLocation && item.storageLocation !== filters.storageLocation) {
      return false;
    }

    const hasValue = item.valueOverrideCents !== null || item.purchasePriceCents !== null;

    if (filters.valueStatus === "with-value" && !hasValue) {
      return false;
    }

    if (filters.valueStatus === "missing-value" && hasValue) {
      return false;
    }

    const itemVariants = variantsFromText(item.variantDetails ?? "");

    if (
      filters.variants.length > 0 &&
      !filters.variants.every((variant) => itemVariants.includes(variant))
    ) {
      return false;
    }

    if (queryTokens.length === 0) {
      return true;
    }

    const haystack = normalizeSearchText(
      [
        item.card.name,
        item.card.setName,
        item.card.setCode,
        item.card.cardNumber,
        item.certNumber,
        item.storageLocation,
        item.notes,
        item.grader,
        item.grade,
        item.certUrl,
        item.certSpecId,
        item.certCategory,
        item.certPopulation,
        item.certPopulationHigher,
        item.card.rarity,
        item.variantDetails,
        item.conditionLabel
      ]
        .filter(Boolean)
        .join(" ")
    );

    return queryTokens.every((token) => haystack.includes(token));
  });

  return filtered.sort((left, right) => compareInventoryItems(left, right, filters.sort));
}

function compareInventoryItems(left: InventoryItem, right: InventoryItem, sort: InventorySortMode) {
  if (sort === "name") {
    return left.card.name.localeCompare(right.card.name, undefined, { sensitivity: "base" });
  }

  if (sort === "set") {
    const leftSet = [left.card.setCode, left.card.cardNumber, left.card.name].filter(Boolean).join(" ");
    const rightSet = [right.card.setCode, right.card.cardNumber, right.card.name].filter(Boolean).join(" ");

    return leftSet.localeCompare(rightSet, undefined, { numeric: true, sensitivity: "base" });
  }

  if (sort === "value") {
    return inventoryItemValue(right) - inventoryItemValue(left);
  }

  if (sort === "quantity") {
    return right.quantity - left.quantity;
  }

  return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
}

function getInventoryFilterOptions(items: InventoryItem[]): InventoryFilterOptions {
  return {
    conditions: uniqueSorted(items.map((item) => item.conditionLabel)),
    storageLocations: uniqueSorted(items.map((item) => item.storageLocation))
  };
}

function getInventoryFilterChips(
  filters: InventoryFilterState,
  actions: {
    onClearQuery: () => void;
    onClearItemType: () => void;
    onClearLanguage: () => void;
    onClearVariant: (variant: string) => void;
    onClearCondition: () => void;
    onClearStorage: () => void;
    onClearValueStatus: () => void;
    onClearSort: () => void;
  }
): InventoryFilterChip[] {
  const chips: InventoryFilterChip[] = [];

  if (filters.query.trim()) {
    chips.push({
      key: "query",
      label: `Search: ${filters.query.trim()}`,
      onRemove: actions.onClearQuery
    });
  }

  if (filters.itemType !== "all") {
    chips.push({
      key: "type",
      label: filters.itemType === "raw" ? "Raw" : "Graded",
      onRemove: actions.onClearItemType
    });
  }

  if (filters.language !== "all") {
    chips.push({
      key: "language",
      label: languageLabel(filters.language),
      onRemove: actions.onClearLanguage
    });
  }

  for (const variant of filters.variants) {
    chips.push({
      key: `variant-${variant}`,
      label: variant,
      onRemove: () => actions.onClearVariant(variant)
    });
  }

  if (filters.conditionLabel) {
    chips.push({
      key: "condition",
      label: filters.conditionLabel,
      onRemove: actions.onClearCondition
    });
  }

  if (filters.storageLocation) {
    chips.push({
      key: "storage",
      label: `Storage: ${filters.storageLocation}`,
      onRemove: actions.onClearStorage
    });
  }

  if (filters.valueStatus !== "all") {
    chips.push({
      key: "value",
      label: filters.valueStatus === "with-value" ? "Has value" : "Missing value",
      onRemove: actions.onClearValueStatus
    });
  }

  if (filters.sort !== "newest") {
    chips.push({
      key: "sort",
      label: `Sort: ${sortLabel(filters.sort)}`,
      onRemove: actions.onClearSort
    });
  }

  return chips;
}

function uniqueSorted(values: Array<string | null>) {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])].sort(
    (left, right) => left.localeCompare(right, undefined, { sensitivity: "base" })
  );
}

function inventoryItemValue(item: InventoryItem) {
  return (item.valueOverrideCents ?? item.purchasePriceCents ?? 0) * item.quantity;
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function languageLabel(language: CardLanguage) {
  if (language === "en") {
    return "English";
  }

  if (language === "ja") {
    return "Japanese";
  }

  return "Other language";
}

function sortLabel(sort: InventorySortMode) {
  if (sort === "name") {
    return "Name A-Z";
  }

  if (sort === "set") {
    return "Set/code";
  }

  if (sort === "value") {
    return "Highest value";
  }

  if (sort === "quantity") {
    return "Quantity";
  }

  return "Newest first";
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

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
