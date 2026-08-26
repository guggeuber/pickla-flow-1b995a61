import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("dynamic Catalog member-price architecture", () => {
  it("projects eligible tiers by canonical flags without membership-name branches", () => {
    const memberships = read("supabase/functions/api-memberships/index.ts");
    const projection = memberships.slice(
      memberships.indexOf("if (req.method === 'GET' && path === 'series-tier-pricing')"),
      memberships.indexOf("if (req.method === 'POST' && path === 'tier-pricing')"),
    );
    expect(projection).toContain(".select('id, name, color, sort_order, is_active, is_assignable')");
    expect(projection).toContain(".or('is_active.eq.true,is_assignable.eq.true')");
    expect(projection).not.toMatch(/\.eq\(['"]name['"]/);
    expect(projection).not.toContain("Founder");
    expect(projection).not.toContain("Play+");
  });

  it("keeps the shared Catalog editor fixed-SEK, optional, and non-free", () => {
    const editor = read("src/components/admin/SeriesMemberPricingEditor.tsx");
    const courseAdmin = read("src/components/admin/AdminCourses.tsx");
    const leagueAdmin = read("src/components/admin/AdminLeague.tsx");
    expect(editor).toContain('mode: "fixed"');
    expect(editor).toContain("if (!trimmed)");
    expect(editor).toContain("numericValue <= 0");
    expect(editor).toContain("removeSeriesMemberPricing");
    expect(editor).not.toContain('value="percent"');
    expect(courseAdmin).toContain("<SeriesMemberPricingEditor");
    expect(leagueAdmin).toContain("<SeriesMemberPricingEditor");
    expect(leagueAdmin).toContain("Teampris för hela lagplatsen · båda spelarna");
  });

  it("adds only a verified additive League reservation function and retains rollback", () => {
    const migration = read("supabase/migrations/20260827125000_catalog_dynamic_member_prices.sql");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.reserve_league_team_entry_v2(");
    expect(migration).toContain("FROM public.reserve_league_team_entry(");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = public, pg_temp");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("TO service_role");
    expect(migration).not.toMatch(/CREATE\s+TABLE/i);
    expect(migration).not.toMatch(/ALTER\s+TABLE/i);
    expect(migration).not.toContain("p_regular_price_minor");
    expect(migration).not.toContain("p_regular_price_type");
  });

  it("verifies only the purchasing captain against canonical membership and product truth", () => {
    const migration = read("supabase/migrations/20260827125000_catalog_dynamic_member_prices.sql");
    const verification = migration.slice(
      migration.indexOf("SELECT membership.id, membership.tier_id, tier.name"),
      migration.indexOf("v_final_price := v_regular_price"),
    );
    expect(verification).toContain("membership.user_id = p_captain_user_id");
    expect(verification).toContain("membership.customer_id = p_captain_customer_id");
    expect(verification).toContain("membership.venue_id = v_context.venue_id");
    expect(verification).toContain("membership.status = 'active'");
    expect(verification).toContain("tier.is_active = true OR tier.is_assignable = true");
    expect(verification).toContain("pricing.product_type = v_context.product_key");
    expect(verification).toContain("pricing.pricing_rule_id IS NULL");
    expect(verification).not.toContain("p_player_customer_id");
  });

  it("uses one locked base/member/Early-Bird winner and freezes canonical provenance", () => {
    const migration = read("supabase/migrations/20260827125000_catalog_dynamic_member_prices.sql");
    expect(migration).toContain("v_regular_price := v_member_price");
    expect(migration).toContain("v_reserved.final_price_minor < v_regular_price");
    expect(migration).toContain("v_final_type := 'early_bird'");
    expect(migration).toContain("'regular_price_minor', v_regular_price");
    expect(migration).toContain("'membership_tier_id', v_membership.tier_id");
    expect(migration).toContain("IF v_reserved.reason <> 'held' THEN");
    expect(migration).toContain("never re-evaluate after membership/configuration changes");
  });

  it("converges League detail, cart and checkout on V2 without frontend calculations", () => {
    const leagues = read("supabase/functions/api-leagues/index.ts");
    const commerce = read("supabase/functions/api-commerce/index.ts");
    const page = read("src/pages/LeaguePage.tsx");
    expect(leagues).toContain("resolveScopeAwarePricingDecision({");
    expect(leagues).toContain("applyEarlyBird: false");
    expect(leagues).toContain("admin.rpc('reserve_league_team_entry_v2'");
    expect(leagues).toContain("membership_pricing_applied:");
    expect(leagues).toContain("customerReservationPricing(reserved)");
    expect(leagues).toContain("delete pricing.membership_id");
    expect(leagues).toContain("delete pricing.membership_tier_id");
    expect(commerce).toContain("admin.rpc('reserve_league_team_entry_v2'");
    expect(commerce).toContain("purchase_provenance");
    expect(page).toContain("league.current_price_minor");
    expect(page).not.toContain("membership_tier_pricing *");
  });
});
