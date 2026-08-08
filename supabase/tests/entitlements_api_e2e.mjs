import crypto from "node:crypto";

const apiUrl = process.env.API_URL || "http://127.0.0.1:54321";
const functionUrl = process.env.ENTITLEMENTS_FUNCTION_URL || `${apiUrl}/functions/v1/api-entitlements`;
const anonKey = process.env.ANON_KEY;
const serviceKey = process.env.SERVICE_ROLE_KEY;

if (!anonKey || !serviceKey || !apiUrl.startsWith("http://127.0.0.1")) {
  throw new Error("Entitlements E2E only runs against the local Supabase stack");
}

const run = crypto.randomBytes(5).toString("hex");
const ids = {
  venue: crypto.randomUUID(),
  otherVenue: crypto.randomUUID(),
  session: crypto.randomUUID(),
  otherSession: crypto.randomUUID(),
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pass(name, detail = "ok") {
  process.stdout.write(`PASS ${name}: ${detail}\n`);
}

async function request(url, { method = "GET", body, key = serviceKey, token, expected } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      apikey: key,
      ...(token === null ? {} : { Authorization: `Bearer ${token || key}` }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
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
  return request(`${apiUrl}/rest/v1/${table}${query ? `?${query}` : ""}`, {
    ...options,
    headers: undefined,
  });
}

async function fn(path, { method = "GET", body, token, expected } = {}) {
  return request(`${functionUrl}/${path}`, {
    method,
    body,
    key: anonKey,
    token: token ?? null,
    expected,
  });
}

async function rpc(name, body) {
  return request(`${apiUrl}/rest/v1/rpc/${name}`, { method: "POST", body });
}

async function createUser(label) {
  const email = `entitlement-${label}-${run}@example.test`;
  const password = "Entitlement-local-42!";
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
  return { id: created.payload.id, token: login.payload.access_token, email };
}

function assertNoForbiddenKeys(value, forbiddenFragments, path = "payload") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, forbiddenFragments, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    const forbidden = forbiddenFragments.find((fragment) => normalized.includes(fragment));
    assert(!forbidden, `${path}.${key} exposed forbidden field fragment ${forbidden}`);
    assertNoForbiddenKeys(child, forbiddenFragments, `${path}.${key}`);
  }
}

const forbiddenPublic = [
  "program_id", "program_key", "partner_program", "counterparty", "external_reference",
  "legacy_source", "operator_note", "imported_by", "settlement", "reimbursement", "amount_minor",
  "funding_counterparty", "issuance_key", "metadata",
];

const organization = (await rest("organizations", "slug=eq.pickla&select=id")).payload[0];
assert(organization?.id, "local Pickla organization missing");
await rest("venues", "", { method: "POST", body: [
  { id: ids.venue, organization_id: organization.id, name: "Entitlement API Venue", slug: `entitlement-api-${run}` },
  { id: ids.otherVenue, organization_id: organization.id, name: "Entitlement Other Venue", slug: `entitlement-other-${run}` },
] });
await rest("activity_sessions", "", { method: "POST", body: [
  { id: ids.session, venue_id: ids.venue, name: "Bruce Open Play", session_type: "open_play", session_date: "2026-08-06", start_time: "10:00", end_time: "12:00", price_sek: 165, product_key: "open_play_slot" },
  { id: ids.otherSession, venue_id: ids.venue, name: "Ordinary Open Play", session_type: "open_play", session_date: "2026-08-06", start_time: "13:00", end_time: "15:00", price_sek: 165, product_key: "open_play_slot" },
] });

const operator = await createUser("operator");
const customer = await createUser("customer");
const outsider = await createUser("outsider");
await rest("venue_staff", "", { method: "POST", body: [
  { venue_id: ids.venue, user_id: operator.id, role: "venue_admin", is_active: true },
  { venue_id: ids.otherVenue, user_id: outsider.id, role: "venue_admin", is_active: true },
] });
const customerRow = (await rest("customers", `auth_user_id=eq.${customer.id}&select=id`)).payload[0];
assert(customerRow?.id, "customer identity did not resolve");

