import { describe, expect, it } from "vitest";
import {
  activityOccurrenceIdentity,
  canAccessDeskAdmin,
  currentReservationConflict,
  DEFAULT_DESK_SURFACE,
  projectLiveActivityOccurrences,
  resourceBreakdownLabel,
  resourceTypeLabel,
  stockholmBusinessDate,
} from "@/lib/deskTruth";

describe("Desk truth helpers", () => {
  it("uses Today as the default Desk surface", () => {
    expect(DEFAULT_DESK_SURFACE).toBe("today");
  });

  it("uses resource-type terminology instead of calling every resource a court", () => {
    expect(resourceTypeLabel("pickleball")).toBe("pickleballbana");
    expect(resourceTypeLabel("pickleball", 8)).toBe("pickleballbanor");
    expect(resourceTypeLabel("dart")).toBe("dartstation");
    expect(resourceTypeLabel("dart", 19)).toBe("dartstationer");
    expect(resourceTypeLabel("unknown", 2)).toBe("bokningsresurser");
    expect(resourceBreakdownLabel([
      ...Array.from({ length: 8 }, () => ({ sport_type: "pickleball" })),
      ...Array.from({ length: 19 }, () => ({ sport_type: "dart" })),
    ])).toBe("8 pickleballbanor · 19 dartstationer");
  });

  it("deduplicates one multi-resource activity occurrence and counts participants separately", () => {
    const rows = [
      ...["court-1", "court-2"].map((courtId) => ({
        id: `block-${courtId}`,
        kind: "activity_court_block",
        activity_session_id: "session-1",
        session_date: "2026-09-17",
        start_time: "2026-09-17T15:00:00Z",
        end_time: "2026-09-17T20:00:00Z",
        venue_court_id: courtId,
        venue_courts: { name: courtId },
        activity_session: { name: "Open Play Kväll" },
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `session_registration:registration-${index}`,
        registration_id: `registration-${index}`,
        kind: "activity_registration",
        activity_session_id: "session-1",
        session_date: "2026-09-17",
        start_time: "2026-09-17T15:00:00Z",
        end_time: "2026-09-17T20:00:00Z",
        checked_in: index < 3,
        activity_session: { name: "Open Play Kväll" },
      })),
    ];

    expect(activityOccurrenceIdentity(rows[0])).toBe("session-1:2026-09-17");
    expect(projectLiveActivityOccurrences(rows, Date.parse("2026-09-17T19:00:00Z"))).toEqual([
      expect.objectContaining({
        key: "session-1:2026-09-17",
        participant_count: 4,
        checked_in_count: 3,
        resource_ids: ["court-1", "court-2"],
      }),
    ]);
  });

  it("uses canonical reservation precedence", () => {
    const base = { resource_id: "court-1", starts_at: "2026-09-17T18:00:00Z", ends_at: "2026-09-17T19:00:00Z" };
    expect(currentReservationConflict([
      { ...base, type: "booking" },
      { ...base, type: "activity_occurrence" },
    ])?.type).toBe("activity_occurrence");
    expect(currentReservationConflict([
      { ...base, type: "activity_occurrence" },
      { ...base, type: "resource_block" },
    ])?.type).toBe("resource_block");
    expect(currentReservationConflict([
      { ...base, type: "resource_block" },
      { ...base, type: "venue_closed" },
    ])?.type).toBe("venue_closed");
  });

  it("derives business dates at Stockholm boundaries", () => {
    expect(stockholmBusinessDate("2026-01-01T22:59:59Z")).toBe("2026-01-01");
    expect(stockholmBusinessDate("2026-01-01T23:00:00Z")).toBe("2026-01-02");
    expect(stockholmBusinessDate("2026-07-01T21:59:59Z")).toBe("2026-07-01");
    expect(stockholmBusinessDate("2026-07-01T22:00:00Z")).toBe("2026-07-02");
  });

  it("gates Admin to venue admins and super admins", () => {
    expect(canAccessDeskAdmin({ role: "desk_staff", roles: [] })).toBe(false);
    expect(canAccessDeskAdmin({ role: "venue_admin", roles: [] })).toBe(true);
    expect(canAccessDeskAdmin({ role: "desk_staff", roles: ["super_admin"] })).toBe(true);
  });
});
