import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { ArrowRight, BookOpen, CalendarDays, Loader2, MapPin, Menu, MessageCircle, UserRound, X, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import {
  getBookingChatResourceId,
  getBookingCourtLabel,
  groupBookingRows,
} from "@/lib/bookingGroups";
import picklaLogo from "@/assets/pickla-logo.svg";
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
};

type SessionOccurrence = SessionRow & {
  occurrence_date: string;
};

type RegistrationRow = {
  activity_session_id: string;
  session_date: string;
  status: string | null;
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
      const { data } = await supabase
        .from("venues")
        .select("id, name, slug, address, city, description, cover_image_url")
        .eq("slug", slug)
        .maybeSingle();
      return data;
    },
  });
}

function usePlayerProfile(userId: string | undefined) {
  return useQuery({
    queryKey: ["today-player-profile", userId],
    enabled: !!userId,
    staleTime: 60000,
    queryFn: async () => {
      const { data } = await supabase
        .from("player_profiles")
        .select("display_name, avatar_url")
        .eq("auth_user_id", userId!)
        .maybeSingle();
      return data;
    },
  });
}

function useVenueOpenStatus(venueId: string | undefined) {
  return useQuery({
    queryKey: ["today-open-status", venueId],
    enabled: !!venueId,
    staleTime: 60000,
    queryFn: async () => {
      const now = DateTime.now().setZone("Europe/Stockholm");
      const { data } = await supabase
        .from("opening_hours")
        .select("day_of_week, open_time, close_time, is_closed")
        .eq("venue_id", venueId!)
        .order("day_of_week");
      const openingHours = (data || []) as OpeningHour[];
      const today = openingHours.find((row) => row.day_of_week === now.weekday % 7);
      if (!today || today.is_closed || !today.open_time || !today.close_time) {
        return { open: false, label: "Stängt idag", openingHours };
      }
      const nowTime = now.toFormat("HH:mm");
      const openTime = String(today.open_time).slice(0, 5);
      const closeTime = String(today.close_time).slice(0, 5);
      const open = nowTime >= openTime && nowTime < closeTime;
      const label = open ? `Öppet till ${closeTime} ikväll` : nowTime < openTime ? `Öppnar ${openTime} idag` : "Stängt för idag";
      return { open, label, openingHours };
    },
  });
}

function dayLabel(day: number) {
  return ["Sön", "Mån", "Tis", "Ons", "Tor", "Fre", "Lör"][day] || "";
}

function formatHour(time?: string | null) {
  return time ? String(time).slice(0, 5) : "";
}

function userDisplayName(user: ReturnType<typeof useAuth>["user"], profile?: { display_name?: string | null } | null) {
  if (profile?.display_name) return profile.display_name;
  if (!user) return "";
  const meta = user.user_metadata || {};
  return meta.display_name || meta.full_name || meta.name || user.email || "Mitt konto";
}

