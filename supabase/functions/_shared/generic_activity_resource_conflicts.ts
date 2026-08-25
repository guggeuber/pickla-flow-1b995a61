export type GenericActivitySession = {
  id?: string | null;
  name?: string | null;
  session_date?: string | null;
  recurrence_days?: number[] | null;
  start_time?: string | null;
  end_time?: string | null;
  court_ids?: string[] | null;
  is_active?: boolean | null;
  publish_status?: string | null;
};

export type GenericActivityResourceConflict = {
  resource_id: string;
  resource_name: string;
  owner_id: string;
  owner_name: string;
  session_date: string;
  start_time: string;
  end_time: string;
};

function cleanDate(value: unknown) {
  const date = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function cleanTime(value: unknown) {
  const time = String(value || '').slice(0, 5);
  return /^\d{2}:\d{2}$/.test(time) ? time : null;
}

function timeMinutes(value: string, end = false) {
  const [hours, minutes] = value.split(':').map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  if (end && hours === 0 && minutes === 0) return 24 * 60;
  return hours * 60 + minutes;
}

function dateParts(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
}

function plusCalendarDays(value: string, days: number) {
  const { year, month, day } = dateParts(value);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function calendarWeekday(value: string) {
  const { year, month, day } = dateParts(value);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function genericActivityOccursOnDate(session: GenericActivitySession, dateValue: string) {
  const date = cleanDate(dateValue);
  if (!date) return false;
  const sessionDate = cleanDate(session.session_date);
  if (sessionDate) return sessionDate === date;
  const recurrenceDays = Array.isArray(session.recurrence_days) ? session.recurrence_days : [];
  return recurrenceDays.includes(calendarWeekday(date));
}

export function nextSharedGenericActivityDate(
  candidate: GenericActivitySession,
  owner: GenericActivitySession,
  fromDateValue: string,
) {
  const fromDate = cleanDate(fromDateValue);
  if (!fromDate) return null;
  const candidateDate = cleanDate(candidate.session_date);
  const ownerDate = cleanDate(owner.session_date);

  if (candidateDate) {
    return genericActivityOccursOnDate(owner, candidateDate) ? candidateDate : null;
  }
  if (ownerDate) {
    return ownerDate >= fromDate && genericActivityOccursOnDate(candidate, ownerDate) ? ownerDate : null;
  }

  // Indefinite recurring activity rows repeat weekly in the existing schedule
  // contract, so one seven-day scan is a complete bounded intersection test.
  for (let offset = 0; offset < 7; offset += 1) {
    const date = plusCalendarDays(fromDate, offset);
    if (genericActivityOccursOnDate(candidate, date) && genericActivityOccursOnDate(owner, date)) return date;
  }
  return null;
}

export function genericActivityTimesOverlap(candidate: GenericActivitySession, owner: GenericActivitySession) {
  const candidateStart = cleanTime(candidate.start_time);
  const candidateEnd = cleanTime(candidate.end_time);
  const ownerStart = cleanTime(owner.start_time);
  const ownerEnd = cleanTime(owner.end_time);
  if (!candidateStart || !candidateEnd || !ownerStart || !ownerEnd) return false;

  const candidateStartMinutes = timeMinutes(candidateStart);
  const candidateEndMinutes = timeMinutes(candidateEnd, true);
  const ownerStartMinutes = timeMinutes(ownerStart);
  const ownerEndMinutes = timeMinutes(ownerEnd, true);
  if (candidateStartMinutes == null || candidateEndMinutes == null || ownerStartMinutes == null || ownerEndMinutes == null) {
    return false;
  }
  return candidateStartMinutes < ownerEndMinutes && candidateEndMinutes > ownerStartMinutes;
}

export function findGenericActivityResourceConflict({
  candidate,
  owners,
  courtNames,
  fromDate,
  selfSessionId,
}: {
  candidate: GenericActivitySession;
  owners: GenericActivitySession[];
  courtNames: Record<string, string>;
  fromDate: string;
  selfSessionId?: string | null;
}): GenericActivityResourceConflict | null {
  const selectedCourts = new Set((candidate.court_ids || []).map(String));
  if (!selectedCourts.size) return null;

  for (const owner of owners) {
    if (selfSessionId && owner.id === selfSessionId) continue;
    if (owner.is_active === false || String(owner.publish_status || 'published') !== 'published') continue;
    const resourceId = (owner.court_ids || []).map(String).find((courtId) => selectedCourts.has(courtId));
    if (!resourceId) continue;
    const sessionDate = nextSharedGenericActivityDate(candidate, owner, fromDate);
    if (!sessionDate || !genericActivityTimesOverlap(candidate, owner)) continue;

    return {
      resource_id: resourceId,
      resource_name: courtNames[resourceId] || 'Vald bana',
      owner_id: String(owner.id || ''),
      owner_name: String(owner.name || 'Aktivitet'),
      session_date: sessionDate,
      start_time: cleanTime(owner.start_time) || '',
      end_time: cleanTime(owner.end_time) || '',
    };
  }
  return null;
}
