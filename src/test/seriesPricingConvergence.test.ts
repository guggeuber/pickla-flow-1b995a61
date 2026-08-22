import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  applyPercentDiscount,
  selectPositiveMembershipProductPrice,
} from "../../supabase/functions/_shared/pricing_math";

const read = (path: string) => readFileSync(path, "utf8");

describe("scope-aware Series pricing convergence", () => {
  it("keeps membership product-price selection deterministic and positive", () => {
    expect(applyPercentDiscount(1495, 10)).toBe(1345.5);
    expect(selectPositiveMembershipProductPrice(1495, [
      { discount_percent: 10 },
      { fixed_price: 1295 },
    ])).toBe(1295);
    expect(selectPositiveMembershipProductPrice(1495, [{ fixed_price: 0 }])).toBeNull();
    expect(selectPositiveMembershipProductPrice(1495, [])).toBeNull();
  });

  it("uses one scope-aware entrypoint while leaving Session resolution authoritative", () => {
    const resolver = read("supabase/functions/_shared/scope_pricing.ts");
    expect(resolver).toContain("scopeType: 'activity_session'");
    expect(resolver).toContain("scopeType: 'activity_series'");
    expect(resolver).toContain("resolveActivityPricingDecision({");
    expect(resolver).toContain("p_scope_type: 'activity_series'");
    expect(resolver).toContain("p_scope_id: series.id");
    expect(resolver).toContain("p_session_date: series.start_date");
    expect(resolver).toContain("salesChannel: channel");
  });

  it("keeps Series price independent of presentation and generated Session prices", () => {
    const resolver = read("supabase/functions/_shared/scope_pricing.ts");
    expect(resolver).toContain("product.base_price_sek");
    expect(resolver).not.toContain("presentation_type");
    expect(resolver).not.toContain("activity_sessions");
    expect(resolver).not.toContain("session.price_sek");
    expect(resolver).not.toContain("session.metadata");
    expect(resolver).toContain("membership_tier_pricing");
    expect(resolver).toContain(".eq('product_type', product.product_key)");
  });

  it("freezes the shared Series decision and retires new course_upfront_price writes", () => {
    const commerce = read("supabase/functions/api-commerce/index.ts");
    expect(commerce).toContain("resolveScopeAwarePricingDecision({");
    expect(commerce).toContain("scopeType: 'activity_series'");
    expect(commerce).toContain("pricing_reason: decision.pricingReason");
    expect(commerce).toContain("series_fill: decision.seriesFill");
    expect(commerce).toContain("unitPriceMinor = Math.round(Number(decision.finalAmountSek || 0) * 100)");
    expect(commerce).not.toContain("pricing_reason: 'course_upfront_price'");
    expect(commerce).not.toContain("applied_price_type: 'course_upfront_price'");
  });

  it("does not let Session entitlements or unsupported zero member prices redefine Series ownership", () => {
    const resolver = read("supabase/functions/_shared/scope_pricing.ts");
    const math = read("supabase/functions/_shared/pricing_math.ts");
    expect(resolver).not.toContain("resolve_access_entitlement");
    expect(resolver).toContain("series_purchase_entitlement_not_applied_without_commitment_funding_contract");
    expect(math).toContain("amount > 0");
  });
});
