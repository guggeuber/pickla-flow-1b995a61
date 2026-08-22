import crypto from "node:crypto";

const apiUrl = process.env.API_URL || "http://127.0.0.1:54321";
const membershipsUrl = process.env.MEMBERSHIPS_FUNCTION_URL || `${apiUrl}/functions/v1/api-memberships`;
const anonKey = process.env.ANON_KEY;
const serviceKey = process.env.SERVICE_ROLE_KEY;

if (!anonKey || !serviceKey || !apiUrl.startsWith("http://127.0.0.1")) {
  throw new Error("Series member-pricing E2E only runs against local Supabase");
}

const run = crypto.randomBytes(5).toString("hex");
const ids = {
  venue: crypto.randomUUID(),
  foreignVenue: crypto.randomUUID(),
  format: crypto.randomUUID(),
  products: [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()],
  foreignProduct: crypto.randomUUID(),
  series: [crypto.randomUUID(), crypto.randomUUID()],
  tiers: [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()],
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
      ...(options.method === "POST" || options.method === "PATCH" ? { Prefer: "return=representation" } : {}),
      ...(options.headers || {}),
    },
  });
}

async function memberships(path, options = {}) {
  return request(`${membershipsUrl}/${path}`, { key: anonKey, token: options.token ?? null, ...options });
}

