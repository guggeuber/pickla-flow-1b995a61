import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workspace = readFileSync("src/components/admin/commerce/AdminCommerceWorkspace.tsx", "utf8");
const commerceApi = readFileSync("supabase/functions/api-commerce/index.ts", "utf8");
const adminApi = readFileSync("supabase/functions/api-admin/index.ts", "utf8");
const mediaMigration = readFileSync("supabase/migrations/20260921120000_product_media_gallery.sql", "utf8");
const operabilityMigration = readFileSync("supabase/migrations/20260921130000_desk_order_customer_operability.sql", "utf8");

describe("Admin Commerce integrated V3 contract", () => {
  it("keeps one deterministic migration version per independently reviewed capability", () => {
    const versions = readdirSync("supabase/migrations")
      .filter((name) => name.endsWith(".sql"))
      .map((name) => name.slice(0, 14));
    expect(new Set(versions).size).toBe(versions.length);
    expect(mediaMigration).toContain("CREATE TABLE public.product_media");
    expect(operabilityMigration).toContain("ALTER COLUMN allocation_id DROP NOT NULL");
    expect(operabilityMigration).toContain("commerce_r2a_collect_pickup");
  });

  it("combines Media V2 with canonical order and customer operability in the same Admin workspace", () => {
    expect(workspace).toContain("ProductMediaEditor");
    expect(workspace).toContain("fetchStaffCommerceOrders");
    expect(workspace).toContain("CommerceOrderDetailDrawer");
    expect(workspace).toContain("Customer360Drawer");
    expect(workspace).toContain('searchParams.get("productId")');
    expect(workspace).toContain("Sök order, kvitto, kund, e-post eller SKU");
  });

  it("preserves venue-authorized SKU search and private media mutation boundaries", () => {
    expect(commerceApi).toContain("commerce_orders!inner(venue_id)");
    expect(commerceApi).toContain("sku.ilike");
    expect(commerceApi).toContain("await requireVenueRole(admin, userId, venueId, ['venue_admin', 'desk_staff'])");
    expect(adminApi).toContain("product-media");
    expect(adminApi).toContain("await requireVenueRole(admin, userId, venueId, ['venue_admin'])");
  });

  it("does not enable tracked merchandise while integrating the two surfaces", () => {
    expect(workspace).toContain("tracked_sales_enabled: false");
    expect(workspace).not.toMatch(/tracked_sales_enabled:\s*true/);
  });
});
