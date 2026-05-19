# Pokemon Collection Tool Implementation Plan

## Current Status

- [x] Initialized local git repository on `main`.
- [x] Added public-safe `.gitignore`, `.env.example`, README, and docs.
- [x] Built React/Vite frontend shell.
- [x] Built Fastify API shell with `/health`.
- [x] Added SQLite migration runner using local database storage.
- [x] Added Docker Compose and Dockerfiles.
- [x] Added full account bootstrap, login, logout, and sessions.
- [x] Added username-or-email login.
- [x] Added local dev account seed script: `admin` / `admin`.
- [x] Added multi-collection database foundation.
- [x] Added collection membership roles and invite route.
- [x] Added local-only manual inventory backend.
- [x] Added manual card entry UI with raw/graded fields.
- [x] Added local inventory list and collection summary stats.
- [x] Added PSA cert lookup backend using `PSA_ACCESS_TOKEN`.
- [x] Added PSA cert import UI under the Cert action.
- [x] Added automatic PSA population metadata fetch when creating PSA graded cards with cert numbers.
- [x] Added card detail image override with URL or local upload.
- [x] Added authenticated local image serving from app data storage.
- [x] Added free card lookup for set/card-number and name searches.
- [x] Added lookup result picker that can add raw or graded inventory items.
- [x] Added delete item flow with confirmation.
- [x] Added edit item flow for card details, grading, values, storage, notes, and images.
- [x] Added multi-select variants for standard, holo/foil, reverse holo, stamped, and related card variants.
- [x] Added local inventory search, filters, active filter chips, and sorting.
- [x] Added bulk card lookup and bulk PSA cert import from pasted or uploaded text lists.
- [x] Added duplicate detection with a quantity-merge choice before adding matching inventory rows.
- [x] Added persistent graded-cert metadata and slab detail UI for PSA imports.
- [x] Fixed graded-cert metadata migration id collision and added self-healing cert column setup.
- [x] Removed PSA estimate UI because the public PSA API did not return estimate values in testing.
- [x] Verified detail modal closes after saving card edits.
- [x] Merged graded-card details into `main`.
- [x] Added collection inventory CSV export.
- [x] Added admin SQLite backup-now action under `data/backups`.
- [x] Added CSV import preview for manual inventory rows.
- [x] Documented SQLite backup restore steps.
- [x] Added scheduled SQLite backups with retention.
- [x] Added legacy JustTCG raw-card pricing refresh and market-value storage.
- [x] Added PokemonPriceTracker graded-card pricing refresh and market-value storage.
- [x] Promoted PokemonPriceTracker to sole raw and graded pricing source.
- [x] Added confirmed pricing source matches and on-demand PokemonPriceTracker history cache.
- [x] Added selection-mode bulk price queue with pause/resume handling for API limits.
- [x] Added selection-mode bulk variant editing with market-price clearing.
- [x] Refreshed the frontend workspace UX with real Collection, Graded, Storage, and Data sections.
- [x] Added local market price snapshots and red/green saved-price change indicators.

## Branch Roadmap

- [x] `feature/app-shell`
- [x] `feature/auth-db`
- [x] `feature/username-login`
- [x] `feature/manual-inventory`
- [x] `feature/card-lookup`
- [x] `feature/bulk-lookup`
- [x] `feature/inventory-images`
- [x] `feature/graded-certs`
- [x] `feature/psa-cert-import`
- [ ] `feature/pricing-comps`
- [ ] `feature/scanning`
- [x] `feature/backups-export`
- [ ] `feature/polish-tests`

## Next Recommended Milestones

### 1. Local Inventory Improvements

- [x] Add edit item flow.
- [x] Add delete item flow with confirmation.
- [x] Add duplicate/quantity merge behavior for manually entered cards.
- [x] Add filters for raw/graded, language, condition, storage, variants, and value.
- [x] Add collection search over local card name, set code, card number, cert number, storage, variants, and notes.
- [x] Add local inventory sorting by newest, name, set/code, value, and quantity.

### 2. Card Lookup Without Paid APIs

