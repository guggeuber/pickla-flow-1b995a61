import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("Desk protected booking detail", () => {
  const desk = read("../pages/Index.tsx");
  const detail = read("../components/operations/AdminBookingDetailDrawer.tsx");
  const adminApi = read("../../supabase/functions/api-admin/index.ts");
  const readSecurity = read("../../supabase/functions/_shared/admin_read_security.ts");

  it("opens the existing venue-authorized detail path instead of rebuilding PII from summary rows", () => {
    expect(desk).toContain("<AdminBookingDetailDrawer");
    expect(desk).toContain("bookingId={openBookingId}");
    expect(desk).not.toContain("buildOperationsBookingDetailFromRows");
    expect(detail).toContain('apiGet<OperationsBookingDetail>("api-admin", "booking-detail"');
    expect(detail).toContain("showProtectedDetails");
  });

  it("keeps the backend venue boundary and the broad calendar projection privacy-safe", () => {
    const detailStart = adminApi.indexOf("path === 'booking-detail'");
    expect(detailStart).toBeGreaterThan(0);
    expect(adminApi.indexOf("await getAuthenticatedClient(req)")).toBeLessThan(detailStart);
    const detailBranch = adminApi.slice(detailStart, detailStart + 2_000);
    expect(detailBranch).toContain("authorizeVenueScopedAdminRead");
    expect(detailBranch).toContain("canOperateVenue(admin, userId, requestedVenueId)");
    expect(detailBranch).toContain("return errorResponse('Forbidden', 403)");
    expect(adminApi).toContain("async function groupedCourtBookingDetail");
    expect(adminApi).toContain("customer_phone:");
    expect(adminApi).toContain("customer_email:");
    expect(adminApi).toContain("receipt_number:");
    expect(adminApi).toContain("projectAdminBookingSummary");
    expect(readSecurity).toContain("ADMIN_BOOKING_SUMMARY_FIELDS");
    expect(readSecurity).not.toContain("'customer_phone'");
    expect(readSecurity).not.toContain("'customer_email'");
    expect(readSecurity).not.toContain("'stripe_session_id'");
  });
});
