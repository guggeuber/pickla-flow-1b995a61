import crypto from "node:crypto";
import { DateTime } from "luxon";

const apiUrl = process.env.API_URL || "http://127.0.0.1:54321";
const commerceUrl = process.env.COMMERCE_FUNCTION_URL || `${apiUrl}/functions/v1/api-commerce`;
const webhookUrl = process.env.COMMERCE_WEBHOOK_URL || `${apiUrl}/functions/v1/api-stripe-webhook`;
const anonKey = process.env.ANON_KEY;
const serviceKey = process.env.SERVICE_ROLE_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "whsec_commerce_r1_local";
if (!anonKey || !serviceKey || !apiUrl.startsWith("http://127.0.0.1")) {
  throw new Error("Commerce R1 E2E only runs against the local Supabase stack");
}

const ids = {
  venue: "c2b00000-0000-4000-8000-000000000001",
  capacityVenue: "c2b00000-0000-4000-8000-000000000002",
  activity: "c2b00000-0000-4000-8000-000000000010",
  futureActivity: "c2b00000-0000-4000-8000-000000000011",
  capacityActivity: "c2b00000-0000-4000-8000-000000000012",
  participation: "c2b00000-0000-4000-8000-000000000020",
  dayPass: "c2b00000-0000-4000-8000-000000000022",
  racket: "c2b00000-0000-4000-8000-000000000021",
  capacityParticipation: "c2b00000-0000-4000-8000-000000000030",
  capacityRacket: "c2b00000-0000-4000-8000-000000000031",
};
const today = DateTime.now().setZone("Europe/Stockholm").toISODate();
const tomorrow = DateTime.now().setZone("Europe/Stockholm").plus({ days: 1 }).toISODate();
const results = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function pass(name, detail = "ok") {
  results.push({ name, detail });
  process.stdout.write(`PASS ${name}: ${detail}\n`);
}

async function request(url, { method = "GET", body, key = serviceKey, token, headers = {}, expected } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      apikey: key,
      ...(token === null ? {} : { Authorization: `Bearer ${token || key}` }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (expected !== undefined) {
    const accepted = Array.isArray(expected) ? expected : [expected];
    assert(accepted.includes(response.status), `${method} ${url} expected ${accepted.join("/")}, got ${response.status}: ${text}`);
  } else if (!response.ok) {
    throw new Error(`${method} ${url} failed ${response.status}: ${text}`);
  }
  return { response, payload };
}

async function rest(table, query = "", options = {}) {
  return request(`${apiUrl}/rest/v1/${table}${query ? `?${query}` : ""}`, {
    ...options,
    headers: {
      Prefer: options.method === "POST" ? "return=representation" : "return=minimal",
      ...(options.headers || {}),
    },
  });
}

async function fn(path, { method = "GET", body, token, expected } = {}) {
  return request(`${commerceUrl}/${path}`, {
    method,
    body,
    key: anonKey,
    token: token || null,
    expected,
  });
}

async function createUser(email) {
  const password = "Commerce-R1-local-42!";
  const created = await request(`${apiUrl}/auth/v1/admin/users`, {
    method: "POST",
    body: { email, password, email_confirm: true },
  });
  const login = await request(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    body: { email, password },
    key: anonKey,
    token: anonKey,
  });
  return { id: created.payload.id, token: login.payload.access_token, email };
}

function cartItems(productId, activityId, date, racketId, quantity = 0) {
  const items = [{ product_id: productId, quantity: 1, activity_session_id: activityId, session_date: date }];
  if (quantity > 0) items.push({ product_id: racketId, quantity, parent_product_id: productId });
  return items;
}

async function createCart({ venueId = ids.venue, productId = ids.participation, activityId = ids.activity, date = today, racketId = ids.racket, quantity = 0, email, name, token, scope }) {
  return (await fn("cart", {
    method: "POST",
    token,
    body: {
      venue_id: venueId,
      source: "commerce_r1_e2e",
      items: cartItems(productId, activityId, date, racketId, quantity),
      ...(email ? { guest_email: email } : {}),
      ...(name ? { guest_name: name } : {}),
      ...(scope ? { draft_scope: scope } : {}),
      journey_id: crypto.randomBytes(32).toString("hex"),
    },
  })).payload;
}

