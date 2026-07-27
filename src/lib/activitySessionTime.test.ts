import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import {
  activitySessionOccurrenceInterval,
  isValidActivitySessionTimeOrder,
} from "@/lib/activitySessionTime";
import {
  activityCheckInAvailable,
  activityTimingStatus,
} from "@/lib/activityTiming";
import { activitySessionToPresentation } from "@/lib/sessionPresentation";

describe("activity sessions ending at midnight", () => {
  it.each([
    ["16:00", 480],
    ["16:30", 450],
    ["18:00", 360],
    ["23:00", 60],
    ["23:30", 30],
  ])("treats %s–00:00 as ending on the next calendar day", (startTime, durationMinutes) => {
    const interval = activitySessionOccurrenceInterval("2026-07-31", startTime, "00:00");

    expect(interval?.start.toISODate()).toBe("2026-07-31");
    expect(interval?.end.toISODate()).toBe("2026-08-01");
    expect(interval?.end.toFormat("HH:mm")).toBe("00:00");
    expect(interval?.durationMinutes).toBe(durationMinutes);
  });

  it.each([
    ["16:00", "23:59", 479],
    ["16:00", "22:00", 360],
  ])("keeps normal same-day range %s–%s unchanged", (startTime, endTime, durationMinutes) => {
    const interval = activitySessionOccurrenceInterval("2026-07-31", startTime, endTime);

    expect(interval?.end.toISODate()).toBe("2026-07-31");
    expect(interval?.durationMinutes).toBe(durationMinutes);
  });

  it("rejects zero-duration and unrestricted overnight sessions", () => {
    expect(isValidActivitySessionTimeOrder("16:00", "16:00")).toBe(false);
    expect(isValidActivitySessionTimeOrder("18:00", "17:00")).toBe(false);
    expect(isValidActivitySessionTimeOrder("00:00", "00:00")).toBe(false);
    expect(activitySessionOccurrenceInterval("2026-07-31", "18:00", "17:00")).toBeNull();
  });

  it("uses a half-open next-day boundary for status and check-in", () => {
    const beforeMidnight = DateTime.fromISO("2026-07-31T23:59:59", { zone: "Europe/Stockholm" });
    const midnight = DateTime.fromISO("2026-08-01T00:00:00", { zone: "Europe/Stockholm" });

    expect(activityTimingStatus({
      sessionDate: "2026-07-31",
      startTime: "23:30",
      endTime: "00:00",
      now: beforeMidnight,
    }).isOngoing).toBe(true);
    expect(activityTimingStatus({
      sessionDate: "2026-07-31",
      startTime: "23:30",
      endTime: "00:00",
      now: midnight,
    }).isEnded).toBe(true);
    expect(activityCheckInAvailable({
      sessionDate: "2026-07-31",
      startTime: "23:30",
      endTime: "00:00",
      now: beforeMidnight,
    })).toBe(true);
    expect(activityCheckInAvailable({
      sessionDate: "2026-07-31",
      startTime: "23:30",
      endTime: "00:00",
      now: midnight,
    })).toBe(false);
  });

  it("projects the correct next-day endsAt while displaying 00:00", () => {
    const presentation = activitySessionToPresentation({
      id: "session-midnight",
      typeLabel: "PASS",
      title: "Midnattspass",
      sessionDate: "2026-07-31",
      startTime: "16:30",
      endTime: "00:00",
      now: DateTime.fromISO("2026-07-31T15:00:00", { zone: "Europe/Stockholm" }),
    });

    expect(DateTime.fromISO(presentation.endsAt).setZone("Europe/Stockholm").toISODate()).toBe("2026-08-01");
    expect(DateTime.fromISO(presentation.endsAt).setZone("Europe/Stockholm").toFormat("HH:mm")).toBe("00:00");
    expect(presentation.timingStatus.rangeLabel).toBe("16:30–00:00");
  });

  it.each(["2026-03-29", "2026-10-25"])("remains venue-local and DST-safe on %s", (date) => {
    const interval = activitySessionOccurrenceInterval(date, "16:00", "00:00");

    expect(interval?.start.zoneName).toBe("Europe/Stockholm");
    expect(interval?.end.zoneName).toBe("Europe/Stockholm");
    expect(interval?.durationMinutes).toBe(480);
    expect(interval?.end.toISODate()).toBe(DateTime.fromISO(date, { zone: "Europe/Stockholm" }).plus({ days: 1 }).toISODate());
  });

  it("derives each recurring occurrence from its own operational date", () => {
    const friday = activitySessionOccurrenceInterval("2026-07-31", "18:00", "00:00");
    const nextFriday = activitySessionOccurrenceInterval("2026-08-07", "18:00", "00:00");

    expect(friday?.end.toISODate()).toBe("2026-08-01");
    expect(nextFriday?.end.toISODate()).toBe("2026-08-08");
  });
});
