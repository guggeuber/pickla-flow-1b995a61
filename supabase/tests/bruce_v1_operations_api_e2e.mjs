import crypto from "node:crypto";

const apiUrl = process.env.API_URL || "http://127.0.0.1:54321";
const functionUrl = process.env.ENTITLEMENTS_FUNCTION_URL || `${apiUrl}/functions/v1/api-entitlements`;
const anonKey = process.env.ANON_KEY;
const serviceKey = process.env.SERVICE_ROLE_KEY;

if (!anonKey || !serviceKey || !apiUrl.startsWith("http://127.0.0.1")) {
  throw new Error("Bruce V1 E2E only runs against the local Supabase stack");
}

const run = crypto.randomBytes(5).toString("hex");
const venueId = crypto.randomUUID();
const otherVenueId = crypto.randomUUID();
const sessionId = crypto.randomUUID();
const serviceDate = "2026-08-10";

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

async function rpc(name, body) {
  return request(`${apiUrl}/rest/v1/rpc/${name}`, { method: "POST", body });
}

async function createUser(label) {
  const email = `bruce-v1-${label}-${run}@example.test`;
  const password = "Bruce-v1-local-42!";
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
  return { id: created.payload.id, token: login.payload.access_token };
}

const organization = (await rest("organizations", "slug=eq.pickla&select=id")).payload[0];
await rest("venues", "", { method: "POST", body: [
  { id: venueId, organization_id: organization.id, name: "Bruce V1 API Venue", slug: `bruce-v1-api-${run}` },
  { id: otherVenueId, organization_id: organization.id, name: "Bruce V1 Other Venue", slug: `bruce-v1-other-${run}` },
] });
await rest("activity_sessions", "", { method: "POST", body: {
  id: sessionId,
  venue_id: venueId,
  name: "Bruce V1 Open Play",
  session_type: "open_play",
  session_date: serviceDate,
  start_time: "10:00",
  end_time: "12:00",
  price_sek: 165,
  capacity: 8,
  product_key: "open_play_slot",
  publish_status: "published",
} });

const operator = await createUser("operator");
const outsider = await createUser("outsider");
await rest("venue_staff", "", { method: "POST", body: [
  { venue_id: venueId, user_id: operator.id, role: "venue_admin", is_active: true },
  { venue_id: otherVenueId, user_id: outsider.id, role: "venue_admin", is_active: true },
] });

const program = await fn("programs", {
  method: "POST",
  token: operator.token,
  body: {
    venueId,
    programKey: `bruce-v1-${run}`,
    name: "Bruce",
    activityLabel: "Bruce gäller",
    accessReason: "Ingår via Bruce",
    deskLabel: "Bruce",
    fundingCounterpartyRef: `fixture-contract-${run}`,
    reimbursementAmountMinor: 12500,
    settlementRule: { version: "bruce-v1", basis: "attendance" },
    agreementVersion: "bruce-v1",
    agreementEffectiveDate: "2026-08-01",
    consumptionTrigger: "on_checkin",
    noShowPolicy: "do_not_consume",
  },
});
await fn("session-eligibility", {
  method: "POST",
  token: operator.token,
  body: { venueId, sessionId, programId: program.payload.id, eligible: true, allocatedCapacity: 4 },
});
const configuration = await fn(`programs?venueId=${venueId}`, { token: operator.token });
const eligibility = configuration.payload.session_eligibility.find((row) => row.activity_session_id === sessionId);
assert(eligibility.allocated_capacity === 4 && eligibility.publication_status === "needs_publication", "Bruce allocation/publication queue missing");
const label = await fn(`session-labels?venueId=${venueId}&sessionId=${sessionId}`, { token: null });
assert(JSON.stringify(label.payload) === JSON.stringify({ labels: [{ label: "Bruce gäller" }] }), "public Bruce label changed");
pass("session eligibility, capacity and public label");

const deskSessions = await fn(`desk-sessions?venueId=${venueId}&date=${serviceDate}`, { token: operator.token });
assert(deskSessions.payload.sessions.length === 1
  && deskSessions.payload.sessions[0].allocated_capacity === 4
  && deskSessions.payload.sessions[0].registered_count === 0,
"Desk session projection was incorrect");
await fn(`desk-sessions?venueId=${venueId}&date=${serviceDate}`, { token: outsider.token, expected: 403 });
pass("venue-scoped Desk session projection");

const customer = await fn("partner-customer", {
  method: "POST",
  token: operator.token,
  body: {
    venueId,
    firstName: "Bruce",
    lastName: "Customer",
    phone: `+4670${run.slice(0, 7)}`,
    email: `bruce-v1-customer-${run}@example.test`,
  },
});
assert(customer.payload.customer_id, "Desk customer was not canonical");
await fn("partner-customer", {
  method: "POST",
  token: operator.token,
  body: {
    venueId,
    firstName: "Duplicate",
    lastName: "Customer",
    phone: `+4670${run.slice(0, 7)}`,
  },
  expected: 409,
});
pass("canonical search/create customer boundary");

