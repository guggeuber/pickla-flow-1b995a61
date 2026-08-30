import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolvePublicLeagueDisplayPrice } from "../../supabase/functions/_shared/public_league_pricing";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260830120000_public_customer_today_secondary_facts.sql");
const projection = read("supabase/functions/_shared/today_secondary.ts");
const endpoint = read("supabase/functions/api-event-public/index.ts");
const today = read("src/pages/TodayPage.tsx");

describe("Today B2 secondary consolidation contracts", () => {
  it("uses one bounded read-only fact RPC and no remote N+1 in the Edge projector", () => {
    expect(projection.match(/client\.rpc\(/g)).toHaveLength(1);
    expect(projection).toContain("'public_customer_today_secondary_facts'");
    expect(projection).not.toContain("client.from(");
    expect(migration).toContain("LIMIT 4");
    expect(migration).toContain("LIMIT 64");
    expect(migration).toContain("LIMIT 256");
    expect(migration).toContain("p_end_date <= p_start_date + 13");
    expect(migration).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });

  it("keeps price ownership in the canonical shared resolvers", () => {
    expect(projection).toContain("resolveActivityPricingDecision");
    expect(projection).toContain("resolveScopeAwarePricingDecision");
    expect(projection).toContain("resolvePublicLeagueDisplayPrice");
    expect(migration).not.toContain("pricing_reason', 'early_bird'");
    expect(migration).not.toContain("first_visit_offerDecision");
  });

  it("makes the public secondary endpoint auth-free and measured", () => {
    const route = endpoint.slice(endpoint.indexOf("path === 'today-secondary'"), endpoint.indexOf("path === 'today-primary'"));
    expect(route).toContain("loadPublicTodaySecondary");
    expect(route).toContain("measurePublicReadStage");
    expect(route).not.toContain("getOptionalUserId");
    expect(route).not.toContain("resolveCustomerIdForUser");
    expect(route).not.toContain("reconcileExpiredFirstVisitCheckouts");
    expect(route).not.toContain("STRIPE");
  });

  it("removes anonymous Course, League, First Visit and social reconstruction", () => {
    expect(today).toContain("fetchTodaySecondary");
    expect(today).toContain("enabled: Boolean(primary.data)");
    expect(today).toContain("enabled: Boolean(primary.data) && verifiedAccount.isVerified");
    expect(today).toContain("userId && sessionIds.length");
    expect(today).not.toContain('fetchCourseHome(slug, { auth: "omit" })');
    expect(today).not.toContain('fetchLeagueHome(slug, { auth: "omit" })');
    expect(today).not.toContain('"first-visit-offers", { venueSlug: slug }, { auth: "omit" }');
  });

  it("preserves League base, active, exhausted and equal-price behavior", () => {
    const regular = { regularPriceMinor: 240000, regularPriceReason: "league_team_base_price" };
    expect(resolvePublicLeagueDisplayPrice(regular)).toEqual({ currentPriceMinor: 240000, pricingReason: "league_team_base_price" });
    expect(resolvePublicLeagueDisplayPrice({ ...regular, scarcityMode: "early_bird", earlyBirdPriceMinor: 200000, earlyBirdRemaining: 2 }))
      .toEqual({ currentPriceMinor: 200000, pricingReason: "early_bird" });
    expect(resolvePublicLeagueDisplayPrice({ ...regular, scarcityMode: "early_bird", earlyBirdPriceMinor: 200000, earlyBirdRemaining: 0 }))
      .toEqual({ currentPriceMinor: 240000, pricingReason: "league_team_base_price" });
    expect(resolvePublicLeagueDisplayPrice({ ...regular, scarcityMode: "early_bird", earlyBirdPriceMinor: 240000, earlyBirdRemaining: 2 }))
      .toEqual({ currentPriceMinor: 240000, pricingReason: "league_team_base_price" });
  });

  it("does not expose customer, auth, payer or membership identifiers", () => {
    const responseTypes = projection.slice(projection.indexOf("export type TodaySecondaryCoursePromotion"), projection.indexOf("const ANONYMOUS_FIRST_VISIT_ELIGIBILITY"));
    for (const forbidden of ["customer_id", "auth_user_id", "payer", "membership_id", "email", "phone", "season_id", "product_id"]) {
      expect(responseTypes).not.toContain(forbidden);
    }
  });
});
