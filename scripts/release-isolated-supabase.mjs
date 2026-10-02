import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

function managementEnv(token) {
  const env = { ...process.env, ...(token ? { SUPABASE_ACCESS_TOKEN: token } : {}) };
  delete env.STRIPE_TEST_SECRET_KEY;
  delete env.STRIPE_TEST_WEBHOOK_SECRET;
  delete env.STAGE_VERCEL_TOKEN;
  return env;
}

export function verifyIsolatedBranch(target, token = process.env.STAGE_SUPABASE_ACCESS_TOKEN) {
  const output = execFileSync("npx", ["--yes", "supabase@2.113.0", "branches", "list", "--project-ref", target.supabase_parent_ref, "--output", "json"], {
    encoding: "utf8", timeout: 90000, maxBuffer: 4 * 1024 * 1024,
    env: managementEnv(token),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const branches = JSON.parse(output);
  const matches = branches.filter((branch) => branch.project_ref === target.supabase_ref);
  if (matches.length !== 1) throw new Error("isolated Supabase branch unavailable");
  const branch = matches[0];
  if (branch.id !== target.supabase_branch_id || branch.parent_project_ref !== target.supabase_parent_ref || branch.preview_project_status !== "ACTIVE_HEALTHY" || branch.with_data !== false || branch.persistent !== true) throw new Error("isolated Supabase branch identity or health changed");
  // MIGRATIONS_FAILED is a workflow state, not proof that the schema is absent.
  // Deployed behavior and the ledger are separate gates.
  return { ref: branch.project_ref, branch_id: branch.id, parent_ref: branch.parent_project_ref, status: branch.status, preview_project_status: branch.preview_project_status, with_data: branch.with_data, persistent: branch.persistent };
}

export function isolatedFunctionVersions(target, token = process.env.STAGE_SUPABASE_ACCESS_TOKEN) {
  if (target.supabase_ref !== "byuwuoivuuklcwmoesrx") throw new Error("unapproved Edge version target");
  const raw = execFileSync("npx", ["--yes", "supabase@2.113.0", "functions", "list", "--project-ref", target.supabase_ref, "--output", "json"], {
    encoding: "utf8", timeout: 90000, maxBuffer: 4 * 1024 * 1024,
    env: managementEnv(token), stdio: ["ignore", "pipe", "pipe"],
  });
  const functions = JSON.parse(raw);
  const required = ["api-admin", "api-bookings", "api-event-public", "api-memberships", "api-stripe-webhook"];
  return Object.fromEntries(required.map((name) => {
    const matches = functions.filter((value) => value.slug === name && value.status === "ACTIVE" && Number.isInteger(value.version));
    if (matches.length !== 1) throw new Error(`isolated Edge identity unavailable: ${name}`);
    return [name, matches[0].version];
  }));
}

export function configureIsolatedCheckoutOrigin(target, deploymentUrl, token = process.env.STAGE_SUPABASE_ACCESS_TOKEN) {
  if (target.supabase_ref !== "byuwuoivuuklcwmoesrx" || !deploymentUrl?.endsWith(".vercel.app") || target.forbidden_domains.some((domain) => deploymentUrl === domain || deploymentUrl.endsWith(`.${domain}`))) throw new Error("checkout origin is not an allowlisted isolated Preview");
  const origin = `https://${deploymentUrl}`;
  const env = managementEnv(token);
  // The values written here are public routing facts. The isolated branch's
  // Stripe TEST key remains managed separately by Supabase Secrets.
  execFileSync("npx", ["--yes", "supabase@2.113.0", "secrets", "set", "PICKLA_ENVIRONMENT=stage", `PUBLIC_SITE_URL=${origin}`, "--project-ref", target.supabase_ref], {
    encoding: "utf8", timeout: 90000, env, stdio: "ignore",
  });
  const raw = execFileSync("npx", ["--yes", "supabase@2.113.0", "secrets", "list", "--project-ref", target.supabase_ref, "--output", "json"], {
    encoding: "utf8", timeout: 90000, env, stdio: ["ignore", "pipe", "pipe"],
  });
  const hashes = Object.fromEntries(JSON.parse(raw).filter((item) => ["PICKLA_ENVIRONMENT", "PUBLIC_SITE_URL"].includes(item.name)).map((item) => [item.name, item.value]));
  const sha256 = (value) => createHash("sha256").update(value).digest("hex");
  if (hashes.PICKLA_ENVIRONMENT !== sha256("stage") || hashes.PUBLIC_SITE_URL !== sha256(origin)) throw new Error("isolated checkout origin did not persist");
  return { supabase_ref: target.supabase_ref, checkout_origin: origin, verified: true };
}