const createdProgram = await fn("programs", {
  method: "POST",
  token: operator.token,
  body: {
    venueId: ids.venue,
    programKey: `bruce-${run}`,
    name: "Bruce",
    activityLabel: "Bruce gäller",
    accessReason: "Ingår via Bruce",
    deskLabel: "Bruce",
    fundingCounterpartyRef: `bruce-contract-${run}`,
    reimbursementAmountMinor: 12500,
    settlementRule: { version: "1", basis: "valid_attendance" },
  },
});
assert(createdProgram.payload.name === "Bruce", "program creation changed the configured program");
pass("program configuration", "generic partner program created by venue staff");

const beforeLabel = await fn(`session-labels?venueId=${ids.venue}&sessionId=${ids.session}`, { token: null });
assert(Array.isArray(beforeLabel.payload.labels) && beforeLabel.payload.labels.length === 0, "unconfigured session exposed a partner label");
await fn("session-eligibility", {
  method: "POST",
  token: operator.token,
  body: { venueId: ids.venue, sessionId: ids.session, programId: createdProgram.payload.id, eligible: true },
});
const publicLabel = await fn(`session-labels?venueId=${ids.venue}&sessionId=${ids.session}`, { token: null });
assert(JSON.stringify(publicLabel.payload) === JSON.stringify({ labels: [{ label: "Bruce gäller" }] }), "public label projection was not exact");
assertNoForbiddenKeys(publicLabel.payload, forbiddenPublic);
const noneligibleLabel = await fn(`session-labels?venueId=${ids.venue}&sessionId=${ids.otherSession}`, { token: null });
assert(noneligibleLabel.payload.labels.length === 0, "noneligible session exposed Bruce");
pass("public eligibility label", "only eligible session returns Bruce gäller");

await fn(`programs?venueId=${ids.venue}`, { token: outsider.token, expected: 403 });
await fn("session-eligibility", {
  method: "POST",
  token: outsider.token,
  body: { venueId: ids.venue, sessionId: ids.session, programId: createdProgram.payload.id, eligible: false },
  expected: 403,
});
pass("cross-venue admin denial", "program reads and eligibility writes forbidden");

const partnerRight = await fn("partner-entitlement", {
  method: "POST",
  token: operator.token,
  body: {
    venueId: ids.venue,
    programId: createdProgram.payload.id,
    sessionId: ids.session,
    serviceDate: "2026-08-06",
    externalReference: `bruce-booking-${run}`,
    customerId: customerRow.id,
  },
});
assert(partnerRight.payload.reason === "Ingår via Bruce", "partner entitlement lost its customer-safe reason");
assertNoForbiddenKeys(partnerRight.payload, forbiddenPublic);

const resolution = await rpc("resolve_access_entitlement", {
  p_venue_id: ids.venue,
  p_customer_id: customerRow.id,
  p_activity_session_id: ids.session,
  p_service_date: "2026-08-06",
  p_at: "2026-08-06T10:00:00Z",
});
assert(resolution.payload.covered === true && resolution.payload.pricing_consequence === "included", "partner access did not produce included pricing consequence");
pass("partner access pricing", "participant consequence is included / 0 kr with provenance");

const myRights = await fn("my", { token: customer.token });
const myPartner = myRights.payload.rights.find((right) => right.id === partnerRight.payload.id);
assert(myPartner?.label === "Ingår via Bruce", "My Page projection did not use Ingår via Bruce");
assertNoForbiddenKeys(myRights.payload, forbiddenPublic);
const staffProjection = await fn(`customer?venueId=${ids.venue}&customerId=${customerRow.id}`, { token: operator.token });
assert(staffProjection.payload.rights.some((right) => right.id === partnerRight.payload.id && right.reason === "Ingår via Bruce"), "Desk allowlist omitted partner reason");
assertNoForbiddenKeys(staffProjection.payload, forbiddenPublic);
pass("safe customer projections", "My Page and Desk allowlists contain no finance/import internals");

await fn("legacy-punch-card", {
  method: "POST",
  token: customer.token,
  body: {
    venueId: ids.venue,
    customerId: customerRow.id,
    remainingVisits: 1,
    scopeType: "open_play",
    legacySourceRef: `legacy-${run}`,
    operatorNote: "Forbidden self-import",
    funder: "self_prepaid",
  },
  expected: 403,
});
const imported = await fn("legacy-punch-card", {
  method: "POST",
  token: operator.token,
  body: {
    venueId: ids.venue,
    customerId: customerRow.id,
    remainingVisits: 1,
    scopeType: "open_play",
    legacySourceRef: `legacy-${run}`,
    operatorNote: "Physical card verified",
    funder: "self_prepaid",
  },
});
assert(imported.payload.remaining_uses === 1, "legacy import did not preserve remaining visits");
const afterImport = await fn("my", { token: customer.token });
assert(afterImport.payload.rights.some((right) => right.id === imported.payload.id && right.label === "Klippkort · 1 gånger kvar"), "My Page punch-card count missing");
pass("legacy import", "staff-only, visible count, no invented monetary value");

