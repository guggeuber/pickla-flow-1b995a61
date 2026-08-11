import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { findFirstAvailableBookingOption, type CourtAvailabilityBlock } from "@/lib/bookingAvailability";

const bookingPage = readFileSync("src/pages/BookingPage.tsx", "utf8");
const todayPage = readFileSync("src/pages/TodayPage.tsx", "utf8");
const openPlayPage = readFileSync("src/pages/OpenPlayPage.tsx", "utf8");

const resources = [
  { id: "pickle-1", sport_type: "pickleball" },
  { id: "pickle-2", sport_type: "pickleball" },
  { id: "dart-1", sport_type: "dart" },
  { id: "dart-2", sport_type: "dart" },
];

const slots = ["09:00", "10:00", "11:00", "12:00"];

function block(courtId: string, date: string, start: string, end: string): CourtAvailabilityBlock {
  return {
    court_id: courtId,
    start: `${date}T${start}:00+02:00`,
    end: `${date}T${end}:00+02:00`,
  };
}

function resolve(
  date: string,
  resourceType: "pickleball" | "dart",
  durationMinutes: number,
  blocks: CourtAvailabilityBlock[],
) {
  return findFirstAvailableBookingOption({
    date,
    resourceType,
    durationMinutes,
    timeSlots: slots,
    resources,
    blocks,
    openTime: "09:00",
    closeTime: "14:00",
  });
}

describe("private resource booking projection", () => {
  it("keeps joinable shared bookings in discovery surfaces only", () => {
    expect(bookingPage).not.toContain("public-open-bookings");
    expect(bookingPage).not.toContain("openBookingToPresentation");
    expect(bookingPage).not.toContain("SessionScheduleRow");
    expect(bookingPage).not.toContain('label: "Häng på"');

    for (const discoverySource of [todayPage, openPlayPage]) {
      expect(discoverySource).toContain("public-open-bookings");
      expect(discoverySource).toContain("openBookingToPresentation");
      expect(discoverySource).toContain("SessionScheduleRow");
    }
  });

  it("re-resolves pickleball independently for today, tomorrow, later and back", () => {
    const today = "2026-08-11";
    const tomorrow = "2026-08-12";
    const later = "2026-08-14";
    const todayBlocks = [
      block("pickle-1", today, "09:00", "11:00"),
      block("pickle-2", today, "09:00", "11:00"),
    ];
    const tomorrowBlocks = [block("pickle-1", tomorrow, "09:00", "10:00")];

    expect(resolve(today, "pickleball", 60, todayBlocks)).toMatchObject({ startTime: "11:00", resourceId: "pickle-1" });
    expect(resolve(tomorrow, "pickleball", 60, tomorrowBlocks)).toMatchObject({ startTime: "09:00", resourceId: "pickle-2" });
    expect(resolve(later, "pickleball", 60, [])).toMatchObject({ startTime: "09:00", resourceId: "pickle-1" });
    expect(resolve(today, "pickleball", 60, todayBlocks)).toMatchObject({ startTime: "11:00", resourceId: "pickle-1" });
  });

  it("re-resolves the first pickleball option for 60, 90 and 120 minutes", () => {
    const date = "2026-08-14";
    const blocks = [
      block("pickle-1", date, "09:30", "10:30"),
      block("pickle-1", date, "12:30", "13:30"),
      block("pickle-2", date, "10:00", "11:30"),
    ];

    expect(resolve(date, "pickleball", 60, blocks)).toMatchObject({ startTime: "09:00", resourceId: "pickle-2" });
    expect(resolve(date, "pickleball", 90, blocks)).toMatchObject({ startTime: "11:00", resourceId: "pickle-1" });
    expect(resolve(date, "pickleball", 120, blocks)).toMatchObject({ startTime: "12:00", resourceId: "pickle-2" });
  });

  it("uses only dart resources and re-resolves them per date", () => {
    const today = "2026-08-11";
    const later = "2026-08-14";
    const todayBlocks = [
      block("dart-1", today, "09:00", "12:00"),
      block("dart-2", today, "09:00", "12:00"),
    ];
    const laterBlocks = [block("dart-1", later, "09:00", "11:00")];

    expect(resolve(today, "dart", 60, todayBlocks)).toMatchObject({ startTime: "12:00", resourceId: "dart-1" });
    expect(resolve(later, "dart", 60, laterBlocks)).toMatchObject({ startTime: "09:00", resourceId: "dart-2" });
  });

  it("invalidates selected time and resource at every availability boundary", () => {
    expect(bookingPage).toMatch(/setSportFilter\(requestedSport\);\s*setSelectedTime\(null\);\s*setSelectedCourts\(\[\]\);/);
    expect(bookingPage).toMatch(/setSelectedDate\(date\);\s*setSelectedTime\(null\);\s*setSelectedCourts\(\[\]\);/);
    expect(bookingPage).toMatch(/setSelectedDuration\(duration\);\s*setSelectedTime\(null\);\s*setSelectedCourts\(\[\]\);/);
    expect(bookingPage).toContain("[requestedSport, slug]");
    expect(bookingPage).toContain("[slug, dateStr, selectedDuration, sportFilter");
  });
});
