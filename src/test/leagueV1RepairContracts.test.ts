import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const domainSql = readFileSync("supabase/migrations/20260827120000_league_v1_domain.sql", "utf8");
const commerceSql = readFileSync("supabase/migrations/20260827121000_league_v1_commerce.sql", "utf8");
const playSql = readFileSync("supabase/migrations/20260827122000_league_v1_play.sql", "utf8");
const leagueApi = readFileSync("supabase/functions/api-leagues/index.ts", "utf8");
const commerceApi = readFileSync("supabase/functions/api-commerce/index.ts", "utf8");
const webhook = readFileSync("supabase/functions/api-stripe-webhook/index.ts", "utf8");
const expiry = readFileSync("supabase/functions/_shared/commerce_checkout_expiry.ts", "utf8");
const leaguePage = readFileSync("src/pages/LeaguePage.tsx", "utf8");

describe("League V1 targeted repair contracts", () => {
  it("keeps one canonical 13–11 scoring boundary in SQL and TypeScript", () => {
    expect(playSql).toContain("GREATEST(p_a, p_b) = 13 AND LEAST(p_a, p_b) IN (11, 12)");
    expect(playSql).toContain("NOT (v_set ? 'team_a' AND v_set ? 'team_b')");
    expect(playSql).toContain("p_expected_version <> 0");
  });

  it("uses canonical staff roles and limits Operations attendance to the active roster", () => {
    expect(leagueApi).toContain("['venue_admin', 'desk_staff']");
    expect(leagueApi).not.toContain("['venue_admin', 'desk', 'staff', 'manager']");
    expect(leagueApi).toContain(".in('activity_session_id', sessionIds).in('league_team_member_id', memberIds)");
  });

  it("binds generation, retry and publication to the exact active-team set", () => {
    expect(domainSql).toContain("generated_team_fingerprint TEXT");
    expect(playSql).toContain("generation_equivalence_failures");
    expect(playSql).toContain("v_season.generated_team_fingerprint IS DISTINCT FROM v_current_fingerprint");
    expect(playSql).toContain("Lagen har ändrats sedan spelschemat genererades. Generera om spelschemat.");
    expect(playSql).toContain("inactive_fixture_teams");
    expect(playSql).toContain("missing_active_teams");
  });

  it("keeps hold release internal and retires abandoned pending team names", () => {
    expect(commerceSql).toContain("REVOKE ALL ON FUNCTION public.release_capacity_hold(UUID, TEXT) FROM PUBLIC, anon, authenticated");
    expect(commerceSql).toContain("GRANT EXECUTE ON FUNCTION public.release_capacity_hold(UUID, TEXT) TO service_role");
    expect(commerceSql).toContain("team_name_reserved = false");
    expect(domainSql).toContain("WHERE team_name_reserved = true");
  });

  it("rejects incompatible pending retries before creating Player 2 identities", () => {
    const mismatch = leagueApi.indexOf("pågående laganmälan med andra uppgifter");
    const guestCreation = leagueApi.indexOf("resolveOrCreateGuestCustomerByEmail(admin", mismatch);
    expect(mismatch).toBeGreaterThan(0);
    expect(guestCreation).toBeGreaterThan(mismatch);
  });

  it("freezes team-fill and Early Bird allocation provenance without making it authority", () => {
    for (const field of [
      "team_capacity",
      "team_fill_before",
      "team_fill_at_reservation",
      "allocation_position",
      "early_bird_allocation_position",
    ]) {
      expect(commerceSql).toContain(`'${field}'`);
      expect(leagueApi).toContain(`${field}: reserved.`);
    }
  });

  it("preserves paid financial truth and exposes an idempotent attention recovery path", () => {
    const finalization = webhook.indexOf("finalize_commerce_payment");
    const fulfillment = webhook.indexOf("fulfill_league_team_entry", finalization);
    const attention = webhook.indexOf("paid_league_fulfillment_failed", fulfillment);
    const incident = webhook.indexOf("recordPaidCapacityConflict", attention);
    const recovery = webhook.indexOf("league_fulfillment_recovered", incident);
    expect(finalization).toBeGreaterThan(0);
    expect(fulfillment).toBeGreaterThan(finalization);
    expect(attention).toBeGreaterThan(fulfillment);
    expect(incident).toBeGreaterThan(attention);
    expect(recovery).toBeGreaterThan(incident);
  });

  it("releases only unpaid expired Stripe checkouts through the internal hold lifecycle", () => {
    expect(expiry).toContain("session.status === 'expired' && session.payment_status !== 'paid'");
    expect(expiry).toContain("p_reason: 'stripe_checkout_expired'");
    expect(expiry).toContain("status: 'expired'");
  });

  it("uses the canonical Series registration close and removes dead schedule seed", () => {
    expect(domainSql).not.toContain("registration_deadline");
    expect(domainSql).not.toContain("schedule_seed");
    expect(commerceSql).toContain("v_series.registration_closes_at");
    expect(commerceApi).toContain("registration_closes_at");
    expect(commerceApi).not.toContain("registration_deadline");
  });

  it("keeps public payloads roster-private", () => {
    const publicProjection = leagueApi.slice(
      leagueApi.indexOf("async function loadPublicProjection"),
      leagueApi.indexOf("async function createLeagueCart"),
    );
    expect(publicProjection).toContain("select('id, team_name, status')");
    expect(publicProjection).not.toContain("primary_email");
    expect(publicProjection).not.toContain("payer_customer_id");
    expect(publicProjection).not.toContain("captain_customer_id");
    expect(publicProjection).not.toContain("league_team_members').select");
  });

  it("does not promise a nonexistent automatic cancellation action", () => {
    expect(leaguePage).toContain("Kontakta Pickla om hela laget behöver avbokas");
    expect(leaguePage).not.toContain("Automatisk lagavbokning");
  });
});
