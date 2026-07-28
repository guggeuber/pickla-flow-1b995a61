import { DateTime } from 'https://esm.sh/luxon@3.5.0';

export const CAPACITY_TIMEZONE = 'Europe/Stockholm';
export const CAPACITY_MAX_DATE_DISTANCE_DAYS = 366;

export type CapacitySourceType =
  | 'booking'
  | 'activity_session'
  | 'resource_block'
  | 'venue_closure'
  | 'event_reservation'
  | 'free';

export type CapacityClassification =
  | 'booking'
  | 'activity'
  | 'resource_block'
  | 'closure'
  | 'event'
  | 'free';

export type CapacityResource = {
  id: string;
  name: string;
  court_number: number | null;
  sport_type: string | null;
  group: string;
};

export type CapacityOpeningHours = {
  day_of_week: number;
  open_time: string;
  close_time: string;
  is_closed?: boolean | null;
};

export type CapacityOpeningInterval = {
  id: string;
  resource_id: string;
  venue_date: string;
  starts_at: string;
  ends_at: string;
};

export type CapacityConflictPeer = {
  source_type: CapacitySourceType;
  source_id: string;
  title: string;
};

export type CapacityIntervalInput = {
  source_type: Exclude<CapacitySourceType, 'free'>;
  source_id: string;
  venue_id: string;
  resource_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  classification: Exclude<CapacityClassification, 'free'>;
  title: string;
  detail_target?: Record<string, unknown> | null;
};

export type CapacityInterval = CapacityIntervalInput & {
  id: string;
  venue_date: string;
  outside_opening_hours: boolean;
  conflict: {
    is_conflict: boolean;
    with: CapacityConflictPeer[];
  };
};

export type CapacityFreeInterval = {
  id: string;
  source_type: 'free';
  source_id: string;
  venue_id: string;
  resource_id: string;
  starts_at: string;
  ends_at: string;
  venue_date: string;
  status: 'available';
  classification: 'free';
  title: 'Ledigt';
  detail_target: null;
  outside_opening_hours: false;
  conflict: { is_conflict: false; with: [] };
};

export type CapacitySummary = {
  open_resource_minutes: number;
  occupied_resource_minutes: number;
  available_resource_minutes: number;
  utilization_percentage: number;
  conflict_count: number;
};

function cleanTime(value: unknown) {
  const time = String(value || '').slice(0, 5);
  return /^\d{2}:\d{2}$/.test(time) ? time : null;
}

function asUtcMillis(value: string) {
  const parsed = DateTime.fromISO(value, { zone: 'utc' });
  return parsed.isValid ? parsed.toMillis() : Number.NaN;
}

function overlapMillis(startA: number, endA: number, startB: number, endB: number) {
  return startA < endB && endA > startB;
}

function intervalMinutes(startMillis: number, endMillis: number) {
  return Math.max(0, Math.round((endMillis - startMillis) / 60_000));
}

export function capacityDates(fromDate: string, toDate: string, maximumDays = 7) {
  const start = DateTime.fromISO(String(fromDate || '').slice(0, 10), { zone: CAPACITY_TIMEZONE }).startOf('day');
  const end = DateTime.fromISO(String(toDate || '').slice(0, 10), { zone: CAPACITY_TIMEZONE }).startOf('day');
  if (!start.isValid || !end.isValid || end < start) return [];

  const dates: string[] = [];
  for (let cursor = start; cursor <= end && dates.length <= maximumDays; cursor = cursor.plus({ days: 1 })) {
    dates.push(cursor.toISODate()!);
  }
  return dates.length <= maximumDays ? dates : [];
}

export function capacityRangeUtc(dates: string[]) {
  if (!dates.length) return null;
  const start = DateTime.fromISO(dates[0], { zone: CAPACITY_TIMEZONE }).startOf('day');
  const end = DateTime.fromISO(dates[dates.length - 1], { zone: CAPACITY_TIMEZONE }).plus({ days: 1 }).startOf('day');
  if (!start.isValid || !end.isValid) return null;
  return { start: start.toUTC().toISO()!, end: end.toUTC().toISO()! };
}

export function capacityDatesWithinOperationalWindow(
  dates: string[],
  todayDate = DateTime.now().setZone(CAPACITY_TIMEZONE).toISODate()!,
) {
  if (!dates.length) return false;
  const today = DateTime.fromISO(todayDate, { zone: CAPACITY_TIMEZONE }).startOf('day');
  const first = DateTime.fromISO(dates[0], { zone: CAPACITY_TIMEZONE }).startOf('day');
  const last = DateTime.fromISO(dates[dates.length - 1], { zone: CAPACITY_TIMEZONE }).startOf('day');
  if (!today.isValid || !first.isValid || !last.isValid) return false;
  return first >= today.minus({ days: CAPACITY_MAX_DATE_DISTANCE_DAYS }) &&
    last <= today.plus({ days: CAPACITY_MAX_DATE_DISTANCE_DAYS });
}

