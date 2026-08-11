import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const policy = readFileSync("supabase/functions/_shared/booking_participant_entitlement.ts", "utf8");
const bookingsApi = readFileSync("supabase/functions/api-bookings/index.ts", "utf8");
const checkinsApi = readFileSync("supabase/functions/api-checkins/index.ts", "utf8");
const desk = readFileSync("src/components/desk/shell/DeskToday.tsx", "utf8");

describe("unpaid booking-participant entitlement re-resolution", () => {
  it("limits mutation to identified, unsettled pending participation", () => {
    expect(policy).toContain("status === 'pending'");
    expect(policy).toContain("Number(participant?.price_minor || 0) > 0");
    expect(policy).toContain("!participant?.booking_receipt_id");
    expect(policy).toContain("!participant?.payment_stripe_session_id");
    expect(policy).toContain("Boolean(participant?.customer_id || participant?.user_id)");
  });

  it("reuses one server-authoritative resolver at checkout, Desk projection and check-in", () => {
    expect(bookingsApi).toContain("channel: 'checkout'");
    expect(bookingsApi).toContain("channel: 'desk'");
    expect(checkinsApi).toContain("channel: 'checkin'");
    expect(bookingsApi.match(/persistCurrentBookingParticipantCoverage/g)?.length).toBeGreaterThanOrEqual(1);
    expect(checkinsApi).toContain("persistCurrentBookingParticipantCoverage");
  });

  it("keeps the inverse and settled-payment doctrine unchanged", () => {
    const eligibilityGuard = policy.slice(
      policy.indexOf("export function bookingParticipantCanReResolve"),
      policy.indexOf("async function loadBookingRows"),
    );
    expect(eligibilityGuard).toContain("status === 'pending'");
    expect(eligibilityGuard).not.toContain("status === 'free'");
    expect(bookingsApi).toContain("participant.payment_status === 'paid' || participant.payment_status === 'free'");
    expect(bookingsApi).toContain("participant.payment_status === 'paid'");
    expect(bookingsApi).toContain("participant.payment_status === 'free'");
  });

  it("preserves the original price snapshot and writes entitlement provenance", () => {
    expect(policy).toContain("original_price_minor: Number(participant.price_minor || 0)");
    expect(policy).toContain("original_payment_status: participant.payment_status");
    expect(policy).toContain("original_pricing_reason: originalMetadata.pricing_reason || null");
    expect(policy).toContain("pricing_reason: 'current_entitlement_reresolution'");
    expect(policy).toContain("p_price_minor: 0");
    expect(policy).toContain("p_payment_status: 'free'");
    expect(policy).toContain("expireSupersededStripeCheckout");
    expect(policy).toContain("booking_participant_payment_already_settled");
    expect(policy).toContain("superseded_stripe_session_id");
  });

  it("keeps customer, venue and scope decisions on the server", () => {
    expect(policy).toContain("booking.venue_id !== participant.venue_id");
    expect(policy).toContain("p_customer_id: participant.customer_id || null");
    expect(policy).toContain("p_user_id: participant.user_id || null");
    expect(policy).toContain("p_product_key: 'booking_participant_share'");
    expect(bookingsApi).toContain("participant.user_id !== actorUserId");
    expect(bookingsApi).toContain("Booking participant belongs to another customer");
    expect(checkinsApi).toContain("Biljetten tillhör inte den inloggade kunden");
    expect(checkinsApi).toContain("Biljetten tillhör en annan kund");
  });

  it("removes the stale Desk collection action when current coverage applies", () => {
    expect(desk).toContain("effective_access_reason");
    expect(desk).toContain("`Ingår · ${accessReason}`");
    expect(desk).not.toContain("Betald på plats");
    expect(desk).toContain("Ingen plats ännu · betala");
  });
});
