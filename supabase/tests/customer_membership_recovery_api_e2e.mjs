import crypto from "node:crypto";

const apiUrl = process.env.API_URL || "http://127.0.0.1:54321";
const customersUrl = `${apiUrl}/functions/v1/api-customers`;
const membershipsUrl = `${apiUrl}/functions/v1/api-memberships`;
const anonKey = process.env.ANON_KEY;
const serviceKey = process.env.SERVICE_ROLE_KEY;

if (!anonKey || !serviceKey || !apiUrl.startsWith("http://127.0.0.1")) {
  throw new Error("Customer/membership recovery E2E only runs against local Supabase");
}

const run = crypto.randomBytes(5).toString("hex");
const needle = `P0Needle${run}`;
const ids = {
  organizationB: crypto.randomUUID(),
  venueA: crypto.randomUUID(),
  venueA2: crypto.randomUUID(),
  venueB: crypto.randomUUID(),
  tierA: crypto.randomUUID(),
  aliasCustomer: crypto.randomUUID(),
  order: crypto.randomUUID(),
  orderLine: crypto.randomUUID(),
  receipt: crypto.randomUUID(),
};
const users = [];
const customerIds = new Set();

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

async function customers(path, options = {}) {
  return request(`${customersUrl}/${path}`, { key: anonKey, token: options.token ?? null, ...options });
}

async function memberships(path, options = {}) {
  return request(`${membershipsUrl}/${path}`, { key: anonKey, token: options.token ?? null, ...options });
}

async function createUser(label, displayName = label) {
  const email = `p0-recovery-${label}-${run}@example.test`;
  const password = "P0-recovery-local-42!";
  const created = await request(`${apiUrl}/auth/v1/admin/users`, {
    method: "POST",
    body: { email, password, email_confirm: true, user_metadata: { display_name: displayName } },
  });
  const login = await request(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    key: anonKey,
    token: anonKey,
    body: { email, password },
  });
  const user = { id: created.payload.id, email, token: login.payload.access_token };
  users.push(user);
  const customer = (await rest("customers", `auth_user_id=eq.${user.id}&select=id`)).payload[0];
  assert(customer?.id, `canonical customer missing for ${label}`);
  customerIds.add(customer.id);
  await rest("player_profiles", `auth_user_id=eq.${user.id}`, {
    method: "PATCH",
    body: {
      auth_user_id: user.id,
      customer_id: customer.id,
      display_name: displayName,
      first_name: label,
      last_name: "Fixture",
      phone: "+46700000000",
    },
  });
  await rest("customers", `id=eq.${customer.id}`, {
    method: "PATCH",
    body: {
      display_name: displayName,
      first_name: label,
      last_name: "Fixture",
      primary_phone: "+46700000000",
    },
  });
  return { ...user, customerId: customer.id };
}

const organizationA = (await rest("organizations", "slug=eq.pickla&select=id")).payload[0];
assert(organizationA?.id, "local Pickla organization missing");