async function checkout(cart, { email, name, token } = {}) {
  return (await fn("checkout", {
    method: "POST",
    token,
    body: {
      token: cart.cart_token,
      expected_version: cart.order.version,
      guest_email: email || null,
      guest_name: name || null,
      journey_id: crypto.randomBytes(32).toString("hex"),
      success_path: `/commerce/confirmed?token=${encodeURIComponent(cart.cart_token)}`,
      cancel_path: "/today",
    },
  })).payload;
}

function stripeSignature(body) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac("sha256", webhookSecret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

async function signedWebhook(event, expected = 200) {
  const body = JSON.stringify(event);
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
  const text = await response.text();
  assert(response.status === expected, `webhook ${event.type} failed ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

function checkoutEvent({ eventId, sessionId, orderId, version, amount, email, name, paymentIntent }) {
  return {
    id: eventId,
    type: "checkout.session.completed",
    data: { object: {
      id: sessionId,
      amount_total: amount,
      currency: "sek",
      payment_intent: paymentIntent,
      payment_method_types: ["card"],
      customer_details: { email, name, phone: null },
      metadata: { commerce_order_id: orderId, commerce_order_version: String(version) },
    } },
  };
}

async function seed() {
  const org = (await rest("organizations", "slug=eq.pickla&select=id")).payload[0];
  assert(org?.id, "local pickla organization missing");
  await rest("venues", "", { method: "POST", body: [
    { id: ids.venue, organization_id: org.id, name: "Commerce R1 API Venue", slug: "commerce-r1-api", commerce_enabled: true },
    { id: ids.capacityVenue, organization_id: org.id, name: "Commerce R1 Capacity Venue", slug: "commerce-r1-capacity", commerce_enabled: true },
  ] });
  await rest("activity_sessions", "", { method: "POST", body: [
    { id: ids.activity, venue_id: ids.venue, name: "Open Play R1", session_type: "open_play", sport_type: "pickleball", recurrence_days: [0,1,2,3,4,5,6], start_time: "00:01", end_time: "00:00", price_sek: 165, capacity: 8, product_key: "r1_open_play", access_policy: { allows_day_access: true }, publish_status: "published" },
    { id: ids.futureActivity, venue_id: ids.venue, name: "Future Open Play R1", session_type: "open_play", sport_type: "pickleball", recurrence_days: [0,1,2,3,4,5,6], start_time: "10:00", end_time: "12:00", price_sek: 165, capacity: 8, product_key: "r1_open_play", access_policy: { allows_day_access: true }, publish_status: "published" },
    { id: ids.capacityActivity, venue_id: ids.capacityVenue, name: "Capacity One R1", session_type: "open_play", sport_type: "pickleball", recurrence_days: [0,1,2,3,4,5,6], start_time: "10:00", end_time: "12:00", price_sek: 165, capacity: 1, product_key: "r1_capacity_play", access_policy: { allows_day_access: true }, publish_status: "published" },
  ] });
  await rest("access_products", "", { method: "POST", body: [
    { id: ids.participation, venue_id: ids.venue, product_key: "r1_open_play", name: "Open Play R1", product_kind: "session_ticket", session_type: "open_play", commerce_kind: "participation", fulfillment_type: "participation", fulfillment_presentation: "participation", base_price_sek: 165, vat_rate: 6, resolver_rules: {}, commerce_enabled: true, status: "active", is_active: true, standalone_enabled: false, activity_addon_enabled: false },
    { id: ids.dayPass, venue_id: ids.venue, product_key: "day_access", name: "Heldagspass", product_kind: "day_access", session_type: null, commerce_kind: "participation", fulfillment_type: "participation", fulfillment_presentation: "participation", base_price_sek: 237, vat_rate: 6, resolver_rules: { entitlement_type: "day_access", includes_session_types: ["open_play"] }, commerce_enabled: true, status: "active", is_active: true, standalone_enabled: false, activity_addon_enabled: false },
    { id: ids.racket, venue_id: ids.venue, product_key: "r1_rental_racket", name: "Hyrrack", product_kind: "rental", session_type: null, commerce_kind: "rental", fulfillment_type: "desk_pickup", fulfillment_presentation: "desk_pickup", base_price_sek: 50, vat_rate: 6, resolver_rules: { max_quantity: 3 }, commerce_enabled: true, status: "active", is_active: true, standalone_enabled: false, activity_addon_enabled: true },
    { id: ids.capacityParticipation, venue_id: ids.capacityVenue, product_key: "r1_capacity_play", name: "Capacity One R1", product_kind: "session_ticket", session_type: "open_play", commerce_kind: "participation", fulfillment_type: "participation", fulfillment_presentation: "participation", base_price_sek: 165, vat_rate: 6, resolver_rules: {}, commerce_enabled: true, status: "active", is_active: true, standalone_enabled: false, activity_addon_enabled: false },
    { id: ids.capacityRacket, venue_id: ids.capacityVenue, product_key: "r1_capacity_racket", name: "Hyrrack", product_kind: "rental", session_type: null, commerce_kind: "rental", fulfillment_type: "desk_pickup", fulfillment_presentation: "desk_pickup", base_price_sek: 50, vat_rate: 6, resolver_rules: {}, commerce_enabled: true, status: "active", is_active: true, standalone_enabled: false, activity_addon_enabled: true },
  ] });
  await rest("product_relationships", "", { method: "POST", body: [
    { venue_id: ids.venue, source_product_id: ids.participation, target_product_id: ids.racket, relationship_type: "offered_with", is_active: true, sort_order: 10 },
    { venue_id: ids.capacityVenue, source_product_id: ids.capacityParticipation, target_product_id: ids.capacityRacket, relationship_type: "offered_with", is_active: true, sort_order: 10 },
  ] });
}

await seed();
pass("fixture", "local venue, activities and products seeded");

const member = await createUser("member@commerce-r1.local");
const attacker = await createUser("attacker@commerce-r1.local");
const currentScope = `activity:${ids.activity}:${today}`;
const memberCart = await createCart({ token: member.token, scope: currentScope, quantity: 1 });
assert(memberCart.order.draft_scope === currentScope, "authenticated draft scope missing");
assert(memberCart.lines.find((line) => line.product_id === ids.racket)?.quantity === 1, "Hyrrack quantity 1 missing");
const resumed = (await fn(`draft?venueId=${ids.venue}&scope=${encodeURIComponent(currentScope)}`, { token: member.token })).payload;
assert(resumed.order.id === memberCart.order.id, "draft did not resume after reload");
const updated = await createCart({ token: member.token, scope: currentScope, quantity: 2 });
assert(updated.order.id === memberCart.order.id, "draft update created a second order");
assert(updated.lines.find((line) => line.product_id === ids.racket)?.quantity === 2, "draft quantity did not persist");
const activeDrafts = (await rest("commerce_orders", `venue_id=eq.${ids.venue}&user_id=eq.${member.id}&draft_scope=eq.${encodeURIComponent(currentScope)}&status=eq.draft&select=id`)).payload;
assert(activeDrafts.length === 1, "more than one active draft exists");
await fn(`order?token=${memberCart.order.id}`, { token: attacker.token, expected: 403 });
pass("R1A draft", "resume, quantity update, uniqueness and owner isolation");

const secondScope = `activity:${ids.futureActivity}:${tomorrow}`;
const concurrent = await Promise.allSettled([
  createCart({ token: member.token, scope: secondScope, activityId: ids.futureActivity, date: tomorrow, quantity: 0 }),
  createCart({ token: member.token, scope: secondScope, activityId: ids.futureActivity, date: tomorrow, quantity: 1 }),
]);
assert(concurrent.some((item) => item.status === "fulfilled"), "concurrent draft creation produced no usable draft");
const concurrentDrafts = (await rest("commerce_orders", `venue_id=eq.${ids.venue}&user_id=eq.${member.id}&draft_scope=eq.${encodeURIComponent(secondScope)}&status=eq.draft&select=id`)).payload;
assert(concurrentDrafts.length === 1, "concurrent draft creation escaped uniqueness");
await rest("commerce_orders", `id=eq.${concurrentDrafts[0].id}`, { method: "PATCH", body: { expires_at: new Date(Date.now() - 1000).toISOString() } });
await fn(`draft?venueId=${ids.venue}&scope=${encodeURIComponent(secondScope)}`, { token: member.token, expected: 404 });
const stale = (await rest("commerce_orders", `id=eq.${concurrentDrafts[0].id}&select=status`)).payload[0];
assert(stale.status === "expired", "stale draft was not expired lazily");
pass("R1A boundaries", "separate scope, concurrent create and stale expiry");

const noAddon = await createCart({ token: attacker.token, scope: `activity:${ids.futureActivity}:${tomorrow}`, activityId: ids.futureActivity, date: tomorrow });
const noAddonResolved = (await fn("resolve", { method: "POST", token: attacker.token, body: { token: noAddon.cart_token } })).payload;
assert(noAddonResolved.lines.length === 1 && noAddonResolved.lines[0].unit_price_minor === 16500, "no-add-on server price is wrong");
await rest("access_products", `id=eq.${ids.racket}`, { method: "PATCH", body: { is_active: false } });
  await fn("cart", { method: "POST", expected: 400, body: { venue_id: ids.venue, source: "unavailable_test", guest_email: "unavailable@commerce-r1.local", guest_name: "Unavailable", items: cartItems(ids.participation, ids.activity, today, ids.racket, 1) } });
await rest("access_products", `id=eq.${ids.racket}`, { method: "PATCH", body: { is_active: true } });
await fn(`catalog?venueId=00000000-0000-4000-8000-000000000000`, { expected: 404 });
pass("R1A price/catalog", "no-add-on server price and unavailable/catalog failures");

await fn("event", { method: "POST", body: { event_name: "activity_sheet_opened", venue_id: ids.venue, activity_session_id: ids.activity, journey_id: crypto.randomBytes(32).toString("hex") } });
await fn("event", { method: "POST", body: { event_name: "logged_out_cta_clicked", venue_id: ids.venue, activity_session_id: ids.activity, journey_id: crypto.randomBytes(32).toString("hex") } });
const guestEmail = "guest@commerce-r1.local";
const guestName = "Guest R1";
const guestCart = await createCart({ email: guestEmail, name: guestName, quantity: 1 });
assert(guestCart.cart_token.length >= 43, "cart token is not 32-byte base64url entropy");
assert(!JSON.stringify(guestCart).includes(guestEmail) && !JSON.stringify(guestCart).includes(guestName), "guest PII leaked in cart response");
const guestResolved = (await fn("resolve", { method: "POST", body: { token: guestCart.cart_token } })).payload;
assert(guestResolved.lines.reduce((sum, line) => sum + line.unit_price_minor * line.quantity, 0) === 21500, "guest server total is not 215 kr");
const guestCheckout = await checkout(guestCart, { email: guestEmail, name: guestName });
const guestSession = new URL(guestCheckout.url).searchParams.get("session");
assert(guestSession, "fake Checkout session missing");
const guestCompleted = checkoutEvent({ eventId: "evt_r1_guest_complete", sessionId: guestSession, orderId: guestCheckout.order_id, version: guestCheckout.version, amount: 21500, email: guestEmail, name: guestName, paymentIntent: "pi_r1_guest" });
await signedWebhook(guestCompleted);
const duplicate = await signedWebhook(guestCompleted);
assert(duplicate.duplicate === true, "duplicate webhook was not acknowledged idempotently");
const guestOrder = (await rest("commerce_orders", `id=eq.${guestCheckout.order_id}&select=id,status,customer_id,booking_receipt_id`)).payload[0];
const guestRegistrations = (await rest("session_registrations", `source_type=eq.commerce_order&select=id,customer_id,user_id,status`)).payload;
const guestRegistration = guestRegistrations.find((row) => row.customer_id === guestOrder.customer_id);
assert(guestOrder.status === "paid" && guestOrder.booking_receipt_id, "guest payment did not finalize receipt/order");
assert(guestRegistration && guestRegistration.status === "confirmed", "guest participant was not created exactly once");
assert(guestRegistrations.filter((row) => row.customer_id === guestOrder.customer_id).length === 1, "duplicate participant exists");
const guestParticipationLine = (await rest("commerce_order_lines", `commerce_order_id=eq.${guestCheckout.order_id}&commerce_kind=eq.participation&select=capacity_hold_id`)).payload[0];
const guestRacketLine = (await rest("commerce_order_lines", `commerce_order_id=eq.${guestCheckout.order_id}&commerce_kind=eq.rental&select=quantity,fulfillment_status,product_snapshot`)).payload[0];
assert(guestRacketLine.quantity === 1 && guestRacketLine.fulfillment_status === "pending_pickup", "Hyrrack quantity or pickup state missing");
assert(guestRacketLine.product_snapshot?.customer_instruction_code === "desk_pickup_racket_by_name", "Hyrrack instruction was not retained");
const guestHold = (await rest("capacity_holds", `id=eq.${guestParticipationLine.capacity_hold_id}&select=status,customer_id`)).payload[0];
assert(guestHold.status === "committed" && guestHold.customer_id === guestOrder.customer_id, "guest hold did not share canonical customer");
pass("R1B purchase", "one order, hold, participant and receipt after duplicate webhook");

const claimed = (await fn("claim", { method: "POST", body: { token: guestCart.cart_token, display_name: "Ada R1" } })).payload;
assert(claimed.order.guest_claimed === true, "display name claim did not issue ticket");
const checkedIn = (await fn("guest-checkin", { method: "POST", body: { token: guestCart.cart_token } })).payload;
assert(checkedIn.checked_in === true, "guest ticket check-in failed across midnight end");
await fn("claim-account", { method: "POST", token: attacker.token, expected: 403, body: { token: guestCart.cart_token } });
const guestAccount = await createUser(guestEmail);
const accountClaim = (await fn("claim-account", { method: "POST", token: guestAccount.token, body: { token: guestCart.cart_token } })).payload;
assert(accountClaim.order.account_claimed === true, "account was not activated after purchase");
const history = (await fn("my-orders", { token: guestAccount.token })).payload;
assert(history.orders.some((order) => order.id === guestCheckout.order_id), "claimed order missing from account history");
const startedManagement = (await fn(`registration-order?registrationId=${guestRegistration.id}`, { token: guestAccount.token })).payload;
assert(startedManagement.state === "started" && startedManagement.policy === "before_activity_start", "started activity cancellation policy is not enforced");
await fn("claim-account", { method: "POST", token: attacker.token, expected: 403, body: { token: guestCart.cart_token } });
pass("R1B claim", "name, ticket, check-in, anti-hijack, account activation and history");

const dayPassEmail = "daypass@commerce-r1.local";
const dayPassCart = await createCart({ productId: ids.dayPass, email: dayPassEmail, name: "Day Pass Guest" });
const dayPassResolved = (await fn("resolve", { method: "POST", body: { token: dayPassCart.cart_token } })).payload;
assert(dayPassResolved.lines.length === 1, "day pass was mixed with an activity ticket");
assert(dayPassResolved.lines[0].unit_price_minor === 23700, "day pass did not use the exact configured Admin price");
assert(dayPassResolved.lines[0].resolver_snapshot?.purchase_kind === "day_pass", "day pass line type is not authoritative");
const dayPassCheckout = await checkout(dayPassCart, { email: dayPassEmail, name: "Day Pass Guest" });
const dayPassSession = new URL(dayPassCheckout.url).searchParams.get("session");
await signedWebhook(checkoutEvent({ eventId: "evt_r1_day_pass", sessionId: dayPassSession, orderId: dayPassCheckout.order_id, version: dayPassCheckout.version, amount: 23700, email: dayPassEmail, name: "Day Pass Guest", paymentIntent: "pi_r1_day_pass" }));
await signedWebhook(checkoutEvent({ eventId: "evt_r1_day_pass_duplicate", sessionId: dayPassSession, orderId: dayPassCheckout.order_id, version: dayPassCheckout.version, amount: 23700, email: dayPassEmail, name: "Day Pass Guest", paymentIntent: "pi_r1_day_pass" }));
const dayPassOrder = (await rest("commerce_orders", `id=eq.${dayPassCheckout.order_id}&select=id,status,customer_id,booking_receipt_id`)).payload[0];
const dayPassRecord = (await rest("day_passes", `commerce_order_id=eq.${dayPassCheckout.order_id}&select=id,user_id,customer_id,valid_date,price,status`)).payload;
const dayAccess = (await rest("access_entitlements", `source_type=eq.commerce_order&source_id=eq.${dayPassCheckout.order_id}&select=id,user_id,customer_id,entitlement_type,valid_date,status`)).payload;
const ordinaryTicket = (await rest("access_entitlements", `source_type=eq.session_ticket&metadata->>commerce_order_id=eq.${dayPassCheckout.order_id}&select=id`)).payload;
assert(dayPassOrder.status === "paid" && dayPassOrder.booking_receipt_id, "day pass receipt/order did not finalize");
assert(dayPassRecord.length === 1 && Number(dayPassRecord[0].price) === 237 && dayPassRecord[0].valid_date === today, "canonical day pass record is wrong or duplicated");
assert(dayAccess.length === 1 && dayAccess[0].entitlement_type === "day_access" && dayAccess[0].valid_date === today, "day access entitlement is wrong or duplicated");
assert(ordinaryTicket.length === 0, "day pass incorrectly delivered an ordinary session ticket");
await fn("claim", { method: "POST", body: { token: dayPassCart.cart_token, display_name: "Day Pass Guest" } });
const dayPassGuestCheckin = (await fn("guest-checkin", { method: "POST", body: { token: dayPassCart.cart_token } })).payload;
assert(dayPassGuestCheckin.checked_in === true, "account-later day access check-in failed");
const dayPassAccount = await createUser(dayPassEmail);
await fn("claim-account", { method: "POST", token: dayPassAccount.token, body: { token: dayPassCart.cart_token } });
const claimedDayPass = (await rest("day_passes", `commerce_order_id=eq.${dayPassCheckout.order_id}&select=user_id`)).payload[0];
assert(claimedDayPass.user_id === dayPassAccount.id, "day pass did not move into account history");
await signedWebhook({ id: "evt_r1_day_pass_refund", type: "charge.refunded", data: { object: { id: "ch_r1_day_pass", payment_intent: "pi_r1_day_pass", amount: 23700, amount_refunded: 23700 } } });
const revokedDayPass = (await rest("day_passes", `commerce_order_id=eq.${dayPassCheckout.order_id}&select=status`)).payload[0];
const revokedDayAccess = (await rest("access_entitlements", `source_type=eq.commerce_order&source_id=eq.${dayPassCheckout.order_id}&select=status`)).payload[0];
assert(revokedDayPass.status === "cancelled" && revokedDayAccess.status === "revoked", "day pass refund did not revoke access");
pass("R1 day pass", "configured quote, guest purchase, idempotent delivery, check-in, account history and refund revocation");

const failCart = await createCart({ email: "fail-payment@commerce-r1.local", name: "Payment Failure" });
await fn("checkout", { method: "POST", expected: 400, body: { token: failCart.cart_token, expected_version: failCart.order.version, guest_email: "fail-payment@commerce-r1.local", guest_name: "Payment Failure" } });
const failedOrder = (await rest("commerce_orders", `id=eq.${failCart.order.id}&select=status`)).payload[0];
assert(failedOrder.status === "draft", "failed payment did not reopen cart");
pass("R1B payment failure", "cart reopened and hold released");

const abandonCart = await createCart({ email: "abandon@commerce-r1.local", name: "Abandon R1", activityId: ids.futureActivity, date: tomorrow });
const abandonCheckout = await checkout(abandonCart, { email: "abandon@commerce-r1.local", name: "Abandon R1" });
const abandonSession = new URL(abandonCheckout.url).searchParams.get("session");
await signedWebhook({ id: "evt_r1_abandoned", type: "checkout.session.expired", data: { object: { id: abandonSession, metadata: { commerce_order_id: abandonCheckout.order_id } } } });
const abandoned = (await rest("commerce_orders", `id=eq.${abandonCheckout.order_id}&select=status`)).payload[0];
assert(abandoned.status === "expired", "abandoned checkout did not expire order");
pass("R1B abandon", "order expired and hold released");

const soldA = await createCart({ venueId: ids.capacityVenue, productId: ids.capacityParticipation, activityId: ids.capacityActivity, date: tomorrow, racketId: ids.capacityRacket, email: "sold-a@commerce-r1.local", name: "Sold A" });
const soldACheckout = await checkout(soldA, { email: "sold-a@commerce-r1.local", name: "Sold A" });
const soldB = await createCart({ venueId: ids.capacityVenue, productId: ids.capacityParticipation, activityId: ids.capacityActivity, date: tomorrow, racketId: ids.capacityRacket, email: "sold-b@commerce-r1.local", name: "Sold B" });
await fn("checkout", { method: "POST", expected: 409, body: { token: soldB.cart_token, expected_version: soldB.order.version, guest_email: "sold-b@commerce-r1.local", guest_name: "Sold B" } });
const soldALine = (await rest("commerce_order_lines", `commerce_order_id=eq.${soldACheckout.order_id}&commerce_kind=eq.participation&select=capacity_hold_id`)).payload[0];
const soldAHold = (await rest("capacity_holds", `id=eq.${soldALine.capacity_hold_id}&select=id`)).payload[0];
await rest("capacity_holds", `id=eq.${soldAHold.id}`, { method: "PATCH", body: { expires_at: new Date(Date.now() - 1000).toISOString() } });
const soldBCheckout = await checkout(soldB, { email: "sold-b@commerce-r1.local", name: "Sold B" });
assert(soldBCheckout.url, "stale hold was not lazily released");
const soldASession = new URL(soldACheckout.url).searchParams.get("session");
await signedWebhook(checkoutEvent({ eventId: "evt_r1_sold_during_checkout", sessionId: soldASession, orderId: soldACheckout.order_id, version: soldACheckout.version, amount: 16500, email: "sold-a@commerce-r1.local", name: "Sold A", paymentIntent: "pi_r1_sold_a" }));
const soldAOrder = (await rest("commerce_orders", `id=eq.${soldACheckout.order_id}&select=status`)).payload[0];
assert(soldAOrder.status === "attention", "paid sold-out conflict was not moved to attention");
const soldBSession = new URL(soldBCheckout.url).searchParams.get("session");
await signedWebhook({ id: "evt_r1_sold_b_expired", type: "checkout.session.expired", data: { object: { id: soldBSession, metadata: { commerce_order_id: soldBCheckout.order_id } } } });
pass("R1B capacity failures", "sold out, stale hold and paid conflict attention path");

const existing = await createUser("existing@commerce-r1.local");
const cancelCart = await createCart({ email: existing.email, name: "Existing R1", activityId: ids.futureActivity, date: tomorrow, quantity: 1 });
const cancelCheckout = await checkout(cancelCart, { email: existing.email, name: "Existing R1" });
const cancelSession = new URL(cancelCheckout.url).searchParams.get("session");
await signedWebhook(checkoutEvent({ eventId: "evt_r1_cancel_complete", sessionId: cancelSession, orderId: cancelCheckout.order_id, version: cancelCheckout.version, amount: 21500, email: existing.email, name: "Existing R1", paymentIntent: "pi_r1_cancel" }));
await fn("claim", { method: "POST", body: { token: cancelCart.cart_token, display_name: "Existing R1" } });
await fn("claim-account", { method: "POST", token: existing.token, body: { token: cancelCart.cart_token } });
const cancelRegistration = (await rest("session_registrations", `source_type=eq.commerce_order&stripe_session_id=eq.${cancelSession}&select=id`)).payload[0];
await fn(`registration-order?registrationId=${cancelRegistration.id}`, { token: attacker.token, expected: 403 });
const paidManagement = (await fn(`registration-order?registrationId=${cancelRegistration.id}`, { token: existing.token })).payload;
assert(paidManagement.state === "paid" && paidManagement.order_id === cancelCheckout.order_id, "account-owned paid cancellation state is wrong");
await rest("commerce_orders", `id=eq.${cancelCheckout.order_id}`, { method: "PATCH", body: { status: "attention" } });
const attentionManagement = (await fn(`registration-order?registrationId=${cancelRegistration.id}`, { token: existing.token })).payload;
assert(attentionManagement.state === "attention", "manual-attention cancellation state is wrong");
await fn("cancel", { method: "POST", token: existing.token, expected: 409, body: { reference: paidManagement.order_id } });
await rest("commerce_orders", `id=eq.${cancelCheckout.order_id}`, { method: "PATCH", body: { status: "paid" } });
const cancellation = (await fn("cancel", { method: "POST", token: existing.token, body: { reference: paidManagement.order_id } })).payload;
assert(cancellation.cancellation_pending === true, "paid cancellation did not request refund");
const repeatedCancellation = (await fn("cancel", { method: "POST", token: existing.token, body: { reference: paidManagement.order_id } })).payload;
assert(repeatedCancellation.cancellation_pending === true, "repeated cancellation was not idempotent");
const pendingManagement = (await fn(`registration-order?registrationId=${cancelRegistration.id}`, { token: existing.token })).payload;
assert(pendingManagement.state === "refund_pending", "refund pending state did not survive refresh");
const refundEvent = { id: "evt_r1_refund", type: "charge.refunded", data: { object: { id: "ch_r1_cancel", payment_intent: "pi_r1_cancel", amount: 21500, amount_refunded: 21500 } } };
await signedWebhook(refundEvent);
await signedWebhook(refundEvent);
const cancelledOrder = (await rest("commerce_orders", `id=eq.${cancelCheckout.order_id}&select=status,booking_receipt_id`)).payload[0];
const cancelledReceipt = (await rest("booking_receipts", `id=eq.${cancelledOrder.booking_receipt_id}&select=payment_status`)).payload[0];
const cancelledPickup = (await rest("commerce_order_lines", `commerce_order_id=eq.${cancelCheckout.order_id}&fulfillment_type=eq.desk_pickup&select=fulfillment_status`)).payload;
const refundLedger = (await rest("ledger_entries", `venue_id=eq.${ids.venue}&source_type=eq.commerce_refund&source_id=eq.${cancelCheckout.order_id}&select=id`)).payload;
assert(cancelledOrder.status === "cancelled" && cancelledReceipt.payment_status === "refunded" && refundLedger.length === 1, "refund did not cancel exactly once");
assert(cancelledPickup.length === 1 && cancelledPickup.every((line) => line.fulfillment_status === "not_collected"), "refunded pickup item remained collectable");
const refundedManagement = (await fn(`registration-order?registrationId=${cancelRegistration.id}`, { token: existing.token })).payload;
assert(refundedManagement.state === "refunded", "refunded state is not exposed in My Page contract");
pass("R1B cancellation/refund", "future cancellation, full refund and duplicate event idempotency");

const freeUser = await createUser("free-cancel@commerce-r1.local");
await rest("activity_sessions", `id=eq.${ids.futureActivity}`, { method: "PATCH", body: { price_sek: 0 } });
await rest("access_products", `id=eq.${ids.participation}`, { method: "PATCH", body: { base_price_sek: 0 } });
const freeCart = await createCart({ token: freeUser.token, scope: `activity:${ids.futureActivity}:${tomorrow}`, activityId: ids.futureActivity, date: tomorrow });
const freeCheckout = await checkout(freeCart, { token: freeUser.token });
assert(freeCheckout.free === true, "zero-price Commerce registration did not bypass Stripe");
const freeLine = (await rest("commerce_order_lines", `commerce_order_id=eq.${freeCheckout.order_id}&commerce_kind=eq.participation&select=session_registration_id`)).payload[0];
const freeManagement = (await fn(`registration-order?registrationId=${freeLine.session_registration_id}`, { token: freeUser.token })).payload;
assert(freeManagement.state === "free", "free cancellation state is wrong");
const freeCancelled = (await fn("cancel", { method: "POST", token: freeUser.token, body: { reference: freeManagement.order_id } })).payload;
assert(freeCancelled.order.status === "cancelled", "free cancellation did not complete immediately");
const freeCancelledAgain = (await fn("cancel", { method: "POST", token: freeUser.token, body: { reference: freeManagement.order_id } })).payload;
assert(freeCancelledAgain.order.status === "cancelled", "free repeated cancellation was not idempotent");
const cancelledManagement = (await fn(`registration-order?registrationId=${freeLine.session_registration_id}`, { token: freeUser.token })).payload;
assert(cancelledManagement.state === "cancelled", "cancelled state did not survive refresh");
const freeRegistration = (await rest("session_registrations", `id=eq.${freeLine.session_registration_id}&select=status`)).payload[0];
const freeEntitlement = (await rest("access_entitlements", `source_type=eq.session_ticket&source_id=eq.${freeLine.session_registration_id}&select=status`)).payload[0];
assert(freeRegistration.status === "cancelled" && freeEntitlement.status === "revoked", "free cancellation left registration or entitlement active");
await rest("activity_sessions", `id=eq.${ids.futureActivity}`, { method: "PATCH", body: { price_sek: 165 } });
await rest("access_products", `id=eq.${ids.participation}`, { method: "PATCH", body: { base_price_sek: 165 } });
pass("R1 free cancellation", "immediate cancellation, entitlement revocation and repeated-click idempotency");

await rest("commerce_orders", `id=eq.${guestCheckout.order_id}`, { method: "PATCH", body: { claim_expires_at: new Date(Date.now() - 1000).toISOString() } });
await fn("claim", { method: "POST", token: guestAccount.token, expected: 410, body: { token: guestCart.cart_token, display_name: "Expired" } });
const analytics = (await rest("commerce_events", `venue_id=eq.${ids.venue}&select=event_name,journey_id_hash,duration_ms,metadata`)).payload;
const analyticsJson = JSON.stringify(analytics);
for (const eventName of ["activity_sheet_opened", "logged_out_cta_clicked", "checkout_started", "guest_purchase_succeeded", "checkout_abandoned", "claim_completed", "account_activated"]) {
  assert(analytics.some((event) => event.event_name === eventName), `missing analytics event ${eventName}`);
}
assert(!analyticsJson.includes("@commerce-r1.local") && !analyticsJson.includes("Ada R1"), "analytics contains PII");
assert(analytics.some((event) => event.event_name === "account_activated" && typeof event.duration_ms === "number" && "within_7d" in event.metadata && "within_30d" in event.metadata), "account conversion timing missing");
pass("R1B security/observability", "expired claim and privacy-safe funnel timings");

process.stdout.write(`COMMERCE_R1_API_E2E_OK ${results.length} groups\n`);
