#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { isolatedConnection, isolatedQuery } from "./release-isolated-db.mjs";

// One-time reconciliation of the first diagnostic Checkout. Its Stripe TEST
// object remains as evidence, but cannot be paid after its capacity hold expired.
const releaseId = "rel-b0d5e9764aed-ae5fc683";
const ref = "byuwuoivuuklcwmoesrx";
const target = JSON.parse(readFileSync(new URL("../release/stage-targets.json", import.meta.url))).targets[0];
const key = process.env.STRIPE_TEST_SECRET_KEY;
const repository = "guggeuber/pickla-flow-1b995a61";
const lockBranch = "pickla-release-isolated-lock";
const fail = (code) => { throw new Error(code); };
if (target.supabase_ref !== ref || !key?.startsWith("sk_test_") && !key?.startsWith("rk_test_") || !process.env.GH_TOKEN) fail("trusted_isolated_test_capability_unavailable");
const connection = isolatedConnection(target);
const sql = (query) => isolatedQuery(connection, query);
const rows = sql(`select coalesce(stripe_session_id,''),status,(expires_at <= now())::text from capacity_holds where idempotency_key = 'release-v1-studentpris-${releaseId}' order by created_at desc limit 2`).split("\n").filter(Boolean);
if (rows.length !== 1) fail("diagnostic_hold_not_unique");
const [sessionId, holdStatus, holdExpired] = rows[0].split("|");
if (!/^cs_test_[A-Za-z0-9]+$/.test(sessionId) || !["active", "expired"].includes(holdStatus) || !["t", "true"].includes(holdExpired)) fail("diagnostic_hold_identity_or_expiry_unverified");
const stripe = async (method, path) => {
  const response = await fetch(`https://api.stripe.com/v1${path}`, { method, headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) fail(`stripe_test_${method.toLowerCase()}_http_${response.status}`);
  return response.json();
};
let session = await stripe("GET", `/checkout/sessions/${sessionId}?expand[]=payment_intent`);
if (session.id !== sessionId || session.livemode !== false || session.amount_total !== 5900 || session.currency !== "sek" || session.payment_status !== "unpaid" || !["open", "expired"].includes(session.status) || session.payment_intent) fail("diagnostic_checkout_payment_state_uncertain");
const counts = [
  sql(`select count(*) from session_registrations where stripe_session_id = '${sessionId}' and status = 'confirmed'`),
  sql(`select count(*) from booking_receipts where stripe_session_id = '${sessionId}' and payment_status = 'paid'`),
  sql(`select count(*) from ledger_entries where stripe_session_id = '${sessionId}' and payment_status = 'paid'`),
  sql(`select count(*) from stripe_events where payload->'data'->'object'->>'id' = '${sessionId}' and status = 'processed'`),
];
if (counts.some((value) => value !== "0")) fail("diagnostic_checkout_canonical_payment_state_uncertain");
if (session.status === "open") session = await stripe("POST", `/checkout/sessions/${sessionId}/expire`);
if (session.status !== "expired" || session.payment_status !== "unpaid" || session.livemode !== false) fail("diagnostic_checkout_retirement_unverified");

const gh = (args) => JSON.parse(execFileSync("gh", ["api", ...args], { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] }));
const path = `repos/${repository}/contents/lock.json`;
const current = gh([`${path}?ref=${lockBranch}`]);
const lock = JSON.parse(Buffer.from(current.content.replace(/\s/g, ""), "base64").toString("utf8"));
if (lock.target !== ref || lock.release_id !== releaseId || lock.status !== "held" || lock.at !== "2026-10-03T23:23:27.191Z") fail("isolated_target_lock_owner_changed");
const released = { target: ref, release_id: releaseId, status: "free", at: new Date().toISOString(), reconciliation: "diagnostic_test_checkout_expired_unpaid" };
const encoded = Buffer.from(`${JSON.stringify(released)}\n`).toString("base64");
gh(["--method", "PUT", path, "-f", `message=Reconcile isolated Release V1 diagnostic TEST checkout`, "-f", `content=${encoded}`, "-f", `sha=${current.sha}`, "-f", `branch=${lockBranch}`]);
console.log(JSON.stringify({ target_ref: ref, release_id: releaseId, diagnostic_checkout: "expired_unpaid_retained_in_stripe_test", diagnostic_checkout_sha256: createHash("sha256").update(sessionId).digest("hex"), canonical_paid_counts: [0, 0, 0, 0], isolated_lock: "released", production_writes: 0, shared_stage_writes: 0 }));
