import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient } from '../_shared/auth.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

async function getOrCreatePublicBookingUserId(admin: any): Promise<string> {
  const publicEmail = 'guest-booking@pickla.local';

  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) break;

    const found = data?.users?.find((u: any) => u.email?.toLowerCase() === publicEmail);
    if (found?.id) return found.id;

    if (!data?.users || data.users.length < 200) break;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: publicEmail,
    email_confirm: true,
    user_metadata: { display_name: 'Public Booking Guest' },
  });

  if (error || !data?.user?.id) {
    throw new Error('Kunde inte skapa gästanvändare för bokning');
  }

  return data.user.id;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.split('/').pop() || '';

  // ── Public endpoint: venue by slug (no auth required) ──
  if (req.method === 'GET' && path === 'public-venue') {
    const slug = url.searchParams.get('slug');
    if (!slug) return errorResponse('Missing slug');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: venue, error: vErr } = await admin.from('venues')
      .select('id, name, slug, description, address, city, logo_url, cover_image_url, primary_color, secondary_color, phone, email, website_url, status')
      .eq('slug', slug)
      .eq('is_public', true)
      .single();

    if (vErr || !venue) return errorResponse('Venue not found', 404);

    // Get opening hours
    const { data: hours } = await admin.from('opening_hours')
      .select('day_of_week, open_time, close_time, is_closed')
      .eq('venue_id', venue.id)
      .order('day_of_week');

    // Get active events
    const { data: events } = await admin.from('events')
      .select('id, name, display_name, event_type, format, start_date, end_date, status, logo_url, primary_color')
      .eq('venue_id', venue.id)
      .eq('is_public', true)
      .in('status', ['upcoming', 'active', 'live'])
      .order('start_date')
      .limit(5);

    // Get community/social links
    const { data: links } = await admin.from('venue_links')
      .select('id, title, description, url, icon, color, member_count')
      .eq('venue_id', venue.id)
      .eq('is_active', true)
      .order('sort_order');

    return jsonResponse({ venue, openingHours: hours || [], events: events || [], links: links || [] }, 200, 60);
  }

  // ── Public endpoint: booking by ref ──
  if (req.method === 'GET' && path === 'public-booking') {
    const ref = url.searchParams.get('ref');
    if (!ref) return errorResponse('Missing ref');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    // Get all bookings with same notes (grouped booking) or single
    const { data: booking } = await admin.from('bookings')
      .select('id, booking_ref, venue_court_id, start_time, end_time, total_price, status, notes, venue_id, venue_courts(name, court_number)')
      .eq('booking_ref', ref).single();

    if (!booking) return errorResponse('Booking not found', 404);

    // Get venue info
    const { data: venue } = await admin.from('venues')
      .select('name, slug, address, city, logo_url').eq('id', booking.venue_id).single();

    // Find sibling bookings (same time + same notes = same group booking)
    const { data: siblings } = await admin.from('bookings')
      .select('id, booking_ref, venue_court_id, start_time, end_time, total_price, venue_courts(name, court_number)')
      .eq('venue_id', booking.venue_id)
      .eq('start_time', booking.start_time)
      .eq('end_time', booking.end_time)
      .eq('notes', booking.notes)
      .neq('status', 'cancelled');

    return jsonResponse({
      booking,
      venue,
      courts: (siblings || [booking]).map((b: any) => ({
        ref: b.booking_ref,
        court_name: b.venue_courts?.name,
        price: b.total_price,
      })),
      totalPrice: (siblings || [booking]).reduce((s: number, b: any) => s + (b.total_price || 0), 0),
    }, 200, 30);
  }

  // ── Public endpoint: available courts for a venue ──
  if (req.method === 'GET' && path === 'public-courts') {
    const venueSlug = url.searchParams.get('slug');
    const date = url.searchParams.get('date'); // YYYY-MM-DD
    if (!venueSlug || !date) return errorResponse('Missing slug or date');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: venue } = await admin.from('venues')
      .select('id, name').eq('slug', venueSlug).eq('is_public', true).single();
    if (!venue) return errorResponse('Venue not found', 404);

    // Get courts
    const { data: courts } = await admin.from('venue_courts')
      .select('id, name, court_number, court_type, hourly_rate, is_available')
      .eq('venue_id', venue.id).eq('is_available', true).order('court_number');

    // Get opening hours for requested day
    const dayOfWeek = new Date(date + 'T12:00:00Z').getUTCDay();
    const { data: hours } = await admin.from('opening_hours')
      .select('open_time, close_time, is_closed')
      .eq('venue_id', venue.id).eq('day_of_week', dayOfWeek).maybeSingle();

    // Get existing bookings for the date
    const start = `${date}T00:00:00.000Z`;
    const end = `${date}T23:59:59.999Z`;
    const { data: bookings } = await admin.from('bookings')
      .select('venue_court_id, start_time, end_time')
      .eq('venue_id', venue.id)
      .neq('status', 'cancelled')
      .gte('start_time', start).lte('start_time', end);

    return jsonResponse({
      venue: { id: venue.id, name: venue.name },
      courts: courts || [],
      openingHours: hours || null,
      bookings: (bookings || []).map((b: any) => ({
        court_id: b.venue_court_id,
        start: b.start_time,
        end: b.end_time,
      })),
    }, 200, 10);
  }

  if (req.method === 'POST' && path === 'public-book') {
    const body = await req.json();
    const { slug, courtIds, date, startTime, endTime, name, phone } = body;

    const safeName = typeof name === 'string' ? name.trim() : '';
    const safePhone = typeof phone === 'string'
      ? phone.replace(/[^\d+()\-\s]/g, '').trim()
      : '';

    if (!slug || !courtIds?.length || !date || !startTime || !endTime || !safeName || !safePhone) {
      return errorResponse('Fyll i alla fält');
    }
    if (safeName.length > 100 || safePhone.length < 6 || safePhone.length > 20) {
      return errorResponse('Ogiltiga uppgifter', 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: venue } = await admin.from('venues')
      .select('id').eq('slug', slug).eq('is_public', true).single();
    if (!venue) return errorResponse('Venue not found', 404);

    // Build ISO timestamps
    const startISO = `${date}T${startTime}:00.000Z`;
    const endISO = `${date}T${endTime}:00.000Z`;

    // Check conflicts for all courts
    for (const courtId of courtIds) {
      const { data: conflicts } = await admin.from('bookings')
        .select('id').eq('venue_court_id', courtId)
        .neq('status', 'cancelled')
        .lt('start_time', endISO).gt('end_time', startISO);
      if (conflicts && conflicts.length > 0) {
        return errorResponse('En eller flera banor är redan bokade för denna tid', 409);
      }
    }

    const publicUserId = await getOrCreatePublicBookingUserId(admin);

    const bookings = [];
    for (const courtId of courtIds) {
      const { data: court } = await admin.from('venue_courts')
        .select('hourly_rate').eq('id', courtId).single();
      const hourlyRate = court?.hourly_rate || 350;
      const durationHours = (new Date(endISO).getTime() - new Date(startISO).getTime()) / 3600000;
      const price = Math.round(hourlyRate * durationHours);

      const { data: booking, error: bErr } = await admin.from('bookings').insert({
        venue_id: venue.id,
        venue_court_id: courtId,
        user_id: publicUserId,
        booked_by: null,
        start_time: startISO,
        end_time: endISO,
        total_price: price,
        status: 'confirmed',
        notes: `${safeName} | ${safePhone}`,
      }).select().single();

      if (bErr) return errorResponse(bErr.message);
      bookings.push(booking);
    }

    return jsonResponse({ bookings, count: bookings.length }, 201);
  }

  try {
    const { client, userId, error } = await getAuthenticatedClient(req);
    if (error || !client || !userId) return errorResponse(error || 'Unauthorized', 401);

    // GET /api-bookings/venue?venueId=X&date=YYYY-MM-DD
    if (req.method === 'GET' && path === 'venue') {
      const venueId = url.searchParams.get('venueId');
      const date = url.searchParams.get('date');
      if (!venueId) return errorResponse('Missing venueId');

      let query = client.from('bookings')
        .select('*, venue_courts(name, court_number)')
        .eq('venue_id', venueId)
        .order('start_time');

      if (date) {
        const start = `${date}T00:00:00.000Z`;
        const end = `${date}T23:59:59.999Z`;
        query = query.gte('start_time', start).lte('start_time', end);
      }

      const { data, error: qErr } = await query;
      if (qErr) return errorResponse(qErr.message);

      return jsonResponse(data, 200, 5);
    }

    // GET /api-bookings/revenue?venueId=X&date=YYYY-MM-DD
    if (req.method === 'GET' && path === 'revenue') {
      const venueId = url.searchParams.get('venueId');
      const date = url.searchParams.get('date');
      if (!venueId || !date) return errorResponse('Missing venueId or date');

      const start = `${date}T00:00:00.000Z`;
      const end = `${date}T23:59:59.999Z`;

      const [bookingsRes, passesRes] = await Promise.all([
        client.from('bookings').select('total_price').eq('venue_id', venueId)
          .gte('start_time', start).lte('start_time', end).in('status', ['confirmed', 'completed']),
        client.from('day_passes').select('price').eq('venue_id', venueId)
          .eq('valid_date', date).eq('status', 'active'),
      ]);

      const bookingRevenue = (bookingsRes.data || []).reduce((s: number, b: any) => s + (b.total_price || 0), 0);
      const passRevenue = (passesRes.data || []).reduce((s: number, p: any) => s + (p.price || 0), 0);

      return jsonResponse({
        total: bookingRevenue + passRevenue,
        bookings: bookingRevenue,
        dayPasses: passRevenue,
        bookingCount: bookingsRes.data?.length || 0,
        passCount: passesRes.data?.length || 0,
      }, 200, 15);
    }

    // GET /api-bookings/courts?venueId=X
    if (req.method === 'GET' && path === 'courts') {
      const venueId = url.searchParams.get('venueId');
      if (!venueId) return errorResponse('Missing venueId');

      const { data, error: qErr } = await client.from('venue_courts')
        .select('*').eq('venue_id', venueId).order('court_number');
      if (qErr) return errorResponse(qErr.message);

      return jsonResponse(data, 200, 30);
    }

    // POST /api-bookings/create
    if (req.method === 'POST' && path === 'create') {
      const body = await req.json();
      const { venueId, venueCourtId, startTime, endTime, totalPrice, bookedBy, notes } = body;
      if (!venueId || !venueCourtId || !startTime || !endTime) {
        return errorResponse('Missing required fields');
      }

      const { data: conflicts } = await client.from('bookings')
        .select('id').eq('venue_court_id', venueCourtId)
        .neq('status', 'cancelled')
        .lt('start_time', endTime).gt('end_time', startTime);

      if (conflicts && conflicts.length > 0) {
        return errorResponse('Court is already booked for this time slot', 409);
      }

      const { data, error: insertErr } = await client.from('bookings').insert({
        venue_id: venueId,
        venue_court_id: venueCourtId,
        user_id: userId,
        booked_by: bookedBy || userId,
        start_time: startTime,
        end_time: endTime,
        total_price: totalPrice,
        status: 'confirmed',
        notes,
      }).select().single();

      if (insertErr) return errorResponse(insertErr.message);
      return jsonResponse(data, 201);
    }

    // PATCH /api-bookings/update
    if (req.method === 'PATCH' && path === 'update') {
      const body = await req.json();
      const { bookingId, status, notes } = body;
      if (!bookingId) return errorResponse('Missing bookingId');

      const updates: Record<string, any> = {};
      if (status) updates.status = status;
      if (notes !== undefined) updates.notes = notes;

      const { data, error: upErr } = await client.from('bookings')
        .update(updates).eq('id', bookingId).select().single();
      if (upErr) return errorResponse(upErr.message);

      return jsonResponse(data);
    }

    return errorResponse('Not found', 404);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