const privateRead = await request(
  `${apiUrl}/rest/v1/access_entitlements?id=eq.${partnerRight.payload.id}&select=id,funding_counterparty_ref,external_reference,operator_note`,
  { key: anonKey, token: customer.token, expected: [400, 401, 403] },
);
assert(privateRead.response.status >= 400, "private entitlement columns were readable directly");
pass("column security", "private partner/import columns denied to customer JWT");

const consumeBody = (key) => ({
  p_entitlement_id: imported.payload.id,
  p_customer_id: customerRow.id,
  p_venue_id: ids.venue,
  p_idempotency_key: key,
  p_quantity: 1,
  p_activity_session_id: ids.session,
  p_session_date: "2026-08-06",
  p_occurred_at: "2026-08-06T10:15:00Z",
});
const concurrent = await Promise.all([
  request(`${apiUrl}/rest/v1/rpc/consume_access_entitlement`, { method: "POST", body: consumeBody(`concurrent-a-${run}`), expected: [200, 400] }),
  request(`${apiUrl}/rest/v1/rpc/consume_access_entitlement`, { method: "POST", body: consumeBody(`concurrent-b-${run}`), expected: [200, 400] }),
]);
assert(concurrent.some(({ response }) => response.ok), "both concurrent punch-card calls failed");
assert(concurrent.filter(({ response }) => !response.ok).every(({ payload }) => payload?.message === "entitlement_exhausted"), "losing concurrent call failed for an unexpected reason");
const punchUses = (await rest("entitlement_consumptions", `entitlement_id=eq.${imported.payload.id}&event_type=eq.use&select=id`)).payload;
const punchRow = (await rest("access_entitlements", `id=eq.${imported.payload.id}&select=uses_count,status`)).payload[0];
assert(punchUses.length === 1 && punchRow.uses_count === 1 && punchRow.status === "exhausted", "concurrent calls overspent one remaining visit");
pass("concurrent occurrence use", "one visit produced exactly one use and exhausted the card");

const partnerUse = await rpc("consume_access_entitlement", {
  p_entitlement_id: partnerRight.payload.id,
  p_customer_id: customerRow.id,
  p_venue_id: ids.venue,
  p_idempotency_key: `partner-attendance-${run}`,
  p_quantity: 1,
  p_activity_session_id: ids.session,
  p_session_date: "2026-08-06",
  p_occurred_at: "2026-08-06T10:20:00Z",
});
await rpc("consume_access_entitlement", {
  p_entitlement_id: partnerRight.payload.id,
  p_customer_id: customerRow.id,
  p_venue_id: ids.venue,
  p_idempotency_key: `partner-attendance-${run}`,
  p_quantity: 1,
  p_activity_session_id: ids.session,
  p_session_date: "2026-08-06",
  p_occurred_at: "2026-08-06T10:20:00Z",
});
const receivables = (await rest("partner_receivable_events", `entitlement_consumption_id=eq.${partnerUse.payload.consumption_id}&select=id,event_type,amount_minor,settlement_state`)).payload;
assert(receivables.length === 1 && receivables[0].amount_minor === 12500 && receivables[0].settlement_state === "pending", "partner attendance did not create exactly one pending receivable");
await fn("reverse-consumption", {
  method: "POST",
  token: operator.token,
  body: {
    venueId: ids.venue,
    consumptionId: partnerUse.payload.consumption_id,
    reason: "E2E attendance correction",
    idempotencyKey: `partner-reversal-${run}`,
  },
});
const reversed = (await rest("partner_receivable_events", `partner_program_id=eq.${createdProgram.payload.id}&select=event_type`)).payload;
assert(reversed.filter((event) => event.event_type === "accrued").length === 1 && reversed.filter((event) => event.event_type === "reversal").length === 1, "partner reversal did not append exactly one finance reversal");
pass("partner receivable lifecycle", "one accrued event, retry-safe, one explicit reversal");

process.stdout.write("ENTITLEMENTS API E2E PASSED\n");
