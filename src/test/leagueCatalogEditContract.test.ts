import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260827124000_league_catalog_edit_v1.sql", "utf8");
const api = readFileSync("supabase/functions/api-leagues/index.ts", "utf8");
const admin = readFileSync("src/components/admin/AdminLeague.tsx", "utf8");
const catalog = readFileSync("src/components/admin/shell/AdminCatalog.tsx", "utf8");

describe("League Catalog edit contracts", () => {
  it("uses one atomic server-only RPC for the three canonical editable rows", () => {
    expect(migration).toContain("FUNCTION public.update_league_catalog_v1");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = public, pg_temp");
    expect(migration).toContain("UPDATE public.activity_series");
    expect(migration).toContain("UPDATE public.access_products");
    expect(migration).toContain("UPDATE public.league_seasons");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.update_league_catalog_v1");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("TO service_role");
  });

  it("cannot reconcile schedule, competition, roster or finance history", () => {
    const body = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION"), migration.indexOf("REVOKE ALL ON FUNCTION"));
    expect(body).not.toMatch(/UPDATE public\.activity_sessions/);
    expect(body).not.toMatch(/UPDATE public\.league_team_entries/);
    expect(body).not.toMatch(/UPDATE public\.league_team_members/);
    expect(body).not.toMatch(/UPDATE public\.league_fixtures/);
    expect(body).not.toMatch(/UPDATE public\.league_fixture_results/);
    expect(body).not.toMatch(/UPDATE public\.commerce_orders/);
    expect(body).not.toMatch(/UPDATE public\.commerce_order_lines/);
    expect(body).not.toMatch(/UPDATE public\.booking_receipts/);
    expect(body).not.toMatch(/UPDATE public\.commerce_receipt_lines/);
    expect(body).not.toMatch(/UPDATE public\.ledger_entries/);
    expect(body).toContain("'schedule_reconciled', false");
    expect(body).toContain("'member_pricing_applied', false");
  });

  it("keeps historical deadlines and prices locked while allowing future-facing configuration", () => {
    expect(migration).toContain("league_registration_open_historical");
    expect(migration).toContain("league_registration_deadline_historical");
    expect(migration).toContain("league_fixture_deadline_historical");
    expect(migration).toContain("league_pricing_historical");
    expect(migration).toContain("p_early_bird_slots NOT BETWEEN 1 AND v_season.team_capacity");
    expect(migration).toContain("p_early_bird_price_minor >= p_base_price_minor");
  });

  it("exposes only the venue-admin API boundary and returns a focused edit policy", () => {
    const route = api.slice(api.indexOf("path === 'catalog'"), api.indexOf("path === 'create'"));
    expect(route).toContain("requireVenueRole(admin, authenticatedUserId, season.venue_id, ['venue_admin'])");
    expect(route).toContain("admin.rpc('update_league_catalog_v1'");
    expect(route).not.toMatch(/\.update\(|\.insert\(|\.delete\(/);
    expect(api).toContain("historical_prices_frozen");
    expect(api).toContain("schedule_editable: false");
    expect(api).toContain("participants_matches_or_payments_exist");
  });

  it("presents one normal Save, a customer-page link and the locked V1 doctrine", () => {
    expect(catalog).toContain(">Redigera <");
    expect(admin).toContain("Spara ändringar");
    expect(admin).toContain("Visa kundsida");
    expect(admin).toContain("League V1 · låst format");
    expect(admin).toContain("6 lag · 2 spelare");
    expect(admin).toContain("Medlemspris används inte för League V1");
    expect(admin).not.toContain("10/30 Session");
  });
});
