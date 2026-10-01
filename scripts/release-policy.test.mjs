import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { edgeGraph, classify, selectInvariants } from "./release-policy.mjs";

const policy = JSON.parse(readFileSync(new URL("../release/policy.json", import.meta.url)));
const graph = edgeGraph(process.cwd());
const select = (paths, options) => { const result = classify(paths, { graph, ...options }); return { result, ids: selectInvariants(result, policy) }; };

test("Studentpris historical diff selects pricing, admin, customer, and isolated Stripe TEST evidence", () => {
  const paths = execFileSync("git", ["diff", "--name-only", "9ba8174a8ae803491589a4a08afed50ceec8bde1^", "9ba8174a8ae803491589a4a08afed50ceec8bde1"], { encoding: "utf8" }).trim().split("\n");
  const { result, ids } = select(paths);
  assert.equal(result.risk_floor, "HIGH");
  assert.deepEqual(result.edge_functions, ["api-bookings", "api-commerce", "api-courses", "api-event-public", "api-leagues"]);
  assert.deepEqual(ids, ["price.server_authoritative", "release.identity_exact", "release.stage_identity_exact", "student.admin_save_reload", "student.customer_view", "student.stripe_test_59"]);
});

test("payment implementation, refund, and inventory select their own evidence", () => {
  assert.ok(select(["supabase/functions/api-stripe-webhook/index.ts"]).ids.includes("payment.no_double_charge"));
  assert.ok(select(["supabase/functions/_shared/refund.ts"]).ids.includes("refund.truth_converges"));
  assert.ok(select(["supabase/functions/_shared/capacity.ts"]).ids.includes("inventory.no_oversell"));
  assert.ok(!select(["src/lib/activityPricing.ts"]).ids.includes("payment.no_double_charge"));
});

test("auth, migration and Stripe risk cannot be lowered by agent text", () => {
  assert.equal(select(["supabase/functions/_shared/auth.ts"], { agentRisk: "HOTFIX" }).result.risk_floor, "CRITICAL");
  assert.equal(select(["supabase/migrations/20261001000000_x.sql"], { agentRisk: "HOTFIX" }).result.risk_floor, "CRITICAL");
  assert.equal(select(["supabase/functions/api-stripe/index.ts"], { agentRisk: "HOTFIX" }).result.risk_floor, "HIGH");
});

test("unknown Edge consumer needs review", () => {
  const { result } = select(["supabase/functions/_shared/not-imported.ts"]);
  assert.equal(result.decision, "NEEDS_REVIEW");
});

test("release inventory and policy do not imply capacity changes", () => {
  const { result, ids } = select(["release/inventory.json", "scripts/release-policy.mjs"]);
  assert.deepEqual(result.domains, ["Platform/DB/Edge"]);
  assert.deepEqual(result.capabilities, ["release_policy"]);
  assert.deepEqual(ids, ["release.identity_exact", "release.stage_identity_exact"]);
});
