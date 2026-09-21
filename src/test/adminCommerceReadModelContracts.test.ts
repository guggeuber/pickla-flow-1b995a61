import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const adminSource = readFileSync("supabase/functions/api-admin/index.ts", "utf8");
const commerceSource = readFileSync("supabase/functions/api-commerce/index.ts", "utf8");
const experienceSource = readFileSync("src/components/admin/commerce/AdminCommerceWorkspace.tsx", "utf8");

describe("Admin Commerce canonical read-model contracts", () => {
  it("decorates products in batches with canonical variants, listing and inventory counters", () => {
    expect(adminSource).toContain("admin.from('product_variants').select('id, product_id, status').in('product_id', productIds)");
    expect(adminSource).toContain("admin.from('inventory_levels')");
    expect(adminSource).toContain("available_to_sell: summary.available_to_sell + Number(level.on_hand || 0) - Number(level.reserved || 0) - Number(level.allocated || 0)");
    expect(adminSource).toContain("trackedGateEnabled");
  });

  it("uses the existing inventory operations boundary for bounded canonical order history", () => {
    expect(commerceSource).toContain("const orderLimit = Math.min(100");
    expect(commerceSource).toContain("const movementLimit = Math.min(100");
    expect(commerceSource).toContain("admin.from('commerce_orders')");
    expect(commerceSource).toContain("admin.from('commerce_order_lines')");
    expect(commerceSource).toContain("admin.from('commerce_physical_dispositions')");
    expect(commerceSource).toContain("orders_page:");
    expect(commerceSource).toContain("movements_page:");
  });

  it("keeps refund and physical disposition as separate canonical commands and exposes no tracked-sales toggle", () => {
    expect(experienceSource).toContain('apiPost<{ recovery_pending?: boolean }>("api-commerce", "refund"');
    expect(experienceSource).toContain('apiPost("api-commerce", "physical-disposition"');
    expect(experienceSource).not.toContain('apiPatch("api-admin", "tracked-sales"');
    expect(experienceSource).not.toMatch(/orange/i);
  });
});
