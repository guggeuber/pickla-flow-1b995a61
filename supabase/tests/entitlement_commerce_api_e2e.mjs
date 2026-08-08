import crypto from "node:crypto";

const apiUrl = process.env.API_URL || "http://127.0.0.1:54321";
const commerceUrl = process.env.COMMERCE_FUNCTION_URL;
const webhookUrl = process.env.COMMERCE_WEBHOOK_URL;
const checkinsUrl = process.env.CHECKINS_FUNCTION_URL;
const anonKey = process.env.ANON_KEY;
const serviceKey = process.env.SERVICE_ROLE_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "whsec_commerce_r1_local";

if (!anonKey || !serviceKey || !commerceUrl || !webhookUrl || !checkinsUrl || !apiUrl.startsWith("http://127.0.0.1")) {
  throw new Error("Entitlement Commerce E2E only runs against the complete local test stack");
}

const run = crypto.randomBytes(5).toString("hex");
const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
const tomorrow = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date(Date.now() + 86_400_000));
const ids = {
  venue: crypto.randomUUID(),
  session: crypto.randomUUID(),
  futureSession: crypto.randomUUID(),
  participation: crypto.randomUUID(),
  racket: crypto.randomUUID(),
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pass(name, detail) {
  process.stdout.write(`PASS ${name}: ${detail}\n`);
}

async function request(url, { method = "GET", body, key = serviceKey, token, expected } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      apikey: key,
      ...(token === null ? {} : { Authorization: `Bearer ${token || key}` }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(method === "POST" && url.includes("/rest/v1/") ? { Prefer: "return=representation" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  const accepted = expected === undefined ? null : (Array.isArray(expected) ? expected : [expected]);
  if (accepted ? !accepted.includes(response.status) : !response.ok) {
    throw new Error(`${method} ${url} failed ${response.status}: ${text}`);
  }
  return { response, payload };
}

async function rest(table, query = "", options = {}) {
  return request(`${apiUrl}/rest/v1/${table}${query ? `?${query}` : ""}`, options);
}

async function rpc(name, body) {
  return (await request(`${apiUrl}/rest/v1/rpc/${name}`, { method: "POST", body })).payload;
}

async function fn(base, path, { method = "GET", body, token, expected } = {}) {
  return (await request(`${base}/${path}`, { method, body, key: anonKey, token: token ?? null, expected })).payload;
}

async function createUser(label) {
  const email = `entitlement-commerce-${label}-${run}@example.test`;
  const password = "Entitlement-commerce-local-42!";
  const created = await request(`${apiUrl}/auth/v1/admin/users`, {
    method: "POST", body: { email, password, email_confirm: true },
  });
  const login = await request(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: "POST", body: { email, password }, key: anonKey, token: anonKey,
  });
  const customer = (await rest("customers", `auth_user_id=eq.${created.payload.id}&select=id`)).payload[0];
  assert(customer?.id, `customer identity missing for ${label}`);
  return { id: created.payload.id, token: login.payload.access_token, customerId: customer.id, email };
}

async function cart(token, items, scope) {
  return fn(commerceUrl, "cart", {
    method: "POST", token, body: {
      venue_id: ids.venue,
      source: "entitlement_commerce_e2e",
      draft_scope: scope,
      journey_id: crypto.randomBytes(32).toString("hex"),
      items,
    },
  });
}

async function checkout(token, currentCart) {
  return fn(commerceUrl, "checkout", {
    method: "POST", token, body: {
      token: currentCart.cart_token,
      expected_version: currentCart.order.version,
      journey_id: crypto.randomBytes(32).toString("hex"),
      success_path: "/commerce/confirmed",
      cancel_path: "/today",
    },
  });
}

function stripeSignature(body) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac("sha256", webhookSecret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

async function completeCheckout({ sessionId, orderId, version, amount, email }) {
  const body = JSON.stringify({
    id: `evt_entitlement_commerce_${run}`,
    type: "checkout.session.completed",
    data: { object: {
      id: sessionId,
      amount_total: amount,
      currency: "sek",
      payment_intent: `pi_entitlement_commerce_${run}`,
      payment_method_types: ["card"],
      customer_details: { email, name: "Entitlement E2E", phone: null },
      metadata: { commerce_order_id: orderId, commerce_order_version: String(version) },
    } },
  });
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "content-type": "application/json",
      "stripe-signature": stripeSignature(body),
    },
    body,
  });
  assert(response.status === 200, `local webhook failed ${response.status}: ${await response.text()}`);
}

const organization = (await rest("organizations", "slug=eq.pickla&select=id")).payload[0];
assert(organization?.id, "local Pickla organization missing");
await rest("venues", "", { method: "POST", body: {
  id: ids.venue, organization_id: organization.id, name: "Entitlement Commerce Venue",
  slug: `entitlement-commerce-${run}`, commerce_enabled: true,
} });
await rest("activity_sessions", "", { method: "POST", body: [
  {
    id: ids.session, venue_id: ids.venue, name: "Entitlement Open Play", session_type: "open_play",
    sport_type: "pickleball", recurrence_days: [0, 1, 2, 3, 4, 5, 6], start_time: "00:01", end_time: "00:00",
    price_sek: 165, capacity: 8, product_key: "entitlement_open_play", publish_status: "published",
  },
  {
    id: ids.futureSession, venue_id: ids.venue, name: "Future Entitlement Open Play", session_type: "open_play",
    sport_type: "pickleball", recurrence_days: [0, 1, 2, 3, 4, 5, 6], start_time: "10:00", end_time: "12:00",
    price_sek: 165, capacity: 8, product_key: "entitlement_open_play", publish_status: "published",
  },
] });
await rest("access_products", "", { method: "POST", body: [
  {
    id: ids.participation, venue_id: ids.venue, product_key: "entitlement_open_play", name: "Personlig plats",
    product_kind: "session_ticket", session_type: "open_play", commerce_kind: "participation",
    fulfillment_type: "participation", fulfillment_presentation: "participation", base_price_sek: 165,
    vat_rate: 6, resolver_rules: {}, commerce_enabled: true, status: "active", is_active: true,
    standalone_enabled: false, activity_addon_enabled: false,
  },
  {
    id: ids.racket, venue_id: ids.venue, product_key: "entitlement_racket", name: "Hyrrack",
    product_kind: "rental", session_type: null, commerce_kind: "rental", fulfillment_type: "desk_pickup",
    fulfillment_presentation: "desk_pickup", base_price_sek: 50, vat_rate: 6,
    resolver_rules: { max_quantity: 3 }, commerce_enabled: true, status: "active", is_active: true,
    standalone_enabled: false, activity_addon_enabled: true,
  },
] });
await rest("product_relationships", "", { method: "POST", body: {
  venue_id: ids.venue, source_product_id: ids.participation, target_product_id: ids.racket,
  relationship_type: "offered_with", is_active: true,
} });

const operator = await createUser("operator");
const punchCustomer = await createUser("punch");
const partnerCustomer = await createUser("partner");
await rest("venue_staff", "", { method: "POST", body: {
  venue_id: ids.venue, user_id: operator.id, role: "venue_admin", is_active: true,
} });

const punch = await rpc("issue_access_entitlement", {
  p_customer_id: punchCustomer.customerId,
  p_user_id: punchCustomer.id,
  p_venue_id: ids.venue,
  p_entitlement_type: "punch_card",
  p_scope_type: "open_play",
  p_meter_type: "occurrences",
  p_funding_type: "customer_prepaid",
  p_funder: "self_prepaid",
  p_resolution_priority: 40,
  p_occurrence_origin: "paid",
  p_access_reason: "Klippkort · 1 gång kvar",
  p_uses_limit: 1,
  p_issuance_key: `punch-commerce-${run}`,
});

const punchCart = await cart(punchCustomer.token, [
  { product_id: ids.participation, quantity: 1, activity_session_id: ids.futureSession, session_date: tomorrow },
], `activity:${ids.futureSession}:${tomorrow}`);
const punchQuote = await fn(commerceUrl, "resolve", {
  method: "POST", token: punchCustomer.token, body: { token: punchCart.cart_token },
});
assert(punchQuote.lines[0].unit_price_minor === 0, "punch card did not cover the participation price");
const punchCheckout = await checkout(punchCustomer.token, punchCart);
assert(punchCheckout.free === true, "covered punch-card order did not bypass Stripe");
const punchRegistration = (await rest("session_registrations", `id=eq.${punchCheckout.registration_id}&select=id,status,source_type,source_id`)).payload[0];
assert(punchRegistration.source_type === "punch_card" && punchRegistration.source_id === punch.id, "free registration lost punch-card provenance");
assert((await rest("access_entitlements", `customer_id=eq.${punchCustomer.customerId}&select=id`)).payload.length === 1, "free checkout fabricated a second entitlement");
const punchCancelled = await fn(commerceUrl, "cancel", {
  method: "POST", token: punchCustomer.token, body: { reference: punchCheckout.order_id },
});
const punchAfterCancel = (await rest("access_entitlements", `id=eq.${punch.id}&select=status,uses_count`)).payload[0];
assert(punchCancelled.order.status === "cancelled" && punchAfterCancel.status === "active" && punchAfterCancel.uses_count === 0,
  "pre-attendance cancellation burned or revoked the punch-card visit");
pass("covered free participation", "0 kr retains punch provenance; cancellation consumes nothing and preserves the card");

const program = (await rest("partner_programs", "", { method: "POST", body: {
  organization_id: organization.id, program_key: `bruce-${run}`, name: "Bruce",
  activity_label: "Bruce gäller", access_reason: "Ingår via Bruce", desk_label: "Bruce",
  funding_counterparty_ref: `bruce-contract-${run}`, reimbursement_amount_minor: 12500,
  settlement_rule: { version: "1", basis: "valid_attendance" }, created_by: operator.id,
} })).payload[0];
await rest("partner_program_sessions", "", { method: "POST", body: {
  partner_program_id: program.id, organization_id: organization.id, venue_id: ids.venue,
  activity_session_id: ids.session, status: "eligible", created_by: operator.id,
} });
const partner = await rpc("issue_partner_entitlement", {
  p_partner_program_id: program.id,
  p_customer_id: partnerCustomer.customerId,
  p_user_id: partnerCustomer.id,
  p_venue_id: ids.venue,
  p_activity_session_id: ids.session,
  p_service_date: today,
  p_external_reference: `bruce-commerce-${run}`,
});

const partnerCart = await cart(partnerCustomer.token, [
  { product_id: ids.participation, quantity: 1, activity_session_id: ids.session, session_date: today },
  { product_id: ids.racket, quantity: 1, parent_product_id: ids.participation },
], `activity:${ids.session}:${today}`);
const partnerQuote = await fn(commerceUrl, "resolve", {
  method: "POST", token: partnerCustomer.token, body: { token: partnerCart.cart_token },
});
const participationQuote = partnerQuote.lines.find((line) => line.commerce_kind === "participation");
assert(participationQuote.unit_price_minor === 0 && participationQuote.resolver_snapshot?.access_reason === "Ingår via Bruce",
  "partner participation was not included with explicit provenance");
assert(partnerQuote.lines.reduce((sum, line) => sum + line.unit_price_minor * line.quantity, 0) === 5000,
  "partner coverage changed the paid add-on total");
const partnerCheckout = await checkout(partnerCustomer.token, partnerCart);
assert(partnerCheckout.free !== true && partnerCheckout.url, "paid add-on did not continue through Stripe");
const sessionId = new URL(partnerCheckout.url).searchParams.get("session");
await completeCheckout({
  sessionId,
  orderId: partnerCheckout.order_id,
  version: partnerCheckout.version,
  amount: 5000,
  email: partnerCustomer.email,
});
const partnerRegistration = (await rest("session_registrations", `source_type=eq.partner_access&source_id=eq.${partner.id}&select=id,status,source_type,source_id`)).payload[0];
assert(partnerRegistration?.id, "paid add-on webhook lost the original partner entitlement source");
assert((await rest("access_entitlements", `customer_id=eq.${partnerCustomer.customerId}&select=id`)).payload.length === 1,
  "paid add-on webhook fabricated a duplicate session entitlement");
const firstCheckin = await fn(checkinsUrl, "checkin", {
  method: "POST", token: operator.token, body: {
    venue_id: ids.venue, target_user_id: partnerCustomer.id,
    entry_type: "partner_access", entitlement_id: partner.id,
  },
});
const retryCheckin = await fn(checkinsUrl, "checkin", {
  method: "POST", token: operator.token, body: {
    venue_id: ids.venue, target_user_id: partnerCustomer.id,
    entry_type: "partner_access", entitlement_id: partner.id,
  },
});
const partnerAfterCheckin = (await rest("access_entitlements", `id=eq.${partner.id}&select=status,uses_count`)).payload[0];
const consumptions = (await rest("entitlement_consumptions", `entitlement_id=eq.${partner.id}&event_type=eq.use&select=id,registration_id`)).payload;
const receivables = (await rest("partner_receivable_events", `partner_program_id=eq.${program.id}&event_type=eq.accrued&select=id`)).payload;
assert(firstCheckin.already_checked_in === false && retryCheckin.already_checked_in === true,
  "partner check-in retry was not idempotent");
assert(partnerAfterCheckin.status === "exhausted" && partnerAfterCheckin.uses_count === 1
  && consumptions.length === 1 && consumptions[0].registration_id === partnerRegistration.id && receivables.length === 1,
  "actual attendance did not consume once with registration and receivable provenance");
pass("partner purchase-to-attendance", "0 kr activity + paid add-on, one original right, one check-in consumption, one receivable");

process.stdout.write("ENTITLEMENT_COMMERCE_API_E2E_PASSED\n");
