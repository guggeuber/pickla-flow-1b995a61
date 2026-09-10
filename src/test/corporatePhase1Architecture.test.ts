import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260910120000_corporate_company_pages_phase1.sql", "utf8");
const foundationMigration = readFileSync("supabase/migrations/20260909120000_physical_availability_foundation_v1.sql", "utf8");
const corporateApi = readFileSync("supabase/functions/api-corporate/index.ts", "utf8");
const publicPage = readFileSync("src/pages/CorporateCompanyPage.tsx", "utf8");

describe("corporate Phase 1 schema and resource safety", () => {
  it("adapts only canonical corporate, order and activity entities", () => {
    expect(migration).toContain("ALTER TABLE public.corporate_accounts");
    expect(migration).toContain("ALTER TABLE public.corporate_orders");
    expect(migration).toContain("ALTER TABLE public.activity_series");
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_corporate_accounts_slug_ci");
    expect(migration).toContain("ON public.corporate_accounts (LOWER(slug))");
    expect(migration).not.toMatch(/client_organizations|client_organization_series_invites/);
  });

  it("makes apply-all atomic and reports every conflict before either update", () => {
    const fn = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.apply_corporate_series_default_court"),
      migration.indexOf("REVOKE ALL ON FUNCTION public.apply_corporate_series_default_court"),
    );
    expect(fn).toContain("preview_corporate_series_default_court");
    expect(fn).toContain("FILTER (WHERE preview.is_available = false)");
    expect(fn.indexOf("IF jsonb_array_length(v_conflicts) > 0")).toBeLessThan(fn.indexOf("UPDATE public.activity_series"));
    expect(fn.indexOf("UPDATE public.activity_series")).toBeLessThan(fn.indexOf("UPDATE public.activity_sessions"));
    expect(fn).toContain("WHERE series_id = p_series_id");
    expect(fn).not.toContain("INSERT INTO public.bookings");
  });

  it("keeps an occurrence override separate from the Series default", () => {
    const fn = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.apply_corporate_session_court"),
      migration.indexOf("REVOKE ALL ON FUNCTION public.apply_corporate_session_court"),
    );
    expect(fn).toContain("UPDATE public.activity_sessions");
    expect(fn).not.toContain("UPDATE public.activity_series");
    expect(fn).toContain("'is_exception'");
  });

  it("uses canonical Sessions as physical occupancy and no duplicate booking rows", () => {
    expect(migration).toContain("public.check_physical_availability(");
    expect(migration).toContain("public.lock_physical_resources(");
    expect(migration).toContain("DROP TRIGGER IF EXISTS trg_guard_corporate_session_resource_conflict");
    expect(migration).not.toContain("CREATE TRIGGER trg_guard_corporate_session_resource_conflict");
    expect(migration).toContain("CREATE TRIGGER trg_enforce_corporate_session_boundary");
    expect(migration).toContain("SET closed_to_public = true");
    expect(migration).toContain("capacity = NULL");
    expect(migration).toContain("NEW.capacity := NULL");
    expect(migration).toContain("v_session.session_date");
    expect(migration).toContain("v_session.start_time");
    expect(migration).toContain("v_session.end_time");
    expect(migration).not.toContain("INSERT INTO public.bookings");
  });

  it("runs after and delegates to the live foundation without redefining physical truth", () => {
    expect(foundationMigration).toContain("CREATE OR REPLACE FUNCTION public.check_physical_availability");
    expect(foundationMigration).toContain("CREATE TRIGGER trg_guard_activity_session_physical_claim");
    expect(migration).not.toContain("CREATE OR REPLACE FUNCTION public.check_physical_availability");
    expect(migration).not.toContain("CREATE OR REPLACE FUNCTION public.preview_course_resource_schedule");
    expect(migration).not.toContain("CREATE OR REPLACE FUNCTION public.lock_physical_resources");
    expect(migration).not.toContain("FROM public.bookings");
    expect(migration).not.toContain("FROM public.event_resource_blocks");
  });

  it("fails closed and rejects a court outside the Corporate venue", () => {
    expect(migration).toContain("COALESCE((v_decision->>'available')::BOOLEAN, false)");
    expect(migration).toContain("court.venue_id = v_series.venue_id");
    expect(migration).toContain("court.venue_id = v_session.venue_id");
    expect(migration).toContain("RAISE EXCEPTION 'corporate_series_court_invalid'");
    expect(migration).toContain("RAISE EXCEPTION 'corporate_session_court_invalid'");
  });
});

describe("corporate Phase 1 API boundaries", () => {
  it("projects closed corporate Sessions without weakening ordinary commerce", () => {
    const publicRoutes = corporateApi.slice(corporateApi.indexOf("path === 'public-companies'"), corporateApi.indexOf("Public: lookup by invite token"));
    expect(publicRoutes).toContain("projectPublicCompany");
    const publicLoader = corporateApi.slice(corporateApi.indexOf("async function loadPublicCorporateContext"), corporateApi.indexOf("function projectPublicCompany"));
    expect(publicLoader).toContain("activity_sessions");
    expect(publicLoader).not.toContain(".eq('closed_to_public', false)");
    expect(publicPage).toContain("series.flatMap((series) => series.sessions)");

    const commerce = readFileSync("supabase/functions/api-commerce/index.ts", "utf8");
    expect(commerce).toContain("session.closed_to_public === true");
    expect(commerce).toContain("Activity session is not available");
  });

  it("keeps the public projection free of corporate secrets and commercial totals", () => {
    const publicLoader = corporateApi.slice(corporateApi.indexOf("async function loadPublicCorporateContext"), corporateApi.indexOf("function projectPublicCompany"));
    const projection = corporateApi.slice(corporateApi.indexOf("function projectPublicCompany"), corporateApi.indexOf("async function publicCompanyBySlug"));
    for (const forbidden of ["invite_token", "contact_email", "contact_phone", "purchaser_name", "total_price", "recurring_config", "notes"]) {
      expect(publicLoader).not.toContain(forbidden);
      expect(projection).not.toContain(forbidden);
    }
    expect(projection).toContain("company_name");
    expect(projection).toContain("included_items");
    expect(projection).toContain("deriveCorporateParticipation");
  });

  it("requires venue authorization for every staff mutation", () => {
    for (const endpoint of ["admin-accounts", "admin-orders", "admin-series", "admin-series-court", "admin-session-court"]) {
      const start = corporateApi.indexOf(`path === '${endpoint}'`);
      const next = corporateApi.indexOf("\n    if (", start + 10);
      const handler = corporateApi.slice(start, next === -1 ? undefined : next);
      expect(handler).toMatch(/requireVenueRole|requireCorporateSeriesVenue|requireCorporateSessionVenue/);
    }
  });
});
