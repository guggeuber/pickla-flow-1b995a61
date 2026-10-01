#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, openSync, closeSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { digest, edgeGraph, classify, selectInvariants, gitDiffPaths } from "./release-policy.mjs";
import { routingPreflight, validateTarget, missingStageCredentials, withStageLock } from "./release-safety.mjs";

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
    const record = { schema_version: 1, release_id: id, candidate_sha: sha, base_sha: main, policy_sha: digest(policyBytes), tree_sha: tree, domains: classification.domains, capabilities: classification.capabilities, risk_floor: classification.risk_floor, urgency: "normal", decision: classification.decision, reasons: classification.reasons, affected_edge_functions: classification.edge_functions, edge_manifest: Object.fromEntries(classification.edge_functions.map((name) => [name, digest((edgeGraph(temp).consumers[name] || []).map((path) => readFileSync(join(temp, path))).join("\n"))])), invariants: Object.fromEntries(ids.map((key) => [key, { status: "required" }])), stage: null, intended_production: { vercel: "UNKNOWN", supabase: "UNKNOWN", migrations: "manual-review" }, recovery_reference: null, evidence: {}, status: classification.decision === "NEEDS_REVIEW" ? "BLOCKED" : "INSPECTED", blockers: classification.decision === "NEEDS_REVIEW" ? ["unknown effect needs review"] : [], created_at: now, updated_at: now, events: [] };
    save(record, "INSPECTED", { key: sha });
    console.log(JSON.stringify(record, null, 2));
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
function stage(id) {
  const record = load(id); mainGuard(record);
  if (dirty()) fail("dirty runner checkout");
  const stageLock = join(registryDir, "isolated-stage.lock");
  mkdirSync(registryDir, { recursive: true });
  return withStageLock(stageLock, () => stageLocked(record, id));
}
function stageLocked(record, id) {
  const target = targets.targets.find((value) => value.purpose === "isolated_candidate_stage" && value.owner && value.supabase_ref && value.vercel_project_id && value.alias);
  if (!target) {
    const decision = inventory.isolated_stage_decision;
    record.status = "BLOCKED";
    record.blockers = [decision?.reason || "isolated Stage target unavailable"];
    save(record, "BLOCKED", { key: "stage-target", reason: record.blockers[0] });
    console.log(JSON.stringify({ release_id: id, status: record.status, blockers: record.blockers, required_action: decision?.minimum_action || "Provision and verify an isolated Stage target." }));
    return;
  }
  if (inventory.github?.branch_protection?.main !== true) fail("trusted main policy unavailable: main branch has no verified protection");
  const missing = missingStageCredentials(process.env);
  if (missing.length) fail(`Stage credentials unavailable: ${missing.join(", ")}`);
  const preflight = routingPreflight(inventory, target);
  if (!preflight.ready) fail(`routing preflight: ${preflight.blockers.join("; ")}`);
  const targetError = validateTarget(target, target.current_identity);
  if (targetError) fail(targetError);
  // V1 never infers a target from supabase/config.toml, CLI links, or env vars.
  fail("Stage deploy adapter requires verified control-plane routing and target identity");
}
function verify(id) {
  const record = load(id); mainGuard(record);
  if (dirty()) fail("dirty runner checkout");
  const local = policy.invariants.filter((item) => record.invariants[item.id]?.status === "required" && item.environment === "local");
  const temp = execFileSync("mktemp", ["-d", join(tmpdir(), "pickla-verify-XXXXXX")], { encoding: "utf8" }).trim();
  try {
    cloneCandidate(temp, record.candidate_sha);
    const dependencyRoot = process.env.PICKLA_RELEASE_DEPENDENCIES || join(root, "node_modules");
    if (!existsSync(dependencyRoot)) fail("local dependencies unavailable; run npm ci in trusted runner");
    if (git(["show", `${record.candidate_sha}:package-lock.json`]) !== readFileSync(join(root, "package-lock.json"), "utf8").trim()) fail("candidate dependency lock differs from runner; install isolated dependencies first");
    symlinkSync(dependencyRoot, join(temp, "node_modules"), "dir");
    for (const item of local) {
      if (record.invariants[item.id].status === "passed") continue;
      const result = spawnSync("sh", ["-c", item.command], { cwd: temp, env: { ...process.env, COMMIT_SHA: record.candidate_sha }, encoding: "utf8", timeout: item.timeout_seconds * 1000, maxBuffer: 4 * 1024 * 1024 });
      const log = `${result.stdout || ""}\n${result.stderr || ""}`;
      record.invariants[item.id] = { status: result.status === 0 ? "passed" : "failed", exit_code: result.status, log_sha256: digest(log), at: new Date().toISOString() };
      save(record, "EVIDENCE", { key: item.id, invariant: item.id, status: record.invariants[item.id].status, digest: digest(log) });
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
  for (const item of policy.invariants.filter((value) => record.invariants[value.id] && value.environment === "isolated_stage")) record.invariants[item.id] = { status: "blocked", reason: inventory.isolated_stage_decision?.reason || "isolated Stage target unavailable" };
  record.blockers = Object.entries(record.invariants).filter(([, value]) => value.status !== "passed").map(([key, value]) => `${key}: ${value.status}${value.reason ? ` (${value.reason})` : ""}`);
  record.status = record.blockers.length ? "BLOCKED" : "READY";
  save(record, "VERIFIED", { key: digest(JSON.stringify(record.invariants)), status: record.status });
  console.log(JSON.stringify({ release_id: id, status: record.status, invariants: record.invariants, blockers: record.blockers }, null, 2));
}
function status(id) { const record = load(id); console.log(JSON.stringify(record, null, 2)); }
if (command === "inspect") inspect(arg);
else if (command === "stage") stage(arg);
else if (command === "verify") verify(arg);
else if (command === "status") status(arg);
else if (command === "promote") fail("promotion disabled in V1: production routing and approval boundary unverified");
else fail("usage: pickla release inspect <full-sha> | stage <release-id> | verify <release-id> | status <release-id> | promote <release-id> (disabled)");
