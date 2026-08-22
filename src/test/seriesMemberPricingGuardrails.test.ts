import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  membershipProductPriceMode,
  membershipProductPricePreview,
  selectPositiveMembershipProductPrice,
} from "../../supabase/functions/_shared/pricing_math";

const read = (path: string) => readFileSync(path, "utf8");

describe("Series member pricing guardrails", () => {
  it("resolves fixed and percentage prices deterministically without zero or above-base results", () => {
    expect(membershipProductPriceMode({ fixed_price: 169 })).toBe("fixed");
    expect(membershipProductPriceMode({ discount_percent: 15 })).toBe("percent");
    expect(membershipProductPriceMode({ fixed_price: 169, discount_percent: 15 })).toBeNull();
    expect(membershipProductPriceMode({})).toBeNull();

    expect(membershipProductPricePreview(199, { fixed_price: 169 })).toEqual({ mode: "fixed", value: 169, finalAmountSek: 169 });
    expect(membershipProductPricePreview(199, { discount_percent: 15 })).toEqual({ mode: "percent", value: 15, finalAmountSek: 169.15 });
    expect(membershipProductPricePreview(199, { fixed_price: 200 })).toBeNull();
    expect(membershipProductPricePreview(199, { fixed_price: 0 })).toBeNull();
    expect(membershipProductPricePreview(199, { discount_percent: 0 })).toBeNull();
    expect(membershipProductPricePreview(199, { discount_percent: 101 })).toBeNull();
    expect(membershipProductPricePreview(199, { discount_percent: 100 })).toBeNull();
    expect(selectPositiveMembershipProductPrice(199, [{ fixed_price: 250 }, { fixed_price: 169 }])).toBe(169);
  });

  it("keeps Series pricing on access_product and the shared resolver", () => {
    const resolver = read("supabase/functions/_shared/scope_pricing.ts");
    expect(resolver).toContain("product.base_price_sek");
    expect(resolver).toContain("membership_tier_pricing");
    expect(resolver).toContain("pricingReason = 'membership_tier_pricing'");
    expect(resolver).not.toContain("presentation_type");
    expect(resolver).not.toContain("session.price_sek");
  });

  it("validates canonical tier/product ownership and every requested invalid mode server-side", () => {
    const api = read("supabase/functions/api-memberships/index.ts");
    expect(api).toContain("validatedTierPricingWrite");
    expect(api).toContain(".eq('venue_id', tier.venue_id)");
    expect(api).toContain("product.is_active !== true || product.status !== 'active'");
    expect(api).toContain("Välj exakt en prismodell");
    expect(api).toContain("fixedPrice <= 0");
    expect(api).toContain("fixedPrice > Number(product.base_price_sek || 0)");
    expect(api).toContain("discountPercent <= 0 || discountPercent > 100");
    expect(api).toContain("Det finns redan ett aktivt medlemspris");
    expect(api).toContain("Serieprodukter stödjer inte gratis medlemspris");
  });

  it("makes direct rules unique and API-owned without creating Series price columns", () => {
    const migration = read("supabase/migrations/20260823120000_series_member_pricing_guardrails.sql");
    expect(migration).toContain("uq_membership_tier_pricing_direct_product");
    expect(migration).toContain("WHERE pricing_rule_id IS NULL");
    expect(migration).toContain("REVOKE INSERT, UPDATE, DELETE ON public.membership_tier_pricing FROM anon, authenticated");
    expect(migration).not.toContain("ALTER TABLE public.activity_series");
    expect(migration).not.toMatch(/CREATE TABLE/i);
  });

  it("keeps House Comp outside Order and membership-price resolution", () => {
    const houseComp = read("supabase/migrations/20260822120000_series_house_comp_staff_grants.sql");
    const memberApi = read("supabase/functions/api-memberships/index.ts");
    expect(houseComp).toContain("series_staff_grant");
    expect(houseComp).not.toContain("membership_tier_pricing");
    expect(memberApi).not.toContain("grant_series_staff_place");
  });
});
