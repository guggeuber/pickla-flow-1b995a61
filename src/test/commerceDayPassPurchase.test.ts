import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const programPage = readFileSync("src/pages/ProgramSessionPage.tsx", "utf8");
const cartPage = readFileSync("src/pages/CommerceCartPage.tsx", "utf8");
const orderPage = readFileSync("src/pages/CommerceOrderPage.tsx", "utf8");
const playPage = readFileSync("src/pages/PlayPage.tsx", "utf8");
const commerceApi = readFileSync("supabase/functions/api-commerce/index.ts", "utf8");
const webhook = readFileSync("supabase/functions/api-stripe-webhook/index.ts", "utf8");
const pricing = readFileSync("supabase/functions/_shared/activity_pricing.ts", "utf8");
const adminSchedule = readFileSync("src/components/admin/AdminSchedule.tsx", "utf8");

describe("Commerce Heldagspass purchase", () => {
  it("offers one calm choice between a personal place and the configured day pass", () => {
    expect(programPage).toContain('data-testid="commerce-option-activity-ticket"');
    expect(programPage).toContain('data-testid="commerce-option-day-pass"');
    expect(programPage).toContain('aria-pressed={commercePurchaseKind === "day_pass"}');
    expect(programPage).toContain('commercePurchaseKind === "activity_ticket" ? commerceExtras.flatMap');
  });

  it("uses only the Admin product base price and has no 199 kr fallback", () => {
    expect(pricing).not.toContain("DEFAULT_DAY_ACCESS_PRICE_SEK");
    expect(adminSchedule).not.toContain("price || 199");
    expect(commerceApi).toContain("Heldagspass saknar pris i Admin.");
    expect(programPage).toContain("commerceDayPassProduct.base_price_sek");
  });

  it("freezes an accurate day-pass order line and keeps Early-Bird separate", () => {
    expect(commerceApi).toContain("purchaseKind = product.product_key === 'day_access'");
    expect(commerceApi).toContain("purchase_kind: purchaseKind");
    expect(commerceApi).toContain("purchase_kind: regularResolvedLine?.resolver_snapshot?.purchase_kind");
    expect(cartPage).toContain('line.resolver_snapshot?.purchase_kind === "day_pass"');
  });

  it("delivers canonical day access idempotently without a session ticket", () => {
    expect(webhook).toContain("upsertCommerceDayPass");
    expect(webhook).toContain("{ onConflict: 'commerce_order_id' }");
    expect(webhook).toContain("entitlement_type: 'day_access'");
    expect(webhook).toContain("source_type: 'commerce_order'");
    expect(webhook).toContain("if (purchaseKind === 'day_pass')");
  });

  it("supports guest check-in, account activation, history and refund revocation", () => {
    expect(commerceApi).toContain("entryType = purchaseKind === 'day_pass' ? 'day_access' : 'session_ticket'");
    expect(commerceApi).toContain(".eq('commerce_order_id', order.id)");
    expect(commerceApi).toContain(".update({ user_id: userId })");
    expect(webhook).toContain(".update({ status: 'cancelled' })");
    expect(orderPage).toContain("Heldagspasset är aktivt");
  });

  it("removes the dead commercial CTA", () => {
    expect(playPage).toContain('cta: "Se Open Play →"');
    expect(playPage).not.toContain('cta: "Köp dagspass →"');
  });
});
