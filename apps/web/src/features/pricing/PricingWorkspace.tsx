import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock3,
  Play,
  RefreshCw,
  Trash2,
  XCircle
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from "react";
import type {
  BulkPriceQueueJob,
  BulkPriceQueueResponse,
  InventoryItem,
  InventoryListResponse,
  PricingReviewsResponse
} from "@collection-tool/shared";
import { api } from "../../api";
import { PricingReviewWorkspace } from "../../PricingReviewWorkspace";
import "./PricingWorkspace.css";

type PricingWorkspaceTab = "overview" | "review" | "queue";
type QueueAction = "resume" | "cancel" | "retry" | "clear";

export type PricingWorkspaceProps = {
  collectionId: string;
  canEdit: boolean;
  onOpenItem: (item: InventoryItem) => void;
  onItemUpdated: (item: InventoryItem) => void;
};

const pricingTabs: Array<{ id: PricingWorkspaceTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "review", label: "Needs review" },
  { id: "queue", label: "Refresh queue" }
];

export function PricingWorkspace({
  collectionId,
  canEdit,
  onOpenItem,
  onItemUpdated
}: PricingWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<PricingWorkspaceTab>("overview");
  const [inventory, setInventory] = useState<InventoryListResponse | null>(null);
  const [reviews, setReviews] = useState<PricingReviewsResponse | null>(null);
  const [queue, setQueue] = useState<BulkPriceQueueResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [queueLoading, setQueueLoading] = useState(true);
  const [inventoryError, setInventoryError] = useState("");
  const [reviewsError, setReviewsError] = useState("");
  const [queueError, setQueueError] = useState("");
  const [queueMessage, setQueueMessage] = useState("");
  const [queueAction, setQueueAction] = useState<QueueAction | null>(null);

  const collectionEpochRef = useRef(0);
  const summaryRequestRef = useRef(0);
  const queueRequestRef = useRef(0);
  const queueActionInFlightRef = useRef(false);
  const notifiedItemSignaturesRef = useRef(new Map<string, string>());
  const onItemUpdatedRef = useRef(onItemUpdated);
  const onOpenItemRef = useRef(onOpenItem);
  onItemUpdatedRef.current = onItemUpdated;
  onOpenItemRef.current = onOpenItem;

  const publishQueueItems = useCallback((response: BulkPriceQueueResponse) => {
    const items = new Map<string, InventoryItem>();

    for (const job of response.jobs) {
      if (job.item) {
        items.set(job.item.id, job.item);
      }
    }

    for (const item of items.values()) {
      const signature = pricingItemSignature(item);

      if (notifiedItemSignaturesRef.current.get(item.id) === signature) {
        continue;
      }

      notifiedItemSignaturesRef.current.set(item.id, signature);
      onItemUpdatedRef.current(item);
    }
  }, []);

  const loadSummary = useCallback(
    async (options: { showLoading?: boolean; epoch?: number } = {}) => {
      const epoch = options.epoch ?? collectionEpochRef.current;
      const requestId = ++summaryRequestRef.current;

      if (options.showLoading !== false) {
        setSummaryLoading(true);
      }

      const [inventoryResult, reviewsResult] = await Promise.allSettled([
        api.listInventory(collectionId),
        api.getPricingReviews(collectionId)
      ]);

      if (
        epoch !== collectionEpochRef.current ||
        requestId !== summaryRequestRef.current
      ) {
        return;
      }

      if (inventoryResult.status === "fulfilled") {
        setInventory(inventoryResult.value);
        setInventoryError("");
      } else {
        setInventoryError(errorMessage(inventoryResult.reason, "Unable to load pricing coverage."));
      }

      if (reviewsResult.status === "fulfilled") {
        setReviews(reviewsResult.value);
        setReviewsError("");
      } else {
        setReviewsError(errorMessage(reviewsResult.reason, "Unable to load pricing review totals."));
      }

      setSummaryLoading(false);
    },
    [collectionId]
  );

  const loadQueue = useCallback(
    async (options: { showLoading?: boolean; epoch?: number } = {}) => {
      const epoch = options.epoch ?? collectionEpochRef.current;
      const requestId = ++queueRequestRef.current;

      if (options.showLoading !== false) {
        setQueueLoading(true);
      }

      try {
        const response = await api.getBulkPriceQueue(collectionId);

        if (
          epoch !== collectionEpochRef.current ||
          requestId !== queueRequestRef.current
        ) {
          return;
        }

        setQueue(response);
        setQueueError("");
        publishQueueItems(response);
      } catch (error) {
        if (
          epoch !== collectionEpochRef.current ||
          requestId !== queueRequestRef.current
        ) {
          return;
        }

        setQueueError(errorMessage(error, "Unable to load the pricing refresh queue."));
      } finally {
        if (
          epoch === collectionEpochRef.current &&
          requestId === queueRequestRef.current
        ) {
          setQueueLoading(false);
        }
      }
    },
    [collectionId, publishQueueItems]
  );

  useEffect(() => {
    const epoch = collectionEpochRef.current + 1;
    collectionEpochRef.current = epoch;
    summaryRequestRef.current += 1;
    queueRequestRef.current += 1;
    queueActionInFlightRef.current = false;
    notifiedItemSignaturesRef.current.clear();

    setActiveTab("overview");
    setInventory(null);
    setReviews(null);
    setQueue(null);
    setSummaryLoading(true);
    setQueueLoading(true);
    setInventoryError("");
    setReviewsError("");
    setQueueError("");
    setQueueMessage("");
    setQueueAction(null);

    void loadSummary({ epoch });
    void loadQueue({ epoch });

    return () => {
      if (collectionEpochRef.current === epoch) {
        collectionEpochRef.current += 1;
      }
      summaryRequestRef.current += 1;
      queueRequestRef.current += 1;
      queueActionInFlightRef.current = false;
    };
  }, [collectionId, loadQueue, loadSummary]);

  const activeQueueCount = queue ? queueActiveCount(queue) : 0;

  useEffect(() => {
    if (activeQueueCount === 0) {
      return;
    }

    const interval = window.setInterval(() => {
      if (!queueActionInFlightRef.current) {
        void loadQueue({ showLoading: false });
      }
    }, 30_000);

    return () => window.clearInterval(interval);
  }, [activeQueueCount, loadQueue]);

  async function refreshOverview() {
    if (queueActionInFlightRef.current) {
      return;
    }

    setQueueMessage("");
    await Promise.all([loadSummary(), loadQueue()]);
  }

  async function runQueueAction(action: QueueAction) {
    if (!canEdit || queueActionInFlightRef.current) {
      return;
    }

    const epoch = collectionEpochRef.current;
    queueActionInFlightRef.current = true;
    queueRequestRef.current += 1;
    setQueueAction(action);
    setQueueError("");
    setQueueMessage("");

    try {
      const response = await queueActionRequest(action, collectionId);

      if (epoch !== collectionEpochRef.current) {
        return;
      }

      setQueue(response);
      setQueueMessage(response.message);
      publishQueueItems(response);

      // The queue operation can save prices or change review state. Reload every
      // source behind the overview, then take one fresh queue snapshot. Logical
      // request ids prevent an older poll or refresh from overwriting these results.
      await loadSummary({ showLoading: false, epoch });
      await loadQueue({ showLoading: false, epoch });
    } catch (error) {
      if (epoch === collectionEpochRef.current) {
        setQueueError(errorMessage(error, queueActionError(action)));
      }
    } finally {
      if (epoch === collectionEpochRef.current) {
        queueActionInFlightRef.current = false;
        setQueueAction(null);
      }
    }
  }

  function handleReviewItemUpdated(item: InventoryItem) {
    onItemUpdatedRef.current(item);
    void loadSummary({ showLoading: false });

    if (!queueActionInFlightRef.current) {
      void loadQueue({ showLoading: false });
    }
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }

    event.preventDefault();
    const currentIndex = pricingTabs.findIndex((tab) => tab.id === activeTab);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? pricingTabs.length - 1
          : event.key === "ArrowRight"
            ? (currentIndex + 1) % pricingTabs.length
            : (currentIndex - 1 + pricingTabs.length) % pricingTabs.length;
    const nextTab = pricingTabs[nextIndex];

    setActiveTab(nextTab.id);
    window.requestAnimationFrame(() => {
      document.getElementById(`pricing-tab-${nextTab.id}`)?.focus();
    });
  }

  const overview = useMemo(() => buildOverview(inventory, reviews, queue), [inventory, queue, reviews]);

  return (
    <section
      aria-busy={summaryLoading || queueLoading || queueAction !== null}
      className="pricing-workspace"
      aria-label="Pricing workspace"
    >
      <header className="pricing-workspace-header">
        <div>
          <p className="eyebrow">Collection pricing</p>
          <h3>Pricing operations</h3>
          <p>Monitor coverage, resolve uncertain matches, and manage refresh work in one place.</p>
        </div>
        {activeTab === "overview" ? (
          <button
            disabled={summaryLoading || queueLoading || queueAction !== null}
            onClick={() => void refreshOverview()}
            type="button"
          >
            <RefreshCw size={17} aria-hidden="true" />
            {summaryLoading || queueLoading ? "Refreshing…" : "Refresh overview"}
          </button>
        ) : null}
        {activeTab === "queue" ? (
          <button
            disabled={queueLoading || queueAction !== null}
            onClick={() => void loadQueue()}
            type="button"
          >
            <RefreshCw size={17} aria-hidden="true" />
            {queueLoading ? "Refreshing…" : "Refresh queue"}
          </button>
        ) : null}
      </header>

      <div className="pricing-workspace-tabs" role="tablist" aria-label="Pricing views">
        {pricingTabs.map((tab) => (
          <button
            aria-controls={`pricing-panel-${tab.id}`}
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? "active" : ""}
            id={`pricing-tab-${tab.id}`}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={handleTabKeyDown}
            role="tab"
            tabIndex={activeTab === tab.id ? 0 : -1}
            type="button"
          >
            {tab.label}
            {tab.id === "review" && reviews ? <span>{reviews.summary.needsReview}</span> : null}
            {tab.id === "queue" && queue && activeQueueCount > 0 ? <span>{activeQueueCount}</span> : null}
          </button>
        ))}
      </div>

      {activeTab === "overview" ? (
        <div
          aria-labelledby="pricing-tab-overview"
          className="pricing-workspace-panel"
          id="pricing-panel-overview"
          role="tabpanel"
        >
          <PricingOverview
            inventoryError={inventoryError}
            loading={summaryLoading || queueLoading}
            overview={overview}
            queueError={queueError}
            reviewsError={reviewsError}
            onSelectTab={setActiveTab}
          />
        </div>
      ) : null}

      {activeTab === "review" ? (
        <div
          aria-labelledby="pricing-tab-review"
          className="pricing-workspace-panel"
          id="pricing-panel-review"
          role="tabpanel"
        >
          <PricingReviewWorkspace
            canEdit={canEdit}
            collectionId={collectionId}
            onItemUpdated={handleReviewItemUpdated}
            onOpenItem={(item) => onOpenItemRef.current(item)}
          />
        </div>
      ) : null}

      {activeTab === "queue" ? (
        <div
          aria-labelledby="pricing-tab-queue"
          className="pricing-workspace-panel"
          id="pricing-panel-queue"
          role="tabpanel"
        >
          <PricingQueue
            canEdit={canEdit}
            error={queueError}
            loading={queueLoading}
            message={queueMessage}
            queue={queue}
            workingAction={queueAction}
            onAction={(action) => void runQueueAction(action)}
            onOpenItem={(item) => onOpenItemRef.current(item)}
          />
        </div>
      ) : null}
    </section>
  );
}

