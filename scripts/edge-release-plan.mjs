#!/usr/bin/env node
import { affectedBrowserFunctions, gitChangedPaths } from "./edge-browser-contract.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const base = argument("--base");
const head = argument("--head") || "HEAD";
const changedArgument = argument("--changed");
if (!base && !changedArgument) {
  console.error("Usage: node scripts/edge-release-plan.mjs --base <git-ref> [--head <git-ref>]");
  console.error("   or: node scripts/edge-release-plan.mjs --changed <comma-separated-paths>");
  process.exit(2);
}

const changedPaths = changedArgument
  ? changedArgument.split(",").map((value) => value.trim()).filter(Boolean)
  : gitChangedPaths(base, head);
const sharedChanges = changedPaths.filter((path) => path.startsWith("supabase/functions/_shared/"));
const affected = affectedBrowserFunctions(sharedChanges);
const output = { base: base || null, head, shared_changes: sharedChanges, browser_functions_to_deploy: affected };

if (process.argv.includes("--json")) console.log(JSON.stringify(output));
else {
  console.log(`Shared runtime changes: ${sharedChanges.length ? sharedChanges.join(", ") : "none"}`);
  console.log(`Browser Edge Functions to deploy (${affected.length}):`);
  for (const name of affected) console.log(name);
}

const deployed = argument("--verify-deployed");
if (deployed !== undefined) {
  const deployedSet = new Set(deployed.split(",").map((value) => value.trim()).filter(Boolean));
  const missing = affected.filter((name) => !deployedSet.has(name));
  if (missing.length) {
    console.error(`Incomplete Edge deployment matrix; missing: ${missing.join(", ")}`);
    process.exit(1);
  }
}
