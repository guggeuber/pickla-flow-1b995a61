import { DateTime } from "luxon";

export const ACTIVITY_SESSION_TIMEZONE = "Europe/Stockholm";

function cleanActivityTime(value: unknown) {
  const time = String(value || "").slice(0, 5);
  return /^\d{2}:\d{2}$/.test(time) ? time : null;
}
function activityMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

export function isValidActivitySessionTimeOrder(startValue: unknown, endValue: unknown) {
  const startTime = cleanActivityTime(startValue);
  const endTime = cleanActivityTime(endValue);
  if (!startTime || !endTime) return false;
  const startMinutes = activityMinutes(startTime);
  const endMinutes = activityMinutes(endTime);
  if (startMinutes == null || endMinutes == null) return false;
  return endMinutes > startMinutes || (endMinutes === 0 && startMinutes > 0);
}

export function activitySessionOccurrenceInterval(
  sessionDate: unknown,
  startValue: unknown,
  endValue: unknown,
  zone = ACTIVITY_SESSION_TIMEZONE,
) {
  const date = String(sessionDate || "").slice(0, 10);
  const startTime = cleanActivityTime(startValue);
  const endTime = cleanActivityTime(endValue);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !startTime || !endTime || !isValidActivitySessionTimeOrder(startTime, endTime)) {
    return null;
  }

  const start = DateTime.fromISO(`${date}T${startTime}:00`, { zone });
  const localEndDate = endTime === "00:00" && startTime !== "00:00"
    ? DateTime.fromISO(date, { zone }).plus({ days: 1 }).toISODate()
    : date;
  const end = DateTime.fromISO(`${localEndDate}T${endTime}:00`, { zone });
  if (!start.isValid || !end.isValid || end <= start) return null;

  return {
    start,
    end,
    startsAt: start.toISO()!,
    endsAt: end.toISO()!,
    durationMinutes: end.diff(start, "minutes").minutes,
  };
}
