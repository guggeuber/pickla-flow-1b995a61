import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("managed Series Admin edit boundary", () => {
  it("keeps Program & Event as the only managed-Series mutation owner", () => {
    const courses = read("supabase/functions/api-courses/index.ts");
    expect(courses).toContain("rpc('update_managed_series_run'");
    expect(courses).toContain("rpc('update_managed_series_format'");
    expect(courses).toContain("Ändra hela omgången där så att schema och deltagare förblir synkroniserade");
    expect(courses).toContain("managedSeriesEditPolicy");
    expect(courses).toContain("schedule_lock_reason");
  });

  it("atomically reconciles a safe published schedule while preserving occurrence identity", () => {
    const migration = read("supabase/migrations/20260825120000_managed_series_admin_edit.sql");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.update_managed_series_run");
    expect(migration).toContain("ON CONFLICT (series_id, series_occurrence_index)");
    expect(migration).toContain("preview_course_resource_schedule");
    expect(migration).toContain("lock_course_resources");
    expect(migration).toContain("DELETE FROM public.activity_sessions");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.update_managed_series_run");
    expect(migration).toContain("TO service_role");
    expect(migration).not.toContain("TO anon");
    expect(migration).not.toContain("TO authenticated");
  });

  it("locks history and enforces canonical capacity without rewriting accounting truth", () => {
    const migration = read("supabase/migrations/20260825120000_managed_series_admin_edit.sql");
    expect(migration).toContain("capacity_committed_count");
    expect(migration).toContain("capacity_active_holds_count");
    expect(migration).toContain("managed_series_capacity_below_fill");
    expect(migration).toContain("managed_series_capacity_below_early_bird_slots");
    expect(migration).toContain("managed_series_price_below_early_bird");
    expect(migration).toContain("managed_series_price_below_member_price");
    expect(migration).toContain("managed_series_schedule_has_participants");
    expect(migration).toContain("managed_series_schedule_started");
    expect(migration).toContain("managed_series_schedule_has_staffing");
    expect(migration).not.toContain("UPDATE public.commerce_orders");
    expect(migration).not.toContain("UPDATE public.commerce_order_lines");
    expect(migration).not.toContain("UPDATE public.commerce_receipts");
    expect(migration).not.toContain("UPDATE public.commerce_ledger");
  });

  it("keeps reusable Format content separate and propagates only future staffing requirements", () => {
    const migration = read("supabase/migrations/20260825120000_managed_series_admin_edit.sql");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.update_managed_series_format");
    expect(migration).toContain("session.session_date + session.start_time");
    expect(migration).toContain("AT TIME ZONE 'Europe/Stockholm' > now()");
    expect(migration).not.toContain("UPDATE public.operational_staff_assignments");
  });
});
