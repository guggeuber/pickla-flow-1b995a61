import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { ArrowRight, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PicklaTopBar } from "@/components/PicklaTopBar";
import { useVenueWithHours } from "@/lib/venueStatus";
import {
  getBookingChatResourceId,
  getBookingCourtLabel,
  groupBookingRows,
} from "@/lib/bookingGroups";
import { formatSek } from "@/lib/activityPricing";
import { fetchActivitySessionOverrides, isPublicActivityOverrideHidden, occurrenceOverrideKey } from "@/lib/activitySessionOverrides";
import { apiGet } from "@/lib/api";
import { getPublicProfileMap, type PublicProfile } from "@/lib/publicProfiles";
import { PriceLine } from "@/components/ui/PriceLine";
import { PeopleRow, ScarcityBadge } from "@/components/ui/PeopleRow";
import { consumeFirstRunWelcome, preserveIntendedRoute } from "@/lib/entryResolver";
import { getTodayHeroTiming } from "@/lib/todayHeroTiming";
import { activityCheckInAvailable, activityTimingLabel } from "@/lib/activityTiming";


const PAGE_BG = "#fffaf7";
const SOFT = "#f4f0ee";
const TEXT = "#111111";
const MUTED = "#76716f";
const PINK = "#ed3f8f";
const BORDER = "rgba(17,17,17,0.07)";
const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";
const DAYS_AHEAD = 7;
const HORIZON_SECTION_MAX_ROWS = 3;
const WEEKEND_SECTION_TRIGGER_WEEKDAYS = [4, 5];

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
  userIsInterested?: boolean;
  userIsRegistered?: boolean;
  userIsCheckedIn?: boolean;
  userRegistrationStatus?: string | null;
  priceSek?: number | null;
  isSpecialPass?: boolean;
  onlineCheaper?: boolean;
  participants?: PublicProfile[];
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
    access_policy?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
  };
  capacity?: number | null;
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
  access_policy: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
};

type SessionOccurrence = SessionRow & {
  occurrence_date: string;
};

type RegistrationRow = {
  activity_session_id: string;
  session_date: string;
  status: string | null;
  user_id?: string | null;
  customer_id?: string | null;
};

type PublicSessionHost = {
  activity_session_id: string;
  customer_id: string;
  first_name?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  sort_order?: number | null;
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

const TODAY_DEBUG_PREFIX = "[TodayPage]";

function logTodayDebug(label: string, payload?: unknown) {
  if (typeof window === "undefined") return;
  console.info(`${TODAY_DEBUG_PREFIX} ${label}`, payload ?? "");
}

function summarizeFeedItem(item: FeedItem) {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    date: item.date,
    time: `${item.startTime}-${item.endTime}`,
    status: item.status,
    registrationsCount: item.registrationsCount,
    capacity: item.capacity,
  };
}

function sessionSummary(session: Pick<SessionRow, "id" | "name" | "session_date" | "recurrence_days" | "start_time" | "end_time" | "capacity">) {
  return {
    id: session.id,
    name: session.name,
    session_date: session.session_date,
    recurrence_days: session.recurrence_days,
    time: `${String(session.start_time).slice(0, 5)}-${String(session.end_time).slice(0, 5)}`,
    capacity: session.capacity,
  };
}

function errorSummary(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return error;
}

async function logMergeStep<T>(label: string, promise: Promise<T>) {
  try {
    const result = await promise;
    logTodayDebug(`merge source ${label} fulfilled`, result);
    return result;
  } catch (error) {
    logTodayDebug(`merge source ${label} rejected`, errorSummary(error));
    throw error;
  }
}


