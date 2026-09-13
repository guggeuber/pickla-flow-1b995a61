import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
  throw new Error(`[pwa-build] ${message}`);
}

const distDir = resolve("dist");
const version = JSON.parse(readFileSync(resolve(distDir, "version.json"), "utf8"));
if (typeof version.sha !== "string" || !/^(local|[0-9a-f]{7,64})$/i.test(version.sha)) {
  fail("version.json has no valid Git SHA");
}
if (typeof version.built_at !== "string" || Number.isNaN(Date.parse(version.built_at))) {
  fail("version.json has no valid UTC build timestamp");
}

const assetNames = readdirSync(resolve(distDir, "assets"));
const mainAssetName = assetNames.find((name) => /^main-[\w-]+\.js$/.test(name));
if (!mainAssetName) fail("hashed main asset is missing");

const mainAsset = readFileSync(resolve(distDir, "assets", mainAssetName), "utf8");
const worker = readFileSync(resolve(distDir, "sw.js"), "utf8");
const html = readFileSync(resolve(distDir, "index.html"), "utf8");
for (const [label, source] of [["main asset", mainAsset], ["service worker", worker]]) {
  if (!source.includes(version.sha) || !source.includes(version.built_at)) {
    fail(`${label} does not contain the version.json identity`);
  }
}
if (!html.includes(`/assets/${mainAssetName}`)) fail("index.html does not reference the hashed main asset");
if (/(?:"url"|url):\s*["']\/?(?:index\.html|version\.json)["']/.test(worker)) {
  fail("HTML or version.json must not be in the service-worker precache");
}
for (const contractToken of ["PICKLA_VERSION_ACTIVATED", "PICKLA_VERSION_CLIENT_ACK", "PICKLA_GET_BUILD"]) {
  if (!worker.includes(contractToken)) fail(`service worker is missing ${contractToken}`);
}

const vercel = JSON.parse(readFileSync(resolve("vercel.json"), "utf8"));
const cacheHeader = (source) => vercel.headers
  .find((entry) => entry.source === source)?.headers
  .find((header) => header.key.toLowerCase() === "cache-control")?.value;
if (!cacheHeader("/sw.js")?.includes("no-store")) fail("sw.js is not no-store");
if (!cacheHeader("/version.json")?.includes("no-store")) fail("version.json is not no-store");
if (!cacheHeader("/manifest.webmanifest")?.includes("must-revalidate")) fail("manifest is not revalidated");
if (cacheHeader("/assets/(.*)") !== "public, max-age=31536000, immutable") {
  fail("hashed assets are not immutable");
}
if (!cacheHeader("/((?!.*\\.[^/]+$).*)")?.includes("no-store")) {
  fail("extensionless SPA documents are not no-store");
}

console.info(`[pwa-build] verified ${version.sha.slice(0, 8)} ${version.built_at} ${mainAssetName}`);
