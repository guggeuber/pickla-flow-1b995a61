#!/usr/bin/env node
import { verifyBrowserEdgeContract } from "./edge-browser-contract.mjs";

const result = verifyBrowserEdgeContract();
console.log(`Browser Edge Functions: ${result.inventory.size}`);
console.log(`Browser request headers: ${[...result.requiredHeaders].sort().join(", ")}`);
console.log(`Shared CORS headers: ${[...result.allowedHeaders].sort().join(", ")}`);
for (const [name, methods] of result.inventory) {
  console.log(`${name}\t${[...methods].sort().join(",")}`);
}

if (result.errors.length) {
  for (const error of result.errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}

console.log("Browser request headers and Edge CORS are compatible.");
