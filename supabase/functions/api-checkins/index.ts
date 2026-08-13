import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import { findAuthUserByEmail } from '../_shared/bookings.ts';
import { resolveCustomerIdForUser } from '../_shared/customers.ts';
import { projectPublicVenueDisplayQueue } from '../_shared/security_projections.ts';
import { activitySessionOccurrenceInterval } from '../_shared/activity_session_time.ts';
import { auditMutation } from '../_shared/authorization.ts';
import {
  persistCurrentBookingParticipantCoverage,
  resolveCurrentBookingParticipantCoverage,
} from '../_shared/booking_participant_entitlement.ts';
import { DateTime } from 'https://esm.sh/luxon@3.5.0';

const STOCKHOLM_ZONE = 'Europe/Stockholm';
type CommittedRegistration = {
  id: string;
  activity_session_id: string;
  session_date: string;
  source_type: string | null;
  source_id: string | null;
};

const entitlementPriority: Record<string, number> = {
  booking: 1,
  booking_participant: 1,
  session_ticket: 10,
  activity_registration: 10,
  membership: 20,
  membership_access: 20,
  day_access: 30,
  punch_card: 40,
  partner_access: 50,
  day_pass: 55,
};

function stockholmNow() {
  const nowSthlm = DateTime.now().setZone(STOCKHOLM_ZONE);
  return {
    nowSthlm,
    today: nowSthlm.toISODate()!,
    nowIso: nowSthlm.toUTC().toISO()!,
    bookingWindowEndIso: nowSthlm.plus({ minutes: 30 }).toUTC().toISO()!,
  };
}

function nameFromBookingNotes(notes?: string | null) {
  return (notes || '').split(' | ')[0].trim();
}

async function getProfile(serviceClient: any, userId: string) {
  const { data } = await serviceClient
    .from('player_profiles')
    .select('id, auth_user_id, customer_id, display_name, first_name, last_name, phone, avatar_url')
    .eq('auth_user_id', userId)
    .maybeSingle();
  return data;
}

function profileName(profile: any) {
  return [profile?.first_name, profile?.last_name].map((part) => String(part || '').trim()).filter(Boolean).join(' ') ||
    profile?.display_name ||
    'Spelare';
}

async function canStaffOperateVenue(serviceClient: any, userId: string, venueId: string) {
  const [{ data: superRole }, { data: venueStaff }] = await Promise.all([
    serviceClient
      .from('user_roles')
      .select('id')
      .eq('user_id', userId)
      .eq('role', 'super_admin')
      .maybeSingle(),
    serviceClient
      .from('venue_staff')
      .select('id')
      .eq('user_id', userId)
      .eq('venue_id', venueId)
      .eq('is_active', true)
      .maybeSingle(),
  ]);

  return Boolean(superRole || venueStaff);
}

