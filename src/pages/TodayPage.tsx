import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PlayerNav } from "@/components/PlayerNav";
import {
  getBookingChatResourceId,
  getBookingCourtLabel,
  groupBookingRows,
} from "@/lib/bookingGroups";
import picklaLogo from "@/assets/pickla-logo.svg";
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
  isMine?: boolean;
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
        .select("id, name, slug")
        .eq("slug", slug)
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
        .eq("day_of_week", now.weekday % 7)
        .maybeSingle();
      if (!data || data.is_closed) return { open: false };
      const nowTime = now.toFormat("HH:mm");
      return { open: nowTime >= String(data.open_time).slice(0, 5) && nowTime < String(data.close_time).slice(0, 5) };
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
          : Promise.resolve({ data: [] as any[], error: null }),
      ]);

      const sessionOccurrences: any[] = [];
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
          if ((session.recurrence_days || []).includes(date.weekday % 7)) {
            sessionOccurrences.push({ ...session, occurrence_date: date.toISODate() });
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
          status: capacity && count >= capacity ? "Full" : "Drop-in",
          spotsLeft: capacity ? Math.max(capacity - count, 0) : null,
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
          status: booking.status === "confirmed" ? "Bokad" : "Väntar",
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

function FeedRow({ item, now, highlight }: { item: FeedItem; now: DateTime; highlight: boolean }) {
  const navigate = useNavigate();
  const end = item.endTime ? DateTime.fromISO(`${item.date}T${item.endTime}`, { zone: "Europe/Stockholm" }) : null;
  const isPast = !!end && end < now;
  const meta = item.spotsLeft != null
    ? item.spotsLeft === 0 ? "Full" : `${item.spotsLeft} kvar`
    : item.status;

  return (
    <button
      type="button"
      onClick={() => navigate(item.href)}
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
        {meta}
      </span>
    </button>
  );
}

export default function TodayPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const slug = searchParams.get("v") || "pickla-arena-sthlm";
  const { data: venue, isLoading: venueLoading } = useVenue(slug);
  const { data: status } = useVenueOpenStatus(venue?.id);
  const { data: items = [], isLoading } = useTodayFeed(venue?.id, user?.id, slug);
  const now = DateTime.now().setZone("Europe/Stockholm");
  const liveHighlightId = items.find((item) => {
    const start = DateTime.fromISO(`${item.date}T${item.startTime}`, { zone: "Europe/Stockholm" });
    const end = item.endTime ? DateTime.fromISO(`${item.date}T${item.endTime}`, { zone: "Europe/Stockholm" }) : null;
    return start <= now && !!end && end >= now && item.status !== "Full";
  })?.id;

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
    <div className="min-h-[100dvh] pb-28" style={{ background: PAGE_BG, color: TEXT }}>
      <header className="px-6 pb-5 pt-[calc(env(safe-area-inset-top,0px)+34px)]">
        <div className="mx-auto flex max-w-md items-center justify-between gap-4">
          <img src={picklaLogo} alt="Pickla" className="h-8 w-auto" />
          <div className="flex items-center gap-1.5 text-[13px]" style={{ fontFamily: FONT_MONO }}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: status?.open ? GREEN : "#d1d5db" }} />
            <span>{venue?.name?.replace("Pickla Arena ", "Pickla ") || "Pickla Solna"}</span>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-md px-6">
          <div className="flex gap-3 overflow-x-auto pb-8" style={{ scrollbarWidth: "none" }}>
            {[
              { label: "Boka\nPickleball", href: `/book?v=${slug}&sport=pickleball`, image: null },
              { label: "Boka darts", href: `/book?v=${slug}&sport=dart`, image: null },
              { label: "Boka event", href: `/book?v=${slug}`, image: weekendVibes },
            ].map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => navigate(action.href)}
                className="relative h-36 w-[31%] min-w-[98px] overflow-hidden rounded-md border text-left shadow-sm active:scale-[0.98]"
                style={{ background: SOFT, borderColor: BORDER }}
              >
                {action.image ? (
                  <img src={action.image} alt="" className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <div className="absolute inset-x-4 top-5 h-16 rounded-full bg-white/45" />
                )}
                {action.image && <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent" />}
                <span
                  className="absolute bottom-4 left-3 right-3 whitespace-pre-line text-[16px] leading-[0.95]"
                  style={{ color: action.image ? "#fff" : TEXT, fontFamily: FONT_HEADING }}
                >
                  {action.label}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="relative h-[430px] overflow-hidden">
          <img src={weekendVibes} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/42 via-transparent to-transparent" />
          <p className="absolute bottom-7 left-6 text-[26px] text-white" style={{ fontFamily: FONT_MONO }}>
            weekend vibes
          </p>
        </section>

        <section className="mx-auto max-w-md px-5 pt-8">
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
                        <FeedRow key={item.id} item={item} now={now} highlight={item.id === liveHighlightId} />
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

      <PlayerNav />
    </div>
  );
}
