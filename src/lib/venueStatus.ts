import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { apiGet } from "@/lib/api";

export type OpeningHour = {
  day_of_week: number;
  open_time: string | null;
  close_time: string | null;
  is_closed: boolean | null;
};

export type VenueOperationOverride = {
  id: string;
  title: string | null;
  reason: string | null;
  override_type: string | null;
  starts_at: string;
  ends_at: string;
  affects_entire_venue: boolean;
  status: string;
};

export function operationTitle(override: VenueOperationOverride) {
  const title = override.title?.trim();
  if (title && title.toLowerCase() !== "driftavvikelse") return title;
  const reason = override.reason?.trim();
  if (reason && reason.toLowerCase() !== "driftavvikelse") return reason;
  const type = String(override.override_type || "").toLowerCase();
  if (type.includes("maintenance") || type.includes("underhall")) return "Underhåll";
  if (type.includes("event")) return "Privat event";
  if (type.includes("holiday") || type.includes("helg")) return "Helgdag";
  return "Avvikelse";
}

export function operationIcon(override: VenueOperationOverride) {
  const t = `${override.title || ""} ${override.reason || ""} ${override.override_type || ""}`.toLowerCase();
  if (t.includes("midsommar") || t.includes("jul") || t.includes("nyår") || t.includes("påsk") || t.includes("helg") || t.includes("holiday")) return "🎉";
  if (t.includes("underhåll") || t.includes("underhall") || t.includes("maintenance") || t.includes("service")) return "🛠️";
  if (t.includes("konferens") || t.includes("event") || t.includes("möte") || t.includes("mote")) return "🏢";
  if (t.includes("städ") || t.includes("stad") || t.includes("clean")) return "🧹";
  return "⚠️";
}

export function operationRange(override: VenueOperationOverride) {
  return {
    start: DateTime.fromISO(override.starts_at, { zone: "utc" }).setZone("Europe/Stockholm"),
    end: DateTime.fromISO(override.ends_at, { zone: "utc" }).setZone("Europe/Stockholm"),
  };
}

export function openingHourForDate(openingHours: OpeningHour[], date: DateTime) {
  return openingHours.find((row) => row.day_of_week === date.weekday % 7) || null;
}

function formatHour(time?: string | null) {
  return time ? String(time).slice(0, 5) : "";
}

export function normalHoursLabelForHour(hour: OpeningHour | null | undefined) {
  if (!hour || hour.is_closed || !hour.open_time || !hour.close_time) return "Stängt";
  return `${formatHour(hour.open_time)}–${formatHour(hour.close_time)}`;
}

function dateTimeForOpeningClock(date: DateTime, time: string) {
  const [hour = 0, minute = 0] = String(time).slice(0, 5).split(":").map(Number);
  return date.startOf("day").set({ hour, minute, second: 0, millisecond: 0 });
}

function normalRangeForDate(hour: OpeningHour | null | undefined, date: DateTime) {
  if (!hour || hour.is_closed || !hour.open_time || !hour.close_time) return null;
  const start = dateTimeForOpeningClock(date, hour.open_time);
  let end = dateTimeForOpeningClock(date, hour.close_time);
  if (end <= start) end = end.plus({ days: 1 });
  return { start, end };
}

export function operationOverlapsDate(override: VenueOperationOverride, date: DateTime) {
  const { start, end } = operationRange(override);
  const dayStart = date.startOf("day");
  const dayEnd = dayStart.plus({ days: 1 });
  return start < dayEnd && end > dayStart;
}

export function operationCoversCalendarDay(override: VenueOperationOverride, date: DateTime) {
  const { start, end } = operationRange(override);
  const dayStart = date.startOf("day");
  return start <= dayStart && end >= dayStart.plus({ days: 1 });
}

export function operationCoversNormalHours(override: VenueOperationOverride, hour: OpeningHour | null | undefined, date: DateTime) {
  const normalRange = normalRangeForDate(hour, date);
  if (!normalRange) return operationCoversCalendarDay(override, date);
  const { start, end } = operationRange(override);
  return start <= normalRange.start && end >= normalRange.end;
}

