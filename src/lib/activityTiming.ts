import { useEffect, useState } from "react";
import { DateTime } from "luxon";

export const STOCKHOLM_ZONE = "Europe/Stockholm";

type ActivityTimingInput = {
  sessionDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  now?: DateTime;
  checkedIn?: boolean;
  checkInAvailable?: boolean;
};

type ActivityTimingStatus = {
  stateLabel: "IDAG" | "IKVÄLL" | "IMORGON" | "NÄSTA" | "PÅGÅR" | "AVSLUTAD";
  detailLabel: string;
  rangeLabel: string;
  isOngoing: boolean;
  isEnded: boolean;
};

function formatDuration(minutes: number) {
  const safeMinutes = Math.max(0, Math.ceil(minutes));
  if (safeMinutes < 60) return `${safeMinutes} min`;
  const hours = Math.floor(safeMinutes / 60);
  const remainingMinutes = safeMinutes % 60;
  const hourLabel = hours === 1 ? "1 tim" : `${hours} tim`;
  return remainingMinutes > 0 ? `${hourLabel} ${remainingMinutes} min` : hourLabel;
}

export function activityTimingStatus({
  sessionDate,
  startTime,
  endTime,
  now = DateTime.now().setZone(STOCKHOLM_ZONE),
}: Pick<ActivityTimingInput, "sessionDate" | "startTime" | "endTime" | "now">): ActivityTimingStatus {
  const date = String(sessionDate || "").slice(0, 10);
  const start = String(startTime || "").slice(0, 5);
  const end = String(endTime || "").slice(0, 5);
  const rangeLabel = start && end ? `${start}–${end}` : "";
  const fallback: ActivityTimingStatus = {
    stateLabel: "NÄSTA",
    detailLabel: rangeLabel,
    rangeLabel,
    isOngoing: false,
    isEnded: false,
  };
  if (!date || !start || !end) return fallback;

  const startsAt = DateTime.fromISO(`${date}T${start}:00`, { zone: STOCKHOLM_ZONE });
  const endsAt = DateTime.fromISO(`${date}T${end}:00`, { zone: STOCKHOLM_ZONE });
  const stockholmNow = now.setZone(STOCKHOLM_ZONE);
  if (!startsAt.isValid || !endsAt.isValid) return fallback;

  if (stockholmNow > endsAt) {
    return {
      stateLabel: "AVSLUTAD",
      detailLabel: rangeLabel,
      rangeLabel,
      isOngoing: false,
      isEnded: true,
    };
  }

  if (stockholmNow >= startsAt && stockholmNow <= endsAt) {
    return {
      stateLabel: "PÅGÅR",
      detailLabel: `Slutar om ${formatDuration(endsAt.diff(stockholmNow, "minutes").minutes)}`,
      rangeLabel,
      isOngoing: true,
      isEnded: false,
    };
  }

  if (startsAt.hasSame(stockholmNow, "day")) {
    return {
      stateLabel: startsAt.hour < 16 ? "IDAG" : "IKVÄLL",
      detailLabel: `Startar om ${formatDuration(startsAt.diff(stockholmNow, "minutes").minutes)}`,
      rangeLabel,
      isOngoing: false,
      isEnded: false,
    };
  }

  if (startsAt.hasSame(stockholmNow.plus({ days: 1 }), "day")) {
    return {
      stateLabel: "IMORGON",
      detailLabel: `Startar imorgon ${startsAt.toFormat("HH:mm")}`,
      rangeLabel,
      isOngoing: false,
      isEnded: false,
    };
  }

  return {
    stateLabel: "NÄSTA",
    detailLabel: `Startar ${startsAt.setLocale("sv").toFormat("ccc HH:mm")}`,
    rangeLabel,
    isOngoing: false,
    isEnded: false,
  };
}

export function useActivityNow(updateMs = 60_000) {
  const [now, setNow] = useState(() => DateTime.now().setZone(STOCKHOLM_ZONE));

  useEffect(() => {
    let timeoutId: number | undefined;

    const scheduleNextTick = () => {
      const current = DateTime.now().setZone(STOCKHOLM_ZONE);
      setNow(current);
      const elapsed = (current.second * 1000 + current.millisecond) % updateMs;
      const delay = Math.max(1000, updateMs - elapsed + 50);
      timeoutId = window.setTimeout(scheduleNextTick, delay);
    };

    const initialElapsed = (now.second * 1000 + now.millisecond) % updateMs;
    timeoutId = window.setTimeout(scheduleNextTick, Math.max(1000, updateMs - initialElapsed + 50));

    return () => {
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [now.millisecond, now.second, updateMs]);

  return now;
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
