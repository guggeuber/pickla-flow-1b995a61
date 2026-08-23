import { describe, expect, it } from "vitest";

import { buildCustomerUpcoming } from "@/lib/customerUpcoming";
import type { MyCourseItem } from "@/lib/courses";
import type { MySessionRegistration } from "@/hooks/useMySessionRegistrations";

const now = Date.parse("2026-08-24T10:00:00Z");

describe("customer upcoming projection", () => {
  it("sorts court, activity and one Series occurrence chronologically", () => {
    const registrations = [{
      id: "registration-1", venue_id: "venue-1", activity_session_id: "open-play", session_date: "2026-08-24", user_id: "user-1",
      status: "paid", price_paid_sek: 165, stripe_session_id: "cs_1", series_commitment_id: null, created_at: null,
      activity_sessions: { id: "open-play", name: "Open Play", session_type: "open_play", session_date: "2026-08-24", start_time: "17:00", end_time: "19:00", venue_id: "venue-1", venues: { name: "Pickla Stockholm", slug: "pickla-arena-sthlm" } },
    }] satisfies MySessionRegistration[];
    const courses = [{
      commitment: { id: "commitment-1", status: "active" },
      series: { id: "parker", venue_id: "venue-1", name: "Parker", format_name: "Parker Brunch", start_date: "2026-09-05", end_date: "2026-09-05", total_sessions: 1, presentation_type: "social_event" },
      participant: { kind: "customer" },
      next_session: { id: "parker-session", session_date: "2026-09-05", start_time: "13:00", end_time: "18:00", court_ids: [], requires_staffing: false, is_active: true, series_occurrence_index: 1 },
      completed_sessions: 0, total_sessions: 1,
    }, {
      commitment: { id: "commitment-course", status: "active" },
      series: { id: "pickla-101", venue_id: "venue-1", name: "Pickla 101 · Höst 2026", format_name: "Pickla 101", start_date: "2026-09-08", end_date: "2026-09-29", total_sessions: 4, presentation_type: "course" },
      participant: { kind: "customer" },
      next_session: { id: "course-session-1", session_date: "2026-09-08", start_time: "18:00", end_time: "19:00", court_ids: [], requires_staffing: true, is_active: true, series_occurrence_index: 1 },
      completed_sessions: 0, total_sessions: 4,
    }] satisfies MyCourseItem[];

    const result = buildCustomerUpcoming({
      bookings: [{ id: "court-1", booking_ref: "COURT1", status: "confirmed", start_time: "2026-08-24T12:00:00Z", end_time: "2026-08-24T13:00:00Z", venue_courts: { name: "Bana 1" } }],
      registrations,
      courses,
      venueSlug: "pickla-arena-sthlm",
      nowMillis: now,
    });

    expect(result.map((item) => [item.source, item.title])).toEqual([
      ["court_booking", "Bana 1"],
      ["session_registration", "Open Play"],
      ["series_occurrence", "Parker Brunch"],
      ["series_occurrence", "Pickla 101 · Höst 2026"],
    ]);
    expect(result[2].destinationUrl).toBe("/course/parker?v=pickla-arena-sthlm");
    expect(result.filter((item) => item.id === "series:pickla-101")).toHaveLength(1);
  });

  it("excludes cancelled/past rows and generated Series registrations to avoid duplicates", () => {
    const registration = (id: string, status: string, sessionType: string, commitmentId: string | null): MySessionRegistration => ({
      id, venue_id: "venue-1", activity_session_id: id, session_date: "2026-08-25", user_id: "user-1", status,
      price_paid_sek: 0, stripe_session_id: null, series_commitment_id: commitmentId, created_at: null,
      activity_sessions: { id, name: id, session_type: sessionType, session_date: "2026-08-25", start_time: "18:00", end_time: "19:00", venue_id: "venue-1", venues: null },
    });
    const result = buildCustomerUpcoming({
      bookings: [{ id: "past", status: "completed", start_time: "2026-08-20T10:00:00Z", end_time: "2026-08-20T11:00:00Z" }],
      registrations: [registration("cancelled", "cancelled", "open_play", null), registration("generated", "confirmed", "course", "commitment-1")],
      courses: [],
      venueSlug: "pickla-arena-sthlm",
      nowMillis: now,
    });
    expect(result).toEqual([]);
  });

  it("never places dependent identity in the presentation-only projection", () => {
    const courses = [{
      commitment: { id: "commitment-child", status: "active", dependent_participant_id: "dependent-secret" },
      series: { id: "kids", venue_id: "venue-1", name: "Pickla Kids", format_name: "Pickla Kids", start_date: "2026-09-01", end_date: "2026-09-30", total_sessions: 4, presentation_type: "course" },
      participant: { kind: "dependent", id: "dependent-secret", first_name: "Hemligt barn", birth_year: 2016 },
      next_session: { id: "kids-1", session_date: "2026-09-01", start_time: "16:00", end_time: "17:00", court_ids: [], requires_staffing: true, is_active: true, series_occurrence_index: 1 },
      completed_sessions: 0, total_sessions: 4,
    }] satisfies MyCourseItem[];
    const [item] = buildCustomerUpcoming({ courses, venueSlug: "pickla-arena-sthlm", nowMillis: now });
    expect(JSON.stringify(item)).not.toContain("Hemligt barn");
    expect(JSON.stringify(item)).not.toContain("dependent-secret");
  });
});
