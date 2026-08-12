import { AlertTriangle, CheckCircle2, Pin, RefreshCw, Unlink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  InventoryItem,
  PricingReviewCandidate,
  PricingReviewComparison,
  PricingReviewEntry,
  PricingReviewsResponse
} from "@collection-tool/shared";
import { api } from "./api";

type ReviewFilter = "needs-review" | "pinned" | "all";

export function PricingReviewWorkspace({
  canEdit,
  collectionId,
  onItemUpdated,
  onOpenItem
}: {
  canEdit: boolean;
  collectionId: string;
  onItemUpdated: (item: InventoryItem) => void;
  onOpenItem: (item: InventoryItem) => void;
}) {
  const [reviews, setReviews] = useState<PricingReviewsResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [message, setMessage] = useState("");
  const [workingItemId, setWorkingItemId] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReviewFilter>("needs-review");

  async function loadReviews() {
    setStatus("loading");
    setMessage("");
    try {
      const response = await api.getPricingReviews(collectionId);
      setReviews(response);
      setStatus("idle");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Unable to load pricing reviews.");
    }
  }

  useEffect(() => {
    void loadReviews();
  }, [collectionId]);

  const visibleReviews = useMemo(
    () =>
      (reviews?.reviews ?? []).filter((review) =>
        filter === "all"
          ? true
          : filter === "pinned"
            ? review.isPinned
            : review.status === "needs-review"
      ),
    [filter, reviews]
  );

  async function selectCandidate(review: PricingReviewEntry, candidate: PricingReviewCandidate) {
    setWorkingItemId(review.item.id);
    setMessage("");
    try {
      const response = await api.selectPricingReview(collectionId, review.item.id, {
        sourceCardId: candidate.sourceCardId,
        sourceVariantId: candidate.sourceVariantId
      });
      setReviews(response.reviews);
      setMessage(response.message);
      onItemUpdated(response.item);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to pin this pricing match.");
    } finally {
      setWorkingItemId(null);
    }
  }

  async function unpin(review: PricingReviewEntry) {
    setWorkingItemId(review.item.id);
    setMessage("");
    try {
      const response = await api.unpinPricingReview(collectionId, review.item.id);
      setReviews(response.reviews);
      setMessage(response.message);
      onItemUpdated(response.item);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to unpin this pricing match.");
    } finally {
      setWorkingItemId(null);
    }
  }

  return (
    <section className="pricing-review-workspace" aria-label="Pricing match review">
      <div className="workspace-panel-header pricing-review-heading">
        <div>
          <p className="eyebrow">Pricing quality</p>
          <h2>Match review</h2>
          <p>
            Compare inventory facts with saved provider alternatives. Confirmed pins remain in
            place during future price refreshes.
          </p>
        </div>
        <button disabled={status === "loading"} onClick={loadReviews} type="button">
          <RefreshCw size={17} aria-hidden="true" />
          Refresh list
        </button>
      </div>

      <div className="pricing-review-summary" aria-label="Pricing review summary">
        <button
          className={filter === "needs-review" ? "active" : ""}
          onClick={() => setFilter("needs-review")}
          type="button"
        >
          <AlertTriangle size={18} aria-hidden="true" />
          <span>Needs review</span>
          <strong>{reviews?.summary.needsReview ?? 0}</strong>
        </button>
        <button
          className={filter === "pinned" ? "active" : ""}
          onClick={() => setFilter("pinned")}
          type="button"
        >
          <Pin size={18} aria-hidden="true" />
          <span>Pinned</span>
          <strong>{reviews?.summary.pinned ?? 0}</strong>
        </button>
        <button
          className={filter === "all" ? "active" : ""}
          onClick={() => setFilter("all")}
          type="button"
        >
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>All</span>
          <strong>{reviews?.reviews.length ?? 0}</strong>
        </button>
      </div>

      {message ? <p className={status === "error" ? "form-error" : "lookup-note"}>{message}</p> : null}
      {!canEdit ? (
        <p className="lookup-note">Viewer access is read-only. An editor can confirm or unpin matches.</p>
      ) : null}

      {status === "loading" && !reviews ? <p className="lookup-note">Loading pricing reviews…</p> : null}
      {status !== "loading" && visibleReviews.length === 0 ? (
        <section className="empty-state filtered-empty">
          <div className="empty-copy">
            <p className="eyebrow">Pricing matches</p>
            <h3>Nothing in this view.</h3>
            <p>Questionable matches appear here after a refresh, and confirmed pins stay visible.</p>
          </div>
        </section>
      ) : null}

      <div className="pricing-review-list">
        {visibleReviews.map((review) => (
          <PricingReviewCard
            canEdit={canEdit}
            isWorking={workingItemId === review.item.id}
            key={review.item.id}
            review={review}
            onOpenItem={() => onOpenItem(review.item)}
            onSelect={(candidate) => selectCandidate(review, candidate)}
            onUnpin={() => unpin(review)}
          />
        ))}
      </div>
    </section>
  );
}