export function operationTimeLabel(override: VenueOperationOverride, date?: DateTime) {
  const { start, end } = operationRange(override);
  if (!date) return `${start.toFormat("HH:mm")}–${end.toFormat("HH:mm")}`;
  const dayStart = date.startOf("day");
  const dayEnd = dayStart.plus({ days: 1 });
  const displayStart = start > dayStart ? start : dayStart;
  const displayEnd = end < dayEnd ? end : dayEnd;
  return `${displayStart.toFormat("HH:mm")}–${displayEnd.toFormat("HH:mm")}`;
}

export function operationDescription(override: VenueOperationOverride, hour: OpeningHour | null | undefined, date: DateTime) {
  if (operationCoversCalendarDay(override, date) || operationCoversNormalHours(override, hour, date)) {
    return "Stängt hela dagen";
  }
  return `Stängt ${operationTimeLabel(override, date)}`;
}

function dayLabel(day: number) {
  return ["Sön", "Mån", "Tis", "Ons", "Tor", "Fre", "Lör"][day] || "";
}

export function useVenueWithHours(slug: string | undefined) {
  return useQuery({
    queryKey: ["venue-with-hours", slug],
    enabled: !!slug,
    queryFn: async () => {
      const data = await apiGet<any>("api-bookings", "public-venue", { slug });
      return {
        ...(data?.venue || {}),
        openingHours: data?.openingHours || [],
        operationOverrides: data?.operationOverrides || [],
      };
    },
  });
}

