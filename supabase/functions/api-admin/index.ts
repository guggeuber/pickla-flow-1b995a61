import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient } from '../_shared/auth.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DateTime } from 'https://esm.sh/luxon@3.5.0';

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

type SoldAs = 'activity_ticket' | 'day_pass' | 'included_only';

function productKeyForActivityTicket(sessionType: string) {
  if (sessionType === 'group_training') return 'group_training';
  return 'open_play_slot';
}

function normalizeActivitySessionPayload(body: Record<string, any>) {
  const next = { ...body };
  const soldAs = String(next.sold_as || next.access_policy?.sold_as || '') as SoldAs | '';
  const sessionType = String(next.session_type || 'open_play');
  delete next.sold_as;
  delete next.included_in_day_pass;
  delete next.included_in_unlimited;

  if (soldAs) {
    if (!['activity_ticket', 'day_pass', 'included_only'].includes(soldAs)) {
      throw new Error('Invalid sold_as');
    }
    next.product_key = soldAs === 'day_pass'
      ? 'day_access'
      : soldAs === 'included_only'
      ? null
      : productKeyForActivityTicket(sessionType);

    const policy = next.access_policy && typeof next.access_policy === 'object' ? next.access_policy : {};
    next.access_policy = {
      ...policy,
      allows_day_access: soldAs === 'day_pass' ? true : Boolean(policy.allows_day_access),
      includes_day_access: soldAs === 'day_pass',
      sold_as: soldAs,
    };
  }

  const publishStatus = String(next.publish_status || 'published');
  const isPublished = publishStatus === 'published' && next.is_active !== false;
  const productKey = next.product_key || null;
  const price = Number(next.price_sek || 0);
  const capacity = next.capacity == null || next.capacity === '' ? null : Number(next.capacity);

  if (productKey && !['open_play_slot', 'group_training', 'day_access', 'event_fee'].includes(String(productKey))) {
    throw new Error(`Unknown product_key for schedule session: ${productKey}`);
  }
  if (isPublished && productKey !== null && capacity !== null && capacity <= 0) {
    throw new Error('Published paid sessions need capacity');
  }
  if (isPublished && productKey !== null && capacity === null) {
    throw new Error('Published paid sessions need capacity');
  }
  if (isPublished && productKey !== null && productKey !== 'day_access' && price <= 0) {
    throw new Error('Published activity tickets need price');
  }
  if (productKey === 'day_access' && ['open_play', 'club_night', 'pickla_open'].includes(sessionType) && soldAs !== 'day_pass') {
    throw new Error('Open Play schedule sessions must be sold as activity_ticket, not day_access');
  }

  return next;
}

function stockholmBlockRange(date: string, startTime: string, endTime: string) {
  const cleanDate = String(date || '').slice(0, 10);
  const cleanStart = String(startTime || '').slice(0, 5);
  const cleanEnd = String(endTime || '').slice(0, 5);
  if (!cleanDate || !cleanStart || !cleanEnd) throw new Error('Missing date/time');
  const startsAt = DateTime.fromISO(`${cleanDate}T${cleanStart}:00`, { zone: 'Europe/Stockholm' });
  const endsAt = DateTime.fromISO(`${cleanDate}T${cleanEnd}:00`, { zone: 'Europe/Stockholm' });
  if (!startsAt.isValid || !endsAt.isValid || endsAt <= startsAt) throw new Error('Invalid date/time');
  return {
    starts_at: startsAt.toUTC().toISO(),
    ends_at: endsAt.toUTC().toISO(),
  };
}

function stockholmDayRangeUtc(date: string) {
  const day = DateTime.fromISO(String(date || '').slice(0, 10), { zone: 'Europe/Stockholm' });
  if (!day.isValid) throw new Error('Invalid date');
  return {
    start: day.startOf('day').toUTC().toISO(),
    end: day.plus({ days: 1 }).startOf('day').toUTC().toISO(),
  };
}

function stockholmToday() {
  return DateTime.now().setZone('Europe/Stockholm').toISODate()!;
}

function stockholmTimeFromIso(value: string | null | undefined) {
  if (!value) return null;
  const date = DateTime.fromISO(value, { zone: 'utc' }).setZone('Europe/Stockholm');
  return date.isValid ? date.toFormat('HH:mm') : null;
}

function cleanTime(value: unknown) {
  return value ? String(value).slice(0, 5) : '';
}

function normalizeDateForResponse(value: unknown) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match?.[1]) return match[1];
  const parsed = DateTime.fromISO(raw, { zone: 'utc' });
  return parsed.isValid ? parsed.setZone('Europe/Stockholm').toISODate() : null;
}

function uniqueStrings(values: unknown[]) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function eventDisplayTitle(event: Record<string, any>) {
  return event.display_name || event.name || event.title || 'Event';
}

function createBlockRef() {
  const now = DateTime.now().setZone('Europe/Stockholm');
  const suffix = crypto.randomUUID().split('-')[0].toUpperCase();
  return `BLK-${now.toFormat('yyyy')}-${suffix}`;
}

