import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BackupSqliteResponse } from "@collection-tool/shared";
import type { FastifyInstance } from "fastify";
import { getAuthContext, getCollectionRole } from "../auth.js";
import type { AppDatabase } from "../db.js";

export async function registerBackupRoutes(app: FastifyInstance, database: AppDatabase) {
  app.post("/api/collections/:collectionId/backups/sqlite", async (request, reply) => {
    const auth = getAuthContext(request, database);

    if (!auth) {
      reply.code(401);
      return { error: "Unauthorized" };
    }

    const { collectionId } = request.params as { collectionId: string };
    const role = getCollectionRole(database, collectionId, auth.user.id);

    if (!role || !["owner", "admin"].includes(role)) {
      reply.code(403);
      return { error: "You need admin access to back up the collection database." };
    }

    const createdAt = new Date();
    const fileName = `collection-${timestampForFileName(createdAt)}.sqlite`;
    const backupDirectory = join(dirname(database.path), "backups");
    const backupPath = join(backupDirectory, fileName);

    mkdirSync(backupDirectory, { recursive: true });
    database.connection.exec(`VACUUM main INTO ${toSqlLiteral(backupPath)}`);

    const response: BackupSqliteResponse = {
      ok: true,
      fileName,
      path: backupPath,
      sizeBytes: statSync(backupPath).size,
      createdAt: createdAt.toISOString()
    };

    return response;
  });
}

function timestampForFileName(date: Date) {
  return date.toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
}

function toSqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}