function programChatResourceId(sessionId: string, occurrenceDate: string) {
  return `activity_session:${sessionId}:${occurrenceDate}`;
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
          .select("id, name, session_type, session_date, recurrence_days, start_time, end_time, capacity, price_sek, product_key, venue_id, access_policy, metadata")
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

      if (sessionsRes.error || eventsRes.error || bookingsRes.error) {
        logTodayDebug("source query errors", {
          sessions: sessionsRes.error?.message,
          events: eventsRes.error?.message,
          bookings: bookingsRes.error?.message,
        });
      }

      logTodayDebug("raw activity_sessions length", {
        count: (sessionsRes.data || []).length,
        venueId,
        slug,
        range: `${startDate}..${endDate}`,
        now: now.toISO(),
        sessions: ((sessionsRes.data || []) as SessionRow[]).map(sessionSummary),
      });

      const sessionOccurrences: SessionOccurrence[] = [];
      const occurrenceDiscards: Array<Record<string, unknown>> = [];
      for (const session of (sessionsRes.data || []) as SessionRow[]) {
        let addedForSession = 0;
        if (session.session_date) {
          const date = DateTime.fromISO(session.session_date, { zone: "Europe/Stockholm" });
          if (date >= now.startOf("day") && date < now.plus({ days: DAYS_AHEAD }).startOf("day")) {
            const occurrenceDate = date.toISODate();
            if (occurrenceDate && !isPastOccurrence(date, session.end_time)) {
              sessionOccurrences.push({ ...session, occurrence_date: occurrenceDate });
              addedForSession += 1;
            } else {
              occurrenceDiscards.push({
                ...sessionSummary(session),
                date: occurrenceDate,
                reason: "past_occurrence_end_time_lte_now",
              });
            }
          } else {
            occurrenceDiscards.push({
              ...sessionSummary(session),
              date: session.session_date,
              reason: "one_off_outside_home_horizon",
            });
          }
          if (addedForSession === 0) {
            occurrenceDiscards.push({
              ...sessionSummary(session),
              reason: "no_visible_one_off_occurrence_created",
            });
          }
          continue;
        }
        for (let offset = 0; offset < DAYS_AHEAD; offset++) {
          const date = now.plus({ days: offset });
          if ((session.recurrence_days || []).includes(date.weekday % 7)) {
            const occurrenceDate = date.toISODate();
            if (occurrenceDate && !isPastOccurrence(date, session.end_time)) {
              sessionOccurrences.push({ ...session, occurrence_date: occurrenceDate });
              addedForSession += 1;
            } else {
              occurrenceDiscards.push({
                ...sessionSummary(session),
                date: occurrenceDate,
                reason: "past_occurrence_end_time_lte_now",
              });
            }
          }
        }
        if (addedForSession === 0) {
          occurrenceDiscards.push({
            ...sessionSummary(session),
            reason: "recurrence_days_do_not_match_home_horizon_or_all_occurrences_past",
          });
        }
      }

      logTodayDebug("session occurrence expansion", {
        created: sessionOccurrences.map((session) => ({
          ...sessionSummary(session),
          occurrence_date: session.occurrence_date,
        })),
        discarded: occurrenceDiscards,
      });

      const sessionIds = [...new Set(sessionOccurrences.map((session) => session.id))];
      let registrationsRes;
      let socialProofRes;
      let hostsRes;
      let overrideMap;
      try {
        [registrationsRes, socialProofRes, hostsRes, overrideMap] = await Promise.all([
          logMergeStep(
            "session_registrations",
            sessionIds.length
              ? supabase
                  .from("session_registrations")
                  .select("activity_session_id, session_date, status, user_id, customer_id")
                  .in("activity_session_id", sessionIds)
                  .gte("session_date", startDate)
                  .lte("session_date", endDate)
              : Promise.resolve({ data: [] as RegistrationRow[] }),
          ),
          logMergeStep(
            "activity-social-proof",
            sessionIds.length
              ? apiGet<{ occurrences: ActivitySocialProofRow[] }>("api-event-public", "activity-social-proof", {
                  venueSlug: slug,
                  sessionIds: sessionIds.join(","),
                  startDate,
                  endDate,
                }).catch((error) => {
                  logTodayDebug("activity-social-proof fallback to empty", errorSummary(error));
                  return { occurrences: [] };
                })
              : Promise.resolve({ occurrences: [] }),
          ),
          logMergeStep(
            "get_public_activity_session_hosts",
            sessionIds.length
              ? (supabase as any)
                  .rpc("get_public_activity_session_hosts", { session_ids: sessionIds })
                  .catch((error: unknown) => {
                    logTodayDebug("get_public_activity_session_hosts fallback to empty", errorSummary(error));
                    return { data: [] as PublicSessionHost[] };
                  })
              : Promise.resolve({ data: [] as PublicSessionHost[] }),
          ),
          logMergeStep(
            "activity_session_overrides",
            sessionIds.length
              ? fetchActivitySessionOverrides(venueId!, sessionIds, startDate, endDate)
              : Promise.resolve(new Map()),
          ),
        ]);
      } catch (error) {
        logTodayDebug("merge pipeline error after occurrence expansion", errorSummary(error));
        throw error;
      }

      logTodayDebug("merge source summary", {
        expandedOccurrences: sessionOccurrences.length,
        sessionIds,
        registrationsRows: (registrationsRes.data || []).length,
        registrationsError: "error" in registrationsRes ? registrationsRes.error?.message : undefined,
        socialProofRows: (socialProofRes.occurrences || []).length,
        hostsRows: (hostsRes.data || []).length,
        hostsError: "error" in hostsRes ? hostsRes.error?.message : undefined,
        overrideRows: overrideMap instanceof Map ? overrideMap.size : null,
        overrideMapType: overrideMap?.constructor?.name,
      });

      if ("error" in registrationsRes && registrationsRes.error) {
        logTodayDebug("session_registrations query error", registrationsRes.error.message);
      }

      const registrationCounts = new Map<string, number>();
      const registrationsByKey = new Map<string, RegistrationRow[]>();
      const userRegistrationStatusByKey = new Map<string, string | null>();
      for (const row of registrationsRes.data || []) {
        if (row.status === "cancelled") continue;
        const key = `${row.activity_session_id}:${row.session_date}`;
        registrationCounts.set(key, (registrationCounts.get(key) || 0) + 1);
        if (userId && row.user_id === userId) {
          const currentStatus = userRegistrationStatusByKey.get(key);
          if (currentStatus !== "checked_in") {
            userRegistrationStatusByKey.set(key, row.status || "confirmed");
          }
        }
        registrationsByKey.set(key, [...(registrationsByKey.get(key) || []), row]);
      }
      const hostsBySessionId = new Map<string, PublicSessionHost[]>();
      for (const host of hostsRes.data || []) {
        const list = hostsBySessionId.get(host.activity_session_id) || [];
        list.push(host);
        hostsBySessionId.set(host.activity_session_id, list);
      }
      const participantUserIdsByKey = new Map<string, string[]>();
      for (const [key, rows] of registrationsByKey.entries()) {
        const sessionIdForKey = key.split(":")[0];
        const hostOrder = new Map((hostsBySessionId.get(sessionIdForKey) || []).map((host, index) => [host.customer_id, Number(host.sort_order ?? index)]));
        const orderedRows = [...rows].sort((a, b) => {
          const aHost = a.customer_id ? hostOrder.get(a.customer_id) : undefined;
          const bHost = b.customer_id ? hostOrder.get(b.customer_id) : undefined;
          if (aHost != null && bHost != null) return aHost - bHost;
          if (aHost != null) return -1;
          if (bHost != null) return 1;
          return 0;
        });
        participantUserIdsByKey.set(
          key,
          [...new Set(orderedRows.map((row) => row.user_id).filter(Boolean) as string[])].slice(0, 3),
        );
      }
      const participantUserIds = [...new Set([...participantUserIdsByKey.values()].flat())];
      const publicProfilesByUserId = participantUserIds.length
        ? await getPublicProfileMap(participantUserIds).catch(() => new Map<string, PublicProfile | null>())
        : new Map<string, PublicProfile | null>();
      const socialProofByKey = new Map<string, ActivitySocialProofRow>();
      for (const row of socialProofRes.occurrences || []) {
        socialProofByKey.set(`${row.activity_session_id}:${row.session_date}`, row);
      }

      const mergeTrace: Array<Record<string, unknown>> = [];

      const visibleSessionOccurrences = sessionOccurrences.filter((session) => {
        const occurrenceKey = occurrenceOverrideKey(session.id, session.occurrence_date);
        const override = overrideMap.get(occurrenceKey);
        const hidden = isPublicActivityOverrideHidden(override?.status);
        const socialProof = socialProofByKey.get(occurrenceKey);
        const registrationCount = registrationCounts.get(occurrenceKey) || 0;
        mergeTrace.push({
          ...sessionSummary(session),
          occurrence_id: occurrenceKey,
          occurrence_date: session.occurrence_date,
          matchingOverride: override || null,
          matchingSocialProof: socialProof || null,
          registrationCount,
          mergeResult: hidden ? "discarded" : "kept_for_session_item_map",
          discardReason: hidden ? "activity_session_override_hidden_or_cancelled" : null,
        });
        if (hidden) {
          logTodayDebug("discard session occurrence", {
            ...sessionSummary(session),
            occurrence_date: session.occurrence_date,
            reason: "activity_session_override_hidden_or_cancelled",
            override,
          });
        }
        return !hidden;
      });

      const sessionItems: FeedItem[] = visibleSessionOccurrences.map((session) => {
        const occurrenceKey = `${session.id}:${session.occurrence_date}`;
        const socialProof = socialProofByKey.get(occurrenceKey);
        const count = socialProof?.registrations_count ?? registrationCounts.get(occurrenceKey) ?? 0;
        const capacity = Number(session.capacity || 0);
        const metadata = session.metadata || {};
        const pricingMode = String(metadata.pricing_mode || "standard");
        const isSpecialPass = pricingMode === "fixed_ticket" || pricingMode === "member_discount";
        const onlinePrice = Number(metadata.online_price_sek ?? session.price_sek ?? 0);
        const deskPrice = Number(metadata.desk_price_sek ?? onlinePrice);
        const spotsLeft = capacity ? Math.max(capacity - count, 0) : null;
        const userRegistrationStatus = userRegistrationStatusByKey.get(occurrenceKey) || null;
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
          userIsInterested: Boolean(socialProof?.user_is_interested),
          userIsRegistered: Boolean(userRegistrationStatus),
          userIsCheckedIn: userRegistrationStatus === "checked_in",
          userRegistrationStatus,
          priceSek: onlinePrice || Number(session.price_sek || 0),
          isSpecialPass,
          onlineCheaper: isSpecialPass && deskPrice > onlinePrice,
          participants: (participantUserIdsByKey.get(occurrenceKey) || [])
            .map((participantUserId) => publicProfilesByUserId.get(participantUserId))
            .filter(Boolean) as PublicProfile[],
          activitySession: session,
          capacity,
          href: `/program/${session.id}?date=${session.occurrence_date}&v=${slug}`,
          cta: capacity && count >= capacity ? "Visa" : "Anmäl",
          chatResourceId: programChatResourceId(session.id, session.occurrence_date),
          chatTitle: session.name,
          chatSubtitle: `${session.occurrence_date} · ${String(session.start_time).slice(0, 5)}-${String(session.end_time).slice(0, 5)}`,
          chatEmoji: "📅",
        };
      });

      logTodayDebug("merge occurrence trace", mergeTrace);

      const eventItems: FeedItem[] = ((eventsRes.data || []) as EventRow[]).map((event) => ({
        id: `event:${event.id}`,
        kind: "event",
        title: event.display_name || event.name,
        date: event.start_date!,
        startTime: String(event.start_time || "00:00").slice(0, 5),
        endTime: String(event.end_time || "").slice(0, 5),
        category: event.category || "Event",
        status: event.status === "live" || event.status === "active" ? "Nu" : "Kommande",
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

      const mergedItems = [...sessionItems, ...eventItems, ...bookingItems].sort((a, b) =>
        `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`)
      );

      logTodayDebug("merged feed items", {
        sessionItems: sessionItems.length,
        eventItems: eventItems.length,
        bookingItems: bookingItems.length,
        mergedActivityItems: mergedItems.filter((item) => item.kind === "session" || item.kind === "event").length,
        items: mergedItems.map(summarizeFeedItem),
      });

      return mergedItems;
    },
  });
}

