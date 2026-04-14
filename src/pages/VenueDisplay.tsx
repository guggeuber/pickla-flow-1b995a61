import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Wifi, WifiOff, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { apiGet } from "@/lib/api";

// ─── Types ───────────────────────────────────────────────────────────────────

type CourtStatus = "free" | "active" | "soon";

interface CourtDisplay {
  id: string;
  name: string;
  court_number: number;
  sport_type: string;
  status: CourtStatus;
  endsAt?: number;
  startsAt?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SPORT_LABELS: Record<string, string> = {
  pickleball: "Pickleball",
  dart:       "Dart Arena",
  darts:      "Dart Arena",
  padel:      "Padel",
  tennis:     "Tennis",
};

const SPORT_ACCENT: Record<string, string> = {
  pickleball: "bg-court-free",
  dart:       "bg-primary",
  darts:      "bg-primary",
};

const STATUS_CFG: Record<CourtStatus, {
  bg: string; border: string; text: string; label: string; dot: string;
}> = {
  free: {
    bg:     "bg-court-free/10",
    border: "border-court-free/30",
    text:   "text-court-free",
    label:  "LEDIG",
    dot:    "bg-court-free",
  },
  active: {
    bg:     "bg-court-active/10",
    border: "border-court-active/40",
    text:   "text-court-active",
    label:  "UPPTAGEN",
    dot:    "bg-court-active",
  },
  soon: {
    bg:     "bg-court-soon/10",
    border: "border-court-soon/30",
    text:   "text-court-soon",
    label:  "SNART",
    dot:    "bg-court-soon",
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function useRealtimeClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function formatCountdown(endsAt: number, nowMs: number): string {
  const diff = Math.max(0, endsAt - nowMs);
  const m = Math.floor(diff / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function getCourtStatus(
  courtId: string,
  rawBookings: Array<{ court_id: string; start: string; end: string }>,
  nowMs: number,
): { status: CourtStatus; endsAt?: number; startsAt?: string } {
  const mine = rawBookings.filter((b) => b.court_id === courtId);
  const soonMs = nowMs + 30 * 60 * 1000;

  const active = mine.find(
    (b) => new Date(b.start).getTime() <= nowMs && new Date(b.end).getTime() > nowMs,
  );
  if (active) {
    return { status: "active", endsAt: new Date(active.end).getTime() };
  }

  const upcoming = mine
    .filter((b) => new Date(b.start).getTime() > nowMs)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  if (upcoming.length > 0) {
    const next = upcoming[0];
    const nextMs = new Date(next.start).getTime();
    const timeLabel = new Date(next.start).toLocaleTimeString("sv-SE", {
      hour: "2-digit",
      minute: "2-digit",
    });
    if (nextMs <= soonMs) {
      return { status: "soon", startsAt: timeLabel };
    }
    return { status: "free", startsAt: timeLabel };
  }

  return { status: "free" };
}

// ─── Court Card ──────────────────────────────────────────────────────────────

function CourtCard({
  court,
  nowMs,
  index,
}: {
  court: CourtDisplay;
  nowMs: number;
  index: number;
}) {
  const cfg = STATUS_CFG[court.status];

  return (
    <motion.div
      layout
      key={court.id}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.25 }}
      className={`flex items-center justify-between rounded-xl border-2 px-5 py-3 ${cfg.bg} ${cfg.border}`}
    >
      {/* Left block */}
      <div className="flex items-center gap-4 min-w-0">
        <span
          className={`w-3 h-3 rounded-full flex-shrink-0 ${cfg.dot} ${
            court.status === "active" ? "animate-pulse" : ""
          }`}
        />
        <div className="min-w-0">
          <p className="font-display font-black text-foreground text-xl leading-tight truncate">
            {court.name}
          </p>
          <p className={`font-bold tracking-widest text-sm ${cfg.text}`}>
            {cfg.label}
            {court.startsAt && court.status !== "active" && (
              <span className="text-muted-foreground font-normal ml-2">
                {court.status === "soon" ? `· startar ${court.startsAt}` : `· nästa ${court.startsAt}`}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Right block: countdown */}
      {court.endsAt && (
        <div className="text-right pl-4 flex-shrink-0">
          <p className={`font-display font-black tabular-nums leading-none ${cfg.text}`}
            style={{ fontSize: "clamp(1.75rem, 3vw, 2.5rem)" }}>
            {formatCountdown(court.endsAt, nowMs)}
          </p>
          <p className="text-muted-foreground text-xs mt-0.5">kvar</p>
        </div>
      )}
    </motion.div>
  );
}

// ─── Sport Column ─────────────────────────────────────────────────────────────

function SportColumn({
  sport,
  courts,
  nowMs,
  colIndex,
  totalCols,
}: {
  sport: string;
  courts: CourtDisplay[];
  nowMs: number;
  colIndex: number;
  totalCols: number;
}) {
  const active = courts.filter((c) => c.status === "active").length;
  const accent = SPORT_ACCENT[sport] ?? "bg-primary";

  return (
    <div
      className={`flex flex-col overflow-hidden px-6 py-5 ${
        colIndex < totalCols - 1 ? "border-r border-border" : ""
      }`}
    >
      {/* Sticky column header */}
      <div className="flex-shrink-0 flex items-center gap-3 mb-4 pb-4 border-b border-border">
        <span className={`w-3 h-3 rounded-full flex-shrink-0 ${accent}`} />
        <h2 className="font-display font-black text-foreground uppercase tracking-widest text-xl">
          {SPORT_LABELS[sport] ?? sport}
        </h2>
        <span className="ml-auto font-mono text-muted-foreground text-base">
          {active}/{courts.length} aktiva
        </span>
      </div>

      {/* Scrollable court cards */}
      <div className="flex-1 overflow-y-auto min-h-0 space-y-2.5 pr-1">
        {courts.map((court, i) => (
          <CourtCard key={court.id} court={court} nowMs={nowMs} index={i} />
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function VenueDisplay() {
  const [searchParams] = useSearchParams();
  const slug = searchParams.get("v") ?? "";
  const queryClient = useQueryClient();
  const now = useRealtimeClock();
  const [isConnected, setIsConnected] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState(new Date());

  const today = now.toISOString().split("T")[0];
  const nowMs = now.getTime();

  // ── Venue info (name, logo) ────────────────────────────────────────────────
  const { data: venueData } = useQuery({
    queryKey: ["display-venue", slug],
    enabled: !!slug,
    queryFn: () => apiGet("api-bookings", "public-venue", { slug }),
    staleTime: 60_000,
  });
  const venue = venueData?.venue as {
    id: string; name: string; logo_url?: string;
  } | undefined;
  const venueId = venue?.id;

  // ── Courts + today's bookings (public endpoint) ───────────────────────────
  const { data: courtsData } = useQuery({
    queryKey: ["display-courts", slug, today],
    enabled: !!slug,
    queryFn: () => apiGet("api-bookings", "public-courts", { slug, date: today, showAll: "true" }),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  // ── Active venue checkins (direct Supabase — public SELECT policy) ─────────
  const { data: checkins } = useQuery({
    queryKey: ["display-checkins", venueId, today],
    enabled: !!venueId,
    queryFn: async () => {
      const { data } = await supabase
        .from("venue_checkins")
        .select("id, entry_type, entitlement_id, player_name, checked_in_at")
        .eq("venue_id", venueId!)
        .eq("session_date", today)
        .is("checked_out_at", null);
      return data ?? [];
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  // ── Realtime: invalidate on any booking / checkin change ──────────────────
  useEffect(() => {
    if (!venueId) return;

    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ["display-courts", slug] });
      queryClient.invalidateQueries({ queryKey: ["display-checkins", venueId] });
      setLastRefreshed(new Date());
    };

    const channel = supabase
      .channel(`venue-display-${venueId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings", filter: `venue_id=eq.${venueId}` },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "venue_checkins", filter: `venue_id=eq.${venueId}` },
        refresh,
      )
      .subscribe((status) => {
        setIsConnected(status === "SUBSCRIBED");
      });

    return () => { supabase.removeChannel(channel); };
  }, [venueId, slug, queryClient]);

  // ── Build CourtDisplay[] with live status ──────────────────────────────────
  const courts: CourtDisplay[] = useMemo(() => {
    if (!courtsData?.courts) return [];
    const rawBookings: Array<{ court_id: string; start: string; end: string }> =
      courtsData.bookings ?? [];

    return (courtsData.courts as Array<{
      id: string; name: string; court_number: number;
      sport_type: string | null;
    }>).map((court) => {
      const { status, endsAt, startsAt } = getCourtStatus(court.id, rawBookings, nowMs);
      return {
        id: court.id,
        name: court.name,
        court_number: court.court_number,
        sport_type: court.sport_type ?? "pickleball",
        status,
        endsAt,
        startsAt,
      };
    });
  }, [courtsData, nowMs]);

  // ── Group by sport_type, pickleball first ─────────────────────────────────
  const courtsBySport = useMemo(() => {
    const groups: Record<string, CourtDisplay[]> = {};
    courts.forEach((c) => {
      if (!groups[c.sport_type]) groups[c.sport_type] = [];
      groups[c.sport_type].push(c);
    });
    return groups;
  }, [courts]);

  const sportTypes = useMemo(
    () => [
      ...Object.keys(courtsBySport).filter((k) => k === "pickleball"),
      ...Object.keys(courtsBySport).filter((k) => k !== "pickleball"),
    ],
    [courtsBySport],
  );

  // ── Open Play queue: checkins without an entitlement (walkups) ────────────
  const openPlayQueue = useMemo(
    () =>
      (checkins ?? []).filter(
        (c: any) => c.entry_type === "open_play" || (c.entry_type === "manual" && !c.entitlement_id),
      ),
    [checkins],
  );

  // ── No slug ───────────────────────────────────────────────────────────────
  if (!slug) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-3xl font-display text-muted-foreground">
          Lägg till <code className="text-primary">?v=venue-slug</code> i URL:en
        </p>
      </div>
    );
  }

  return (
    <div className="h-screen bg-background text-foreground flex flex-col overflow-hidden select-none">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center justify-between px-10 py-5 border-b border-border">
        {/* Venue identity */}
        <div className="flex items-center gap-5">
          {venue?.logo_url && (
            <img
              src={venue.logo_url}
              alt={venue.name}
              className="h-12 w-auto object-contain"
            />
          )}
          <h1
            className="font-display font-black text-foreground tracking-tight"
            style={{ fontSize: "clamp(1.75rem, 3vw, 2.5rem)" }}
          >
            {venue?.name ?? slug}
          </h1>

          {/* Live pulse */}
          <div className="flex items-center gap-2 ml-4">
            <span
              className={`w-3 h-3 rounded-full ${isConnected ? "bg-court-free animate-pulse" : "bg-court-active"}`}
            />
            <span
              className={`font-bold uppercase tracking-widest ${isConnected ? "text-court-free" : "text-court-active"}`}
              style={{ fontSize: "clamp(0.7rem, 1vw, 0.9rem)" }}
            >
              {isConnected ? "LIVE" : "OFFLINE"}
            </span>
            {isConnected ? (
              <Wifi className="w-4 h-4 text-court-free" />
            ) : (
              <WifiOff className="w-4 h-4 text-court-active" />
            )}
          </div>
        </div>

        {/* Clock */}
        <div className="text-right">
          <p
            className="font-display font-black tabular-nums text-foreground leading-none"
            style={{ fontSize: "clamp(3rem, 5vw, 4.5rem)" }}
          >
            {now.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}
          </p>
          <p
            className="text-muted-foreground mt-1 capitalize"
            style={{ fontSize: "clamp(0.8rem, 1.2vw, 1rem)" }}
          >
            {now.toLocaleDateString("sv-SE", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </p>
        </div>
      </div>

      {/* ── Court columns ───────────────────────────────────────────────────── */}
      <div
        className="flex-1 min-h-0 grid"
        style={{ gridTemplateColumns: `repeat(${Math.max(sportTypes.length, 1)}, 1fr)` }}
      >
        {sportTypes.length === 0 ? (
          <div className="flex items-center justify-center col-span-full">
            <p className="text-2xl font-display text-muted-foreground">Laddar banor…</p>
          </div>
        ) : (
          sportTypes.map((sport, i) => (
            <SportColumn
              key={sport}
              sport={sport}
              courts={courtsBySport[sport]}
              nowMs={nowMs}
              colIndex={i}
              totalCols={sportTypes.length}
            />
          ))
        )}
      </div>

      {/* ── Open Play Queue (only visible if there are queued players) ─────── */}
      <AnimatePresence>
        {openPlayQueue.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex-shrink-0 border-t border-border px-10 py-5 overflow-hidden"
          >
            <div className="flex items-center gap-4 mb-4">
              <Users
                style={{ width: "clamp(1.25rem, 2vw, 1.75rem)", height: "clamp(1.25rem, 2vw, 1.75rem)" }}
                className="text-primary"
              />
              <h2
                className="font-display font-black uppercase tracking-widest text-foreground"
                style={{ fontSize: "clamp(1.1rem, 1.8vw, 1.5rem)" }}
              >
                Open Play Kö
              </h2>
              <span
                className="px-4 py-1 rounded-full bg-primary/15 text-primary font-bold"
                style={{ fontSize: "clamp(1rem, 1.5vw, 1.25rem)" }}
              >
                {openPlayQueue.length} väntande
              </span>
            </div>
            <div className="flex flex-wrap gap-3">
              {openPlayQueue.map((player: any, i: number) => (
                <motion.div
                  key={player.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.04 }}
                  className="glass-card rounded-2xl flex items-center gap-3 px-6 py-3"
                >
                  <span
                    className="font-mono text-muted-foreground font-bold"
                    style={{ fontSize: "clamp(1rem, 1.5vw, 1.25rem)" }}
                  >
                    #{i + 1}
                  </span>
                  <span
                    className="font-display font-semibold"
                    style={{ fontSize: "clamp(1rem, 1.5vw, 1.25rem)" }}
                  >
                    {player.player_name ?? "Spelare"}
                  </span>
                  <span
                    className="text-muted-foreground"
                    style={{ fontSize: "clamp(0.85rem, 1.2vw, 1rem)" }}
                  >
                    {new Date(player.checked_in_at).toLocaleTimeString("sv-SE", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center justify-end px-10 py-2 border-t border-border/40">
        <p className="font-mono text-muted-foreground/40" style={{ fontSize: "0.7rem" }}>
          Uppdaterades{" "}
          {lastRefreshed.toLocaleTimeString("sv-SE", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </p>
      </div>
    </div>
  );
}
