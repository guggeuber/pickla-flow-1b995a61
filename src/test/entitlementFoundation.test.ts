import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260806120000_converge_canonical_entitlements.sql", "utf8");
const consumptionMigration = readFileSync("supabase/migrations/20260806130000_entitlement_consumption_contracts.sql", "utf8");
const programMigration = readFileSync("supabase/migrations/20260806140000_partner_and_punch_card_readiness.sql", "utf8");
const constitutionMigration = readFileSync("supabase/migrations/20260808120000_entitlement_constitution_v11.sql", "utf8");
const bruceOperationsMigration = readFileSync("supabase/migrations/20260809120000_bruce_partner_program_operations.sql", "utf8");
const bruceV1OperationsMigration = readFileSync("supabase/migrations/20260810120000_bruce_v1_manual_operations.sql", "utf8");
const entitlementFields = readFileSync("supabase/functions/_shared/entitlements.ts", "utf8");
const constitution = readFileSync("docs/entitlement-constitution.md", "utf8");
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
const deskToday = readFileSync("src/components/desk/shell/DeskToday.tsx", "utf8");
const partnerAdmin = readFileSync("src/components/admin/AdminPartnerPrograms.tsx", "utf8");
const deskBrucePanel = readFileSync("src/components/desk/shell/DeskBrucePanel.tsx", "utf8");

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
    const canonicalActivityEntitlements = activityPricing.match(
      /p_access_context:\s*\{\s*entitlement_types:\s*\[([^\]]+)]\s*}/,
    )?.[1] || "";
    for (const entitlementType of ["series_access", "punch_card", "partner_access"]) {
      expect(canonicalActivityEntitlements).toContain(`'${entitlementType}'`);
    }
    expect(activityPricing).toContain("accessDecision = 'entitlement_included'");
    expect(commerceApi).toContain("source_entitlement_id: decision.accessDecision === 'entitlement_included'");
    expect(commerceApi).toContain("access_reason: resolver.access_reason || null");
    expect(commerceApi).toContain("if (!canonicalEntitlementId)");
    expect(commerceWebhook).toContain("p_source_type: canonicalEntitlementId ? canonicalEntitlementType : 'commerce_order'");
    expect(commerceWebhook).toContain("if (canonicalEntitlementId) return;");
    expect(checkinApi).toContain("committedRegistration?.id || null");
    expect(checkinApi).toContain("entitlement_types: ['partner_access']");
  });
});

describe("Bruce production program operations", () => {
  it("inherits configured trigger/no-show terms and keeps Bruce out of resolver code", () => {
    expect(bruceOperationsMigration).toContain("ADD COLUMN IF NOT EXISTS consumption_trigger");
    expect(bruceOperationsMigration).toContain("p_consumption_trigger => v_program.consumption_trigger");
    expect(bruceOperationsMigration).toContain("p_no_show_policy => v_program.no_show_policy");
    expect(bruceOperationsMigration).toContain("partner_session_not_eligible");
    expect(bruceOperationsMigration).toContain("program.status = 'active'");
    expect(bruceOperationsMigration.toLowerCase()).not.toMatch(/is_bruce|where[^;]+bruce|program_key\s*=\s*'bruce'/);
    expect(bruceOperationsMigration).not.toContain("INSERT INTO public.partner_programs");
  });

  it("uses canonical assignment, check-in, reconciliation and receivable paths", () => {
    expect(entitlementApi).toContain("path === 'partner-entitlement'");
    expect(entitlementApi).toContain("path === 'partner-visit'");
    expect(entitlementApi).toContain("path === 'revoke-partner-entitlement'");
    expect(entitlementApi).toContain("path === 'reconcile-attendance'");
    expect(entitlementApi).toContain("admin.rpc('consume_access_entitlement'");
    expect(bruceOperationsMigration).toContain("manual_reconciliation_actor_and_reason_required");
    expect(checkinApi).toContain("check_in_with_entitlement");
    expect(constitutionMigration).toContain("record_partner_receivable_from_consumption");
  });

  it("keeps the public and Desk projections deliberately narrow", () => {
    expect(entitlementApi).toContain(".map((program: any) => ({ label: program.activity_label }))");
    expect(checkinApi).toContain(".select('id, venue_id, customer_id, user_id, player_name, entry_type, checked_in_at, entitlement_id')");
    expect(checkinApi).toContain("access_reason: right.access_reason");
    expect(checkinApi).toContain("activity_name:");
    expect(deskToday).toContain("accessReason");
    expect(deskToday).toContain("<AxChip tone=\"electric\">{accessReason}</AxChip>");
  });

  it("places the minimum operator flow in the existing access admin surface", () => {
    expect(partnerAdmin).toContain("Programvillkor");
    expect(deskBrucePanel).toContain("Lägg till Bruce-deltagare");
    expect(deskBrucePanel).toContain("Verifierad i Bruce Studio");
    expect(deskBrucePanel).toContain('"partner-visit"');
    expect(partnerAdmin).toContain("Registrera missad närvaro");
    expect(partnerAdmin).toContain("api-entitlements\", \"operations");
    expect(partnerAdmin).not.toContain("stored_value");
    expect(partnerAdmin).not.toContain("is_bruce");
  });

  it("adds only the manual Bruce V1 operating controls", () => {
    expect(bruceV1OperationsMigration).toContain("allocated_capacity");
    for (const state of ["needs_publication", "published", "changed", "removed", "error"]) {
      expect(bruceV1OperationsMigration).toContain(`'${state}'`);
    }
    expect(bruceV1OperationsMigration).toContain("register_partner_visit");
    expect(bruceV1OperationsMigration).toContain("commit_activity_registration_capacity");
    expect(bruceV1OperationsMigration).toContain("partner_receivable_settlement_events");
    expect(bruceV1OperationsMigration).toContain("partner_receivable_settlement_events_are_append_only");
    expect(bruceV1OperationsMigration).not.toContain("http");
    expect(bruceV1OperationsMigration).not.toContain("webhook_events");
    expect(bruceV1OperationsMigration).not.toContain("cron.schedule");
  });
});

