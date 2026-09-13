import { DateTime } from 'https://esm.sh/luxon@3.5.0';

import {
  activityScheduleVersionsBySession,
  effectiveActivityOccurrenceForDate,
  type ActivityScheduleVersion,
} from './activity_schedule_versions.ts';
import {
  measurePublicReadStage,
  resolvePublicVenueQuery,
  type PublicReadContext,
} from './public_read_resilience.ts';
import { COMMITTED_REGISTRATION_STATUSES } from './activity_social_proof.ts';
import { projectPublicTodaySocialEventOccurrence } from './today_primary.ts';

export const TODAY_PRIMARY_QUERY_COUNT = 7;

export type TodayPrimaryProjection = {
  venue: Record<string, unknown>;
  sessions: Array<Record<string, unknown>>;
  seriesOccurrences: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  overrides: Array<Record<string, unknown>>;
  registrationCounts: Array<{
    activity_session_id: string;
    session_date: string;
    registrations_count: number;
  }>;
};

export type TodayPrimaryProjectionResult =
  | { kind: 'found'; data: TodayPrimaryProjection }
  | { kind: 'not_found' }
  | { kind: 'error'; stage: string; error: unknown };

/**
 * The shared, identity-free Today schedule projection. Public Today and the
 * authenticated personalized read model intentionally reuse this exact loader
 * so pricing does not fork schedule/visibility truth or turn the public route
 * into a coupled endpoint.
 */
