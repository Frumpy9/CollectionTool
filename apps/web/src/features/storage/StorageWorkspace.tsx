import type { InventoryItem } from "@collection-tool/shared";
import {
  AlertTriangle,
  Archive,
  Check,
  ChevronRight,
  ClipboardCheck,
  ExternalLink,
  MapPin,
  MoveRight,
  PackageOpen,
  RotateCcw,
  Search,
  ShieldCheck,
  Tags,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import "./StorageWorkspace.css";

type AuditStatus = "unreviewed" | "confirmed" | "missing" | "misplaced";
type AuditPhase = "active" | "finished";
type MoveEntryMode = "existing" | "new";

type LocationGroup = {
  key: string;
  label: string;
  items: InventoryItem[];
  quantity: number;
};

type LocationConcern = {
  first: LocationGroup;
  second: LocationGroup;
  reason: string;
};

type AuditSession = {
  phase: AuditPhase;
  locationKey: string;
  locationLabel: string;
  items: InventoryItem[];
  statuses: Record<string, AuditStatus>;
  startedAt: Date;
  finishedAt: Date | null;
};

type MutationPreview =
  | {
      kind: "move";
      destination: string;
      itemIds: string[];
      sourceLabel: string;
    }
  | {
      kind: "rename";
      destination: string;
      itemIds: string[];
      merges: boolean;
      sourceLabel: string;
    };

export type StorageWorkspaceProps = {
  collectionId: string;
  items: InventoryItem[];
  canEdit: boolean;
  onItemsUpdated: (items: InventoryItem[]) => void;
  onOpenItem: (item: InventoryItem) => void;
};

const unassignedLabel = "Unassigned";

export function StorageWorkspace({
  collectionId,
  items,
  canEdit,
  onItemsUpdated,
  onOpenItem
}: StorageWorkspaceProps) {
  const locationGroups = useMemo(() => groupItemsByLocation(items), [items]);
  const locationConcerns = useMemo(
    () => findLocationConcerns(locationGroups.filter((group) => group.key)),
    [locationGroups]
  );
  const [selectedLocationKey, setSelectedLocationKey] = useState("");
  const [searchText, setSearchText] = useState("");
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(() => new Set());
  const [moveEntryMode, setMoveEntryMode] = useState<MoveEntryMode>("existing");
  const [moveTarget, setMoveTarget] = useState("");
  const [newMoveTarget, setNewMoveTarget] = useState("");
  const [renameTarget, setRenameTarget] = useState("");
  const [preview, setPreview] = useState<MutationPreview | null>(null);
  const [mutationStatus, setMutationStatus] = useState<"idle" | "loading" | "error">("idle");
  const [mutationMessage, setMutationMessage] = useState("");
  const [audit, setAudit] = useState<AuditSession | null>(null);
  const collectionEpochRef = useRef(0);
  const pendingConcernRenameTargetRef = useRef<string | null>(null);

  const selectedLocation =
    locationGroups.find((group) => group.key === selectedLocationKey) ?? locationGroups[0];
  const locationItems = selectedLocation?.items ?? [];
  const normalizedSearch = searchText.trim().toLocaleLowerCase();
  const visibleItems = normalizedSearch
    ? locationItems.filter((item) => inventorySearchText(item).includes(normalizedSearch))
    : locationItems;
  const visibleItemIds = visibleItems.map((item) => item.id);
  const visibleSelectedCount = visibleItemIds.filter((id) => selectedItemIds.has(id)).length;
  const allVisibleSelected = visibleItems.length > 0 && visibleSelectedCount === visibleItems.length;
  const someVisibleSelected = visibleSelectedCount > 0 && !allVisibleSelected;
  const existingMoveTargets = locationGroups.filter((group) => group.key !== selectedLocationKey);
  const assignedLocationCount = locationGroups.filter((group) => group.key).length;
  const unassignedGroup = locationGroups.find((group) => !group.key);
  const storedQuantity = items.reduce(
    (total, item) => total + (item.storageLocation?.trim() ? item.quantity : 0),
    0
  );
  const locationKeySignature = locationGroups.map((group) => group.key).join("\u0000");
  const locationItemIdSignature = locationItems.map((item) => item.id).join("\u0000");

  useEffect(() => {
    const epoch = collectionEpochRef.current + 1;
    collectionEpochRef.current = epoch;
    setSelectedLocationKey("");
    setSearchText("");
    setSelectedItemIds(new Set());
    setMoveEntryMode("existing");
    setMoveTarget("");
    setNewMoveTarget("");
    setRenameTarget("");
    setPreview(null);
    setMutationStatus("idle");
    setMutationMessage("");
    setAudit(null);

    return () => {
      if (collectionEpochRef.current === epoch) {
        collectionEpochRef.current += 1;
      }
    };
  }, [collectionId]);

  useEffect(() => {
    if (locationGroups.some((group) => group.key === selectedLocationKey)) {
      return;
    }

    setSelectedLocationKey("");
    setSelectedItemIds(new Set());
    setPreview(null);
  }, [locationGroups, selectedLocationKey]);

  useEffect(() => {
    const availableTarget = locationGroups.find((group) => group.key !== selectedLocationKey);

    if (availableTarget) {
      setMoveTarget(availableTarget.key);
      setMoveEntryMode("existing");
    } else {
      setMoveTarget("");
      setMoveEntryMode("new");
    }

    setNewMoveTarget("");
    setRenameTarget(pendingConcernRenameTargetRef.current ?? "");
    pendingConcernRenameTargetRef.current = null;
    setPreview(null);
  }, [locationKeySignature, selectedLocationKey]);

  useEffect(() => {
    const validIds = new Set(locationItems.map((item) => item.id));

    setSelectedItemIds((current) => {
      const next = new Set([...current].filter((id) => validIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [locationItemIdSignature]);

  function selectLocation(key: string) {
    if (audit?.phase === "active") {
      return;
    }

    setSelectedLocationKey(key);
    setSearchText("");
    setSelectedItemIds(new Set());
    setMutationMessage("");
    setPreview(null);
  }

  function updateSearchText(value: string) {
    setSearchText(value);
    setSelectedItemIds(new Set());
    setPreview(null);
  }

  function toggleVisibleItems() {
    setSelectedItemIds((current) => {
      const next = new Set(current);

      if (allVisibleSelected) {
        for (const id of visibleItemIds) {
          next.delete(id);
        }
      } else {
        for (const id of visibleItemIds) {
          next.add(id);
        }
      }

      return next;
    });
    setPreview(null);
  }

  function toggleItem(itemId: string) {
    setSelectedItemIds((current) => {
      const next = new Set(current);

      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }

      return next;
    });
    setPreview(null);
  }

  function prepareMove() {
    const destination = moveEntryMode === "existing" ? moveTarget : newMoveTarget.trim();
    const itemIds = [...selectedItemIds];

    if (!canEdit || itemIds.length === 0 || destination === selectedLocationKey) {
      return;
    }

    setMutationMessage("");
    setPreview({
      kind: "move",
      destination,
      itemIds,
      sourceLabel: selectedLocation?.label ?? unassignedLabel
    });
  }

  function prepareRename() {
    const destination = renameTarget.trim();

    if (!canEdit || !selectedLocationKey || !destination || destination === selectedLocationKey) {
      return;
    }

    setMutationMessage("");
    setPreview({
      kind: "rename",
      destination,
      itemIds: locationItems.map((item) => item.id),
      merges: locationGroups.some((group) => group.key === destination),
      sourceLabel: selectedLocation?.label ?? selectedLocationKey
    });
  }

  async function confirmStorageMutation() {
    if (!preview || !canEdit || mutationStatus === "loading") {
      return;
    }

    const mutation = preview;
    const epoch = collectionEpochRef.current;
    setMutationStatus("loading");
    setMutationMessage("");

    try {
      const response = await api.bulkUpdateInventoryStorageLocation(collectionId, {
        itemIds: mutation.itemIds,
        storageLocation: mutation.destination
      });

      if (epoch !== collectionEpochRef.current) {
        return;
      }

      onItemsUpdated(response.items);
      setSelectedLocationKey(mutation.destination);
      setSelectedItemIds(new Set());
      setSearchText("");
      setPreview(null);
      setMutationStatus("idle");
      setMutationMessage(
        storageMutationResultMessage(
          mutation,
          response.updatedItemIds.length,
          response.notFoundItemIds.length
        )
      );
    } catch (error) {
      if (epoch !== collectionEpochRef.current) {
        return;
      }

      setMutationStatus("error");
      setMutationMessage(
        error instanceof Error ? error.message : "Unable to update storage locations."
      );
    }
  }

  function startAudit() {
    if (!selectedLocation || locationItems.length === 0) {
      return;
    }

    setSelectedItemIds(new Set());
    setPreview(null);
    setMutationMessage("");
    setAudit({
      phase: "active",
      locationKey: selectedLocation.key,
      locationLabel: selectedLocation.label,
      items: [...locationItems],
      statuses: Object.fromEntries(
        locationItems.map((item) => [item.id, "unreviewed" as const])
      ),
      startedAt: new Date(),
      finishedAt: null
    });
  }

  function setAuditItemStatus(itemId: string, status: AuditStatus) {
    setAudit((current) =>
      current?.phase === "active"
        ? {
            ...current,
            statuses: {
              ...current.statuses,
              [itemId]: status
            }
          }
        : current
    );
  }

  function resetAudit() {
    setAudit((current) =>
      current
        ? {
            ...current,
            phase: "active",
            statuses: Object.fromEntries(
              current.items.map((item) => [item.id, "unreviewed" as const])
            ),
            finishedAt: null
          }
        : current
    );
  }

  function cancelAudit() {
    if (audit) {
      setSelectedLocationKey(audit.locationKey);
    }
    setAudit(null);
  }

  function finishAudit() {
    setAudit((current) => {
      if (!current || current.phase !== "active") {
        return current;
      }

      const hasUnreviewed = current.items.some(
        (item) => current.statuses[item.id] === "unreviewed"
      );

      if (hasUnreviewed) {
        return current;
      }

      return {
        ...current,
        phase: "finished",
        finishedAt: new Date()
      };
    });
  }

  function reviewConcern(concern: LocationConcern) {
    if (audit?.phase === "active") {
      return;
    }

    if (selectedLocationKey === concern.first.key) {
      setRenameTarget(concern.second.key);
    } else {
      pendingConcernRenameTargetRef.current = concern.second.key;
    }
    setSelectedLocationKey(concern.first.key);
    setSearchText("");
    setSelectedItemIds(new Set());
    setMutationMessage("");
    setPreview(null);
  }

  if (audit) {
    return (
      <StorageAudit
        audit={audit}
        onCancel={cancelAudit}
        onFinish={finishAudit}
        onOpenItem={onOpenItem}
        onReset={resetAudit}
        onStatusChange={setAuditItemStatus}
      />
    );
  }

  return (
    <section aria-labelledby="storage-organizer-heading" className="storage-organizer">
      <header className="storage-organizer-header">
        <div>
          <p className="eyebrow">Storage</p>
          <h3 id="storage-organizer-heading">Organize physical locations</h3>
          <p>Browse what is actually stored, move cards deliberately, and audit one location.</p>
        </div>
        <span className={`storage-access-badge ${canEdit ? "can-edit" : "read-only"}`}>
          {canEdit ? <Tags aria-hidden="true" size={16} /> : <ShieldCheck aria-hidden="true" size={16} />}
          {canEdit ? "Editor access" : "Read-only"}
        </span>
      </header>

      {!canEdit ? (
        <div className="storage-read-only-note" role="note">
          <ShieldCheck aria-hidden="true" size={19} />
          <span>You can browse, open cards, and run a local audit. Moving and renaming require editor access.</span>
        </div>
      ) : null}

      <div className="storage-summary" aria-label="Storage summary">
        <div><span>Locations</span><strong>{assignedLocationCount}</strong></div>
        <div><span>Stored quantity</span><strong>{storedQuantity}</strong></div>
        <div className={(unassignedGroup?.quantity ?? 0) > 0 ? "needs-attention" : ""}>
          <span>Unassigned</span><strong>{unassignedGroup?.quantity ?? 0}</strong>
        </div>
        <div className={locationConcerns.length > 0 ? "needs-attention" : ""}>
          <span>Name concerns</span><strong>{locationConcerns.length}</strong>
        </div>
      </div>

      <div className="storage-organizer-layout">
        <nav aria-label="Storage locations" className="storage-location-nav">
          <div className="storage-section-heading">
            <div><p className="eyebrow">Browse</p><h3>Locations</h3></div>
            <span>{locationGroups.length}</span>
          </div>
          <div className="storage-location-list">
            {locationGroups.map((group) => (
              <button
                aria-current={selectedLocationKey === group.key ? "page" : undefined}
                className={selectedLocationKey === group.key ? "active" : ""}
                key={group.key || "unassigned"}
                onClick={() => selectLocation(group.key)}
                type="button"
              >
                <span className="storage-location-icon">
                  {group.key ? <Archive aria-hidden="true" size={18} /> : <PackageOpen aria-hidden="true" size={18} />}
                </span>
                <span><strong>{group.label}</strong><small>{group.items.length} row{group.items.length === 1 ? "" : "s"}</small></span>
                <span className="storage-location-quantity">{group.quantity}</span>
                <ChevronRight aria-hidden="true" size={17} />
              </button>
            ))}
          </div>
        </nav>

        <div className="storage-location-content">
          <div className="storage-location-header">
            <div>
              <p className="eyebrow">Selected location</p>
              <h3>{selectedLocation?.label ?? unassignedLabel}</h3>
              <p>{locationItems.length} inventory row{locationItems.length === 1 ? "" : "s"} · {selectedLocation?.quantity ?? 0} total card{selectedLocation?.quantity === 1 ? "" : "s"}</p>
            </div>
            <button
              className="storage-audit-start"
              disabled={locationItems.length === 0 || mutationStatus === "loading"}
              onClick={startAudit}
              type="button"
            >
              <ClipboardCheck aria-hidden="true" size={18} />
              Start physical audit
            </button>
          </div>

          <label className="storage-search">
            <Search aria-hidden="true" size={17} />
            <span className="sr-only">Search cards in {selectedLocation?.label ?? unassignedLabel}</span>
            <input
              onChange={(event) => updateSearchText(event.target.value)}
              placeholder="Search this location by card, set, number, grade…"
              type="search"
              value={searchText}
            />
          </label>

          {locationItems.length > 0 ? (
            <div className="storage-inventory-table-wrap">
              <table className="storage-inventory-table">
                <thead>
                  <tr>
                    <th className="storage-select-cell" scope="col">
                      {canEdit ? (
                        <input
                          aria-checked={someVisibleSelected ? "mixed" : allVisibleSelected}
                          aria-label="Select all visible cards"
                          checked={allVisibleSelected}
                          onChange={toggleVisibleItems}
                          type="checkbox"
                        />
                      ) : null}
                    </th>
                    <th scope="col">Card</th>
                    <th scope="col">Details</th>
                    <th scope="col">Qty</th>
                    <th className="storage-open-column" scope="col"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((item) => (
                    <tr className={selectedItemIds.has(item.id) ? "selected" : ""} key={item.id}>
                      <td className="storage-select-cell">
                        {canEdit ? (
                          <input
                            aria-label={`Select ${item.card.name}`}
                            checked={selectedItemIds.has(item.id)}
                            onChange={() => toggleItem(item.id)}
                            type="checkbox"
                          />
                        ) : null}
                      </td>
                      <td>
                        <strong>{item.card.name}</strong>
                        <small>{item.card.setName ?? "Unknown set"}{item.card.cardNumber ? ` · ${item.card.cardNumber}` : ""}</small>
                      </td>
                      <td>
                        <span className="storage-item-type">{item.itemType}</span>
                        <small>{item.itemType === "graded" ? [item.grader, item.grade].filter(Boolean).join(" ") || "Grade not recorded" : item.conditionLabel ?? "Condition not recorded"}</small>
                      </td>
                      <td><strong>{item.quantity}</strong></td>
                      <td className="storage-open-column">
                        <button aria-label={`Open ${item.card.name}`} onClick={() => onOpenItem(item)} type="button">
                          <ExternalLink aria-hidden="true" size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visibleItems.length === 0 ? <p className="storage-empty-inline">No cards in this location match that search.</p> : null}
            </div>
          ) : (
            <div className="storage-empty-location">
              <PackageOpen aria-hidden="true" size={28} />
              <div><strong>This location is empty.</strong><p>Select cards elsewhere and move them here, or choose another location.</p></div>
            </div>
          )}

          {canEdit ? (
            <div className="storage-actions-grid">
              <section aria-labelledby="storage-move-heading" className="storage-action-panel">
                <div className="storage-section-heading">
                  <div><p className="eyebrow">Selected cards</p><h3 id="storage-move-heading">Move cards</h3></div>
                  <span>{selectedItemIds.size}</span>
                </div>
                <p>Move the selected rows to an existing location, a new location, or Unassigned.</p>
                <div className="storage-segmented-control" aria-label="Move destination type">
                  <button aria-pressed={moveEntryMode === "existing"} onClick={() => { setMoveEntryMode("existing"); setPreview(null); }} type="button">Existing</button>
                  <button aria-pressed={moveEntryMode === "new"} onClick={() => { setMoveEntryMode("new"); setPreview(null); }} type="button">New location</button>
                </div>
                {moveEntryMode === "existing" ? (
                  <label>Destination
                    <select disabled={existingMoveTargets.length === 0} onChange={(event) => { setMoveTarget(event.target.value); setPreview(null); }} value={moveTarget}>
                      {existingMoveTargets.map((group) => <option key={group.key || "unassigned"} value={group.key}>{group.label}</option>)}
                    </select>
                  </label>
                ) : (
                  <label>New location name
                    <input onChange={(event) => { setNewMoveTarget(event.target.value); setPreview(null); }} placeholder="Binder 3, Box B…" value={newMoveTarget} />
                  </label>
                )}
                <button
                  className="storage-primary-action"
                  disabled={selectedItemIds.size === 0 || mutationStatus === "loading" || (moveEntryMode === "existing" ? existingMoveTargets.length === 0 || moveTarget === selectedLocationKey : !newMoveTarget.trim() || newMoveTarget.trim() === selectedLocationKey)}
                  onClick={prepareMove}
                  type="button"
                >
                  <MoveRight aria-hidden="true" size={17} />
                  Review move
                </button>
              </section>

              <section aria-labelledby="storage-rename-heading" className="storage-action-panel">
                <div className="storage-section-heading">
                  <div><p className="eyebrow">Whole location</p><h3 id="storage-rename-heading">Rename or merge</h3></div>
                  <span>{locationItems.length}</span>
                </div>
                {selectedLocationKey ? (
                  <>
                    <p>Renaming moves every row in this location. Matching an existing name merges the groups.</p>
                    <label>New location name
                      <input onChange={(event) => { setRenameTarget(event.target.value); setPreview(null); }} placeholder="Shelf A" value={renameTarget} />
                    </label>
                    <button className="storage-primary-action" disabled={!renameTarget.trim() || renameTarget.trim() === selectedLocationKey || locationItems.length === 0 || mutationStatus === "loading"} onClick={prepareRename} type="button">
                      <Tags aria-hidden="true" size={17} />
                      Review rename
                    </button>
                  </>
                ) : (
                  <div className="storage-action-unavailable" role="note">
                    <PackageOpen aria-hidden="true" size={20} />
                    <span>Unassigned is a system group and cannot be renamed. Move its cards instead.</span>
                  </div>
                )}
              </section>
            </div>
          ) : null}

          {preview ? (
            <StorageMutationPreview
              busy={mutationStatus === "loading"}
              onCancel={() => setPreview(null)}
              onConfirm={() => void confirmStorageMutation()}
              preview={preview}
            />
          ) : null}

          {mutationMessage ? (
            <p aria-live="polite" className={`storage-mutation-message ${mutationStatus === "error" ? "error" : "success"}`} role={mutationStatus === "error" ? "alert" : "status"}>
              {mutationMessage}
            </p>
          ) : null}
        </div>
      </div>

      <section aria-labelledby="storage-concerns-heading" className="storage-concerns">
        <div className="storage-section-heading">
          <div><p className="eyebrow">Review only</p><h3 id="storage-concerns-heading">Possible naming inconsistencies</h3></div>
          <span>{locationConcerns.length}</span>
        </div>
        <p>These are conservative suggestions based on formatting or a very small spelling difference. Nothing is merged automatically.</p>
        {locationConcerns.length > 0 ? (
          <div className="storage-concern-list">
            {locationConcerns.map((concern) => (
              <div key={`${concern.first.key}\u0000${concern.second.key}`}>
                <AlertTriangle aria-hidden="true" size={18} />
                <span><strong>{concern.first.label}</strong><small>{concern.first.quantity} card{concern.first.quantity === 1 ? "" : "s"}</small></span>
                <span className="storage-concern-divider">may match</span>
                <span><strong>{concern.second.label}</strong><small>{concern.second.quantity} card{concern.second.quantity === 1 ? "" : "s"}</small></span>
                <span className="storage-concern-reason">{concern.reason}</span>
                <button disabled={!canEdit} onClick={() => reviewConcern(concern)} type="button">Review rename</button>
              </div>
            ))}
          </div>
        ) : (
          <div className="storage-no-concerns"><Check aria-hidden="true" size={18} /><span>No likely naming inconsistencies detected.</span></div>
        )}
      </section>
    </section>
  );
}

function StorageMutationPreview({
  busy,
  onCancel,
  onConfirm,
  preview
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  preview: MutationPreview;
}) {
  const destinationLabel = preview.destination || unassignedLabel;

  return (
    <section aria-labelledby="storage-change-preview-heading" className="storage-change-preview">
      <AlertTriangle aria-hidden="true" size={22} />
      <div>
        <p className="eyebrow">Confirm scope</p>
        <h3 id="storage-change-preview-heading">
          {preview.kind === "move" ? "Move selected cards?" : preview.merges ? "Merge these locations?" : "Rename this location?"}
        </h3>
        <p><strong>{preview.itemIds.length} inventory row{preview.itemIds.length === 1 ? "" : "s"}</strong> will move from <strong>{preview.sourceLabel}</strong> to <strong>{destinationLabel}</strong>.</p>
        {preview.kind === "rename" && preview.merges ? <p className="storage-merge-warning">“{destinationLabel}” already exists. Its cards are preserved and these rows will join that location.</p> : null}
        <div className="storage-preview-actions">
          <button disabled={busy} onClick={onCancel} type="button">Cancel</button>
          <button className="confirm" disabled={busy} onClick={onConfirm} type="button">{busy ? "Updating…" : "Confirm change"}</button>
        </div>
      </div>
    </section>
  );
}

function StorageAudit({
  audit,
  onCancel,
  onFinish,
  onOpenItem,
  onReset,
  onStatusChange
}: {
  audit: AuditSession;
  onCancel: () => void;
  onFinish: () => void;
  onOpenItem: (item: InventoryItem) => void;
  onReset: () => void;
  onStatusChange: (itemId: string, status: AuditStatus) => void;
}) {
  const totals = auditTotals(audit);
  const reviewedCount = audit.items.length - totals.unreviewed.rows;
  const complete = reviewedCount === audit.items.length;
  const exceptionItems = audit.items.filter((item) => {
    const status = audit.statuses[item.id];
    return status === "missing" || status === "misplaced";
  });

  if (audit.phase === "finished") {
    return (
      <section aria-labelledby="storage-audit-summary-heading" className="storage-audit storage-audit-summary">
        <header className="storage-audit-header">
          <div>
            <p className="eyebrow">Physical audit complete</p>
            <h3 id="storage-audit-summary-heading">{audit.locationLabel}</h3>
            <p>Finished {formatAuditDate(audit.finishedAt)} · started {formatAuditDate(audit.startedAt)}</p>
          </div>
          <button onClick={onCancel} type="button"><X aria-hidden="true" size={17} /> Close report</button>
        </header>
        <AuditMetricGrid totals={totals} />
        <div className="storage-audit-safety" role="note">
          <ShieldCheck aria-hidden="true" size={20} />
          <span>This report is retained on this screen until closed. It did not change quantities, locations, or any inventory record.</span>
        </div>
        {exceptionItems.length > 0 ? (
          <div className="storage-audit-exceptions">
            <h3>Follow-up list</h3>
            {exceptionItems.map((item) => (
              <button key={item.id} onClick={() => onOpenItem(item)} type="button">
                <span className={`storage-audit-status ${audit.statuses[item.id]}`} />
                <span><strong>{item.card.name}</strong><small>{item.card.setName ?? "Unknown set"}{item.card.cardNumber ? ` · ${item.card.cardNumber}` : ""}</small></span>
                <span>{audit.statuses[item.id] === "missing" ? "Missing" : "Misplaced"}</span>
                <ExternalLink aria-hidden="true" size={16} />
              </button>
            ))}
          </div>
        ) : (
          <div className="storage-no-concerns"><Check aria-hidden="true" size={18} /><span>Every inventory row was confirmed in this location.</span></div>
        )}
        <button className="storage-audit-again" onClick={onReset} type="button"><RotateCcw aria-hidden="true" size={17} /> Audit this location again</button>
      </section>
    );
  }

  return (
    <section aria-labelledby="storage-audit-heading" className="storage-audit">
      <header className="storage-audit-header">
        <div>
          <p className="eyebrow">Physical audit</p>
          <h3 id="storage-audit-heading">{audit.locationLabel}</h3>
          <p>Compare each inventory row with the physical location. Findings stay local until this session is closed.</p>
        </div>
        <button onClick={onCancel} type="button"><X aria-hidden="true" size={17} /> Cancel audit</button>
      </header>
      <div className="storage-audit-progress">
        <div><strong>{reviewedCount} of {audit.items.length} reviewed</strong><span>{Math.round((reviewedCount / Math.max(1, audit.items.length)) * 100)}%</span></div>
        <progress max={audit.items.length} value={reviewedCount}>{reviewedCount} of {audit.items.length}</progress>
      </div>
      <div className="storage-audit-rows">
        {audit.items.map((item) => (
          <article key={item.id}>
            <div className="storage-audit-item">
              <button className="storage-audit-open" onClick={() => onOpenItem(item)} type="button">
                <span><strong>{item.card.name}</strong><small>{item.card.setName ?? "Unknown set"}{item.card.cardNumber ? ` · ${item.card.cardNumber}` : ""} · Qty {item.quantity}</small></span>
                <ExternalLink aria-hidden="true" size={15} />
              </button>
            </div>
            <div aria-label={`Audit status for ${item.card.name}`} className="storage-audit-status-options" role="group">
              {(["confirmed", "missing", "misplaced"] as const).map((status) => (
                <button aria-pressed={audit.statuses[item.id] === status} className={status} key={status} onClick={() => onStatusChange(item.id, status)} type="button">
                  {status === "confirmed" ? <Check aria-hidden="true" size={15} /> : status === "missing" ? <X aria-hidden="true" size={15} /> : <MapPin aria-hidden="true" size={15} />}
                  {status[0].toUpperCase() + status.slice(1)}
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>
      <footer className="storage-audit-footer">
        <button onClick={onReset} type="button"><RotateCcw aria-hidden="true" size={17} /> Reset statuses</button>
        <div>
          {!complete ? <span>{totals.unreviewed.rows} row{totals.unreviewed.rows === 1 ? "" : "s"} still need a status.</span> : <span>All rows reviewed. Ready to finish.</span>}
          <button className="finish" disabled={!complete} onClick={onFinish} type="button"><ClipboardCheck aria-hidden="true" size={17} /> Finish audit</button>
        </div>
      </footer>
    </section>
  );
}

type AuditCount = { rows: number; quantity: number };
type AuditTotals = Record<AuditStatus, AuditCount>;

function AuditMetricGrid({ totals }: { totals: AuditTotals }) {
  return (
    <div className="storage-audit-metrics" aria-label="Audit result summary">
      {(["confirmed", "missing", "misplaced"] as const).map((status) => (
        <div className={status} key={status}>
          <span>{status[0].toUpperCase() + status.slice(1)}</span>
          <strong>{totals[status].rows}</strong>
          <small>{totals[status].quantity} card{totals[status].quantity === 1 ? "" : "s"}</small>
        </div>
      ))}
    </div>
  );
}

function groupItemsByLocation(items: InventoryItem[]): LocationGroup[] {
  const grouped = new Map<string, InventoryItem[]>();
  grouped.set("", []);

  for (const item of items) {
    const key = item.storageLocation?.trim() ?? "";
    const groupItems = grouped.get(key) ?? [];
    groupItems.push(item);
    grouped.set(key, groupItems);
  }

  return [...grouped.entries()]
    .map(([key, groupItems]) => ({
      key,
      label: key || unassignedLabel,
      items: [...groupItems].sort(compareInventoryItems),
      quantity: groupItems.reduce((total, item) => total + item.quantity, 0)
    }))
    .sort((first, second) => {
      if (!first.key) return -1;
      if (!second.key) return 1;
      return first.label.localeCompare(second.label, undefined, { numeric: true, sensitivity: "base" });
    });
}

function findLocationConcerns(groups: LocationGroup[]): LocationConcern[] {
  const concerns: LocationConcern[] = [];

  for (let firstIndex = 0; firstIndex < groups.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < groups.length; secondIndex += 1) {
      const first = groups[firstIndex];
      const second = groups[secondIndex];
      const firstNormalized = normalizedLocationName(first.key);
      const secondNormalized = normalizedLocationName(second.key);
      let reason = "";

      if (firstNormalized === secondNormalized) {
        reason = "Formatting difference";
      } else if (isConservativeNearMatch(firstNormalized, secondNormalized)) {
        reason = "Possible one-character typo";
      }

      if (reason) {
        concerns.push({ first, second, reason });
      }
    }
  }

  return concerns.slice(0, 20);
}

function normalizedLocationName(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\-_/]+/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .trim();
}

function isConservativeNearMatch(first: string, second: string) {
  if (first.length < 5 || second.length < 5 || Math.abs(first.length - second.length) > 1) {
    return false;
  }

  const firstNumbers = first.match(/\d+/g) ?? [];
  const secondNumbers = second.match(/\d+/g) ?? [];

  if (firstNumbers.join("|") !== secondNumbers.join("|")) {
    return false;
  }

  return editDistanceAtMostOne(first, second);
}

function editDistanceAtMostOne(first: string, second: string) {
  if (first === second) return true;
  if (Math.abs(first.length - second.length) > 1) return false;

  const shorter = first.length <= second.length ? first : second;
  const longer = first.length <= second.length ? second : first;
  let shorterIndex = 0;
  let longerIndex = 0;
  let differences = 0;

  while (shorterIndex < shorter.length && longerIndex < longer.length) {
    if (shorter[shorterIndex] === longer[longerIndex]) {
      shorterIndex += 1;
      longerIndex += 1;
      continue;
    }

    differences += 1;
    if (differences > 1) return false;

    if (shorter.length === longer.length) shorterIndex += 1;
    longerIndex += 1;
  }

  return true;
}

function inventorySearchText(item: InventoryItem) {
  return [
    item.card.name,
    item.card.setName,
    item.card.setCode,
    item.card.cardNumber,
    item.itemType,
    item.conditionLabel,
    item.grader,
    item.grade,
    item.certNumber
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

function compareInventoryItems(first: InventoryItem, second: InventoryItem) {
  return first.card.name.localeCompare(second.card.name, undefined, { numeric: true, sensitivity: "base" }) ||
    (first.card.setName ?? "").localeCompare(second.card.setName ?? "", undefined, { numeric: true, sensitivity: "base" }) ||
    (first.card.cardNumber ?? "").localeCompare(second.card.cardNumber ?? "", undefined, { numeric: true, sensitivity: "base" });
}

function auditTotals(audit: AuditSession): AuditTotals {
  const totals: AuditTotals = {
    unreviewed: { rows: 0, quantity: 0 },
    confirmed: { rows: 0, quantity: 0 },
    missing: { rows: 0, quantity: 0 },
    misplaced: { rows: 0, quantity: 0 }
  };

  for (const item of audit.items) {
    const status = audit.statuses[item.id] ?? "unreviewed";
    totals[status].rows += 1;
    totals[status].quantity += item.quantity;
  }

  return totals;
}

function storageMutationResultMessage(
  mutation: MutationPreview,
  updatedCount: number,
  notFoundCount: number
) {
  const action = mutation.kind === "rename"
    ? mutation.merges ? "Merged" : "Renamed"
    : "Moved";
  const notFoundMessage = notFoundCount > 0
    ? ` ${notFoundCount} selected row${notFoundCount === 1 ? " was" : "s were"} already gone.`
    : "";

  return `${action} ${updatedCount} inventory row${updatedCount === 1 ? "" : "s"} to ${mutation.destination || unassignedLabel}.${notFoundMessage}`;
}

function formatAuditDate(value: Date | null) {
  if (!value) return "unknown time";
  return value.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
