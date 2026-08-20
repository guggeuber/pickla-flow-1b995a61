import crypto from "node:crypto";

const apiUrl = process.env.API_URL || "http://127.0.0.1:54321";
const adminUrl = process.env.ADMIN_FUNCTION_URL || "http://127.0.0.1:8000";
const courseUrl = process.env.COURSE_FUNCTION_URL || "http://127.0.0.1:8001";
const anonKey = process.env.ANON_KEY;
const serviceKey = process.env.SERVICE_ROLE_KEY;

if (!anonKey || !serviceKey || !apiUrl.startsWith("http://127.0.0.1")) {
  throw new Error("Series write-boundary E2E only runs against local Supabase");
}

const run = crypto.randomBytes(5).toString("hex");
const venueId = crypto.randomUUID();
const courtId = crypto.randomUUID();

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
      ...(options.headers || {}),
    },
  });
}

async function call(base, path, options = {}) {
  const query = options.query ? `?${new URLSearchParams(options.query)}` : "";
  return request(`${base}/${path}${query}`, {
    key: anonKey,
    token: options.token ?? null,
    ...options,
  });
}

async function createUser() {
  const email = `series-boundary-${run}@example.test`;
  const password = "Boundary-local-42!";
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
  return { id: created.payload.id, token: login.payload.access_token };
}

const organization = (await rest("organizations", "slug=eq.pickla&select=id")).payload[0];
assert(organization?.id, "local Pickla organization missing");
await rest("venues", "", { method: "POST", body: {
  id: venueId,
  organization_id: organization.id,
  name: "Series Boundary Venue",
  slug: `series-boundary-${run}`,
  commerce_enabled: true,
} });
await rest("venue_courts", "", { method: "POST", body: {
  id: courtId,
  venue_id: venueId,
  name: "Bana 1",
  court_number: 1,
  sport_type: "pickleball",
  is_available: true,
} });

const operator = await createUser();
await rest("venue_staff", "", { method: "POST", body: {
  venue_id: venueId,
  user_id: operator.id,
  role: "venue_admin",
  is_active: true,
} });

const scheduleSeries = (await call(adminUrl, "activity-series", {
  method: "POST",
  token: operator.token,
  body: { venueId, name: "Open Play", series_type: "program", status: "active" },
})).payload;
assert(scheduleSeries.id && !scheduleSeries.format_id, "generic Schedule series was not created");

const scheduleSession = (await call(adminUrl, "activity-sessions", {
  method: "POST",
  token: operator.token,
  body: {
    venueId,
    series_id: scheduleSeries.id,
    name: "Open Play",
    session_type: "open_play",
    recurrence_days: [1],
    start_time: "10:00",
    end_time: "12:00",
    price_sek: 0,
    capacity: 16,
    court_ids: [courtId],
    sold_as: "included_only",
    publish_status: "published",
  },
})).payload;

await call(adminUrl, "activity-series", {
  method: "PATCH",
  token: operator.token,
  body: { venueId, seriesId: scheduleSeries.id, name: "Open Play Updated" },
});
await call(adminUrl, "activity-sessions", {
  method: "PATCH",
  token: operator.token,
  body: {
    venueId,
    sessionId: scheduleSession.id,
    capacity: 18,
    closed_to_public: true,
    series_occurrence_index: 99,
    created_at: "2000-01-01T00:00:00Z",
  },
});
const updatedScheduleSession = (await rest("activity_sessions", `id=eq.${scheduleSession.id}&select=capacity,closed_to_public,series_occurrence_index`)).payload[0];
assert(updatedScheduleSession.capacity === 18, "Workflow B lost its canonical API edit path");
assert(updatedScheduleSession.closed_to_public === false && updatedScheduleSession.series_occurrence_index === null, "generic update accepted protected generated-Session fields");
pass("Workflow B", "generic Series and Session remain editable through api-admin");

await call(adminUrl, "activity-series", {
  method: "POST",
  token: operator.token,
  expected: 409,
  body: { venueId, name: "Wrong Course Path", series_type: "course" },
});
await call(adminUrl, "activity-series", {
  method: "PATCH",
  token: operator.token,
  expected: 409,
  body: { venueId, seriesId: scheduleSeries.id, series_type: "course" },
});
await call(adminUrl, "activity-sessions", {
  method: "PATCH",
  token: operator.token,
  expected: 409,
  body: { venueId, sessionId: scheduleSession.id, session_type: "course" },
});

