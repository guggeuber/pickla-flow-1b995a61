import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Radio, Trophy, Zap } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { apiGet } from "@/lib/api";

type BroadcastMatch = {
  id: string;
  status: string;
  player1_name: string;
  player2_name: string;
  player1_legs: number;
  player2_legs: number;
  player1_remaining: number;
  player2_remaining: number;
  current_player: number;
  current_leg: number;
  best_of_legs: number;
  game_type?: string;
  player_slots?: BroadcastPlayerSlot[];
  winner_name?: string | null;
  updated_at: string;
  venue_courts?: { name: string; court_number: number } | null;
};

type BroadcastPlayerSlot = {
  number: number;
  name: string;
  legs: number;
  remaining: number;
};

type BroadcastEvent = {
  id: string;
  event_type: string;
  title: string;
  message?: string | null;
  priority: number;
  created_at: string;
  payload?: Record<string, unknown>;
};

type BroadcastState = {
  session: { id: string; name: string; status: string; venues?: { name: string } | null };
  matches: BroadcastMatch[];
  events: BroadcastEvent[];
};

function heat(match: BroadcastMatch) {
  let score = 0;
  if (match.status === "in_progress") score += 10;
  if (match.status === "completed") score -= 6;
  if (Math.abs(match.player1_legs - match.player2_legs) <= 1) score += 3;
  if (match.player1_remaining <= 170 || match.player2_remaining <= 170) score += 4;
  const need = Math.floor(match.best_of_legs / 2) + 1;
  if (match.player1_legs === need - 1 && match.player2_legs === need - 1) score += 8;
  score += Math.max(0, 5 - Math.floor((Date.now() - new Date(match.updated_at).getTime()) / 30_000));
  return score;
}