const visitBody = {
  venueId,
  programId: program.payload.id,
  sessionId,
  serviceDate,
  customerId: customer.payload.customer_id,
  externalReference: null,
  operatorNote: "Verified visually in Bruce Studio",
};
const visit = await fn("partner-visit", { method: "POST", token: operator.token, body: visitBody });
const retry = await fn("partner-visit", { method: "POST", token: operator.token, body: visitBody });
assert(visit.payload.entitlement_id === retry.payload.entitlement_id
  && visit.payload.registration_id === retry.payload.registration_id
  && visit.payload.price_paid_sek === 0,
"Desk partner visit was not idempotent/payment-free");
const registrations = (await rest("session_registrations", `source_id=eq.${visit.payload.entitlement_id}&select=id,price_paid_sek,stripe_session_id,source_type`)).payload;
assert(registrations.length === 1
  && registrations[0].price_paid_sek === 0
  && registrations[0].stripe_session_id === null
  && registrations[0].source_type === "partner_access",
"Desk created a fake checkout or duplicate registration");
await fn("partner-visit", { method: "POST", token: outsider.token, body: visitBody, expected: 403 });
pass("atomic no-payment Desk registration");

const firstCheckin = await rpc("check_in_with_entitlement", {
  p_entitlement_id: visit.payload.entitlement_id,
  p_customer_id: customer.payload.customer_id,
  p_venue_id: venueId,
  p_entry_type: "partner_access",
  p_session_date: serviceDate,
  p_activity_session_id: sessionId,
});
const secondCheckin = await rpc("check_in_with_entitlement", {
  p_entitlement_id: visit.payload.entitlement_id,
  p_customer_id: customer.payload.customer_id,
  p_venue_id: venueId,
  p_entry_type: "partner_access",
  p_session_date: serviceDate,
  p_activity_session_id: sessionId,
});
assert(firstCheckin.payload.already_checked_in === false && secondCheckin.payload.already_checked_in === true, "Bruce check-in idempotency failed");
const consumptions = (await rest("entitlement_consumptions", `entitlement_id=eq.${visit.payload.entitlement_id}&event_type=eq.use&select=id,reimbursement_rate_minor,reimbursement_agreement_version,reimbursement_effective_date`)).payload;
const receivables = (await rest("partner_receivable_events", `entitlement_consumption_id=eq.${consumptions[0].id}&event_type=eq.accrued&select=id,amount_minor,settlement_state`)).payload;
assert(consumptions.length === 1
  && receivables.length === 1
  && consumptions[0].reimbursement_rate_minor === 12500
  && consumptions[0].reimbursement_agreement_version === "bruce-v1"
  && receivables[0].amount_minor === 12500
  && receivables[0].settlement_state === "pending",
"Check-in did not create one frozen consumption and one pending receivable");
pass("exactly-once check-in, consumption and receivable");

const settlementReference = `bruce-self-invoice-${run}`;
await fn("settle-receivable", {
  method: "POST",
  token: operator.token,
  body: { venueId, receivableId: receivables[0].id, settlementReference },
});
await fn("settle-receivable", {
  method: "POST",
  token: operator.token,
  body: { venueId, receivableId: receivables[0].id, settlementReference },
});
const operations = await fn(`operations?venueId=${venueId}`, { token: operator.token });
const settled = operations.payload.receivables.find((row) => row.id === receivables[0].id);
assert(settled?.settlement_state === "settled" && settled.settlement_reference === settlementReference, "Manual settlement was not reflected in reports");
const settlementEvents = (await rest("partner_receivable_settlement_events", `partner_receivable_event_id=eq.${receivables[0].id}&select=id`)).payload;
assert(settlementEvents.length === 1, "Settlement retry duplicated append-only history");
pass("pending to manually settled receivable");

await fn("session-eligibility", {
  method: "POST",
  token: operator.token,
  body: { venueId, sessionId, programId: program.payload.id, publicationStatus: "published" },
});
await rest("activity_sessions", `id=eq.${sessionId}`, { method: "PATCH", body: { start_time: "10:15" } });
const changedConfiguration = await fn(`programs?venueId=${venueId}`, { token: operator.token });
const changed = changedConfiguration.payload.session_eligibility.find((row) => row.activity_session_id === sessionId);
assert(changed.publication_status === "changed", "Published session change did not enter Changed state");
await fn("session-eligibility", {
  method: "POST",
  token: operator.token,
  body: { venueId, sessionId, programId: program.payload.id, publicationStatus: "error" },
  expected: 400,
});
pass("manual publication lifecycle");

process.stdout.write("BRUCE V1 OPERATIONS API E2E PASSED\n");
