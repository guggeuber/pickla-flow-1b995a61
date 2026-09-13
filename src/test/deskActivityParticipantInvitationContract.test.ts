import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const bookings = read("../../supabase/functions/api-bookings/index.ts");
const webhook = read("../../supabase/functions/api-stripe-webhook/index.ts");
const expiry = read("../../supabase/functions/_shared/commerce_checkout_expiry.ts");
const migration = read("../../supabase/migrations/20260913120000_activity_participant_invitations.sql");
const desk = read("../components/desk/shell/DeskToday.tsx");
const deskOps = read("../lib/deskOps.ts");
const invitePage = read("../pages/ActivityParticipantInvitePage.tsx");
const participantState = read("../../supabase/functions/_shared/activity_participant_invitation.ts");

describe("Desk activity participant invitation contract", () => {
  it("targets one effective occurrence and authorizes venue staff before protected reads or writes", () => {
    expect(bookings).toContain("path === 'activity-participants'");
    expect(bookings).toContain("path === 'activity-participant-invite'");
    expect(bookings).toContain("if (!await canOperateVenue(admin, userId, venueId)) return errorResponse('Forbidden', 403)");
    expect(bookings).toContain("loadEffectiveActivityOccurrence(admin, venueId, activitySessionId, sessionDate)");
    expect(bookings).toContain("effectiveActivityOccurrenceForDate(session, sessionDate, versions)");
    expect(migration).toContain("UNIQUE (activity_session_id, session_date, user_id)");
    expect(migration).toContain("REVOKE ALL ON public.activity_participant_invitations FROM anon, authenticated");
    expect(migration).not.toContain("GRANT SELECT ON public.activity_participant_invitations TO authenticated");
  });

  it("requires a canonical linked participant identity and resolves that person's price", () => {
    expect(bookings).toContain("Aktivitetsinbjudan kräver en kund med kopplat Pickla-konto");
    expect(bookings).toContain("userId: customer.user_id, customerId: customer.customer_id");
    expect(bookings).toContain("resolveActivityPricingDecision");
    expect(bookings).toContain("salesChannel: 'desk'");
    expect(desk).toContain("Namn, e-post eller telefon");
    expect(desk).toContain("Oidentifierade gäster stöds inte säkert i detta flöde");
  });

  it("uses canonical capacity for free commitment, paid reservation, final-seat serialization and retry", () => {
    expect(bookings).toContain("commitActivityRegistrationCapacity(admin");
    expect(bookings).toContain("includedActivityRegistrationSource(quotedPricing, typedInvitation.id)");
    expect(bookings).toContain("return { sourceType: 'membership', sourceId: pricing.membershipId }");
    expect(bookings).toContain("return { sourceType: 'access_entitlement', sourceId: pricing.sourceId }");
    expect(bookings).toContain("acquire_first_visit_activity_pricing_hold");
    expect(bookings).toContain("attachCapacityHoldStripeSession");
    expect(bookings).toContain("activityParticipantInviteIdempotencyKey");
    expect(bookings).toContain("En annan operatör hanterar redan spelaren");
    expect(bookings).toContain("ACTIVITY_PARTICIPANT_PREPARING_STALE_SECONDS");
    expect(bookings).toContain("Platsen hann tas — aktiviteten är full.");
    expect(bookings).toContain("retireUnpaidStripeCheckout");
    expect(bookings).toContain("stripeCheckoutLifecycleState");
    expect(bookings).toContain("retired.state === 'paid' || retired.state === 'unknown'");
    expect(bookings).toContain("Stripe Checkout identity mismatch");
    expect(bookings).toContain("stripe_session_unknown: checkoutCreationUncertain");
    expect(bookings).toContain("Tidigare betalningsförsök är tvetydigt och kräver manuell kontroll");
    expect(webhook).toContain("status: 'action_required'");
    expect(migration).toContain("REFERENCES public.capacity_holds(id)");
    expect(migration).toContain("CHECK (status IN ('preparing', 'payment_pending', 'confirmed_free', 'confirmed_paid', 'payment_expired', 'action_required', 'cancelled'))");
  });

  it("creates a stable Pickla payment entry while Stripe and the webhook remain authoritative", () => {
    expect(bookings).toContain("const stablePath = `/activity/invite/");
    expect(bookings).toContain("success_url: `${canonicalPublicOrigin(req)}${stablePath}?session={CHECKOUT_SESSION_ID}`");
    expect(bookings).toContain("activity_participant_invitation_id: typedInvitation.id");
    expect(invitePage).toContain("Betala och säkra platsen");
    expect(invitePage).toContain("auth: \"omit\"");
    expect(webhook).toContain("markInvitationConfirmed");
    expect(webhook).toContain("status: 'confirmed_paid'");
    expect(webhook).toContain("createPurchaseReceipt");
    expect(webhook).toContain("createLedgerEntryFromReceipt");
  });

  it("expires abandoned Checkout capacity and never lets email delivery confirm a place", () => {
    expect(expiry).toContain("activity_participant_invitation_id");
    expect(expiry).toContain("status: 'payment_expired'");
    expect(expiry).toContain("p_reason: 'stripe_checkout_expired'");
    expect(bookings).toContain("must prove expired_unpaid before the hold is released");
    expect(bookings).toContain("status: delivered.ok ? 'payment_pending' : 'action_required'");
    expect(bookings).not.toContain("status: delivered.ok ? 'confirmed_paid'");
  });

  it("resends the same stable link without creating another Checkout attempt", () => {
    const resendStart = bookings.indexOf("if (action === 'resend')");
    const addStart = bookings.indexOf("if (action !== 'add')", resendStart);
    const resendBranch = bookings.slice(resendStart, addStart);
    expect(resendBranch).toContain("deliverActivityInvitationEmail");
    expect(resendBranch).not.toContain("createStripeCheckoutSession");
    expect(bookings).toContain("activityParticipantInviteEmailIdempotencyKey");
  });

  it("renders operational truth in Desk and refreshes from protected detail", () => {
    expect(deskOps).toContain('"activity-participants"');
    expect(desk).toContain("participant.headline");
    expect(participantState).toContain("HAR PLATS");
    expect(participantState).toContain("BETALNING PÅGÅR");
    expect(participantState).toContain("HAR INTE PLATS ÄNNU");
    expect(participantState).toContain("KRÄVER ÅTGÄRD");
    expect(participantState).toContain("AVBOKAD");
    expect(desk).toContain("Betalningslänk skickad");
    expect(desk).toContain("Skicka länken igen");
    expect(desk).toContain("Försök igen");
    expect(desk).not.toContain("CLAIMAD");
  });
});