function PricingReviewCard({
  canEdit,
  isWorking,
  review,
  onOpenItem,
  onSelect,
  onUnpin
}: {
  canEdit: boolean;
  isWorking: boolean;
  review: PricingReviewEntry;
  onOpenItem: () => void;
  onSelect: (candidate: PricingReviewCandidate) => void;
  onUnpin: () => void;
}) {
  return (
    <article className={`pricing-review-card ${review.status}`}>
      <div className="pricing-review-card-header">
        <div className="pricing-review-item">
          <div className="pricing-review-image" aria-hidden="true">
            {review.item.card.imageUrl ? <img alt="" src={review.item.card.imageUrl} /> : null}
          </div>
          <div>
            <p className="eyebrow">
              {review.item.card.language.toUpperCase()} · {review.item.itemType}
            </p>
            <h3>{review.item.card.name}</h3>
            <p>{inventoryIdentity(review.item)}</p>
          </div>
        </div>
        <div className="pricing-review-card-actions">
          <span className={`queue-status-pill ${review.status === "pinned" ? "saved" : "needs-review"}`}>
            {review.status === "pinned"
              ? "Pinned"
              : review.isPinned
                ? "Pinned · Needs review"
                : "Needs review"}
          </span>
          <button onClick={onOpenItem} type="button">Open card</button>
          {review.isPinned && canEdit ? (
            <button disabled={isWorking} onClick={onUnpin} type="button">
              <Unlink size={16} aria-hidden="true" />
              {isWorking ? "Working…" : "Unpin"}
            </button>
          ) : null}
        </div>
      </div>
      <p className="pricing-review-message">{review.message}</p>

      {review.candidates.length === 0 ? (
        <p className="lookup-note">No saved alternatives yet. Open the card and refresh its price.</p>
      ) : (
        <div className="pricing-review-candidates">
          {review.candidates.map((candidate) => (
            <article
              className={`pricing-review-candidate ${candidate.isPinned ? "pinned" : ""}`}
              key={`${candidate.sourceCardId}-${candidate.sourceVariantId}`}
            >
              <div className="pricing-review-candidate-heading">
                <div>
                  <strong>{candidate.matchedName}</strong>
                  <span>{formatCurrency(candidate.priceCents)} · {candidate.confidence}</span>
                </div>
                {candidate.isPinned ? <span className="pin-label"><Pin size={14} /> Pinned</span> : null}
              </div>
              <div className="pricing-comparison-table">
                <div className="pricing-comparison-header">
                  <span>Field</span><span>Inventory</span><span>Provider</span>
                </div>
                {candidate.comparisons.map((comparison) => (
                  <ComparisonRow comparison={comparison} key={comparison.field} />
                ))}
              </div>
              <div className="pricing-review-candidate-footer">
                <span>{candidate.saleCount === null ? "Sales unknown" : `${candidate.saleCount} sales`}</span>
                {review.status === "needs-review" && canEdit ? (
                  <button disabled={isWorking} onClick={() => onSelect(candidate)} type="button">
                    <Pin size={16} aria-hidden="true" />
                    {isWorking ? "Saving…" : "Confirm and pin"}
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </article>
  );
}

function ComparisonRow({ comparison }: { comparison: PricingReviewComparison }) {
  return (
    <div className={`pricing-comparison-row ${comparison.status}`}>
      <strong>{comparisonLabel(comparison.field)}</strong>
      <span>{comparison.inventoryValue ?? "Not recorded"}</span>
      <span>{comparison.candidateValue ?? "Not provided"}</span>
    </div>
  );
}

function comparisonLabel(field: PricingReviewComparison["field"]) {
  return field === "card-number" ? "Card number" : field[0].toUpperCase() + field.slice(1);
}

function inventoryIdentity(item: InventoryItem) {
  return [
    item.card.setName,
    item.card.setCode,
    item.card.cardNumber,
    item.variantDetails,
    item.itemType === "graded" ? [item.grader, item.grade].filter(Boolean).join(" ") : item.conditionLabel
  ].filter(Boolean).join(" · ") || "Inventory details incomplete";
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
