import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const commerceApi = readFileSync("supabase/functions/api-commerce/index.ts", "utf8");
const commerceLib = readFileSync("src/lib/commerce.ts", "utf8");
const myPage = readFileSync("src/pages/MyPage.tsx", "utf8");
const cancellationClient = readFileSync("src/lib/cancellationPolicy.ts", "utf8");
const cancellationExecution = readFileSync("supabase/functions/_shared/cancellation_execution.ts", "utf8");
const refundExecution = readFileSync("supabase/functions/_shared/commerce_refunds.ts", "utf8");
const webhook = readFileSync("supabase/functions/api-stripe-webhook/index.ts", "utf8");
const cancellationMigration = readFileSync("supabase/migrations/20260921140000_activity_cancellation_capacity_truth.sql", "utf8");
const policyMigration = readFileSync("supabase/migrations/20260922120000_cancellation_policy_v1.sql", "utf8");

describe("account-owned Commerce activity cancellation", () => {
  it("maps a registration to an account-owned order on the server", () => {
    expect(commerceApi).toContain("path === 'registration-order'");
    expect(commerceApi).toContain("if (registration.user_id !== userId) return errorResponse('Forbidden', 403)");
    expect(commerceApi).toContain("loadOrderByReference(admin, participationLine.commerce_order_id, userId, true)");
    expect(commerceLib).toContain('"registration-order", { registrationId }');
  });

  it("uses the frozen server policy preview and keeps the legacy order-state projection honest", () => {
    expect(commerceApi).toContain("policy: 'before_activity_start'");
    for (const state of ["paid", "free", "pending", "refund_pending", "refunded", "cancelled", "started", "attention", "unmanaged"]) {
      expect(commerceLib).toContain(`| "${state}"`);
    }
    expect(cancellationClient).toContain('"api-cancellations", "preview"');
    expect(cancellationClient).toContain("cancellationDecisionCopy");
    expect(myPage).toContain('fetchCancellationPreview("activity_registration"');
    expect(myPage).toContain("Avbokning stängd");
    expect(myPage).toContain("återbetalningen behandlas");
  });

  it("keeps cancellation confirmation and Stripe refund delivery idempotent", () => {
    expect(commerceApi).toContain("confirmCancellationAndDispatchRefund");
    expect(cancellationExecution).toContain("confirm_cancellation_policy_v1");
    expect(refundExecution).toContain("'Idempotency-Key': refund.provider_idempotency_key");
    expect(policyMigration).toContain("commerce_refunds_cancellation_decision_once");
    expect(policyMigration.match(/request_id = v_request/g)).toHaveLength(2);
    expect(webhook).toContain("stripe_refund_object_id");
    expect(webhook).toContain("payment_status: 'refunded'");
  });

  it("revokes registration and access atomically while refund fulfillment remains separate", () => {
    expect(policyMigration).toContain("cancel_activity_registration_participation");
    expect(policyMigration).toContain("UPDATE public.access_entitlements SET status = 'revoked'");
    expect(cancellationMigration).toContain("UPDATE public.session_registrations");
    expect(cancellationMigration).toContain("UPDATE public.access_entitlements");
    expect(cancellationMigration).not.toContain("fulfillment_status");
    expect(webhook).toContain("fulfillment_status: 'not_collected'");
    expect(myPage).toContain('["my-session-registrations", user?.id]');
    expect(myPage).toContain('["commerce-my-orders"]');
    expect(myPage).toContain('["my-passes", user?.id]');
  });
});
