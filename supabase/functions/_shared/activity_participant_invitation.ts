export type ActivityParticipantOperationalState =
  | 'confirmed_paid'
  | 'confirmed_included'
  | 'payment_pending'
  | 'payment_expired'
  | 'action_required'
  | 'cancelled';

export type ActivityParticipantInvitationFacts = {
  status?: string | null;
  registrationStatus?: string | null;
  registrationPriceSek?: number | null;
  canonicalPriceMinor?: number | null;
  holdStatus?: string | null;
  holdExpiresAt?: string | null;
  now?: string | number | Date;
};

function hasCommittedRegistration(status?: string | null) {
  return ['confirmed', 'checked_in', 'no_show'].includes(String(status || '').toLowerCase());
}

function activeHold(status?: string | null, expiresAt?: string | null, now: string | number | Date = new Date()) {
  const expires = expiresAt ? new Date(expiresAt).getTime() : Number.NaN;
  return status === 'active' && Number.isFinite(expires) && expires > new Date(now).getTime();
}

export function activityParticipantInvitationState(
  facts: ActivityParticipantInvitationFacts,
): {
  operational_state: ActivityParticipantOperationalState;
  headline: 'HAR PLATS' | 'BETALNING PÅGÅR' | 'HAR INTE PLATS ÄNNU' | 'KRÄVER ÅTGÄRD' | 'AVBOKAD';
  has_place: boolean;
  reserved: boolean;
  can_resend: boolean;
  can_retry: boolean;
} {
  if (['cancelled', 'refunded'].includes(String(facts.registrationStatus || '').toLowerCase())) {
    return { operational_state: 'cancelled', headline: 'AVBOKAD', has_place: false, reserved: false, can_resend: false, can_retry: false };
  }
  if (hasCommittedRegistration(facts.registrationStatus)) {
    if (Number(facts.registrationPriceSek ?? facts.canonicalPriceMinor ?? 0) <= 0) {
      return { operational_state: 'confirmed_included', headline: 'HAR PLATS', has_place: true, reserved: false, can_resend: false, can_retry: false };
    }
    return { operational_state: 'confirmed_paid', headline: 'HAR PLATS', has_place: true, reserved: false, can_resend: false, can_retry: false };
  }
  if (facts.status === 'cancelled') {
    return { operational_state: 'cancelled', headline: 'AVBOKAD', has_place: false, reserved: false, can_resend: false, can_retry: false };
  }
  const reserved = activeHold(facts.holdStatus, facts.holdExpiresAt, facts.now);
  if (facts.status === 'payment_pending' && reserved) {
    return { operational_state: 'payment_pending', headline: 'BETALNING PÅGÅR', has_place: false, reserved: true, can_resend: true, can_retry: false };
  }
  if (facts.status === 'action_required' && reserved) {
    return { operational_state: 'action_required', headline: 'KRÄVER ÅTGÄRD', has_place: false, reserved: true, can_resend: true, can_retry: false };
  }
  if (['payment_pending', 'payment_expired'].includes(String(facts.status || '')) || facts.holdStatus === 'expired') {
    return { operational_state: 'payment_expired', headline: 'HAR INTE PLATS ÄNNU', has_place: false, reserved: false, can_resend: false, can_retry: true };
  }
  return { operational_state: 'action_required', headline: 'KRÄVER ÅTGÄRD', has_place: false, reserved: false, can_resend: false, can_retry: true };
}

export function activityParticipantInviteIdempotencyKey(invitationId: string, attempt: number) {
  return `activity_participant_invitation:${invitationId}:attempt:${Math.max(1, Math.floor(attempt))}`;
}

export function activityParticipantInviteEmailIdempotencyKey(invitationId: string, sendCount: number) {
  return `activity-invite-${invitationId}-${Math.max(1, Math.floor(sendCount))}`;
}
