import { DateTime } from "luxon";

const STOCKHOLM_ZONE = "Europe/Stockholm";

type ActivityTimingInput = {
  sessionDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  now?: DateTime;
  checkedIn?: boolean;
  checkInAvailable?: boolean;
};

function formatDuration(minutes: number) {
  const safeMinutes = Math.max(0, Math.round(minutes));
  if (safeMinutes < 60) return `${safeMinutes} min`;
  const hours = Math.max(1, Math.round(safeMinutes / 60));
  return hours === 1 ? "1 timme" : `${hours} timmar`;
}

export function activityTimingLabel({
  sessionDate,
  startTime,
  endTime,
  now = DateTime.now().setZone(STOCKHOLM_ZONE),
  checkedIn = false,
  checkInAvailable = false,
}: ActivityTimingInput) {
  if (checkedIn) return "Du är incheckad";

  const date = String(sessionDate || "").slice(0, 10);
  const start = String(startTime || "").slice(0, 5);
  const end = String(endTime || "").slice(0, 5);
  if (!date || !start || !end) return "";

  const startsAt = DateTime.fromISO(`${date}T${start}:00`, { zone: STOCKHOLM_ZONE });
  const endsAt = DateTime.fromISO(`${date}T${end}:00`, { zone: STOCKHOLM_ZONE });
  if (!startsAt.isValid || !endsAt.isValid) return "";

  if (now > endsAt) return "Avslutad";
  if (checkInAvailable) return "Check-in öppen";
  if (now >= startsAt && now <= endsAt) {
    return `Pågår · ${formatDuration(endsAt.diff(now, "minutes").minutes)} kvar`;
  }
  if (startsAt.hasSame(now, "day")) {
    return `Startar om ${formatDuration(startsAt.diff(now, "minutes").minutes)}`;
  }
  if (startsAt.hasSame(now.plus({ days: 1 }), "day")) {
    return `Startar imorgon ${startsAt.toFormat("HH:mm")}`;
  }
  return `Startar ${startsAt.setLocale("sv").toFormat("ccc HH:mm")}`;
}

export function activityCheckInAvailable({
  sessionDate,
  startTime,
  endTime,
  now = DateTime.now().setZone(STOCKHOLM_ZONE),
}: Pick<ActivityTimingInput, "sessionDate" | "startTime" | "endTime" | "now">) {
  const date = String(sessionDate || "").slice(0, 10);
  const start = String(startTime || "").slice(0, 5);
  const end = String(endTime || "").slice(0, 5);
  if (!date || !start || !end) return false;
  const startsAt = DateTime.fromISO(`${date}T${start}:00`, { zone: STOCKHOLM_ZONE });
  const endsAt = DateTime.fromISO(`${date}T${end}:00`, { zone: STOCKHOLM_ZONE });
  if (!startsAt.isValid || !endsAt.isValid) return false;
  return now >= startsAt.minus({ minutes: 30 }) && now <= endsAt;
}
