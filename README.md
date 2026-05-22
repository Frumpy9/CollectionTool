# Pokemon Collection Tool

A self-hosted collection manager for raw and graded Pokemon cards. The first milestone is a Docker-ready app shell with a React frontend, Fastify API, SQLite migration runner, and a public-repo-safe configuration layout.

## Current Status

Milestone 1 is focused on the working app shell:

- React/Vite web app
- Fastify API with `/health`
- SQLite migration runner
- Local card image uploads stored outside git
- Free card lookup through PokemonTCG.io and TCGdex
- Inventory CSV export/import preview
- SQLite backup-now and scheduled backup flow under `data/backups`
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
