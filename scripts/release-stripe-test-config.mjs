#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const target = JSON.parse(readFileSync(new URL("../release/stage-targets.json", import.meta.url))).targets[0];
const ref = "byuwuoivuuklcwmoesrx";
const key = process.env.STRIPE_TEST_SECRET_KEY;
const webhook = process.env.STRIPE_TEST_WEBHOOK_SECRET;
const token = process.env.STAGE_SUPABASE_ACCESS_TOKEN;
const fail = (reason) => { console.error(JSON.stringify({ status: "BLOCKED", reason })); process.exit(1); };

if (target.supabase_ref !== ref || target.supabase_parent_ref !== "ptnvhbniiiapzbyofctg") fail("isolated Stripe target changed");
if (!key || !webhook || !token) fail("one-time Stripe TEST setup missing: certification environment needs STRIPE_TEST_SECRET_KEY and STRIPE_TEST_WEBHOOK_SECRET, plus STAGE_SUPABASE_ACCESS_TOKEN");
if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) fail("Stripe credential is not TEST scoped");
if (!webhook.startsWith("whsec_")) fail("Stripe TEST webhook signing secret is invalid");

const secrets = [{ name: "STRIPE_SECRET_KEY", value: key }, { name: "STRIPE_WEBHOOK_SECRET", value: webhook }];
const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/secrets`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(secrets),
  signal: AbortSignal.timeout(30000),
});
if (!response.ok) fail(`isolated Supabase TEST secret write failed: HTTP ${response.status}`);

// Supabase CLI returns SHA-256 digests in `value`. Parse only in memory and
// compare against the trusted job's TEST credentials; never emit either value.
const raw = execFileSync("npx", ["--yes", "supabase@2.113.0", "secrets", "list", "--project-ref", ref, "--output", "json"], {
  encoding: "utf8", timeout: 90000, maxBuffer: 4 * 1024 * 1024,
  env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }, stdio: ["ignore", "pipe", "pipe"],
});
const digests = Object.fromEntries(JSON.parse(raw).filter((item) => secrets.some((secret) => secret.name === item.name)).map((item) => [item.name, item.value]));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
if (digests.STRIPE_SECRET_KEY !== sha256(key) || digests.STRIPE_WEBHOOK_SECRET !== sha256(webhook)) fail("isolated Stripe TEST secret verification failed");
console.log(JSON.stringify({ target_ref: ref, stripe_test_credentials_available: true, webhook_test_secret_available: true }));
