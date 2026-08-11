import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bookingParticipationFunding } from "../../supabase/functions/_shared/booking_participant_funding";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("booking participation funding doctrine", () => {
  it("covers joiners from a fully prepaid Stripe court", () => {
    expect(bookingParticipationFunding([{
      status: "confirmed",
      stripe_session_id: "cs_paid",
      total_price: 350,
      included_court_hours: 0,
    }])).toMatchObject({
      mode: "resource_funded",
      sourceType: "stripe_payment",
      sourceId: "cs_paid",
      funder: "self_prepaid",
    });
  });

  it("keeps Founder/partially included courts on individual participant economics", () => {
    expect(bookingParticipationFunding([{
      status: "confirmed",
      stripe_session_id: "cs_partial",
      included_court_hours: 1,
      membership_id: "membership-founder",
    }])).toMatchObject({
      mode: "individual_participation",
      sourceType: "membership_entitlement",
      funder: "subscription",
    });
  });

  it("treats corporate-funded courts as already funded", () => {
    expect(bookingParticipationFunding([{
      status: "confirmed",
      corporate_package_id: "corp-1",
      total_price: 0,
    }])).toMatchObject({
      mode: "resource_funded",
      sourceType: "corporate_package",
      funder: "employer",
    });
  });

  it("refuses to guess mixed or unsupported legacy funding", () => {
    expect(bookingParticipationFunding([
      { status: "confirmed", stripe_session_id: "cs_paid", total_price: 350 },
      { status: "confirmed", total_price: 350 },
    ])).toMatchObject({ mode: "unresolved", reason: "mixed_group_funding" });
  });
});

describe("pay first contracts", () => {
  const bookings = read("../../supabase/functions/api-bookings/index.ts");
  const webhook = read("../../supabase/functions/api-stripe-webhook/index.ts");
  const corporate = read("../../supabase/functions/api-corporate/index.ts");
  const checkins = read("../../supabase/functions/api-checkins/index.ts");
  const entitlement = read("../../supabase/functions/_shared/booking_participant_entitlement.ts");
  const desk = read("../components/desk/shell/DeskToday.tsx");
  const deskOps = read("../lib/deskOps.ts");
  const claimPage = read("../pages/ClaimBookingParticipantPage.tsx");
  const migration = read("../../supabase/migrations/20260811120000_booking_participation_pay_first.sql");

  it("acquires the canonical hold at claim and creates no ticket before commitment", () => {
    expect(bookings).toContain("acquireBookingParticipantPaymentHold");
    expect(bookings).toContain("claim_status: 'payment_hold'");
    expect(bookings).toContain("if (!participantIsCommitted(participant))");
    expect(bookings).toContain("booking_participant_not_financially_committed");
    expect(claimPage).toContain('idempotency_key: claim.capacity_hold_id');
    expect(claimPage).toContain('capacity_hold_id: claim.capacity_hold_id');
    expect(bookings).toContain("participant?.entitlement_reresolution_pending === true");
  });

  it("blocks stale pending rows when base funding cannot be proven", () => {
    expect(bookings).toContain("currentCoverage.status === 'base_funding_unresolved'");
    expect(bookings).toContain("participant.payment_status !== 'pending'");
  });

  it("releases expired participant checkout holds", () => {
    expect(webhook).toContain("const directHoldId = String(session?.metadata?.capacity_hold_id");
    expect(webhook).toContain("p_reason: 'stripe_checkout_expired'");
  });

  it("removes pay-at-desk producers and keeps only a stale-client rejection", () => {
    expect(desk).not.toContain("Betald på plats");
    expect(deskOps).not.toContain("markBookingParticipantPaid");
    expect(bookings).not.toContain("p_payment_method: 'desk'");
    expect(bookings).not.toContain("payment_provider: 'desk'");
    expect(bookings).toContain("Betalning på plats stöds inte för deltagarplatser");
  });

  it("keeps settled commitments immutable and re-resolves only unpaid legacy rows", () => {
    expect(entitlement).toContain("return status === 'pending'");
    expect(entitlement).toContain("!participant?.booking_receipt_id");
    expect(entitlement).toContain("!participant?.payment_stripe_session_id");
  });

  it("allows every canonical participation entitlement through the shared resolver", () => {
    expect(entitlement).toContain("'booking_access'");
    expect(entitlement).toContain("'membership_access'");
    expect(entitlement).toContain("'day_access'");
    expect(entitlement).toContain("'punch_card'");
    expect(entitlement).toContain("'partner_access'");
    expect(checkins).toContain("bookingParticipantConsumptionEntitlement");
    expect(checkins).toContain("product_key: metadata.product_key || 'booking_participant_share'");
    expect(checkins).toContain("markBookingParticipantCheckedIn");
  });

  it("adds explicit base-resource funding provenance without rewriting historical participant payments", () => {
    expect(migration).toContain("participation_funding_mode");
    expect(migration).toContain("'individual_participation', 'resource_funded', 'unresolved'");
    expect(migration).toContain("participation_funder");
    expect(migration).not.toContain("UPDATE public.booking_participants");
    expect(corporate).toContain("participation_funding_source_type: 'corporate_order'");
    expect(corporate).toContain("participation_funder: 'employer'");
  });
});
