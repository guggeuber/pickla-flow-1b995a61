const apiUrl = process.env.API_URL || "http://127.0.0.1:54321";
const functionUrl = process.env.EVENT_SALES_FUNCTION_URL || `${apiUrl}/functions/v1/event-sales-agent`;
const anonKey = process.env.ANON_KEY;
const serviceKey = process.env.SERVICE_ROLE_KEY;

if (!anonKey || !serviceKey || !apiUrl.startsWith("http://127.0.0.1")) {
  throw new Error("Event-offer E2E only runs against the local Supabase stack");
}

const ids = {
  organization: "e0f00000-0000-4000-8000-000000000001",
  venue: "e0f00000-0000-4000-8000-000000000002",
  otherVenue: "e0f00000-0000-4000-8000-000000000003",
  lead: "e0f00000-0000-4000-8000-000000000004",
  offer: "e0f00000-0000-4000-8000-000000000005",
};

const canonicalPath = [ids.organization, ids.venue, ids.lead, `${ids.offer}.pdf`].join("/");

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
      Authorization: `Bearer ${token || key}`,
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
  return request(`${functionUrl}/${path}`, { method, body, key: anonKey, token, expected });
}

async function createUser(label) {
  const email = `event-offer-${label}-${Date.now()}@example.test`;
  const password = "Event-offer-local-42!";
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

function decodeJwtPayload(token) {
  const encoded = token.split(".")[1];
  assert(encoded, "signed URL has no JWT payload");
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
}

async function listOfferObjects() {
  return (await request(`${apiUrl}/storage/v1/object/list/event-offers`, {
    method: "POST",
    body: { prefix: `${ids.organization}/${ids.venue}/${ids.lead}`, limit: 100 },
  })).payload;
}

async function cleanup(users = []) {
  await rest("event_lead_activities", `event_lead_id=eq.${ids.lead}`, { method: "DELETE" });
  await rest("event_offers", `id=eq.${ids.offer}`, { method: "DELETE" });
  await rest("event_leads", `id=eq.${ids.lead}`, { method: "DELETE" });
  await rest("venue_staff", `venue_id=in.(${ids.venue},${ids.otherVenue})`, { method: "DELETE" });
  await rest("venues", `id=in.(${ids.venue},${ids.otherVenue})`, { method: "DELETE" });
  await rest("organizations", `id=eq.${ids.organization}`, { method: "DELETE" });
  for (const user of users) {
    await request(`${apiUrl}/auth/v1/admin/users/${user.id}`, { method: "DELETE" });
  }
}

async function ensureIdentityScope() {
  const existing = await rest("organizations", "slug=eq.pickla&select=id");
  if (existing.payload.length === 0) {
    await rest("organizations", "", {
      method: "POST",
      body: { id: "e0f00000-0000-4000-8000-000000000000", name: "Pickla Test", slug: "pickla" },
    });
  }
}

const users = [];
try {
  await cleanup();
  await ensureIdentityScope();
  const owner = await createUser("owner");
  const outsider = await createUser("outsider");
  users.push(owner, outsider);

  await rest("organizations", "", {
    method: "POST",
    body: { id: ids.organization, name: "Offer E2E", slug: "offer-e2e" },
  });
  await rest("venues", "", {
    method: "POST",
    body: [
      { id: ids.venue, organization_id: ids.organization, name: "Offer E2E One", slug: "offer-e2e-one" },
      { id: ids.otherVenue, organization_id: ids.organization, name: "Offer E2E Two", slug: "offer-e2e-two" },
    ],
  });
  await rest("venue_staff", "", {
    method: "POST",
    body: [
      { user_id: owner.id, venue_id: ids.venue, role: "venue_admin", is_active: true },
      { user_id: outsider.id, venue_id: ids.otherVenue, role: "venue_admin", is_active: true },
    ],
  });
  await rest("event_leads", "", {
    method: "POST",
    body: {
      id: ids.lead,
      venue_id: ids.venue,
      contact_name: "Offer Test",
      email: "offer-customer@example.test",
      participants_count: 8,
    },
  });
  await rest("event_offers", "", {
    method: "POST",
    body: {
      id: ids.offer,
      venue_id: ids.venue,
      event_lead_id: ids.lead,
      title: "Offer storage E2E",
      total_price: 2360,
      offer_payload: {
        title: "Offer storage E2E",
        intro: "Local test offer.",
        package: { title: "Standard", range: "295 kr/person" },
        customer: {
          company_name: "Offer E2E AB",
          contact_name: "Offer Test",
          email: "offer-customer@example.test",
          participants_count: 8,
        },
        total_price: 2360,
        included: ["Activity"],
        agenda: ["Welcome"],
        resources: ["Court"],
        practical_info: ["Arrive on time"],
        food_drink_options: ["Available separately"],
        terms: ["According to agreement"],
        cta: "Reply to confirm.",
        venue: { email: "test@example.test", phone: "08-000 00 00", address: "Testgatan 1" },
      },
    },
  });

  const generated = await fn("generate-pdf", { method: "POST", body: { offerId: ids.offer }, token: owner.token });
  assert(generated.payload.pdf_url === canonicalPath, "generated PDF did not use the canonical path");
  assert(generated.payload.signed_url, "generate-pdf did not return a signed URL");
  let objects = await listOfferObjects();
  assert(objects.length === 1 && objects[0].name === `${ids.offer}.pdf`, "PDF generation did not create exactly one canonical object");
  pass("generate-pdf", canonicalPath);

  const firstObjectId = objects[0].id;
  await fn("generate-pdf", { method: "POST", body: { offerId: ids.offer }, token: owner.token });
  objects = await listOfferObjects();
  assert(objects.length === 1, "retry created a second PDF object");
  assert(objects[0].id === firstObjectId, "retry replaced the object identity instead of upserting it");
  pass("manual retry", "one object after retry");

  const signed = await fn(`signed-url?offerId=${ids.offer}`, { token: owner.token });
  const token = new URL(signed.payload.signed_url).searchParams.get("token");
  const claims = decodeJwtPayload(token);
  const remainingSeconds = claims.exp - Math.floor(Date.now() / 1000);
  assert(remainingSeconds >= 3500 && remainingSeconds <= 3650, `signed URL TTL was ${remainingSeconds}s, expected one hour`);
  pass("signed-url", `${remainingSeconds}s TTL`);

  const preview = await fn(`preview-send?offerId=${ids.offer}`, { token: owner.token });
  assert(preview.payload.pdf_url === canonicalPath, "preview-send did not expose the canonical path");
  assert(preview.payload.to === "offer-customer@example.test", "preview-send changed the customer recipient");
  pass("preview-send", "canonical PDF attached to preview");

  await fn(`signed-url?offerId=${ids.offer}`, { token: outsider.token, expected: 403 });
  await fn("generate-pdf", { method: "POST", body: { offerId: ids.offer }, token: outsider.token, expected: 403 });
  pass("cross-venue denial", "signed-url and generate-pdf forbidden");

  await rest("event_offers", `id=eq.${ids.offer}`, {
    method: "PATCH",
    body: { pdf_url: `${ids.venue}/${ids.lead}/${ids.offer}.pdf` },
  });
  await fn(`preview-send?offerId=${ids.offer}`, { token: owner.token, expected: 500 });
  await fn(`signed-url?offerId=${ids.offer}`, { token: owner.token, expected: 500 });
  await rest("event_offers", `id=eq.${ids.offer}`, {
    method: "PATCH",
    body: { pdf_url: canonicalPath },
  });
  pass("stale reference denial", "non-canonical paths rejected");
} finally {
  await cleanup(users);
}
