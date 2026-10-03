import { spawnSync } from "node:child_process";

// The pinned Supabase CLI's `branches get <20-character-ref> --output json`
// reads exactly these three Management API routes. Check them independently so
// a scoped-token rotation reveals all denied routes in one read-only run.
const parentRef = "ptnvhbniiiapzbyofctg";
const branchRef = "byuwuoivuuklcwmoesrx";
const routes = [
  ["branch_config", `/v1/branches/${branchRef}`],
  ["branch_api_keys", `/v1/projects/${branchRef}/api-keys`],
  ["branch_pooler", `/v1/projects/${branchRef}/config/database/pooler`],
];
const token = process.env.STAGE_SUPABASE_ACCESS_TOKEN;
if (!token) throw new Error("STAGE_SUPABASE_ACCESS_TOKEN unavailable");

const results = await Promise.all(routes.map(async ([name, path]) => {
  try {
    const response = await fetch(`https://api.supabase.com${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    if (response.ok) {
      await response.body?.cancel(); // successful bodies can contain credentials
      return { route: name, status: response.status, result: "PASS", missing_permissions: [] };
    }
    const error = (await response.text()).slice(0, 4096);
    const permissions = new Set();
    const match = error.match(/Missing required permission\(s\):\s*([a-z_,\s]+)/i);
    if (match) for (const permission of match[1].split(/[\s,]+/)) {
      if (/^[a-z][a-z0-9_]*$/.test(permission)) permissions.add(permission);
    }
    return { route: name, status: response.status, result: "BLOCKED", missing_permissions: [...permissions].sort() };
  } catch {
    return { route: name, status: null, result: "BLOCKED", missing_permissions: [], reason: "network_or_timeout" };
  }
}));

const missing = [...new Set(results.flatMap((result) => result.missing_permissions))].sort();
let cli = "SKIPPED";
if (results.every((result) => result.result === "PASS")) {
  const run = spawnSync("npx", ["--yes", "supabase@2.113.0", "branches", "get", branchRef,
    "--project-ref", parentRef, "--output", "json"], {
    encoding: "utf8", timeout: 90000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (run.status === 0) {
    try {
      const data = JSON.parse(run.stdout);
      const url = new URL(data.POSTGRES_URL_NON_POOLING);
      cli = data.SUPABASE_URL === `https://${branchRef}.supabase.co` &&
        url.hostname.includes(branchRef) && Boolean(data.SUPABASE_JWT_SECRET && data.SUPABASE_ANON_KEY)
        ? "PASS" : "BLOCKED_IDENTITY";
    } catch { cli = "BLOCKED_RESPONSE"; }
  } else cli = "BLOCKED_CLI";
}
console.log(JSON.stringify({
  check: "supabase_branches_get_read_only_v1", branch_ref: branchRef,
  routes: results, missing_permissions: missing, cli,
}));
if (results.some((result) => result.result !== "PASS") || cli !== "PASS") process.exitCode = 1;