function FeedRow({
  item,
  now,
  highlight,
  venueId,
  slug,
  emphasis = "default",
}: {
  item: FeedItem;
  now: DateTime;
  highlight: boolean;
  venueId?: string;
  slug: string;
  emphasis?: "default" | "secondary";
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading: authLoading } = useAuth();
  const [opening, setOpening] = useState(false);
  const end = item.endTime ? DateTime.fromISO(`${item.date}T${item.endTime}`, { zone: "Europe/Stockholm" }) : null;
  const isPast = !!end && end < now;
  const popBorder = item.isSpecialPass ? "rgba(237,63,143,0.28)" : highlight ? "rgba(17,17,17,0.14)" : BORDER;
  const popBackground = item.isSpecialPass
    ? "#fff7fb"
    : highlight
    ? "#ece7e2"
    : SOFT;
  const priceEmphasisClass = emphasis === "secondary" ? "opacity-60" : "";
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
      preserveIntendedRoute(redirect);
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
        background: popBackground,
        color: TEXT,
        opacity: isPast || item.status === "Full" ? 0.48 : 1,
        border: `1px solid ${popBorder}`,
        boxShadow: item.isSpecialPass ? "0 10px 26px rgba(237,63,143,0.08)" : "none",
        fontFamily: FONT_MONO,
      }}
    >
      <span className="text-[15px]">{item.startTime}</span>
      <div className="min-w-0">
        {item.isSpecialPass && (
          <span className="mb-1 inline-flex rounded-full bg-black px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] text-white">
            Specialpass
          </span>
        )}
        <span className="block truncate text-[15px]">{item.title}</span>
        {item.kind === "session" && (
          <PeopleRow
            people={item.participants}
            participantCount={item.registrationsCount}
            className="mt-1 text-[10px] !text-black/45"
            showInvitation={false}
          />
        )}
        {item.kind === "session" && item.priceSek != null && item.priceSek > 0 && (
          <span className={`mt-1 block ${priceEmphasisClass}`}>
            <PriceLine amountSek={item.priceSek} size="sm" />
          </span>
        )}
        {item.kind === "session" && Number(item.priceSek || 0) <= 0 && (
          <span
            className={`mt-1 block text-[12px] font-black ${emphasis === "secondary" ? "text-black/40" : "text-black/55"}`}
            style={{ fontFamily: FONT_HEADING }}
          >
            Ingår
          </span>
        )}
      </div>
      {opening ? (
        <span className="rounded-full bg-white/65 px-2 py-1 text-[10px] font-bold text-black/55">Öppnar</span>
      ) : (
        <ScarcityBadge remaining={item.spotsLeft} capacity={item.capacity} />
      )}
    </button>
  );
}

