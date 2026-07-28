import { assert, assertEquals } from 'jsr:@std/assert@1';
import { DateTime } from 'https://esm.sh/luxon@3.5.0';

import {
  buildCapacityProjection,
  buildOpeningIntervals,
  capacityDates,
  capacityDatesWithinOperationalWindow,
  capacityRangeUtc,
  type CapacityIntervalInput,
  type CapacityOpeningHours,
  type CapacityResource,
} from './capacity.ts';

const venueId = 'venue-1';
const resources: CapacityResource[] = [
  { id: 'court-1', name: 'Bana 1', court_number: 1, sport_type: 'pickleball', group: 'pickleball' },
  { id: 'court-2', name: 'Bana 2', court_number: 2, sport_type: 'pickleball', group: 'pickleball' },
];

function localIso(date: string, time: string) {
  return DateTime.fromISO(`${date}T${time}:00`, { zone: 'Europe/Stockholm' }).toUTC().toISO()!;
}

function hoursFor(date: string, open = '10:00', close = '12:00'): CapacityOpeningHours[] {
  return [{
    day_of_week: DateTime.fromISO(date, { zone: 'Europe/Stockholm' }).weekday % 7,
    open_time: open,
    close_time: close,
    is_closed: false,
  }];
}

function interval(
  sourceId: string,
  resourceId: string,
  date: string,
  start: string,
  end: string,
  overrides: Partial<CapacityIntervalInput> = {},
): CapacityIntervalInput {
  return {
    source_type: 'booking',
    source_id: sourceId,
    venue_id: venueId,
    resource_id: resourceId,
    starts_at: localIso(date, start),
    ends_at: end === '24:00'
      ? DateTime.fromISO(date, { zone: 'Europe/Stockholm' }).plus({ days: 1 }).startOf('day').toUTC().toISO()!
      : localIso(date, end),
    status: 'confirmed',
    classification: 'booking',
    title: sourceId,
    detail_target: { kind: 'booking_drawer' },
    ...overrides,
  };
}

function projection(date: string, inputs: CapacityIntervalInput[], selectedResources = resources, open = '10:00', close = '12:00') {
  const dates = [date];
  const openings = buildOpeningIntervals(selectedResources, dates, hoursFor(date, open, close));
  return { openings, ...buildCapacityProjection(selectedResources, dates, openings, inputs, venueId) };
}

Deno.test('empty venue capacity is fully free across every active resource', () => {
  const result = projection('2026-07-28', []);
  assertEquals(result.summary.open_resource_minutes, 240);
  assertEquals(result.summary.occupied_resource_minutes, 0);
  assertEquals(result.summary.available_resource_minutes, 240);
  assertEquals(result.summary.utilization_percentage, 0);
  assertEquals(result.intervals.filter((row) => row.classification === 'free').length, 2);
});

Deno.test('one booking consumes only its court and keeps the other court free', () => {
  const result = projection('2026-07-28', [interval('booking-1', 'court-1', '2026-07-28', '10:30', '11:30')]);
  assertEquals(result.summary.occupied_resource_minutes, 60);
  assertEquals(result.summary.available_resource_minutes, 180);
  assertEquals(result.summary.utilization_percentage, 25);
  const courtTwoFree = result.intervals.filter((row) => row.resource_id === 'court-2' && row.classification === 'free');
  assertEquals(courtTwoFree.length, 1);
  assertEquals(courtTwoFree[0].venue_id, venueId);
});

Deno.test('separate bookings and half-open boundaries do not create conflicts', () => {
  const result = projection('2026-07-28', [
    interval('booking-1', 'court-1', '2026-07-28', '10:00', '11:00'),
    interval('booking-2', 'court-1', '2026-07-28', '11:00', '12:00'),
  ]);
  assertEquals(result.summary.occupied_resource_minutes, 120);
  assertEquals(result.summary.conflict_count, 0);
  assertEquals(result.intervals.some((row) => row.conflict.is_conflict), false);
});

