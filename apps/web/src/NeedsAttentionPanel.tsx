import { AlertTriangle, CheckCircle2, ImageOff, RefreshCw, Search, Tags } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  BulkPriceQueueResponse,
  InventoryItem,
  NeedsAttentionCategory,
  NeedsAttentionIssue,
  NeedsAttentionResponse
} from "@collection-tool/shared";
import { api } from "./api";

const categoryLabels: Record<NeedsAttentionCategory, string> = {
  "missing-price": "Missing prices",
  "stale-price": "Stale prices",
  "low-confidence": "Low confidence",
  "missing-image": "Missing images",
  "incomplete-metadata": "Incomplete metadata",
  "duplicate-cert": "Duplicate certs",
  "possible-duplicate": "Possible duplicates",
  "failed-work": "Failed / review work"
};

export function NeedsAttentionPanel({
  canEdit,
  collectionId,
  onOpenItem,
  onPriceQueued
}: {
  canEdit: boolean;
  collectionId: string;
  onOpenItem: (item: InventoryItem) => void;
  onPriceQueued: (queue: BulkPriceQueueResponse, message: string) => void;
}) {
  const [response, setResponse] = useState<NeedsAttentionResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState<NeedsAttentionCategory | "all">("all");
  const [workingItemId, setWorkingItemId] = useState("");

  async function load() {
    setStatus("loading");
    setMessage("");
    try {
      setResponse(await api.getNeedsAttention(collectionId));
      setStatus("idle");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Unable to load attention items.");
    }
  }

  useEffect(() => {
    setCategory("all");
    void load();
  }, [collectionId]);

  const issues = useMemo(
    () => response?.results.issues.filter((issue) => category === "all" || issue.category === category) ?? [],
    [category, response]
  );

  async function queuePrice(issue: NeedsAttentionIssue) {
    const item = issue.items[0];
    if (!item || !canEdit) return;
    setWorkingItemId(item.id);
    setMessage("");
    try {
      const queue = await api.enqueueBulkPriceRefresh(collectionId, {
        itemIds: [item.id],
        mode: item.itemType,
        includeExisting: item.marketPriceCents !== null
      });
      onPriceQueued(queue, `Queued ${item.card.name} for price refresh.`);
      setMessage(`Queued ${item.card.name} for price refresh.`);
      await load();
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Unable to queue price refresh.");
    } finally {
      setWorkingItemId("");
    }
  }

  if (status === "loading" && !response) {
    return <p className="attention-state">Loading collection checks…</p>;
  }

  if (!response) {
    return (
      <section className="attention-state">
        <AlertTriangle size={22} aria-hidden="true" />
        <p>{message || "Unable to load attention items."}</p>
        <button onClick={() => void load()} type="button">Try again</button>
      </section>
    );
  }

  return (
    <section className="attention-workspace" aria-label="Needs attention inbox">
      <div className="attention-toolbar">
        <div>
          <p className="eyebrow">Live collection checks</p>
          <h3>{response.summary.attentionItemCount} item{response.summary.attentionItemCount === 1 ? "" : "s"} need attention</h3>
          <p>{response.summary.totalGroupCount} actionable issue group{response.summary.totalGroupCount === 1 ? "" : "s"} from saved inventory and pricing work.</p>
        </div>
        <button disabled={status === "loading"} onClick={() => void load()} type="button">
          <RefreshCw size={16} aria-hidden="true" />
          {status === "loading" ? "Checking…" : "Run checks"}
        </button>
      </div>

      <div className="attention-category-grid" aria-label="Issue categories">
        <button className={category === "all" ? "active" : ""} onClick={() => setCategory("all")} type="button">
          <strong>{response.summary.totalGroupCount}</strong><span>All issues</span>
        </button>
        {response.summary.categories.map((summary) => (
          <button
            className={category === summary.category ? "active" : ""}
            key={summary.category}
            onClick={() => setCategory(summary.category)}
            type="button"
          >
            <strong>{summary.groupCount}</strong>
            <span>{categoryLabels[summary.category]}</span>
            <small>{summary.itemCount} item{summary.itemCount === 1 ? "" : "s"}</small>
          </button>
        ))}
      </div>

      {response.results.truncated ? (
        <p className="attention-warning">
          Details are bounded to {response.results.limitPerCategory} groups per category and {response.results.itemLimitPerGroup} item previews per group. Showing {response.results.returnedGroupCount} of {response.summary.totalGroupCount} groups ({response.results.returnedItemCount} previewed items); totals still cover the complete collection.
        </p>
      ) : null}
      {message ? <p className={status === "error" ? "form-error" : "lookup-note"}>{message}</p> : null}

      <div className="attention-list-header">
        <strong>{category === "all" ? "All issues" : categoryLabels[category]}</strong>
        <span>
          {issues.length} returned group{issues.length === 1 ? "" : "s"}
          {category !== "all" && response.summary.categories.find((entry) => entry.category === category)?.truncated
            ? ` of ${response.summary.categories.find((entry) => entry.category === category)?.groupCount}`
            : ""}
        </span>
      </div>
      <div className="attention-list">
        {issues.map((issue) => (
          <AttentionIssueRow
            canEdit={canEdit}
            issue={issue}
            key={issue.id}
            working={issue.items.some((item) => item.id === workingItemId)}
            onOpenItem={onOpenItem}
            onQueuePrice={() => void queuePrice(issue)}
          />
        ))}
        {issues.length === 0 ? (
          <div className="attention-empty">
            <CheckCircle2 size={28} aria-hidden="true" />
            <strong>No issues in this category</strong>
            <span>Nothing currently needs action here.</span>
          </div>
        ) : null}
      </div>

      <details className="attention-evidence">
        <summary>Evidence coverage</summary>
        <p>Inventory fields and persisted pricing-queue results are checked.</p>
        {response.sources.importHistory.available ? (
          <p><strong>Import history:</strong> Persisted server-side import evidence is included.</p>
        ) : (
          <p><strong>Import history unavailable:</strong> {response.sources.importHistory.reason}</p>
        )}
        <p>Prices become stale after {response.thresholds.stalePriceDays} days. Items explicitly ignored for price refresh are omitted from all pricing categories.</p>
      </details>
    </section>
  );
}