function displayNameForUser(user: any) {
  const metadata = user?.user_metadata || {};
  const raw = metadata.first_name || metadata.name || metadata.display_name || user?.email?.split("@")[0] || "";
  const name = String(raw).trim();
  if (!name) return null;
  return name.split(/\s+/)[0];
}

function ParticipantLine({ participants, count }: { participants?: PublicProfile[]; count?: number }) {
  return <PeopleRow people={participants} participantCount={count} />;
}

function itemEndDateTime(item: FeedItem) {
  const endTime = item.endTime || item.startTime;
  return DateTime.fromISO(`${item.date}T${endTime}`, { zone: "Europe/Stockholm" });
}

function isJoinableItem(item: FeedItem, now: DateTime) {
  return item.status !== "Full" && itemEndDateTime(item) > now;
}

function getHeroDiscardReason(item: FeedItem, now: DateTime, todayKey: string, tomorrowKey: string) {
  const end = itemEndDateTime(item);
  if (item.kind !== "session" && item.kind !== "event") return "not_activity_or_event";
  if (item.date !== todayKey && item.date !== tomorrowKey) return "not_today_or_tomorrow";
  if (item.status === "Full") return "full";
  if (!end.isValid) return "invalid_end_datetime";
  if (end <= now) return "end_time_lte_now";
  return "kept";
}

