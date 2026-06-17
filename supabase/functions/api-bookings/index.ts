import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import { findAuthUserByEmail, generateAccessCode, getOrCreatePublicBookingUserId, stockholmDateRangeUtc } from '../_shared/bookings.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DateTime } from 'https://esm.sh/luxon@3.5.0';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { resolveActivityPricingDecision } from '../_shared/activity_pricing.ts';

function safeLocalPath(path?: string | null) {
  if (!path || typeof path !== 'string') return '';
  if (!path.startsWith('/') || path.startsWith('//')) return '';
  return path.slice(0, 450);
}

function nameFromBookingNotes(notes?: string | null) {
  return (notes || '').split(' | ')[0].trim();
}

function applyPercentDiscount(baseAmount: number, percent: number) {
  return Math.max(0, Math.round(baseAmount * (1 - (percent / 100)) * 100) / 100);
}

function parseNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function vatPartsFromIncludedTotal(totalIncVat: number, vatRate = 6) {
  const vatAmount = Math.round(totalIncVat * vatRate / (100 + vatRate) * 100) / 100;
  return {
    totalIncVat: Math.round(totalIncVat * 100) / 100,
    vatAmount,
    totalExVat: Math.round(Math.max(totalIncVat - vatAmount, 0) * 100) / 100,
    vatRate,
  };
}

function normalizeCatalogResource(row: any) {
  const resource = row?.event_resource_catalog;
  return Array.isArray(resource) ? resource[0] : resource;
}

function blockTargetsCourts(block: any, courtIds: string[]) {
  const resource = normalizeCatalogResource(block);
  const scope = block?.metadata?.scope;
  const resourceType = String(resource?.resource_type || '').toLowerCase();
  if (scope === 'venue' || resourceType === 'venue' || resourceType === 'whole_venue') return courtIds;

  const courtId = resource?.venue_court_id || block?.metadata?.venue_court_id;
  return courtId && courtIds.includes(courtId) ? [courtId] : [];
}

async function getCourtResourceBlocks(
  admin: any,
  venueId: string,
  courtIds: string[],
  startISO: string,
  endISO: string,
) {
  if (!courtIds.length) return [];

  const { data, error } = await admin
    .from('event_resource_blocks')
    .select('id, title, reason, status, starts_at, ends_at, metadata, resource_catalog_id, event_resource_catalog(id, name, resource_type, venue_court_id)')
    .eq('venue_id', venueId)
    .eq('blocks_public_booking', true)
    .in('status', ['hold', 'confirmed'])
    .lt('starts_at', endISO)
    .gt('ends_at', startISO);

  if (error) {
    console.error('event_resource_blocks lookup failed', error.message);
    return [];
  }

  return (data || []).flatMap((block: any) =>
    blockTargetsCourts(block, courtIds).map((courtId) => ({
      id: block.id,
      court_id: courtId,
      start: block.starts_at,
      end: block.ends_at,
      title: block.title,
      status: block.status,
      kind: 'resource_block',
    }))
  );
}

async function isActivityOccurrenceBlocked(admin: any, venueId: string, activitySessionId: string, sessionDate: string) {
  if (!venueId || !activitySessionId || !sessionDate) return false;
  const { data, error } = await admin
    .from('activity_session_overrides')
    .select('status')
    .eq('venue_id', venueId)
    .eq('activity_session_id', activitySessionId)
    .eq('session_date', sessionDate)
    .maybeSingle();
  if (error) {
    console.error('activity_session_overrides lookup failed', error.message);
    return false;
  }
  return data?.status === 'hidden' || data?.status === 'cancelled';
}

function stockholmWeekForIso(iso: string) {
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone('Europe/Stockholm');
  return {
    start: dt.startOf('week').toISODate()!,
    end: dt.endOf('week').toISODate()!,
  };
}

function bookingDurationHours(row: any) {
  const start = new Date(row.start_time).getTime();
  const end = new Date(row.end_time).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return (end - start) / 36e5;
}

function stockholmSessionIso(sessionDate: string, time?: string | null, end = false) {
  const cleanDate = String(sessionDate || '').slice(0, 10);
  const cleanTime = String(time || (end ? '23:59' : '00:00')).slice(0, 5);
  return DateTime.fromISO(`${cleanDate}T${cleanTime}:00`, { zone: 'Europe/Stockholm' }).toUTC().toISO();
}

function profileDisplayName(profile: any) {
  if (!profile) return null;
  const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim();
  return fullName || profile.display_name || profile.phone || null;
}

