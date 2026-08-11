import crypto from "node:crypto";

const apiUrl = process.env.API_URL || "http://127.0.0.1:54321";
const functionUrl = process.env.ADMIN_FUNCTION_URL || `${apiUrl}/functions/v1/api-admin`;
const anonKey = process.env.ANON_KEY;
const serviceKey = process.env.SERVICE_ROLE_KEY;

if (!anonKey || !serviceKey || !apiUrl.startsWith("http://127.0.0.1")) {
  throw new Error("Operations Week E2E only runs against the local Supabase stack");
}

const run = crypto.randomBytes(5).toString("hex");
const monday = "2026-08-10";
const sunday = "2026-08-16";
const ids = {
  venue: crypto.randomUUID(),
  otherVenue: crypto.randomUUID(),
  court: crypto.randomUUID(),
  resource: crypto.randomUUID(),
  activity: crypto.randomUUID(),
  booking: crypto.randomUUID(),
  event: crypto.randomUUID(),
  eventBlock: crypto.randomUUID(),
  maintenance: crypto.randomUUID(),
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pass(name) {
  process.stdout.write(`PASS ${name}\n`);
}

async function request(url, { method = "GET", body, key = serviceKey, token, expected } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      apikey: key,
      ...(token === null ? {} : { Authorization: `Bearer ${token || key}` }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(["POST", "PATCH"].includes(method) && url.includes("/rest/v1/") ? { Prefer: "return=representation" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (expected !== undefined) {
    const statuses = Array.isArray(expected) ? expected : [expected];
    assert(statuses.includes(response.status), `${method} ${url} expected ${statuses.join("/")}, got ${response.status}: ${text}`);
  } else if (!response.ok) {
    throw new Error(`${method} ${url} failed ${response.status}: ${text}`);
  }
  return { response, payload };
}

async function rest(table, query = "", options = {}) {
  return request(`${apiUrl}/rest/v1/${table}${query ? `?${query}` : ""}`, options);
}

async function fn(path, { method = "GET", body, token, expected } = {}) {
  return request(`${functionUrl}/${path}`, { method, body, key: anonKey, token: token ?? null, expected });
}

async function createUser(label) {
  const email = `operations-${label}-${run}@example.test`;
  const password = "Operations-local-42!";
  const created = await request(`${apiUrl}/auth/v1/admin/users`, {
    method: "POST",
    body: { email, password, email_confirm: true, user_metadata: { first_name: label, last_name: "Operator" } },
  });
  const login = await request(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    body: { email, password },
    key: anonKey,
    token: anonKey,
  });
  return { id: created.payload.id, token: login.payload.access_token };
}

const organization = (await rest("organizations", "slug=eq.pickla&select=id")).payload[0];
const operator = await createUser("Anna");
const outsider = await createUser("Olle");

await rest("venues", "", { method: "POST", body: [
  { id: ids.venue, organization_id: organization.id, name: "Operations API Venue", slug: `operations-api-${run}` },
  { id: ids.otherVenue, organization_id: organization.id, name: "Operations Other Venue", slug: `operations-other-${run}` },
] });
await rest("venue_staff", "", { method: "POST", body: [
  { venue_id: ids.venue, user_id: operator.id, role: "venue_admin", is_active: true },
  { venue_id: ids.otherVenue, user_id: outsider.id, role: "venue_admin", is_active: true },
] });
const staffRows = (await rest("venue_staff", `venue_id=eq.${ids.venue}&user_id=eq.${operator.id}&select=id`)).payload;
const staffId = staffRows[0].id;

await rest("venue_courts", "", { method: "POST", body: {
  id: ids.court, venue_id: ids.venue, name: "Bana 1", court_number: 1, sport_type: "pickleball", is_available: true,
} });
await rest("opening_hours", "", { method: "POST", body: Array.from({ length: 7 }, (_, index) => ({
  venue_id: ids.venue, day_of_week: index, open_time: "08:00", close_time: "22:00", is_closed: false,
})) });
await rest("event_resource_catalog", "", { method: "POST", body: {
  id: ids.resource, venue_id: ids.venue, resource_type: "court", name: "Bana 1", venue_court_id: ids.court, is_bookable: true, is_active: true,
} });
await rest("activity_sessions", "", { method: "POST", body: {
  id: ids.activity, venue_id: ids.venue, name: "Operations Open Play", session_type: "open_play",
  session_date: monday, start_time: "10:00", end_time: "12:00", price_sek: 165, capacity: 8,
  court_ids: [ids.court], publish_status: "published", requires_staffing: true,
} });
await rest("bookings", "", { method: "POST", body: {
  id: ids.booking, venue_id: ids.venue, venue_court_id: ids.court, user_id: operator.id, booked_by: operator.id,
  start_time: "2026-08-11T13:00:00+02:00", end_time: "2026-08-11T14:00:00+02:00", status: "confirmed",
  total_price: 400, booking_ref: `OPS-${run}`,
} });
await rest("events", "", { method: "POST", body: {
  id: ids.event, venue_id: ids.venue, name: "Operations Event", event_type: "tournament", format: "round_robin",
  planning_status: "booked", start_date: "2026-08-10T11:00:00+02:00", end_date: "2026-08-10T14:00:00+02:00",
  start_time: "11:00", end_time: "14:00", resources: ["Bana 1"], expected_participants: 24,
} });
await rest("event_resource_blocks", "", { method: "POST", body: [
  {
    id: ids.eventBlock, venue_id: ids.venue, resource_catalog_id: ids.resource, event_id: ids.event,
    title: "Operations Event", reason: "event", status: "confirmed",
    starts_at: "2026-08-10T11:00:00+02:00", ends_at: "2026-08-10T14:00:00+02:00", blocks_public_booking: true,
  },
  {
    id: ids.maintenance, venue_id: ids.venue, resource_catalog_id: ids.resource, event_id: null,
    title: "Nätservice", reason: "maintenance", status: "confirmed",
    starts_at: "2026-08-12T08:00:00+02:00", ends_at: "2026-08-12T09:00:00+02:00", blocks_public_booking: true,
  },
] });

const getWeek = () => fn(`operations-week?venueId=${ids.venue}&from=${monday}&to=${sunday}`, { token: operator.token });
const initial = await getWeek();
const occurrences = initial.payload.operations.occurrences;
assert(initial.payload.dates.length === 7 && initial.payload.operations.query_strategy.n_plus_one === false, "week range/query contract changed");
assert(occurrences.filter((row) => row.source_id === ids.activity).length === 1, "activity occurrence missing or duplicated");
assert(occurrences.filter((row) => row.source_id === ids.booking).length === 1, "private booking missing or duplicated");
assert(occurrences.filter((row) => row.source_id === ids.event).length === 1, "event and its resource block were double-counted");
assert(occurrences.filter((row) => row.source_id === ids.maintenance).length === 1, "maintenance occurrence missing or duplicated");
assert(occurrences.find((row) => row.source_id === ids.activity).warnings.some((warning) => warning.code === "missing_staff"), "required activity did not warn");
assert(!occurrences.find((row) => row.source_id === ids.booking).warnings.some((warning) => warning.code === "missing_staff"), "private booking received false staffing warning");
assert(initial.payload.operations.daily.find((day) => day.date === monday).occurrence_count === 2, "daily occurrence summary drifted");
assert(initial.payload.intervals.some((row) => row.classification === "free"), "free capacity was not projected");
pass("bounded weekly projection, dedupe, daily truth and free capacity");

await fn(`operations-week?venueId=${ids.venue}&from=${monday}&to=${sunday}`, { token: outsider.token, expected: 403 });
pass("venue authorization");

const activityAssignment = await fn("operations-staffing", {
  method: "POST", token: operator.token, body: {
    venueId: ids.venue, source_type: "activity_session", source_id: ids.activity,
    occurrence_date: monday, venue_staff_id: staffId, role: "host",
  },
});
const assigned = await getWeek();
const assignedActivity = assigned.payload.operations.occurrences.find((row) => row.source_id === ids.activity);
assert(assignedActivity.assignments.length === 1 && !assignedActivity.warnings.some((warning) => warning.code === "missing_staff"), "staffing did not persist/remove warning");
pass("staff assignment persistence and immediate missing-warning removal");

const eventAssignment = await fn("operations-staffing", {
  method: "POST", token: operator.token, body: {
    venueId: ids.venue, source_type: "event", source_id: ids.event,
    occurrence_date: monday, venue_staff_id: staffId, role: "service",
  },
});
const overlapped = await getWeek();
const overlapRows = overlapped.payload.operations.occurrences.filter((row) => [ids.activity, ids.event].includes(row.source_id));
assert(overlapRows.every((row) => row.warnings.some((warning) => warning.code === "staff_overlap")), "overlap warning was not applied to both occurrences");
pass("non-blocking staff overlap warning");

await fn(`operations-staffing?venueId=${ids.venue}&assignmentId=${activityAssignment.payload.id}`, {
  method: "DELETE", token: operator.token,
});
const afterRemoval = await getWeek();
assert(afterRemoval.payload.operations.occurrences.find((row) => row.source_id === ids.activity).warnings.some((warning) => warning.code === "missing_staff"), "removal did not restore missing warning");
const auditRows = (await rest("audit_log", `entity_table=eq.operational_staff_assignments&select=id,action,entity_id`)).payload;
assert(
  auditRows.some((row) => row.action.endsWith(".post") && row.entity_id === ids.activity)
    && auditRows.some((row) => row.action.endsWith(".post") && row.entity_id === ids.event)
    && auditRows.some((row) => row.action.endsWith(".delete") && row.entity_id === activityAssignment.payload.id),
  "staffing changes were not audited",
);
pass("soft removal and audit trail");

process.stdout.write("OPERATIONS WEEK API E2E PASSED\n");
