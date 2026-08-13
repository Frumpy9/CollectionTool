# Pokemon Collection Tool

A self-hosted collection manager for raw and graded Pokemon cards. The first milestone is a Docker-ready app shell with a React frontend, Fastify API, SQLite migration runner, and a public-repo-safe configuration layout.

## Current Status

Milestone 1 is focused on the working app shell:

- React/Vite web app
- Fastify API with `/health`
- SQLite migration runner
- SQLite foreign-key enforcement, WAL journaling, and admin integrity diagnostics
- Local card image uploads stored outside git
- Free card lookup through PokemonTCG.io and TCGdex
- Atomic inventory CSV export/import with dry-run validation and error reports
- SQLite backup-now and scheduled backup flow under `data/backups`
- Interactive saved-price charts and immutable collection-value history with date ranges and point inspection
- Collection transaction ledger for purchases, sales, trades, gifts, disposals, and fees
- Needs-attention inbox for metadata, image, pricing, duplicate, and failed-work review
- Unified Add Cards workspace for search, manual entry, PSA certs, bulk lists, and CSV imports
- Server-ranked image recovery with provider fallback and inspectable match reasons
- Consolidated Pricing workspace for coverage, match review, and refresh-queue operations
- Docker Compose layout with persistent local data
- Public-safe `.env.example`

Later milestones add CGC cert workflows, pricing comps, camera scanning, and deeper import/export tools.

## Requirements

- Node.js 22+ for local development
- Docker and Docker Compose for server deployment
- A persistent data directory on the server
- Tailscale or Cloudflare Tunnel for phone access

## Local Development

```bash
npm install
npm run dev
```

The web app runs at `http://localhost:5173` and proxies API requests to `http://localhost:3000`.

For a local throwaway test account:

```bash
npm run seed:dev-admin --workspace @collection-tool/api
```

That creates or resets a local-only account with username `admin` and password `admin` in the ignored SQLite dev database.

## Docker

```bash
cp .env.example .env
npm run prod
```

Edit `.env` before starting production. Set `APP_URL` to your HTTPS domain and replace `SESSION_SECRET` with a long random value. Production startup rejects localhost URLs and default/short session secrets.

The production Docker app publishes the website only on `127.0.0.1:5173`. Point host-installed `cloudflared` at `http://localhost:5173`; nginx inside the web container proxies `/api`, `/uploads`, and `/health` to the private API container.

Useful production commands:

```bash
npm run prod          # build/start containers
npm run prod:logs     # follow logs
npm run prod:ps       # show container status
npm run prod:restart  # restart containers
npm run prod:stop     # stop containers, keep data volume
```

`npm run prod` computes `APP_VERSION` from the local Git commit count before Docker builds the web image, so the Credits page can show the deployed public version even though the container does not include `.git`.

To update later:

```bash
git pull
npm run prod
npm run prod:logs
```

The SQLite database is stored in the `collection-data` Docker volume at `/data/collection.sqlite`.
Uploaded card images are stored in the same volume under `/data/uploads`. Do not run `docker compose down -v` unless you intentionally want to delete the stored collection data.

## Backups And Restore

Use the in-app backup button before large imports or cleanup sessions. Local backups are written under `data/backups`; Docker backups are written under `/data/backups`.

Restore steps are documented in [docs/backup-restore.md](docs/backup-restore.md).

## Atomic CSV Imports

The Data workspace accepts Pokemon Vault inventory exports, compatible named columns, and PSA
Vault collection exports. Previewing runs on the API and does not change inventory. The preview
states exactly how many rows will commit and how many invalid or duplicate rows are excluded. You
must acknowledge exclusions before committing, and exact duplicates require an explicit skip,
merge-quantity, or separate-row policy. Cert numbers are always deduplicated. Manual, bulk, PSA,
CSV, and Needs Attention checks use the same server-side identity rules and return field-level match
reasons; variant-distinct cards remain separate.

Accepted rows commit in one SQLite transaction, so an interruption or row failure cannot leave a
partial import. Inventory changes after preview invalidate the plan and require a new preview. A
successful import records one collection-value snapshot for the whole job; dry-runs, cancellations,
and failed jobs record none. Validation progress can be cancelled, and failed/excluded rows can be
downloaded as a spreadsheet-safe CSV error report. Imports are limited to 5 MB, 5,000 data rows,
and 128 columns. Jobs are temporary, creator-only, and expire after one hour.
They are held in API memory rather than the database, so an API restart discards unfinished previews;
upload the CSV again to create a fresh plan after a restart.

## Database Reliability

