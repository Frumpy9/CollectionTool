import cors from "@fastify/cors";
import Fastify from "fastify";
import type { HealthResponse } from "@collection-tool/shared";
import type { AppConfig } from "./config.js";
import type { AppDatabase } from "./db.js";

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

  app.get("/health", async (): Promise<HealthResponse> => ({
    status: "ok",
    service: "api",
    timestamp: new Date().toISOString(),
    database: {
      path: database.path,
      migrationsApplied: database.migrationsApplied
    }
  }));

  app.get("/api/collections", async () => ({
    collections: []
  }));

  app.addHook("onClose", async () => {
    database.connection.close();
  });

  return app;
}

