import { execFileSync } from "node:child_process";

const apiUrl = process.env.API_URL || "http://127.0.0.1:54321";
const functionUrl = process.env.TODAY_SECONDARY_FUNCTION_URL || `${apiUrl}/functions/v1/api-event-public`;
const localStatus = !process.env.ANON_KEY || !process.env.SERVICE_ROLE_KEY
  ? execFileSync("supabase", ["status", "-o", "env"], { encoding: "utf8" })
  : "";
const localValue = (name) => localStatus.match(new RegExp(`^${name}=(?:\"([^\"]*)\"|([^\\n]*))$`, "m"))?.slice(1).find((value) => value !== undefined);
const anonKey = process.env.ANON_KEY || localValue("ANON_KEY");
const serviceKey = process.env.SERVICE_ROLE_KEY || localValue("SERVICE_ROLE_KEY");

if (!anonKey || !serviceKey || !apiUrl.startsWith("http://127.0.0.1")) {
  throw new Error("Today secondary E2E only runs against local Supabase");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(url, { method = "GET", headers = {}, body, expected = 200 } = {}) {
  const response = await fetch(url, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  const statuses = Array.isArray(expected) ? expected : [expected];
  if (!statuses.includes(response.status)) throw new Error(`${method} ${url} failed ${response.status}: ${text}`);
  return { response, payload, bytes: Buffer.byteLength(text) };
}

const restHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
const venues = await request(`${apiUrl}/rest/v1/venues?select=slug,is_public&order=slug`, { headers: restHeaders });
const publicVenues = venues.payload.filter((venue) => venue.is_public === true);
const publicVenue = publicVenues[0];
const privateVenue = venues.payload.find((venue) => venue.is_public === false);
assert(publicVenue?.slug, "local E2E requires one public venue");

const startDate = new Date().toISOString().slice(0, 10);
const endDate = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);
const endpoint = (slug) => `${functionUrl}/today-secondary?venueSlug=${encodeURIComponent(slug)}&startDate=${startDate}&endDate=${endDate}`;

const publicResult = await request(endpoint(publicVenue.slug));
assert(Object.keys(publicResult.payload).sort().join(",") === "course,first_visit,league", "public response sections changed");
assert(publicResult.payload.first_visit?.is_first_time === true, "anonymous first-visit posture changed");
assert(!/(email|phone|auth_user|payer|membership_id|customer_id)/i.test(JSON.stringify(publicResult.payload)), "private identity escaped");
assert(publicResult.response.headers.get("server-timing")?.includes("today_secondary_rpc"), "Server-Timing missing RPC stage");
assert(publicResult.response.headers.get("cache-control")?.includes("max-age=15"), "display cache policy changed");
assert(publicResult.response.headers.get("x-pickla-request-id"), "correlation ID missing");
process.stdout.write(`PASS auth-free Today secondary: ${publicResult.bytes} bytes, ${publicResult.response.headers.get("server-timing")}\n`);

for (const venue of publicVenues) {
  const result = await request(endpoint(venue.slug));
  assert(Object.keys(result.payload).sort().join(",") === "course,first_visit,league", `public contract changed for ${venue.slug}`);
}
process.stdout.write(`PASS public multi-venue routing for ${publicVenues.length} local venue(s)\n`);

await request(endpoint("missing-today-secondary-venue"), { expected: 404 });
if (privateVenue?.slug) await request(endpoint(privateVenue.slug), { expected: 404 });
await request(`${functionUrl}/today-secondary?venueSlug=${encodeURIComponent(publicVenue.slug)}&startDate=${startDate}&endDate=2099-12-31`, { expected: 400 });
process.stdout.write("PASS missing/private/malformed venue and range boundaries\n");

await request(`${apiUrl}/rest/v1/rpc/public_customer_today_secondary_facts`, {
  method: "POST",
  headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  body: { p_venue_slug: publicVenue.slug, p_start_date: startDate, p_end_date: endDate },
  expected: [401, 403, 404],
});
process.stdout.write("PASS direct anonymous RPC denied; auth-free Edge route allowed\n");