function cleanBlockMetadata(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function operationRangeFromBody(body: Record<string, any>) {
  if (body.starts_at && body.ends_at) {
    const startsAt = DateTime.fromISO(String(body.starts_at));
    const endsAt = DateTime.fromISO(String(body.ends_at));
    if (!startsAt.isValid || !endsAt.isValid || endsAt <= startsAt) throw new Error('Invalid date/time');
    return {
      starts_at: startsAt.toUTC().toISO(),
      ends_at: endsAt.toUTC().toISO(),
    };
  }

  return stockholmBlockRange(body.date, body.start_time, body.end_time);
}

function normalizeOverrideType(value: unknown) {
  const overrideType = String(value || 'other');
  if (!['closed', 'maintenance', 'private_event', 'staffing', 'other'].includes(overrideType)) {
    throw new Error('Invalid override_type');
  }
  return overrideType;
}

function blockReasonForOverride(overrideType: string) {
  if (overrideType === 'maintenance') return 'maintenance';
  if (overrideType === 'private_event') return 'private';
  if (overrideType === 'staffing' || overrideType === 'closed') return 'internal';
  return 'manual';
}

function localDatesBetween(startsAtIso: string, endsAtIso: string) {
  const start = DateTime.fromISO(startsAtIso, { zone: 'utc' }).setZone('Europe/Stockholm').startOf('day');
  const end = DateTime.fromISO(endsAtIso, { zone: 'utc' }).setZone('Europe/Stockholm').startOf('day');
  if (!start.isValid || !end.isValid || end < start) return [];

  const dates: string[] = [];
  let cursor = start;
  while (cursor <= end && dates.length < 45) {
    dates.push(cursor.toISODate()!);
    cursor = cursor.plus({ days: 1 });
  }
  return dates;
}

function resourceForBlockRow(block: any) {
  const resource = block.event_resource_catalog;
  return Array.isArray(resource) ? resource[0] : resource;
}

function activityOverrideKey(activitySessionId: string, sessionDate: string) {
  return `${activitySessionId}:${sessionDate}`;
}

async function activityRegistrationCounts(admin: any, activitySessionIds: string[], startDate: string, endDate: string) {
  const cleanIds = [...new Set(activitySessionIds.filter(Boolean))];
  const counts = new Map<string, number>();
  if (!cleanIds.length || !startDate || !endDate) return counts;

  const { data, error } = await admin
    .from('session_registrations')
    .select('activity_session_id, session_date, status')
    .in('activity_session_id', cleanIds)
    .gte('session_date', startDate)
    .lte('session_date', endDate);
  if (error) throw new Error(error.message);

  for (const row of data || []) {
    if (row.status === 'cancelled') continue;
    const key = activityOverrideKey(row.activity_session_id, row.session_date);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

async function activityOverrideMap(admin: any, venueId: string, activitySessionIds: string[], startDate: string, endDate: string) {
  const cleanIds = [...new Set(activitySessionIds.filter(Boolean))];
  const overrides = new Map<string, any>();
  if (!cleanIds.length || !startDate || !endDate) return overrides;

  const { data, error } = await admin
    .from('activity_session_overrides')
    .select('id, activity_session_id, session_date, status, reason, venue_operation_override_id')
    .eq('venue_id', venueId)
    .in('activity_session_id', cleanIds)
    .gte('session_date', startDate)
    .lte('session_date', endDate);
  if (error) throw new Error(error.message);

  for (const row of data || []) {
    overrides.set(activityOverrideKey(row.activity_session_id, row.session_date), row);
  }
  return overrides;
}

async function activeBookableCourtResources(admin: any, venueId: string) {
  const { data, error } = await admin
    .from('event_resource_catalog')
    .select('id, venue_court_id')
    .eq('venue_id', venueId)
    .eq('resource_type', 'court')
    .eq('is_active', true)
    .eq('is_bookable', true)
    .not('venue_court_id', 'is', null)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);

  const seenCourtIds = new Set<string>();
  return (data || []).filter((row: any) => {
    const courtId = String(row.venue_court_id || '');
    if (!courtId || seenCourtIds.has(courtId)) return false;
    seenCourtIds.add(courtId);
    return true;
  });
}

async function resourceIdsForCourtIds(admin: any, venueId: string, courtIds: string[]) {
  if (courtIds.length === 0) return [];

  const { data: courts, error: courtsError } = await admin
    .from('venue_courts')
    .select('id, name, court_number, sport_type')
    .eq('venue_id', venueId)
    .in('id', courtIds);
  if (courtsError) throw new Error(courtsError.message);
  if ((courts || []).length !== courtIds.length) throw new Error('One or more courts do not belong to this venue');

  const { data: existingCatalog, error: catalogError } = await admin
    .from('event_resource_catalog')
    .select('id, venue_court_id')
    .eq('venue_id', venueId)
    .eq('resource_type', 'court')
    .in('venue_court_id', courtIds);
  if (catalogError) throw new Error(catalogError.message);

  const existingByCourt = new Map((existingCatalog || []).map((row: any) => [row.venue_court_id, row.id]));
  const missingCourts = (courts || []).filter((court: any) => !existingByCourt.has(court.id));
  if (missingCourts.length) {
    const { data: inserted, error: insertError } = await admin
      .from('event_resource_catalog')
      .insert(missingCourts.map((court: any) => ({
        venue_id: venueId,
        resource_type: 'court',
        name: court.name,
        description: court.sport_type || null,
        venue_court_id: court.id,
        unit: 'event',
        is_bookable: true,
        is_active: true,
        sort_order: court.court_number || 100,
      })))
      .select('id, venue_court_id');
    if (insertError) throw new Error(insertError.message);
    for (const row of inserted || []) existingByCourt.set(row.venue_court_id, row.id);
  }

  return courtIds.map((courtId: string) => existingByCourt.get(courtId)).filter(Boolean);
}

async function analyzeOperationImpact(
  admin: any,
  venueId: string,
  startsAt: string,
  endsAt: string,
  affectsEntireVenue: boolean,
  courtIds: string[],
  overrideId?: string | null,
) {
  let bookingsQuery = admin
    .from('bookings')
    .select('id, booking_ref, start_time, end_time, status, venue_court_id, venue_courts(id, name)', { count: 'exact' })
    .eq('venue_id', venueId)
    .neq('status', 'cancelled')
    .lt('start_time', endsAt)
    .gt('end_time', startsAt)
    .order('start_time', { ascending: true })
    .limit(8);
  if (!affectsEntireVenue && courtIds.length) bookingsQuery = bookingsQuery.in('venue_court_id', courtIds);
  const { data: bookings, count: bookingCount, error: bookingsError } = await bookingsQuery;
  if (bookingsError) throw new Error(bookingsError.message);

  const dates = localDatesBetween(startsAt, endsAt);
  const startMs = DateTime.fromISO(startsAt, { zone: 'utc' }).toMillis();
  const endMs = DateTime.fromISO(endsAt, { zone: 'utc' }).toMillis();
  const { data: sessions, error: sessionsError } = await admin
    .from('activity_sessions')
    .select('id, name, session_type, session_date, recurrence_days, start_time, end_time, court_ids, is_active, publish_status')
    .eq('venue_id', venueId)
    .eq('is_active', true)
    .limit(500);
  if (sessionsError) throw new Error(sessionsError.message);

  const courtSet = new Set(courtIds);
  const activitySamples: any[] = [];
  let activityCount = 0;
  for (const session of sessions || []) {
    const sessionCourtIds = Array.isArray(session.court_ids) ? session.court_ids.map((id: unknown) => String(id)) : [];
    if (!affectsEntireVenue && sessionCourtIds.length && !sessionCourtIds.some((id: string) => courtSet.has(id))) {
      continue;
    }

    for (const date of dates) {
      const isConcrete = session.session_date === date;
      const isRecurring = !session.session_date && Array.isArray(session.recurrence_days)
        && session.recurrence_days.includes(DateTime.fromISO(date, { zone: 'Europe/Stockholm' }).weekday % 7);
      if (!isConcrete && !isRecurring) continue;

      const occurrenceStart = DateTime.fromISO(`${date}T${String(session.start_time).slice(0, 5)}:00`, { zone: 'Europe/Stockholm' }).toUTC();
      const occurrenceEnd = DateTime.fromISO(`${date}T${String(session.end_time).slice(0, 5)}:00`, { zone: 'Europe/Stockholm' }).toUTC();
      if (!occurrenceStart.isValid || !occurrenceEnd.isValid) continue;
      if (occurrenceStart.toMillis() < endMs && occurrenceEnd.toMillis() > startMs) {
        activityCount += 1;
        if (activitySamples.length < 8) {
          activitySamples.push({
            id: session.id,
            activity_session_id: session.id,
            name: session.name,
            session_type: session.session_type,
            session_date: date,
            start_time: String(session.start_time).slice(0, 5),
            end_time: String(session.end_time).slice(0, 5),
          });
        }
      }
    }
  }

  const sampleSessionIds = activitySamples.map((sample) => sample.activity_session_id);
  const startDate = dates[0] || '';
  const endDate = dates[dates.length - 1] || '';
  const [registrationCounts, overrides] = await Promise.all([
    activityRegistrationCounts(admin, sampleSessionIds, startDate, endDate),
    activityOverrideMap(admin, venueId, sampleSessionIds, startDate, endDate),
  ]);
  for (const sample of activitySamples) {
    const key = activityOverrideKey(sample.activity_session_id, sample.session_date);
    const override = overrides.get(key);
    sample.registrations_count = registrationCounts.get(key) || 0;
    sample.override_status = override?.status || null;
    sample.activity_session_override_id = override?.id || null;
  }

  const resourceIds = !affectsEntireVenue && courtIds.length
    ? await resourceIdsForCourtIds(admin, venueId, courtIds)
    : [];
  let blocksQuery = admin
    .from('event_resource_blocks')
    .select('id, title, reason, status, starts_at, ends_at, metadata, resource_catalog_id, event_resource_catalog(id, name, venue_court_id)', { count: 'exact' })
    .eq('venue_id', venueId)
    .in('status', ['hold', 'confirmed'])
    .lt('starts_at', endsAt)
    .gt('ends_at', startsAt)
    .order('starts_at', { ascending: true })
    .limit(100);
  if (!affectsEntireVenue && resourceIds.length) blocksQuery = blocksQuery.or(`resource_catalog_id.is.null,resource_catalog_id.in.(${resourceIds.join(',')})`);
  const { data: blockRows, error: blocksError } = await blocksQuery;
  if (blocksError) throw new Error(blocksError.message);

  const filteredBlocks = (blockRows || []).filter((block: any) => {
    const metadata = cleanBlockMetadata(block.metadata);
    if (overrideId && metadata.venue_operation_override_id === overrideId) return false;
    if (affectsEntireVenue) return true;
    const resource = resourceForBlockRow(block);
    return !resource || courtSet.has(resource.venue_court_id);
  });

  return {
    bookings: {
      count: bookingCount ?? (bookings || []).length,
      samples: bookings || [],
    },
    activities: {
      count: activityCount,
      samples: activitySamples,
      limited: dates.length >= 45,
    },
    blocks: {
      count: filteredBlocks.length,
      samples: filteredBlocks.slice(0, 8),
    },
  };
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
    const canResolveVenueFromBody = ['venue-operation-impact', 'venue-operation-overrides', 'activity-session-overrides'].includes(path)
      && ['POST', 'PATCH'].includes(req.method);
    if (!venueId && !canResolveVenueFromBody) return errorResponse('No venue found', 400);

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

    // ── ADMIN OS ATTENTION SIGNALS ──
    if (req.method === 'GET' && path === 'attention') {
      const scopedVenueId = venueId!;
      const today = stockholmToday();
      const tomorrow = DateTime.fromISO(today, { zone: 'Europe/Stockholm' }).plus({ days: 1 }).toISODate()!;
      const todayRange = stockholmDayRangeUtc(today);
      const tomorrowRange = stockholmDayRangeUtc(tomorrow);
      const cutoff = DateTime.now().minus({ hours: 24 }).toUTC().toISO();
      const items: any[] = [];

      const { data: leads, error: leadsError } = await admin
        .from('event_leads')
        .select('id, company_name, contact_name, status, created_at, event_id')
        .eq('venue_id', scopedVenueId)
        .lt('created_at', cutoff)
        .not('status', 'in', '("won","lost","booking_confirmed")')
        .order('created_at', { ascending: true })
        .limit(50);
      if (leadsError) return errorResponse(leadsError.message);

      const leadIds = (leads || []).map((lead: any) => lead.id);
      const respondedLeadIds = new Set<string>();
      if (leadIds.length) {
        const { data: activities, error: activitiesError } = await admin
          .from('event_lead_activities')
          .select('event_lead_id, activity_type')
          .in('event_lead_id', leadIds);
        if (activitiesError) return errorResponse(activitiesError.message);
        const outboundResponseTypes = new Set(['offer_sent', 'booking_confirmation', 'booking_confirmed', 'deposit_link_sent']);
        for (const activity of activities || []) {
          if (outboundResponseTypes.has(activity.activity_type)) respondedLeadIds.add(activity.event_lead_id);
        }
      }

      for (const lead of leads || []) {
        if (respondedLeadIds.has(lead.id)) continue;
        const created = DateTime.fromISO(lead.created_at, { zone: 'utc' }).setZone('Europe/Stockholm');
        items.push({
          id: `lead-${lead.id}`,
          kind: 'lead',
          tone: 'warn',
          title: lead.company_name || lead.contact_name || 'Event lead',
          meta: `Inget svar till kund registrerat sedan ${created.isValid ? created.toFormat('d MMM HH:mm') : 'skapande'}`,
          moduleTarget: 'eventLeads',
          href: null,
        });
      }

      const { data: overrides, error: overridesError } = await admin
        .from('venue_operation_overrides')
        .select('id, title, override_type, starts_at, ends_at, affects_entire_venue, status')
        .eq('venue_id', scopedVenueId)
        .eq('status', 'active')
        .lt('starts_at', tomorrowRange.end)
        .gt('ends_at', todayRange.start)
        .order('starts_at', { ascending: true })
        .limit(50);
      if (overridesError) return errorResponse(overridesError.message);

      for (const override of overrides || []) {
        const starts = DateTime.fromISO(override.starts_at, { zone: 'utc' }).setZone('Europe/Stockholm');
        const ends = DateTime.fromISO(override.ends_at, { zone: 'utc' }).setZone('Europe/Stockholm');
        const day = starts.toISODate() === today ? 'idag' : starts.toISODate() === tomorrow ? 'imorgon' : starts.toFormat('d MMM');
        items.push({
          id: `drift-${override.id}`,
          kind: 'drift',
          tone: 'warn',
          title: override.title || 'Driftavvikelse',
          meta: `${day} ${starts.toFormat('HH:mm')}–${ends.toFormat('HH:mm')}${override.affects_entire_venue ? ' · hela venue' : ''}`,
          moduleTarget: 'operations',
          href: null,
        });
      }

      const { data: events, error: eventsError } = await admin
        .from('events')
        .select('id, name, display_name, start_date, start_time, planning_status, resources, staffing')
        .eq('venue_id', scopedVenueId)
        .not('planning_status', 'in', '("done","cancelled")')
        .order('start_date', { ascending: true, nullsFirst: false })
        .limit(80);
      if (eventsError) return errorResponse(eventsError.message);

      const eventIds = (events || []).map((event: any) => event.id);
      const courtCounts = new Map<string, number>();
      if (eventIds.length) {
        const { data: courts, error: courtsError } = await admin
          .from('event_courts')
          .select('event_id, venue_court_id')
          .in('event_id', eventIds);
        if (courtsError) return errorResponse(courtsError.message);
        for (const court of courts || []) {
          courtCounts.set(court.event_id, (courtCounts.get(court.event_id) || 0) + 1);
        }
      }

      for (const event of events || []) {
        const issues: string[] = [];
        const resourceCount = Array.isArray(event.resources) ? event.resources.length : 0;
        if (resourceCount === 0 && (courtCounts.get(event.id) || 0) === 0) issues.push('resurser');
        if (!String(event.staffing || '').trim()) issues.push('personal');
        if (!['booked', 'ready', 'published'].includes(String(event.planning_status || ''))) issues.push('bekräftelse');
        if (!issues.length) continue;
        const date = event.start_date ? String(event.start_date).slice(0, 10) : 'Datum saknas';
        const time = cleanTime(event.start_time);
        items.push({
          id: `event-${event.id}`,
          kind: 'event',
          tone: 'info',
          title: eventDisplayTitle(event),
          meta: `${date}${time ? ` ${time}` : ''} · Saknar ${issues.join(', ')}`,
          moduleTarget: 'events',
          href: null,
        });
      }

      const { data: blocks, error: blocksError } = await admin
        .from('event_resource_blocks')
        .select('id, title, reason, status, starts_at, ends_at, resource_catalog_id, event_resource_catalog(id, name, venue_court_id)')
        .eq('venue_id', scopedVenueId)
        .in('status', ['hold', 'confirmed'])
        .lt('starts_at', todayRange.end)
        .gt('ends_at', todayRange.start)
        .order('starts_at', { ascending: true })
        .limit(50);
      if (blocksError) return errorResponse(blocksError.message);

      for (const block of blocks || []) {
        const starts = stockholmTimeFromIso(block.starts_at) || '--:--';
        const ends = stockholmTimeFromIso(block.ends_at) || '--:--';
        const resource = resourceForBlockRow(block);
        items.push({
          id: `block-${block.id}`,
          kind: 'block',
          tone: 'warn',
          title: block.title || resource?.name || 'Resursblockering',
          meta: `${starts}–${ends} · ${block.status}`,
          moduleTarget: 'resourceBlocks',
          href: null,
        });
      }

      return jsonResponse(items, 200, 5);
    }

    // ── PICKLA AGENT INBOX ──
    if (req.method === 'GET' && path === 'agent-inbox') {
      const scopedVenueId = venueId!;
      const { data: recommendations, error: recommendationsError } = await admin
        .from('event_lead_activities')
        .select('id, event_lead_id, title, body, metadata, created_at')
        .eq('venue_id', scopedVenueId)
        .eq('activity_type', 'agent_recommendation')
        .order('created_at', { ascending: false })
        .limit(100);
      if (recommendationsError) return errorResponse(recommendationsError.message);

      const latestByLead = new Map<string, any>();
      for (const recommendation of recommendations || []) {
        if (!latestByLead.has(recommendation.event_lead_id)) {
          latestByLead.set(recommendation.event_lead_id, recommendation);
        }
      }

      const leadIds = Array.from(latestByLead.keys());
      if (!leadIds.length) return jsonResponse([], 200, 5);

      const [{ data: leads, error: leadsError }, { data: decisions, error: decisionsError }] = await Promise.all([
        admin
          .from('event_leads')
          .select('id, event_id, company_name, contact_name, status, preferred_date')
          .eq('venue_id', scopedVenueId)
          .in('id', leadIds),
        admin
          .from('event_lead_activities')
          .select('id, event_lead_id, activity_type, created_at')
          .eq('venue_id', scopedVenueId)
          .in('event_lead_id', leadIds)
          .in('activity_type', ['agent_recommendation_approved', 'agent_recommendation_rejected'])
          .order('created_at', { ascending: false }),
      ]);
      if (leadsError) return errorResponse(leadsError.message);
      if (decisionsError) return errorResponse(decisionsError.message);

      const leadById = new Map((leads || []).map((lead: any) => [lead.id, lead]));
      const latestDecisionByLead = new Map<string, any>();
      for (const decision of decisions || []) {
        if (!latestDecisionByLead.has(decision.event_lead_id)) latestDecisionByLead.set(decision.event_lead_id, decision);
      }

      const eventIds = uniqueStrings((leads || []).map((lead: any) => lead.event_id).filter(Boolean));
      const eventById = new Map<string, any>();
      if (eventIds.length) {
        const { data: events, error: eventsError } = await admin
          .from('events')
          .select('id, start_date, start_time, end_time')
          .in('id', eventIds);
        if (eventsError) return errorResponse(eventsError.message);
        for (const event of events || []) eventById.set(event.id, event);
      }

      const rows: any[] = [];
      for (const recommendation of latestByLead.values()) {
        const decision = latestDecisionByLead.get(recommendation.event_lead_id);
        if (decision && new Date(decision.created_at).getTime() > new Date(recommendation.created_at).getTime()) continue;
        const lead = leadById.get(recommendation.event_lead_id);
        if (!lead || ['won', 'lost', 'booking_confirmed'].includes(String(lead.status))) continue;
        const event = lead.event_id ? eventById.get(lead.event_id) : null;
        const metadata = cleanBlockMetadata(recommendation.metadata) as any;
        rows.push({
          id: recommendation.id,
          activity_id: recommendation.id,
          lead_id: lead.id,
          lead_name: lead.company_name || lead.contact_name || 'Event lead',
          event_date: normalizeDateForResponse(event?.start_date || metadata.recommended_schedule?.event_date || lead.preferred_date),
          event_time: cleanTime(event?.start_time || metadata.recommended_schedule?.start_time),
          summary: String(metadata.summary || recommendation.body || 'Agent recommendation'),
          risk: String(metadata.risk || 'low'),
          capacity_ok: metadata.capacity_ok !== false,
          next_action: String(metadata.next_action || 'review'),
          affected_registrations: Number(metadata.affected_registrations || 0),
          created_at: recommendation.created_at,
          moduleTarget: 'eventLeads',
        });
      }

      rows.sort((a, b) => {
        const riskOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
        return (riskOrder[a.risk] ?? 3) - (riskOrder[b.risk] ?? 3)
          || new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });

      return jsonResponse(rows.slice(0, 12), 200, 5);
    }

    // ── ADMIN OS TODAY TIMELINE ──
    if (req.method === 'GET' && path === 'todays-plan') {
      const scopedVenueId = venueId!;
      const date = url.searchParams.get('date') || stockholmToday();
      const day = DateTime.fromISO(date, { zone: 'Europe/Stockholm' });
      if (!day.isValid) return errorResponse('Invalid date', 400);
      const range = stockholmDayRangeUtc(date);
      const weekday = day.weekday % 7;
      const items: any[] = [];

      const { data: sessions, error: sessionsError } = await admin
        .from('activity_sessions')
        .select('id, name, session_type, session_date, recurrence_days, start_time, end_time, is_active, publish_status')
        .eq('venue_id', scopedVenueId)
        .eq('is_active', true)
        .order('start_time', { ascending: true })
        .limit(500);
      if (sessionsError) return errorResponse(sessionsError.message);

      for (const session of sessions || []) {
        const isConcrete = session.session_date === date;
        const isRecurring = !session.session_date && Array.isArray(session.recurrence_days) && session.recurrence_days.includes(weekday);
        if (!isConcrete && !isRecurring) continue;
        const time = cleanTime(session.start_time);
        items.push({
          id: `activity-${session.id}-${date}`,
          time: time || '--:--',
          title: session.name || 'Aktivitet',
          kind: 'aktivitet',
          tone: 'lime',
          href: null,
          moduleTarget: 'schedule',
        });
      }

      const { data: dayEvents, error: dayEventsError } = await admin
        .from('events')
        .select('id, name, display_name, start_date, start_time, end_time, planning_status')
        .eq('venue_id', scopedVenueId)
        .eq('start_date', date)
        .neq('planning_status', 'cancelled')
        .order('start_time', { ascending: true });
      if (dayEventsError) return errorResponse(dayEventsError.message);

      for (const event of dayEvents || []) {
        const time = cleanTime(event.start_time);
        items.push({
          id: `event-${event.id}`,
          time: time || '--:--',
          title: eventDisplayTitle(event),
          kind: 'event',
          tone: 'magenta',
          href: null,
          moduleTarget: 'events',
        });
      }

      const { data: blocks, error: blocksError } = await admin
        .from('event_resource_blocks')
        .select('id, title, reason, status, starts_at, ends_at, resource_catalog_id, event_resource_catalog(id, name, venue_court_id)')
        .eq('venue_id', scopedVenueId)
        .in('status', ['hold', 'confirmed'])
        .lt('starts_at', range.end)
        .gt('ends_at', range.start)
        .order('starts_at', { ascending: true })
        .limit(200);
      if (blocksError) return errorResponse(blocksError.message);

      for (const block of blocks || []) {
        const resource = resourceForBlockRow(block);
        items.push({
          id: `block-${block.id}`,
          time: stockholmTimeFromIso(block.starts_at) || '--:--',
          title: block.title || resource?.name || 'Resursblockering',
          kind: 'block',
          tone: block.reason === 'event' ? 'magenta' : 'sun',
          href: null,
          moduleTarget: 'resourceBlocks',
        });
      }

      const { data: overrides, error: overridesError } = await admin
        .from('venue_operation_overrides')
        .select('id, title, override_type, starts_at, ends_at, affects_entire_venue, status')
        .eq('venue_id', scopedVenueId)
        .eq('status', 'active')
        .lt('starts_at', range.end)
        .gt('ends_at', range.start)
        .order('starts_at', { ascending: true })
        .limit(100);
      if (overridesError) return errorResponse(overridesError.message);

      for (const override of overrides || []) {
        items.push({
          id: `drift-${override.id}`,
          time: stockholmTimeFromIso(override.starts_at) || '--:--',
          title: override.title || 'Driftavvikelse',
          kind: 'drift',
          tone: 'danger',
          href: null,
          moduleTarget: 'operations',
        });
      }

      items.sort((a, b) => {
        const at = /^\d{2}:\d{2}$/.test(a.time) ? a.time : '99:99';
        const bt = /^\d{2}:\d{2}$/.test(b.time) ? b.time : '99:99';
        return at.localeCompare(bt) || String(a.title || '').localeCompare(String(b.title || ''));
      });

      return jsonResponse(items, 200, 5);
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

    // ── VENUE OPERATION OVERRIDES ──
    if (req.method === 'GET' && path === 'venue-operation-overrides') {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      let query = admin
        .from('venue_operation_overrides')
        .select('*')
        .eq('venue_id', venueId)
        .order('starts_at', { ascending: true });
      if (from) query = query.gte('ends_at', from);
      if (to) query = query.lte('starts_at', to);

      const { data, error: e } = await query;
      if (e) return errorResponse(e.message);
      return jsonResponse(data || [], 200, 10);
    }

    if (req.method === 'POST' && path === 'venue-operation-impact') {
      const body = await req.json();
      const requestedVenueId = url.searchParams.get('venueId') || body.venueId || adminVenueId;
      if (!requestedVenueId) return errorResponse('No venue found', 400);
      const affectsEntireVenue = body.affects_entire_venue !== false;
      const courtIds = Array.isArray(body.venue_court_ids)
        ? Array.from(new Set(body.venue_court_ids.map((id: unknown) => String(id)).filter(Boolean)))
        : [];
      if (!affectsEntireVenue && courtIds.length === 0) return errorResponse('Select at least one court or affect the entire venue', 400);

      let range;
      try {
        range = operationRangeFromBody(body);
        if (!affectsEntireVenue) await resourceIdsForCourtIds(admin, requestedVenueId, courtIds);
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : 'Invalid operation override', 400);
      }

      const impact = await analyzeOperationImpact(
        admin,
        requestedVenueId,
        range.starts_at!,
        range.ends_at!,
        affectsEntireVenue,
        courtIds,
        body.overrideId ? String(body.overrideId) : null,
      );
      return jsonResponse(impact);
    }

    if (req.method === 'POST' && path === 'venue-operation-overrides') {
      const body = await req.json();
      const requestedVenueId = url.searchParams.get('venueId') || body.venueId || adminVenueId;
      if (!requestedVenueId) return errorResponse('No venue found', 400);
      const title = String(body.title || '').trim().slice(0, 180);
      const reason = String(body.reason || '').trim().slice(0, 1000);
      const affectsEntireVenue = body.affects_entire_venue !== false;
      const courtIds = Array.isArray(body.venue_court_ids)
        ? Array.from(new Set(body.venue_court_ids.map((id: unknown) => String(id)).filter(Boolean)))
        : [];
      const metadata = cleanBlockMetadata(body.metadata);
      if (!title) return errorResponse('Missing title', 400);
      if (!affectsEntireVenue && courtIds.length === 0) return errorResponse('Select at least one court or affect the entire venue', 400);

      let range;
      let overrideType;
      let resourceIds: string[] = [];
      let resolvedCourtIds = courtIds;
      try {
        range = operationRangeFromBody(body);
        overrideType = normalizeOverrideType(body.override_type);
        if (affectsEntireVenue) {
          const courtResources = await activeBookableCourtResources(admin, requestedVenueId);
          resourceIds = courtResources.map((row: any) => String(row.id)).filter(Boolean);
          resolvedCourtIds = courtResources.map((row: any) => String(row.venue_court_id)).filter(Boolean);
          if (resourceIds.length === 0) return errorResponse('No active bookable court resources found for venue', 400);
        } else {
          resourceIds = await resourceIdsForCourtIds(admin, requestedVenueId, courtIds);
        }
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : 'Invalid operation override', 400);
      }

      const impact = await analyzeOperationImpact(admin, requestedVenueId, range.starts_at!, range.ends_at!, affectsEntireVenue, resolvedCourtIds);
      const { data: override, error: overrideError } = await admin
        .from('venue_operation_overrides')
        .insert({
          venue_id: requestedVenueId,
          title,
          reason: reason || null,
          override_type: overrideType,
          starts_at: range.starts_at,
          ends_at: range.ends_at,
          affects_entire_venue: affectsEntireVenue,
          status: 'active',
          created_by: userId,
          metadata: {
            ...metadata,
            venue_court_ids: resolvedCourtIds,
            resource_catalog_ids: resourceIds,
            impact_snapshot: {
              bookings_count: impact.bookings.count,
              activities_count: impact.activities.count,
              blocks_count: impact.blocks.count,
            },
          },
        })
        .select()
        .single();
      if (overrideError) return errorResponse(overrideError.message);

      const blockMetadata = {
        scope: 'courts',
        affects_entire_venue: affectsEntireVenue,
        venue_operation_override_id: override.id,
        override_type: overrideType,
        venue_court_ids: resolvedCourtIds,
        resource_catalog_ids: resourceIds,
        note: reason,
      };
      const blockRows = resourceIds.map((resourceId: string) => ({
        venue_id: requestedVenueId,
        resource_catalog_id: resourceId,
        title,
        reason: blockReasonForOverride(overrideType),
        status: 'confirmed',
        starts_at: range.starts_at,
        ends_at: range.ends_at,
        blocks_public_booking: true,
        created_by: userId,
        metadata: blockMetadata,
      }));

      const { data: blocks, error: blocksError } = await admin
        .from('event_resource_blocks')
        .insert(blockRows)
        .select('*, event_resource_catalog(id, name, resource_type, venue_court_id)');
      if (blocksError) {
        await admin.from('venue_operation_overrides').update({ status: 'cancelled' }).eq('id', override.id).eq('venue_id', requestedVenueId);
        return errorResponse(blocksError.message);
      }

      return jsonResponse({ override, blocks: blocks || [], impact }, 201);
    }

    if (req.method === 'PATCH' && path === 'venue-operation-overrides') {
      const body = await req.json();
      const requestedVenueId = url.searchParams.get('venueId') || body.venueId || adminVenueId;
      if (!requestedVenueId) return errorResponse('No venue found', 400);
      const overrideId = String(body.overrideId || body.id || '');
      if (!overrideId) return errorResponse('Missing overrideId', 400);

      const { data: override, error: overrideFetchError } = await admin
        .from('venue_operation_overrides')
        .select('id, status')
        .eq('id', overrideId)
        .eq('venue_id', requestedVenueId)
        .maybeSingle();
      if (overrideFetchError) return errorResponse(overrideFetchError.message);
      if (!override) return errorResponse('Override not found', 404);

      const { data, error: e } = await admin
        .from('venue_operation_overrides')
        .update({ status: 'cancelled' })
        .eq('id', overrideId)
        .eq('venue_id', requestedVenueId)
        .select()
        .single();
      if (e) return errorResponse(e.message);

      const { data: blocks, error: blocksError } = await admin
        .from('event_resource_blocks')
        .update({ status: 'cancelled', blocks_public_booking: false })
        .eq('venue_id', requestedVenueId)
        .contains('metadata', { venue_operation_override_id: overrideId })
        .select('id, status, blocks_public_booking');
      if (blocksError) return errorResponse(blocksError.message);

      return jsonResponse({ override: data, blocks: blocks || [] });
    }

    if (req.method === 'POST' && path === 'activity-session-overrides') {
      const body = await req.json();
      const requestedVenueId = url.searchParams.get('venueId') || body.venueId || adminVenueId;
      if (!requestedVenueId) return errorResponse('No venue found', 400);

      const activitySessionId = String(body.activity_session_id || body.activitySessionId || '').trim();
      const sessionDate = String(body.session_date || body.sessionDate || '').slice(0, 10);
      const status = String(body.status || '').trim();
      const reason = String(body.reason || '').trim().slice(0, 1000);
      const venueOperationOverrideId = body.venue_operation_override_id || body.venueOperationOverrideId || null;
      const metadata = cleanBlockMetadata(body.metadata);

      if (!activitySessionId) return errorResponse('Missing activity_session_id', 400);
      if (!sessionDate) return errorResponse('Missing session_date', 400);
      if (!['active', 'hidden', 'cancelled'].includes(status)) return errorResponse('Invalid status', 400);

      const { data: session, error: sessionError } = await admin
        .from('activity_sessions')
        .select('id, venue_id')
        .eq('id', activitySessionId)
        .eq('venue_id', requestedVenueId)
        .maybeSingle();
      if (sessionError) return errorResponse(sessionError.message);
      if (!session) return errorResponse('Activity session not found for venue', 404);

      const counts = await activityRegistrationCounts(admin, [activitySessionId], sessionDate, sessionDate);
      const registrationsCount = counts.get(activityOverrideKey(activitySessionId, sessionDate)) || 0;
      if (registrationsCount > 0 && body.confirm !== true) {
        return jsonResponse({
          requires_confirmation: true,
          registrations_count: registrationsCount,
          message: 'Activity occurrence has registrations. Confirm before changing visibility.',
        }, 409);
      }

      const { data, error: upsertError } = await admin
        .from('activity_session_overrides')
        .upsert({
          venue_id: requestedVenueId,
          activity_session_id: activitySessionId,
          session_date: sessionDate,
          status,
          reason: reason || null,
          venue_operation_override_id: venueOperationOverrideId || null,
          metadata: {
            ...metadata,
            registrations_count_at_change: registrationsCount,
          },
        }, { onConflict: 'venue_id,activity_session_id,session_date' })
        .select()
        .single();
      if (upsertError) return errorResponse(upsertError.message);

      return jsonResponse({ override: data, registrations_count: registrationsCount });
    }

    // ── EVENT RESOURCE BLOCKS ──
    if (req.method === 'GET' && path === 'resource-blocks') {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      let query = admin
        .from('event_resource_blocks')
        .select('*, event_resource_catalog(id, name, resource_type, venue_court_id)')
        .eq('venue_id', venueId)
        .order('starts_at', { ascending: true });
      if (from) query = query.gte('ends_at', from);
      if (to) query = query.lte('starts_at', to);

      const { data, error: e } = await query;
      if (e) return errorResponse(e.message);
      return jsonResponse(data || [], 200, 10);
    }

    if (req.method === 'POST' && path === 'resource-blocks') {
      const body = await req.json();
      const title = String(body.title || '').trim().slice(0, 180);
      const reason = String(body.reason || 'manual');
      const status = String(body.status || 'hold');
      const scope = String(body.scope || 'courts');
      const courtIds = Array.isArray(body.venue_court_ids)
        ? body.venue_court_ids.map((id: unknown) => String(id)).filter(Boolean)
        : [];
      const explicitResourceIds = Array.isArray(body.resource_catalog_ids)
        ? body.resource_catalog_ids.map((id: unknown) => String(id)).filter(Boolean)
        : [];
      const groupId = String(body.group_id || body.metadata?.group_id || crypto.randomUUID());
      const blockRef = String(body.block_ref || body.metadata?.block_ref || createBlockRef());
      const note = String(body.note || body.metadata?.note || '').trim().slice(0, 1000);

      if (!title) return errorResponse('Missing title');
      if (!['manual', 'event', 'maintenance', 'private', 'internal'].includes(reason)) return errorResponse('Invalid reason', 400);
      if (!['hold', 'confirmed', 'released', 'cancelled'].includes(status)) return errorResponse('Invalid status', 400);

      let range;
      try {
        range = stockholmBlockRange(body.date, body.start_time, body.end_time);
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : 'Invalid date/time', 400);
      }

      let resourceIds = [...explicitResourceIds];
      if (courtIds.length) {
        const { data: courts, error: courtsError } = await admin
          .from('venue_courts')
          .select('id, name, court_number, sport_type')
          .eq('venue_id', venueId)
          .in('id', courtIds);
        if (courtsError) return errorResponse(courtsError.message);
        if ((courts || []).length !== courtIds.length) return errorResponse('One or more courts do not belong to this venue', 400);

        const { data: existingCatalog, error: catalogError } = await admin
          .from('event_resource_catalog')
          .select('id, venue_court_id')
          .eq('venue_id', venueId)
          .eq('resource_type', 'court')
          .in('venue_court_id', courtIds);
        if (catalogError) return errorResponse(catalogError.message);

        const existingByCourt = new Map((existingCatalog || []).map((row: any) => [row.venue_court_id, row.id]));
        const missingCourts = (courts || []).filter((court: any) => !existingByCourt.has(court.id));
        if (missingCourts.length) {
          const { data: inserted, error: insertError } = await admin
            .from('event_resource_catalog')
            .insert(missingCourts.map((court: any) => ({
              venue_id: venueId,
              resource_type: 'court',
              name: court.name,
              description: court.sport_type || null,
              venue_court_id: court.id,
              unit: 'event',
              is_bookable: true,
              is_active: true,
              sort_order: court.court_number || 100,
            })))
            .select('id, venue_court_id');
          if (insertError) return errorResponse(insertError.message);
          for (const row of inserted || []) existingByCourt.set(row.venue_court_id, row.id);
        }

        resourceIds = [...resourceIds, ...courtIds.map((courtId: string) => existingByCourt.get(courtId)).filter(Boolean)];
      }

      if (scope !== 'venue' && resourceIds.length === 0) {
        return errorResponse('Select at least one resource or use venue scope', 400);
      }

      if (resourceIds.length) {
        const { data: validResources, error: validError } = await admin
          .from('event_resource_catalog')
          .select('id')
          .eq('venue_id', venueId)
          .in('id', resourceIds);
        if (validError) return errorResponse(validError.message);
        const validIds = new Set((validResources || []).map((row: any) => row.id));
        resourceIds = Array.from(new Set(resourceIds.filter((id: string) => validIds.has(id))));
      }

      const rows = scope === 'venue'
        ? [{
          venue_id: venueId,
          resource_catalog_id: null,
          title,
          reason,
          status,
          starts_at: range.starts_at,
          ends_at: range.ends_at,
          blocks_public_booking: body.blocks_public_booking !== false,
          created_by: userId,
          metadata: { scope: 'venue', group_id: groupId, block_ref: blockRef, note },
        }]
        : resourceIds.map((resourceId: string) => ({
          venue_id: venueId,
          resource_catalog_id: resourceId,
          title,
          reason,
          status,
          starts_at: range.starts_at,
          ends_at: range.ends_at,
          blocks_public_booking: body.blocks_public_booking !== false,
          created_by: userId,
          metadata: { group_id: groupId, block_ref: blockRef, note },
        }));

      const { data, error: e } = await admin
        .from('event_resource_blocks')
        .insert(rows)
        .select('*, event_resource_catalog(id, name, resource_type, venue_court_id)');
      if (e) return errorResponse(e.message);
      return jsonResponse(data || [], 201);
    }

    if (req.method === 'PATCH' && path === 'resource-blocks') {
      const body = await req.json();
      const blockId = body.blockId || body.id;
      const blockIds = Array.isArray(body.blockIds)
        ? body.blockIds.map((id: unknown) => String(id)).filter(Boolean)
        : blockId ? [String(blockId)] : [];
      if (blockIds.length === 0) return errorResponse('Missing blockId');
      const updates: any = {};
      if (body.title !== undefined) updates.title = String(body.title || '').trim().slice(0, 180);
      if (body.reason !== undefined) {
        const reason = String(body.reason);
        if (!['manual', 'event', 'maintenance', 'private', 'internal'].includes(reason)) return errorResponse('Invalid reason', 400);
        updates.reason = reason;
      }
      if (body.status !== undefined) {
        const status = String(body.status);
        if (!['hold', 'confirmed', 'released', 'cancelled'].includes(status)) return errorResponse('Invalid status', 400);
        updates.status = status;
      }
      if (body.blocks_public_booking !== undefined) updates.blocks_public_booking = Boolean(body.blocks_public_booking);
      if (body.date || body.start_time || body.end_time) {
        let range;
        try {
          range = stockholmBlockRange(body.date, body.start_time, body.end_time);
        } catch (err) {
          return errorResponse(err instanceof Error ? err.message : 'Invalid date/time', 400);
        }
        updates.starts_at = range.starts_at;
        updates.ends_at = range.ends_at;
      }
      if (body.note !== undefined || body.metadata !== undefined) {
        const { data: currentRows, error: currentError } = await admin
          .from('event_resource_blocks')
          .select('id, metadata')
          .eq('venue_id', venueId)
          .in('id', blockIds);
        if (currentError) return errorResponse(currentError.message);
        const note = body.note !== undefined ? String(body.note || '').trim().slice(0, 1000) : undefined;
        const metadataPatch = cleanBlockMetadata(body.metadata);

        for (const row of currentRows || []) {
          const nextMetadata = {
            ...cleanBlockMetadata((row as any).metadata),
            ...metadataPatch,
            ...(note !== undefined ? { note } : {}),
          };
          const { error: metaError } = await admin
            .from('event_resource_blocks')
            .update({ ...updates, metadata: nextMetadata })
            .eq('id', (row as any).id)
            .eq('venue_id', venueId);
          if (metaError) return errorResponse(metaError.message);
        }

        const { data, error: selectError } = await admin
          .from('event_resource_blocks')
          .select('*, event_resource_catalog(id, name, resource_type, venue_court_id)')
          .eq('venue_id', venueId)
          .in('id', blockIds);
        if (selectError) return errorResponse(selectError.message);
        return jsonResponse(data || []);
      }

      const { data, error: e } = await admin
        .from('event_resource_blocks')
        .update(updates)
        .eq('venue_id', venueId)
        .in('id', blockIds)
        .select('*, event_resource_catalog(id, name, resource_type, venue_court_id)');
      if (e) return errorResponse(e.message);
      return jsonResponse(data);
    }

    if (req.method === 'DELETE' && path === 'resource-blocks') {
      const blockId = url.searchParams.get('blockId');
      const blockIdsParam = url.searchParams.get('blockIds');
      const blockIds = blockIdsParam
        ? blockIdsParam.split(',').map((id) => id.trim()).filter(Boolean)
        : blockId ? [blockId] : [];
      if (blockIds.length === 0) return errorResponse('Missing blockId');
      const { data, error: e } = await admin
        .from('event_resource_blocks')
        .update({ status: 'released', blocks_public_booking: false })
        .eq('venue_id', venueId)
        .in('id', blockIds)
        .select('id, status, blocks_public_booking')
      ;
      if (e) return errorResponse(e.message);
      return jsonResponse(data);
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
      const normalized = normalizeActivitySessionPayload(body);
      const recurrenceDays = Array.isArray(body.recurrence_days) ? body.recurrence_days : null;
      const { data, error: e } = await admin.from('activity_sessions').insert({
        venue_id: venueId,
        series_id: normalized.series_id || null,
        product_key: normalized.product_key || null,
        name: normalized.name,
        session_type: normalized.session_type || 'open_play',
        sport_type: normalized.sport_type || 'pickleball',
        recurrence_days: recurrenceDays,
        session_date: normalized.session_date || null,
        start_time: normalized.start_time,
        end_time: normalized.end_time,
        price_sek: normalized.price_sek ?? 0,
        capacity: normalized.capacity ?? null,
        court_ids: Array.isArray(normalized.court_ids) ? normalized.court_ids : [],
        access_policy: normalized.access_policy || {},
        is_active: normalized.is_active ?? true,
        publish_status: normalized.publish_status || 'published',
        sort_order: normalized.sort_order ?? 0,
        metadata: normalized.metadata || {},
      }).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 201);
    }

    if (req.method === 'PATCH' && path === 'activity-sessions') {
      const { sessionId, ...updates } = await req.json();
      if (!sessionId) return errorResponse('Missing sessionId');
      const normalized = normalizeActivitySessionPayload(updates);
      const { data, error: e } = await admin.from('activity_sessions')
        .update(normalized).eq('id', sessionId).eq('venue_id', venueId).select().single();
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