type PricingOverviewData = {
  totalEntries: number | null;
  totalCards: number | null;
  pricedEntries: number | null;
  unpricedEntries: number | null;
  possibleMatches: number | null;
  needsReview: number | null;
  pinned: number | null;
  activeQueue: number | null;
  failedQueue: number | null;
  rateLimitedQueue: number | null;
};

function PricingOverview({
  inventoryError,
  loading,
  overview,
  queueError,
  reviewsError,
  onSelectTab
}: {
  inventoryError: string;
  loading: boolean;
  overview: PricingOverviewData;
  queueError: string;
  reviewsError: string;
  onSelectTab: (tab: PricingWorkspaceTab) => void;
}) {
  return (
    <section className="pricing-overview" aria-label="Pricing overview">
      {loading && overview.totalEntries === null ? (
        <p className="pricing-workspace-loading">Loading pricing overview…</p>
      ) : null}

      {inventoryError ? <ErrorNotice label="Coverage unavailable" message={inventoryError} /> : null}
      {reviewsError ? <ErrorNotice label="Review totals unavailable" message={reviewsError} /> : null}
      {queueError ? <ErrorNotice label="Queue status unavailable" message={queueError} /> : null}

      <div className="pricing-overview-grid">
        <article className="pricing-overview-card coverage">
          <div className="pricing-overview-card-heading">
            <BarChart3 size={20} aria-hidden="true" />
            <div>
              <p className="eyebrow">Coverage</p>
              <h3>{formatCount(overview.pricedEntries)} priced entries</h3>
            </div>
          </div>
          <dl>
            <div><dt>Inventory entries</dt><dd>{formatCount(overview.totalEntries)}</dd></div>
            <div><dt>Physical cards</dt><dd>{formatCount(overview.totalCards)}</dd></div>
            <div><dt>Missing market price</dt><dd>{formatCount(overview.unpricedEntries)}</dd></div>
            <div><dt>Possible confidence</dt><dd>{formatCount(overview.possibleMatches)}</dd></div>
          </dl>
          <p>Coverage counts stored market prices on inventory entries; manual value overrides are not counted as market prices.</p>
        </article>

        <button className="pricing-overview-card review" onClick={() => onSelectTab("review")} type="button">
          <div className="pricing-overview-card-heading">
            <AlertTriangle size={20} aria-hidden="true" />
            <div>
              <p className="eyebrow">Match quality</p>
              <h3>{formatCount(overview.needsReview)} need review</h3>
            </div>
          </div>
          <dl>
            <div><dt>Needs review</dt><dd>{formatCount(overview.needsReview)}</dd></div>
            <div><dt>Confirmed pins</dt><dd>{formatCount(overview.pinned)}</dd></div>
          </dl>
          <span className="pricing-overview-link">Open match review</span>
        </button>

        <button className="pricing-overview-card queue" onClick={() => onSelectTab("queue")} type="button">
          <div className="pricing-overview-card-heading">
            <Clock3 size={20} aria-hidden="true" />
            <div>
              <p className="eyebrow">Refresh work</p>
              <h3>{formatCount(overview.activeQueue)} active jobs</h3>
            </div>
          </div>
          <dl>
            <div><dt>Active</dt><dd>{formatCount(overview.activeQueue)}</dd></div>
            <div><dt>Rate limited</dt><dd>{formatCount(overview.rateLimitedQueue)}</dd></div>
            <div><dt>Failed</dt><dd>{formatCount(overview.failedQueue)}</dd></div>
          </dl>
          <span className="pricing-overview-link">Open refresh queue</span>
        </button>
      </div>
    </section>
  );
}

