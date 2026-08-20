import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Series / Schedule write boundary", () => {
  it("uses lifecycle ownership rather than presentation or type", () => {
    const shared = read("supabase/functions/_shared/series_management.ts");
    expect(shared).toContain("series?.format_id || series?.access_product_id");
    expect(shared).not.toContain("presentation_type");
    expect(shared).not.toContain("series_type ===");
    expect(shared).not.toContain("session_type ===");
  });

  it("guards every generic managed-Series mutation surface on the server", () => {
    const admin = read("supabase/functions/api-admin/index.ts");
    expect(admin).toContain("loadActivitySeriesOwnership(admin, venueId, seriesId)");
    expect(admin).toContain("loadManagedSeriesForProduct(admin, venueId, productId)");
    expect(admin).toContain("isManagedActivitySeries(activitySeriesOwnershipFromRelation(existingSession.activity_series))");
    expect(admin).toContain("isManagedActivitySeries(targetOwnership)");
    expect(admin).toContain("return errorResponse(MANAGED_SERIES_MESSAGE, 409)");
    expect(admin).toContain("genericActivitySessionUpdates(normalizeActivitySessionPayload(updates))");
  });

  it("removes direct browser writes while preserving read and canonical server access", () => {
    const migration = read("supabase/migrations/20260820130000_series_schedule_write_boundary.sql");
    for (const table of ["activity_series", "activity_sessions", "access_products"]) {
      expect(migration).toContain(`REVOKE ALL ON TABLE public.${table} FROM anon, authenticated`);
      expect(migration).toContain(`GRANT SELECT ON TABLE public.${table} TO anon, authenticated`);
    }
    expect(migration).not.toContain("presentation_type");
  });

  it("keeps managed rows visible but removes misleading generic edit actions", () => {
    const schedule = read("src/components/admin/AdminSchedule.tsx");
    expect(schedule).toContain('management_mode === "managed_series"');
    expect(schedule).toContain("Hanteras i Program & event");
    expect(schedule).toContain("Genererat av Program & event");
    expect(schedule).toContain("series.filter((item) => !isManagedScheduleSeries(item))");
    expect(schedule).not.toContain('{ key: "course", label: "Kurs/serie" }');
    expect(read("src/components/admin/AdminCourses.tsx")).toContain("aria-expanded={open}");
  });
});
