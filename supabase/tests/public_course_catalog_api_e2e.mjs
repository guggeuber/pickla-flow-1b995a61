import crypto from "node:crypto";

const apiUrl = process.env.API_URL || "http://127.0.0.1:54321";
const courseUrl = process.env.COURSE_FUNCTION_URL || `${apiUrl}/functions/v1/api-courses`;
const anonKey = process.env.ANON_KEY;
const serviceKey = process.env.SERVICE_ROLE_KEY;

if (!anonKey || !serviceKey || !apiUrl.startsWith("http://127.0.0.1")) {
  throw new Error("Public Course Catalog E2E only runs against local Supabase");
}

const run = crypto.randomBytes(5).toString("hex");
const ids = {
  organization: crypto.randomUUID(),
  venue: crypto.randomUUID(),
  emptyVenue: crypto.randomUUID(),
  privateVenue: crypto.randomUUID(),
  format: crypto.randomUUID(),
  formatFallback: crypto.randomUUID(),
  series: crypto.randomUUID(),
  seriesFallback: crypto.randomUUID(),
  privateSeries: crypto.randomUUID(),
  customer: crypto.randomUUID(),
  commitment: crypto.randomUUID(),
  hold: crypto.randomUUID(),
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
      ...(options.headers || {}),
    },
  });
}

async function catalog(slug, expected = 200) {
  return request(`${courseUrl}/catalog?v=${encodeURIComponent(slug)}`, {
    key: anonKey,
    token: null,
    expected,
  });
}

await rest("organizations", "", { method: "POST", body: {
  id: ids.organization,
  name: "Course Catalog E2E",
  slug: `course-catalog-${run}`,
} });

await rest("venues", "", { method: "POST", body: [
  { id: ids.venue, organization_id: ids.organization, name: "Course Catalog E2E", slug: `course-catalog-${run}`, commerce_enabled: true, is_public: true },
  { id: ids.emptyVenue, organization_id: ids.organization, name: "Course Catalog Empty", slug: `course-empty-${run}`, commerce_enabled: true, is_public: true },
  { id: ids.privateVenue, organization_id: ids.organization, name: "Course Catalog Private", slug: `course-private-${run}`, commerce_enabled: true, is_public: false },
] });

await rest("customers", "", { method: "POST", body: {
  id: ids.customer,
  organization_id: ids.organization,
  display_name: "Catalog Participant",
  primary_email: `catalog-${run}@example.test`,
  email_normalized: `catalog-${run}@example.test`,
} });

await rest("activity_formats", "", { method: "POST", body: [
  { id: ids.format, organization_id: ids.organization, name: `Catalog Format ${run}`, description: "Reusable course", image_urls: ["https://images.test/format.webp"], age_group: "adult", level: "beginner", requires_instructor: true, presentation_type: "course" },
  { id: ids.formatFallback, organization_id: ids.organization, name: `Catalog Fallback ${run}`, description: "Fallback course", image_urls: ["https://images.test/fallback.webp"], age_group: "adult", level: "intermediate", requires_instructor: true, presentation_type: "course" },
] });

await rest("activity_series", "", { method: "POST", body: [
  { id: ids.series, venue_id: ids.venue, format_id: ids.format, name: "Alpha E2E Course", description: "Alpha run", image_urls: ["https://images.test/alpha.webp"], series_type: "course", status: "active", start_date: "2098-10-01", end_date: "2098-10-29", total_sessions: 4, registration_opens_at: "2000-01-01T00:00:00Z", registration_closes_at: "2098-09-30T22:00:00Z", capacity: 4, recurrence_days: [4], start_time: "18:00", end_time: "19:00", court_ids: [] },
  { id: ids.seriesFallback, venue_id: ids.venue, format_id: ids.formatFallback, name: "Beta E2E Course", description: null, image_urls: [], series_type: "course", status: "active", start_date: "2098-10-02", end_date: "2098-10-30", total_sessions: 4, registration_opens_at: "2090-01-01T00:00:00Z", registration_closes_at: "2098-10-01T22:00:00Z", capacity: 3, recurrence_days: [5], start_time: "19:00", end_time: "20:00", court_ids: [] },
  { id: ids.privateSeries, venue_id: ids.privateVenue, format_id: ids.format, name: "Private E2E Course", description: null, image_urls: [], series_type: "course", status: "active", start_date: "2098-10-03", end_date: "2098-10-31", total_sessions: 4, registration_opens_at: null, registration_closes_at: null, capacity: 3, recurrence_days: [6], start_time: "18:00", end_time: "19:00", court_ids: [] },
] });

await rest("series_commitments", "", { method: "POST", body: {
  id: ids.commitment,
  organization_id: ids.organization,
  venue_id: ids.venue,
  activity_series_id: ids.series,
  commitment_type: "participant",
  participant_customer_id: ids.customer,
  status: "active",
  activated_at: new Date().toISOString(),
} });

await rest("capacity_holds", "", { method: "POST", body: {
  id: ids.hold,
  venue_id: ids.venue,
  scope_type: "activity_series",
  scope_id: ids.series,
  session_date: "2098-10-01",
  idempotency_key: `catalog-${run}`,
  status: "active",
  expires_at: "2099-01-01T00:00:00Z",
} });

const result = await catalog(`course-catalog-${run}`);
assert(result.payload.items.length === 2, "anonymous catalog did not return both visible Course cards");
assert(result.payload.items[0].id === ids.series && result.payload.items[1].id === ids.seriesFallback, "catalog order changed");
assert(result.payload.items[0].capacity.available_count === 2, "catalog capacity did not include commitment and active hold");
assert(result.payload.items[0].registration_state === "open", "open registration state changed");
assert(result.payload.items[1].registration_state === "upcoming", "upcoming registration state changed");
assert(result.payload.items[0].image_urls[0] === "https://images.test/alpha.webp", "Series artwork precedence changed");
assert(result.payload.items[1].image_urls[0] === "https://images.test/fallback.webp", "Format artwork fallback changed");
assert(Object.keys(result.payload.items[0]).sort().join(",") === "capacity,description,format,id,image_urls,name,registration_state,start_date", "unexpected Course card field escaped");
assert(!/(email|phone|customer|participant|payer|membership|coach|staff|price)/i.test(JSON.stringify(result.payload)), "private identity or pricing data escaped");
assert(result.response.headers.get("server-timing")?.includes("course_catalog_rpc"), "catalog Server-Timing is missing");
assert(result.response.headers.get("cache-control")?.includes("max-age=5"), "catalog display cache policy changed");
pass("Anonymous Course Catalog", "two bounded privacy-safe cards with canonical display capacity");

const empty = await catalog(`course-empty-${run}`);
assert(Array.isArray(empty.payload.items) && empty.payload.items.length === 0, "valid empty venue did not return 200 []");
await catalog(`course-private-${run}`, 404);
await catalog(`course-missing-${run}`, 404);
await catalog("INVALID SLUG", 400);
pass("Venue boundary", "empty, non-public, invalid and malformed venue outcomes are distinct and safe");

await request(`${apiUrl}/rest/v1/rpc/public_customer_course_cards`, {
  method: "POST",
  key: anonKey,
  token: anonKey,
  expected: [401, 403, 404],
  body: { p_venue_slug: `course-catalog-${run}` },
});
pass("RPC grants", "direct anonymous PostgREST execution is denied while the auth-free Edge route succeeds");
