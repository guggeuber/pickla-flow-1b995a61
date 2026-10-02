#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, openSync, closeSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { digest, edgeGraph, classify, selectInvariants, gitDiffPaths } from "./release-policy.mjs";
import { validateTarget, isolatedStagePreflight, withStageLock } from "./release-safety.mjs";
import { withIsolatedTargetLock } from "./release-isolated-lock.mjs";
import { createExactPreview, discoverExactPreview } from "./release-isolated-preview.mjs";
import { configureIsolatedCheckoutOrigin, isolatedFunctionVersions, verifyIsolatedBranch } from "./release-isolated-supabase.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const policyBytes = readFileSync(join(root, "release/policy.json"));
const policy = JSON.parse(policyBytes);
const targets = JSON.parse(readFileSync(join(root, "release/stage-targets.json")));
const inventory = JSON.parse(readFileSync(join(root, "release/inventory.json")));
const registryDir = process.env.PICKLA_RELEASE_REGISTRY || join(root, ".pickla-release-v1");
const offset = process.argv[2] === "release" ? 1 : 0;
const command = process.argv[2 + offset], arg = process.argv[3 + offset];
const shaPattern = /^[0-9a-f]{40}$/;
const releasePattern = /^rel-[0-9a-f]{12}-[0-9a-f]{8}$/;
function git(args, cwd = root) { return execFileSync("git", args, { cwd, encoding: "utf8" }).trim(); }
function withoutStripeEnv() {
  const safeEnv = { ...process.env };
  delete safeEnv.STRIPE_TEST_SECRET_KEY;
  delete safeEnv.STRIPE_TEST_WEBHOOK_SECRET;
  return safeEnv;
}
function fail(reason) { console.error(JSON.stringify({ status: "BLOCKED", reason })); process.exit(1); }
function currentMain() {
  const remote = git(["ls-remote", "origin", "refs/heads/main"]).split("\t")[0];
  const local = git(["rev-parse", "refs/remotes/origin/main"]);
  if (!shaPattern.test(remote) || remote !== local) fail("canonical origin/main moved or local ref is stale; fetch from a trusted checkout before retrying");
  return remote;
}
function cloneCandidate(temp, sha) {
  git(["clone", "--shared", "--no-checkout", "--quiet", root, temp]);
  git(["checkout", "--detach", "--quiet", sha], temp);
  if (git(["status", "--porcelain", "--untracked-files=all"], temp)) fail("dirty temporary checkout");
}
function dirty() { return git(["status", "--porcelain", "--untracked-files=all"]).split("\n").some((v) => v && !v.includes(".pickla-release-v1/")); }
function pathFor(id) { if (!releasePattern.test(id || "")) fail("invalid release-id"); return join(registryDir, `${id}.json`); }
function load(id) { const path = pathFor(id); if (!existsSync(path)) fail("release not found in registry"); const data = JSON.parse(readFileSync(path)); validate(data); return data; }
function validate(record) {
  const schema = JSON.parse(readFileSync(join(root, "release/record.schema.json")));
  for (const key of schema.required) if (!(key in record)) fail(`invalid registry record: ${key}`);
  for (const key of ["candidate_sha", "base_sha", "tree_sha"]) if (!shaPattern.test(record[key])) fail(`invalid registry SHA: ${key}`);
  for (const key of ["policy_sha", ...Object.keys(record.edge_manifest || {}).map((name) => `edge_manifest.${name}`)]) {
    const value = key.startsWith("edge_manifest.") ? record.edge_manifest[key.slice(14)] : record[key];
    if (!/^[0-9a-f]{64}$/.test(value || "")) fail(`invalid digest: ${key}`);
  }
  if (!releasePattern.test(record.release_id) || !["normal", "urgent"].includes(record.urgency) || !["HOTFIX", "STANDARD", "HIGH", "CRITICAL"].includes(record.risk_floor)) fail("invalid record selector");
  if (!Array.isArray(record.events) || !Array.isArray(record.blockers) || !record.invariants || typeof record.invariants !== "object") fail("invalid record events or evidence");
}
function save(record, event, details = {}) {
  mkdirSync(registryDir, { recursive: true });
  const lock = join(registryDir, `${record.release_id}.lock`);
  let fd; try { fd = openSync(lock, "wx"); } catch { fail("concurrent register writer"); }
  try {
    const path = pathFor(record.release_id);
    const current = existsSync(path) ? JSON.parse(readFileSync(path)) : null;
    if (current && current.candidate_sha !== record.candidate_sha) fail("registry candidate mismatch");
    record.events = current?.events || record.events || [];
    if (!record.events.some((entry) => entry.event === event && entry.key === details.key)) record.events.push({ event, key: details.key || null, at: new Date().toISOString(), ...details });
    record.updated_at = new Date().toISOString();
    writeFileSync(`${path}.tmp`, JSON.stringify(record, null, 2) + "\n");
    execFileSync("mv", [`${path}.tmp`, path]);
  } finally { closeSync(fd); rmSync(lock, { force: true }); }
}
function mainGuard(record) {
  const main = currentMain();
  if (main !== record.base_sha) fail(`main changed: inspected ${record.base_sha}, current ${main}`);
  if (git(["rev-parse", `${record.candidate_sha}^{tree}`]) !== record.tree_sha) fail("candidate tree changed");
  if (digest(policyBytes) !== record.policy_sha) fail("policy changed");
}
function trustedMain(record) {
  if (record.bootstrap_trust) {
    const tag = "pickla-release-bootstrap-v1";
    const sha = git(["rev-parse", "HEAD"]);
    if (record.bootstrap_trust.mode !== "reviewed_tag_v1" || record.bootstrap_trust.ref !== `refs/tags/${tag}` || record.bootstrap_trust.workflow_sha !== sha || process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REF !== `refs/tags/${tag}` || process.env.GITHUB_SHA !== sha || process.env.PICKLA_BOOTSTRAP_SHA !== sha) return false;
    try {
      if (git(["ls-remote", "origin", `refs/tags/${tag}`]).split("\t")[0] !== sha) return false;
      const rulesets = JSON.parse(execFileSync("gh", ["api", "repos/guggeuber/pickla-flow-1b995a61/rulesets?targets=tag"], { cwd: root, encoding: "utf8", timeout: 30000 }));
      const rule = rulesets.find((value) => value.name === "pickla-release-bootstrap-v1-immutable" && value.enforcement === "active" && value.target === "tag");
      if (!rule) return false;
      const details = JSON.parse(execFileSync("gh", ["api", `repos/guggeuber/pickla-flow-1b995a61/rulesets/${rule.id}`], { cwd: root, encoding: "utf8", timeout: 30000 }));
      return details.conditions?.ref_name?.include?.includes(`refs/tags/${tag}`) && ["update", "deletion"].every((type) => details.rules?.some((item) => item.type === type)) && !details.bypass_actors?.length;
    } catch { return false; }
  }
  if (git(["rev-parse", "HEAD"]) !== record.base_sha) return false;
  try {
    execFileSync("gh", ["api", "repos/guggeuber/pickla-flow-1b995a61/branches/main/protection"], { cwd: root, timeout: 30000, stdio: "ignore" });
    return true;
  } catch { return false; }
}
function inspect(sha) {
  if (!shaPattern.test(sha || "")) fail("full 40-character SHA required");
  if (dirty()) fail("dirty runner checkout");
  const main = currentMain();
  try { if (git(["cat-file", "-t", sha]) !== "commit") fail("SHA is not a commit"); } catch { fail("unknown SHA"); }
  if (git(["merge-base", main, sha]) !== main) fail("old candidate: current main is not ancestor");
  const temp = execFileSync("mktemp", ["-d", join(tmpdir(), "pickla-release-XXXXXX")], { encoding: "utf8" }).trim();
  try {
    cloneCandidate(temp, sha);
    const tree = git(["rev-parse", "HEAD^{tree}"], temp);
    const paths = gitDiffPaths(root, main, sha);
    const classification = classify(paths, { graph: edgeGraph(temp) });
    const ids = selectInvariants(classification, policy);
    const id = `rel-${sha.slice(0, 12)}-${digest(`${main}:${digest(policyBytes)}`).slice(0, 8)}`;
    const now = new Date().toISOString();
    const bootstrapTrust = process.env.PICKLA_BOOTSTRAP_REQUEST === "reviewed_tag_v1" && process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_REF === "refs/tags/pickla-release-bootstrap-v1" && process.env.GITHUB_SHA === git(["rev-parse", "HEAD"])
      ? { mode: "reviewed_tag_v1", ref: process.env.GITHUB_REF, workflow_sha: process.env.GITHUB_SHA } : null;
    const record = { schema_version: 1, release_id: id, candidate_sha: sha, base_sha: main, policy_sha: digest(policyBytes), tree_sha: tree, domains: classification.domains, capabilities: classification.capabilities, risk_floor: classification.risk_floor, urgency: "normal", decision: classification.decision, reasons: classification.reasons, affected_edge_functions: classification.edge_functions, edge_manifest: Object.fromEntries(classification.edge_functions.map((name) => [name, digest((edgeGraph(temp).consumers[name] || []).map((path) => readFileSync(join(temp, path))).join("\n"))])), invariants: Object.fromEntries(ids.map((key) => [key, { status: "required" }])), bootstrap_trust: bootstrapTrust, stage: null, intended_production: { vercel: "UNKNOWN", supabase: "UNKNOWN", migrations: "manual-review" }, recovery_reference: null, evidence: {}, status: classification.decision === "NEEDS_REVIEW" ? "BLOCKED" : "INSPECTED", blockers: classification.decision === "NEEDS_REVIEW" ? ["unknown effect needs review"] : [], created_at: now, updated_at: now, events: [] };
    save(record, "INSPECTED", { key: sha });
    console.log(JSON.stringify(record, null, 2));
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
function stage(id) {
  const record = load(id); mainGuard(record);
  if (dirty()) fail("dirty runner checkout");
  const stageLock = join(registryDir, "isolated-stage.lock");
  mkdirSync(registryDir, { recursive: true });
  try {
    return withStageLock(stageLock, () => withIsolatedTargetLock(root, id, () => stageLocked(record, id)));
  } catch (error) {
    record.status = "BLOCKED";
    record.blockers = [`isolated target requires reconciliation: ${error.message}`];
    save(record, "BLOCKED", { key: "stage-reconcile", reason: record.blockers[0] });
    console.log(JSON.stringify({ release_id: id, status: record.status, blockers: record.blockers }));
    process.exitCode = 1;
  }
}
function stageLocked(record, id) {
  const target = targets.targets.find((value) => value.purpose === "isolated_candidate_stage" && value.owner && value.supabase_ref && value.vercel_project_id && value.preview_git_branch);
  const blocked = (key, reason) => {
    record.status = "BLOCKED";
    record.blockers = [reason];
    save(record, "BLOCKED", { key, reason });
    console.log(JSON.stringify({ release_id: id, status: record.status, blockers: record.blockers }));
    process.exitCode = 1;
  };
  if (!target) {
    const decision = inventory.isolated_stage_decision;
    return blocked("stage-target", decision?.reason || "isolated Stage target unavailable");
  }
  const preflight = isolatedStagePreflight(inventory, target);
  if (!preflight.ready) return blocked("stage-routing", `isolated routing preflight: ${preflight.blockers.join("; ")}`);
  if (!trustedMain(record)) {
    return blocked("trusted-main", "trusted-main Stage runner unavailable: protected main does not yet contain Release V1 policy and workflow");
  }
  if (record.affected_edge_functions.length) return blocked("edge-deploy", "candidate changes Edge functions; isolated Edge deployment/version adapter is not approved for this target");
  if (!process.env.STAGE_VERCEL_TOKEN || !process.env.STAGE_SUPABASE_ACCESS_TOKEN) return blocked("stage-credentials", "Vercel or Supabase read credential unavailable in trusted main certification environment");
  let previewMutationAttempted = false;
  try {
    const branch = verifyIsolatedBranch(target);
    const edgeVersions = isolatedFunctionVersions(target);
    previewMutationAttempted = true;
    const deploymentId = record.stage?.vercel_deployment_id || createExactPreview(target, record.candidate_sha, id);
    const preview = discoverExactPreview(target, record.candidate_sha, process.env.STAGE_VERCEL_TOKEN, deploymentId);
    const targetError = validateTarget(target, { ...preview, supabase_ref: branch.ref });
    if (targetError) return blocked("stage-identity", targetError);
    const checkoutOrigin = configureIsolatedCheckoutOrigin(target, preview.deployment_url);
    let stripeConfigured = false;
    if (process.env.STRIPE_TEST_SECRET_KEY && process.env.STRIPE_TEST_WEBHOOK_SECRET) {
      execFileSync("node", [join(root, "scripts/release-stripe-test-config.mjs")], {
        cwd: root, env: process.env, encoding: "utf8", timeout: 120000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      stripeConfigured = true;
    }
    // The URL is an immutable Vercel deployment. Supabase is explicit and must
    // be verified independently before any Edge or fixture mutation.
    record.stage = { ...preview, supabase_ref: branch.ref, supabase_branch_id: branch.branch_id, supabase_branch_status: branch.status, edge_versions: edgeVersions, fixture_venue_slug: target.fixture_venue_slug, checkout_origin: checkoutOrigin.checkout_origin, stripe_test_credentials_available: stripeConfigured };
    record.invariants["release.stage_identity_exact"] = { status: "passed", evidence_ref: `vercel:${preview.vercel_deployment_id}`, at: preview.verified_at };
    record.status = "STAGED";
    record.blockers = [];
    save(record, "STAGED", { key: preview.vercel_deployment_id, deployment_id: preview.vercel_deployment_id, supabase_ref: target.supabase_ref });
    console.log(JSON.stringify({ release_id: id, status: "STAGED", stage: record.stage }));
  } catch (error) {
    if (previewMutationAttempted) {
      blocked("stage-adapter", `exact-SHA preview state uncertain: ${error.message}`);
      throw error;
    }
    return blocked("stage-adapter", `exact-SHA preview unavailable: ${error.message}`);
  }
}
function verify(id, mode = "normal") {
  const record = load(id); mainGuard(record);
  if (dirty()) fail("dirty runner checkout");
  const local = policy.invariants.filter((item) => record.invariants[item.id] && item.environment === "local");
  if (mode === "stage") {
    if (process.env.GITHUB_ACTIONS !== "true" || process.env.PICKLA_LOCAL_GATE_SHA !== record.candidate_sha || !/^\d+$/.test(process.env.GITHUB_RUN_ID || "")) fail("trusted local-gate job attestation missing");
    for (const item of local) record.invariants[item.id] = { status: "passed", evidence_ref: `github-actions:${process.env.GITHUB_RUN_ID}:local-gates:${record.candidate_sha}`, at: new Date().toISOString() };
    save(record, "EVIDENCE", { key: `local-gates:${process.env.GITHUB_RUN_ID}`, scope: "isolated-local-job", candidate_sha: record.candidate_sha });
  } else if (local.some((item) => record.invariants[item.id]?.status !== "passed")) {
    if (process.env.STAGE_VERCEL_TOKEN || process.env.STAGE_SUPABASE_ACCESS_TOKEN || process.env.STRIPE_TEST_SECRET_KEY) fail("candidate local gates require a credential-free process");
    const temp = execFileSync("mktemp", ["-d", join(tmpdir(), "pickla-verify-XXXXXX")], { encoding: "utf8" }).trim();
    try {
      cloneCandidate(temp, record.candidate_sha);
      const dependencyRoot = process.env.PICKLA_RELEASE_DEPENDENCIES || join(root, "node_modules");
      if (!existsSync(dependencyRoot)) fail("local dependencies unavailable; run npm ci in trusted runner");
      if (git(["show", `${record.candidate_sha}:package-lock.json`]) !== readFileSync(join(root, "package-lock.json"), "utf8").trim()) fail("candidate dependency lock differs from runner; install isolated dependencies first");
      symlinkSync(dependencyRoot, join(temp, "node_modules"), "dir");
      for (const item of local) {
        if (record.invariants[item.id].status === "passed") continue;
        const safeEnv = {
          PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR || tmpdir(),
          CI: "true", COMMIT_SHA: record.candidate_sha, VERCEL_ENV: "preview",
          PICKLA_ISOLATED_CERTIFICATION: "byuwuoivuuklcwmoesrx",
          VITE_SUPABASE_PROJECT_ID: "byuwuoivuuklcwmoesrx",
          VITE_SUPABASE_URL: "https://byuwuoivuuklcwmoesrx.supabase.co",
          VITE_SUPABASE_PUBLISHABLE_KEY: "local-synthetic-placeholder",
        };
        const result = spawnSync("sh", ["-c", item.command], { cwd: temp, env: safeEnv, encoding: "utf8", timeout: item.timeout_seconds * 1000, maxBuffer: 4 * 1024 * 1024 });
        const log = `${result.stdout || ""}\n${result.stderr || ""}`;
        record.invariants[item.id] = { status: result.status === 0 ? "passed" : "failed", exit_code: result.status, log_sha256: digest(log), at: new Date().toISOString() };
        save(record, "EVIDENCE", { key: item.id, invariant: item.id, status: record.invariants[item.id].status, digest: digest(log) });
      }
    } finally { rmSync(temp, { recursive: true, force: true }); }
  }
  if (local.some((item) => record.invariants[item.id]?.status !== "passed")) fail("required local candidate gate failed");
  if (mode === "local") { console.log(JSON.stringify({ release_id: id, candidate_sha: record.candidate_sha, status: "LOCAL_GATES_PASS" })); return; }
  const target = targets.targets.find((value) => value.purpose === "isolated_candidate_stage");
  if (record.stage && target && trustedMain(record) && process.env.STAGE_VERCEL_TOKEN && process.env.STAGE_SUPABASE_ACCESS_TOKEN) {
    let gate = "studentpris";
    try {
      withStageLock(join(registryDir, "isolated-stage.lock"), () => withIsolatedTargetLock(root, id, () => {
        const current = discoverExactPreview(target, record.candidate_sha, process.env.STAGE_VERCEL_TOKEN, record.stage.vercel_deployment_id);
        if (current.vercel_deployment_id !== record.stage.vercel_deployment_id) throw new Error("staged Vercel identity changed");
        const branch = verifyIsolatedBranch(target);
        if (branch.ref !== record.stage.supabase_ref || branch.branch_id !== record.stage.supabase_branch_id) throw new Error("staged Supabase identity changed");
        if (JSON.stringify(isolatedFunctionVersions(target)) !== JSON.stringify(record.stage.edge_versions)) throw new Error("staged Edge function versions changed");
        const evidence = JSON.parse(execFileSync("node", [join(root, "scripts/release-studentpris-harness.mjs"), "run"], { cwd: root, env: withoutStripeEnv(), encoding: "utf8", timeout: 180000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }));
        record.evidence.studentpris = evidence;
        for (const key of ["price.server_authoritative", "studentpris.member_matrix", "open_play.inverse", "studentpris.admin_save_reload"]) if (record.invariants[key]) record.invariants[key] = { status: "passed", evidence_ref: `record:evidence.studentpris#${evidence.sha256}`, at: evidence.observed_at };
        save(record, "EVIDENCE", { key: evidence.sha256, scope: "isolated-studentpris", digest: evidence.sha256 });
        if (process.env.STRIPE_TEST_SECRET_KEY && record.stage.stripe_test_credentials_available && record.invariants["stripe.test_amount"]?.status !== "passed") {
          gate = "stripe";
          const payment = JSON.parse(execFileSync("node", [join(root, "scripts/release-stripe-test-harness.mjs"), "run", current.deployment_url, id], {
            cwd: root, env: process.env, encoding: "utf8", timeout: 240000, maxBuffer: 1024 * 1024,
            stdio: ["ignore", "pipe", "pipe"],
          }));
          if (payment.target_ref !== target.supabase_ref || payment.preview_deployment_url !== current.deployment_url || payment.amount_minor !== 5900 || payment.livemode !== false || payment.provider_payment !== "paid" || payment.successful_charge_count !== 1 || payment.registration_count !== 1 || payment.paid_receipt_count !== 1 || payment.paid_ledger_count !== 1 || payment.processed_checkout_webhook_count !== 1) throw new Error("Stripe TEST evidence contract mismatch");
          record.evidence.stripe_test = payment;
          record.invariants["stripe.test_amount"] = { status: "passed", evidence_ref: `record:evidence.stripe_test#${payment.sha256}`, at: payment.observed_at };
          save(record, "EVIDENCE", { key: payment.sha256, scope: "isolated-stripe-test", digest: payment.sha256 });
        }
        if (JSON.stringify(isolatedFunctionVersions(target)) !== JSON.stringify(record.stage.edge_versions)) throw new Error("isolated Edge function versions changed during certification");
      }));
    } catch (error) {
      if (gate === "stripe" && record.invariants["stripe.test_amount"]) record.invariants["stripe.test_amount"] = { status: "failed", reason: "trusted Stripe TEST payment or canonical Pickla result did not verify" };
      record.blockers = [gate === "stripe" ? "trusted Stripe TEST payment or canonical Pickla result did not verify; isolated target lock held for reconciliation" : `isolated deployed-behavior gate failed: ${error.message}`];
      save(record, "BLOCKED", { key: "isolated-behavior", reason: record.blockers[0] });
    }
  }
  for (const item of policy.invariants.filter((value) => record.invariants[value.id] && value.environment === "isolated_stage" && record.invariants[value.id].status !== "passed")) {
    const reason = item.id === "stripe.test_amount"
      ? "real Stripe TEST checkout unavailable: isolated STRIPE_SECRET_KEY and trusted STRIPE_TEST_SECRET_KEY not configured"
      : record.stage ? "trusted deployed-behavior evidence unavailable" : "exact-SHA isolated preview not staged";
    record.invariants[item.id] = { status: "blocked", reason };
  }
  record.blockers = [...record.blockers.filter((value) => value.startsWith("isolated deployed-behavior gate failed:") || value.startsWith("trusted Stripe TEST payment") || value.startsWith("trusted-main Stage runner unavailable:") || value.startsWith("isolated target lock unavailable:")), ...Object.entries(record.invariants).filter(([, value]) => value.status !== "passed").map(([key, value]) => `${key}: ${value.status}${value.reason ? ` (${value.reason})` : ""}`)];
  record.status = record.blockers.length ? "BLOCKED" : "READY_FOR_APPROVAL";
  save(record, "VERIFIED", { key: digest(JSON.stringify(record.invariants)), status: record.status });
  console.log(JSON.stringify({ release_id: id, status: record.status, invariants: record.invariants, blockers: record.blockers }, null, 2));
  if (record.status !== "READY_FOR_APPROVAL") process.exitCode = 1;
}
function status(id) { const record = load(id); console.log(JSON.stringify(record, null, 2)); }
if (command === "inspect") inspect(arg);
else if (command === "stage") stage(arg);
else if (command === "verify") verify(arg);
else if (command === "verify-local") verify(arg, "local");
else if (command === "verify-stage") verify(arg, "stage");
else if (command === "status") status(arg);
else if (command === "promote") fail("promotion disabled in V1: production routing and approval boundary unverified");
else fail("usage: pickla release inspect <full-sha> | stage <release-id> | verify <release-id> | status <release-id> | promote <release-id> (disabled)");