function userInitial(user: ReturnType<typeof useAuth>["user"], profile?: { display_name?: string | null } | null) {
  const name = userDisplayName(user, profile);
  return name ? name.trim().charAt(0).toUpperCase() : "";
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

      const [sessionsRes, eventsRes, bookingsRes] = await Promise.all([
        supabase
          .from("activity_sessions")
          .select("id, name, session_type, session_date, recurrence_days, start_time, end_time, capacity")
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
            if (occurrenceDate) sessionOccurrences.push({ ...session, occurrence_date: occurrenceDate });
          }
          continue;
        }
        for (let offset = 0; offset < DAYS_AHEAD; offset++) {
          const date = now.plus({ days: offset });
          if ((session.recurrence_days || []).includes(date.weekday % 7)) {
            const occurrenceDate = date.toISODate();
            if (occurrenceDate) sessionOccurrences.push({ ...session, occurrence_date: occurrenceDate });
          }
        }
      }

      const sessionIds = sessionOccurrences.map((session) => session.id);
      const registrationsRes = sessionIds.length
        ? await supabase
            .from("session_registrations")
            .select("activity_session_id, session_date, status")
            .in("activity_session_id", sessionIds)
            .gte("session_date", startDate)
            .lte("session_date", endDate)
        : { data: [] as RegistrationRow[] };

      const registrationCounts = new Map<string, number>();
      for (const row of registrationsRes.data || []) {
        if (row.status === "cancelled") continue;
        const key = `${row.activity_session_id}:${row.session_date}`;
        registrationCounts.set(key, (registrationCounts.get(key) || 0) + 1);
      }

      const sessionItems: FeedItem[] = sessionOccurrences.map((session) => {
        const count = registrationCounts.get(`${session.id}:${session.occurrence_date}`) || 0;
        const capacity = Number(session.capacity || 0);
        return {
          id: `session:${session.id}:${session.occurrence_date}`,
          kind: "session",
          title: session.name,
          date: session.occurrence_date,
          startTime: String(session.start_time).slice(0, 5),
          endTime: String(session.end_time).slice(0, 5),
          category: session.session_type === "open_play" ? "Open Play" : session.session_type === "group_training" ? "Träning" : session.session_type || "Pass",
          status: capacity && count >= capacity ? "Full" : "Drop-in",
          spotsLeft: capacity ? Math.max(capacity - count, 0) : null,
          href: `/program/${session.id}?date=${session.occurrence_date}&v=${slug}`,
          cta: capacity && count >= capacity ? "Visa" : "Anmäl",
          chatResourceId: session.id,
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
  const [opening, setOpening] = useState(false);
  const end = item.endTime ? DateTime.fromISO(`${item.date}T${item.endTime}`, { zone: "Europe/Stockholm" }) : null;
  const isPast = !!end && end < now;
  const meta = item.spotsLeft != null
    ? item.spotsLeft === 0 ? "Full" : `${item.spotsLeft} kvar`
    : item.status;
  const openItem = async () => {
    if (item.kind === "booking" || !item.chatResourceId || !venueId) {
      navigate(item.href);
      return;
    }
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
      className="grid w-full grid-cols-[64px_1fr_auto] items-center gap-2 px-3 py-3 text-left transition-transform active:scale-[0.99]"
      style={{
        background: highlight ? GREEN : SOFT,
        color: TEXT,
        opacity: isPast || item.status === "Full" ? 0.48 : 1,
        border: `1px solid ${highlight ? "rgba(50,239,135,0.55)" : BORDER}`,
        fontFamily: FONT_MONO,
      }}
    >
      <span className="text-[15px]">{item.startTime}</span>
      <span className="min-w-0 truncate text-[15px]">{item.title}</span>
      <span className="rounded-full bg-white/65 px-2 py-1 text-[10px] font-bold text-black/55">
        {opening ? "Öppnar" : meta}
      </span>
    </button>
  );
}

export default function TodayPage() {
  const [searchParams] = useSearchParams();
  const [venueSheetOpen, setVenueSheetOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeGuide, setActiveGuide] = useState<GuideKey | null>(null);
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const slug = searchParams.get("v") || "pickla-arena-sthlm";
  const { data: venue, isLoading: venueLoading } = useVenue(slug);
  const { data: profile } = usePlayerProfile(user?.id);
  const { data: status } = useVenueOpenStatus(venue?.id);
  const { data: items = [], isLoading } = useTodayFeed(venue?.id, user?.id, slug);
  const now = DateTime.now().setZone("Europe/Stockholm");
  const menuBookings = items.filter((item) => item.kind === "booking").slice(0, 5);
  const heroImage = venue?.cover_image_url || heroPhoto;
  const heroText = venue?.description?.trim() || "Weekend Vibes";
  const openGuide = (guideKey: GuideKey) => {
    setMenuOpen(false);
    setActiveGuide(guideKey);
  };
  const go = (href: string) => {
    setMenuOpen(false);
    setActiveGuide(null);
    navigate(href);
  };
  const openDailyRoom = async () => {
    if (!venue?.id) return;
    const { data } = await supabase.rpc("upsert_daily_chat_room", {
      p_venue_id: venue.id,
      p_session_date: DateTime.now().setZone("Europe/Stockholm").toISODate(),
      p_name: "Pickla Idag",
    });
    const room = data?.[0];
    navigate(room?.id ? `/chat/${room.id}?v=${encodeURIComponent(slug)}` : `/hub?v=${encodeURIComponent(slug)}`);
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

  return (
    <div className="min-h-[100dvh] pb-10 pt-[calc(env(safe-area-inset-top,0px)+74px)]" style={{ background: PAGE_BG, color: TEXT }}>
      <header className="fixed left-0 right-0 top-0 z-50 border-b border-black/5 bg-[#fffaf7]/95 px-5 pb-3 pt-[calc(env(safe-area-inset-top,0px)+14px)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate(`/?v=${encodeURIComponent(slug)}`)}
            className="shrink-0 active:scale-[0.98]"
            aria-label="Till startsidan"
          >
            <img src={picklaLogo} alt="Pickla" className="h-8 w-auto" />
          </button>
          <button
            type="button"
            onClick={() => setVenueSheetOpen(true)}
            className="min-w-0 flex-1 justify-center flex items-center gap-1.5 rounded-full bg-white px-3 py-2 text-[12px] shadow-sm active:scale-[0.98]"
            style={{ fontFamily: FONT_MONO }}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: status?.open ? GREEN : "#d1d5db" }} />
            <span className="truncate">{venue?.name?.replace("Pickla Arena ", "Pickla ") || "Pickla Solna"}</span>
          </button>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="grid h-10 w-10 place-items-center rounded-full border border-black/10 bg-white text-neutral-950 shadow-sm active:scale-[0.98]"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

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
          <button
            type="button"
            onClick={openDailyRoom}
            className="mt-5 flex w-full items-center gap-4 rounded-[26px] border border-black/10 bg-white p-4 text-left shadow-sm active:scale-[0.99]"
          >
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-green-100 text-green-600">
              <MessageCircle className="h-7 w-7" />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-[20px] font-black text-neutral-950" style={{ fontFamily: FONT_HEADING }}>
                Pickla Idag <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
              </span>
              <span className="mt-1 block truncate text-[13px] text-neutral-500" style={{ fontFamily: FONT_MONO }}>
                Öppen kanal · lediga banor & Open Play
              </span>
            </span>
          </button>
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
                      inget schemalagt ännu
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
              <div className="mt-3 space-y-1">
                {(status?.openingHours || []).map((hour) => (
                  <div key={hour.day_of_week} className="flex justify-between gap-8 text-[13px] text-neutral-950" style={{ fontFamily: FONT_MONO }}>
                    <span>{dayLabel(hour.day_of_week)}</span>
                    <span>{hour.is_closed ? "Stängt" : `${formatHour(hour.open_time)} - ${formatHour(hour.close_time)}`}</span>
                  </div>
                ))}
              </div>
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

      <Drawer open={menuOpen} onOpenChange={setMenuOpen}>
        <DrawerContent className="max-h-[88vh] rounded-t-[28px] border-0 bg-white px-6 pb-[calc(env(safe-area-inset-bottom,0px)+22px)] pt-5">
          <div className="mx-auto flex w-full max-w-md flex-col">
            <div className="mb-6 flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-[#f4f0ee] text-[17px] font-black text-neutral-950" style={{ fontFamily: FONT_HEADING }}>
                  {profile?.avatar_url ? (
                    <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
                  ) : user ? (
                    userInitial(user, profile)
                  ) : (
                    <UserRound className="h-5 w-5" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
                    meny
                  </p>
                  <h2 className="mt-1 truncate text-[25px] font-black leading-none text-neutral-950" style={{ fontFamily: FONT_HEADING }}>
                    {user ? userDisplayName(user, profile) : "Pickla"}
                  </h2>
                </div>
              </div>
              <button type="button" onClick={() => setMenuOpen(false)} className="rounded-full p-2 text-neutral-950">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-7 overflow-y-auto pb-4">
              <section className="rounded-[24px] border border-neutral-200 bg-[#fffaf7] p-4">
                <button
                  type="button"
                  onClick={() => go(user ? "/my" : "/auth")}
                  className="flex w-full items-center justify-between text-left active:scale-[0.99]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[16px] font-black text-neutral-950" style={{ fontFamily: FONT_HEADING }}>
                      {user ? "Min sida" : "Logga in"}
                    </span>
                    <span className="mt-1 block text-[12px] text-neutral-500" style={{ fontFamily: FONT_MONO }}>
                      {user ? "bokningar, kvitton och konto" : "för bokningar, kvitton och medlemskap"}
                    </span>
                  </span>
                  <ArrowRight className="h-5 w-5 shrink-0 text-neutral-400" />
                </button>
              </section>

              <section>
                <div className="mb-3 flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-neutral-400" />
                  <h3 className="text-[14px] font-black text-neutral-950" style={{ fontFamily: FONT_HEADING }}>Mina bokningar</h3>
                </div>
                {user ? (
                  menuBookings.length ? (
                    <div className="space-y-2">
                      {menuBookings.map((booking) => (
                        <button
                          key={booking.id}
                          type="button"
                          onClick={() => go(`/my?booking=${encodeURIComponent(booking.bookingRef || booking.id)}&v=${encodeURIComponent(slug)}`)}
                          className="grid w-full grid-cols-[58px_1fr_auto] items-center gap-3 rounded-2xl border border-neutral-200 bg-[#fffaf7] px-3 py-3 text-left active:scale-[0.99]"
                        >
                          <span className="font-mono text-[13px] text-neutral-500">{booking.startTime}</span>
                          <span className="min-w-0 truncate text-[14px] font-bold text-neutral-950" style={{ fontFamily: FONT_HEADING }}>
                            {booking.title}
                          </span>
                          <ArrowRight className="h-4 w-4 text-neutral-400" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-2xl bg-[#fffaf7] px-4 py-4 text-[13px] text-neutral-500" style={{ fontFamily: FONT_MONO }}>
                      inga kommande bokningar här än
                    </p>
                  )
                ) : (
                  <p className="rounded-2xl bg-[#fffaf7] px-4 py-4 text-[13px] text-neutral-500" style={{ fontFamily: FONT_MONO }}>
                    logga in högst upp för bokningar och kvitton
                  </p>
                )}
              </section>

              <section>
                <h3 className="mb-3 text-[14px] font-black text-neutral-950" style={{ fontFamily: FONT_HEADING }}>Snabbt</h3>
                <div className="space-y-2">
                  {[
                    ["Boka pickleball", `/book?v=${slug}&sport=pickleball`],
                    ["Boka darts", `/book?v=${slug}&sport=dart`],
                    ["Planera event", `/book/group?v=${slug}`],
                  ].map(([label, href]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => go(href)}
                      className="flex w-full items-center justify-between rounded-2xl border border-neutral-200 bg-white px-4 py-4 text-left text-neutral-950"
                      style={{ fontFamily: FONT_HEADING }}
                    >
                      <span>{label}</span>
                      <ArrowRight className="h-4 w-4 text-neutral-400" />
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <div className="mb-3 flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-neutral-400" />
                  <h3 className="text-[14px] font-black text-neutral-950" style={{ fontFamily: FONT_HEADING }}>Guides</h3>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(["pickleball", "darts", "pickla"] as GuideKey[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => openGuide(key)}
                      className="rounded-2xl bg-[#f4f0ee] px-3 py-4 text-left active:scale-[0.98]"
                    >
                      <span className="text-[12px] font-black text-neutral-950" style={{ fontFamily: FONT_HEADING }}>
                        {GUIDES[key].title}
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setVenueSheetOpen(true);
                  }}
                  className="flex w-full items-center justify-between rounded-2xl border border-neutral-200 bg-[#fffaf7] px-4 py-4 text-left"
                >
                  <span>
                    <span className="block text-[14px] font-black text-neutral-950" style={{ fontFamily: FONT_HEADING }}>
                      {venue?.name?.replace("Pickla Arena ", "Pickla ") || "Pickla Solna"}
                    </span>
                    <span className="mt-1 block text-[12px] text-neutral-500" style={{ fontFamily: FONT_MONO }}>
                      {status?.label || "Öppettider"}
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-neutral-400" />
                </button>
              </section>

              {user && (
                <section>
                  <button
                    type="button"
                    onClick={async () => {
                      await signOut();
                      go(`/?v=${slug}`);
                    }}
                    className="flex w-full items-center justify-between rounded-2xl border border-neutral-200 bg-[#f4f0ee] px-4 py-4 text-left text-neutral-950"
                    style={{ fontFamily: FONT_HEADING }}
                  >
                    <span>Logga ut</span>
                    <LogOut className="h-4 w-4 text-neutral-400" />
                  </button>
                </section>
              )}
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
