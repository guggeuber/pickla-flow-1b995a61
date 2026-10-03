import { spawnSync } from "node:child_process";

const branchRef = "byuwuoivuuklcwmoesrx";
const parentRef = "ptnvhbniiiapzbyofctg";
const branchId = "4aec1694-5d7d-4691-9228-a03c156371bc";

export function selectIsolatedSessionPooler(data, target) {
  if (target.supabase_ref !== branchRef || target.supabase_parent_ref !== parentRef || target.supabase_branch_id !== branchId ||
      data.SUPABASE_URL !== `https://${branchRef}.supabase.co` || !data.SUPABASE_JWT_SECRET || !data.SUPABASE_ANON_KEY) {
    throw new Error("isolated branch identity unavailable");
  }
  const direct = new URL(data.POSTGRES_URL_NON_POOLING);
  const pooler = new URL(data.POSTGRES_URL);
  if (!["postgres:", "postgresql:"].includes(direct.protocol) || direct.hostname !== `db.${branchRef}.supabase.co` ||
      decodeURIComponent(direct.username) !== "postgres" || !direct.password || direct.pathname !== "/postgres" ||
      !["postgres:", "postgresql:"].includes(pooler.protocol) || !/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(pooler.hostname) ||
      decodeURIComponent(pooler.username) !== `postgres.${branchRef}` || !["5432", "6543"].includes(pooler.port) ||
      pooler.pathname !== "/postgres" || decodeURIComponent(pooler.password) !== decodeURIComponent(direct.password) ||
      pooler.search || pooler.hash) throw new Error("isolated session pooler identity unavailable");
  // The control-plane pooler host and branch-qualified user are authoritative.
  // Port 5432 on that host is Supavisor session mode, including when the
  // control plane's generic pooled URL points at transaction mode on 6543.
  pooler.port = "5432";
  return { url: pooler, jwtSecret: data.SUPABASE_JWT_SECRET, anonKey: data.SUPABASE_ANON_KEY };
}

export function classifyPsqlFailure(result) {
  const message = String(result.stderr || result.error?.message || "").toLowerCase();
  if (/password authentication failed|authentication failed|no password supplied|tenant or user not found|role .* does not exist|no pg_hba.conf entry/.test(message)) return "auth";
  if (/could not translate host name|name or service not known|temporary failure in name resolution|enotfound|nodename nor servname/.test(message)) return "dns";
  if (/network is unreachable|no route to host|connection refused|could not connect to server|timeout|timed out|econnrefused|enetunreach|etimedout/.test(message) || result.signal === "SIGTERM") return "network";
  if (/database .* does not exist|permission denied|relation .* does not exist|syntax error|^error:|\nerror:|fatal:/.test(message)) return "database";
  if (result.error?.code === "ENOENT") return "psql_unavailable";
  return "unknown";
}

// Only trusted-main code may call this. The Management API response includes
// credentials; parse it in memory and never log or persist the raw response.
export function isolatedConnection(target, token = process.env.STAGE_SUPABASE_ACCESS_TOKEN) {
  if (target.supabase_ref !== branchRef || target.supabase_parent_ref !== parentRef || target.supabase_branch_id !== branchId) throw new Error("unknown test branch");
  const result = spawnSync("npx", ["--yes", "supabase@2.113.0", "branches", "get", branchRef, "--project-ref", parentRef, "--output", "json"], {
    encoding: "utf8", timeout: 90000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, ...(token ? { SUPABASE_ACCESS_TOKEN: token } : {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) throw new Error("isolated branch control-plane lookup failed");
  return selectIsolatedSessionPooler(JSON.parse(result.stdout), target);
}

export function isolatedQuery(connection, sql, readOnly = true) {
  const result = spawnSync("psql", ["-X", "-w", "-h", connection.url.hostname, "-p", connection.url.port, "-U", decodeURIComponent(connection.url.username), "-d", connection.url.pathname.slice(1), "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024,
    env: { ...process.env, PGPASSWORD: decodeURIComponent(connection.url.password), PGCONNECT_TIMEOUT: "10", ...(readOnly ? { PGOPTIONS: "-c default_transaction_read_only=on" } : {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) throw new Error(`isolated test branch SQL failed: ${classifyPsqlFailure(result)}`);
  return result.stdout.trim();
}
