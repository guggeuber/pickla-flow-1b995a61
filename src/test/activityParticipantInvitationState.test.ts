import { describe, expect, it } from "vitest";
import {
  activityParticipantInvitationState,
  activityParticipantInviteEmailIdempotencyKey,
  activityParticipantInviteIdempotencyKey,
} from "../../supabase/functions/_shared/activity_participant_invitation";

const now = "2026-09-13T10:00:00.000Z";

describe("activity participant invitation truth", () => {
  it("distinguishes paid and participant-owned included commitments", () => {
    expect(activityParticipantInvitationState({
      status: "confirmed_paid",
      registrationStatus: "confirmed",
      registrationPriceSek: 198,
      now,
    })).toMatchObject({ operational_state: "confirmed_paid", headline: "HAR PLATS", has_place: true, reserved: false });

    expect(activityParticipantInvitationState({
      status: "confirmed_free",
      registrationStatus: "confirmed",
      registrationPriceSek: 0,
      now,
    })).toMatchObject({ operational_state: "confirmed_included", headline: "HAR PLATS", has_place: true, reserved: false });
  });

  it("never treats an active payment hold as a confirmed place", () => {
    expect(activityParticipantInvitationState({
      status: "payment_pending",
      holdStatus: "active",
      holdExpiresAt: "2026-09-13T10:10:00.000Z",
      now,
    })).toEqual({
      operational_state: "payment_pending",
      headline: "BETALNING PÅGÅR",
      has_place: false,
      reserved: true,
      can_resend: true,
      can_retry: false,
    });
  });

  it("never treats orchestration status alone as canonical confirmation", () => {
    for (const status of ["confirmed_free", "confirmed_paid"]) {
      expect(activityParticipantInvitationState({ status, now })).toMatchObject({
        operational_state: "action_required",
        headline: "KRÄVER ÅTGÄRD",
        has_place: false,
        reserved: false,
      });
    }
  });

  it("excludes expired attempts from operational capacity and enables authoritative retry", () => {
    for (const status of ["payment_pending", "payment_expired"]) {
      expect(activityParticipantInvitationState({
        status,
        holdStatus: "active",
        holdExpiresAt: "2026-09-13T09:59:59.000Z",
        now,
      })).toMatchObject({
        operational_state: "payment_expired",
        headline: "HAR INTE PLATS ÄNNU",
        has_place: false,
        reserved: false,
        can_retry: true,
      });
    }
  });

  it("keeps email/Stripe failures and cancellations explicit", () => {
    expect(activityParticipantInvitationState({ status: "action_required", now })).toMatchObject({
      operational_state: "action_required",
      headline: "KRÄVER ÅTGÄRD",
      has_place: false,
      can_retry: true,
    });
    expect(activityParticipantInvitationState({ status: "cancelled", now })).toMatchObject({
      operational_state: "cancelled",
      headline: "AVBOKAD",
      has_place: false,
      reserved: false,
    });
    expect(activityParticipantInvitationState({
      status: "confirmed_paid",
      registrationStatus: "cancelled",
      registrationPriceSek: 198,
      now,
    })).toMatchObject({ operational_state: "cancelled", headline: "AVBOKAD", has_place: false });
  });

  it("uses one stable capacity/Checkout key per attempt and one mail key per explicit send", () => {
    expect(activityParticipantInviteIdempotencyKey("invite-1", 2)).toBe("activity_participant_invitation:invite-1:attempt:2");
    expect(activityParticipantInviteIdempotencyKey("invite-1", 2)).toBe(activityParticipantInviteIdempotencyKey("invite-1", 2));
    expect(activityParticipantInviteEmailIdempotencyKey("invite-1", 1)).toBe("activity-invite-invite-1-1");
    expect(activityParticipantInviteEmailIdempotencyKey("invite-1", 2)).toBe("activity-invite-invite-1-2");
  });
});