function PricingQueue({
  canEdit,
  error,
  loading,
  message,
  queue,
  workingAction,
  onAction,
  onOpenItem
}: {
  canEdit: boolean;
  error: string;
  loading: boolean;
  message: string;
  queue: BulkPriceQueueResponse | null;
  workingAction: QueueAction | null;
  onAction: (action: QueueAction) => void;
  onOpenItem: (item: InventoryItem) => void;
}) {
  if (loading && !queue) {
    return <p className="pricing-workspace-loading">Loading refresh queue…</p>;
  }

  if (!queue) {
    return error ? <ErrorNotice message={error} /> : null;
  }

  const activeCount = queueActiveCount(queue);
  const completedCount =
    queue.summary.saved +
    queue.summary.needsReview +
    queue.summary.skipped +
    queue.summary.failed +
    queue.summary.cancelled;
  const primaryState =
    queue.summary.running > 0
      ? "Running"
      : queue.summary.rateLimited > 0
        ? "Paused by provider"
        : queue.summary.queued > 0
          ? "Queued"
          : queue.summary.failed + queue.summary.needsReview > 0
            ? "Needs attention"
            : "Idle";
  const visibleJobs = queue.jobs.filter(isVisibleQueueJob).slice(0, 25);
  const nextRetry = earliestRetry(queue.jobs);

  return (
    <section className="pricing-queue" aria-label="Bulk price refresh queue">
      <div className="pricing-queue-heading">
        <div>
          <p className="eyebrow">Refresh queue</p>
          <h3>{primaryState}</h3>
          <p>{queue.summary.total} recent jobs are currently stored.</p>
        </div>
        <div className="pricing-queue-actions">
          <button
            disabled={!canEdit || workingAction !== null || queue.summary.queued + queue.summary.rateLimited === 0}
            onClick={() => onAction("resume")}
            type="button"
          >
            <Play size={16} aria-hidden="true" />
            {workingAction === "resume" ? "Resuming…" : "Resume now"}
          </button>
          <button
            disabled={!canEdit || workingAction !== null || activeCount === 0}
            onClick={() => onAction("cancel")}
            type="button"
          >
            <XCircle size={16} aria-hidden="true" />
            {workingAction === "cancel" ? "Cancelling…" : "Cancel active"}
          </button>
          <button
            disabled={!canEdit || workingAction !== null || queue.summary.failed === 0}
            onClick={() => onAction("retry")}
            type="button"
          >
            <RefreshCw size={16} aria-hidden="true" />
            {workingAction === "retry" ? "Retrying…" : "Retry failed"}
          </button>
          <button
            disabled={!canEdit || workingAction !== null || completedCount === 0}
            onClick={() => onAction("clear")}
            type="button"
          >
            <Trash2 size={16} aria-hidden="true" />
            {workingAction === "clear" ? "Clearing…" : "Clear completed"}
          </button>
        </div>
      </div>

      {!canEdit ? (
        <p className="pricing-workspace-note">Viewer access is read-only. An editor can operate the refresh queue.</p>
      ) : null}
      {error ? <ErrorNotice message={error} /> : null}
      {message ? <p className="pricing-workspace-message" aria-live="polite">{message}</p> : null}

      <div className="pricing-queue-stats" aria-label="Refresh queue summary">
        <QueueStat icon={<Clock3 size={18} aria-hidden="true" />} label="Queued / running" value={queue.summary.queued + queue.summary.running} tone="active" />
        <QueueStat icon={<CheckCircle2 size={18} aria-hidden="true" />} label="Saved" value={queue.summary.saved} tone="saved" />
        <QueueStat icon={<AlertTriangle size={18} aria-hidden="true" />} label="Needs review" value={queue.summary.needsReview} tone="review" />
        <QueueStat icon={<XCircle size={18} aria-hidden="true" />} label="Failed" value={queue.summary.failed} tone="failed" />
      </div>

      {queue.summary.rateLimited > 0 ? (
        <div className="pricing-rate-limit" role="status">
          <Clock3 size={18} aria-hidden="true" />
          <p>
            <strong>{queue.summary.rateLimited} {pluralize(queue.summary.rateLimited, "job is", "jobs are")} paused by a provider limit.</strong>{" "}
            The backend retries eligible jobs automatically{nextRetry ? `; the next retry is ${nextRetry}` : ""}.
          </p>
        </div>
      ) : null}
      {queue.summary.failed > 0 ? (
        <p className="pricing-workspace-note">Failed jobs wait for an explicit retry. Retry them after correcting provider access or allowing the request limit to reset.</p>
      ) : null}

      <div className="pricing-queue-list-heading">
        <strong>Open jobs</strong>
        <span>Showing {visibleJobs.length} of {queue.jobs.filter(isVisibleQueueJob).length}</span>
      </div>
      <div className="pricing-queue-list">
        {visibleJobs.length === 0 ? (
          <div className="pricing-queue-empty">
            <CheckCircle2 size={22} aria-hidden="true" />
            <div><strong>No queue work needs attention.</strong><span>New bulk price refreshes will appear here.</span></div>
          </div>
        ) : null}
        {visibleJobs.map((job) => (
          <QueueJobRow job={job} key={job.id} onOpenItem={onOpenItem} />
        ))}
      </div>
    </section>
  );
}

