import { describe, expect, it } from "vitest";

import {
  commerceRacketOrderSummaryInstruction,
  commerceRacketPickupQuantity,
  commerceRacketSuccessInstruction,
  type CommerceOrderLine,
} from "@/lib/commerce";

function racketLine(quantity: number, fulfillmentStatus = "pending_pickup"): CommerceOrderLine {
  return {
    id: "line-racket",
    product_id: "product-racket",
    product_key: "rental_racket",
    product_name: "Hyrrack",
    commerce_kind: "rental",
    quantity,
    unit_price_minor: 5000,
    line_total_inc_vat_minor: 5000 * quantity,
    vat_rate: 6,
    vat_amount_minor: Math.round(5000 * quantity * 6 / 106),
    fulfillment_type: "desk_pickup",
    fulfillment_status: fulfillmentStatus,
    product_snapshot: { customer_instruction_code: "desk_pickup_racket_by_name" },
  };
}

describe("Commerce R1 pickup instructions", () => {
  it("omits pickup copy when the quantity is zero", () => {
    expect(commerceRacketPickupQuantity([])).toBe(0);
    expect(commerceRacketOrderSummaryInstruction(0)).toBeNull();
    expect(commerceRacketSuccessInstruction(0)).toBeNull();
  });

  it("uses singular order-summary and success copy for one racket", () => {
    expect(commerceRacketPickupQuantity([racketLine(1)])).toBe(1);
    expect(commerceRacketOrderSummaryInstruction(1)).toBe(
      "Hämtas ut i desken genom att uppge ditt namn.",
    );
    expect(commerceRacketSuccessInstruction(1)).toEqual({
      summary: "Du har hyrt 1 rack.",
      pickup: "Hämta ut det i desken genom att uppge ditt namn.",
    });
  });

  it("uses plural order-summary and success copy for multiple rackets", () => {
    expect(commerceRacketPickupQuantity([racketLine(2)])).toBe(2);
    expect(commerceRacketOrderSummaryInstruction(2)).toBe(
      "Hämtas ut i desken genom att uppge ditt namn.",
    );
    expect(commerceRacketSuccessInstruction(2)).toEqual({
      summary: "Du har hyrt 2 rack.",
      pickup: "Hämta ut dem i desken genom att uppge ditt namn.",
    });
  });

  it("does not present refunded or cancelled rackets as collectable", () => {
    expect(commerceRacketPickupQuantity([racketLine(1, "not_collected")], { confirmed: true })).toBe(0);
    expect(commerceRacketPickupQuantity([racketLine(1, "collected")], { confirmed: true })).toBe(0);
  });
});
