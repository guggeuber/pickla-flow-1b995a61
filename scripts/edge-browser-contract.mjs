import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const SRC_ROOT = join(REPO_ROOT, "src");
const FUNCTIONS_ROOT = join(REPO_ROOT, "supabase/functions");

function sourceFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      const stat = statSync(path);
      if (stat.isDirectory()) visit(path);
      else if ([".ts", ".tsx"].includes(extname(name)) && !name.includes(".test.")) files.push(path);
    }
  };
  visit(root);
  return files;
}

export function browserEdgeInventory() {
  const inventory = new Map();
  const remember = (name, method) => {
    if (!inventory.has(name)) inventory.set(name, new Set());
    inventory.get(name).add(method);
  };

  for (const path of sourceFiles(SRC_ROOT)) {
    const source = readFileSync(path, "utf8");
    const apiCall = /\bapi(Get|Post|Patch|Put|Delete)(?:<[^()]{0,4000}>)?\s*\(\s*["']([^"']+)["']/gs;
    for (const match of source.matchAll(apiCall)) remember(match[2], match[1].toUpperCase());
    for (const match of source.matchAll(/functions\.invoke\(\s*["']([^"']+)["']/g)) remember(match[1], "POST");
    for (const match of source.matchAll(/functions\/v1\/([a-z0-9-]+)/g)) remember(match[1], "GET");
  }

  return new Map([...inventory.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export function clientRequestHeaders() {
  const source = readFileSync(join(SRC_ROOT, "lib/api.ts"), "utf8");
  const start = source.indexOf("function buildHeaders(");
  const end = source.indexOf("\nfunction ", start + 1);
  if (start < 0 || end < 0) throw new Error("Unable to locate buildHeaders in src/lib/api.ts");
  const body = source.slice(start, end);
  const headers = new Set(["apikey", "x-client-info"]);
  for (const match of body.matchAll(/headers\[["']([^"']+)["']\]/g)) headers.add(match[1].toLowerCase());
  for (const match of body.matchAll(/headers\.([A-Za-z][A-Za-z0-9]*)/g)) headers.add(match[1].toLowerCase());
  return headers;
}

export function corsAllowedHeaders() {
  const source = readFileSync(join(FUNCTIONS_ROOT, "_shared/cors.ts"), "utf8");
  const match = source.match(/["']Access-Control-Allow-Headers["']\s*:\s*["']([^"']+)["']/);
  if (!match) throw new Error("Unable to read Access-Control-Allow-Headers from _shared/cors.ts");
  return new Set(match[1].split(",").map((header) => header.trim().toLowerCase()).filter(Boolean));
}

export function verifyBrowserEdgeContract() {
  const errors = [];
  const inventory = browserEdgeInventory();
  const requiredHeaders = clientRequestHeaders();
  const allowedHeaders = corsAllowedHeaders();

  for (const header of requiredHeaders) {
    if (!allowedHeaders.has(header)) errors.push(`shared CORS does not allow browser header: ${header}`);
  }

  for (const [name] of inventory) {
    const entrypoint = join(FUNCTIONS_ROOT, name, "index.ts");
    if (!existsSync(entrypoint)) {
      errors.push(`browser calls missing Edge Function directory: ${name}`);
      continue;
    }
    const source = readFileSync(entrypoint, "utf8");
    if (!source.includes("_shared/cors")) errors.push(`${name} does not import the shared CORS contract`);
    if (!/method\s*===\s*["']OPTIONS["']/.test(source)) errors.push(`${name} does not handle OPTIONS`);
  }

  return { errors, inventory, requiredHeaders, allowedHeaders };
}

function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

function localDependencyClosure(entrypoint) {
  const visited = new Set();
  const visit = (path) => {
    const normalized = resolve(path);
    if (visited.has(normalized) || !existsSync(normalized)) return;
    visited.add(normalized);
    const source = readFileSync(normalized, "utf8");
    for (const match of source.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)) {
      const dependency = resolveImport(normalized, match[1]);
      if (dependency && dependency.startsWith(FUNCTIONS_ROOT)) visit(dependency);
    }
  };
  visit(entrypoint);
  return visited;
}

export function affectedBrowserFunctions(changedPaths) {
  const changed = new Set(changedPaths.map((path) => resolve(REPO_ROOT, path)));
  const affected = [];
  for (const [name] of browserEdgeInventory()) {
    const closure = localDependencyClosure(join(FUNCTIONS_ROOT, name, "index.ts"));
    if ([...changed].some((path) => closure.has(path))) affected.push(name);
  }
  return affected.sort();
}

export function gitChangedPaths(base, head = "HEAD") {
  return execFileSync("git", ["diff", "--name-only", `${base}..${head}`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim().split("\n").filter(Boolean);
}
