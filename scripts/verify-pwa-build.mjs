import { existsSync, readFileSync, readdirSync } from "node:fs";
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

const manifestFiles = ["manifest.webmanifest", "manifest-desk.webmanifest", "manifest-admin.webmanifest"];
const manifests = manifestFiles.map((file) => JSON.parse(readFileSync(resolve(distDir, file), "utf8")));
const expectedIdentities = [
  { id: "/", name: "Pickla", short_name: "Pickla", start_url: "/" },
  { id: "/desk", name: "Pickla Desk", short_name: "Desk", start_url: "/desk" },
  { id: "/hub/admin", name: "Pickla Admin", short_name: "Admin", start_url: "/hub/admin" },
];
if (new Set(manifests.map((manifest) => manifest.id)).size !== manifests.length) {
  fail("multi-surface manifest ids are not unique");
}
manifests.forEach((manifest, index) => {
  const expected = expectedIdentities[index];
  for (const field of ["id", "name", "short_name", "start_url"]) {
    if (manifest[field] !== expected[field]) fail(`${manifestFiles[index]} has invalid ${field}`);
  }
  if (manifest.scope !== "/" || manifest.display !== "standalone") {
    fail(`${manifestFiles[index]} has invalid standalone scope`);
  }
  for (const icon of manifest.icons || []) {
    const iconPath = resolve(distDir, icon.src.replace(/^\//, ""));
    if (!existsSync(iconPath)) fail(`${manifestFiles[index]} references missing ${icon.src}`);
    const bytes = readFileSync(iconPath);
    if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
      fail(`${icon.src} is not a PNG`);
    }
    const [width, height] = icon.sizes.split("x").map(Number);
    if (bytes.readUInt32BE(16) !== width || bytes.readUInt32BE(20) !== height) {
      fail(`${icon.src} dimensions do not match its manifest`);
    }
  }
});
for (const asset of [
  "apple-touch-icon-customer-180x180.png",
  "apple-touch-icon-desk-180x180.png",
  "apple-touch-icon-admin-180x180.png",
]) {
  const assetPath = resolve(distDir, asset);
  if (!existsSync(assetPath)) fail(`${asset} is missing`);
  const bytes = readFileSync(assetPath);
  if (bytes.readUInt32BE(16) !== 180 || bytes.readUInt32BE(20) !== 180) {
    fail(`${asset} is not a valid 180x180 Apple touch icon`);
  }
}
for (const token of [
  "pickla-pwa-surface-bootstrap",
  "/manifest.webmanifest",
  "/manifest-desk.webmanifest",
  "/manifest-admin.webmanifest",
]) {
  if (!html.includes(token)) fail(`index.html is missing ${token}`);
}

const vercel = JSON.parse(readFileSync(resolve("vercel.json"), "utf8"));
const cacheHeader = (source) => vercel.headers
  .find((entry) => entry.source === source)?.headers
  .find((header) => header.key.toLowerCase() === "cache-control")?.value;
if (!cacheHeader("/sw.js")?.includes("no-store")) fail("sw.js is not no-store");
if (!cacheHeader("/version.json")?.includes("no-store")) fail("version.json is not no-store");
if (!cacheHeader("/manifest.webmanifest")?.includes("must-revalidate")) fail("manifest is not revalidated");
if (!cacheHeader("/manifest-desk.webmanifest")?.includes("must-revalidate")) fail("Desk manifest is not revalidated");
if (!cacheHeader("/manifest-admin.webmanifest")?.includes("must-revalidate")) fail("Admin manifest is not revalidated");
if (cacheHeader("/assets/(.*)") !== "public, max-age=31536000, immutable") {
  fail("hashed assets are not immutable");
}
const spaDocumentHeader = vercel.headers.find((entry) =>
  entry.source === "/((?!pickleball-stockholm$|.*\\.[^/]+$).*)"
);
if (!spaDocumentHeader?.headers
  .find((header) => header.key.toLowerCase() === "cache-control")?.value
  .includes("no-store")) {
  fail("extensionless SPA documents are not no-store");
}

console.info(`[pwa-build] verified ${version.sha.slice(0, 8)} ${version.built_at} ${mainAssetName}`);
