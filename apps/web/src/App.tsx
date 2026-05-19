import {
  AlertTriangle,
  BarChart3,
  ChevronDown,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Database,
  Download,
  ExternalLink,
  FileText,
  Gem,
  Grid2X2,
  HardDriveDownload,
  Image as ImageIcon,
  ListFilter,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Tags,
  Trash2,
  Upload,
  X,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AuthMeResponse,
  AuthUser,
  BulkPriceQueueResponse,
  BulkVariantEditMode,
  CardLanguage,
  CardLookupCandidate,
  CardLookupResponse,
  CollectionSummary,
  CreateInventoryItemRequest,
  InventoryItem,
  InventoryItemType,
  InventoryListResponse,
  PricingCandidate,
  PricingHistoryPoint,
  PsaCertLookupResponse,
  ValueOverrideHistoryEntry
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

type InventoryTagFilter =
  | { type: "query"; label: string; value: string }
  | { type: "itemType"; label: string; value: InventoryItemType }
  | { type: "language"; label: string; value: CardLanguage }
  | { type: "variant"; label: string; value: string }
  | { type: "storage"; label: string; value: string };

type InventoryGroupSummary = {
  key: string;
  label: string;
  count: number;
  valueCents: number;
  examples: string;
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

type CsvImportRowStatus = "ready" | "error" | "adding" | "added" | "skipped";

type CsvImportPreviewRow = {
  id: string;
  lineNumber: number;
  raw: Record<string, string>;
  payload: CreateInventoryItemRequest;
  errors: string[];
  status: CsvImportRowStatus;
};

type DuplicateDecisionChoice = "merge" | "separate" | "cancel";
type WorkspaceSection = "collection" | "graded" | "storage" | "data";

type PendingDuplicateDecision = {
  id: string;
  existingItem: InventoryItem;
  payload: CreateInventoryItemRequest;
  resolve: (choice: DuplicateDecisionChoice) => void;
};

const variantOptions = [
  "Standard",
  "Holo / Foil",
  "Reverse Holo",
  "Stamped",
  "1st Edition",
  "Shadowless",
  "Promo",
  "Error",
  "Misprint",
  "Other"
];

const workspaceNavItems = [
  { section: "collection", label: "Collection", icon: Grid2X2 },
  { section: "graded", label: "Graded cards", icon: ShieldCheck },
  { section: "storage", label: "Storage", icon: Tags },
  { section: "data", label: "Data", icon: Database }
] satisfies Array<{
  section: WorkspaceSection;
  label: string;
  icon: typeof Grid2X2;
}>;

const showMarketPriceHistoryPanel = false;

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

function workspaceSectionMeta(
  section: WorkspaceSection,
  counts: { totalCards: number; gradedRows: number; storageGroups: number }
) {
  if (section === "graded") {
    return {
      eyebrow: "Slabs and certs",
      title: "Graded cards",
      description: `${counts.gradedRows} graded row${
        counts.gradedRows === 1 ? "" : "s"
      } with cert details, market pricing, and price history.`
    };
  }

  if (section === "storage") {
    return {
      eyebrow: "Organization",
      title: "Storage and variants",
      description: `${counts.storageGroups} storage group${
        counts.storageGroups === 1 ? "" : "s"
      } across ${counts.totalCards} card${counts.totalCards === 1 ? "" : "s"}.`
    };
  }

  if (section === "data") {
    return {
      eyebrow: "Maintenance",
      title: "Data tools",
      description: "Export inventory, import CSV rows, back up SQLite, and monitor price jobs."
    };
  }

  return {
    eyebrow: "Inventory",
    title: "Collection workspace",
    description: "Lookup, import, edit, price, and organize the cards in this local collection."
  };
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
  const [activeCollectionId, setActiveCollectionId] = useState(collections[0]?.id ?? "");
  const activeCollection =
    collections.find((collection) => collection.id === activeCollectionId) ?? collections[0];
  const [activeSection, setActiveSection] = useState<WorkspaceSection>("collection");
  const [showCollectionMenu, setShowCollectionMenu] = useState(false);
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
  const [activePanel, setActivePanel] = useState<
    "lookup" | "manual" | "cert" | "bulk" | "import" | null
  >(null);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [inventoryFilters, setInventoryFilters] =
    useState<InventoryFilterState>(defaultInventoryFilters);
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupLanguage, setLookupLanguage] = useState<CardLanguage | "all">("all");
  const [lookupResult, setLookupResult] = useState<CardLookupResponse | null>(null);
  const [lookupStatus, setLookupStatus] = useState<"idle" | "loading">("idle");
  const [lookupError, setLookupError] = useState("");
  const [exportStatus, setExportStatus] = useState<"idle" | "loading" | "error">("idle");
  const [backupStatus, setBackupStatus] = useState<"idle" | "loading" | "error">("idle");
  const [dataActionMessage, setDataActionMessage] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [bulkPriceQueue, setBulkPriceQueue] = useState<BulkPriceQueueResponse | null>(null);
  const [bulkPriceStatus, setBulkPriceStatus] = useState<"idle" | "loading" | "error">("idle");
  const [bulkPriceMessage, setBulkPriceMessage] = useState("");
  const [bulkPriceIncludeExisting, setBulkPriceIncludeExisting] = useState(false);
  const [bulkVariantEditorOpen, setBulkVariantEditorOpen] = useState(false);
  const [bulkVariantStatus, setBulkVariantStatus] = useState<"idle" | "loading" | "error">("idle");
  const [bulkVariantMessage, setBulkVariantMessage] = useState("");
  const [bulkVariantMode, setBulkVariantMode] = useState<BulkVariantEditMode>("add");
  const [bulkVariantValues, setBulkVariantValues] = useState<string[]>([]);
  const [bulkVariantClearMarketPrices, setBulkVariantClearMarketPrices] = useState(true);
  const [duplicateDecision, setDuplicateDecision] = useState<PendingDuplicateDecision | null>(null);
  const inventoryRef = useRef(inventory);
  const activeBulkPriceJobCount = bulkPriceQueue
    ? bulkPriceQueue.summary.queued +
      bulkPriceQueue.summary.running +
      bulkPriceQueue.summary.rateLimited
    : 0;

  useEffect(() => {
    const firstCollection = collections[0];

    if (!firstCollection) {
      setActiveCollectionId("");
      return;
    }

    if (!collections.some((collection) => collection.id === activeCollectionId)) {
      setActiveCollectionId(firstCollection.id);
    }
  }, [activeCollectionId, collections]);

  useEffect(() => {
    setActivePanel(null);
    setSelectedItem(null);
    setShowFilters(false);
    setShowCollectionMenu(false);
    setInventoryFilters(defaultInventoryFilters);
    setLookupQuery("");
    setLookupResult(null);
    setLookupError("");
    setSelectionMode(false);
    setSelectedItemIds([]);
    setBulkVariantEditorOpen(false);
    setBulkVariantMessage("");
    setBulkPriceMessage("");
    setDataActionMessage("");
  }, [activeCollection?.id]);

  useEffect(() => {
    if (!activeCollection) {
      setInventory({
        items: [],
        summary: {
          itemCount: 0,
          cardCount: 0,
          estimatedValueCents: 0
        }
      });
      return;
    }

    let cancelled = false;
    setInventoryStatus("loading");
    setInventoryError("");
    setInventory({
      items: [],
      summary: {
        itemCount: 0,
        cardCount: activeCollection.cardCount,
        estimatedValueCents: activeCollection.estimatedValueCents
      }
    });

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
    if (!activeCollection || activeBulkPriceJobCount === 0) {
      return;
    }

    let cancelled = false;
    const interval = window.setInterval(() => {
      if (bulkPriceStatus === "loading") {
        return;
      }

      api
        .getBulkPriceQueue(activeCollection.id)
        .then((response) => {
          if (!cancelled) {
            applyBulkPriceQueueResponse(response);
          }
        })
        .catch(() => {
          // Keep the last visible queue state; action handlers still surface errors.
        });
    }, 30000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeCollection?.id, activeBulkPriceJobCount, bulkPriceStatus]);

  useEffect(() => {
    inventoryRef.current = inventory;
  }, [inventory]);

  useEffect(() => {
    if (!activeCollection) {
      return;
    }

    let cancelled = false;

    api
      .getBulkPriceQueue(activeCollection.id)
      .then((response) => {
        if (!cancelled) {
          setBulkPriceQueue(response);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBulkPriceQueue(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeCollection?.id]);

  useEffect(() => {
    const availableItemIds = new Set(inventory.items.map((item) => item.id));
    setSelectedItemIds((current) => current.filter((itemId) => availableItemIds.has(itemId)));
  }, [inventory.items]);

  function requestDuplicateDecision(
    existingItem: InventoryItem,
    payload: CreateInventoryItemRequest
  ) {
    return new Promise<DuplicateDecisionChoice>((resolve) => {
      setDuplicateDecision({
        id: createClientId(),
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

  const selectedItemIdSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds]);
  const selectedItems = useMemo(
    () => inventory.items.filter((item) => selectedItemIdSet.has(item.id)),
    [inventory.items, selectedItemIdSet]
  );
  const selectedMissingPriceCount = selectedItems.filter(
    (item) => item.marketPriceCents === null
  ).length;
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
  const gradedItems = useMemo(
    () => inventory.items.filter((item) => item.itemType === "graded"),
    [inventory.items]
  );
  const storageGroups = useMemo(() => getStorageGroups(inventory.items), [inventory.items]);
  const variantGroups = useMemo(() => getVariantGroups(inventory.items), [inventory.items]);
  const sectionItems = activeSection === "graded" ? gradedItems : inventory.items;
  const visibleItems =
    activeSection === "collection" || activeSection === "graded"
      ? filterInventoryItems(sectionItems, inventoryFilters)
      : [];
  const sectionMeta = workspaceSectionMeta(activeSection, {
    totalCards: inventory.summary.cardCount,
    gradedRows: gradedItems.length,
    storageGroups: storageGroups.length
  });

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

  function changeSection(section: WorkspaceSection) {
    setActiveSection(section);
    setActivePanel(null);
    setLookupResult(null);
    setLookupError("");
    setSelectedItem(null);
    setSelectionMode(false);
    setSelectedItemIds([]);
    setBulkVariantEditorOpen(false);
    setBulkVariantMessage("");
    setShowFilters(false);
  }

  function handleSelectCollection(collectionId: string) {
    setActiveCollectionId(collectionId);
    setShowCollectionMenu(false);
    changeSection("collection");
  }

  function openPanel(panel: "manual" | "cert" | "bulk" | "import") {
    if (panel === "import") {
      changeSection("data");
    } else {
      setActiveSection("collection");
    }

    setActivePanel((current) => (current === panel ? null : panel));
  }

  function applyStorageFilter(storageLocation: string) {
    setInventoryFilters({
      ...defaultInventoryFilters,
      storageLocation
    });
    setActiveSection("collection");
    setShowFilters(true);
  }

  function applyVariantFilter(variant: string) {
    setInventoryFilters({
      ...defaultInventoryFilters,
      variants: [variant]
    });
    setActiveSection("collection");
    setShowFilters(true);
  }

  function applyInventoryTagFilter(filter: InventoryTagFilter) {
    const nextFilters = filtersFromInventoryTag(filter);

    setInventoryFilters(nextFilters);
    setActiveSection("collection");
    setActivePanel(null);
    setSelectedItem(null);
    setSelectionMode(false);
    setSelectedItemIds([]);
    setShowFilters(true);
  }

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

  async function handleExportInventoryCsv() {
    if (!activeCollection) {
      return;
    }

    setExportStatus("loading");
    setBackupStatus("idle");
    setDataActionMessage("");

    try {
      const { blob, fileName } = await api.exportInventoryCsv(activeCollection.id);
      downloadBlob(blob, fileName);
      setExportStatus("idle");
      setDataActionMessage(`Exported ${fileName}.`);
    } catch (error) {
      setExportStatus("error");
      setDataActionMessage(error instanceof Error ? error.message : "Unable to export inventory.");
    }
  }

  async function handleCreateSqliteBackup() {
    if (!activeCollection) {
      return;
    }

    setBackupStatus("loading");
    setExportStatus("idle");
    setDataActionMessage("");

    try {
      const response = await api.createSqliteBackup(activeCollection.id);
      setBackupStatus("idle");
      setDataActionMessage(
        `Backup saved to ${response.path} (${formatFileSize(response.sizeBytes)}).`
      );
    } catch (error) {
      setBackupStatus("error");
      setDataActionMessage(error instanceof Error ? error.message : "Unable to create backup.");
    }
  }

  function toggleSelectionMode() {
    setSelectionMode((isSelecting) => {
      if (isSelecting) {
        setSelectedItemIds([]);
        setBulkVariantEditorOpen(false);
        setBulkVariantMessage("");
      }

      return !isSelecting;
    });
  }

  function toggleSelectedItem(itemId: string) {
    setSelectedItemIds((current) =>
      current.includes(itemId)
        ? current.filter((selectedItemId) => selectedItemId !== itemId)
        : [...current, itemId]
    );
  }

  function selectVisibleItems() {
    setSelectedItemIds(visibleItems.map((item) => item.id));
  }

  function applyBulkPriceQueueResponse(response: BulkPriceQueueResponse) {
    setBulkPriceQueue(response);
    const updatedItems = response.jobs
      .map((job) => job.item)
      .filter((item): item is InventoryItem => Boolean(item));

    if (updatedItems.length > 0) {
      setInventory((current) => {
        const updatedById = new Map(updatedItems.map((item) => [item.id, item]));
        return summarizeInventory(
          current.items.map((item) => updatedById.get(item.id) ?? item)
        );
      });
    }
  }

  async function handleQueueBulkPriceRefresh() {
    if (!activeCollection || selectedItemIds.length === 0) {
      return;
    }

    setBulkPriceStatus("loading");
    setBulkPriceMessage("");

    try {
      const response = await api.enqueueBulkPriceRefresh(activeCollection.id, {
        itemIds: selectedItems
          .filter((item) => bulkPriceIncludeExisting || item.marketPriceCents === null)
          .map((item) => item.id),
        mode: "auto",
        includeExisting: bulkPriceIncludeExisting
      });
      applyBulkPriceQueueResponse(response);
      setBulkPriceStatus("idle");
      setBulkPriceMessage(response.message);
    } catch (error) {
      setBulkPriceStatus("error");
      setBulkPriceMessage(
        error instanceof Error ? error.message : "Unable to queue bulk price refresh."
      );
    }
  }

  async function handleResumeBulkPriceQueue() {
    if (!activeCollection) {
      return;
    }

    setBulkPriceStatus("loading");
    setBulkPriceMessage("");

    try {
      const response = await api.resumeBulkPriceQueue(activeCollection.id);
      applyBulkPriceQueueResponse(response);
      setBulkPriceStatus("idle");
      setBulkPriceMessage(response.message);
    } catch (error) {
      setBulkPriceStatus("error");
      setBulkPriceMessage(error instanceof Error ? error.message : "Unable to resume queue.");
    }
  }

  async function handleCancelBulkPriceQueue() {
    if (!activeCollection) {
      return;
    }

    setBulkPriceStatus("loading");
    setBulkPriceMessage("");

    try {
      const response = await api.cancelBulkPriceQueue(activeCollection.id);
      applyBulkPriceQueueResponse(response);
      setBulkPriceStatus("idle");
      setBulkPriceMessage(response.message);
    } catch (error) {
      setBulkPriceStatus("error");
      setBulkPriceMessage(error instanceof Error ? error.message : "Unable to cancel queue.");
    }
  }

  async function handleRetryFailedBulkPriceQueue() {
    if (!activeCollection) {
      return;
    }

    setBulkPriceStatus("loading");
    setBulkPriceMessage("");

    try {
      const response = await api.retryFailedBulkPriceQueue(activeCollection.id);
      applyBulkPriceQueueResponse(response);
      setBulkPriceStatus("idle");
      setBulkPriceMessage(response.message);
    } catch (error) {
      setBulkPriceStatus("error");
      setBulkPriceMessage(error instanceof Error ? error.message : "Unable to retry failed jobs.");
    }
  }

  async function handleClearCompletedBulkPriceQueue() {
    if (!activeCollection) {
      return;
    }

    setBulkPriceStatus("loading");
    setBulkPriceMessage("");

    try {
      const response = await api.clearCompletedBulkPriceQueue(activeCollection.id);
      applyBulkPriceQueueResponse(response);
      setBulkPriceStatus("idle");
      setBulkPriceMessage(response.message);
    } catch (error) {
      setBulkPriceStatus("error");
      setBulkPriceMessage(error instanceof Error ? error.message : "Unable to clear queue.");
    }
  }

  async function handleIgnorePriceRefresh(item: InventoryItem) {
    if (!activeCollection) {
      return;
    }

    setBulkPriceStatus("loading");
    setBulkPriceMessage("");

    try {
      const response = await api.ignorePriceRefreshForItem(activeCollection.id, item.id);
      applyBulkPriceQueueResponse(response);
      setBulkPriceStatus("idle");
      setBulkPriceMessage(response.message);
    } catch (error) {
      setBulkPriceStatus("error");
      setBulkPriceMessage(
        error instanceof Error
          ? error.message
          : "Unable to ignore queued price refreshes for this card."
      );
    }
  }

  async function handleBulkDeleteSelected() {
    if (!activeCollection || selectedItemIds.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      `Delete ${selectedItemIds.length} selected card${
        selectedItemIds.length === 1 ? "" : "s"
      } from this collection? This cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    setBulkPriceStatus("loading");
    setBulkPriceMessage("");

    try {
      const response = await api.bulkDeleteInventoryItems(activeCollection.id, {
        itemIds: selectedItemIds
      });
      setInventory((current) =>
        summarizeInventory(
          current.items.filter((item) => !response.deletedItemIds.includes(item.id))
        )
      );
      setSelectedItemIds((current) =>
        current.filter((itemId) => !response.deletedItemIds.includes(itemId))
      );
      setBulkPriceStatus("idle");
      setBulkPriceMessage(
        `Deleted ${response.deletedItemIds.length} card${
          response.deletedItemIds.length === 1 ? "" : "s"
        }.${
          response.notFoundItemIds.length > 0
            ? ` ${response.notFoundItemIds.length} selected card${
                response.notFoundItemIds.length === 1 ? " was" : "s were"
              } already gone.`
            : ""
        }`
      );
    } catch (error) {
      setBulkPriceStatus("error");
      setBulkPriceMessage(error instanceof Error ? error.message : "Unable to delete selected cards.");
    }
  }

  function toggleBulkVariantValue(variant: string) {
    setBulkVariantValues((current) =>
      current.includes(variant)
        ? current.filter((selected) => selected !== variant)
        : [...current, variant]
    );
  }

  async function handleBulkUpdateVariants() {
    if (!activeCollection || selectedItemIds.length === 0) {
      return;
    }

    if (bulkVariantMode !== "set" && bulkVariantValues.length === 0) {
      setBulkVariantStatus("error");
      setBulkVariantMessage("Choose at least one variant to add or remove.");
      return;
    }

    const actionLabel =
      bulkVariantMode === "set" ? "replace variants for" : `${bulkVariantMode} variants on`;
    const confirmed = window.confirm(
      `Bulk ${actionLabel} ${selectedItemIds.length} selected card${
        selectedItemIds.length === 1 ? "" : "s"
      }?${bulkVariantClearMarketPrices ? " Saved market prices will be cleared." : ""}`
    );

    if (!confirmed) {
      return;
    }

    setBulkVariantStatus("loading");
    setBulkVariantMessage("");

    try {
      const response = await api.bulkUpdateInventoryVariants(activeCollection.id, {
        itemIds: selectedItemIds,
        mode: bulkVariantMode,
        variants: bulkVariantValues,
        clearMarketPrices: bulkVariantClearMarketPrices
      });
      const updatedById = new Map(response.items.map((item) => [item.id, item]));

      setInventory((current) =>
        summarizeInventory(current.items.map((item) => updatedById.get(item.id) ?? item))
      );
      setBulkVariantStatus("idle");
      setBulkVariantMessage(
        `Updated ${response.updatedItemIds.length} card${
          response.updatedItemIds.length === 1 ? "" : "s"
        }.${
          response.clearedMarketPriceItemIds.length > 0
            ? ` Cleared ${response.clearedMarketPriceItemIds.length} saved market price${
                response.clearedMarketPriceItemIds.length === 1 ? "" : "s"
              }.`
            : ""
        }${
          response.notFoundItemIds.length > 0
            ? ` ${response.notFoundItemIds.length} selected card${
                response.notFoundItemIds.length === 1 ? " was" : "s were"
              } already gone.`
            : ""
        }`
      );
    } catch (error) {
      setBulkVariantStatus("error");
      setBulkVariantMessage(
        error instanceof Error ? error.message : "Unable to update selected variants."
      );
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

        <div className="collection-switcher-wrap">
          {collections.length > 1 ? (
            <>
              <button
                className={`collection-switcher ${showCollectionMenu ? "active" : ""}`}
                type="button"
                aria-expanded={showCollectionMenu}
                aria-haspopup="menu"
                onClick={() => setShowCollectionMenu((isOpen) => !isOpen)}
              >
                <span>
                  <strong>{activeCollection?.name ?? "No collection"}</strong>
                  <small>{activeCollection ? `${activeCollection.role} workspace` : "No access"}</small>
                </span>
                <ChevronDown size={18} aria-hidden="true" />
              </button>
              {showCollectionMenu ? (
                <div className="collection-menu" role="menu" aria-label="Switch collection">
                  {collections.map((collection) => (
                    <button
                      className={collection.id === activeCollection?.id ? "active" : ""}
                      key={collection.id}
                      onClick={() => handleSelectCollection(collection.id)}
                      role="menuitem"
                      type="button"
                    >
                      <span>
                        <strong>{collection.name}</strong>
                        <small>
                          {collection.role} · {collection.cardCount} cards ·{" "}
                          {formatCurrency(collection.estimatedValueCents)}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div className="collection-switcher static">
              <span>
                <strong>{activeCollection?.name ?? "No collection"}</strong>
                <small>
                  {activeCollection
                    ? `${activeCollection.role} workspace`
                    : "Create a collection to begin"}
                </small>
              </span>
            </div>
          )}
        </div>

        <nav className="nav-stack" aria-label="Primary">
          {workspaceNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={`nav-item ${activeSection === item.section ? "active" : ""}`}
                key={item.section}
                onClick={() => changeSection(item.section)}
                type="button"
              >
                <Icon size={18} aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
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
            <p className="eyebrow">{sectionMeta.eyebrow}</p>
            <h2 id="workspace-title">{sectionMeta.title}</h2>
            <p>{sectionMeta.description}</p>
          </div>
          <div className="topbar-actions">
            {activeSection === "collection" || activeSection === "graded" ? (
              <button
                className={`icon-button ${showFilters ? "active" : ""}`}
                type="button"
                aria-label="Filter collection"
                aria-expanded={showFilters}
                onClick={() => setShowFilters((isOpen) => !isOpen)}
              >
                <ListFilter size={20} aria-hidden="true" />
              </button>
            ) : null}
            {activeSection === "collection" ? (
              <button className="primary-button" type="button" onClick={() => openPanel("manual")}>
                <Plus size={18} aria-hidden="true" />
                Add card
              </button>
            ) : null}
          </div>
        </header>

        {activeSection === "collection" ? (
          <form className="command-panel" aria-label="Add cards" onSubmit={handleLookup}>
            <div className="search-control">
              <Search size={20} aria-hidden="true" />
              <input
                aria-label="Search or add card"
                onChange={(event) => setLookupQuery(event.target.value)}
                placeholder="Search by name, PSA cert, or set/card like s10a 073/071"
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
              <button type="button" onClick={() => openPanel("cert")}>
                <ShieldCheck size={18} aria-hidden="true" />
                Cert
              </button>
              <button type="button" onClick={() => openPanel("bulk")}>
                <FileText size={18} aria-hidden="true" />
                Bulk
              </button>
            </div>
          </form>
        ) : null}

        {(activeSection === "collection" || activeSection === "graded") && showFilters ? (
          <InventoryFilterPanel
            chips={activeFilterChips}
            filters={inventoryFilters}
            options={filterOptions}
            resultCount={visibleItems.length}
            totalCount={sectionItems.length}
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

        {activePanel === "import" && activeCollection ? (
          <InventoryCsvImportPanel
            collectionId={activeCollection.id}
            existingItems={inventory.items}
            onCreateItem={createOrMergeInventoryItem}
            onItemUpdated={(item) => setInventory((current) => updateInventoryItem(current, item))}
          />
        ) : null}

        {inventoryStatus === "error" ? <p className="form-error">{inventoryError}</p> : null}

        {activeSection === "collection" || activeSection === "graded" ? (
          <>
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

            {sectionItems.length > 0 ? (
              <>
                <div className="inventory-list-header">
                  <p>
                    Showing <strong>{visibleItems.length}</strong> of{" "}
                    <strong>{sectionItems.length}</strong>
                    {activeSection === "graded" ? " graded rows" : " inventory rows"}
                  </p>
                  <div className="inventory-list-actions">
                    {hasActiveInventoryFilters ? (
                      <button type="button" onClick={() => setInventoryFilters(defaultInventoryFilters)}>
                        Clear filters
                      </button>
                    ) : null}
                    {activeSection === "collection" ? (
                      <button type="button" onClick={toggleSelectionMode}>
                        {selectionMode ? "Cancel select" : "Select"}
                      </button>
                    ) : null}
                  </div>
                </div>
                {activeSection === "collection" && selectionMode ? (
                  <BulkSelectionBar
                    includeExisting={bulkPriceIncludeExisting}
                    isWorking={bulkPriceStatus === "loading"}
                    missingPriceCount={selectedMissingPriceCount}
                    selectedCount={selectedItemIds.length}
                    visibleCount={visibleItems.length}
                    onClear={() => setSelectedItemIds([])}
                    onDeleteSelected={handleBulkDeleteSelected}
                    onEditVariants={() => setBulkVariantEditorOpen((isOpen) => !isOpen)}
                    onIncludeExistingChange={setBulkPriceIncludeExisting}
                    onQueuePriceRefresh={handleQueueBulkPriceRefresh}
                    onSelectVisible={selectVisibleItems}
                  />
                ) : null}
                {activeSection === "collection" && selectionMode && bulkVariantEditorOpen ? (
                  <BulkVariantEditor
                    clearMarketPrices={bulkVariantClearMarketPrices}
                    isWorking={bulkVariantStatus === "loading"}
                    message={bulkVariantMessage}
                    mode={bulkVariantMode}
                    selectedCount={selectedItemIds.length}
                    selectedVariants={bulkVariantValues}
                    status={bulkVariantStatus}
                    onClearMarketPricesChange={setBulkVariantClearMarketPrices}
                    onModeChange={setBulkVariantMode}
                    onSubmit={handleBulkUpdateVariants}
                    onToggleVariant={toggleBulkVariantValue}
                  />
                ) : null}
                {activeSection === "collection" && bulkPriceQueue && bulkPriceQueue.summary.total > 0 ? (
                  <BulkPriceQueuePanel
                    isWorking={bulkPriceStatus === "loading"}
                    message={bulkPriceMessage}
                    queue={bulkPriceQueue}
                    status={bulkPriceStatus}
                    onCancel={handleCancelBulkPriceQueue}
                    onClearCompleted={handleClearCompletedBulkPriceQueue}
                    onIgnoreItem={handleIgnorePriceRefresh}
                    onOpenItem={(item) => setSelectedItem(item)}
                    onResume={handleResumeBulkPriceQueue}
                    onRetryFailed={handleRetryFailedBulkPriceQueue}
                  />
                ) : null}
                {visibleItems.length > 0 ? (
                  <InventoryGrid
                    isSelecting={activeSection === "collection" && selectionMode}
                    items={visibleItems}
                    selectedItemIds={selectedItemIdSet}
                    onSelect={setSelectedItem}
                    onToggleSelected={toggleSelectedItem}
                  />
                ) : (
                  <section className="empty-state filtered-empty">
                    <div className="empty-copy">
                      <p className="eyebrow">No visible matches</p>
                      <h3>No cards match this view.</h3>
                      <p>Clear a filter or adjust the search text to bring cards back into view.</p>
                    </div>
                  </section>
                )}
              </>
            ) : (
              <section className="empty-state">
                <div className="empty-visual" aria-hidden="true">
                  <div className="card-stack card-stack-one" />
                  <div className="card-stack card-stack-two" />
                  <div className="card-stack card-stack-three" />
                </div>
                <div className="empty-copy">
                  <p className="eyebrow">Ready for inventory</p>
                  <h3>
                    {activeSection === "graded"
                      ? "No graded cards yet."
                      : "Your collection will live here."}
                  </h3>
                  <p>
                    {activeSection === "graded"
                      ? "Import a PSA cert or mark a manual entry as graded to track slab details, values, and price history."
                      : "Use lookup, PSA cert import, bulk paste, CSV import, or manual entry to add cards to this local collection."}
                  </p>
                </div>
              </section>
            )}
          </>
        ) : null}

        {activeSection === "storage" ? (
          <StorageInsights
            storageGroups={storageGroups}
            variantGroups={variantGroups}
            onSelectStorage={applyStorageFilter}
            onSelectVariant={applyVariantFilter}
          />
        ) : null}

        {activeSection === "data" ? (
          <>
            <DataWorkspacePanel
              backupStatus={backupStatus}
              dataActionMessage={dataActionMessage}
              exportStatus={exportStatus}
              hasCollection={Boolean(activeCollection)}
              onBackup={handleCreateSqliteBackup}
              onExport={handleExportInventoryCsv}
              onImport={() => openPanel("import")}
            />
            {bulkPriceQueue && bulkPriceQueue.summary.total > 0 ? (
              <BulkPriceQueuePanel
                isWorking={bulkPriceStatus === "loading"}
                message={bulkPriceMessage}
                queue={bulkPriceQueue}
                status={bulkPriceStatus}
                onCancel={handleCancelBulkPriceQueue}
                onClearCompleted={handleClearCompletedBulkPriceQueue}
                onIgnoreItem={handleIgnorePriceRefresh}
                onOpenItem={(item) => setSelectedItem(item)}
                onResume={handleResumeBulkPriceQueue}
                onRetryFailed={handleRetryFailedBulkPriceQueue}
              />
            ) : null}
          </>
        ) : null}

        {activeCollection && selectedItem ? (
          <InventoryItemDetail
            collectionId={activeCollection.id}
            item={selectedItem}
            onClose={() => setSelectedItem(null)}
            onDeleted={(itemId) => {
              setInventory((current) => removeInventoryItem(current, itemId));
              setSelectedItem(null);
            }}
            onPriceQueued={(queue, message) => {
              applyBulkPriceQueueResponse(queue);
              setBulkPriceMessage(message);
              setBulkPriceStatus("idle");
            }}
            onTagFilter={applyInventoryTagFilter}
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

function StorageInsights({
  storageGroups,
  variantGroups,
  onSelectStorage,
  onSelectVariant
}: {
  storageGroups: InventoryGroupSummary[];
  variantGroups: InventoryGroupSummary[];
  onSelectStorage: (storageLocation: string) => void;
  onSelectVariant: (variant: string) => void;
}) {
  return (
    <section className="insight-grid" aria-label="Storage and variant summaries">
      <div className="insight-panel">
        <div className="insight-header">
          <div>
            <p className="eyebrow">Storage</p>
            <h3>Locations</h3>
          </div>
          <span>{storageGroups.length}</span>
        </div>
        <div className="insight-list">
          {storageGroups.length > 0 ? (
            storageGroups.map((group) => (
              <button key={group.key} onClick={() => onSelectStorage(group.key)} type="button">
                <span>
                  <strong>{group.label}</strong>
                  <small>{group.examples}</small>
                </span>
                <span>
                  <strong>{group.count}</strong>
                  <small>{formatCurrency(group.valueCents)}</small>
                </span>
              </button>
            ))
          ) : (
            <p className="lookup-note">Add storage locations to cards to build this view.</p>
          )}
        </div>
      </div>

      <div className="insight-panel">
        <div className="insight-header">
          <div>
            <p className="eyebrow">Variants</p>
            <h3>Tags in use</h3>
          </div>
          <span>{variantGroups.length}</span>
        </div>
        <div className="insight-list">
          {variantGroups.length > 0 ? (
            variantGroups.map((group) => (
              <button key={group.key} onClick={() => onSelectVariant(group.key)} type="button">
                <span>
                  <strong>{group.label}</strong>
                  <small>{group.examples}</small>
                </span>
                <span>
                  <strong>{group.count}</strong>
                  <small>{formatCurrency(group.valueCents)}</small>
                </span>
              </button>
            ))
          ) : (
            <p className="lookup-note">Add variants like Holo, 1st Edition, or Promo to see groups.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function DataWorkspacePanel({
  backupStatus,
  dataActionMessage,
  exportStatus,
  hasCollection,
  onBackup,
  onExport,
  onImport
}: {
  backupStatus: "idle" | "loading" | "error";
  dataActionMessage: string;
  exportStatus: "idle" | "loading" | "error";
  hasCollection: boolean;
  onBackup: () => void;
  onExport: () => void;
  onImport: () => void;
}) {
  const hasError = exportStatus === "error" || backupStatus === "error";

  return (
    <section className="data-workspace" aria-label="Data tools">
      <div className="data-action-grid">
        <button disabled={!hasCollection || exportStatus === "loading"} onClick={onExport} type="button">
          <Download size={20} aria-hidden="true" />
          <span>
            <strong>{exportStatus === "loading" ? "Exporting..." : "Export CSV"}</strong>
            <small>Download the visible collection as inventory rows.</small>
          </span>
        </button>
        <button disabled={!hasCollection || backupStatus === "loading"} onClick={onBackup} type="button">
          <HardDriveDownload size={20} aria-hidden="true" />
          <span>
            <strong>{backupStatus === "loading" ? "Backing up..." : "Back up SQLite"}</strong>
            <small>Create a local database snapshot under data/backups.</small>
          </span>
        </button>
        <button disabled={!hasCollection} onClick={onImport} type="button">
          <Upload size={20} aria-hidden="true" />
          <span>
            <strong>Import CSV</strong>
            <small>Preview manual inventory rows before adding them.</small>
          </span>
        </button>
      </div>
      {dataActionMessage ? (
        <p className={`data-action-status ${hasError ? "error" : "ok"}`}>{dataActionMessage}</p>
      ) : null}
    </section>
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

function InventoryCsvImportPanel({
  collectionId,
  existingItems,
  onCreateItem,
  onItemUpdated
}: {
  collectionId: string;
  existingItems: InventoryItem[];
  onCreateItem: (
    collectionId: string,
    payload: CreateInventoryItemRequest
  ) => Promise<InventoryItem | null>;
  onItemUpdated: (item: InventoryItem) => void;
}) {
  const [csvText, setCsvText] = useState("");
  const [rows, setRows] = useState<CsvImportPreviewRow[]>([]);
  const [status, setStatus] = useState<"idle" | "adding">("idle");
  const [error, setError] = useState("");

  const counts = summarizeCsvImportRows(rows);
  const readyRows = rows.filter((row) => row.status === "ready");

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setCsvText(await file.text());
    setRows([]);
    setError("");
  }

  function handlePreview() {
    try {
      const parsedRows = parseInventoryCsvImport(csvText);
      setRows(parsedRows);
      setError(parsedRows.length === 0 ? "No importable rows found." : "");
    } catch (previewError) {
      setRows([]);
      setError(previewError instanceof Error ? previewError.message : "Unable to parse CSV.");
    }
  }

  async function handleImportReady() {
    if (readyRows.length === 0) {
      return;
    }

    setStatus("adding");
    setError("");
    const seenCertNumbers = new Set(
      existingItems.map((item) => normalizedCertNumber(item.certNumber)).filter(Boolean)
    );

    for (const row of readyRows) {
      setRows((current) =>
        current.map((candidate) =>
          candidate.id === row.id ? { ...candidate, status: "adding" } : candidate
        )
      );

      try {
        const certNumber = normalizedCertNumber(row.payload.certNumber);

        if (certNumber && seenCertNumbers.has(certNumber)) {
          setRows((current) =>
            current.map((candidate) =>
              candidate.id === row.id
                ? {
                    ...candidate,
                    status: "skipped",
                    errors: [`Cert ${row.payload.certNumber} is already in this collection.`]
                  }
                : candidate
            )
          );
          continue;
        }

        const item = await onCreateItem(collectionId, row.payload);
        const updatedItem = item?.card.imageUrl
          ? item
          : await applyBestImageCandidateToItem(collectionId, item);

        if (updatedItem) {
          onItemUpdated(updatedItem);
          const importedCertNumber = normalizedCertNumber(updatedItem.certNumber);

          if (importedCertNumber) {
            seenCertNumbers.add(importedCertNumber);
          }
        }

        setRows((current) =>
          current.map((candidate) =>
            candidate.id === row.id
              ? {
                  ...candidate,
                  payload: updatedItem ? inventoryItemToPayload(updatedItem) : candidate.payload,
                  status: updatedItem ? "added" : "skipped",
                  errors: updatedItem ? [] : ["Import cancelled."]
                }
              : candidate
          )
        );
      } catch (importError) {
        setRows((current) =>
          current.map((candidate) =>
            candidate.id === row.id
              ? {
                  ...candidate,
                  status: "error",
                  errors: [
                    importError instanceof Error ? importError.message : "Unable to import row."
                  ]
                }
              : candidate
          )
        );
      }

      await delay(100);
    }

    setStatus("idle");
  }

  function skipRow(rowId: string) {
    setRows((current) =>
      current.map((row) =>
        row.id === rowId ? { ...row, status: "skipped", errors: ["Skipped."] } : row
      )
    );
  }

  return (
    <section className="manual-panel bulk-panel" aria-label="CSV inventory import">
      <div className="bulk-header">
        <div>
          <p className="eyebrow">CSV import</p>
          <h3>Preview inventory rows</h3>
        </div>
        <p className="lookup-note">
          Use the Pokemon Vault export format, matching column names, or PSA Vault collection exports.
        </p>
      </div>

      <div className="bulk-input-grid">
        <label>
          Paste CSV
          <textarea
            disabled={status !== "idle"}
            onChange={(event) => {
              setCsvText(event.target.value);
              setRows([]);
              setError("");
            }}
            placeholder={"name,set_code,card_number,language,item_type,quantity\nPikachu,base1,58/102,en,raw,1"}
            value={csvText}
          />
        </label>
        <div className="bulk-file-box">
          <label>
            Upload .csv
            <input
              accept=".csv,text/csv"
              disabled={status !== "idle"}
              onChange={handleFileUpload}
              type="file"
            />
          </label>
          <p>
            {rows.length > 0
              ? `${counts.ready} ready, ${counts.error} need edits`
              : "Preview before importing"}
          </p>
        </div>
      </div>

      <div className="bulk-actions">
        <button
          className="primary-button"
          disabled={status !== "idle" || csvText.trim().length === 0}
          onClick={handlePreview}
          type="button"
        >
          Preview CSV
        </button>
        <button
          disabled={status !== "idle" || readyRows.length === 0}
          onClick={handleImportReady}
          type="button"
        >
          {status === "adding" ? "Importing..." : `Import ready (${readyRows.length})`}
        </button>
        <button
          disabled={status !== "idle"}
          onClick={() => {
            setCsvText("");
            setRows([]);
            setError("");
          }}
          type="button"
        >
          Clear import
        </button>
      </div>

      {rows.length > 0 ? (
        <div className="bulk-progress">
          <span>{counts.ready} ready</span>
          <span>{counts.error} errors</span>
          <span>{counts.added} added</span>
          <span>{counts.skipped} skipped</span>
        </div>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}

      {rows.length > 0 ? (
        <div className="bulk-results">
          {rows.map((row) => (
            <CsvImportRowCard key={row.id} row={row} onSkip={skipRow} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function CsvImportRowCard({
  row,
  onSkip
}: {
  row: CsvImportPreviewRow;
  onSkip: (rowId: string) => void;
}) {
  const rowClass = row.status === "ready" ? "selected" : row.status === "error" ? "failed" : row.status;

  return (
    <article className={`bulk-row ${rowClass}`}>
      <div className="bulk-row-thumb" aria-hidden="true">
        {row.payload.imageUrl ? <img alt="" src={row.payload.imageUrl} /> : <FileText size={28} />}
      </div>
      <div className="bulk-row-body">
        <div className="bulk-row-header">
          <div>
            <p className="eyebrow">Line {row.lineNumber} · {row.status}</p>
            <h4>{row.payload.name || "Missing name"}</h4>
            <p>{[row.payload.setCode, row.payload.cardNumber, row.payload.setName].filter(Boolean).join(" · ")}</p>
          </div>
          {["ready", "error"].includes(row.status) ? (
            <button onClick={() => onSkip(row.id)} type="button">
              Skip
            </button>
          ) : null}
        </div>

        <div className="inventory-meta">
          <span>{row.payload.language.toUpperCase()}</span>
          <span>{row.payload.itemType}</span>
          <span>Qty {row.payload.quantity}</span>
          {row.payload.grader ? <span>{row.payload.grader} {row.payload.grade}</span> : null}
        </div>

        {row.errors.length > 0 ? <p className="form-error">{row.errors.join(" ")}</p> : null}
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
      releaseYear: String(formData.get("releaseYear") ?? ""),
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
          Release year
          <input inputMode="numeric" maxLength={4} name="releaseYear" placeholder="Optional" />
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

function BulkSelectionBar({
  includeExisting,
  isWorking,
  missingPriceCount,
  selectedCount,
  visibleCount,
  onClear,
  onDeleteSelected,
  onEditVariants,
  onIncludeExistingChange,
  onQueuePriceRefresh,
  onSelectVisible
}: {
  includeExisting: boolean;
  isWorking: boolean;
  missingPriceCount: number;
  selectedCount: number;
  visibleCount: number;
  onClear: () => void;
  onDeleteSelected: () => void;
  onEditVariants: () => void;
  onIncludeExistingChange: (includeExisting: boolean) => void;
  onQueuePriceRefresh: () => void;
  onSelectVisible: () => void;
}) {
  const queuedCount = includeExisting ? selectedCount : missingPriceCount;

  return (
    <section className="bulk-selection-bar" aria-label="Bulk selection actions">
      <div>
        <strong>{selectedCount} selected</strong>
        <span>
          {queuedCount} will be queued for price refresh
          {includeExisting ? "" : " (missing prices only)"}
        </span>
      </div>
      <div className="bulk-selection-actions">
        <label className="inline-checkbox">
          <input
            checked={includeExisting}
            onChange={(event) => onIncludeExistingChange(event.target.checked)}
            type="checkbox"
          />
          Refresh existing prices
        </label>
        <button disabled={visibleCount === 0 || isWorking} onClick={onSelectVisible} type="button">
          Select visible
        </button>
        <button disabled={selectedCount === 0 || isWorking} onClick={onClear} type="button">
          Clear selection
        </button>
        <button disabled={selectedCount === 0 || isWorking} onClick={onEditVariants} type="button">
          Edit variants
        </button>
        <button
          className="danger-button"
          disabled={selectedCount === 0 || isWorking}
          onClick={onDeleteSelected}
          type="button"
        >
          Delete selected
        </button>
        <button disabled={queuedCount === 0 || isWorking} onClick={onQueuePriceRefresh} type="button">
          {isWorking ? "Queueing..." : "Queue price refresh"}
        </button>
      </div>
    </section>
  );
}

function BulkVariantEditor({
  clearMarketPrices,
  isWorking,
  message,
  mode,
  selectedCount,
  selectedVariants,
  status,
  onClearMarketPricesChange,
  onModeChange,
  onSubmit,
  onToggleVariant
}: {
  clearMarketPrices: boolean;
  isWorking: boolean;
  message: string;
  mode: BulkVariantEditMode;
  selectedCount: number;
  selectedVariants: string[];
  status: "idle" | "loading" | "error";
  onClearMarketPricesChange: (clearMarketPrices: boolean) => void;
  onModeChange: (mode: BulkVariantEditMode) => void;
  onSubmit: () => void;
  onToggleVariant: (variant: string) => void;
}) {
  const canSubmit = selectedCount > 0 && !isWorking && (mode === "set" || selectedVariants.length > 0);

  return (
    <section className="bulk-variant-panel" aria-label="Bulk variant editor">
      <div className="bulk-queue-header">
        <div>
          <p className="eyebrow">Bulk edit variants</p>
          <h3>{selectedCount} selected</h3>
        </div>
        <div className="bulk-mode-switch" aria-label="Variant edit mode">
          {(["add", "set", "remove"] as BulkVariantEditMode[]).map((option) => (
            <button
              className={mode === option ? "selected" : ""}
              disabled={isWorking}
              key={option}
              onClick={() => onModeChange(option)}
              type="button"
            >
              {variantEditModeLabel(option)}
            </button>
          ))}
        </div>
      </div>
      <div className="variant-picker">
        {variantOptions.map((variant) => (
          <label key={variant}>
            <input
              checked={selectedVariants.includes(variant)}
              disabled={isWorking}
              onChange={() => onToggleVariant(variant)}
              type="checkbox"
            />
            {variant}
          </label>
        ))}
      </div>
      <div className="bulk-selection-actions">
        <label className="inline-checkbox">
          <input
            checked={clearMarketPrices}
            disabled={isWorking}
            onChange={(event) => onClearMarketPricesChange(event.target.checked)}
            type="checkbox"
          />
          Clear saved market prices
        </label>
        <button disabled={!canSubmit} onClick={onSubmit} type="button">
          {isWorking ? "Saving..." : "Apply variant edit"}
        </button>
      </div>
      {message ? (
        <p className={status === "error" ? "form-error" : "lookup-note"}>{message}</p>
      ) : null}
    </section>
  );
}

function BulkPriceQueuePanel({
  isWorking,
  message,
  queue,
  status,
  onCancel,
  onClearCompleted,
  onIgnoreItem,
  onOpenItem,
  onResume,
  onRetryFailed
}: {
  isWorking: boolean;
  message: string;
  queue: BulkPriceQueueResponse;
  status: "idle" | "loading" | "error";
  onCancel: () => void;
  onClearCompleted: () => void;
  onIgnoreItem: (item: InventoryItem) => void;
  onOpenItem: (item: InventoryItem) => void;
  onResume: () => void;
  onRetryFailed: () => void;
}) {
  const activeCount =
    queue.summary.queued + queue.summary.running + queue.summary.rateLimited;
  const attentionCount =
    queue.summary.needsReview + queue.summary.failed + queue.summary.rateLimited;
  const completedCount =
    queue.summary.saved + queue.summary.skipped + queue.summary.cancelled;
  const hasCompleted = completedCount + queue.summary.needsReview + queue.summary.failed > 0;
  const visibleJobs = queue.jobs.filter(isVisibleBulkQueueJob).slice(0, 8);
  const primaryState =
    queue.summary.running > 0
      ? "Running"
      : queue.summary.rateLimited > 0
        ? "Paused"
        : queue.summary.queued > 0
          ? "Queued"
          : attentionCount > 0
            ? "Needs attention"
            : "Idle";

  return (
    <section className="bulk-queue-panel" aria-label="Bulk price queue">
      <div className="bulk-queue-header">
        <div>
          <p className="eyebrow">Price queue</p>
          <h3>{primaryState}</h3>
          <p>{queue.summary.total} recent pricing jobs tracked locally</p>
        </div>
        <div className="bulk-selection-actions">
          <button disabled={isWorking} onClick={onResume} type="button">
            <Play size={16} aria-hidden="true" />
            {isWorking ? "Working..." : "Resume now"}
          </button>
          <button disabled={activeCount === 0 || isWorking} onClick={onCancel} type="button">
            <XCircle size={16} aria-hidden="true" />
            Cancel queued
          </button>
          <button disabled={queue.summary.failed === 0 || isWorking} onClick={onRetryFailed} type="button">
            <RefreshCw size={16} aria-hidden="true" />
            Retry failed
          </button>
          <button disabled={!hasCompleted || isWorking} onClick={onClearCompleted} type="button">
            <Trash2 size={16} aria-hidden="true" />
            Clear completed
          </button>
        </div>
      </div>
      <div className="bulk-queue-stats">
        <div className="bulk-queue-stat active">
          <Clock3 size={18} aria-hidden="true" />
          <span>Waiting</span>
          <strong>{queue.summary.queued + queue.summary.running}</strong>
        </div>
        <div className="bulk-queue-stat saved">
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>Saved</span>
          <strong>{queue.summary.saved}</strong>
        </div>
        <div className="bulk-queue-stat review">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>Needs attention</span>
          <strong>{attentionCount}</strong>
        </div>
        <div className="bulk-queue-stat done">
          <Trash2 size={18} aria-hidden="true" />
          <span>Cleared / skipped</span>
          <strong>{queue.summary.skipped + queue.summary.cancelled}</strong>
        </div>
      </div>
      {message ? (
        <p className={status === "error" ? "form-error" : "lookup-note"}>{message}</p>
      ) : null}
      {queue.summary.rateLimited > 0 ? (
        <p className="lookup-note">
          Paused by an API limit. The backend will retry eligible jobs automatically; Resume now
          retries immediately.
        </p>
      ) : null}
      {queue.summary.failed > 0 ? (
        <p className="lookup-note">
          Failed jobs are not retried automatically. Use Retry failed after fixing the key or waiting
          for the request limit to reset.
        </p>
      ) : null}
      <div className="bulk-queue-list-header">
        <strong>Open jobs</strong>
        <span>
          Showing {visibleJobs.length} of {queue.jobs.filter(isVisibleBulkQueueJob).length}
        </span>
      </div>
      <div className="bulk-queue-list">
        {visibleJobs.length === 0 ? (
          <p className="bulk-queue-empty">
            Nothing needs attention right now. Saved jobs stay counted above and can be cleared.
          </p>
        ) : null}
        {visibleJobs.map((job) => (
          <article className={`bulk-queue-row ${job.status}`} key={job.id}>
            <div>
              <div className="bulk-queue-row-title">
                <strong>{job.item?.card.name ?? "Missing item"}</strong>
                <span className={`queue-status-pill ${job.status}`}>
                  {bulkQueueStatusLabel(job.status)}
                </span>
              </div>
              <p>
                {[
                  job.item?.card.setName,
                  job.item?.card.cardNumber,
                  job.mode
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {job.message ? <span>{job.message}</span> : null}
              {job.nextAttemptAt ? <em>{retryLabel(job.nextAttemptAt)}</em> : null}
            </div>
            {job.item ? (
              <div className="bulk-queue-row-actions">
                <button onClick={() => onOpenItem(job.item!)} type="button">
                  Open
                </button>
                {job.status === "needs-review" || job.status === "failed" ? (
                  <button
                    disabled={isWorking}
                    onClick={() => onIgnoreItem(job.item!)}
                    type="button"
                  >
                    Ignore
                  </button>
                ) : null}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function isVisibleBulkQueueJob(job: BulkPriceQueueResponse["jobs"][number]) {
  return !["saved", "skipped", "cancelled"].includes(job.status);
}

function bulkQueueStatusLabel(status: string) {
  switch (status) {
    case "cancelled":
      return "Cancelled";
    case "failed":
      return "Failed";
    case "needs-review":
      return "Review";
    case "rate-limited":
      return "Paused";
    case "running":
      return "Running";
    case "saved":
      return "Saved";
    case "skipped":
      return "Skipped";
    default:
      return "Queued";
  }
}

function InventoryGrid({
  isSelecting,
  items,
  selectedItemIds,
  onSelect,
  onToggleSelected
}: {
  isSelecting: boolean;
  items: InventoryItem[];
  selectedItemIds: Set<string>;
  onSelect: (item: InventoryItem) => void;
  onToggleSelected: (itemId: string) => void;
}) {
  return (
    <section className="inventory-grid" id="collection" aria-label="Collection cards">
      {items.map((item) => (
        <article
          aria-label={`Open ${item.card.name} details`}
          className={`inventory-card ${isSelecting ? "selecting" : ""} ${
            selectedItemIds.has(item.id) ? "selected" : ""
          }`}
          key={item.id}
          onClick={() => {
            if (isSelecting) {
              onToggleSelected(item.id);
            } else {
              onSelect(item);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              if (isSelecting) {
                onToggleSelected(item.id);
              } else {
                onSelect(item);
              }
            }
          }}
          role={isSelecting ? "checkbox" : "button"}
          aria-checked={isSelecting ? selectedItemIds.has(item.id) : undefined}
          tabIndex={0}
        >
          {isSelecting ? (
            <label className="inventory-select-box" onClick={(event) => event.stopPropagation()}>
              <input
                checked={selectedItemIds.has(item.id)}
                onChange={() => onToggleSelected(item.id)}
                type="checkbox"
              />
              <span>Select {item.card.name}</span>
            </label>
          ) : null}
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
                {[item.card.setCode, item.card.cardNumber, item.card.setName, item.card.releaseYear]
                  .filter(Boolean)
                  .join(" · ") || "Manual card"}
              </p>
            </div>
            <div className="inventory-meta">
              <span>Qty {item.quantity}</span>
              {item.conditionLabel ? <span>{item.conditionLabel}</span> : null}
              {item.conditionScore ? <span>{item.conditionScore}/10</span> : null}
              {item.variantDetails ? <span>{item.variantDetails}</span> : null}
              {item.grader && item.grade ? (
                <span>
                  {item.grader} {item.grade}
                </span>
              ) : null}
              {item.marketPriceCents !== null ? (
                <span>Market {formatCurrency(item.marketPriceCents)}</span>
              ) : null}
              {item.storageLocation ? <span>{item.storageLocation}</span> : null}
            </div>
            <strong>{formatCurrency(inventoryItemValue(item))}</strong>
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

function RawMarketPriceSummary({
  candidates,
  error,
  isRefreshing,
  item,
  onRefresh,
  onSelectCandidate
}: {
  candidates: PricingCandidate[];
  error: string;
  isRefreshing: boolean;
  item: InventoryItem;
  onRefresh: () => void;
  onSelectCandidate: (candidate: PricingCandidate) => void;
}) {
  const lookupDate = item.marketPriceUpdatedAt ? new Date(item.marketPriceUpdatedAt) : null;
  const lookupLabel =
    lookupDate && !Number.isNaN(lookupDate.getTime())
      ? lookupDate.toLocaleDateString()
      : null;

  return (
    <section className="raw-price-panel" aria-label="Raw market price">
      <div className="graded-cert-header pricing-panel-header">
        <div>
          <p className="eyebrow">Raw market price</p>
          <h4>
            {item.marketPriceCents !== null
              ? formatCurrency(item.marketPriceCents)
              : "No market price yet"}
          </h4>
        </div>
        <div className="graded-cert-actions pricing-panel-actions">
          <EbaySoldCompsLink item={item} />
          <PokemonPriceTrackerLink item={item} />
          <button disabled={isRefreshing} onClick={onRefresh} type="button">
            <RefreshCw size={16} aria-hidden="true" />
            {isRefreshing ? "Refreshing..." : "Refresh raw price"}
          </button>
        </div>
      </div>

      {item.marketPriceCents !== null ? (
        <>
          <div className="graded-cert-stats">
            <div>
              <span>Source</span>
              <strong>{marketPriceSourceLabel(item.marketPriceSource)}</strong>
            </div>
            <div>
              <span>Confidence</span>
              <strong>{item.marketPriceConfidence ?? "Unknown"}</strong>
            </div>
            <div>
              <span>Updated</span>
              <strong>{lookupLabel ?? "Unknown"}</strong>
            </div>
          </div>
          <div className="inventory-meta">
            {item.marketPriceMatchedName ? <span>{item.marketPriceMatchedName}</span> : null}
            {item.marketPriceMatchedSetName ? <span>{item.marketPriceMatchedSetName}</span> : null}
            {item.marketPriceMatchedCardNumber ? (
              <span>{item.marketPriceMatchedCardNumber}</span>
            ) : null}
            {item.marketPriceCondition ? <span>{item.marketPriceCondition}</span> : null}
            {item.marketPricePrinting ? <span>{item.marketPricePrinting}</span> : null}
          </div>
        </>
      ) : (
        <p className="lookup-note">
          Refresh with PokemonPriceTracker to store a raw-card market price.
        </p>
      )}

      {error ? <p className="form-error">{error}</p> : null}

      {candidates.length > 0 ? (
        <div className="price-candidate-list">
          {candidates.map((candidate) => (
            <article className="price-candidate" key={candidate.sourceVariantId}>
              <div>
                <strong>{candidate.matchedName}</strong>
                <p>
                  {[candidate.matchedSetName, candidate.matchedCardNumber]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <div className="inventory-meta">
                  <span>{formatCurrency(candidate.priceCents)}</span>
                  <span>{candidate.confidence}</span>
                  {candidate.condition ? <span>{candidate.condition}</span> : null}
                  {candidate.printing ? <span>{candidate.printing}</span> : null}
                </div>
              </div>
              <button
                disabled={isRefreshing}
                onClick={() => onSelectCandidate(candidate)}
                type="button"
              >
                Use this price
              </button>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function GradedMarketPriceSummary({
  candidates,
  error,
  isRefreshing,
  item,
  onRefresh,
  onSelectCandidate
}: {
  candidates: PricingCandidate[];
  error: string;
  isRefreshing: boolean;
  item: InventoryItem;
  onRefresh: () => void;
  onSelectCandidate: (candidate: PricingCandidate) => void;
}) {
  const lookupDate = item.marketPriceUpdatedAt ? new Date(item.marketPriceUpdatedAt) : null;
  const lookupLabel =
    lookupDate && !Number.isNaN(lookupDate.getTime())
      ? lookupDate.toLocaleDateString()
      : null;

  return (
    <section className="raw-price-panel" aria-label="Graded market price">
      <div className="graded-cert-header pricing-panel-header">
        <div>
          <p className="eyebrow">Graded market price</p>
          <h4>
            {item.marketPriceCents !== null
              ? formatCurrency(item.marketPriceCents)
              : "No market price yet"}
          </h4>
        </div>
        <div className="graded-cert-actions pricing-panel-actions">
          <EbaySoldCompsLink item={item} />
          <PokemonPriceTrackerLink item={item} />
          <button disabled={isRefreshing} onClick={onRefresh} type="button">
            <RefreshCw size={16} aria-hidden="true" />
            {isRefreshing ? "Refreshing..." : "Refresh graded price"}
          </button>
        </div>
      </div>

      {item.marketPriceCents !== null ? (
        <>
          <div className="graded-cert-stats">
            <div>
              <span>Source</span>
              <strong>{marketPriceSourceLabel(item.marketPriceSource)}</strong>
            </div>
            <div>
              <span>Confidence</span>
              <strong>{item.marketPriceConfidence ?? "Unknown"}</strong>
            </div>
            <div>
              <span>Sales</span>
              <strong>{item.marketPriceSaleCount ?? "Unknown"}</strong>
            </div>
            <div>
              <span>Updated</span>
              <strong>{lookupLabel ?? "Unknown"}</strong>
            </div>
          </div>
          <div className="inventory-meta">
            {item.marketPriceMatchedName ? <span>{item.marketPriceMatchedName}</span> : null}
            {item.marketPriceMatchedSetName ? <span>{item.marketPriceMatchedSetName}</span> : null}
            {item.marketPriceMatchedCardNumber ? (
              <span>{item.marketPriceMatchedCardNumber}</span>
            ) : null}
            {item.marketPriceCondition ? <span>{item.marketPriceCondition}</span> : null}
            {item.marketPricePrinting ? <span>{item.marketPricePrinting}</span> : null}
          </div>
        </>
      ) : (
        <p className="lookup-note">
          Refresh with PokemonPriceTracker to store a graded-card market price.
        </p>
      )}

      {error ? <p className="form-error">{error}</p> : null}

      {candidates.length > 0 ? (
        <div className="price-candidate-list">
          {candidates.map((candidate) => (
            <article
              className="price-candidate"
              key={`${candidate.sourceCardId}-${candidate.sourceVariantId}`}
            >
              <div>
                <strong>{candidate.matchedName}</strong>
                <p>
                  {[candidate.matchedSetName, candidate.matchedCardNumber]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <div className="inventory-meta">
                  <span>{formatCurrency(candidate.priceCents)}</span>
                  <span>{candidate.confidence}</span>
                  <span>{candidate.grader} {candidate.grade}</span>
                  <span>{candidate.saleCount} sales</span>
                  {candidate.medianPriceCents !== null ? (
                    <span>Median {formatCurrency(candidate.medianPriceCents)}</span>
                  ) : null}
                  {candidate.marketTrend ? <span>{candidate.marketTrend}</span> : null}
                </div>
              </div>
              <button
                disabled={isRefreshing}
                onClick={() => onSelectCandidate(candidate)}
                type="button"
              >
                Use this price
              </button>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function EbaySoldCompsLink({ item }: { item: InventoryItem }) {
  return (
    <a
      href={buildEbaySoldSearchUrl(item)}
      rel="noreferrer"
      target="_blank"
      title="Open eBay sold listings search"
    >
      <ExternalLink size={16} aria-hidden="true" />
      eBay solds
    </a>
  );
}

function PokemonPriceTrackerLink({ item }: { item: InventoryItem }) {
  return (
    <a
      href={buildPokemonPriceTrackerUrl(item)}
      rel="noreferrer"
      target="_blank"
      title="Open PokemonPriceTracker search"
    >
      <ExternalLink size={16} aria-hidden="true" />
      PriceTracker
    </a>
  );
}

function PricingHistoryPanel({
  loadedDays,
  isLoading,
  message,
  points,
  selectedDays,
  status,
  onSelectDays,
  onLoad
}: {
  loadedDays: number | null;
  isLoading: boolean;
  message: string;
  points: PricingHistoryPoint[];
  selectedDays: number;
  status: "idle" | "loading" | "error";
  onSelectDays: (days: number) => void;
  onLoad: () => void;
}) {
  const minPrice = points.length > 0 ? Math.min(...points.map((point) => point.priceCents)) : 0;
  const maxPrice = points.length > 0 ? Math.max(...points.map((point) => point.priceCents)) : 0;
  const range = Math.max(1, maxPrice - minPrice);
  const hasLoadedSelectedRange = loadedDays === selectedDays;
  const hasLoadedAnyRange = loadedDays !== null;
  const hasPoints = points.length > 0;
  const heading =
    status === "loading"
      ? `Loading ${selectedDays}d`
      : hasPoints && loadedDays
        ? `${points.length} points · ${loadedDays}d`
        : hasLoadedAnyRange && loadedDays
          ? `No ${loadedDays}d history`
          : "Ready to load";
  const loadLabel = `${hasLoadedSelectedRange ? "Reload" : "Load"} ${selectedDays}d history`;
  const emptyMessage =
    status === "loading"
      ? `Loading ${selectedDays}d history...`
      : hasLoadedAnyRange && status !== "error"
        ? "No price history found for this card/range."
        : "Choose a range, then load history when you need it so PokemonPriceTracker credits are used deliberately.";

  return (
    <section className="raw-price-panel" aria-label="Market price history">
      <div className="graded-cert-header">
        <div>
          <p className="eyebrow">Price history</p>
          <h4>{heading}</h4>
        </div>
        <div className="history-controls">
          <div className="history-actions" aria-label="Price history range">
            {[7, 30, 90].map((option) => (
              <button
                aria-pressed={selectedDays === option}
                className={selectedDays === option ? "active" : ""}
                disabled={isLoading}
                key={option}
                onClick={() => onSelectDays(option)}
                type="button"
              >
                {option}d
              </button>
            ))}
          </div>
          <button
            className="primary-button history-load-button"
            disabled={isLoading}
            onClick={onLoad}
            type="button"
          >
            <RefreshCw size={16} aria-hidden="true" />
            {isLoading ? "Loading..." : loadLabel}
          </button>
        </div>
      </div>

      {hasPoints ? (
        <div className="price-history-chart" aria-hidden="true">
          {points.map((point) => {
            const height = 18 + ((point.priceCents - minPrice) / range) * 82;

            return (
              <span
                key={`${point.date}-${point.priceCents}`}
                style={{ height: `${height}%` }}
                title={`${point.date}: ${formatCurrency(point.priceCents)}`}
              />
            );
          })}
        </div>
      ) : (
        <p className="lookup-note">{emptyMessage}</p>
      )}

      {hasPoints ? (
        <div className="inventory-meta">
          <span>{formatCurrency(points[0].priceCents)} start</span>
          <span>{formatCurrency(points[points.length - 1].priceCents)} latest</span>
          <span>{formatCurrency(minPrice)} low</span>
          <span>{formatCurrency(maxPrice)} high</span>
        </div>
      ) : null}

      {hasLoadedAnyRange && !hasLoadedSelectedRange && status !== "loading" ? (
        <p className="lookup-note">
          Showing {loadedDays}d history. Load {selectedDays}d history to update this panel.
        </p>
      ) : null}

      {message ? (
        <p className={status === "error" ? "form-error" : "lookup-note"}>{message}</p>
      ) : null}
    </section>
  );
}

function ValueOverrideHistoryPanel({
  history,
  status
}: {
  history: ValueOverrideHistoryEntry[];
  status: "idle" | "loading" | "error";
}) {
  if (history.length === 0) {
    return null;
  }

  return (
    <section className="raw-price-panel value-history-panel" aria-label="Manual value history">
      <div className="graded-cert-header">
        <div>
          <p className="eyebrow">Manual value history</p>
          <h4>{history.length > 0 ? `${history.length} changes` : "Not available"}</h4>
        </div>
        {status === "loading" ? <span className="status-pill">Loading</span> : null}
      </div>

      {history.length > 0 ? (
        <div className="value-history-list">
          {history.map((entry) => (
            <div className="value-history-row" key={entry.id}>
              <div>
                <strong>
                  {formatOptionalCurrency(entry.previousValueCents)} {"->"}{" "}
                  {formatOptionalCurrency(entry.nextValueCents)}
                </strong>
                <span>{valueHistoryActor(entry)}</span>
              </div>
              <time dateTime={entry.changedAt}>{formatHistoryDate(entry.changedAt)}</time>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function valueHistoryActor(entry: ValueOverrideHistoryEntry) {
  return entry.changedByDisplayName ?? entry.changedByUsername ?? "Unknown user";
}

function formatOptionalCurrency(cents: number | null) {
  return cents === null ? "None" : formatCurrency(cents);
}

function formatHistoryDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function friendlyPricingHistoryError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to load price history.";

  if (/route\s+get:\/api\/.*not found/i.test(message)) {
    return "Price history is not available from the running API. Restart the API and try again.";
  }

  return message;
}

function InventoryMetaFilterButton({
  filter,
  onSelect
}: {
  filter: InventoryTagFilter;
  onSelect: (filter: InventoryTagFilter) => void;
}) {
  return (
    <button
      aria-label={`Filter collection by ${filter.label}`}
      className="inventory-meta-button"
      onClick={() => onSelect(filter)}
      title={`Filter by ${filter.label}`}
      type="button"
    >
      {filter.label}
    </button>
  );
}

function InventoryItemDetail({
  collectionId,
  item,
  onClose,
  onDeleted,
  onPriceQueued,
  onTagFilter,
  onUpdated
}: {
  collectionId: string;
  item: InventoryItem;
  onClose: () => void;
  onDeleted: (itemId: string) => void;
  onPriceQueued: (queue: BulkPriceQueueResponse, message: string) => void;
  onTagFilter: (filter: InventoryTagFilter) => void;
  onUpdated: (item: InventoryItem) => void;
}) {
  const [imageUrl, setImageUrl] = useState(item.card.imageUrl ?? "");
  const [itemType, setItemType] = useState<InventoryItemType>(item.itemType);
  const [language, setLanguage] = useState<CardLanguage>(item.card.language);
  const [status, setStatus] = useState<
    "idle" | "saving" | "deleting" | "refreshing" | "pricing" | "image" | "image-saving"
  >("idle");
  const [pricingCandidates, setPricingCandidates] = useState<PricingCandidate[]>([]);
  const [gradedPricingCandidates, setGradedPricingCandidates] = useState<PricingCandidate[]>([]);
  const [pricingError, setPricingError] = useState("");
  const [pricingHistory, setPricingHistory] = useState<PricingHistoryPoint[]>([]);
  const [selectedPricingHistoryDays, setSelectedPricingHistoryDays] = useState(30);
  const [loadedPricingHistoryDays, setLoadedPricingHistoryDays] = useState<number | null>(null);
  const [pricingHistoryStatus, setPricingHistoryStatus] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [pricingHistoryMessage, setPricingHistoryMessage] = useState("");
  const [valueHistory, setValueHistory] = useState<ValueOverrideHistoryEntry[]>([]);
  const [valueHistoryStatus, setValueHistoryStatus] = useState<"idle" | "loading" | "error">(
    "idle"
  );
  const [valueHistoryMessage, setValueHistoryMessage] = useState("");
  const [imageCandidates, setImageCandidates] = useState<CardLookupCandidate[]>([]);
  const [imageLookupMessage, setImageLookupMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setPricingCandidates([]);
    setGradedPricingCandidates([]);
    setPricingError("");
    setPricingHistory([]);
    setSelectedPricingHistoryDays(30);
    setLoadedPricingHistoryDays(null);
    setPricingHistoryStatus("idle");
    setPricingHistoryMessage("");
    setValueHistory([]);
    setValueHistoryStatus("idle");
    setValueHistoryMessage("");
    setImageCandidates([]);
    setImageLookupMessage("");
    setError("");
    setStatus("idle");
  }, [item.id]);

  useEffect(() => {
    let isCurrent = true;

    setValueHistory([]);
    setValueHistoryStatus("loading");
    setValueHistoryMessage("");

    api
      .getValueOverrideHistory(collectionId, item.id)
      .then((response) => {
        if (!isCurrent) {
          return;
        }

        setValueHistory(response.history);
        setValueHistoryStatus("idle");
      })
      .catch((historyError) => {
        if (!isCurrent) {
          return;
        }

        setValueHistoryStatus("error");
        setValueHistoryMessage(
          historyError instanceof Error
            ? historyError.message
            : "Unable to load manual value history."
        );
      });

    return () => {
      isCurrent = false;
    };
  }, [collectionId, item.id]);

  useEffect(() => {
    setImageUrl(item.card.imageUrl ?? "");
    setItemType(item.itemType);
    setLanguage(item.card.language);
  }, [item.card.imageUrl, item.card.language, item.itemType]);

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
        releaseYear: String(formData.get("releaseYear") ?? ""),
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
    setImageCandidates([]);
    setImageLookupMessage("");
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

  async function handleFetchImage() {
    setError("");
    setImageCandidates([]);
    setImageLookupMessage("");
    setStatus("image");

    try {
      const candidates = await findCardImageCandidatesForItem(collectionId, item);

      if (candidates.length === 0) {
        throw new Error("No image found for this card.");
      }

      setImageCandidates(candidates);
      setImageLookupMessage(
        `Found ${candidates.length} image option${candidates.length === 1 ? "" : "s"}.`
      );
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Unable to fetch image options.");
    } finally {
      setStatus("idle");
    }
  }

  async function handleSelectImageCandidate(candidate: CardLookupCandidate) {
    const image = imageUrlFromLookupCandidate(candidate);

    if (!image) {
      setError("This option does not include an image.");
      return;
    }

    setError("");
    setStatus("image-saving");

    try {
      const response = await api.updateInventoryItemImage(collectionId, item.id, {
        imageUrl: image
      });

      setImageUrl(response.item.card.imageUrl ?? "");
      setImageCandidates([]);
      setImageLookupMessage("Image updated.");
      onUpdated(response.item);
    } catch (saveImageError) {
      setError(saveImageError instanceof Error ? saveImageError.message : "Unable to save image.");
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

  async function handleRefreshRawPrice() {
    if (item.itemType !== "raw") {
      setError("Raw pricing is only available for raw cards.");
      return;
    }

    setPricingError("");
    setPricingCandidates([]);
    setGradedPricingCandidates([]);
    setStatus("pricing");

    try {
      const response = await api.refreshPricing(collectionId, item.id);

      if (response.status === "queued" && response.queue) {
        onPriceQueued(response.queue, response.message);
        setPricingError(response.message);
        return;
      }

      if (response.item) {
        onUpdated(response.item);
      }

      setPricingCandidates(
        response.status === "needs-review"
          ? response.candidates.filter((candidate) => candidate.priceKind === "raw")
          : []
      );

      if (response.status === "needs-review") {
        setPricingError(response.message);
      }
    } catch (pricingError) {
      setPricingError(
        pricingError instanceof Error ? pricingError.message : "Unable to refresh raw pricing."
      );
    } finally {
      setStatus("idle");
    }
  }

  async function handleSelectRawPrice(candidate: PricingCandidate) {
    setPricingError("");
    setStatus("pricing");

    try {
      const response = await api.selectPricing(collectionId, item.id, {
        sourceCardId: candidate.sourceCardId,
        sourceVariantId: candidate.sourceVariantId,
        source: candidate.source,
        candidate
      });

      if (response.item) {
        onUpdated(response.item);
      }

      setPricingCandidates([]);
    } catch (pricingError) {
      setPricingError(
        pricingError instanceof Error ? pricingError.message : "Unable to save raw pricing."
      );
    } finally {
      setStatus("idle");
    }
  }

  async function handleRefreshGradedPrice() {
    if (item.itemType !== "graded") {
      setError("PokemonPriceTracker graded pricing is only available for graded cards.");
      return;
    }

    setPricingError("");
    setPricingCandidates([]);
    setGradedPricingCandidates([]);
    setStatus("pricing");

    try {
      const response = await api.refreshPricing(collectionId, item.id);

      if (response.status === "queued" && response.queue) {
        onPriceQueued(response.queue, response.message);
        setPricingError(response.message);
        return;
      }

      if (response.item) {
        onUpdated(response.item);
      }

      setGradedPricingCandidates(
        response.status === "needs-review"
          ? response.candidates.filter((candidate) => candidate.priceKind === "graded")
          : []
      );

      if (response.status === "needs-review") {
        setPricingError(response.message);
      }
    } catch (pricingError) {
      setPricingError(
        pricingError instanceof Error
          ? pricingError.message
          : "Unable to refresh PokemonPriceTracker pricing."
      );
    } finally {
      setStatus("idle");
    }
  }

  async function handleSelectGradedPrice(candidate: PricingCandidate) {
    setPricingError("");
    setStatus("pricing");

    try {
      const response = await api.selectPricing(collectionId, item.id, {
        sourceCardId: candidate.sourceCardId,
        sourceVariantId: candidate.sourceVariantId,
        source: candidate.source,
        candidate
      });

      if (response.item) {
        onUpdated(response.item);
      }

      setGradedPricingCandidates([]);
    } catch (pricingError) {
      setPricingError(
        pricingError instanceof Error
          ? pricingError.message
          : "Unable to save PokemonPriceTracker pricing."
      );
    } finally {
      setStatus("idle");
    }
  }

  async function handleLoadPricingHistory() {
    setPricingHistoryStatus("loading");
    setPricingHistoryMessage("");

    try {
      const response = await api.getPricingHistory(collectionId, item.id, selectedPricingHistoryDays);
      setPricingHistory(response.points);
      setLoadedPricingHistoryDays(response.days);
      setPricingHistoryStatus("idle");
      setPricingHistoryMessage(response.points.length > 0 ? response.message : "");
    } catch (historyError) {
      setPricingHistoryStatus("error");
      setPricingHistoryMessage(friendlyPricingHistoryError(historyError));
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
              <InventoryMetaFilterButton
                filter={{
                  type: "language",
                  label: languageLabel(item.card.language),
                  value: item.card.language
                }}
                onSelect={onTagFilter}
              />
              <InventoryMetaFilterButton
                filter={{
                  type: "itemType",
                  label: item.itemType === "graded" ? "Graded" : "Raw",
                  value: item.itemType
                }}
                onSelect={onTagFilter}
              />
              {item.card.setCode ? (
                <InventoryMetaFilterButton
                  filter={{ type: "query", label: item.card.setCode, value: item.card.setCode }}
                  onSelect={onTagFilter}
                />
              ) : null}
              {item.card.cardNumber ? (
                <InventoryMetaFilterButton
                  filter={{
                    type: "query",
                    label: item.card.cardNumber,
                    value: item.card.cardNumber
                  }}
                  onSelect={onTagFilter}
                />
              ) : null}
              {item.card.setName ? (
                <InventoryMetaFilterButton
                  filter={{ type: "query", label: item.card.setName, value: item.card.setName }}
                  onSelect={onTagFilter}
                />
              ) : null}
              {item.card.releaseYear ? (
                <InventoryMetaFilterButton
                  filter={{
                    type: "query",
                    label: item.card.releaseYear,
                    value: item.card.releaseYear
                  }}
                  onSelect={onTagFilter}
                />
              ) : null}
              {item.card.rarity ? (
                <InventoryMetaFilterButton
                  filter={{ type: "query", label: item.card.rarity, value: item.card.rarity }}
                  onSelect={onTagFilter}
                />
              ) : null}
              {variantsFromText(item.variantDetails ?? "").map((variant) => (
                <InventoryMetaFilterButton
                  filter={{ type: "variant", label: variant, value: variant }}
                  key={variant}
                  onSelect={onTagFilter}
                />
              ))}
              {item.grader && item.grade ? (
                <InventoryMetaFilterButton
                  filter={{
                    type: "query",
                    label: `${item.grader} ${item.grade}`,
                    value: `${item.grader} ${item.grade}`
                  }}
                  onSelect={onTagFilter}
                />
              ) : null}
              {item.certNumber ? (
                <InventoryMetaFilterButton
                  filter={{
                    type: "query",
                    label: `Cert ${item.certNumber}`,
                    value: item.certNumber
                  }}
                  onSelect={onTagFilter}
                />
              ) : null}
              {item.storageLocation ? (
                <InventoryMetaFilterButton
                  filter={{
                    type: "storage",
                    label: item.storageLocation,
                    value: item.storageLocation
                  }}
                  onSelect={onTagFilter}
                />
              ) : null}
            </div>

            {itemType === "graded" ? (
              <>
                <GradedCertSummary
                  item={item}
                  isRefreshing={status === "refreshing"}
                  onRefresh={handleRefreshCert}
                />
                <GradedMarketPriceSummary
                  candidates={gradedPricingCandidates}
                  error={pricingError}
                  isRefreshing={status === "pricing"}
                  item={item}
                  onRefresh={handleRefreshGradedPrice}
                  onSelectCandidate={handleSelectGradedPrice}
                />
              </>
            ) : null}

            {itemType === "raw" ? (
              <RawMarketPriceSummary
                candidates={pricingCandidates}
                error={pricingError}
                isRefreshing={status === "pricing"}
                item={item}
                onRefresh={handleRefreshRawPrice}
                onSelectCandidate={handleSelectRawPrice}
              />
            ) : null}

            {showMarketPriceHistoryPanel && item.marketPriceSource === "pokemonpricetracker" ? (
              <PricingHistoryPanel
                isLoading={pricingHistoryStatus === "loading"}
                loadedDays={loadedPricingHistoryDays}
                message={pricingHistoryMessage}
                points={pricingHistory}
                selectedDays={selectedPricingHistoryDays}
                status={pricingHistoryStatus}
                onSelectDays={setSelectedPricingHistoryDays}
                onLoad={handleLoadPricingHistory}
              />
            ) : null}

            <ValueOverrideHistoryPanel
              history={valueHistory}
              status={valueHistoryStatus}
            />

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
                Release year
                <input
                  defaultValue={item.card.releaseYear ?? ""}
                  inputMode="numeric"
                  maxLength={4}
                  name="releaseYear"
                />
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
              {imageLookupMessage ? <p className="lookup-note wide-field">{imageLookupMessage}</p> : null}
              {imageCandidates.length > 0 ? (
                <ImageLookupOptions
                  candidates={imageCandidates}
                  disabled={status !== "idle"}
                  onSelect={handleSelectImageCandidate}
                />
              ) : null}
              <div className="detail-actions">
                <button className="primary-button" disabled={status !== "idle"} type="submit">
                  <Upload size={18} aria-hidden="true" />
                  {status === "saving" ? "Saving..." : "Save changes"}
                </button>
                <button disabled={status !== "idle"} onClick={handleFetchImage} type="button">
                  <ImageIcon size={18} aria-hidden="true" />
                  {status === "image"
                    ? "Fetching..."
                    : item.card.imageUrl
                      ? "Refresh image"
                      : "Fetch image"}
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

function ImageLookupOptions({
  candidates,
  disabled,
  onSelect
}: {
  candidates: CardLookupCandidate[];
  disabled: boolean;
  onSelect: (candidate: CardLookupCandidate) => void;
}) {
  return (
    <section className="image-option-panel wide-field" aria-label="Image options">
      <div>
        <p className="eyebrow">Image options</p>
        <h4>Choose card art</h4>
      </div>
      <div className="image-option-list">
        {candidates.map((candidate) => {
          const image = imageUrlFromLookupCandidate(candidate);

          return (
            <article className="image-option" key={`${candidate.id}-${image ?? ""}`}>
              <div className="image-option-thumb" aria-hidden="true">
                {image ? (
                  <img alt="" src={image} />
                ) : (
                  <ImageIcon size={28} aria-hidden="true" />
                )}
              </div>
              <div className="image-option-copy">
                <strong>{candidate.name}</strong>
                <p>
                  {[candidate.setName, candidate.cardNumber, candidate.language.toUpperCase()]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p>
                  {formatImageCandidateSource(candidate.source)} · {candidate.confidence}
                </p>
              </div>
              <button disabled={disabled || !image} onClick={() => onSelect(candidate)} type="button">
                Use image
              </button>
            </article>
          );
        })}
      </div>
    </section>
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
          (item.valueOverrideCents ?? item.marketPriceCents ?? item.purchasePriceCents ?? 0) *
          item.quantity;
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
  const certNumber = normalizedCertNumber(payload.certNumber);

  if (certNumber) {
    const matchingCertItem = items.find((item) => normalizedCertNumber(item.certNumber) === certNumber);

    if (matchingCertItem) {
      return matchingCertItem;
    }
  }

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
    releaseYear: item.card.releaseYear ?? "",
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

async function applyBestImageCandidateToItem(collectionId: string, item: InventoryItem | null) {
  if (!item) {
    return null;
  }

  try {
    const candidates = await findCardImageCandidatesForItem(collectionId, item);
    const image = candidates[0] ? imageUrlFromLookupCandidate(candidates[0]) : null;

    if (!image) {
      return item;
    }

    const response = await api.updateInventoryItemImage(collectionId, item.id, { imageUrl: image });
    return response.item;
  } catch {
    return item;
  }
}

async function findCardImageCandidatesForItem(collectionId: string, item: InventoryItem) {
  const payload = inventoryItemToPayload(item);

  try {
    const response = await promiseWithTimeout(
      api.lookupPokemonPriceTrackerImageCandidates(collectionId, item.id),
      18000,
      { candidates: [], message: "PokemonPriceTracker image lookup timed out." }
    );

    if (response.candidates.length > 0) {
      return mergeImageLookupCandidates(response.candidates);
    }
  } catch {
    // Fall back to the generic lookup databases when PokemonPriceTracker is unavailable.
  }

  return promiseWithTimeout(findCardImageCandidatesForPayload(payload), 15000, []);
}

async function findCardImageCandidatesForPayload(
  payload: CreateInventoryItemRequest
): Promise<CardLookupCandidate[]> {
  const queries = imageLookupQueriesForPayload(payload);
  const languages: Array<CardLanguage | "all"> =
    payload.language === "other" ? ["all"] : [payload.language, "all"];
  const candidateMap = new Map<string, { candidate: CardLookupCandidate; score: number }>();

  for (const query of queries) {
    for (const language of languages) {
      try {
        const result = await api.lookupCards({ query, language });

        for (const candidate of result.candidates) {
          const image = imageUrlFromLookupCandidate(candidate);

          if (!image || !imageLookupCandidateMatchesPayload(payload, candidate)) {
            continue;
          }

          const key = image || `${candidate.source}:${candidate.sourceId || candidate.id}`;
          const score = scoreImageLookupCandidate(payload, candidate);
          const current = candidateMap.get(key);

          if (!current || score > current.score) {
            candidateMap.set(key, { candidate, score });
          }
        }
      } catch {
        // Image fetch is a convenience path. Keep manual edit/import flows usable if lookup fails.
      }
    }
  }

  return [...candidateMap.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, 8)
    .map((entry) => entry.candidate);
}

function mergeImageLookupCandidates(candidates: CardLookupCandidate[]) {
  const candidateMap = new Map<string, CardLookupCandidate>();

  for (const candidate of candidates) {
    const image = imageUrlFromLookupCandidate(candidate);

    if (!image) {
      continue;
    }

    const existing = candidateMap.get(image);

    if (!existing || candidate.score > existing.score) {
      candidateMap.set(image, candidate);
    }
  }

  return [...candidateMap.values()].slice(0, 8);
}

function imageLookupQueriesForPayload(payload: CreateInventoryItemRequest) {
  const queries: string[] = [];
  const names = imageLookupNameOptions(payload.name);

  for (const name of names) {
    queries.push(
      [name, payload.setName, payload.cardNumber].filter(Boolean).join(" "),
      [name, payload.setCode, payload.cardNumber].filter(Boolean).join(" "),
      [name, payload.cardNumber].filter(Boolean).join(" "),
      [name, payload.setName].filter(Boolean).join(" ")
    );
  }

  queries.push(
    [payload.setCode, payload.cardNumber].filter(Boolean).join(" "),
    [payload.setName, payload.cardNumber].filter(Boolean).join(" ")
  );

  return uniqueNonEmptyStrings(queries);
}

function imageLookupNameOptions(name: string) {
  const trimmed = name.trim();
  const withoutPsaFinish = trimmed.replace(/\s*-\s*(holo|hologram|reverse holo)$/i, "").trim();

  return uniqueNonEmptyStrings([trimmed, withoutPsaFinish]);
}

function scoreImageLookupCandidate(
  payload: CreateInventoryItemRequest,
  candidate: CardLookupCandidate
) {
  let score = candidate.score;

  score += candidate.confidence === "exact" ? 120 : candidate.confidence === "strong" ? 70 : 20;

  if (candidate.language === payload.language) {
    score += 40;
  }

  if (payload.cardNumber && candidate.cardNumber) {
    score += cardNumbersCompatible(payload.cardNumber, candidate.cardNumber) ? 90 : -60;
  }

  if (payload.setCode && candidate.setCode) {
    score += normalizeText(candidate.setCode) === normalizeText(payload.setCode) ? 50 : 0;
  }

  if (payload.setName && candidate.setName) {
    const payloadSetName = normalizeSearchText(payload.setName);
    const candidateSetName = normalizeSearchText(candidate.setName);

    if (candidateSetName === payloadSetName) {
      score += 50;
    } else if (
      candidateSetName.includes(payloadSetName) ||
      payloadSetName.includes(candidateSetName)
    ) {
      score += 25;
    }
  }

  const payloadNames = imageLookupNameOptions(payload.name).map(normalizeSearchText);
  const candidateName = normalizeSearchText(candidate.name);

  if (payloadNames.includes(candidateName)) {
    score += 50;
  } else if (
    payloadNames.some((name) => candidateName.includes(name) || name.includes(candidateName))
  ) {
    score += 25;
  }

  return score;
}

function imageLookupCandidateMatchesPayload(
  payload: CreateInventoryItemRequest,
  candidate: CardLookupCandidate
) {
  if (
    payload.cardNumber &&
    candidate.cardNumber &&
    !cardNumbersCompatible(payload.cardNumber, candidate.cardNumber)
  ) {
    return false;
  }

  const payloadNames = imageLookupNameOptions(payload.name).map(normalizeSearchText).filter(Boolean);
  const candidateNames = imageLookupNameOptions(candidate.name).map(normalizeSearchText).filter(Boolean);

  if (
    payloadNames.length > 0 &&
    candidateNames.length > 0 &&
    !payloadNames.some((payloadName) =>
      candidateNames.some(
        (candidateName) =>
          payloadName === candidateName ||
          (payloadName.length >= 4 &&
            candidateName.length >= 4 &&
            (payloadName.includes(candidateName) || candidateName.includes(payloadName)))
      )
    )
  ) {
    return false;
  }

  if (payload.setName && candidate.setName) {
    const payloadSetName = normalizeSearchText(payload.setName);
    const candidateSetName = normalizeSearchText(candidate.setName);

    if (
      payloadSetName &&
      candidateSetName &&
      payloadSetName !== candidateSetName &&
      !payloadSetName.includes(candidateSetName) &&
      !candidateSetName.includes(payloadSetName)
    ) {
      return false;
    }
  }

  return true;
}

function cardNumbersCompatible(left: unknown, right: unknown) {
  const leftNumber = normalizeCardNumber(left);
  const rightNumber = normalizeCardNumber(right);
  const leftPrinted = leftNumber.split("/")[0];
  const rightPrinted = rightNumber.split("/")[0];

  return Boolean(
    leftNumber &&
      rightNumber &&
      (leftNumber === rightNumber || leftPrinted === rightNumber || rightPrinted === leftNumber)
  );
}

function imageUrlFromLookupCandidate(candidate: CardLookupCandidate) {
  return candidate.imageUrl || candidate.item.imageUrl || null;
}

function formatImageCandidateSource(source: CardLookupCandidate["source"]) {
  if (source === "pokemonpricetracker") {
    return "PokemonPriceTracker";
  }

  if (source === "pokemontcg") {
    return "PokemonTCG.io";
  }

  if (source === "tcgdex") {
    return "TCGdex";
  }

  if (source === "japanese-cache") {
    return "Japanese cache";
  }

  return "Parsed";
}

function uniqueNonEmptyStrings(values: string[]) {
  const seen = new Set<string>();
  const uniqueValues: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();

    if (!trimmed || seen.has(normalizeText(trimmed))) {
      continue;
    }

    seen.add(normalizeText(trimmed));
    uniqueValues.push(trimmed);
  }

  return uniqueValues;
}

function promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), timeoutMs);

    promise
      .then((value) => resolve(value))
      .catch(() => resolve(fallback))
      .finally(() => window.clearTimeout(timer));
  });
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

function normalizedCertNumber(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeQuantity(value: unknown) {
  const quantity = Number(value);
  return Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
}

function createClientId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
      16,
      20
    )}-${hex.slice(20)}`;
  }

  return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
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
    id: createClientId(),
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

function parseInventoryCsvImport(value: string): CsvImportPreviewRow[] {
  const records = parseCsvRecords(value).filter((record) =>
    record.cells.some((cell) => cell.trim().length > 0)
  );

  if (records.length === 0) {
    return [];
  }

  const headers = records[0].cells.map(normalizeCsvHeader);
  const seenHeaders = new Set<string>();

  for (const header of headers) {
    if (!header) {
      continue;
    }

    if (seenHeaders.has(header)) {
      throw new Error(`CSV has duplicate column "${header}".`);
    }

    seenHeaders.add(header);
  }

  return records.slice(1).map((record) => createCsvImportPreviewRow(headers, record));
}

function createCsvImportPreviewRow(
  headers: string[],
  record: { cells: string[]; lineNumber: number }
): CsvImportPreviewRow {
  const raw = headers.reduce<Record<string, string>>((row, header, index) => {
    if (header) {
      row[header] = record.cells[index]?.trim() ?? "";
    }

    return row;
  }, {});

  if (isPsaVaultCsvRow(raw)) {
    return createPsaVaultCsvImportPreviewRow(raw, record);
  }

  const itemType = csvItemType(csvValue(raw, "item_type", "type"));
  const language = csvLanguage(csvValue(raw, "language", "lang"));
  const quantity = csvInteger(csvValue(raw, "quantity", "qty"), 1);
  const conditionScore = csvOptionalNumber(csvValue(raw, "condition_score", "score"));
  const purchasePriceCents = csvOptionalCents(
    csvValue(raw, "purchase_price_cents"),
    csvValue(raw, "purchase_price", "purchase")
  );
  const valueOverrideCents = csvOptionalCents(
    csvValue(raw, "value_override_cents"),
    csvValue(raw, "value_override", "value")
  );
  const certEstimateCents = csvOptionalCents(csvValue(raw, "cert_estimate_cents"));
  const payload: CreateInventoryItemRequest = {
    name: csvValue(raw, "name", "card_name"),
    setName: csvValue(raw, "set_name"),
    setCode: csvValue(raw, "set_code"),
    cardNumber: csvValue(raw, "card_number", "number"),
    language,
    rarity: csvValue(raw, "rarity"),
    imageUrl: csvValue(raw, "image_url"),
    itemType,
    quantity,
    conditionLabel: csvValue(raw, "condition_label", "condition"),
    conditionScore,
    variantDetails: csvValue(raw, "variant_details", "variants"),
    grader: itemType === "graded" ? csvValue(raw, "grader") : "",
    grade: itemType === "graded" ? csvValue(raw, "grade") : "",
    certNumber: itemType === "graded" ? csvValue(raw, "cert_number", "cert") : "",
    certUrl: csvValue(raw, "cert_url"),
    certSpecId: csvValue(raw, "cert_spec_id"),
    certCategory: csvValue(raw, "cert_category"),
    certPopulation: csvValue(raw, "cert_population"),
    certPopulationHigher: csvValue(raw, "cert_population_higher"),
    certEstimateCents,
    certLookupAt: csvValue(raw, "cert_lookup_at"),
    purchasePriceCents,
    purchaseDate: csvValue(raw, "purchase_date"),
    valueOverrideCents,
    storageLocation: csvValue(raw, "storage_location", "storage"),
    notes: csvValue(raw, "notes")
  };
  const errors = validateCsvImportPayload(payload, raw, record.cells.length > headers.length);

  return {
    id: createClientId(),
    lineNumber: record.lineNumber,
    raw,
    payload,
    errors,
    status: errors.length > 0 ? "error" : "ready"
  };
}

function createPsaVaultCsvImportPreviewRow(
  raw: Record<string, string>,
  record: { cells: string[]; lineNumber: number }
): CsvImportPreviewRow {
  const setName = csvPlaceholderValue(raw, "set");
  const normalizedSetName = normalizePsaVaultSetName(setName);
  const subject = csvPlaceholderValue(raw, "subject");
  const variety = csvPlaceholderValue(raw, "variety");
  const itemDescription = csvPlaceholderValue(raw, "item");
  const parsedName = parsePsaVaultCardName(subject || nameFromPsaVaultItem(itemDescription));
  const certNumber = csvPlaceholderValue(raw, "cert_number");
  const grader = csvPlaceholderValue(raw, "grade_issuer") || "PSA";
  const grade = csvPlaceholderValue(raw, "grade");
  const vaultStatus = csvPlaceholderValue(raw, "vault_status");
  const vaultedDate = csvPlaceholderValue(raw, "vaulted_date");
  const source = csvPlaceholderValue(raw, "source");
  const listingStatus = csvPlaceholderValue(raw, "listing_status");
  const soldStatus = csvPlaceholderValue(raw, "sold_status");
  const notes = [
    csvPlaceholderValue(raw, "my_notes"),
    vaultStatus ? `Vault status: ${vaultStatus}` : "",
    vaultedDate ? `Vaulted date: ${vaultedDate}` : "",
    source ? `Source: ${source}` : "",
    listingStatus ? `Listing status: ${listingStatus}` : "",
    soldStatus ? `Sold status: ${soldStatus}` : "",
    itemDescription ? `PSA Vault item: ${itemDescription}` : ""
  ]
    .filter(Boolean)
    .join("\n");
  const payload: CreateInventoryItemRequest = {
    name: parsedName.name,
    setName: normalizedSetName,
    setCode: setCodeFromPsaVaultSet(setName),
    cardNumber: csvPlaceholderValue(raw, "card_number"),
    language: psaVaultLanguage(setName, itemDescription),
    rarity: "",
    releaseYear: csvPlaceholderValue(raw, "year"),
    imageUrl: "",
    itemType: "graded",
    quantity: 1,
    conditionLabel: "",
    conditionScore: undefined,
    variantDetails: psaVaultVariantDetails(variety, parsedName.variant, normalizedSetName),
    grader,
    grade,
    certNumber,
    certUrl: certNumber ? `https://www.psacard.com/cert/${certNumber}/psa` : "",
    certSpecId: "",
    certCategory: titleCaseSetName(csvPlaceholderValue(raw, "category")),
    certPopulation: "",
    certPopulationHigher: "",
    certEstimateCents: csvOptionalCents("", csvPlaceholderValue(raw, "psa_estimate")),
    certLookupAt: "",
    purchasePriceCents: csvOptionalCents("", csvPlaceholderValue(raw, "my_cost")),
    purchaseDate: normalizeCsvDate(csvPlaceholderValue(raw, "date_acquired")),
    valueOverrideCents: csvOptionalCents("", csvPlaceholderValue(raw, "my_value")),
    storageLocation: vaultStatus || "",
    notes
  };
  const errors = validateCsvImportPayload(payload, raw, record.cells.length > Object.keys(raw).length);

  return {
    id: createClientId(),
    lineNumber: record.lineNumber,
    raw,
    payload,
    errors,
    status: errors.length > 0 ? "error" : "ready"
  };
}

function isPsaVaultCsvRow(raw: Record<string, string>) {
  return Boolean(
    raw.item_status !== undefined &&
      raw.cert_number !== undefined &&
      raw.grade_issuer !== undefined &&
      raw.psa_estimate !== undefined &&
      raw.vault_status !== undefined
  );
}

function validateCsvImportPayload(
  payload: CreateInventoryItemRequest,
  raw: Record<string, string>,
  hasExtraCells: boolean
) {
  const errors: string[] = [];
  const rawLanguage = csvValue(raw, "language", "lang").toLowerCase();
  const rawItemType = csvValue(raw, "item_type", "type").toLowerCase();
  const rawQuantity = csvValue(raw, "quantity", "qty");

  if (hasExtraCells) {
    errors.push("Row has more values than the header row.");
  }

  if (!payload.name.trim() || payload.name.trim().length < 2) {
    errors.push("Card name must be at least 2 characters.");
  }

  if (
    rawLanguage &&
    !["en", "english", "ja", "japanese", "other"].includes(rawLanguage)
  ) {
    errors.push("Language must be en, ja, or other.");
  }

  if (rawItemType && !["raw", "graded"].includes(rawItemType)) {
    errors.push("Item type must be raw or graded.");
  }

  if (
    (rawQuantity && !Number.isInteger(Number(rawQuantity))) ||
    !Number.isInteger(payload.quantity) ||
    payload.quantity < 1 ||
    payload.quantity > 999
  ) {
    errors.push("Quantity must be between 1 and 999.");
  }

  if (
    payload.conditionScore !== undefined &&
    (!Number.isFinite(payload.conditionScore) ||
      payload.conditionScore < 1 ||
      payload.conditionScore > 10)
  ) {
    errors.push("Condition score must be between 1 and 10.");
  }

  if (payload.itemType === "graded" && !payload.grader?.trim()) {
    errors.push("Graded rows need a grader.");
  }

  if (!isValidOptionalCents(payload.purchasePriceCents)) {
    errors.push("Purchase price must be a positive amount.");
  }

  if (!isValidOptionalCents(payload.valueOverrideCents)) {
    errors.push("Value override must be a positive amount.");
  }

  if (!isValidOptionalCents(payload.certEstimateCents)) {
    errors.push("Cert estimate must be a positive amount.");
  }

  return errors;
}

function parseCsvRecords(value: string) {
  const records: Array<{ cells: string[]; lineNumber: number }> = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let lineNumber = 1;
  let rowLineNumber = 1;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;

        if (char === "\n") {
          lineNumber += 1;
        }
      }

      continue;
    }

    if (char === '"' && cell.length === 0) {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      cells.push(cell);
      cell = "";
      continue;
    }

    if (char === "\n" || char === "\r") {
      cells.push(cell);
      records.push({ cells, lineNumber: rowLineNumber });
      cells = [];
      cell = "";

      if (char === "\r" && next === "\n") {
        index += 1;
      }

      lineNumber += 1;
      rowLineNumber = lineNumber;
      continue;
    }

    cell += char;
  }

  if (inQuotes) {
    throw new Error("CSV has an unclosed quoted field.");
  }

  if (cell.length > 0 || cells.length > 0) {
    cells.push(cell);
    records.push({ cells, lineNumber: rowLineNumber });
  }

  return records;
}

function summarizeCsvImportRows(rows: CsvImportPreviewRow[]) {
  return rows.reduce(
    (summary, row) => {
      summary[row.status] += 1;
      return summary;
    },
    {
      ready: 0,
      error: 0,
      adding: 0,
      added: 0,
      skipped: 0
    }
  );
}

function csvValue(raw: Record<string, string>, ...keys: string[]) {
  for (const key of keys) {
    const value = raw[normalizeCsvHeader(key)];

    if (value) {
      return value.trim();
    }
  }

  return "";
}

function csvPlaceholderValue(raw: Record<string, string>, ...keys: string[]) {
  const value = csvValue(raw, ...keys);
  return value === "-" ? "" : value;
}

function normalizeCsvHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function csvLanguage(value: string): CardLanguage {
  const language = value.trim().toLowerCase();

  if (language === "ja" || language === "japanese") {
    return "ja";
  }

  if (language === "other") {
    return "other";
  }

  return "en";
}

function csvItemType(value: string): InventoryItemType {
  return value.trim().toLowerCase() === "graded" ? "graded" : "raw";
}

function csvInteger(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function csvOptionalNumber(value: string) {
  if (!value.trim()) {
    return undefined;
  }

  return Number(value);
}

function csvOptionalCents(centsValue: string, moneyValue = "") {
  if (centsValue.trim()) {
    return Number(centsValue);
  }

  if (!moneyValue.trim()) {
    return undefined;
  }

  return Math.round(Number(moneyValue.replace(/[$,]/g, "")) * 100);
}

function isValidOptionalCents(value: number | undefined) {
  return value === undefined || (Number.isInteger(value) && value >= 0);
}

function normalizeCsvDate(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);

  if (!match) {
    return trimmed;
  }

  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function psaVaultLanguage(setName: string, itemDescription: string): CardLanguage {
  const text = `${setName} ${itemDescription}`.toLowerCase();
  return text.includes("japanese") ? "ja" : "en";
}

function normalizePsaVaultSetName(value: string) {
  const rawName = value.replace(/\s+/g, " ").trim();
  const normalized = normalizeText(rawName);
  const explicitNames: Record<string, string> = {
    "pokemon jtg en-journey together": "Journey Together",
    "pokemon mew en-151": "151",
    "pokemon pre en-prismatic evolutions": "Prismatic Evolutions",
    "pokemon pop series 2": "POP Series 2",
    "pokemon rocket": "Team Rocket",
    "pokemon sun & moon forbidden light": "Forbidden Light",
    "pokemon japanese m1l-mega brave": "Mega Brave (M1L)",
    "pokemon japanese m2a-mega dream ex": "Mega Dream ex (M2a)",
    "pokemon japanese sv-p promo": "SV-P Promotional Cards",
    "pokemon japanese s promo": "S Promotional Cards",
    "pokemon japanese promo": "Japanese Promo",
    "pokemon japanese e-starter deck": "Japanese E-Starter Deck",
    "pokemon japanese vending": "Japanese Vending",
    "pokemon japanese neo 4": "Japanese Neo 4"
  };

  if (explicitNames[normalized]) {
    return explicitNames[normalized];
  }

  const japaneseCodeMatch = /^pokemon japanese ([a-z0-9]+)-(.+)$/i.exec(rawName);

  if (japaneseCodeMatch) {
    return `${titleCaseSetName(japaneseCodeMatch[2])} (${japaneseCodeMatch[1].toUpperCase()})`;
  }

  const englishCodeMatch = /^pokemon [a-z0-9]+ en-(.+)$/i.exec(rawName);

  if (englishCodeMatch) {
    return titleCaseSetName(englishCodeMatch[1]);
  }

  return titleCaseSetName(rawName.replace(/^pokemon\s+/i, ""));
}

function setCodeFromPsaVaultSet(setName: string) {
  const ignored = new Set(["POKEMON", "JAPANESE", "PROMO"]);
  const match = setName
    .toUpperCase()
    .match(/\b[A-Z]{1,5}\d{0,3}[A-Z]?(?:-[A-Z0-9]+)?\b/g)
    ?.find((token) => !ignored.has(token));

  if (!match) {
    return "";
  }

  const normalized = /^(SV\d+|M\d[A-Z])/i.exec(match)?.[0] ?? match;
  return normalized;
}

function nameFromPsaVaultItem(itemDescription: string) {
  const hashIndex = itemDescription.indexOf("#");

  if (hashIndex === -1) {
    return itemDescription;
  }

  return itemDescription
    .slice(hashIndex)
    .replace(/^#\S+\s+/, "")
    .replace(/\s+[A-Z0-9-]+(?:'S)?(?:\s+[A-Z0-9-]+)*$/, "")
    .trim();
}

function parsePsaVaultCardName(value: string) {
  const rawName = value.replace(/\s+/g, " ").trim();
  const slashParts = rawName.split(/\s*\/\s*/);
  const variants: string[] = [];
  let name = rawName;

  if (slashParts.length >= 2 && isPsaVaultLeadingVariant(slashParts[0])) {
    variants.push(slashParts[0]);
    name = slashParts.slice(1).join("/");
  }

  const trailingVariant = psaVaultTrailingVariant(name);

  if (trailingVariant) {
    variants.push(trailingVariant.variant);
    name = trailingVariant.name;
  }

  return {
    name: titleCaseCardName(name),
    variant: csvVariantDetails(...variants)
  };
}

function isPsaVaultLeadingVariant(value: string) {
  return [
    "alternate art",
    "full art",
    "hyper rare",
    "illustration rare",
    "secret rare",
    "special art",
    "special illustration rare"
  ].includes(normalizeText(value));
}

function psaVaultTrailingVariant(value: string) {
  const match = /\s*[-–—]\s*(reverse holo|reverse foil|holo|foil)\s*$/i.exec(value);

  if (!match || match.index === undefined) {
    return null;
  }

  const name = value.slice(0, match.index).trim();
  const variant = normalizeText(match[1]).includes("reverse") ? "Reverse Holo" : "Holo / Foil";

  return name ? { name, variant } : null;
}

function csvVariantDetails(...values: string[]) {
  return uniqueNonEmptyStrings(values.map(titleCaseVariant)).join(", ");
}

function psaVaultVariantDetails(variety: string, parsedVariant: string, setName: string) {
  return csvVariantDetails(...psaVaultVarietyParts(variety, setName), parsedVariant);
}

function psaVaultVarietyParts(value: string, setName: string) {
  const normalizedSet = normalizeText(setName);
  const setTokens = normalizedSet
    .replace(/\([^)]*\)/g, " ")
    .split(" ")
    .filter((token) => token.length > 1);

  return value
    .split(/\s*-\s*/)
    .map((part) => normalizePsaVaultVarietyPart(part))
    .filter((part) => {
      const normalizedPart = normalizeText(part);

      return (
        normalizedPart &&
        normalizedPart !== normalizedSet &&
        !(setTokens.length > 0 && setTokens.every((token) => normalizedPart.includes(token)))
      );
    });
}

function normalizePsaVaultVarietyPart(value: string) {
  const normalized = normalizeText(value);
  const known: Record<string, string> = {
    "f.a.": "Full Art",
    "fa": "Full Art",
    "full art": "Full Art",
    "illustration rare": "Illustration Rare",
    "special illustration rare": "Special Illustration Rare",
    "special art rare": "Special Art Rare",
    "mega attack rare": "Mega Attack Rare",
    "art rare": "Art Rare",
    "toys r us": "Toys R Us",
    "mcdonald's": "McDonald's",
    "hif elite trainer box": "Elite Trainer Box"
  };

  return known[normalized] ?? titleCaseVariant(value);
}

function titleCaseSetName(value: string) {
  return titleCaseWords(value.replace(/\s+/g, " ").trim());
}

function titleCaseCardName(value: string) {
  return titleCaseWords(
    value
      .replace(/\s+-\s+\S+\/\S+\s*$/i, "")
      .replace(/\s*-\s*(ex|gx|v|vmax|vstar)\b/gi, " $1")
      .replace(/\s*-\s*/g, "-")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function titleCaseVariant(value: string) {
  return titleCaseWords(value.replace(/\s+/g, " ").trim());
}

function titleCaseWords(value: string) {
  return value
    .toLowerCase()
    .replace(/\b([a-z])/g, (letter) => letter.toUpperCase())
    .replace(/\b(Gx|Ex|Vmax|Vstar|V|Lv|Pc|Xy|Sv|Dp|Mcdonald'S)\b/g, (word) =>
      word === "Mcdonald'S" ? "McDonald's" : word.toUpperCase()
    )
    .replace(/'S\b/g, "'s")
    .replace(/-([a-z])/g, (_, letter: string) => `-${letter.toUpperCase()}`);
}

function filtersFromInventoryTag(filter: InventoryTagFilter): InventoryFilterState {
  if (filter.type === "itemType") {
    return {
      ...defaultInventoryFilters,
      itemType: filter.value
    };
  }

  if (filter.type === "language") {
    return {
      ...defaultInventoryFilters,
      language: filter.value
    };
  }

  if (filter.type === "variant") {
    return {
      ...defaultInventoryFilters,
      variants: [filter.value]
    };
  }

  if (filter.type === "storage") {
    return {
      ...defaultInventoryFilters,
      storageLocation: filter.value
    };
  }

  return {
    ...defaultInventoryFilters,
    query: filter.value
  };
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

    const hasValue =
      item.valueOverrideCents !== null ||
      item.marketPriceCents !== null ||
      item.purchasePriceCents !== null;

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

function getStorageGroups(items: InventoryItem[]): InventoryGroupSummary[] {
  return groupInventoryItems(
    items.filter((item) => Boolean(item.storageLocation?.trim())),
    (item) => item.storageLocation?.trim() ?? "",
    (value) => value
  );
}

function getVariantGroups(items: InventoryItem[]): InventoryGroupSummary[] {
  const groups = new Map<string, InventoryItem[]>();

  for (const item of items) {
    for (const variant of variantsFromText(item.variantDetails ?? "")) {
      const current = groups.get(variant) ?? [];
      current.push(item);
      groups.set(variant, current);
    }
  }

  return [...groups.entries()]
    .map(([variant, groupItems]) => inventoryGroupSummary(variant, variant, groupItems))
    .sort(compareInventoryGroups);
}

function groupInventoryItems(
  items: InventoryItem[],
  keyForItem: (item: InventoryItem) => string,
  labelForKey: (key: string) => string
) {
  const groups = new Map<string, InventoryItem[]>();

  for (const item of items) {
    const key = keyForItem(item);

    if (!key) {
      continue;
    }

    const current = groups.get(key) ?? [];
    current.push(item);
    groups.set(key, current);
  }

  return [...groups.entries()]
    .map(([key, groupItems]) => inventoryGroupSummary(key, labelForKey(key), groupItems))
    .sort(compareInventoryGroups);
}

function inventoryGroupSummary(
  key: string,
  label: string,
  items: InventoryItem[]
): InventoryGroupSummary {
  const examples = uniqueSorted(items.map((item) => item.card.name))
    .slice(0, 3)
    .join(", ");

  return {
    key,
    label,
    count: items.reduce((total, item) => total + item.quantity, 0),
    valueCents: items.reduce((total, item) => total + inventoryItemValue(item), 0),
    examples: examples || "No named cards"
  };
}

function compareInventoryGroups(left: InventoryGroupSummary, right: InventoryGroupSummary) {
  if (right.count !== left.count) {
    return right.count - left.count;
  }

  return left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
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
  return (item.valueOverrideCents ?? item.marketPriceCents ?? item.purchasePriceCents ?? 0) * item.quantity;
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

function variantEditModeLabel(mode: BulkVariantEditMode) {
  if (mode === "set") {
    return "Set";
  }

  if (mode === "remove") {
    return "Remove";
  }

  return "Add";
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(cents / 100);
}

function marketPriceSourceLabel(source: InventoryItem["marketPriceSource"]) {
  if (source === "justtcg") {
    return "Legacy JustTCG";
  }

  if (source === "pokemonpricetracker") {
    return "PokemonPriceTracker";
  }

  return "Unknown";
}

function buildEbaySoldSearchUrl(item: InventoryItem) {
  const gradeNumber = String(item.grade ?? "").match(/\d+(?:\.\d+)?/)?.[0] ?? "";
  const gradedTerm =
    item.itemType === "graded"
      ? [item.grader, gradeNumber || item.grade].filter(Boolean).join(" ")
      : "";
  const cardName = ebaySearchCardName(item.card.name, item.card.cardNumber);
  const cardNumber = String(item.card.cardNumber ?? "").trim();
  const query = uniqueSearchTerms([
    cardName,
    cardNumber && !normalizeSearchText(cardName).includes(normalizeSearchText(cardNumber))
      ? cardNumber
      : "",
    item.card.language === "ja" ? "Japanese" : "",
    ebaySearchVariant(item.variantDetails),
    gradedTerm,
    "Pokemon"
  ]).join(" ");
  const params = new URLSearchParams({
    _nkw: query,
    _sacat: "0",
    LH_Sold: "1",
    LH_Complete: "1"
  });

  return `https://www.ebay.com/sch/i.html?${params.toString()}`;
}

function buildPokemonPriceTrackerUrl(item: InventoryItem) {
  const params = new URLSearchParams({
    name: ebaySearchCardName(item.card.name, item.card.cardNumber)
  });

  return `https://www.pokemonpricetracker.com/pokemon-prices?${params.toString()}`;
}

function ebaySearchCardName(name: string, cardNumber: string | null | undefined) {
  const number = String(cardNumber ?? "").trim();

  if (!number) {
    return name.trim();
  }

  const escapedNumber = number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return name
    .replace(new RegExp(`\\s*[-–—]?\\s*${escapedNumber}\\s*$`, "i"), "")
    .trim();
}

function ebaySearchVariant(value: string | null | undefined) {
  const normalized = normalizeSearchText(value ?? "");

  if (normalized.includes("1st edition") || normalized.includes("first edition")) {
    return "1st Edition";
  }

  if (normalized.includes("shadowless")) {
    return "Shadowless";
  }

  if (normalized.includes("reverse")) {
    return "Reverse Holo";
  }

  return "";
}

function uniqueSearchTerms(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const terms: string[] = [];

  for (const value of values) {
    const term = String(value ?? "").trim();
    const key = normalizeSearchText(term);

    if (!term || seen.has(key)) {
      continue;
    }

    seen.add(key);
    terms.push(term);
  }

  return terms;
}

function retryLabel(nextAttemptAt: string | null) {
  if (!nextAttemptAt) {
    return null;
  }

  const retryDate = new Date(nextAttemptAt);

  if (Number.isNaN(retryDate.getTime())) {
    return null;
  }

  return `retry ${retryDate.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  })}`;
}

function formatFileSize(bytes: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    style: "unit",
    unit: "megabyte"
  }).format(bytes / 1024 / 1024);
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
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
