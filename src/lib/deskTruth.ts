import { DateTime } from "luxon";

export const DESK_TIMEZONE = "Europe/Stockholm";
export const DEFAULT_DESK_SURFACE = "today" as const;

type StaffVenueAuthorization = {
  role?: string | null;
  roles?: string[] | null;
} | null | undefined;

export type LiveReservationConflict = {
  type: "venue_closed" | "court_unavailable" | "booking" | "activity_occurrence" | "resource_block";
  resource_id: string;
  source_id?: string | null;
  occurrence_date?: string | null;
  starts_at: string;
  ends_at: string;
};

export type DeskLiveRow = {
  id?: string | null;
  kind?: string | null;
  status?: string | null;
  activity_session_id?: string | null;
  activity_session?: { id?: string | null; name?: string | null } | null;
  session_date?: string | null;
  occurrence_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  registration_id?: string | null;
  session_registration_id?: string | null;
  venue_court_id?: string | null;
  venue_courts?: { name?: string | null } | null;
  checked_in?: boolean | null;
  consumed?: boolean | null;
  notes?: string | null;
  customer_name?: string | null;
  customer_contact?: { name?: string | null } | null;
  booked_by?: string | null;
  guest_name?: string | null;
};

const RESERVATION_PRECEDENCE: Record<LiveReservationConflict["type"], number> = {
  venue_closed: 50,
  court_unavailable: 40,
  resource_block: 40,
  activity_occurrence: 30,
  booking: 20,
};

export function canAccessDeskAdmin(staffVenue: StaffVenueAuthorization) {
  return staffVenue?.role === "venue_admin" || staffVenue?.roles?.includes("super_admin") === true;
}

export function stockholmBusinessDate(value: Date | string | number = new Date()) {
  const instant = value instanceof Date
    ? DateTime.fromJSDate(value)
    : typeof value === "number"
      ? DateTime.fromMillis(value)
      : DateTime.fromISO(value, { setZone: true });
  return instant.setZone(DESK_TIMEZONE).toISODate();
}

export function resourceTypeLabel(sportType: unknown, count = 1) {
  const type = String(sportType || "").trim().toLowerCase();
  if (type === "pickleball") return count === 1 ? "pickleballbana" : "pickleballbanor";
  if (type === "dart") return count === 1 ? "dartstation" : "dartstationer";
  return count === 1 ? "bokningsresurs" : "bokningsresurser";
}

export function resourceBreakdownLabel(resources: Array<{ sport_type?: unknown }>) {
  const counts = new Map<string, number>();
  for (const resource of resources) {
    const raw = String(resource?.sport_type || "").trim().toLowerCase();
    const key = raw === "pickleball" || raw === "dart" ? raw : "other";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return ["pickleball", "dart", "other"]
    .flatMap((key) => {
      const count = counts.get(key) || 0;
      return count ? [`${count} ${resourceTypeLabel(key, count)}`] : [];
    })
    .join(" · ");
}

export function activityOccurrenceIdentity(row: DeskLiveRow) {
  const sessionId = String(row.activity_session_id || row.activity_session?.id || "").trim();
  if (!sessionId) return null;
  const occurrenceDate = String(row.session_date || row.occurrence_date || "").slice(0, 10)
    || (row.start_time ? stockholmBusinessDate(row.start_time) : null);
  return occurrenceDate ? `${sessionId}:${occurrenceDate}` : null;
}

export function projectLiveActivityOccurrences(rows: DeskLiveRow[], nowMs: number) {
  const occurrences = new Map<string, {
    key: string;
    activity_session_id: string;
    occurrence_date: string;
    title: string;
    start_time: string;
    end_time: string;
    participantIds: Set<string>;
    checkedInParticipantIds: Set<string>;
    resourceIds: Set<string>;
    resourceNames: Set<string>;
  }>();

  for (const row of rows) {
    if (row.kind !== "activity_registration" && row.kind !== "activity_court_block") continue;
    const startMs = +new Date(row.start_time || "");
    const endMs = +new Date(row.end_time || "");
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > nowMs || endMs <= nowMs) continue;
    const key = activityOccurrenceIdentity(row);
    if (!key) continue;
    const [activitySessionId, occurrenceDate] = key.split(":");
    const current = occurrences.get(key) || {
      key,
      activity_session_id: activitySessionId,
      occurrence_date: occurrenceDate,
      title: row.activity_session?.name || row.notes || row.customer_name || row.booked_by || "Aktivitet",
      start_time: row.start_time || "",
      end_time: row.end_time || "",
      participantIds: new Set<string>(),
      checkedInParticipantIds: new Set<string>(),
      resourceIds: new Set<string>(),
      resourceNames: new Set<string>(),
    };
    if (row.kind === "activity_registration") {
      const participantId = String(row.registration_id || row.session_registration_id || row.id || "").trim();
      if (participantId) {
        current.participantIds.add(participantId);
        if (row.checked_in || row.consumed || row.status === "checked_in") {
          current.checkedInParticipantIds.add(participantId);
        }
      }
    }
    if (row.kind === "activity_court_block") {
      if (row.venue_court_id) current.resourceIds.add(String(row.venue_court_id));
      if (row.venue_courts?.name) current.resourceNames.add(String(row.venue_courts.name));
    }
    occurrences.set(key, current);
  }

  return Array.from(occurrences.values()).map((occurrence) => ({
    key: occurrence.key,
    activity_session_id: occurrence.activity_session_id,
    occurrence_date: occurrence.occurrence_date,
    title: occurrence.title,
    start_time: occurrence.start_time,
    end_time: occurrence.end_time,
    participant_count: occurrence.participantIds.size,
    checked_in_count: occurrence.checkedInParticipantIds.size,
    resource_ids: Array.from(occurrence.resourceIds),
    resource_names: Array.from(occurrence.resourceNames),
  }));
}

export function currentReservationConflict(conflicts: LiveReservationConflict[]) {
  return [...conflicts].sort((left, right) => RESERVATION_PRECEDENCE[right.type] - RESERVATION_PRECEDENCE[left.type])[0] || null;
}
