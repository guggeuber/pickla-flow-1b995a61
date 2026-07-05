import { DateTime } from "luxon";

export const HERO_EVENING_START_HOUR = 16;
export const HERO_RELATIVE_WINDOW_HOURS = 3;
export const STOCKHOLM_ZONE = "Europe/Stockholm";

type HeroTimingInput = {
  sessionDate: string;
  startTime: string;
  endTime: string;
  now: DateTime;
};

type HeroTiming = {
  eyebrow: "IDAG" | "IKVÄLL" | "IMORGON" | "NÄSTA";
  subtitle: string;
};

function timeRange(startTime: string, endTime: string) {
  return `${startTime}–${endTime}`;
}

export function getTodayHeroTiming({ sessionDate, startTime, endTime, now }: HeroTimingInput): HeroTiming {
  const startsAt = DateTime.fromISO(`${sessionDate}T${startTime}`, { zone: STOCKHOLM_ZONE });
  const sessionDay = DateTime.fromISO(sessionDate, { zone: STOCKHOLM_ZONE });
  const stockholmNow = now.setZone(STOCKHOLM_ZONE);
  const range = timeRange(startTime, endTime);

  const isToday = sessionDay.hasSame(stockholmNow, "day");
  const isTomorrow = sessionDay.hasSame(stockholmNow.plus({ days: 1 }), "day");
  const eyebrow = isToday
    ? startsAt.hour < HERO_EVENING_START_HOUR
      ? "IDAG"
      : "IKVÄLL"
    : isTomorrow
      ? "IMORGON"
      : "NÄSTA";

  const minutesUntilStart = Math.ceil(startsAt.diff(stockholmNow, "minutes").minutes);
  if (isToday && minutesUntilStart > 0 && minutesUntilStart <= HERO_RELATIVE_WINDOW_HOURS * 60) {
    if (minutesUntilStart < 60) {
      return { eyebrow, subtitle: `${range} · om ${minutesUntilStart} min` };
    }
    const hoursUntilStart = Math.ceil(minutesUntilStart / 60);
    return {
      eyebrow,
      subtitle: `${range} · om ${hoursUntilStart} ${hoursUntilStart === 1 ? "timme" : "timmar"}`,
    };
  }

  return { eyebrow, subtitle: range };
}
