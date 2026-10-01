import { execFileSync, spawnSync } from "node:child_process";

// Only trusted-main code may call this. The Management API response includes
// credentials; parse it in memory and never log or persist the raw response.
export function isolatedConnection(target, token = process.env.STAGE_SUPABASE_ACCESS_TOKEN) {
  if (target.supabase_ref !== "byuwuoivuuklcwmoesrx") throw new Error("unknown test branch");
  const raw = execFileSync("npx", ["--yes", "supabase@2.113.0", "branches", "get", target.supabase_ref, "--project-ref", target.supabase_parent_ref, "--output", "json"], {
    encoding: "utf8", timeout: 90000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, ...(token ? { SUPABASE_ACCESS_TOKEN: token } : {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const data = JSON.parse(raw);
  const url = new URL(data.POSTGRES_URL_NON_POOLING);
  if (data.SUPABASE_URL !== `https://${target.supabase_ref}.supabase.co` || !data.SUPABASE_JWT_SECRET || !data.SUPABASE_ANON_KEY || !url.hostname.includes(target.supabase_ref)) throw new Error("isolated branch credentials do not match target");
  return { url, jwtSecret: data.SUPABASE_JWT_SECRET, anonKey: data.SUPABASE_ANON_KEY };
}

export function isolatedQuery(connection, sql, readOnly = true) {
  const result = spawnSync("psql", ["-h", connection.url.hostname, "-p", connection.url.port || "5432", "-U", decodeURIComponent(connection.url.username), "-d", connection.url.pathname.slice(1), "-At", "-c", sql], {
    encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024,
    env: { ...process.env, PGPASSWORD: decodeURIComponent(connection.url.password), ...(readOnly ? { PGOPTIONS: "-c default_transaction_read_only=on" } : {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) throw new Error("isolated test branch SQL failed");
  return result.stdout.trim();
}