Deno.test('a multi-resource activity consumes one interval per selected court', () => {
  const activity = (courtId: string) => interval('activity-1', courtId, '2026-07-28', '10:00', '11:00', {
    source_type: 'activity_session',
    classification: 'activity',
    title: 'Open Play',
  });
  const result = projection('2026-07-28', [activity('court-1'), activity('court-2')]);
  assertEquals(result.summary.occupied_resource_minutes, 120);
  assertEquals(result.intervals.filter((row) => row.classification === 'activity').length, 2);
});

Deno.test('court-scoped block consumes only the explicitly selected court', () => {
  const result = projection('2026-07-28', [interval('block-1', 'court-1', '2026-07-28', '10:00', '12:00', {
    source_type: 'resource_block',
    classification: 'resource_block',
    title: 'Turnering',
  })]);
  assertEquals(result.summary.occupied_resource_minutes, 120);
  assertEquals(result.intervals.filter((row) => row.resource_id === 'court-2' && row.classification === 'free').length, 1);
});

Deno.test('venue closure rows can occupy each active court without double-counting overlaps', () => {
  const closure = (courtId: string) => interval('closure-1', courtId, '2026-07-28', '10:00', '12:00', {
    source_type: 'venue_closure',
    classification: 'closure',
    title: 'Stängt',
  });
  const result = projection('2026-07-28', [closure('court-1'), closure('court-2')]);
  assertEquals(result.summary.occupied_resource_minutes, 240);
  assertEquals(result.summary.available_resource_minutes, 0);
});

Deno.test('outside-opening occupancy is visible but excluded from capacity totals', () => {
  const result = projection('2026-07-28', [interval('booking-early', 'court-1', '2026-07-28', '08:00', '09:00')]);
  assertEquals(result.summary.occupied_resource_minutes, 0);
  const booking = result.intervals.find((row) => row.source_id === 'booking-early');
  assert(booking);
  assertEquals(booking.outside_opening_hours, true);
});

Deno.test('overlap marks deterministic conflicts while utilization uses the occupied union', () => {
  const result = projection('2026-07-28', [
    interval('booking-1', 'court-1', '2026-07-28', '10:00', '11:00'),
    interval('activity-1', 'court-1', '2026-07-28', '10:30', '11:30', {
      source_type: 'activity_session',
      classification: 'activity',
    }),
  ]);
  assertEquals(result.summary.conflict_count, 1);
  assertEquals(result.summary.occupied_resource_minutes, 90);
  assertEquals(result.intervals.filter((row) => row.conflict.is_conflict).length, 2);
});

Deno.test('three mutually connected overlaps are one conflict group, not three conflicts', () => {
  const result = projection('2026-07-28', [
    interval('booking-1', 'court-1', '2026-07-28', '10:00', '11:00'),
    interval('activity-1', 'court-1', '2026-07-28', '10:30', '11:30', { source_type: 'activity_session', classification: 'activity' }),
    interval('block-1', 'court-1', '2026-07-28', '10:45', '12:00', { source_type: 'resource_block', classification: 'resource_block' }),
  ]);
  assertEquals(result.summary.conflict_count, 1);
  assertEquals(result.summary.occupied_resource_minutes, 120);
});

Deno.test('event reservations conflict with activities only on their common court', () => {
  const result = projection('2026-07-28', [
    interval('event-1', 'court-1', '2026-07-28', '10:00', '11:30', { source_type: 'event_reservation', classification: 'event' }),
    interval('activity-1', 'court-1', '2026-07-28', '11:00', '12:00', { source_type: 'activity_session', classification: 'activity' }),
    interval('booking-2', 'court-2', '2026-07-28', '11:00', '12:00'),
  ]);
  assertEquals(result.summary.conflict_count, 1);
  assertEquals(result.intervals.find((row) => row.source_id === 'booking-2')?.conflict.is_conflict, false);
});