function sortBySoonestThenPeople(items: FeedItem[]) {
  return [...items].sort((a, b) => {
    const timeCompare = `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`);
    if (timeCompare !== 0) return timeCompare;
    return Number(b.registrationsCount || 0) - Number(a.registrationsCount || 0);
  });
}

function FeaturedTonightHero({
  item,
  now,
  userName,
  welcomeLine,
  priceLabel,
  included,
  onOpen,
}: {
  item: FeedItem | null;
  now: DateTime;
  userName: string | null;
  welcomeLine?: string | null;
  priceLabel: string | null;
  included: boolean;
  onOpen: () => void;
}) {
  const timing = item
    ? getTodayHeroTiming({
        sessionDate: item.date,
        startTime: item.startTime,
        endTime: item.endTime,
        now,
      })
    : { eyebrow: "NÄSTA", subtitle: "Nästa kväll på Pickla" };
  const checkInAvailable = Boolean(item?.userIsRegistered && activityCheckInAvailable({
    sessionDate: item?.date,
    startTime: item?.startTime,
    endTime: item?.endTime,
    now,
  }));
  const statusLabel = item
    ? activityTimingLabel({
        sessionDate: item.date,
        startTime: item.startTime,
        endTime: item.endTime,
        now,
        checkedIn: item.userIsCheckedIn,
        checkInAvailable,
      })
    : timing.subtitle;
  const ctaLabel = item?.userIsCheckedIn
    ? "✓ Incheckad"
    : item?.userIsRegistered
      ? "✓ Redan anmäld"
      : included
        ? "Boka plats · Ingår"
        : `Boka plats${priceLabel ? ` · ${priceLabel}` : ""}`;

  return (
    <section className="mx-auto max-w-md px-5 pt-2">
      <button
        type="button"
        onClick={onOpen}
        disabled={!item}
        className="w-full overflow-hidden rounded-[28px] px-5 pb-5 pt-5 text-left transition-transform active:scale-[0.99] disabled:opacity-70"
        style={{
          background: "#fff",
          border: `1px solid ${BORDER}`,
          boxShadow: "0 14px 36px rgba(17,17,17,0.06)",
        }}
      >
        <p className="text-[11px] font-black uppercase tracking-[0.22em]" style={{ fontFamily: FONT_MONO, color: PINK }}>
          {timing.eyebrow}
        </p>
        <div className="mt-5">
          {welcomeLine ? (
            <p className="mb-2 text-[15px] font-semibold" style={{ fontFamily: FONT_HEADING, color: MUTED }}>
              {welcomeLine}
            </p>
          ) : userName && (
            <p className="mb-2 text-[15px] font-semibold" style={{ fontFamily: FONT_HEADING, color: MUTED }}>
              Hej {userName}.
            </p>
          )}
          <h2 className="break-words text-[31px] font-black leading-[0.98] tracking-[-0.04em]" style={{ fontFamily: FONT_HEADING, color: TEXT }}>
            {item?.title || "Något händer snart"}
          </h2>
          <p className="mt-3 text-[15px] font-semibold leading-snug" style={{ color: MUTED }}>
            {statusLabel || timing.subtitle}
          </p>
        </div>

        <div className="mt-6 grid gap-4">
          <div className="min-w-0">
            <ParticipantLine participants={item?.participants} count={item?.registrationsCount} />
          </div>
          <span
            className="inline-flex w-fit items-center gap-2 rounded-full px-5 py-3 text-[15px] font-black text-white shadow-sm disabled:opacity-60"
            style={{ fontFamily: FONT_HEADING, background: TEXT }}
          >
            <span>{ctaLabel}</span>
            <ArrowRight className="h-4 w-4" />
          </span>
        </div>
      </button>
    </section>
  );
}

