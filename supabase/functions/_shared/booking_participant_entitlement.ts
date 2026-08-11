import { DateTime } from 'https://esm.sh/luxon@3.5.0';
import { bookingParticipationFunding } from './booking_participant_funding.ts';

const BOOKING_PARTICIPANT_MAX_PER_COURT = 4;
const OPEN_BOOKING_SOURCE = 'open_booking_slot';
const RESOLVABLE_ENTITLEMENT_TYPES = [
  'booking_access',
  'membership_access',
  'day_access',
  'punch_card',
  'partner_access',
];

const ENTITLEMENT_PRIORITY: Record<string, number> = {
  booking_access: 10,
  membership_access: 20,
  day_access: 30,
  punch_card: 40,
  partner_access: 50,
};

export type BookingParticipantCoverage = {
  covered: boolean;
  status: string;
  entitlementId: string | null;
  entitlementType: string | null;
  accessReason: string | null;
  fundingType: string | null;
  funder: string | null;
  sourceType: string | null;
  sourceId: string | null;
  membershipId: string | null;
  consumptionRequired: boolean;
  consumptionTrigger: string | null;
  noShowPolicy: string | null;
  resolutionPriority: number;
};

type ResolutionOptions = {
  bookingRows?: any[];
  channel?: 'checkout' | 'desk' | 'checkin' | 'ticket' | 'my_page';
};

type ParticipantIdentity = {
  venueId: string;
  customerId?: string | null;
  userId?: string | null;
};

function metadataOf(row: any) {
  return row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
}

function representativeBooking(participant: any, bookingRows?: any[]) {
  if (bookingRows?.length) return bookingRows[0];
  return Array.isArray(participant?.bookings) ? participant.bookings[0] : participant?.bookings;
}

function bookingServiceDate(booking: any) {
  if (!booking?.start_time) return null;
  const start = DateTime.fromISO(booking.start_time, { zone: 'utc' }).setZone('Europe/Stockholm');
  return start.isValid ? start.toISODate() : null;
}

function founderBooking(rows: any[]) {
  return rows.some((row: any) =>
    Number(row?.included_court_hours || 0) > 0 ||
    row?.membership_usage_entitlement_type === 'court_hours_per_week'
  );
}

function openBookingCapacity(rows: any[]) {
  const representative = rows.find((row: any) => row?.open_for_more_status === 'open') || rows[0] || {};
  if (representative.open_for_more_status !== 'open') return 0;
  const publicCapacity = Number(representative.open_for_more_public_capacity || 0);
  if (publicCapacity > 0) return publicCapacity;
  const openedPlaces = Number(representative.open_for_more_opened_places || 0);
  const committedAtPublication = Number(representative.open_for_more_committed_at_publication || 0);
  if (openedPlaces > 0) return committedAtPublication + openedPlaces;
  return Math.max(Number(representative.open_for_more_total_players || 0), 0);
}

function participantUsesOpenCapacity(participant: any, rows: any[]) {
  const metadata = metadataOf(participant);
  return (metadata.source === OPEN_BOOKING_SOURCE || metadata.open_booking_public_claim === true) &&
    rows.some((row: any) => row?.open_for_more_status === 'open');
}

function participantCapacity(participant: any, rows: any[]) {
  if (participantUsesOpenCapacity(participant, rows)) return openBookingCapacity(rows);
  return Math.max(rows.length, 1) * BOOKING_PARTICIPANT_MAX_PER_COURT;
}

function noCoverage(status: string): BookingParticipantCoverage {
  return {
    covered: false,
    status,
    entitlementId: null,
    entitlementType: null,
    accessReason: null,
    fundingType: null,
    funder: null,
    sourceType: null,
    sourceId: null,
    membershipId: null,
    consumptionRequired: false,
    consumptionTrigger: null,
    noShowPolicy: null,
    resolutionPriority: Number.POSITIVE_INFINITY,
  };
}

