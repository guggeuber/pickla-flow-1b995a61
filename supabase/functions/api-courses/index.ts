import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import { requireVenueRole } from '../_shared/authorization.ts';
import { resolveCustomerIdForUser } from '../_shared/customers.ts';
import { resolveScopeAwarePricingDecision } from '../_shared/scope_pricing.ts';
import {
  DEFAULT_COURSE_PARTICIPANT_POLICY,
  isCourseParticipantPolicy,
  resolveCourseParticipantPolicy,
} from '../_shared/course_participant_policy.ts';
import { projectPublicCourseCoaches } from '../_shared/course_coach_projection.ts';
import {
  loadPublicCourseCatalog,
  type PublicCourseCatalogRpcClient,
} from '../_shared/public_course_catalog.ts';
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

async function managedSeriesEditPolicy(admin: ServiceClient, series: CourseSeriesRow) {
  const { data: sessions, error: sessionsError } = await admin.from('activity_sessions')
    .select('id, session_date, start_time, is_active')
    .eq('series_id', series.id)
    .order('series_occurrence_index');
  if (sessionsError) throw new Error(sessionsError.message);
  const sessionIds = (sessions || []).map((session) => session.id);
  const now = DateTime.now().setZone('Europe/Stockholm');
  const hasStarted = (sessions || []).some((session) => {
    if (!session.is_active || !session.session_date || !session.start_time) return false;
    const starts = DateTime.fromISO(`${session.session_date}T${String(session.start_time).slice(0, 8)}`, { zone: 'Europe/Stockholm' });
    return starts.isValid && starts <= now;
  });
  const [commitmentsResult, activeCommitmentsResult, holdsResult, ordersResult, registrationsResult, staffingResult] = await Promise.all([
    admin.from('series_commitments').select('id', { count: 'exact', head: true }).eq('activity_series_id', series.id),
    admin.from('series_commitments').select('id', { count: 'exact', head: true })
      .eq('activity_series_id', series.id).eq('status', 'active'),
    admin.from('capacity_holds').select('id', { count: 'exact', head: true })
      .eq('venue_id', series.venue_id).eq('scope_type', 'activity_series').eq('scope_id', series.id)
      .eq('status', 'active').gt('expires_at', new Date().toISOString()),
    admin.from('commerce_order_lines').select('id, commerce_orders!inner(status)', { count: 'exact', head: true })
      .eq('activity_series_id', series.id).in('commerce_orders.status', ['checkout_pending', 'paid', 'attention', 'cancelled']),
    sessionIds.length
      ? admin.from('session_registrations').select('id', { count: 'exact', head: true }).in('activity_session_id', sessionIds)
      : Promise.resolve({ count: 0, error: null }),
    sessionIds.length
      ? admin.from('operational_staff_assignments').select('id', { count: 'exact', head: true })
        .eq('source_type', 'activity_session').eq('status', 'active').in('source_id', sessionIds)
      : Promise.resolve({ count: 0, error: null }),
  ]);
  const policyError = commitmentsResult.error || activeCommitmentsResult.error || holdsResult.error || ordersResult.error || registrationsResult.error || staffingResult.error;
  if (policyError) throw new Error(policyError.message);
  const commitmentCount = Number(commitmentsResult.count || 0);
  const activeCommitmentCount = Number(activeCommitmentsResult.count || 0);
  const activeHoldsCount = Number(holdsResult.count || 0);
  const orderHistoryCount = Number(ordersResult.count || 0);
  const registrationCount = Number(registrationsResult.count || 0);
  const staffingCount = Number(staffingResult.count || 0);
  const lifecycleEditable = ['draft', 'active', 'paused'].includes(String(series.status || ''));
  const scheduleEditable = lifecycleEditable && !hasStarted && commitmentCount === 0 && activeHoldsCount === 0
    && orderHistoryCount === 0 && registrationCount === 0 && staffingCount === 0;
  const scheduleLockReason = !lifecycleEditable ? 'lifecycle_locked'
    : hasStarted ? 'series_started'
    : commitmentCount > 0 || orderHistoryCount > 0 || registrationCount > 0 ? 'participants_or_payments_exist'
    : activeHoldsCount > 0 ? 'active_checkout_holds'
    : staffingCount > 0 ? 'staffing_exists'
    : null;
  return {
    lifecycle_editable: lifecycleEditable,
    schedule_editable: scheduleEditable,
    schedule_lock_reason: scheduleLockReason,
    has_started: hasStarted,
    commitment_count: commitmentCount,
    active_holds_count: activeHoldsCount,
    order_history_count: orderHistoryCount,
    registration_count: registrationCount,
    staffing_assignment_count: staffingCount,
    minimum_capacity: activeCommitmentCount + activeHoldsCount,
    historical_prices_frozen: commitmentCount > 0 || orderHistoryCount > 0,
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

function projectSeriesIncludedAccess(product: Record<string, unknown> | null, sessions: Array<Record<string, unknown>>) {
  const resolverRules = (product?.resolver_rules || {}) as Record<string, unknown>;
  const includedBenefits = (resolverRules.included_benefits || {}) as Record<string, unknown>;
  const openPlayRule = (includedBenefits.open_play_series_period || {}) as Record<string, unknown>;
  const activeSessions = sessions
    .filter((session) => session.is_active === true && session.publish_status === 'published' && session.session_date)
    .sort((left, right) => String(left.session_date).localeCompare(String(right.session_date))
      || String(left.start_time || '').localeCompare(String(right.start_time || '')));
  const first = activeSessions[0];
  const last = activeSessions[activeSessions.length - 1];
  const starts = first
    ? DateTime.fromISO(String(first.session_date), { zone: 'Europe/Stockholm' }).startOf('day')
    : null;
  const expires = last
    ? DateTime.fromISO(String(last.session_date), { zone: 'Europe/Stockholm' }).plus({ days: 1 }).startOf('day')
    : null;
  return {
    open_play_series_period: {
      enabled: openPlayRule.enabled === true,
      starts_at: starts?.isValid ? starts.toUTC().toISO() : null,
      expires_at: expires?.isValid ? expires.toUTC().toISO() : null,
      start_date: first?.session_date || null,
      end_date: last?.session_date || null,
      period_source: 'active_series_occurrences',
    },
  };
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
      ? admin.from('access_products').select('id, venue_id, product_key, name, description, base_price_sek, vat_rate, status, is_active, product_kind, scarcity_mode, early_bird_price_minor, early_bird_slots, resolver_rules').eq('id', series.access_product_id).maybeSingle()
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
  const pricingDecision = productResult.data
    ? await resolveScopeAwarePricingDecision({
      client: admin,
      scopeType: 'activity_series',
      scopeId: series.id,
      venueId: series.venue_id,
      userId: userId || null,
      customerId: null,
      salesChannel: 'online',
      accessProduct: productResult.data,
      series,
    })
    : null;
  const earlyBird = pricingDecision?.debug?.early_bird as Record<string, unknown> | undefined;
  const sessions = (sessionsResult.data || []) as Array<Record<string, unknown>>;
  let coach: Awaited<ReturnType<typeof projectCourseCoach>> = { coverage: 'none', mode: 'unassigned', coaches: [] };
  try {
    coach = await projectCourseCoach(admin, series, sessions);
  } catch (error) {
    console.error('course coach projection unavailable', series.id, error instanceof Error ? error.message : error);
  }
  return {
    ...series,
    format: formatResult.data || null,
    image_urls: (seriesImages.length ? seriesImages : formatImages).slice(0, 3),
    product: productResult.data || null,
    pricing: pricingDecision ? {
      scope_type: pricingDecision.scopeType,
      list_price_minor: Math.round(Number(pricingDecision.listAmountSek || 0) * 100),
      final_price_minor: Math.round(Number(pricingDecision.finalAmountSek || 0) * 100),
      pricing_reason: pricingDecision.pricingReason,
      sales_channel: pricingDecision.salesChannel,
      checkout_label: pricingDecision.checkoutLabel,
      membership_tier_name: pricingDecision.membershipTierName,
      early_bird: {
        configured: earlyBird?.configured === true,
        active: earlyBird?.active === true,
        applied: earlyBird?.applied === true,
        price_minor: earlyBird?.price_minor == null ? null : Number(earlyBird.price_minor),
        slots: earlyBird?.slots == null ? null : Number(earlyBird.slots),
        remaining: earlyBird?.remaining == null ? null : Number(earlyBird.remaining),
      },
    } : null,
    venue: venueResult.data || null,
    sessions,
    included_access: projectSeriesIncludedAccess(productResult.data, sessions),
    participant_policy: resolveCourseParticipantPolicy(productResult.data?.resolver_rules),
    coach,
    capacity,
    registration_state: registrationState(series),
    customer_has_commitment: Boolean(commitment),
    commitment,
  };
}

async function projectCourseCoach(
  admin: ServiceClient,
  series: CourseSeriesRow,
  sessions: Array<Record<string, unknown>>,
) {
  const requiredSessions = sessions.filter((session) => session.is_active === true
    && session.publish_status === 'published'
    && session.requires_staffing === true
    && session.id
    && session.session_date);
  const unassigned = { coverage: 'none', mode: 'unassigned', coaches: [] } as const;
  if (!requiredSessions.length) return unassigned;

  const sessionIds = requiredSessions.map((session) => String(session.id));
  const { data: assignments, error: assignmentError } = await admin.from('operational_staff_assignments')
    .select('source_id, occurrence_date, venue_staff_id')
    .eq('venue_id', series.venue_id)
    .eq('source_type', 'activity_session')
    .eq('role', 'instructor')
    .eq('status', 'active')
    .in('source_id', sessionIds);
  if (assignmentError) throw new Error(assignmentError.message);
  const staffIds = [...new Set((assignments || []).map((assignment) => assignment.venue_staff_id).filter(Boolean))];
  if (!staffIds.length) return unassigned;

  const { data: staffRows, error: staffError } = await admin.from('venue_staff')
    .select('id, user_id')
    .eq('venue_id', series.venue_id)
    .eq('is_active', true)
    .in('id', staffIds);
  if (staffError) throw new Error(staffError.message);
  const userIds = [...new Set((staffRows || []).map((staff) => staff.user_id).filter(Boolean))];
  const { data: profiles, error: profileError } = userIds.length
    ? await admin.from('player_profiles').select('auth_user_id, display_name').in('auth_user_id', userIds)
    : { data: [], error: null };
  if (profileError) throw new Error(profileError.message);

  return projectPublicCourseCoaches({
    sessions: requiredSessions,
    assignments: assignments || [],
    staff: staffRows || [],
    profiles: profiles || [],
  });
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
  const commitmentIds = commitments.map((row) => row.id);
  const [{ data: seriesRows, error: seriesError }, { data: sessionRows, error: sessionError }, { data: benefitRows, error: benefitError }] = await Promise.all([
    admin.from('activity_series').select('id, venue_id, format_id, name, start_date, end_date, total_sessions, status').in('id', seriesIds),
    admin.from('activity_sessions')
      .select('id, series_id, session_date, start_time, end_time, is_active, publish_status, series_occurrence_index')
      .in('series_id', seriesIds)
      .eq('is_active', true)
      .eq('publish_status', 'published')
      .order('session_date'),
    admin.from('access_entitlements')
      .select('id, source_id, status, starts_at, expires_at, access_reason')
      .eq('source_type', 'series_benefit')
      .eq('entitlement_type', 'series_access')
      .eq('scope_type', 'open_play')
      .in('source_id', commitmentIds),
  ]);
  if (seriesError || sessionError || benefitError) throw new Error(seriesError?.message || sessionError?.message || benefitError?.message || 'Course projection unavailable');
  const formatIds = [...new Set((seriesRows || []).map((row) => row.format_id).filter(Boolean))];
  const { data: formatRows, error: formatError } = formatIds.length
    ? await admin.from('activity_formats').select('id, name, presentation_type').in('id', formatIds)
    : { data: [], error: null };
  if (formatError) throw new Error(formatError.message);
  const formatById = new Map((formatRows || []).map((format) => [format.id, format]));
  const dependentById = new Map((dependentRows || []).map((row) => [row.id, row]));
  const benefitByCommitmentId = new Map((benefitRows || []).map((row) => [row.source_id, row]));
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
      series: series ? {
        ...series,
        format_name: formatById.get(series.format_id)?.name || null,
        presentation_type: formatById.get(series.format_id)?.presentation_type || 'course',
      } : series,
      participant: commitment.dependent_participant_id
        ? { kind: 'dependent', ...(dependentById.get(commitment.dependent_participant_id) || {}) }
        : { kind: 'customer' },
      next_session: next,
      completed_sessions: completed,
      total_sessions: sessions.length,
      included_access: benefitByCommitmentId.has(commitment.id) ? {
        open_play_series_period: {
          enabled: benefitByCommitmentId.get(commitment.id)?.status !== 'revoked',
          starts_at: benefitByCommitmentId.get(commitment.id)?.starts_at || null,
          expires_at: benefitByCommitmentId.get(commitment.id)?.expires_at || null,
          access_reason: benefitByCommitmentId.get(commitment.id)?.access_reason || null,
        },
      } : null,
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
  const row = preview.rows.find((candidate) => !candidate.is_available && candidate.conflicts.length > 0);
  const conflict = row?.conflicts[0];
  const starts = conflict?.starts_at
    ? DateTime.fromISO(conflict.starts_at).setZone('Europe/Stockholm').setLocale('sv')
    : null;
  const ends = conflict?.ends_at
    ? DateTime.fromISO(conflict.ends_at).setZone('Europe/Stockholm')
    : null;
  const operatorMessage = row && conflict && starts?.isValid && ends?.isValid
    ? `${row.court_name} är redan upptagen ${starts.toFormat('ccc HH:mm')}–${ends.toFormat('HH:mm')}`
    : 'En vald bana är redan upptagen.';
  return jsonResponse({
    error: operatorMessage,
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
      return jsonResponse(projected, 200, userId ? 0 : 5);
    }

    if (req.method === 'GET' && path === 'home') {
      const userId = await optionalUserId(req);
      const venueRow = await venue(admin, {
        id: url.searchParams.get('venueId'),
        slug: url.searchParams.get('v') || url.searchParams.get('slug'),
      });
      if (userId) {
        const mine = await listMyCourses(admin, userId);
        const homeNow = DateTime.now().setZone('Europe/Stockholm');
        const homeHorizonEnd = homeNow.plus({ days: 1 }).endOf('day');
        const active = mine
          .filter((item) => item.series?.venue_id === venueRow.id && item.commitment?.status === 'active' && item.next_session)
          .filter((item) => {
            const next = item.next_session;
            if (!next) return false;
            const starts = DateTime.fromISO(`${next.session_date}T${String(next.start_time).slice(0, 8)}`, { zone: 'Europe/Stockholm' });
            const ends = DateTime.fromISO(`${next.session_date}T${String(next.end_time).slice(0, 8)}`, { zone: 'Europe/Stockholm' });
            return starts.isValid && ends.isValid && ends > homeNow && starts <= homeHorizonEnd;
          })
          .sort((a, b) => {
            const aNext = a.next_session!;
            const bNext = b.next_session!;
            const aStart = DateTime.fromISO(`${aNext.session_date}T${String(aNext.start_time).slice(0, 8)}`, { zone: 'Europe/Stockholm' }).toMillis();
            const bStart = DateTime.fromISO(`${bNext.session_date}T${String(bNext.start_time).slice(0, 8)}`, { zone: 'Europe/Stockholm' }).toMillis();
            return aStart - bStart;
          })[0];
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
        if (projected.customer_has_commitment) continue;
        if (projected.capacity.available_count > 0) return jsonResponse({ mode: 'registration', item: projected }, 200, userId ? 0 : 5);
      }
      return jsonResponse({ mode: 'none', item: null }, 200, 5);
    }

    if (req.method === 'GET' && path === 'catalog-prices') {
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

    if (req.method === 'GET' && path === 'catalog') {
      const venueSlug = String(url.searchParams.get('v') || url.searchParams.get('slug') || '').trim();
      if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(venueSlug)) return errorResponse('Valid venue slug is required', 400);
      const edgeStartedAt = performance.now();
      const rpcStartedAt = performance.now();
      const catalog = await loadPublicCourseCatalog(
        admin as unknown as PublicCourseCatalogRpcClient,
        venueSlug,
      );
      const rpcDuration = performance.now() - rpcStartedAt;
      if (!catalog.venue_found) return errorResponse('Venue not found', 404);
      const serializationStartedAt = performance.now();
      const body = JSON.stringify({ items: catalog.items });
      const serializationDuration = performance.now() - serializationStartedAt;
      const headers = {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=5, s-maxage=5',
        'Server-Timing': `course_catalog_rpc;dur=${rpcDuration.toFixed(1)}, serialize;dur=${serializationDuration.toFixed(1)}, edge;dur=${(performance.now() - edgeStartedAt).toFixed(1)}`,
      };
      return new Response(body, { status: 200, headers });
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
          edit_policy: await managedSeriesEditPolicy(admin, series),
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
      const { data: existingFormat, error: existingFormatError } = await admin.from('activity_formats')
        .select('id, image_urls').eq('id', formatId).eq('organization_id', venueRow.organization_id).eq('is_active', true).maybeSingle();
      if (existingFormatError) throw new Error(existingFormatError.message);
      if (!existingFormat) return errorResponse('Course Format not found', 404);
      const { data, error } = await admin.rpc('update_managed_series_format', {
        p_format_id: formatId,
        p_organization_id: venueRow.organization_id,
        p_name: name,
        p_description: cleanText(body.description, 1000) || null,
        p_full_description: cleanText(body.full_description, 20000) || null,
        p_image_urls: body.image_urls === undefined
          ? (Array.isArray(existingFormat.image_urls) ? existingFormat.image_urls : [])
          : cleanImageUrls(body.image_urls, `activity-formats/${formatId}`),
        p_age_group: ageGroup,
        p_level: level,
        p_requires_instructor: body.requires_instructor === true,
        p_presentation_type: presentationType,
      });
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

    if (req.method === 'PATCH' && path === 'series-early-bird') {
      const body = await req.json();
      const series = await managedSellableSeries(admin, String(body.series_id || ''));
      await requireVenueRole(admin, auth.userId, series.venue_id, ['venue_admin']);
      if (!['draft', 'active', 'paused'].includes(String(series.status || ''))) {
        return errorResponse('Early Bird kan inte ändras för en avslutad serie.', 409);
      }
      const { data: product, error: productError } = await admin.from('access_products')
        .select('id, venue_id, product_key, product_kind, base_price_sek, status, is_active')
        .eq('id', series.access_product_id)
        .eq('venue_id', series.venue_id)
        .maybeSingle();
      if (productError) throw new Error(productError.message);
      if (!product || product.product_kind !== 'series_access' || product.status !== 'active' || product.is_active !== true) {
        return errorResponse('Seriens prissättningsprodukt är inte aktiv.', 409);
      }

      const enabled = body.enabled === true;
      let updates: Record<string, unknown> = {
        scarcity_mode: 'none',
        early_bird_price_minor: null,
        early_bird_slots: null,
      };
      if (enabled) {
        const priceSek = Number(body.price_sek);
        const priceMinor = Math.round(priceSek * 100);
        const requestedSlots = Number(body.slots);
        const slots = requestedSlots;
        const basePriceMinor = Math.round(Number(product.base_price_sek || 0) * 100);
        const { data: seriesRow, error: seriesError } = await admin.from('activity_series')
          .select('capacity')
          .eq('id', series.id)
          .eq('venue_id', series.venue_id)
          .maybeSingle();
        if (seriesError) throw new Error(seriesError.message);
        const capacity = Math.floor(Number(seriesRow?.capacity || 0));
        if (!Number.isFinite(priceSek) || priceMinor <= 0) {
          return errorResponse('Early Bird-priset måste vara större än 0 kr.', 400);
        }
        if (priceMinor >= basePriceMinor) {
          return errorResponse('Early Bird-priset måste vara lägre än ordinarie pris.', 400);
        }
        if (!Number.isInteger(requestedSlots) || slots < 1) {
          return errorResponse('Early Bird måste omfatta ett helt antal platser, minst en.', 400);
        }
        if (capacity < 1 || slots > capacity) {
          return errorResponse('Antalet Early Bird-platser får inte överstiga seriens kapacitet.', 400);
        }
        updates = {
          scarcity_mode: 'early_bird',
          early_bird_price_minor: priceMinor,
          early_bird_slots: slots,
        };
      }
      const { data: updated, error: updateError } = await admin.from('access_products')
        .update(updates)
        .eq('id', product.id)
        .eq('venue_id', series.venue_id)
        .eq('product_kind', 'series_access')
        .select('id, venue_id, product_key, name, base_price_sek, scarcity_mode, early_bird_price_minor, early_bird_slots')
        .maybeSingle();
      if (updateError) throw new Error(updateError.message);
      if (!updated) return errorResponse('Seriens prissättningsprodukt kunde inte uppdateras.', 409);
      return jsonResponse({
        series_id: series.id,
        product: updated,
        preview: {
          ordinary_price_sek: Number(updated.base_price_sek || 0),
          early_bird_price_sek: updated.early_bird_price_minor == null
            ? null
            : Number(updated.early_bird_price_minor) / 100,
          early_bird_slots: updated.early_bird_slots == null ? null : Number(updated.early_bird_slots),
        },
      }, 200, 0);
    }

    if (req.method === 'PATCH' && path === 'series-included-access') {
      const body = await req.json();
      const series = await managedSellableSeries(admin, String(body.series_id || ''));
      await requireVenueRole(admin, auth.userId, series.venue_id, ['venue_admin']);
      if (!['draft', 'active', 'paused'].includes(String(series.status || ''))) {
        return errorResponse('Inkluderad access kan inte ändras för en avslutad omgång.', 409);
      }
      if (typeof body.open_play_series_period_enabled !== 'boolean') {
        return errorResponse('Välj om Open Play ska ingå under erbjudandets period.', 400);
      }
      const { data, error } = await admin.rpc('set_series_open_play_benefit', {
        p_series_id: series.id,
        p_enabled: body.open_play_series_period_enabled,
      });
      if (error) {
        if (error.message.includes('series_open_play_benefit_commercial_history_locked')) {
          return errorResponse('Inkluderad access är låst eftersom deltagare eller betalningshistorik finns.', 409);
        }
        if (error.message.includes('series_open_play_benefit_product_invalid')) {
          return errorResponse('Omgångens accessprodukt är inte giltig.', 409);
        }
        throw new Error(error.message);
      }
      return jsonResponse(data, 200, 0);
    }

    if (req.method === 'PATCH' && path === 'series-participant-policy') {
      const body = await req.json();
      const series = await managedSellableSeries(admin, String(body.series_id || ''));
      await requireVenueRole(admin, auth.userId, series.venue_id, ['venue_admin']);
      if (!['draft', 'active', 'paused'].includes(String(series.status || ''))) {
        return errorResponse('Deltagarregeln kan inte ändras för en avslutad omgång.', 409);
      }
      const participantPolicy = String(body.participant_policy || '');
      if (!isCourseParticipantPolicy(participantPolicy)) return errorResponse('Ogiltig deltagarregel.', 400);
      const [{ data: product, error: productError }, commitments, orderLines, activeHolds] = await Promise.all([
        admin.from('access_products')
          .select('id, resolver_rules')
          .eq('id', series.access_product_id)
          .eq('venue_id', series.venue_id)
          .eq('product_kind', 'series_access')
          .maybeSingle(),
        admin.from('series_commitments').select('id', { count: 'exact', head: true })
          .eq('activity_series_id', series.id),
        admin.from('commerce_order_lines').select('id', { count: 'exact', head: true })
          .eq('activity_series_id', series.id),
        admin.from('capacity_holds').select('id', { count: 'exact', head: true })
          .eq('venue_id', series.venue_id)
          .eq('scope_type', 'activity_series')
          .eq('scope_id', series.id)
          .eq('status', 'active')
          .gt('expires_at', new Date().toISOString()),
      ]);
      const boundaryError = productError || commitments.error || orderLines.error || activeHolds.error;
      if (boundaryError) throw new Error(boundaryError.message);
      if (!product) return errorResponse('Omgångens accessprodukt saknas.', 409);
      if (Number(commitments.count || 0) > 0 || Number(orderLines.count || 0) > 0 || Number(activeHolds.count || 0) > 0) {
        return errorResponse('Deltagarregeln är låst eftersom deltagare, köphistorik eller en pågående checkout finns.', 409);
      }
      const resolverRules = product.resolver_rules && typeof product.resolver_rules === 'object' && !Array.isArray(product.resolver_rules)
        ? product.resolver_rules as Record<string, unknown>
        : {};
      const { data: updated, error: updateError } = await admin.from('access_products')
        .update({ resolver_rules: { ...resolverRules, participant_policy: participantPolicy } })
        .eq('id', product.id)
        .eq('venue_id', series.venue_id)
        .eq('product_kind', 'series_access')
        .select('id, resolver_rules')
        .maybeSingle();
      if (updateError) throw new Error(updateError.message);
      if (!updated) return errorResponse('Deltagarregeln kunde inte sparas.', 409);
      return jsonResponse({
        series_id: series.id,
        access_product_id: updated.id,
        participant_policy: resolveCourseParticipantPolicy(updated.resolver_rules),
      }, 200, 0);
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
      const participantPolicy = body.participant_policy == null
        ? DEFAULT_COURSE_PARTICIPANT_POLICY
        : String(body.participant_policy);
      if (!isCourseParticipantPolicy(participantPolicy)) return errorResponse('Ogiltig deltagarregel.', 400);
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
        resolver_rules: { purchase_kind: 'course', max_quantity: 1, participant_policy: participantPolicy },
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
        'name', 'image_urls', 'start_date', 'end_date', 'registration_opens_at', 'registration_closes_at',
        'capacity', 'price_sek', 'recurrence_days', 'start_time', 'end_time',
        'total_sessions', 'court_ids',
      ];
      const isManagedEdit = editableFields.some((field) => body[field] !== undefined);

      if (isManagedEdit) {
        if (body.status !== undefined) return errorResponse('Publish and edit are separate actions', 400);
        if (!['draft', 'active', 'paused'].includes(String(series.status || ''))) {
          return errorResponse('Den här omgången är avslutad och kan inte längre redigeras.', 409);
        }
        const schedule = courseScheduleInput({ ...body, venue_id: series.venue_id });
        const capacity = Math.floor(Number(body.capacity || 0));
        const priceSek = Math.round(Number(body.price_sek || 0));
        const name = cleanText(body.name, 120);
        if (!schedule || !name || capacity <= 0 || priceSek <= 0) {
          return errorResponse('Course name, capacity, price, schedule and resources are required', 400);
        }
        const resourcePreview = await previewCourseResourceSchedule(admin, schedule, series.id);
        if (resourcePreview.has_conflicts) return courseConflictResponse(resourcePreview);
        const imageUrls = body.image_urls === undefined
          ? (Array.isArray(series.image_urls) ? series.image_urls : [])
          : cleanImageUrls(body.image_urls, `activity-series/${series.id}`);
        const { error } = await admin.rpc('update_managed_series_run', {
          p_series_id: series.id,
          p_name: name,
          p_image_urls: imageUrls,
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
          if (error.message.includes('managed_series_capacity_below_fill')) return errorResponse('Antalet platser får inte vara lägre än aktiva platser och pågående betalningar.', 409);
          if (error.message.includes('managed_series_capacity_below_early_bird_slots')) return errorResponse('Antalet platser får inte vara lägre än den aktiva Early Bird-gränsen.', 409);
          if (error.message.includes('managed_series_price_below_early_bird')) return errorResponse('Ordinarie pris måste vara högre än det aktiva Early Bird-priset.', 409);
          if (error.message.includes('managed_series_price_below_member_price')) return errorResponse('Ordinarie pris får inte sänkas under ett aktivt fast medlemspris.', 409);
          if (error.message.includes('managed_series_schedule_started')) return errorResponse('Schemat är låst eftersom omgången har startat.', 409);
          if (error.message.includes('managed_series_schedule_has_participants')) return errorResponse('Schemat är låst eftersom deltagare, betalning eller pågående checkout finns.', 409);
          if (error.message.includes('managed_series_schedule_has_staffing')) return errorResponse('Ta bort aktiva bemanningsuppdrag innan schemat ändras.', 409);
          if (error.message.includes('managed_series_product_invalid')) return errorResponse('Seriens produkt är inte aktiv eller saknar korrekt koppling.', 409);
          if (/managed_series_(lifecycle_locked|not_found)/.test(error.message)) return errorResponse('Omgången kan inte längre redigeras.', 409);
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
      if (nextStatus === 'active') {
        const schedule = courseScheduleInput({ ...series, venue_id: series.venue_id });
        if (!schedule) return errorResponse('Schema och banor måste vara kompletta före publicering.', 409);
        const preview = await previewCourseResourceSchedule(admin, schedule, series.id);
        if (preview.has_conflicts) return courseConflictResponse(preview);
        const [{ count: activeSessionCount, error: sessionsError }, { data: product, error: productError }] = await Promise.all([
          admin.from('activity_sessions').select('id', { count: 'exact', head: true })
            .eq('series_id', series.id).eq('is_active', true),
          admin.from('access_products').select('id, base_price_sek, status, is_active, product_kind')
            .eq('id', series.access_product_id).eq('venue_id', series.venue_id).maybeSingle(),
        ]);
        if (sessionsError || productError) throw new Error(sessionsError?.message || productError?.message || 'Publish readiness unavailable');
        if (Number(activeSessionCount || 0) !== Number(series.total_sessions || 0)) {
          return errorResponse('Alla tillfällen måste finnas före publicering.', 409);
        }
        if (!product || product.product_kind !== 'series_access' || product.status !== 'active'
          || product.is_active !== true || Number(product.base_price_sek || 0) <= 0) {
          return errorResponse('En aktiv produkt med giltigt pris krävs före publicering.', 409);
        }
        const fill = await seriesCapacity(admin, series);
        if (fill.capacity < fill.committed_count + fill.active_holds_count) {
          return errorResponse('Kapaciteten är lägre än aktiva platser och pågående betalningar.', 409);
        }
      }
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
      return errorResponse('Tillfället ägs av Program & Event. Ändra hela omgången där så att schema och deltagare förblir synkroniserade.', 409);
    }

    if (req.method === 'POST' && path === 'session') {
      const body = await req.json();
      const series = await courseSeries(admin, String(body.series_id || ''));
      await requireVenueRole(admin, auth.userId, series.venue_id, ['venue_admin']);
      return errorResponse('Tillfällen skapas genom omgångens schema i Program & Event, inte som fristående pass.', 409);
    }

    return errorResponse('Not found', 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Course request failed';
    const status = message.startsWith('Forbidden') ? 403
      : message.includes('series_staff_grant_forbidden') ? 403
      : /not found/i.test(message) ? 404
      : /series_staff_grant_(series_ineligible|idempotency_key_reused|cancellation_only|commitment_not_active)/.test(message) ? 409
      : /series_open_play_benefit_(commercial_history_locked|product_invalid)/.test(message) ? 409
      : message.includes('course_resource_conflict') ? 409
      : /required|unavailable|does not produce|participant_required/i.test(message) ? 400
      : 500;
    return errorResponse(message, status);
  }
};

const localFunctionPort = Number(Deno.env.get('FUNCTION_PORT') || 0);
if (localFunctionPort > 0) Deno.serve({ port: localFunctionPort }, coursesHandler);
else Deno.serve(coursesHandler);
