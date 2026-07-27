import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const adminApi = readFileSync("supabase/functions/api-admin/index.ts", "utf8");
const bookingsApi = readFileSync("supabase/functions/api-bookings/index.ts", "utf8");
const checkinsApi = readFileSync("supabase/functions/api-checkins/index.ts", "utf8");
const publicApi = readFileSync("supabase/functions/api-event-public/index.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260727120000_activity_sessions_end_at_midnight.sql", "utf8");
const adminSchedule = readFileSync("src/components/admin/AdminSchedule.tsx", "utf8");
const adminCalendar = readFileSync("src/components/admin/shell/AdminCalendar.tsx", "utf8");

describe("activity-session midnight integration contract", () => {
  it("changes only the existing time-order constraint and keeps unrestricted overnight invalid", () => {
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS activity_sessions_time_order");
    expect(migration).toContain("end_time > start_time");
    expect(migration).toContain("end_time = TIME '00:00:00'");
    expect(migration).toContain("start_time > TIME '00:00:00'");
    expect(migration).not.toContain("ADD COLUMN");
    expect(migration).not.toContain("UPDATE public.activity_sessions");
  });

  it("validates create and edit through the canonical API interval rule", () => {
    expect(adminApi).toContain("isValidActivitySessionTimeOrder(draft.start_time, draft.end_time)");
    expect(adminApi.match(/isValidActivitySessionTimeOrder\(draft\.start_time, draft\.end_time\)/g)).toHaveLength(2);
    expect(adminApi).toContain("activitySessionOccurrenceInterval(date, session.start_time, session.end_time)");
    expect(adminSchedule).toContain("isValidActivitySessionTimeOrder");
    expect(adminCalendar).toContain("isValidActivitySessionTimeOrder(activityStart, activityEnd)");
  });

  it("uses the same date-aware range for reservations, Desk and check-in", () => {
    expect(bookingsApi).toContain("activitySessionOccurrenceInterval(date, session.start_time, session.end_time)");
    expect(bookingsApi).toContain("start: interval.startISO, end: interval.endISO");
    expect(bookingsApi).toContain("activitySessionOccurrenceInterval(registration.session_date, session.start_time, session.end_time)");
    expect(checkinsApi).toContain("activitySessionOccurrenceInterval(today, session.start_time, session.end_time)");
    expect(checkinsApi).toContain("now < occurrence.end");
  });

  it("keeps the public occurrence available until the half-open midnight boundary", () => {
    expect(publicApi).toContain("activitySessionOccurrenceInterval(date.toISODate(), session.start_time, session.end_time)");
    expect(publicApi).toContain("now >= occurrence.end");
  });
});
