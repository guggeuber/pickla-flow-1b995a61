import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, Bot, Check, Link2, Minus, Plus, Radio, Trophy, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import picklaLogo from "@/assets/pickla-logo.svg";
import { apiGet, apiPost } from "@/lib/api";

type Court = {
  id: string;
  name: string;
  court_number: number;
  sport_type: string | null;
};

type DeviceState = {
  device: { id: string; name: string; device_token: string; venue_court_id?: string | null };
  venue?: { id: string; name: string; slug: string };
  resource?: Court | null;
  courts: Court[];
  activeMatch?: { id: string; score_session_id: string; player1_name: string; player2_name: string } | null;
};

type WalkInResult = {
  session: { id: string };
  match?: { id: string };
  matches?: Array<{ id: string }>;
};

type MatchPlayer = {
  name: string;
  auth_user_id?: string | null;
  linked?: boolean;
  is_bot?: boolean;
  bot_level?: BotLevel;
};

type LinkedPlayer = {
  slot_number: number;
  auth_user_id: string;
  display_name: string;
  avatar_url?: string | null;
};

type JoinState = {
  players: LinkedPlayer[];
};

type BotLevel = "rookie" | "social" | "club" | "pro";

const BOT_LEVELS: Array<{ value: BotLevel; label: string; description: string }> = [
  { value: "rookie", label: "Nybörjare", description: "Snittar runt 30 per runda" },
  { value: "social", label: "Motionär", description: "Snittar runt 45 per runda" },
  { value: "club", label: "Klubbspelare", description: "Snittar runt 60 per runda" },
  { value: "pro", label: "Vass", description: "Snittar runt 80 per runda" },
];

const botNameForLevel = (level: BotLevel) => `Pickla Bot ${BOT_LEVELS.find((item) => item.value === level)?.label || ""}`.trim();

const createSetupId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const scoreJoinOrigin = () => {
  const { hostname, origin } = window.location;
  if (hostname === "playpickla.com" || hostname === "www.playpickla.com") {
    return "https://www.playpickla.com";
  }
  return origin;
};

