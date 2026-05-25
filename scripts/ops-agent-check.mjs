#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const modes = new Set(["deploy", "opening", "closing", "weekly", "incident"]);
const modeArg = process.argv.find((arg) => arg.startsWith("--mode="));
const mode = modeArg ? modeArg.split("=")[1] : "deploy";

if (!modes.has(mode)) {
  console.error(`Unknown mode "${mode}". Use one of: ${Array.from(modes).join(", ")}`);
  process.exit(1);
}

const projectRef = "cqnjpudmsreubgviqptg";
const productionUrl = "https://playpickla.com";
const docs = [
  "docs/production-readiness.md",
  "docs/launch-runbook.md",
  "docs/observability-and-ops-agent.md",
  "docs/support-runbook.md",
  "docs/security-checklist.md",
  "docs/data-and-compliance.md",
  "docs/daily-operations-runbook.md",
  "docs/staging.md",
  "docs/smoke-tests.md",
];

const modeChecklists = {
  deploy: [
    "Vercel production build is green.",
    "Open production home, /book, /my, and one known padda route.",
    "Check Supabase Edge Function logs for changed functions.",
    "Check Stripe webhook deliveries and retries.",
    "Run one low-risk smoke path matching the change.",
    "Classify deploy as Green, Yellow, or Red.",
  ],
  opening: [
    "Today page shows correct venue state and upcoming sessions.",
    "Desk loads and can search one known customer.",
    "Paddor are online and show expected resource state.",
    "Booking availability loads for pickleball and darts.",
    "Stripe dashboard has no unresolved webhook failures.",
  ],
  closing: [
    "No stuck paid Stripe sessions without Pickla records.",
    "No unexpected active check-ins after closing.",
    "Cancellations from the day released inventory.",
    "Staff noted any support corrections made during the day.",
  ],
  weekly: [
    "Founder allowance and vouchers look correct for a sample user.",
    "Activity sessions for the next week look sane.",
    "Receipts and VAT look correct for paid, free, and multi-resource bookings.",
    "Temporary staff/admin access is removed or intentionally renewed.",
  ],
  incident: [
    "Classify severity P0-P3.",
    "Collect venue, route/function, user/customer, and object ids.",
    "Contain customer impact before broad debugging.",
    "Prefer code/admin fix. Use SQL only with explicit notes.",
    "Verify affected journey and one adjacent journey.",
  ],
};

function stockholmTimestamp() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date());
}

function gitStatus() {
  try {
    return execSync("git status --short", { encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function packageScripts() {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  return pkg.scripts || {};
}

function printCheck(label, ok, detail = "") {
  const mark = ok ? "ok" : "warn";
  console.log(`[${mark}] ${label}${detail ? ` - ${detail}` : ""}`);
}

function printChecklist(items) {
  items.forEach((item) => console.log(`[ ] ${item}`));
}

console.log(`Pickla Ops Agent`);
console.log(`Mode: ${mode}`);
console.log(`Stockholm time: ${stockholmTimestamp()}`);
console.log("");

console.log("Local readiness");
const missingDocs = docs.filter((path) => !existsSync(path));
printCheck("Ops docs present", missingDocs.length === 0, missingDocs.length ? missingDocs.join(", ") : "all required docs found");

const scripts = packageScripts();
printCheck("prod:check script exists", Boolean(scripts["prod:check"]), scripts["prod:check"] || "missing");
printCheck("ops:agent script exists", Boolean(scripts["ops:agent"]), scripts["ops:agent"] || "missing");

const dirty = gitStatus().filter((line) => !line.includes("supabase/.temp/"));
printCheck("working tree has no non-temp changes", dirty.length === 0, dirty.length ? dirty.join(" | ") : "clean except ignored/local temp files");
console.log("");

console.log(`${mode[0].toUpperCase()}${mode.slice(1)} checklist`);
printChecklist(modeChecklists[mode]);
console.log("");

console.log("Useful links");
console.log(`- Production: ${productionUrl}`);
console.log(`- Supabase project ref: ${projectRef}`);
console.log("- Stripe webhooks: Stripe Dashboard -> Developers -> Webhooks");
console.log("- Vercel deploys: Vercel Dashboard -> Pickla -> Deployments");
console.log("");

console.log("Useful commands");
console.log("- npm run prod:check");
console.log("- npm run ops:agent -- --mode=opening");
console.log("- npm run ops:agent -- --mode=closing");
console.log(`- supabase functions deploy <function-name> --no-verify-jwt --project-ref ${projectRef}`);
console.log("");

if (mode === "incident") {
  console.log("Incident note template");
  console.log(`Time detected: ${stockholmTimestamp()}`);
  console.log("Reported by:");
  console.log("Venue:");
  console.log("Severity:");
  console.log("Affected route/function:");
  console.log("Affected user/customer:");
  console.log("Booking/payment/session ids:");
  console.log("Impact:");
  console.log("Current status:");
  console.log("Containment:");
  console.log("Fix commit/deploy:");
  console.log("Manual data changes:");
  console.log("Verification:");
  console.log("Follow-up:");
  console.log("Owner:");
}

