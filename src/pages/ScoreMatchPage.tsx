import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RotateCcw, Trophy } from "lucide-react";
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
  current_player: 1 | 2;
  current_leg: number;
  best_of_legs: number;
  winner_name?: string | null;
  venue_courts?: { name: string; court_number: number } | null;
};

const keypad = [1, 2, 3, 4, 5, 6, 7, 8, 9, "del", 0, "enter"] as const;

export default function ScoreMatchPage() {
  const { matchId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const deviceToken = searchParams.get("device") || "";
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");

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
  const currentName = match?.current_player === 1 ? match.player1_name : match?.player2_name;
  const currentRemaining = match?.current_player === 1 ? match.player1_remaining : match?.player2_remaining;
  const projected = useMemo(() => {
    if (!match || !input) return null;
    const score = Number(input);
    if (!Number.isInteger(score)) return null;
    const after = currentRemaining! - score;
    if (score > currentRemaining! || after === 1) return "BUST";
    return after;
  }, [currentRemaining, input, match]);

  const scoreMutation = useMutation({
    mutationFn: (score: number) => apiPost("api-score", "score", {
      match_id: matchId,
      score,
      darts_used: 3,
      device_token: deviceToken || undefined,
    }),
    onSuccess: () => {
      setInput("");
      queryClient.invalidateQueries({ queryKey: ["score-match", matchId] });
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

  const press = (key: typeof keypad[number]) => {
    if (key === "del") {
      setInput((value) => value.slice(0, -1));
      return;
    }
    if (key === "enter") {
      const score = input === "" ? 0 : Number(input);
      if (!Number.isInteger(score)) return;
      scoreMutation.mutate(score);
      return;
    }
    setInput((value) => `${value}${key}`.slice(0, 3));
  };

  if (isLoading) {
    return <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-white">laddar match...</main>;
  }

  if (isError || !match) {
    return <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-white">Matchen hittades inte.</main>;
  }

  const completed = match.status === "completed";

  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 py-5">
        <header className="mb-5 flex items-center justify-between gap-3">
          <Link to={deviceToken ? `/score/start?device=${encodeURIComponent(deviceToken)}` : "/today"} className="rounded-full bg-white/10 p-4">
            <ArrowLeft className="h-6 w-6" />
          </Link>
          <div className="text-center">
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-white/35">
              {match.venue_courts?.name || "Pickla Score"}
            </p>
            <p className="font-display text-3xl font-black">501</p>
          </div>
          <button
            onClick={() => undoMutation.mutate()}
            disabled={undoMutation.isPending || completed}
            className="rounded-full bg-white/10 p-4 disabled:opacity-30"
          >
            <RotateCcw className="h-6 w-6" />
          </button>
        </header>

        <section className="grid flex-1 gap-4 lg:grid-cols-[1fr_360px]">
          <div className="flex flex-col gap-4">
            <PlayerPanel
              active={!completed && match.current_player === 1}
              name={match.player1_name}
              legs={match.player1_legs}
              remaining={match.player1_remaining}
            />
            <PlayerPanel
              active={!completed && match.current_player === 2}
              name={match.player2_name}
              legs={match.player2_legs}
              remaining={match.player2_remaining}
            />
            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6">
              <div className="flex items-end justify-between">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.2em] text-white/35">Leg {match.current_leg}</p>
                  <p className="mt-1 font-display text-3xl font-black">Bäst av {match.best_of_legs}</p>
                </div>
                {completed ? (
                  <div className="flex items-center gap-2 rounded-full bg-emerald-300 px-5 py-3 text-neutral-950">
                    <Trophy className="h-5 w-5" />
                    <span className="font-display text-xl font-black">{match.winner_name}</span>
                  </div>
                ) : (
                  <p className="font-mono text-lg text-emerald-300">{currentName} kastar</p>
                )}
              </div>
            </div>
          </div>

          <aside className="rounded-[2rem] border border-white/10 bg-white p-5 text-neutral-950">
            <div className="mb-4 rounded-[1.5rem] bg-neutral-100 p-5">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-neutral-400">Score</p>
              <div className="mt-1 flex items-end justify-between">
                <p className="font-display text-7xl font-black leading-none">{input || "0"}</p>
                <p className={`font-mono text-xl ${projected === "BUST" ? "text-pink-600" : "text-neutral-400"}`}>
                  {projected === null ? "" : projected}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {keypad.map((key) => (
                <button
                  key={key}
                  onClick={() => press(key)}
                  disabled={completed || scoreMutation.isPending}
                  className={`h-20 rounded-2xl font-display text-3xl font-black disabled:opacity-30 ${
                    key === "enter" ? "bg-emerald-300 text-neutral-950" : key === "del" ? "bg-neutral-200 text-neutral-500" : "bg-neutral-950 text-white"
                  }`}
                >
                  {key === "del" ? "⌫" : key === "enter" ? "OK" : key}
                </button>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-4 gap-2">
              {[26, 41, 60, 81, 100, 140, 180, Number(currentRemaining || 0)].map((quick) => (
                <button
                  key={quick}
                  onClick={() => setInput(String(quick))}
                  disabled={completed}
                  className="rounded-xl bg-neutral-100 py-3 font-mono text-sm text-neutral-600 disabled:opacity-30"
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

function PlayerPanel({ active, name, legs, remaining }: { active: boolean; name: string; legs: number; remaining: number }) {
  return (
    <div className={`rounded-[2rem] border p-7 transition-all ${
      active ? "border-emerald-300 bg-emerald-300 text-neutral-950" : "border-white/10 bg-white/5 text-white"
    }`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className={`font-mono text-xs uppercase tracking-[0.2em] ${active ? "text-neutral-700" : "text-white/35"}`}>Spelare</p>
          <h2 className="mt-2 font-display text-5xl font-black leading-none">{name}</h2>
        </div>
        <div className="text-right">
          <p className={`font-mono text-xs uppercase tracking-[0.2em] ${active ? "text-neutral-700" : "text-white/35"}`}>Legs</p>
          <p className="font-display text-5xl font-black">{legs}</p>
        </div>
      </div>
      <p className="mt-7 font-display text-[9rem] font-black leading-none tracking-tight">{remaining}</p>
    </div>
  );
}