function AttentionIssueRow({
  canEdit,
  issue,
  working,
  onOpenItem,
  onQueuePrice
}: {
  canEdit: boolean;
  issue: NeedsAttentionIssue;
  working: boolean;
  onOpenItem: (item: InventoryItem) => void;
  onQueuePrice: () => void;
}) {
  const firstItem = issue.items[0];
  const canQueue = canEdit && firstItem && ["missing-price", "stale-price", "low-confidence", "failed-work"].includes(issue.category);
  const Icon = issue.category === "missing-image" ? ImageOff : issue.category.includes("duplicate") ? Tags : issue.category === "failed-work" ? AlertTriangle : Search;

  return (
    <article className={`attention-row attention-${issue.category}`}>
      <div className="attention-row-icon"><Icon size={18} aria-hidden="true" /></div>
      <div className="attention-row-copy">
        <div className="attention-row-heading">
          <span className="attention-category">{categoryLabels[issue.category]}</span>
          <strong>{issue.title}</strong>
        </div>
        <p>{issue.reasons.join(" ")}</p>
        <div className="attention-items">
          {issue.items.map((item) => (
            <button key={item.id} onClick={() => onOpenItem(item)} type="button">
              <strong>{item.card.name}</strong>
              <span>{[item.card.setCode || item.card.setName, item.card.cardNumber, item.itemType === "graded" ? `${item.grader || "No grader"} ${item.grade || ""}`.trim() : item.conditionLabel].filter(Boolean).join(" · ") || "Metadata incomplete"}</span>
            </button>
          ))}
          {issue.itemsTruncated ? (
            <span className="attention-items-more">
              +{issue.totalItemCount - issue.items.length} more matching item{issue.totalItemCount - issue.items.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
      </div>
      <div className="attention-row-actions">
        {firstItem ? <button onClick={() => onOpenItem(firstItem)} type="button">Open card</button> : null}
        {canQueue ? (
          <button className="primary-button" disabled={working} onClick={onQueuePrice} type="button">
            {working ? "Queueing…" : "Queue price"}
          </button>
        ) : null}
      </div>
    </article>
  );
}
