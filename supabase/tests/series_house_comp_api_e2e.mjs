import crypto from "node:crypto";
import { DateTime } from "luxon";

const apiUrl = process.env.API_URL || "http://127.0.0.1:54321";
const courseUrl = process.env.COURSE_FUNCTION_URL || `${apiUrl}/functions/v1/api-courses`;
const checkinsUrl = process.env.CHECKINS_FUNCTION_URL || `${apiUrl}/functions/v1/api-checkins`;
const anonKey = process.env.ANON_KEY;
const serviceKey = process.env.SERVICE_ROLE_KEY;

if (!anonKey || !serviceKey || !apiUrl.startsWith("http://127.0.0.1")) {
  throw new Error("Series staff-grant E2E only runs against local Supabase");
}

const run = crypto.randomBytes(5).toString("hex");
const stockholmNow = DateTime.now().setZone("Europe/Stockholm");
const stockholmToday = stockholmNow.toISODate();
const activeSessionStart = stockholmNow.minus({ minutes: 30 }).toFormat("HH:mm");
const activeSessionEnd = stockholmNow.plus({ minutes: 30 }).toFormat("HH:mm");
const ids = {
  venue: crypto.randomUUID(),
  formats: Array.from({ length: 5 }, () => crypto.randomUUID()),
  products: Array.from({ length: 5 }, () => crypto.randomUUID()),
  series: Array.from({ length: 5 }, () => crypto.randomUUID()),
  sessions: Array.from({ length: 8 }, () => crypto.randomUUID()),
  dependent: crypto.randomUUID(),
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pass(name, detail = "ok") {
  process.stdout.write(`PASS ${name}: ${detail}\n`);
}

async function request(url, { method = "GET", body, key = serviceKey, token, expected, headers = {} } = {}) {
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
      ...(options.method === "PATCH" ? { Prefer: "return=representation" } : {}),
      ...(options.headers || {}),
    },
  });
}

async function course(path, options = {}) {
  return request(`${courseUrl}/${path}`, {
    key: anonKey,
    token: options.token ?? null,
    ...options,
  });
}

async function createUser(label) {
  const email = `series-grant-${label}-${run}@example.test`;
  const password = "Series-grant-local-42!";
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
  return { id: created.payload.id, email, token: login.payload.access_token };
}

async function grant(seriesId, participant, requestId, token, expected = [200, 201]) {
  return course("staff-grant", {
    method: "POST",
    token,
    expected,
    body: {
      venue_id: ids.venue,
      series_id: seriesId,
      participant_kind: participant.kind,
      participant_id: participant.id,
      reason: `Kontrollerad friplats ${requestId}`,
      request_id: requestId,
    },
  });
}

const organization = (await rest("organizations", "slug=eq.pickla&select=id")).payload[0];
assert(organization?.id, "local Pickla organization missing");

const [operator, outsider, annaUser, bertilUser, ceciliaUser, davidUser, guardianUser] = await Promise.all([
  createUser("operator"), createUser("outsider"), createUser("anna"), createUser("bertil"),
  createUser("cecilia"), createUser("david"), createUser("guardian"),
]);

await rest("venues", "", { method: "POST", body: {
  id: ids.venue,
  organization_id: organization.id,
  name: "Series Grant E2E",
  slug: `series-grant-${run}`,
  commerce_enabled: true,
} });
await rest("venue_staff", "", { method: "POST", body: {
  venue_id: ids.venue,
  user_id: operator.id,
  role: "venue_admin",
  is_active: true,
} });

const customerUsers = [annaUser, bertilUser, ceciliaUser, davidUser, guardianUser];
const authUserFilter = customerUsers.map((user) => user.id).join(",");
const autoCustomers = (await rest("customers", `auth_user_id=in.(${authUserFilter})&select=id,auth_user_id,organization_id,primary_email`)).payload;
assert(autoCustomers.length === customerUsers.length, "canonical auth-to-customer creation did not complete");
const customerRows = customerUsers.map((user, index) => {
  const customer = autoCustomers.find((row) => row.auth_user_id === user.id);
  assert(customer?.organization_id === organization.id, "auth customer belongs to wrong organization");
  return {
    ...customer,
    display_name: ["Anna", "Bertil", "Cecilia", "David", "Guardian"][index],
  };
});
for (const customer of customerRows) {
  await rest("customers", `id=eq.${customer.id}`, { method: "PATCH", body: { display_name: customer.display_name } });
}
const [anna, bertil, cecilia, david, guardian] = customerRows.map((row) => ({ kind: "customer", id: row.id, name: row.display_name }));
await rest("dependent_participants", "", { method: "POST", body: {
  id: ids.dependent,
  organization_id: organization.id,
  guardian_customer_id: guardian.id,
  first_name: "Elsa",
  birth_year: 2016,
} });
const elsa = { kind: "dependent", id: ids.dependent, name: "Elsa" };

