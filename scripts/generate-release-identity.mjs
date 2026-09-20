import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const outputPath = resolve(repoRoot, "api/_release-identity.generated.json");

function gitOutput(args, fallback) {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim() || fallback;
  } catch {
    return fallback;
  }
}

const sha = (
  process.env.VERCEL_GIT_COMMIT_SHA
  || process.env.GITHUB_SHA
  || process.env.COMMIT_SHA
  || gitOutput(["rev-parse", "HEAD"], "local")
).trim();
const deploymentId = (process.env.VERCEL_DEPLOYMENT_ID || `local-${sha.slice(0, 12)}`).trim();
const deploymentUrl = (process.env.VERCEL_URL || "localhost").trim();
const environment = (process.env.VERCEL_ENV || "development").trim();

let existing = null;
if (existsSync(outputPath)) {
  try {
    existing = JSON.parse(readFileSync(outputPath, "utf8"));
  } catch {
    existing = null;
  }
}

const canReuse = existing
  && existing.sha === sha
  && existing.deployment_id === deploymentId
  && existing.deployment_url === deploymentUrl
  && existing.environment === environment
  && typeof existing.built_at === "string"
  && !Number.isNaN(Date.parse(existing.built_at));

const identity = canReuse ? existing : {
  sha,
  built_at: new Date().toISOString(),
  deployment_id: deploymentId,
  deployment_url: deploymentUrl,
  environment,
};

writeFileSync(outputPath, `${JSON.stringify(identity, null, 2)}\n`, "utf8");
console.info(`[release-identity] ${canReuse ? "reused" : "generated"} ${sha.slice(0, 8)} ${deploymentId}`);
