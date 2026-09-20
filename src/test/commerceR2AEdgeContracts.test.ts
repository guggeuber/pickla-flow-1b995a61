import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const commerceSource = readFileSync("supabase/functions/api-commerce/index.ts", "utf8");
const webhookSource = readFileSync("supabase/functions/api-stripe-webhook/index.ts", "utf8");
const recoverySource = readFileSync("supabase/functions/api-commerce-recovery/index.ts", "utf8");
const canonicalOriginSource = readFileSync("supabase/functions/_shared/canonical_origin.ts", "utf8");
const stripeEnvironmentSource = readFileSync("supabase/functions/_shared/stripe_environment_contract.ts", "utf8");
const refundTruthMigration = readFileSync(
  "supabase/migrations/20260920120000_commerce_r2a_refund_truth_reconciliation.sql",
  "utf8",
);

describe("Commerce R2A edge contracts", () => {
  it("persists the attempt before Stripe and uses one stable provider idempotency key", () => {
    const prepare = commerceSource.indexOf("commerce_r2a_prepare_checkout");
    const create = commerceSource.indexOf("createStripeCheckoutSession(stripeKey, stripeRequest", prepare);
    expect(prepare).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(prepare);
    expect(commerceSource.slice(prepare, create)).toContain("p_provider_idempotency_key");
    expect(commerceSource.slice(prepare, create)).toContain("trackedProviderIdempotencyKey = preparedAttempt.provider_idempotency_key");
    expect(commerceSource.slice(prepare, create)).toContain("stripeRequest = preparedAttempt.provider_request");
    expect(commerceSource.slice(prepare, create)).toContain("trackedProviderSessionId = preparedAttempt.provider_session_id");
    const createCallEnd = commerceSource.indexOf("trackedProviderIdempotencyKey || undefined", create);
    expect(createCallEnd).toBeGreaterThan(create);
    expect(commerceSource.slice(create, createCallEnd + 48)).toContain("trackedProviderIdempotencyKey || undefined");
  });

  it("does not release tracked stock from a browser return or local deadline", () => {
    const cancel = commerceSource.indexOf("path === 'cancel-checkout'");
    const checkout = commerceSource.indexOf("path === 'checkout'", cancel);
    const cancelSource = commerceSource.slice(cancel, checkout);
    expect(cancelSource).toContain("expireStripeCheckoutSession");
    expect(cancelSource).toContain("retrieveStripeCheckoutSession");
    expect(cancelSource).toContain("commerce_r2a_close_unpaid_attempt");
    expect(cancelSource).toContain("recovery_pending");
  });

  it("requires paid status and validates tracked provider context before canonical finalization", () => {
    const start = webhookSource.indexOf("async function handleCommerceOrder");
    const end = webhookSource.indexOf("async function handleCommerceRefund", start);
    const handler = webhookSource.slice(start, end);
    expect(handler).toContain("session?.payment_status !== 'paid'");
    expect(handler).toContain("Commerce checkout provider context mismatch");
    expect(handler).toContain("commerce_checkout_attempt_id");
    expect(handler).toContain("finalize_commerce_payment");
  });

  it("keeps ambiguous requests held and refuses blind recreation beyond Stripe's safe key window", () => {
    expect(recoverySource).toContain("PROVIDER_IDEMPOTENCY_SAFE_RETRY_MS = 23 * 60 * 60 * 1000");
    expect(recoverySource).toContain("manual Stripe reconciliation required");
    expect(recoverySource).toContain("commerce_r2a_claim_recovery_attempts");
    expect(recoverySource).toContain("commerce_r2a_claim_recovery_refunds");
    expect(recoverySource).toContain("assertRecoveredSessionContract");
  });

  it("separates refund reconciliation from physical disposition", () => {
    expect(commerceSource).toContain("path === 'refund'");
    expect(commerceSource).toContain("path === 'physical-disposition'");
    expect(commerceSource).toContain("commerce_r2a_prepare_refund");
    expect(commerceSource).toContain("commerce_r2a_record_disposition");
    expect(webhookSource).toContain("Tracked refund arrived before local payment finalization; Stripe must retry the event");
    expect(webhookSource).toContain("metadataOrderId");
  });

  it("observes real Stripe refund failure/update events after an initial success", () => {
    expect(webhookSource).toContain("'refund.failed'");
    expect(webhookSource).toContain("'charge.refund.updated'");
    expect(webhookSource).toContain("['paid', 'attention', 'cancelled'].includes(order.status)");
    expect(webhookSource).toContain("Commerce refund provider identity mismatch");
    expect(recoverySource).toContain("result.outcome === 'pending' || result.outcome === 'succeeded'");
  });

  it("compensates succeeded-to-failed refund truth without fabricating physical truth", () => {
    const reconcileStart = refundTruthMigration.indexOf("CREATE OR REPLACE FUNCTION public.commerce_r2a_reconcile_refund");
    const reconcileEnd = refundTruthMigration.indexOf("REVOKE ALL ON FUNCTION", reconcileStart);
    const reconcile = refundTruthMigration.slice(reconcileStart, reconcileEnd);
    expect(reconcile).toContain("v_refund.status = 'succeeded' AND p_provider_status <> 'failed'");
    expect(reconcile).toContain("'commerce_refund_reversal'");
    expect(reconcile).toContain("'refund_reversed'");
    expect(reconcile).toContain("'net_refund_delta_minor', -v_refund.amount_inc_vat_minor");
    expect(reconcile).toContain("'physical_truth_changed', false");
    expect(reconcile).toContain("'commerce.refund.provider_failed'");
    expect(reconcile).not.toMatch(/UPDATE public\.inventory_(?:levels|reservations|allocations|movements)/);
    expect(reconcile).not.toMatch(/UPDATE public\.commerce_physical_dispositions/);
  });

  it("keeps succeeded refunds in a bounded recovery-monitoring window", () => {
    expect(refundTruthMigration).toContain("provider_monitor_until = COALESCE(provider_monitor_until, now() + interval '30 days')");
    expect(refundTruthMigration).toContain("status = 'succeeded'");
    expect(refundTruthMigration).toContain("provider_monitor_until > now()");
    expect(refundTruthMigration).toContain("FOR UPDATE SKIP LOCKED");
  });

  it("fails closed when stage or production return origins cross environments", () => {
    expect(canonicalOriginSource).toContain("environment === 'stage'");
    expect(canonicalOriginSource).toContain("stage requires a secure non-production PUBLIC_SITE_URL");
    expect(canonicalOriginSource).toContain("environment === 'production'");
    expect(canonicalOriginSource).toContain("production PUBLIC_SITE_URL mismatch");
  });

  it("fails closed across explicit Pickla, Supabase project, key, and webhook environments", () => {
    expect(commerceSource).toContain("requireStripeRuntimeEnvironment");
    expect(recoverySource).toContain("requireStripeRuntimeEnvironment");
    expect(webhookSource).toContain("assertStripeEventMode(stripeRuntime, event?.livemode)");
    expect(stripeEnvironmentSource).toContain("PICKLA_ENVIRONMENT");
    expect(stripeEnvironmentSource).toContain("PICKLA_PRODUCTION_PROJECT_REF");
    expect(stripeEnvironmentSource).toContain("PICKLA_STAGE_PROJECT_REF");
    expect(stripeEnvironmentSource).toContain("stage requires Stripe test mode");
    expect(stripeEnvironmentSource).toContain("production requires Stripe live mode");
  });
});
