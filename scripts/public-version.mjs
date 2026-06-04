import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "apps/web/package.json"), "utf8"));

process.stdout.write(publicAppVersion(packageJson.version));

function publicAppVersion(baseVersion) {
  const [major = "0", minor = "0"] = String(baseVersion).split(".");
  const buildNumber = gitCommitCount();

  return buildNumber ? `${major}.${minor}.${buildNumber}` : String(baseVersion);
}

function gitCommitCount() {
  try {
    return execSync("git rev-list --count HEAD", {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}
