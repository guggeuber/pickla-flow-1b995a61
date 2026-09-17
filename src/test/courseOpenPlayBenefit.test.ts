import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(path, "utf8");
}

const migrationPath = "supabase/migrations/20260826120000_series_open_play_benefit.sql";
const occurrenceCommitRepairPath = "supabase/migrations/20260916120000_scope_activity_registration_idempotency_to_occurrence.sql";

describe("managed-Series Open Play benefit contract", () => {
  it("owns configuration on the existing access product and issues canonical access", () => {
    const migration = read(migrationPath);
    expect(migration).toContain("product.resolver_rules #>> '{included_benefits,open_play_series_period,enabled}'");
    expect(migration).toContain("'series_access', 'active', 'series_benefit'");
    expect(migration).toContain("2, 'open_play', 'unlimited'");
    expect(migration).toContain("ARRAY['open_play']::TEXT[]");
    expect(migration).not.toMatch(/CREATE TABLE/i);
    expect(migration).not.toContain("presentation_type");
    expect(migration).not.toContain("Pickla Start");
  });

  it("derives inclusive Stockholm calendar days from active canonical occurrences", () => {
    const migration = read(migrationPath);
    const period = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.series_open_play_benefit_period"),
      migration.indexOf("CREATE OR REPLACE FUNCTION public.series_open_play_benefit_enabled"),
    );
    expect(period).toContain("MIN(session.session_date)");
    expect(period).toContain("MAX(session.session_date) + 1");
    expect(period.match(/AT TIME ZONE 'Europe\/Stockholm'/g)).toHaveLength(2);
    expect(period).toContain("session.is_active = true");
    expect(period).toContain("session.publish_status = 'published'");
  });

  it("reconciles idempotently and revokes access with the commitment", () => {
    const migration = read(migrationPath);
    expect(migration).toContain("issuance_key = v_issuance_key");
    expect(migration).toContain("'series_open_play:' || p_commitment_id::TEXT");
    expect(migration).toContain("AFTER INSERT OR UPDATE OF status, activity_series_id, participant_customer_id, dependent_participant_id");
    expect(migration).toContain("reconcile_series_open_play_benefits_on_session");
    expect(migration).toContain("status = 'revoked'");
    expect(migration).not.toContain("DELETE FROM public.access_entitlements");
  });

  it("keeps the benefit participant-owned for paid and House Comp places", () => {
    const migration = read(migrationPath);
    expect(migration).toContain("v_commitment.participant_customer_id");
    expect(migration).toContain("v_commitment.dependent_participant_id");
    expect(migration).toContain("CASE WHEN v_house_comp THEN 'house_granted' ELSE 'commerce_purchase' END");
    expect(migration).toContain("CASE WHEN v_house_comp THEN 'house_comped' ELSE 'self_prepaid' END");
    expect(migration).not.toContain("payer_customer_id");
  });

  it("uses the shared activity resolver and preserves canonical price precedence", () => {
    const pricing = read("supabase/functions/_shared/activity_pricing.ts");
    const commerce = read("supabase/functions/api-commerce/index.ts");
    expect(pricing).toContain("entitlement_types: ['series_access', 'punch_card', 'partner_access']");
    expect(pricing).toContain("String(canonicalAccess.entitlement_type || '') === 'series_access' || finalAmountSek > 0");
    expect(pricing.indexOf("entitlement_types: ['series_access', 'punch_card', 'partner_access']"))
      .toBeLessThan(pricing.indexOf("if (firstVisitEnabled && finalAmountSek > 0)"));
    expect(commerce).toContain("['series_access', 'punch_card', 'partner_access']");
  });

  it("scopes reusable entitlement registration idempotency to the exact occurrence", () => {
    const migration = read(occurrenceCommitRepairPath);
    const commerce = read("supabase/functions/api-commerce/index.ts");
    expect(migration).toContain("AND activity_session_id = p_activity_session_id");
    expect(migration).toContain("AND session_date = p_session_date");
    expect(migration).toContain("jsonb_build_object('registration_id', v_existing.id)");
    expect(migration).not.toContain("WHERE source_type = p_source_type AND source_id = p_source_id\n    LIMIT 1");
    expect(commerce).toContain(".eq('activity_session_id', line.activity_session_id)");
    expect(commerce).toContain(".eq('session_date', line.session_date)");
    expect(commerce).toContain("registration_occurrence_mismatch");
  });

  it("verifies exact canonical registration truth before linking or paying the order", () => {
    const commerce = read("supabase/functions/api-commerce/index.ts");
    const orderPage = read("src/pages/CommerceOrderPage.tsx");
    const verification = commerce.indexOf("let committedRegistrationQuery");
    const lineLink = commerce.indexOf("admin.from('commerce_order_lines')", verification);
    const paidOrder = commerce.indexOf("admin.from('commerce_orders').update", verification);

    expect(verification).toBeGreaterThan(-1);
    expect(lineLink).toBeGreaterThan(verification);
    expect(paidOrder).toBeGreaterThan(lineLink);
    expect(commerce.slice(verification, lineLink)).toContain(".eq('activity_session_id', line.activity_session_id)");
    expect(commerce.slice(verification, lineLink)).toContain(".eq('session_date', line.session_date)");
    expect(orderPage).toContain("const managementRegistrationId = activity?.registration_id || null");
    expect(orderPage).not.toContain("lines.find((line) => line.commerce_kind === \"participation\")?.session_registration_id");
  });

  it("exposes only the small managed-Series control and actual Session projection", () => {
    const api = read("supabase/functions/api-courses/index.ts");
    const admin = read("src/components/admin/AdminCourses.tsx");
    const detail = read("src/pages/CourseSeriesPage.tsx");
    expect(api).toContain("path === 'series-included-access'");
    expect(api).toContain("set_series_open_play_benefit");
    expect(admin).toContain("Open Play under erbjudandets period");
    expect(detail).toContain("course?.sessions");
    expect(detail).toContain("Dina tillfällen");
    expect(detail).not.toContain("plus({ weeks:");
    expect(detail).toContain("Fri Open Play under hela kursperioden");
  });
});
