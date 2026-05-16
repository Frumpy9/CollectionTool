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
docker compose up --build
```

The SQLite database is stored in the `collection-data` Docker volume at `/data/collection.sqlite`.
Uploaded card images are stored in the same volume under `/data/uploads`.

## Backups And Restore

Use the in-app backup button before large imports or cleanup sessions. Local backups are written under `data/backups`; Docker backups are written under `/data/backups`.

Restore steps are documented in [docs/backup-restore.md](docs/backup-restore.md).

## Secrets

Do not commit `.env`, database files, cached images, backups, sessions, or logs. PSA credentials, session secrets, tunnel tokens, and optional PokemonTCG.io keys belong only in runtime environment variables.

## Data Sources

- TCGdex: primary card metadata source, no API key required.
- PokemonTCG.io: optional free API key for English-card fallback and higher rate limits.
- PSA Public API: free PSA account/API token required for cert lookup.
- eBay sold comps: best-effort personal-use sold-search parsing because official sold-history API access is limited/restricted.
- CGC cert lookup: best-effort public lookup parsing with manual confirmation fallback.