const formatTypes = ["social_event", "course", "clinic", "tournament", "social_event"];
await rest("activity_formats", "", { method: "POST", body: ids.formats.map((id, index) => ({
  id,
  organization_id: organization.id,
  name: `Grant Format ${index + 1} ${run}`,
  description: "E2E",
  age_group: index === 3 ? "youth" : "adult",
  level: "intro",
  requires_instructor: false,
  presentation_type: formatTypes[index],
})) });
await rest("access_products", "", { method: "POST", body: ids.products.map((id, index) => ({
  id,
  venue_id: ids.venue,
  product_key: `series_grant_${run}_${index}`,
  name: `Grant Product ${index + 1}`,
  product_kind: "series_access",
  base_price_sek: index === 0 ? 199 : index === 1 ? 1495 : 399,
  commerce_kind: "participation",
  fulfillment_type: "participation",
  fulfillment_presentation: "participation",
  commerce_enabled: true,
  status: "active",
})) });

const seriesFixtures = [
  { name: "One-off Event", start: stockholmToday, end: stockholmToday, total: 1, capacity: 40, startTime: activeSessionStart, endTime: activeSessionEnd },
  { name: "Four Occurrences", start: "2027-09-07", end: "2027-09-28", total: 4, capacity: 8 },
  { name: "Hold Race", start: "2027-10-01", end: "2027-10-01", total: 1, capacity: 1 },
  { name: "Grant Race", start: "2027-11-01", end: "2027-11-01", total: 1, capacity: 1 },
  { name: "Idempotency", start: "2027-12-01", end: "2027-12-01", total: 1, capacity: 2 },
];
await rest("activity_series", "", { method: "POST", body: seriesFixtures.map((fixture, index) => ({
  id: ids.series[index],
  venue_id: ids.venue,
  format_id: ids.formats[index],
  name: fixture.name,
  series_type: "course",
  status: "active",
  access_product_id: ids.products[index],
  product_key: `series_grant_${run}_${index}`,
  start_date: fixture.start,
  end_date: fixture.end,
  total_sessions: fixture.total,
  capacity: fixture.capacity,
  recurrence_days: [1],
  start_time: fixture.startTime || "18:00",
  end_time: fixture.endTime || "19:00",
  court_ids: [],
})) });

const sessionRows = [
  { series: 0, date: stockholmToday, occurrence: 1 },
  { series: 1, date: "2027-09-07", occurrence: 1 },
  { series: 1, date: "2027-09-14", occurrence: 2 },
  { series: 1, date: "2027-09-21", occurrence: 3 },
  { series: 1, date: "2027-09-28", occurrence: 4 },
  { series: 2, date: "2027-10-01", occurrence: 1 },
  { series: 3, date: "2027-11-01", occurrence: 1 },
  { series: 4, date: "2027-12-01", occurrence: 1 },
];
await rest("activity_sessions", "", { method: "POST", body: sessionRows.map((fixture, index) => ({
  id: ids.sessions[index],
  venue_id: ids.venue,
  series_id: ids.series[fixture.series],
  name: seriesFixtures[fixture.series].name,
  session_type: "course",
  sport_type: "pickleball",
  session_date: fixture.date,
  start_time: seriesFixtures[fixture.series].startTime || "18:00",
  end_time: seriesFixtures[fixture.series].endTime || "19:00",
  price_sek: 0,
  capacity: seriesFixtures[fixture.series].capacity,
  court_ids: [],
  access_policy: { series_commitment_required: true },
  is_active: true,
  publish_status: "published",
  closed_to_public: true,
  series_occurrence_index: fixture.occurrence,
})) });

const financialBefore = {
  orders: (await rest("commerce_orders", "select=id")).payload.length,
  receipts: (await rest("booking_receipts", "select=id")).payload.length,
  ledger: (await rest("ledger_entries", "select=id")).payload.length,
};