export default function TodayPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [welcomeLine] = useState(() => consumeFirstRunWelcome() ? "Välkommen till Pickla" : null);
  const slug = searchParams.get("v") || "pickla-arena-sthlm";
  const { data: venue, isLoading: venueLoading } = useVenueWithHours(slug);

  const { data: items = [], isLoading } = useTodayFeed(venue?.id, user?.id, slug);
  const now = DateTime.now().setZone("Europe/Stockholm");
  const userName = displayNameForUser(user);
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

  const activityItems = items.filter((item) => item.kind === "session" || item.kind === "event");
  const todayKey = now.toISODate();
  const tomorrowKey = now.plus({ days: 1 }).toISODate();
  const todayActivities = sortBySoonestThenPeople(activityItems.filter((item) => item.date === todayKey));
  const tomorrowActivities = sortBySoonestThenPeople(activityItems.filter((item) => item.date === tomorrowKey));
  const todayJoinable = todayActivities.filter((item) => isJoinableItem(item, now));
  const tomorrowJoinable = tomorrowActivities.filter((item) => isJoinableItem(item, now));
  const featuredItem = (
    todayJoinable[0] ||
    tomorrowJoinable[0] ||
    null
  );

  useEffect(() => {
    const heroCandidates = activityItems.filter((item) => item.kind === "session" || item.kind === "event");
    logTodayDebug("hero selection", {
      now: now.toISO(),
      rawItemsLength: items.length,
      mergedActivityItemsLength: activityItems.length,
      todayKey,
      tomorrowKey,
      todayItems: todayActivities.map(summarizeFeedItem),
      todayJoinable: todayJoinable.map(summarizeFeedItem),
      tomorrowJoinable: tomorrowJoinable.map(summarizeFeedItem),
      featuredItem: featuredItem ? summarizeFeedItem(featuredItem) : null,
      discardReasons: heroCandidates.map((item) => ({
        ...summarizeFeedItem(item),
        reason: getHeroDiscardReason(item, now, todayKey!, tomorrowKey!),
        endDateTime: itemEndDateTime(item).toISO(),
      })),
    });
  }, [items, activityItems, todayActivities, todayJoinable, tomorrowJoinable, featuredItem, now, todayKey, tomorrowKey]);

  const todayListItems = todayActivities.filter((item) => item.id !== featuredItem?.id);
  const weekendMode = WEEKEND_SECTION_TRIGGER_WEEKDAYS.includes(now.weekday);
  const daysUntilSaturday = (6 - now.weekday + 7) % 7 || 7;
  const saturdayKey = now.plus({ days: daysUntilSaturday }).toISODate();
  const sundayKey = now.plus({ days: daysUntilSaturday + 1 }).toISODate();
  const horizonCandidates = weekendMode
    ? activityItems.filter((item) => item.date === saturdayKey || item.date === sundayKey)
    : tomorrowActivities;
  const horizonItems = sortBySoonestThenPeople(
    horizonCandidates
      .filter((item) => item.id !== featuredItem?.id)
      .filter((item) => isJoinableItem(item, now))
  ).slice(0, HORIZON_SECTION_MAX_ROWS);
  const horizonHeading = weekendMode ? "I helgen" : "Imorgon";
  const { data: featuredPreview } = useQuery({
    queryKey: ["today-featured-preview", user?.id || "anon", featuredItem?.id],
    enabled: !!featuredItem?.activitySession?.id,
    staleTime: user?.id ? 0 : 15000,
    queryFn: () => apiGet<any>("api-event-public", "activity-preview", {
      sessionId: featuredItem!.activitySession!.id,
      date: featuredItem!.date,
      venueSlug: slug,
    }),
  });
  const featuredPricing = featuredPreview?.activityTicketPricing || featuredPreview?.pricing || null;
  const featuredIncluded = featuredPricing?.requiresCheckout === false;
  const featuredFallbackPrice = Number(
    featuredItem?.activitySession?.metadata?.online_price_sek ??
    featuredItem?.activitySession?.price_sek ??
    0
  );
  const featuredPriceLabel = featuredIncluded
    ? null
    : featuredPricing?.checkoutLabel ||
      (featuredFallbackPrice > 0 ? formatSek(featuredFallbackPrice) : null) ||
      null;
  const openFeatured = () => {
    if (!featuredItem) return;
    if (featuredItem.kind === "session") {
      navigate(featuredItem.href, { state: { backgroundLocation: location, activitySession: featuredItem.activitySession } });
      return;
    }
    navigate(featuredItem.href);
  };

  return (
    <div className="min-h-[100dvh] pb-10 pt-[calc(env(safe-area-inset-top,0px)+74px)]" style={{ background: PAGE_BG, color: TEXT }}>
      <PicklaTopBar
        slug={slug}
        venueName={venue?.name?.replace("Pickla Arena ", "Pickla ") || "Pickla Stockholm"}
        background={PAGE_BG}
      />


      <main>
        <h1 className="sr-only">Pickla Arena Stockholm — Pickleball, dart och event i Solna</h1>
        {venueLoading || isLoading ? (
          <section className="mx-auto grid min-h-[330px] max-w-md place-items-center px-5 pt-2">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: PINK }} />
          </section>
        ) : (
          <FeaturedTonightHero
            item={featuredItem}
            now={now}
            userName={userName}
            welcomeLine={welcomeLine}
            priceLabel={featuredPriceLabel}
            included={featuredIncluded}
            onOpen={openFeatured}
          />
        )}

        <section className="mx-auto max-w-md px-5 pt-7">
          {venueLoading || isLoading ? (
            null
          ) : (
            <div className="space-y-8">
              {todayListItems.length > 0 && (
                <section>
                  <h2 className="mb-4 text-[28px] leading-none tracking-[-0.04em]" style={{ fontFamily: FONT_HEADING }}>
                    Mer händer idag
                  </h2>
                  <div className="space-y-2">
                    {todayListItems.map((item) => (
                      <FeedRow key={item.id} item={item} now={now} highlight={item.id === liveHighlightId} venueId={venue?.id} slug={slug} />
                    ))}
                  </div>
                </section>
              )}

              {horizonItems.length > 0 && (
                <section>
                  <h2 className="mb-4 text-[24px] leading-none tracking-[-0.03em]" style={{ fontFamily: FONT_HEADING }}>
                    {horizonHeading}
                  </h2>
                  <div className="space-y-2">
                    {horizonItems.map((item) => (
                      <FeedRow
                        key={item.id}
                        item={item}
                        now={now}
                        highlight={false}
                        venueId={venue?.id}
                        slug={slug}
                        emphasis="secondary"
                      />
                    ))}
                  </div>
                </section>
              )}

              <button
                type="button"
                onClick={() => navigate(`/openplay?v=${encodeURIComponent(slug)}`)}
                className="text-sm font-black underline underline-offset-4"
                style={{ color: MUTED, fontFamily: FONT_HEADING }}
              >
                Hela veckan →
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