async function refundMembershipCourtHours(admin: any, rows: any[]) {
  const refunds = new Map<string, {
    user_id: string;
    venue_id: string;
    period_start: string;
    period_end: string;
    value: number;
  }>();

  for (const row of rows) {
    if (row.status === 'cancelled') continue;
    const existingIncluded = parseNumber(row.included_court_hours, 0);
    let refundHours = existingIncluded;
    let periodStart = row.membership_usage_period_start || null;
    let periodEnd = row.membership_usage_period_end || null;

    // Legacy fallback for bookings made before usage metadata existed.
    if (refundHours <= 0 && Number(row.total_price || 0) === 0 && row.user_id && row.venue_id) {
      const sportType = row.venue_courts?.sport_type || 'pickleball';
      const { data: membership } = await admin
        .from('memberships')
        .select('id, tier_id')
        .eq('user_id', row.user_id)
        .eq('venue_id', row.venue_id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (membership?.tier_id) {
        let entitlementQuery = admin
          .from('membership_entitlements')
          .select('id')
          .eq('tier_id', membership.tier_id)
          .eq('entitlement_type', 'court_hours_per_week')
          .limit(1);
        entitlementQuery = sportType === 'pickleball'
          ? entitlementQuery.or('sport_type.is.null,sport_type.eq.pickleball')
          : entitlementQuery.eq('sport_type', sportType);
        const { data: entitlement } = await entitlementQuery.maybeSingle();

        if (entitlement) refundHours = bookingDurationHours(row);
      }
    }

    if (refundHours <= 0) continue;
    if (!periodStart || !periodEnd) {
      const week = stockholmWeekForIso(row.start_time);
      periodStart = week.start;
      periodEnd = week.end;
    }
    const key = `${row.user_id}:${row.venue_id}:${periodStart}`;
    const current = refunds.get(key) || {
      user_id: row.user_id,
      venue_id: row.venue_id,
      period_start: periodStart,
      period_end: periodEnd,
      value: 0,
    };
    current.value += refundHours;
    refunds.set(key, current);
  }

  for (const refund of refunds.values()) {
    const { data: usage } = await admin
      .from('membership_usage')
      .select('used_value')
      .eq('user_id', refund.user_id)
      .eq('venue_id', refund.venue_id)
      .eq('entitlement_type', 'court_hours_per_week')
      .eq('period_start', refund.period_start)
      .maybeSingle();

    if (!usage) continue;
    await admin.from('membership_usage').update({
      used_value: Math.max(Number(usage.used_value || 0) - refund.value, 0),
      period_end: refund.period_end,
      updated_at: new Date().toISOString(),
    })
      .eq('user_id', refund.user_id)
      .eq('venue_id', refund.venue_id)
      .eq('entitlement_type', 'court_hours_per_week')
      .eq('period_start', refund.period_start);
  }
}

async function calculateIncludedCourtHoursFromBookings(
  admin: any,
  userId: string,
  venueId: string,
  periodStart: string,
  periodEnd: string,
  sportType = 'pickleball',
) {
  const startUtc = DateTime.fromISO(`${periodStart}T00:00:00`, { zone: 'Europe/Stockholm' }).toUTC().toISO()!;
  const endUtc = DateTime.fromISO(`${periodEnd}T23:59:59.999`, { zone: 'Europe/Stockholm' }).toUTC().toISO()!;
  const { data: rows } = await admin
    .from('bookings')
    .select('id, start_time, end_time, total_price, included_court_hours, venue_courts(sport_type)')
    .eq('user_id', userId)
    .eq('venue_id', venueId)
    .neq('status', 'cancelled')
    .gte('start_time', startUtc)
    .lte('start_time', endUtc);

  return (rows || []).reduce((sum: number, row: any) => {
    const rowSport = row.venue_courts?.sport_type || 'pickleball';
    if (rowSport !== sportType) return sum;
    const included = parseNumber(row.included_court_hours, 0);
    if (included > 0) return sum + included;

    // Legacy fallback for free membership bookings created before usage metadata.
    if (Number(row.total_price || 0) === 0) return sum + bookingDurationHours(row);
    return sum;
  }, 0);
}

async function createFreeEntitlementBookingResponse({
  product_type,
  meta,
  venue_id,
  entitlementUserId,
}: {
  product_type: string;
  meta: Record<string, any>;
  venue_id: string;
  entitlementUserId: string;
}) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const adminFree = createClient(supabaseUrl, serviceKey);

  if (product_type === 'court_booking' && meta.court_ids && meta.date) {
    const startISO = DateTime.fromISO(`${meta.date}T${meta.start_time}:00`, { zone: 'Europe/Stockholm' }).toUTC().toISO()!;
    const endISO   = DateTime.fromISO(`${meta.date}T${meta.end_time}:00`,   { zone: 'Europe/Stockholm' }).toUTC().toISO()!;
    const notes = [meta.name, meta.phone].filter(Boolean).join(' | ') || null;

    let courtIds: string[];
    try { courtIds = JSON.parse(meta.court_ids || '[]'); } catch { courtIds = []; }
    const accessCode = await generateAccessCode(adminFree, venue_id, meta.date);
    const bookings = [];
    const quotaDate = meta.entitlement_period_start
      ? DateTime.fromISO(meta.entitlement_period_start, { zone: 'Europe/Stockholm' })
      : meta.date
      ? DateTime.fromISO(meta.date, { zone: 'Europe/Stockholm' })
      : DateTime.now().setZone('Europe/Stockholm');
    const weekStart = (meta.entitlement_period_start || quotaDate.startOf('week').toISODate())!;
    const weekEnd   = (meta.entitlement_period_end || quotaDate.endOf('week').toISODate())!;
    const durationHours = parseFloat(meta.duration_hours || '0');
    const courtHours = durationHours * Math.max(courtIds.length, 1);
    const includedCourtHours = parseNumber(meta.included_court_hours, courtHours);
    const includedHoursPerCourt = courtIds.length > 0 ? includedCourtHours / courtIds.length : 0;

    for (const courtId of courtIds) {
      const { data: conflicts } = await adminFree.from('bookings')
        .select('id')
        .eq('venue_court_id', courtId)
        .neq('status', 'cancelled')
        .lt('start_time', endISO)
        .gt('end_time', startISO)
        .limit(1);
      if (conflicts?.length) return errorResponse('En eller flera banor är redan bokade för denna tid', 409);

      const { data: booking, error: bookingErr } = await adminFree.from('bookings').insert({
        venue_id, venue_court_id: courtId, user_id: entitlementUserId, booked_by: entitlementUserId,
        start_time: startISO, end_time: endISO, total_price: 0,
        status: 'confirmed', notes, access_code: accessCode, access_code_expires_at: endISO,
        membership_id: meta.membership_id || null,
        included_court_hours: includedHoursPerCourt,
        paid_court_hours: 0,
        membership_usage_entitlement_type: includedHoursPerCourt > 0 ? 'court_hours_per_week' : null,
        membership_usage_period_start: includedHoursPerCourt > 0 ? weekStart : null,
        membership_usage_period_end: includedHoursPerCourt > 0 ? weekEnd : null,
      }).select('booking_ref').single();
      if (bookingErr) return errorResponse(bookingErr.message, 500);
      if (booking) bookings.push(booking);
    }

    if (includedCourtHours > 0) {
      const { data: currentUsage } = await adminFree
        .from('membership_usage')
        .select('used_value')
        .eq('user_id', entitlementUserId)
        .eq('venue_id', venue_id)
        .eq('entitlement_type', 'court_hours_per_week')
        .eq('period_start', weekStart)
        .maybeSingle();

      await adminFree.from('membership_usage').upsert({
        user_id: entitlementUserId, venue_id, entitlement_type: 'court_hours_per_week',
        period_start: weekStart, period_end: weekEnd, used_value: (currentUsage?.used_value || 0) + includedCourtHours,
      }, { onConflict: 'user_id,venue_id,entitlement_type,period_start' });
    }

    const bookingRef = bookings[0]?.booking_ref;
    if (!bookingRef) return errorResponse('Booking could not be created', 500);
    const slugParam = meta.slug ? `&v=${encodeURIComponent(meta.slug)}` : '';
    return jsonResponse({ free: true, redirect: `/my?booking=${encodeURIComponent(bookingRef)}${slugParam}` });
  }

  if (product_type === 'day_pass' && meta.entitlement_type === 'free_day_pass_monthly') {
    const today = DateTime.now().setZone('Europe/Stockholm').toISODate()!;
    const validDate = meta.date || today;
    const { data: dayPass } = await adminFree.from('day_passes').insert({
      venue_id, user_id: entitlementUserId, valid_date: validDate,
      purchase_date: today, price: 0, status: 'active', is_free: true,
    }).select('id').single();

    if (dayPass?.id) {
      await adminFree.from('access_entitlements').upsert({
        venue_id,
        user_id: entitlementUserId,
        entitlement_type: 'day_access',
        status: 'active',
        source_type: 'day_pass',
        source_id: dayPass.id,
        valid_date: validDate,
        includes_session_types: ['open_play'],
        metadata: {
          legacy_day_pass_id: dayPass.id,
          source: 'membership_free_pass',
        },
      }, { onConflict: 'source_type,source_id,user_id,entitlement_type' });

      const activitySessionId = meta.activity_session_id || meta.open_play_session_id;
      if (activitySessionId) {
        await adminFree.from('session_registrations').upsert({
          venue_id,
          activity_session_id: activitySessionId,
          session_date: validDate,
          user_id: entitlementUserId,
          status: 'confirmed',
          price_paid_sek: 0,
          source_type: 'day_pass',
          source_id: dayPass.id,
        }, { onConflict: 'activity_session_id,session_date,user_id' });
      }
    }

    await adminFree.from('membership_usage').upsert({
      user_id: entitlementUserId, venue_id,
      entitlement_type: 'free_day_pass_monthly',
      period_start: meta.entitlement_period_start,
      period_end: meta.entitlement_period_end,
      used_value: 1,
    }, { onConflict: 'user_id,venue_id,entitlement_type,period_start' });

    return jsonResponse({ free: true, redirect: safeLocalPath(meta.redirect_path) || '/my' });
  }

  if (product_type === 'activity_ticket' && meta.entitlement_type === 'open_play_unlimited') {
    const validDate = meta.date || DateTime.now().setZone('Europe/Stockholm').toISODate()!;
    const activitySessionId = meta.activity_session_id || meta.open_play_session_id;
    if (activitySessionId) {
      await adminFree.from('session_registrations').upsert({
        venue_id,
        activity_session_id: activitySessionId,
        session_date: validDate,
        user_id: entitlementUserId,
        status: 'confirmed',
        price_paid_sek: 0,
        source_type: 'membership',
        source_id: meta.membership_id || null,
        metadata: {
          session_type: meta.session_type || 'open_play',
          session_name: meta.session_name || null,
          entitlement_type: 'open_play_unlimited',
        },
      }, { onConflict: 'activity_session_id,session_date,user_id' });
    }

    await adminFree.from('access_entitlements').upsert({
      venue_id,
      user_id: entitlementUserId,
      entitlement_type: 'membership_access',
      status: 'active',
      source_type: 'membership',
      source_id: meta.membership_id || null,
      activity_session_id: activitySessionId || null,
      session_date: activitySessionId ? validDate : null,
      valid_date: validDate,
      includes_session_types: ['open_play'],
      metadata: {
        source: 'open_play_unlimited',
        session_name: meta.session_name || null,
        session_type: meta.session_type || 'open_play',
      },
    }, { onConflict: 'source_type,source_id,user_id,entitlement_type' });

    return jsonResponse({ free: true, redirect: safeLocalPath(meta.redirect_path) || '/my' });
  }

  if (product_type === 'activity_ticket' && meta.entitlement_type === 'session_member_discount') {
    const validDate = meta.date || DateTime.now().setZone('Europe/Stockholm').toISODate()!;
    const activitySessionId = meta.activity_session_id || meta.open_play_session_id;
    if (activitySessionId) {
      await adminFree.from('session_registrations').upsert({
        venue_id,
        activity_session_id: activitySessionId,
        session_date: validDate,
        user_id: entitlementUserId,
        status: 'confirmed',
        price_paid_sek: 0,
        source_type: 'membership',
        source_id: meta.membership_id || null,
        metadata: {
          session_type: meta.session_type || 'open_play',
          session_name: meta.session_name || null,
          entitlement_type: 'session_member_discount',
          pricing_reason: meta.pricing_reason || 'session_member_discount',
        },
      }, { onConflict: 'activity_session_id,session_date,user_id' });
    }

    return jsonResponse({ free: true, redirect: safeLocalPath(meta.redirect_path) || '/my' });
  }

  if (product_type === 'activity_ticket' && meta.entitlement_type === 'day_access') {
    const validDate = meta.date || DateTime.now().setZone('Europe/Stockholm').toISODate()!;
    const activitySessionId = meta.activity_session_id || meta.open_play_session_id;
    if (activitySessionId) {
      await adminFree.from('session_registrations').upsert({
        venue_id,
        activity_session_id: activitySessionId,
        session_date: validDate,
        user_id: entitlementUserId,
        status: 'confirmed',
        price_paid_sek: 0,
        source_type: 'access_entitlement',
        source_id: meta.access_entitlement_id || null,
        metadata: {
          session_type: meta.session_type || 'open_play',
          session_name: meta.session_name || null,
          entitlement_type: 'day_access',
        },
      }, { onConflict: 'activity_session_id,session_date,user_id' });
    }

    return jsonResponse({ free: true, redirect: safeLocalPath(meta.redirect_path) || '/my' });
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.split('/').pop() || '';

  // ── POST /create-checkout — create a Stripe Checkout Session (no auth required) ──
  if (req.method === 'POST' && path === 'create-checkout') {
    const body = await req.json();
    const { product_type, amount_sek, venue_id, metadata } = body;

    if (!product_type || amount_sek == null) return errorResponse('Missing required fields');
    if (!['court_booking', 'day_pass', 'activity_ticket', 'membership'].includes(product_type)) return errorResponse('Invalid product_type');
    if (typeof amount_sek !== 'number' || amount_sek < 0) return errorResponse('amount_sek must be zero or positive');
    // venue_id required for court_booking and day_pass, optional for membership
    if (product_type !== 'membership' && !venue_id) return errorResponse('Missing venue_id');

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) return errorResponse('Stripe not configured', 500);

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });

    // Derive base URL from request Origin to support multiple environments
    const origin = req.headers.get('origin') || 'http://localhost:8080';

    const meta = metadata || {};
    const isMembership = product_type === 'membership';

    if (product_type === 'court_booking') {
      let courtIds: string[] = [];
      try { courtIds = JSON.parse(meta.court_ids || '[]'); } catch { return errorResponse('Invalid court_ids', 400); }
      if (!courtIds.length || !meta.date || !meta.start_time || !meta.end_time) {
        return errorResponse('Missing booking metadata', 400);
      }

      const startISO = DateTime.fromISO(`${meta.date}T${meta.start_time}:00`, { zone: 'Europe/Stockholm' }).toUTC().toISO()!;
      const endISO = DateTime.fromISO(`${meta.date}T${meta.end_time}:00`, { zone: 'Europe/Stockholm' }).toUTC().toISO()!;
      const adminCheckout = getServiceClient();

      const { data: venueCourts } = await adminCheckout
        .from('venue_courts')
        .select('id')
        .eq('venue_id', venue_id)
        .in('id', courtIds);
      if ((venueCourts || []).length !== courtIds.length) {
        return errorResponse('One or more courts do not belong to this venue', 400);
      }

      const { data: conflicts } = await adminCheckout
        .from('bookings')
        .select('id')
        .eq('venue_id', venue_id)
        .in('venue_court_id', courtIds)
        .neq('status', 'cancelled')
        .lt('start_time', endISO)
        .gt('end_time', startISO)
        .limit(1);
      if (conflicts?.length) {
        return errorResponse('En eller flera banor är redan bokade för denna tid', 409);
      }

      const resourceBlocks = await getCourtResourceBlocks(adminCheckout, venue_id, courtIds, startISO, endISO);
      if (resourceBlocks.length) {
        return errorResponse('En eller flera banor är blockerade för event eller intern planering', 409);
      }
    }

    // ── Entitlement check — apply discounts / check limits ───────────────────
    // user_id is set in metadata by the frontend from useAuth(); membership
    // benefits are applied here. Hard cap (Founder 4h/week) blocks checkout.
    let baseAmountSek = amount_sek;
    let finalAmountSek = amount_sek;
    let entitlementUserId = meta.user_id || '';
    let activityPricingDecision: any = null;

    if ((product_type === 'day_pass' || product_type === 'activity_ticket') && venue_id && (meta.activity_session_id || meta.open_play_session_id)) {
      const adminCheckout = getServiceClient();
      if (meta.activity_session_id && meta.date) {
        const blocked = await isActivityOccurrenceBlocked(adminCheckout, venue_id, meta.activity_session_id, String(meta.date).slice(0, 10));
        if (blocked) return errorResponse('Aktiviteten är inte tillgänglig för anmälan', 409);
      }

      const { data: product } = meta.product_key
        ? await adminCheckout
          .from('access_products')
          .select('product_key, name, product_kind, session_type, base_price_sek, grants')
          .eq('venue_id', venue_id)
          .eq('product_key', meta.product_key)
          .eq('is_active', true)
          .maybeSingle()
        : { data: null };

      if (product) {
        meta.product_key = product.product_key;
        meta.product_kind = product.product_kind;
        meta.session_type = meta.session_type || product.session_type || 'open_play';
        meta.includes_day_access = product_type === 'day_pass' && (product.product_kind === 'day_access' || product.product_kind === 'session_with_day_access') ? 'true' : '';

        if (product.base_price_sek != null) {
          baseAmountSek = Number(product.base_price_sek);
          finalAmountSek = baseAmountSek;
          meta.base_amount_sek = String(baseAmountSek);
        }
      }

      const activitySessionId = meta.activity_session_id || meta.open_play_session_id;
      const { data: activitySession } = await adminCheckout
        .from('activity_sessions')
        .select('price_sek, venue_id, name, session_type, access_policy, metadata')
        .eq('id', activitySessionId)
        .maybeSingle();

      if (activitySession?.venue_id === venue_id && activitySession.price_sek != null) {
        // A scheduled session is the concrete thing being sold, so its price
        // must override the reusable product baseline (e.g. Fredagsklubben
        // can share the day_access product but still cost 99 kr).
        const sessionMetadata = activitySession.metadata && typeof activitySession.metadata === 'object'
          ? activitySession.metadata
          : {};
        baseAmountSek = Number(sessionMetadata.online_price_sek ?? activitySession.price_sek);
        finalAmountSek = baseAmountSek;
        meta.base_amount_sek = String(baseAmountSek);
        meta.online_price_sek = String(sessionMetadata.online_price_sek ?? baseAmountSek);
        meta.desk_price_sek = String(sessionMetadata.desk_price_sek ?? baseAmountSek);
        meta.pricing_channel_mode = String(sessionMetadata.pricing_channel_mode || '');
        meta.activity_session_id = activitySessionId;
        meta.session_name = meta.session_name || activitySession.name;
        meta.session_type = activitySession.session_type || 'open_play';
        meta.includes_day_access = product_type === 'day_pass' ? 'true' : '';
      } else if (meta.open_play_session_id) {
        const { data: openPlaySession } = await adminCheckout
          .from('open_play_sessions')
          .select('price_sek, venue_id')
          .eq('id', meta.open_play_session_id)
          .maybeSingle();

        if (openPlaySession?.venue_id === venue_id && openPlaySession.price_sek != null) {
          baseAmountSek = Number(openPlaySession.price_sek);
          finalAmountSek = baseAmountSek;
          meta.base_amount_sek = String(baseAmountSek);
        }
      }
    }

    if (!entitlementUserId) {
      const authHeader = req.headers.get('authorization') || '';
      if (authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice('Bearer '.length);
        const { data: { user: authUser } } = await getServiceClient().auth.getUser(token);
        entitlementUserId = authUser?.id || '';
        if (entitlementUserId) meta.user_id = entitlementUserId;
      }
    }

    if ((product_type === 'day_pass' || product_type === 'activity_ticket') && venue_id && (meta.activity_session_id || meta.open_play_session_id)) {
      const activitySessionId = meta.activity_session_id || meta.open_play_session_id;
      activityPricingDecision = await resolveActivityPricingDecision({
        client: getServiceClient(),
        venueId: venue_id,
        userId: entitlementUserId || null,
        activitySessionId,
        sessionDate: meta.date,
        requestedProductKey: product_type === 'day_pass' ? 'day_access' : (meta.product_key || null),
        requestedAmountSek: amount_sek,
        purchaseKind: product_type === 'day_pass' ? 'day_pass' : 'activity_ticket',
      });

      baseAmountSek = activityPricingDecision.baseAmountSek;
      finalAmountSek = activityPricingDecision.finalAmountSek;
      meta.activity_session_id = activitySessionId;
      meta.product_key = activityPricingDecision.productKey;
      meta.product_kind = activityPricingDecision.productKind || '';
      meta.base_amount_sek = String(activityPricingDecision.baseAmountSek);
      meta.effective_amount_sek = String(activityPricingDecision.finalAmountSek);
      meta.entitlement_type = activityPricingDecision.entitlementType || '';
      meta.membership_id = activityPricingDecision.membershipId || '';
      meta.pricing_reason = activityPricingDecision.pricingReason || '';
      meta.pricing_mode = String(activityPricingDecision.debug?.pricing_mode || '');
      meta.online_price_sek = String(activityPricingDecision.debug?.online_price_sek || '');
      meta.desk_price_sek = String(activityPricingDecision.debug?.desk_price_sek || '');
      meta.pricing_channel_mode = String(activityPricingDecision.debug?.pricing_channel_mode || '');
      meta.access_entitlement_id = activityPricingDecision.entitlementType === 'day_access'
        ? activityPricingDecision.sourceId || ''
        : '';
    }

    if (isMembership) {
      const firstName = String(meta.first_name || '').trim();
      const lastName = String(meta.last_name || '').trim();
      const phone = String(meta.customer_phone || '').trim();
      const customerName = String(meta.customer_name || [firstName, lastName].filter(Boolean).join(' ')).trim();

      if (!firstName || !lastName || !phone) {
        return errorResponse('Medlemskap kräver förnamn, efternamn och telefon', 400);
      }

      if (entitlementUserId) {
        const adminProfile = getServiceClient();
        const { data: existingProfile } = await adminProfile
          .from('player_profiles')
          .select('display_name')
          .eq('auth_user_id', entitlementUserId)
          .maybeSingle();

        await adminProfile.from('player_profiles').upsert({
          auth_user_id: entitlementUserId,
          display_name: existingProfile?.display_name || customerName,
          first_name: firstName,
          last_name: lastName,
          phone,
        }, { onConflict: 'auth_user_id' });
      }

      meta.customer_name = customerName;
      meta.customer_phone = phone;
    }

    if (entitlementUserId && !isMembership && venue_id) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const adminEnt = createClient(supabaseUrl, serviceKey);
      let entitlementSportType: string | null = (product_type === 'day_pass' || product_type === 'activity_ticket') ? 'pickleball' : null;

      if (product_type === 'court_booking' && meta.court_ids) {
        let courtIds: string[] = [];
        try { courtIds = JSON.parse(meta.court_ids || '[]'); } catch { courtIds = []; }

        if (courtIds.length > 0) {
          const { data: courtsForEntitlement } = await adminEnt
            .from('venue_courts')
            .select('sport_type')
            .in('id', courtIds);
          const sportTypes = [...new Set((courtsForEntitlement || []).map((c: any) => c.sport_type || 'pickleball'))];
          entitlementSportType = sportTypes.length === 1 ? sportTypes[0] : null;
        }
      }

      // Fetch active membership + entitlements
      const { data: membership } = await adminEnt
        .from('memberships')
        .select('id, tier_id, venue_id')
        .eq('user_id', entitlementUserId)
        .eq('venue_id', venue_id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (membership?.tier_id) {
        const { data: entitlements } = await adminEnt
          .from('membership_entitlements')
          .select('entitlement_type, value, period, sport_type')
          .eq('tier_id', membership.tier_id);

        const ents = (entitlements || []).filter((e: any) =>
          entitlementSportType && (e.sport_type || 'pickleball') === entitlementSportType
        );
        const hasEnt = (type: string) => ents.find((e: any) => e.entitlement_type === type);
        const pricingProductType = product_type === 'court_booking'
          ? 'court_hourly'
          : product_type === 'day_pass'
          ? (meta.product_key || 'day_access')
          : product_type === 'activity_ticket'
          ? (meta.product_key || 'session_ticket')
          : product_type;
        const { data: tierPricingRows } = await adminEnt
          .from('membership_tier_pricing')
          .select('product_type, fixed_price, discount_percent')
          .eq('tier_id', membership.tier_id)
          .eq('product_type', pricingProductType);

        const { data: tier } = await adminEnt
          .from('membership_tiers')
          .select('discount_percent')
          .eq('id', membership.tier_id)
          .maybeSingle();
        const tierDefaultDiscount = Number(tier?.discount_percent || 0);

        const applyTierPricing = (tierPricing: any, baseAmount: number) => {
          if (!tierPricing) return baseAmount;

          if (tierPricing.fixed_price != null) {
            if (product_type === 'court_booking') {
              let courtIds: string[] = [];
              try { courtIds = JSON.parse(meta.court_ids || '[]'); } catch { courtIds = []; }
              const durationHours = parseFloat(meta.duration_hours || '1') || 1;
              return Number(tierPricing.fixed_price) * Math.max(courtIds.length, 1) * durationHours;
            }

            return Number(tierPricing.fixed_price);
          }

          if (tierPricing.discount_percent) {
            return applyPercentDiscount(baseAmount, Number(tierPricing.discount_percent));
          }

          return baseAmount;
        };

        const bestTierPricingAmount = () => {
          if (entitlementSportType !== 'pickleball') return null;

          const amounts = (tierPricingRows || [])
            .filter((row: any) => row.fixed_price != null || row.discount_percent != null)
            .map((row: any) => applyTierPricing(row, baseAmountSek))
            .filter((amount: number) => Number.isFinite(amount) && amount >= 0);

          if (amounts.length === 0) return null;
          return Math.min(...amounts);
        };

        const tierDiscountAmount = () => {
          if (entitlementSportType !== 'pickleball' || tierDefaultDiscount <= 0) return null;
          return applyPercentDiscount(baseAmountSek, tierDefaultDiscount);
        };

        if (product_type === 'court_booking') {
          const courtDiscount = hasEnt('court_discount_pct');
          const tierPricingAmount = bestTierPricingAmount();
          const fallbackTierAmount = tierDiscountAmount();
          if (tierPricingAmount != null) {
            finalAmountSek = tierPricingAmount;
          } else if (courtDiscount) {
            finalAmountSek = applyPercentDiscount(baseAmountSek, Number(courtDiscount.value));
          } else if (fallbackTierAmount != null) {
            finalAmountSek = fallbackTierAmount;
          }

          // Founder-style included court-hours: use included hours first, then bill overage
          // with the tier price/discount instead of blocking checkout.
          const weekLimit = hasEnt('court_hours_per_week');
          if (weekLimit) {
            let courtIds: string[] = [];
            try { courtIds = JSON.parse(meta.court_ids || '[]'); } catch { courtIds = []; }
            const bookingHours = parseFloat(meta.duration_hours || '0') * Math.max(courtIds.length, 1);
            if (bookingHours > 0) {
              const quotaDate = meta.date
                ? DateTime.fromISO(meta.date, { zone: 'Europe/Stockholm' })
                : DateTime.now().setZone('Europe/Stockholm');
              const weekStart = quotaDate.startOf('week').toISODate()!;
              const weekEnd   = quotaDate.endOf('week').toISODate()!;

              const usedHours = await calculateIncludedCourtHoursFromBookings(
                adminEnt,
                entitlementUserId,
                venue_id,
                weekStart,
                weekEnd,
                entitlementSportType || 'pickleball',
              );
              const includedHours = Math.min(Math.max(Number(weekLimit.value) - Number(usedHours), 0), bookingHours);
              const paidHours = Math.max(bookingHours - includedHours, 0);
              const basePerCourtHour = bookingHours > 0 ? baseAmountSek / bookingHours : baseAmountSek;

              const tierPaidAmount = () => {
                const row = (tierPricingRows || []).find((pricing: any) =>
                  pricing.fixed_price != null || pricing.discount_percent != null
                );
                if (!row) return null;
                if (row.fixed_price != null) return Number(row.fixed_price) * paidHours;
                return applyPercentDiscount(basePerCourtHour * paidHours, Number(row.discount_percent || 0));
              };

              const discountPaidAmount = courtDiscount
                ? applyPercentDiscount(basePerCourtHour * paidHours, Number(courtDiscount.value))
                : fallbackTierAmount != null
                ? applyPercentDiscount(basePerCourtHour * paidHours, tierDefaultDiscount)
                : null;

              finalAmountSek = paidHours <= 0
                ? 0
                : Math.round((tierPaidAmount() ?? discountPaidAmount ?? (basePerCourtHour * paidHours)) * 100) / 100;

              meta.membership_id = membership.id;
              meta.included_court_hours = String(includedHours);
              meta.paid_court_hours = String(paidHours);
              meta.entitlement_period_start = weekStart;
              meta.entitlement_period_end = weekEnd;
              meta.entitlement_type = 'court_hours_per_week';
            }
          }
        }

        if (product_type === 'day_pass' && !activityPricingDecision) {
          const passDiscount = hasEnt('day_pass_discount_pct');
          const freePass = hasEnt('free_day_pass_monthly');
          const openPlayUnlimited = hasEnt('open_play_unlimited');
          const tierPricingAmount = bestTierPricingAmount();
          const fallbackTierAmount = tierDiscountAmount();
          let usedFreePass = false;

          if (openPlayUnlimited && (meta.session_type || 'open_play') === 'open_play') {
            finalAmountSek = 0;
            meta.entitlement_type = 'open_play_unlimited';
            meta.membership_id = membership.id;
            usedFreePass = true;
          }

          if (!usedFreePass && freePass) {
            const now = DateTime.now().setZone('Europe/Stockholm');
            const monthStart = now.startOf('month').toISODate()!;
            const monthEnd   = now.endOf('month').toISODate()!;

            const { data: usage } = await adminEnt
              .from('membership_usage')
              .select('used_value')
              .eq('user_id', entitlementUserId)
              .eq('venue_id', venue_id)
              .eq('entitlement_type', 'free_day_pass_monthly')
              .eq('period_start', monthStart)
              .maybeSingle();

            const usedPasses = (usage?.used_value || 0);
            if (usedPasses < freePass.value) {
              finalAmountSek = 0;
              meta.entitlement_type = 'free_day_pass_monthly';
              meta.entitlement_period_start = monthStart;
              meta.entitlement_period_end = monthEnd;
              usedFreePass = true;
            }
          }

          if (!usedFreePass) {
            // If the monthly free pass is already used, keep applying the paid member price.
            if (tierPricingAmount != null) {
              finalAmountSek = tierPricingAmount;
            } else if (passDiscount) {
              finalAmountSek = applyPercentDiscount(baseAmountSek, Number(passDiscount.value));
            } else if (fallbackTierAmount != null) {
              finalAmountSek = fallbackTierAmount;
            }
          }
        }
      }
    }

    // Free entitlement bookings bypass Stripe entirely
    if (finalAmountSek === 0 && !isMembership) {
      const freeResponse = await createFreeEntitlementBookingResponse({
        product_type,
        meta,
        venue_id,
        entitlementUserId,
      });
      if (freeResponse) return freeResponse;
    }

    // Use finalAmountSek for Stripe session (may be discounted)
    const billedAmountSek = finalAmountSek > 0 ? finalAmountSek : amount_sek;

    const productName = product_type === 'court_booking'
      ? `Banbokning${meta.date ? ` · ${meta.date}` : ''}${meta.start_time ? ` ${meta.start_time}–${meta.end_time || ''}` : ''}`
      : product_type === 'membership'
      ? `Pickla Membership${meta.tier_name ? ` · ${meta.tier_name}` : ''}`
      : product_type === 'activity_ticket'
      ? `Aktivitetsbiljett${meta.session_name ? ` · ${meta.session_name}` : ''}`
      : 'Dagspass';

    // Shared metadata (all values must be strings, max 500 chars each)
    const stripeMetadata: Record<string, string> = {
      product_type,
      venue_id:         String(venue_id             || ''),
      slug:             String(meta.slug             || ''),
      court_ids:        String(meta.court_ids        || '[]'),
      date:             String(meta.date             || ''),
      start_time:       String(meta.start_time       || ''),
      end_time:         String(meta.end_time         || ''),
      name:             String(meta.name             || '').slice(0, 200),
      phone:            String(meta.phone            || '').slice(0, 50),
      user_id:          String(meta.user_id          || ''),
      base_amount_sek:  String(meta.base_amount_sek  || baseAmountSek || ''),
      billed_amount_sek: String(billedAmountSek       || ''),
      pricing_mode:     String(meta.pricing_mode      || ''),
      pricing_reason:   String(meta.pricing_reason    || ''),
      online_price_sek: String(meta.online_price_sek  || ''),
      desk_price_sek:   String(meta.desk_price_sek    || ''),
      pricing_channel_mode: String(meta.pricing_channel_mode || ''),
      product_key:      String(meta.product_key       || ''),
      product_kind:     String(meta.product_kind      || ''),
      membership_id:    String(meta.membership_id     || ''),
      entitlement_type: String(meta.entitlement_type  || ''),
      entitlement_period_start: String(meta.entitlement_period_start || ''),
      entitlement_period_end: String(meta.entitlement_period_end || ''),
      included_court_hours: String(meta.included_court_hours || ''),
      paid_court_hours: String(meta.paid_court_hours || ''),
      // Membership-specific
      tier_id:          String(meta.tier_id          || ''),
      first_name:       String(meta.first_name       || '').slice(0, 100),
      last_name:        String(meta.last_name        || '').slice(0, 100),
      customer_name:    String(meta.customer_name    || '').slice(0, 200),
      customer_email:   String(meta.customer_email   || '').slice(0, 200),
      customer_phone:   String(meta.customer_phone   || '').slice(0, 50),
      // Day-pass-specific
      open_play_session_id: String(meta.open_play_session_id || ''),
      activity_session_id: String(meta.activity_session_id || ''),
      chat_room_id: String(meta.chat_room_id || ''),
      session_name:     String(meta.session_name     || ''),
      session_type:     String(meta.session_type     || 'open_play'),
      includes_day_access: String(meta.includes_day_access || ''),
    };

    const encodedSlug = meta.slug ? encodeURIComponent(String(meta.slug)) : '';
    const cancelPath = isMembership
      ? `/membership${encodedSlug ? `?v=${encodedSlug}` : ''}`
      : encodedSlug
      ? `/book?v=${encodedSlug}`
      : '/book';
    const requestedSuccessPath = safeLocalPath(meta.success_path);
    const successPath = isMembership
      ? (requestedSuccessPath || '/membership/confirmed')
      : product_type === 'day_pass'
      ? (requestedSuccessPath || '/booking/confirmed?type=day_pass')
      : product_type === 'activity_ticket'
      ? (requestedSuccessPath || '/booking/confirmed?type=session_ticket')
      : '/booking/confirmed';

    let stripeSession: Stripe.Checkout.Session;

    if (isMembership) {
      // Subscription mode — recurring monthly charge
      stripeSession = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'subscription',
        customer_email: stripeMetadata.customer_email || undefined,
        line_items: [{
          price_data: {
            currency: 'sek',
            product_data: { name: productName },
            unit_amount: Math.round(billedAmountSek * 100),
            tax_behavior: 'inclusive',
            recurring: { interval: 'month' },
          },
          quantity: 1,
        }],
        metadata: stripeMetadata,
        subscription_data: { metadata: stripeMetadata },
        success_url: `${origin}${successPath}${successPath.includes('?') ? '&' : '?'}session={CHECKOUT_SESSION_ID}`,
        cancel_url:  `${origin}${cancelPath}`,
      });
    } else {
      // One-time payment (court_booking, day_pass, activity_ticket)
      stripeSession = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        customer_email: stripeMetadata.customer_email || undefined,
        line_items: [{
          price_data: {
            currency: 'sek',
            product_data: { name: productName },
            unit_amount: Math.round(billedAmountSek * 100),
            tax_behavior: 'inclusive',
          },
          quantity: 1,
        }],
        metadata: stripeMetadata,
        success_url: `${origin}${successPath}${successPath.includes('?') ? '&' : '?'}session={CHECKOUT_SESSION_ID}`,
        cancel_url:  `${origin}${cancelPath}`,
      });
    }

    return jsonResponse({ url: stripeSession.url });
  }

  // ── GET /by-session?session=xxx — look up a booking by Stripe session ID ──
  if (req.method === 'GET' && path === 'by-session') {
    const sessionId = url.searchParams.get('session');
    if (!sessionId) return errorResponse('Missing session');

    const serviceClient = getServiceClient();
    const { data: booking } = await serviceClient
      .from('bookings')
      .select('booking_ref, venue_id')
      .eq('stripe_session_id', sessionId)
      .neq('status', 'cancelled')
      .limit(1)
      .maybeSingle();

    if (!booking) {
      const { data: registration } = await serviceClient
        .from('session_registrations')
        .select('id, venue_id, activity_session_id, session_date')
        .eq('stripe_session_id', sessionId)
        .neq('status', 'cancelled')
        .limit(1)
        .maybeSingle();

      if (!registration) return jsonResponse({ pending: true }, 200, 0);

      const { data: venue } = await serviceClient
        .from('venues')
        .select('slug')
        .eq('id', registration.venue_id)
        .maybeSingle();

      return jsonResponse({
        pending: false,
        type: 'session_ticket',
        registration_id: registration.id,
        activity_session_id: registration.activity_session_id,
        session_date: registration.session_date,
        venue_slug: venue?.slug || '',
      }, 200, 0);
    }

    const { data: venue } = await serviceClient
      .from('venues')
      .select('slug')
      .eq('id', booking.venue_id)
      .maybeSingle();

    return jsonResponse({ pending: false, booking_ref: booking.booking_ref, venue_slug: venue?.slug || '' }, 200, 0);
  }

  // ── Public endpoint: venue by slug (no auth required) ──
  if (req.method === 'GET' && path === 'public-venue') {
    const slug = url.searchParams.get('slug');
    if (!slug) return errorResponse('Missing slug');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    let venueResult = await admin.from('venues')
      .select('id, name, slug, description, address, city, logo_url, cover_image_url, primary_color, secondary_color, phone, email, website_url, status, group_booking_title, group_booking_intro, group_booking_notes, group_booking_image_url')
      .eq('slug', slug)
      .eq('is_public', true)
      .single();

    if (venueResult.error?.message?.includes('group_booking_')) {
      venueResult = await admin.from('venues')
        .select('id, name, slug, description, address, city, logo_url, cover_image_url, primary_color, secondary_color, phone, email, website_url, status')
        .eq('slug', slug)
        .eq('is_public', true)
        .single();
    }

    const { data: venue, error: vErr } = venueResult;
    if (vErr || !venue) return errorResponse('Venue not found', 404);

    // Get opening hours
    const { data: hours } = await admin.from('opening_hours')
      .select('day_of_week, open_time, close_time, is_closed')
      .eq('venue_id', venue.id)
      .order('day_of_week');

    const todaySthlm = DateTime.now().setZone('Europe/Stockholm').toISODate()!;
    const upcomingEndSthlm = DateTime.now().setZone('Europe/Stockholm').plus({ days: 14 }).toISODate()!;
    const { start: todayStartUtc, end: todayEndUtc } = stockholmDateRangeUtc(todaySthlm);
    const { end: upcomingEndUtc } = stockholmDateRangeUtc(upcomingEndSthlm);
    const { data: operationOverrides } = await admin
      .from('venue_operation_overrides')
      .select('id, title, reason, override_type, starts_at, ends_at, affects_entire_venue, status')
      .eq('venue_id', venue.id)
      .eq('status', 'active')
      .eq('affects_entire_venue', true)
      .lt('starts_at', upcomingEndUtc)
      .gt('ends_at', todayStartUtc)
      .order('starts_at');

    const todayOperationOverrides = (operationOverrides || []).filter((override: any) =>
      override.starts_at < todayEndUtc && override.ends_at > todayStartUtc
    );
    const upcomingOperationOverrides = (operationOverrides || []).filter((override: any) =>
      override.ends_at > todayEndUtc
    );

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

    return jsonResponse({
      venue,
      openingHours: hours || [],
      operationOverrides: operationOverrides || [],
      todayOperationOverrides,
      upcomingOperationOverrides,
      events: events || [],
      links: links || [],
    }, 200, 30);
  }

  // ── Public endpoint: display device by token (no auth required) ──
  if (req.method === 'GET' && path === 'display-device') {
    const token = url.searchParams.get('token');
    if (!token) return errorResponse('Missing token', 400);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: device, error: deviceErr } = await admin
      .from('display_devices')
      .select('id, name, device_token, mode, is_active, external_links, instructions, venue_id, venue_court_id, venues(id, name, slug), venue_courts(id, name, court_number, sport_type)')
      .eq('device_token', token)
      .eq('is_active', true)
      .maybeSingle();
    if (deviceErr || !device) return errorResponse('Device not found', 404);

    await admin
      .from('display_devices')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', device.id);

    const nowSthlm = DateTime.now().setZone('Europe/Stockholm');
    const today = nowSthlm.toISODate()!;
    const { start, end } = stockholmDateRangeUtc(today);
    const courtId = (device as any).venue_court_id;
    let bookings: any[] = [];

    if (courtId) {
      const { data } = await admin
        .from('bookings')
        .select('id, start_time, end_time, status, booking_ref, notes, access_code')
        .eq('venue_id', (device as any).venue_id)
        .eq('venue_court_id', courtId)
        .neq('status', 'cancelled')
        .lt('start_time', end)
        .gt('end_time', start)
        .order('start_time', { ascending: true });
      bookings = data || [];
    }

    const nowMs = nowSthlm.toUTC().toMillis();
    const currentBooking = bookings.find((booking: any) =>
      DateTime.fromISO(booking.start_time, { zone: 'utc' }).toMillis() <= nowMs &&
      DateTime.fromISO(booking.end_time, { zone: 'utc' }).toMillis() > nowMs
    ) || null;
    const nextBooking = bookings.find((booking: any) =>
      DateTime.fromISO(booking.start_time, { zone: 'utc' }).toMillis() > nowMs
    ) || null;

    let currentCheckin: any = null;
    let currentCheckins: any[] = [];
    if (currentBooking?.id) {
      let groupBookingIds = [currentBooking.id];
      if (currentBooking.access_code) {
        const { data: groupBookings } = await admin
          .from('bookings')
          .select('id')
          .eq('venue_id', (device as any).venue_id)
          .eq('access_code', currentBooking.access_code)
          .eq('start_time', currentBooking.start_time)
          .eq('end_time', currentBooking.end_time)
          .neq('status', 'cancelled');
        groupBookingIds = (groupBookings || []).map((booking: any) => booking.id).filter(Boolean);
        if (groupBookingIds.length === 0) groupBookingIds = [currentBooking.id];
      }

      if (groupBookingIds.length > 0) {
        const { data: checkins } = await admin
          .from('venue_checkins')
          .select('id, player_name, checked_in_at')
          .eq('venue_id', (device as any).venue_id)
          .eq('entry_type', 'booking_code')
          .in('entitlement_id', groupBookingIds)
          .is('checked_out_at', null)
          .order('checked_in_at', { ascending: false });
        currentCheckins = checkins || [];
        currentCheckin = currentCheckins[0] || null;
      }
    }

    return jsonResponse({
      device,
      venue: (device as any).venues,
      resource: (device as any).venue_courts,
      currentBooking: currentBooking ? {
        ...currentBooking,
        checked_in: currentCheckins.length > 0,
        player_name: currentCheckin?.player_name || nameFromBookingNotes(currentBooking.notes) || null,
        checked_in_at: currentCheckin?.checked_in_at || null,
      } : null,
      nextBooking,
    }, 200, 10);
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
      .select('id, booking_ref, venue_court_id, start_time, end_time, total_price, status, notes, venue_id, user_id, access_code, stripe_session_id, created_at, venue_courts(name, court_number, sport_type)')
      .eq('booking_ref', ref).single();

    if (!booking) return errorResponse('Booking not found', 404);

    // Get venue info
    const { data: venue } = await admin.from('venues')
      .select('name, slug, address, city, logo_url').eq('id', booking.venue_id).single();

    // Find sibling bookings. Stripe groups by session; free/direct bookings fall back to the shared time+notes group.
    let siblingQuery = admin.from('bookings')
      .select('id, booking_ref, venue_court_id, start_time, end_time, total_price, venue_courts(name, court_number, sport_type)')
      .eq('venue_id', booking.venue_id)
      .neq('status', 'cancelled');

    if (booking.stripe_session_id) {
      siblingQuery = siblingQuery.eq('stripe_session_id', booking.stripe_session_id);
    } else {
      siblingQuery = siblingQuery
        .eq('start_time', booking.start_time)
        .eq('end_time', booking.end_time)
        .eq('notes', booking.notes);
    }

    const { data: siblings } = await siblingQuery;
    const groupedBookings = siblings?.length ? siblings : [booking];
    const looksLikeFreeDartDirectBooking = !booking.stripe_session_id &&
      groupedBookings.length > 0 &&
      groupedBookings.every((b: any) => b.venue_courts?.sport_type === 'dart');
    const totalPrice = looksLikeFreeDartDirectBooking
      ? 0
      : groupedBookings.reduce((s: number, b: any) => s + (b.total_price || 0), 0);
    const bookingRefs = groupedBookings.map((b: any) => b.booking_ref).filter(Boolean);

    let receipt: any = null;
    if (booking.stripe_session_id) {
      const receiptResult = await admin.from('booking_receipts')
        .select('*')
        .eq('stripe_session_id', booking.stripe_session_id)
        .maybeSingle();
      receipt = receiptResult.data || null;
      if (receiptResult.error) console.error('Receipt lookup failed:', receiptResult.error.message);
    } else if (booking.booking_ref) {
      const receiptResult = await admin.from('booking_receipts')
        .select('*')
        .contains('booking_refs', [booking.booking_ref])
        .limit(1)
        .maybeSingle();
      receipt = receiptResult.data || null;
      if (receiptResult.error) console.error('Receipt lookup failed:', receiptResult.error.message);
    }

    const vatRate = Number(receipt?.vat_rate || 6);
    const fallbackVat = vatPartsFromIncludedTotal(totalPrice, vatRate);
    const receiptView = {
      receipt_number: receipt?.receipt_number || booking.booking_ref,
      booking_refs: receipt?.booking_refs || bookingRefs,
      stripe_session_id: receipt?.stripe_session_id || booking.stripe_session_id || null,
      stripe_payment_intent_id: receipt?.stripe_payment_intent_id || null,
      stripe_customer_id: receipt?.stripe_customer_id || null,
      stripe_subscription_id: receipt?.stripe_subscription_id || null,
      customer_name: receipt?.customer_name || (booking.notes || '').split(' | ')[0] || null,
      customer_email: receipt?.customer_email || (booking.notes || '').split(' | ')[2] || null,
      customer_phone: receipt?.customer_phone || (booking.notes || '').split(' | ')[1] || null,
      personal_identity_number: receipt?.personal_identity_number || null,
      employer_note: receipt?.employer_note || null,
      wellness_requested: Boolean(receipt?.wellness_requested),
      product_description: receipt?.product_description || 'Banbokning',
      purchase_type: receipt?.purchase_type || 'booking',
      payment_method: receipt?.payment_method || (booking.stripe_session_id ? 'Kort via Stripe' : 'Pickla'),
      total_inc_vat: receipt?.total_inc_vat ?? totalPrice,
      total_ex_vat: receipt?.total_ex_vat ?? Math.round(fallbackVat.totalExVat),
      vat_amount: receipt?.vat_amount ?? Math.round(fallbackVat.vatAmount),
      total_inc_vat_sek: Number(receipt?.total_inc_vat_sek ?? totalPrice),
      total_ex_vat_sek: Number(receipt?.total_ex_vat_sek ?? fallbackVat.totalExVat),
      vat_amount_sek: Number(receipt?.vat_amount_sek ?? fallbackVat.vatAmount),
      vat_rate: vatRate,
      currency: receipt?.currency || 'SEK',
      payment_provider: receipt?.payment_provider || (booking.stripe_session_id ? 'stripe' : 'pickla'),
      payment_status: receipt?.payment_status || (totalPrice > 0 ? 'paid' : 'free'),
      issued_at: receipt?.issued_at || booking.created_at,
      is_snapshot: Boolean(receipt),
    };

    return jsonResponse({
      booking,
      venue,
      courts: groupedBookings.map((b: any) => ({
        ref: b.booking_ref,
        court_name: b.venue_courts?.name,
        price: b.total_price,
      })),
      totalPrice,
      receipt: receiptView,
    }, 200, 30);
  }

  // ── Public endpoint: available courts for a venue ──
  if (req.method === 'GET' && path === 'public-courts') {
    const venueSlug = url.searchParams.get('slug');
    const date = url.searchParams.get('date'); // YYYY-MM-DD
    if (!venueSlug || !date) return errorResponse('Missing slug or date');
    const requestedDays = Number(url.searchParams.get('days') || '1');
    const days = Number.isFinite(requestedDays)
      ? Math.min(Math.max(Math.floor(requestedDays), 1), 14)
      : 1;
    const requestedDates = Array.from({ length: days }, (_, index) =>
      DateTime.fromISO(date, { zone: 'Europe/Stockholm' }).plus({ days: index }).toISODate()!
    );

    // showAll=true skips the is_available filter — used by the ops display screen
    const showAll = url.searchParams.get('showAll') === 'true';

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: venue } = await admin.from('venues')
      .select('id, name').eq('slug', venueSlug).eq('is_public', true).single();
    if (!venue) return errorResponse('Venue not found', 404);

    // Get courts — display screen passes showAll=true to include unavailable courts
    let courtQuery = admin.from('venue_courts')
      .select('id, name, court_number, court_type, sport_type, hourly_rate, is_available')
      .eq('venue_id', venue.id)
      .order('court_number');
    if (!showAll) courtQuery = courtQuery.eq('is_available', true);
    const { data: courts } = await courtQuery;

    // Get opening hours for requested day(s)
    const { data: hoursRows } = await admin.from('opening_hours')
      .select('day_of_week, open_time, close_time, is_closed')
      .eq('venue_id', venue.id);
    const hoursByDay = new Map((hoursRows || []).map((row: any) => [row.day_of_week, row]));

    // Get existing bookings for the requested date range
    const { start } = stockholmDateRangeUtc(requestedDates[0]);
    const { end } = stockholmDateRangeUtc(requestedDates[requestedDates.length - 1]);
    const { data: bookings } = await admin.from('bookings')
      .select('venue_court_id, start_time, end_time')
      .eq('venue_id', venue.id)
      .neq('status', 'cancelled')
      .lt('start_time', end)
      .gt('end_time', start);

    // Get active pricing rules for this venue
    const { data: pricingRules } = await admin.from('pricing_rules')
      .select('id, name, type, price, days_of_week, time_from, time_to, sport_type, court_type')
      .eq('venue_id', venue.id).eq('is_active', true)
      .order('price', { ascending: false });

    const emptyAvailability = () => ({ openingHours: null, bookings: [] as any[] });
    const availabilityByDate: Record<string, { openingHours: any; bookings: any[] }> = Object.fromEntries(
      requestedDates.map((dateKey) => {
        const dayOfWeek = new Date(dateKey + 'T12:00:00Z').getUTCDay();
        const hours = hoursByDay.get(dayOfWeek) || null;
        return [dateKey, {
          openingHours: hours ? {
            open_time: hours.open_time,
            close_time: hours.close_time,
            is_closed: hours.is_closed,
          } : null,
          bookings: [],
        }];
      })
    );

    for (const booking of bookings || []) {
      const bookingDate = DateTime.fromISO(booking.start_time, { zone: 'utc' })
        .setZone('Europe/Stockholm')
        .toISODate()!;
      const bucket = availabilityByDate[bookingDate] || emptyAvailability();
      bucket.bookings.push({
        court_id: booking.venue_court_id,
        start: booking.start_time,
        end: booking.end_time,
      });
      availabilityByDate[bookingDate] = bucket;
    }

    const courtIds = (courts || []).map((court: any) => court.id).filter(Boolean);
    const resourceBlocks = await getCourtResourceBlocks(admin, venue.id, courtIds, start, end);
    for (const block of resourceBlocks) {
      for (const requestedDate of requestedDates) {
        const range = stockholmDateRangeUtc(requestedDate);
        if (block.start < range.end && block.end > range.start) {
          const bucket = availabilityByDate[requestedDate] || emptyAvailability();
          bucket.bookings.push({
            court_id: block.court_id,
            start: block.start,
            end: block.end,
            status: 'blocked',
            block_id: block.id,
            title: block.title,
            kind: 'resource_block',
          });
          availabilityByDate[requestedDate] = bucket;
        }
      }
    }

    const selectedAvailability = availabilityByDate[date] || emptyAvailability();
    return jsonResponse({
      venue: { id: venue.id, name: venue.name },
      courts: courts || [],
      openingHours: selectedAvailability.openingHours,
      bookings: selectedAvailability.bookings,
      pricingRules: pricingRules || [],
      ...(days > 1 ? { availabilityByDate } : {}),
    }, 200, 10);
  }

  if (req.method === 'POST' && path === 'public-book') {
    const body = await req.json();
    const { slug, courtIds, date, startTime, endTime, name, phone, email, corporatePackageId } = body;

    const safeName = typeof name === 'string' ? name.trim() : '';
    const safePhone = typeof phone === 'string'
      ? phone.replace(/[^\d+()\-\s]/g, '').trim()
      : '';
    const safeEmail = typeof email === 'string' ? email.trim().toLowerCase().slice(0, 200) : '';

    if (!slug || !courtIds?.length || !date || !startTime || !endTime || !safeName || !safePhone || !safeEmail) {
      return errorResponse('Fyll i alla fält');
    }
    if (safeName.length > 100 || safePhone.length < 6 || safePhone.length > 20 || !safeEmail.includes('@')) {
      return errorResponse('Ogiltiga uppgifter', 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: venue } = await admin.from('venues')
      .select('id').eq('slug', slug).eq('is_public', true).single();
    if (!venue) return errorResponse('Venue not found', 404);

    // Build UTC ISO timestamps from Stockholm local time
    const startISO = DateTime.fromISO(`${date}T${startTime}:00`, { zone: 'Europe/Stockholm' }).toUTC().toISO()!;
    const endISO = DateTime.fromISO(`${date}T${endTime}:00`, { zone: 'Europe/Stockholm' }).toUTC().toISO()!;
    const durationHours = (new Date(endISO).getTime() - new Date(startISO).getTime()) / 3600000;

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

    const resourceBlocks = await getCourtResourceBlocks(admin, venue.id, courtIds, startISO, endISO);
    if (resourceBlocks.length) {
      return errorResponse('En eller flera banor är blockerade för event eller intern planering', 409);
    }

    // Try to resolve authenticated user from Authorization header
    let bookingUserId: string | null = null;
    const authHeader = req.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const { data: { user: authUser } } = await admin.auth.getUser(token);
      if (authUser?.id) {
        bookingUserId = authUser.id;
      }
    }

    if (!bookingUserId && safeEmail) {
      const existing = await findAuthUserByEmail(admin, safeEmail);
      if (existing?.id) {
        bookingUserId = existing.id;
      } else {
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email: safeEmail,
          email_confirm: true,
          user_metadata: { display_name: safeName, phone: safePhone },
        });
        if (created?.user?.id) bookingUserId = created.user.id;
        if (createErr) console.error('Failed to create booking user from public-book:', createErr.message);
      }
    }

    // Validate corporate package if provided
    let validCorporatePackageId: string | null = null;
    if (corporatePackageId && bookingUserId) {
      const { data: pkg } = await admin.from('corporate_packages')
        .select('id, total_hours, used_hours, status, corporate_account_id')
        .eq('id', corporatePackageId)
        .eq('status', 'active')
        .single();

      if (pkg) {
        // Verify user is a member of this corporate account
        const { data: membership } = await admin.from('corporate_members')
          .select('id')
          .eq('corporate_account_id', pkg.corporate_account_id)
          .eq('user_id', bookingUserId)
          .maybeSingle();

        if (membership) {
          const totalBookingHours = durationHours * courtIds.length;
          const remaining = pkg.total_hours - pkg.used_hours;
          if (totalBookingHours > remaining) {
            return errorResponse(`Inte tillräckligt med timmar kvar (${remaining}h tillgängligt)`, 400);
          }
          validCorporatePackageId = pkg.id;
        }
      }
    }

    // Fallback to guest user if not authenticated
    if (!bookingUserId) {
      bookingUserId = await getOrCreatePublicBookingUserId(admin);
    }

    // Fetch pricing rules for this venue
    const { data: pricingRules } = await admin.from('pricing_rules')
      .select('type, price, days_of_week, time_from, time_to, sport_type, court_type')
      .eq('venue_id', venue.id).eq('is_active', true).eq('type', 'hourly')
      .order('price', { ascending: false });

    const bookingDayOfWeek = new Date(date + 'T12:00:00Z').getUTCDay();

    const bookings = [];
    let totalHoursBooked = 0;
    const sharedAccessCode = await generateAccessCode(admin, venue.id, date);
    for (const courtId of courtIds) {
      const { data: court } = await admin.from('venue_courts')
        .select('hourly_rate, sport_type, court_type').eq('id', courtId).single();

      // Find matching pricing rule: day + time window
      let hourlyRate = court?.hourly_rate != null
        ? Number(court.hourly_rate)
        : (court?.sport_type === 'dart' ? 0 : 350);
      if (pricingRules && pricingRules.length > 0) {
        const matchingRule = pricingRules.find((r: any) => {
          const daysMatch = !r.days_of_week || r.days_of_week.length === 0 || r.days_of_week.includes(bookingDayOfWeek);
          const sportMatches = !r.sport_type || r.sport_type === (court?.sport_type || 'pickleball');
          const courtTypeMatches = !r.court_type || r.court_type === (court?.court_type || null);
          const timeFrom = r.time_from || '00:00';
          const timeTo = r.time_to || '23:59';
          return sportMatches && courtTypeMatches && daysMatch && startTime >= timeFrom.slice(0, 5) && startTime < timeTo.slice(0, 5);
        });
        if (matchingRule) hourlyRate = matchingRule.price;
      }

      const price = validCorporatePackageId ? 0 : Math.round(hourlyRate * durationHours);

      const { data: booking, error: bErr } = await admin.from('bookings').insert({
        venue_id: venue.id,
        venue_court_id: courtId,
        user_id: bookingUserId,
        booked_by: bookingUserId,
        start_time: startISO,
        end_time: endISO,
        total_price: price,
        status: 'confirmed',
        notes: `${safeName} | ${safePhone} | ${safeEmail}`,
        corporate_package_id: validCorporatePackageId,
        access_code: sharedAccessCode,
        access_code_expires_at: endISO,
      }).select().single();

      if (bErr) return errorResponse(bErr.message);
      bookings.push(booking);
      totalHoursBooked += durationHours;
    }

    // Deduct hours from corporate package
    if (validCorporatePackageId && totalHoursBooked > 0) {
      const { data: currentPkg } = await admin.from('corporate_packages')
        .select('used_hours').eq('id', validCorporatePackageId).single();
      if (currentPkg) {
        await admin.from('corporate_packages')
          .update({ used_hours: (currentPkg.used_hours || 0) + totalHoursBooked })
          .eq('id', validCorporatePackageId);
      }
    }

    return jsonResponse({ bookings, count: bookings.length, corporate: !!validCorporatePackageId }, 201);
  }

  try {
    const { client, userId, error } = await getAuthenticatedClient(req);
    if (error || !client || !userId) return errorResponse(error || 'Unauthorized', 401);

    // GET /api-bookings/receipt?ref=PICKLA-2026-000001 — authenticated receipt snapshot
    if (req.method === 'GET' && path === 'receipt') {
      const ref = (url.searchParams.get('ref') || '').trim();
      if (!ref) return errorResponse('Missing receipt ref', 400);

      const admin = getServiceClient();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ref);
      const query = admin
        .from('booking_receipts')
        .select('*')
        .eq('user_id', userId)
        .limit(1);

      const { data: receipt, error: receiptErr } = await (isUuid
        ? query.eq('id', ref).maybeSingle()
        : query.eq('receipt_number', ref).maybeSingle());

      if (receiptErr) return errorResponse(receiptErr.message, 500);
      if (!receipt) return errorResponse('Receipt not found', 404);

      return jsonResponse({ receipt }, 200, 30);
    }

    // GET /api-bookings/wellness?year=YYYY — printable friskvårdsintyg
    if (req.method === 'GET' && path === 'wellness') {
      const requestedYear = Number(url.searchParams.get('year') || DateTime.now().setZone('Europe/Stockholm').year);
      const year = Number.isFinite(requestedYear)
        ? Math.min(Math.max(Math.floor(requestedYear), 2020), 2100)
        : DateTime.now().setZone('Europe/Stockholm').year;
      const start = DateTime.fromObject({ year, month: 1, day: 1 }, { zone: 'Europe/Stockholm' }).toUTC().toISO()!;
      const end = DateTime.fromObject({ year: year + 1, month: 1, day: 1 }, { zone: 'Europe/Stockholm' }).toUTC().toISO()!;
      const startDay = DateTime.fromObject({ year, month: 1, day: 1 }, { zone: 'Europe/Stockholm' }).toISODate()!;
      const endDay = DateTime.fromObject({ year: year + 1, month: 1, day: 1 }, { zone: 'Europe/Stockholm' }).toISODate()!;
      const admin = getServiceClient();

      const [receiptRes, profileRes, wellnessProfileRes, legacyDayPassesRes] = await Promise.all([
        admin.from('booking_receipts')
          .select('id, receipt_number, booking_refs, purchase_type, product_description, customer_name, customer_email, customer_phone, total_inc_vat, total_inc_vat_sek, total_ex_vat_sek, vat_amount_sek, vat_rate, issued_at, payment_method, stripe_session_id')
          .eq('user_id', userId)
          .eq('payment_status', 'paid')
          .gte('issued_at', start)
          .lt('issued_at', end)
          .gt('total_inc_vat', 0)
          .order('issued_at', { ascending: true }),
        client.from('player_profiles')
          .select('display_name, first_name, last_name, phone')
          .eq('auth_user_id', userId)
          .maybeSingle(),
        client.from('wellness_receipt_profiles')
          .select('personal_identity_number, employer_note')
          .eq('auth_user_id', userId)
          .maybeSingle(),
        admin.from('day_passes')
          .select('id, price, purchase_date, stripe_session_id')
          .eq('user_id', userId)
          .gte('purchase_date', startDay)
          .lt('purchase_date', endDay)
          .gt('price', 0)
          .not('stripe_session_id', 'is', null)
      ]);

      if (receiptRes.error) return errorResponse(receiptRes.error.message);

      const typeLabel = (type: string | null | undefined) => {
        if (type === 'booking') return 'Banbokning';
        if (type === 'activity_session') return 'Aktivitet';
        if (type === 'day_pass') return 'Dagsmedlemskap';
        if (type === 'membership') return 'Medlemskap';
        return 'Friskvård';
      };
      const items = (receiptRes.data || []).map((receipt: any) => ({
        id: receipt.id,
        type: typeLabel(receipt.purchase_type),
        date: DateTime.fromISO(receipt.issued_at, { zone: 'utc' }).setZone('Europe/Stockholm').toISODate(),
        label: receipt.product_description || typeLabel(receipt.purchase_type),
        reference: receipt.receipt_number,
        amount: Number(receipt.total_inc_vat_sek ?? receipt.total_inc_vat ?? 0),
        vat_amount: Number(receipt.vat_amount_sek ?? 0),
        payment_method: receipt.payment_method || 'Kort via Stripe',
        stripe_session_id: receipt.stripe_session_id || null,
      }));

      const receiptStripeSessionIds = new Set(items.map((i: any) => i.stripe_session_id).filter(Boolean));
      const legacyItems = (legacyDayPassesRes.data || [])
        .filter((pass: any) => pass.stripe_session_id && !receiptStripeSessionIds.has(pass.stripe_session_id))
        .map((pass: any) => {
          const amount = Number(pass.price);
          const vat_amount = Math.round((amount * 6 / 106) * 100) / 100;
          return {
            id: pass.id,
            type: 'Dagsmedlemskap',
            date: (pass.purchase_date || '').slice(0, 10),
            label: 'Dagsmedlemskap',
            reference: pass.id,
            amount: amount,
            vat_amount: vat_amount,
            payment_method: 'Kort via Stripe',
            stripe_session_id: pass.stripe_session_id,
          };
        });

      items.push(...legacyItems);
      items.sort((a: any, b: any) => ((a.date || '') > (b.date || '') ? 1 : (a.date || '') < (b.date || '') ? -1 : 0));

      const total = items.reduce((sum, item) => sum + item.amount, 0);
      const vatRate = 6;
      const vat = vatPartsFromIncludedTotal(total, vatRate);

      return jsonResponse({
        year,
        issued_at: DateTime.now().toUTC().toISO(),
        user_id: userId,
        customer: {
          name: [profileRes.data?.first_name, profileRes.data?.last_name].filter(Boolean).join(' ') || profileRes.data?.display_name || null,
          phone: profileRes.data?.phone || null,
          personal_identity_number: wellnessProfileRes.data?.personal_identity_number || null,
          employer_note: wellnessProfileRes.data?.employer_note || null,
        },
        items,
        total_inc_vat: vat.totalIncVat,
        total_ex_vat: vat.totalExVat,
        vat_amount: vat.vatAmount,
        vat_rate: vatRate,
        currency: 'SEK',
      }, 200, 0);
    }

    // POST /api-bookings/wellness-profile — stores sensitive wellness receipt fields for current user only
    if (req.method === 'POST' && path === 'wellness-profile') {
      const body = await req.json();
      const personalIdentityNumber = String(body.personal_identity_number || '').trim().slice(0, 20);
      const employerNote = String(body.employer_note || '').trim().slice(0, 200);

      const { error: upsertErr } = await client.from('wellness_receipt_profiles').upsert({
        auth_user_id: userId,
        personal_identity_number: personalIdentityNumber || null,
        employer_note: employerNote || null,
      }, { onConflict: 'auth_user_id' });

      if (upsertErr) return errorResponse(upsertErr.message, 500);
      return jsonResponse({ success: true }, 200, 0);
    }

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
        const { start, end } = stockholmDateRangeUtc(date);
        query = query.gte('start_time', start).lte('start_time', end);
      }

      const { data, error: qErr } = await query;
      if (qErr) return errorResponse(qErr.message);

      const courtBookings = (data || []).map((booking: any) => ({
        ...booking,
        kind: 'court_booking',
        booking_type: 'Banbokning',
      }));

      let activityRegistrations: any[] = [];
      if (date) {
        const { data: registrations, error: regErr } = await client
          .from('session_registrations')
          .select('id, venue_id, activity_session_id, session_date, user_id, status, price_paid_sek, created_at, activity_sessions(id, name, session_type, start_time, end_time, capacity)')
          .eq('venue_id', venueId)
          .eq('session_date', date)
          .neq('status', 'cancelled');

        if (regErr) return errorResponse(regErr.message);

        const userIds = Array.from(new Set((registrations || []).map((row: any) => row.user_id).filter(Boolean)));
        const profilesByUserId = new Map<string, any>();

        if (userIds.length > 0) {
          const { data: profiles, error: profilesErr } = await client
            .from('player_profiles')
            .select('auth_user_id, display_name, first_name, last_name, phone')
            .in('auth_user_id', userIds);

          if (profilesErr) return errorResponse(profilesErr.message);
          for (const profile of profiles || []) {
            profilesByUserId.set(profile.auth_user_id, profile);
          }
        }

        activityRegistrations = (registrations || []).map((registration: any) => {
          const session = registration.activity_sessions || {};
          const startTime = stockholmSessionIso(registration.session_date, session.start_time, false);
          const endTime = stockholmSessionIso(registration.session_date, session.end_time, true);
          const participantName = profileDisplayName(profilesByUserId.get(registration.user_id)) || 'Deltagare';

          return {
            id: `session_registration:${registration.id}`,
            kind: 'activity_registration',
            booking_type: 'Aktivitet',
            session_registration_id: registration.id,
            activity_session_id: registration.activity_session_id,
            session_date: registration.session_date,
            venue_id: registration.venue_id,
            venue_court_id: null,
            start_time: startTime,
            end_time: endTime,
            status: registration.status || 'confirmed',
            total_price: registration.price_paid_sek,
            booked_by: participantName,
            notes: session.name || 'Aktivitet',
            booking_ref: null,
            venue_courts: null,
            activity_session: {
              id: session.id,
              name: session.name,
              session_type: session.session_type,
              capacity: session.capacity,
              start_time: session.start_time,
              end_time: session.end_time,
            },
          };
        });
      }

      const items = [...courtBookings, ...activityRegistrations].sort((a: any, b: any) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
      );

      return jsonResponse(items, 200, 5);
    }

    // GET /api-bookings/revenue?venueId=X&date=YYYY-MM-DD
    if (req.method === 'GET' && path === 'revenue') {
      const venueId = url.searchParams.get('venueId');
      const date = url.searchParams.get('date');
      if (!venueId || !date) return errorResponse('Missing venueId or date');

      const { start, end } = stockholmDateRangeUtc(date);

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

    // GET /api-bookings/pricing?venueId=X
    if (req.method === 'GET' && path === 'pricing') {
      const venueId = url.searchParams.get('venueId');
      if (!venueId) return errorResponse('Missing venueId');

      const { data, error: qErr } = await client.from('pricing_rules')
        .select('id, name, type, price, days_of_week, time_from, time_to, is_active')
        .eq('venue_id', venueId).eq('is_active', true).order('price');
      if (qErr) return errorResponse(qErr.message);

      return jsonResponse(data, 200, 30);
    }

    // GET /api-bookings/hours?venueId=X
    if (req.method === 'GET' && path === 'hours') {
      const venueId = url.searchParams.get('venueId');
      if (!venueId) return errorResponse('Missing venueId');

      const { data, error: qErr } = await client.from('opening_hours')
        .select('day_of_week, open_time, close_time, is_closed')
        .eq('venue_id', venueId).order('day_of_week');
      if (qErr) return errorResponse(qErr.message);

      return jsonResponse(data, 200, 60);
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

      const bookingDate = DateTime.fromISO(startTime, { zone: 'utc' }).setZone('Europe/Stockholm').toISODate()!;
      const accessCode = await generateAccessCode(getServiceClient(), venueId, bookingDate);

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
        access_code: accessCode,
        access_code_expires_at: endTime,
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

    // POST /api-bookings/cancel — cancel one booking row or a grouped booking.
    if (req.method === 'POST' && path === 'cancel') {
      const body = await req.json();
      const ids = Array.isArray(body.bookingIds)
        ? body.bookingIds.filter(Boolean)
        : body.bookingId
        ? [body.bookingId]
        : [];
      if (!ids.length) return errorResponse('Missing bookingIds');

      const admin = getServiceClient();
      const { data: rows, error: rowsErr } = await admin
        .from('bookings')
        .select('id, venue_id, user_id, booked_by, status, start_time, end_time, total_price, included_court_hours, membership_usage_period_start, membership_usage_period_end, venue_courts(sport_type)')
        .in('id', ids);
      if (rowsErr) return errorResponse(rowsErr.message, 500);
      if (!rows?.length) return errorResponse('Booking not found', 404);

      const requestedIds = new Set(ids.map(String));
      if (rows.length !== requestedIds.size) return errorResponse('One or more bookings were not found', 404);

      const venueIds = Array.from(new Set(rows.map((row: any) => row.venue_id).filter(Boolean)));
      const userOwnsAll = rows.every((row: any) => row.user_id === userId || row.booked_by === userId);
      let staffCanCancel = false;
      if (!userOwnsAll && venueIds.length === 1) {
        staffCanCancel = await (async () => {
          const { data: role } = await admin.from('user_roles')
            .select('role')
            .eq('user_id', userId)
            .eq('role', 'super_admin')
            .maybeSingle();
          if (role) return true;
          const { data: staff } = await admin.from('venue_staff')
            .select('id')
            .eq('user_id', userId)
            .eq('venue_id', venueIds[0])
            .eq('is_active', true)
            .maybeSingle();
          return !!staff;
        })();
      }
      if (!userOwnsAll && !staffCanCancel) return errorResponse('Forbidden', 403);

      await refundMembershipCourtHours(admin, rows || []);

      const { data, error: cancelErr } = await admin
        .from('bookings')
        .update({ status: 'cancelled' })
        .in('id', ids)
        .select('id, status, booking_ref');
      if (cancelErr) return errorResponse(cancelErr.message, 500);

      return jsonResponse({ success: true, cancelled: data || [] });
    }

    return errorResponse('Not found', 404);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
