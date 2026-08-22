import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(path, "utf8");
}

const migrationPath = "supabase/migrations/20260822120000_series_house_comp_staff_grants.sql";

describe("Series house comp constitutional contract", () => {
  it("reuses canonical entitlement provenance without a parallel financial model", () => {
    const migration = read(migrationPath);
    const grant = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.grant_series_staff_place"),
      migration.indexOf("CREATE OR REPLACE FUNCTION public.cancel_series_staff_place"),
    );

    expect(grant).toContain("'house_granted', 'house_comped', 'Friplats · Pickla'");
    expect(grant).toContain("'house_comped', 1, 1, 10");
    expect(grant).toContain("'series_staff_grant', v_commitment.id");
    expect(grant).toContain("'activity_series', 'unlimited'");
    expect(grant).not.toContain("presentation_type");
    expect(grant).not.toContain("commerce_orders");
    expect(grant).not.toContain("commerce_order_lines");
    expect(grant).not.toContain("booking_receipts");
    expect(grant).not.toContain("ledger_entries");
    expect(migration).not.toMatch(/CREATE TABLE/i);
  });

  it("serializes grants with the same Series capacity lock used by checkout holds", () => {
    const migration = read(migrationPath);
    const grant = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.grant_series_staff_place"),
      migration.indexOf("CREATE OR REPLACE FUNCTION public.cancel_series_staff_place"),
    );

    expect(grant).toContain("public.capacity_lock_scope");
    expect(grant).toContain("public.capacity_committed_count");
    expect(grant).toContain("public.capacity_active_holds_count");
    expect(grant).toContain("'capacity_full'");
    expect(grant).toContain("'duplicate_active_place'");
    expect(grant).toContain("'existing_grant'");
    expect(grant).toContain("grant_request_id");
    expect(migration).toContain("uq_series_staff_grant_request");
  });

  it("cancels non-financial truth without deleting attendance or grant provenance", () => {
    const migration = read(migrationPath);
    const cancellation = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.cancel_series_staff_place"),
    );

    expect(cancellation).toContain("status = 'cancelled'");
    expect(cancellation).toContain("status = 'revoked'");
    expect(cancellation).toContain("COALESCE(metadata, '{}'::JSONB) || jsonb_build_object");
    expect(migration).toContain("registration.status IN ('checked_in', 'no_show')");
    expect(migration).toContain("registration.status = 'confirmed'");
    expect(cancellation).not.toContain("DELETE FROM public.series_commitments");
    expect(cancellation).not.toContain("commerce_refund");
  });

  it("keeps mutation service-role-only and removes browser writes", () => {
    const migration = read(migrationPath);
    expect(migration).toContain("REVOKE INSERT, UPDATE, DELETE ON public.series_commitments FROM anon, authenticated");
    expect(migration).toContain("DROP POLICY IF EXISTS \"Venue staff manage series commitments\"");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.grant_series_staff_place(");
    expect(migration).toContain("TO service_role");
    expect(migration).toContain("staff.role = 'venue_admin'");
    expect(migration).toContain("role.role = 'super_admin'");
  });

  it("exposes only authorized admin actions and friendly customer provenance", () => {
    const api = read("supabase/functions/api-courses/index.ts");
    const admin = read("src/components/admin/AdminCourses.tsx");
    const myPage = read("src/pages/MyPage.tsx");
    const grantRoute = api.slice(api.indexOf("path === 'staff-grant'"), api.indexOf("path === 'staff-grant-cancel'"));

    expect(api).toContain("path === 'staff-grant'");
    expect(api).toContain("path === 'staff-grant-cancel'");
    expect(grantRoute).toContain("managedSellableSeries(admin, seriesId)");
    expect(grantRoute).not.toContain("courseSeries(admin, seriesId)");
    expect(grantRoute).not.toContain("presentation_type");
    expect(api).toContain("requireVenueRole(admin, auth.userId, venueId, ['venue_admin'])");
    expect(admin).toContain("Ge plats");
    expect(admin).toContain("Plats given");
    expect(api).toContain("provenance_label: 'Friplats · Pickla'");
    expect(admin).toContain("grant.provenance_label");
    expect(myPage).toContain("course.access.label");
    expect(myPage).toContain("course.access.detail");
    expect(myPage).not.toContain("house_granted");
    expect(myPage).not.toContain("house_comped");
    expect(myPage).not.toContain("series_staff_grant");
  });
});