async function createUser(label) {
  const email = `series-member-price-${label}-${run}@example.test`;
  const password = "Series-member-local-42!";
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
const [operator, outsider] = await Promise.all([createUser("operator"), createUser("outsider")]);

try {
  await rest("venues", "", { method: "POST", body: [
    { id: ids.venue, organization_id: organization.id, name: "Series Pricing E2E", slug: `series-pricing-${run}`, commerce_enabled: true },
    { id: ids.foreignVenue, organization_id: organization.id, name: "Foreign Series Pricing E2E", slug: `series-pricing-foreign-${run}`, commerce_enabled: true },
  ] });
  await rest("venue_staff", "", { method: "POST", body: { venue_id: ids.venue, user_id: operator.id, role: "venue_admin", is_active: true } });
  await rest("activity_formats", "", { method: "POST", body: {
    id: ids.format,
    organization_id: organization.id,
    name: `Generic Series ${run}`,
    description: "E2E",
    age_group: "adult",
    level: "intro",
    requires_instructor: false,
    presentation_type: "social_event",
  } });
  const productKeys = [`series_event_${run}`, `series_course_${run}`, `series_inactive_${run}`];
  await rest("access_products", "", { method: "POST", body: [
    { id: ids.products[0], venue_id: ids.venue, product_key: productKeys[0], name: "One-off Series", product_kind: "series_access", base_price_sek: 199, is_active: true, status: "active", commerce_enabled: true },
    { id: ids.products[1], venue_id: ids.venue, product_key: productKeys[1], name: "Four-occurrence Series", product_kind: "series_access", base_price_sek: 1495, is_active: true, status: "active", commerce_enabled: true },
    { id: ids.products[2], venue_id: ids.venue, product_key: productKeys[2], name: "Inactive Series", product_kind: "series_access", base_price_sek: 199, is_active: false, status: "archived", commerce_enabled: false },
    { id: ids.foreignProduct, venue_id: ids.foreignVenue, product_key: `series_foreign_${run}`, name: "Foreign Series", product_kind: "series_access", base_price_sek: 199, is_active: true, status: "active", commerce_enabled: true },
  ] });
  await rest("activity_series", "", { method: "POST", body: [
    { id: ids.series[0], venue_id: ids.venue, format_id: ids.format, access_product_id: ids.products[0], product_key: productKeys[0], name: "One-off", series_type: "course", status: "active", start_date: "2027-09-05", end_date: "2027-09-05", total_sessions: 1, capacity: 40, recurrence_days: [0], start_time: "13:00", end_time: "18:00", court_ids: [] },
    { id: ids.series[1], venue_id: ids.venue, format_id: ids.format, access_product_id: ids.products[1], product_key: productKeys[1], name: "Four occurrences", series_type: "course", status: "active", start_date: "2027-10-05", end_date: "2027-10-26", total_sessions: 4, capacity: 8, recurrence_days: [1], start_time: "18:00", end_time: "19:00", court_ids: [] },
  ] });
  await rest("membership_tiers", "", { method: "POST", body: [
    { id: ids.tiers[0], venue_id: ids.venue, name: "Play", is_active: true, sort_order: 1 },
    { id: ids.tiers[1], venue_id: ids.venue, name: "Play+", is_active: true, sort_order: 2 },
    { id: ids.tiers[2], venue_id: ids.venue, name: "Old", is_active: false, sort_order: 3 },
  ] });

  await memberships("tier-pricing", { method: "POST", token: null, expected: 401, body: {} });
  await memberships("tier-pricing", { method: "POST", token: outsider.token, expected: 403, body: { tierId: ids.tiers[0], product_type: productKeys[0], fixed_price: 169 } });
  pass("authorization", "anonymous 401 and non-admin 403");

  const fixed = (await memberships("tier-pricing", { method: "POST", token: operator.token, expected: 201, body: {
    tierId: ids.tiers[0], product_type: productKeys[0], fixed_price: 169, discount_percent: null, label: "Play · One-off",
  } })).payload;
  let preview = (await memberships(`series-tier-pricing?venueId=${ids.venue}`, { token: operator.token })).payload;
  const oneOff = preview.series.find((item) => item.series_id === ids.series[0]);
  const playFixed = oneOff.tiers.find((item) => item.tier.id === ids.tiers[0]);
  assert(playFixed.preview.resolved_price_sek === 169 && playFixed.preview.mode === "fixed", "fixed Series preview was not canonical");
  pass("fixed price", "199 → 169 through membership_tier_pricing");

  await memberships("tier-pricing", { method: "PATCH", token: operator.token, body: {
    id: fixed.id, fixed_price: null, discount_percent: 15,
  } });
  preview = (await memberships(`series-tier-pricing?venueId=${ids.venue}`, { token: operator.token })).payload;
  const playPercent = preview.series.find((item) => item.series_id === ids.series[0]).tiers.find((item) => item.tier.id === ids.tiers[0]);
  assert(playPercent.preview.resolved_price_sek === 169.15 && playPercent.preview.mode === "percent", "percentage Series preview was not canonical");
  pass("percentage price", "199 with 15% resolves to 169.15");

  const invalidCases = [
    ["fixed above base", { tierId: ids.tiers[1], product_type: productKeys[0], fixed_price: 200, discount_percent: null }, 400],
    ["fixed zero", { tierId: ids.tiers[1], product_type: productKeys[0], fixed_price: 0, discount_percent: null }, 400],
    ["percent zero", { tierId: ids.tiers[1], product_type: productKeys[0], fixed_price: null, discount_percent: 0 }, 400],
    ["percent above 100", { tierId: ids.tiers[1], product_type: productKeys[0], fixed_price: null, discount_percent: 101 }, 400],
    ["both modes", { tierId: ids.tiers[1], product_type: productKeys[0], fixed_price: 169, discount_percent: 15 }, 400],
    ["unknown product", { tierId: ids.tiers[1], product_type: `missing_${run}`, fixed_price: 169, discount_percent: null }, 404],
    ["foreign product", { tierId: ids.tiers[1], product_type: `series_foreign_${run}`, fixed_price: 169, discount_percent: null }, 404],
    ["inactive product", { tierId: ids.tiers[1], product_type: productKeys[2], fixed_price: 169, discount_percent: null }, 409],
    ["inactive tier", { tierId: ids.tiers[2], product_type: productKeys[0], fixed_price: 169, discount_percent: null }, 409],
  ];
  for (const [label, body, expected] of invalidCases) {
    await memberships("tier-pricing", { method: "POST", token: operator.token, expected, body });
    pass(`reject ${label}`);
  }
  await memberships("tier-pricing", { method: "POST", token: operator.token, expected: 409, body: {
    tierId: ids.tiers[0], product_type: productKeys[0], fixed_price: 159, discount_percent: null,
  } });
  pass("duplicate rule", "second active tier/product rule rejected");

  await rest("membership_tier_pricing", "", {
    method: "POST",
    key: anonKey,
    token: operator.token,
    expected: 403,
    body: { tier_id: ids.tiers[1], product_type: productKeys[1], fixed_price: 1295 },
  });
  pass("direct write boundary", "venue-admin PostgREST write rejected");

  await memberships("tier-pricing", { method: "POST", token: operator.token, expected: 201, body: {
    tierId: ids.tiers[1], product_type: productKeys[1], fixed_price: 1295, discount_percent: null, label: "Play+ · Four occurrences",
  } });
  preview = (await memberships(`series-tier-pricing?venueId=${ids.venue}`, { token: operator.token })).payload;
  const multi = preview.series.find((item) => item.series_id === ids.series[1]);
  const playPlus = multi.tiers.find((item) => item.tier.id === ids.tiers[1]);
  assert(preview.series.length === 2 && playPlus.preview.resolved_price_sek === 1295, "multi-occurrence Series preview did not remain Series scoped");
  pass("multi-occurrence Series", "one product-level member price for the whole Series");

  const commerceRows = (await rest("commerce_orders", `venue_id=eq.${ids.venue}&select=id`)).payload;
  assert(commerceRows.length === 0, "pricing configuration fabricated an Order");
  pass("House Comp/Commerce separation", "pricing configuration created no Order or grant");
} finally {
  await rest("activity_series", `venue_id=eq.${ids.venue}`, { method: "DELETE" }).catch(() => {});
  await rest("access_products", `venue_id=in.(${ids.venue},${ids.foreignVenue})`, { method: "DELETE" }).catch(() => {});
  await rest("membership_tiers", `venue_id=eq.${ids.venue}`, { method: "DELETE" }).catch(() => {});
  await rest("venue_staff", `venue_id=eq.${ids.venue}`, { method: "DELETE" }).catch(() => {});
  await rest("venues", `id=in.(${ids.venue},${ids.foreignVenue})`, { method: "DELETE" }).catch(() => {});
  await request(`${apiUrl}/auth/v1/admin/users/${operator.id}`, { method: "DELETE" }).catch(() => {});
  await request(`${apiUrl}/auth/v1/admin/users/${outsider.id}`, { method: "DELETE" }).catch(() => {});
}

process.stdout.write("SERIES MEMBER PRICING API E2E PASS\n");
