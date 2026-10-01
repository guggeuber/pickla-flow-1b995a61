import { openSync, closeSync, rmSync } from "node:fs";

export function routingPreflight(inventory, target) {
  const routes = inventory?.routes || {};
  const blockers = [];
  for (const key of ["vercel_git", "vercel_autoassign", "vercel_hooks", "supabase_github"]) if (routes[key] !== "DISABLED") blockers.push(`${key}: ${routes[key] || "UNKNOWN"}`);
  if (!target?.vercel_project_id || !target?.supabase_ref || !target?.owner) blockers.push("target identity or owner missing");
  return { ready: blockers.length === 0, blockers };
}

export function validateTarget(target, actual) {
  if (!target || !actual || !target.verified_at) return "target unverified";
  if (target.supabase_ref === "ptnvhbniiiapzbyofctg" || target.alias === "stage.playpickla.com") return "protected target";
  if (actual.supabase_ref !== target.supabase_ref || actual.vercel_project_id !== target.vercel_project_id) return "wrong Stage ref or project";
  if (actual.alias !== target.alias || actual.served_sha !== target.expected_served_sha) return "Stage alias or release identity changed";
  return null;
}

export function validateReady(record, actual) {
  if (!record?.stage || !actual) return "Stage evidence missing";
  if (record.stage.vercel_deployment_id !== actual.vercel_deployment_id || record.candidate_sha !== actual.served_sha) return "served alias or deployment identity changed";
  for (const [name, hash] of Object.entries(record.edge_manifest || {})) if (actual.edge_manifest?.[name] !== hash) return `Edge identity changed: ${name}`;
  if (Object.values(record.invariants || {}).some((value) => value.status !== "passed")) return "required evidence missing";
  return null;
}

export function validateStripeTest(session) {
  if (!session || session.livemode !== false || session.payment_status !== "paid" || session.amount_total !== 5900 || session.currency !== "sek" || !/^cs_test_/.test(session.id || "")) return "Stripe TEST payment absent or amount incorrect";
  return null;
}

export function withStageLock(path, action) {
  let fd;
  try { fd = openSync(path, "wx"); } catch { throw new Error("Stage target already locked"); }
  try { return action(); } finally { closeSync(fd); rmSync(path, { force: true }); }
}