Every API database connection enables SQLite foreign-key enforcement and waits up to five seconds
for a busy database before failing an operation. File-backed local databases use WAL journal mode for
safer reader/writer concurrency; in-memory test databases keep SQLite's compatible in-memory journal.
Startup stops with a clear error if the required foreign-key or WAL setting cannot be activated.

System administrators can open **System Admin → Maintenance** and run an on-demand database check. It runs
SQLite's `integrity_check` and `foreign_key_check`, reports connection safety settings, and returns a
bounded diagnostic summary without exposing the database path or stored card data. A check detects
problems but does not modify or repair the database.

Collection membership and scheduled-pricing visibility live under **Collection Settings**, which is
available only to explicit collection owners and collection admins. Local user accounts, whole-database
backups, integrity checks, and credential-safe provider diagnostics live under **System Admin**.

For local debugging, system administrators also see every collection in the collection switcher.
Collections where the administrator is not an explicit member are exposed with viewer access: cards
and read-only pricing diagnostics are visible, but inventory and membership mutations still require
an explicit role on that collection.

## Secrets

Do not commit `.env`, database files, cached images, backups, sessions, or logs. PSA credentials, session secrets, tunnel tokens, and optional PokemonTCG.io/PokemonPriceTracker keys belong only in runtime environment variables.

## Data Sources

- TCGdex: primary card metadata source, no API key required.
- PokemonTCG.io: optional free API key for English-card fallback and higher rate limits.
- PokemonPriceTracker: paid API key and primary source for raw and graded market pricing.
- JustTCG: deprecated; old saved prices remain readable, but the app no longer calls JustTCG.
- PSA Public API: free PSA account/API token required for cert lookup.
- eBay solds: manual research link only; PokemonPriceTracker is the v1 pricing/comps source.
- CGC cert lookup: best-effort public lookup parsing with manual confirmation fallback.

Questionable PokemonPriceTracker matches are saved in the **Price Review** workspace. It compares
the inventory card with each provider alternative across set, card number, variant, language, and
condition. Editors can confirm and pin a match; subsequent manual, queued, and scheduled refreshes
stay on that source card and price variant. Changing pricing identity fields such as the card name,
set, number, language, item type, condition, variant, grader, or grade invalidates the pin and opens
a fresh review. Viewers can inspect reviews but cannot confirm or unpin them.

Scheduled PokemonPriceTracker refreshes are opt-in. Set `ENABLE_SCHEDULED_PRICE_REFRESH=true` only when the API key has enough quota for unattended bulk pricing.

Collection-value history is append-only from schema version 19 onward. A saved point keeps the
value and owned quantity that were true when an inventory or pricing change occurred, so later
quantity edits, overrides, and deletions do not rewrite earlier points. Older market-price history
is reconstructed once during migration and is labeled as an approximate legacy estimate in the UI.

## Transaction Ledger

Use the Transactions workspace to record collection activity. Amounts are totals for the whole transaction, never per-card amounts. Purchase and sale totals plus fees feed the cash-flow summary; assigned trade values stay outside cash flow. Cash-sale realized P&L is shown only when a sale has an explicit allocated cost. Trade-given assigned-value P&L is reported separately for the same reason.

New item transactions default to **Ledger only**. When a row is linked, editors can instead choose **Adjust linked inventory**, review the exact before/after quantity, and confirm the ledger entry and inventory change as one atomic operation. Incoming purchases, trades, and gifts increase quantity; sales, outgoing trades or gifts, and disposals decrease it. A zero remainder removes the inventory row while preserving its transaction snapshot. Failed quantity validation changes neither ledger nor inventory, and editing or deleting a ledger entry never replays or reverses inventory changes.

Viewers can read the ledger, while editors, admins, and owners can add, edit, or delete rows. Ledger rows retain a snapshot of the card name, set, and number if their inventory item is later deleted.

## Needs-Attention Inbox

The **Needs attention** workspace runs read-only checks against the current collection and persisted
pricing queue. It reports missing, stale (30+ days), or possible-confidence prices; missing images;
incomplete identity or grading metadata; normalized duplicate certs; rows matching the app's complete
duplicate identity; and the latest failed or needs-review pricing job for each card. Cards explicitly
ignored for price refresh are omitted from all pricing categories.

Category totals always cover the complete collection. The API returns at most 50 detailed issue
groups per category and 25 item previews per group, marking truncated results without changing
those totals. Viewers may inspect issues and open cards; editors, admins, and owners can also queue
a price refresh. CSV import failure
history is shown as unavailable because there is currently no persisted server-side evidence source.