async function resolveUserAccess(serviceClient: any, venueId: string, targetUserId: string) {
  const { today, nowIso, bookingWindowEndIso } = stockholmNow();
  const profile = await getProfile(serviceClient, targetUserId);
  const customerId = profile?.customer_id || await resolveCustomerIdForUser(serviceClient, targetUserId);
  const entitlements: any[] = [];

  const { data: existingCheckin } = await serviceClient
    .from('venue_checkins')
    .select('*')
    .eq('user_id', targetUserId)
    .eq('venue_id', venueId)
    .eq('session_date', today)
    .is('checked_out_at', null)
    .order('checked_in_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: booking } = await serviceClient
    .from('bookings')
    .select('id, start_time, end_time, booking_ref, access_code, notes, venue_courts(name)')
    .eq('user_id', targetUserId)
    .eq('venue_id', venueId)
    .eq('status', 'confirmed')
    .lte('start_time', bookingWindowEndIso)
    .gte('end_time', nowIso)
    .order('start_time', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (booking) {
    entitlements.push({
      type: 'booking',
      id: booking.id,
      label: `Bokning: ${(booking as any).venue_courts?.name || 'Bana'}`,
      resource: (booking as any).venue_courts?.name || null,
      starts_at: booking.start_time,
      ends_at: booking.end_time,
      priority: entitlementPriority.booking,
    });
  }

  const { data: bookingParticipant } = await serviceClient
    .from('booking_participants')
    .select('id, display_name, payment_status, checked_in_at, booking_id, bookings(start_time, end_time, booking_ref, venue_courts(name))')
    .eq('user_id', targetUserId)
    .eq('venue_id', venueId)
    .in('payment_status', ['paid', 'free'])
    .order('created_at', { ascending: false })
    .limit(20);

  const activeBookingParticipant = (bookingParticipant || []).find((row: any) => {
    const bookingRow = Array.isArray(row.bookings) ? row.bookings[0] : row.bookings;
    if (!bookingRow?.start_time || !bookingRow?.end_time) return false;
    const start = DateTime.fromISO(bookingRow.start_time, { zone: 'utc' }).setZone(STOCKHOLM_ZONE);
    const end = DateTime.fromISO(bookingRow.end_time, { zone: 'utc' }).setZone(STOCKHOLM_ZONE);
    const now = DateTime.now().setZone(STOCKHOLM_ZONE);
    return start.toISODate() === today && now >= start.minus({ minutes: 30 }) && now <= end;
  });

  if (activeBookingParticipant) {
    const bookingRow = Array.isArray(activeBookingParticipant.bookings) ? activeBookingParticipant.bookings[0] : activeBookingParticipant.bookings;
    entitlements.push({
      type: 'booking_participant',
      id: activeBookingParticipant.id,
      label: `Medspelare: ${bookingRow?.venue_courts?.name || 'Bana'}`,
      resource: bookingRow?.venue_courts?.name || null,
      starts_at: bookingRow?.start_time || null,
      ends_at: bookingRow?.end_time || null,
      priority: entitlementPriority.booking_participant,
    });
  }

  const { data: registrations } = await serviceClient
    .from('session_registrations')
    .select('id, activity_session_id, session_date, status, price_paid_sek, source_type, source_id, activity_sessions(name, session_type, start_time, end_time)')
    .eq('user_id', targetUserId)
    .eq('venue_id', venueId)
    .eq('session_date', today)
    .in('status', ['confirmed', 'checked_in'])
    .order('created_at', { ascending: false });

  const registration = (registrations || []).find((row: any) => {
    const session = row.activity_sessions;
    if (!session?.start_time || !session?.end_time) return true;
    const occurrence = activitySessionOccurrenceInterval(today, session.start_time, session.end_time);
    if (!occurrence) return true;
    const now = DateTime.now().setZone(STOCKHOLM_ZONE);
    return now >= occurrence.start.minus({ minutes: 30 }) && now < occurrence.end;
  });

  if (registration && !['punch_card', 'partner_access'].includes(String(registration.source_type || ''))) {
    const session = (registration as any).activity_sessions;
    entitlements.push({
      type: 'session_ticket',
      id: registration.id,
      source_type: 'session_registration',
      source_id: registration.id,
      label: session?.name || 'Aktivitetsbiljett',
      activity_session_id: registration.activity_session_id,
      session_date: registration.session_date,
      starts_at: session?.start_time || null,
      ends_at: session?.end_time || null,
      priority: entitlementPriority.session_ticket,
    });
  }

  const { data: membership } = await serviceClient
    .from('memberships')
    .select('id, tier_id, status, starts_at, expires_at, membership_tiers(name, color)')
    .eq('user_id', targetUserId)
    .eq('venue_id', venueId)
    .eq('status', 'active')
    .lte('starts_at', today)
    .or(`expires_at.is.null,expires_at.gte.${today}`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (membership) {
    entitlements.push({
      type: 'membership',
      id: membership.id,
      label: (membership as any).membership_tiers?.name || 'Medlem',
      color: (membership as any).membership_tiers?.color || '#4CAF50',
      priority: entitlementPriority.membership,
    });
  }

  let accessQuery = serviceClient
    .from('access_entitlements')
    .select('id, customer_id, entitlement_type, source_type, source_id, status, valid_date, valid_from, valid_until, activity_session_id, session_date, includes_session_types, metadata, model_version, scope_type, meter_type, starts_at, expires_at, service_date, funding_type, funder, access_reason, requires_consumption, consumption_trigger, no_show_policy, occurrence_origin, resolution_priority, scarcity_class, resolution_origin_priority, resolution_expiry_at, uses_limit, uses_count')
    .eq('venue_id', venueId)
    .eq('status', 'active');
  accessQuery = customerId
    ? accessQuery.or(`user_id.eq.${targetUserId},customer_id.eq.${customerId}`)
    : accessQuery.eq('user_id', targetUserId);
  const { data: accessRows } = await accessQuery;

  for (const access of accessRows || []) {
    const validFromValue = access.starts_at || access.valid_from;
    const validUntilValue = access.expires_at || access.valid_until;
    const validFrom = validFromValue ? DateTime.fromISO(validFromValue, { zone: 'utc' }).toMillis() : null;
    const validUntil = validUntilValue ? DateTime.fromISO(validUntilValue, { zone: 'utc' }).toMillis() : null;
    const nowMs = DateTime.now().toMillis();
    if (validFrom && nowMs < validFrom) continue;
    if (validUntil && nowMs > validUntil) continue;
    if (access.valid_date && access.valid_date !== today) continue;

    const committedRegistration = (registrations || []).find((row: CommittedRegistration) => (
      ['punch_card', 'partner_access'].includes(String(row.source_type || ''))
      && String(row.source_id || '') === String(access.id)
    ));
    if (access.entitlement_type === 'partner_access') {
      if (!committedRegistration) continue;
      const { data: resolvedPartner, error: resolvedPartnerError } = await serviceClient.rpc('resolve_access_entitlement', {
        p_venue_id: venueId,
        p_customer_id: access.customer_id || customerId,
        p_user_id: targetUserId,
        p_activity_session_id: committedRegistration.activity_session_id,
        p_service_date: committedRegistration.session_date,
        p_at: nowIso,
        p_product_key: null,
        p_access_context: { entitlement_types: ['partner_access'], channel: 'checkin' },
      });
      if (resolvedPartnerError
        || resolvedPartner?.covered !== true
        || String(resolvedPartner?.entitlement_id || '') !== String(access.id)) continue;
    }

    entitlements.push({
      type: access.entitlement_type,
      id: access.id,
      canonical_entitlement_id: access.id,
      customer_id: access.customer_id || customerId || null,
      source_type: access.source_type,
      source_id: access.source_id,
      registration_id: committedRegistration?.id || null,
      metadata: access.metadata || {},
      label: access.access_reason || (access.entitlement_type === 'day_access'
        ? 'Heldagspass'
        : access.entitlement_type === 'punch_card'
          ? `Klippkort · ${Math.max(Number(access.uses_limit || 0) - Number(access.uses_count || 0), 0)} gånger kvar`
          : access.entitlement_type === 'partner_access'
            ? 'Ingår via partner'
            : access.metadata?.session_name || 'Aktivitetsbiljett'),
      valid_date: access.valid_date,
      activity_session_id: committedRegistration?.activity_session_id || access.activity_session_id,
      session_date: committedRegistration?.session_date || access.session_date,
      includes_session_types: access.includes_session_types || [],
      meter_type: access.meter_type,
      remaining_uses: access.meter_type === 'occurrences'
        ? Math.max(Number(access.uses_limit || 0) - Number(access.uses_count || 0), 0)
        : null,
      funding_type: access.funding_type,
      funder: access.funder,
      consumption_required: Boolean(access.requires_consumption),
      priority: committedRegistration
        ? entitlementPriority.session_ticket
        : Number(access.resolution_priority || entitlementPriority[access.entitlement_type] || 60),
      scarcity_priority: access.scarcity_class === 'scarce' ? 1 : 0,
      origin_priority: Number(access.resolution_origin_priority || 0),
      expiry_priority: access.resolution_expiry_at ? DateTime.fromISO(access.resolution_expiry_at).toMillis() : Number.POSITIVE_INFINITY,
    });
  }

  const { data: dayPass } = await serviceClient
    .from('day_passes')
    .select('id, price, status, valid_date')
    .eq('user_id', targetUserId)
    .eq('venue_id', venueId)
    .eq('valid_date', today)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (dayPass) {
    entitlements.push({
      type: 'day_pass',
      id: dayPass.id,
      label: `Dagspass (${dayPass.price || 0} kr)`,
      valid_date: dayPass.valid_date,
      priority: entitlementPriority.day_pass,
    });
  }

  entitlements.sort((a, b) => {
    const priority = (a.priority || 99) - (b.priority || 99);
    if (priority !== 0) return priority;
    const scarcity = Number(a.scarcity_priority || 0) - Number(b.scarcity_priority || 0);
    if (scarcity !== 0) return scarcity;
    const origin = Number(a.origin_priority || 0) - Number(b.origin_priority || 0);
    if (origin !== 0) return origin;
    return Number(a.expiry_priority ?? Number.POSITIVE_INFINITY)
      - Number(b.expiry_priority ?? Number.POSITIVE_INFINITY);
  });

  return {
    profile,
    entitlements,
    best: entitlements[0] || null,
    existingCheckin,
    already_checked_in: !!existingCheckin,
    allowed: !!existingCheckin || entitlements.length > 0,
    today,
  };
}

async function checkInCanonicalEntitlement(serviceClient: any, params: {
  entitlement: any;
  customerId: string;
  venueId: string;
  sessionDate: string;
  userId?: string | null;
  playerName?: string | null;
  playerPhone?: string | null;
  checkedInBy?: string | null;
}) {
  const entitlementId = String(params.entitlement?.canonical_entitlement_id || '');
  if (!entitlementId) return null;

  const sessionType = params.entitlement?.includes_session_types?.[0]
    || params.entitlement?.metadata?.session_type
    || (params.entitlement?.type === 'day_access' ? 'open_play' : null);
  const { data, error } = await serviceClient.rpc('check_in_with_entitlement', {
    p_entitlement_id: entitlementId,
    p_customer_id: params.customerId,
    p_venue_id: params.venueId,
    p_entry_type: params.entitlement.type,
    p_session_date: params.sessionDate,
    p_user_id: params.userId || null,
    p_player_name: params.playerName || null,
    p_player_phone: params.playerPhone || null,
    p_checked_in_by: params.checkedInBy || null,
    p_activity_session_id: params.entitlement.activity_session_id || null,
    p_registration_id: params.entitlement.registration_id
      || (params.entitlement.source_type === 'session_registration' ? params.entitlement.source_id || null : null),
    p_commerce_order_id: params.entitlement.metadata?.commerce_order_id || null,
    p_access_context: {
      channel: 'checkin',
      session_type: sessionType,
      sport_type: params.entitlement.metadata?.sport_type || 'pickleball',
      product_key: params.entitlement.metadata?.product_key || null,
    },
  });
  if (error) throw new Error(error.message);
  return data as { checkin: any; consumption?: any; already_checked_in: boolean };
}

async function reResolveBookingParticipantForCheckin(
  serviceClient: any,
  req: Request,
  actorUserId: string,
  participant: any,
) {
  const coverage = await resolveCurrentBookingParticipantCoverage(serviceClient, participant, { channel: 'checkin' });
  if (!coverage.covered) return { participant, coverage, reresolved: false };

  const persisted = await persistCurrentBookingParticipantCoverage(serviceClient, participant, coverage, {
    channel: 'checkin',
  });
  if (persisted.reresolved) {
    await auditMutation(serviceClient, {
      req,
      userId: actorUserId,
      action: 'booking_participant.entitlement_reresolved',
      entityTable: 'booking_participants',
      entityId: participant.id,
      venueId: participant.venue_id,
      before: { payment_status: participant.payment_status, price_minor: participant.price_minor },
      after: { payment_status: 'free', price_minor: 0, access_reason: coverage.accessReason },
      metadata: {
        channel: 'checkin',
        entitlement_id: coverage.entitlementId,
        entitlement_type: coverage.entitlementType,
      },
    });
  }
  return persisted;
}

function bookingParticipantConsumptionEntitlement(participant: any) {
  const metadata = participant?.metadata && typeof participant.metadata === 'object'
    ? participant.metadata
    : {};
  const entitlementId = String(metadata.entitlement_id || '').trim();
  if (!metadata.consumption_required || !entitlementId) return null;
  return {
    type: metadata.entitlement_type || 'booking_participant',
    id: participant.id,
    canonical_entitlement_id: entitlementId,
    source_type: metadata.source_type || null,
    source_id: metadata.source_id || null,
    registration_id: metadata.registration_id || null,
    activity_session_id: metadata.activity_session_id || null,
    metadata: {
      ...metadata,
      product_key: metadata.product_key || 'booking_participant_share',
    },
  };
}

async function markBookingParticipantCheckedIn(serviceClient: any, venueId: string, participantId: string | null) {
  if (!participantId) return;
  const { error } = await serviceClient
    .from('booking_participants')
    .update({ checked_in_at: new Date().toISOString() })
    .eq('id', participantId)
    .eq('venue_id', venueId)
    .is('checked_in_at', null);
  if (error) throw new Error(error.message);
}

async function resolveVenueForSelfCheckin(serviceClient: any, params: { venueId?: string | null; venueSlug?: string | null }) {
  if (params.venueId) {
    const { data } = await serviceClient
      .from('venues')
      .select('id, name, slug')
      .eq('id', params.venueId)
      .maybeSingle();
    return data || null;
  }

  if (params.venueSlug) {
    const slug = String(params.venueSlug).trim();
    const candidates = [slug, slug === 'solna' ? 'pickla-arena-sthlm' : slug];
    const { data } = await serviceClient
      .from('venues')
      .select('id, name, slug')
      .in('slug', candidates)
      .limit(1)
      .maybeSingle();
    return data || null;
  }

  return null;
}

async function purchaseOptionsForVenue(serviceClient: any, venue: any) {
  const { today } = stockholmNow();
  const options: any[] = [
    {
      type: 'day_pass',
      label: 'Köp dagsmedlemskap',
      href: `/openplay?v=${encodeURIComponent(venue.slug || '')}`,
    },
    {
      type: 'membership',
      label: 'Bli medlem',
      href: `/membership?v=${encodeURIComponent(venue.slug || '')}`,
    },
  ];

  const { data: sessions } = await serviceClient
    .from('activity_sessions')
    .select('id, name, session_date, recurrence_days, start_time, end_time, price_sek')
    .eq('venue_id', venue.id)
    .eq('is_active', true)
    .eq('publish_status', 'published')
    .eq('closed_to_public', false)
    .order('start_time', { ascending: true })
    .limit(20);

  const now = DateTime.now().setZone(STOCKHOLM_ZONE);
  const weekday = now.weekday % 7;
  const session = (sessions || []).find((row: any) => {
    if (row.session_date && row.session_date !== today) return false;
    if (!row.session_date && (!Array.isArray(row.recurrence_days) || !row.recurrence_days.includes(weekday))) return false;
    if (!row.end_time) return true;
    const occurrence = activitySessionOccurrenceInterval(today, row.start_time, row.end_time);
    return Boolean(occurrence && occurrence.end > now);
  });

  if (session) {
    options.unshift({
      type: 'activity_ticket',
      label: `Köp biljett: ${session.name}`,
      href: `/program/${session.id}?date=${encodeURIComponent(today)}&v=${encodeURIComponent(venue.slug || '')}`,
      price_sek: session.price_sek || 0,
    });
  }

  return options;
}

async function findActiveCheckin(serviceClient: any, params: {
  venueId: string;
  today: string;
  entryType: string;
  entitlementId?: string | null;
  targetUserId?: string | null;
  playerPhone?: string | null;
  playerName?: string | null;
}) {
  let existingQuery = serviceClient
    .from('venue_checkins')
    .select('*')
    .eq('venue_id', params.venueId)
    .eq('entry_type', params.entryType)
    .eq('session_date', params.today)
    .is('checked_out_at', null)
    .limit(1);

  if (params.entitlementId) {
    existingQuery = existingQuery.eq('entitlement_id', params.entitlementId);
  } else if (params.targetUserId) {
    existingQuery = existingQuery.eq('user_id', params.targetUserId);
  } else if (params.playerPhone) {
    existingQuery = existingQuery.eq('player_phone', params.playerPhone);
  } else if (params.playerName) {
    existingQuery = existingQuery.eq('player_name', params.playerName);
  } else {
    return null;
  }

  const { data } = await existingQuery.maybeSingle();
  return data || null;
}

async function markSessionRegistrationCheckedIn(serviceClient: any, params: {
  venueId: string;
  entryType?: string | null;
  entitlementId?: string | null;
}) {
  if (!params.entitlementId) return;
  if (String(params.entryType || '') === 'booking_participant') {
    await serviceClient
      .from('booking_participants')
      .update({ checked_in_at: new Date().toISOString() })
      .eq('id', params.entitlementId)
      .eq('venue_id', params.venueId)
      .is('checked_in_at', null);
    return;
  }
  if (!['session_ticket', 'activity_registration'].includes(String(params.entryType || ''))) return;

  await serviceClient
    .from('session_registrations')
    .update({ status: 'checked_in' })
    .eq('id', params.entitlementId)
    .eq('venue_id', params.venueId)
    .neq('status', 'cancelled');
}

const checkinsHandler = async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.split('/').pop() || '';

  try {
    // GET /api-checkins/public-display-queue?slug=X
    // Public venue display projection: no table IDs, user IDs, contact data, or staff IDs.
    if (req.method === 'GET' && path === 'public-display-queue') {
      const slug = String(url.searchParams.get('slug') || '').trim();
      if (!slug) return errorResponse('Missing slug');

      const serviceClient = getServiceClient();
      const { data: venue, error: venueErr } = await serviceClient
        .from('venues')
        .select('id')
        .eq('slug', slug)
        .maybeSingle();
      if (venueErr) return errorResponse(venueErr.message, 500);
      if (!venue) return errorResponse('Venue not found', 404);

      const { today } = stockholmNow();
      const { data: rows, error: rowsErr } = await serviceClient
        .from('venue_checkins')
        .select('player_name, checked_in_at, entry_type, entitlement_id')
        .eq('venue_id', venue.id)
        .eq('session_date', today)
        .in('entry_type', ['open_play', 'manual'])
        .is('checked_out_at', null)
        .order('checked_in_at', { ascending: true });
      if (rowsErr) return errorResponse(rowsErr.message, 500);

      return jsonResponse({ queue: projectPublicVenueDisplayQueue(rows || []) }, 200, 5);
    }

    // POST /api-checkins/booking — staff checks in a concrete booking/group.
    if (req.method === 'POST' && path === 'booking') {
      const { userId, error } = await getAuthenticatedClient(req);
      if (error || !userId) return errorResponse(error || 'Unauthorized', 401);

      const body = await req.json();
      const venueId = String(body.venue_id || body.venueId || '').trim();
      const requestedBookingIds = Array.isArray(body.booking_ids)
        ? body.booking_ids.map((id: unknown) => String(id || '').trim()).filter(Boolean)
        : [String(body.booking_id || body.bookingId || '').trim()].filter(Boolean);
      if (!venueId || requestedBookingIds.length === 0) return errorResponse('Missing venue_id or booking_ids', 400);

      const serviceClient = getServiceClient();
      const canOperate = await canStaffOperateVenue(serviceClient, userId, venueId);
      if (!canOperate) return errorResponse('Forbidden', 403);

      const { today, nowSthlm } = stockholmNow();
      const { data: baseBooking, error: baseErr } = await serviceClient
        .from('bookings')
        .select('id, customer_id, user_id, venue_id, start_time, end_time, status, total_price, stripe_session_id, access_code, notes, booked_by')
        .eq('venue_id', venueId)
        .eq('id', requestedBookingIds[0])
        .maybeSingle();
      if (baseErr) return errorResponse(baseErr.message, 500);
      if (!baseBooking) return errorResponse('Booking not found', 404);

      let groupQuery = serviceClient
        .from('bookings')
        .select('id, customer_id, user_id, venue_id, start_time, end_time, status, total_price, stripe_session_id, access_code, notes, booked_by')
        .eq('venue_id', venueId)
        .eq('start_time', baseBooking.start_time)
        .eq('end_time', baseBooking.end_time)
        .neq('status', 'cancelled');

      if (requestedBookingIds.length > 1) {
        groupQuery = groupQuery.in('id', requestedBookingIds);
      } else if (baseBooking.stripe_session_id) {
        groupQuery = groupQuery.eq('stripe_session_id', baseBooking.stripe_session_id);
      } else if (baseBooking.access_code) {
        groupQuery = groupQuery.eq('access_code', baseBooking.access_code);
      } else {
        groupQuery = groupQuery.eq('id', baseBooking.id);
      }

      const { data: groupRows, error: groupErr } = await groupQuery;
      if (groupErr) return errorResponse(groupErr.message, 500);
      const bookings = groupRows || [];
      if (!bookings.length) return errorResponse('Booking group not found', 404);

      const start = DateTime.fromISO(baseBooking.start_time, { zone: 'utc' }).setZone(STOCKHOLM_ZONE);
      const end = DateTime.fromISO(baseBooking.end_time, { zone: 'utc' }).setZone(STOCKHOLM_ZONE);
      if (!start.isValid || !end.isValid) return errorResponse('Invalid booking time', 400);
      if (start.toISODate() !== today) return errorResponse('Bokningen gäller inte idag', 400);
      if (nowSthlm.toMillis() < start.minus({ minutes: 30 }).toMillis()) {
        return errorResponse(`För tidigt — incheckning öppnar ${start.minus({ minutes: 30 }).toFormat('HH:mm')}`, 400);
      }
      if (nowSthlm.toMillis() > end.toMillis()) return errorResponse('Bokningstiden har passerat', 400);

      const statusOk = bookings.every((booking: any) => ['confirmed', 'completed'].includes(String(booking.status || '')));
      if (!statusOk) return errorResponse('Bokningen är inte bekräftad', 409);

      const totalAmount = bookings.reduce((sum: number, booking: any) => sum + Number(booking.total_price || 0), 0);
      const paymentOk = totalAmount <= 0 || bookings.some((booking: any) => Boolean(booking.stripe_session_id));
      if (!paymentOk) return errorResponse('Bokningen saknar betald status', 409);

      const bookingIds = bookings.map((booking: any) => booking.id).filter(Boolean);
      const { data: existingRows, error: existingErr } = await serviceClient
        .from('venue_checkins')
        .select('*')
        .eq('venue_id', venueId)
        .eq('session_date', today)
        .in('entitlement_id', bookingIds)
        .is('checked_out_at', null);
      if (existingErr) return errorResponse(existingErr.message, 500);

      const existingIds = new Set((existingRows || []).map((row: any) => row.entitlement_id));
      const playerName = String(body.customer_name || body.customerName || nameFromBookingNotes(baseBooking.notes) || baseBooking.booked_by || '').trim() || null;
      const bookingCustomerIdsByUserId = new Map<string, string | null>();
      const bookingUserIds = [...new Set(bookings.map((booking: any) => String(booking.user_id || '').trim()).filter(Boolean))];
      for (const bookingUserId of bookingUserIds) {
        bookingCustomerIdsByUserId.set(bookingUserId, await resolveCustomerIdForUser(serviceClient, bookingUserId));
      }
      const rowsToInsert = bookings
        .filter((booking: any) => !existingIds.has(booking.id))
        .map((booking: any) => ({
          venue_id: venueId,
          customer_id: booking.customer_id || bookingCustomerIdsByUserId.get(booking.user_id) || null,
          user_id: booking.user_id || null,
          player_name: playerName,
          entry_type: 'booking',
          entitlement_id: booking.id,
          checked_in_by: userId,
          session_date: today,
        }));

      let insertedRows: any[] = [];
      if (rowsToInsert.length > 0) {
        const { data: checkins, error: insertErr } = await serviceClient
          .from('venue_checkins')
          .insert(rowsToInsert)
          .select();
        if (insertErr) {
          if (insertErr.code !== '23505') return errorResponse(insertErr.message, 500);
          const { data: retryRows, error: retryErr } = await serviceClient
            .from('venue_checkins')
            .select('*')
            .eq('venue_id', venueId)
            .eq('session_date', today)
            .in('entitlement_id', bookingIds)
            .is('checked_out_at', null);
          if (retryErr) return errorResponse(retryErr.message, 500);
          return jsonResponse({
            already_checked_in: true,
            checkins: retryRows || [],
            booking_ids: bookingIds,
          });
        }
        insertedRows = checkins || [];
      }

      return jsonResponse({
        already_checked_in: rowsToInsert.length === 0,
        checkins: [...(existingRows || []), ...insertedRows],
        booking_ids: bookingIds,
      }, rowsToInsert.length > 0 ? 201 : 200);
    }

    // POST /api-checkins/self — customer-led venue QR check-in.
    if (req.method === 'POST' && path === 'self') {
      const { client, userId, error } = await getAuthenticatedClient(req);
      if (error || !client || !userId) return errorResponse(error || 'Unauthorized', 401);

      const body = await req.json();
      const requestedEntryType = body.entry_type ? String(body.entry_type) : null;
      const requestedEntitlementId = body.entitlement_id ? String(body.entitlement_id) : null;
      const serviceClient = getServiceClient();
      const venue = await resolveVenueForSelfCheckin(serviceClient, {
        venueId: body.venue_id || body.venueId || null,
        venueSlug: body.venue_slug || body.venueSlug || null,
      });
      if (!venue?.id) return errorResponse('Venue not found', 404);

      let bookingParticipantConsumption: any = null;

      if (requestedEntryType === 'booking_participant' && requestedEntitlementId) {
        const { data: participant, error: participantError } = await serviceClient
          .from('booking_participants')
          .select('id, venue_id, booking_id, booking_group_key, invite_id, customer_id, user_id, display_name, email, phone, role, price_minor, payment_status, payment_method, payment_stripe_session_id, booking_receipt_id, metadata, bookings(id, booking_ref, venue_id, start_time, end_time, status, notes, access_code, stripe_session_id, included_court_hours, membership_usage_entitlement_type, open_for_more_status, open_for_more_total_players, open_for_more_opened_places, open_for_more_public_capacity, open_for_more_committed_at_publication, open_for_more_published_at)')
          .eq('id', requestedEntitlementId)
          .eq('venue_id', venue.id)
          .maybeSingle();
        if (participantError) return errorResponse(participantError.message, 500);
        if (!participant || participant.user_id !== userId) return errorResponse('Biljetten tillhör inte den inloggade kunden', 403);
        let effectiveParticipant = participant;
        try {
          effectiveParticipant = (await reResolveBookingParticipantForCheckin(
            serviceClient,
            req,
            userId,
            participant,
          )).participant;
        } catch (coverageError) {
          return errorResponse((coverageError as Error).message || 'Rättigheten kunde inte bekräftas', 409);
        }
        if (!['paid', 'free'].includes(String(effectiveParticipant.payment_status || '').toLowerCase())) {
          return errorResponse('Biljetten är inte betald', 409);
        }
        bookingParticipantConsumption = bookingParticipantConsumptionEntitlement(effectiveParticipant);
      }

      const access = await resolveUserAccess(serviceClient, venue.id, userId);
      const profile = access.profile;

      if (!requestedEntryType && !requestedEntitlementId && access.already_checked_in && access.existingCheckin) {
        await markSessionRegistrationCheckedIn(serviceClient, {
          venueId: venue.id,
          entryType: access.existingCheckin.entry_type,
          entitlementId: access.existingCheckin.entitlement_id,
        });
        return jsonResponse({
          checked_in: true,
          already_checked_in: true,
          checkin: access.existingCheckin,
          access,
          venue,
        });
      }

      if (!access.allowed || !access.best) {
        return jsonResponse({
          checked_in: false,
          allowed: false,
          venue,
          access,
          purchase_options: await purchaseOptionsForVenue(serviceClient, venue),
        }, 200);
      }

      let best = access.best;
      if (requestedEntryType && requestedEntitlementId) {
        const requested = access.entitlements.find((ent) =>
          ent.type === requestedEntryType && String(ent.id || '') === requestedEntitlementId
        );
        if (!requested) return errorResponse('Ingen giltig access hittades för den här biljetten', 403);
        best = bookingParticipantConsumption || requested;
      }
      if (!best) return errorResponse('Ingen giltig access hittades', 403);
      const playerName = profileName(profile);
      const customerId = await resolveCustomerIdForUser(serviceClient, userId);
      if (best.canonical_entitlement_id) {
        if (!customerId) return errorResponse('Kunden behöver identifieras innan incheckning', 409);
        try {
          const canonicalResult = await checkInCanonicalEntitlement(serviceClient, {
            entitlement: best,
            customerId,
            venueId: venue.id,
            sessionDate: access.today,
            userId,
            playerName,
            checkedInBy: userId,
          });
          const canonicalCheckin = canonicalResult?.checkin;
          if (!canonicalCheckin) return errorResponse('Incheckningen kunde inte slutföras', 500);
          await markSessionRegistrationCheckedIn(serviceClient, {
            venueId: venue.id,
            entryType: canonicalCheckin.entry_type,
            entitlementId: canonicalCheckin.entitlement_id,
          });
          await markBookingParticipantCheckedIn(
            serviceClient,
            venue.id,
            bookingParticipantConsumption ? requestedEntitlementId : null,
          );
          return jsonResponse({
            checked_in: true,
            already_checked_in: Boolean(canonicalResult?.already_checked_in),
            checkin: canonicalCheckin,
            consumption: canonicalResult?.consumption || null,
            access: {
              ...access,
              existingCheckin: canonicalCheckin,
              already_checked_in: true,
            },
            venue,
          }, canonicalResult?.already_checked_in ? 200 : 201);
        } catch (canonicalError) {
          return errorResponse((canonicalError as Error).message || 'Rättigheten kunde inte användas', 409);
        }
      }
      const existingCheckin = await findActiveCheckin(serviceClient, {
        venueId: venue.id,
        today: access.today,
        entryType: best.type,
        entitlementId: best.id,
        targetUserId: userId,
      });

      if (existingCheckin) {
        await markSessionRegistrationCheckedIn(serviceClient, {
          venueId: venue.id,
          entryType: existingCheckin.entry_type,
          entitlementId: existingCheckin.entitlement_id,
        });
        return jsonResponse({
          checked_in: true,
          already_checked_in: true,
          checkin: existingCheckin,
          access,
          venue,
        });
      }

      const { data, error: insertErr } = await serviceClient
        .from('venue_checkins')
        .insert({
          venue_id: venue.id,
          customer_id: customerId,
          user_id: userId,
          player_name: playerName,
          entry_type: best.type,
          entitlement_id: best.id || null,
          checked_in_by: userId,
          session_date: access.today,
        })
        .select()
        .single();

      if (insertErr) {
        if (insertErr.code === '23505') {
          const retry = await findActiveCheckin(serviceClient, {
            venueId: venue.id,
            today: access.today,
            entryType: best.type,
            entitlementId: best.id,
            targetUserId: userId,
          });
          if (retry) {
            await markSessionRegistrationCheckedIn(serviceClient, {
              venueId: venue.id,
              entryType: retry.entry_type,
              entitlementId: retry.entitlement_id,
            });
            return jsonResponse({
              checked_in: true,
              already_checked_in: true,
              checkin: retry,
              access,
              venue,
            });
          }
        }
        return errorResponse(insertErr.message);
      }

      await markSessionRegistrationCheckedIn(serviceClient, {
        venueId: venue.id,
        entryType: data.entry_type,
        entitlementId: data.entitlement_id,
      });

      return jsonResponse({
        checked_in: true,
        already_checked_in: false,
        checkin: data,
        access: {
          ...access,
          existingCheckin: data,
          already_checked_in: true,
        },
        venue,
      }, 201);
    }

    // POST /api-checkins/code — self-service check-in via booking access code (no auth required)
    if (req.method === 'POST' && path === 'code') {
      const body = await req.json();
      const { venue_id, access_code, resource_id } = body;
      if (!venue_id || !access_code) return errorResponse('Missing venue_id or access_code');

      const safeCode = String(access_code).trim();
      if (!/^\d{4}$/.test(safeCode)) return errorResponse('Ogiltig kod', 400);
      const resourceId = resource_id ? String(resource_id).trim() : null;

      const serviceClient = getServiceClient();

      // Current time in Europe/Stockholm — used for all time comparisons
      const nowSthlm = DateTime.now().setZone('Europe/Stockholm');
      const todaySthlm = nowSthlm.toISODate(); // YYYY-MM-DD in Stockholm
      const todayStartUtc = nowSthlm.startOf('day').toUTC().toISO()!;
      const todayEndUtc = nowSthlm.endOf('day').toUTC().toISO()!;

      const { data: bookings, error: bErr } = await serviceClient
        .from('bookings')
        .select('id, customer_id, user_id, venue_id, venue_court_id, start_time, end_time, status, booking_ref, notes, venue_courts(id, name, court_number, sport_type)')
        .eq('venue_id', venue_id)
        .eq('access_code', safeCode)
        .eq('status', 'confirmed')
        .gte('start_time', todayStartUtc)
        .lte('start_time', todayEndUtc)
        .order('start_time', { ascending: true });

      if (bErr || !bookings?.length) return errorResponse('Ogiltig eller utgången kod', 404);
      const booking = resourceId
        ? (bookings.find((b: any) => b.venue_court_id === resourceId) || bookings[0])
        : bookings[0];
      const groupBookings = bookings.filter((b: any) =>
        b.start_time === booking.start_time &&
        b.end_time === booking.end_time
      );
      const expectedResources = groupBookings
        .map((b: any) => b.venue_courts ? { ...b.venue_courts, id: b.venue_court_id || b.venue_courts.id } : null)
        .filter(Boolean);

      if (resourceId && !groupBookings.some((b: any) => b.venue_court_id === resourceId)) {
        return jsonResponse({
          wrong_resource: true,
          expected_resources: expectedResources,
          booking: {
            id: booking.id,
            booking_ref: (booking as any).booking_ref,
            start_time: booking.start_time,
            end_time: booking.end_time,
            court: (booking as any).venue_courts,
            courts: expectedResources,
            customer_name: nameFromBookingNotes((booking as any).notes) || null,
          },
        }, 200);
      }

      // ── Time-window validation ──────────────────────────────────────────────
      const startSthlm = DateTime.fromISO(booking.start_time, { zone: 'utc' }).setZone('Europe/Stockholm');
      const endSthlm   = DateTime.fromISO(booking.end_time,   { zone: 'utc' }).setZone('Europe/Stockholm');

      // Must be today in Stockholm
      if (startSthlm.toISODate() !== todaySthlm) {
        return errorResponse('Koden gäller inte idag', 400);
      }

      // Not more than 30 min before start
      const openMs = startSthlm.minus({ minutes: 30 }).toMillis();
      if (nowSthlm.toMillis() < openMs) {
        const opensAt = startSthlm.minus({ minutes: 30 }).toFormat('HH:mm');
        return errorResponse(`För tidigt — incheckning öppnar ${opensAt}`, 400);
      }

      // Not after end_time
      if (nowSthlm.toMillis() > endSthlm.toMillis()) {
        return errorResponse('Bokningstiden har passerat', 400);
      }
      // ──────────────────────────────────────────────────────────────────────

      const bookingIds = groupBookings.map((b: any) => b.id).filter(Boolean);
      const { data: existingRows } = await serviceClient
        .from('venue_checkins')
        .select('*')
        .eq('venue_id', venue_id)
        .eq('session_date', todaySthlm)
        .eq('entry_type', 'booking_code')
        .in('entitlement_id', bookingIds)
        .is('checked_out_at', null);
      const existingIds = new Set((existingRows || []).map((row: any) => row.entitlement_id));

      // Extract customer name from "Name | Phone" notes format
      const customerName = nameFromBookingNotes((booking as any).notes);
      const bookingCustomerIdsByUserId = new Map<string, string | null>();
      const bookingUserIds = [...new Set(groupBookings.map((b: any) => String(b.user_id || '').trim()).filter(Boolean))];
      for (const bookingUserId of bookingUserIds) {
        bookingCustomerIdsByUserId.set(bookingUserId, await resolveCustomerIdForUser(serviceClient, bookingUserId));
      }

      const checkinRows = groupBookings.filter((b: any) => !existingIds.has(b.id)).map((b: any) => ({
        venue_id,
        customer_id: b.customer_id || bookingCustomerIdsByUserId.get(b.user_id) || null,
        user_id: b.user_id || null,
        player_name: customerName || null,
        entry_type: 'booking_code',
        entitlement_id: b.id,
        session_date: todaySthlm,
      }));

      let insertedRows: any[] = [];
      if (checkinRows.length > 0) {
        const { data: checkins, error: cErr } = await serviceClient
          .from('venue_checkins')
          .insert(checkinRows)
          .select();

        if (cErr) {
          if (cErr.code === '23505') {
            const { data: retryRows } = await serviceClient
              .from('venue_checkins')
              .select('*')
              .eq('venue_id', venue_id)
              .eq('session_date', todaySthlm)
              .eq('entry_type', 'booking_code')
              .in('entitlement_id', bookingIds)
              .is('checked_out_at', null);
            insertedRows = retryRows || [];
          } else {
            return errorResponse(cErr.message);
          }
        } else {
          insertedRows = checkins || [];
        }
      }

      const allCheckins = [...(existingRows || []), ...insertedRows];

      return jsonResponse({
        checkin: allCheckins[0] || null,
        checkins: allCheckins,
        already_checked_in: checkinRows.length === 0,
        booking: {
          id: booking.id,
          booking_ref: (booking as any).booking_ref,
          start_time: booking.start_time,
          end_time: booking.end_time,
          court: (booking as any).venue_courts,
          courts: expectedResources,
          customer_name: customerName || null,
        },
      }, 201);
    }

    // Public endpoint: validate-checkin (no auth required for desk search)
    if (req.method === 'POST' && path === 'validate-by-uid') {
      const { client, userId, error } = await getAuthenticatedClient(req);
      if (error || !client || !userId) return errorResponse(error || 'Unauthorized', 401);

      const body = await req.json();
      const { venue_id, user_id: targetUserId } = body;
      if (!venue_id || !targetUserId) return errorResponse('Missing venue_id or user_id');

      const serviceClient = getServiceClient();
      const access = await resolveUserAccess(serviceClient, venue_id, targetUserId);
      const profile = access.profile;

      if (!profile) return errorResponse('User not found', 404);

      return jsonResponse({
        profile_id: profile.id,
        user_id: profile.auth_user_id,
        display_name: profile.display_name,
        phone: profile.phone,
        avatar_url: profile.avatar_url,
        entitlements: access.entitlements,
        best_entitlement: access.best,
        allowed: access.allowed,
        already_checked_in: access.already_checked_in,
        active_checkin: access.existingCheckin,
      });
    }

    if (req.method === 'POST' && path === 'validate-checkin') {
      const { client, userId, error } = await getAuthenticatedClient(req);
      if (error || !client || !userId) return errorResponse(error || 'Unauthorized', 401);

      const body = await req.json();
      const { venue_id, search_query } = body;
      if (!venue_id) return errorResponse('Missing venue_id');

      const serviceClient = getServiceClient();

      // Search for player by name, phone, or email
      const query = (search_query || '').trim().toLowerCase();
      if (!query) return errorResponse('Missing search_query');

      // Search player_profiles
      const { data: profiles } = await serviceClient
        .from('player_profiles')
        .select('id, auth_user_id, display_name, first_name, last_name, phone, avatar_url')
        .or(`display_name.ilike.%${query}%,first_name.ilike.%${query}%,last_name.ilike.%${query}%,phone.ilike.%${query}%`)
        .limit(10);

      let searchProfiles = profiles || [];
      if (query.includes('@')) {
        const authUser = await findAuthUserByEmail(serviceClient, query);
        if (authUser?.id && !searchProfiles.some((profile: any) => profile.auth_user_id === authUser.id)) {
          const emailProfile = await getProfile(serviceClient, authUser.id);
          if (emailProfile) searchProfiles = [emailProfile, ...searchProfiles];
        }
      }

      if (!searchProfiles.length) {
        return jsonResponse({ results: [] });
      }

      const results = [];

      for (const profile of searchProfiles.slice(0, 10)) {
        const uid = profile.auth_user_id;
        const access = await resolveUserAccess(serviceClient, venue_id, uid);

        results.push({
          profile_id: profile.id,
          user_id: uid,
          display_name: profileName(profile),
          phone: profile.phone,
          avatar_url: profile.avatar_url,
          entitlements: access.entitlements,
          best_entitlement: access.best,
          allowed: access.allowed,
          already_checked_in: access.already_checked_in,
          active_checkin: access.existingCheckin,
        });
      }

      return jsonResponse({ results });
    }

    // POST /api-checkins/checkin — perform the check-in
    if (req.method === 'POST' && path === 'checkin') {
      const { client, userId, error } = await getAuthenticatedClient(req);
      if (error || !client || !userId) return errorResponse(error || 'Unauthorized', 401);

      const body = await req.json();
      const { venue_id, player_name, player_phone } = body;
      let target_user_id = body.target_user_id ? String(body.target_user_id) : null;
      const requestedCustomerId = body.customer_id ? String(body.customer_id) : null;
      let { entry_type, entitlement_id } = body;
      if (!venue_id || !entry_type) return errorResponse('Missing required fields');

      const serviceClient = getServiceClient();
      if (!await canStaffOperateVenue(serviceClient, userId, venue_id)) return errorResponse('Forbidden', 403);
      const { today } = stockholmNow();
      let customerId = requestedCustomerId || (target_user_id ? await resolveCustomerIdForUser(serviceClient, target_user_id) : null);
      let canonicalEntitlement: any = null;
      let bookingParticipantConsumption: any = null;
      let bookingParticipantId: string | null = null;
      let dependentParticipantId: string | null = null;

      if (String(entry_type || '') === 'session_ticket' && entitlement_id) {
        const { data: registration, error: registrationError } = await serviceClient
          .from('session_registrations')
          .select('id, venue_id, session_date, customer_id, user_id, dependent_participant_id, status')
          .eq('id', entitlement_id)
          .eq('venue_id', venue_id)
          .eq('session_date', today)
          .in('status', ['confirmed', 'checked_in'])
          .maybeSingle();
        if (registrationError) return errorResponse(registrationError.message, 500);
        if (!registration) return errorResponse('Biljetten saknas eller gäller inte idag', 404);
        if (target_user_id && registration.user_id && registration.user_id !== target_user_id) return errorResponse('Biljetten tillhör en annan kund', 403);
        if (requestedCustomerId && registration.customer_id && registration.customer_id !== requestedCustomerId) return errorResponse('Biljetten tillhör en annan kund', 403);
        target_user_id ||= registration.user_id || null;
        customerId ||= registration.customer_id || null;
        dependentParticipantId = registration.dependent_participant_id || null;
      }

      if (String(entry_type || '') === 'booking_participant' && entitlement_id) {
        const { data: participant, error: participantError } = await serviceClient
          .from('booking_participants')
          .select('id, venue_id, booking_id, booking_group_key, invite_id, customer_id, user_id, display_name, email, phone, role, price_minor, payment_status, payment_method, payment_stripe_session_id, booking_receipt_id, metadata, bookings(id, booking_ref, venue_id, start_time, end_time, status, notes, access_code, stripe_session_id, included_court_hours, membership_usage_entitlement_type, open_for_more_status, open_for_more_total_players, open_for_more_opened_places, open_for_more_public_capacity, open_for_more_committed_at_publication, open_for_more_published_at)')
          .eq('id', entitlement_id)
          .eq('venue_id', venue_id)
          .maybeSingle();
        if (participantError) return errorResponse(participantError.message, 500);
        if (!participant) return errorResponse('Biljetten saknas', 404);
        bookingParticipantId = participant.id;
        if (target_user_id && participant.user_id && participant.user_id !== target_user_id) {
          return errorResponse('Biljetten tillhör en annan kund', 403);
        }
        if (requestedCustomerId && participant.customer_id && participant.customer_id !== requestedCustomerId) {
          return errorResponse('Biljetten tillhör en annan kund', 403);
        }
        target_user_id ||= participant.user_id || null;
        customerId ||= participant.customer_id || (target_user_id ? await resolveCustomerIdForUser(serviceClient, target_user_id) : null);
        try {
          const resolved = await reResolveBookingParticipantForCheckin(serviceClient, req, userId, participant);
          bookingParticipantConsumption = bookingParticipantConsumptionEntitlement(resolved.participant);
        } catch (coverageError) {
          return errorResponse((coverageError as Error).message || 'Rättigheten kunde inte bekräftas', 409);
        }
      }

      if (target_user_id) {
        const access = await resolveUserAccess(serviceClient, venue_id, target_user_id);

        if (access.already_checked_in && access.existingCheckin) {
          const existingCanonical = access.entitlements.find(
            (ent) => ent.canonical_entitlement_id === access.existingCheckin.entitlement_id,
          );
          if (existingCanonical && customerId) {
            try {
              const canonicalResult = await checkInCanonicalEntitlement(serviceClient, {
                entitlement: existingCanonical,
                customerId,
                venueId: venue_id,
                sessionDate: today,
                userId: target_user_id,
                playerName: player_name || profileName(access.profile),
                playerPhone: player_phone,
                checkedInBy: userId,
              });
              return jsonResponse({
                ...(canonicalResult?.checkin || access.existingCheckin),
                already_checked_in: true,
                consumption: canonicalResult?.consumption || null,
                access,
              });
            } catch (canonicalError) {
              return errorResponse((canonicalError as Error).message || 'Rättigheten kunde inte användas', 409);
            }
          }
          await markSessionRegistrationCheckedIn(serviceClient, {
            venueId: venue_id,
            entryType: access.existingCheckin.entry_type,
            entitlementId: access.existingCheckin.entitlement_id,
          });
          return jsonResponse({
            ...access.existingCheckin,
            already_checked_in: true,
            access,
          });
        }

        const requestedEntitlement = access.entitlements.find(
          (ent) => ent.type === entry_type && ent.id === entitlement_id
        );

        if ((!entitlement_id || entry_type === 'manual' || entry_type === 'auto') && access.best) {
          entry_type = access.best.type;
          entitlement_id = access.best.id;
        } else if (entitlement_id && !requestedEntitlement) {
          return errorResponse('Ingen giltig access hittades för den här incheckningen', 403);
        } else if (!access.allowed && entry_type !== 'manual') {
          return errorResponse('Ingen giltig access hittades', 403);
        }
        canonicalEntitlement = access.entitlements.find(
          (ent) => ent.type === entry_type && ent.id === entitlement_id && ent.canonical_entitlement_id,
        ) || null;
        if (bookingParticipantConsumption) canonicalEntitlement = bookingParticipantConsumption;
      }

      if (String(entry_type || '') === 'booking_participant' && entitlement_id) {
        const { data: participant, error: participantErr } = await serviceClient
          .from('booking_participants')
          .select('id, venue_id, customer_id, user_id, payment_status')
          .eq('id', entitlement_id)
          .eq('venue_id', venue_id)
          .maybeSingle();
        if (participantErr) return errorResponse(participantErr.message, 500);
        if (!participant) return errorResponse('Biljetten saknas', 404);
        if (!participant.customer_id && !participant.user_id) {
          return errorResponse('Spelaren behöver identifiera sig innan check-in', 409);
        }
        if (!['paid', 'free'].includes(String(participant.payment_status || '').toLowerCase())) {
          return errorResponse('Biljetten är inte betald', 409);
        }
      }

      if (canonicalEntitlement) {
        if (!customerId) return errorResponse('Kunden behöver identifieras innan incheckning', 409);
        try {
          const canonicalResult = await checkInCanonicalEntitlement(serviceClient, {
            entitlement: canonicalEntitlement,
            customerId,
            venueId: venue_id,
            sessionDate: today,
            userId: target_user_id || null,
            playerName: player_name || null,
            playerPhone: player_phone || null,
            checkedInBy: userId,
          });
          const canonicalCheckin = canonicalResult?.checkin;
          if (!canonicalCheckin) return errorResponse('Incheckningen kunde inte slutföras', 500);
          await markSessionRegistrationCheckedIn(serviceClient, {
            venueId: venue_id,
            entryType: canonicalCheckin.entry_type,
            entitlementId: canonicalCheckin.entitlement_id,
          });
          await markBookingParticipantCheckedIn(serviceClient, venue_id, bookingParticipantId);
          return jsonResponse({
            ...canonicalCheckin,
            already_checked_in: Boolean(canonicalResult?.already_checked_in),
            consumption: canonicalResult?.consumption || null,
          }, canonicalResult?.already_checked_in ? 200 : 201);
        } catch (canonicalError) {
          return errorResponse((canonicalError as Error).message || 'Rättigheten kunde inte användas', 409);
        }
      }

      if (entitlement_id || target_user_id || player_phone || player_name) {
        const existingCheckin = await findActiveCheckin(serviceClient, {
          venueId: venue_id,
          today,
          entryType: entry_type,
          entitlementId: entitlement_id,
          targetUserId: target_user_id,
          playerPhone: player_phone,
          playerName: player_name,
        });
        if (existingCheckin) {
          await markSessionRegistrationCheckedIn(serviceClient, {
            venueId: venue_id,
            entryType: existingCheckin.entry_type,
            entitlementId: existingCheckin.entitlement_id,
          });
          return jsonResponse({ ...existingCheckin, already_checked_in: true });
        }
      }

      const { data, error: insertErr } = await client
        .from('venue_checkins')
        .insert({
          venue_id,
          customer_id: customerId,
          user_id: target_user_id || null,
          dependent_participant_id: dependentParticipantId,
          player_name: player_name || null,
          player_phone: player_phone || null,
          entry_type,
          entitlement_id: entitlement_id || null,
          checked_in_by: userId,
          session_date: today,
        })
        .select()
        .single();

      if (insertErr) {
        if (insertErr.code === '23505' && (entitlement_id || target_user_id)) {
          const retry = await findActiveCheckin(serviceClient, {
            venueId: venue_id,
            today,
            entryType: entry_type,
            entitlementId: entitlement_id,
            targetUserId: target_user_id,
          });
          if (retry) {
            await markSessionRegistrationCheckedIn(serviceClient, {
              venueId: venue_id,
              entryType: retry.entry_type,
              entitlementId: retry.entitlement_id,
            });
            return jsonResponse({ ...retry, already_checked_in: true });
          }
        }
        return errorResponse(insertErr.message);
      }
      await markSessionRegistrationCheckedIn(serviceClient, {
        venueId: venue_id,
        entryType: data.entry_type,
        entitlementId: data.entitlement_id,
      });
      return jsonResponse({ ...data, already_checked_in: false });
    }

    // GET /api-checkins/today — get today's venue checkins
    if (req.method === 'GET' && path === 'today') {
      const { userId, error } = await getAuthenticatedClient(req);
      if (error || !userId) return errorResponse(error || 'Unauthorized', 401);

      const venueId = url.searchParams.get('venueId');
      if (!venueId) return errorResponse('Missing venueId');
      const serviceClient = getServiceClient();
      if (!await canStaffOperateVenue(serviceClient, userId, venueId)) return errorResponse('Forbidden', 403);

      const nowSthlm = DateTime.now().setZone('Europe/Stockholm');
      const today = nowSthlm.toISODate()!;
      const todayStartUtc = nowSthlm.startOf('day').toUTC().toISO()!;
      const todayEndUtc = nowSthlm.plus({ days: 1 }).startOf('day').toUTC().toISO()!;
      const { data, error: qErr } = await serviceClient
        .from('venue_checkins')
        .select('id, venue_id, customer_id, user_id, player_name, entry_type, checked_in_at, entitlement_id')
        .eq('venue_id', venueId)
        .or(`session_date.eq.${today},and(session_date.is.null,checked_in_at.gte.${todayStartUtc},checked_in_at.lt.${todayEndUtc})`)
        .is('checked_out_at', null)
        .order('checked_in_at', { ascending: false });

      if (qErr) return errorResponse(qErr.message);
      const partnerEntitlementIds = (data || [])
        .filter((row) => row.entry_type === 'partner_access' && row.entitlement_id)
        .map((row) => row.entitlement_id);
      const { data: partnerRights, error: partnerRightsError } = partnerEntitlementIds.length
        ? await serviceClient.from('access_entitlements')
          .select('id, access_reason, activity_session_id, partner_program_id')
          .eq('venue_id', venueId)
          .eq('entitlement_type', 'partner_access')
          .in('id', partnerEntitlementIds)
        : { data: [], error: null };
      if (partnerRightsError) return errorResponse(partnerRightsError.message);
      const sessionIds = [...new Set((partnerRights || []).map((right) => right.activity_session_id).filter(Boolean))];
      const programIds = [...new Set((partnerRights || []).map((right) => right.partner_program_id).filter(Boolean))];
      const [{ data: sessions, error: sessionsError }, { data: programs, error: programsError }] = await Promise.all([
        sessionIds.length
          ? serviceClient.from('activity_sessions').select('id, name').eq('venue_id', venueId).in('id', sessionIds)
          : Promise.resolve({ data: [], error: null }),
        programIds.length
          ? serviceClient.from('partner_programs').select('id, desk_label').in('id', programIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (sessionsError || programsError) return errorResponse(sessionsError?.message || programsError?.message || 'Desk projection unavailable');
      const rightById = new Map((partnerRights || []).map((right) => [right.id, right]));
      const sessionById = new Map((sessions || []).map((session) => [session.id, session]));
      const programById = new Map((programs || []).map((program) => [program.id, program]));
      return jsonResponse((data || []).map((row) => {
        const right = rightById.get(row.entitlement_id);
        if (!right) return row;
        const deskLabel = programById.get(right.partner_program_id)?.desk_label;
        return {
          ...row,
          access_reason: right.access_reason || (deskLabel ? `Ingår via ${deskLabel}` : 'Partner'),
          activity_name: sessionById.get(right.activity_session_id)?.name || null,
        };
      }), 200, 5);
    }

    // GET /api-checkins/ops?venueId=X — deterministic desk attention signals.
    if (req.method === 'GET' && path === 'ops') {
      const { userId, error } = await getAuthenticatedClient(req);
      if (error || !userId) return errorResponse(error || 'Unauthorized', 401);

      const venueId = url.searchParams.get('venueId');
      if (!venueId) return errorResponse('Missing venueId');

      const serviceClient = getServiceClient();
      const canOperate = await canStaffOperateVenue(serviceClient, userId, venueId);
      if (!canOperate) return errorResponse('Forbidden', 403);

      const { today } = stockholmNow();
      const { data: staleRows, error: staleErr } = await serviceClient
        .from('venue_checkins')
        .select('id, player_name, entry_type, checked_in_at, session_date')
        .eq('venue_id', venueId)
        .lt('session_date', today)
        .is('checked_out_at', null)
        .order('checked_in_at', { ascending: false })
        .limit(20);
      if (staleErr) return errorResponse(staleErr.message, 500);

      const { data: unclearRows, error: unclearErr } = await serviceClient
        .from('venue_checkins')
        .select('id, player_name, entry_type, checked_in_at')
        .eq('venue_id', venueId)
        .eq('session_date', today)
        .is('entitlement_id', null)
        .is('checked_out_at', null)
        .order('checked_in_at', { ascending: false })
        .limit(20);
      if (unclearErr) return errorResponse(unclearErr.message, 500);

      return jsonResponse({
        stale_checkins: staleRows || [],
        unclear_checkins: unclearRows || [],
      }, 200, 10);
    }

    // ── Legacy event-based endpoints ──

    const { client: authClient, userId: authUserId, error: authError } = await getAuthenticatedClient(req);
    if (authError || !authClient || !authUserId) return errorResponse(authError || 'Unauthorized', 401);

    if (req.method === 'GET' && path === 'event') {
      const eventId = url.searchParams.get('eventId');
      const date = url.searchParams.get('date');
      if (!eventId || !date) return errorResponse('Missing eventId or date');

      const { data, error: qErr } = await authClient.from('event_checkins')
        .select('*').eq('event_id', eventId).eq('session_date', date);
      if (qErr) return errorResponse(qErr.message);
      return jsonResponse(data, 200, 5);
    }

    if (req.method === 'GET' && path === 'players') {
      const eventId = url.searchParams.get('eventId');
      if (!eventId) return errorResponse('Missing eventId');

      const serviceClient = getServiceClient();
      const { data: event, error: eventErr } = await serviceClient
        .from('events')
        .select('venue_id')
        .eq('id', eventId)
        .maybeSingle();
      if (eventErr) return errorResponse(eventErr.message, 500);
      if (!event?.venue_id) return errorResponse('Event not found', 404);

      const canOperate = await canStaffOperateVenue(serviceClient, authUserId, event.venue_id);
      if (!canOperate) return errorResponse('Forbidden', 403);

      const { data, error: qErr } = await serviceClient.from('players')
        .select('*, team:teams(id, name, color)')
        .eq('event_id', eventId).order('name');
      if (qErr) return errorResponse(qErr.message);
      return jsonResponse(data, 200, 15);
    }

    if (req.method === 'POST' && path === 'toggle') {
      const body = await req.json();
      const { eventId, playerId, sessionDate, checkedIn } = body;
      if (!eventId || !playerId || !sessionDate) return errorResponse('Missing fields');

      if (checkedIn) {
        const { error: upErr } = await authClient.from('event_checkins').upsert(
          { event_id: eventId, player_id: playerId, session_date: sessionDate, checked_in: true, checked_in_at: new Date().toISOString() },
          { onConflict: 'event_id,player_id,session_date' }
        );
        if (upErr) return errorResponse(upErr.message);
      } else {
        const { error: upErr } = await authClient.from('event_checkins')
          .update({ checked_in: false, checked_in_at: null })
          .eq('event_id', eventId).eq('player_id', playerId).eq('session_date', sessionDate);
        if (upErr) return errorResponse(upErr.message);
      }

      return jsonResponse({ success: true });
    }

    return errorResponse('Not found', 404);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
};

const localFunctionPort = Number(Deno.env.get('FUNCTION_PORT') || 0);
if (localFunctionPort > 0) Deno.serve({ port: localFunctionPort }, checkinsHandler);
else Deno.serve(checkinsHandler);
