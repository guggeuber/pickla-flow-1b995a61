import { describe, expect, it } from "vitest";

import {
  commercePendingPickupItems,
  type CommerceOrderLine,
} from "@/lib/commerce";

function pickupLine(quantity: number, fulfillmentStatus = "pending_pickup"): CommerceOrderLine {
  return {
    id: "line-product",
    product_id: "product-addon",
    product_key: "generic_addon",
    product_name: "Handduk",
    commerce_kind: "merchandise",
    quantity,
    unit_price_minor: 5000,
    line_total_inc_vat_minor: 5000 * quantity,
    vat_rate: 6,
    vat_amount_minor: Math.round(5000 * quantity * 6 / 106),
    fulfillment_type: "desk_pickup",
    fulfillment_status: fulfillmentStatus,
    product_snapshot: {},
  };
}

describe("Commerce R1 pickup instructions", () => {
  it("omits pickup items when none exist", () => {
    expect(commercePendingPickupItems([])).toEqual([]);
  });

  it("projects any desk-pickup product without product-name special cases", () => {
    expect(commercePendingPickupItems([pickupLine(2)])).toEqual([{
      lineId: "line-product",
      productName: "Handduk",
      quantity: 2,
    }]);
  });

  it("does not present refunded or collected products as collectable", () => {
    expect(commercePendingPickupItems([pickupLine(1, "not_collected")], { confirmed: true })).toEqual([]);
    expect(commercePendingPickupItems([pickupLine(1, "collected")], { confirmed: true })).toEqual([]);
  });
});
