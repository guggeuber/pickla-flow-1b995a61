import crypto from "node:crypto";

const apiUrl = process.env.API_URL || "http://127.0.0.1:54321";
const commerceUrl = process.env.COMMERCE_FUNCTION_URL || `${apiUrl}/functions/v1/api-commerce`;
const coursesUrl = process.env.COURSES_FUNCTION_URL || `${apiUrl}/functions/v1/api-courses`;
const anonKey = process.env.ANON_KEY;
const serviceKey = process.env.SERVICE_ROLE_KEY;

if (!anonKey || !serviceKey || !apiUrl.startsWith("http://127.0.0.1")) {
  throw new Error("Course participant-policy E2E only runs against local Supabase");
}

const run = crypto.randomBytes(5).toString("hex");
const ids = {
  venue: crypto.randomUUID(),
  format: crypto.randomUUID(),
  selfProduct: crypto.randomUUID(),
  adultProduct: crypto.randomUUID(),
  flexibleProduct: crypto.randomUUID(),
  selfSeries: crypto.randomUUID(),
  adultSeries: crypto.randomUUID(),
  flexibleSeries: crypto.randomUUID(),
  otherCustomer: crypto.randomUUID(),
  coachStaff: crypto.randomUUID(),
  coachSessions: Array.from({ length: 4 }, () => crypto.randomUUID()),
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

async function commerce(path, { token = null, ...options } = {}) {
  return request(`${commerceUrl}/${path}`, { key: anonKey, token, ...options });
}

async function courses(path, { token = null, ...options } = {}) {
  return request(`${coursesUrl}/${path}`, { key: anonKey, token, ...options });
}

async function createUser(label) {
  const email = `course-policy-${label}-${run}@example.test`;
  const password = "Course-policy-local-42!";
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

const organization = (await rest("organizations", "slug=eq.pickla&select=id")).payload[0];
assert(organization?.id, "local Pickla organization missing");
const purchaser = await createUser("purchaser");

try {
  await rest("venues", "", { method: "POST", body: {
    id: ids.venue,
    organization_id: organization.id,
    name: "Course Participant Policy E2E",
    slug: `course-policy-${run}`,
    commerce_enabled: true,
  } });
  await rest("activity_formats", "", { method: "POST", body: {
    id: ids.format,
    organization_id: organization.id,
    name: `Course Policy ${run}`,
    description: "E2E",
    age_group: "adult",
    level: "intermediate",
    requires_instructor: true,
    presentation_type: "course",
  } });
  const product = (id, key, policy) => ({
    id,
    venue_id: ids.venue,
    product_key: key,
    name: `Course ${policy}`,
    product_kind: "series_access",
    commerce_kind: "participation",
    fulfillment_type: "participation",
    fulfillment_presentation: "participation",
    base_price_sek: 1495,
    vat_rate: 6,
    is_active: true,
    status: "active",
    commerce_enabled: true,
    resolver_rules: { purchase_kind: "course", max_quantity: 1, participant_policy: policy },
  });
  const productKeys = [`course_self_${run}`, `course_adult_${run}`, `course_flexible_${run}`];
  await rest("access_products", "", { method: "POST", body: [
    product(ids.selfProduct, productKeys[0], "self_only"),
    product(ids.adultProduct, productKeys[1], "self_or_adult"),
    product(ids.flexibleProduct, productKeys[2], "self_adult_or_dependent"),
  ] });
  const series = (id, accessProductId, productKey, name) => ({
    id,
    venue_id: ids.venue,
    format_id: ids.format,
    access_product_id: accessProductId,
    product_key: productKey,
    name,
    series_type: "course",
    status: "active",
    start_date: "2027-09-02",
    end_date: "2027-09-23",
    total_sessions: 4,
    registration_opens_at: "2026-01-01T00:00:00Z",
    registration_closes_at: "2027-09-01T22:00:00Z",
    capacity: 12,
    recurrence_days: [4],
    start_time: "18:00",
    end_time: "19:00",
    court_ids: [],
  });
  await rest("activity_series", "", { method: "POST", body: [
    series(ids.selfSeries, ids.selfProduct, productKeys[0], "Self-only Course"),
    series(ids.adultSeries, ids.adultProduct, productKeys[1], "Adult-delegate Course"),
    series(ids.flexibleSeries, ids.flexibleProduct, productKeys[2], "Dependent Course"),
  ] });
  await rest("customers", "", { method: "POST", body: {
    id: ids.otherCustomer,
    organization_id: organization.id,
    display_name: "Other Customer",
    primary_email: `other-${run}@example.test`,
    email_normalized: `other-${run}@example.test`,
  } });

  await commerce("course-cart", { method: "POST", expected: 401, body: { series_id: ids.selfSeries } });
  pass("self-only auth", "anonymous cart rejected before participant creation");

  const beforeCustomers = (await rest("customers", `organization_id=eq.${organization.id}&primary_email=eq.delegate-${run}%40example.test&select=id`)).payload.length;
  const beforeDependents = (await rest("dependent_participants", `organization_id=eq.${organization.id}&select=id`, {})).payload.length;
  const adultRejected = await commerce("course-cart", {
    method: "POST",
    token: purchaser.token,
    expected: 409,
    body: {
      series_id: ids.selfSeries,
      participant_type: "adult",
      participant_name: "Delegated Adult",
      participant_email: `delegate-${run}@example.test`,
    },
  });
  assert(/verifierade köparen själv/.test(adultRejected.payload?.error || ""), "adult rejection was not policy-specific");
  await commerce("course-cart", {
    method: "POST",
    token: purchaser.token,
    expected: 409,
    body: { series_id: ids.selfSeries, participant_type: "dependent", dependent_first_name: "Elsa", dependent_birth_year: 2016 },
  });
  await commerce("course-cart", {
    method: "POST",
    token: purchaser.token,
    expected: 409,
    body: { series_id: ids.selfSeries, participant_type: "self", beneficiary_customer_id: ids.otherCustomer },
  });
  const afterCustomers = (await rest("customers", `organization_id=eq.${organization.id}&primary_email=eq.delegate-${run}%40example.test&select=id`)).payload.length;
  const afterDependents = (await rest("dependent_participants", `organization_id=eq.${organization.id}&select=id`)).payload.length;
  assert(beforeCustomers === afterCustomers && beforeDependents === afterDependents, "rejected self-only requests created participant identity rows");
  pass("tamper boundary", "adult, dependent and hidden alternate-customer input rejected before writes");

  const valid = (await commerce("course-cart", {
    method: "POST",
    token: purchaser.token,
    expected: 201,
    body: { series_id: ids.selfSeries },
  })).payload;
  const purchaserCustomers = (await rest("customers", `auth_user_id=eq.${purchaser.id}&select=id,auth_user_id`)).payload;
  assert(purchaserCustomers.length === 1, "self-only cart created duplicate purchaser Customers");
  const payerCustomerId = purchaserCustomers[0].id;
  const [line] = (await rest("commerce_order_lines", `commerce_order_id=eq.${valid.order.id}&select=id,beneficiary_user_id,beneficiary_customer_id,dependent_participant_id,metadata`)).payload;
  assert(line.beneficiary_user_id === purchaser.id && line.beneficiary_customer_id === payerCustomerId && !line.dependent_participant_id, "self-only beneficiary is not the verified purchaser");
  assert(line.metadata?.participant_type === "self" && line.metadata?.participant_policy === "self_only", "self-only snapshot missing");
  await commerce("resolve", { method: "POST", token: purchaser.token, expected: 200, body: { token: valid.order.id } });
  pass("self-only canonical mapping", "one Customer; payer, participant and beneficiary are identical");

  const tampered = (await commerce("course-cart", {
    method: "POST",
    token: purchaser.token,
    expected: 201,
    body: { series_id: ids.selfSeries },
  })).payload;
  const [tamperedLine] = (await rest("commerce_order_lines", `commerce_order_id=eq.${tampered.order.id}&select=id`)).payload;
  await rest("commerce_order_lines", `id=eq.${tamperedLine.id}`, {
    method: "PATCH",
    body: { beneficiary_customer_id: ids.otherCustomer, beneficiary_user_id: null, metadata: { participant_type: "adult" } },
  });
  await commerce("checkout", {
    method: "POST",
    token: purchaser.token,
    expected: 409,
    body: { token: tampered.order.id, expected_version: tampered.order.version },
  });
  const commitments = (await rest("series_commitments", `activity_series_id=eq.${ids.selfSeries}&select=id`)).payload;
  assert(commitments.length === 0, "tampered checkout created a Course commitment");
  pass("checkout defense", "tampered frozen beneficiary rejected before payment/registration");

  const delegatedAdult = (await commerce("course-cart", {
    method: "POST",
    token: purchaser.token,
    expected: 201,
    body: {
      series_id: ids.adultSeries,
      participant_type: "adult",
      participant_name: "Allowed Adult",
      participant_email: `allowed-adult-${run}@example.test`,
    },
  })).payload;
  const [adultLine] = (await rest("commerce_order_lines", `commerce_order_id=eq.${delegatedAdult.order.id}&select=beneficiary_customer_id,dependent_participant_id`)).payload;
  assert(adultLine.beneficiary_customer_id && adultLine.beneficiary_customer_id !== payerCustomerId && !adultLine.dependent_participant_id, "configured adult delegation regressed");
  pass("delegated adult regression", "self_or_adult still creates the intended adult beneficiary");

  const dependent = (await commerce("course-cart", {
    method: "POST",
    token: purchaser.token,
    expected: 201,
    body: {
      series_id: ids.flexibleSeries,
      participant_type: "dependent",
      dependent_first_name: "Allowed Child",
      dependent_birth_year: 2016,
    },
  })).payload;
  const [dependentLine] = (await rest("commerce_order_lines", `commerce_order_id=eq.${dependent.order.id}&select=beneficiary_customer_id,dependent_participant_id`)).payload;
  assert(!dependentLine.beneficiary_customer_id && dependentLine.dependent_participant_id, "configured dependent flow regressed");
  const [dependentRow] = (await rest("dependent_participants", `id=eq.${dependentLine.dependent_participant_id}&select=guardian_customer_id`)).payload;
  assert(dependentRow.guardian_customer_id === payerCustomerId, "guardian ownership changed");
  pass("dependent regression", "guardian-owned dependent remains available only on configured offers");

  await rest("player_profiles", `auth_user_id=eq.${purchaser.id}`, {
    method: "PATCH",
    body: { display_name: "Gunnar Svalander" },
  });
  await rest("venue_staff", "", { method: "POST", body: {
    id: ids.coachStaff,
    venue_id: ids.venue,
    user_id: purchaser.id,
    role: "venue_admin",
    is_active: true,
  } });
  const coachDates = ["2027-09-02", "2027-09-09", "2027-09-16", "2027-09-23"];
  await rest("activity_sessions", "", { method: "POST", body: coachDates.map((sessionDate, index) => ({
    id: ids.coachSessions[index],
    venue_id: ids.venue,
    series_id: ids.selfSeries,
    name: `Self-only Course ${index + 1}`,
    session_type: "course",
    sport_type: "pickleball",
    session_date: sessionDate,
    start_time: "18:00",
    end_time: "19:00",
    price_sek: 0,
    capacity: 12,
    court_ids: [],
    access_policy: {},
    is_active: true,
    publish_status: "published",
    series_occurrence_index: index + 1,
    requires_staffing: true,
  })) });
  await rest("operational_staff_assignments", "", { method: "POST", body: coachDates.map((occurrenceDate, index) => ({
    venue_id: ids.venue,
    source_type: "activity_session",
    source_id: ids.coachSessions[index],
    occurrence_date: occurrenceDate,
    venue_staff_id: ids.coachStaff,
    role: "instructor",
    status: "active",
  })) });
  const publicCourse = (await courses(`detail?seriesId=${ids.selfSeries}`, { expected: 200 })).payload;
  assert(publicCourse.participant_policy === "self_only", "public Course policy did not use canonical offer configuration");
  assert(JSON.stringify(publicCourse.coach) === JSON.stringify({
    coverage: "complete",
    mode: "single",
    coaches: [{ display_name: "Gunnar Svalander" }],
  }), "public Course coach did not resolve canonical occurrence staffing");
  const publicCoachJson = JSON.stringify(publicCourse.coach);
  assert(!/auth_user_id|user_id|venue_staff|email|phone|customer|private/i.test(publicCoachJson), "public coach projection leaked private staffing identity");
  pass("public coach projection", "anonymous detail returns one canonical display name without private staffing identity");
} finally {
  await rest("commerce_orders", `venue_id=eq.${ids.venue}`, { method: "DELETE" }).catch(() => {});
  await rest("dependent_participants", `organization_id=eq.${organization.id}&first_name=eq.Allowed Child`, { method: "DELETE" }).catch(() => {});
  await rest("operational_staff_assignments", `venue_id=eq.${ids.venue}`, { method: "DELETE" }).catch(() => {});
  await rest("venue_staff", `id=eq.${ids.coachStaff}`, { method: "DELETE" }).catch(() => {});
  await rest("activity_sessions", `venue_id=eq.${ids.venue}`, { method: "DELETE" }).catch(() => {});
  await rest("activity_series", `venue_id=eq.${ids.venue}`, { method: "DELETE" }).catch(() => {});
  await rest("access_products", `venue_id=eq.${ids.venue}`, { method: "DELETE" }).catch(() => {});
  await rest("customers", `organization_id=eq.${organization.id}&primary_email=like.*-${run}%40example.test`, { method: "DELETE" }).catch(() => {});
  await rest("venues", `id=eq.${ids.venue}`, { method: "DELETE" }).catch(() => {});
  await request(`${apiUrl}/auth/v1/admin/users/${purchaser.id}`, { method: "DELETE" }).catch(() => {});
}

process.stdout.write("COURSE PARTICIPANT POLICY API E2E PASS\n");