async function expireSupersededStripeCheckout(sessionId: string) {
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) throw new Error('stripe_not_configured_for_entitlement_reresolution');
  const stripeApiBase = (Deno.env.get('STRIPE_API_BASE') || 'https://api.stripe.com/v1').replace(/\/$/, '');
  const headers = {
    Authorization: `Bearer ${stripeKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Stripe-Version': '2023-10-16',
  };
  const expireResponse = await fetch(`${stripeApiBase}/checkout/sessions/${encodeURIComponent(sessionId)}/expire`, {
    method: 'POST',
    headers,
  });
  if (expireResponse.ok) return;

  const statusResponse = await fetch(`${stripeApiBase}/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${stripeKey}`, 'Stripe-Version': '2023-10-16' },
  });
  const session = await statusResponse.json().catch(() => ({}));
  if (statusResponse.ok && session?.status === 'expired') return;
  if (statusResponse.ok && (session?.status === 'complete' || session?.payment_status === 'paid')) {
    throw new Error('booking_participant_payment_already_settled');
  }
  throw new Error('booking_participant_checkout_expiry_failed');
}

export function bookingParticipantCanReResolve(participant: any) {
  const status = String(participant?.payment_status || '').toLowerCase();
  return status === 'pending' &&
    Number(participant?.price_minor || 0) > 0 &&
    !participant?.booking_receipt_id &&
    !participant?.payment_stripe_session_id &&
    Boolean(participant?.customer_id || participant?.user_id);
}

async function loadBookingRows(admin: any, participant: any) {
  const booking = representativeBooking(participant);
  if (!booking?.id || booking.venue_id !== participant.venue_id) return [];

  let query = admin
    .from('bookings')
    .select('id, booking_ref, venue_id, venue_court_id, user_id, customer_id, start_time, end_time, status, notes, access_code, stripe_session_id, corporate_package_id, membership_id, included_court_hours, membership_usage_entitlement_type, participation_funding_mode, participation_funding_source_type, participation_funding_source_id, participation_funder, open_for_more_status, open_for_more_total_players, open_for_more_opened_places, open_for_more_public_capacity, open_for_more_committed_at_publication, open_for_more_published_at, venue_courts(sport_type)')
    .eq('venue_id', participant.venue_id)
    .neq('status', 'cancelled');

  if (booking.stripe_session_id) {
    query = query.eq('stripe_session_id', booking.stripe_session_id);
  } else if (booking.access_code) {
    query = query.eq('access_code', booking.access_code).eq('start_time', booking.start_time).eq('end_time', booking.end_time);
  } else {
    query = query.eq('start_time', booking.start_time).eq('end_time', booking.end_time).eq('notes', booking.notes);
  }

  const { data, error } = await query.order('start_time', { ascending: true });
  if (error) throw new Error(error.message);
  return data?.length ? data : [booking];
}

export async function resolveBookingParticipantCoverageForIdentity(
  admin: any,
  identity: ParticipantIdentity,
  bookingRows: any[],
  options: Omit<ResolutionOptions, 'bookingRows'> = {},
): Promise<BookingParticipantCoverage> {
  const rows = bookingRows || [];
  const booking = rows[0];
  if (!booking || booking.venue_id !== identity.venueId) return noCoverage('booking_wrong_venue');
  const serviceDate = bookingServiceDate(booking);
  if (!serviceDate) return noCoverage('booking_date_missing');

  const baseFunding = bookingParticipationFunding(rows);
  if (baseFunding.mode === 'resource_funded') {
    return {
      covered: true,
      status: 'covered',
      entitlementId: null,
      entitlementType: 'booking_access',
      accessReason: 'Ingår via banbokningen',
      fundingType: 'base_booking_funded',
      funder: baseFunding.funder,
      sourceType: baseFunding.sourceType || 'booking',
      sourceId: baseFunding.sourceId || booking.id || null,
      membershipId: null,
      consumptionRequired: false,
      consumptionTrigger: null,
      noShowPolicy: null,
      resolutionPriority: 0,
    };
  }

  const candidates: BookingParticipantCoverage[] = [];
  if (founderBooking(rows) && identity.userId) {
    const { data: memberships, error: membershipError } = await admin
      .from('memberships')
      .select('id, starts_at, expires_at, membership_tiers(name)')
      .eq('venue_id', identity.venueId)
      .eq('user_id', identity.userId)
      .eq('status', 'active')
      .lte('starts_at', serviceDate)
      .or(`expires_at.is.null,expires_at.gte.${serviceDate}`)
      .order('created_at', { ascending: false })
      .limit(10);
    if (membershipError) throw new Error(membershipError.message);
    const founder = (memberships || []).find((membership: any) => {
      const tier = Array.isArray(membership.membership_tiers)
        ? membership.membership_tiers[0]
        : membership.membership_tiers;
      return /founder/i.test(String(tier?.name || ''));
    });
    if (founder?.id) {
      candidates.push({
        covered: true,
        status: 'covered',
        entitlementId: null,
        entitlementType: 'membership_access',
        accessReason: 'Founder',
        fundingType: null,
        funder: null,
        sourceType: 'membership',
        sourceId: founder.id,
        membershipId: founder.id,
        consumptionRequired: false,
        consumptionTrigger: null,
        noShowPolicy: null,
        resolutionPriority: ENTITLEMENT_PRIORITY.membership_access,
      });
    }
  }

  if (identity.customerId || identity.userId) {
    const { data: canonical, error: canonicalError } = await admin.rpc('resolve_access_entitlement', {
      p_venue_id: identity.venueId,
      p_customer_id: identity.customerId || null,
      p_user_id: identity.userId || null,
      p_activity_session_id: null,
      p_service_date: serviceDate,
      p_at: booking.start_time,
      p_product_key: 'booking_participant_share',
      p_access_context: {
        entitlement_types: RESOLVABLE_ENTITLEMENT_TYPES,
        channel: options.channel || 'checkout',
      },
    });
    if (canonicalError) throw new Error(canonicalError.message);
    const entitlementType = String(canonical?.entitlement_type || '');
    if (canonical?.covered === true && RESOLVABLE_ENTITLEMENT_TYPES.includes(entitlementType)) {
      candidates.push({
        covered: true,
        status: String(canonical.status || 'covered'),
        entitlementId: String(canonical.entitlement_id || '') || null,
        entitlementType,
        accessReason: String(canonical.access_reason || '') || null,
        fundingType: String(canonical.funding_type || '') || null,
        funder: String(canonical.funder || '') || null,
        sourceType: String(canonical.source_type || '') || null,
        sourceId: String(canonical.entitlement_id || '') || null,
        membershipId: null,
        consumptionRequired: Boolean(canonical.consumption_required),
        consumptionTrigger: String(canonical.consumption_trigger || '') || null,
        noShowPolicy: String(canonical.no_show_policy || '') || null,
        resolutionPriority: ENTITLEMENT_PRIORITY[entitlementType] || 60,
      });
    }
  }

  candidates.sort((left, right) => left.resolutionPriority - right.resolutionPriority);
  if (candidates[0]) return candidates[0];
  return noCoverage(baseFunding.mode === 'unresolved' ? 'base_funding_unresolved' : 'not_covered');
}

export async function resolveCurrentBookingParticipantCoverage(
  admin: any,
  participant: any,
  options: ResolutionOptions = {},
): Promise<BookingParticipantCoverage> {
  if (!bookingParticipantCanReResolve(participant)) return noCoverage('not_unpaid');

  const rows = options.bookingRows?.length ? options.bookingRows : await loadBookingRows(admin, participant);
  const booking = representativeBooking(participant, rows);
  if (!booking || booking.venue_id !== participant.venue_id) return noCoverage('booking_wrong_venue');
  return resolveBookingParticipantCoverageForIdentity(admin, {
    venueId: participant.venue_id,
    customerId: participant.customer_id || null,
    userId: participant.user_id || null,
  }, rows, { channel: options.channel });
}

export function projectBookingParticipantCoverage(participant: any, coverage: BookingParticipantCoverage) {
  if (!coverage.covered) return participant;
  return {
    ...participant,
    price_minor: 0,
    amount_sek: 0,
    payment_status: 'free',
    access_reason: coverage.accessReason,
    entitlement_type: coverage.entitlementType,
    entitlement_id: coverage.entitlementId,
    entitlement_reresolution_pending: true,
    metadata: {
      ...metadataOf(participant),
      effective_access_reason: coverage.accessReason,
      effective_entitlement_type: coverage.entitlementType,
      effective_entitlement_id: coverage.entitlementId,
    },
  };
}

export async function persistCurrentBookingParticipantCoverage(
  admin: any,
  participant: any,
  coverage: BookingParticipantCoverage,
  options: ResolutionOptions = {},
) {
  if (!coverage.covered || !bookingParticipantCanReResolve(participant)) {
    return { reresolved: false, participant, coverage };
  }

  const rows = options.bookingRows?.length ? options.bookingRows : await loadBookingRows(admin, participant);
  const booking = representativeBooking(participant, rows);
  const serviceDate = bookingServiceDate(booking);
  const capacity = participantCapacity(participant, rows);
  if (!booking || !serviceDate || capacity <= 0) throw new Error('booking_participant_capacity_missing');

  const { data: latestHold, error: activeHoldError } = await admin
    .from('capacity_holds')
    .select('id, status, expires_at, stripe_session_id')
    .eq('venue_id', participant.venue_id)
    .eq('scope_type', 'booking_group')
    .eq('scope_id', participant.booking_group_key)
    .eq('session_date', serviceDate)
    .eq('source_type', 'booking_participant')
    .eq('source_id', participant.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activeHoldError) throw new Error(activeHoldError.message);
  const nowIso = new Date().toISOString();
  const activeHoldId = latestHold?.status === 'active' && String(latestHold.expires_at || '') > nowIso
    ? latestHold.id
    : null;
  if (latestHold?.stripe_session_id) {
    await expireSupersededStripeCheckout(String(latestHold.stripe_session_id));
  }

  const resolvedAt = nowIso;
  const originalMetadata = metadataOf(participant);
  const court = Array.isArray(booking.venue_courts) ? booking.venue_courts[0] : booking.venue_courts;
  const transitionMetadata = {
    pricing_label: coverage.accessReason ? `Ingår · ${coverage.accessReason}` : 'Ingår',
    pricing_reason: 'current_entitlement_reresolution',
    access_reason: coverage.accessReason,
    entitlement_type: coverage.entitlementType,
    entitlement_id: coverage.entitlementId,
    source_type: coverage.sourceType,
    source_id: coverage.sourceId,
    membership_id: coverage.membershipId,
    funding_type: coverage.fundingType,
    funder: coverage.funder,
    consumption_required: coverage.consumptionRequired,
    consumption_trigger: coverage.consumptionTrigger,
    no_show_policy: coverage.noShowPolicy,
    product_key: 'booking_participant_share',
    sport_type: court?.sport_type || 'pickleball',
    entitlement_reresolution: {
      version: 1,
      resolved_at: resolvedAt,
      channel: options.channel || 'checkout',
      original_price_minor: Number(participant.price_minor || 0),
      original_payment_status: participant.payment_status,
      original_pricing_label: originalMetadata.pricing_label || null,
      original_pricing_reason: originalMetadata.pricing_reason || null,
      entitlement_id: coverage.entitlementId,
      entitlement_type: coverage.entitlementType,
      access_reason: coverage.accessReason,
      funding_type: coverage.fundingType,
      funder: coverage.funder,
      source_type: coverage.sourceType,
      source_id: coverage.sourceId,
      superseded_stripe_session_id: latestHold?.stripe_session_id || null,
    },
  };

  const { data: committed, error: commitError } = await admin.rpc('commit_booking_participant_capacity', {
    p_venue_id: participant.venue_id,
    p_booking_id: participant.booking_id,
    p_booking_group_key: participant.booking_group_key,
    p_session_date: serviceDate,
    p_capacity: capacity,
    p_invite_id: participant.invite_id || null,
    p_customer_id: participant.customer_id || null,
    p_user_id: participant.user_id || null,
    p_display_name: participant.display_name || 'Spelare',
    p_email: participant.email || null,
    p_phone: participant.phone || null,
    p_role: participant.role || 'player',
    p_price_minor: 0,
    p_payment_status: 'free',
    p_payment_method: null,
    p_metadata: transitionMetadata,
    p_hold_id: activeHoldId,
    p_participant_id: participant.id,
  }).maybeSingle();
  if (commitError) throw new Error(commitError.message);
  if (!committed?.ok) throw new Error(committed?.reason || 'booking_participant_capacity_full');

  const { data: fresh, error: freshError } = await admin
    .from('booking_participants')
    .select('id, venue_id, booking_id, booking_group_key, invite_id, customer_id, user_id, display_name, email, phone, role, price_minor, currency, payment_status, payment_method, payment_stripe_session_id, booking_receipt_id, checked_in_at, metadata, created_at')
    .eq('id', participant.id)
    .maybeSingle();
  if (freshError) throw new Error(freshError.message);

  const transitionApplied = committed.reason === 'committed' &&
    fresh?.payment_status === 'free' && Number(fresh?.price_minor || 0) === 0;
  return {
    reresolved: transitionApplied,
    participant: fresh || projectBookingParticipantCoverage(participant, coverage),
    coverage,
  };
}
