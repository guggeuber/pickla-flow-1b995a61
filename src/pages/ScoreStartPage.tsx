import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, Radio, Trophy } from "lucide-react";
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

type MatchNames = Record<string, { player1_name: string; player2_name: string }>;

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

  const [selectedCourtIds, setSelectedCourtIds] = useState<string[]>([]);
  const [bestOfLegs, setBestOfLegs] = useState(1);
  const [matchNames, setMatchNames] = useState<MatchNames>({});

  useEffect(() => {
    if (!data?.resource?.id || selectedCourtIds.length) return;
    setSelectedCourtIds([data.resource.id]);
    setMatchNames({
      [data.resource.id]: { player1_name: "", player2_name: "" },
    });
  }, [data?.resource?.id, selectedCourtIds.length]);

  const selectedCourts = useMemo(
    () => (data?.courts || []).filter((court) => selectedCourtIds.includes(court.id)),
    [data?.courts, selectedCourtIds],
  );

  const startMutation = useMutation({
    mutationFn: () => apiPost("api-score", "walk-in", {
      device_token: deviceToken,
      best_of_legs: bestOfLegs,
      court_ids: selectedCourtIds,
      matches: selectedCourtIds.map((courtId, index) => {
        const fallback = index + 1;
        return {
          court_id: courtId,
          player1_name: matchNames[courtId]?.player1_name || `Spelare ${fallback}A`,
          player2_name: matchNames[courtId]?.player2_name || `Spelare ${fallback}B`,
        };
      }),
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

  const toggleCourt = (courtId: string) => {
    setSelectedCourtIds((current) => {
      if (current.includes(courtId)) {
        if (current.length === 1) return current;
        return current.filter((id) => id !== courtId);
      }
      return [...current, courtId];
    });
    setMatchNames((current) => ({
      ...current,
      [courtId]: current[courtId] || { player1_name: "", player2_name: "" },
    }));
  };

  const updateName = (courtId: string, field: "player1_name" | "player2_name", value: string) => {
    setMatchNames((current) => ({
      ...current,
      [courtId]: {
        player1_name: current[courtId]?.player1_name || "",
        player2_name: current[courtId]?.player2_name || "",
        [field]: value,
      },
    }));
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
            Walk-in 501 direkt på {data.resource?.name || data.device.name}.
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
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.18em] text-neutral-400">Format</p>
            <div className="grid grid-cols-3 gap-3">
              {[1, 3, 5].map((best) => (
                <button
                  key={best}
                  onClick={() => setBestOfLegs(best)}
                  className={`rounded-2xl px-4 py-4 font-mono text-sm ${
                    bestOfLegs === best ? "bg-neutral-950 text-white" : "bg-neutral-100 text-neutral-500"
                  }`}
                >
                  Bäst av {best}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.18em] text-neutral-400">Tavlor</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {(data.courts || []).map((court) => {
                const selected = selectedCourtIds.includes(court.id);
                return (
                  <button
                    key={court.id}
                    onClick={() => toggleCourt(court.id)}
                    className={`flex min-h-20 items-center justify-between rounded-2xl border p-4 text-left ${
                      selected ? "border-emerald-300 bg-emerald-50" : "border-black/10 bg-neutral-50"
                    }`}
                  >
                    <span className="font-display text-xl font-black">{court.name}</span>
                    {selected && <Check className="h-5 w-5 text-emerald-500" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-4">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-neutral-400">Spelare</p>
            {selectedCourts.map((court, index) => (
              <div key={court.id} className="rounded-2xl border border-black/10 bg-[#faf8f5] p-4">
                <p className="mb-3 font-display text-2xl font-black">{court.name}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    value={matchNames[court.id]?.player1_name || ""}
                    onChange={(e) => updateName(court.id, "player1_name", e.target.value)}
                    placeholder={`Spelare ${index + 1}A`}
                    className="h-14 rounded-2xl border border-black/10 bg-white px-4 font-mono text-base outline-none focus:border-emerald-300"
                  />
                  <input
                    value={matchNames[court.id]?.player2_name || ""}
                    onChange={(e) => updateName(court.id, "player2_name", e.target.value)}
                    placeholder={`Spelare ${index + 1}B`}
                    className="h-14 rounded-2xl border border-black/10 bg-white px-4 font-mono text-base outline-none focus:border-emerald-300"
                  />
                </div>
              </div>
            ))}
          </div>

          <button
            disabled={!selectedCourtIds.length || startMutation.isPending}
            onClick={() => startMutation.mutate()}
            className="flex h-16 w-full items-center justify-center gap-3 rounded-full bg-neutral-950 font-display text-2xl font-black text-white disabled:bg-neutral-300"
          >
            <Radio className="h-6 w-6" />
            Starta 501
          </button>
        </section>
      </div>
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
