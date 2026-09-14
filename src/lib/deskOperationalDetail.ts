export type DeskBookingDetailTarget = {
  kind: "booking";
  booking_id: string;
};

export type DeskActivityOccurrenceDetailTarget = {
  kind: "activity_occurrence";
  activity_session_id: string;
  occurrence_date: string;
};

export type DeskOperationalDetailTarget =
  | DeskBookingDetailTarget
  | DeskActivityOccurrenceDetailTarget;

export type DeskOperationalDetailTargetResult =
  | { ok: true; target: DeskOperationalDetailTarget }
  | { ok: false; error: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parseDeskOperationalDetailTarget(value: unknown): DeskOperationalDetailTargetResult {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "Detaljmål saknas" };
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "booking") {
    if (typeof candidate.booking_id !== "string" || !UUID_PATTERN.test(candidate.booking_id)) {
      return { ok: false, error: "Ogiltigt bokningsmål" };
    }
    return { ok: true, target: { kind: "booking", booking_id: candidate.booking_id } };
  }

  if (candidate.kind === "activity_occurrence") {
    if (
      typeof candidate.activity_session_id !== "string" ||
      !UUID_PATTERN.test(candidate.activity_session_id) ||
      typeof candidate.occurrence_date !== "string" ||
      !LOCAL_DATE_PATTERN.test(candidate.occurrence_date)
    ) {
      return { ok: false, error: "Ogiltigt aktivitetstillfälle" };
    }
    return {
      ok: true,
      target: {
        kind: "activity_occurrence",
        activity_session_id: candidate.activity_session_id,
        occurrence_date: candidate.occurrence_date,
      },
    };
  }

  return { ok: false, error: "Okänd detaljtyp" };
}
