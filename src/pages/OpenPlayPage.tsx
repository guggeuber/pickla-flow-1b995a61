import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { ArrowLeft, Loader2 } from "lucide-react";

import { PicklaTopBar } from "@/components/PicklaTopBar";
import { SessionScheduleRow } from "@/components/session";
import { apiGet } from "@/lib/api";
import { fetchActivitySessionOverrides, isPublicActivityOverrideHidden, occurrenceOverrideKey } from "@/lib/activitySessionOverrides";
import { activitySessionToPresentation, openBookingToPresentation, type SessionPresentation } from "@/lib/sessionPresentation";
import { supabase } from "@/integrations/supabase/client";
import { useVenueWithHours } from "@/lib/venueStatus";

const PAGE_BG = "#fffaf7";
const TEXT = "#111111";
const MUTED = "#76716f";
const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";
const WEEK_DAYS = 7;

type ActivitySessionRow = {
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
};

type ActivitySessionOccurrence = ActivitySessionRow & {
  occurrence_date: string;
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
  start_time: string;
  end_time: string;
  open_spots: number;
  public_capacity?: number | null;
  total_players?: number | null;
  pace_label: string;
  note?: string | null;
  booker_first_name: string;
  committed_count?: number | null;
  claim_url: string;
  courts?: Array<{ name?: string | null; court_number?: number | null }>;
};

type WeeklyScheduleItem = {
  id: string;
  date: string;
  startsAt: string;
  href: string;
  presentation: SessionPresentation;
};

function sessionTypeLabel(sessionType?: string | null) {
  if (sessionType === "open_play") return "OPEN PLAY";
  if (sessionType === "group_training") return "TRÄNING";
  if (sessionType === "liveball") return "LIVEBALL";
  return String(sessionType || "PASS").replace(/_/g, " ").toUpperCase();
}

function dayHeading(dateKey: string, now: DateTime) {
  const date = DateTime.fromISO(dateKey, { zone: "Europe/Stockholm" });
  if (date.hasSame(now, "day")) return "Idag";
  if (date.hasSame(now.plus({ days: 1 }), "day")) return "Imorgon";
  return date.setLocale("sv").toFormat("cccc d MMM");
}

function isPastOccurrence(date: DateTime, endTime: string | null | undefined, now: DateTime) {
  if (!date.hasSame(now, "day") || !endTime) return false;
  const [hour = 0, minute = 0] = String(endTime).slice(0, 5).split(":").map(Number);
  const endsAt = date.set({ hour, minute, second: 0, millisecond: 0 });
  return endsAt <= now;
}

function occurrenceHref(session: ActivitySessionOccurrence, slug: string) {
  return `/program/${session.id}?date=${session.occurrence_date}&v=${encodeURIComponent(slug)}`;
}

function parseClaimHref(claimUrl: string) {
  try {
    const url = new URL(claimUrl);
    return `${url.pathname}${url.search}`;
  } catch {
    return claimUrl;
  }
}

