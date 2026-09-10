/* eslint-disable @typescript-eslint/no-explicit-any */
import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import { requireVenueRole } from '../_shared/authorization.ts';
import { DateTime } from 'https://esm.sh/luxon@3.5.0';
import {
  CORPORATE_PARTICIPATION_MODES,
  canListPublicCorporateAccount,
  canResolvePublicCorporateAccount,
  deriveCorporateParticipation,
  normalizeCorporateSlug,
  normalizeExternalBookingLabel,
  normalizeExternalBookingUrl,
  normalizeIncludedItems,
  normalizePublicIntro,
} from '../_shared/corporate.ts';

function generateOrderNumber(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = 'CO-';
  for (let i = 0; i < 8; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

function publicVenueProjection(venue: any) {
  return {
    name: venue.name,
    slug: venue.slug,
    address: venue.address || null,
    city: venue.city || null,
    postal_code: venue.postal_code || null,
    country: venue.country || 'SE',
    latitude: venue.latitude ?? null,
    longitude: venue.longitude ?? null,
  };
}

function activeCorporateSessions(sessions: any[], excludedSessionDates: Set<string>) {
  return sessions
    .filter((session) => !excludedSessionDates.has(`${session.id}:${session.session_date}`))
    .sort((a, b) => `${a.session_date} ${a.start_time}`.localeCompare(`${b.session_date} ${b.start_time}`));
}

async function loadPublicCorporateContext(serviceClient: any, account: any) {
  const [{ data: venue, error: venueError }, { data: orders, error: orderError }] = await Promise.all([
    serviceClient.from('venues')
      .select('id, name, slug, address, city, postal_code, country, latitude, longitude, timezone')
      .eq('id', account.venue_id).eq('is_public', true).eq('status', 'active').maybeSingle(),
    serviceClient.from('corporate_orders')
      .select('id, included_items, status')
      .eq('corporate_account_id', account.id).neq('status', 'cancelled'),
  ]);
  if (venueError) throw new Error(venueError.message);
  if (orderError) throw new Error(orderError.message);
  if (!venue) return null;

  const orderIds = (orders || []).map((order: any) => order.id);
  if (!orderIds.length) return null;
  const { data: seriesRows, error: seriesError } = await serviceClient.from('activity_series')
    .select('id, corporate_order_id, name, description, status, start_date, end_date, court_ids, participation_management_mode, external_booking_url, external_booking_label')
    .in('corporate_order_id', orderIds).eq('status', 'active');
  if (seriesError) throw new Error(seriesError.message);
  if (!seriesRows?.length) return null;

  const today = DateTime.now().setZone(venue.timezone || 'Europe/Stockholm').toISODate()!;
  const seriesIds = seriesRows.map((series: any) => series.id);
  const { data: sessions, error: sessionError } = await serviceClient.from('activity_sessions')
    .select('id, series_id, name, session_date, start_time, end_time, court_ids, publish_status, closed_to_public, series_occurrence_index')
    .in('series_id', seriesIds).eq('is_active', true).eq('publish_status', 'published')
    .not('session_date', 'is', null).gte('session_date', today).order('session_date').order('start_time');
  if (sessionError) throw new Error(sessionError.message);

  // Overrides reference Sessions, not Series. Fetch only after the bounded Session query.
  const sessionIds = (sessions || []).map((session: any) => session.id);
  let sessionOverrides: any[] = [];
  if (sessionIds.length) {
    const result = await serviceClient.from('activity_session_overrides')
      .select('activity_session_id, session_date, status')
      .in('activity_session_id', sessionIds).in('status', ['hidden', 'cancelled']);
    if (result.error) throw new Error(result.error.message);
    sessionOverrides = result.data || [];
  }
  const excluded = new Set(sessionOverrides.map((row: any) => `${row.activity_session_id}:${row.session_date}`));
  const visibleSessions = activeCorporateSessions(sessions || [], excluded);
  if (!visibleSessions.length) return null;

  const courtIds = [...new Set(visibleSessions.flatMap((session: any) => Array.isArray(session.court_ids) ? session.court_ids : []))];
  const { data: courts, error: courtError } = courtIds.length
    ? await serviceClient.from('venue_courts').select('id, name, sport_type').eq('venue_id', account.venue_id).in('id', courtIds)
    : { data: [], error: null };
  if (courtError) throw new Error(courtError.message);

  return { venue, orders: orders || [], seriesRows, sessions: visibleSessions, courts: courts || [] };
}

function projectPublicCompany(account: any, context: any) {
  const orderById = new Map(context.orders.map((order: any) => [String(order.id), order]));
  const courtById = new Map(context.courts.map((court: any) => [String(court.id), court]));
  const series = context.seriesRows.map((row: any) => {
    const order: any = orderById.get(String(row.corporate_order_id)) || {};
    const sessions = context.sessions.filter((session: any) => session.series_id === row.id).map((session: any) => ({
      id: session.id,
      session_date: session.session_date,
      start_time: session.start_time,
      end_time: session.end_time,
      occurrence_index: session.series_occurrence_index ?? null,
      courts: (session.court_ids || []).map((courtId: string) => courtById.get(String(courtId))).filter(Boolean),
    }));
    if (!sessions.length) return null;
    return {
      id: row.id,
      name: row.name,
      description: row.description || null,
      start_date: row.start_date || null,
      end_date: row.end_date || null,
      included_items: Array.isArray(order.included_items) ? order.included_items : [],
      participation: deriveCorporateParticipation({
        ...row,
        company_name: account.company_name,
      }),
      sessions,
    };
  }).filter(Boolean);

  if (!series.length) return null;
  return {
    company: {
      company_name: account.company_name,
      slug: account.slug,
      public_intro: account.public_intro || null,
    },
    venue: publicVenueProjection(context.venue),
    series,
  };
}

async function publicCompanyBySlug(serviceClient: any, rawSlug: unknown) {
  let slug: string | null;
  try { slug = normalizeCorporateSlug(rawSlug); } catch { return null; }
  if (!slug) return null;
  const { data: account, error } = await serviceClient.from('corporate_accounts')
    .select('id, venue_id, company_name, slug, public_intro, public_visibility, is_active')
    .ilike('slug', slug).eq('is_active', true).in('public_visibility', ['listed', 'unlisted']).maybeSingle();
  if (error) throw new Error(error.message);
  if (!account || !canResolvePublicCorporateAccount(account)) return null;
  const context = await loadPublicCorporateContext(serviceClient, account);
  return context ? projectPublicCompany(account, context) : null;
}

async function requireCorporateSeriesVenue(serviceClient: any, userId: string, seriesId: string) {
  const { data: series, error } = await serviceClient.from('activity_series')
    .select('id, venue_id, corporate_order_id').eq('id', seriesId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!series?.corporate_order_id) throw new Error('Corporate Series not found');
  await requireVenueRole(serviceClient, userId, series.venue_id);
  return series;
}

async function requireCorporateSessionVenue(serviceClient: any, userId: string, sessionId: string) {
  const { data: session, error } = await serviceClient.from('activity_sessions')
    .select('id, venue_id, series_id').eq('id', sessionId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!session?.series_id) throw new Error('Corporate Session not found');
  await requireCorporateSeriesVenue(serviceClient, userId, session.series_id);
  return session;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.split('/').pop() || '';

  try {
    // Public corporate pages use a service-role query but return a strict,
    // purpose-built projection. Direct table access remains unnecessary.
    if (req.method === 'GET' && path === 'public-companies') {
      const venueSlug = String(url.searchParams.get('venueSlug') || '').trim();
      if (!venueSlug) return errorResponse('Missing venueSlug');
      const serviceClient = getServiceClient();
      const { data: venue, error: venueError } = await serviceClient.from('venues')
        .select('id, name, slug').eq('slug', venueSlug).eq('is_public', true).eq('status', 'active').maybeSingle();
      if (venueError) return errorResponse(venueError.message, 500);
      if (!venue) return errorResponse('Venue not found', 404);

      const { data: accounts, error: accountsError } = await serviceClient.from('corporate_accounts')
        .select('id, venue_id, company_name, slug, public_intro, public_visibility, is_active')
        .eq('venue_id', venue.id).eq('is_active', true).eq('public_visibility', 'listed')
        .not('slug', 'is', null).order('company_name');
      if (accountsError) return errorResponse(accountsError.message, 500);

      const companies: any[] = [];
      for (const account of accounts || []) {
        if (!canListPublicCorporateAccount(account)) continue;
        const context = await loadPublicCorporateContext(serviceClient, account);
        const projected = context ? projectPublicCompany(account, context) : null;
        if (!projected) continue;
        const firstSession = projected.series.flatMap((series: any) => series.sessions)[0] || null;
        companies.push({
          company_name: projected.company.company_name,
          slug: projected.company.slug,
          public_intro: projected.company.public_intro,
          next_session: firstSession ? {
            session_date: firstSession.session_date,
            start_time: firstSession.start_time,
          } : null,
        });
      }
      return jsonResponse({ venue: { name: venue.name, slug: venue.slug }, companies }, 200, 60);
    }

    if (req.method === 'GET' && path === 'public-company') {
      const serviceClient = getServiceClient();
      const projected = await publicCompanyBySlug(serviceClient, url.searchParams.get('slug'));
      if (!projected) return errorResponse('Company page not found', 404);
      return jsonResponse(projected, 200, 60);
    }

    // ── Public: lookup by invite token (no auth) ──
    if (req.method === 'GET' && path === 'invite-info') {
      const token = url.searchParams.get('token');
      if (!token) return errorResponse('Missing token');

      const serviceClient = getServiceClient();
      const { data, error } = await serviceClient
        .from('corporate_accounts')
        .select('id, company_name, venue_id, venues(name, logo_url, primary_color)')
        .eq('invite_token', token)
        .eq('is_active', true)
        .maybeSingle();

      if (error || !data) return errorResponse('Invalid or expired invite link', 404);
      return jsonResponse(data);
    }

    // ── Public: self-registration request ──
    if (req.method === 'POST' && path === 'register') {
      const body = await req.json();
      const { company_name, contact_name, contact_email, contact_phone, venue_id } = body;
      if (!company_name?.trim() || !venue_id) return errorResponse('Företagsnamn och venue krävs');

      const serviceClient = getServiceClient();

      const { data: account, error: insertErr } = await serviceClient
        .from('corporate_accounts')
        .insert({
          venue_id,
          company_name: company_name.trim(),
          contact_name: contact_name?.trim() || null,
          contact_email: contact_email?.trim() || null,
          contact_phone: contact_phone?.trim() || null,
        })
        .select()
        .single();

      if (insertErr) return errorResponse(insertErr.message);

      // If the user is authenticated, make them the first admin member
      const authHeader = req.headers.get('Authorization');
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        const { data: { user: authUser } } = await serviceClient.auth.getUser(token);
        if (authUser?.id) {
          await serviceClient.from('corporate_members').insert({
            corporate_account_id: account.id,
            user_id: authUser.id,
            role: 'admin',
          });
        }
      }

      return jsonResponse({ registered: true, account_id: account.id, invite_token: account.invite_token }, 201);
    }

    // ── Authenticated endpoints ──
    const { client, userId, error: authErr } = await getAuthenticatedClient(req);
    if (authErr || !client || !userId) return errorResponse(authErr || 'Unauthorized', 401);

    // ── Pickla staff: unified corporate administration ──
    if (req.method === 'GET' && path === 'admin-overview') {
      const venueId = String(url.searchParams.get('venueId') || '');
      const serviceClient = getServiceClient();
      await requireVenueRole(serviceClient, userId, venueId);

      const [accountsResult, packagesResult, ordersResult, seriesResult, courtsResult] = await Promise.all([
        serviceClient.from('corporate_accounts').select('*').eq('venue_id', venueId).order('created_at', { ascending: false }),
        serviceClient.from('corporate_packages').select('*').eq('venue_id', venueId).order('created_at', { ascending: false }),
        serviceClient.from('corporate_orders').select('*').eq('venue_id', venueId).order('created_at', { ascending: false }),
        serviceClient.from('activity_series')
          .select('id, venue_id, name, status, start_date, end_date, total_sessions, court_ids, format_id, access_product_id, corporate_order_id, participation_management_mode, external_booking_url, external_booking_label')
          .eq('venue_id', venueId).order('created_at', { ascending: false }),
        serviceClient.from('venue_courts').select('id, name, sport_type, is_available').eq('venue_id', venueId).order('name'),
      ]);
      for (const result of [accountsResult, packagesResult, ordersResult, seriesResult, courtsResult]) {
        if (result.error) return errorResponse(result.error.message, 500);
      }

      const accounts = accountsResult.data || [];
      const orders = ordersResult.data || [];
      const allSeries = seriesResult.data || [];
      const linkedSeriesIds = allSeries.filter((series: any) => series.corporate_order_id).map((series: any) => series.id);
      const { data: sessions, error: sessionsError } = linkedSeriesIds.length
        ? await serviceClient.from('activity_sessions')
          .select('id, series_id, name, session_date, start_time, end_time, court_ids, is_active, publish_status, closed_to_public, series_occurrence_index')
          .in('series_id', linkedSeriesIds).not('session_date', 'is', null).order('session_date').order('start_time')
        : { data: [], error: null };
      if (sessionsError) return errorResponse(sessionsError.message, 500);

      const accountById = new Map(accounts.map((account: any) => [String(account.id), account]));
      const orderById = new Map(orders.map((order: any) => [String(order.id), order]));
      const linked_series = allSeries.filter((series: any) => series.corporate_order_id).map((series: any) => {
        const order: any = orderById.get(String(series.corporate_order_id)) || {};
        const account: any = accountById.get(String(order.corporate_account_id)) || {};
        const seriesSessions = (sessions || []).filter((session: any) => session.series_id === series.id);
        const defaultCourtId = Array.isArray(series.court_ids) && series.court_ids.length === 1 ? series.court_ids[0] : null;
        const usingDefault = defaultCourtId
          ? seriesSessions.filter((session: any) => session.is_active && session.court_ids?.length === 1 && session.court_ids[0] === defaultCourtId).length
          : 0;
        const activeConcrete = seriesSessions.filter((session: any) => session.is_active && session.session_date);
        return {
          ...series,
          sessions: seriesSessions,
          default_court_id: defaultCourtId,
          active_session_count: activeConcrete.length,
          sessions_using_default_count: usingDefault,
          court_exception_count: activeConcrete.filter((session: any) => !defaultCourtId || session.court_ids?.length !== 1 || session.court_ids[0] !== defaultCourtId).length,
          participation: deriveCorporateParticipation({
            ...series,
            company_name: account.company_name,
            purchaser_name: order.purchaser_name,
          }),
        };
      });

      return jsonResponse({
        accounts,
        packages: packagesResult.data || [],
        orders,
        series_options: allSeries.map((series: any) => ({
          id: series.id,
          name: series.name,
          status: series.status,
          start_date: series.start_date,
          end_date: series.end_date,
          corporate_order_id: series.corporate_order_id,
          linkable_for_corporate_phase_1: !series.format_id && !series.access_product_id,
        })),
        linked_series,
        courts: courtsResult.data || [],
      });
    }

    if (req.method === 'POST' && path === 'admin-accounts') {
      const body = await req.json();
      const venueId = String(body.venue_id || '');
      const serviceClient = getServiceClient();
      await requireVenueRole(serviceClient, userId, venueId);
      const companyName = String(body.company_name || '').trim();
      if (!companyName) return errorResponse('Company name is required');
      const slug = normalizeCorporateSlug(body.slug);
      const visibility = String(body.public_visibility || 'private');
      const discountPercent = Number(body.discount_percent || 0);
      if (!['private', 'unlisted', 'listed'].includes(visibility)) return errorResponse('Invalid public visibility');
      if (visibility !== 'private' && !slug) return errorResponse('A slug is required for a public company page');
      if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) return errorResponse('Discount must be between 0 and 100');
      const { data, error } = await serviceClient.from('corporate_accounts').insert({
        venue_id: venueId,
        company_name: companyName,
        contact_name: String(body.contact_name || '').trim() || null,
        contact_email: String(body.contact_email || '').trim() || null,
        contact_phone: String(body.contact_phone || '').trim() || null,
        discount_percent: discountPercent,
        slug,
        public_visibility: visibility,
        public_intro: normalizePublicIntro(body.public_intro),
        is_active: body.is_active !== false,
      }).select('*').single();
      if (error) return errorResponse(error.message, error.code === '23505' ? 409 : 400);
      // Packages are intentionally created only by an explicit hour-bank order.
      return jsonResponse(data, 201);
    }

    if (req.method === 'PATCH' && path === 'admin-accounts') {
      const body = await req.json();
      const accountId = String(body.account_id || '');
      const serviceClient = getServiceClient();
      const { data: existing, error: existingError } = await serviceClient.from('corporate_accounts')
        .select('*').eq('id', accountId).maybeSingle();
      if (existingError) return errorResponse(existingError.message, 500);
      if (!existing) return errorResponse('Corporate account not found', 404);
      await requireVenueRole(serviceClient, userId, existing.venue_id);
      const nextSlug = Object.prototype.hasOwnProperty.call(body, 'slug') ? normalizeCorporateSlug(body.slug) : existing.slug;
      const nextVisibility = Object.prototype.hasOwnProperty.call(body, 'public_visibility')
        ? String(body.public_visibility) : existing.public_visibility;
      if (!['private', 'unlisted', 'listed'].includes(nextVisibility)) return errorResponse('Invalid public visibility');
      if (nextVisibility !== 'private' && !nextSlug) return errorResponse('A slug is required for a public company page');
      const allowed: Record<string, unknown> = {};
      if (Object.prototype.hasOwnProperty.call(body, 'company_name')) {
        const companyName = String(body.company_name || '').trim();
        if (!companyName) return errorResponse('Company name is required');
        allowed.company_name = companyName;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'contact_name')) allowed.contact_name = String(body.contact_name || '').trim() || null;
      if (Object.prototype.hasOwnProperty.call(body, 'contact_email')) allowed.contact_email = String(body.contact_email || '').trim() || null;
      if (Object.prototype.hasOwnProperty.call(body, 'contact_phone')) allowed.contact_phone = String(body.contact_phone || '').trim() || null;
      if (Object.prototype.hasOwnProperty.call(body, 'discount_percent')) {
        const discountPercent = Number(body.discount_percent || 0);
        if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) return errorResponse('Discount must be between 0 and 100');
        allowed.discount_percent = discountPercent;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'is_active')) allowed.is_active = body.is_active === true;
      if (Object.prototype.hasOwnProperty.call(body, 'public_intro')) allowed.public_intro = normalizePublicIntro(body.public_intro);
      allowed.slug = nextSlug;
      allowed.public_visibility = nextVisibility;
      const { data, error } = await serviceClient.from('corporate_accounts').update(allowed).eq('id', accountId).select('*').single();
      if (error) return errorResponse(error.message, error.code === '23505' ? 409 : 400);
      return jsonResponse(data);
    }

    if (req.method === 'POST' && path === 'admin-orders') {
      const body = await req.json();
      const accountId = String(body.corporate_account_id || '');
      const serviceClient = getServiceClient();
      const { data: account, error: accountError } = await serviceClient.from('corporate_accounts')
        .select('id, venue_id').eq('id', accountId).maybeSingle();
      if (accountError) return errorResponse(accountError.message, 500);
      if (!account) return errorResponse('Corporate account not found', 404);
      await requireVenueRole(serviceClient, userId, account.venue_id);
      const orderType = String(body.order_type || 'recurring');
      if (!['hours', 'recurring'].includes(orderType)) return errorResponse('Invalid order type');
      const totalHours = Number(body.total_hours || 0);
      const totalPrice = Number(body.total_price || 0);
      if (!Number.isFinite(totalHours) || totalHours < 0 || !Number.isFinite(totalPrice) || totalPrice < 0) {
        return errorResponse('Hours and price must be non-negative numbers');
      }
      const { data, error } = await serviceClient.from('corporate_orders').insert({
        corporate_account_id: account.id,
        venue_id: account.venue_id,
        order_type: orderType,
        total_hours: totalHours,
        total_price: totalPrice,
        currency: 'SEK',
        notes: String(body.notes || '').trim() || null,
        purchaser_name: String(body.purchaser_name || '').trim() || null,
        price_includes_vat: typeof body.price_includes_vat === 'boolean' ? body.price_includes_vat : null,
        included_items: normalizeIncludedItems(body.included_items),
        created_by: userId,
      }).select('*').single();
      if (error) return errorResponse(error.message, 400);
      return jsonResponse(data, 201);
    }

    if (req.method === 'PATCH' && path === 'admin-series') {
      const body = await req.json();
      const seriesId = String(body.series_id || '');
      const serviceClient = getServiceClient();
      const { data: existing, error: existingError } = await serviceClient.from('activity_series')
        .select('id, venue_id, format_id, access_product_id, corporate_order_id, participation_management_mode, external_booking_url, external_booking_label')
        .eq('id', seriesId).maybeSingle();
      if (existingError) return errorResponse(existingError.message, 500);
      if (!existing) return errorResponse('Activity Series not found', 404);
      await requireVenueRole(serviceClient, userId, existing.venue_id);

      const updates: Record<string, unknown> = {};
      if (Object.prototype.hasOwnProperty.call(body, 'corporate_order_id')) {
        const orderId = String(body.corporate_order_id || '') || null;
        if (orderId) {
          if (existing.format_id || existing.access_product_id) {
            return errorResponse('A managed sellable Series cannot be repurposed as a Phase 1 corporate capacity Series', 409);
          }
          const { data: order } = await serviceClient.from('corporate_orders')
            .select('id').eq('id', orderId).eq('venue_id', existing.venue_id)
            .eq('order_type', 'recurring').neq('status', 'cancelled').maybeSingle();
          if (!order) return errorResponse('Corporate order does not belong to this venue', 400);
        }
        updates.corporate_order_id = orderId;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'participation_management_mode')) {
        const mode = String(body.participation_management_mode || '');
        if (!CORPORATE_PARTICIPATION_MODES.includes(mode as any)) return errorResponse('Invalid participation management mode');
        updates.participation_management_mode = mode;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'external_booking_url')) {
        updates.external_booking_url = normalizeExternalBookingUrl(body.external_booking_url);
      }
      if (Object.prototype.hasOwnProperty.call(body, 'external_booking_label')) {
        updates.external_booking_label = normalizeExternalBookingLabel(body.external_booking_label);
      }
      if (!Object.keys(updates).length) return errorResponse('No supported changes');
      const { data, error } = await serviceClient.from('activity_series').update(updates).eq('id', seriesId).select('*').single();
      if (error) return errorResponse(error.message, 400);
      return jsonResponse(data);
    }

    if (req.method === 'POST' && path === 'admin-series-court') {
      const body = await req.json();
      const seriesId = String(body.series_id || '');
      const courtId = String(body.court_id || '');
      const action = String(body.action || 'preview');
      if (!seriesId || !courtId || !['preview', 'apply'].includes(action)) return errorResponse('Series, court and valid action are required');
      const serviceClient = getServiceClient();
      await requireCorporateSeriesVenue(serviceClient, userId, seriesId);
      const rpc = action === 'apply' ? 'apply_corporate_series_default_court' : 'preview_corporate_series_default_court';
      const { data, error } = await serviceClient.rpc(rpc, { p_series_id: seriesId, p_court_id: courtId });
      if (error) return errorResponse(error.message, 409);
      if (action === 'apply' && data?.applied !== true) {
        return jsonResponse({ error: 'Court conflicts must be resolved before applying', code: 'corporate_series_court_conflict', result: data }, 409);
      }
      return jsonResponse({ action, result: data });
    }

    if (req.method === 'POST' && path === 'admin-session-court') {
      const body = await req.json();
      const sessionId = String(body.session_id || '');
      const courtId = String(body.court_id || '');
      const action = String(body.action || 'preview');
      if (!sessionId || !courtId || !['preview', 'apply'].includes(action)) return errorResponse('Session, court and valid action are required');
      const serviceClient = getServiceClient();
      await requireCorporateSessionVenue(serviceClient, userId, sessionId);
      const rpc = action === 'apply' ? 'apply_corporate_session_court' : 'preview_corporate_session_court';
      const { data, error } = await serviceClient.rpc(rpc, { p_session_id: sessionId, p_court_id: courtId });
      if (error) return errorResponse(error.message, 409);
      if (action === 'apply' && data?.applied !== true) {
        return jsonResponse({ error: 'Court conflict must be resolved before applying', code: 'corporate_session_court_conflict', result: data }, 409);
      }
      return jsonResponse({ action, result: data });
    }

    // POST /join — join via invite token
    if (req.method === 'POST' && path === 'join') {
      const body = await req.json();
      const { token } = body;
      if (!token) return errorResponse('Missing token');

      const serviceClient = getServiceClient();

      const { data: account } = await serviceClient
        .from('corporate_accounts')
        .select('id, company_name, venue_id')
        .eq('invite_token', token)
        .eq('is_active', true)
        .maybeSingle();

      if (!account) return errorResponse('Invalid or expired invite link', 404);

      const { data: existing } = await serviceClient
        .from('corporate_members')
        .select('id')
        .eq('corporate_account_id', account.id)
        .eq('user_id', userId)
        .maybeSingle();

      if (existing) return jsonResponse({ already_member: true, corporate_account_id: account.id });

      const { count } = await serviceClient
        .from('corporate_members')
        .select('id', { count: 'exact', head: true })
        .eq('corporate_account_id', account.id);

      const role = (count === 0) ? 'admin' : 'member';

      const { error: insertErr } = await serviceClient
        .from('corporate_members')
        .insert({ corporate_account_id: account.id, user_id: userId, role });

      if (insertErr) return errorResponse(insertErr.message);

      return jsonResponse({ joined: true, role, corporate_account_id: account.id, company_name: account.company_name });
    }

    // GET /my — get user's corporate memberships
    if (req.method === 'GET' && path === 'my') {
      const serviceClient = getServiceClient();
      const { data: memberships } = await serviceClient
        .from('corporate_members')
        .select(`
          id, role, joined_at, monthly_hour_limit, monthly_cost_limit,
          corporate_accounts(id, company_name, venue_id, invite_token, venues(name, logo_url))
        `)
        .eq('user_id', userId);

      if (!memberships?.length) return jsonResponse({ memberships: [], packages: [] });

      const accountIds = memberships.map((m: any) => m.corporate_accounts?.id).filter(Boolean);

      const { data: packages } = await serviceClient
        .from('corporate_packages')
        .select('*')
        .in('corporate_account_id', accountIds)
        .eq('status', 'active');

      return jsonResponse({ memberships, packages: packages || [] });
    }

    // GET /dashboard — corporate admin dashboard
    if (req.method === 'GET' && path === 'dashboard') {
      const accountId = url.searchParams.get('accountId');
      if (!accountId) return errorResponse('Missing accountId');

      const serviceClient = getServiceClient();

      const { data: membership } = await serviceClient
        .from('corporate_members')
        .select('role')
        .eq('corporate_account_id', accountId)
        .eq('user_id', userId)
        .maybeSingle();

      if (!membership || membership.role !== 'admin') return errorResponse('Forbidden', 403);

      const [accountRes, membersRes, packagesRes, bookingsRes, ordersRes] = await Promise.all([
        serviceClient.from('corporate_accounts').select('*, venues(name, logo_url)').eq('id', accountId).single(),
        serviceClient.from('corporate_members').select('id, user_id, role, joined_at, monthly_hour_limit, monthly_cost_limit').eq('corporate_account_id', accountId),
        serviceClient.from('corporate_packages').select('*').eq('corporate_account_id', accountId),
        serviceClient.from('bookings')
          .select('id, start_time, end_time, status, venue_courts(name), user_id')
          .eq('corporate_package_id', accountId)
          .order('start_time', { ascending: false })
          .limit(50),
        serviceClient.from('corporate_orders')
          .select('*, corporate_order_items(*)')
          .eq('corporate_account_id', accountId)
          .order('created_at', { ascending: false }),
      ]);

      const memberUserIds = (membersRes.data || []).map((m: any) => m.user_id);
      const { data: profiles } = await serviceClient
        .from('player_profiles')
        .select('auth_user_id, display_name, phone, avatar_url')
        .in('auth_user_id', memberUserIds);

      const profileMap = Object.fromEntries((profiles || []).map((p: any) => [p.auth_user_id, p]));
      const membersWithProfiles = (membersRes.data || []).map((m: any) => ({
        ...m,
        profile: profileMap[m.user_id] || null,
      }));

      return jsonResponse({
        account: accountRes.data,
        members: membersWithProfiles,
        packages: packagesRes.data || [],
        recent_bookings: bookingsRes.data || [],
        orders: ordersRes.data || [],
      });
    }

    // POST /orders — create an order (hours or recurring series)
    if (req.method === 'POST' && path === 'orders') {
      const body = await req.json();
      const { corporate_account_id, order_type, total_hours, total_price, notes, recurring_config } = body;

      if (!corporate_account_id) return errorResponse('Missing corporate_account_id');

      const serviceClient = getServiceClient();

      // Verify caller is corp admin
      const { data: membership } = await serviceClient
        .from('corporate_members')
        .select('role')
        .eq('corporate_account_id', corporate_account_id)
        .eq('user_id', userId)
        .maybeSingle();

      if (!membership || membership.role !== 'admin') return errorResponse('Forbidden', 403);

      // Get venue_id from account
      const { data: account } = await serviceClient
        .from('corporate_accounts')
        .select('venue_id')
        .eq('id', corporate_account_id)
        .single();

      if (!account) return errorResponse('Account not found', 404);

      // Create order
      const { data: order, error: orderErr } = await serviceClient
        .from('corporate_orders')
        .insert({
          corporate_account_id,
          venue_id: account.venue_id,
          order_type: order_type || 'hours',
          total_hours: total_hours || 0,
          total_price: total_price || 0,
          notes: notes || null,
          recurring_config: recurring_config || null,
          created_by: userId,
        })
        .select()
        .single();

      if (orderErr) return errorResponse(orderErr.message);

      // If recurring, generate order items
      if (order_type === 'recurring' && recurring_config) {
        const { slots, weeks } = recurring_config;
        // slots = [{ day_of_week: 1, start_time: "17:00", end_time: "19:00" }, ...]
        // weeks = 12
        if (Array.isArray(slots) && weeks > 0) {
          const items: any[] = [];
          const today = new Date();

          for (let week = 0; week < weeks; week++) {
            for (const slot of slots) {
              // Calculate the date for this day_of_week in this week
              const daysUntil = ((slot.day_of_week - today.getDay()) + 7) % 7;
              const slotDate = new Date(today);
              slotDate.setDate(today.getDate() + daysUntil + (week * 7));
              
              items.push({
                order_id: order.id,
                day_of_week: slot.day_of_week,
                start_time: slot.start_time,
                end_time: slot.end_time,
                week_number: week + 1,
                scheduled_date: slotDate.toISOString().split('T')[0],
                status: 'pending',
              });
            }
          }

          if (items.length > 0) {
            await serviceClient.from('corporate_order_items').insert(items);
          }

          // Calculate total hours
          let totalHrs = 0;
          for (const slot of slots) {
            const startH = parseInt(slot.start_time.split(':')[0]);
            const endH = parseInt(slot.end_time.split(':')[0]);
            totalHrs += (endH - startH) * weeks;
          }

          await serviceClient.from('corporate_orders')
            .update({ total_hours: totalHrs })
            .eq('id', order.id);
        }
      }

      // Re-fetch order with items
      const { data: fullOrder } = await serviceClient
        .from('corporate_orders')
        .select('*, corporate_order_items(*)')
        .eq('id', order.id)
        .single();

      return jsonResponse(fullOrder, 201);
    }

    // PATCH /orders — update order status (venue admin: invoiced, paid, fulfilled)
    if (req.method === 'PATCH' && path === 'orders') {
      const body = await req.json();
      const { order_id, status, notes } = body;

      if (!order_id || !status) return errorResponse('Missing order_id or status');

      const serviceClient = getServiceClient();

      // Get order to check permissions
      const { data: order } = await serviceClient
        .from('corporate_orders')
        .select('id, venue_id, corporate_account_id, status, total_hours, order_type, recurring_config')
        .eq('id', order_id)
        .single();

      if (!order) return errorResponse('Order not found', 404);

      // Allow both venue admins and corporate admins for cancellation
      const { data: venueStaff } = await serviceClient
        .from('venue_staff')
        .select('role')
        .eq('venue_id', order.venue_id)
        .eq('user_id', userId)
        .eq('is_active', true)
        .maybeSingle();

      const isVenueAdmin = venueStaff?.role === 'venue_admin';
      const { data: superCheck } = await serviceClient.rpc('is_super_admin');

      const { data: corpMembership } = await serviceClient
        .from('corporate_members')
        .select('role')
        .eq('corporate_account_id', order.corporate_account_id)
        .eq('user_id', userId)
        .maybeSingle();

      const isCorporateAdmin = corpMembership?.role === 'admin';

      if (!isVenueAdmin && !superCheck && !isCorporateAdmin) {
        return errorResponse('Forbidden', 403);
      }

      const updateData: any = { status };
      if (notes !== undefined) updateData.notes = notes;
      if (status === 'invoiced') updateData.invoiced_at = new Date().toISOString();
      if (status === 'paid') updateData.paid_at = new Date().toISOString();
      if (status === 'fulfilled') {
        updateData.fulfilled_at = new Date().toISOString();

        // When fulfilled: if hours order, add hours to package
        if (order.order_type === 'hours' && order.total_hours > 0) {
          // Find active package or create one
          const { data: existingPkg } = await serviceClient
            .from('corporate_packages')
            .select('id, total_hours')
            .eq('corporate_account_id', order.corporate_account_id)
            .eq('status', 'active')
            .maybeSingle();

          if (existingPkg) {
            await serviceClient.from('corporate_packages')
              .update({ total_hours: existingPkg.total_hours + order.total_hours })
              .eq('id', existingPkg.id);
          } else {
            await serviceClient.from('corporate_packages').insert({
              corporate_account_id: order.corporate_account_id,
              venue_id: order.venue_id,
              total_hours: order.total_hours,
              package_type: 'hours',
            });
          }
        }

        // Linked recurring orders are fulfilled by canonical Series/Sessions.
        // The unlinked branch below is retained for existing recurring orders
        // whose corporate_order_items/bookings are still their source of truth.
        if (order.order_type === 'recurring') {
          const { data: linkedSeries, error: linkedSeriesError } = await serviceClient
            .from('activity_series')
            .select('id, status, total_sessions, court_ids')
            .eq('corporate_order_id', order.id);
          if (linkedSeriesError) return errorResponse(linkedSeriesError.message);

          if (linkedSeries?.length) {
            for (const series of linkedSeries) {
              const { data: canonicalSessions, error: canonicalSessionsError } = await serviceClient
                .from('activity_sessions')
                .select('id, session_date, court_ids, is_active, publish_status, closed_to_public')
                .eq('series_id', series.id)
                .eq('is_active', true)
                .not('session_date', 'is', null);
              if (canonicalSessionsError) return errorResponse(canonicalSessionsError.message);
              const defaultCourtId = Array.isArray(series.court_ids) && series.court_ids.length === 1
                ? series.court_ids[0]
                : null;
              const expectedCount = Number(series.total_sessions || canonicalSessions?.length || 0);
              const scheduleReady = series.status === 'active'
                && Boolean(defaultCourtId)
                && (canonicalSessions?.length || 0) === expectedCount
                && expectedCount > 0
                && (canonicalSessions || []).every((session: any) =>
                  session.publish_status === 'published'
                  && session.closed_to_public === true
                  && session.court_ids?.length === 1
                  && session.court_ids[0] === defaultCourtId
                );
              if (!scheduleReady) {
                return errorResponse('Linked corporate Series must have its complete published, closed and court-assigned Session schedule before fulfillment', 409);
              }
            }
          } else {
          const { data: items } = await serviceClient
            .from('corporate_order_items')
            .select('*')
            .eq('order_id', order.id)
            .eq('status', 'pending');

          if (items && items.length > 0) {
            // Get a default court for this venue
            const { data: courts } = await serviceClient
              .from('venue_courts')
              .select('id')
              .eq('venue_id', order.venue_id)
              .eq('is_available', true)
              .limit(1);

            const courtId = courts?.[0]?.id;
            if (!courtId) return errorResponse('No available courts to create bookings');

            // Get or create guest user for these bookings
            const { data: account } = await serviceClient
              .from('corporate_accounts')
              .select('id, company_name')
              .eq('id', order.corporate_account_id)
              .single();

            for (const item of items) {
              const startISO = `${item.scheduled_date}T${item.start_time}:00.000Z`;
              const endISO = `${item.scheduled_date}T${item.end_time}:00.000Z`;

              // Check for conflicts
              const { data: conflicts } = await serviceClient.from('bookings')
                .select('id').eq('venue_court_id', courtId)
                .neq('status', 'cancelled')
                .lt('start_time', endISO).gt('end_time', startISO);

              if (conflicts && conflicts.length > 0) {
                // Mark as conflict instead
                await serviceClient.from('corporate_order_items')
                  .update({ status: 'conflict' })
                  .eq('id', item.id);
                continue;
              }

              const { data: booking } = await serviceClient.from('bookings').insert({
                venue_id: order.venue_id,
                venue_court_id: courtId,
                user_id: userId,
                booked_by: userId,
                start_time: startISO,
                end_time: endISO,
                total_price: 0,
                status: 'confirmed',
                notes: `${account?.company_name || 'Företag'} | Serie`,
                participation_funding_mode: 'resource_funded',
                participation_funding_source_type: 'corporate_order',
                participation_funding_source_id: order.id,
                participation_funder: 'employer',
              }).select('id').single();

              if (booking) {
                await serviceClient.from('corporate_order_items')
                  .update({ booking_id: booking.id, status: 'confirmed' })
                  .eq('id', item.id);
              }
            }
          }
          }
        }
      }

      const { error: updateErr } = await serviceClient
        .from('corporate_orders')
        .update(updateData)
        .eq('id', order_id);

      if (updateErr) return errorResponse(updateErr.message);

      return jsonResponse({ updated: true, status });
    }

    // PATCH /members — update member limits
    if (req.method === 'PATCH' && path === 'members') {
      const body = await req.json();
      const { member_id, monthly_hour_limit, monthly_cost_limit } = body;

      if (!member_id) return errorResponse('Missing member_id');

      const serviceClient = getServiceClient();

      // Get member to find corporate account
      const { data: member } = await serviceClient
        .from('corporate_members')
        .select('corporate_account_id')
        .eq('id', member_id)
        .single();

      if (!member) return errorResponse('Member not found', 404);

      // Verify caller is corp admin
      const { data: callerMembership } = await serviceClient
        .from('corporate_members')
        .select('role')
        .eq('corporate_account_id', member.corporate_account_id)
        .eq('user_id', userId)
        .maybeSingle();

      if (!callerMembership || callerMembership.role !== 'admin') return errorResponse('Forbidden', 403);

      const updateData: any = {};
      if (monthly_hour_limit !== undefined) updateData.monthly_hour_limit = monthly_hour_limit;
      if (monthly_cost_limit !== undefined) updateData.monthly_cost_limit = monthly_cost_limit;

      const { error: updateErr } = await serviceClient
        .from('corporate_members')
        .update(updateData)
        .eq('id', member_id);

      if (updateErr) return errorResponse(updateErr.message);

      return jsonResponse({ updated: true });
    }

    // GET /venues — list venues for registration
    if (req.method === 'GET' && path === 'venues') {
      const serviceClient = getServiceClient();
      const { data: venues } = await serviceClient
        .from('venues')
        .select('id, name, slug, city, logo_url')
        .eq('is_public', true)
        .eq('status', 'active')
        .order('name');

      return jsonResponse(venues || []);
    }

    return errorResponse('Not found', 404);
  } catch (e) {
    const message = (e as Error).message;
    if (message === 'Unauthorized') return errorResponse(message, 401);
    if (message.startsWith('Forbidden')) return errorResponse(message, 403);
    if (/URL|Slug|CTA label|Public intro|included items|An order may/i.test(message)) return errorResponse(message, 400);
    return errorResponse(message, 500);
  }
});