- [x] Add input parser for values like `s10a 073/071`.
- [x] Add TCGdex lookup for Japanese and English card metadata.
- [x] Add PokemonTCG.io lookup for English set/card-number and name searches.
- [x] Add candidate result picker with card images.
- [x] Save selected lookup results into the existing `cards` and `owned_items` tables.
- [x] Add bulk newline-list card lookup with staged review before inventory add.
- [x] Keep manual entry and parsed draft candidates as fallback when lookup fails.
- [x] Add SQLite-backed Japanese card cache for fast local set/card lookups.
- [x] Add authenticated API endpoint to seed/update Japanese cache entries.
- [x] Add on-demand official Japanese card list import for exact set/card-number searches.
- [x] Add older Japanese product-id fallback for sets like `CP3`.
- [x] Add English Pokemon name enrichment from free species data when official Japanese pages include a Pokedex number.
- [x] Add local Japanese Pokemon species-name translation map for Tag Teams and cached Japanese names.
- [x] Add Limitless fallback for Japanese secret-number cards missing from TCGdex and official product imports.
- [ ] Add importer/backfill for Japanese set lists from free sources where available.
- [x] Normalize Japanese cache fields: set code, card number, printed total, name, rarity, image URL, source.
- [x] Search Japanese cache before live APIs using indexed set/card and number/total queries.
- [ ] Add admin/maintenance UI to import or refresh a Japanese set.

### 3. Images And Attachments

- [ ] Cache external card images locally when allowed.
- [x] Add optional manual image URL per card.
- [x] Add optional local upload for front card images.
- [ ] Add separate back-photo attachment support.
- [ ] Add PSA cert images later when cert import is implemented.

### 4. Graded Cards And Certs

- [x] Add PSA cert import with PSA API token.
- [x] Add bulk PSA cert import from newline-separated text lists.
- [ ] Add CGC cert/barcode draft flow.
- [x] Add graded card detail UI for grader, grade, cert number, and cert links.
- [x] Persist PSA cert URL, spec ID, category, population, pop higher, and lookup timestamp.
- [x] Add PSA cert refresh action on graded card details.
- [x] Auto-fetch PSA cert population metadata when adding PSA graded cards with cert numbers.
- [x] Repair migration safety after parked pricing work reused migration id 6.
- [x] Remove PSA estimate display until a reliable free source exists.
- [ ] Add barcode scanner path for PSA/CGC slabs.

### 5. Pricing And Comps

- [x] Add manual value override history.
- [x] Add guide price storage.
- [x] Add PokemonPriceTracker raw-card guide price refresh.
- [x] Use PokemonPriceTracker as the v1 comps/pricing source and keep eBay solds as a manual research link.
- [x] Add comp confidence scoring.
- [x] Add staggered daily refresh plus manual refresh button.
- [x] Add local saved-price history snapshots because PokemonPriceTracker history is unreliable.
- [x] Add red/green market price movement indicators in list and detail views.
- [ ] Consider PokemonPriceTracker `fetchAllInSet` later for set-level cache warming when saved source IDs make bulk matching safe.

### 6. Camera Scanning

- [ ] Add scan session setup for English/Japanese.
- [ ] Add browser camera capture.
- [ ] Add continuous tray mode with stable-frame capture.
- [ ] Add OCR draft queue for raw cards.
- [ ] Add barcode/QR reading for slabs.

### 7. Backups And Export

- [x] Add CSV export for inventory.
- [x] Add CSV import for manual inventory.
- [x] Add scheduled SQLite backups under `/data/backups`.
- [x] Add admin “backup now” button.
- [x] Document restore steps.

### 8. Polish And Public Repo Readiness

- [x] Replace inactive sidebar links, dead scan affordance, and stale roadmap chips with working workspace sections.
- [ ] Add Playwright tests for auth and manual inventory.
- [ ] Add backend tests for auth, permissions, and inventory routes.
- [ ] Run Docker Compose on the Ubuntu target server.
- [ ] Add screenshots to README.
- [ ] Confirm no secrets, databases, cached images, backups, sessions, or logs are tracked.

## Useful Commands

```bash
npm install
npm run dev
npm run typecheck
npm run build
npm run seed:dev-admin --workspace @collection-tool/api
```

## API Keys Needed Later

- [x] PSA Public API account/token for cert lookup.
- [x] Optional PokemonTCG.io free API key for English fallback and higher rate limits.
- [x] PokemonPriceTracker API key for primary raw/graded market pricing.
- [x] JustTCG is deprecated; old saved prices remain readable but no API key is used.
- [ ] No TCGdex API key required.
- [x] No eBay API key or direct eBay scraping planned for v1 sold comps.
- [ ] No CGC API key planned; use best-effort public lookup with manual fallback.

## End Of Night Checkpoint

- Current working branch: `codex/backups-export`.
- Bulk lookup, duplicate/quantity merge, and graded-card details are merged into local `main`.
- Backups/export is in progress on `codex/backups-export`.
- The current dev database has the graded cert metadata columns applied.
- Verified in browser: PSA cert refresh persists population/pop higher/spec/category and Save changes closes the detail modal.
- PSA estimate is intentionally not shown because the public PSA lookup response did not include it for cert `59711010`.
