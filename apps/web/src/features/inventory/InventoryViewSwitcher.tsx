import {
  CircleDollarSign,
  Clock3,
  Grid2X2,
  ImageOff,
  Layers3,
  ShieldCheck,
  type LucideIcon
} from "lucide-react";
import { useId, useMemo, useRef, type KeyboardEvent } from "react";
import type { InventoryItem } from "@collection-tool/shared";
import {
  getInventoryViewCounts,
  getInventoryViewDefinition,
  inventoryViews,
  type InventoryView
} from "./inventoryViews";
import "./InventoryViewSwitcher.css";

export type InventoryViewSwitcherProps = {
  items: readonly InventoryItem[];
  value: InventoryView;
  onChange: (view: InventoryView) => void;
  /** A stable timestamp can be supplied when counts must share a render-time boundary. */
  referenceTimeMs?: number;
  ariaLabel?: string;
  className?: string;
};

const viewIcons: Record<InventoryView, LucideIcon> = {
  all: Layers3,
  raw: Grid2X2,
  graded: ShieldCheck,
  "missing-price": CircleDollarSign,
  "missing-image": ImageOff,
  "recently-added": Clock3
};

const countFormatter = new Intl.NumberFormat();

export function InventoryViewSwitcher({
  ariaLabel = "Inventory view",
  className,
  items,
  onChange,
  referenceTimeMs,
  value
}: InventoryViewSwitcherProps) {
  const generatedId = useId();
  const idPrefix = `inventory-view-${generatedId.replace(/:/g, "")}`;
  const optionRefs = useRef<Partial<Record<InventoryView, HTMLButtonElement | null>>>({});
  // Hold one boundary across a render and refresh the default boundary whenever
  // immutable inventory data changes. Callers can pass referenceTimeMs when the
  // switcher and applyInventoryView must share the exact same boundary.
  const stableReferenceTimeMs = useMemo(
    () => referenceTimeMs ?? Date.now(),
    [referenceTimeMs, items]
  );
  const counts = useMemo(
    () => getInventoryViewCounts(items, { referenceTimeMs: stableReferenceTimeMs }),
    [items, stableReferenceTimeMs]
  );
  const activeDefinition = getInventoryViewDefinition(value);

  function selectAndFocus(view: InventoryView) {
    onChange(view);
    optionRefs.current[view]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, view: InventoryView) {
    const currentIndex = inventoryViews.indexOf(view);
    let nextView: InventoryView | null = null;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextView = inventoryViews[(currentIndex + 1) % inventoryViews.length];
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextView = inventoryViews[
        (currentIndex - 1 + inventoryViews.length) % inventoryViews.length
      ];
    } else if (event.key === "Home") {
      nextView = inventoryViews[0];
    } else if (event.key === "End") {
      nextView = inventoryViews[inventoryViews.length - 1];
    }

    if (nextView) {
      event.preventDefault();
      selectAndFocus(nextView);
    }
  }

  return (
    <section
      aria-labelledby={`${idPrefix}-heading`}
      className={["inventory-view-switcher", className].filter(Boolean).join(" ")}
    >
      <div className="inventory-view-heading">
        <div>
          <p className="eyebrow">Inventory scope</p>
          <h3 id={`${idPrefix}-heading`}>View collection</h3>
        </div>
        <p>
          <strong>{countFormatter.format(counts[value])}</strong> row
          {counts[value] === 1 ? "" : "s"}
        </p>
      </div>

      <div aria-label={ariaLabel} className="inventory-view-options" role="radiogroup">
        {inventoryViews.map((view) => {
          const definition = getInventoryViewDefinition(view);
          const Icon = viewIcons[view];
          const isActive = value === view;

          return (
            <button
              aria-checked={isActive}
              className={isActive ? "active" : ""}
              id={`${idPrefix}-${view}`}
              key={view}
              onClick={() => onChange(view)}
              onKeyDown={(event) => handleKeyDown(event, view)}
              ref={(element) => {
                optionRefs.current[view] = element;
              }}
              role="radio"
              tabIndex={isActive ? 0 : -1}
              type="button"
            >
              <Icon aria-hidden="true" size={17} />
              <span>{definition.label}</span>
              <strong aria-label={`${counts[view]} rows`}>{countFormatter.format(counts[view])}</strong>
            </button>
          );
        })}
      </div>

      <p aria-live="polite" className="inventory-view-description">
        <strong>{activeDefinition.label}:</strong> {activeDefinition.description}
      </p>
    </section>
  );
}