await course("staff-grant", { method: "POST", token: null, expected: 401, body: {} });
await grant(ids.series[0], anna, `unauthorized-${run}`, outsider.token, 403);
pass("permission boundary", "public and non-staff callers rejected");

const eventGrant = (await grant(ids.series[0], anna, `event-${run}`, operator.token)).payload;
assert(eventGrant.available_count === 39 && eventGrant.grant.provenance_label === "Friplats · Pickla", "one-off grant projection invalid");
const eventRetry = (await grant(ids.series[0], anna, `event-${run}`, operator.token)).payload;
assert(eventRetry.commitment_id === eventGrant.commitment_id && eventRetry.reason === "existing_grant", "same request did not return same grant");
const eventRegistrations = (await rest("session_registrations", `series_commitment_id=eq.${eventGrant.commitment_id}&select=id,status`)).payload;
assert(eventRegistrations.length === 1, "one-off event did not project one registration");
const eventCheckin = (await request(`${checkinsUrl}/checkin`, {
  method: "POST",
  key: anonKey,
  token: operator.token,
  body: {
    venue_id: ids.venue,
    player_name: "Anna",
    entry_type: "session_ticket",
    entitlement_id: eventRegistrations[0].id,
  },
})).payload;
const checkedInEvent = (await rest("session_registrations", `id=eq.${eventRegistrations[0].id}&select=status`)).payload[0];
assert(eventCheckin.customer_id === anna.id && checkedInEvent.status === "checked_in", "one-off house-comp registration did not use canonical check-in");
pass("one-off Series", "40 → 39, one commitment/entitlement/registration and normal check-in");

const courseGrant = (await grant(ids.series[1], bertil, `course-${run}`, operator.token)).payload;
const courseRegistrations = (await rest("session_registrations", `series_commitment_id=eq.${courseGrant.commitment_id}&select=id,status,activity_session_id`)).payload;
assert(courseGrant.available_count === 7 && courseRegistrations.length === 4, "multi-occurrence Series did not consume one place and project four occurrences");
await rest("session_registrations", `id=eq.${courseRegistrations[0].id}`, { method: "PATCH", body: { status: "checked_in" } });
await rest("session_registrations", `id=eq.${courseRegistrations[1].id}`, { method: "PATCH", body: { status: "no_show" } });
await course("staff-grant-cancel", { method: "POST", token: operator.token, body: {
  venue_id: ids.venue,
  commitment_id: courseGrant.commitment_id,
  reason: "Kontrollerad avbokning",
  request_id: `cancel-course-${run}`,
} });
const cancelledStatuses = (await rest("session_registrations", `series_commitment_id=eq.${courseGrant.commitment_id}&select=status`)).payload.map((row) => row.status).sort();
assert(JSON.stringify(cancelledStatuses) === JSON.stringify(["cancelled", "cancelled", "checked_in", "no_show"]), "cancellation did not preserve attendance");
const cancelledCommitment = (await rest("series_commitments", `id=eq.${courseGrant.commitment_id}&select=status,metadata`)).payload[0];
assert(cancelledCommitment.status === "cancelled" && cancelledCommitment.metadata.grant_reason && cancelledCommitment.metadata.cancel_reason, "cancellation replaced grant metadata");
pass("multi-occurrence Series", "one place, four projections, attendance preserved");

const holdRace = await Promise.all([
  request(`${apiUrl}/rest/v1/rpc/acquire_capacity_hold`, { method: "POST", body: {
    p_venue_id: ids.venue,
    p_scope_type: "activity_series",
    p_scope_id: ids.series[2],
    p_session_date: "2027-10-01",
    p_capacity: 1,
    p_customer_id: cecilia.id,
    p_source_type: "commerce_order",
    p_idempotency_key: `hold-race-${run}`,
  } }),
  grant(ids.series[2], david, `grant-hold-race-${run}`, operator.token, [201, 409]),
]);
const holdWon = holdRace[0].payload[0]?.ok === true;
const grantWon = holdRace[1].payload?.ok === true;
assert(Number(holdWon) + Number(grantWon) === 1, "checkout hold and staff grant both won or both lost final seat");
pass("hold/grant concurrency", holdWon ? "checkout hold won" : "staff grant won");

