import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { ArrowRight, Loader2, MapPin, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { PicklaTopBar } from "@/components/PicklaTopBar";
import {
  getBookingChatResourceId,
  getBookingCourtLabel,
  groupBookingRows,
} from "@/lib/bookingGroups";
import { activityPriceLabels } from "@/lib/activityPricing";
import { fetchActivitySessionOverrides, isPublicActivityOverrideHidden, occurrenceOverrideKey } from "@/lib/activitySessionOverrides";
import { apiGet } from "@/lib/api";
import heroPhoto from "@/assets/pickla-hero-photo.jpg";
import weekendVibes from "@/assets/pickla-weekend-vibes.jpg";

const PAGE_BG = "#fffaf7";
const SOFT = "#f4f0ee";
const TEXT = "#111111";
const MUTED = "#76716f";
const PINK = "#ed3f8f";
const GREEN = "#32ef87";
const BORDER = "rgba(17,17,17,0.07)";
const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";
const DAYS_AHEAD = 7;

type FeedItem = {
  id: string;
  kind: "session" | "event" | "booking";
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  category: string;
  status: string;
  spotsLeft?: number | null;
  registrationsCount?: number;
  interestedCount?: number;
  userIsInterested?: boolean;
  socialProofLabel?: string;
  priceChips?: string[];
  activitySession?: {
    id: string;
    name: string;
    session_type: string | null;
    session_date: string | null;
    recurrence_days: number[] | null;
    start_time: string;
    end_time: string;
    capacity: number | null;
    price_sek: number | null;
    product_key: string | null;
    venue_id?: string;
    occurrence_date?: string;
  };
  availabilityLabel?: string;
  href: string;
  cta: string;
  chatResourceId?: string;
  chatTitle?: string;
  chatSubtitle?: string | null;
  chatEmoji?: string;
  isMine?: boolean;
  bookingRef?: string | null;
};

type SessionRow = {
  id: string;
  name: string;
  session_type: string | null;
  session_date: string | null;
  recurrence_days: number[] | null;
  start_time: string;
  end_time: string;
  capacity: number | null;
  price_sek: number | null;
  product_key: string | null;
  venue_id: string;
};

type SessionOccurrence = SessionRow & {
  occurrence_date: string;
};

type RegistrationRow = {
  activity_session_id: string;
  session_date: string;
  status: string | null;
};

type ActivitySocialProofRow = {
  activity_session_id: string;
  session_date: string;
  registrations_count: number;
  interested_count: number;
  user_is_interested: boolean;
};

type EventRow = {
  id: string;
  name: string;
  display_name: string | null;
  slug: string | null;
  category: string | null;
  status: string | null;
  start_date: string | null;
  start_time: string | null;
  end_time: string | null;
};

type BookingRow = {
  id: string;
  booking_ref: string | null;
  stripe_session_id: string | null;
  start_time: string;
  end_time: string;
  status: string | null;
  notes: string | null;
  access_code: string | null;
  venue_courts?: { name: string | null } | null;
};

type BookingGroup = BookingRow & {
  bookings?: BookingRow[];
  primary_booking_ref?: string | null;
  court_count?: number;
  court_names?: string[];
  access_codes?: string[];
};

type OpeningHour = {
  day_of_week: number;
  open_time: string | null;
  close_time: string | null;
  is_closed: boolean | null;
};

type VenueOperationOverride = {
  id: string;
  title: string | null;
  reason: string | null;
  override_type: string | null;
  starts_at: string;
  ends_at: string;
  affects_entire_venue: boolean;
  status: string;
};

type GuideKey = "pickleball" | "darts" | "pickla";

const GUIDES: Record<GuideKey, {
  title: string;
  kicker: string;
  body: string;
  cta: string;
  href: (slug: string) => string;
}> = {
  pickleball: {
    title: "Pickleball 101",
    kicker: "världens snabbaste lilla racketsport",
    body: "Pickleball är en lättstartad racketsport och en av de snabbast växande sporterna i Nordamerika och Asien. Man spelar oftast till 11 och måste vinna med 2. Bara servande lag kan ta poäng. Serven slås underhand, bakom baslinjen, diagonalt över nätet. Efter serve måste returen studsa, och sedan måste även nästa slag studsa. Därefter får man volleya, men inte stå i köket och slå volley.",
    cta: "Boka pickleball",
    href: (slug) => `/book?v=${slug}&sport=pickleball`,
  },
  darts: {
    title: "Darts 101",
    kicker: "tre pilar, enkel matte, mycket känsla",
    body: "På Pickla spelar många klassisk 501: varje spelare börjar på 501 och kastar tre pilar per runda. Poängen räknas ner mot exakt 0. Vanligt upplägg är dubbel ut, alltså att sista pilen måste träffa en dubbel. Bullseye är 50, yttre bull är 25, och tripplar ger mest tryck i spelet.",
    cta: "Boka darts",
    href: (slug) => `/book?v=${slug}&sport=dart`,
  },
  pickla: {
    title: "Pickla 101",
    kicker: "så funkar hallen",
    body: "Boka bana, dartbord eller ett pass i appen. Du får bokningen på Mina sidor och en fyrsiffrig kod. När du kommer till hallen checkar du in på paddan vid din resurs. För grupper och företag planerar vi upplägget tillsammans via en förfrågan.",
    cta: "Boka aktivitet",
    href: (slug) => `/book?v=${slug}`,
  },
};

function sectionLabel(date: DateTime, now: DateTime) {
  const prefix = date.hasSame(now, "day")
    ? "IDAG"
    : date.hasSame(now.plus({ days: 1 }), "day")
      ? "IMORGON"
      : date.setLocale("sv").toFormat("cccc").toUpperCase();
  return `${prefix} ${date.toFormat("d/M")}`;
}

function useVenue(slug: string) {
  return useQuery({
    queryKey: ["today-venue", slug],
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

function operationTitle(override: VenueOperationOverride) {
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

function operationIcon(override: VenueOperationOverride) {
  const t = `${override.title || ""} ${override.reason || ""} ${override.override_type || ""}`.toLowerCase();
  if (t.includes("midsommar") || t.includes("jul") || t.includes("nyår") || t.includes("påsk") || t.includes("helg") || t.includes("holiday")) return "🎉";
  if (t.includes("underhåll") || t.includes("underhall") || t.includes("maintenance") || t.includes("service")) return "🛠️";
  if (t.includes("konferens") || t.includes("event") || t.includes("möte") || t.includes("mote")) return "🏢";
  if (t.includes("städ") || t.includes("stad") || t.includes("clean")) return "🧹";
  return "⚠️";
}

function operationRange(override: VenueOperationOverride) {
  return {
    start: DateTime.fromISO(override.starts_at, { zone: "utc" }).setZone("Europe/Stockholm"),
    end: DateTime.fromISO(override.ends_at, { zone: "utc" }).setZone("Europe/Stockholm"),
  };
}

function openingHourForDate(openingHours: OpeningHour[], date: DateTime) {
  return openingHours.find((row) => row.day_of_week === date.weekday % 7) || null;
}

function normalHoursLabelForHour(hour: OpeningHour | null | undefined) {
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

function operationOverlapsDate(override: VenueOperationOverride, date: DateTime) {
  const { start, end } = operationRange(override);
  const dayStart = date.startOf("day");
  const dayEnd = dayStart.plus({ days: 1 });
  return start < dayEnd && end > dayStart;
}

function operationCoversCalendarDay(override: VenueOperationOverride, date: DateTime) {
  const { start, end } = operationRange(override);
  const dayStart = date.startOf("day");
  return start <= dayStart && end >= dayStart.plus({ days: 1 });
}

function operationCoversNormalHours(override: VenueOperationOverride, hour: OpeningHour | null | undefined, date: DateTime) {
  const normalRange = normalRangeForDate(hour, date);
  if (!normalRange) return operationCoversCalendarDay(override, date);
  const { start, end } = operationRange(override);
  return start <= normalRange.start && end >= normalRange.end;
}

function operationTimeLabel(override: VenueOperationOverride, date?: DateTime) {
  const { start, end } = operationRange(override);
  if (!date) return `${start.toFormat("HH:mm")}–${end.toFormat("HH:mm")}`;
  const dayStart = date.startOf("day");
  const dayEnd = dayStart.plus({ days: 1 });
  const displayStart = start > dayStart ? start : dayStart;
  const displayEnd = end < dayEnd ? end : dayEnd;
  return `${displayStart.toFormat("HH:mm")}–${displayEnd.toFormat("HH:mm")}`;
}

function operationDescription(override: VenueOperationOverride, hour: OpeningHour | null | undefined, date: DateTime) {
  if (operationCoversCalendarDay(override, date) || operationCoversNormalHours(override, hour, date)) {
    return "Stängt hela dagen";
  }
  return `Stängt ${operationTimeLabel(override, date)}`;
}

function useVenueOpenStatus(venue: any | undefined) {
  return useQuery({
    queryKey: ["today-open-status", venue?.id, venue?.operationOverrides?.map((row: VenueOperationOverride) => `${row.id}:${row.title}:${row.status}:${row.starts_at}:${row.ends_at}`).join(",")],
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
          venueStatusTone: activeOverride ? "exception" as const : "closed" as const,
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
          venueStatusTone: normalOpen ? "open" as const : "closed" as const,
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
        venueStatusTone: normalOpen ? "open" as const : "closed" as const,
      };
    },
  });
}

function dayLabel(day: number) {
  return ["Sön", "Mån", "Tis", "Ons", "Tor", "Fre", "Lör"][day] || "";
}

function formatHour(time?: string | null) {
  return time ? String(time).slice(0, 5) : "";
}

function programChatResourceId(sessionId: string, occurrenceDate: string) {
  return `activity_session:${sessionId}:${occurrenceDate}`;
}

function activitySocialProofLabel(registrationsCount = 0, interestedCount = 0) {
  if (registrationsCount > 0 && interestedCount > 0) return `${registrationsCount} kommer · ${interestedCount} intresserade`;
  if (registrationsCount > 0) return `${registrationsCount} kommer`;
  if (interestedCount > 0) return `${interestedCount} intresserade`;
  return "";
}

function HeroSticker({ guideKey, onClick }: { guideKey: GuideKey; onClick: (key: GuideKey) => void }) {
  const guide = GUIDES[guideKey];
  return (
    <button
      type="button"
      onClick={() => onClick(guideKey)}
      className="block w-fit bg-neutral-950 px-4 py-2.5 text-left shadow-sm active:scale-[0.98]"
    >
      <p className="text-[20px] leading-none text-pink-100" style={{ fontFamily: FONT_MONO }}>{guide.title}</p>
    </button>
  );
}

function useTodayFeed(venueId: string | undefined, userId: string | undefined, slug: string) {
  return useQuery({
    queryKey: ["today-feed", venueId, userId],
    enabled: !!venueId,
    staleTime: 30000,
    queryFn: async () => {
      const now = DateTime.now().setZone("Europe/Stockholm");
      const startDate = now.toISODate()!;
      const endDate = now.plus({ days: DAYS_AHEAD - 1 }).toISODate()!;
      const startUtc = now.startOf("day").toUTC().toISO()!;
      const endUtc = now.plus({ days: DAYS_AHEAD }).startOf("day").toUTC().toISO()!;
      const isPastOccurrence = (date: DateTime, endTime: string | null | undefined) => {
        if (!date.hasSame(now, "day") || !endTime) return false;
        const [hour = 0, minute = 0] = String(endTime).slice(0, 5).split(":").map(Number);
        const endsAt = date.set({ hour, minute, second: 0, millisecond: 0 });
        return endsAt <= now;
      };

      const [sessionsRes, eventsRes, bookingsRes] = await Promise.all([
        supabase
          .from("activity_sessions")
          .select("id, name, session_type, session_date, recurrence_days, start_time, end_time, capacity, price_sek, product_key, venue_id")
          .eq("venue_id", venueId!)
          .eq("is_active", true)
          .eq("publish_status", "published")
          .order("start_time", { ascending: true }),
        supabase
          .from("events")
          .select("id, name, display_name, slug, category, status, start_date, start_time, end_time")
          .eq("venue_id", venueId!)
          .eq("is_public", true)
          .in("status", ["upcoming", "active", "live"])
          .gte("start_date", startDate)
          .lte("start_date", endDate)
          .order("start_date", { ascending: true }),
        userId
          ? supabase
              .from("bookings")
              .select("id, booking_ref, stripe_session_id, start_time, end_time, status, notes, access_code, venue_courts(name)")
              .eq("user_id", userId)
              .neq("status", "cancelled")
              .gte("end_time", startUtc)
              .lt("start_time", endUtc)
              .order("start_time", { ascending: true })
          : Promise.resolve({ data: [] as BookingRow[], error: null }),
      ]);

      const sessionOccurrences: SessionOccurrence[] = [];
      for (const session of (sessionsRes.data || []) as SessionRow[]) {
        if (session.session_date) {
          const date = DateTime.fromISO(session.session_date, { zone: "Europe/Stockholm" });
          if (date >= now.startOf("day") && date < now.plus({ days: DAYS_AHEAD }).startOf("day")) {
            const occurrenceDate = date.toISODate();
            if (occurrenceDate && !isPastOccurrence(date, session.end_time)) sessionOccurrences.push({ ...session, occurrence_date: occurrenceDate });
          }
          continue;
        }
        for (let offset = 0; offset < DAYS_AHEAD; offset++) {
          const date = now.plus({ days: offset });
          if ((session.recurrence_days || []).includes(date.weekday % 7)) {
            const occurrenceDate = date.toISODate();
            if (occurrenceDate && !isPastOccurrence(date, session.end_time)) sessionOccurrences.push({ ...session, occurrence_date: occurrenceDate });
          }
        }
      }

      const sessionIds = [...new Set(sessionOccurrences.map((session) => session.id))];
      const [registrationsRes, socialProofRes, overrideMap] = await Promise.all([
        sessionIds.length
          ? supabase
              .from("session_registrations")
              .select("activity_session_id, session_date, status")
              .in("activity_session_id", sessionIds)
              .gte("session_date", startDate)
              .lte("session_date", endDate)
          : Promise.resolve({ data: [] as RegistrationRow[] }),
        sessionIds.length
          ? apiGet<{ occurrences: ActivitySocialProofRow[] }>("api-event-public", "activity-social-proof", {
              venueSlug: slug,
              sessionIds: sessionIds.join(","),
              startDate,
              endDate,
            }).catch(() => ({ occurrences: [] }))
          : Promise.resolve({ occurrences: [] }),
        sessionIds.length
          ? fetchActivitySessionOverrides(venueId!, sessionIds, startDate, endDate)
          : Promise.resolve(new Map()),
      ]);

      const registrationCounts = new Map<string, number>();
      for (const row of registrationsRes.data || []) {
        if (row.status === "cancelled") continue;
        const key = `${row.activity_session_id}:${row.session_date}`;
        registrationCounts.set(key, (registrationCounts.get(key) || 0) + 1);
      }
      const socialProofByKey = new Map<string, ActivitySocialProofRow>();
      for (const row of socialProofRes.occurrences || []) {
        socialProofByKey.set(`${row.activity_session_id}:${row.session_date}`, row);
      }

      const visibleSessionOccurrences = sessionOccurrences.filter((session) => {
        const override = overrideMap.get(occurrenceOverrideKey(session.id, session.occurrence_date));
        return !isPublicActivityOverrideHidden(override?.status);
      });

      const sessionItems: FeedItem[] = visibleSessionOccurrences.map((session) => {
        const socialProof = socialProofByKey.get(`${session.id}:${session.occurrence_date}`);
        const count = socialProof?.registrations_count ?? registrationCounts.get(`${session.id}:${session.occurrence_date}`) ?? 0;
        const interestedCount = socialProof?.interested_count ?? 0;
        const capacity = Number(session.capacity || 0);
        const spotsLeft = capacity ? Math.max(capacity - count, 0) : null;
        const pricing = activityPriceLabels({
          basePrice: Number(session.price_sek || 165),
          productKey: session.product_key,
          sessionType: session.session_type,
        });
        return {
          id: `session:${session.id}:${session.occurrence_date}`,
          kind: "session",
          title: session.name,
          date: session.occurrence_date,
          startTime: String(session.start_time).slice(0, 5),
          endTime: String(session.end_time).slice(0, 5),
          category: session.session_type === "open_play" ? "Open Play" : session.session_type === "group_training" ? "Träning" : session.session_type || "Pass",
          status: capacity && count >= capacity ? "Full" : "Drop-in",
          spotsLeft,
          registrationsCount: count,
          interestedCount,
          userIsInterested: Boolean(socialProof?.user_is_interested),
          socialProofLabel: activitySocialProofLabel(count, interestedCount),
          priceChips: pricing.publicChips,
          activitySession: session,
          availabilityLabel: spotsLeft == null ? "Öppet" : spotsLeft === 0 ? "Fullt" : spotsLeft <= 4 ? `Få platser · ${spotsLeft} kvar` : `${spotsLeft} kvar`,
          href: `/program/${session.id}?date=${session.occurrence_date}&v=${slug}`,
          cta: capacity && count >= capacity ? "Visa" : "Anmäl",
          chatResourceId: programChatResourceId(session.id, session.occurrence_date),
          chatTitle: session.name,
          chatSubtitle: `${session.occurrence_date} · ${String(session.start_time).slice(0, 5)}-${String(session.end_time).slice(0, 5)}`,
          chatEmoji: "📅",
        };
      });

      const eventItems: FeedItem[] = ((eventsRes.data || []) as EventRow[]).map((event) => ({
        id: `event:${event.id}`,
        kind: "event",
        title: event.display_name || event.name,
        date: event.start_date!,
        startTime: String(event.start_time || "00:00").slice(0, 5),
        endTime: String(event.end_time || "").slice(0, 5),
        category: event.category || "Event",
        status: event.status === "live" || event.status === "active" ? "Live" : "Kommande",
        href: event.slug ? `/e/${event.slug}` : `/event/${event.id}`,
        cta: "Visa",
        chatResourceId: event.id,
        chatTitle: event.display_name || event.name,
        chatSubtitle: event.start_date
          ? DateTime.fromISO(event.start_date).toFormat("d MMM", { locale: "sv" })
          : null,
        chatEmoji: "🏆",
      }));

      const bookingItems: FeedItem[] = (groupBookingRows((bookingsRes.data || []) as BookingRow[]) as BookingGroup[]).map((booking) => {
        const start = DateTime.fromISO(booking.start_time, { zone: "utc" }).setZone("Europe/Stockholm");
        const end = DateTime.fromISO(booking.end_time, { zone: "utc" }).setZone("Europe/Stockholm");
        return {
          id: `booking:${getBookingChatResourceId(booking)}`,
          kind: "booking",
          title: getBookingCourtLabel(booking),
          date: start.toISODate()!,
          startTime: start.toFormat("HH:mm"),
          endTime: end.toFormat("HH:mm"),
          category: "Min bokning",
          status: booking.status === "confirmed" ? "Bokad" : "Väntar",
          href: `/booking-chat/${encodeURIComponent(getBookingChatResourceId(booking))}?v=${slug}`,
          cta: "Öppna",
          isMine: true,
          bookingRef: booking.primary_booking_ref || booking.booking_ref || booking.id,
        };
      });

      return [...sessionItems, ...eventItems, ...bookingItems].sort((a, b) =>
        `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`)
      );
    },
  });
}

function FeedRow({ item, now, highlight, venueId, slug }: { item: FeedItem; now: DateTime; highlight: boolean; venueId?: string; slug: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading: authLoading } = useAuth();
  const [opening, setOpening] = useState(false);
  const end = item.endTime ? DateTime.fromISO(`${item.date}T${item.endTime}`, { zone: "Europe/Stockholm" }) : null;
  const isPast = !!end && end < now;
  const meta = item.availabilityLabel || (item.spotsLeft != null
    ? item.spotsLeft === 0 ? "Fullt" : `${item.spotsLeft} kvar`
    : item.status);
  const openItem = async () => {
    if (item.kind === "session") {
      navigate(item.href, { state: { backgroundLocation: location, activitySession: item.activitySession } });
      return;
    }

    if (item.kind === "booking" || !item.chatResourceId || !venueId) {
      navigate(item.href);
      return;
    }

    if (!authLoading && !user?.id) {
      const redirect = item.href || `${window.location.pathname}${window.location.search}`;
      sessionStorage.setItem("pickla_auth_redirect", redirect);
      navigate(`/auth?redirect=${encodeURIComponent(redirect)}`);
      return;
    }

    if (authLoading) return;

    setOpening(true);
    try {
      const { data } = await supabase.rpc("upsert_resource_chat_room", {
        p_venue_id: venueId,
        p_resource_id: item.chatResourceId,
        p_room_type: "event",
        p_title: item.chatTitle || item.title,
        p_subtitle: item.chatSubtitle || `${item.date} · ${item.startTime}-${item.endTime}`,
        p_emoji: item.chatEmoji || "📅",
        p_is_public: true,
      });
      const roomId = data?.[0]?.id;
      navigate(roomId ? `/chat/${roomId}?v=${encodeURIComponent(slug)}` : item.href);
    } finally {
      setOpening(false);
    }
  };

  return (
    <button
      type="button"
      onClick={openItem}
      disabled={opening}
      className="grid w-full grid-cols-[58px_1fr_auto] items-center gap-2 px-3 py-3 text-left transition-transform active:scale-[0.99]"
      style={{
        background: highlight ? GREEN : SOFT,
        color: TEXT,
        opacity: isPast || item.status === "Full" ? 0.48 : 1,
        border: `1px solid ${highlight ? "rgba(50,239,135,0.55)" : BORDER}`,
        fontFamily: FONT_MONO,
      }}
    >
      <span className="text-[15px]">{item.startTime}</span>
      <span className="min-w-0">
        <span className="block truncate text-[15px]">{item.title}</span>
        {item.priceChips && (
          <span className="mt-1 flex min-w-0 flex-wrap gap-1">
            {item.priceChips.map((chip) => (
              <span key={chip} className="rounded-full bg-white/65 px-1.5 py-0.5 text-[9px] font-bold text-black/55">
                {chip}
              </span>
            ))}
          </span>
        )}
        {item.socialProofLabel && (
          <span className="mt-1 block truncate text-[10px] font-bold text-black/45">
            {item.socialProofLabel}
          </span>
        )}
      </span>
      <span className="rounded-full bg-white/65 px-2 py-1 text-[10px] font-bold text-black/55">
        {opening ? "Öppnar" : meta}
      </span>
    </button>
  );
}

export default function TodayPage() {
  const [searchParams] = useSearchParams();
  const [venueSheetOpen, setVenueSheetOpen] = useState(false);
  const [activeGuide, setActiveGuide] = useState<GuideKey | null>(null);
  const navigate = useNavigate();
  const { user } = useAuth();
  const slug = searchParams.get("v") || "pickla-arena-sthlm";
  const { data: venue, isLoading: venueLoading } = useVenue(slug);
  const { data: status } = useVenueOpenStatus(venue);
  const { data: items = [], isLoading } = useTodayFeed(venue?.id, user?.id, slug);
  const now = DateTime.now().setZone("Europe/Stockholm");
  const heroImage = venue?.cover_image_url || heroPhoto;
  const heroText = venue?.description?.trim() || "Weekend Vibes";
  const openGuide = (guideKey: GuideKey) => {
    setActiveGuide(guideKey);
  };
  const go = (href: string) => {
    setActiveGuide(null);
    navigate(href);
  };
  const liveHighlightId = items.find((item) => {
    const start = DateTime.fromISO(`${item.date}T${item.startTime}`, { zone: "Europe/Stockholm" });
    const end = item.endTime ? DateTime.fromISO(`${item.date}T${item.endTime}`, { zone: "Europe/Stockholm" }) : null;
    return start <= now && !!end && end >= now && item.status !== "Full";
  })?.id;

  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, []);

  const days = useMemo(() => (
    Array.from({ length: DAYS_AHEAD }, (_, offset) => {
      const date = now.plus({ days: offset }).startOf("day");
      return {
        key: date.toISODate()!,
        date,
        items: items.filter((item) => item.date === date.toISODate()),
      };
    })
  ), [items, now]);
  const emptyDayText = (date: DateTime) => {
    if (!date.hasSame(now, "day")) return "inget schemalagt ännu";
    if (!status) return "inget mer schemalagt idag";
    if (status.open) return "inget mer schemalagt idag";
    if (status.label?.startsWith("Öppnar")) return `Pickla ${status.label.toLowerCase()}`;
    if (status.label === "Stängt idag") return "Pickla är stängt idag";
    return "Pickla är stängt för idag";
  };

  return (
    <div className="min-h-[100dvh] pb-10 pt-[calc(env(safe-area-inset-top,0px)+74px)]" style={{ background: PAGE_BG, color: TEXT }}>
      <PicklaTopBar
        slug={slug}
        venueName={venue?.name?.replace("Pickla Arena ", "Pickla ") || "Pickla Stockholm"}
        venueOpen={Boolean(status?.open)}
        venueStatusTone={status?.venueStatusTone}
        onVenueClick={() => setVenueSheetOpen(true)}
        background={PAGE_BG}
      />

      <main>
        <section className="relative mx-auto h-[510px] max-w-md overflow-hidden sm:rounded-b-[28px]">
          <img src={heroImage} alt="" className="absolute inset-0 h-full w-full object-cover object-center" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-black/5" />
          <div className="absolute left-0 top-[34%] flex flex-col items-start gap-2">
            <HeroSticker guideKey="pickleball" onClick={openGuide} />
            <HeroSticker guideKey="darts" onClick={openGuide} />
            <HeroSticker guideKey="pickla" onClick={openGuide} />
          </div>
          <p
            className="absolute bottom-8 left-6 right-4 max-w-[88%] text-[46px] uppercase leading-[0.9] text-white sm:text-[58px]"
            style={{
              fontFamily: FONT_MONO,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {heroText}
          </p>
        </section>

        <section className="mx-auto max-w-md px-6 py-7">
          <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
            {[
              { label: "Boka\nPickleball", href: `/book?v=${slug}&sport=pickleball`, image: null },
              { label: "Boka darts", href: `/book?v=${slug}&sport=dart`, image: null },
              { label: "Planera\nEvent", href: `/book/group?v=${slug}`, image: heroImage },
            ].map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => navigate(action.href)}
                className="relative h-32 w-[31%] min-w-[104px] overflow-hidden rounded-2xl border text-left shadow-sm active:scale-[0.98]"
                style={{ background: SOFT, borderColor: BORDER }}
              >
                {action.image ? (
                  <img src={action.image} alt="" className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <div className="absolute inset-x-4 top-5 h-14 rounded-full bg-white/45" />
                )}
                {action.image && <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />}
                <span
                  className="absolute bottom-4 left-3 right-3 whitespace-pre-line text-[15px] leading-[0.95]"
                  style={{ color: action.image ? "#fff" : TEXT, fontFamily: FONT_HEADING }}
                >
                  {action.label}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-md px-5 pt-1">
          {venueLoading || isLoading ? (
            <div className="grid min-h-48 place-items-center">
              <Loader2 className="h-6 w-6 animate-spin" style={{ color: PINK }} />
            </div>
          ) : (
            <div className="space-y-9">
              {days.map(({ key, date, items: dayItems }) => (
                <section key={key}>
                  <h2 className="mb-4 text-[36px] leading-none tracking-[-0.04em]" style={{ fontFamily: FONT_MONO }}>
                    {sectionLabel(date, now)}
                  </h2>
                  {dayItems.length > 0 ? (
                    <div className="space-y-2">
                      {dayItems.map((item) => (
                        <FeedRow key={item.id} item={item} now={now} highlight={item.id === liveHighlightId} venueId={venue?.id} slug={slug} />
                      ))}
                    </div>
                  ) : (
                    <div className="px-3 py-3 text-[14px]" style={{ background: SOFT, color: MUTED, fontFamily: FONT_MONO }}>
                      {emptyDayText(date)}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </section>
      </main>

      <Drawer open={venueSheetOpen} onOpenChange={setVenueSheetOpen}>
        <DrawerContent className="rounded-t-[28px] border-0 bg-white px-6 pb-[calc(env(safe-area-inset-bottom,0px)+22px)] pt-5">
          <div className="mx-auto w-full max-w-md">
            <div className="mb-7 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[28px] font-black text-neutral-950" style={{ fontFamily: FONT_HEADING }}>
                  {venue?.name?.replace("Pickla Arena ", "Pickla ") || "Pickla Solna"}
                </h2>
                <p className="mt-4 text-[13px] font-bold text-neutral-950" style={{ fontFamily: FONT_HEADING }}>
                  {status?.label || "Öppettider laddas"}
                </p>
                <p className="mt-1 text-[13px] text-neutral-700" style={{ fontFamily: FONT_MONO }}>
                  {[venue?.address || "Svetsarvägen 22", venue?.city || "Solna"].filter(Boolean).join(", ")}
                </p>
              </div>
              <button type="button" onClick={() => setVenueSheetOpen(false)} className="rounded-full p-2 text-neutral-950">
                <X className="h-5 w-5" />
              </button>
            </div>

            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([venue?.address || "Svetsarvägen 22", venue?.city || "Solna"].filter(Boolean).join(", "))}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-neutral-950 px-4 py-2 text-[13px] font-bold text-neutral-950"
              style={{ fontFamily: FONT_HEADING }}
            >
              <MapPin className="h-4 w-4" />
              Vägbeskrivning
            </a>

            <div className="mt-9">
              <h3 className="text-[16px] font-black text-neutral-950" style={{ fontFamily: FONT_HEADING }}>
                Öppettider
              </h3>
              <div className="mt-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
                      {status?.todayLabel || `Today, ${now.setLocale("sv").toFormat("d LLLL")}`}
                    </p>
                    <p className="mt-2 text-[13px] font-bold text-neutral-950" style={{ fontFamily: FONT_HEADING }}>
                      Normal öppettid: {status?.normalHoursLabel || "Laddar"}
                    </p>
                    {status?.activeOperationOverride && (
                      <p className="mt-1 text-[13px] font-bold text-red-700" style={{ fontFamily: FONT_HEADING }}>
                        {operationTitle(status.activeOperationOverride)}: {operationDescription(status.activeOperationOverride, status.todayOpeningHours, now)}
                      </p>
                    )}
                  </div>
                  <span
                    className="mt-1 h-3 w-3 shrink-0 rounded-full"
                    style={{
                      background: status?.venueStatusTone === "exception"
                        ? "#f97316"
                        : status?.open
                          ? GREEN
                          : "#ef4444",
                    }}
                  />
                </div>
                <p className="mt-3 rounded-xl bg-white px-3 py-2 text-[13px] font-black text-neutral-950" style={{ fontFamily: FONT_HEADING }}>
                  Aktuell status: {status?.currentStatusLabel || status?.label || "Laddar"}
                </p>
              </div>
              <div className="mt-3 space-y-1">
                {(status?.scheduleRows || []).map((row: any) => (
                  <div
                    key={row.key}
                    className={`rounded-xl px-2 py-1 text-[13px] text-neutral-950 ${row.isToday ? "bg-neutral-100 font-bold" : ""}`}
                    style={{ fontFamily: FONT_MONO }}
                  >
                    <div className="flex justify-between gap-8">
                      <span>{row.dayLabel}</span>
                      <span>{row.fullyClosed ? `Stängt · ${row.primaryTitle}` : row.normalLabel}</span>
                    </div>
                    {!row.fullyClosed && row.overrides?.map((override: any) => (
                      <p key={override.id} className="mt-1 text-right text-[11px] font-bold text-red-700">
                        {override.title}: {override.description}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
              {status?.upcomingOverrideRows?.length > 0 && (
                <div className="mt-6">
                  <h4 className="text-[13px] font-black text-neutral-950" style={{ fontFamily: FONT_HEADING }}>
                    Kommande avvikelser
                  </h4>
                  <div className="mt-2 space-y-2">
                    {status.upcomingOverrideRows.map((override: any) => (
                      <div key={override.id} className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-[13px] font-black text-neutral-950" style={{ fontFamily: FONT_HEADING }}>
                              {override.title}
                            </p>
                            <p className="mt-1 text-[12px] text-neutral-500" style={{ fontFamily: FONT_MONO }}>
                              {override.dateLabel}
                            </p>
                          </div>
                          <p className="text-right text-[12px] font-bold text-red-700" style={{ fontFamily: FONT_HEADING }}>
                            {override.description}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      <Drawer open={!!activeGuide} onOpenChange={(open) => !open && setActiveGuide(null)}>
        <DrawerContent className="rounded-t-[28px] border-0 bg-white px-6 pb-[calc(env(safe-area-inset-bottom,0px)+22px)] pt-5">
          {activeGuide && (
            <div className="mx-auto w-full max-w-md">
              <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.24em] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
                    {GUIDES[activeGuide].kicker}
                  </p>
                  <h2 className="mt-2 text-[32px] font-black leading-none text-neutral-950" style={{ fontFamily: FONT_HEADING }}>
                    {GUIDES[activeGuide].title}
                  </h2>
                </div>
                <button type="button" onClick={() => setActiveGuide(null)} className="rounded-full p-2 text-neutral-950">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <p className="text-[14px] leading-relaxed text-neutral-700" style={{ fontFamily: FONT_MONO }}>
                {GUIDES[activeGuide].body}
              </p>
              <button
                type="button"
                onClick={() => go(GUIDES[activeGuide].href(slug))}
                className="mt-7 flex w-full items-center justify-between rounded-2xl bg-neutral-950 px-5 py-4 text-left text-white active:scale-[0.98]"
                style={{ fontFamily: FONT_HEADING }}
              >
                <span>{GUIDES[activeGuide].cta}</span>
                <ArrowRight className="h-5 w-5" />
              </button>
              {activeGuide === "pickla" && (
                <button
                  type="button"
                  onClick={() => go(`/book/group?v=${slug}`)}
                  className="mt-3 flex w-full items-center justify-between rounded-2xl border border-neutral-200 bg-white px-5 py-4 text-left text-neutral-950 active:scale-[0.98]"
                  style={{ fontFamily: FONT_HEADING }}
                >
                  <span>Planera event</span>
                  <ArrowRight className="h-5 w-5" />
                </button>
              )}
            </div>
          )}
        </DrawerContent>
      </Drawer>

    </div>
  );
}
