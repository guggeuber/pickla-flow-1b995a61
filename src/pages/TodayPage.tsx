import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { CalendarDays, Clock3, Loader2, MessageCircle, Ticket, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PlayerNav } from "@/components/PlayerNav";
import {
  getBookingChatResourceId,
  getBookingCourtLabel,
  groupBookingRows,
} from "@/lib/bookingGroups";
import picklaLogo from "@/assets/pickla-logo.svg";

const PAGE_BG = "#f6d7dc";
const CARD = "#fffaf9";
const TEXT = "#111827";
const MUTED = "#6b7280";
const NAVY = "#1a1f3a";
const RED = "#cc2936";
const GREEN = "#15803d";
const BORDER = "rgba(17,24,39,0.09)";
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
  totalSpots?: number | null;
  courtLabel?: string;
  href: string;
  cta: string;
  isMine?: boolean;
};

function dayLabel(date: DateTime, now: DateTime) {
  if (date.hasSame(now, "day")) return "Idag";
  if (date.hasSame(now.plus({ days: 1 }), "day")) return "Imorgon";
  return date.setLocale("sv").toFormat("cccc d MMM");
}

function useVenue(slug: string) {
  return useQuery({
    queryKey: ["today-venue", slug],
    queryFn: async () => {
      const { data } = await supabase
        .from("venues")
        .select("id, name, slug")
        .eq("slug", slug)
        .maybeSingle();
      return data;
    },
  });
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
          .select("id, name, session_type, session_date, recurrence_days, start_time, end_time, price_sek, capacity, product_key")
          .eq("venue_id", venueId!)
          .eq("is_active", true)
          .eq("publish_status", "published")
          .order("start_time", { ascending: true }),
        supabase
          .from("events")
          .select("id, name, display_name, slug, category, status, start_date, end_date, start_time, end_time")
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
          : Promise.resolve({ data: [] as any[], error: null }),
      ]);

      const sessionOccurrences: Array<any> = [];
      for (const session of sessionsRes.data || []) {
        if (session.session_date) {
          const date = DateTime.fromISO(session.session_date, { zone: "Europe/Stockholm" });
          if (date >= now.startOf("day") && date < now.plus({ days: DAYS_AHEAD }).startOf("day")) {
            sessionOccurrences.push({ ...session, occurrence_date: date.toISODate() });
          }
          continue;
        }
        for (let offset = 0; offset < DAYS_AHEAD; offset++) {
          const date = now.plus({ days: offset });
          if (!(session.recurrence_days || []).includes(date.weekday % 7)) continue;
          sessionOccurrences.push({ ...session, occurrence_date: date.toISODate() });
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
        : { data: [] as any[] };

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
          status: capacity && count >= capacity ? "Full" : "Öppen",
          spotsLeft: capacity ? Math.max(capacity - count, 0) : null,
          totalSpots: capacity || null,
          href: `/program/${session.id}?date=${session.occurrence_date}&v=${slug}`,
          cta: capacity && count >= capacity ? "Visa" : "Anmäl",
        };
      });

      const eventItems: FeedItem[] = (eventsRes.data || []).map((event) => ({
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
      }));

      const bookingItems: FeedItem[] = groupBookingRows(bookingsRes.data || []).map((booking: any) => {
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
          status: booking.status === "confirmed" ? "Bekräftad" : "Väntande",
          courtLabel: getBookingCourtLabel(booking),
          href: `/booking-chat/${encodeURIComponent(getBookingChatResourceId(booking))}?v=${slug}`,
          cta: "Öppna",
          isMine: true,
        };
      });

      return [...sessionItems, ...eventItems, ...bookingItems].sort((a, b) =>
        `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`)
      );
    },
  });
}

