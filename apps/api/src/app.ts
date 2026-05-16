import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import Fastify from "fastify";
import type { HealthResponse } from "@collection-tool/shared";
import type { AppConfig } from "./config.js";
import type { AppDatabase } from "./db.js";
import { registerAuthRoutes } from "./routes/authRoutes.js";
import { registerBackupRoutes } from "./routes/backupRoutes.js";
import { registerCardLookupRoutes } from "./routes/cardLookupRoutes.js";
import { registerCollectionRoutes } from "./routes/collectionRoutes.js";
import { registerInventoryRoutes } from "./routes/inventoryRoutes.js";
import { registerPsaRoutes } from "./routes/psaRoutes.js";
import { registerUploadRoutes } from "./routes/uploadRoutes.js";

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
  await registerBackupRoutes(app, database);
  await registerCardLookupRoutes(app, config, database);
  await registerCollectionRoutes(app, database);
  await registerInventoryRoutes(app, database);
  await registerPsaRoutes(app, config, database);
  await registerUploadRoutes(app, config, database);

  app.addHook("onClose", async () => {
    database.connection.close();
  });

  return app;
}