const format = (await call(courseUrl, "format", {
  method: "POST",
  token: operator.token,
  body: {
    venue_id: venueId,
    name: `Managed Event ${run}`,
    description: "Identity-led fixture",
    age_group: "adult",
    level: "intro",
    requires_instructor: false,
    presentation_type: "social_event",
  },
})).payload;
const managed = (await call(courseUrl, "series", {
  method: "POST",
  token: operator.token,
  body: {
    venue_id: venueId,
    format_id: format.id,
    name: `Managed Event Run ${run}`,
    start_date: "2027-03-01",
    end_date: "2027-03-01",
    registration_opens_at: "2027-01-01T00:00:00Z",
    registration_closes_at: "2027-02-28T22:00:00Z",
    capacity: 12,
    price_sek: 199,
    total_sessions: 1,
    recurrence_days: [1],
    start_time: "18:00",
    end_time: "19:00",
    court_ids: [courtId],
  },
})).payload;
assert(managed.series.format_id === format.id && managed.sessions.length === 1, "managed Series API did not create canonical truth");

const genericSeries = (await call(adminUrl, "activity-series", {
  token: operator.token,
  query: { venueId },
})).payload;
const managedProjection = genericSeries.find((row) => row.id === managed.series.id);
const scheduleProjection = genericSeries.find((row) => row.id === scheduleSeries.id);
assert(managedProjection?.management_mode === "managed_series" && managedProjection.schedule_editable === false, "managed ownership was not projected to Admin");
assert(scheduleProjection?.management_mode === "schedule_group" && scheduleProjection.schedule_editable === true, "schedule ownership was not projected to Admin");

const genericSessions = (await call(adminUrl, "activity-sessions", {
  token: operator.token,
  query: { venueId },
})).payload;
const generatedProjection = genericSessions.find((row) => row.id === managed.sessions[0].id);
assert(generatedProjection?.management_mode === "managed_series" && generatedProjection.schedule_editable === false, "generated Session ownership was not projected");
pass("One schedule", "both workflows remain visible through the same activity_series/activity_sessions projection");

for (const [label, action] of [
  ["draft Series update", () => call(adminUrl, "activity-series", { method: "PATCH", token: operator.token, expected: 409, body: { venueId, seriesId: managed.series.id, capacity: 99 } })],
  ["generated Session update", () => call(adminUrl, "activity-sessions", { method: "PATCH", token: operator.token, expected: 409, body: { venueId, sessionId: managed.sessions[0].id, start_time: "17:00", closed_to_public: false } })],
  ["generated Session delete", () => call(adminUrl, "activity-sessions", { method: "DELETE", token: operator.token, expected: 409, query: { venueId, sessionId: managed.sessions[0].id } })],
  ["managed product update", () => call(adminUrl, "products", { method: "PATCH", token: operator.token, expected: 409, body: { venueId, productId: managed.series.access_product_id, base_price_sek: 1 } })],
  ["managed product delete", () => call(adminUrl, "products", { method: "DELETE", token: operator.token, expected: 409, query: { venueId, productId: managed.series.access_product_id } })],
  ["attach generic Session", () => call(adminUrl, "activity-sessions", { method: "POST", token: operator.token, expected: 409, body: { venueId, series_id: managed.series.id, name: "Bypass", start_time: "20:00", end_time: "21:00" } })],
]) {
  const result = await action();
  assert(String(result.payload?.error || result.payload?.message || "").includes("Program & event"), `${label} did not return the canonical ownership error`);
}

const addon = (await call(adminUrl, "products", {
  method: "POST",
  token: operator.token,
  body: {
    venueId,
    product_key: `boundary_addon_${run}`,
    name: "Boundary Add-on",
    base_price_sek: 50,
    vat_rate: 6,
    product_kind: "rental",
    activity_addon_enabled: true,
    status: "active",
  },
})).payload;
await call(adminUrl, "product-relationships", {
  method: "POST",
  token: operator.token,
  expected: 409,
  body: {
    venueId,
    source_product_id: managed.series.access_product_id,
    target_product_id: addon.id,
  },
});

await call(courseUrl, "series", {
  method: "PATCH",
  token: operator.token,
  body: { series_id: managed.series.id, status: "active" },
});
await call(adminUrl, "activity-series", {
  method: "DELETE",
  token: operator.token,
  expected: 409,
  query: { venueId, seriesId: managed.series.id },
});
pass("Managed lifecycle", "draft, published, generated Session and product side doors return 409");

const directWrite = await request(`${apiUrl}/rest/v1/activity_sessions?id=eq.${managed.sessions[0].id}`, {
  method: "PATCH",
  key: anonKey,
  token: operator.token,
  expected: [401, 403],
  headers: { Prefer: "return=representation" },
  body: { closed_to_public: false, series_occurrence_index: 99 },
});
assert(directWrite.response.status === 401 || directWrite.response.status === 403, "direct authenticated table write was not denied");
const unchanged = (await rest("activity_sessions", `id=eq.${managed.sessions[0].id}&select=closed_to_public,series_occurrence_index`)).payload[0];
assert(unchanged.closed_to_public === true && unchanged.series_occurrence_index === 1, "direct-write denial did not preserve generated truth");
pass("Direct-write boundary", "authenticated REST cannot bypass API ownership rules");

process.stdout.write("Series / Schedule write-boundary API E2E passed\n");
