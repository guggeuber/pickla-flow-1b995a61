import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { ArrowRight, Check, Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PicklaTopBar } from "@/components/PicklaTopBar";
import { useVenueWithHours } from "@/lib/venueStatus";
import {
  getBookingChatResourceId,
  getBookingCourtLabel,
  groupBookingRows,
} from "@/lib/bookingGroups";
import { formatSek, type ActivityDiscoveryPricingResponse } from "@/lib/activityPricing";
import { isPublicActivityOverrideHidden, occurrenceOverrideKey } from "@/lib/activitySessionOverrides";
import { apiGet } from "@/lib/api";
import { errorStatus } from "@/lib/queryRetry";
import { getPublicProfileMap, type PublicProfile } from "@/lib/publicProfiles";
import { SessionPeopleRow, SessionScheduleRow } from "@/components/session";
import { consumeFirstRunWelcome, preserveIntendedRoute } from "@/lib/entryResolver";
import { getTodayHeroTiming } from "@/lib/todayHeroTiming";
import { activityTimingStatus, useActivityNow } from "@/lib/activityTiming";
import { getFirstName } from "@/lib/displayName";
import { activitySessionToPresentation, openBookingToPresentation } from "@/lib/sessionPresentation";
import { activitySessionOccurrenceInterval } from "@/lib/activitySessionTime";
import { fetchCourseHome, type CourseDetail, type MyCourseItem } from "@/lib/courses";
import { inheritedEventImages } from "@/lib/eventMedia";
import { useVerifiedAccount } from "@/hooks/useVerifiedAccount";
import { resolveCustomerVenueContext } from "@/lib/customerVenue";
import type { ActivitySessionOverride } from "@/lib/activitySessionOverrides";
import { SeriesRegistrationCard } from "@/components/series/SeriesRegistrationCard";
import { ResponsiveSupabaseImage } from "@/components/ResponsiveSupabaseImage";
import { CARD_ARTWORK_SIZES, CARD_ARTWORK_WIDTHS } from "@/lib/responsiveSupabaseImage";
import { occurrenceProgressLabel, seriesCustomerTitle, seriesPresentation } from "@/lib/seriesPresentation";
import { shareOrCopy } from "@/lib/share";
import { canonicalAppUrl } from "@/lib/canonicalOrigin";
import { fetchLeagueHome, type LeaguePublicProjection, type MyLeagueItem } from "@/lib/league";


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
const TOMORROW_SECTION_COLLAPSES_INTO_WEEKEND_WEEKDAYS = [5];