export function buildOpeningIntervals(
  resources: CapacityResource[],
  dates: string[],
  hours: CapacityOpeningHours[],
): CapacityOpeningInterval[] {
  const hoursByWeekday = new Map<number, CapacityOpeningHours>();
  for (const row of hours) hoursByWeekday.set(Number(row.day_of_week), row);

  const result: CapacityOpeningInterval[] = [];
  for (const date of dates) {
    const localDate = DateTime.fromISO(date, { zone: CAPACITY_TIMEZONE });
    if (!localDate.isValid) continue;
    const row = hoursByWeekday.get(localDate.weekday % 7);
    const openTime = cleanTime(row?.open_time);
    const closeTime = cleanTime(row?.close_time);
    if (!row || row.is_closed || !openTime || !closeTime) continue;

    const start = DateTime.fromISO(`${date}T${openTime}:00`, { zone: CAPACITY_TIMEZONE });
    const endDate = closeTime === '00:00' && openTime !== '00:00'
      ? localDate.plus({ days: 1 }).toISODate()!
      : date;
    const end = DateTime.fromISO(`${endDate}T${closeTime}:00`, { zone: CAPACITY_TIMEZONE });
    if (!start.isValid || !end.isValid || end <= start) continue;

    for (const resource of resources) {
      result.push({
        id: `open:${resource.id}:${date}`,
        resource_id: resource.id,
        venue_date: date,
        starts_at: start.toUTC().toISO()!,
        ends_at: end.toUTC().toISO()!,
      });
    }
  }
  return result;
}

function splitInputsByVenueDate(inputs: CapacityIntervalInput[], dates: string[]) {
  const result: CapacityInterval[] = [];
  for (const input of inputs) {
    const inputStart = asUtcMillis(input.starts_at);
    const inputEnd = asUtcMillis(input.ends_at);
    if (!Number.isFinite(inputStart) || !Number.isFinite(inputEnd) || inputEnd <= inputStart) continue;

    for (const date of dates) {
      const dayStart = DateTime.fromISO(date, { zone: CAPACITY_TIMEZONE }).startOf('day');
      const dayEnd = dayStart.plus({ days: 1 });
      const clippedStart = Math.max(inputStart, dayStart.toUTC().toMillis());
      const clippedEnd = Math.min(inputEnd, dayEnd.toUTC().toMillis());
      if (clippedEnd <= clippedStart) continue;

      result.push({
        ...input,
        id: `${input.source_type}:${input.source_id}:${input.resource_id}:${date}`,
        starts_at: DateTime.fromMillis(clippedStart, { zone: 'utc' }).toISO()!,
        ends_at: DateTime.fromMillis(clippedEnd, { zone: 'utc' }).toISO()!,
        venue_date: date,
        outside_opening_hours: false,
        conflict: { is_conflict: false, with: [] },
      });
    }
  }
  return result;
}

function groupedIntervals<T extends { resource_id: string; venue_date: string }>(rows: T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = `${row.resource_id}:${row.venue_date}`;
    const current = groups.get(key) || [];
    current.push(row);
    groups.set(key, current);
  }
  return groups;
}

