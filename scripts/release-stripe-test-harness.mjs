#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { isolatedConnection, isolatedQuery } from "./release-isolated-db.mjs";
import { jwt } from "./release-studentpris-harness.mjs";
import { safeFailure, withPaymentBrowser } from "./release-stripe-payment-window.mjs";

const ref = "byuwuoivuuklcwmoesrx";
const fixture = { venue: "student-hotfix-5403bc75", session: "b4bf1691-8f9c-463b-b7eb-57bb7b1fcae0", date: "2026-10-13" };
const sha256 = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const key = process.env.STRIPE_TEST_SECRET_KEY;
const previewUrl = process.argv[3];
const releaseId = process.argv[4];
const target = JSON.parse(readFileSync(new URL("../release/stage-targets.json", import.meta.url))).targets[0];
const diagnosis = { phase: "preflight", checkout_navigation: "not_started", checkout_form: "not_started", payment_submit: "not_started", redirect_callback: "not_observed", provider_payment: "not_checked", webhook_delivery: "not_checked", pickla_reconciliation: "not_checked" };
const classify = (code) => { const error = new Error(code); error.code = code; return error; };

async function stripe(path) {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Stripe TEST read HTTP ${response.status}`);
  return response.json();
}
async function fillCard(page) {
  const fields = [
    [/email|e-post/i, "student-hotfix-nonmember-5403bc75@example.test", 'input[type="email"], input[name="email"]'],
    [/cardnumber|cardNumber|cc-number/i, "4242424242424242", 'input[name="cardNumber"], input[name="cardnumber"], input[autocomplete="cc-number"]'],
    [/expiry|expiration|cardExpiry|cc-exp/i, "1234", 'input[name="cardExpiry"], input[name="exp-date"], input[autocomplete="cc-exp"]'],
    [/cvc|security|cc-csc/i, "123", 'input[name="cardCvc"], input[name="cvc"], input[autocomplete="cc-csc"]'],
  ];
  for (const [label, value, selector] of fields) {
    let filled = false;
    for (let attempt = 0; attempt < 30 && !filled; attempt++) {
      for (const frame of page.frames()) {
        const input = frame.locator(selector).first();
        if (await input.count() && await input.isVisible()) { await input.fill(value); filled = true; break; }
      }
      if (!filled) await page.waitForTimeout(500);
    }
    if (!filled && !/email/.test(String(label))) throw classify("test_payment_input_unavailable");
  }
  for (const selector of ['input[name="billingName"]', 'input[name="name"]', 'input[autocomplete="cc-name"]']) {
    const input = page.locator(selector).first();
    if (await input.count() && await input.isVisible()) { await input.fill("Pickla Synthetic Test"); break; }
  }
  for (const selector of ['input[name="billingPostalCode"]', 'input[name="postalCode"]', 'input[autocomplete="postal-code"]']) {
    const input = page.locator(selector).first();
    if (await input.count() && await input.isVisible()) { await input.fill("11122"); break; }
  }
  const submit = page.locator('button[type="submit"]').last();
  if (!await submit.count()) throw classify("test_payment_submit_unavailable");
  if (!await submit.isEnabled()) throw classify("test_payment_submit_disabled");
  try { await submit.click({ noWaitAfter: true, timeout: 15000 }); }
  catch { throw classify("test_payment_submit_click_failed"); }
}

async function run() {
  if (target.supabase_ref !== ref || target.fixture_venue_slug !== fixture.venue) throw new Error("unapproved Stripe TEST target");
  if (!key || !(key.startsWith("sk_test_") || key.startsWith("rk_test_"))) throw new Error("trusted Stripe TEST credential unavailable");
  if (!/^rel-[0-9a-f]{12}-[0-9a-f]{8}$/.test(releaseId || "")) throw new Error("immutable release ID required for Stripe TEST retry");
  if (!previewUrl?.endsWith(".vercel.app") || target.forbidden_domains.some((domain) => previewUrl === domain || previewUrl.endsWith(`.${domain}`))) throw new Error("unapproved checkout Preview origin");
  const connection = isolatedConnection(target);
  const sql = (query) => isolatedQuery(connection, query);
  const venueId = sql(`select id from venues where slug = '${fixture.venue}'`);
  const userId = sql("select id from auth.users where email = 'student-hotfix-nonmember-5403bc75@example.test'");
  assert.match(venueId, /^[0-9a-f-]{36}$/);
  assert.match(userId, /^[0-9a-f-]{36}$/);
  const configuredOrigin = `https://${previewUrl}`;
  const secretRaw = execFileSync("npx", ["--yes", "supabase@2.113.0", "secrets", "list", "--project-ref", ref, "--output", "json"], {
    encoding: "utf8", timeout: 90000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: process.env.STAGE_SUPABASE_ACCESS_TOKEN },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const originHash = JSON.parse(secretRaw).find((item) => item.name === "PUBLIC_SITE_URL")?.value;
  if (originHash !== createHash("sha256").update(configuredOrigin).digest("hex")) throw new Error("isolated checkout origin changed");

  diagnosis.phase = "prior_checkout_reconciliation";
  const prior = sql(`select coalesce(stripe_session_id,''), status, (expires_at > now())::text from capacity_holds where idempotency_key = 'release-v1-studentpris-${releaseId}' order by created_at desc limit 1`);
  if (prior) {
    const [priorId] = prior.split("|");
    if (!/^cs_test_[A-Za-z0-9]+$/.test(priorId)) throw classify("prior_checkout_identity_unverified");
    const previous = await stripe(`/checkout/sessions/${priorId}`);
    if (previous.livemode !== false || previous.amount_total !== 5900 || previous.currency !== "sek" || previous.payment_status !== "unpaid" || previous.status !== "expired") throw classify("prior_checkout_not_retired");
    diagnosis.prior_checkout = "expired_unpaid";
  }
  const body = {
    product_type: "activity_ticket", amount_sek: 59, venue_id: venueId,
    idempotency_key: `release-v1-studentpris-${releaseId}-payment-2`,
    metadata: {
      date: fixture.date, activity_session_id: fixture.session, session_name: "Studentpris TEST",
      session_type: "open_play", product_key: "studentpris", preview_effective_amount_sek: "59",
      user_id: userId, slug: fixture.venue, success_path: "/booking/confirmed?type=session_ticket",
    },
  };
  const checkout = async () => fetch(`https://${ref}.supabase.co/functions/v1/api-bookings/create-checkout`, {
    method: "POST", headers: {
      apikey: connection.anonKey, Authorization: `Bearer ${jwt(connection.jwtSecret, userId)}`,
      Origin: configuredOrigin, "Content-Type": "application/json", "Idempotency-Key": body.idempotency_key,
    }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
  });
  diagnosis.phase = "checkout_request";
  const existing = sql(`select coalesce(stripe_session_id,''),status,(expires_at > now())::text from capacity_holds where idempotency_key = '${body.idempotency_key}' order by created_at desc limit 1`);
  let checkoutUrl;
  let sessionId;
  if (existing) {
    const [id, holdStatus, holdUnexpired] = existing.split("|");
    if (!/^cs_test_[A-Za-z0-9]+$/.test(id)) throw classify("retry_checkout_identity_unverified");
    sessionId = id;
    const session = await stripe(`/checkout/sessions/${sessionId}`);
    if (session.livemode !== false || session.amount_total !== 5900 || session.currency !== "sek") throw classify("retry_checkout_amount_or_mode_mismatch");
    if (session.payment_status === "unpaid" && (session.status !== "open" || holdStatus !== "active" || !["t", "true"].includes(holdUnexpired))) throw classify("retry_checkout_hold_expired");
    if (session.payment_status !== "paid" && session.payment_status !== "unpaid") throw classify("retry_checkout_payment_state_unknown");
    checkoutUrl = session.url;
    diagnosis.checkout_request = "reused_exact_test_session";
  } else {
    const created = await checkout();
    diagnosis.checkout_http_status = created.status;
    if (!created.ok) throw classify("isolated_checkout_request_failed");
    checkoutUrl = (await created.json()).url;
    diagnosis.checkout_request = "created_once";
  }
  if (checkoutUrl != null && (typeof checkoutUrl !== "string" || new URL(checkoutUrl).hostname !== "checkout.stripe.com")) throw classify("checkout_url_not_stripe_hosted");
  sessionId ||= decodeURIComponent(checkoutUrl || "").match(/cs_test_[A-Za-z0-9]+/)?.[0];
  if (!sessionId) throw new Error("candidate Checkout session ID unavailable");
  const before = await stripe(`/checkout/sessions/${sessionId}`);
  if (before.livemode !== false || before.amount_total !== 5900 || before.currency !== "sek" || !["unpaid", "paid"].includes(before.payment_status)) throw classify("checkout_amount_or_mode_mismatch");
  if (before.payment_status === "unpaid" && (!checkoutUrl || before.status !== "open")) throw classify("checkout_not_open_for_payment");

  let paid;
  if (before.payment_status === "paid") { paid = before; diagnosis.provider_payment = "already_paid"; }
  else {
    diagnosis.phase = "browser_navigation";
    const browser = await chromium.launch({ headless: true });
    await withPaymentBrowser(browser, async () => {
      const page = await browser.newPage();
      const failedHosts = new Set();
      const callbackStatuses = [];
      page.on("requestfailed", (request) => { try { failedHosts.add(new URL(request.url()).hostname); } catch { /* never log URLs */ } });
      page.on("response", (response) => { try { if (new URL(response.url()).hostname === previewUrl) callbackStatuses.push(response.status()); } catch { /* never log URLs */ } });
      const navigation = await page.goto(checkoutUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      diagnosis.checkout_navigation = { host: new URL(page.url()).hostname, http_status: navigation?.status() ?? null };
      if (navigation?.status() !== 200 || new URL(page.url()).hostname !== "checkout.stripe.com") throw classify("stripe_checkout_navigation_failed");
      diagnosis.phase = "test_payment_input";
      await fillCard(page);
      diagnosis.checkout_form = "approved_test_card_filled";
      diagnosis.payment_submit = "clicked";
      diagnosis.phase = "provider_payment";
      for (let attempt = 0; attempt < 90; attempt++) {
        paid = await stripe(`/checkout/sessions/${sessionId}?expand[]=payment_intent`);
        diagnosis.provider_payment = paid.payment_status;
        const host = new URL(page.url()).hostname;
        if (host === previewUrl) diagnosis.redirect_callback = "preview_reached";
        if (paid.payment_status === "paid") break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      diagnosis.failed_request_hosts = [...failedHosts].slice(0, 8);
      diagnosis.callback_http_statuses = callbackStatuses.slice(0, 8);
      diagnosis.final_browser_host = new URL(page.url()).hostname;
      if (paid?.payment_status !== "paid") throw classify("stripe_test_payment_unpaid_after_submit");
    });
  }
  if (!paid?.payment_intent?.id) paid = await stripe(`/checkout/sessions/${sessionId}?expand[]=payment_intent`);
  if (paid?.livemode !== false || paid?.payment_status !== "paid" || paid?.amount_total !== 5900 || paid?.currency !== "sek" || paid?.payment_intent?.livemode !== false) throw classify("stripe_test_payment_contract_mismatch");
  const paymentIntentId = paid.payment_intent.id;
  const charges = await stripe(`/charges?payment_intent=${encodeURIComponent(paymentIntentId)}&limit=10`);
  if (charges.data?.filter((charge) => charge.paid === true && charge.livemode === false).length !== 1) throw new Error("Stripe TEST charge count is not exactly one");

  diagnosis.phase = "webhook_and_reconciliation";
  let registration = "", receipt = "", ledger = "", event = "";
  for (let attempt = 0; attempt < 30; attempt++) {
    registration = sql(`select count(*) from session_registrations where stripe_session_id = '${sessionId}' and activity_session_id = '${fixture.session}' and user_id = '${userId}' and status = 'confirmed'`);
    receipt = sql(`select count(*) from booking_receipts where stripe_session_id = '${sessionId}' and venue_id = '${venueId}' and total_inc_vat_sek = 59 and payment_status = 'paid'`);
    ledger = sql(`select count(*) from ledger_entries where stripe_session_id = '${sessionId}' and source_type = 'activity_registration' and source_id = '${sessionId}' and amount_inc_vat_minor = 5900 and payment_status = 'paid'`);
    event = sql(`select count(*) from stripe_events where type = 'checkout.session.completed' and status = 'processed' and payload->'data'->'object'->>'id' = '${sessionId}'`);
    if (registration === "1" && receipt === "1" && ledger === "1" && event === "1") break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  diagnosis.webhook_delivery = event === "1" ? "processed" : "not_processed";
  diagnosis.pickla_reconciliation = { registration_count: Number(registration), paid_receipt_count: Number(receipt), paid_ledger_count: Number(ledger) };
  if (registration !== "1" || receipt !== "1" || ledger !== "1" || event !== "1") throw classify("canonical_pickla_convergence_missing");
  const evidence = {
    target_ref: ref, preview_deployment_url: previewUrl, amount_minor: 5900, currency: "sek", livemode: false,
    provider_payment: "paid", successful_charge_count: 1, registration_count: 1, paid_receipt_count: 1, paid_ledger_count: 1,
    processed_checkout_webhook_count: 1,
    checkout_session_sha256: sha256(sessionId), payment_intent_sha256: sha256(paymentIntentId),
    observed_at: new Date().toISOString(),
  };
  return { ...evidence, sha256: sha256(evidence) };
}

if (process.argv[2] === "run" && process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await run())); }
  catch (error) { console.error(JSON.stringify(safeFailure(error, diagnosis))); process.exitCode = 1; }
}
