import { config as loadDotenv } from "dotenv";

loadDotenv();
loadDotenv({ path: "../../.env", override: false });

export type AppConfig = {
  appUrl: string;
  databasePath: string;
  host: string;
  port: number;
  sessionSecret: string;
  cookieSecure: boolean;
  psaAccessToken: string;
  pokemonTcgApiKey: string;
  pokemonPriceTrackerApiKey: string;
  uploadsPath: string;
  maxImageUploadBytes: number;
  scheduledBackupsEnabled: boolean;
  backupIntervalHours: number;
  backupRetentionDays: number;
  scheduledPriceRefreshEnabled: boolean;
  priceRefreshIntervalHours: number;
  priceRefreshBatchSize: number;
};

export function loadConfig(): AppConfig {
  return {
    appUrl: process.env.APP_URL ?? "http://localhost:5173",
    databasePath: process.env.DATABASE_PATH ?? "./data/collection.sqlite",
    host: process.env.HOST ?? "0.0.0.0",
    port: Number(process.env.PORT ?? 3000),
    sessionSecret: process.env.SESSION_SECRET ?? "dev-only-change-me",
    cookieSecure: (process.env.APP_URL ?? "").startsWith("https://"),
    psaAccessToken: process.env.PSA_ACCESS_TOKEN ?? "",
    pokemonTcgApiKey: process.env.POKEMONTCG_API_KEY ?? "",
    pokemonPriceTrackerApiKey: process.env.POKEMON_PRICE_TRACKER_API_KEY ?? "",
    uploadsPath: process.env.UPLOADS_PATH ?? "./data/uploads",
    maxImageUploadBytes: positiveIntegerFromEnv(
      process.env.MAX_IMAGE_UPLOAD_BYTES,
      6 * 1024 * 1024
    ),
    scheduledBackupsEnabled: booleanFromEnv(process.env.ENABLE_SCHEDULED_BACKUPS, true),
    backupIntervalHours: positiveIntegerFromEnv(process.env.BACKUP_INTERVAL_HOURS, 24),
    backupRetentionDays: positiveIntegerFromEnv(process.env.BACKUP_RETENTION_DAYS, 30),
    scheduledPriceRefreshEnabled: booleanFromEnv(
      process.env.ENABLE_SCHEDULED_PRICE_REFRESH,
      Boolean(process.env.POKEMON_PRICE_TRACKER_API_KEY?.trim())
    ),
    priceRefreshIntervalHours: positiveIntegerFromEnv(
      process.env.PRICE_REFRESH_INTERVAL_HOURS,
      24
    ),
    priceRefreshBatchSize: positiveIntegerFromEnv(process.env.PRICE_REFRESH_BATCH_SIZE, 10)
  };
}

function positiveIntegerFromEnv(value: string | undefined, fallback: number) {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function booleanFromEnv(value: string | undefined, fallback: boolean) {
  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}