function QueueStat({
  icon,
  label,
  tone,
  value
}: {
  icon: ReactNode;
  label: string;
  tone: "active" | "saved" | "review" | "failed";
  value: number;
}) {
  return <div className={`pricing-queue-stat ${tone}`}>{icon}<span>{label}</span><strong>{value}</strong></div>;
}

function QueueJobRow({
  job,
  onOpenItem
}: {
  job: BulkPriceQueueJob;
  onOpenItem: (item: InventoryItem) => void;
}) {
  return (
    <article className={`pricing-queue-row ${job.status}`}>
      <div>
        <div className="pricing-queue-row-title">
          <strong>{job.item?.card.name ?? "Inventory item unavailable"}</strong>
          <span className={`pricing-status-pill ${job.status}`}>{queueStatusLabel(job.status)}</span>
        </div>
        <p>{[job.item?.card.setName, job.item?.card.cardNumber, job.mode].filter(Boolean).join(" · ") || "No item details"}</p>
        {job.message ? <span>{job.message}</span> : null}
        {job.nextAttemptAt ? <time dateTime={job.nextAttemptAt}>{retryLabel(job.nextAttemptAt)}</time> : null}
      </div>
      {job.item ? <button onClick={() => onOpenItem(job.item!)} type="button">Open card</button> : null}
    </article>
  );
}