Deno.test('opening through midnight includes 23:00–00:00 and excludes time after midnight', () => {
  const result = projection('2026-07-28', [interval('late', 'court-1', '2026-07-28', '23:00', '24:00')], resources, '10:00', '00:00');
  assertEquals(result.summary.open_resource_minutes, 28 * 60);
  assertEquals(result.summary.occupied_resource_minutes, 60);
  assertEquals(result.openings[0].ends_at, localIso('2026-07-29', '00:00'));
});

Deno.test('cross-midnight intervals split into the selected venue dates', () => {
  const dates = ['2026-07-28', '2026-07-29'];
  const allDayHours = dates.map((date) => hoursFor(date, '00:00', '23:59')[0]);
  const openings = buildOpeningIntervals([resources[0]], dates, allDayHours);
  const crossMidnight = interval('late', 'court-1', '2026-07-28', '23:30', '24:00');
  crossMidnight.ends_at = localIso('2026-07-29', '00:30');
  const result = buildCapacityProjection([resources[0]], dates, openings, [crossMidnight], venueId);
  assertEquals(result.intervals.filter((row) => row.source_id === 'late').map((row) => row.venue_date), dates);
});

Deno.test('day and week ranges are venue-local, bounded and half-open in UTC', () => {
  assertEquals(capacityDates('2026-07-28', '2026-07-28'), ['2026-07-28']);
  assertEquals(capacityDates('2026-07-28', '2026-08-03').length, 7);
  assertEquals(capacityDates('2026-07-28', '2026-08-04'), []);
  assertEquals(capacityDates('2026-02-31', '2026-02-31'), []);
  assertEquals(capacityDates('2026-07-29', '2026-07-28'), []);
  const range = capacityRangeUtc(['2026-07-28', '2026-07-29']);
  assert(range);
  assertEquals(range.start, localIso('2026-07-28', '00:00'));
  assertEquals(range.end, localIso('2026-07-30', '00:00'));
});

Deno.test('capacity dates stay inside the explicit operational horizon', () => {
  assertEquals(capacityDatesWithinOperationalWindow(['2025-07-27'], '2026-07-28'), true);
  assertEquals(capacityDatesWithinOperationalWindow(['2025-07-26'], '2026-07-28'), false);
  assertEquals(capacityDatesWithinOperationalWindow(['2027-07-29'], '2026-07-28'), true);
  assertEquals(capacityDatesWithinOperationalWindow(['2027-07-30'], '2026-07-28'), false);
});

Deno.test('Stockholm DST changes real open resource minutes without changing local boundaries', () => {
  const springDate = '2026-03-29';
  const fallDate = '2026-10-25';
  const spring = buildOpeningIntervals([resources[0]], [springDate], hoursFor(springDate, '00:00', '04:00'));
  const fall = buildOpeningIntervals([resources[0]], [fallDate], hoursFor(fallDate, '00:00', '04:00'));
  const springProjection = buildCapacityProjection([resources[0]], [springDate], spring, [], venueId);
  const fallProjection = buildCapacityProjection([resources[0]], [fallDate], fall, [], venueId);
  assertEquals(springProjection.summary.open_resource_minutes, 180);
  assertEquals(fallProjection.summary.open_resource_minutes, 300);
});

Deno.test('safe detail targets and canonical source references survive normalization', () => {
  const input = interval('booking-1', 'court-1', '2026-07-28', '10:00', '11:00', {
    detail_target: { kind: 'booking_drawer', booking: { source_ids: ['booking-1'] } },
  });
  const result = projection('2026-07-28', [input]);
  const normalized = result.intervals.find((row) => row.source_id === 'booking-1');
  assert(normalized);
  assertEquals(normalized.source_type, 'booking');
  assertEquals(normalized.detail_target, input.detail_target);
});
