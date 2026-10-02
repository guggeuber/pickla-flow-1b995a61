import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { routingPreflight, isolatedStagePreflight, validateTarget, validateReady, validateStripeTest, missingStageCredentials, withStageLock } from "./release-safety.mjs";
import { withIsolatedTargetLock } from "./release-isolated-lock.mjs";

test("competing route blocks promotion", () => {
  assert.equal(routingPreflight({ routes: { vercel_git: "ENABLED", vercel_autoassign: "DISABLED", vercel_hooks: "DISABLED", supabase_github: "DISABLED" } }, { owner: "x", vercel_project_id: "p", supabase_ref: "s" }).ready, false);
});
test("wrong Stage ref and changed alias block", () => {
  const target = { verified_at: "2026-10-01", supabase_ref: "isolated", vercel_project_id: "project", alias: "candidate.example", expected_served_sha: "abc" };
  assert.match(validateTarget(target, { supabase_ref: "shared", vercel_project_id: "project", alias: "candidate.example", served_sha: "abc" }), /wrong Stage/);
  assert.match(validateTarget(target, { supabase_ref: "isolated", vercel_project_id: "project", alias: "other", served_sha: "abc" }), /alias/);
});
test("only the identified isolated preview route is allowed", () => {
  const target = { verified_at: "2026-10-01", supabase_ref: "byuwuoivuuklcwmoesrx", supabase_parent_ref: "ptnvhbniiiapzbyofctg", vercel_project_id: "prj_ZXHb62NWhYVlIrj2yaEZekIxgJVV", preview_git_branch: "codex/release-v1-20261001", preview_domain_suffix: ".vercel.app", forbidden_domains: ["stage.playpickla.com", "playpickla.com"] };
  const routes = { supabase_github: "DISCONNECTED_PARENT_DASHBOARD", isolated_vercel_deploy_hooks: "NONE", isolated_preview_domains: "VERCEL_APP_ONLY", isolated_vercel_preview_branch: target.preview_git_branch };
  assert.equal(isolatedStagePreflight({ routes }, target).ready, true);
  assert.equal(isolatedStagePreflight({ routes: { ...routes, isolated_vercel_deploy_hooks: "UNKNOWN" } }, target).ready, false);
  assert.equal(validateTarget(target, { supabase_ref: target.supabase_ref, vercel_project_id: target.vercel_project_id, preview_git_branch: target.preview_git_branch, environment: "preview", deployment_url: "pickla-flow-abc.vercel.app" }), null);
  assert.match(validateTarget(target, { supabase_ref: "anpxxnpevtxhiajxmfji", vercel_project_id: target.vercel_project_id, preview_git_branch: target.preview_git_branch, environment: "preview", deployment_url: "pickla-flow-abc.vercel.app" }), /wrong Stage/);
  assert.match(validateTarget(target, { supabase_ref: target.supabase_ref, vercel_project_id: target.vercel_project_id, preview_git_branch: target.preview_git_branch, environment: "preview", deployment_url: "stage.playpickla.com" }), /protected/);
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
test("two Stage runs cannot own durable git target lock", () => {
  const dir = mkdtempSync(join(tmpdir(), "pickla-git-lock-test-"));
  const remote = join(dir, "remote.git"), runner = join(dir, "runner");
  const git = (args, cwd = dir) => execFileSync("git", args, { cwd, stdio: "pipe" });
  try {
    mkdirSync(runner);
    git(["init", "--bare", remote]);
    git(["init", runner]);
    writeFileSync(join(runner, "README"), "fixture\n");
    git(["add", "README"], runner);
    git(["-c", "user.name=test", "-c", "user.email=test@example.test", "commit", "-m", "fixture"], runner);
    git(["remote", "add", "origin", remote], runner);
    git(["push", "origin", "HEAD:refs/heads/main"], runner);
    withIsolatedTargetLock(runner, "first", () => assert.throws(() => withIsolatedTargetLock(runner, "second", () => {}), /locked/));
    assert.doesNotThrow(() => withIsolatedTargetLock(runner, "third", () => {}));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("interrupted isolated mutation retains durable lock", () => {
  const dir = mkdtempSync(join(tmpdir(), "pickla-git-lock-interrupt-"));
  const remote = join(dir, "remote.git"), runner = join(dir, "runner");
  const git = (args, cwd = dir) => execFileSync("git", args, { cwd, stdio: "pipe" });
  try {
    mkdirSync(runner);
    git(["init", "--bare", remote]);
    git(["init", runner]);
    writeFileSync(join(runner, "README"), "fixture\n");
    git(["add", "README"], runner);
    git(["-c", "user.name=test", "-c", "user.email=test@example.test", "commit", "-m", "fixture"], runner);
    git(["remote", "add", "origin", remote], runner);
    git(["push", "origin", "HEAD:refs/heads/main"], runner);
    assert.throws(() => withIsolatedTargetLock(runner, "interrupted", () => { throw new Error("deployment state unknown"); }), /deployment state unknown/);
    assert.throws(() => withIsolatedTargetLock(runner, "next", () => {}), /locked by interrupted/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("missing Stage credential reports names only", () => {
  const value = "fixture-secret-placeholder";
  const missing = missingStageCredentials({ STRIPE_TEST_SECRET_KEY: value });
  assert.deepEqual(missing, ["STAGE_VERCEL_TOKEN", "STAGE_SUPABASE_ACCESS_TOKEN"]);
  assert.ok(!JSON.stringify(missing).includes(value));
});
test("trusted Stripe TEST wiring fails without credentials and never echoes supplied material", () => {
  const marker = "fixture-secret-that-must-not-appear";
  const result = spawnSync("node", [new URL("./release-stripe-test-config.mjs", import.meta.url).pathname], {
    encoding: "utf8", env: { PATH: process.env.PATH, STRIPE_TEST_SECRET_KEY: marker },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /one-time Stripe TEST setup missing/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(marker));
});
