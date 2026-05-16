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
- [x] Added card detail image override with URL or local upload.
- [x] Added authenticated local image serving from app data storage.
- [x] Added free card lookup for set/card-number and name searches.
- [x] Added lookup result picker that can add raw or graded inventory items.
- [x] Added delete item flow with confirmation.
- [x] Added edit item flow for card details, grading, values, storage, notes, and images.

## Branch Roadmap

- [x] `feature/app-shell`
- [x] `feature/auth-db`
- [x] `feature/username-login`
- [x] `feature/manual-inventory`
- [x] `feature/card-lookup`
- [x] `feature/inventory-images`
- [ ] `feature/graded-certs`
- [x] `feature/psa-cert-import`
- [ ] `feature/pricing-comps`
- [ ] `feature/scanning`
- [ ] `feature/backups-export`
- [ ] `feature/polish-tests`

## Next Recommended Milestones

### 1. Local Inventory Improvements

- [x] Add edit item flow.
- [x] Add delete item flow with confirmation.
- [ ] Add duplicate/quantity merge behavior for manually entered cards.
- [ ] Add filters for raw/graded, language, condition, set code, storage, and value.
- [ ] Add collection search over local card name, set code, card number, cert number, and notes.

### 2. Card Lookup Without Paid APIs

- [x] Add input parser for values like `s10a 073/071`.
- [x] Add TCGdex lookup for Japanese and English card metadata.
- [x] Add PokemonTCG.io lookup for English set/card-number and name searches.
- [x] Add candidate result picker with card images.
- [x] Save selected lookup results into the existing `cards` and `owned_items` tables.
- [x] Keep manual entry and parsed draft candidates as fallback when lookup fails.

### 3. Images And Attachments

- [ ] Cache external card images locally when allowed.
- [x] Add optional manual image URL per card.
- [x] Add optional local upload for front card images.
- [ ] Add separate back-photo attachment support.
- [ ] Add PSA cert images later when cert import is implemented.

### 4. Graded Cards And Certs

- [x] Add PSA cert import with PSA API token.
- [ ] Add CGC cert/barcode draft flow.
- [ ] Add graded card detail UI for grader, grade, cert number, and cert links.
- [ ] Add barcode scanner path for PSA/CGC slabs.

### 5. Pricing And Comps

- [ ] Add manual value override history.
- [ ] Add guide price storage.
- [ ] Add eBay US sold-comp search/parsing as best-effort personal-use scraping.
- [ ] Add comp confidence scoring.
- [ ] Add daily refresh plus manual refresh button.

### 6. Camera Scanning

- [ ] Add scan session setup for English/Japanese.
- [ ] Add browser camera capture.
- [ ] Add continuous tray mode with stable-frame capture.
- [ ] Add OCR draft queue for raw cards.
- [ ] Add barcode/QR reading for slabs.

### 7. Backups And Export

- [ ] Add CSV export for collections and inventory.
- [ ] Add CSV import for manual inventory.
- [ ] Add scheduled SQLite backups under `/data/backups`.
- [ ] Add admin “backup now” button.
- [ ] Document restore steps.

### 8. Polish And Public Repo Readiness

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

- [ ] PSA Public API account/token for cert lookup.
- [ ] Optional PokemonTCG.io free API key for English fallback and higher rate limits.
- [ ] No TCGdex API key required.
- [ ] No eBay API key planned for v1 sold comps.
- [ ] No CGC API key planned; use best-effort public lookup with manual fallback.
