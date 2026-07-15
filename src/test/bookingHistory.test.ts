import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";

import {
  bookingHasConversation,
  buildBookingHistory,
  formatBookingHistoryTime,
  getBookingHistoryStatus,
} from "@/lib/bookingHistory";

const NOW = DateTime.fromISO("2026-07-15T12:00:00Z").toMillis();

function booking(overrides: Record<string, unknown>) {
  return {
    id: String(overrides.id),
    booking_ref: String(overrides.id),
    status: "confirmed",
    start_time: "2026-07-15T13:00:00Z",
    end_time: "2026-07-15T14:00:00Z",
    venue_courts: { name: "Bana 1" },
    ...overrides,
  };
}

describe("booking history", () => {
  it("derives the three customer-facing statuses from one grouped source", () => {
    const rows = [
      booking({ id: "upcoming", start_time: "2026-07-16T13:00:00Z", end_time: "2026-07-16T14:00:00Z" }),
      booking({ id: "completed", start_time: "2026-07-14T13:00:00Z", end_time: "2026-07-14T14:00:00Z" }),
      booking({ id: "cancelled", status: "cancelled", start_time: "2026-07-17T13:00:00Z", end_time: "2026-07-17T14:00:00Z" }),
    ];

    const history = buildBookingHistory(rows, NOW);

    expect(history.map((item) => [item.booking_ref, item.history_status])).toEqual([
      ["upcoming", "upcoming"],
      ["cancelled", "cancelled"],
      ["completed", "completed"],
    ]);
  });

  it("always treats a cancelled booking as cancelled regardless of its date", () => {
    expect(getBookingHistoryStatus(booking({ id: "past-cancelled", status: "cancelled", end_time: "2026-07-01T14:00:00Z" }), NOW)).toBe("cancelled");
    expect(getBookingHistoryStatus(booking({ id: "future-cancelled", status: "cancelled", end_time: "2026-08-01T14:00:00Z" }), NOW)).toBe("cancelled");
  });

  it("formats the same Stockholm-local timestamp for every booking-history surface", () => {
    expect(formatBookingHistoryTime(booking({
      id: "formatted",
      start_time: "2026-07-16T13:00:00Z",
      end_time: "2026-07-16T14:00:00Z",
    }))).toBe("tors 16 juli 15:00–16:00");
  });

  it("keeps the complete history continuous with upcoming first and past newest-first", () => {
    const history = buildBookingHistory([
      booking({ id: "past-old", start_time: "2026-07-10T13:00:00Z", end_time: "2026-07-10T14:00:00Z" }),
      booking({ id: "future-later", start_time: "2026-07-20T13:00:00Z", end_time: "2026-07-20T14:00:00Z" }),
      booking({ id: "past-new", start_time: "2026-07-14T13:00:00Z", end_time: "2026-07-14T14:00:00Z" }),
      booking({ id: "future-sooner", start_time: "2026-07-16T13:00:00Z", end_time: "2026-07-16T14:00:00Z" }),
    ], NOW);

    expect(history.map((item) => item.booking_ref)).toEqual([
      "future-sooner",
      "future-later",
      "past-new",
      "past-old",
    ]);
  });

  it("matches conversations only to the corresponding booking resource", () => {
    const groupedBooking = buildBookingHistory([
      booking({ id: "row-1", stripe_session_id: "cs_prod_exact", booking_ref: "BOOK-1" }),
    ], NOW)[0];

    expect(bookingHasConversation(groupedBooking, [
      { room_type: "booking", resource_id: "stripe:cs_prod_exact" },
    ])).toBe(true);
    expect(bookingHasConversation(groupedBooking, [
      { room_type: "booking", resource_id: "stripe:another-session" },
      { room_type: "event", resource_id: "stripe:cs_prod_exact" },
    ])).toBe(false);
  });
});
