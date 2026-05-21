import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AdminBackupSummary, BackupSqliteResponse } from "@collection-tool/shared";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
import type { AppDatabase } from "./db.js";

const hoursToMs = 60 * 60 * 1000;
const daysToMs = 24 * hoursToMs;

export function createSqliteBackup(
  database: AppDatabase,
  createdAt = new Date()
): BackupSqliteResponse {
  const fileName = `collection-${timestampForFileName(createdAt)}.sqlite`;
  const backupDirectory = backupDirectoryForDatabase(database);
  const backupPath = join(backupDirectory, fileName);

  mkdirSync(backupDirectory, { recursive: true });
  database.connection.exec(`VACUUM main INTO ${toSqlLiteral(backupPath)}`);

  return {
    ok: true,
    fileName,
    path: backupPath,
    sizeBytes: statSync(backupPath).size,
    createdAt: createdAt.toISOString()
  };
}

export function pruneOldSqliteBackups(
  database: AppDatabase,
  retentionDays: number,
  now = new Date()
) {
  const backupDirectory = backupDirectoryForDatabase(database);

  if (!existsSync(backupDirectory)) {
    return 0;
  }

  const cutoff = now.getTime() - retentionDays * daysToMs;
  let removed = 0;

  for (const fileName of readdirSync(backupDirectory)) {
    if (!isBackupFileName(fileName)) {
      continue;
    }

    const backupPath = join(backupDirectory, fileName);

    if (statSync(backupPath).mtime.getTime() >= cutoff) {
      continue;
    }

    rmSync(backupPath);
    removed += 1;
  }

  return removed;
}

export function listSqliteBackups(
  database: AppDatabase,
  limit = 5
): AdminBackupSummary[] {
  const backupDirectory = backupDirectoryForDatabase(database);

  if (!existsSync(backupDirectory)) {
    return [];
  }

  return readdirSync(backupDirectory)
    .filter(isBackupFileName)
    .map((fileName) => {
      const backupPath = join(backupDirectory, fileName);
      const stat = statSync(backupPath);

      return {
        fileName,
        path: backupPath,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString()
      };
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
}

export function startScheduledSqliteBackups(
  app: FastifyInstance,
  database: AppDatabase,
  config: AppConfig
) {
  if (!config.scheduledBackupsEnabled) {
    app.log.info("Scheduled SQLite backups are disabled.");
    return;
  }

  const backupIntervalMs = config.backupIntervalHours * hoursToMs;
  const runBackupIfDue = () => {
    const now = new Date();
    const latestBackupAt = latestBackupTime(database);

    if (latestBackupAt && now.getTime() - latestBackupAt.getTime() < backupIntervalMs) {
      return;
    }

    const backup = createSqliteBackup(database, now);
    const removed = pruneOldSqliteBackups(database, config.backupRetentionDays, now);

    app.log.info(
      {
        backupPath: backup.path,
        removedBackups: removed
      },
      "Scheduled SQLite backup completed."
    );
  };

  try {
    runBackupIfDue();
  } catch (error) {
    app.log.error({ error }, "Scheduled SQLite backup failed.");
  }

  const interval = setInterval(() => {
    try {
      runBackupIfDue();
    } catch (error) {
      app.log.error({ error }, "Scheduled SQLite backup failed.");
    }
  }, backupIntervalMs);

  interval.unref();

  app.addHook("onClose", async () => {
    clearInterval(interval);
  });
}

function backupDirectoryForDatabase(database: AppDatabase) {
  return join(dirname(database.path), "backups");
}

function latestBackupTime(database: AppDatabase) {
  const backupDirectory = backupDirectoryForDatabase(database);

  if (!existsSync(backupDirectory)) {
    return null;
  }

  return readdirSync(backupDirectory)
    .filter(isBackupFileName)
    .map((fileName) => statSync(join(backupDirectory, fileName)).mtime)
    .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
}

function timestampForFileName(date: Date) {
  return date.toISOString().replaceAll(":", "-").replace(".", "-");
}

function isBackupFileName(fileName: string) {
  return /^collection-\d{4}-\d{2}-\d{2}T.+Z\.sqlite$/.test(fileName);
}

function toSqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}
