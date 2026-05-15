import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import Fastify from "fastify";
import type { HealthResponse } from "@collection-tool/shared";
import type { AppConfig } from "./config.js";
import type { AppDatabase } from "./db.js";
import { getAuthContext, listCollectionsForUser } from "./auth.js";
import { registerAuthRoutes } from "./routes/authRoutes.js";

export async function createApp(config: AppConfig, database: AppDatabase) {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info"
    }
  });

  await app.register(cors, {
    origin: config.appUrl,
    credentials: true
  });

  await app.register(cookie, {
    secret: config.sessionSecret
  });

  app.get("/health", async (): Promise<HealthResponse> => ({
    status: "ok",
    service: "api",
    timestamp: new Date().toISOString(),
    database: {
      path: database.path,
      migrationsApplied: database.migrationsApplied
    }
  }));

  await registerAuthRoutes(app, config, database);

  app.get("/api/collections", async (request, reply) => {
    const auth = getAuthContext(request, database);

    if (!auth) {
      reply.code(401);
      return { error: "Unauthorized" };
    }

    return {
      collections: listCollectionsForUser(database, auth.user.id)
    };
  });

  app.addHook("onClose", async () => {
    database.connection.close();
  });

  return app;
}
