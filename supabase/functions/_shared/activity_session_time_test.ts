import { assert, assertEquals } from 'jsr:@std/assert@1';

import {
  activitySessionOccurrenceInterval,
  isValidActivitySessionTimeOrder,
} from './activity_session_time.ts';

Deno.test('activity session midnight ranges are next-day, Stockholm-local and half-open', () => {
  const interval = activitySessionOccurrenceInterval('2026-07-31', '16:30', '00:00');
  assert(interval);
  assertEquals(interval.start.toISO(), '2026-07-31T16:30:00.000+02:00');
  assertEquals(interval.end.toISO(), '2026-08-01T00:00:00.000+02:00');
  assertEquals(interval.durationMinutes, 450);

  const nextDayAtMidnight = activitySessionOccurrenceInterval('2026-08-01', '00:00', '01:00');
  assert(nextDayAtMidnight);
  assertEquals(interval.end.toMillis() <= nextDayAtMidnight.start.toMillis(), true);
});
Deno.test('activity session time order allows only exact-midnight rollover', () => {
  for (const start of ['16:00', '16:30', '18:00', '23:00', '23:30']) {
    assertEquals(isValidActivitySessionTimeOrder(start, '00:00'), true);
  }
  assertEquals(isValidActivitySessionTimeOrder('16:00', '23:59'), true);
  assertEquals(isValidActivitySessionTimeOrder('16:00', '22:00'), true);
  assertEquals(isValidActivitySessionTimeOrder('16:00', '16:00'), false);
  assertEquals(isValidActivitySessionTimeOrder('18:00', '17:00'), false);
});

Deno.test('activity session midnight range stays correct across Stockholm DST dates', () => {
  for (const date of ['2026-03-29', '2026-10-25']) {
    const interval = activitySessionOccurrenceInterval(date, '16:00', '00:00');
    assert(interval);
    assertEquals(interval.durationMinutes, 480);
    assertEquals(interval.start.zoneName, 'Europe/Stockholm');
    assertEquals(interval.end.zoneName, 'Europe/Stockholm');
  }
});
