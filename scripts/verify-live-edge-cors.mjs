#!/usr/bin/env node
import { browserEdgeInventory, clientRequestHeaders } from "./edge-browser-contract.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const projectRef = argument("--project-ref") || process.env.SUPABASE_PROJECT_REF;
const origin = argument("--origin") || "https://playpickla.com";
if (!projectRef) {
  console.error("Missing --project-ref or SUPABASE_PROJECT_REF");
  process.exit(2);
}

const requestedHeaders = [...clientRequestHeaders()].sort();
const failures = [];
for (const [name, methods] of browserEdgeInventory()) {
  const results = await Promise.all([...methods].sort().map(async (method) => {
    const response = await fetch(`https://${projectRef}.supabase.co/functions/v1/${name}`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": requestedHeaders.join(","),
      },
    });
    const allowedHeaders = new Set((response.headers.get("access-control-allow-headers") || "")
      .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
    const allowedMethods = new Set((response.headers.get("access-control-allow-methods") || "")
      .split(",").map((value) => value.trim().toUpperCase()).filter(Boolean));
    const missingHeaders = requestedHeaders.filter((header) => !allowedHeaders.has(header));
    const ok = response.ok && missingHeaders.length === 0 && allowedMethods.has(method);
    if (!ok) failures.push({ name, method, status: response.status, missingHeaders, allowedMethods: [...allowedMethods] });
    return { method, ok, requestId: response.headers.get("sb-request-id") || "-" };
  }));
  console.log(`${name}\t${results.map((result) => `${result.method}:${result.ok ? "ok" : "FAIL"}`).join(",")}\t${results.map((result) => result.requestId).join(",")}`);
}

if (failures.length) {
  console.error(JSON.stringify({ failures }, null, 2));
  process.exit(1);
}
console.log(`Live CORS verified for every browser method across ${browserEdgeInventory().size} functions.`);
