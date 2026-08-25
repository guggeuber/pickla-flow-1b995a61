import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  getBookingCourtLabel,
  getBookingCourtNamesLabel,
  groupBookingRows,
} from "@/lib/bookingGroups";
import { findGenericActivityResourceConflict } from "../../supabase/functions/_shared/generic_activity_resource_conflicts";

const adminApi = readFileSync("supabase/functions/api-admin/index.ts", "utf8");
const bookingsApi = readFileSync("supabase/functions/api-bookings/index.ts", "utf8");
const BANA_6 = "court-bana-6";

function activity(overrides: Record<string, unknown>) {
  return {
    id: String(overrides.id),
    name: String(overrides.name || overrides.id),
    session_date: null,
    recurrence_days: [2],
    start_time: "18:00",
    end_time: "20:00",
    court_ids: [BANA_6],
    is_active: true,
    publish_status: "published",
    ...overrides,
  };
}

function activityConflict(candidate: Record<string, unknown>, owners: Record<string, unknown>[], selfSessionId?: string) {
  return findGenericActivityResourceConflict({
    candidate,
    owners,
    courtNames: { [BANA_6]: "Bana 6", "court-free": "Bana 7" },
    fromDate: "2026-08-25",
    selfSessionId,
  });
}

function booking(overrides: Record<string, unknown>) {
  return {
    id: String(overrides.id),
    booking_ref: String(overrides.id),
    status: "confirmed",
    start_time: "2026-08-25T15:00:00Z",
    end_time: "2026-08-25T16:00:00Z",
    notes: "Same customer",
    ...overrides,
  };
}

describe("resource conflict hotfix regressions", () => {
  it("excludes cancelled replacement predecessors from active booking presentation", () => {
    const groups = groupBookingRows([
      booking({ id: "cancelled-bana-2", booking_group_key: "code:1001:17:00:18:00", status: "cancelled", access_code: "1001", venue_courts: { name: "Bana 2" } }),
      booking({ id: "cancelled-bana-3", booking_group_key: "code:1002:17:00:18:00", status: "cancelled", access_code: "1002", venue_courts: { name: "Bana 3" } }),
      booking({ id: "confirmed-bana-2", booking_group_key: "code:1003:17:00:18:00", access_code: "1003", venue_courts: { name: "Bana 2" } }),
    ]);

    const active = groups.filter((group) => group.status !== "cancelled");
    expect(active).toHaveLength(1);
    expect(groups.filter((group) => group.status === "cancelled")).toHaveLength(2);
    expect(active[0]).toMatchObject({
      status: "confirmed",
      court_count: 1,
      court_names: ["Bana 2"],
    });
    expect(getBookingCourtLabel(active[0])).toBe("Bana 2");
    expect(getBookingCourtNamesLabel(active[0])).toBe("Bana 2");
    expect(bookingsApi).toContain("booking_group_key: groupKey");
  });

  it("keeps a legitimate active multi-court booking grouped by its canonical access code", () => {
    const groups = groupBookingRows([
      booking({ id: "multi-bana-2", booking_group_key: "code:2001:17:00:18:00", access_code: "2001", venue_courts: { name: "Bana 2" } }),
      booking({ id: "multi-bana-3", booking_group_key: "code:2001:17:00:18:00", access_code: "2001", venue_courts: { name: "Bana 3" } }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      status: "confirmed",
      court_count: 2,
      court_names: ["Bana 2", "Bana 3"],
    });
  });

  it("makes the generic Admin activity validator query other activity owners", () => {
    const validator = adminApi.slice(
      adminApi.indexOf("async function validateActivitySessionCourtAvailability"),
      adminApi.indexOf("async function validateActivitySessionHostCustomers"),
    );

    expect(validator).toContain(".from('activity_sessions')");
    expect(validator).toContain(".from('bookings')");
    expect(validator).toContain(".from('event_resource_blocks')");
    expect(validator).toContain("code: 'resource_conflict'");
  });

  it("denies the exact recurring Bana 6 PATCH conflict", () => {
    const openPlay = activity({ id: "open-play", name: "Open Play Kväll", start_time: "17:00", end_time: "22:00" });
    const singelAfterPatch = activity({
      id: "singel",
      name: "Singel Träning",
      court_ids: ["court-bana-2", BANA_6],
    });

    expect(activityConflict(singelAfterPatch, [openPlay], "singel")).toEqual({
      resource_id: BANA_6,
      resource_name: "Bana 6",
      owner_id: "open-play",
      owner_name: "Open Play Kväll",
      session_date: "2026-08-25",
      start_time: "17:00",
      end_time: "22:00",
    });
  });

  it("allows touching boundaries, different weekdays, and different courts", () => {
    const tuesdayOwner = activity({ id: "owner", start_time: "17:00", end_time: "18:00" });
    expect(activityConflict(activity({ id: "candidate" }), [tuesdayOwner], "candidate")).toBeNull();

    const mondayOwner = activity({ id: "monday", recurrence_days: [1] });
    expect(activityConflict(activity({ id: "candidate" }), [mondayOwner], "candidate")).toBeNull();

    const otherCourtOwner = activity({ id: "other-court", court_ids: ["court-free"] });
    expect(activityConflict(activity({ id: "candidate" }), [otherCourtOwner], "candidate")).toBeNull();
  });

  it("self-excludes unchanged assignments and allows adding a free resource", () => {
    const current = activity({ id: "candidate" });
    expect(activityConflict(current, [current], "candidate")).toBeNull();

    const addFreeCourt = activity({ id: "candidate", court_ids: [BANA_6, "court-free"] });
    expect(activityConflict(addFreeCourt, [current], "candidate")).toBeNull();
  });

  it("checks concrete dates without rejecting unrelated or historical occurrences", () => {
    const concreteTuesday = activity({ id: "concrete", session_date: "2026-09-01", recurrence_days: null });
    expect(activityConflict(activity({ id: "candidate", recurrence_days: [2] }), [concreteTuesday], "candidate")).not.toBeNull();

    const concreteWednesday = activity({ id: "other-day", session_date: "2026-09-02", recurrence_days: null });
    expect(activityConflict(activity({ id: "candidate", recurrence_days: [2] }), [concreteWednesday], "candidate")).toBeNull();

    const historicalTuesday = activity({ id: "historical", session_date: "2026-08-18", recurrence_days: null });
    expect(activityConflict(activity({ id: "candidate", recurrence_days: [2] }), [historicalTuesday], "candidate")).toBeNull();
  });
});
