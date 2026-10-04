import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import { isolatedConnection, isolatedQuery } from "./release-isolated-db.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sha256 = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function jwt(secret, userId) {
  const now = Math.floor(Date.now() / 1000);
  const parts = [{ alg: "HS256", typ: "JWT" }, { aud: "authenticated", role: "authenticated", sub: userId, iat: now, exp: now + 600 }].map((value) => Buffer.from(JSON.stringify(value)).toString("base64url"));
  return `${parts.join(".")}.${createHmac("sha256", secret).update(parts.join(".")).digest("base64url")}`;
}

export async function certifyStudentpris(target, fixture) {
  if (target.supabase_ref !== "byuwuoivuuklcwmoesrx" || target.fixture_venue_slug !== "student-hotfix-5403bc75") throw new Error("unapproved certification fixture");
  const connection = isolatedConnection(target);
  const sql = (query) => isolatedQuery(connection, query);
  const venueId = sql("select id from venues where slug = 'student-hotfix-5403bc75'");
  assert.match(venueId, /^[0-9a-f-]{36}$/);
  const accounts = Object.fromEntries(sql("select email,id from auth.users where email like '%@example.test'").split("\n").map((line) => line.split("|")).filter(([email]) => email.endsWith("@example.test") && email.includes("-5403bc75@")).map(([email, id]) => [email.split("@")[0].replace("student-hotfix-", "").replace("-5403bc75", ""), id]));
  for (const name of ["admin", "nonmember", "play", "playplus", "founder"]) assert.match(accounts[name] || "", /^[0-9a-f-]{36}$/);
  const tierRows = sql(`select id,name from membership_tiers where venue_id = '${venueId}'`).split("\n").map((line) => line.split("|"));
  const playTier = tierRows.find(([, name]) => name.toLowerCase() === "play")?.[0];
  assert.match(playTier || "", /^[0-9a-f-]{36}$/);
  const base = `https://${target.supabase_ref}.supabase.co/functions/v1`;
  async function call(fn, path, user, method = "GET", body) {
    const response = await fetch(`${base}/${fn}/${path}`, {
      method,
      headers: { apikey: connection.anonKey, Authorization: `Bearer ${jwt(connection.jwtSecret, accounts[user])}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`${fn}/${path.split("?")[0]} returned ${response.status}`);
    return response.json();
  }
  const existingRules = sql(`select id,coalesce(label,'') from membership_tier_pricing where tier_id = '${playTier}' and product_type = 'studentpris'`);
  if (existingRules) {
    for (const row of existingRules.split("\n")) {
      const [id, label] = row.split("|");
      if (label !== "release-v1-temporary") throw new Error("unowned explicit Studentpris pricing rule exists");
      await call("api-memberships", `tier-pricing?id=${encodeURIComponent(id)}`, "admin", "DELETE");
    }
  }
  const params = (id) => `sessionId=${encodeURIComponent(id)}&date=${encodeURIComponent(fixture.date)}&venueSlug=${encodeURIComponent(target.fixture_venue_slug)}`;
  const preview = (id, user) => call("api-event-public", `activity-preview-personalized?${params(id)}`, user);
  const student = fixture.student_session_id;
  const normal = fixture.normal_session_id;
  const adminSessions = await call("api-admin", `activity-sessions?venueId=${venueId}`, "admin");
  const session = adminSessions.find((value) => value.id === student);
  assert.ok(session, "Studentpris TEST session absent");
  assert.equal(session.product_key, "studentpris");
  assert.equal(session.price_sek, 59);
  const saved = await call("api-admin", "activity-sessions", "admin", "PATCH", {
    venueId, sessionId: student, product_key: "studentpris", price_sek: 59, capacity: 100,
    access_policy: { ...(session.access_policy || {}), allows_day_access: false, member_benefit_key: null },
    metadata: { ...(session.metadata || {}), online_price_sek: 59, membership_included: false, day_pass_included: false, legacy_open_play_member_benefit_key: "open_play_unlimited" },
  });
  const reloaded = (await call("api-admin", `activity-sessions?venueId=${venueId}`, "admin")).find((value) => value.id === student);
  for (const value of [saved, reloaded]) {
    assert.equal(value.product_key, "studentpris");
    assert.equal(value.price_sek, 59);
    assert.equal(value.metadata?.online_price_sek, 59);
    assert.equal(value.access_policy?.allows_day_access, false);
    assert.equal(value.access_policy?.member_benefit_key, null);
    assert.equal(value.metadata?.membership_included, false);
    assert.equal(value.metadata?.day_pass_included, false);
  }
  const matrix = {}, inverse = {};
  for (const [name, user] of [["non-member", "nonmember"], ["Play", "play"], ["Play+", "playplus"], ["Founder", "founder"]]) {
    const [a, b] = await Promise.all([preview(student, user), preview(normal, user)]);
    matrix[name] = a.activityTicketPricing?.effectivePriceSek;
    inverse[name] = b.activityTicketPricing?.effectivePriceSek;
    assert.equal(matrix[name], 59, `Studentpris ${name}`);
  }
  assert.deepEqual(inverse, { "non-member": 165, Play: 99, "Play+": 0, Founder: 0 });
  const rule = await call("api-memberships", "tier-pricing", "admin", "POST", { tierId: playTier, product_type: "studentpris", fixed_price: 49, label: "release-v1-temporary" });
  let explicit;
  try {
    const result = await preview(student, "play");
    explicit = result.activityTicketPricing?.effectivePriceSek;
    assert.equal(explicit, 49, "explicit Studentpris rule");
  } finally {
    await call("api-memberships", `tier-pricing?id=${encodeURIComponent(rule.id)}`, "admin", "DELETE");
  }
  assert.equal(sql(`select count(*) from membership_tier_pricing where tier_id = '${playTier}' and product_type = 'studentpris'`), "0");
  const evidence = { target_ref: target.supabase_ref, venue_slug: target.fixture_venue_slug, date: fixture.date, student_session_id: student, normal_session_id: normal, admin_save_reload: "PASS", studentpris_member_matrix: matrix, normal_open_play_inverse: inverse, explicit_studentpris_play_price_sek: explicit, temporary_rule_removed: true, observed_at: new Date().toISOString() };
  return { ...evidence, sha256: sha256(evidence) };
}

if (process.argv[2] === "run" && process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = JSON.parse(readFileSync(new URL("../release/stage-targets.json", import.meta.url))).targets[0];
  const fixture = { date: "2026-10-13", student_session_id: "b4bf1691-8f9c-463b-b7eb-57bb7b1fcae0", normal_session_id: "f1a6e8af-473a-4390-ab3d-bc8c848ebf1b" };
  try { console.log(JSON.stringify(await certifyStudentpris(target, fixture))); }
  catch (error) { console.error(JSON.stringify({ status: "FAIL", reason: error.message })); process.exitCode = 1; }
}
