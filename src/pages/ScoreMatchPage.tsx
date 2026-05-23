import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, MonitorPlay, RotateCcw, Square, Trophy } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { apiGet, apiPost } from "@/lib/api";

type ScoreMatch = {
  id: string;
  score_session_id: string;
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
  target_score?: number;
  checkout_rule?: "single_out" | "double_out";
  player_slots?: PlayerSlot[];
  winner_name?: string | null;
  venue_courts?: { name: string; court_number: number } | null;
};

type PlayerSlot = {
  number: number;
  id?: string | null;
  name: string;
  legs: number;
  remaining: number;
};

type ScoreResponse = {
  match: ScoreMatch;
  turn?: {
    score: number;
    is_bust?: boolean;
    is_checkout?: boolean;
    player_number?: number;
    remaining_after?: number;
  };
};

const keypad = [1, 2, 3, 4, 5, 6, 7, 8, 9, "del", 0, "enter"] as const;

export default function ScoreMatchPage() {
  const { matchId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const deviceToken = searchParams.get("device") || "";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  const { data, isLoading, isError } = useQuery<{ match: ScoreMatch; turns: unknown[] }>({
    queryKey: ["score-match", matchId],
    enabled: !!matchId,
    queryFn: () => apiGet("api-score", "match", { matchId }),
    refetchInterval: 2_500,
  });

  useEffect(() => {
    if (!matchId) return;
    const channel = supabase
      .channel(`score-match-${matchId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "score_matches", filter: `id=eq.${matchId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ["score-match", matchId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "score_turns", filter: `match_id=eq.${matchId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ["score-match", matchId] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId, queryClient]);

  const match = data?.match;
  const players = useMemo<PlayerSlot[]>(() => {
    if (!match) return [];
    if (Array.isArray(match.player_slots) && match.player_slots.length) return match.player_slots;
    return [
      { number: 1, id: match.player1_name, name: match.player1_name, legs: match.player1_legs, remaining: match.player1_remaining },
      { number: 2, id: match.player2_name, name: match.player2_name, legs: match.player2_legs, remaining: match.player2_remaining },
    ];
  }, [match]);
  const activePlayer = players.find((player) => player.number === match?.current_player) || players[0];
  const otherPlayers = players.filter((player) => player.number !== activePlayer?.number);
  const currentName = activePlayer?.name;
  const currentRemaining = activePlayer?.remaining;
  const projected = useMemo(() => {
    if (!match || !input) return null;
    const score = Number(input);
    if (!Number.isInteger(score)) return null;
    const after = Number(currentRemaining) - score;
    const doubleOut = match.checkout_rule !== "single_out";
    if (score > Number(currentRemaining) || (doubleOut && after === 1)) return "BUST";
    return after;
  }, [currentRemaining, input, match]);

  const scoreMutation = useMutation({
    mutationFn: (score: number) => apiPost<ScoreResponse>("api-score", "score", {
      match_id: matchId,
      score,
      darts_used: 3,
      device_token: deviceToken || undefined,
    }),
    onSuccess: (result) => {
      setInput("");
      queryClient.setQueryData(["score-match", matchId], (current: { match: ScoreMatch; turns: unknown[] } | undefined) => ({
        match: result.match,
        turns: current?.turns || [],
      }));
      if (result.turn?.is_bust) {
        setNotice({ tone: "warn", text: "BUST - score står kvar, turen går vidare" });
      } else if (result.turn?.is_checkout) {
        setNotice({ tone: "ok", text: "UT - legget är klart" });
      } else if (result.turn) {
        setNotice({ tone: "ok", text: `${result.turn.score} registrerat` });
      }
      window.setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["score-match", matchId] });
      }, 150);
    },
    onError: (error: Error) => toast.error(error.message || "Kunde inte registrera score"),
  });

  const undoMutation = useMutation({
    mutationFn: () => apiPost("api-score", "undo", {
      match_id: matchId,
      device_token: deviceToken || undefined,
    }),
    onSuccess: () => {
      setInput("");
      queryClient.invalidateQueries({ queryKey: ["score-match", matchId] });
      toast.success("Ångrat");
    },
    onError: (error: Error) => toast.error(error.message || "Kunde inte ångra"),
  });

  const endMutation = useMutation({
    mutationFn: () => apiPost("api-score", "end-match", {
      match_id: matchId,
      device_token: deviceToken || undefined,
    }),
    onSuccess: () => {
      toast.success("Match avslutad");
      navigate(deviceToken ? `/score/start?device=${encodeURIComponent(deviceToken)}` : "/today", { replace: true });
    },
    onError: (error: Error) => toast.error(error.message || "Kunde inte avsluta match"),
  });

  const press = (key: typeof keypad[number]) => {
    if (key === "del") {
      setNotice(null);
      setInput((value) => value.slice(0, -1));
      return;
    }
    if (key === "enter") {
      const score = input === "" ? 0 : Number(input);
      if (!Number.isInteger(score)) return;
      scoreMutation.mutate(score);
      return;
    }
    setNotice(null);
    setInput((value) => `${value}${key}`.slice(0, 3));
  };

  if (isLoading) {
    return <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-white">laddar match...</main>;
  }

  if (isError || !match) {
    return <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-white">Matchen hittades inte.</main>;
  }

  const completed = match.status === "completed";
  const ended = completed || match.status === "cancelled";
  const quickScores = [26, 41, 45, 60, 81, 85, 100, 140, 180, Number(currentRemaining || 0)]
    .filter((value, index, list) => value > 0 && list.indexOf(value) === index);

  return (
    <main className="h-[100svh] overflow-hidden bg-neutral-950 text-white">
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-3 py-3 sm:px-4">
        <header className="mb-2 flex h-14 shrink-0 items-center justify-between gap-3">
          <Link to={deviceToken ? `/score/start?device=${encodeURIComponent(deviceToken)}` : "/today"} className="rounded-full bg-white/10 p-3">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="text-center">
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-white/35">
              {match.venue_courts?.name || "Pickla Score"}
            </p>
            <p className="font-display text-[clamp(1.5rem,4vh,2.3rem)] font-black leading-none">
              {match.game_type || "501"} · först till {Math.floor(match.best_of_legs / 2) + 1}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to={`/display/broadcast/${match.score_session_id}`}
              className="rounded-full bg-emerald-300 p-3 text-neutral-950"
              title="Öppna broadcast"
            >
              <MonitorPlay className="h-5 w-5" />
            </Link>
            <button
              onClick={() => undoMutation.mutate()}
              disabled={undoMutation.isPending || ended}
              className="rounded-full bg-white/10 p-3 disabled:opacity-30"
            >
              <RotateCcw className="h-5 w-5" />
            </button>
            {!ended && (
              <button
                onClick={() => {
                  if (confirm("Avsluta matchen och gå tillbaka till start?")) endMutation.mutate();
                }}
                disabled={endMutation.isPending}
                className="rounded-full bg-white/10 p-3 disabled:opacity-30"
                title="Avsluta match"
              >
                <Square className="h-5 w-5" />
              </button>
            )}
            {ended && (
              <Link
                to={deviceToken ? `/score/start?device=${encodeURIComponent(deviceToken)}` : "/today"}
                className="rounded-full bg-white px-4 py-3 font-mono text-xs font-bold text-neutral-950"
              >
                Ny match
              </Link>
            )}
          </div>
        </header>

        <section className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto_auto] gap-3">
            {activePlayer && (
              <ActivePlayerPanel
                completed={ended}
                name={activePlayer.name}
                legs={activePlayer.legs}
                remaining={activePlayer.remaining}
              />
            )}
            <div className={`grid gap-2 ${otherPlayers.length > 1 ? "sm:grid-cols-2" : ""}`}>
              {otherPlayers.map((player) => (
                <PlayerPanel
                  key={player.number}
                  name={player.name}
                  legs={player.legs}
                  remaining={player.remaining}
                />
              ))}
            </div>
            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.2em] text-white/35">Leg {match.current_leg}</p>
                  <p className="mt-0.5 font-display text-[clamp(1.15rem,3vh,1.8rem)] font-black leading-none">
                    {match.checkout_rule === "single_out" ? "enkel ut" : "dubbel ut"}
                  </p>
                </div>
                {completed ? (
                  <div className="flex items-center gap-2 rounded-full bg-emerald-300 px-4 py-2 text-neutral-950">
                    <Trophy className="h-4 w-4" />
                    <span className="font-display text-lg font-black">{match.winner_name}</span>
                  </div>
                ) : ended ? (
                  <p className="font-mono text-sm text-white/50">Match avslutad</p>
                ) : (
                  <p className="font-mono text-[clamp(0.95rem,2.5vh,1.25rem)] text-emerald-300">{currentName} kastar</p>
                )}
              </div>
            </div>
          </div>

          <aside className="flex min-h-0 flex-col rounded-[1.5rem] border border-white/10 bg-white p-3 text-neutral-950">
            <div className="mb-2 shrink-0 rounded-[1.25rem] bg-neutral-100 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-neutral-400">Score</p>
                {notice && (
                  <p className={`truncate font-mono text-[10px] uppercase tracking-[0.12em] ${
                    notice.tone === "warn" ? "text-pink-600" : "text-emerald-600"
                  }`}>
                    {notice.text}
                  </p>
                )}
              </div>
              <div className="mt-0.5 flex items-end justify-between">
                <p className="font-display text-[clamp(3rem,10vh,5rem)] font-black leading-none">{input || "0"}</p>
                <p className={`font-mono text-lg ${projected === "BUST" ? "text-pink-600" : projected === 0 ? "text-emerald-600" : "text-neutral-400"}`}>
                  {projected === null ? "" : projected === 0 ? "UT" : projected}
                </p>
              </div>
            </div>

            <div className="grid flex-1 grid-cols-3 gap-2">
              {keypad.map((key) => (
                <button
                  key={key}
                  onClick={() => press(key)}
                  disabled={ended || scoreMutation.isPending}
                  className={`min-h-0 rounded-xl font-display text-[clamp(1.45rem,5vh,2.35rem)] font-black disabled:opacity-30 ${
                    key === "enter" ? "bg-emerald-300 text-neutral-950" : key === "del" ? "bg-neutral-200 text-neutral-500" : "bg-neutral-950 text-white"
                  }`}
                >
                  {key === "del" ? "⌫" : key === "enter" ? (projected === 0 ? "UT" : "OK") : key}
                </button>
              ))}
            </div>

            <div className="mt-2 grid shrink-0 grid-cols-5 gap-1.5">
              {quickScores.map((quick) => (
                <button
                  key={quick}
                  onClick={() => setInput(String(quick))}
                  disabled={ended}
                  className="rounded-lg bg-neutral-100 py-2 font-mono text-xs text-neutral-600 disabled:opacity-30"
                >
                  {quick}
                </button>
              ))}
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

function ActivePlayerPanel({ completed, name, legs, remaining }: { completed: boolean; name: string; legs: number; remaining: number }) {
  return (
    <div className={`min-h-0 rounded-[1.75rem] border p-4 transition-all ${
      completed ? "border-white/10 bg-white/5 text-white" : "border-emerald-300 bg-emerald-300 text-neutral-950"
    }`}>
      <div className="flex h-full min-h-0 flex-col justify-between gap-2">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className={`font-mono text-xs uppercase tracking-[0.2em] ${completed ? "text-white/35" : "text-neutral-700"}`}>Kastar nu</p>
            <h2 className="mt-1 truncate font-display text-[clamp(2.2rem,7vh,4.5rem)] font-black leading-none">{name}</h2>
          </div>
          <div className="text-right">
            <p className={`font-mono text-xs uppercase tracking-[0.2em] ${completed ? "text-white/35" : "text-neutral-700"}`}>Legs</p>
            <p className="font-display text-[clamp(2rem,6vh,4rem)] font-black leading-none">{legs}</p>
          </div>
        </div>
        <p className="font-display text-[clamp(6rem,26vh,12rem)] font-black leading-none tracking-tight">{remaining}</p>
      </div>
    </div>
  );
}

function PlayerPanel({ name, legs, remaining }: { name: string; legs: number; remaining: number }) {
  return (
    <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-3 text-white">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-display text-[clamp(1.3rem,4vh,2rem)] font-black leading-none">{name}</p>
          <p className="mt-1 font-mono text-xs text-white/35">Legs {legs}</p>
        </div>
        <p className="font-display text-[clamp(2.2rem,6vh,4rem)] font-black leading-none">{remaining}</p>
      </div>
    </div>
  );
}