function useWeeklySchedule(slug: string, venueId: string | undefined, venueName: string | undefined) {
  return useQuery({
    queryKey: ["weekly-session-schedule", slug, venueId],
    enabled: !!venueId,
    staleTime: 30_000,
    queryFn: async () => {
      const now = DateTime.now().setZone("Europe/Stockholm");
      const startDate = now.toISODate()!;
      const endDate = now.plus({ days: WEEK_DAYS - 1 }).toISODate()!;

      const [sessionsRes, openBookingsRes] = await Promise.all([
        supabase
          .from("activity_sessions")
          .select("id, name, session_type, session_date, recurrence_days, start_time, end_time, capacity, price_sek, product_key, venue_id, access_policy, metadata, early_bird_price_minor, early_bird_slots, scarcity_mode")
          .eq("venue_id", venueId!)
          .eq("is_active", true)
          .eq("publish_status", "published")
          .order("start_time", { ascending: true }),
        apiGet<{ items: OpenBookingItem[] }>("api-bookings", "public-open-bookings", {
          slug,
          date: startDate,
          days: String(WEEK_DAYS),
        }).catch(() => ({ items: [] })),
      ]);

      if (sessionsRes.error) throw sessionsRes.error;

      const sessionOccurrences: ActivitySessionOccurrence[] = [];
      for (const session of (sessionsRes.data || []) as ActivitySessionRow[]) {
        if (session.session_date) {
          const date = DateTime.fromISO(session.session_date, { zone: "Europe/Stockholm" });
          if (date >= now.startOf("day") && date < now.plus({ days: WEEK_DAYS }).startOf("day")) {
            const occurrenceDate = date.toISODate();
            if (occurrenceDate && !isPastOccurrence(date, session.end_time, now)) {
              sessionOccurrences.push({ ...session, occurrence_date: occurrenceDate });
            }
          }
          continue;
        }

        for (let offset = 0; offset < WEEK_DAYS; offset += 1) {
          const date = now.plus({ days: offset });
          if ((session.recurrence_days || []).includes(date.weekday % 7)) {
            const occurrenceDate = date.toISODate();
            if (occurrenceDate && !isPastOccurrence(date, session.end_time, now)) {
              sessionOccurrences.push({ ...session, occurrence_date: occurrenceDate });
            }
          }
        }
      }

      const sessionIds = [...new Set(sessionOccurrences.map((session) => session.id))];
      const [socialProofRes, overrideMap] = await Promise.all([
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

      const socialProofByKey = new Map<string, ActivitySocialProofRow>();
      for (const row of socialProofRes.occurrences || []) {
        socialProofByKey.set(`${row.activity_session_id}:${row.session_date}`, row);
      }

      const activityItems: WeeklyScheduleItem[] = sessionOccurrences
        .filter((session) => {
          const override = overrideMap.get(occurrenceOverrideKey(session.id, session.occurrence_date));
          return !isPublicActivityOverrideHidden(override?.status);
        })
        .map((session) => {
          const occurrenceKey = `${session.id}:${session.occurrence_date}`;
          const registered = Number(socialProofByKey.get(occurrenceKey)?.registrations_count || 0);
          const capacity = Number(session.capacity || 0);
          const href = occurrenceHref(session, slug);
          const presentation = activitySessionToPresentation({
            id: session.id,
            typeLabel: sessionTypeLabel(session.session_type),
            title: session.name,
            sessionDate: session.occurrence_date,
            startTime: String(session.start_time).slice(0, 5),
            endTime: String(session.end_time).slice(0, 5),
            venueName,
            people: [],
            committedCount: registered,
            capacity: capacity || null,
            placesLeft: capacity ? Math.max(0, capacity - registered) : null,
            pricing: Number(session.price_sek || 0) > 0
              ? { kind: "amount", amountSek: Number(session.price_sek || 0) }
              : null,
            primaryAction: { key: "open", label: "Visa" },
            route: href,
            now,
          });
          return {
            id: `activity:${session.id}:${session.occurrence_date}`,
            date: session.occurrence_date,
            startsAt: presentation.startsAt,
            href,
            presentation,
          };
        });

      const openBookingItems: WeeklyScheduleItem[] = ((openBookingsRes as { items?: OpenBookingItem[] })?.items || []).map((item) => {
        const start = DateTime.fromISO(item.start_time, { zone: "utc" }).setZone("Europe/Stockholm");
        const end = DateTime.fromISO(item.end_time, { zone: "utc" }).setZone("Europe/Stockholm");
        const courtLabel = (item.courts || [])
          .map((court) => court.name || (court.court_number ? `Bana ${court.court_number}` : null))
          .filter(Boolean)
          .join(", ");
        const href = parseClaimHref(item.claim_url);
        const presentation = openBookingToPresentation({
          id: item.id,
          bookerFirstName: item.booker_first_name,
          startsAt: start.toISO()!,
          endsAt: end.toISO()!,
          venueName,
          resourceNames: courtLabel ? [courtLabel] : [],
          people: [],
          committedCount: Number(item.committed_count || 0),
          capacity: Number(item.public_capacity || item.total_players || 0) || null,
          placesLeft: item.open_spots,
          pace: item.pace_label,
          description: item.note,
          pricing: { kind: "status", label: "Din del av banan" },
          primaryAction: { key: "open", label: "Häng på" },
          route: href,
          now,
        });
        return {
          id: `open-booking:${item.id}`,
          date: start.toISODate()!,
          startsAt: presentation.startsAt,
          href,
          presentation,
        };
      });

      return [...activityItems, ...openBookingItems].sort((a, b) =>
        a.startsAt.localeCompare(b.startsAt)
      );
    },
  });
}

export default function OpenPlayPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const slug = searchParams.get("v") || "pickla-arena-sthlm";
  const { data: venue, isLoading: venueLoading } = useVenueWithHours(slug);
  const { data: schedule = [], isLoading: scheduleLoading } = useWeeklySchedule(slug, venue?.id, venue?.name);
  const now = DateTime.now().setZone("Europe/Stockholm");

  const groups = useMemo(() => {
    const byDate = new Map<string, WeeklyScheduleItem[]>();
    for (const item of schedule) {
      byDate.set(item.date, [...(byDate.get(item.date) || []), item]);
    }
    return [...byDate.entries()].map(([date, items]) => ({
      date,
      heading: dayHeading(date, now),
      items,
    }));
  }, [schedule, now]);

  const openItem = (item: WeeklyScheduleItem) => {
    navigate(item.href);
  };

  return (
    <div
      className="min-h-[100dvh] pb-12 pt-[calc(env(safe-area-inset-top,0px)+74px)]"
      style={{ background: PAGE_BG, color: TEXT }}
    >
      <PicklaTopBar
        slug={slug}
        venueName={venue?.name?.replace("Pickla Arena ", "Pickla ") || "Pickla Stockholm"}
        background={PAGE_BG}
      />

      <main className="mx-auto max-w-md px-5">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-5 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[12px] font-bold shadow-sm active:scale-[0.98]"
          style={{ fontFamily: FONT_MONO, color: MUTED }}
        >
          <ArrowLeft className="h-4 w-4" />
          Tillbaka
        </button>

        <header className="mb-7">
          <p className="text-[11px] font-black uppercase tracking-[0.22em]" style={{ fontFamily: FONT_MONO, color: MUTED }}>
            Hela veckan
          </p>
          <h1 className="mt-3 text-[40px] font-black leading-none tracking-[-0.05em]" style={{ fontFamily: FONT_HEADING }}>
            Vad händer på Pickla?
          </h1>
          <p className="mt-3 text-[14px] font-semibold leading-relaxed" style={{ color: MUTED }}>
            En kronologisk vy för pass, öppna banor och annat du kan hänga på.
          </p>
        </header>

        {venueLoading || scheduleLoading ? (
          <section className="grid min-h-[320px] place-items-center">
            <Loader2 className="h-6 w-6 animate-spin text-black/40" />
          </section>
        ) : groups.length === 0 ? (
          <section className="rounded-[28px] border border-black/10 bg-white p-6">
            <p className="text-[18px] font-black" style={{ fontFamily: FONT_HEADING }}>
              Inget publicerat just nu
            </p>
            <p className="mt-2 text-[13px] font-semibold" style={{ color: MUTED }}>
              Kolla tillbaka snart.
            </p>
          </section>
        ) : (
          <div className="space-y-8">
            {groups.map((group) => (
              <section key={group.date}>
                <h2 className="mb-4 text-[25px] font-bold leading-none tracking-[-0.03em]" style={{ fontFamily: FONT_HEADING }}>
                  {group.heading}
                </h2>
                <div className="space-y-2">
                  {group.items.map((item) => (
                    <SessionScheduleRow
                      key={item.id}
                      presentation={item.presentation}
                      onClick={() => openItem(item)}
                      emphasis={item.date === now.toISODate() ? "today" : "future"}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
