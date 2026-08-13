import crypto from "node:crypto";

const apiUrl = process.env.API_URL || "http://127.0.0.1:54321";
const courseUrl = process.env.COURSE_FUNCTION_URL || "http://127.0.0.1:8000";
const commerceUrl = process.env.COMMERCE_FUNCTION_URL || "http://127.0.0.1:8001";
const webhookUrl = process.env.COMMERCE_WEBHOOK_URL || "http://127.0.0.1:8002";
const checkinsUrl = process.env.CHECKINS_FUNCTION_URL || "http://127.0.0.1:8003";
const anonKey = process.env.ANON_KEY;
const serviceKey = process.env.SERVICE_ROLE_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "whsec_commerce_r1_local";

if (!anonKey || !serviceKey || !apiUrl.startsWith("http://127.0.0.1")) {
  throw new Error("Course V1 E2E only runs against local Supabase");
}

const run = crypto.randomBytes(5).toString("hex");
const ids = { venue: crypto.randomUUID(), court: crypto.randomUUID(), court2: crypto.randomUUID() };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pass(name, detail = "ok") {
  process.stdout.write(`PASS ${name}: ${detail}\n`);
}

async function request(url, { method = "GET", body, rawBody, key = serviceKey, token, expected, headers = {} } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      apikey: key,
      ...(token === null ? {} : { Authorization: `Bearer ${token || key}` }),
      ...(body === undefined && rawBody === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: rawBody === undefined ? (body === undefined ? undefined : JSON.stringify(body)) : rawBody,
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  const accepted = expected === undefined ? null : Array.isArray(expected) ? expected : [expected];
  if (accepted ? !accepted.includes(response.status) : !response.ok) {
    throw new Error(`${method} ${url} failed ${response.status}: ${text}`);
  }
  return { response, payload };
}

async function rest(table, query = "", options = {}) {
  return request(`${apiUrl}/rest/v1/${table}${query ? `?${query}` : ""}`, {
    ...options,
    headers: {
      ...(options.method === "POST" ? { Prefer: "return=representation" } : {}),
      ...(options.headers || {}),
    },
  });
}

async function course(path, options = {}) {
  return request(`${courseUrl}/${path}`, { key: anonKey, token: options.token ?? null, ...options });
}

async function commerce(path, options = {}) {
  return request(`${commerceUrl}/${path}`, { key: anonKey, token: options.token ?? null, ...options });
}

async function createUser(label, prefix = "course") {
  const email = `${prefix}-${label}-${run}@example.test`;
  const password = "Course-local-42!";
  const created = await request(`${apiUrl}/auth/v1/admin/users`, {
    method: "POST",
    body: { email, password, email_confirm: true },
  });
  const login = await request(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    key: anonKey,
    token: anonKey,
    body: { email, password },
  });
  return { id: created.payload.id, token: login.payload.access_token, email };
}

