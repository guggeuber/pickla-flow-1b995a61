import crypto from "node:crypto";

const apiUrl = process.env.API_URL || "http://127.0.0.1:54321";
const commerceUrl = process.env.COMMERCE_FUNCTION_URL || `${apiUrl}/functions/v1/api-commerce`;
const anonKey = process.env.ANON_KEY;
const serviceKey = process.env.SERVICE_ROLE_KEY;
if (!anonKey || !serviceKey || !apiUrl.startsWith("http://127.0.0.1")) {
  throw new Error("Commerce R1B concurrency test only runs against the local Supabase stack");
}

const runId = crypto.randomUUID();
const venueId = crypto.randomUUID();
const productId = crypto.randomUUID();
const source = `commerce_r1b_concurrency_${runId}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(url, { method = "GET", body, key = serviceKey, token, expected } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      apikey: key,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(method === "POST" ? { Prefer: "return=representation" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (expected !== undefined ? response.status !== expected : !response.ok) {
    throw new Error(`${method} ${new URL(url).pathname} ${response.status}: ${text.slice(0, 1000)}`);
  }
  return { status: response.status, payload };
}

async function rest(table, query = "", options = {}) {
  return request(`${apiUrl}/rest/v1/${table}${query ? `?${query}` : ""}`, {
    ...options,
    key: serviceKey,
    token: serviceKey,
  });
}

async function seed() {
  const organizations = (await rest("organizations", "select=id&limit=1")).payload;
  assert(organizations[0]?.id, "Local organization missing");
  await rest("venues", "", {
    method: "POST",
    expected: 201,
    body: {
      id: venueId,
      organization_id: organizations[0].id,
      name: "R1B Concurrency",
      slug: `r1b-${runId}`,
      commerce_enabled: true,
    },
  });
  await rest("access_products", "", {
    method: "POST",
    expected: 201,
    body: {
      id: productId,
      venue_id: venueId,
      product_key: `r1b_bag_${runId.replaceAll("-", "_")}`,
      name: "Pickla Bag",
      product_kind: "merchandise",
      commerce_kind: "merchandise",
      fulfillment_type: "desk_pickup",
      fulfillment_presentation: "desk_pickup",
      base_price_sek: 200,
      vat_rate: 25,
      resolver_rules: { max_quantity: 4 },
      commerce_enabled: true,
      status: "active",
      is_active: true,
      standalone_enabled: true,
      activity_addon_enabled: false,
    },
  });
}

async function createCart(idempotencyKey) {
  return request(`${commerceUrl}/cart`, {
    method: "POST",
    key: anonKey,
    body: {
      venue_id: venueId,
      source,
      draft_scope: "shop",
      idempotency_key: idempotencyKey,
      items: [{ product_id: productId, quantity: 1 }],
      journey_id: crypto.randomBytes(32).toString("hex"),
    },
  });
}

function assertNoTokenLeak(payload, idempotencyKey) {
  const serialized = JSON.stringify(payload);
  assert(!serialized.includes("guest_token_hash"), "guest_token_hash leaked");
  assert(!serialized.includes("draft_idempotency_key_hash"), "draft_idempotency_key_hash leaked");
  assert(payload.cart_token === idempotencyKey, "Guest cart bearer was not returned canonically");
  const withoutBearer = JSON.stringify({ ...payload, cart_token: null });
  assert(!withoutBearer.includes(idempotencyKey), "Guest bearer leaked outside cart_token");
}

async function exercise(concurrency) {
  const idempotencyKey = crypto.randomBytes(32).toString("hex");
  const keyHash = crypto.createHash("sha256").update(idempotencyKey).digest("hex");
  const responses = await Promise.all(Array.from({ length: concurrency }, () => createCart(idempotencyKey)));
  const cartIds = [...new Set(responses.map(({ payload }) => payload.order.id))];
  assert(cartIds.length === 1, `${concurrency} requests returned ${cartIds.length} cart identities`);
  assert(responses.every(({ status }) => status === 200 || status === 201), `${concurrency} requests returned a non-success status`);
  responses.forEach(({ payload }) => {
    assertNoTokenLeak(payload, idempotencyKey);
    assert(payload.lines.length === 1, `${concurrency} request response did not contain exactly one line`);
    assert(payload.lines[0].product_id === productId && payload.lines[0].quantity === 1, `${concurrency} request response line diverged`);
  });

  const active = (await rest(
    "commerce_orders",
    `venue_id=eq.${venueId}&draft_scope=eq.shop&status=eq.draft&draft_idempotency_key_hash=eq.${keyHash}&select=id,version`,
  )).payload;
  assert(active.length === 1, `${concurrency} requests committed ${active.length} active carts`);
  assert(active[0].id === cartIds[0], `${concurrency} responses did not return the committed cart`);
  const lines = (await rest(
    "commerce_order_lines",
    `commerce_order_id=eq.${cartIds[0]}&select=id,quantity,product_id`,
  )).payload;
  assert(lines.length === 1, `${concurrency} requests committed ${lines.length} order lines`);
  assert(lines[0].product_id === productId && lines[0].quantity === 1, `${concurrency} requests committed a divergent line`);

  return {
    concurrency,
    statuses: responses.map(({ status }) => status),
    cart_id: cartIds[0],
    active_carts: active.length,
    lines: lines.length,
  };
}

async function cleanup() {
  await rest("commerce_orders", `venue_id=eq.${venueId}`, { method: "DELETE", expected: 204 });
  await rest("access_products", `id=eq.${productId}`, { method: "DELETE", expected: 204 });
  await rest("venues", `id=eq.${venueId}`, { method: "DELETE", expected: 204 });
}

const results = [];
let failure;
try {
  await seed();
  for (const concurrency of [2, 5, 10]) results.push(await exercise(concurrency));
} catch (error) {
  failure = error;
} finally {
  try { await cleanup(); } catch (cleanupError) { failure ||= cleanupError; }
}

if (failure) throw failure;
process.stdout.write(`${JSON.stringify({ ok: true, results, cleanup: true }, null, 2)}\n`);
