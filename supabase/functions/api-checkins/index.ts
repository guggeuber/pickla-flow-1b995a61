import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import { DateTime } from 'https://esm.sh/luxon@3.5.0';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.split('/').pop() || '';

  try {
    // POST /api-checkins/code — self-service check-in via booking access code (no auth required)
    if (req.method === 'POST' && path === 'code') {
      const body = await req.json();
      const { venue_id, access_code } = body;
      if (!venue_id || !access_code) return errorResponse('Missing venue_id or access_code');

      const safeCode = String(access_code).trim();
      if (!/^\d{4}$/.test(safeCode)) return errorResponse('Ogiltig kod', 400);

      const serviceClient = getServiceClient();

      // Current time in Europe/Stockholm — used for all time comparisons
      const nowSthlm = DateTime.now().setZone('Europe/Stockholm');
      const todaySthlm = nowSthlm.toISODate(); // YYYY-MM-DD in Stockholm
      const todayStartUtc = nowSthlm.startOf('day').toUTC().toISO()!;
      const todayEndUtc = nowSthlm.endOf('day').toUTC().toISO()!;

      const { data: bookings, error: bErr } = await serviceClient
        .from('bookings')
        .select('id, user_id, venue_id, start_time, end_time, status, booking_ref, notes, venue_courts(name, court_number)')
        .eq('venue_id', venue_id)
        .eq('access_code', safeCode)
        .eq('status', 'confirmed')
        .gte('start_time', todayStartUtc)
        .lte('start_time', todayEndUtc)
        .order('start_time', { ascending: true });

      if (bErr || !bookings?.length) return errorResponse('Ogiltig eller utgången kod', 404);
      const booking = bookings[0];

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

      const bookingIds = bookings.map((b: any) => b.id).filter(Boolean);
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
      const customerName = ((booking as any).notes || '').split(' | ')[0].trim();

      const checkinRows = bookings.filter((b: any) => !existingIds.has(b.id)).map((b: any) => ({
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
          courts: bookings.map((b: any) => b.venue_courts).filter(Boolean),
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

      // Get profile
      const { data: profile } = await serviceClient
        .from('player_profiles')
        .select('id, auth_user_id, display_name, phone, avatar_url')
        .eq('auth_user_id', targetUserId)
        .maybeSingle();

      if (!profile) return errorResponse('User not found', 404);

      const today = DateTime.now().setZone('Europe/Stockholm').toISODate()!;
      const entitlements: any[] = [];

      // Check membership
      const { data: membership } = await serviceClient
        .from('memberships')
        .select('id, tier_id, status, membership_tiers(name, color)')
        .eq('user_id', targetUserId)
        .eq('venue_id', venue_id)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();

      if (membership) {
        entitlements.push({
          type: 'membership',
          id: membership.id,
          label: (membership as any).membership_tiers?.name || 'Medlem',
          color: (membership as any).membership_tiers?.color || '#4CAF50',
        });
      }

      // Check day pass
      const { data: dayPass } = await serviceClient
        .from('day_passes')
        .select('id, price, status')
        .eq('user_id', targetUserId)
        .eq('venue_id', venue_id)
        .eq('valid_date', today)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();

      if (dayPass) {
        entitlements.push({
          type: 'day_pass',
          id: dayPass.id,
          label: `Dagspass (${dayPass.price || 0} kr)`,
        });
      }

      // Check booking: same window as booking code check-in, 30 min before start until end.
      const nowSthlm = DateTime.now().setZone('Europe/Stockholm');
      const windowEndIso = nowSthlm.plus({ minutes: 30 }).toUTC().toISO()!;
      const nowIso = nowSthlm.toUTC().toISO()!;
      const { data: booking } = await serviceClient
        .from('bookings')
        .select('id, start_time, end_time, venue_courts(name)')
        .eq('user_id', targetUserId)
        .eq('venue_id', venue_id)
        .eq('status', 'confirmed')
        .lte('start_time', windowEndIso)
        .gte('end_time', nowIso)
        .order('start_time', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (booking) {
        entitlements.push({
          type: 'booking',
          id: booking.id,
          label: `Bokning: ${(booking as any).venue_courts?.name || 'Bana'}`,
        });
      }

      // Already checked in?
      const { data: existingCheckin } = await serviceClient
        .from('venue_checkins')
        .select('id')
        .eq('user_id', targetUserId)
        .eq('venue_id', venue_id)
        .eq('session_date', today)
        .is('checked_out_at', null)
        .limit(1)
        .maybeSingle();

      return jsonResponse({
        profile_id: profile.id,
        user_id: profile.auth_user_id,
        display_name: profile.display_name,
        phone: profile.phone,
        avatar_url: profile.avatar_url,
        entitlements,
        already_checked_in: !!existingCheckin,
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
        .select('id, auth_user_id, display_name, phone, avatar_url')
        .or(`display_name.ilike.%${query}%,phone.ilike.%${query}%`)
        .limit(10);

      if (!profiles?.length) {
        return jsonResponse({ results: [] });
      }

      const today = DateTime.now().setZone('Europe/Stockholm').toISODate()!;
      const results = [];

      for (const profile of profiles) {
        const uid = profile.auth_user_id;
        const entitlements: any[] = [];

        // Check active membership
        const { data: membership } = await serviceClient
          .from('memberships')
          .select('id, tier_id, status, membership_tiers(name, color)')
          .eq('user_id', uid)
          .eq('venue_id', venue_id)
          .eq('status', 'active')
          .limit(1)
          .maybeSingle();

        if (membership) {
          entitlements.push({
            type: 'membership',
            id: membership.id,
            label: (membership as any).membership_tiers?.name || 'Medlem',
            color: (membership as any).membership_tiers?.color || '#4CAF50',
          });
        }

        // Check today's day pass
        const { data: dayPass } = await serviceClient
          .from('day_passes')
          .select('id, price, status')
          .eq('user_id', uid)
          .eq('venue_id', venue_id)
          .eq('valid_date', today)
          .eq('status', 'active')
          .limit(1)
          .maybeSingle();

        if (dayPass) {
          entitlements.push({
            type: 'day_pass',
            id: dayPass.id,
            label: `Dagspass (${dayPass.price || 0} kr)`,
          });
        }

        // Check today's booking
        const nowIso = new Date().toISOString();
        const { data: booking } = await serviceClient
          .from('bookings')
          .select('id, start_time, end_time, venue_courts(name)')
          .eq('user_id', uid)
          .eq('venue_id', venue_id)
          .eq('status', 'confirmed')
          .lte('start_time', nowIso)
          .gte('end_time', nowIso)
          .limit(1)
          .maybeSingle();

        if (booking) {
          entitlements.push({
            type: 'booking',
            id: booking.id,
            label: `Bokning: ${(booking as any).venue_courts?.name || 'Bana'}`,
          });
        }

        // Check if already checked in today
        const { data: existingCheckin } = await serviceClient
          .from('venue_checkins')
          .select('id')
          .eq('user_id', uid)
          .eq('venue_id', venue_id)
          .eq('session_date', today)
          .is('checked_out_at', null)
          .limit(1)
          .maybeSingle();

        results.push({
          profile_id: profile.id,
          user_id: uid,
          display_name: profile.display_name,
          phone: profile.phone,
          avatar_url: profile.avatar_url,
          entitlements,
          already_checked_in: !!existingCheckin,
        });
      }

      return jsonResponse({ results });
    }

    // POST /api-checkins/checkin — perform the check-in
    if (req.method === 'POST' && path === 'checkin') {
      const { client, userId, error } = await getAuthenticatedClient(req);
      if (error || !client || !userId) return errorResponse(error || 'Unauthorized', 401);

      const body = await req.json();
      const { venue_id, target_user_id, entry_type, entitlement_id, player_name, player_phone } = body;
      if (!venue_id || !entry_type) return errorResponse('Missing required fields');

      const today = DateTime.now().setZone('Europe/Stockholm').toISODate()!;
      if (entitlement_id || target_user_id || player_phone || player_name) {
        let existingQuery = client
          .from('venue_checkins')
          .select('*')
          .eq('venue_id', venue_id)
          .eq('entry_type', entry_type)
          .eq('session_date', today)
          .is('checked_out_at', null)
          .limit(1);

        if (entitlement_id) {
          existingQuery = existingQuery.eq('entitlement_id', entitlement_id);
        } else if (target_user_id) {
          existingQuery = existingQuery.eq('user_id', target_user_id);
        } else if (player_phone) {
          existingQuery = existingQuery.eq('player_phone', player_phone);
        } else if (player_name) {
          existingQuery = existingQuery.eq('player_name', player_name);
        }

        const { data: existingCheckin } = await existingQuery.maybeSingle();
        if (existingCheckin) return jsonResponse(existingCheckin);
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
          let retryQuery = client
            .from('venue_checkins')
            .select('*')
            .eq('venue_id', venue_id)
            .eq('entry_type', entry_type)
            .eq('session_date', today)
            .is('checked_out_at', null)
            .limit(1);
          retryQuery = entitlement_id
            ? retryQuery.eq('entitlement_id', entitlement_id)
            : retryQuery.eq('user_id', target_user_id);
          const { data: retry } = await retryQuery.maybeSingle();
          if (retry) return jsonResponse(retry);
        }
        return errorResponse(insertErr.message);
      }
      return jsonResponse(data);
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
