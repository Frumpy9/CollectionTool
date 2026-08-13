import type { FastifyInstance } from "fastify";
import { getAuthContext } from "../auth.js";
import { createSqliteBackup } from "../backups.js";
import type { AppDatabase } from "../db.js";

export async function registerBackupRoutes(app: FastifyInstance, database: AppDatabase) {
  app.post("/api/admin/backups/sqlite", async (request, reply) => {
    const auth = getAuthContext(request, database);

    if (!auth) {
      reply.code(401);
      return { error: "Unauthorized" };
    }

    if (auth.user.systemRole !== "admin") {
      reply.code(403);
      return { error: "System administrator access is required to back up the database." };
    }

    return createSqliteBackup(database);
  });
}
