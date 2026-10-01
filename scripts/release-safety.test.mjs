import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { routingPreflight, validateTarget, validateReady, validateStripeTest, missingStageCredentials, withStageLock } from "./release-safety.mjs";

test("competing route blocks promotion", () => {
  assert.equal(routingPreflight({ routes: { vercel_git: "ENABLED", vercel_autoassign: "DISABLED", vercel_hooks: "DISABLED", supabase_github: "DISABLED" } }, { owner: "x", vercel_project_id: "p", supabase_ref: "s" }).ready, false);
});
test("wrong Stage ref and changed alias block", () => {
  const target = { verified_at: "2026-10-01", supabase_ref: "isolated", vercel_project_id: "project", alias: "candidate.example", expected_served_sha: "abc" };
  assert.match(validateTarget(target, { supabase_ref: "shared", vercel_project_id: "project", alias: "candidate.example", served_sha: "abc" }), /wrong Stage/);
  assert.match(validateTarget(target, { supabase_ref: "isolated", vercel_project_id: "project", alias: "other", served_sha: "abc" }), /alias/);
});
test("alias or Edge identity change prevents READY", () => {
  const record = { candidate_sha: "abc", stage: { vercel_deployment_id: "dpl1" }, edge_manifest: { "api-bookings": "hash1" }, invariants: { a: { status: "passed" } } };
  assert.match(validateReady(record, { vercel_deployment_id: "dpl2", served_sha: "abc", edge_manifest: { "api-bookings": "hash1" } }), /deployment/);
  assert.match(validateReady(record, { vercel_deployment_id: "dpl1", served_sha: "abc", edge_manifest: { "api-bookings": "hash2" } }), /Edge/);
});
test("unpaid or wrong amount Stripe TEST cannot pass", () => {
  const valid = { id: "cs_test_123", livemode: false, payment_status: "paid", amount_total: 5900, currency: "sek" };
  assert.equal(validateStripeTest(valid), null);
  assert.ok(validateStripeTest({ ...valid, payment_status: "unpaid" }));
  assert.ok(validateStripeTest({ ...valid, amount_total: 9900 }));
});
test("two Stage runs cannot own local target lock", () => {
  const dir = mkdtempSync(join(tmpdir(), "pickla-lock-test-"));
  try { withStageLock(join(dir, "stage.lock"), () => assert.throws(() => withStageLock(join(dir, "stage.lock"), () => {}), /already locked/)); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
test("missing Stage credential reports names only", () => {
  const value = "sk_test_do_not_print";
  const missing = missingStageCredentials({ STRIPE_TEST_SECRET_KEY: value });
  assert.deepEqual(missing, ["STAGE_VERCEL_TOKEN", "STAGE_SUPABASE_ACCESS_TOKEN"]);
  assert.ok(!JSON.stringify(missing).includes(value));
});
