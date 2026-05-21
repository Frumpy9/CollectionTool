# Backup And Restore

Pokemon Vault stores collection data in SQLite. The backup button creates a consistent SQLite copy with `VACUUM INTO`, so use those files instead of copying the live database while the API is running.

## Backup Locations

Local development:

```bash
data/backups/
```

Docker deployment:

```bash
/data/backups/
```

Backup files are named like:

```text
collection-2026-05-16T20-48-57-123Z.sqlite
```

## Create A Backup

In the app, sign in as a system admin or collection owner/admin, open the Admin workspace, and click **Back up now** in Maintenance. The API writes a new `.sqlite` file under the backups directory.

You can also export inventory as CSV from the Data workspace. CSV exports are useful for spreadsheet review and manual import, but the SQLite backup is the full restore point.

## Scheduled Backups

The API also checks for scheduled backups while it is running. By default it creates one SQLite backup every 24 hours and prunes backups older than 30 days.

Configure this with environment variables:

```bash
ENABLE_SCHEDULED_BACKUPS=true
BACKUP_INTERVAL_HOURS=24
BACKUP_RETENTION_DAYS=30
```

Set `ENABLE_SCHEDULED_BACKUPS=false` to turn the scheduler off.

## Restore Locally

1. Stop the dev server.
2. Pick the backup file you want from `data/backups/`.
3. Keep a copy of the current database before replacing it:

```bash
cp data/collection.sqlite data/collection.before-restore.sqlite
```

4. Replace the active database:

```bash
cp data/backups/collection-YYYY-MM-DDTHH-MM-SSZ.sqlite data/collection.sqlite
```

5. Restart the app:

```bash
npm run dev
```

## Restore In Docker

1. Stop the app container:

```bash
docker compose down
```

2. Back up the current database inside the persistent volume before replacing it.
3. Copy the selected backup over `/data/collection.sqlite` in the volume.
4. Start the app again:

```bash
docker compose up -d
```

Exact Docker volume copy commands depend on the host and volume name. Confirm the volume mount before running destructive copy commands.

## Safety Notes

- Never commit `data/collection.sqlite`, `data/backups/`, uploads, sessions, logs, `.env`, or API tokens.
- Restore only while the API is stopped.
- If a restored database is older, newer cards, uploads, or cert metadata entered after that backup will not be present.
- CSV import is for inventory rows only. Use SQLite backups for full app recovery.