function ErrorNotice({ label = "Unable to refresh", message }: { label?: string; message: string }) {
  return (
    <div className="pricing-workspace-error" role="alert">
      <AlertTriangle size={18} aria-hidden="true" />
      <p><strong>{label}</strong><span>{message}</span></p>
    </div>
  );
}

function buildOverview(
  inventory: InventoryListResponse | null,
  reviews: PricingReviewsResponse | null,
  queue: BulkPriceQueueResponse | null
): PricingOverviewData {
  const pricedEntries = inventory?.items.filter((item) => item.marketPriceCents !== null).length ?? null;

  return {
    totalEntries: inventory?.items.length ?? null,
    totalCards: inventory?.summary.cardCount ?? null,
    pricedEntries,
    unpricedEntries: inventory && pricedEntries !== null ? inventory.items.length - pricedEntries : null,
    possibleMatches: inventory?.items.filter((item) => item.marketPriceConfidence === "possible").length ?? null,
    needsReview: reviews?.summary.needsReview ?? null,
    pinned: reviews?.summary.pinned ?? null,
    activeQueue: queue ? queueActiveCount(queue) : null,
    failedQueue: queue?.summary.failed ?? null,
    rateLimitedQueue: queue?.summary.rateLimited ?? null
  };
}

function pricingItemSignature(item: InventoryItem) {
  return [
    item.marketPriceCents,
    item.marketPriceSource,
    item.marketPriceUpdatedAt,
    item.marketPriceConfidence,
    item.marketPriceMatchedName,
    item.marketPriceMatchedSetName,
    item.marketPriceMatchedCardNumber,
    item.marketPriceSnapshotCount
  ].join("|");
}

