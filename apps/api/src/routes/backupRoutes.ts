import type { FastifyInstance } from "fastify";
import { getAuthContext, getCollectionRole } from "../auth.js";
import { createSqliteBackup } from "../backups.js";
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

    return createSqliteBackup(database);
  });
}
