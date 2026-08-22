import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import { requireVenueRole } from '../_shared/authorization.ts';
import { resolveCustomerIdForUser } from '../_shared/customers.ts';
import { DateTime } from 'https://esm.sh/luxon@3.5.0';

type ServiceClient = ReturnType<typeof getServiceClient>;
type CourseSeriesRow = {
  id: string;
  venue_id: string;
  format_id?: string | null;
  access_product_id?: string | null;
  sport_type?: string | null;
  status: string;
  start_date: string;
  registration_opens_at?: string | null;
  registration_closes_at?: string | null;
  capacity?: number | null;
  start_time?: string | null;
  end_time?: string | null;
  court_ids?: string[] | null;
  image_urls?: string[] | null;
  [key: string]: unknown;
};

type CourseScheduleInput = {
  venueId: string;
  startDate: string;
  endDate: string;
  recurrenceDays: number[];
  startTime: string;
  endTime: string;
  totalSessions: number;
  courtIds: string[];
};

type CourseResourcePreviewRow = {
  occurrence_index: number;
  occurrence_date: string;
  proposed_starts_at: string;
  proposed_ends_at: string;
  court_id: string;
  court_name: string;
  is_available: boolean;
  conflicts: Array<{
    source_type: string;
    source_id: string;
    title: string;
    starts_at: string;
    ends_at: string;
  }>;
};

type SeriesStaffGrantParticipant = {
  kind: 'customer' | 'dependent';
  id: string;
  name: string;
  detail: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AGE_GROUPS = new Set(['adult', 'youth', 'all_ages']);
const LEVELS = new Set(['intro', 'beginner', 'intermediate', 'advanced']);
const PRESENTATION_TYPES = new Set(['course', 'social_event', 'clinic', 'tournament']);

async function optionalUserId(req: Request) {
  if (!req.headers.get('Authorization')) return null;
  const result = await getAuthenticatedClient(req);
  return result.error ? null : result.userId;
}

async function venue(admin: ServiceClient, input: { id?: string | null; slug?: string | null }) {
  let query = admin.from('venues').select('id, organization_id, name, slug, commerce_enabled');
  query = input.id ? query.eq('id', input.id) : query.eq('slug', input.slug || '');
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.organization_id) throw new Error('Venue not found');
  return data;
}

async function courseSeries(admin: ServiceClient, seriesId: string) {
  if (!UUID.test(seriesId)) throw new Error('Invalid Course Series');
  const { data, error } = await admin.from('activity_series')
    .select('id, venue_id, format_id, name, description, image_urls, series_type, sport_type, status, product_key, access_product_id, start_date, end_date, total_sessions, registration_opens_at, registration_closes_at, capacity, recurrence_days, start_time, end_time, court_ids, metadata, created_at, updated_at')
    .eq('id', seriesId)
    .eq('series_type', 'course')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Course not found');
  return data;
}

