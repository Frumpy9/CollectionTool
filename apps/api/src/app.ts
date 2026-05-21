import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import Fastify from "fastify";
import type { HealthResponse } from "@collection-tool/shared";
import { startScheduledSqliteBackups } from "./backups.js";
import type { AppConfig } from "./config.js";
import type { AppDatabase } from "./db.js";
import { registerAdminRoutes } from "./routes/adminRoutes.js";
import { registerAuthRoutes } from "./routes/authRoutes.js";
import { registerBackupRoutes } from "./routes/backupRoutes.js";
import { registerCardLookupRoutes } from "./routes/cardLookupRoutes.js";
import { registerCollectionRoutes } from "./routes/collectionRoutes.js";
import { registerInventoryRoutes } from "./routes/inventoryRoutes.js";
import { registerPricingRoutes, startBulkPriceQueueRunner } from "./routes/pricingRoutes.js";
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

  await registerAdminRoutes(app, config, database);
  await registerAuthRoutes(app, config, database);
  await registerBackupRoutes(app, database);
  await registerCardLookupRoutes(app, config, database);
  await registerCollectionRoutes(app, database);
  await registerInventoryRoutes(app, config, database);
  await registerPricingRoutes(app, config, database);
  await registerPsaRoutes(app, config, database);
  await registerUploadRoutes(app, config, database);
  startScheduledSqliteBackups(app, database, config);
  startBulkPriceQueueRunner(app, config, database);

  app.addHook("onClose", async () => {
    database.connection.close();
  });

  return app;
}
