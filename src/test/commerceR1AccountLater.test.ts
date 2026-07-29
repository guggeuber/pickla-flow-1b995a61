import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const commerceApi = readFileSync("supabase/functions/api-commerce/index.ts", "utf8");
const webhook = readFileSync("supabase/functions/api-stripe-webhook/index.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260728200000_commerce_r1b_account_later.sql", "utf8");
const orderPage = readFileSync("src/pages/CommerceOrderPage.tsx", "utf8");
const cartPage = readFileSync("src/pages/CommerceCartPage.tsx", "utf8");
const programPage = readFileSync("src/pages/ProgramSessionPage.tsx", "utf8");

describe("Commerce R1B account-later contract", () => {
  it("keeps guest purchase primary and member login secondary", () => {
    expect(programPage).toContain('`Fortsätt · ${formatCommerceMoney(commerceTotalMinor)}`');
    expect(programPage).toContain("Medlem? Logga in för ditt pris");
    expect(programPage).toContain("logged_out_cta_clicked");
    expect(programPage).not.toContain("Betalning sker via Stripe innan platsen bekräftas.");
    expect(cartPage).toContain('`Betala ${formatCommerceMoney(total)}`');
    expect(cartPage).toContain("Platsen bekräftas direkt efter betalning.");
    expect(orderPage).toContain('"Platsen är din"');
  });

  it("uses possession tokens without exposing guest PII or internal snapshots", () => {
    expect(commerceApi).toContain("const CART_TOKEN_BYTES = 32");
    const projection = commerceApi.slice(commerceApi.indexOf("function projectOrderLine"), commerceApi.indexOf("async function venueContext"));
    expect(projection).not.toContain("guest_email:");
    expect(projection).not.toContain("guest_name:");
    expect(projection).not.toContain("beneficiary_user_id:");
    expect(projection).toContain("contact_email_present");
  });

  it("keeps claim, account activation, ticket and chat gates explicit", () => {
    expect(commerceApi).toContain("path === 'claim'");
    expect(commerceApi).toContain("path === 'claim-account'");
    expect(commerceApi).toContain("path === 'guest-checkin'");
    expect(commerceApi).toContain("authUser?.email_confirmed_at");
    expect(orderPage).toContain("order.account_claimed && activity?.venue_slug");
  });

  it("makes participant, ticket and claim ownership service-only and idempotent", () => {
    expect(migration).toContain("idx_session_registrations_commerce_source_once");
    expect(migration).toContain("idx_session_registrations_guest_customer_once");
    expect(migration).toContain("commerce_order_already_claimed");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.confirm_commerce_guest_identity");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.claim_commerce_activity_order");
  });

  it("handles abandon, duplicate completion, cancellation and refund through canonical records", () => {
    expect(webhook).toContain("checkout.session.expired");
    expect(webhook).toContain("charge.refunded");
    expect(webhook).toContain("source_type: 'commerce_refund'");
    expect(webhook).toContain("status: 'cancelled'");
    expect(commerceApi).toContain("Idempotency-Key");
    expect(commerceApi).toContain("path === 'cancel'");
  });

  it("records only the approved privacy-safe funnel", () => {
    for (const eventName of [
      "activity_sheet_opened",
      "logged_out_cta_clicked",
      "checkout_started",
      "guest_purchase_succeeded",
      "checkout_abandoned",
      "claim_completed",
      "account_activated",
    ]) expect(migration).toContain(`'${eventName}'`);
    expect(commerceApi).toContain("within_7d");
    expect(commerceApi).toContain("within_30d");
    expect(commerceApi).toContain("duration_ms");
    expect(migration).toContain("Never store names, email, phone, raw tokens or provider metadata");
  });
});
