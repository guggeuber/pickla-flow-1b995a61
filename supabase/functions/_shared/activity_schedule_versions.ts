import { genericActivityOccursOnDate, type GenericActivitySession } from './generic_activity_resource_conflicts.ts';

export type ActivityScheduleVersion = {
  id?: string;
  activity_session_id: string;
  effective_from: string;
  effective_until?: string | null;
  series_id?: string | null;
  series_start_date?: string | null;
  series_end_date?: string | null;
  series_total_sessions?: number | null;
  session_date?: string | null;
  recurrence_days?: number[] | null;
  start_time: string;
  end_time: string;
  court_ids?: string[] | null;
  is_active?: boolean | null;
  publish_status?: string | null;
};

function stockholmDateWeekday(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function addCalendarDays(value: string, days: number) {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function versionOccursWithinSeriesBounds(schedule: ActivityScheduleVersion, date: string) {
  if (!schedule.series_id) return true;
  const startDate = schedule.series_start_date?.slice(0, 10) || null;
  const endDate = schedule.series_end_date?.slice(0, 10) || null;
  if (startDate && date < startDate) return false;
  if (endDate && date > endDate) return false;
  if (!startDate || schedule.series_total_sessions == null) return true;

  const recurrenceDays = new Set((schedule.recurrence_days || []).map(Number));
  let occurrenceCount = 0;
  for (let cursor = startDate; cursor <= date; cursor = addCalendarDays(cursor, 1)) {
    if (recurrenceDays.has(stockholmDateWeekday(cursor))) occurrenceCount += 1;
  }
  return occurrenceCount <= schedule.series_total_sessions;
}

export function activityScheduleVersionsBySession(versions: ActivityScheduleVersion[]) {
  const bySession = new Map<string, ActivityScheduleVersion[]>();
  for (const version of versions || []) {
    const key = String(version.activity_session_id || '');
    if (!key) continue;
    const current = bySession.get(key) || [];
    current.push(version);
    bySession.set(key, current);
  }
  for (const rows of bySession.values()) {
    rows.sort((left, right) => String(left.effective_from).localeCompare(String(right.effective_from)));
  }
  return bySession;
}

export function effectiveActivityScheduleForDate(
  session: GenericActivitySession & Record<string, unknown>,
  date: string,
  versionsBySession: Map<string, ActivityScheduleVersion[]>,
) {
  const versions = versionsBySession.get(String(session.id || '')) || [];
  const version = versions.find((candidate) => (
    candidate.effective_from <= date
    && (!candidate.effective_until || date < candidate.effective_until)
  ));
  if (version) return { ...session, ...version, id: session.id };
  if (session.schedule_effective_from && date < String(session.schedule_effective_from).slice(0, 10)) return null;
  return session;
}

export function effectiveActivityOccurrenceForDate(
  session: GenericActivitySession & Record<string, unknown>,
  date: string,
  versionsBySession: Map<string, ActivityScheduleVersion[]>,
) {
  const effective = effectiveActivityScheduleForDate(session, date, versionsBySession);
  if (!effective || effective.is_active === false || String(effective.publish_status || 'published') !== 'published') return null;
  if (!genericActivityOccursOnDate(effective, date)) return null;
  const version = effective as ActivityScheduleVersion;
  return version.effective_from && !versionOccursWithinSeriesBounds(version, date) ? null : effective;
}
