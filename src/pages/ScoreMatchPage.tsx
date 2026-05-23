import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, MonitorPlay, RotateCcw, Sparkles, Square, Trophy } from "lucide-react";
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
  removed_turn_id?: string;
  turn?: {
    id: string;
    score: number;
    is_bust?: boolean;
    is_checkout?: boolean;
    player_number?: number;
    remaining_before?: number;
    remaining_after?: number;
  };
};

type ScoreTurn = {
  id: string;
  player_number: number;
  score: number;
  is_bust?: boolean;
  is_checkout?: boolean;
  darts_used?: number;
  remaining_before?: number;
  remaining_after?: number;
};

type PlayerStats = {
  player: PlayerSlot;
  turns: number;
  darts: number;
  scored: number;
  average: number;
  high: number;
  checkout: number;
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
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [dismissWinner, setDismissWinner] = useState(false);
  const [celebration, setCelebration] = useState<{ tone: "win" | "checkout" | "bust" | "hot"; text: string } | null>(null);

  const { data, isLoading, isError } = useQuery<{ match: ScoreMatch; turns: ScoreTurn[] }>({
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
  const latestTurn = data?.turns?.[0];
  const currentName = activePlayer?.name;
  const currentRemaining = correctionOpen && latestTurn ? latestTurn.remaining_before : activePlayer?.remaining;
  const matchEnded = match?.status === "completed" || match?.status === "cancelled";
  const projected = useMemo(() => {
    if (!match || !input) return null;
    const score = Number(input);
    if (!Number.isInteger(score)) return null;
    const after = Number(currentRemaining) - score;
    const doubleOut = match.checkout_rule !== "single_out";
    if (score > Number(currentRemaining) || (doubleOut && after === 1)) return "BUST";
    return after;
  }, [currentRemaining, input, match]);
  const checkoutHint = useMemo(() => {
    if (!match || !currentRemaining || correctionOpen || matchEnded) return null;
    return getCheckoutHint(Number(currentRemaining), match.checkout_rule || "double_out");
  }, [correctionOpen, currentRemaining, match, matchEnded]);

  const showCelebration = (next: { tone: "win" | "checkout" | "bust" | "hot"; text: string }) => {
    setCelebration(next);
    window.setTimeout(() => setCelebration((current) => (current?.text === next.text ? null : current)), 1_450);
  };

  const mergeScoreResult = (result: ScoreResponse) => {
    queryClient.setQueryData(["score-match", matchId], (current: { match: ScoreMatch; turns: ScoreTurn[] } | undefined) => {
      const currentTurns = current?.turns || [];
      const turns = result.turn
        ? [
            result.turn as ScoreTurn,
            ...currentTurns.filter((turn) => turn.id !== result.turn?.id && turn.id !== result.removed_turn_id),
          ]
        : currentTurns.filter((turn) => turn.id !== result.removed_turn_id);
      return { match: result.match, turns };
    });
  };

  const scoreMutation = useMutation({
    mutationFn: (score: number) => apiPost<ScoreResponse>("api-score", "score", {
      match_id: matchId,
      score,
      darts_used: 3,
      device_token: deviceToken || undefined,
    }),
    onSuccess: (result) => {
      setInput("");
      setDismissWinner(false);
      mergeScoreResult(result);
      if (result.turn?.is_bust) {
        setNotice({ tone: "warn", text: "BUST - score står kvar, turen går vidare" });
        showCelebration({ tone: "bust", text: "BUST" });
      } else if (result.turn?.is_checkout) {
        setNotice({ tone: "ok", text: "UT - legget är klart" });
        showCelebration({ tone: result.match.status === "completed" ? "win" : "checkout", text: result.match.status === "completed" ? "MATCH!" : "UT!" });
      } else if (result.turn) {
        setNotice({ tone: "ok", text: `${result.turn.score} registrerat` });
        if (result.turn.score === 180) showCelebration({ tone: "hot", text: "180!" });
      }
      window.setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["score-match", matchId] });
      }, 150);
    },
    onError: (error: Error) => toast.error(error.message || "Kunde inte registrera score"),
  });

  const correctionMutation = useMutation({
    mutationFn: (score: number) => apiPost<ScoreResponse>("api-score", "correct-last-turn", {
      match_id: matchId,
      score,
      darts_used: 3,
      device_token: deviceToken || undefined,
    }),
    onSuccess: (result) => {
      setInput("");
      setCorrectionOpen(false);
      setDismissWinner(false);
      mergeScoreResult(result);
      setNotice({ tone: "ok", text: "Score ändrad" });
      if (result.turn?.is_checkout) showCelebration({ tone: result.match.status === "completed" ? "win" : "checkout", text: result.match.status === "completed" ? "MATCH!" : "UT!" });
      toast.success("Senaste score ändrad");
      window.setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["score-match", matchId] });
      }, 150);
    },
    onError: (error: Error) => toast.error(error.message || "Kunde inte ändra score"),
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

  const rematchMutation = useMutation({
    mutationFn: () => apiPost<ScoreResponse>("api-score", "rematch", {
      match_id: matchId,
      device_token: deviceToken || undefined,
    }),
    onSuccess: (result) => {
      toast.success("Rematch startad");
      navigate(`/score/match/${result.match.id}${deviceToken ? `?device=${encodeURIComponent(deviceToken)}` : ""}`, { replace: true });
    },
    onError: (error: Error) => toast.error(error.message || "Kunde inte starta rematch"),
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
      if (correctionOpen) correctionMutation.mutate(score);
      else scoreMutation.mutate(score);
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
  const stats = computeStats(players, data?.turns || []);
  const winnerStats = stats.find((item) => item.player.name === match.winner_name) || stats[0];
  const showWinner = completed && winnerStats && !correctionOpen && !dismissWinner;
  const scoreInputDisabled = (ended && !correctionOpen) || scoreMutation.isPending || correctionMutation.isPending;

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
              {latestTurn && (
                <button
                  onClick={() => {
                    setCorrectionOpen(true);
                    setDismissWinner(true);
                    setInput(String(latestTurn.score));
                    setNotice({ tone: "warn", text: `Ändrar senaste: ${latestTurn.score}` });
                  }}
                  disabled={correctionMutation.isPending}
                  className="mt-3 rounded-full bg-white/10 px-4 py-2 font-mono text-xs text-white/70 disabled:opacity-40"
                >
                  Ändra senaste score
                </button>
              )}
            </div>
          </div>

          <aside className="flex min-h-0 flex-col rounded-[1.5rem] border border-white/10 bg-white p-3 text-neutral-950">
            <div className="mb-2 shrink-0 rounded-[1.25rem] bg-neutral-100 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-neutral-400">
                  {correctionOpen ? "Ändra score" : "Score"}
                </p>
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
              {correctionOpen && (
                <div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-pink-50 px-3 py-2">
                  <p className="font-mono text-xs text-pink-700">Ersätter senaste kastet</p>
                  <button
                    onClick={() => {
                      setCorrectionOpen(false);
                      setInput("");
                      setNotice(null);
                    }}
                    className="font-mono text-xs font-bold text-neutral-500"
                  >
                    Avbryt
                  </button>
                </div>
              )}
              {checkoutHint && (
                <div className="mt-2 rounded-xl bg-emerald-50 px-3 py-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-emerald-700">Utgångsförslag</p>
                  <p className="mt-1 font-display text-xl font-black text-neutral-950">
                    Gå ut: {checkoutHint}
                  </p>
                </div>
              )}
            </div>

            <div className="grid flex-1 grid-cols-3 gap-2">
              {keypad.map((key) => (
                <button
                  key={key}
                  onClick={() => press(key)}
                  disabled={scoreInputDisabled}
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
      {showWinner && (
        <WinnerView
          winner={winnerStats}
          stats={stats}
          onCorrect={() => {
            if (!latestTurn) return;
            setCorrectionOpen(true);
            setDismissWinner(true);
            setInput(String(latestTurn.score));
            setNotice({ tone: "warn", text: `Ändrar senaste: ${latestTurn.score}` });
          }}
          onRematch={() => rematchMutation.mutate()}
          onNewMatch={() => navigate(deviceToken ? `/score/start?device=${encodeURIComponent(deviceToken)}` : "/today")}
          onClose={() => navigate(deviceToken ? `/score/start?device=${encodeURIComponent(deviceToken)}` : "/today", { replace: true })}
          rematchPending={rematchMutation.isPending}
        />
      )}
      {celebration && <ScoreCelebration tone={celebration.tone} text={celebration.text} />}
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

function computeStats(players: PlayerSlot[], turns: ScoreTurn[]): PlayerStats[] {
  return players.map((player) => {
    const playerTurns = turns.filter((turn) => Number(turn.player_number) === player.number);
    const scoredTurns = playerTurns.map((turn) => (turn.is_bust ? 0 : Number(turn.score || 0)));
    const scored = scoredTurns.reduce((sum, score) => sum + score, 0);
    const darts = playerTurns.reduce((sum, turn) => sum + Number(turn.darts_used || 3), 0);
    const checkout = playerTurns
      .filter((turn) => turn.is_checkout)
      .reduce((high, turn) => Math.max(high, Number(turn.score || 0)), 0);
    return {
      player,
      turns: playerTurns.length,
      darts,
      scored,
      average: playerTurns.length ? scored / playerTurns.length : 0,
      high: scoredTurns.reduce((high, score) => Math.max(high, score), 0),
      checkout,
    };
  });
}

function WinnerView({
  winner,
  stats,
  onRematch,
  onNewMatch,
  onClose,
  onCorrect,
  rematchPending,
}: {
  winner: PlayerStats;
  stats: PlayerStats[];
  onRematch: () => void;
  onNewMatch: () => void;
  onClose: () => void;
  onCorrect: () => void;
  rematchPending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-emerald-300 p-5 text-neutral-950">
      <div className="flex h-full w-full max-w-5xl flex-col justify-between">
        <header className="flex items-center justify-between gap-4">
          <div className="inline-flex items-center gap-3 rounded-full bg-neutral-950 px-5 py-3 text-white">
            <Trophy className="h-6 w-6 text-emerald-300" />
            <span className="font-mono text-xs uppercase tracking-[0.2em]">Match klar</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onCorrect} className="rounded-full bg-neutral-950/10 px-5 py-3 font-mono text-xs font-bold">
              Ändra score
            </button>
            <button onClick={onClose} className="rounded-full bg-white/70 px-5 py-3 font-mono text-xs font-bold">
              Avbryt
            </button>
          </div>
        </header>

        <section className="grid min-h-0 flex-1 items-center gap-6 py-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="mb-3 font-mono text-sm uppercase tracking-[0.26em] text-neutral-700">Vinnare</p>
            <h1 className="font-display text-[clamp(5rem,18vh,13rem)] font-black leading-none tracking-tight">
              {winner.player.name}
            </h1>
            <div className="mt-5 grid grid-cols-3 gap-3">
              <StatTile label="3-pilsnitt" value={winner.average.toFixed(1)} />
              <StatTile label="Högsta" value={String(winner.high)} />
              <StatTile label="Checkout" value={winner.checkout ? String(winner.checkout) : "-"} />
            </div>
          </div>

          <div className="rounded-[2rem] bg-neutral-950 p-5 text-white">
            <div className="mb-4 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-emerald-300" />
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-white/50">Match stats</p>
            </div>
            <div className="space-y-2">
              {stats.map((item) => (
                <div key={item.player.number} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-2xl bg-white/8 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-display text-2xl font-black">{item.player.name}</p>
                    <p className="font-mono text-xs text-white/40">{item.turns} rundor · {item.scored} poäng</p>
                  </div>
                  <p className="font-mono text-sm text-white/65">{item.average.toFixed(1)} avg</p>
                  <p className="font-display text-3xl font-black">{item.player.legs}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <footer className="grid grid-cols-3 gap-3">
          <button
            onClick={onRematch}
            disabled={rematchPending}
            className="rounded-full bg-neutral-950 px-5 py-5 font-display text-2xl font-black text-white disabled:opacity-50"
          >
            Spela igen
          </button>
          <button onClick={onNewMatch} className="rounded-full bg-white px-5 py-5 font-display text-2xl font-black">
            Ny match
          </button>
          <button onClick={onClose} className="rounded-full border border-neutral-950/20 bg-white/40 px-5 py-5 font-display text-2xl font-black">
            Stäng
          </button>
        </footer>
      </div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.5rem] bg-white/65 p-4">
      <p className="font-mono text-xs uppercase tracking-[0.16em] text-neutral-500">{label}</p>
      <p className="mt-2 font-display text-4xl font-black leading-none">{value}</p>
    </div>
  );
}

function ScoreCelebration({ tone, text }: { tone: "win" | "checkout" | "bust" | "hot"; text: string }) {
  const className = tone === "bust"
    ? "bg-pink-500 text-white"
    : tone === "hot"
      ? "bg-white text-neutral-950"
      : "bg-emerald-300 text-neutral-950";
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center">
      <style>
        {`@keyframes score-pop {
          0% { opacity: 0; transform: scale(0.72) rotate(-2deg); }
          16% { opacity: 1; transform: scale(1.08) rotate(1deg); }
          64% { opacity: 1; transform: scale(1) rotate(0deg); }
          100% { opacity: 0; transform: scale(1.18) rotate(0deg); }
        }`}
      </style>
      <div className={`animate-[score-pop_1.45s_ease-out_forwards] rounded-[2rem] px-10 py-7 shadow-2xl ${className}`}>
        <p className="font-display text-[clamp(5rem,18vh,13rem)] font-black leading-none tracking-tight">{text}</p>
      </div>
    </div>
  );
}

const singleSegments = Array.from({ length: 20 }, (_, index) => ({ label: `S${index + 1}`, value: index + 1 }));
const doubleSegments = Array.from({ length: 20 }, (_, index) => ({ label: `D${index + 1}`, value: (index + 1) * 2 }));
const tripleSegments = Array.from({ length: 20 }, (_, index) => ({ label: `T${index + 1}`, value: (index + 1) * 3 }));
const bullSegments = [{ label: "25", value: 25 }, { label: "BULL", value: 50 }];
const allSegments = [...tripleSegments, ...doubleSegments, ...singleSegments, ...bullSegments].sort((a, b) => b.value - a.value);
const doubleOutSegments = [...doubleSegments, { label: "BULL", value: 50 }].sort((a, b) => b.value - a.value);

function getCheckoutHint(remaining: number, rule: "single_out" | "double_out") {
  if (remaining <= 0 || remaining > 170) return null;
  const finalSegments = rule === "double_out" ? doubleOutSegments : [...singleSegments, ...doubleSegments, ...tripleSegments, ...bullSegments];
  for (const last of finalSegments) {
    if (last.value === remaining) return last.label;
  }
  for (const first of allSegments) {
    for (const last of finalSegments) {
      if (first.value + last.value === remaining) return `${first.label} ${last.label}`;
    }
  }
  for (const first of allSegments) {
    for (const second of allSegments) {
      for (const last of finalSegments) {
        if (first.value + second.value + last.value === remaining) return `${first.label} ${second.label} ${last.label}`;
      }
    }
  }
  return null;
}
