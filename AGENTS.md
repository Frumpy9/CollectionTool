# AGENTS.md

Guidance for coding agents working on Pokemon Vault.

## Project Shape

Pokemon Vault is a local-first Pokemon/video game collection webapp.

- Monorepo with npm workspaces.
- Frontend: `apps/web`, React + Vite.
- API: `apps/api`, Fastify.
- Shared request/response types: `packages/shared`.
- Local SQLite database: `data/collection.sqlite`.
- Local uploads/backups live under `data/`.

## Safety Rules

This repo is intended to be public-safe.

Never commit:

- `.env` or any secret-bearing env file
- SQLite databases, especially `data/collection.sqlite`
- uploads, backups, sessions, logs, caches, or generated private data
- API tokens, PSA tokens, JustTCG keys, tunnel tokens, or cookies

Before committing, always check:

```bash
git status --short
git diff --check
```

Preferred git author:

```text
Frumpy9 <32330391+Frumpy9@users.noreply.github.com>
```

## Local Development

Install and run:

```bash
npm install
npm run dev
```

The app usually runs at:

- Web: `http://localhost:5173`
- API: `http://localhost:3000`

Dev login:

```text
username: admin
password: admin
```

If needed, seed/reset the dev admin:

```bash
npm run seed:dev-admin --workspace @collection-tool/api
```

If port `3000` is stuck:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
kill <PID>
npm run dev
```

## Verification Commands

Use focused checks while working, then broader checks before a commit:

```bash
npm run typecheck --workspace @collection-tool/api
npm run typecheck --workspace @collection-tool/web
npm run build --workspace @collection-tool/api
npm run build --workspace @collection-tool/web
git diff --check
```

For frontend behavior changes, verify in the browser at `http://localhost:5173`.

## Database And Migrations

Migrations live in `apps/api/src/db.ts`.

Important history:

- Migration id `6` was used by parked pricing work.
- Graded cert metadata moved to migration id `7`.
- Raw market pricing uses migration id `8`.
- `apps/api/src/db.ts` includes self-healing cert metadata column setup for out-of-order local migration history.

Be careful when adding migrations:

- Use a new id.
- Preserve existing local data.
- Do not assume every dev DB has migrations in perfect historical order.
- Never edit or commit the SQLite database file.

## Data Source Notes

### PokemonTCG.io

Used for English card lookup and some safe PSA enrichment.

Plain English searches should behave like normal name searches. For example, `shaymin ex` should return multiple English Shaymin-EX cards, not be parsed as set `shaymin` and card `ex`.

### TCGdex

Used for free English/Japanese card metadata where available.

### Japanese Card Lookup

Japanese lookup uses a mix of:

- TCGdex
- SQLite-backed Japanese cache
- official Pokemon-card.com imports where available
- older product-id fallback for sets such as `CP3`
- Limitless fallback for some Japanese card pages/images

Avoid replacing this with fragile single-source logic.

### PSA Cert Lookup

PSA lookup uses `PSA_ACCESS_TOKEN` and returns cert label metadata.

Do not blindly trust PokemonTCG.io enrichment for PSA slabs. The PSA label is authoritative; PokemonTCG.io enrichment must be conservative. In particular:

- Require a real subject/name token match before using PokemonTCG.io card details.
- Do not match only on generic set-era terms like `Sword & Shield`.
- PSA abbreviations such as `MLTRS/ZPDS/ARTCN.GX` should map to real names before matching.
- Japanese PSA labels may need Japanese fallback images, not English PokemonTCG.io cards.

### JustTCG Raw Pricing

JustTCG is used only for raw-card guide prices.

Rules:

- Never apply JustTCG raw prices to graded cards.
- Manual value override wins over market price.
- Market price wins over purchase price.
- Graded cards should return/receive a friendly raw-pricing unavailable message.

Matching gotchas:

- Search results are paginated; exact cards may be on later pages.
- Score by card name, set, card number, language, condition, and variants.
- Treat `1st Edition` and `Shadowless` as explicit variant signals.
- Do not choose `1st Edition` or `Shadowless` unless the local item is marked that way.
- JustTCG free tier is rate-limited. Avoid bulk refresh without throttling/request budgeting.

## Inventory Behavior

Duplicate detection intentionally includes:

- item type
- language
- name
- set code
- card number
- condition
- variants
- grader/grade/cert number

So regular Fossil Psyduck and `1st Edition` Fossil Psyduck are separate rows. Do not merge variant-distinct cards automatically.

Estimated value precedence:

1. `valueOverrideCents`
2. `marketPriceCents`
3. `purchasePriceCents`
4. `0`

## Frontend Notes

Main files:

- `apps/web/src/App.tsx`
- `apps/web/src/styles.css`
- `apps/web/src/api.ts`

Use existing component/style patterns. Keep operational screens dense and clear; this is a collection tool, not a marketing landing page.

For browser-generated row ids, do not call `crypto.randomUUID()` directly. Use the existing client id helper so older/nonstandard browser contexts keep working.

## API Notes

Main route files:

- `apps/api/src/routes/inventoryRoutes.ts`
- `apps/api/src/routes/pricingRoutes.ts`
- `apps/api/src/routes/psaRoutes.ts`
- `apps/api/src/routes/cardLookupRoutes.ts`

Data-source clients:

- `apps/api/src/cardLookupClient.ts`
- `apps/api/src/psaClient.ts`
- `apps/api/src/justTcgClient.ts`

Keep external API keys server-side. Do not expose JustTCG, PSA, or PokemonTCG.io keys to the frontend.

## Documentation

Useful docs:

- `README.md`
- `docs/implementation-plan.md`
- `docs/backup-restore.md`

When completing a feature, update docs/checklists if the user-facing behavior or operating procedure changed.
