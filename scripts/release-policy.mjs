import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";

export const riskOrder = ["HOTFIX", "STANDARD", "HIGH", "CRITICAL"];
export const digest = (value) => createHash("sha256").update(value).digest("hex");
const add = (set, ...values) => values.forEach((value) => set.add(value));

export function edgeGraph(root) {
  const directory = join(root, "supabase/functions");
  const files = [];
  function walk(path) {
    for (const item of readdirSync(path, { withFileTypes: true })) {
      if (item.isDirectory()) walk(join(path, item.name));
      else if (/\.(ts|tsx|js|mjs)$/.test(item.name)) files.push(join(path, item.name));
    }
  }
  walk(directory);
  const imports = new Map();
  const unknown = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const deps = new Set();
    for (const match of source.matchAll(/(?:from\s*|import\s*\(|import\s*)["'](\.[^"']+)["']/g)) {
      const base = resolve(dirname(file), match[1]);
      const target = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, join(base, "index.ts")].find((value) => files.includes(value));
      if (target) deps.add(target);
      else unknown.push(relative(root, file));
    }
    if (/import\s*\(\s*[^"'\s]/.test(source)) unknown.push(relative(root, file));
    imports.set(file, deps);
  }
  const consumers = {};
  for (const file of files.filter((value) => /\/api-[^/]+\/index\.ts$/.test(value))) {
    const seen = new Set();
    function visit(path) { if (seen.has(path)) return; seen.add(path); for (const dep of imports.get(path) || []) visit(dep); }
    visit(file);
    consumers[relative(directory, file).split("/")[0]] = [...seen].map((value) => relative(root, value)).sort();
  }
  return { consumers, unknown: [...new Set(unknown)].sort() };
}

export function classify(paths, options = {}) {
  const domains = new Set(), capabilities = new Set(), reasons = [];
  let risk = "HOTFIX";
  const raise = (level, why) => { if (riskOrder.indexOf(level) > riskOrder.indexOf(risk)) risk = level; reasons.push(why); };
  const graph = options.graph || { consumers: {}, unknown: [] };
  const affectedEdge = new Set();
  for (const path of paths) {
    if (/^supabase\/migrations\//.test(path)) { add(domains, "Platform/DB/Edge", "Identity/Auth/RLS"); add(capabilities, "migration", "rls"); raise("CRITICAL", "database migration"); }
    if (/^supabase\/functions\//.test(path)) {
      add(domains, "Platform/DB/Edge"); add(capabilities, "edge");
      for (const [name, deps] of Object.entries(graph.consumers)) if (deps.includes(path)) affectedEdge.add(name);
      if (graph.unknown.includes(path) || ![...Object.values(graph.consumers)].some((deps) => deps.includes(path))) add(capabilities, "unknown_effect");
    }
    if (/stripe|payment|checkout|webhook/i.test(path)) { add(domains, "Payments", "Commerce"); add(capabilities, "payment"); raise("HIGH", "payment path"); }
    if (/refund|cancell/i.test(path)) { add(domains, "Payments"); add(capabilities, "refund"); raise("HIGH", "refund path"); }
    if (/auth|rls|security|tenant/i.test(path)) { add(domains, "Identity/Auth/RLS"); add(capabilities, "auth"); raise("CRITICAL", "identity or tenant boundary"); }
    if (/capacity|inventory|hold|booking|participation/i.test(path)) { add(domains, "Booking/Capacity"); add(capabilities, "inventory", "capacity"); raise("HIGH", "inventory or capacity concurrency"); }
    if (/pric|entitlement|membership|student/i.test(path)) { add(domains, "Pricing", "Commerce"); add(capabilities, "pricing"); raise("HIGH", "server pricing or entitlement"); }
    if (/student|activityProductSelectionPricing|activity_inclusion_policy/i.test(path)) { add(domains, "Customer UX/PWA"); add(capabilities, "student_price"); }
    if (/^src\//.test(path) || /^api\//.test(path)) { add(domains, "Customer UX/PWA"); add(capabilities, "web"); }
    if (/^scripts\/|^\.github\/|^release\//.test(path)) { add(domains, "Platform/DB/Edge"); add(capabilities, "release_policy"); }
  }
  // Importers need redeployment, but importing a price resolver does not prove a
  // change to Stripe idempotency or capacity concurrency behavior.
  if (capabilities.has("unknown_effect") || !domains.size) return { domains: [...domains].sort(), capabilities: [...capabilities].sort(), risk_floor: risk, decision: "NEEDS_REVIEW", reasons, edge_functions: [...affectedEdge].sort() };
  const agentRisk = options.agentRisk;
  if (agentRisk && riskOrder.includes(agentRisk)) raise(agentRisk, "agent escalation");
  return { domains: [...domains].sort(), capabilities: [...capabilities].sort(), risk_floor: risk, decision: "CLASSIFIED", reasons, edge_functions: [...affectedEdge].sort() };
}

export function selectInvariants(classification, policy) {
  return policy.invariants.filter((item) => item.capabilities.some((value) => classification.capabilities.includes(value)) && item.domains.some((value) => classification.domains.includes(value)) && riskOrder.indexOf(classification.risk_floor) >= riskOrder.indexOf(item.min_risk)).map((item) => item.id);
}

export function gitDiffPaths(root, base, head) {
  return execFileSync("git", ["diff", "--name-only", `${base}..${head}`], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
}