export default function ScoreStartPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const deviceToken = searchParams.get("device") || "";
  const { data, isLoading, isError } = useQuery<DeviceState>({
    queryKey: ["score-device-state", deviceToken],
    enabled: !!deviceToken,
    queryFn: () => apiGet("api-score", "device-state", { device: deviceToken }),
    refetchInterval: 5_000,
  });

  const [bestOfLegs, setBestOfLegs] = useState(1);
  const [gameType, setGameType] = useState<"301" | "501" | "701">("501");
  const [checkoutRule, setCheckoutRule] = useState<"double_out" | "single_out">("double_out");
  const [players, setPlayers] = useState<MatchPlayer[]>([{ name: "" }, { name: "" }]);
  const [soloMode, setSoloMode] = useState(false);
  const [botLevel, setBotLevel] = useState<BotLevel>("social");
  const [setupId] = useState(createSetupId);
  const [linkIndex, setLinkIndex] = useState<number | null>(null);

  const activeCourt = useMemo(() => data?.resource || null, [data?.resource]);
  const normalizedNames = useMemo(
    () => players.map((player, index) => player.name.trim() || `Spelare ${index + 1}`),
    [players],
  );

  useEffect(() => {
    if (!soloMode) return;
    setPlayers((current) => {
      const human = current.find((player) => !player.is_bot) || current[0] || { name: "" };
      return [
        { ...human, is_bot: false, bot_level: undefined },
        { name: botNameForLevel(botLevel), is_bot: true, bot_level: botLevel },
      ];
    });
  }, [botLevel, soloMode]);

  const { data: joinState } = useQuery<JoinState>({
    queryKey: ["score-join-state", deviceToken, setupId],
    enabled: !!deviceToken && !!setupId,
    queryFn: () => apiGet("api-score", "join-state", { device: deviceToken, setupId }),
    refetchInterval: linkIndex !== null ? 1_000 : 2_000,
  });

  useEffect(() => {
    if (!joinState?.players?.length) return;
    setPlayers((current) => {
      let changed = false;
      const next = current.map((player, index) => {
        const link = joinState.players.find((item) => item.slot_number === index);
        if (!link) return player;
        if (player.auth_user_id === link.auth_user_id && player.name === link.display_name) return player;
        changed = true;
        return {
          ...player,
          name: link.display_name,
          auth_user_id: link.auth_user_id,
          linked: true,
        };
      });
      return changed ? next : current;
    });
  }, [joinState]);

  const joinUrl = (index: number) => {
    const params = new URLSearchParams({
      setup: setupId,
      device: deviceToken,
      slot: String(index),
    });
    return `${scoreJoinOrigin()}/score/join?${params.toString()}`;
  };

  const startMutation = useMutation({
    mutationFn: () => apiPost("api-score", "walk-in", {
      device_token: deviceToken,
      best_of_legs: bestOfLegs,
      game_type: gameType,
      checkout_rule: checkoutRule,
      court_ids: activeCourt?.id ? [activeCourt.id] : [],
      player_names: normalizedNames,
      player_users: players.map((player) => player.auth_user_id || null),
      player_bots: players.map((player) => player.is_bot ? { level: player.bot_level || botLevel } : null),
    }),
    onSuccess: (result: WalkInResult) => {
      const first = result.match || result.matches?.[0];
      if (!first?.id) {
        toast.error("Matchen skapades men kunde inte öppnas");
        return;
      }
      toast.success(result.matches?.length > 1 ? `${result.matches.length} matcher startade` : "Match startad");
      navigate(`/score/match/${first.id}?device=${encodeURIComponent(deviceToken)}`, { replace: true });
    },
    onError: (error: Error) => toast.error(error.message || "Kunde inte starta match"),
  });

  const updateName = (index: number, value: string) => {
    if (players[index]?.is_bot) return;
    setPlayers((current) => current.map((player, i) => (i === index ? { ...player, name: value } : player)));
  };

  const addPlayer = () => {
    if (soloMode) return;
    setPlayers((current) => (current.length >= 4 ? current : [...current, { name: "" }]));
  };

  const removePlayer = (index: number) => {
    if (soloMode) return;
    setPlayers((current) => (current.length <= 2 ? current : current.filter((_, i) => i !== index)));
  };

  const toggleSoloMode = () => {
    if (soloMode) {
      setPlayers((current) => current.map((player, index) => (
        player.is_bot ? { name: index === 1 ? "" : `Spelare ${index + 1}` } : player
      )));
      setSoloMode(false);
      return;
    }
    setSoloMode(true);
  };

  if (isLoading) {
    return <Shell><p className="font-mono text-neutral-400">laddar score...</p></Shell>;
  }

  if (isError || !data) {
    return <Shell><p className="font-mono text-neutral-500">Paddan hittades inte.</p></Shell>;
  }

  return (
    <Shell venueName={data.venue?.name}>
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-3xl flex-col px-6 pb-8">
        <header className="mb-8">
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.24em] text-neutral-400">
            Pickla Score
          </p>
          <h1 className="font-display text-6xl font-black leading-none text-neutral-950 sm:text-7xl">
            Starta match
          </h1>
          <p className="mt-4 max-w-xl font-mono text-lg text-neutral-500">
            Walk-in direkt på {data.resource?.name || data.device.name}. En tavla, 2-4 spelare.
          </p>
        </header>

        {data.activeMatch && (
          <button
            onClick={() => navigate(`/score/match/${data.activeMatch!.id}?device=${encodeURIComponent(deviceToken)}`)}
            className="mb-6 flex items-center justify-between rounded-[2rem] bg-emerald-300 p-6 text-left text-neutral-950"
          >
            <div>
              <p className="font-display text-3xl font-black">Fortsätt match</p>
              <p className="mt-1 font-mono text-sm">
                {data.activeMatch.player1_name} vs {data.activeMatch.player2_name}
              </p>
            </div>
            <ArrowRight className="h-8 w-8" />
          </button>
        )}

        <section className="space-y-6 rounded-[2rem] border border-black/10 bg-white p-6 shadow-sm">
          <div>
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.18em] text-neutral-400">Match</p>
            <div className="mb-3 rounded-2xl border border-black/10 bg-[#faf8f5] p-4">
              <p className="font-display text-2xl font-black">{activeCourt?.name || data.device.name}</p>
              <p className="mt-1 font-mono text-sm text-neutral-500">Paddan startar match på sin egen tavla.</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {(["301", "501", "701"] as const).map((game) => (
                <button
                  key={game}
                  onClick={() => setGameType(game)}
                  className={`rounded-2xl px-4 py-4 font-mono text-sm ${
                    gameType === game ? "bg-neutral-950 text-white" : "bg-neutral-100 text-neutral-500"
                  }`}
                >
                  {game}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.18em] text-neutral-400">Ben</p>
            <div className="grid grid-cols-3 gap-3">
              {[1, 3, 5].map((best) => (
                <button
                  key={best}
                  onClick={() => setBestOfLegs(best)}
                  className={`rounded-2xl px-4 py-4 font-mono text-sm ${
                    bestOfLegs === best ? "bg-neutral-950 text-white" : "bg-neutral-100 text-neutral-500"
                  }`}
                >
                  Först till {Math.floor(best / 2) + 1}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.18em] text-neutral-400">Utgång</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setCheckoutRule("double_out")}
                className={`rounded-2xl px-4 py-4 font-mono text-sm ${
                  checkoutRule === "double_out" ? "bg-neutral-950 text-white" : "bg-neutral-100 text-neutral-500"
                }`}
              >
                Dubbel ut
              </button>
              <button
                onClick={() => setCheckoutRule("single_out")}
                className={`rounded-2xl px-4 py-4 font-mono text-sm ${
                  checkoutRule === "single_out" ? "bg-neutral-950 text-white" : "bg-neutral-100 text-neutral-500"
                }`}
              >
                Enkel ut
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-neutral-400">Spelare</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleSoloMode}
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 font-mono text-xs ${
                    soloMode ? "bg-emerald-300 text-neutral-950" : "bg-neutral-100 text-neutral-700"
                  }`}
                >
                  <Bot className="h-4 w-4" />
                  Mot bot
                </button>
                <button
                  type="button"
                  onClick={addPlayer}
                  disabled={players.length >= 4 || soloMode}
                  className="inline-flex items-center gap-2 rounded-full bg-neutral-100 px-4 py-2 font-mono text-xs text-neutral-700 disabled:opacity-40"
                >
                  <Plus className="h-4 w-4" />
                  Lägg till
                </button>
              </div>
            </div>
            {soloMode && (
              <div className="grid grid-cols-2 gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-2 sm:grid-cols-4">
                {BOT_LEVELS.map((level) => (
                  <button
                    key={level.value}
                    type="button"
                    onClick={() => setBotLevel(level.value)}
                    className={`rounded-xl p-3 text-left ${
                      botLevel === level.value ? "bg-neutral-950 text-white" : "bg-white text-neutral-700"
                    }`}
                  >
                    <p className="font-display text-lg font-black leading-none">{level.label}</p>
                    <p className={`mt-1 font-mono text-[10px] leading-tight ${botLevel === level.value ? "text-white/55" : "text-neutral-400"}`}>
                      {level.description}
                    </p>
                  </button>
                ))}
              </div>
            )}
            {players.map((player, index) => (
              <div key={index} className="flex items-center gap-3 rounded-2xl border border-black/10 bg-[#faf8f5] p-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-neutral-950 font-display text-xl font-black text-white">
                  {player.is_bot ? <Bot className="h-5 w-5 text-emerald-300" /> : player.linked ? <Check className="h-5 w-5 text-emerald-300" /> : index + 1}
                </div>
                <input
                  value={player.name}
                  onChange={(e) => updateName(index, e.target.value)}
                  placeholder={`Spelare ${index + 1}`}
                  readOnly={player.is_bot}
                  className="h-14 min-w-0 flex-1 rounded-2xl border border-black/10 bg-white px-4 font-mono text-base outline-none focus:border-emerald-300"
                />
                {!player.is_bot && (
                  <button
                    type="button"
                    onClick={() => {
                      setLinkIndex(index);
                    }}
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${
                      player.linked ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-600"
                    }`}
                    title="Koppla konto"
                  >
                    <Link2 className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removePlayer(index)}
                  disabled={players.length <= 2 || soloMode}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 disabled:opacity-30"
                >
                  <Minus className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <button
            disabled={!activeCourt?.id || startMutation.isPending}
            onClick={() => startMutation.mutate()}
            className="flex h-16 w-full items-center justify-center gap-3 rounded-full bg-neutral-950 font-display text-2xl font-black text-white disabled:bg-neutral-300"
          >
            <Radio className="h-6 w-6" />
            Starta {gameType}
          </button>
        </section>
      </div>

      {linkIndex !== null && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-[2rem] bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-neutral-400">Koppla konto</p>
                <h2 className="mt-1 font-display text-3xl font-black text-neutral-950">Spelare {linkIndex + 1}</h2>
                <p className="mt-1 font-mono text-sm text-neutral-500">Spelaren skannar denna QR med sin egen mobil.</p>
              </div>
              <button onClick={() => setLinkIndex(null)} className="rounded-full bg-neutral-100 p-3 text-neutral-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex flex-col items-center rounded-[1.5rem] bg-[#faf8f5] p-5">
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <QRCodeSVG
                  value={joinUrl(linkIndex)}
                  size={220}
                  level="M"
                  bgColor="#ffffff"
                  fgColor="#111827"
                />
              </div>
              <p className="mt-4 text-center font-mono text-sm text-neutral-500">
                Öppnar Pickla på mobilen och kopplar kontot till matchen.
              </p>
            </div>
            {players[linkIndex]?.linked && (
              <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 font-mono text-sm text-emerald-700">
                {players[linkIndex].name} är kopplad.
              </div>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children, venueName }: { children: ReactNode; venueName?: string }) {
  return (
    <main className="min-h-screen bg-[#faf8f5] text-neutral-950">
      <div className="sticky top-0 z-30 border-b border-black/5 bg-[#faf8f5]/90 px-6 py-5 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <img src={picklaLogo} alt="Pickla" className="h-10 w-auto" />
          <div className="flex items-center gap-2 rounded-full bg-white px-4 py-3 font-mono text-xs shadow-sm">
            <Trophy className="h-4 w-4 text-pink-500" />
            <span>{venueName || "Pickla"}</span>
          </div>
        </div>
      </div>
      <div className="pt-8">{children}</div>
    </main>
  );
}
