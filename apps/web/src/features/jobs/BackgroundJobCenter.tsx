import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileSpreadsheet,
  ListTodo,
  PauseCircle,
  Play,
  RefreshCw,
  Trash2,
  X,
  XCircle
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import type {
  BulkPriceQueueResponse,
  CollectionSummary,
  CsvImportJobResponse,
  InventoryItem
} from "@collection-tool/shared";
import { api } from "../../api";
import "./BackgroundJobCenter.css";

type CollectionJobSnapshot = {
  collection: CollectionSummary;
  csvJobs: CsvImportJobResponse[];
  priceQueue: BulkPriceQueueResponse | null;
};

type PriceQueueAction = "resume" | "cancel" | "retry" | "clear";

export type BackgroundJobCenterProps = {
  activeCollectionId: string;
  collections: CollectionSummary[];
  onItemUpdated: (collectionId: string, item: InventoryItem) => void;
  onOpenCsvImport: (collectionId: string, jobId: string) => void;
  onOpenPricing: (collectionId: string) => void;
};

export function BackgroundJobCenter({
  activeCollectionId,
  collections,
  onItemUpdated,
  onOpenCsvImport,
  onOpenPricing
}: BackgroundJobCenterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<CollectionJobSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [workingJobId, setWorkingJobId] = useState("");
  const requestIdRef = useRef(0);
  const itemSignaturesRef = useRef(new Map<string, string>());
  const onItemUpdatedRef = useRef(onItemUpdated);
  onItemUpdatedRef.current = onItemUpdated;

  const publishQueueItems = useCallback((collectionId: string, queue: BulkPriceQueueResponse) => {
    for (const job of queue.jobs) {
      if (!job.item) continue;
      const key = `${collectionId}:${job.item.id}`;
      const signature = inventoryPriceSignature(job.item);
      if (itemSignaturesRef.current.get(key) === signature) continue;
      itemSignaturesRef.current.set(key, signature);
      onItemUpdatedRef.current(collectionId, job.item);
    }
  }, []);

  const loadJobs = useCallback(
    async ({ showLoading = false }: { showLoading?: boolean } = {}) => {
      const requestId = ++requestIdRef.current;
      if (showLoading) setLoading(true);

      const nextSnapshots = await Promise.all(
        collections.map(async (collection): Promise<CollectionJobSnapshot> => {
          const [queueResult, csvResult] = await Promise.allSettled([
            api.getBulkPriceQueue(collection.id),
            collection.role === "viewer"
              ? Promise.resolve({ jobs: [] as CsvImportJobResponse[] })
              : api.listCsvImportJobs(collection.id)
          ]);
          const priceQueue = queueResult.status === "fulfilled" ? queueResult.value : null;

          if (priceQueue) publishQueueItems(collection.id, priceQueue);

          return {
            collection,
            priceQueue,
            csvJobs: csvResult.status === "fulfilled" ? csvResult.value.jobs : []
          };
        })
      );

      if (requestId !== requestIdRef.current) return;
      setSnapshots(nextSnapshots);
      setLoading(false);
    },
    [collections, publishQueueItems]
  );

  useEffect(() => {
    itemSignaturesRef.current.clear();
    void loadJobs({ showLoading: true });
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadJobs]);

  const hasActiveWork = snapshots.some(snapshotHasActiveWork);

  useEffect(() => {
    const interval = window.setInterval(
      () => void loadJobs(),
      hasActiveWork ? 2_000 : 30_000
    );
    const refreshOnFocus = () => void loadJobs();
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [hasActiveWork, loadJobs]);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  const visibleJobs = useMemo(() => buildVisibleJobs(snapshots), [snapshots]);
  const attentionCount = visibleJobs.filter((job) => job.needsAttention).length;

  async function runPriceQueueAction(
    collection: CollectionSummary,
    action: PriceQueueAction
  ) {
    if (collection.role === "viewer" || workingJobId) return;
    const jobId = `pricing:${collection.id}`;
    setWorkingJobId(jobId);
    setMessage("");

    try {
      const response = await priceQueueActionRequest(action, collection.id);
      publishQueueItems(collection.id, response);
      setMessage(response.message);
      await loadJobs();
    } catch (error) {
      setMessage(errorMessage(error, "Unable to update the pricing queue."));
    } finally {
      setWorkingJobId("");
    }
  }

  async function cancelCsvImport(job: CsvImportJobResponse) {
    if (workingJobId) return;
    const jobId = `csv:${job.id}`;
    setWorkingJobId(jobId);
    setMessage("");

    try {
      await api.cancelCsvImportJob(job.collectionId, job.id);
      setMessage("Cancelled the CSV import.");
      await loadJobs();
    } catch (error) {
      setMessage(errorMessage(error, "Unable to cancel the CSV import."));
    } finally {
      setWorkingJobId("");
    }
  }

  return (
    <>
      <button
        aria-controls="background-job-drawer"
        aria-expanded={isOpen}
        className={`background-job-toggle ${attentionCount > 0 ? "attention" : ""}`}
        onClick={() => {
          setIsOpen((open) => !open);
          if (!isOpen) void loadJobs();
        }}
        type="button"
      >
        <ListTodo size={18} aria-hidden="true" />
        Jobs
        {attentionCount > 0 ? <span>{attentionCount}</span> : null}
      </button>

      {isOpen ? (
        <aside
          aria-label="Background jobs"
          className="background-job-drawer"
          id="background-job-drawer"
        >
          <header>
            <div>
              <p className="eyebrow">Background work</p>
              <h2>Jobs</h2>
              <span>Import and pricing work stays here while you move around the app.</span>
            </div>
            <div className="background-job-header-actions">
              <button
                aria-label="Refresh background jobs"
                disabled={loading}
                onClick={() => void loadJobs({ showLoading: true })}
                type="button"
              >
                <RefreshCw size={17} aria-hidden="true" />
              </button>
              <button aria-label="Close background jobs" onClick={() => setIsOpen(false)} type="button">
                <X size={18} aria-hidden="true" />
              </button>
            </div>
          </header>

          {message ? <p className="background-job-message" aria-live="polite">{message}</p> : null}

          <div className="background-job-list">
            {loading && visibleJobs.length === 0 ? <p>Loading background jobs…</p> : null}
            {!loading && visibleJobs.length === 0 ? (
              <div className="background-job-empty">
                <CheckCircle2 size={22} aria-hidden="true" />
                <strong>No background work yet.</strong>
                <span>CSV imports and pricing refreshes will appear here.</span>
              </div>
            ) : null}
            {visibleJobs.map((job) => {
              if (job.kind === "csv") {
                return (
                  <CsvJobCard
                    isWorking={workingJobId === job.id}
                    job={job.job}
                    key={job.id}
                    collectionName={job.collection.name}
                    onCancel={() => void cancelCsvImport(job.job)}
                    onOpen={() => {
                      setIsOpen(false);
                      onOpenCsvImport(job.collection.id, job.job.id);
                    }}
                  />
                );
              }

              return (
                <PricingJobCard
                  activeCollection={job.collection.id === activeCollectionId}
                  collection={job.collection}
                  isWorking={workingJobId === job.id}
                  key={job.id}
                  queue={job.queue}
                  onAction={(action) => void runPriceQueueAction(job.collection, action)}
                  onOpen={() => {
                    setIsOpen(false);
                    onOpenPricing(job.collection.id);
                  }}
                />
              );
            })}
          </div>
        </aside>
      ) : null}
    </>
  );
}

type VisibleJob =
  | {
      id: string;
      kind: "csv";
      collection: CollectionSummary;
      job: CsvImportJobResponse;
      updatedAt: string;
      needsAttention: boolean;
    }
  | {
      id: string;
      kind: "pricing";
      collection: CollectionSummary;
      queue: BulkPriceQueueResponse;
      updatedAt: string;
      needsAttention: boolean;
    };

function buildVisibleJobs(snapshots: CollectionJobSnapshot[]) {
  const jobs: VisibleJob[] = [];

  for (const snapshot of snapshots) {
    for (const job of snapshot.csvJobs) {
      jobs.push({
        id: `csv:${job.id}`,
        kind: "csv",
        collection: snapshot.collection,
        job,
        updatedAt: job.updatedAt,
        needsAttention: ["ready", "failed"].includes(job.status)
      });
    }

    if (snapshot.priceQueue && snapshot.priceQueue.summary.total > 0) {
      jobs.push({
        id: `pricing:${snapshot.collection.id}`,
        kind: "pricing",
        collection: snapshot.collection,
        queue: snapshot.priceQueue,
        updatedAt: latestQueueUpdate(snapshot.priceQueue),
        needsAttention:
          snapshot.priceQueue.summary.failed +
            snapshot.priceQueue.summary.needsReview +
            snapshot.priceQueue.summary.rateLimited >
          0
      });
    }
  }

  return jobs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function CsvJobCard({
  collectionName,
  isWorking,
  job,
  onCancel,
  onOpen
}: {
  collectionName: string;
  isWorking: boolean;
  job: CsvImportJobResponse;
  onCancel: () => void;
  onOpen: () => void;
}) {
  const isActive = ["queued", "validating", "committing"].includes(job.status);
  const canCancel = ["queued", "validating", "ready"].includes(job.status);
  const progressMaximum = Math.max(job.progress.totalRows, 1);
  const progressValue =
    job.status === "completed"
      ? progressMaximum
      : Math.min(job.progress.processedRows, progressMaximum);

  return (
    <article className={`background-job-card ${job.status}`}>
      <div className="background-job-card-heading">
        <FileSpreadsheet size={19} aria-hidden="true" />
        <div>
          <strong>CSV import</strong>
          <span>{collectionName}</span>
        </div>
        <JobStatus status={csvStatus(job.status)} />
      </div>
      <progress max={progressMaximum} value={progressValue} />
      <p>{csvJobDetail(job)}</p>
      {job.error ? <p className="background-job-error">{job.error}</p> : null}
      <div className="background-job-card-actions">
        <button onClick={onOpen} type="button">
          {job.status === "ready" ? "Review import" : "Open import"}
        </button>
        {canCancel ? (
          <button disabled={isWorking} onClick={onCancel} type="button">
            <XCircle size={15} aria-hidden="true" />
            {isWorking ? "Cancelling…" : "Cancel"}
          </button>
        ) : null}
      </div>
      <time dateTime={job.updatedAt}>{relativeJobTime(job.updatedAt)}</time>
      {isActive ? <span className="sr-only">This job is active.</span> : null}
    </article>
  );
}

function PricingJobCard({
  activeCollection,
  collection,
  isWorking,
  queue,
  onAction,
  onOpen
}: {
  activeCollection: boolean;
  collection: CollectionSummary;
  isWorking: boolean;
  queue: BulkPriceQueueResponse;
  onAction: (action: PriceQueueAction) => void;
  onOpen: () => void;
}) {
  const active = queue.summary.queued + queue.summary.running + queue.summary.rateLimited;
  const completed =
    queue.summary.saved +
    queue.summary.needsReview +
    queue.summary.skipped +
    queue.summary.failed +
    queue.summary.cancelled;
  const status = priceQueueStatus(queue);
  const canEdit = collection.role !== "viewer";

  return (
    <article className={`background-job-card ${status.id}`}>
      <div className="background-job-card-heading">
        {status.icon}
        <div>
          <strong>Price refresh</strong>
          <span>{collection.name}{activeCollection ? " · current" : ""}</span>
        </div>
        <JobStatus status={status} />
      </div>
      <progress max={Math.max(queue.summary.total, 1)} value={Math.min(completed, queue.summary.total)} />
      <p>{pricingJobDetail(queue)}</p>
      <div className="background-job-card-actions">
        <button onClick={onOpen} type="button">Open pricing</button>
        {canEdit && queue.summary.queued + queue.summary.rateLimited > 0 ? (
          <button disabled={isWorking} onClick={() => onAction("resume")} type="button">
            <Play size={15} aria-hidden="true" /> Resume
          </button>
        ) : null}
        {canEdit && active > 0 ? (
          <button disabled={isWorking} onClick={() => onAction("cancel")} type="button">Cancel</button>
        ) : null}
        {canEdit && queue.summary.failed > 0 ? (
          <button disabled={isWorking} onClick={() => onAction("retry")} type="button">Retry</button>
        ) : null}
        {canEdit && completed > 0 ? (
          <button disabled={isWorking} onClick={() => onAction("clear")} type="button">
            <Trash2 size={15} aria-hidden="true" /> Clear finished
          </button>
        ) : null}
      </div>
      {!canEdit ? <span className="background-job-readonly">Viewer access · read-only</span> : null}
      <time dateTime={latestQueueUpdate(queue)}>{relativeJobTime(latestQueueUpdate(queue))}</time>
    </article>
  );
}

type JobStatusPresentation = {
  id: string;
  label: string;
  icon?: ReactNode;
};

function JobStatus({ status }: { status: JobStatusPresentation }) {
  return <span className={`background-job-status ${status.id}`}>{status.label}</span>;
}

function csvStatus(status: CsvImportJobResponse["status"]): JobStatusPresentation {
  if (status === "ready") return { id: "ready", label: "Ready" };
  if (status === "validating") return { id: "running", label: "Validating" };
  if (status === "committing") return { id: "running", label: "Saving" };
  if (status === "failed") return { id: "failed", label: "Failed" };
  if (status === "completed") return { id: "completed", label: "Complete" };
  if (status === "cancelled") return { id: "cancelled", label: "Cancelled" };
  return { id: "queued", label: "Queued" };
}

function priceQueueStatus(queue: BulkPriceQueueResponse): JobStatusPresentation {
  if (queue.summary.running > 0) {
    return { id: "running", label: "Running", icon: <RefreshCw size={19} aria-hidden="true" /> };
  }
  if (queue.summary.rateLimited > 0) {
    return { id: "paused", label: "Paused", icon: <PauseCircle size={19} aria-hidden="true" /> };
  }
  if (queue.summary.queued > 0) {
    return { id: "queued", label: "Queued", icon: <Clock3 size={19} aria-hidden="true" /> };
  }
  if (queue.summary.failed + queue.summary.needsReview > 0) {
    return { id: "failed", label: "Attention", icon: <AlertTriangle size={19} aria-hidden="true" /> };
  }
  return { id: "completed", label: "Complete", icon: <CheckCircle2 size={19} aria-hidden="true" /> };
}

function csvJobDetail(job: CsvImportJobResponse) {
  if (job.status === "ready") {
    return `${job.summary.commitRows} rows are ready to commit; ${job.summary.excludedRows} excluded.`;
  }
  if (["queued", "validating"].includes(job.status)) {
    return `${job.progress.processedRows} of ${job.progress.totalRows || "unknown"} rows checked.`;
  }
  if (job.status === "committing") return `Saving ${job.summary.commitRows} rows atomically.`;
  if (job.status === "completed") return `Imported ${job.summary.commitRows} rows atomically.`;
  if (job.status === "cancelled") return "Import cancelled without saving inventory rows.";
  return "Import failed without saving partial inventory changes.";
}

function pricingJobDetail(queue: BulkPriceQueueResponse) {
  const parts = [
    `${queue.summary.queued + queue.summary.running} queued or running`,
    `${queue.summary.saved} saved`,
    `${queue.summary.needsReview} need review`,
    `${queue.summary.failed} failed`
  ];
  if (queue.summary.rateLimited > 0) parts.push(`${queue.summary.rateLimited} provider-paused`);
  return parts.join(" · ");
}

function snapshotHasActiveWork(snapshot: CollectionJobSnapshot) {
  const csvActive = snapshot.csvJobs.some((job) =>
    ["queued", "validating", "committing"].includes(job.status)
  );
  const queue = snapshot.priceQueue;
  return Boolean(
    csvActive ||
      (queue && queue.summary.queued + queue.summary.running + queue.summary.rateLimited > 0)
  );
}

function latestQueueUpdate(queue: BulkPriceQueueResponse) {
  return queue.jobs.reduce(
    (latest, job) => (job.updatedAt > latest ? job.updatedAt : latest),
    queue.jobs[0]?.updatedAt ?? new Date(0).toISOString()
  );
}

function inventoryPriceSignature(item: InventoryItem) {
  return [
    item.marketPriceCents,
    item.marketPriceSource,
    item.marketPriceUpdatedAt,
    item.marketPriceConfidence
  ].join("|");
}

function relativeJobTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Update time unavailable";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1_000));
  if (seconds < 60) return "Updated just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  return `Updated ${new Date(timestamp).toLocaleDateString()}`;
}

async function priceQueueActionRequest(action: PriceQueueAction, collectionId: string) {
  if (action === "resume") return api.resumeBulkPriceQueue(collectionId);
  if (action === "cancel") return api.cancelBulkPriceQueue(collectionId);
  if (action === "retry") return api.retryFailedBulkPriceQueue(collectionId);
  return api.clearCompletedBulkPriceQueue(collectionId);
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
