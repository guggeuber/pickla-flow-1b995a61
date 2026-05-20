import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient } from '../_shared/auth.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

async function isAdmin(userId: string): Promise<{ ok: boolean; venueId: string | null }> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);

  // Check super_admin
  const { data: superRole } = await admin.from('user_roles')
    .select('id').eq('user_id', userId).eq('role', 'super_admin').maybeSingle();
  if (superRole) {
    const { data: vs } = await admin.from('venue_staff').select('venue_id').eq('user_id', userId).limit(1).maybeSingle();
    return { ok: true, venueId: vs?.venue_id || null };
  }

  // Check venue_admin
  const { data: vs } = await admin.from('venue_staff')
    .select('venue_id').eq('user_id', userId).eq('role', 'venue_admin').eq('is_active', true).limit(1).maybeSingle();
  if (vs) return { ok: true, venueId: vs.venue_id };

  return { ok: false, venueId: null };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.split('/').pop() || '';

  try {
    const { client, userId, error } = await getAuthenticatedClient(req);
    if (error || !client || !userId) return errorResponse(error || 'Unauthorized', 401);

    const { ok, venueId: adminVenueId } = await isAdmin(userId);
    if (!ok) return errorResponse('Forbidden: admin only', 403);

    const venueId = url.searchParams.get('venueId') || adminVenueId;
    if (!venueId) return errorResponse('No venue found', 400);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    // ── CHECK ROLE ──
    if (req.method === 'GET' && path === 'check') {
      // Check if super_admin
      const { data: superRole } = await admin.from('user_roles')
        .select('id').eq('user_id', userId).eq('role', 'super_admin').maybeSingle();
      return jsonResponse({ isAdmin: true, venueId, isSuperAdmin: !!superRole });
    }

    // ── LIST VENUES (super_admin sees all, venue_admin sees own) ──
    if (req.method === 'GET' && path === 'venues') {
      const { data: superRole } = await admin.from('user_roles')
        .select('id').eq('user_id', userId).eq('role', 'super_admin').maybeSingle();

      let venues;
      if (superRole) {
        const { data, error: e } = await admin.from('venues').select('id, name, slug, city, status, logo_url, primary_color').order('name');
        if (e) return errorResponse(e.message);
        venues = data;
      } else {
        const { data: staffVenues } = await admin.from('venue_staff')
          .select('venue_id').eq('user_id', userId).eq('is_active', true);
        const vIds = (staffVenues || []).map((v: any) => v.venue_id);
        const { data, error: e } = await admin.from('venues').select('id, name, slug, city, status, logo_url, primary_color').in('id', vIds).order('name');
        if (e) return errorResponse(e.message);
        venues = data;
      }
      return jsonResponse(venues, 200, 10);
    }

    // ── VENUE STATS (revenue dashboard) ──
    if (req.method === 'GET' && path === 'stats') {
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
      const lastWeekDay = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);

      // Helper to get revenue & bookings for a date
      const getDateStats = async (date: string) => {
        const { data } = await admin.from('bookings')
          .select('id, total_price, status')
          .eq('venue_id', venueId)
          .gte('start_time', `${date}T00:00:00`)
          .lt('start_time', `${date}T23:59:59`);
        const rows = data || [];
        return {
          bookings: rows.length,
          revenue: rows.filter((b: any) => b.status !== 'cancelled')
            .reduce((s: number, b: any) => s + (b.total_price || 0), 0),
        };
      };

      // Helper to get day pass count
      const getPassCount = async (date: string) => {
        const { count } = await admin.from('day_passes')
          .select('id', { count: 'exact', head: true })
          .eq('venue_id', venueId).eq('valid_date', date).eq('status', 'active');
        return count || 0;
      };

      // Fetch all periods in parallel
      const [todayStats, yesterdayStats, lastWeekStats, todayPasses, yesterdayPasses, lastWeekPasses] = await Promise.all([
        getDateStats(today),
        getDateStats(yesterday),
        getDateStats(lastWeekDay),
        getPassCount(today),
        getPassCount(yesterday),
        getPassCount(lastWeekDay),
      ]);

      // Courts count
      const { count: totalCourts } = await admin.from('venue_courts')
        .select('id', { count: 'exact', head: true }).eq('venue_id', venueId);

      // Staff count
      const { count: activeStaff } = await admin.from('venue_staff')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', venueId).eq('is_active', true);

      // Pricing rules count
      const { count: pricingRules } = await admin.from('pricing_rules')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', venueId).eq('is_active', true);

      // Links count
      const { count: linksCount } = await admin.from('venue_links')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', venueId).eq('is_active', true);

      return jsonResponse({
        totalCourts: totalCourts || 0,
        bookingsToday: todayStats.bookings,
        todayRevenue: todayStats.revenue,
        activePasses: todayPasses,
        activeStaff: activeStaff || 0,
        pricingRules: pricingRules || 0,
        linksCount: linksCount || 0,
        // Trend data
        yesterdayRevenue: yesterdayStats.revenue,
        yesterdayBookings: yesterdayStats.bookings,
        yesterdayPasses,
        lastWeekRevenue: lastWeekStats.revenue,
        lastWeekBookings: lastWeekStats.bookings,
        lastWeekPasses,
      }, 200, 5);
    }

    // ── 7-DAY HISTORY (for sparklines) ──
    if (req.method === 'GET' && path === 'history') {
      const days: string[] = [];
      for (let i = 6; i >= 0; i--) {
        days.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
      }
      const results = await Promise.all(days.map(async (date) => {
        const [{ data: bookings }, { count: passes }] = await Promise.all([
          admin.from('bookings').select('total_price, status').eq('venue_id', venueId)
            .gte('start_time', `${date}T00:00:00`).lt('start_time', `${date}T23:59:59`),
          admin.from('day_passes').select('id', { count: 'exact', head: true })
            .eq('venue_id', venueId).eq('valid_date', date).eq('status', 'active'),
        ]);
        const rows = bookings || [];
        return {
          date,
          revenue: rows.filter((b: any) => b.status !== 'cancelled').reduce((s: number, b: any) => s + (b.total_price || 0), 0),
          bookings: rows.length,
          passes: passes || 0,
        };
      }));
      return jsonResponse(results, 200, 5);
    }

    // ── CREATE VENUE (super_admin only) ──
    if (req.method === 'POST' && path === 'venues') {
      const { data: superRole } = await admin.from('user_roles')
        .select('id').eq('user_id', userId).eq('role', 'super_admin').maybeSingle();
      if (!superRole) return errorResponse('Only super_admin can create venues', 403);

      const body = await req.json();
      if (!body.name || !body.slug) return errorResponse('Missing name or slug');

      const { data, error: e } = await admin.from('venues').insert({
        name: body.name,
        slug: body.slug,
        city: body.city || null,
        address: body.address || null,
      }).select().single();
      if (e) return errorResponse(e.message);

      // Add creator as venue_admin staff
      await admin.from('venue_staff').insert({
        venue_id: data.id, user_id: userId, role: 'venue_admin', is_active: true,
      });

      return jsonResponse(data, 201);
    }

    // ── VENUE INFO ──
    if (req.method === 'GET' && path === 'venue') {
      const { data, error: e } = await admin.from('venues').select('*').eq('id', venueId).single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 200, 30);
    }

    if (req.method === 'PATCH' && path === 'venue') {
      const body = await req.json();
      const { data, error: e } = await admin.from('venues').update(body).eq('id', venueId).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data);
    }

    // ── STAFF ──
    if (req.method === 'GET' && path === 'staff') {
      const { data, error: e } = await admin.from('venue_staff')
        .select('id, user_id, role, is_active, created_at')
        .eq('venue_id', venueId).order('created_at');
      if (e) return errorResponse(e.message);

      // Enrich with profile names
      const userIds = (data || []).map((s: any) => s.user_id);
      const { data: profiles } = await admin.from('player_profiles')
        .select('auth_user_id, display_name, phone').in('auth_user_id', userIds);

      const enriched = (data || []).map((s: any) => {
        const p = (profiles || []).find((p: any) => p.auth_user_id === s.user_id);
        return { ...s, display_name: p?.display_name || 'Unknown', phone: p?.phone };
      });

      return jsonResponse(enriched, 200, 10);
    }

    if (req.method === 'POST' && path === 'staff') {
      const { email, role } = await req.json();
      if (!email || !role) return errorResponse('Missing email or role');

      // Find user by email in auth
      const { data: { users }, error: authErr } = await admin.auth.admin.listUsers();
      if (authErr) return errorResponse(authErr.message);
      const user = users.find((u: any) => u.email === email);
      if (!user) return errorResponse('User not found. They must sign up first.', 404);

      const { data, error: e } = await admin.from('venue_staff').insert({
        venue_id: venueId, user_id: user.id, role, is_active: true,
      }).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 201);
    }

    if (req.method === 'PATCH' && path === 'staff') {
      const { staffId, role, isActive } = await req.json();
      if (!staffId) return errorResponse('Missing staffId');
      const updates: any = {};
      if (role) updates.role = role;
      if (isActive !== undefined) updates.is_active = isActive;
      const { data, error: e } = await admin.from('venue_staff').update(updates).eq('id', staffId).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data);
    }

    if (req.method === 'DELETE' && path === 'staff') {
      const staffId = url.searchParams.get('staffId');
      if (!staffId) return errorResponse('Missing staffId');
      const { error: e } = await admin.from('venue_staff').delete().eq('id', staffId);
      if (e) return errorResponse(e.message);
      return jsonResponse({ ok: true });
    }

    // ── COURTS ──
    if (req.method === 'GET' && path === 'courts') {
      const { data, error: e } = await admin.from('venue_courts')
        .select('*').eq('venue_id', venueId).order('court_number');
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 200, 15);
    }

    if (req.method === 'POST' && path === 'courts') {
      const { venueId: _v, ...body } = await req.json();
      const { data, error: e } = await admin.from('venue_courts').insert({
        venue_id: venueId, ...body,
      }).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 201);
    }

    if (req.method === 'PATCH' && path === 'courts') {
      const { courtId, ...updates } = await req.json();
      if (!courtId) return errorResponse('Missing courtId');
      const { data, error: e } = await admin.from('venue_courts').update(updates).eq('id', courtId).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data);
    }

    if (req.method === 'DELETE' && path === 'courts') {
      const courtId = url.searchParams.get('courtId');
      if (!courtId) return errorResponse('Missing courtId');
      const { error: e } = await admin.from('venue_courts').delete().eq('id', courtId);
      if (e) return errorResponse(e.message);
      return jsonResponse({ ok: true });
    }

    // ── DISPLAY DEVICES ──
    if (req.method === 'GET' && path === 'display-devices') {
      const { data, error: e } = await admin
        .from('display_devices')
        .select('*, venue_courts(id, name, court_number, sport_type)')
        .eq('venue_id', venueId)
        .order('created_at', { ascending: false });
      if (e) return errorResponse(e.message);
      return jsonResponse(data || [], 200, 10);
    }

    if (req.method === 'POST' && path === 'display-devices') {
      const body = await req.json();
      const safeName = String(body.name || '').trim();
      if (safeName.length < 2) return errorResponse('Missing name');
      const externalLinks = Array.isArray(body.external_links) ? body.external_links : [];
      const { data, error: e } = await admin
        .from('display_devices')
        .insert({
          venue_id: venueId,
          venue_court_id: body.venue_court_id || null,
          name: safeName.slice(0, 120),
          mode: body.mode || 'resource_home',
          is_active: body.is_active !== false,
          external_links: externalLinks.slice(0, 8),
          instructions: body.instructions ? String(body.instructions).slice(0, 1000) : null,
        })
        .select('*, venue_courts(id, name, court_number, sport_type)')
        .single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 201);
    }

    if (req.method === 'PATCH' && path === 'display-devices') {
      const body = await req.json();
      const deviceId = body.deviceId || body.id;
      if (!deviceId) return errorResponse('Missing deviceId');
      const updates: any = {};
      if (body.name !== undefined) updates.name = String(body.name).trim().slice(0, 120);
      if (body.venue_court_id !== undefined) updates.venue_court_id = body.venue_court_id || null;
      if (body.mode !== undefined) updates.mode = body.mode;
      if (body.is_active !== undefined) updates.is_active = Boolean(body.is_active);
      if (body.external_links !== undefined) updates.external_links = Array.isArray(body.external_links) ? body.external_links.slice(0, 8) : [];
      if (body.instructions !== undefined) updates.instructions = body.instructions ? String(body.instructions).slice(0, 1000) : null;
      if (body.rotate_token === true) updates.device_token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '').slice(0, 16);

      const { data, error: e } = await admin
        .from('display_devices')
        .update(updates)
        .eq('id', deviceId)
        .eq('venue_id', venueId)
        .select('*, venue_courts(id, name, court_number, sport_type)')
        .single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data);
    }

    if (req.method === 'DELETE' && path === 'display-devices') {
      const deviceId = url.searchParams.get('deviceId');
      if (!deviceId) return errorResponse('Missing deviceId');
      const { error: e } = await admin
        .from('display_devices')
        .delete()
        .eq('id', deviceId)
        .eq('venue_id', venueId);
      if (e) return errorResponse(e.message);
      return jsonResponse({ ok: true });
    }

    // ── OPENING HOURS ──
    if (req.method === 'GET' && path === 'hours') {
      const { data, error: e } = await admin.from('opening_hours')
        .select('*').eq('venue_id', venueId).order('day_of_week');
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 200, 30);
    }

    if (req.method === 'POST' && path === 'hours') {
      const body = await req.json();
      // Upsert: delete old for this day, insert new
      await admin.from('opening_hours').delete().eq('venue_id', venueId).eq('day_of_week', body.dayOfWeek);
      const { data, error: e } = await admin.from('opening_hours').insert({
        venue_id: venueId,
        day_of_week: body.dayOfWeek,
        open_time: body.openTime,
        close_time: body.closeTime,
        is_closed: body.isClosed || false,
      }).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 201);
    }

    // ── PRICING RULES ──
    if (req.method === 'GET' && path === 'pricing') {
      const { data, error: e } = await admin.from('pricing_rules')
        .select('*').eq('venue_id', venueId).order('name');
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 200, 15);
    }

    if (req.method === 'POST' && path === 'pricing') {
      const { venueId: _v, ...body } = await req.json();
      const { data, error: e } = await admin.from('pricing_rules').insert({
        venue_id: venueId, ...body,
      }).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 201);
    }

    if (req.method === 'PATCH' && path === 'pricing') {
      const { ruleId, ...updates } = await req.json();
      if (!ruleId) return errorResponse('Missing ruleId');
      const { data, error: e } = await admin.from('pricing_rules').update(updates).eq('id', ruleId).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data);
    }

    if (req.method === 'DELETE' && path === 'pricing') {
      const ruleId = url.searchParams.get('ruleId');
      if (!ruleId) return errorResponse('Missing ruleId');
      const { error: e } = await admin.from('pricing_rules').delete().eq('id', ruleId);
      if (e) return errorResponse(e.message);
      return jsonResponse({ ok: true });
    }

    // ── ACCESS PRODUCTS ──
    if (req.method === 'GET' && path === 'products') {
      const { data, error: e } = await admin.from('access_products')
        .select('*').eq('venue_id', venueId).order('sort_order').order('name');
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 200, 15);
    }

    if (req.method === 'POST' && path === 'products') {
      const { venueId: _v, product_key, name, description, product_kind, session_type, base_price_sek, vat_rate, grants, sort_order, is_active } = await req.json();
      if (!product_key || !name) return errorResponse('Missing product_key or name');
      const { data, error: e } = await admin.from('access_products').upsert({
        venue_id: venueId,
        product_key,
        name,
        description: description || null,
        product_kind: product_kind || 'day_access',
        session_type: session_type || null,
        base_price_sek: base_price_sek ?? 0,
        vat_rate: vat_rate ?? 6,
        grants: grants || {},
        sort_order: sort_order ?? 0,
        is_active: is_active ?? true,
      }, { onConflict: 'venue_id,product_key' }).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 201);
    }

    if (req.method === 'PATCH' && path === 'products') {
      const { productId, ...updates } = await req.json();
      if (!productId) return errorResponse('Missing productId');
      const { data, error: e } = await admin.from('access_products')
        .update(updates).eq('id', productId).eq('venue_id', venueId).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data);
    }

    if (req.method === 'DELETE' && path === 'products') {
      const productId = url.searchParams.get('productId');
      if (!productId) return errorResponse('Missing productId');
      const { error: e } = await admin.from('access_products').delete().eq('id', productId).eq('venue_id', venueId);
      if (e) return errorResponse(e.message);
      return jsonResponse({ ok: true });
    }

    // ── ACTIVITY PROGRAM / SCHEDULE ──
    if (req.method === 'GET' && path === 'activity-series') {
      const { data, error: e } = await admin.from('activity_series')
        .select('*').eq('venue_id', venueId).order('created_at', { ascending: false });
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 200, 15);
    }

    if (req.method === 'POST' && path === 'activity-series') {
      const { venueId: _v, ...body } = await req.json();
      if (!body.name) return errorResponse('Missing name');
      const { data, error: e } = await admin.from('activity_series').insert({
        venue_id: venueId,
        name: body.name,
        description: body.description || null,
        series_type: body.series_type || 'program',
        sport_type: body.sport_type || 'pickleball',
        status: body.status || 'active',
        product_key: body.product_key || null,
        start_date: body.start_date || null,
        end_date: body.end_date || null,
        total_sessions: body.total_sessions ?? null,
        metadata: body.metadata || {},
      }).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 201);
    }

    if (req.method === 'PATCH' && path === 'activity-series') {
      const { seriesId, ...updates } = await req.json();
      if (!seriesId) return errorResponse('Missing seriesId');
      const { data, error: e } = await admin.from('activity_series')
        .update(updates).eq('id', seriesId).eq('venue_id', venueId).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data);
    }

    if (req.method === 'DELETE' && path === 'activity-series') {
      const seriesId = url.searchParams.get('seriesId');
      if (!seriesId) return errorResponse('Missing seriesId');
      const { error: e } = await admin.from('activity_series').delete().eq('id', seriesId).eq('venue_id', venueId);
      if (e) return errorResponse(e.message);
      return jsonResponse({ ok: true });
    }

    if (req.method === 'GET' && path === 'activity-sessions') {
      const { data, error: e } = await admin.from('activity_sessions')
        .select('*, activity_series(id, name, series_type)')
        .eq('venue_id', venueId)
        .order('start_time', { ascending: true });
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 200, 15);
    }

    if (req.method === 'POST' && path === 'activity-sessions') {
      const { venueId: _v, ...body } = await req.json();
      if (!body.name || !body.start_time || !body.end_time) return errorResponse('Missing name/start_time/end_time');
      const recurrenceDays = Array.isArray(body.recurrence_days) ? body.recurrence_days : null;
      const { data, error: e } = await admin.from('activity_sessions').insert({
        venue_id: venueId,
        series_id: body.series_id || null,
        product_key: body.product_key || null,
        name: body.name,
        session_type: body.session_type || 'open_play',
        sport_type: body.sport_type || 'pickleball',
        recurrence_days: recurrenceDays,
        session_date: body.session_date || null,
        start_time: body.start_time,
        end_time: body.end_time,
        price_sek: body.price_sek ?? 0,
        capacity: body.capacity ?? null,
        court_ids: Array.isArray(body.court_ids) ? body.court_ids : [],
        access_policy: body.access_policy || {},
        is_active: body.is_active ?? true,
        publish_status: body.publish_status || 'published',
        sort_order: body.sort_order ?? 0,
        metadata: body.metadata || {},
      }).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 201);
    }

    if (req.method === 'PATCH' && path === 'activity-sessions') {
      const { sessionId, ...updates } = await req.json();
      if (!sessionId) return errorResponse('Missing sessionId');
      const { data, error: e } = await admin.from('activity_sessions')
        .update(updates).eq('id', sessionId).eq('venue_id', venueId).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data);
    }

    if (req.method === 'DELETE' && path === 'activity-sessions') {
      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId) return errorResponse('Missing sessionId');
      const { error: e } = await admin.from('activity_sessions').delete().eq('id', sessionId).eq('venue_id', venueId);
      if (e) return errorResponse(e.message);
      return jsonResponse({ ok: true });
    }

    // ── VENUE LINKS ──
    if (req.method === 'GET' && path === 'links') {
      const { data, error: e } = await admin.from('venue_links')
        .select('*').eq('venue_id', venueId).order('sort_order');
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 200, 15);
    }

    if (req.method === 'POST' && path === 'links') {
      const { venueId: _v, ...body } = await req.json();
      const { data, error: e } = await admin.from('venue_links').insert({
        venue_id: venueId, ...body,
      }).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 201);
    }

    if (req.method === 'PATCH' && path === 'links') {
      const { linkId, ...updates } = await req.json();
      if (!linkId) return errorResponse('Missing linkId');
      const { data, error: e } = await admin.from('venue_links').update(updates).eq('id', linkId).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data);
    }

    if (req.method === 'DELETE' && path === 'links') {
      const linkId = url.searchParams.get('linkId');
      if (!linkId) return errorResponse('Missing linkId');
      const { error: e } = await admin.from('venue_links').delete().eq('id', linkId);
      if (e) return errorResponse(e.message);
      return jsonResponse({ ok: true });
    }

    // ── EVENT CATEGORIES ──
    if (req.method === 'GET' && path === 'event-categories') {
      const { data, error: e } = await admin.from('venue_event_categories')
        .select('*').eq('venue_id', venueId).order('category_key');
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 200, 15);
    }

    if (req.method === 'POST' && path === 'event-categories') {
      const body = await req.json();
      if (!body.categoryKey || !body.displayName) return errorResponse('Missing categoryKey or displayName');
      const { data, error: e } = await admin.from('venue_event_categories').upsert({
        venue_id: venueId,
        category_key: body.categoryKey,
        display_name: body.displayName,
        logo_url: body.logoUrl || null,
        whatsapp_url: body.whatsappUrl || null,
      }, { onConflict: 'venue_id,category_key' }).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 201);
    }

    if (req.method === 'DELETE' && path === 'event-categories') {
      const catId = url.searchParams.get('id');
      if (!catId) return errorResponse('Missing id');
      const { error: e } = await admin.from('venue_event_categories').delete().eq('id', catId);
      if (e) return errorResponse(e.message);
      return jsonResponse({ ok: true });
    }

    return errorResponse('Not found', 404);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