function mergedRanges(rows: Array<{ starts_at: string; ends_at: string }>, clipStart: number, clipEnd: number) {
  const ranges = rows
    .map((row) => ({ start: Math.max(asUtcMillis(row.starts_at), clipStart), end: Math.min(asUtcMillis(row.ends_at), clipEnd) }))
    .filter((row) => Number.isFinite(row.start) && Number.isFinite(row.end) && row.end > row.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

function markConflicts(intervals: CapacityInterval[]) {
  const groups = groupedIntervals(intervals);
  let conflictCount = 0;

  for (const rows of groups.values()) {
    rows.sort((a, b) => asUtcMillis(a.starts_at) - asUtcMillis(b.starts_at) || asUtcMillis(a.ends_at) - asUtcMillis(b.ends_at) || a.id.localeCompare(b.id));
    let component: CapacityInterval[] = [];
    let componentEnd = Number.NEGATIVE_INFINITY;

    const closeComponent = () => {
      const canonicalSources = new Set(component.map((row) => `${row.source_type}:${row.source_id}`));
      if (component.length > 1 && canonicalSources.size > 1) {
        conflictCount += 1;
        for (const row of component) {
          const peers = component
            .filter((peer) => peer.id !== row.id && `${peer.source_type}:${peer.source_id}` !== `${row.source_type}:${row.source_id}`)
            .filter((peer) => overlapMillis(asUtcMillis(row.starts_at), asUtcMillis(row.ends_at), asUtcMillis(peer.starts_at), asUtcMillis(peer.ends_at)))
            .map((peer) => ({ source_type: peer.source_type, source_id: peer.source_id, title: peer.title }));
          if (peers.length) row.conflict = { is_conflict: true, with: peers };
        }
      }
      component = [];
      componentEnd = Number.NEGATIVE_INFINITY;
    };

    for (const row of rows) {
      const start = asUtcMillis(row.starts_at);
      const end = asUtcMillis(row.ends_at);
      if (component.length && start >= componentEnd) closeComponent();
      component.push(row);
      componentEnd = Math.max(componentEnd, end);
    }
    if (component.length) closeComponent();
  }

  return conflictCount;
}

export function buildCapacityProjection(
  resources: CapacityResource[],
  dates: string[],
  openingIntervals: CapacityOpeningInterval[],
  inputs: CapacityIntervalInput[],
  venueId = '',
) {
  const resourceIds = new Set(resources.map((resource) => resource.id));
  const intervals = splitInputsByVenueDate(
    inputs.filter((input) => resourceIds.has(input.resource_id)),
    dates,
  );
  const openingsByGroup = groupedIntervals(openingIntervals);
  const occupancyByGroup = groupedIntervals(intervals);

  for (const interval of intervals) {
    const openings = openingsByGroup.get(`${interval.resource_id}:${interval.venue_date}`) || [];
    const start = asUtcMillis(interval.starts_at);
    const end = asUtcMillis(interval.ends_at);
    interval.outside_opening_hours = !openings.some((opening) =>
      overlapMillis(start, end, asUtcMillis(opening.starts_at), asUtcMillis(opening.ends_at))
    );
  }

  const conflictCount = markConflicts(intervals);
  const freeIntervals: CapacityFreeInterval[] = [];
  let openMinutes = 0;
  let occupiedMinutes = 0;

  for (const opening of openingIntervals) {
    const openStart = asUtcMillis(opening.starts_at);
    const openEnd = asUtcMillis(opening.ends_at);
    openMinutes += intervalMinutes(openStart, openEnd);
    const occupied = mergedRanges(
      occupancyByGroup.get(`${opening.resource_id}:${opening.venue_date}`) || [],
      openStart,
      openEnd,
    );
    occupiedMinutes += occupied.reduce((sum, range) => sum + intervalMinutes(range.start, range.end), 0);

    let cursor = openStart;
    for (const range of occupied) {
      if (range.start > cursor) {
        freeIntervals.push(makeFreeInterval(opening, cursor, range.start, venueId));
      }
      cursor = Math.max(cursor, range.end);
    }
    if (cursor < openEnd) freeIntervals.push(makeFreeInterval(opening, cursor, openEnd, venueId));
  }

  const availableMinutes = Math.max(0, openMinutes - occupiedMinutes);
  const summary: CapacitySummary = {
    open_resource_minutes: openMinutes,
    occupied_resource_minutes: occupiedMinutes,
    available_resource_minutes: availableMinutes,
    utilization_percentage: openMinutes > 0 ? Math.round((occupiedMinutes / openMinutes) * 1000) / 10 : 0,
    conflict_count: conflictCount,
  };

  return {
    intervals: [...intervals, ...freeIntervals].sort((a, b) =>
      a.venue_date.localeCompare(b.venue_date) ||
      a.resource_id.localeCompare(b.resource_id) ||
      asUtcMillis(a.starts_at) - asUtcMillis(b.starts_at) ||
      a.id.localeCompare(b.id)
    ),
    summary,
  };
}

function makeFreeInterval(opening: CapacityOpeningInterval, start: number, end: number, venueId: string): CapacityFreeInterval {
  const startsAt = DateTime.fromMillis(start, { zone: 'utc' }).toISO()!;
  const endsAt = DateTime.fromMillis(end, { zone: 'utc' }).toISO()!;
  return {
    id: `free:${opening.resource_id}:${opening.venue_date}:${startsAt}`,
    source_type: 'free',
    source_id: opening.id,
    venue_id: venueId,
    resource_id: opening.resource_id,
    starts_at: startsAt,
    ends_at: endsAt,
    venue_date: opening.venue_date,
    status: 'available',
    classification: 'free',
    title: 'Ledigt',
    detail_target: null,
    outside_opening_hours: false,
    conflict: { is_conflict: false, with: [] },
  };
}
