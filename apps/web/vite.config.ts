import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import packageJson from "./package.json";

const appVersion = process.env.APP_VERSION?.trim() || publicAppVersion(packageJson.version);

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion)
  },
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/health": "http://localhost:3000",
      "/api": "http://localhost:3000",
      "/uploads": "http://localhost:3000"
    }
  }
});

function publicAppVersion(baseVersion: string) {
  const [major = "0", minor = "0"] = baseVersion.split(".");
  const buildNumber = gitCommitCount();

  return buildNumber ? `${major}.${minor}.${buildNumber}` : baseVersion;
}

function gitCommitCount() {
  try {
    return execSync("git rev-list --count HEAD", {
      cwd: new URL("../..", import.meta.url),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}
