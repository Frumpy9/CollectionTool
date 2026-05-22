import { config as loadDotenv } from "dotenv";

loadDotenv();
loadDotenv({ path: "../../.env", override: false });

export type AppConfig = {
  nodeEnv: string;
  isProduction: boolean;
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
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const isProduction = nodeEnv === "production";
  const appUrl = process.env.APP_URL ?? "http://localhost:5173";
  const sessionSecret = process.env.SESSION_SECRET ?? "dev-only-change-me";
  const port = Number(process.env.PORT ?? 3000);

  validateRuntimeConfig({ appUrl, isProduction, sessionSecret });

  return {
    nodeEnv,
    isProduction,
    appUrl,
    databasePath: process.env.DATABASE_PATH ?? "./data/collection.sqlite",
    host: process.env.HOST ?? "0.0.0.0",
    port,
    sessionSecret,
    cookieSecure: isProduction || appUrl.startsWith("https://"),
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
      12
    ),
    priceRefreshBatchSize: positiveIntegerFromEnv(process.env.PRICE_REFRESH_BATCH_SIZE, 10)
  };
}

function validateRuntimeConfig(input: {
  appUrl: string;
  isProduction: boolean;
  sessionSecret: string;
}) {
  if (!input.isProduction) {
    return;
  }

  let parsedAppUrl: URL;

  try {
    parsedAppUrl = new URL(input.appUrl);
  } catch {
    throw new Error("APP_URL must be a valid HTTPS URL in production.");
  }

  if (parsedAppUrl.protocol !== "https:") {
    throw new Error("APP_URL must use https:// in production.");
  }

  if (["localhost", "127.0.0.1", "0.0.0.0"].includes(parsedAppUrl.hostname)) {
    throw new Error("APP_URL must be your public HTTPS domain in production.");
  }

  if (parsedAppUrl.hostname === "your-domain.example") {
    throw new Error("APP_URL must be changed from the example domain in production.");
  }

  const defaultSecrets = new Set([
    "dev-only-change-me",
    "change-me-to-a-long-random-secret",
    "replace-with-a-long-random-secret-at-least-32-chars"
  ]);

  if (defaultSecrets.has(input.sessionSecret) || input.sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters and non-default in production.");
  }
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