async function managedSellableSeries(admin: ServiceClient, seriesId: string) {
  if (!UUID.test(seriesId)) throw new Error('Invalid Series');
  const { data, error } = await admin.from('activity_series')
    .select('id, venue_id, format_id, access_product_id, status')
    .eq('id', seriesId)
    .not('format_id', 'is', null)
    .not('access_product_id', 'is', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Series not found');
  return data;
}

async function seriesCapacity(admin: ServiceClient, series: CourseSeriesRow) {
  const { data, error } = await admin.rpc('capacity_fill', {
    p_venue_id: series.venue_id,
    p_scope_type: 'activity_series',
    p_scope_id: series.id,
    p_session_date: series.start_date,
  });
  if (error) throw new Error(error.message);
  const fill = Array.isArray(data) ? data[0] : data;
  return {
    capacity: Number(fill?.capacity ?? series.capacity ?? 0),
    committed_count: Number(fill?.committed_count || 0),
    active_holds_count: Number(fill?.active_holds_count || 0),
    available_count: Number(fill?.available_count || 0),
  };
}

function registrationState(series: CourseSeriesRow, now = DateTime.now().toUTC()) {
  const opens = series.registration_opens_at ? DateTime.fromISO(series.registration_opens_at, { zone: 'utc' }) : null;
  const closes = series.registration_closes_at ? DateTime.fromISO(series.registration_closes_at, { zone: 'utc' }) : null;
  if (series.status !== 'active') return 'closed';
  if (opens?.isValid && now < opens) return 'upcoming';
  if (closes?.isValid && now >= closes) return 'closed';
  return 'open';
}

function customerName(customer: Record<string, unknown> | null | undefined) {
  if (!customer) return 'Kund';
  const displayName = cleanText(customer.display_name, 160);
  const fullName = [cleanText(customer.first_name, 80), cleanText(customer.last_name, 80)].filter(Boolean).join(' ');
  return displayName || fullName || cleanText(customer.primary_email, 160) || 'Kund';
}

async function listSeriesStaffGrants(admin: ServiceClient, venueId: string) {
  const { data: commitments, error } = await admin.from('series_commitments')
    .select('id, activity_series_id, participant_customer_id, dependent_participant_id, status, activated_at, cancelled_at, metadata')
    .eq('venue_id', venueId)
    .eq('commitment_type', 'participant')
    .eq('metadata->>funding_source', 'series_staff_grant')
    .order('activated_at', { ascending: false });
  if (error) throw new Error(error.message);
  if (!commitments?.length) return [];

  const customerIds = [...new Set(commitments.map((row) => row.participant_customer_id).filter(Boolean))];
  const dependentIds = [...new Set(commitments.map((row) => row.dependent_participant_id).filter(Boolean))];
  const [{ data: customers, error: customerError }, { data: dependents, error: dependentError }] = await Promise.all([
    customerIds.length
      ? admin.from('customers').select('id, display_name, first_name, last_name, primary_email').in('id', customerIds)
      : Promise.resolve({ data: [], error: null }),
    dependentIds.length
      ? admin.from('dependent_participants').select('id, first_name, birth_year, guardian_customer_id').in('id', dependentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (customerError || dependentError) throw new Error(customerError?.message || dependentError?.message || 'Series grants unavailable');

  const guardianIds = [...new Set((dependents || []).map((row) => row.guardian_customer_id).filter(Boolean))];
  const { data: guardians, error: guardianError } = guardianIds.length
    ? await admin.from('customers').select('id, display_name, first_name, last_name, primary_email').in('id', guardianIds)
    : { data: [], error: null };
  if (guardianError) throw new Error(guardianError.message);

  const customerById = new Map((customers || []).map((row) => [row.id, row]));
  const dependentById = new Map((dependents || []).map((row) => [row.id, row]));
  const guardianById = new Map((guardians || []).map((row) => [row.id, row]));

  return commitments.map((commitment) => {
    const dependent = commitment.dependent_participant_id ? dependentById.get(commitment.dependent_participant_id) : null;
    const participant: SeriesStaffGrantParticipant = dependent
      ? {
        kind: 'dependent',
        id: dependent.id,
        name: dependent.first_name,
        detail: `Vårdnadshavare: ${customerName(guardianById.get(dependent.guardian_customer_id))}`,
      }
      : {
        kind: 'customer',
        id: commitment.participant_customer_id,
        name: customerName(customerById.get(commitment.participant_customer_id)),
        detail: customerById.get(commitment.participant_customer_id)?.primary_email || null,
      };
    return {
      id: commitment.id,
      activity_series_id: commitment.activity_series_id,
      status: commitment.status,
      activated_at: commitment.activated_at,
      cancelled_at: commitment.cancelled_at,
      participant,
      provenance_label: 'Friplats · Pickla',
      grant_reason: cleanText(commitment.metadata?.grant_reason, 500) || null,
    };
  });
}

async function findSeriesGrantParticipants(admin: ServiceClient, organizationId: string, search: string) {
  const [{ data: customers, error: customerError }, { data: dependents, error: dependentError }] = await Promise.all([
    admin.from('customers')
      .select('id, display_name, first_name, last_name, primary_email')
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .is('merged_into_id', null)
      .order('updated_at', { ascending: false })
      .limit(500),
    admin.from('dependent_participants')
      .select('id, first_name, birth_year, guardian_customer_id')
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(500),
  ]);
  if (customerError || dependentError) throw new Error(customerError?.message || dependentError?.message || 'Participants unavailable');

  const customerById = new Map((customers || []).map((row) => [row.id, row]));
  const needle = search.trim().toLocaleLowerCase('sv');
  const adults = (customers || []).map((customer) => ({
    kind: 'customer' as const,
    id: customer.id,
    name: customerName(customer),
    detail: customer.primary_email || null,
  }));
  const subordinate = (dependents || []).map((dependent) => ({
    kind: 'dependent' as const,
    id: dependent.id,
    name: dependent.first_name,
    detail: [
      dependent.birth_year ? `Född ${dependent.birth_year}` : null,
      `Vårdnadshavare: ${customerName(customerById.get(dependent.guardian_customer_id))}`,
    ].filter(Boolean).join(' · '),
  }));
  return [...adults, ...subordinate]
    .filter((participant) => `${participant.name} ${participant.detail || ''}`.toLocaleLowerCase('sv').includes(needle))
    .slice(0, 12);
}

async function projectCourse(admin: ServiceClient, series: CourseSeriesRow, userId?: string | null) {
  const [formatResult, productResult, venueResult, sessionsResult, capacity] = await Promise.all([
    series.format_id
      ? admin.from('activity_formats').select('id, name, description, full_description, image_urls, age_group, level, requires_instructor, presentation_type').eq('id', series.format_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    series.access_product_id
      ? admin.from('access_products').select('id, product_key, name, description, base_price_sek, vat_rate, status, product_kind').eq('id', series.access_product_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin.from('venues').select('id, name, slug').eq('id', series.venue_id).maybeSingle(),
    admin.from('activity_sessions')
      .select('id, series_id, session_date, start_time, end_time, court_ids, capacity, requires_staffing, is_active, publish_status, series_occurrence_index')
      .eq('series_id', series.id)
      .order('series_occurrence_index'),
    seriesCapacity(admin, series),
  ]);
  if (formatResult.error || productResult.error || venueResult.error || sessionsResult.error) {
    throw new Error(formatResult.error?.message || productResult.error?.message || venueResult.error?.message || sessionsResult.error?.message || 'Course projection unavailable');
  }
  let commitment = null;
  if (userId) {
    const customerId = await resolveCustomerIdForUser(admin, userId);
    if (customerId) {
      const { data, error } = await admin.from('series_commitments')
        .select('id, participant_customer_id, dependent_participant_id, payer_customer_id, status, activated_at')
        .eq('activity_series_id', series.id)
        .eq('status', 'active')
        .or(`participant_customer_id.eq.${customerId},payer_customer_id.eq.${customerId}`)
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      commitment = data || null;
    }
  }
  const seriesImages = Array.isArray(series.image_urls) ? series.image_urls.filter(Boolean) : [];
  const formatImages = Array.isArray(formatResult.data?.image_urls) ? formatResult.data.image_urls.filter(Boolean) : [];
  return {
    ...series,
    format: formatResult.data || null,
    image_urls: (seriesImages.length ? seriesImages : formatImages).slice(0, 3),
    product: productResult.data || null,
    venue: venueResult.data || null,
    sessions: sessionsResult.data || [],
    capacity,
    registration_state: registrationState(series),
    customer_has_commitment: Boolean(commitment),
    commitment,
  };
}

async function listMyCourses(admin: ServiceClient, userId: string) {
  const customerId = await resolveCustomerIdForUser(admin, userId);
  if (!customerId) return [];
  const { data: dependentRows, error: dependentError } = await admin.from('dependent_participants')
    .select('id, first_name, birth_year')
    .eq('guardian_customer_id', customerId)
    .eq('status', 'active');
  if (dependentError) throw new Error(dependentError.message);
  const dependentIds = (dependentRows || []).map((row) => row.id);
  const filters = [`participant_customer_id.eq.${customerId}`, `payer_customer_id.eq.${customerId}`];
  if (dependentIds.length) filters.push(`dependent_participant_id.in.(${dependentIds.join(',')})`);
  const { data: commitments, error } = await admin.from('series_commitments')
    .select('id, activity_series_id, participant_customer_id, dependent_participant_id, payer_customer_id, status, activated_at, metadata')
    .eq('commitment_type', 'participant')
    .in('status', ['active', 'completed'])
    .or(filters.join(','))
    .order('activated_at', { ascending: false });
  if (error) throw new Error(error.message);
  if (!commitments?.length) return [];
  const seriesIds = [...new Set(commitments.map((row) => row.activity_series_id))];
  const [{ data: seriesRows, error: seriesError }, { data: sessionRows, error: sessionError }] = await Promise.all([
    admin.from('activity_series').select('id, venue_id, format_id, name, start_date, end_date, total_sessions, status').in('id', seriesIds),
    admin.from('activity_sessions')
      .select('id, series_id, session_date, start_time, end_time, is_active, series_occurrence_index')
      .in('series_id', seriesIds)
      .eq('is_active', true)
      .order('session_date'),
  ]);
  if (seriesError || sessionError) throw new Error(seriesError?.message || sessionError?.message || 'Course projection unavailable');
  const formatIds = [...new Set((seriesRows || []).map((row) => row.format_id).filter(Boolean))];
  const { data: formatRows, error: formatError } = formatIds.length
    ? await admin.from('activity_formats').select('id, presentation_type').in('id', formatIds)
    : { data: [], error: null };
  if (formatError) throw new Error(formatError.message);
  const presentationByFormat = new Map((formatRows || []).map((format) => [format.id, format.presentation_type || 'course']));
  const dependentById = new Map((dependentRows || []).map((row) => [row.id, row]));
  const now = DateTime.now().setZone('Europe/Stockholm');
  return commitments.map((commitment) => {
    const series = (seriesRows || []).find((row) => row.id === commitment.activity_series_id);
    const sessions = (sessionRows || []).filter((row) => row.series_id === commitment.activity_series_id);
    const next = sessions.find((session) => {
      const ends = DateTime.fromISO(`${session.session_date}T${String(session.end_time).slice(0, 8)}`, { zone: 'Europe/Stockholm' });
      return ends.isValid && ends > now;
    }) || null;
    const completed = sessions.filter((session) => {
      const ends = DateTime.fromISO(`${session.session_date}T${String(session.end_time).slice(0, 8)}`, { zone: 'Europe/Stockholm' });
      return ends.isValid && ends <= now;
    }).length;
    return {
      commitment,
      series: series ? { ...series, presentation_type: presentationByFormat.get(series.format_id) || 'course' } : series,
      participant: commitment.dependent_participant_id
        ? { kind: 'dependent', ...(dependentById.get(commitment.dependent_participant_id) || {}) }
        : { kind: 'customer' },
      next_session: next,
      completed_sessions: completed,
      total_sessions: sessions.length,
      access: commitment.metadata?.funding_source === 'series_staff_grant'
        ? { label: 'Friplats', detail: 'Ingår · Pickla' }
        : null,
    };
  });
}

function cleanText(value: unknown, max = 240) {
  return String(value || '').trim().slice(0, max);
}

function cleanImageUrls(value: unknown, ownerPath: string) {
  if (!Array.isArray(value)) return [];
  const marker = `/storage/v1/object/public/event-logos/${ownerPath}/`;
  return [...new Set(value.map((url) => String(url || '').trim()).filter((url) => {
    if (!url.startsWith('https://') || !url.includes(marker)) return false;
    return /^[1-3]\.(png|jpe?g|webp)$/i.test(url.split(marker)[1]?.split('?')[0] || '');
  }))].slice(0, 3);
}

function courseProductKey() {
  return `course_${crypto.randomUUID().replaceAll('-', '')}`;
}

function courseScheduleInput(body: Record<string, unknown>): CourseScheduleInput | null {
  const venueId = String(body.venue_id || body.venueId || '');
  const startDate = String(body.start_date || '');
  const endDate = String(body.end_date || '');
  const startTime = String(body.start_time || '').slice(0, 8);
  const endTime = String(body.end_time || '').slice(0, 8);
  const totalSessions = Math.floor(Number(body.total_sessions || 0));
  const recurrenceDays = Array.isArray(body.recurrence_days)
    ? [...new Set(body.recurrence_days.map(Number).filter((day: number) => Number.isInteger(day) && day >= 0 && day <= 6))]
    : [];
  const courtIds = Array.isArray(body.court_ids)
    ? [...new Set(body.court_ids.map(String).filter((id: string) => UUID.test(id)))]
    : [];
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const timePattern = /^\d{2}:\d{2}(?::\d{2})?$/;
  if (
    !UUID.test(venueId) || !datePattern.test(startDate) || !datePattern.test(endDate) || startDate > endDate ||
    !timePattern.test(startTime) || !timePattern.test(endTime) || startTime === endTime ||
    totalSessions <= 0 || !recurrenceDays.length || !courtIds.length
  ) return null;
  return { venueId, startDate, endDate, recurrenceDays, startTime, endTime, totalSessions, courtIds };
}

async function previewCourseResourceSchedule(
  admin: ServiceClient,
  schedule: CourseScheduleInput,
  excludeSeriesId: string | null = null,
  excludeSessionId: string | null = null,
) {
  const { data, error } = await admin.rpc('preview_course_resource_schedule', {
    p_venue_id: schedule.venueId,
    p_start_date: schedule.startDate,
    p_end_date: schedule.endDate,
    p_recurrence_days: schedule.recurrenceDays,
    p_start_time: schedule.startTime,
    p_end_time: schedule.endTime,
    p_total_sessions: schedule.totalSessions,
    p_court_ids: schedule.courtIds,
    p_exclude_series_id: excludeSeriesId,
    p_exclude_session_id: excludeSessionId,
  });
  if (error) throw new Error(error.message);
  const rows = (data || []) as CourseResourcePreviewRow[];
  const occurrenceCount = new Set(rows.map((row) => Number(row.occurrence_index))).size;
  const selectedCourtCount = new Set(rows.map((row) => row.court_id)).size;
  if (occurrenceCount !== schedule.totalSessions) throw new Error('Course schedule does not produce the requested occurrences');
  if (selectedCourtCount !== schedule.courtIds.length) throw new Error('Course resources are unavailable');
  return {
    rows,
    has_conflicts: rows.some((row) => !row.is_available),
    occurrence_count: occurrenceCount,
  };
}

function courseConflictResponse(preview: Awaited<ReturnType<typeof previewCourseResourceSchedule>>) {
  return jsonResponse({
    error: 'Course resource conflict',
    code: 'course_resource_conflict',
    preview,
  }, 409, 0);
}

const coursesHandler = async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const url = new URL(req.url);
  const path = url.pathname.split('/').pop() || '';
  const admin = getServiceClient();
  try {
    if (req.method === 'GET' && path === 'detail') {
      const userId = await optionalUserId(req);
      const series = await courseSeries(admin, String(url.searchParams.get('seriesId') || ''));
      const projected = await projectCourse(admin, series, userId);
      if (projected.status !== 'active') return errorResponse('Course not found', 404);
      return jsonResponse(projected, 200, 5);
    }

    if (req.method === 'GET' && path === 'home') {
      const userId = await optionalUserId(req);
      const venueRow = await venue(admin, {
        id: url.searchParams.get('venueId'),
        slug: url.searchParams.get('v') || url.searchParams.get('slug'),
      });
      if (userId) {
        const mine = await listMyCourses(admin, userId);
        const active = mine.find((item) => item.series?.venue_id === venueRow.id && item.commitment?.status === 'active' && item.next_session);
        if (active) return jsonResponse({ mode: 'next', item: active }, 200, 0);
      }
      const now = DateTime.now().toUTC().toISO();
      const { data, error } = await admin.from('activity_series')
        .select('id, venue_id, format_id, name, description, image_urls, series_type, sport_type, status, product_key, access_product_id, start_date, end_date, total_sessions, registration_opens_at, registration_closes_at, capacity, recurrence_days, start_time, end_time, court_ids, metadata, created_at, updated_at')
        .eq('venue_id', venueRow.id)
        .eq('series_type', 'course')
        .eq('status', 'active')
        .lte('registration_opens_at', now)
        .gt('registration_closes_at', now)
        .order('registration_closes_at')
        .limit(4);
      if (error) throw new Error(error.message);
      for (const series of data || []) {
        const projected = await projectCourse(admin, series, userId);
        if (projected.capacity.available_count > 0) return jsonResponse({ mode: 'registration', item: projected }, 200, 5);
      }
      return jsonResponse({ mode: 'none', item: null }, 200, 5);
    }

    if (req.method === 'GET' && path === 'catalog') {
      const userId = await optionalUserId(req);
      const venueRow = await venue(admin, { id: url.searchParams.get('venueId'), slug: url.searchParams.get('v') || url.searchParams.get('slug') });
      const today = DateTime.now().setZone('Europe/Stockholm').toISODate();
      const { data, error } = await admin.from('activity_series')
        .select('id, venue_id, format_id, name, description, image_urls, series_type, sport_type, status, product_key, access_product_id, start_date, end_date, total_sessions, registration_opens_at, registration_closes_at, capacity, recurrence_days, start_time, end_time, court_ids, metadata, created_at, updated_at, activity_formats!inner(presentation_type)')
        .eq('venue_id', venueRow.id).eq('series_type', 'course').eq('activity_formats.presentation_type', 'course').eq('status', 'active').gte('end_date', today).order('start_date').limit(24);
      if (error) throw new Error(error.message);
      const items = [];
      for (const series of data || []) {
        const projected = await projectCourse(admin, series, userId);
        if (projected.format?.presentation_type === 'course') items.push(projected);
      }
      return jsonResponse({ items }, 200, userId ? 0 : 5);
    }

    const auth = await getAuthenticatedClient(req);
    if (auth.error || !auth.userId) return errorResponse('Unauthorized', 401);

    if (req.method === 'GET' && path === 'my') {
      return jsonResponse({ items: await listMyCourses(admin, auth.userId) }, 200, 5);
    }

    if (req.method === 'GET' && path === 'grant-participants') {
      const venueId = String(url.searchParams.get('venueId') || '');
      const search = cleanText(url.searchParams.get('search'), 120);
      await requireVenueRole(admin, auth.userId, venueId, ['venue_admin']);
      const venueRow = await venue(admin, { id: venueId });
      if (search.length < 2) return jsonResponse({ items: [] }, 200, 0);
      return jsonResponse({
        items: await findSeriesGrantParticipants(admin, venueRow.organization_id, search),
      }, 200, 0);
    }

    if (req.method === 'POST' && path === 'staff-grant') {
      const body = await req.json();
      const venueId = String(body.venue_id || body.venueId || '');
      const seriesId = String(body.series_id || '');
      const participantKind = String(body.participant_kind || '');
      const participantId = String(body.participant_id || '');
      const grantReason = cleanText(body.reason, 500);
      const requestId = cleanText(body.request_id, 200);
      if (!UUID.test(venueId) || !UUID.test(seriesId) || !UUID.test(participantId)
        || !['customer', 'dependent'].includes(participantKind) || !grantReason || !requestId) {
        return errorResponse('Series, participant, reason and request id are required', 400);
      }
      await requireVenueRole(admin, auth.userId, venueId, ['venue_admin']);
      // Grant authority follows managed sellable-Series ownership, never the
      // customer presentation type or the historical Course projection label.
      const series = await managedSellableSeries(admin, seriesId);
      if (series.venue_id !== venueId) return errorResponse('Series not found', 404);
      const { data, error } = await admin.rpc('grant_series_staff_place', {
        p_venue_id: venueId,
        p_activity_series_id: seriesId,
        p_actor_user_id: auth.userId,
        p_participant_customer_id: participantKind === 'customer' ? participantId : null,
        p_dependent_participant_id: participantKind === 'dependent' ? participantId : null,
        p_reason: grantReason,
        p_request_id: requestId,
      });
      if (error) throw new Error(error.message);
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.ok) {
        const message = result?.reason === 'capacity_full'
          ? 'Serien är full'
          : 'Deltagaren har redan en aktiv plats';
        return jsonResponse({ error: message, code: result?.reason || 'series_staff_grant_rejected' }, 409, 0);
      }
      const grants = await listSeriesStaffGrants(admin, venueId);
      return jsonResponse({
        ...result,
        grant: grants.find((grant) => grant.id === result.commitment_id) || null,
      }, result.reason === 'granted' ? 201 : 200, 0);
    }

    if (req.method === 'POST' && path === 'staff-grant-cancel') {
      const body = await req.json();
      const venueId = String(body.venue_id || body.venueId || '');
      const commitmentId = String(body.commitment_id || '');
      const cancellationReason = cleanText(body.reason, 500);
      const requestId = cleanText(body.request_id, 200);
      if (!UUID.test(venueId) || !UUID.test(commitmentId) || !cancellationReason || !requestId) {
        return errorResponse('Commitment, reason and request id are required', 400);
      }
      await requireVenueRole(admin, auth.userId, venueId, ['venue_admin']);
      const { data, error } = await admin.rpc('cancel_series_staff_place', {
        p_venue_id: venueId,
        p_commitment_id: commitmentId,
        p_actor_user_id: auth.userId,
        p_reason: cancellationReason,
        p_request_id: requestId,
      });
      if (error) throw new Error(error.message);
      const result = Array.isArray(data) ? data[0] : data;
      return jsonResponse(result, 200, 0);
    }

    if (req.method === 'GET' && path === 'admin') {
      const venueId = String(url.searchParams.get('venueId') || '');
      await requireVenueRole(admin, auth.userId, venueId, ['venue_admin']);
      const venueRow = await venue(admin, { id: venueId });
      const [{ data: formats, error: formatError }, { data: seriesRows, error: seriesError }, { data: courts, error: courtsError }] = await Promise.all([
        admin.from('activity_formats').select('*').eq('organization_id', venueRow.organization_id).eq('is_active', true).order('name'),
        admin.from('activity_series')
          .select('id, venue_id, format_id, name, description, image_urls, series_type, sport_type, status, product_key, access_product_id, start_date, end_date, total_sessions, registration_opens_at, registration_closes_at, capacity, recurrence_days, start_time, end_time, court_ids, metadata, created_at, updated_at')
          .eq('venue_id', venueId).eq('series_type', 'course').order('start_date', { ascending: false }),
        admin.from('venue_courts').select('id, name, court_number, sport_type').eq('venue_id', venueId).eq('is_available', true).order('court_number'),
      ]);
      if (formatError || seriesError || courtsError) throw new Error(formatError?.message || seriesError?.message || courtsError?.message || 'Course admin unavailable');
      const grants = await listSeriesStaffGrants(admin, venueId);
      const projected = [];
      for (const series of seriesRows || []) {
        projected.push({
          ...await projectCourse(admin, series, null),
          staff_grants: grants.filter((grant) => grant.activity_series_id === series.id && grant.status === 'active'),
        });
      }
      return jsonResponse({ formats: formats || [], series: projected, courts: courts || [] }, 200, 5);
    }

    if (req.method === 'POST' && path === 'format') {
      const body = await req.json();
      const venueId = String(body.venue_id || body.venueId || '');
      await requireVenueRole(admin, auth.userId, venueId, ['venue_admin']);
      const venueRow = await venue(admin, { id: venueId });
      const ageGroup = cleanText(body.age_group, 24);
      const level = cleanText(body.level, 24);
      const presentationType = cleanText(body.presentation_type || 'course', 32);
      if (!AGE_GROUPS.has(ageGroup) || !LEVELS.has(level) || !PRESENTATION_TYPES.has(presentationType)) return errorResponse('Invalid Format taxonomy', 400);
      const { data, error } = await admin.from('activity_formats').insert({
        organization_id: venueRow.organization_id,
        name: cleanText(body.name, 120),
        description: cleanText(body.description, 1000) || null,
        full_description: cleanText(body.full_description, 20000) || null,
        image_urls: [],
        age_group: ageGroup,
        level,
        requires_instructor: body.requires_instructor === true,
        presentation_type: presentationType,
      }).select('*').single();
      if (error) throw new Error(error.message);
      return jsonResponse(data, 201, 0);
    }

    if (req.method === 'PATCH' && path === 'format') {
      const body = await req.json();
      const venueId = String(body.venue_id || body.venueId || '');
      const formatId = String(body.format_id || '');
      await requireVenueRole(admin, auth.userId, venueId, ['venue_admin']);
      const venueRow = await venue(admin, { id: venueId });
      const ageGroup = cleanText(body.age_group, 24);
      const level = cleanText(body.level, 24);
      const presentationType = cleanText(body.presentation_type || 'course', 32);
      const name = cleanText(body.name, 120);
      if (!UUID.test(formatId) || !name || !AGE_GROUPS.has(ageGroup) || !LEVELS.has(level) || !PRESENTATION_TYPES.has(presentationType)) {
        return errorResponse('Invalid Format', 400);
      }
      const { data, error } = await admin.from('activity_formats').update({
        name,
        description: cleanText(body.description, 1000) || null,
        full_description: cleanText(body.full_description, 20000) || null,
        ...(body.image_urls === undefined ? {} : { image_urls: cleanImageUrls(body.image_urls, `activity-formats/${formatId}`) }),
        age_group: ageGroup,
        level,
        requires_instructor: body.requires_instructor === true,
        presentation_type: presentationType,
      }).eq('id', formatId).eq('organization_id', venueRow.organization_id).eq('is_active', true).select('*').maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return errorResponse('Course Format not found', 404);
      return jsonResponse(data, 200, 0);
    }

    if (req.method === 'POST' && path === 'series-preview') {
      const body = await req.json();
      const schedule = courseScheduleInput(body);
      if (!schedule) return errorResponse('Course schedule and resources are required', 400);
      await requireVenueRole(admin, auth.userId, schedule.venueId, ['venue_admin']);
      await venue(admin, { id: schedule.venueId });
      const excludeSeriesId = body.series_id ? String(body.series_id) : null;
      if (excludeSeriesId) {
        const existing = await courseSeries(admin, excludeSeriesId);
        if (existing.venue_id !== schedule.venueId) return errorResponse('Course not found', 404);
      }
      return jsonResponse(await previewCourseResourceSchedule(admin, schedule, excludeSeriesId), 200, 0);
    }

    if (req.method === 'POST' && path === 'series') {
      const body = await req.json();
      const venueId = String(body.venue_id || body.venueId || '');
      await requireVenueRole(admin, auth.userId, venueId, ['venue_admin']);
      const venueRow = await venue(admin, { id: venueId });
      const formatId = String(body.format_id || '');
      const { data: format, error: formatError } = await admin.from('activity_formats')
        .select('id, organization_id, name, description, full_description, requires_instructor')
        .eq('id', formatId).eq('organization_id', venueRow.organization_id).eq('is_active', true).maybeSingle();
      if (formatError || !format) return errorResponse('Course Format not found', 404);
      const capacity = Math.floor(Number(body.capacity || 0));
      const priceSek = Math.round(Number(body.price_sek || 0));
      const schedule = courseScheduleInput(body);
      if (!schedule || schedule.venueId !== venueId || capacity <= 0 || priceSek <= 0) return errorResponse('Course capacity, price, schedule and resources are required', 400);
      const totalSessions = schedule.totalSessions;
      const recurrenceDays = schedule.recurrenceDays;
      const courtIds = schedule.courtIds;
      const resourcePreview = await previewCourseResourceSchedule(admin, schedule);
      if (resourcePreview.has_conflicts) return courseConflictResponse(resourcePreview);
      const productKey = courseProductKey();
      const { data: product, error: productError } = await admin.from('access_products').insert({
        venue_id: venueId,
        product_key: productKey,
        name: cleanText(body.name, 120) || format.name,
        description: cleanText(body.description, 1000) || format.description || null,
        product_kind: 'series_access',
        base_price_sek: priceSek,
        vat_rate: 6,
        grants: { scope_type: 'activity_series', meter_type: 'unlimited' },
        is_active: true,
        commerce_kind: 'participation',
        fulfillment_type: 'participation',
        fulfillment_presentation: 'participation',
        commerce_enabled: true,
        status: 'active',
        standalone_enabled: false,
        activity_addon_enabled: false,
        category: 'course',
        sport: 'pickleball',
        resolver_rules: { purchase_kind: 'course', max_quantity: 1 },
      }).select('*').single();
      if (productError || !product) throw new Error(productError?.message || 'Course product could not be created');
      const { data: series, error: seriesError } = await admin.from('activity_series').insert({
        venue_id: venueId,
        format_id: format.id,
        name: cleanText(body.name, 120) || format.name,
        description: cleanText(body.description, 1000) || format.description || null,
        series_type: 'course',
        sport_type: 'pickleball',
        status: 'draft',
        product_key: productKey,
        access_product_id: product.id,
        start_date: body.start_date,
        end_date: body.end_date,
        total_sessions: totalSessions,
        registration_opens_at: body.registration_opens_at,
        registration_closes_at: body.registration_closes_at,
        capacity,
        recurrence_days: recurrenceDays,
        start_time: body.start_time,
        end_time: body.end_time,
        court_ids: courtIds,
        metadata: { created_by: auth.userId, doctrine: 'series_commitment' },
      }).select('*').single();
      if (seriesError || !series) {
        await admin.from('access_products').delete().eq('id', product.id);
        throw new Error(seriesError?.message || 'Course Series could not be created');
      }
      const { data: sessions, error: generationError } = await admin.rpc('generate_course_series_sessions', { p_series_id: series.id });
      if (generationError) {
        await admin.from('activity_series').delete().eq('id', series.id);
        await admin.from('access_products').delete().eq('id', product.id);
        if (generationError.message.includes('course_resource_conflict')) {
          const concurrentPreview = await previewCourseResourceSchedule(admin, schedule);
          return courseConflictResponse(concurrentPreview);
        }
        throw new Error(generationError.message);
      }
      return jsonResponse({ series, product, sessions: sessions || [] }, 201, 0);
    }

    if (req.method === 'PATCH' && path === 'series') {
      const body = await req.json();
      const series = await courseSeries(admin, String(body.series_id || ''));
      await requireVenueRole(admin, auth.userId, series.venue_id, ['venue_admin']);
      const editableFields = [
        'name', 'start_date', 'end_date', 'registration_opens_at', 'registration_closes_at',
        'capacity', 'price_sek', 'recurrence_days', 'start_time', 'end_time',
        'total_sessions', 'court_ids',
      ];
      const isDraftEdit = editableFields.some((field) => body[field] !== undefined);

      if (isDraftEdit) {
        if (body.status !== undefined) return errorResponse('Publish and edit are separate actions', 400);
        if (series.status !== 'draft') return errorResponse('Published Course Series cannot be edited in V1', 409);
        const schedule = courseScheduleInput({ ...body, venue_id: series.venue_id });
        const capacity = Math.floor(Number(body.capacity || 0));
        const priceSek = Math.round(Number(body.price_sek || 0));
        const name = cleanText(body.name, 120);
        if (!schedule || !name || capacity <= 0 || priceSek <= 0) {
          return errorResponse('Course name, capacity, price, schedule and resources are required', 400);
        }
        const resourcePreview = await previewCourseResourceSchedule(admin, schedule, series.id);
        if (resourcePreview.has_conflicts) return courseConflictResponse(resourcePreview);
        const { error } = await admin.rpc('update_course_draft_series', {
          p_series_id: series.id,
          p_name: name,
          p_start_date: schedule.startDate,
          p_end_date: schedule.endDate,
          p_registration_opens_at: body.registration_opens_at,
          p_registration_closes_at: body.registration_closes_at,
          p_capacity: capacity,
          p_price_sek: priceSek,
          p_recurrence_days: schedule.recurrenceDays,
          p_start_time: schedule.startTime,
          p_end_time: schedule.endTime,
          p_total_sessions: schedule.totalSessions,
          p_court_ids: schedule.courtIds,
        });
        if (error) {
          if (error.message.includes('course_resource_conflict')) {
            return courseConflictResponse(await previewCourseResourceSchedule(admin, schedule, series.id));
          }
          if (/course_series_not_draft|course_draft_has_/.test(error.message)) {
            return errorResponse('Course draft can no longer be edited safely', 409);
          }
          throw new Error(error.message);
        }
        return jsonResponse(await projectCourse(admin, await courseSeries(admin, series.id), null), 200, 0);
      }

      if (body.status === undefined) return errorResponse('No Course update supplied', 400);
      const nextStatus = String(body.status);
      const transitions: Record<string, string[]> = {
        draft: ['active', 'cancelled'],
        active: ['paused', 'completed', 'cancelled'],
        paused: ['active', 'completed', 'cancelled'],
        completed: [],
        cancelled: [],
      };
      if (!(transitions[series.status] || []).includes(nextStatus)) return errorResponse('Invalid Course status transition', 409);
      const { data, error } = await admin.from('activity_series').update({ status: nextStatus }).eq('id', series.id).select('*').single();
      if (error) throw new Error(error.message);
      return jsonResponse(await projectCourse(admin, data, null), 200, 0);
    }

    if (req.method === 'PATCH' && path === 'session') {
      const body = await req.json();
      const sessionId = String(body.session_id || '');
      const { data: session, error: sessionError } = await admin.from('activity_sessions')
        .select('id, venue_id, series_id, activity_series!inner(series_type)')
        .eq('id', sessionId).maybeSingle();
      if (sessionError || !session || (session as { activity_series?: { series_type?: string } }).activity_series?.series_type !== 'course') return errorResponse('Course Session not found', 404);
      await requireVenueRole(admin, auth.userId, session.venue_id, ['venue_admin']);
      const updates: Record<string, unknown> = {};
      for (const field of ['session_date', 'start_time', 'end_time', 'is_active']) if (body[field] !== undefined) updates[field] = body[field];
      if (body.court_ids !== undefined) updates.court_ids = Array.isArray(body.court_ids) ? body.court_ids : [];
      const { data, error } = await admin.from('activity_sessions').update(updates).eq('id', session.id).select('*').single();
      if (error) throw new Error(error.message);
      return jsonResponse(data, 200, 0);
    }

    if (req.method === 'POST' && path === 'session') {
      const body = await req.json();
      const series = await courseSeries(admin, String(body.series_id || ''));
      await requireVenueRole(admin, auth.userId, series.venue_id, ['venue_admin']);
      const { data: last } = await admin.from('activity_sessions').select('series_occurrence_index').eq('series_id', series.id).order('series_occurrence_index', { ascending: false }).limit(1).maybeSingle();
      const { data: format } = series.format_id
        ? await admin.from('activity_formats').select('requires_instructor').eq('id', series.format_id).maybeSingle()
        : { data: null };
      const occurrenceIndex = Number(last?.series_occurrence_index || 0) + 1;
      const { data, error } = await admin.from('activity_sessions').insert({
        venue_id: series.venue_id, name: series.name, session_type: 'course', sport_type: series.sport_type,
        recurrence_days: null, session_date: body.session_date, start_time: body.start_time || series.start_time,
        end_time: body.end_time || series.end_time, price_sek: 0, capacity: series.capacity,
        court_ids: body.court_ids || series.court_ids, access_policy: { series_commitment_required: true },
        is_active: true, metadata: { generated_by: 'course_series', activity_series_id: series.id, added_manually: true },
        series_id: series.id, product_key: null, publish_status: 'published', requires_staffing: format?.requires_instructor === true,
        closed_to_public: true, series_occurrence_index: occurrenceIndex,
      }).select('*').single();
      if (error) throw new Error(error.message);
      return jsonResponse(data, 201, 0);
    }

    return errorResponse('Not found', 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Course request failed';
    const status = message.startsWith('Forbidden') ? 403
      : message.includes('series_staff_grant_forbidden') ? 403
      : /not found/i.test(message) ? 404
      : /series_staff_grant_(series_ineligible|idempotency_key_reused|cancellation_only|commitment_not_active)/.test(message) ? 409
      : message.includes('course_resource_conflict') ? 409
      : /required|unavailable|does not produce|participant_required/i.test(message) ? 400
      : 500;
    return errorResponse(message, status);
  }
};

const localFunctionPort = Number(Deno.env.get('FUNCTION_PORT') || 0);
if (localFunctionPort > 0) Deno.serve({ port: localFunctionPort }, coursesHandler);
else Deno.serve(coursesHandler);