function ItemCard({ item, now }: { item: FeedItem; now: DateTime }) {
  const navigate = useNavigate();
  const start = DateTime.fromISO(`${item.date}T${item.startTime}`, { zone: "Europe/Stockholm" });
  const end = item.endTime ? DateTime.fromISO(`${item.date}T${item.endTime}`, { zone: "Europe/Stockholm" }) : null;
  const isLive = start <= now && !!end && end >= now;
  const isPast = !!end && end < now;
  const isFeatured = isLive || item.isMine;
  const chips = [
    item.category,
    item.spotsLeft != null ? (item.spotsLeft === 0 ? "Full" : `${item.spotsLeft} platser kvar`) : null,
    item.courtLabel,
  ].filter(Boolean);

  return (
    <button
      type="button"
      onClick={() => navigate(item.href)}
      className="w-full text-left active:scale-[0.99] transition-transform"
      style={{
        background: CARD,
        border: `1px solid ${isLive ? "rgba(204,41,54,0.34)" : BORDER}`,
        borderRadius: isFeatured ? 22 : 16,
        padding: isFeatured ? 16 : 13,
        opacity: isPast ? 0.58 : 1,
        boxShadow: isFeatured ? "0 14px 34px rgba(17,24,39,0.08)" : "none",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {isLive && <span className="rounded-full px-2 py-1 text-[10px] font-black text-white" style={{ background: RED }}>Live nu</span>}
            {chips.map((chip) => (
              <span key={chip} className="rounded-full px-2 py-1 text-[10px] font-bold" style={{ background: "#f1f5f9", color: MUTED }}>
                {chip}
              </span>
            ))}
          </div>
          <p className={`${isFeatured ? "text-lg" : "text-[15px]"} font-black leading-tight`} style={{ color: TEXT, fontFamily: FONT_HEADING }}>
            {item.title}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-xs" style={{ color: MUTED, fontFamily: FONT_MONO }}>
            <Clock3 className="h-3.5 w-3.5" /> {item.startTime}{item.endTime ? `-${item.endTime}` : ""}
          </p>
        </div>
        <div className="shrink-0 rounded-full px-3 py-2 text-xs font-black" style={{ background: isLive ? RED : NAVY, color: "#fff", fontFamily: FONT_HEADING }}>
          {item.cta}
        </div>
      </div>
    </button>
  );
}

export default function TodayPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const slug = searchParams.get("v") || "pickla-arena-sthlm";
  const { data: venue, isLoading: venueLoading } = useVenue(slug);
  const { data: items = [], isLoading } = useTodayFeed(venue?.id, user?.id, slug);
  const now = DateTime.now().setZone("Europe/Stockholm");

  const days = useMemo(() => {
    return Array.from({ length: DAYS_AHEAD }, (_, offset) => {
      const date = now.plus({ days: offset }).startOf("day");
      return {
        key: date.toISODate()!,
        date,
        items: items.filter((item) => item.date === date.toISODate()),
      };
    });
  }, [items, now]);

  return (
    <div className="min-h-[100dvh] pb-28" style={{ background: PAGE_BG, color: TEXT }}>
      <header
        className="fixed left-0 right-0 top-0 z-20 px-5 pb-4 pt-[calc(env(safe-area-inset-top,0px)+18px)] backdrop-blur-xl"
        style={{
          background: "linear-gradient(180deg, rgba(246,215,220,0.98) 0%, rgba(246,215,220,0.9) 72%, rgba(246,215,220,0) 100%)",
        }}
      >
        <div className="mx-auto flex max-w-md items-end justify-between gap-3">
          <div>
            <img src={picklaLogo} alt="Pickla" className="h-7 w-auto" />
            <p className="mt-2 text-xs font-bold" style={{ color: MUTED, fontFamily: FONT_MONO }}>{venue?.name || "Pickla"}</p>
          </div>
          <button type="button" onClick={() => navigate(`/book?v=${slug}`)} className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-black" style={{ background: NAVY, color: "#fff", fontFamily: FONT_HEADING }}>
            <Zap className="h-4 w-4" /> Boka
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-md px-5 pt-[calc(env(safe-area-inset-top,0px)+92px)]">
        <div className="mb-6 pt-4">
          <h1 className="text-[32px] font-black leading-none" style={{ fontFamily: FONT_HEADING }}>Nu</h1>
          <p className="mt-2 text-sm" style={{ color: MUTED }}>Vad som händer nu och framåt.</p>
        </div>

        {venueLoading || isLoading ? (
          <div className="grid min-h-48 place-items-center">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: NAVY }} />
          </div>
        ) : (
          <div className="space-y-7">
            {days.map(({ key, date, items: dayItems }) => (
              <section key={key}>
                <div className="mb-3 flex items-center gap-2">
                  <CalendarDays className="h-4 w-4" style={{ color: NAVY }} />
                  <h2 className="text-sm font-black capitalize" style={{ fontFamily: FONT_HEADING }}>{dayLabel(date, now)}</h2>
                  <span className="text-xs" style={{ color: MUTED, fontFamily: FONT_MONO }}>{date.toFormat("d/M")}</span>
                </div>

                {dayItems.length > 0 ? (
                  <div className="space-y-2.5">
                    {dayItems.map((item) => <ItemCard key={item.id} item={item} now={now} />)}
                  </div>
                ) : (
                  <div className="rounded-2xl border px-4 py-4 text-sm" style={{ borderColor: BORDER, color: MUTED, background: "rgba(255,250,249,0.62)" }}>
                    Inget schemalagt ännu.
                  </div>
                )}
              </section>
            ))}
          </div>
        )}

        <div className="mt-8 grid grid-cols-2 gap-3">
          <button type="button" onClick={() => navigate(`/book?v=${slug}`)} className="rounded-2xl p-4 text-left" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
            <Ticket className="mb-3 h-5 w-5" style={{ color: NAVY }} />
            <p className="text-sm font-black" style={{ fontFamily: FONT_HEADING }}>Boka resurs</p>
            <p className="mt-1 text-xs" style={{ color: MUTED }}>Bana, dart eller annat.</p>
          </button>
          <button type="button" onClick={() => navigate(`/hub?v=${slug}`)} className="rounded-2xl p-4 text-left" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
            <MessageCircle className="mb-3 h-5 w-5" style={{ color: NAVY }} />
            <p className="text-sm font-black" style={{ fontFamily: FONT_HEADING }}>Öppna rum</p>
            <p className="mt-1 text-xs" style={{ color: MUTED }}>Chattar lever kvar i rätt kontext.</p>
          </button>
        </div>
      </main>

      <PlayerNav />
    </div>
  );
}
