import crypto from "node:crypto";
import { DateTime } from "luxon";

const apiUrl = process.env.API_URL || "http://127.0.0.1:54321";
const leagueUrl = process.env.LEAGUE_FUNCTION_URL || `${apiUrl}/functions/v1/api-leagues`;
const commerceUrl = process.env.COMMERCE_FUNCTION_URL || `${apiUrl}/functions/v1/api-commerce`;
const webhookUrl = process.env.COMMERCE_WEBHOOK_URL || `${apiUrl}/functions/v1/api-stripe-webhook`;
const anonKey = process.env.ANON_KEY;
const serviceKey = process.env.SERVICE_ROLE_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "whsec_commerce_r1_local";

if (!anonKey || !serviceKey || !apiUrl.startsWith("http://127.0.0.1")) {
  throw new Error("League V1 E2E only runs against the local Supabase stack");
}

const run = crypto.randomBytes(5).toString("hex");
const stockholmNow = DateTime.now().setZone("Europe/Stockholm");
const scheduleAnchor = stockholmNow.plus({ days: 14 }).startOf("day");
const firstThursday = scheduleAnchor.plus({ days: (4 - scheduleAnchor.weekday + 7) % 7 });
const nightDates = Array.from({ length: 5 }, (_, index) => firstThursday.plus({ weeks: index }).toISODate());
const registrationOpensAt = stockholmNow.minus({ days: 1 }).toUTC().toISO();
const registrationDeadline = firstThursday.minus({ days: 7 }).set({ hour: 21, minute: 59 }).toUTC().toISO();
const fixturePublicationDeadline = firstThursday.minus({ days: 2 }).set({ hour: 21, minute: 59 }).toUTC().toISO();
const ids = {
  venue: crypto.randomUUID(),
  courts: [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()],
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pass(name, detail = "ok") {
  process.stdout.write(`PASS ${name}: ${detail}\n`);
}

async function request(url, { method = "GET", body, rawBody, key = serviceKey, token, expected, headers = {} } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      apikey: key,
      ...(token === null ? {} : { Authorization: `Bearer ${token || key}` }),
      ...(body === undefined && rawBody === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: rawBody === undefined ? (body === undefined ? undefined : JSON.stringify(body)) : rawBody,
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

async function league(path, { method = "GET", body, token, expected } = {}) {
  return request(`${leagueUrl}/${path}`, { method, body, key: anonKey, token: token ?? null, expected });
}

async function commerce(path, { method = "GET", body, token, expected } = {}) {
  return request(`${commerceUrl}/${path}`, { method, body, key: anonKey, token: token ?? null, expected });
}

async function createUser(label, email = `league-${label}-${run}@example.test`) {
  const password = "League-local-42!";
  const created = await request(`${apiUrl}/auth/v1/admin/users`, {
    method: "POST",
    body: { email, password, email_confirm: true, user_metadata: { full_name: `League ${label}` } },
  });
  const login = await request(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    key: anonKey,
    token: anonKey,
    body: { email, password },
  });
  return { id: created.payload.id, token: login.payload.access_token, email };
}

function stripeSignature(rawBody) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac("sha256", webhookSecret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

async function webhook(event, expected = 200) {
  const rawBody = JSON.stringify(event);
  return request(webhookUrl, {
    method: "POST",
    key: anonKey,
    token: anonKey,
    expected,
    headers: { "content-type": "application/json", "stripe-signature": stripeSignature(rawBody) },
    rawBody,
  });
}

function checkoutEvent({ eventId, sessionId, order, email }) {
  return {
    id: eventId,
    type: "checkout.session.completed",
    data: { object: {
      id: sessionId,
      amount_total: order.total_inc_vat_minor,
      amount_subtotal: order.total_inc_vat_minor,
      currency: "sek",
      payment_status: "paid",
      payment_intent: `pi_league_${run}_${order.id.slice(0, 6)}`,
      payment_method_types: ["card"],
      customer_details: { email, name: "League Captain", phone: null },
      metadata: { commerce_order_id: order.id, commerce_order_version: String(order.version) },
    } },
  };
}

async function registerAndPay({ seriesId, captain, teamIndex, playerEmail }) {
  const registrationRequestId = `league-e2e-${run}-${teamIndex}-${crypto.randomUUID()}`;
  const sourceLineId = crypto.randomUUID();
  const registrationBody = {
    series_id: seriesId,
    team_name: `E2E Lag ${teamIndex}`,
    player_name: `Spelare ${teamIndex}`,
    player_email: playerEmail,
    age_confirmed: true,
    registration_request_id: registrationRequestId,
    source_line_id: sourceLineId,
  };
  const registration = (await league("register", { method: "POST", token: captain.token, body: registrationBody })).payload;
  const orderBefore = (await rest("commerce_orders", `id=eq.${registration.order.id}&select=id,version,status,total_inc_vat_minor,stripe_session_id`)).payload[0];
  const checkout = (await commerce("checkout", {
    method: "POST",
    token: captain.token,
    body: {
      token: orderBefore.id,
      expected_version: orderBefore.version,
      journey_id: crypto.randomBytes(24).toString("hex"),
      success_path: `/commerce/confirmed?token=${orderBefore.id}`,
      cancel_path: `/seriespel/${seriesId}`,
    },
  })).payload;
  const frozen = (await rest("commerce_orders", `id=eq.${checkout.order_id}&select=id,version,status,total_inc_vat_minor,stripe_session_id`)).payload[0];
  const event = checkoutEvent({
    eventId: `evt_league_${run}_${teamIndex}`,
    sessionId: frozen.stripe_session_id,
    order: frozen,
    email: captain.email,
  });
  await webhook(event);
  await webhook(event);
  const team = (await rest("league_team_entries", `commerce_order_id=eq.${frozen.id}&select=*`)).payload[0];
  assert(team?.status === "active", `team ${teamIndex} was not fulfilled`);
  return { registrationBody, registration, order: frozen, team, event };
}

const organization = (await rest("organizations", "slug=eq.pickla&select=id")).payload[0];
assert(organization?.id, "local Pickla organization missing");
await rest("venues", "", { method: "POST", body: {
  id: ids.venue,
  organization_id: organization.id,
  name: `League API ${run}`,
  slug: `league-api-${run}`,
  commerce_enabled: true,
} });
await rest("venue_courts", "", { method: "POST", body: ids.courts.map((id, index) => ({
  id,
  venue_id: ids.venue,
  name: `E2E Bana ${index + 1}`,
  court_number: index + 1,
  sport_type: "pickleball",
  is_available: true,
})) });

const operator = await createUser("operator");
await rest("venue_staff", "", { method: "POST", body: {
  venue_id: ids.venue,
  user_id: operator.id,
  role: "venue_admin",
  is_active: true,
} });

const created = (await league("create", {
  method: "POST",
  token: operator.token,
  body: {
    venue_id: ids.venue,
    name: `Pickla Seriespel API ${run}`,
    description: "Sex lag, fem torsdagar och en lagplats per köp.",
    image_urls: [],
    night_dates: nightDates,
    court_ids: ids.courts,
    registration_opens_at: registrationOpensAt,
    registration_deadline: registrationDeadline,
    fixture_publication_deadline: fixturePublicationDeadline,
    base_price_minor: 199500,
    vat_rate: 6,
    early_bird_price_minor: 179500,
    early_bird_slots: 2,
    publish: false,
  },
})).payload;
const seasonId = created.season.id;
const season = (await rest("league_seasons", `id=eq.${seasonId}&select=id,activity_series_id`)).payload[0];
const seriesId = season.activity_series_id;
await league("publish-offer", { method: "POST", token: operator.token, body: { league_season_id: seasonId } });
const sessions = (await rest("activity_sessions", `series_id=eq.${seriesId}&select=id,session_date,start_time,end_time,capacity,court_ids`)).payload;
assert(sessions.length === 5 && sessions.every((row) => row.start_time === "18:00:00" && row.end_time === "20:00:00" && row.capacity === 12 && row.court_ids.length === 3), "League did not create five canonical nights");
pass("offer", "staff-created offer, five Sessions and publication boundary");

const anonymous = (await league(`public?seriesId=${seriesId}`, { token: null })).payload;
assert(anonymous.capacity.team_capacity === 6 && anonymous.capacity.available_count === 6, "anonymous capacity projection incorrect");
const anonymousText = JSON.stringify(anonymous).toLowerCase();
for (const forbidden of ["primary_email", "customer_id", "payer_customer", "auth_user_id"]) {
  assert(!anonymousText.includes(forbidden), `public League payload exposed ${forbidden}`);
}
pass("public privacy", "team capacity is public; customer, payer and email identity are absent");

const captains = [];
for (let index = 1; index <= 6; index += 1) captains.push(await createUser(`captain-${index}`));
const firstPlayerEmail = `league-player-1-${run}@example.test`;
const first = await registerAndPay({ seriesId, captain: captains[0], teamIndex: 1, playerEmail: firstPlayerEmail });
assert(first.registration.pricing.final_price_minor === 179500, "first team did not receive Early Bird team price");
assert(first.registration.pricing.team_capacity === 6 && first.registration.pricing.team_fill_before === 0 && first.registration.pricing.allocation_position === 1, "team fill snapshot was not frozen");
const firstMembers = (await rest("league_team_members", `team_entry_id=eq.${first.team.id}&select=id,customer_id,role,status`)).payload;
const firstRegistrations = (await rest("session_registrations", `league_team_member_id=in.(${firstMembers.map((member) => member.id).join(",")})&select=id,status,league_team_member_id`)).payload;
assert(firstMembers.length === 2 && firstMembers.every((member) => member.status === "active"), "one team did not activate two people");
assert(firstRegistrations.length === 10, "one team did not project ten person registrations");
assert((await rest("booking_receipts", `commerce_order_id=eq.${first.order.id}&select=id`)).payload.length === 1, "League purchase did not create one receipt");
assert((await rest("ledger_entries", `commerce_order_id=eq.${first.order.id}&select=id`)).payload.length === 1, "League purchase did not create one ledger entry");
pass("team purchase", "one order line, one active team, two members, ten registrations and replay-safe fulfillment");

const incompatibleRetryEmail = `league-orphan-must-not-exist-${run}@example.test`;
await league("register", {
  method: "POST",
  token: captains[0].token,
  expected: 400,
  body: { ...first.registrationBody, player_email: incompatibleRetryEmail },
});
assert((await rest("customers", `organization_id=eq.${organization.id}&primary_email=eq.${incompatibleRetryEmail}&select=id`)).payload.length === 0, "incompatible retry created an orphan Player 2 Customer");
pass("registration retry", "immutable mismatch is rejected before guest identity creation");

const guestBefore = (await rest("customers", `organization_id=eq.${organization.id}&primary_email=eq.${firstPlayerEmail}&select=id,auth_user_id`)).payload;
assert(guestBefore.length === 1 && !guestBefore[0].auth_user_id, "Player 2 guest identity was not canonical");
const claimedPlayer = await createUser("claimed-player", firstPlayerEmail);
const guestAfter = (await rest("customers", `organization_id=eq.${organization.id}&primary_email=eq.${firstPlayerEmail}&select=id,auth_user_id`)).payload;
assert(guestAfter.length === 1 && guestAfter[0].id === guestBefore[0].id && guestAfter[0].auth_user_id === claimedPlayer.id, "Player 2 account claim duplicated or detached the Customer");
const claimedMy = (await league("my", { token: claimedPlayer.token })).payload;
assert(claimedMy.items.length === 1 && claimedMy.items[0].team.id === first.team.id, "claimed Player 2 cannot resolve League participation");
pass("Player 2 claim", "same canonical Customer and team membership survive later account creation");

const paidTeams = [first];
for (let index = 2; index <= 6; index += 1) {
  const paid = await registerAndPay({
    seriesId,
    captain: captains[index - 1],
    teamIndex: index,
    playerEmail: `league-player-${index}-${run}@example.test`,
  });
  assert(paid.registration.pricing.final_price_minor === (index === 2 ? 179500 : 199500), `team ${index} price was wrong`);
  paidTeams.push(paid);
}
const earlyBirdCancelled = paidTeams[1];
const refundEvent = {
  id: `evt_league_refund_${run}`,
  type: "charge.refunded",
  data: { object: {
    id: `ch_league_refund_${run}`,
    payment_intent: `pi_league_${run}_${earlyBirdCancelled.order.id.slice(0, 6)}`,
    amount: earlyBirdCancelled.order.total_inc_vat_minor,
    amount_refunded: earlyBirdCancelled.order.total_inc_vat_minor,
  } },
};
await webhook(refundEvent);
await webhook(refundEvent);
const cancelledTeam = (await rest("league_team_entries", `id=eq.${earlyBirdCancelled.team.id}&select=status`)).payload[0];
const cancelledMembers = (await rest("league_team_members", `team_entry_id=eq.${earlyBirdCancelled.team.id}&select=id,status`)).payload;
const cancelledRegistrations = (await rest("session_registrations", `league_team_member_id=in.(${cancelledMembers.map((member) => member.id).join(",")})&select=status`)).payload;
const cancelledOrder = (await rest("commerce_orders", `id=eq.${earlyBirdCancelled.order.id}&select=status,booking_receipt_id`)).payload[0];
const originalLedger = (await rest("ledger_entries", `commerce_order_id=eq.${earlyBirdCancelled.order.id}&select=id`)).payload;
const refundLedger = (await rest("ledger_entries", `source_type=eq.commerce_refund&source_id=eq.${earlyBirdCancelled.order.id}&select=id`)).payload;
assert(cancelledTeam.status === "cancelled" && cancelledMembers.every((member) => member.status === "inactive"), "full League refund did not cancel the team roster");
assert(cancelledRegistrations.length === 10 && cancelledRegistrations.every((row) => row.status === "cancelled"), "full League refund orphaned future registrations");
assert(cancelledOrder.status === "cancelled" && originalLedger.length === 1 && refundLedger.length === 1, "refund did not preserve purchase history and append one refund ledger entry");

const replacementCaptain = await createUser("captain-replacement");
captains.push(replacementCaptain);
const replacement = await registerAndPay({
  seriesId,
  captain: replacementCaptain,
  teamIndex: 7,
  playerEmail: `league-player-7-${run}@example.test`,
});
assert(replacement.registration.pricing.final_price_minor === 179500, "released Early Bird team allocation was not reusable");
const activeTeams = (await rest("league_team_entries", `league_season_id=eq.${seasonId}&status=eq.active&select=id`)).payload;
assert(activeTeams.length === 6, "six paid purchases did not produce exactly six teams");
assert((await rest("session_registrations", `activity_session_id=in.(${sessions.map((session) => session.id).join(",")})&status=eq.confirmed&select=id`)).payload.length === 60, "six teams did not create 12 active registrations per night");
pass("capacity/refund/Early Bird", "full-team refund preserves history, releases capacity and makes its Early Bird allocation reusable");

const generated = (await league("generate-fixtures", { method: "POST", token: operator.token, body: { league_season_id: seasonId } })).payload;
assert(Array.isArray(generated.data) && generated.data.length === 30, "fixture generator did not return 30 fixtures");
await league("generate-fixtures", { method: "POST", token: operator.token, body: { league_season_id: seasonId } });
await league("publish-fixtures", { method: "POST", token: operator.token, body: { league_season_id: seasonId } });
const published = (await league(`public?seriesId=${seriesId}`, { token: null })).payload;
assert(published.fixtures.length === 30 && published.standings.length === 6, "published public projection is incomplete");
assert(!JSON.stringify(published).toLowerCase().includes("primary_email"), "published League payload exposed private roster identity");
pass("schedule", "deterministic retry, 30 canonical fixtures and public publication");

const fixture = published.fixtures[0];
const resultRequest = `league-result-${run}-${crypto.randomUUID()}`;
const saved = (await league("result", {
  method: "POST",
  token: operator.token,
  body: {
    fixture_id: fixture.id,
    state: "final",
    outcome_type: "played",
    sets: [{ team_a: 13, team_b: 11 }, { team_a: 11, team_b: 9 }, { team_a: 8, team_b: 11 }],
    expected_version: 0,
    request_id: resultRequest,
  },
})).payload;
assert(saved.result.version === 1, "initial result did not use version zero contract");
await league("result", {
  method: "POST",
  token: operator.token,
  body: {
    fixture_id: fixture.id,
    state: "final",
    outcome_type: "played",
    sets: [{ team_a: 13, team_b: 11 }, { team_a: 11, team_b: 9 }, { team_a: 8, team_b: 11 }],
    expected_version: 0,
    request_id: resultRequest,
  },
});
const afterResult = (await league(`public?seriesId=${seriesId}`, { token: null })).payload;
assert(afterResult.standings.reduce((sum, row) => sum + row.matches_played, 0) === 2, "13-11 final result did not update derived standings");
pass("result", "13-11 accepted, initial expected_version=0 and request replay idempotent");

const adminProjection = (await league(`admin?venueId=${ids.venue}`, { token: operator.token })).payload;
const operations = (await league(`operations?venueId=${ids.venue}&date=${nightDates[0]}`, { token: operator.token })).payload;
assert(adminProjection.seasons.length === 1 && operations.fixtures.length === 6 && operations.registrations.length === 12, "Admin/Operations League projection incomplete");
const captainMy = (await league("my", { token: captains[0].token })).payload;
assert(captainMy.items.length === 1 && captainMy.items[0].next_fixtures.length >= 1 && captainMy.items[0].next_fixtures.length <= 2, "My Page projection did not deduplicate League participation");
pass("surfaces", "Admin, Operations and one-item My Page projections resolve canonical League truth");

process.stdout.write("LEAGUE_V1_API_E2E_OK 11 groups\n");
