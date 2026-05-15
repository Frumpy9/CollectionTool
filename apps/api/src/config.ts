import "dotenv/config";

export type AppConfig = {
  appUrl: string;
  databasePath: string;
  host: string;
  port: number;
};

export function loadConfig(): AppConfig {
  return {
    appUrl: process.env.APP_URL ?? "http://localhost:5173",
    databasePath: process.env.DATABASE_PATH ?? "./data/collection.sqlite",
    host: process.env.HOST ?? "0.0.0.0",
    port: Number(process.env.PORT ?? 3000)
  };
}

