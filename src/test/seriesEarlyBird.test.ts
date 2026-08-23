import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const migrationPath = "supabase/migrations/20260824120000_series_early_bird.sql";

describe("Series Early Bird constitutional contract", () => {
  it("reuses product scarcity fields and canonical Series capacity holds", () => {
    const migration = read(migrationPath);

    expect(migration).toContain("public.capacity_lock_scope");
    expect(migration).toContain("public.capacity_holds");
    expect(migration).toContain("v_product.scarcity_mode = 'early_bird'");
    expect(migration).toContain("v_product.early_bird_price_minor");
    expect(migration).toContain("v_product.early_bird_slots");
    expect(migration).not.toContain("ALTER TABLE public.activity_series");
    expect(migration).not.toMatch(/CREATE TABLE/i);
  });

  it("counts only allocations where Early Bird won", () => {
    const migration = read(migrationPath);
    const fill = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.series_early_bird_fill"),
      migration.indexOf("CREATE OR REPLACE FUNCTION public.acquire_series_pricing_hold"),
    );

    expect(fill).toContain("line.resolver_snapshot->>'pricing_reason' = 'early_bird'");
    expect(fill).toContain("hold.metadata->>'applied_price_type' = 'early_bird'");
    expect(fill).not.toContain("house_granted");
    expect(fill).not.toContain("session_registrations");
  });

  it("awards the lowest positive base/member/Early-Bird price without presentation branching", () => {
    const resolver = read("supabase/functions/_shared/scope_pricing.ts");

    expect(resolver).toContain("pricingReason = 'membership_tier_pricing'");
    expect(resolver).toContain("earlyBirdPriceMinor < Math.round(finalAmountSek * 100)");
    expect(resolver).toContain("pricingReason = 'early_bird'");
    expect(resolver).not.toContain("presentation_type");
    expect(resolver).not.toContain("session.price_sek");
  });

  it("freezes Series price and scarcity provenance in the same atomic hold", () => {
    const migration = read(migrationPath);
    const commerce = read("supabase/functions/api-commerce/index.ts");

    expect(migration).toContain("'applied_price_type', v_price_type");
    expect(migration).toContain("'final_price_minor', v_final_price_minor");
    expect(migration).toContain("'series_fill_count', series_fill_count");
    expect(migration).toContain("'early_bird_allocated_count', early_bird_allocated_count");
    expect(commerce).toContain("admin.rpc('acquire_series_pricing_hold'");
    expect(commerce).toContain("SERIES_EARLY_BIRD_HOLD_TTL_SECONDS");
    expect(commerce).toContain("checkoutAppliedPriceType === 'early_bird' && Boolean(participation[0]?.activity_series_id)");
  });

  it("keeps Session Early Bird on its existing primitive", () => {
    const commerce = read("supabase/functions/api-commerce/index.ts");
    const sessionMigration = read("supabase/migrations/20260731100000_atomic_activity_pricing_holds.sql");

    expect(commerce).toContain("admin.rpc('acquire_first_visit_activity_pricing_hold'");
    expect(sessionMigration).toContain("CREATE OR REPLACE FUNCTION public.acquire_activity_pricing_hold");
    expect(sessionMigration).toContain("CREATE OR REPLACE FUNCTION public.activity_early_bird_fill");
  });

  it("validates and exposes only product-owned configuration in managed Series Admin", () => {
    const api = read("supabase/functions/api-courses/index.ts");
    const admin = read("src/components/admin/AdminCourses.tsx");

    expect(api).toContain("path === 'series-early-bird'");
    expect(api).toContain("managedSellableSeries(admin");
    expect(api).toContain("product.product_kind !== 'series_access'");
    expect(api).toContain("priceMinor >= basePriceMinor");
    expect(api).toContain("slots > capacity");
    expect(api).toContain("scarcity_mode: 'none'");
    expect(api).toContain("early_bird_price_minor: null");
    expect(api).toContain("early_bird_slots: null");
    expect(admin).toContain("Första vinnande betalda platserna");
    expect(admin).toContain("Early Bird-pris");
    expect(admin).toContain("Ordinarie");
  });

  it("projects customer Series pricing through the shared resolver without exposing resolver debug", () => {
    const api = read("supabase/functions/api-courses/index.ts");
    const projection = api.slice(api.indexOf("async function projectCourse"), api.indexOf("async function listMyCourses"));

    expect(projection).toContain("resolveScopeAwarePricingDecision");
    expect(projection).toContain("scopeType: 'activity_series'");
    expect(projection).toContain("pricing_reason: pricingDecision.pricingReason");
    expect(projection).toContain("membership_tier_name: pricingDecision.membershipTierName");
    expect(projection).toContain("early_bird:");
    expect(projection).not.toContain("debug: pricingDecision.debug");
    expect(api).toContain("jsonResponse(projected, 200, userId ? 0 : 5)");
    expect(api).toContain("jsonResponse({ mode: 'registration', item: projected }, 200, userId ? 0 : 5)");
  });
});