let operator;
let ordinary;
let globalAdmin;
let personA;
let personA2;
let assignPerson;
let foreignPerson;
try {
  [operator, ordinary, globalAdmin, personA, personA2, assignPerson, foreignPerson] = await Promise.all([
    createUser("operator"),
    createUser("ordinary"),
    createUser("global-admin"),
    createUser("venue-a-person", `${needle} Venue A`),
    createUser("venue-a2-person", `${needle} Venue A2`),
    createUser("canonical-person", `Canonical ${needle}`),
    createUser("foreign-person", `${needle} Foreign`),
  ]);
  await rest("organizations", "", { method: "POST", body: {
    id: ids.organizationB,
    name: `Recovery Org B ${run}`,
    slug: `recovery-org-b-${run}`,
  } });
  await rest("venues", "", { method: "POST", body: [
    { id: ids.venueA, organization_id: organizationA.id, name: "Recovery Venue A", slug: `recovery-a-${run}`, commerce_enabled: true },
    { id: ids.venueA2, organization_id: organizationA.id, name: "Recovery Venue A2", slug: `recovery-a2-${run}`, commerce_enabled: true },
    { id: ids.venueB, organization_id: ids.organizationB, name: "Recovery Venue B", slug: `recovery-b-${run}`, commerce_enabled: true },
  ] });
  await rest("venue_staff", "", { method: "POST", body: {
    venue_id: ids.venueA, user_id: operator.id, role: "venue_admin", is_active: true,
  } });
  await rest("user_roles", "", { method: "POST", body: {
    user_id: globalAdmin.id, role: "super_admin",
  } });
  await rest("customer_venue_profiles", "", { method: "POST", body: [
    { customer_id: personA.customerId, venue_id: ids.venueA, first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString() },
    { customer_id: personA2.customerId, venue_id: ids.venueA2, first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString() },
  ] });

  await rest("customers", `id=eq.${foreignPerson.customerId}`, {
    method: "PATCH", body: { organization_id: ids.organizationB },
  });
  await rest("customer_identities", `customer_id=eq.${foreignPerson.customerId}`, {
    method: "PATCH", body: { organization_id: ids.organizationB },
  });

  await customers("list", { token: null, expected: 401 });
  await customers("list", { token: ordinary.token, expected: 403 });
  await customers("list", { token: operator.token, expected: 403 });
  await customers(`list?venueId=${ids.venueA}`, { token: ordinary.token, expected: 403 });
  await customers(`list?venueId=${ids.venueA2}`, { token: operator.token, expected: 403 });
  pass("directory authorization", "anonymous denied; ordinary denied; venue staff cannot omit or switch venue");

  const globalRows = (await customers(`list?search=${encodeURIComponent(needle)}`, { token: globalAdmin.token })).payload;
  assert(globalRows.some((row) => row.customer_id === personA.customerId), "super-admin global directory authority was not honored");
  assert(globalRows.some((row) => row.customer_id === personA2.customerId), "super-admin global directory omitted second venue fixture");
  pass("explicit global authority", "only a super_admin fixture could list without venueId");

  let venueRows = (await customers(`list?venueId=${ids.venueA}&search=${encodeURIComponent(needle)}`, { token: operator.token })).payload;
  assert(venueRows.some((row) => row.customer_id === personA.customerId), "authorized venue People search omitted linked person");
  assert(!venueRows.some((row) => row.customer_id === personA2.customerId), "cross-venue person leaked into People search");
  assert(!venueRows.some((row) => row.customer_id === foreignPerson.customerId), "cross-organization person leaked into People search");
  pass("People isolation", "authorized venue result contains linked person only");

  let social = (await customers("social-preferences", { token: personA.token })).payload;
  assert(social.social_visibility === "visible", "default social visibility was not restored");
  social = (await customers("social-preferences", {
    method: "PATCH",
    token: personA.token,
    body: { social_visibility: "hidden", booking_notice_shown: true },
  })).payload;
  assert(social.social_visibility === "hidden" && social.booking_notice_shown === true, "social preference update did not persist");
  social = (await customers("social-preferences", { token: personA.token })).payload;
  assert(social.social_visibility === "hidden" && social.booking_notice_shown === true, "social preference read did not round-trip");
  pass("social preferences", "self-only GET/PATCH round-trip restored");

  await rest("commerce_orders", "", { method: "POST", body: {
    id: ids.order,
    organization_id: organizationA.id,
    venue_id: ids.venueA,
    customer_id: personA.customerId,
    user_id: personA.id,
    status: "draft",
    version: 1,
    currency: "SEK",
    subtotal_minor: 10000,
    total_inc_vat_minor: 10000,
    total_ex_vat_minor: 9434,
    vat_amount_minor: 566,
    guest_token_hash: crypto.createHash("sha256").update(`guest-${run}`).digest("hex"),
    guest_name: `${needle} Venue A`,
    guest_email: personA.email,
    checkout_frozen_at: new Date().toISOString(),
    paid_at: new Date().toISOString(),
  } });
  await rest("commerce_order_lines", "", { method: "POST", body: {
    id: ids.orderLine,
    commerce_order_id: ids.order,
    product_key: `recovery_product_${run}`,
    product_name: "Recovery fixture",
    commerce_kind: "retail",
    quantity: 1,
    unit_price_minor: 10000,
    line_total_inc_vat_minor: 10000,
    line_total_ex_vat_minor: 9434,
    vat_rate: 6,
    vat_amount_minor: 566,
    source_type: "catalog",
    fulfillment_type: "none",
    fulfillment_status: "not_required",
    inventory_policy: "stockless",
  } });
  await rest("commerce_orders", `id=eq.${ids.order}`, { method: "PATCH", body: { status: "paid" } });
  await rest("booking_receipts", "", { method: "POST", body: {
    id: ids.receipt,
    receipt_number: `P0-${run}`,
    venue_id: ids.venueA,
    user_id: personA.id,
    customer_id: personA.customerId,
    customer_name: `${needle} Venue A`,
    customer_email: personA.email,
    total_inc_vat: 100,
    total_ex_vat: 94,
    vat_amount: 6,
    total_inc_vat_sek: 100,
    total_ex_vat_sek: 94.34,
    vat_amount_sek: 5.66,
    vat_rate: 6,
    currency: "SEK",
    payment_provider: "manual",
    payment_method: "Recovery fixture",
    payment_status: "paid",
    purchase_type: "commerce_order",
    product_description: "Recovery fixture",
    commerce_order_id: ids.order,
  } });
  await rest("commerce_orders", `id=eq.${ids.order}`, { method: "PATCH", body: { booking_receipt_id: ids.receipt } });

  venueRows = (await customers(`list?venueId=${ids.venueA}&search=${encodeURIComponent(`P0-${run}`)}`, { token: operator.token })).payload;
  assert(venueRows.length === 1 && venueRows[0].commerce_order_ids.includes(ids.order), "People Commerce order lookup did not resolve canonical customer");
  const view360 = (await customers(`360?venueId=${ids.venueA}&commerceOrderId=${ids.order}`, { token: operator.token })).payload;
  assert(view360.customer.customer_id === personA.customerId, "Customer360 did not reuse canonical customer identity");
  assert(view360.commerce_orders.some((order) => order.id === ids.order), "Customer360 omitted Commerce order");
  assert(view360.receipts.some((receipt) => receipt.id === ids.receipt), "Customer360 omitted Commerce receipt");
  pass("Commerce customer view", "People receipt lookup and Customer360 order identity restored");

  await rest("membership_tiers", "", { method: "POST", body: {
    id: ids.tierA,
    venue_id: ids.venueA,
    name: "Recovery tier",
    is_active: true,
    is_assignable: true,
  } });
  await rest("customers", "", { method: "POST", body: {
    id: ids.aliasCustomer,
    organization_id: organizationA.id,
    display_name: "Merged alias",
    status: "merged",
    merged_into_id: assignPerson.customerId,
  } });
  customerIds.add(ids.aliasCustomer);
  await rest("player_profiles", `auth_user_id=eq.${assignPerson.id}`, {
    method: "PATCH", body: { customer_id: ids.aliasCustomer },
  });

  const assigned = (await memberships("assign", {
    method: "POST",
    token: operator.token,
    expected: 201,
    body: { venueId: ids.venueA, customerUserId: assignPerson.id, tierId: ids.tierA, notes: "local recovery fixture" },
  })).payload;
  assert(assigned.customer_id === assignPerson.customerId, "membership did not use canonical customer identity");
  const canonicalLink = (await rest("customer_venue_profiles", `venue_id=eq.${ids.venueA}&customer_id=eq.${assignPerson.customerId}&select=id`)).payload;
  assert(canonicalLink.length === 1, "canonical customer was not linked to venue");
  const assignedProfile = (await rest("player_profiles", `auth_user_id=eq.${assignPerson.id}&select=customer_id`)).payload[0];
  assert(assignedProfile.customer_id === assignPerson.customerId, "merged profile was not repaired to canonical customer");
  pass("canonical membership link", "merged alias resolved to same-org canonical customer before venue link and membership insert");

  await memberships("assign", {
    method: "POST",
    token: operator.token,
    expected: [400, 409],
    body: { venueId: ids.venueA, customerUserId: assignPerson.id, tierId: ids.tierA, notes: "local retry fixture" },
  });
  const retryRows = (await rest("memberships", `venue_id=eq.${ids.venueA}&user_id=eq.${assignPerson.id}&select=id,status`)).payload;
  const activeAfterRetry = retryRows.filter((row) => row.status === "active").length;
  assert(activeAfterRetry === 0, "historical repeat-assignment behavior changed unexpectedly; review required");
  pass("repeat assignment residual", "same-day retry hit the legacy unique key after cancelling the original, leaving zero active rows");

  await memberships("assign", {
    method: "POST",
    token: operator.token,
    expected: 500,
    body: { venueId: ids.venueA, customerUserId: foreignPerson.id, tierId: ids.tierA },
  });
  const foreignLinks = (await rest("customer_venue_profiles", `venue_id=eq.${ids.venueA}&customer_id=eq.${foreignPerson.customerId}&select=id`)).payload;
  const foreignMemberships = (await rest("memberships", `venue_id=eq.${ids.venueA}&user_id=eq.${foreignPerson.id}&select=id`)).payload;
  assert(foreignLinks.length === 0 && foreignMemberships.length === 0, "cross-organization assignment mutated link or membership state");
  pass("cross-organization assignment", "scope mismatch rejected before customer link or membership cancellation/insert");
} finally {
  await rest("commerce_orders", `id=eq.${ids.order}`, { method: "PATCH", body: { booking_receipt_id: null } }).catch(() => {});
  await rest("booking_receipts", `id=eq.${ids.receipt}`, { method: "DELETE" }).catch(() => {});
  await rest("commerce_order_lines", `id=eq.${ids.orderLine}`, { method: "DELETE" }).catch(() => {});
  await rest("commerce_orders", `id=eq.${ids.order}`, { method: "DELETE" }).catch(() => {});
  await rest("memberships", `venue_id=eq.${ids.venueA}`, { method: "DELETE" }).catch(() => {});
  await rest("membership_tiers", `id=eq.${ids.tierA}`, { method: "DELETE" }).catch(() => {});
  await rest("customer_venue_profiles", `venue_id=in.(${ids.venueA},${ids.venueA2},${ids.venueB})`, { method: "DELETE" }).catch(() => {});
  await rest("venue_staff", `venue_id=eq.${ids.venueA}`, { method: "DELETE" }).catch(() => {});
  await rest("venues", `id=in.(${ids.venueA},${ids.venueA2},${ids.venueB})`, { method: "DELETE" }).catch(() => {});
  await rest("customer_identities", `provider_id=in.(${users.map((user) => user.id).join(",")})`, { method: "DELETE" }).catch(() => {});
  await rest("player_profiles", `auth_user_id=in.(${users.map((user) => user.id).join(",")})`, { method: "DELETE" }).catch(() => {});
  await rest("customers", `id=in.(${Array.from(customerIds).join(",")})`, { method: "DELETE" }).catch(() => {});
  await rest("user_roles", `user_id=in.(${users.map((user) => user.id).join(",")})`, { method: "DELETE" }).catch(() => {});
  for (const user of users) {
    await request(`${apiUrl}/auth/v1/admin/users/${user.id}`, { method: "DELETE" }).catch(() => {});
  }
  await rest("organizations", `id=eq.${ids.organizationB}`, { method: "DELETE" }).catch(() => {});
}

process.stdout.write("CUSTOMER/MEMBERSHIP RECOVERY API E2E PASS\n");
