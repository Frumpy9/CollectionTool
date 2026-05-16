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
    pokemonTcgApiKey: process.env.POKEMONTCG_API_KEY ?? ""
  };
}
