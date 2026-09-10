import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const corporateApi = readFileSync("supabase/functions/api-corporate/index.ts", "utf8");
const bookingsApi = readFileSync("supabase/functions/api-bookings/index.ts", "utf8");
const app = readFileSync("src/App.tsx", "utf8");

describe("corporate Phase 1 compatibility baseline", () => {
  it("keeps the explicit hour-order fulfillment path backed by corporate packages", () => {
    expect(corporateApi).toContain("order.order_type === 'hours'");
    expect(corporateApi).toContain(".from('corporate_packages')");
    expect(corporateApi).toContain("total_hours: order.total_hours");
  });

  it("does not create an implicit package with a new corporate account", () => {
    const createAccount = corporateApi.slice(
      corporateApi.indexOf("path === 'admin-accounts'"),
      corporateApi.indexOf("req.method === 'PATCH' && path === 'admin-accounts'"),
    );
    expect(createAccount).toContain("Packages are intentionally created only by an explicit hour-bank order");
    expect(createAccount).not.toContain(".from('corporate_packages')");
  });

  it("keeps corporate package-funded court booking and employer provenance", () => {
    expect(bookingsApi).toContain("const { data: pkg } = await admin.from('corporate_packages')");
    expect(bookingsApi).toContain(".from('corporate_members')");
    expect(bookingsApi).toContain("corporate_package_id: validCorporatePackageId");
    expect(bookingsApi).toContain("participation_funder: validCorporatePackageId ? 'employer' : 'house_comped'");
  });

  it("keeps the existing corporate portal routes", () => {
    expect(app).toContain('<Route path="/corp/join" element={<CorporateJoinPage />} />');
    expect(app).toContain('<Route path="/corp/register" element={<CorporateRegisterPage />} />');
    expect(app).toContain('<Route path="/corp/dashboard" element={<ProtectedRoute><CorporateDashboard /></ProtectedRoute>} />');
  });

  it("captures the isolated legacy recurring fulfillment boundary", () => {
    expect(corporateApi).toContain("order.order_type === 'recurring'");
    expect(corporateApi).toContain(".eq('corporate_order_id', order.id)");
    expect(corporateApi).toContain("if (linkedSeries?.length)");
    expect(corporateApi).toContain("Linked corporate Series must have its complete published, closed and court-assigned Session schedule before fulfillment");
    expect(corporateApi).toContain("} else {");
    expect(corporateApi).toContain(".from('corporate_order_items')");
    expect(corporateApi).toContain("participation_funding_source_type: 'corporate_order'");
  });
});
