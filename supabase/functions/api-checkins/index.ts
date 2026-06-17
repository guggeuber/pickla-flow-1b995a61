import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import { findAuthUserByEmail } from '../_shared/bookings.ts';
import { DateTime } from 'https://esm.sh/luxon@3.5.0';

const STOCKHOLM_ZONE = 'Europe/Stockholm';

const entitlementPriority: Record<string, number> = {
  booking: 1,
  session_ticket: 2,
  activity_registration: 2,
  membership: 3,
  membership_access: 3,
  day_access: 4,
  day_pass: 5,
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
    .select('id, auth_user_id, display_name, first_name, last_name, phone, avatar_url')
    .eq('auth_user_id', userId)
    .maybeSingle();
  return data;
}

function profileName(profile: any) {
  return [profile?.first_name, profile?.last_name].map((part) => String(part || '').trim()).filter(Boolean).join(' ') ||
    profile?.display_name ||
    'Spelare';
}

async function resolveUserAccess(serviceClient: any, venueId: string, targetUserId: string) {
  const { today, nowIso, bookingWindowEndIso } = stockholmNow();
  const profile = await getProfile(serviceClient, targetUserId);
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

  const { data: registrations } = await serviceClient
    .from('session_registrations')
    .select('id, activity_session_id, session_date, status, price_paid_sek, activity_sessions(name, session_type, start_time, end_time)')
    .eq('user_id', targetUserId)
    .eq('venue_id', venueId)
    .eq('session_date', today)
    .in('status', ['confirmed', 'checked_in'])
    .order('created_at', { ascending: false });

  const registration = (registrations || []).find((row: any) => {
    const session = row.activity_sessions;
    if (!session?.start_time || !session?.end_time) return true;
    const start = DateTime.fromISO(`${today}T${String(session.start_time).slice(0, 5)}:00`, { zone: STOCKHOLM_ZONE });
    const end = DateTime.fromISO(`${today}T${String(session.end_time).slice(0, 5)}:00`, { zone: STOCKHOLM_ZONE });
    if (!start.isValid || !end.isValid) return true;
    const now = DateTime.now().setZone(STOCKHOLM_ZONE);
    return now >= start.minus({ minutes: 30 }) && now <= end;
  });

  if (registration) {
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

  const { data: accessRows } = await serviceClient
    .from('access_entitlements')
    .select('id, entitlement_type, source_type, source_id, valid_date, valid_from, valid_until, activity_session_id, session_date, includes_session_types, metadata')
    .eq('user_id', targetUserId)
    .eq('venue_id', venueId)
    .eq('status', 'active')
    .or(`valid_date.eq.${today},valid_date.is.null`);

  for (const access of accessRows || []) {
    const validFrom = access.valid_from ? DateTime.fromISO(access.valid_from, { zone: 'utc' }).toMillis() : null;
    const validUntil = access.valid_until ? DateTime.fromISO(access.valid_until, { zone: 'utc' }).toMillis() : null;
    const nowMs = DateTime.now().toMillis();
    if (validFrom && nowMs < validFrom) continue;
    if (validUntil && nowMs > validUntil) continue;
    if (access.valid_date && access.valid_date !== today) continue;

    entitlements.push({
      type: access.entitlement_type,
      id: access.id,
      source_type: access.source_type,
      source_id: access.source_id,
      label: access.entitlement_type === 'day_access'
        ? 'Dagstillgång'
        : access.metadata?.session_name || 'Aktivitetsbiljett',
      valid_date: access.valid_date,
      activity_session_id: access.activity_session_id,
      session_date: access.session_date,
      includes_session_types: access.includes_session_types || [],
      priority: entitlementPriority[access.entitlement_type] || 50,
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

  entitlements.sort((a, b) => (a.priority || 99) - (b.priority || 99));

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
    .order('start_time', { ascending: true })
    .limit(20);

  const now = DateTime.now().setZone(STOCKHOLM_ZONE);
  const weekday = now.weekday % 7;
  const session = (sessions || []).find((row: any) => {
    if (row.session_date && row.session_date !== today) return false;
    if (!row.session_date && (!Array.isArray(row.recurrence_days) || !row.recurrence_days.includes(weekday))) return false;
    if (!row.end_time) return true;
    const [hour = 0, minute = 0] = String(row.end_time).slice(0, 5).split(':').map(Number);
    return now.set({ hour, minute, second: 0, millisecond: 0 }) > now;
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.split('/').pop() || '';

  try {
    // POST /api-checkins/self — customer-led venue QR check-in.
    if (req.method === 'POST' && path === 'self') {
      const { client, userId, error } = await getAuthenticatedClient(req);
      if (error || !client || !userId) return errorResponse(error || 'Unauthorized', 401);

      const body = await req.json();
      const serviceClient = getServiceClient();
      const venue = await resolveVenueForSelfCheckin(serviceClient, {
        venueId: body.venue_id || body.venueId || null,
        venueSlug: body.venue_slug || body.venueSlug || null,
      });
      if (!venue?.id) return errorResponse('Venue not found', 404);

      const access = await resolveUserAccess(serviceClient, venue.id, userId);
      const profile = access.profile;

      if (access.already_checked_in && access.existingCheckin) {
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

      const best = access.best;
      const playerName = profileName(profile);
      const existingCheckin = await findActiveCheckin(serviceClient, {
        venueId: venue.id,
        today: access.today,
        entryType: best.type,
        entitlementId: best.id,
        targetUserId: userId,
      });

      if (existingCheckin) {
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
        .select('id, user_id, venue_id, venue_court_id, start_time, end_time, status, booking_ref, notes, venue_courts(id, name, court_number, sport_type)')
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

      const checkinRows = groupBookings.filter((b: any) => !existingIds.has(b.id)).map((b: any) => ({
        venue_id,
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
      const { venue_id, target_user_id, player_name, player_phone } = body;
      let { entry_type, entitlement_id } = body;
      if (!venue_id || !entry_type) return errorResponse('Missing required fields');

      const serviceClient = getServiceClient();
      const { today } = stockholmNow();

      if (target_user_id) {
        const access = await resolveUserAccess(serviceClient, venue_id, target_user_id);

        if (access.already_checked_in && access.existingCheckin) {
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
        if (existingCheckin) return jsonResponse({ ...existingCheckin, already_checked_in: true });
      }

      const { data, error: insertErr } = await client
        .from('venue_checkins')
        .insert({
          venue_id,
          user_id: target_user_id || null,
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
          if (retry) return jsonResponse({ ...retry, already_checked_in: true });
        }
        return errorResponse(insertErr.message);
      }
      return jsonResponse({ ...data, already_checked_in: false });
    }

    // GET /api-checkins/today — get today's venue checkins
    if (req.method === 'GET' && path === 'today') {
      const { client, userId, error } = await getAuthenticatedClient(req);
      if (error || !client || !userId) return errorResponse(error || 'Unauthorized', 401);

      const venueId = url.searchParams.get('venueId');
      if (!venueId) return errorResponse('Missing venueId');

      const today = DateTime.now().setZone('Europe/Stockholm').toISODate()!;
      const { data, error: qErr } = await client
        .from('venue_checkins')
        .select('*')
        .eq('venue_id', venueId)
        .eq('session_date', today)
        .is('checked_out_at', null)
        .order('checked_in_at', { ascending: false });

      if (qErr) return errorResponse(qErr.message);
      return jsonResponse(data, 200, 5);
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

      const { data, error: qErr } = await authClient.from('players')
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
});
