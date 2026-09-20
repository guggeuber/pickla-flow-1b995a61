import { describe, expect, it } from "vitest";
import {
  commerceCartItemFromKey,
  commerceCartItemKey,
  commerceCartItemsFromLines,
  commerceCartQuantitiesFromLines,
  commercePendingPickupItems,
} from "@/lib/commerce";
import { evaluateCommerceAvailability } from "../../supabase/functions/_shared/commerce_availability";

describe("Commerce R2A client contracts", () => {
  it("keeps stockless cart keys backward compatible and keys tracked variants by location", () => {
    expect(commerceCartItemKey({ product_id: "racket" })).toBe("racket");
    const key = commerceCartItemKey({ product_id: "tee", variant_id: "black-m", pickup_location_id: "desk-a" });
    expect(key).toBe("tee::black-m::desk-a");
    expect(commerceCartItemFromKey(key, 2)).toEqual({
      product_id: "tee",
      variant_id: "black-m",
      pickup_location_id: "desk-a",
      quantity: 2,
    });
  });

  it("round-trips canonical tracked line identity without carrying a client price", () => {
    const lines = [{
      id: "line-a", product_id: "tee", product_key: "pickla_classic_tee",
      product_name: "Pickla Classic Tee", commerce_kind: "merchandise" as const,
      quantity: 2, unit_price_minor: 29900, line_total_inc_vat_minor: 59800,
      vat_rate: 25, vat_amount_minor: 11960, fulfillment_type: "desk_pickup",
      fulfillment_status: "pending_pickup", inventory_policy: "tracked" as const,
      variant_id: "black-m", sku: "PCT-BLK-M", pickup_location_id: "desk-a",
    }];
    expect(commerceCartQuantitiesFromLines(lines)).toEqual({ "tee::black-m::desk-a": 2 });
    expect(commerceCartItemsFromLines(lines)).toEqual([{
      product_id: "tee", quantity: 2, variant_id: "black-m", pickup_location_id: "desk-a",
    }]);
  });

  it("derives quantity-aware pickup progress from immutable purchased quantity", () => {
    const [item] = commercePendingPickupItems([{
      id: "line-a", product_id: "tee", product_key: "pickla_classic_tee",
      product_name: "Pickla Classic Tee", commerce_kind: "merchandise",
      quantity: 3, unit_price_minor: 29900, line_total_inc_vat_minor: 89700,
      vat_rate: 25, vat_amount_minor: 17940, fulfillment_type: "desk_pickup",
      fulfillment_status: "pending_pickup", collected_quantity: 1, cancelled_quantity: 1,
      sku: "PCT-BLK-M", variant_snapshot: { options: [{
        option_id: "color", option_code: "color", option_label: "Färg",
        value_id: "black", value_code: "black", value_label: "Black", swatch: "#000000",
      }] },
    }]);
    expect(item.quantity).toBe(1);
    expect(item.productName).toContain("Black");
    expect(item.productName).toContain("PCT-BLK-M");
  });
});

describe("Commerce R2A availability boundary", () => {
  const merchandise = {
    status: "active", is_active: true, standalone_enabled: true,
    activity_addon_enabled: false, commerce_kind: "merchandise",
    fulfillment_type: "desk_pickup", fulfillment_presentation: "desk_pickup",
    base_price_sek: 299, vat_rate: 25, inventory_policy: "tracked",
  };

  it("permits tracked merchandise only in the standalone channel", () => {
    expect(evaluateCommerceAvailability(merchandise, {
      channel: "standalone", venueCommerceEnabled: true,
    })).toEqual({ eligible: true, code: "available", message: null });
    expect(evaluateCommerceAvailability({ ...merchandise, activity_addon_enabled: true }, {
      channel: "activity_addon", venueCommerceEnabled: true, hasActiveRelationship: true,
    }).code).toBe("unsupported_tracked_channel");
  });

  it("keeps zero a valid explicit price instead of treating it as null", () => {
    expect(evaluateCommerceAvailability({ ...merchandise, base_price_sek: 0 }, {
      channel: "standalone", venueCommerceEnabled: true,
    }).eligible).toBe(true);
  });
});
