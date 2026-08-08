import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260806120000_converge_canonical_entitlements.sql", "utf8");
const consumptionMigration = readFileSync("supabase/migrations/20260806130000_entitlement_consumption_contracts.sql", "utf8");
const programMigration = readFileSync("supabase/migrations/20260806140000_partner_and_punch_card_readiness.sql", "utf8");
const entitlementApi = readFileSync("supabase/functions/api-entitlements/index.ts", "utf8");
const checkinApi = readFileSync("supabase/functions/api-checkins/index.ts", "utf8");
const activityPricing = readFileSync("supabase/functions/_shared/activity_pricing.ts", "utf8");
const commerceApi = readFileSync("supabase/functions/api-commerce/index.ts", "utf8");
const commerceWebhook = readFileSync("supabase/functions/api-stripe-webhook/index.ts", "utf8");
const programPage = readFileSync("src/pages/ProgramSessionPage.tsx", "utf8");
const myPage = readFileSync("src/pages/MyPage.tsx", "utf8");
const adminSchedule = readFileSync("src/components/admin/AdminSchedule.tsx", "utf8");
const scanner = readFileSync("src/components/desk/QrScanner.tsx", "utf8");
const arrivals = readFileSync("src/components/desk/shell/DeskArrivals.tsx", "utf8");

describe("canonical entitlement foundation", () => {
  it("expresses scope, meter, validity, funding and customer ownership independently", () => {
    expect(migration).toContain("scope_type TEXT");
    expect(migration).toContain("meter_type TEXT");
    expect(migration).toContain("starts_at TIMESTAMPTZ");
    expect(migration).toContain("expires_at TIMESTAMPTZ");
    expect(migration).toContain("service_date DATE");
    expect(migration).toContain("funding_type TEXT");
    expect(migration).toContain("canonical_entitlement_requires_customer");
    expect(migration).toContain("'exact_session', 'activity_series', 'session_type', 'product_key'");
    expect(migration).toContain("'unlimited', 'occurrences', 'one_per_day', 'valid_day', 'exact_session'");
    for (const fundingType of ["customer_prepaid", "subscription", "house_granted", "partner_funded", "legacy_import", "commerce_purchase"]) {
      expect(migration).toContain(`'${fundingType}'`);
    }
  });

  it("keeps resolver precedence explicit and venue-bound", () => {
    expect(migration).toMatch(/scope_type = 'exact_session'.+THEN 10/s);
    expect(migration).toMatch(/entitlement_type = 'membership_access'.+THEN 20/s);
    expect(migration).toMatch(/entitlement_type = 'day_access'.+THEN 30/s);
    expect(migration).toMatch(/entitlement_type = 'punch_card'.+THEN 40/s);
    expect(migration).toMatch(/entitlement_type = 'partner_access'.+THEN 50/s);
    expect(migration).toContain("WHEN 'open_play' THEN v_entitlement.venue_id = p_venue_id");
    expect(consumptionMigration).toContain("WHEN 'open_play' THEN v_entitlement.venue_id = p_venue_id");
    expect(migration).toContain("'pricing_consequence', 'included'");
  });

  it("consumes only through append-only, idempotent real-attendance contracts", () => {
    expect(consumptionMigration).toContain("CREATE TABLE public.entitlement_consumptions");
    expect(consumptionMigration).toContain("entitlement_consumptions_are_append_only");
    expect(consumptionMigration).toContain("attendance_consumption_quantity_must_be_one");
    expect(consumptionMigration).toContain("CREATE OR REPLACE FUNCTION public.check_in_with_entitlement");
    expect(consumptionMigration).toContain("'checkin:' || v_checkin.id::text");
    expect(checkinApi).toContain("check_in_with_entitlement");
    expect(checkinApi).toContain("canonical_entitlement_id");
  });

  it("keeps Commerce provenance intact until actual check-in", () => {
    expect(activityPricing).toContain("entitlement_types: ['punch_card', 'partner_access']");
    expect(activityPricing).toContain("accessDecision = 'entitlement_included'");
    expect(commerceApi).toContain("source_entitlement_id: decision.accessDecision === 'entitlement_included'");
    expect(commerceApi).toContain("access_reason: resolver.access_reason || null");
    expect(commerceApi).toContain("if (!canonicalEntitlementId)");
    expect(commerceWebhook).toContain("p_source_type: canonicalEntitlementId ? canonicalEntitlementType : 'commerce_order'");
    expect(commerceWebhook).toContain("if (canonicalEntitlementId) return;");
    expect(checkinApi).toContain("registration?.source_id === access.id ? registration.id : null");
  });
});

describe("partner and punch-card readiness", () => {
  it("models Bruce as configuration and creates one receivable from consumption", () => {
    expect(programMigration).toContain("CREATE TABLE public.partner_programs");
    expect(programMigration).toContain("CREATE TABLE public.partner_program_sessions");
    expect(programMigration).toContain("CREATE TABLE public.partner_receivable_events");
    expect(programMigration).toContain("record_partner_receivable_from_consumption");
    expect(programMigration).toContain("partner_receivable_events_consumption_once");
    expect(programMigration.toLowerCase()).not.toContain("is_bruce");
    expect(programMigration).not.toMatch(/INSERT INTO public\.partner_programs[\s\S]+VALUES \([\s\S]+Bruce/);
  });

  it("provides a strict, audited legacy import without inventing money", () => {
    expect(programMigration).toContain("CREATE OR REPLACE FUNCTION public.import_legacy_punch_card");
    expect(programMigration).toContain("legacy_punch_card_already_imported");
    expect(programMigration).toContain("funding_type => 'legacy_import'");
    expect(programMigration).toContain("CREATE TABLE public.entitlement_adjustments");
    expect(programMigration).toContain("entitlement_adjustments_are_append_only");
    expect(programMigration).not.toContain("monetary_value");
  });

  it("exposes customer-safe labels and operational allowlists only", () => {
    expect(entitlementApi).toContain("Public projection: a factual label only");
    expect(entitlementApi).toContain(".select('id, activity_label, status, valid_from, valid_until')");
    expect(entitlementApi).toContain("`Klippkort · ${remainingUses(row)} gånger kvar`");
    expect(programPage).toContain('data-testid="partner-session-labels"');
    expect(myPage).toContain("Dina pass");
    expect(adminSchedule).toContain("Rättigheter");
    expect(scanner).toContain('case "punch_card"');
    expect(scanner).toContain('case "partner_access"');
    expect(arrivals).toContain('punch_card: "Klippkort"');
    expect(arrivals).toContain('partner_access: "Partner"');
  });

  it("denies direct reads of private partner and import columns", () => {
    expect(programMigration).toContain("REVOKE SELECT ON public.access_entitlements FROM authenticated");
    expect(programMigration).toContain("REVOKE SELECT ON public.entitlement_consumptions FROM authenticated");
    const safeGrant = programMigration.match(/GRANT SELECT \([\s\S]+?\) ON public\.access_entitlements TO authenticated;/)?.[0] || "";
    expect(safeGrant).not.toContain("funding_counterparty_ref");
    expect(safeGrant).not.toContain("external_reference");
    expect(safeGrant).not.toContain("legacy_source_ref");
    expect(safeGrant).not.toContain("operator_note");
    expect(safeGrant).not.toContain("issuance_key");
  });
});