describe("entitlement constitution v1.1", () => {
  it("makes funder first-class without deriving it from funding provenance", () => {
    for (const funder of ["self_prepaid", "subscription", "house_comped", "partner", "employer", "sponsor"]) {
      expect(constitutionMigration).toContain(`'${funder}'`);
      expect(entitlementFields).toContain(`'${funder}'`);
    }
    expect(constitutionMigration).toContain("entitlement_funder_required");
    expect(constitutionMigration).toContain("access_entitlements_v11_canonical_required");
    expect(entitlementFields).toContain("funding_type is provenance; it never determines funder");
    expect(constitutionMigration).not.toMatch(/CASE\s+[^;]*funding_type[^;]*THEN[^;]*funder/is);
  });

  it("models trigger, no-show and occurrence origin without activating behavior", () => {
    for (const trigger of ["on_checkin", "on_commitment", "on_session_end"]) {
      expect(constitutionMigration).toContain(`'${trigger}'`);
    }
    for (const origin of ["paid", "promotional", "house_comped", "legacy_import"]) {
      expect(constitutionMigration).toContain(`'${origin}'`);
    }
    expect(constitutionMigration).toContain("DEFAULT 'on_checkin'");
    expect(constitutionMigration).toContain("DEFAULT 'do_not_consume'");
    expect(constitution).toMatch(/does not execute\s+them/);
  });

  it("supports structured scope and property-driven ordering", () => {
    expect(constitutionMigration).toContain("'activity_format'");
    expect(constitutionMigration).toContain("'channel'");
    expect(constitutionMigration).toContain("valid_from TIMESTAMPTZ");
    expect(constitutionMigration).toContain("valid_until TIMESTAMPTZ");
    expect(constitutionMigration).toMatch(/ORDER BY\s+entitlement\.resolution_priority,[\s\S]+entitlement\.resolution_expiry_at ASC NULLS LAST/);
    expect(constitutionMigration).toContain("CASE entitlement.scarcity_class WHEN 'non_scarce' THEN 0 ELSE 1 END");
    expect(constitutionMigration).toContain("entitlement.resolution_origin_priority");
  });

  it("freezes partner reimbursement terms on append-only consumption", () => {
    for (const field of [
      "partner_program_id",
      "partner_reference",
      "reimbursement_rate_minor",
      "reimbursement_agreement_version",
      "reimbursement_effective_date",
    ]) {
      expect(constitutionMigration).toContain(field);
    }
    expect(constitutionMigration).toContain("freeze_entitlement_consumption_terms");
    expect(constitutionMigration).toContain("NEW.reimbursement_rate_minor := v_original.reimbursement_rate_minor");
    expect(constitutionMigration).toContain("NEW.reimbursement_agreement_version := v_program.agreement_version");
  });

  it("states the ledger boundary without adding adjacent products", () => {
    expect(constitution).toContain("Buying an entitlement creates deferred revenue");
    expect(constitution).toMatch(/Consuming an entitlement\s+recognises revenue/);
    expect(constitution).toContain("Stored Value never grants participation");
    expect(constitution).toContain("Payment Sources never create rights");
    expect(constitution).toContain("adds no Bruce UI, Epassi flow, punch-card UI");
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
    expect(adminSchedule).toContain("Manuell drift");
    expect(adminSchedule).toContain("Bruce-kapacitet");
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