function queueActiveCount(queue: BulkPriceQueueResponse) {
  return queue.summary.queued + queue.summary.running + queue.summary.rateLimited;
}

function isVisibleQueueJob(job: BulkPriceQueueJob) {
  return !["saved", "skipped", "cancelled"].includes(job.status);
}

async function queueActionRequest(action: QueueAction, collectionId: string) {
  if (action === "resume") {
    return api.resumeBulkPriceQueue(collectionId);
  }
  if (action === "cancel") {
    return api.cancelBulkPriceQueue(collectionId);
  }
  if (action === "retry") {
    return api.retryFailedBulkPriceQueue(collectionId);
  }
  return api.clearCompletedBulkPriceQueue(collectionId);
}

function queueActionError(action: QueueAction) {
  if (action === "resume") return "Unable to resume the refresh queue.";
  if (action === "cancel") return "Unable to cancel active refreshes.";
  if (action === "retry") return "Unable to retry failed refreshes.";
  return "Unable to clear completed refreshes.";
}

function queueStatusLabel(status: BulkPriceQueueJob["status"]) {
  if (status === "needs-review") return "Needs review";
  if (status === "rate-limited") return "Paused";
  return status[0].toUpperCase() + status.slice(1);
}

function earliestRetry(jobs: BulkPriceQueueJob[]) {
  const timestamps = jobs
    .map((job) => job.nextAttemptAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((left, right) => left.getTime() - right.getTime());
  const date = timestamps[0];
  return date ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
}

function retryLabel(value: string) {
  const retry = new Date(value);
  return Number.isNaN(retry.getTime())
    ? "Retry time unavailable"
    : `Retry ${retry.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function formatCount(value: number | null) {
  return value === null ? "—" : new Intl.NumberFormat("en-US").format(value);
}

function pluralize(value: number, singular: string, plural: string) {
  return value === 1 ? singular : plural;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
