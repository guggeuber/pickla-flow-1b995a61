import { readFileSync } from "node:fs";
import { isolatedConnection, isolatedQuery } from "./release-isolated-db.mjs";

const target = JSON.parse(readFileSync(new URL("../release/stage-targets.json", import.meta.url))).targets[0];
const releaseId = "rel-b0d5e9764aed-ae5fc683";
const sessionFixture = "b4bf1691-8f9c-463b-b7eb-57bb7b1fcae0";
const key = process.env.STRIPE_TEST_SECRET_KEY;
if (target.supabase_ref !== "byuwuoivuuklcwmoesrx" || !key || !(key.startsWith("sk_test_") || key.startsWith("rk_test_"))) throw new Error("isolated TEST diagnostic target or credential unavailable");
const connection = isolatedConnection(target);
const sql = (query) => isolatedQuery(connection, query);
const holdRows = sql(`select coalesce(stripe_session_id,''),status from capacity_holds where idempotency_key = 'release-v1-studentpris-${releaseId}' and scope_id = '${sessionFixture}' order by created_at desc limit 3`);
const holds = holdRows ? holdRows.split("\n").map((row) => row.split("|")) : [];
const result = { check: "isolated_stripe_test_read_only", target_ref: target.supabase_ref, hold_count: holds.length, hold_states: holds.map(([, status]) => status), checkout_session_present: holds.some(([id]) => Boolean(id)) };
const sessionIds = [...new Set(holds.map(([id]) => id).filter(Boolean))];
if (sessionIds.some((id) => !/^cs_test_[A-Za-z0-9]+$/.test(id))) throw new Error("isolated hold contains non-TEST checkout identity");
if (sessionIds.length > 1) throw new Error("multiple TEST checkout sessions for one release identity");
if (sessionIds.length === 1) {
  const sessionId = sessionIds[0];
  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}?expand[]=payment_intent`, {
    headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30000),
  });
  result.stripe_read_http_status = response.status;
  if (response.ok) {
    const session = await response.json();
    result.stripe_livemode = session.livemode;
    result.stripe_amount_minor = session.amount_total;
    result.stripe_payment_status = session.payment_status;
    result.stripe_session_status = session.status;
    if (session.payment_intent?.id && session.payment_intent.livemode === false) {
      const chargeResponse = await fetch(`https://api.stripe.com/v1/charges?payment_intent=${encodeURIComponent(session.payment_intent.id)}&limit=10`, {
        headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30000),
      });
      result.charge_read_http_status = chargeResponse.status;
      if (chargeResponse.ok) {
        const charges = await chargeResponse.json();
        result.paid_test_charge_count = charges.data?.filter((charge) => charge.paid === true && charge.livemode === false).length;
      }
    }
  }
  result.canonical_registration_count = Number(sql(`select count(*) from session_registrations where stripe_session_id = '${sessionId}' and activity_session_id = '${sessionFixture}' and status = 'confirmed'`));
  result.canonical_paid_receipt_count = Number(sql(`select count(*) from booking_receipts where stripe_session_id = '${sessionId}' and total_inc_vat_sek = 59 and payment_status = 'paid'`));
  result.canonical_paid_ledger_count = Number(sql(`select count(*) from ledger_entries where stripe_session_id = '${sessionId}' and amount_inc_vat_minor = 5900 and payment_status = 'paid'`));
  result.processed_checkout_webhook_count = Number(sql(`select count(*) from stripe_events where type = 'checkout.session.completed' and status = 'processed' and payload->'data'->'object'->>'id' = '${sessionId}'`));
}
console.log(JSON.stringify(result));
