# Pokemon Vault Cleanup Ideas

Pokemon Vault has a strong set of local-first collection features. The next cleanup pass should
reduce overlapping workflows, make consequential actions easier to understand, and create clearer
domain boundaries in the codebase.

Status: `[x]` shipped, `[~]` in progress, `[ ]` planned.

## Primary Workflow Cleanups

### [x] 1. Unified card intake

Replace the scattered manual entry, card lookup, bulk lookup, PSA cert import, Deep Search import,
and CSV entry points with one **Add cards** workspace. Each intake method should feed a consistent
review-and-commit flow while retaining its specialized controls.

Suggested methods:

- Search cards
- Manual entry
- PSA certificate
- Bulk list
- CSV import

The first pass can consolidate navigation and presentation around the existing, proven workflows.
A later pass can introduce a shared server-backed review tray and atomic commit contract.

### [x] 2. Consolidated pricing workspace

Bring pricing status, questionable matches, refresh jobs, ignored cards, history, and provider
diagnostics into one **Pricing** workspace instead of spreading them across card details, Price
Review, Needs Attention, selection actions, and Admin maintenance.

Suggested views:

- Overview
- Needs review
- Refresh queue
- History
- Ignored cards
- Provider status and settings

Needs Attention should remain a collection-wide inbox but deep-link into the relevant Pricing view.

### [x] 3. Simpler inventory navigation

Use one Inventory workspace with persistent views or filters for All, Raw, Graded, Missing price,
Missing image, and Recently added. Remove surprising transitions between raw-only, graded-only, and
cross-inventory result scopes.

The shipped view switcher stores the active view per collection, reports real inventory-row counts,
and applies the primary scope before the existing detailed filters.

### [x] 4. Actionable storage organizer

Either merge the current storage summaries into Inventory or turn Storage into a real organizer:

- Browse the contents of a location
- Rename and merge locations
- Move cards between locations
- Detect inconsistent location names
- Start a physical inventory audit

Storage now supports reviewed moves and rename/merge operations, a first-class Unassigned group,
conservative naming suggestions, and non-mutating local audit reports. Viewers retain browse and
audit access without seeing mutation controls.

### [x] 5. Transaction and inventory finalization

When recording a sale, trade, gift, or disposal, explicitly offer to adjust inventory in the same
reviewed operation. Show the before and after quantity and retain a **ledger only** option. Never
silently change inventory.

New item transactions now default to ledger-only and offer an explicit linked-inventory option with
a before/after confirmation. The ledger insert and quantity change commit atomically; invalid or
insufficient adjustments roll both back. Editing or deleting history never replays inventory changes.

## Consistency And Trust Cleanups

### [x] 6. Centralized duplicate identity

Move duplicate comparison into one server-side domain module used by manual entry, bulk intake, CSV
imports, cert checks, and Needs Attention. Return structured match reasons so every workflow explains
duplicates consistently.

Duplicate identity now lives in one tested server module. Intake uses a read-only preflight endpoint,
CSV policies and cert checks share the same normalized keys, and Needs Attention reports the same
structured matching fields. Certification matches cannot change quantity or be added as separate rows, while intentional
variant differences such as 1st Edition, Shadowless, and printing details remain distinct.

### [ ] 7. Server-side image matching

Move image candidate lookup, scoring, and provider fallback logic out of the large frontend
component. Return ranked candidates with match reasons and confidence from the API so manual, bulk,
PSA, and CSV workflows share one tested implementation.

### [ ] 8. Clear collection versus system administration

Separate collection settings—members, roles, collection preferences, and pricing behavior—from
system administration—local accounts, database integrity, backups, and provider diagnostics.

### [ ] 9. Shared background-job center

Add a persistent job drawer for CSV imports, price refreshes, future image caching, and maintenance
tasks. It should show progress, pauses, rate limits, failures, completion, cancellation, and retries
without requiring the user to remain on the originating screen.

### [ ] 10. Consistent feedback and destructive-action review

Replace scattered status messages and native confirmation prompts with consistent application
notices and accessible review dialogs. Bulk and destructive actions should identify the exact scope,
expected result, and recovery options before confirmation.

## Architecture Cleanups

### [ ] 11. Split the frontend by domain

Incrementally extract `App.tsx` into domain-focused features:

- `features/inventory`
- `features/intake`
- `features/pricing`
- `features/transactions`
- `features/storage`
- `features/admin`

Keep shared primitives small and avoid replacing the single large component with a single large
global state store.

### [ ] 12. Shared authorization helpers and runtime schemas

Replace repeated route-level authentication, role checks, body casts, and normalization with shared
access helpers and runtime request schemas. Preserve friendly, stable API errors.

### [ ] 13. Provider boundary cleanup

Separate each external provider into transport, response normalization, matching/scoring, and public
result layers. Provider-specific payloads should not leak into routes or frontend state.

### [ ] 14. URL-backed workspace state

Put the active workspace, tab, filters, selected card, and review target in the URL. Refreshing or
sharing a URL should restore the same useful context without exposing sensitive values.

### [ ] 15. Remove hardcoded currency assumptions

Centralize currency formatting now, then preserve original transaction currencies and collection
display preferences when multi-currency support is introduced.

## Recommended Sequence

1. Unified card intake and consolidated pricing workspace.
2. Inventory navigation, collection/system settings split, and shared background jobs.
3. Transaction finalization, actionable storage, and consistent destructive-action review.
4. Duplicate identity, image matching, authorization/schema, and provider boundary extraction.
5. URL state and currency cleanup.

## Cleanup Principles

- Consolidation must preserve existing capabilities and permission rules.
- Prefer progressive extraction over a large rewrite.
- Every consequential action needs a previewable scope and a clear result.
- Provider matching decisions should be inspectable and testable.
- New workspaces should remain dense, keyboard-friendly, and useful for large collections.
