import { describe, expect, it } from "vitest";
import { adminModuleHref, adminModuleIdFromPath } from "@/lib/adminModuleRoute";

describe("admin module routes", () => {
  it("round-trips directly addressable modules", () => {
    expect(adminModuleHref("products")).toBe("/hub/admin/products");
    expect(adminModuleIdFromPath("products")).toBe("products");
    expect(adminModuleHref("financialMaintenance")).toBe("/hub/admin/financial-maintenance");
    expect(adminModuleIdFromPath("financial-maintenance")).toBe("financialMaintenance");
  });

  it("rejects unknown modules safely", () => {
    expect(adminModuleHref("unknown")).toBe("/hub/admin");
    expect(adminModuleIdFromPath("unknown")).toBeNull();
  });
});