function stripeSignature(rawBody) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac("sha256", webhookSecret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

async function webhook(event, expected = 200) {
  const rawBody = JSON.stringify(event);
  return request(webhookUrl, {
    method: "POST",
    key: anonKey,
    token: anonKey,
    expected,
    headers: { "content-type": "application/json", "stripe-signature": stripeSignature(rawBody) },
    rawBody,
  });
}

function checkoutEvent({ id, sessionId, orderId, version, email, amount = 149500 }) {
  return {
    id,
    type: "checkout.session.completed",
    data: { object: {
      id: sessionId,
      amount_total: amount,
      amount_subtotal: amount,
      currency: "sek",
      payment_status: "paid",
      payment_intent: `pi_${run}_${orderId.slice(0, 6)}`,
      customer_details: { email, name: "Course Payer", phone: null },
      metadata: { commerce_order_id: orderId, commerce_order_version: String(version) },
    } },
  };
}

async function checkoutCourse({ seriesId, user, participant }) {
  const cart = (await commerce("course-cart", {
    method: "POST",
    token: user.token,
    body: { series_id: seriesId, ...participant },
  })).payload;
  const checkout = (await commerce("checkout", {
    method: "POST",
    token: user.token,
    body: {
      token: cart.cart_token,
      expected_version: cart.order.version,
      journey_id: crypto.randomBytes(24).toString("hex"),
      success_path: `/commerce/confirmed?token=${encodeURIComponent(cart.cart_token)}`,
      cancel_path: `/course/${seriesId}`,
    },
  })).payload;
  const order = (await rest("commerce_orders", `id=eq.${checkout.order_id}&select=id,version,stripe_session_id,status,total_inc_vat_minor`)).payload[0];
  return { cart, checkout, order };
}

const organization = (await rest("organizations", "slug=eq.pickla&select=id")).payload[0];
assert(organization?.id, "local Pickla organization missing");
await rest("venues", "", { method: "POST", body: {
  id: ids.venue,
  organization_id: organization.id,
  name: "Course V1 API Venue",
  slug: `course-v1-${run}`,
  commerce_enabled: true,
} });
await rest("venue_courts", "", { method: "POST", body: [
  { id: ids.court, venue_id: ids.venue, name: "Bana 3", court_number: 3, sport_type: "pickleball", is_available: true },
  { id: ids.court2, venue_id: ids.venue, name: "Bana 4", court_number: 4, sport_type: "pickleball", is_available: true },
] });

const operator = await createUser("operator");
const payer = await createUser("payer");
const guardian = await createUser("guardian");
const finalSeatA = await createUser("final-a");
const finalSeatB = await createUser("final-b");
const failing = await createUser("payment", "fail");
await rest("venue_staff", "", { method: "POST", body: {
  venue_id: ids.venue,
  user_id: operator.id,
  role: "venue_admin",
  is_active: true,
} });

const format = (await course("format", {
  method: "POST",
  token: operator.token,
  body: {
    venue_id: ids.venue,
    name: `Pickla 101 ${run}`,
    description: "Vuxen nybörjarkurs",
    age_group: "adult",
    level: "beginner",
    requires_instructor: true,
  },
})).payload;
assert(format.name === `Pickla 101 ${run}` && format.requires_instructor === true, "Format was not created canonically");
pass("Format", "minimal reusable taxonomy and instructor requirement");

function seriesBody({ capacity = 12, name = "Pickla 101 · Höst 2026", startTime = "18:00", endTime = "19:00", courtIds = [ids.court] } = {}) {
  return {
    venue_id: ids.venue,
    format_id: format.id,
    name,
    description: "Sex tillfällen med en kursplats för hela serien.",
    start_date: "2026-09-08",
    end_date: "2026-10-13",
    registration_opens_at: "2026-08-01T00:00:00Z",
    registration_closes_at: "2026-09-08T15:30:00Z",
    capacity,
    price_sek: 1495,
    total_sessions: 6,
    recurrence_days: [2],
    start_time: startTime,
    end_time: endTime,
    court_ids: courtIds,
  };
}

async function previewSeries(overrides = {}) {
  return (await course("series-preview", {
    method: "POST",
    token: operator.token,
    body: seriesBody(overrides),
  })).payload;
}

async function createSeries(options = {}) {
  const created = (await course("series", {
    method: "POST",
    token: operator.token,
    body: seriesBody(options),
  })).payload;
  assert(created.sessions.length === 6, "Series did not generate six Sessions");
  assert(created.sessions.every((session) => session.closed_to_public === true && session.requires_staffing === true), "Course Sessions are not closed/staffed");
  await course("series", { method: "PATCH", token: operator.token, body: { series_id: created.series.id, status: "active" } });
  return created;
}

const freePreview = await previewSeries();
assert(freePreview.occurrence_count === 6 && freePreview.rows.length === 6 && freePreview.rows.every((row) => row.is_available), "free Course preview was not fully available");
pass("Course resource preview", "six free occurrences use canonical physical-resource truth");

const created = await createSeries();
const seriesId = created.series.id;
pass("Series generation", "one Series, six closed Sessions, existing staffing projection");

const activityConflict = await previewSeries();
assert(activityConflict.has_conflicts && activityConflict.rows.every((row) => row.conflicts.some((conflict) => conflict.source_type === "activity_session" && conflict.source_id === created.sessions[row.occurrence_index - 1].id)), "existing Activity Session conflict was not projected");

await rest("bookings", "", { method: "POST", body: {
  venue_id: ids.venue,
  venue_court_id: ids.court2,
  user_id: operator.id,
  booked_by: operator.id,
  start_time: "2026-09-22T06:00:00Z",
  end_time: "2026-09-22T07:00:00Z",
  status: "confirmed",
  total_price: 350,
  booking_ref: `COURSE-CONFLICT-${run}`,
} });
const privateConflict = await previewSeries({ startTime: "08:00", endTime: "09:00", courtIds: [ids.court, ids.court2] });
const privateConflictRows = privateConflict.rows.filter((row) => !row.is_available);
assert(privateConflictRows.length === 1 && privateConflictRows[0].occurrence_index === 3 && privateConflictRows[0].court_id === ids.court2 && privateConflictRows[0].conflicts[0].source_type === "booking", "private booking conflict did not identify occurrence 3 and its court");

const seriesBeforeBlockedCreate = (await rest("activity_series", `venue_id=eq.${ids.venue}&series_type=eq.course&select=id`)).payload.length;
const sessionsBeforeBlockedCreate = (await rest("activity_sessions", `venue_id=eq.${ids.venue}&session_type=eq.course&select=id`)).payload.length;
const blockedCreate = await course("series", {
  method: "POST",
  token: operator.token,
  expected: 409,
  body: seriesBody({ name: "Blocked private booking Course", startTime: "08:00", endTime: "09:00", courtIds: [ids.court, ids.court2] }),
});
assert(blockedCreate.payload.code === "course_resource_conflict" && blockedCreate.payload.preview.rows.some((row) => !row.is_available), "blocked Course creation did not return structured conflict data");
assert((await rest("activity_series", `venue_id=eq.${ids.venue}&series_type=eq.course&select=id`)).payload.length === seriesBeforeBlockedCreate, "blocked Course creation left a Series");
assert((await rest("activity_sessions", `venue_id=eq.${ids.venue}&session_type=eq.course&select=id`)).payload.length === sessionsBeforeBlockedCreate, "blocked Course creation partially generated Sessions");
pass("Private booking guard", "occurrence 3/court identified; zero partial Course rows created");

const adjacentPreview = await previewSeries({ startTime: "09:00", endTime: "10:00", courtIds: [ids.court2] });
assert(adjacentPreview.rows.every((row) => row.is_available), "adjacent half-open interval was incorrectly treated as overlap");
pass("Adjacent resource interval", "existing end at Course start remains available");

const eventResource = (await rest("event_resource_catalog", "", { method: "POST", body: {
  venue_id: ids.venue,
  resource_type: "court",
  name: "Bana 4 eventresurs",
  venue_court_id: ids.court2,
  is_active: true,
} })).payload[0];
await rest("event_resource_blocks", "", { method: "POST", body: [
  {
    venue_id: ids.venue, resource_catalog_id: eventResource.id, title: "Corporate Event", reason: "event", status: "confirmed",
    starts_at: "2026-09-29T10:00:00Z", ends_at: "2026-09-29T11:00:00Z", blocks_public_booking: true,
  },
  {
    venue_id: ids.venue, resource_catalog_id: eventResource.id, title: "Underhåll Bana 4", reason: "maintenance", status: "confirmed",
    starts_at: "2026-10-06T12:00:00Z", ends_at: "2026-10-06T13:00:00Z", blocks_public_booking: true,
  },
] });
const eventConflict = await previewSeries({ startTime: "12:00", endTime: "13:00", courtIds: [ids.court2] });
assert(eventConflict.rows.find((row) => row.occurrence_index === 4)?.conflicts.some((conflict) => conflict.source_type === "event_reservation"), "event/resource block was not projected");
const maintenanceConflict = await previewSeries({ startTime: "14:00", endTime: "15:00", courtIds: [ids.court2] });
assert(maintenanceConflict.rows.find((row) => row.occurrence_index === 5)?.conflicts.some((conflict) => conflict.source_type === "resource_block"), "maintenance block was not projected");

await rest("venue_operation_overrides", "", { method: "POST", body: {
  venue_id: ids.venue,
  title: "Driftstopp Bana 4",
  reason: "Test",
  override_type: "maintenance",
  starts_at: "2026-10-13T14:00:00Z",
  ends_at: "2026-10-13T15:00:00Z",
  affects_entire_venue: false,
  status: "active",
  metadata: { venue_court_ids: [ids.court2] },
} });
const operationsConflict = await previewSeries({ startTime: "16:00", endTime: "17:00", courtIds: [ids.court2] });
assert(operationsConflict.rows.find((row) => row.occurrence_index === 6)?.conflicts.some((conflict) => conflict.source_type === "venue_closure"), "operational/maintenance override was not projected");
pass("Operations occupancy sources", "activity, event, resource and maintenance conflicts are canonical");

const concurrentBodies = ["Concurrent Course A", "Concurrent Course B"].map((name) => seriesBody({ name, startTime: "06:00", endTime: "07:00", courtIds: [ids.court2] }));
const concurrentCourseCreates = await Promise.all(concurrentBodies.map((body) => course("series", { method: "POST", token: operator.token, body, expected: [201, 409] })));
assert(concurrentCourseCreates.filter((result) => result.response.status === 201).length === 1 && concurrentCourseCreates.filter((result) => result.response.status === 409).length === 1, "concurrent Course generation created overlapping physical occupancy");
const concurrentWinner = concurrentCourseCreates.find((result) => result.response.status === 201).payload;
assert(concurrentWinner.sessions.length === 6, "concurrent Course winner did not generate atomically");
const concurrentSeriesRows = (await rest("activity_series", `venue_id=eq.${ids.venue}&name=in.(Concurrent%20Course%20A,Concurrent%20Course%20B)&select=id,access_product_id`)).payload;
assert(concurrentSeriesRows.length === 1, "concurrent Course loser left a partial Series");
const concurrentProducts = (await rest("access_products", `venue_id=eq.${ids.venue}&name=in.(Concurrent%20Course%20A,Concurrent%20Course%20B)&select=id`)).payload;
assert(concurrentProducts.length === 1 && concurrentProducts[0].id === concurrentSeriesRows[0].access_product_id, "concurrent Course loser left an orphan product");
pass("Course generation concurrency", "one request wins the resource lock; one receives 409");

const stockholmToday = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const visibilitySessionIds = {
  public: crypto.randomUUID(),
  course: crypto.randomUUID(),
  otherClosed: crypto.randomUUID(),
};
await rest("activity_sessions", "", { method: "POST", body: [
  {
    id: visibilitySessionIds.public,
    venue_id: ids.venue,
    name: "Public self-check-in activity",
    session_type: "open_play",
    sport_type: "pickleball",
    session_date: stockholmToday,
    start_time: "00:01",
    end_time: "23:59",
    price_sek: 165,
    capacity: 8,
    publish_status: "published",
    is_active: true,
    closed_to_public: false,
  },
  {
    id: visibilitySessionIds.course,
    venue_id: ids.venue,
    name: "Closed Course self-check-in activity",
    session_type: "course",
    sport_type: "pickleball",
    session_date: stockholmToday,
    start_time: "00:01",
    end_time: "23:59",
    price_sek: 1495,
    capacity: 12,
    publish_status: "published",
    is_active: true,
    closed_to_public: true,
  },
  {
    id: visibilitySessionIds.otherClosed,
    venue_id: ids.venue,
    name: "Closed non-Course self-check-in activity",
    session_type: "open_play",
    sport_type: "pickleball",
    session_date: stockholmToday,
    start_time: "00:01",
    end_time: "23:59",
    price_sek: 165,
    capacity: 8,
    publish_status: "published",
    is_active: true,
    closed_to_public: true,
  },
] });
const selfCheckin = (await request(`${checkinsUrl}/self`, {
  method: "POST",
  key: anonKey,
  token: finalSeatA.token,
  body: { venue_id: ids.venue },
})).payload;
const activityOptions = (selfCheckin.purchase_options || []).filter((option) => option.type === "activity_ticket");
assert(selfCheckin.allowed === false, "self-check-in visibility fixture unexpectedly granted access");
assert(activityOptions.length === 1, "self-check-in did not offer exactly the one public activity");
assert(activityOptions[0].href.includes(visibilitySessionIds.public), "normal public activity was not offered");
assert(!JSON.stringify(activityOptions).includes(visibilitySessionIds.course), "Course-specific purchase path leaked from self-check-in");
assert(!JSON.stringify(activityOptions).includes(visibilitySessionIds.otherClosed), "other closed activity leaked from self-check-in");
pass("Self check-in public closure", "public activity offered; Course and other closed sessions excluded by canonical visibility");

const detail = (await course(`detail?seriesId=${seriesId}`, { token: null })).payload;
assert(detail.capacity.capacity === 12 && detail.capacity.available_count === 12, "public capacity projection incorrect");
assert(!JSON.stringify(detail).includes("guardian_customer_id"), "public Course detail exposed guardian identity");
const home = (await course(`home?v=${encodeURIComponent(`course-v1-${run}`)}`, { token: null })).payload;
assert(home.mode === "registration" && home.item.id === seriesId, "Home did not project registration deadline truth");
pass("Public/Home projection", "registration deadline and anonymous capacity only");

const adultPurchase = await checkoutCourse({
  seriesId,
  user: payer,
  participant: { participant_type: "adult", participant_name: "Adult Participant", participant_email: `adult-${run}@example.test` },
});
assert(adultPurchase.order.status === "checkout_pending" && adultPurchase.order.total_inc_vat_minor === 149500, "Course checkout did not freeze one upfront order");
await webhook(checkoutEvent({
  id: `evt_course_adult_${run}`,
  sessionId: adultPurchase.order.stripe_session_id,
  orderId: adultPurchase.order.id,
  version: adultPurchase.order.version,
  email: payer.email,
}));

const commitment = (await rest("series_commitments", `activity_series_id=eq.${seriesId}&select=*`)).payload;
const entitlements = (await rest("access_entitlements", `source_type=eq.series_commitment&source_id=eq.${commitment[0]?.id}&select=*`)).payload;
const registrations = (await rest("session_registrations", `series_commitment_id=eq.${commitment[0]?.id}&select=*`)).payload;
const receipts = (await rest("booking_receipts", `commerce_order_id=eq.${adultPurchase.order.id}&select=id,total_inc_vat_sek`)).payload;
assert(commitment.length === 1 && commitment[0].status === "active", "payment did not create one active Series Commitment");
assert(commitment[0].payer_customer_id !== commitment[0].participant_customer_id, "payer and adult participant were collapsed");
assert(entitlements.length === 1 && entitlements[0].entitlement_type === "series_access" && entitlements[0].meter_type === "unlimited", "payment did not create one non-consuming Series entitlement");
assert(registrations.length === 6, "commitment did not project six expected participations");
assert(receipts.length === 1 && Number(receipts[0].total_inc_vat_sek) === 1495, "one canonical receipt was not created");
pass("Adult payer != player", "one order, one commitment, one entitlement, six projections");

const my = (await course("my", { token: payer.token })).payload;
assert(my.items.length === 1 && my.items[0].total_sessions === 6, "My Page API did not project one Course");
const homeMine = (await course(`home?v=${encodeURIComponent(`course-v1-${run}`)}`, { token: payer.token })).payload;
assert(homeMine.mode === "next", "payer did not receive the managed Course projection");
pass("My Course ownership", "participant truth stays separate from payer ownership");

const originalSession = created.sessions[2];
await course("session", { method: "PATCH", token: operator.token, body: { session_id: originalSession.id, session_date: "2026-09-24" } });
const commitmentAfterMove = (await rest("series_commitments", `id=eq.${commitment[0].id}&select=id,status,updated_at`)).payload[0];
const movedRegistration = (await rest("session_registrations", `series_commitment_id=eq.${commitment[0].id}&activity_session_id=eq.${originalSession.id}&select=id,status`)).payload[0];
assert(commitmentAfterMove.id === commitment[0].id && commitmentAfterMove.status === "active" && movedRegistration?.id, "Session move rewrote or detached commitment");
const added = (await course("session", { method: "POST", token: operator.token, body: { series_id: seriesId, session_date: "2026-10-20" } })).payload;
const registrationsAfterAdd = (await rest("session_registrations", `series_commitment_id=eq.${commitment[0].id}&select=id`)).payload;
assert(added.series_occurrence_index === 7 && registrationsAfterAdd.length === 7, "Session addition did not reconcile idempotently");
await course("session", { method: "PATCH", token: operator.token, body: { session_id: added.id, is_active: false } });
const cancelledProjection = (await rest("session_registrations", `series_commitment_id=eq.${commitment[0].id}&activity_session_id=eq.${added.id}&select=id,status`)).payload[0];
const commitmentAfterCancellation = (await rest("series_commitments", `id=eq.${commitment[0].id}&select=id,status`)).payload[0];
assert(cancelledProjection?.status === "cancelled" && commitmentAfterCancellation?.status === "active", "Session cancellation changed the Series Commitment or left an active expectation");
pass("Session reconciliation", "move/add/cancel leaves commitment intact and reconciles expected participation");

const childPurchase = await checkoutCourse({
  seriesId,
  user: guardian,
  participant: { participant_type: "dependent", dependent_first_name: "Elsa", dependent_birth_year: 2016 },
});
await webhook(checkoutEvent({
  id: `evt_course_child_${run}`,
  sessionId: childPurchase.order.stripe_session_id,
  orderId: childPurchase.order.id,
  version: childPurchase.order.version,
  email: guardian.email,
}));
const childCommitment = (await rest("series_commitments", `activity_series_id=eq.${seriesId}&dependent_participant_id=not.is.null&select=id,dependent_participant_id,status`)).payload[0];
const childMy = (await course("my", { token: guardian.token })).payload;
const publicAfterChild = (await course(`detail?seriesId=${seriesId}`, { token: null })).payload;
assert(childCommitment?.status === "active" && childMy.items[0]?.participant?.first_name === "Elsa", "guardian Course projection missing child");
assert(!JSON.stringify(publicAfterChild).includes("Elsa") && !JSON.stringify(publicAfterChild).includes(childCommitment.dependent_participant_id), "minor leaked to public Course projection");
pass("Child privacy", "guardian/staff-operational identity exists; public projection contains no identity");

await course("session", { method: "PATCH", token: operator.token, body: { session_id: originalSession.id, session_date: stockholmToday } });
const childRegistration = (await rest("session_registrations", `series_commitment_id=eq.${childCommitment.id}&activity_session_id=eq.${originalSession.id}&select=id,status`)).payload[0];
const childEntitlementBefore = (await rest("access_entitlements", `source_type=eq.series_commitment&source_id=eq.${childCommitment.id}&select=id,uses_count`)).payload[0];
const checkin = (await request(`${checkinsUrl}/checkin`, {
  method: "POST",
  key: anonKey,
  token: operator.token,
  body: {
    venue_id: ids.venue,
    player_name: "Elsa",
    entry_type: "session_ticket",
    entitlement_id: childRegistration.id,
  },
})).payload;
const childRegistrationAfter = (await rest("session_registrations", `id=eq.${childRegistration.id}&select=status`)).payload[0];
const childEntitlementAfter = (await rest("access_entitlements", `id=eq.${childEntitlementBefore.id}&select=uses_count`)).payload[0];
assert(checkin.dependent_participant_id === childCommitment.dependent_participant_id, "Course check-in lost subordinate participant identity");
assert(childRegistrationAfter.status === "checked_in", "Course Session registration did not record attendance");
assert(childEntitlementAfter.uses_count === childEntitlementBefore.uses_count, "Course check-in consumed the Series entitlement");
pass("Course check-in", "existing check-in records Session attendance without consuming Series entitlement");

const finalSeries = await createSeries({ capacity: 1, name: "Final Seat Course", startTime: "19:00", endTime: "20:00" });
const [cartA, cartB] = await Promise.all([
  commerce("course-cart", { method: "POST", token: finalSeatA.token, body: { series_id: finalSeries.series.id, participant_type: "self" } }),
  commerce("course-cart", { method: "POST", token: finalSeatB.token, body: { series_id: finalSeries.series.id, participant_type: "self" } }),
]);
const checkoutPayload = (cart, user) => commerce("checkout", {
  method: "POST",
  token: user.token,
  expected: [200, 409],
  body: {
    token: cart.payload.cart_token,
    expected_version: cart.payload.order.version,
    journey_id: crypto.randomBytes(24).toString("hex"),
    success_path: "/commerce/confirmed",
    cancel_path: `/course/${finalSeries.series.id}`,
  },
});
const concurrent = await Promise.all([checkoutPayload(cartA, finalSeatA), checkoutPayload(cartB, finalSeatB)]);
assert(concurrent.filter((result) => result.response.status === 200).length === 1 && concurrent.filter((result) => result.response.status === 409).length === 1, "final Course seat hold oversold");
const winning = concurrent.find((result) => result.response.status === 200).payload;
const winningOrder = (await rest("commerce_orders", `id=eq.${winning.order_id}&select=id,version,stripe_session_id`)).payload[0];
await webhook({
  id: `evt_course_expired_${run}`,
  type: "checkout.session.expired",
  data: { object: { id: winningOrder.stripe_session_id, metadata: { commerce_order_id: winningOrder.id } } },
});
const activeHolds = (await rest("capacity_holds", `scope_type=eq.activity_series&scope_id=eq.${finalSeries.series.id}&status=eq.active&select=id`)).payload;
assert(activeHolds.length === 0, "abandoned Course checkout did not release capacity");
pass("Final-seat concurrency", "one hold wins; checkout expiry releases the seat");

const failedSeries = await createSeries({ capacity: 2, name: "Payment Failure Course", startTime: "20:00", endTime: "21:00" });
const failedCart = (await commerce("course-cart", { method: "POST", token: failing.token, body: { series_id: failedSeries.series.id, participant_type: "self" } })).payload;
const failedCheckout = await commerce("checkout", {
  method: "POST",
  token: failing.token,
  expected: 400,
  body: {
    token: failedCart.cart_token,
    expected_version: failedCart.order.version,
    journey_id: crypto.randomBytes(24).toString("hex"),
    success_path: "/commerce/confirmed",
    cancel_path: `/course/${failedSeries.series.id}`,
  },
});
assert(String(failedCheckout.payload?.error || "").includes("Local test payment failure"), "fake Stripe failure was not exercised");
const failedCommitments = (await rest("series_commitments", `activity_series_id=eq.${failedSeries.series.id}&select=id`)).payload;
const failedEntitlements = (await rest("access_entitlement_scopes", `activity_series_id=eq.${failedSeries.series.id}&select=entitlement_id`)).payload;
const failedHolds = (await rest("capacity_holds", `scope_type=eq.activity_series&scope_id=eq.${failedSeries.series.id}&status=eq.active&select=id`)).payload;
assert(failedCommitments.length === 0 && failedEntitlements.length === 0 && failedHolds.length === 0, "payment failure left durable Course rights/capacity");
pass("Payment failure", "no commitment, entitlement, receipt right or active hold");

const closedSession = (await rest("activity_sessions", `series_id=eq.${seriesId}&select=id&limit=1`)).payload[0];
const publicPreview = await request(`${apiUrl}/rest/v1/activity_sessions?id=eq.${closedSession.id}&select=id`, { key: anonKey, token: anonKey });
assert(publicPreview.payload.length === 0, "closed Course Session was exposed by public RLS");
pass("Public closure", "Course Sessions cannot be bought/discovered as ordinary session products");

process.stdout.write("COURSE V1 API E2E PASS\n");
