import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  checkoutReturnEligible,
  stripeCheckoutCancellationDecision,
} from "../../supabase/functions/_shared/commerce_checkout_return";

const read = (path: string) => readFileSync(path, "utf8");

describe("Course Stripe checkout return authority", () => {
  it("allows polling only for the exact server-owned checkout session", () => {
    expect(checkoutReturnEligible("cs_live_exact", "cs_live_exact")).toBe(true);
    expect(checkoutReturnEligible("cs_live_exact", "cs_live_other")).toBe(false);
    expect(checkoutReturnEligible("cs_live_exact", "")).toBe(false);
    expect(checkoutReturnEligible("cs_live_exact", "not-a-session")).toBe(false);
  });

  it("never reopens paid or completed checkout truth", () => {
    expect(stripeCheckoutCancellationDecision({ status: "complete", payment_status: "paid" })).toBe("verify_payment");
    expect(stripeCheckoutCancellationDecision({ status: "complete", payment_status: "unpaid" })).toBe("verify_payment");
    expect(stripeCheckoutCancellationDecision({ status: "open", payment_status: "paid" })).toBe("verify_payment");
    expect(stripeCheckoutCancellationDecision({ status: "open", payment_status: "unpaid" })).toBe("expire_and_reopen");
    expect(stripeCheckoutCancellationDecision({ status: "expired", payment_status: "unpaid" })).toBe("reopen");
  });

  it("marks Stripe cancel explicitly and keeps success session correlation server-side", () => {
    const api = read("supabase/functions/api-commerce/index.ts");
    const orderPage = read("src/pages/CommerceOrderPage.tsx");
    const cartPage = read("src/pages/CommerceCartPage.tsx");
    expect(api).toContain("checkoutReturnEligible(order.stripe_session_id, returnedSessionId)");
    expect(api).toContain("checkout=cancelled");
    expect(api).toContain("path === 'cancel-checkout'");
    expect(api).toContain("retrieveStripeCheckoutSession");
    expect(api.indexOf("expireStripeCheckoutSession(stripeKey, order.stripe_session_id)")).toBeLessThan(api.indexOf("reopen_commerce_order_after_checkout_failure", api.indexOf("path === 'cancel-checkout'")));
    expect(orderPage).toContain("checkout_verification_eligible === true");
    expect(cartPage).toContain('order.status === "checkout_pending"');
  });

  it("derives child-only backfill from canonical youth audience and has an in-flight checkout gate", () => {
    const migration = read("supabase/migrations/20260831140000_course_dependent_only_participant_policy.sql");
    expect(migration).toContain("format.age_group = 'youth'");
    expect(migration).toContain("commerce_order.status = 'checkout_pending'");
    expect(migration).toContain("course_dependent_only_pending_checkout_gate");
    expect(migration).toContain("'\"dependent_only\"'::jsonb");
    expect(migration).not.toMatch(/Pickla Kids|Pickla Juniors|Pickla Next|Pickla Start/);
  });
});