type FeedItem = {
  id: string;
  kind: "session" | "event" | "booking" | "open_booking";
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
  priceResolved?: boolean;
  isSpecialPass?: boolean;
  firstVisitOffer?: {
    state: "conditional" | "eligible";
    label: string;
    priceSek: number;
    regularPriceSek: number;
  } | null;
  imageUrls?: string[];
  onlineCheaper?: boolean;
  participants?: PublicProfile[];
  resourceNames?: string[];
  hostFirstName?: string | null;
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
    early_bird_price_minor?: number | null;
    early_bird_slots?: number | null;
    scarcity_mode?: string | null;
    first_visit_offer_enabled?: boolean;
    first_visit_price_minor?: number | null;
    first_visit_only?: boolean;
    image_urls?: string[];
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
  early_bird_price_minor?: number | null;
  early_bird_slots?: number | null;
  scarcity_mode?: string | null;
  first_visit_offer_enabled?: boolean;
  first_visit_price_minor?: number | null;
  first_visit_only?: boolean;
  activity_series?: {
    image_urls?: string[] | null;
    activity_formats?: { image_urls?: string[] | null } | null;
  } | null;
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

type ActivitySocialProofRow = {
  activity_session_id: string;
  session_date: string;
  registrations_count: number;
  interested_count: number;
  user_is_interested: boolean;
};

type OpenBookingItem = {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  open_spots: number;
  public_capacity?: number | null;
  total_players?: number | null;
  opened_places?: number | null;
  committed_at_publication?: number | null;
  pace_label: string;
  booker_first_name: string;
  committed_count?: number | null;
  claim_url: string;
  courts?: Array<{ name?: string | null; court_number?: number | null }>;
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
  logo_url?: string | null;
  background_url?: string | null;
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

function programChatResourceId(sessionId: string, occurrenceDate: string) {
  return `activity_session:${sessionId}:${occurrenceDate}`;
}

type TodayPrimaryResponse = {
  venue: { id: string; name: string; slug: string };
  sessions: SessionRow[];
  events: EventRow[];
  overrides: ActivitySessionOverride[];
  registrationCounts: Array<{
    activity_session_id: string;
    session_date: string;
    registrations_count: number;
  }>;
};

type TodayEnrichment = {
  socialProofByKey: Map<string, ActivitySocialProofRow>;
  registrationCounts: Map<string, number>;
  userRegistrationStatusByKey: Map<string, string | null>;
  participantUserIdsByKey: Map<string, string[]>;
  publicProfilesByUserId: Map<string, PublicProfile | null>;
  bookingItems: FeedItem[];
  openBookingItems: FeedItem[];
};

function sessionOccurrencesForRange(sessions: SessionRow[], now: DateTime) {
  const sessionOccurrences: SessionOccurrence[] = [];
  const isPastOccurrence = (date: DateTime, startTime: string | null | undefined, endTime: string | null | undefined) => {
    if (!date.hasSame(now, "day") || !endTime) return false;
    const interval = activitySessionOccurrenceInterval(date.toISODate(), startTime, endTime);
    return !interval || interval.end <= now;
  };

  for (const session of sessions) {
    if (session.session_date) {
      const date = DateTime.fromISO(session.session_date, { zone: "Europe/Stockholm" });
      if (date >= now.startOf("day") && date < now.plus({ days: DAYS_AHEAD }).startOf("day")) {
        const occurrenceDate = date.toISODate();
        if (occurrenceDate && !isPastOccurrence(date, session.start_time, session.end_time)) {
          sessionOccurrences.push({ ...session, occurrence_date: occurrenceDate });
        }
      }
      continue;
    }
    for (let offset = 0; offset < DAYS_AHEAD; offset += 1) {
      const date = now.plus({ days: offset });
      if ((session.recurrence_days || []).includes(date.weekday % 7)) {
        const occurrenceDate = date.toISODate();
        if (occurrenceDate && !isPastOccurrence(date, session.start_time, session.end_time)) {
          sessionOccurrences.push({ ...session, occurrence_date: occurrenceDate });
        }
      }
    }
  }
  return sessionOccurrences;
}

function sessionFeedItem(session: SessionOccurrence, registrationsCount: number, slug: string): FeedItem {
  const capacity = Number(session.capacity || 0);
  const metadata = session.metadata || {};
  const pricingMode = String(metadata.pricing_mode || "standard");
  const isSpecialPass = pricingMode === "fixed_ticket" || pricingMode === "member_discount";
  const onlinePrice = Number(metadata.online_price_sek ?? session.price_sek ?? 0);
  const deskPrice = Number(metadata.desk_price_sek ?? onlinePrice);
  const spotsLeft = capacity ? Math.max(capacity - registrationsCount, 0) : null;
  const earlyPrice = earlyBirdPriceSek(session, registrationsCount);
  return {
    id: `session:${session.id}:${session.occurrence_date}`,
    kind: "session",
    title: session.name,
    date: session.occurrence_date,
    startTime: String(session.start_time).slice(0, 5),
    endTime: String(session.end_time).slice(0, 5),
    category: session.session_type === "open_play" ? "Open Play" : session.session_type === "group_training" ? "Träning" : session.session_type || "Pass",
    status: capacity && registrationsCount >= capacity ? "Full" : "Drop-in",
    spotsLeft,
    registrationsCount,
    priceSek: earlyPrice ?? (onlinePrice || Number(session.price_sek || 0)),
    priceResolved: false,
    isSpecialPass,
    imageUrls: inheritedEventImages(session),
    onlineCheaper: isSpecialPass && deskPrice > onlinePrice,
    participants: [],
    activitySession: session,
    capacity,
    href: `/program/${session.id}?date=${session.occurrence_date}&v=${slug}`,
    cta: capacity && registrationsCount >= capacity ? "Visa" : "Anmäl",
    chatResourceId: programChatResourceId(session.id, session.occurrence_date),
    chatTitle: session.name,
    chatSubtitle: `${session.occurrence_date} · ${String(session.start_time).slice(0, 5)}-${String(session.end_time).slice(0, 5)}`,
    chatEmoji: "📅",
  };
}

function useTodayPrimaryFeed(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: ["today-primary", slug],
    enabled,
    staleTime: 30000,
    retry: false,
    queryFn: async ({ client, queryKey }) => {
      const now = DateTime.now().setZone("Europe/Stockholm");
      const startDate = now.toISODate()!;
      const endDate = now.plus({ days: DAYS_AHEAD - 1 }).toISODate()!;
      const response = await apiGet<TodayPrimaryResponse>("api-event-public", "today-primary", {
        venueSlug: slug,
        startDate,
        endDate,
      }, {
        auth: "omit",
        publicRead: {
          maxRetries: 1,
          retryDelayMs: 250,
          staleRetained: Boolean(client.getQueryData(queryKey)),
        },
      });
      const sessionOccurrences = sessionOccurrencesForRange(response.sessions || [], now);
      const overrideMap = new Map((response.overrides || []).map((row) => [
        occurrenceOverrideKey(row.activity_session_id, row.session_date),
        row,
      ]));
      const primaryCounts = new Map((response.registrationCounts || []).map((row) => [
        `${row.activity_session_id}:${row.session_date}`,
        Number(row.registrations_count || 0),
      ]));
      const visibleSessionOccurrences = sessionOccurrences.filter((session) => {
        const occurrenceKey = occurrenceOverrideKey(session.id, session.occurrence_date);
        const override = overrideMap.get(occurrenceKey);
        return !isPublicActivityOverrideHidden(override?.status);
      });
      const sessionItems = visibleSessionOccurrences.map((session) => sessionFeedItem(
        session,
        primaryCounts.get(`${session.id}:${session.occurrence_date}`) || 0,
        slug,
      ));
      const eventItems: FeedItem[] = (response.events || []).map((event) => ({
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
        imageUrls: [event.background_url || event.logo_url].filter(Boolean) as string[],
      }));

      return {
        venue: response.venue,
        sessionOccurrences: visibleSessionOccurrences,
        items: [...sessionItems, ...eventItems].sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`)),
      };
    },
  });
}

function useTodayEnrichment(
  venueId: string | undefined,
  sessionOccurrences: SessionOccurrence[],
  userId: string | undefined,
  slug: string,
  enabled: boolean,
) {
  const sessionSignature = sessionOccurrences.map((session) => `${session.id}:${session.occurrence_date}`).join(",");
  return useQuery({
    queryKey: ["today-feed-enrichment", venueId, userId || "guest", sessionSignature],
    enabled: enabled && Boolean(venueId),
    staleTime: 30_000,
    queryFn: async (): Promise<TodayEnrichment> => {
      const now = DateTime.now().setZone("Europe/Stockholm");
      const startDate = now.toISODate()!;
      const endDate = now.plus({ days: DAYS_AHEAD - 1 }).toISODate()!;
      const startUtc = now.startOf("day").toUTC().toISO()!;
      const endUtc = now.plus({ days: DAYS_AHEAD }).startOf("day").toUTC().toISO()!;
      const sessionIds = [...new Set(sessionOccurrences.map((session) => session.id))];
      const [registrationsRes, socialProofRes, bookingsRes, openBookingsRes] = await Promise.all([
        sessionIds.length
          ? supabase
              .from("session_registrations")
              .select("activity_session_id, session_date, status, user_id")
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
            }, userId ? {} : { auth: "omit" }).catch(() => ({ occurrences: [] }))
          : Promise.resolve({ occurrences: [] }),
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
        apiGet<{ items: OpenBookingItem[] }>("api-bookings", "public-open-bookings", {
          slug,
          date: startDate,
          days: String(DAYS_AHEAD),
        }, { auth: "omit" }).catch(() => ({ items: [] })),
      ]);

      const registrationCounts = new Map<string, number>();
      const registrationsByKey = new Map<string, RegistrationRow[]>();
      const userRegistrationStatusByKey = new Map<string, string | null>();
      for (const row of registrationsRes.data || []) {
        if (row.status === "cancelled" || row.status === "refunded") continue;
        const key = `${row.activity_session_id}:${row.session_date}`;
        registrationCounts.set(key, (registrationCounts.get(key) || 0) + 1);
        if (userId && row.user_id === userId) {
          const currentStatus = userRegistrationStatusByKey.get(key);
          if (currentStatus !== "checked_in") userRegistrationStatusByKey.set(key, row.status || "confirmed");
        }
        registrationsByKey.set(key, [...(registrationsByKey.get(key) || []), row]);
      }
      const participantUserIdsByKey = new Map<string, string[]>();
      for (const [key, rows] of registrationsByKey.entries()) {
        participantUserIdsByKey.set(key, [...new Set(rows.map((row) => row.user_id).filter(Boolean) as string[])].slice(0, 3));
      }
      const participantUserIds = [...new Set([...participantUserIdsByKey.values()].flat())];
      const publicProfilesByUserId = participantUserIds.length
        ? await getPublicProfileMap(participantUserIds).catch(() => new Map<string, PublicProfile | null>())
        : new Map<string, PublicProfile | null>();
      const socialProofByKey = new Map<string, ActivitySocialProofRow>();
      for (const row of socialProofRes.occurrences || []) {
        socialProofByKey.set(`${row.activity_session_id}:${row.session_date}`, row);
      }

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

      const openBookingItems: FeedItem[] = ((openBookingsRes as { items?: OpenBookingItem[] })?.items || []).map((item) => {
        const start = DateTime.fromISO(item.start_time, { zone: "utc" }).setZone("Europe/Stockholm");
        const end = DateTime.fromISO(item.end_time, { zone: "utc" }).setZone("Europe/Stockholm");
        const capacity = Number(item.public_capacity || item.total_players || 0);
        const committed = Number(item.committed_count || 0);
        const courtLabel = (item.courts || [])
          .map((court) => court.name || (court.court_number ? `Bana ${court.court_number}` : null))
          .filter(Boolean)
          .join(", ");
        let href = item.claim_url;
        try {
          const url = new URL(item.claim_url);
          href = `${url.pathname}${url.search}`;
        } catch {
          // Keep absolute fallback from the API if URL parsing fails.
        }
        return {
          id: `open-booking:${item.id}`,
          kind: "open_booking",
          title: item.booker_first_name ? `Häng på ${item.booker_first_name}` : "Häng på en bana",
          date: start.toISODate()!,
          startTime: start.toFormat("HH:mm"),
          endTime: end.toFormat("HH:mm"),
          category: item.pace_label,
          status: item.open_spots > 0 ? "Öppen" : "Full",
          spotsLeft: item.open_spots,
          registrationsCount: committed,
          participants: [],
          resourceNames: courtLabel ? [courtLabel] : [],
          hostFirstName: item.booker_first_name,
          capacity,
          href,
          cta: "Häng på",
          chatSubtitle: courtLabel,
        };
      });

      return {
        socialProofByKey,
        registrationCounts,
        userRegistrationStatusByKey,
        participantUserIdsByKey,
        publicProfilesByUserId,
        bookingItems,
        openBookingItems,
      };
    },
  });
}

function enrichTodayItems(primaryItems: FeedItem[], enrichment?: TodayEnrichment) {
  if (!enrichment) return primaryItems;
  const enrichedPrimary = primaryItems.map((item) => {
    if (item.kind !== "session" || !item.activitySession) return item;
    const key = `${item.activitySession.id}:${item.date}`;
    const socialProof = enrichment.socialProofByKey.get(key);
    const count = socialProof?.registrations_count ?? enrichment.registrationCounts.get(key) ?? item.registrationsCount ?? 0;
    const capacity = Number(item.capacity || 0);
    const userRegistrationStatus = enrichment.userRegistrationStatusByKey.get(key) || null;
    return {
      ...item,
      status: capacity && count >= capacity ? "Full" : "Drop-in",
      spotsLeft: capacity ? Math.max(capacity - count, 0) : null,
      registrationsCount: count,
      userIsInterested: Boolean(socialProof?.user_is_interested),
      userIsRegistered: Boolean(userRegistrationStatus),
      userIsCheckedIn: userRegistrationStatus === "checked_in",
      userRegistrationStatus,
      participants: (enrichment.participantUserIdsByKey.get(key) || [])
        .map((participantUserId) => enrichment.publicProfilesByUserId.get(participantUserId))
        .filter(Boolean) as PublicProfile[],
      cta: capacity && count >= capacity ? "Visa" : "Anmäl",
    };
  });
  return [...enrichedPrimary, ...enrichment.openBookingItems, ...enrichment.bookingItems]
    .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));
}

function useFirstVisitOffers(slug: string, userId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["first-visit-offers", slug, userId || "guest"],
    enabled,
    staleTime: userId ? 0 : 30_000,
    queryFn: () => apiGet<ActivityDiscoveryPricingResponse>("api-event-public", "first-visit-offers", { venueSlug: slug }, userId ? {} : { auth: "omit" }),
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
  const openItem = async () => {
    if (item.kind === "session") {
      navigate(item.href, { state: { backgroundLocation: location, activitySession: item.activitySession } });
      return;
    }

    if (item.kind === "open_booking") {
      navigate(item.href, { state: { backgroundLocation: location } });
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

  const presentation =
    item.kind === "open_booking"
      ? openBookingToPresentation({
          id: item.id,
          bookerFirstName: item.hostFirstName,
          startsAt: DateTime.fromISO(`${item.date}T${item.startTime}`, { zone: "Europe/Stockholm" }).toISO()!,
          endsAt: DateTime.fromISO(`${item.date}T${item.endTime || item.startTime}`, { zone: "Europe/Stockholm" }).toISO()!,
          resourceNames: item.resourceNames,
          people: item.participants,
          committedCount: item.registrationsCount,
          capacity: item.capacity,
          placesLeft: item.spotsLeft,
          pace: item.category,
          pricing: { kind: "status", label: "Din del av banan" },
          primaryAction: { key: "open", label: item.cta },
          route: item.href,
          now,
        })
      : activitySessionToPresentation({
          id: item.id,
          typeLabel: item.firstVisitOffer?.label || (item.isSpecialPass ? "SPECIALPASS" : item.category),
          title: item.title,
          sessionDate: item.date,
          startTime: item.startTime,
          endTime: item.endTime || item.startTime,
          resourceNames: item.resourceNames,
          imageUrls: item.imageUrls,
          people: item.participants,
          committedCount: item.registrationsCount,
          capacity: item.capacity,
          placesLeft: item.spotsLeft,
          pricing:
            item.kind === "session"
              ? !item.priceResolved
                ? null
                : Number(item.priceSek || 0) <= 0
                ? { kind: "included", label: "Ingår", amountSek: 0 }
                : { kind: "amount", amountSek: item.priceSek }
              : null,
          primaryAction: { key: "open", label: item.cta },
          route: item.href,
          now,
        });

  return (
    <SessionScheduleRow
      presentation={presentation}
      onClick={openItem}
      disabled={opening}
      emphasis={emphasis === "secondary" ? "future" : "today"}
      className={[
        isPast || item.status === "Full" ? "opacity-50" : "",
        item.isSpecialPass ? "border-pink-200 bg-pink-50" : "",
        highlight ? "bg-[#ece7e2]" : "",
      ].join(" ")}
    />
  );
}

function itemEndDateTime(item: FeedItem) {
  const endTime = item.endTime || item.startTime;
  return DateTime.fromISO(`${item.date}T${endTime}`, { zone: "Europe/Stockholm" });
}

function isJoinableItem(item: FeedItem, now: DateTime) {
  return item.status !== "Full" && itemEndDateTime(item) > now;
}

function sortBySoonestThenPeople(items: FeedItem[]) {
  return [...items].sort((a, b) => {
    const timeCompare = `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`);
    if (timeCompare !== 0) return timeCompare;
    return Number(b.registrationsCount || 0) - Number(a.registrationsCount || 0);
  });
}

function earlyBirdPriceSek(session: SessionOccurrence, registrationsCount: number) {
  const metadata = session.metadata || {};
  const priceMinor = Number(session.early_bird_price_minor ?? metadata.early_bird_price_minor ?? 0);
  const slots = Number(session.early_bird_slots ?? metadata.early_bird_slots ?? 0);
  const mode = String(session.scarcity_mode ?? metadata.scarcity_mode ?? "none");
  if (mode !== "early_bird" || priceMinor <= 0 || slots <= 0) return null;
  return registrationsCount < slots ? Math.round(priceMinor) / 100 : null;
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
  const activityStatus = item
    ? activityTimingStatus({
        sessionDate: item.date,
        startTime: item.startTime,
        endTime: item.endTime,
        now,
      })
    : null;
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
        {item?.imageUrls?.[0] ? <ResponsiveSupabaseImage
          src={item.imageUrls[0]}
          alt=""
          sizes={CARD_ARTWORK_SIZES}
          widths={CARD_ARTWORK_WIDTHS}
          width={1280}
          height={720}
          priority
          className="-mx-5 -mt-5 mb-5 aspect-video w-[calc(100%+2.5rem)] object-cover"
          data-testid="featured-identity-image"
        /> : null}
        <p className="text-[11px] font-black uppercase tracking-[0.22em]" style={{ fontFamily: FONT_MONO, color: PINK }}>
          {item?.firstVisitOffer?.label || activityStatus?.stateLabel || timing.eyebrow}
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
            {activityStatus?.detailLabel || timing.subtitle}
          </p>
        </div>

        <div className="mt-6 grid gap-4">
          <div className="min-w-0">
            <SessionPeopleRow
              presentation={{
                people: item?.participants ?? [],
                committedCount: item?.registrationsCount ?? 0,
                capacity: item?.kind === "open_booking" ? item.capacity : null,
                placesLeft: item?.kind === "open_booking" ? item.spotsLeft : null,
              }}
              variant="drawer"
              showInvitation
            />
            {item?.kind === "open_booking" ? (
              <p className="mt-2 text-[12px]" style={{ color: MUTED }}>
                Din del av banan
              </p>
            ) : null}
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
  const verifiedAccount = useVerifiedAccount();
  const [welcomeLine] = useState(() => consumeFirstRunWelcome() ? "Välkommen till Pickla" : null);
  const venueContext = resolveCustomerVenueContext(searchParams.get("v"));
  const slug = venueContext.slug;
  const { data: venue, isLoading: venueLoading, isError: venueError } = useVenueWithHours(slug);
  const primaryEnabled = venueContext.canUseBeforeRemoteValidation || venue?.slug === slug;
  const primary = useTodayPrimaryFeed(slug, primaryEnabled);
  const primaryStatus = errorStatus(primary.error);
  const primaryVenueNotFound = primary.isError && primaryStatus === 404;
  const primaryRefreshFailed = Boolean(primary.data) && primary.isError && (
    primaryStatus === null
      ? (primary.error as { name?: unknown } | null)?.name !== "AbortError"
      : primaryStatus >= 500 && primaryStatus < 600
  );
  const primaryHardError = primary.isError && !primaryRefreshFailed;
  const venueId = venue?.id || primary.data?.venue.id;
  const identityReady = verifiedAccount.state === "anonymous" || verifiedAccount.state === "verified";
  const enrichment = useTodayEnrichment(
    venueId,
    primary.data?.sessionOccurrences || [],
    verifiedAccount.verifiedUserId || undefined,
    slug,
    Boolean(primary.data) && identityReady,
  );
  const rawItems = useMemo(
    () => enrichTodayItems(primary.data?.items || [], enrichment.data),
    [enrichment.data, primary.data?.items],
  );
  const { data: firstVisitOffers } = useFirstVisitOffers(
    slug,
    verifiedAccount.verifiedUserId || undefined,
    Boolean(primary.data) && identityReady,
  );
  const pricingByOccurrence = useMemo(() => new Map(
    (firstVisitOffers?.pricing || []).map((pricing) => [`${pricing.activity_session_id}:${pricing.session_date}`, pricing]),
  ), [firstVisitOffers?.pricing]);
  const items = useMemo(() => rawItems.map((item) => {
    if (item.kind !== "session" || !item.activitySession?.id) return item;
    const pricing = pricingByOccurrence.get(`${item.activitySession.id}:${item.date}`);
    if (!pricing?.customer_presentation) return item;
    const customerPrice = pricing.customer_presentation;
    return {
      ...item,
      priceSek: customerPrice.displayPriceSek,
      priceResolved: true,
      firstVisitOffer: customerPrice.offerState && customerPrice.offerLabel ? {
        state: customerPrice.offerState,
        label: customerPrice.offerLabel,
        priceSek: pricing.effective_price_sek,
        regularPriceSek: customerPrice.listPriceSek,
      } : null,
    };
  }), [pricingByOccurrence, rawItems]);
  const { data: courseHome } = useQuery({
    queryKey: ["course-home", slug, verifiedAccount.verifiedUserId || "guest"],
    enabled: Boolean(primary.data) && identityReady,
    queryFn: () => fetchCourseHome(slug, verifiedAccount.verifiedUserId ? undefined : { auth: "omit" }),
    staleTime: 30000,
  });
  const { data: leagueHome } = useQuery({
    queryKey: ["league-home", slug, verifiedAccount.verifiedUserId || "guest"],
    enabled: Boolean(primary.data) && identityReady,
    queryFn: () => fetchLeagueHome(slug, verifiedAccount.verifiedUserId ? undefined : { auth: "omit" }),
    staleTime: 30000,
  });
  const now = useActivityNow();
  const userName = getFirstName({
    playerProfile: verifiedAccount.account?.profile,
    customer: verifiedAccount.account?.customer,
    authUser: verifiedAccount.isVerified ? user : null,
  });
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

  const activityItems = items.filter((item) => item.kind === "session" || item.kind === "event" || item.kind === "open_booking");
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

  const todayListItems = todayActivities.filter((item) => item.id !== featuredItem?.id);
  const showWeekendSection = WEEKEND_SECTION_TRIGGER_WEEKDAYS.includes(now.weekday);
  const showTomorrowSection = !TOMORROW_SECTION_COLLAPSES_INTO_WEEKEND_WEEKDAYS.includes(now.weekday);
  const daysUntilSaturday = (6 - now.weekday + 7) % 7 || 7;
  const saturdayKey = now.plus({ days: daysUntilSaturday }).toISODate();
  const sundayKey = now.plus({ days: daysUntilSaturday + 1 }).toISODate();
  const tomorrowItems = showTomorrowSection
    ? sortBySoonestThenPeople(
      tomorrowActivities
        .filter((item) => item.id !== featuredItem?.id)
        .filter((item) => isJoinableItem(item, now))
    )
    : [];
  const weekendItems = showWeekendSection
    ? sortBySoonestThenPeople(
      activityItems
        .filter((item) => item.date === saturdayKey || item.date === sundayKey)
        .filter((item) => item.id !== featuredItem?.id)
        .filter((item) => isJoinableItem(item, now))
    ).slice(0, HORIZON_SECTION_MAX_ROWS)
    : [];
  const horizonSections = [
    { heading: "Imorgon", items: tomorrowItems },
    { heading: "I helgen", items: weekendItems },
  ].filter((section) => section.items.length > 0);
  const { data: featuredPreview } = useQuery({
    queryKey: ["today-featured-preview", verifiedAccount.verifiedUserId || "anon", featuredItem?.id],
    enabled: identityReady && !!featuredItem?.activitySession?.id,
    staleTime: verifiedAccount.verifiedUserId ? 0 : 15000,
    queryFn: () => apiGet<any>("api-event-public", "activity-preview", {
      sessionId: featuredItem!.activitySession!.id,
      date: featuredItem!.date,
      venueSlug: slug,
    }, verifiedAccount.verifiedUserId ? {} : { auth: "omit" }),
  });
  const featuredPricing = featuredPreview?.activityTicketPricing || featuredPreview?.pricing || null;
  const featuredIncluded = featuredPricing?.requiresCheckout === false;
  const featuredPriceLabel = featuredIncluded
    ? null
    : featuredPricing?.customerPresentation?.displayLabel ||
      featuredPricing?.checkoutLabel ||
      null;
  const openFeatured = () => {
    if (!featuredItem) return;
    if (featuredItem.kind === "session") {
      navigate(featuredItem.href, { state: { backgroundLocation: location, activitySession: featuredItem.activitySession } });
      return;
    }
    navigate(featuredItem.href);
  };
  const shareOwnedSeries = async (item: MyCourseItem) => {
    const title = seriesCustomerTitle({
      seriesName: item.series.name,
      formatName: item.series.format_name,
      presentationType: item.series.presentation_type,
    });
    const path = `/course/${encodeURIComponent(item.series.id)}?v=${encodeURIComponent(slug)}`;
    const result = await shareOrCopy({ title, text: title, url: canonicalAppUrl(path), copyText: canonicalAppUrl(path) });
    if (result === "copied") toast.success("Länk kopierad");
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
        {primaryVenueNotFound || (!primaryEnabled && venueError) ? (
          <section className="mx-auto grid min-h-[330px] max-w-md place-items-center px-5 pt-2 text-center text-sm font-semibold text-neutral-500">
            Arenan kunde inte hittas.
          </section>
        ) : primaryHardError ? (
          <section className="mx-auto grid min-h-[330px] max-w-md place-items-center px-5 pt-2 text-center">
            <div><p className="text-sm font-semibold text-neutral-500">Dagens schema kunde inte hämtas.</p><button type="button" onClick={() => void primary.refetch()} className="mt-4 rounded-full border border-black/15 px-4 py-2 text-sm font-black">Försök igen</button></div>
          </section>
        ) : (!primaryEnabled && venueLoading) || primary.isLoading ? (
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

        {primaryRefreshFailed ? (
          <section className="mx-auto max-w-md px-5 pt-3" aria-live="polite" data-testid="today-refresh-warning">
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-black/10 bg-white/70 px-4 py-3 text-sm font-semibold text-neutral-600">
              <span>Kunde inte uppdatera just nu</span>
              <button type="button" onClick={() => void primary.refetch()} className="shrink-0 font-black text-neutral-950">Försök igen</button>
            </div>
          </section>
        ) : null}

        <section className="mx-auto max-w-md px-5 pt-7">
          {(!primaryEnabled && venueLoading) || primary.isLoading || primaryHardError || primaryVenueNotFound || (!primaryEnabled && venueError) ? (
            null
          ) : (
            <div className="space-y-8">
              {firstVisitOffers?.is_first_time && (firstVisitOffers.items?.length > 0 || !firstVisitOffers.has_configured_offer) ? (
                <button type="button" onClick={() => navigate(firstVisitOffers.items?.[0]?.route || `/today?v=${encodeURIComponent(slug)}`)} className="flex w-full items-center justify-between gap-4 border-y border-black/10 py-4 text-left text-[14px] font-bold">
                  <span>{firstVisitOffers.items?.length ? <><span className="block">Första gången? Spela för 99 kr.</span><span className="mt-1 block text-[12px] font-semibold text-neutral-500">Racket finns att låna.</span></> : "Första gången? 165 kr, racket ingår — kom på Open Play ikväll."}</span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-neutral-400" />
                </button>
              ) : null}
              {leagueHome?.mode === "registration" && leagueHome.item ? (() => {
                const league = leagueHome.item as LeaguePublicProjection;
                return <button type="button" onClick={() => navigate(`/seriespel/${league.series.id}?v=${encodeURIComponent(slug)}`)} className="w-full overflow-hidden rounded-[24px] bg-white text-left" style={{ border: `1px solid ${BORDER}` }} data-testid="league-home-offer">
                  {league.series.image_urls?.[0] ? <ResponsiveSupabaseImage src={league.series.image_urls[0]} alt={league.series.name} sizes={CARD_ARTWORK_SIZES} widths={CARD_ARTWORK_WIDTHS} width={960} height={540} className="aspect-[16/9] w-full object-cover" /> : null}
                  <div className="p-5"><p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: PINK, fontFamily: FONT_MONO }}>Seriespel</p><h2 className="mt-2 text-xl font-black" style={{ fontFamily: FONT_HEADING }}>{league.series.name}</h2><p className="mt-2 text-sm font-semibold" style={{ color: MUTED }}>6 lag · 5 torsdagar · 2 matcher per kväll</p><div className="mt-4 flex items-center justify-between"><p className="font-black">{formatSek(league.current_price_minor / 100)} / lag</p><span className="rounded-full bg-neutral-950 px-4 py-2 text-sm font-black text-white">Anmäl lag</span></div></div>
                </button>;
              })() : null}
              {leagueHome?.mode === "next" && leagueHome.item ? (() => {
                const league = leagueHome.item as MyLeagueItem;
                return <section className="w-full rounded-[24px] bg-white p-5 text-left" style={{ border: `1px solid ${BORDER}` }} data-testid="owned-league-home-card"><p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: PINK, fontFamily: FONT_MONO }}>Seriespel</p><h2 className="mt-2 text-xl font-black" style={{ fontFamily: FONT_HEADING }}>{league.team.team_name}</h2><p className="mt-2 text-sm font-semibold" style={{ color: MUTED }}>{league.next_session ? `Nästa: ${DateTime.fromISO(league.next_session.session_date).setLocale("sv").toFormat("cccc d LLL")} · ${String(league.next_session.start_time).slice(0, 5)}` : league.series.name}</p><p className="mt-3 flex items-center gap-1.5 text-sm font-bold"><Check className="h-4 w-4" /> Ditt lag är anmält</p><button type="button" onClick={() => navigate(`/seriespel/${league.series.id}?v=${encodeURIComponent(slug)}`)} className="mt-4 rounded-full bg-neutral-950 px-4 py-2 text-sm font-black text-white">Visa Seriespel</button></section>;
              })() : null}
              {courseHome?.mode === "registration" && courseHome.item ? (() => {
                const course = courseHome.item as CourseDetail;
                return (
                  <SeriesRegistrationCard
                    series={course}
                    onOpen={() => navigate(`/course/${course.id}?v=${encodeURIComponent(slug)}`)}
                    imagePriority={!featuredItem?.imageUrls?.[0]}
                  />
                );
              })() : null}
              {courseHome?.mode === "next" && courseHome.item ? (() => {
                const item = courseHome.item as MyCourseItem;
                const presentation = seriesPresentation(item.series.presentation_type);
                const customerTitle = seriesCustomerTitle({
                  seriesName: item.series.name,
                  formatName: item.series.format_name,
                  presentationType: presentation.type,
                });
                const occurrenceCopy = presentation.hideSingleOccurrenceCount && item.total_sessions === 1
                  ? null
                  : occurrenceProgressLabel(Math.min(item.completed_sessions + 1, item.total_sessions), item.total_sessions);
                const destination = `/course/${item.series.id}?v=${encodeURIComponent(slug)}`;
                return (
                  <section className="w-full rounded-[24px] bg-white p-5 text-left" style={{ border: `1px solid ${BORDER}` }} data-testid="owned-series-home-card">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: PINK, fontFamily: FONT_MONO }}>Nästa</p>
                    <h2 className="mt-2 text-xl font-black" style={{ fontFamily: FONT_HEADING }}>{customerTitle}</h2>
                    <p className="mt-2 text-sm font-semibold" style={{ color: MUTED }}>{[occurrenceCopy, item.next_session ? DateTime.fromISO(item.next_session.session_date).setLocale("sv").toFormat("cccc HH:mm").replace("00:00", String(item.next_session.start_time).slice(0, 5)) : null].filter(Boolean).join(" · ")}</p>
                    <p className="mt-3 flex items-center gap-1.5 text-sm font-bold"><Check className="h-4 w-4" /> Du har en plats</p>
                    <div className="mt-4 flex gap-2">
                      <button type="button" onClick={() => navigate(destination)} className="rounded-full bg-neutral-950 px-4 py-2 text-sm font-black text-white">Visa</button>
                      {presentation.type === "social_event" ? <button type="button" onClick={() => void shareOwnedSeries(item)} className="flex items-center gap-2 rounded-full border border-black/15 px-4 py-2 text-sm font-black"><Share2 className="h-4 w-4" /> Dela</button> : null}
                    </div>
                  </section>
                );
              })() : null}
              {todayListItems.length > 0 && (
                <section>
                  <h2 className="mb-4 text-[28px] leading-none tracking-[-0.04em]" style={{ fontFamily: FONT_HEADING }}>
                    Mer händer idag
                  </h2>
                  <div className="space-y-2">
                    {todayListItems.map((item) => (
                      <FeedRow key={item.id} item={item} now={now} highlight={item.id === liveHighlightId} venueId={venueId} slug={slug} />
                    ))}
                  </div>
                </section>
              )}

              {horizonSections.map((section) => (
                <section key={section.heading}>
                  <h2 className="mb-4 text-[24px] leading-none tracking-[-0.03em]" style={{ fontFamily: FONT_HEADING }}>
                    {section.heading}
                  </h2>
                  <div className="space-y-2">
                    {section.items.map((item) => (
                      <FeedRow
                        key={item.id}
                        item={item}
                        now={now}
                        highlight={false}
                        venueId={venueId}
                        slug={slug}
                        emphasis="secondary"
                      />
                    ))}
                  </div>
                </section>
              ))}

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
