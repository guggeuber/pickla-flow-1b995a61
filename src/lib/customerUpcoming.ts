import { DateTime } from "luxon";

import { buildBookingHistory, formatBookingHistoryTime } from "@/lib/bookingHistory";
import { getBookingChatResourceId, getBookingCourtLabel } from "@/lib/bookingGroups";
import type { MyCourseItem } from "@/lib/courses";
import type { MySessionRegistration } from "@/hooks/useMySessionRegistrations";
import { seriesCustomerTitle, seriesPresentation } from "@/lib/seriesPresentation";

export type CustomerUpcomingItem = {
  id: string;
  source: "court_booking" | "session_registration" | "series_occurrence";
  title: string;
  typeLabel: string;
  stateLabel: "Bokad" | "Anmäld" | "Du har en plats";
  startsAt: string;
  endsAt: string | null;
  timeLabel: string;
  venue: { name: string | null; slug: string };
  destinationUrl: string;
};

function stockholmSessionDateTime(date: unknown, time: unknown) {
  const day = String(date || "").slice(0, 10);
  const clock = String(time || "").slice(0, 5);
  if (!day || !clock) return null;
  const value = DateTime.fromISO(`${day}T${clock}:00`, { zone: "Europe/Stockholm" });
  return value.isValid ? value : null;
}

function formatUpcomingTime(start: DateTime, end?: DateTime | null) {
  return `${start.setLocale("sv").toFormat("ccc d LLL HH:mm")}${end?.isValid ? `–${end.toFormat("HH:mm")}` : ""}`;
}

export function buildCustomerUpcoming(input: {
  bookings?: Record<string, unknown>[];
  registrations?: MySessionRegistration[];
  courses?: MyCourseItem[];
  venueSlug: string;
  nowMillis?: number;
}): CustomerUpcomingItem[] {
  const nowMillis = input.nowMillis ?? DateTime.now().toMillis();
  const courtItems = buildBookingHistory(input.bookings || [], nowMillis)
    .filter((booking) => booking.history_status === "upcoming")
    .map((booking): CustomerUpcomingItem => {
      const start = DateTime.fromISO(String(booking.start_time || ""), { setZone: true });
      const end = DateTime.fromISO(String(booking.end_time || ""), { setZone: true });
      const reference = String(booking.primary_booking_ref || booking.booking_ref || booking.id || getBookingChatResourceId(booking));
      return {
        id: `court:${getBookingChatResourceId(booking) || reference}`,
        source: "court_booking",
        title: getBookingCourtLabel(booking),
        typeLabel: "Bana",
        stateLabel: "Bokad",
        startsAt: start.toUTC().toISO() || String(booking.start_time || ""),
        endsAt: end.isValid ? end.toUTC().toISO() : null,
        timeLabel: formatBookingHistoryTime(booking),
        venue: { name: null, slug: input.venueSlug },
        destinationUrl: `/my?booking=${encodeURIComponent(reference)}&v=${encodeURIComponent(input.venueSlug)}`,
      };
    });

  const registrationItems = (input.registrations || [])
    .filter((registration) => {
      const status = String(registration.status || "confirmed");
      if (!["confirmed", "paid", "checked_in"].includes(status)) return false;
      if (registration.series_commitment_id || registration.activity_sessions?.session_type === "course") return false;
      const end = stockholmSessionDateTime(registration.session_date || registration.activity_sessions?.session_date, registration.activity_sessions?.end_time);
      return !end || end.toMillis() >= nowMillis;
    })
    .map((registration): CustomerUpcomingItem | null => {
      const session = registration.activity_sessions;
      const date = registration.session_date || session?.session_date;
      const start = stockholmSessionDateTime(date, session?.start_time);
      if (!start) return null;
      const end = stockholmSessionDateTime(date, session?.end_time);
      const venueSlug = session?.venues?.slug || input.venueSlug;
      return {
        id: `session:${registration.id}`,
        source: "session_registration",
        title: session?.name || "Aktivitet",
        typeLabel: session?.session_type === "open_play" ? "Open Play" : "Aktivitet",
        stateLabel: "Anmäld",
        startsAt: start.toUTC().toISO()!,
        endsAt: end?.toUTC().toISO() || null,
        timeLabel: formatUpcomingTime(start, end),
        venue: { name: session?.venues?.name || null, slug: venueSlug },
        destinationUrl: `/program/${encodeURIComponent(registration.activity_session_id)}?date=${encodeURIComponent(String(date).slice(0, 10))}&v=${encodeURIComponent(venueSlug)}`,
      };
    })
    .filter((item): item is CustomerUpcomingItem => Boolean(item));

  const seenSeries = new Set<string>();
  const seriesItems = (input.courses || [])
    .filter((item) => item.commitment?.status === "active" && item.next_session)
    .map((item): CustomerUpcomingItem | null => {
      if (seenSeries.has(item.series.id)) return null;
      seenSeries.add(item.series.id);
      const next = item.next_session!;
      const start = stockholmSessionDateTime(next.session_date, next.start_time);
      if (!start) return null;
      const end = stockholmSessionDateTime(next.session_date, next.end_time);
      if (end && end.toMillis() < nowMillis) return null;
      const presentation = seriesPresentation(item.series.presentation_type);
      return {
        id: `series:${item.series.id}`,
        source: "series_occurrence",
        title: seriesCustomerTitle({
          seriesName: item.series.name,
          formatName: item.series.format_name,
          presentationType: presentation.type,
        }),
        typeLabel: presentation.label,
        stateLabel: "Du har en plats",
        startsAt: start.toUTC().toISO()!,
        endsAt: end?.toUTC().toISO() || null,
        timeLabel: formatUpcomingTime(start, end),
        venue: { name: null, slug: input.venueSlug },
        destinationUrl: `/course/${encodeURIComponent(item.series.id)}?v=${encodeURIComponent(input.venueSlug)}`,
      };
    })
    .filter((item): item is CustomerUpcomingItem => Boolean(item));

  return [...courtItems, ...registrationItems, ...seriesItems]
    .sort((a, b) => DateTime.fromISO(a.startsAt).toMillis() - DateTime.fromISO(b.startsAt).toMillis());
}