export function useVenueOpenStatus(venue: any | undefined) {
  return useQuery({
    queryKey: [
      "venue-open-status",
      venue?.id,
      ((venue?.operationOverrides || []) as VenueOperationOverride[])
        .map((row) => `${row.id}:${row.title}:${row.status}:${row.starts_at}:${row.ends_at}`)
        .join(","),
    ],
    enabled: !!venue?.id,
    staleTime: 30000,
    queryFn: async () => {
      const now = DateTime.now().setZone("Europe/Stockholm");
      const openingHours = (venue?.openingHours || []) as OpeningHour[];
      const operationOverrides = ((venue?.operationOverrides || []) as VenueOperationOverride[])
        .filter((row) => row.status === "active" && row.affects_entire_venue)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      const today = openingHourForDate(openingHours, now);
      const todayLabel = `Today, ${now.setLocale("sv").toFormat("d LLLL")}`;
      const normalHoursLabel = normalHoursLabelForHour(today);
      const todayOperationOverrides = operationOverrides.filter((override) => operationOverlapsDate(override, now));
      const activeOverride = todayOperationOverrides.find((override) => operationRange(override).end > now) || null;
      const scheduleRows = Array.from({ length: 7 }, (_, offset) => {
        const date = now.plus({ days: offset }).startOf("day");
        const hour = openingHourForDate(openingHours, date);
        const dayOverrides = operationOverrides.filter((override) => operationOverlapsDate(override, date));
        const primaryOverride = dayOverrides[0] || null;
        const fullyClosed = !!primaryOverride && operationCoversNormalHours(primaryOverride, hour, date);
        return {
          key: date.toISODate()!,
          dayLabel: `${dayLabel(date.weekday % 7)} ${date.toFormat("d/L")}`,
          normalLabel: normalHoursLabelForHour(hour),
          isToday: date.hasSame(now, "day"),
          primaryTitle: primaryOverride ? operationTitle(primaryOverride) : null,
          fullyClosed,
          overrides: dayOverrides.map((override) => ({
            id: override.id,
            title: operationTitle(override),
            icon: operationIcon(override),
            description: operationDescription(override, hour, date),
            timeLabel: operationTimeLabel(override, date),
            fullyClosed: operationCoversNormalHours(override, hour, date),
          })),
        };
      });
      const upcomingOverrideRows = operationOverrides
        .filter((override) => {
          const { end } = operationRange(override);
          return end > now && !operationOverlapsDate(override, now);
        })
        .map((override) => {
          const { start } = operationRange(override);
          const date = start.startOf("day");
          const hour = openingHourForDate(openingHours, date);
          const fullyClosed = operationCoversNormalHours(override, hour, date);
          return {
            id: override.id,
            title: operationTitle(override),
            icon: operationIcon(override),
            dateLabel: start.setLocale("sv").toFormat("d LLLL"),
            dayBadge: start.setLocale("sv").toFormat("d LLL").toUpperCase(),
            description: operationDescription(override, hour, date),
            fullDayLabel: fullyClosed ? "Stängt hela dagen" : `Stängt ${operationTimeLabel(override, date)}`,
            fullyClosed,
          };
        });
      const baseStatus = {
        openingHours,
        operationOverrides,
        todayOperationOverrides,
        activeOperationOverride: activeOverride,
        todayOpeningHours: today || null,
        normalHoursLabel,
        todayLabel,
        scheduleRows,
        upcomingOverrideRows,
      };

      if (!today || today.is_closed || !today.open_time || !today.close_time) {
        return {
          ...baseStatus,
          open: false,
          label: "Stängt idag",
          currentStatusLabel: "Stängt idag",
          venueStatusTone: activeOverride ? ("exception" as const) : ("closed" as const),
        };
      }

      const nowTime = now.toFormat("HH:mm");
      const openTime = String(today.open_time).slice(0, 5);
      const closeTime = String(today.close_time).slice(0, 5);
      const normalOpen = nowTime >= openTime && nowTime < closeTime;
      const normalLabel = normalOpen ? `Öppet till ${closeTime} ikväll` : nowTime < openTime ? `Öppnar ${openTime} idag` : "Stängt för idag";
      const normalCurrentLabel = normalOpen
        ? `Öppet till ${closeTime}`
        : nowTime < openTime
          ? `Stängt just nu · Öppnar ${openTime}`
          : "Stängt för idag";
      const normalOpenStart = now.set({
        hour: Number(openTime.slice(0, 2)),
        minute: Number(openTime.slice(3, 5)),
        second: 0,
        millisecond: 0,
      });
      const normalOpenEnd = now.set({
        hour: Number(closeTime.slice(0, 2)),
        minute: Number(closeTime.slice(3, 5)),
        second: 0,
        millisecond: 0,
      });

      if (!activeOverride) {
        return {
          ...baseStatus,
          open: normalOpen,
          label: normalLabel,
          currentStatusLabel: normalCurrentLabel,
          venueStatusTone: normalOpen ? ("open" as const) : ("closed" as const),
        };
      }

      const { start: overrideStart, end: overrideEnd } = operationRange(activeOverride);
      const overrideStartTime = overrideStart.toFormat("HH:mm");
      const overrideEndTime = overrideEnd.toFormat("HH:mm");
      const coversNormalDay = overrideStart <= normalOpenStart && overrideEnd >= normalOpenEnd;
      const wholeCalendarDay = overrideStart <= now.startOf("day") && overrideEnd >= now.plus({ days: 1 }).startOf("day");

      if (wholeCalendarDay || coversNormalDay) {
        return {
          ...baseStatus,
          open: false,
          label: "Stängt idag",
          currentStatusLabel: "Stängt idag",
          venueStatusTone: "exception" as const,
        };
      }

      if (now < overrideStart) {
        const delayedOpening = !normalOpen && overrideStart <= normalOpenStart ? `Öppnar ${overrideEndTime} idag` : null;
        return {
          ...baseStatus,
          open: normalOpen,
          label: delayedOpening || `Stänger tillfälligt ${overrideStartTime}–${overrideEndTime}`,
          currentStatusLabel: delayedOpening
            ? `Stängt just nu · Öppnar ${overrideEndTime}`
            : `Stänger tillfälligt ${overrideStartTime}–${overrideEndTime}`,
          venueStatusTone: "exception" as const,
        };
      }

      if (now < overrideEnd) {
        return {
          ...baseStatus,
          open: false,
          label: `Öppnar ${overrideEndTime} idag`,
          currentStatusLabel: `Stängt just nu · Öppnar ${overrideEndTime}`,
          venueStatusTone: "exception" as const,
        };
      }

      return {
        ...baseStatus,
        open: normalOpen,
        label: normalLabel,
        currentStatusLabel: normalLabel,
        venueStatusTone: normalOpen ? ("open" as const) : ("closed" as const),
      };
    },
  });
}

export function useVenueStatusBySlug(slug: string | undefined) {
  const { data: venue } = useVenueWithHours(slug);
  const { data: status } = useVenueOpenStatus(venue);
  return { venue, status };
}