export default function ScoreBroadcastPage() {
  const { scoreSessionId = "" } = useParams();
  const queryClient = useQueryClient();
  const [rotationIndex, setRotationIndex] = useState(0);

  const { data, isLoading, isError } = useQuery<BroadcastState>({
    queryKey: ["score-broadcast", scoreSessionId],
    enabled: !!scoreSessionId,
    queryFn: () => apiGet("api-score", "live-state", { scoreSessionId }),
    refetchInterval: 5_000,
  });

  useEffect(() => {
    if (!scoreSessionId) return;
    const channel = supabase
      .channel(`score-broadcast-${scoreSessionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "score_matches", filter: `score_session_id=eq.${scoreSessionId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ["score-broadcast", scoreSessionId] });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "score_events", filter: `score_session_id=eq.${scoreSessionId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ["score-broadcast", scoreSessionId] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, scoreSessionId]);

  useEffect(() => {
    const id = setInterval(() => setRotationIndex((current) => current + 1), 18_000);
    return () => clearInterval(id);
  }, []);

  const matches = useMemo(() => data?.matches || [], [data?.matches]);
  const ranked = useMemo(() => [...matches].sort((a, b) => heat(b) - heat(a)), [matches]);
  const hotMatches = ranked.filter((match) => match.status === "in_progress");
  const featured = hotMatches.length ? hotMatches[rotationIndex % hotMatches.length] : ranked[0];
  const upNext = matches.find((match) => match.status === "pending") || ranked.find((match) => match.id !== featured?.id);
  const tickerItems = (data?.events || []).slice(0, 12);

  if (isLoading) {
    return <main className="flex h-screen items-center justify-center bg-[#050508] text-white">loading broadcast...</main>;
  }

  if (isError || !data) {
    return <main className="flex h-screen items-center justify-center bg-[#050508] text-white">broadcast saknas</main>;
  }

  return (
    <main className="relative h-screen overflow-hidden bg-[#050508] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(46,255,146,0.18),transparent_35%),radial-gradient(circle_at_80%_30%,rgba(255,59,142,0.18),transparent_30%)]" />
      <div className="relative z-10 flex h-full flex-col p-10">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <p className="font-mono text-sm uppercase tracking-[0.32em] text-emerald-300">Pickla Broadcast</p>
            <h1 className="font-display text-6xl font-black leading-none">{data.session.name}</h1>
          </div>
          <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/10 px-6 py-4">
            <span className="h-3 w-3 rounded-full bg-emerald-300 shadow-[0_0_24px_rgba(110,255,180,0.8)]" />
            <span className="font-mono text-sm uppercase tracking-[0.22em]">{data.session.venues?.name || "Live"}</span>
          </div>
        </header>

        <section className="grid min-h-0 flex-1 grid-cols-[1fr_420px] gap-8">
          <motion.div
            key={featured?.id || "empty"}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex min-h-0 flex-col justify-between rounded-[2.5rem] border border-white/10 bg-white/[0.08] p-10 shadow-2xl"
          >
            {featured ? (
              <>
                <div className="flex items-center justify-between">
                  <div className="rounded-full bg-emerald-300 px-5 py-2 font-mono text-sm font-bold uppercase tracking-[0.2em] text-neutral-950">
                    Featured Match
                  </div>
                  <div className="font-mono text-3xl text-white/60">
                    Board {featured.venue_courts?.court_number || "-"}
                  </div>
                </div>

                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-8">
                  <BroadcastPlayer
                    active={featured.current_player === getPlayers(featured)[0]?.number && featured.status === "in_progress"}
                    player={getPlayers(featured)[0]}
                  />
                  <div className="font-display text-7xl font-black text-white/25">VS</div>
                  <BroadcastPlayer
                    active={featured.current_player === getPlayers(featured)[1]?.number && featured.status === "in_progress"}
                    player={getPlayers(featured)[1]}
                  />
                </div>

                {getPlayers(featured).length > 2 && (
                  <div className="grid grid-cols-2 gap-4">
                    {getPlayers(featured).slice(2).map((player) => (
                      <div
                        key={player.number}
                        className={`rounded-2xl px-5 py-4 ${
                          featured.current_player === player.number && featured.status === "in_progress"
                            ? "bg-emerald-300 text-neutral-950"
                            : "bg-white/5 text-white"
                        }`}
                      >
                        <p className="font-display text-3xl font-black">{player.name}</p>
                        <p className="font-mono text-lg opacity-70">{player.remaining} kvar · {player.legs} leg</p>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between border-t border-white/10 pt-8">
                  <p className="font-mono text-2xl text-white/55">Leg {featured.current_leg} · bäst av {featured.best_of_legs}</p>
                  {featured.status === "completed" ? (
                    <p className="flex items-center gap-3 font-display text-4xl font-black text-emerald-300">
                      <Trophy className="h-9 w-9" /> {featured.winner_name}
                    </p>
                  ) : (
                    <p className="flex items-center gap-3 font-display text-4xl font-black text-emerald-300">
                      <Zap className="h-9 w-9" /> LIVE
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center font-display text-5xl font-black text-white/40">
                Inga matcher live
              </div>
            )}
          </motion.div>

          <aside className="grid min-h-0 grid-rows-[auto_1fr] gap-6">
            <Panel title="Now Playing" icon={<Radio className="h-5 w-5" />}>
              <div className="space-y-4">
                {hotMatches.slice(0, 5).map((match) => (
                  <MatchRow key={match.id} match={match} active={match.id === featured?.id} />
                ))}
                {!hotMatches.length && <p className="font-mono text-white/40">Väntar på matcher...</p>}
              </div>
            </Panel>

            <Panel title="Up Next">
              {upNext ? (
                <div>
                  <p className="font-mono text-xl text-white/50">Board {upNext.venue_courts?.court_number || "-"}</p>
                  <p className="mt-3 font-display text-4xl font-black">{upNext.player1_name}</p>
                  <p className="font-display text-4xl font-black text-white/45">vs {upNext.player2_name}</p>
                </div>
              ) : (
                <p className="font-mono text-white/40">Ingen kö just nu</p>
              )}
            </Panel>
          </aside>
        </section>
      </div>

      <div className="absolute bottom-0 left-0 right-0 z-20 overflow-hidden border-t border-white/10 bg-neutral-950/95 py-5">
        <motion.div
          className="flex w-max gap-12 whitespace-nowrap font-display text-3xl font-black"
          animate={{ x: ["0%", "-50%"] }}
          transition={{ duration: 35, repeat: Infinity, ease: "linear" }}
        >
          {[...tickerItems, ...tickerItems].map((event, index) => (
            <span key={`${event.id}-${index}`} className="px-2">
              <span className="text-emerald-300">{event.event_type.replaceAll("_", " ")}</span> · {event.title}
            </span>
          ))}
          {!tickerItems.length && <span className="px-10 text-white/40">Pickla Score live...</span>}
        </motion.div>
      </div>
    </main>
  );
}

function getPlayers(match: BroadcastMatch): BroadcastPlayerSlot[] {
  if (Array.isArray(match.player_slots) && match.player_slots.length) return match.player_slots;
  return [
    { number: 1, name: match.player1_name, legs: match.player1_legs, remaining: match.player1_remaining },
    { number: 2, name: match.player2_name, legs: match.player2_legs, remaining: match.player2_remaining },
  ];
}

function BroadcastPlayer({ active, player }: { active: boolean; player?: BroadcastPlayerSlot }) {
  const safePlayer = player || { number: 0, name: "-", legs: 0, remaining: 0 };
  return (
    <div className={`rounded-[2rem] p-8 ${active ? "bg-emerald-300 text-neutral-950" : "bg-white/5 text-white"}`}>
      <p className={`font-mono text-sm uppercase tracking-[0.22em] ${active ? "text-neutral-700" : "text-white/35"}`}>
        {active ? "At the oche" : "Player"}
      </p>
      <h2 className="mt-3 min-h-28 font-display text-6xl font-black leading-none">{safePlayer.name}</h2>
      <div className="mt-10 flex items-end justify-between">
        <div>
          <p className={`font-mono text-sm uppercase tracking-[0.2em] ${active ? "text-neutral-700" : "text-white/35"}`}>To go</p>
          <p className="font-display text-8xl font-black leading-none">{safePlayer.remaining}</p>
        </div>
        <div className="text-right">
          <p className={`font-mono text-sm uppercase tracking-[0.2em] ${active ? "text-neutral-700" : "text-white/35"}`}>Legs</p>
          <p className="font-display text-7xl font-black">{safePlayer.legs}</p>
        </div>
      </div>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-[2rem] border border-white/10 bg-white/[0.08] p-7">
      <div className="mb-6 flex items-center gap-3">
        {icon}
        <h3 className="font-mono text-sm uppercase tracking-[0.24em] text-white/45">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function MatchRow({ match, active }: { match: BroadcastMatch; active: boolean }) {
  const players = getPlayers(match);
  return (
    <div className={`rounded-2xl p-4 ${active ? "bg-emerald-300 text-neutral-950" : "bg-white/5"}`}>
      <div className="flex items-center justify-between">
        <p className="font-display text-2xl font-black">Board {match.venue_courts?.court_number || "-"}</p>
        <p className="font-mono text-sm opacity-60">Leg {match.current_leg}</p>
      </div>
      <p className="mt-2 font-mono text-lg opacity-80">
        {players.map((player) => `${player.name} ${player.legs}`).join(" · ")}
      </p>
    </div>
  );
}
