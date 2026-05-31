import { useEffect, useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import picklaLogo from "@/assets/pickla-logo.svg";

const BG = "#fbf7f2";
const TEXT = "#0f172a";
const FONT_HEADING = "'Space Grotesk', sans-serif";
const DAY_NAMES = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];

function nextOccurrence(session: any, requestedDate?: string | null) {
  if (requestedDate) return DateTime.fromISO(requestedDate, { zone: "Europe/Stockholm" });
  if (session?.session_date) return DateTime.fromISO(session.session_date, { zone: "Europe/Stockholm" });

  const now = DateTime.now().setZone("Europe/Stockholm");
  const recurrenceDays = session?.recurrence_days || [];
  for (let offset = 0; offset < 14; offset++) {
    const date = now.plus({ days: offset });
    const jsDow = date.weekday % 7;
    if (!recurrenceDays.includes(jsDow)) continue;
    if (offset === 0 && session?.end_time) {
      const [endHour, endMinute] = String(session.end_time).split(":").map(Number);
      const endAt = date.set({ hour: endHour || 0, minute: endMinute || 0, second: 0, millisecond: 0 });
      if (now > endAt) continue;
    }
    return date;
  }

  return now;
}

function programChatResourceId(sessionId: string, occurrenceDate: string | null | undefined) {
  return `activity_session:${sessionId}:${occurrenceDate || "next"}`;
}

export default function ProgramSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const requestedDate = searchParams.get("date");
  const venueSlug = searchParams.get("v") || "pickla-arena-sthlm";

  const { data, isLoading, error } = useQuery({
    queryKey: ["program-session-entry", sessionId],
    enabled: !!sessionId,
    queryFn: async () => {
      const { data: session, error: sessionError } = await supabase
        .from("activity_sessions")
        .select("*, activity_series(id, name, series_type)")
        .eq("id", sessionId!)
        .maybeSingle();

      if (sessionError) throw sessionError;
      if (!session) throw new Error("Passet finns inte längre");

      const { data: venue } = await supabase
        .from("venues")
        .select("id, name, slug")
        .eq("id", (session as any).venue_id)
        .maybeSingle();

      return { session: session as any, venue: venue as any };
    },
  });

  const occurrence = useMemo(() => nextOccurrence(data?.session, requestedDate), [data?.session, requestedDate]);
  const occurrenceDate = occurrence.toISODate();

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => navigate(`/hub?v=${venueSlug}`, { replace: true }), 1200);
    return () => window.clearTimeout(timer);
  }, [error, navigate, venueSlug]);

  useEffect(() => {
    if (authLoading || isLoading || !data?.session) return;

    if (!user?.id) {
      const redirect = `${window.location.pathname}${window.location.search}`;
      sessionStorage.setItem("pickla_auth_redirect", redirect);
      navigate(`/auth?redirect=${encodeURIComponent(redirect)}`, { replace: true });
      return;
    }

    let cancelled = false;
    const openProgramChat = async () => {
      const session = data.session;
      const venue = data.venue;
      const startTime = session?.start_time ? String(session.start_time).slice(0, 5) : "";
      const endTime = session?.end_time ? String(session.end_time).slice(0, 5) : "";
      const now = DateTime.now().setZone("Europe/Stockholm");
      const dayLabel = occurrence.hasSame(now, "day")
        ? "Idag"
        : occurrence.hasSame(now.plus({ days: 1 }), "day")
          ? "Imorgon"
          : `${DAY_NAMES[occurrence.weekday % 7]} ${occurrence.toFormat("d MMM", { locale: "sv" })}`;

      const { data: rooms, error: roomError } = await supabase.rpc("upsert_resource_chat_room", {
        p_venue_id: session.venue_id,
        p_resource_id: programChatResourceId(session.id, occurrenceDate),
        p_room_type: "event",
        p_title: session.name,
        p_subtitle: `${dayLabel} · ${startTime}-${endTime}`,
        p_emoji: "📅",
        p_is_public: true,
      });
      if (roomError) throw roomError;

      const roomId = rooms?.[0]?.id;
      if (!roomId) throw new Error("Kunde inte öppna aktivitetschatten");
      if (!cancelled) navigate(`/chat/${roomId}?v=${venue?.slug || venueSlug}`, { replace: true });
    };

    openProgramChat().catch((err) => {
      toast.error(err.message || "Kunde inte öppna aktiviteten");
      navigate(`/hub?v=${venueSlug}`, { replace: true });
    });

    return () => {
      cancelled = true;
    };
  }, [authLoading, data, isLoading, navigate, occurrence, occurrenceDate, user?.id, venueSlug]);

  return (
    <div
      className="grid min-h-[100dvh] place-items-center px-6 text-center"
      style={{ background: BG, color: TEXT, paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="grid justify-items-center gap-4">
        <img src={picklaLogo} alt="Pickla" className="h-8 w-auto" />
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        <div>
          <p className="text-lg font-black" style={{ fontFamily: FONT_HEADING }}>
            {error ? "Aktiviteten hittades inte" : "Öppnar aktivitetschatten"}
          </p>
          <p className="mt-1 text-sm font-bold text-slate-500">
            {error ? "Vi skickar dig tillbaka till hubben." : "Chatten är platsen för frågor och anmälan."}
          </p>
        </div>
      </div>
    </div>
  );
}
