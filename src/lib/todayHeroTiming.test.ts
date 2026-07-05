import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { getTodayHeroTiming, STOCKHOLM_ZONE } from "./todayHeroTiming";

const now = DateTime.fromISO("2026-06-17T12:00:00", { zone: STOCKHOLM_ZONE });

describe("getTodayHeroTiming", () => {
  it("labels today's sessions before 16:00 as IDAG", () => {
    expect(
      getTodayHeroTiming({
        sessionDate: "2026-06-17",
        startTime: "15:59",
        endTime: "17:00",
        now,
      })
    ).toEqual({ eyebrow: "IDAG", subtitle: "15:59–17:00" });
  });

  it("labels today's sessions at 16:00 as IKVÄLL", () => {
    expect(
      getTodayHeroTiming({
        sessionDate: "2026-06-17",
        startTime: "16:00",
        endTime: "18:00",
        now,
      })
    ).toEqual({ eyebrow: "IKVÄLL", subtitle: "16:00–18:00" });
  });

  it("labels rollover sessions as IMORGON without repeating the day word in the subtitle", () => {
    expect(
      getTodayHeroTiming({
        sessionDate: "2026-06-18",
        startTime: "10:00",
        endTime: "12:00",
        now,
      })
    ).toEqual({ eyebrow: "IMORGON", subtitle: "10:00–12:00" });
  });

  it("shows minutes when today's session starts within one hour", () => {
    expect(
      getTodayHeroTiming({
        sessionDate: "2026-06-17",
        startTime: "12:45",
        endTime: "14:00",
        now,
      })
    ).toEqual({ eyebrow: "IDAG", subtitle: "12:45–14:00 · om 45 min" });
  });

  it("shows hours when today's session starts within three hours", () => {
    expect(
      getTodayHeroTiming({
        sessionDate: "2026-06-17",
        startTime: "14:15",
        endTime: "16:00",
        now,
      })
    ).toEqual({ eyebrow: "IDAG", subtitle: "14:15–16:00 · om 3 timmar" });
  });
});
