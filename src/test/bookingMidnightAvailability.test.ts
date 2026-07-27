import { describe, expect, it } from "vitest";

import {
  bookingDurationFits,
  courtIsAvailableForInterval,
  generateBookingTimeSlots,
} from "@/lib/bookingAvailability";

describe("booking availability through midnight", () => {
  it("generates valid hourly slots from 10:00 until midnight", () => {
    const slots = generateBookingTimeSlots("10:00", "00:00");

    expect(slots).toHaveLength(14);
    expect(slots[0]).toBe("10:00");
    expect(slots.at(-1)).toBe("23:00");
  });

  it("allows 60, 90 and 120 minute bookings only when they end by midnight", () => {
    expect(bookingDurationFits("23:00", 60, "10:00", "00:00")).toBe(true);
    expect(bookingDurationFits("22:00", 90, "10:00", "00:00")).toBe(true);
    expect(bookingDurationFits("22:00", 120, "10:00", "00:00")).toBe(true);

    expect(bookingDurationFits("23:00", 90, "10:00", "00:00")).toBe(false);
    expect(bookingDurationFits("23:00", 120, "10:00", "00:00")).toBe(false);
  });

  it("keeps a block scoped to its court", () => {
    const blocks = [{
      court_id: "court-a",
      start: "2026-07-24T18:00:00+02:00",
      end: "2026-07-24T20:00:00+02:00",
    }];
    const startMs = new Date("2026-07-24T18:00:00+02:00").getTime();
    const endMs = new Date("2026-07-24T19:00:00+02:00").getTime();

    expect(courtIsAvailableForInterval("court-a", blocks, startMs, endMs)).toBe(false);
    expect(courtIsAvailableForInterval("court-b", blocks, startMs, endMs)).toBe(true);
  });

  it("keeps combined activity and resource blocks court-specific", () => {
    const blocks = [
      {
        court_id: "court-a",
        start: "2026-07-24T18:00:00+02:00",
        end: "2026-07-24T20:00:00+02:00",
      },
      {
        court_id: "court-b",
        start: "2026-07-24T18:00:00+02:00",
        end: "2026-07-24T20:00:00+02:00",
      },
    ];
    const startMs = new Date("2026-07-24T18:30:00+02:00").getTime();
    const endMs = new Date("2026-07-24T19:30:00+02:00").getTime();

    expect(courtIsAvailableForInterval("court-a", blocks, startMs, endMs)).toBe(false);
    expect(courtIsAvailableForInterval("court-b", blocks, startMs, endMs)).toBe(false);
    expect(courtIsAvailableForInterval("court-c", blocks, startMs, endMs)).toBe(true);
  });

  it("keeps 23:59 inside the interval and midnight outside without a new interval", () => {
    expect(bookingDurationFits("23:59", 1, "10:00", "00:00")).toBe(true);
    expect(bookingDurationFits("00:00", 1, "10:00", "00:00")).toBe(false);
    expect(bookingDurationFits("00:00", 1, "00:00", "02:00")).toBe(true);
  });
});
