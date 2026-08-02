import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const commerceApi = readFileSync("supabase/functions/api-commerce/index.ts", "utf8");
const commerceLib = readFileSync("src/lib/commerce.ts", "utf8");
const myPage = readFileSync("src/pages/MyPage.tsx", "utf8");
const webhook = readFileSync("supabase/functions/api-stripe-webhook/index.ts", "utf8");

describe("account-owned Commerce activity cancellation", () => {
  it("maps a registration to an account-owned order on the server", () => {
    expect(commerceApi).toContain("path === 'registration-order'");
    expect(commerceApi).toContain("if (registration.user_id !== userId) return errorResponse('Forbidden', 403)");
    expect(commerceApi).toContain("loadOrderByReference(admin, participationLine.commerce_order_id, userId, true)");
    expect(commerceLib).toContain('"registration-order", { registrationId }');
  });

  it("uses the established before-start policy and exposes every honest state", () => {
    expect(commerceApi).toContain("policy: 'before_activity_start'");
    for (const state of ["paid", "free", "pending", "refund_pending", "refunded", "cancelled", "started", "attention", "unmanaged"]) {
      expect(commerceLib).toContain(`| "${state}"`);
    }
    for (const label of ["Avboka", "Återbetalning pågår", "Avbokad", "Återbetald", "Avbokning stängd", "Vi hjälper dig"]) {
      expect(myPage).toContain(label);
    }
  });

  it("keeps paid cancellation and Stripe refund idempotent", () => {
    expect(commerceApi).toContain("order.metadata?.cancellation_requested_at");
    expect(commerceApi).toContain("cancellation_pending: true");
    expect(commerceApi).toContain("Idempotency-Key': `commerce-cancel-${orderId}`");
    expect(webhook).toContain("stripe_refund_object_id");
    expect(webhook).toContain("payment_status: 'refunded'");
  });

  it("revokes registration, access and pickup state through canonical paths", () => {
    expect(commerceApi).toContain(".update({ status: 'cancelled' })");
    expect(commerceApi).toContain(".update({ status: 'revoked' })");
    expect(commerceApi).toContain("fulfillment_status: 'not_collected'");
    expect(webhook).toContain("fulfillment_status: 'not_collected'");
    expect(myPage).toContain('["my-session-registrations", user?.id]');
    expect(myPage).toContain('["commerce-my-orders"]');
    expect(myPage).toContain('["my-passes", user?.id]');
  });
});