const differentPeople = await Promise.all([
  grant(ids.series[3], cecilia, `grant-race-a-${run}`, operator.token, [201, 409]),
  grant(ids.series[3], david, `grant-race-b-${run}`, operator.token, [201, 409]),
]);
assert(differentPeople.filter((result) => result.payload?.ok === true).length === 1, "two staff grants oversold final seat");
const raceCommitments = (await rest("series_commitments", `activity_series_id=eq.${ids.series[3]}&status=eq.active&select=id`)).payload;
assert(raceCommitments.length === 1, "final-seat race created duplicate commitments");
pass("grant/grant concurrency", "exactly one different participant won");

const sameRequestId = `same-request-${run}`;
const sameParticipant = await Promise.all([
  grant(ids.series[4], cecilia, sameRequestId, operator.token),
  grant(ids.series[4], cecilia, sameRequestId, operator.token),
]);
assert(sameParticipant[0].payload.commitment_id === sameParticipant[1].payload.commitment_id, "concurrent retry did not converge on one commitment");
assert((await rest("series_commitments", `activity_series_id=eq.${ids.series[4]}&participant_customer_id=eq.${cecilia.id}&select=id`)).payload.length === 1, "same participant retry duplicated commitment");
const duplicateAttempt = await grant(ids.series[4], cecilia, `different-request-${run}`, operator.token, 409);
assert(duplicateAttempt.payload.code === "duplicate_active_place", "new duplicate request was not rejected");
pass("idempotency", "same request converges; distinct duplicate rejects");

const dependentGrant = (await grant(ids.series[4], elsa, `dependent-${run}`, operator.token)).payload;
const dependentCommitment = (await rest("series_commitments", `id=eq.${dependentGrant.commitment_id}&select=participant_customer_id,dependent_participant_id,payer_customer_id`)).payload[0];
const dependentRegistration = (await rest("session_registrations", `series_commitment_id=eq.${dependentGrant.commitment_id}&select=user_id,customer_id,dependent_participant_id`)).payload[0];
assert(dependentCommitment.dependent_participant_id === elsa.id && !dependentCommitment.participant_customer_id && !dependentCommitment.payer_customer_id, "dependent grant fabricated adult/payer identity");
assert(dependentRegistration.dependent_participant_id === elsa.id && !dependentRegistration.user_id && !dependentRegistration.customer_id, "dependent registration leaked adult identity");
const guardianMy = (await course("my", { token: guardianUser.token })).payload;
assert(guardianMy.items.some((item) => item.commitment.id === dependentGrant.commitment_id && item.access?.label === "Friplats"), "guardian My Page did not project friendly grant truth");
const publicDetail = (await course(`detail?seriesId=${ids.series[4]}`, { token: null })).payload;
assert(!JSON.stringify(publicDetail).includes("Elsa"), "dependent identity leaked into public Series detail");
pass("dependent/P-18", "guardian and staff truth without public identity leakage");

const directWrite = await rest("series_commitments", "", {
  method: "POST",
  key: anonKey,
  token: operator.token,
  expected: 403,
  body: {
    organization_id: organization.id,
    venue_id: ids.venue,
    activity_series_id: ids.series[0],
    participant_customer_id: david.id,
    status: "active",
    activated_at: new Date().toISOString(),
  },
});
assert(directWrite.response.status === 403, "authorized browser retained direct commitment write");
pass("direct-write boundary", "authenticated venue admin denied by PostgREST");

const financialAfter = {
  orders: (await rest("commerce_orders", "select=id")).payload.length,
  receipts: (await rest("booking_receipts", "select=id")).payload.length,
  ledger: (await rest("ledger_entries", "select=id")).payload.length,
};
assert(JSON.stringify(financialAfter) === JSON.stringify(financialBefore), "staff grants created financial records");
const auditRows = (await rest("audit_log", `venue_id=eq.${ids.venue}&action=in.(series.staff_grant.created,series.staff_grant.cancelled)&select=action,actor_user_id,request_id,metadata`)).payload;
assert(auditRows.length >= 5 && auditRows.every((row) => row.actor_user_id === operator.id && row.metadata.reason), "grant/cancel audit is incomplete");
pass("accounting/audit", "0 financial rows; append-only actor/participant/Series/reason events present");

process.stdout.write("SERIES HOUSE COMP API E2E PASS\n");