export async function loadTodayPrimaryProjection(
  client: any,
  input: {
    venueSlug: string;
    startDate: string;
    endDate: string;
    readContext: PublicReadContext;
  },
): Promise<TodayPrimaryProjectionResult> {
  const { venueSlug, startDate, endDate, readContext } = input;
  const [venueResolution, sessionsResult, scheduleVersionsResult, seriesOccurrencesResult, eventsResult, overridesResult, registrationsResult] = await Promise.all([
    resolvePublicVenueQuery(readContext, () => client.from('venues')
      .select('id, name, slug')
      .eq('slug', venueSlug)
      .eq('is_public', true)
      .maybeSingle()),
    measurePublicReadStage(readContext, 'sessions', () => client.from('activity_sessions')
      .select('id, name, session_type, session_date, recurrence_days, start_time, end_time, capacity, price_sek, product_key, venue_id, access_policy, metadata, early_bird_price_minor, early_bird_slots, scarcity_mode, first_visit_offer_enabled, first_visit_price_minor, first_visit_only, is_active, publish_status, closed_to_public, schedule_effective_from, activity_series(image_urls, activity_formats(image_urls)), venues!inner(slug, is_public)')
      .eq('venues.slug', venueSlug)
      .eq('venues.is_public', true)
      .eq('closed_to_public', false)
      .order('start_time', { ascending: true })),
    measurePublicReadStage(readContext, 'schedule_versions', () => client.from('activity_session_schedule_versions')
      .select('id, activity_session_id, effective_from, effective_until, series_id, series_start_date, series_end_date, series_total_sessions, session_date, recurrence_days, start_time, end_time, court_ids, is_active, publish_status, venues!inner(slug, is_public)')
      .eq('venues.slug', venueSlug)
      .eq('venues.is_public', true)
      .lte('effective_from', endDate)
      .or(`effective_until.is.null,effective_until.gt.${startDate}`)),
    measurePublicReadStage(readContext, 'series_occurrences', () => client.from('activity_sessions')
      .select('id, series_id, name, session_date, start_time, end_time, capacity, is_active, publish_status, activity_series!inner(id, name, series_type, status, registration_opens_at, registration_closes_at, image_urls, activity_formats!inner(name, presentation_type, image_urls)), venues!inner(slug, is_public)')
      .eq('venues.slug', venueSlug)
      .eq('venues.is_public', true)
      .eq('is_active', true)
      .eq('publish_status', 'published')
      .gte('session_date', startDate)
      .lte('session_date', endDate)
      .eq('activity_series.series_type', 'course')
      .eq('activity_series.status', 'active')
      .eq('activity_series.activity_formats.presentation_type', 'social_event')
      .order('session_date', { ascending: true })
      .order('start_time', { ascending: true })),
    measurePublicReadStage(readContext, 'events', () => client.from('events')
      .select('id, name, display_name, slug, category, status, start_date, start_time, end_time, logo_url, background_url, venues!inner(slug, is_public)')
      .eq('venues.slug', venueSlug)
      .eq('venues.is_public', true)
      .eq('is_public', true)
      .in('status', ['upcoming', 'active', 'live'])
      .gte('start_date', startDate)
      .lte('start_date', endDate)
      .order('start_date', { ascending: true })),
    measurePublicReadStage(readContext, 'overrides', () => client.from('activity_session_overrides')
      .select('id, activity_session_id, session_date, status, reason, venues!inner(slug, is_public)')
      .eq('venues.slug', venueSlug)
      .eq('venues.is_public', true)
      .gte('session_date', startDate)
      .lte('session_date', endDate)),
    measurePublicReadStage(readContext, 'committed_counts', () => client.from('session_registrations')
      .select('activity_session_id, session_date, status, venues!inner(slug, is_public)')
      .eq('venues.slug', venueSlug)
      .eq('venues.is_public', true)
      .gte('session_date', startDate)
      .lte('session_date', endDate)),
  ]);

  if (venueResolution.kind === 'error') return { kind: 'error', stage: 'venue', error: venueResolution.error };
  if (venueResolution.kind === 'not_found') return { kind: 'not_found' };

  const primaryResults = [
    { stage: 'sessions', error: sessionsResult.error },
    { stage: 'schedule_versions', error: scheduleVersionsResult.error },
    { stage: 'series_occurrences', error: seriesOccurrencesResult.error },
    { stage: 'events', error: eventsResult.error },
    { stage: 'overrides', error: overridesResult.error },
    { stage: 'committed_counts', error: registrationsResult.error },
  ];
  const failedStage = primaryResults.find((result) => result.error);
  if (failedStage) return { kind: 'error', stage: failedStage.stage, error: failedStage.error };

  const registrationCounts = new Map<string, number>();
  for (const registration of registrationsResult.data || []) {
    if (!COMMITTED_REGISTRATION_STATUSES.has(String(registration.status || ''))) continue;
    const key = `${registration.activity_session_id}:${registration.session_date}`;
    registrationCounts.set(key, (registrationCounts.get(key) || 0) + 1);
  }

  const seriesProjectionInput = { venueSlug, startDate, endDate, asOf: new Date() };
  const seriesOccurrences = (seriesOccurrencesResult.data || [])
    .map((row: unknown) => projectPublicTodaySocialEventOccurrence(row, seriesProjectionInput))
    .filter((occurrence): occurrence is NonNullable<typeof occurrence> => occurrence !== null);
  const seriesOccurrenceSessionIds = new Set(seriesOccurrences.map((occurrence) => occurrence.session_id));
  const scheduleVersions = activityScheduleVersionsBySession((scheduleVersionsResult.data || []) as ActivityScheduleVersion[]);
  const versionedSessions: Array<Record<string, unknown>> = [];
  const start = DateTime.fromISO(startDate, { zone: 'Europe/Stockholm' });
  const end = DateTime.fromISO(endDate, { zone: 'Europe/Stockholm' });
  for (let cursor = start; cursor <= end; cursor = cursor.plus({ days: 1 })) {
    const date = cursor.toISODate()!;
    for (const session of sessionsResult.data || []) {
      const effectiveSession = effectiveActivityOccurrenceForDate(session, date, scheduleVersions);
      if (!effectiveSession || effectiveSession.closed_to_public === true) continue;
      versionedSessions.push({ ...effectiveSession, id: session.id, session_date: date, recurrence_days: null });
    }
  }

  return {
    kind: 'found',
    data: {
      venue: venueResolution.data as Record<string, unknown>,
      sessions: versionedSessions.filter((session) => !seriesOccurrenceSessionIds.has(String(session.id))),
      seriesOccurrences,
      events: eventsResult.data || [],
      overrides: overridesResult.data || [],
      registrationCounts: [...registrationCounts].map(([key, count]) => {
        const separator = key.lastIndexOf(':');
        return {
          activity_session_id: key.slice(0, separator),
          session_date: key.slice(separator + 1),
          registrations_count: count,
        };
      }),
    },
  };
}
