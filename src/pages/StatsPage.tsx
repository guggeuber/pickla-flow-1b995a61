import { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, BarChart3, Check, Flame, Loader2, Sparkles, Target, Ticket, Trophy } from "lucide-react";
import { PicklaTopBar } from "@/components/PicklaTopBar";
import { apiGet } from "@/lib/api";

const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";
const BLUE = "#0066FF";
const BLUE_LIGHT = "rgba(0,102,255,0.08)";
const GREEN = "#22C55E";
const GREEN_LIGHT = "rgba(34,197,94,0.08)";
const GREEN_BORDER = "rgba(34,197,94,0.15)";
const TEXT_PRIMARY = "#111827";
const TEXT_SECONDARY = "#6B7280";
const TEXT_MUTED = "#9CA3AF";
const CARD_BG = "#FFFFFF";
const CARD_BORDER = "#E5E7EB";
const PAGE_BG = "#F8FAFC";

type RecentMatch = {
  id: string;
  status: string;
  game_type?: string | null;
  checkout_rule?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  winner_name?: string | null;
  player_name?: string | null;
  opponent_names?: string[];
  player1_name?: string | null;
  player2_name?: string | null;
  player1_legs?: number | null;
  player2_legs?: number | null;
  won?: boolean;
  court?: { name?: string | null; court_number?: number | null } | null;
};

type MyStats = {
  matches_played: number;
  wins: number;
  turns: number;
  darts: number;
  scored: number;
  average: number;
  high_score: number;
  one_eighties: number;
  checkouts: number;
  high_checkout: number;
  recent_matches: RecentMatch[];
};

const emptyStats: MyStats = {
  matches_played: 0,
  wins: 0,
  turns: 0,
  darts: 0,
  scored: 0,
  average: 0,
  high_score: 0,
  one_eighties: 0,
  checkouts: 0,
  high_checkout: 0,
  recent_matches: [],
};

function statPercent(value: number, total: number) {
  if (!total) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function formatDate(value?: string | null) {
  if (!value) return "Pågående";
  return new Date(value).toLocaleDateString("sv-SE", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function checkoutRuleLabel(rule?: string | null) {
  if (rule === "single_out") return "Enkel ut";
  if (rule === "double_out") return "Dubbel ut";
  return "Utgång";
}

function StatTile({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: ReactNode }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}` }}>
      <div className="mb-3 flex items-center gap-2" style={{ color: TEXT_MUTED }}>
        {icon}
        <span className="text-[10px] uppercase tracking-[0.14em]" style={{ fontFamily: FONT_MONO }}>{label}</span>
      </div>
      <p className="text-3xl font-black leading-none" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>{value}</p>
      {sub && <p className="mt-2 text-[11px]" style={{ fontFamily: FONT_MONO, color: TEXT_SECONDARY }}>{sub}</p>}
    </div>
  );
}

function MatchRow({ match }: { match: RecentMatch }) {
  const opponent = match.opponent_names?.length
    ? match.opponent_names.join(", ")
    : [match.player1_name, match.player2_name].filter(Boolean).join(" vs ");
  const isCompleted = match.status === "completed";

  return (
    <div className="rounded-2xl p-4" style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}` }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold truncate" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>
            {match.player_name || "Du"} {opponent ? `vs ${opponent}` : ""}
          </p>
          <p className="mt-1 text-[11px]" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
            {formatDate(match.completed_at || match.started_at)} · {match.court?.name || "Dart"}
          </p>
        </div>
        <span
          className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold"
          style={{
            background: !isCompleted ? BLUE_LIGHT : match.won ? GREEN_LIGHT : "rgba(239,68,68,0.08)",
            color: !isCompleted ? BLUE : match.won ? GREEN : "#EF4444",
            fontFamily: FONT_HEADING,
          }}
        >
          {!isCompleted ? "Live" : match.won ? "Vinst" : "Förlust"}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 rounded-xl px-3 py-2" style={{ background: PAGE_BG }}>
        <p className="text-[11px]" style={{ fontFamily: FONT_MONO, color: TEXT_SECONDARY }}>
          {match.game_type || "501"} · {checkoutRuleLabel(match.checkout_rule)}
        </p>
        <p className="text-sm font-black" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>
          {match.player1_legs ?? 0}-{match.player2_legs ?? 0}
        </p>
      </div>
    </div>
  );
}

export default function StatsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const slug = searchParams.get("v") || "pickla-arena-sthlm";
  const { data, isLoading } = useQuery<MyStats>({
    queryKey: ["my-score-stats"],
    staleTime: 30000,
    queryFn: () => apiGet("api-score", "my-stats"),
  });

  const stats = data || emptyStats;
  const hasStats = stats.matches_played > 0;
  const losses = Math.max(stats.matches_played - stats.wins, 0);

  return (
    <div className="min-h-screen" style={{ background: PAGE_BG }}>
      <PicklaTopBar slug={slug} showVenue={false} background={PAGE_BG} />

      <main className="px-5 pb-16 pt-[calc(env(safe-area-inset-top,0px)+104px)]">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto flex max-w-md flex-col gap-5"
        >
          <button
            type="button"
            onClick={() => navigate(`/my?v=${encodeURIComponent(slug)}`)}
            className="flex w-fit items-center gap-2 rounded-full bg-white px-3 py-2 text-xs shadow-sm active:scale-[0.98]"
            style={{ color: TEXT_SECONDARY, fontFamily: FONT_HEADING }}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Min sida
          </button>

          <section>
            <p className="text-[11px] uppercase tracking-[0.22em]" style={{ color: TEXT_MUTED, fontFamily: FONT_MONO }}>
              Pickla Score
            </p>
            <h1 className="mt-2 text-4xl font-black leading-none" style={{ color: TEXT_PRIMARY, fontFamily: FONT_HEADING }}>
              Min statistik
            </h1>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: TEXT_SECONDARY }}>
              Skanna din Pickla-QR när du startar dartmatch på paddan, så kopplas matcher och stats till ditt konto.
            </p>
          </section>

          {isLoading ? (
            <div className="flex h-44 items-center justify-center rounded-3xl" style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}` }}>
              <Loader2 className="h-6 w-6 animate-spin" style={{ color: TEXT_MUTED }} />
            </div>
          ) : !hasStats ? (
            <div className="rounded-3xl p-6" style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}` }}>
              <div className="mb-5 grid h-14 w-14 place-items-center rounded-2xl" style={{ background: GREEN_LIGHT }}>
                <BarChart3 className="h-7 w-7" style={{ color: GREEN }} />
              </div>
              <h2 className="text-xl font-black" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>
                Inga matcher ännu
              </h2>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: TEXT_SECONDARY }}>
                Starta en dartmatch från paddan och koppla ditt konto via QR. Efter matchen fylls sidan med snitt, checkout och historik.
              </p>
            </div>
          ) : (
            <>
              <section className="grid grid-cols-2 gap-3">
                <StatTile label="Matcher" value={String(stats.matches_played)} sub={`${stats.wins} vinster · ${losses} förluster`} icon={<Trophy className="h-4 w-4" />} />
                <StatTile label="Vinstprocent" value={statPercent(stats.wins, stats.matches_played)} sub="Avslutade matcher" icon={<Check className="h-4 w-4" />} />
                <StatTile label="3-pilsnitt" value={stats.average.toFixed(1)} sub={`${stats.turns} rundor · ${stats.darts} pilar`} icon={<BarChart3 className="h-4 w-4" />} />
                <StatTile label="Högsta kast" value={String(stats.high_score)} sub={`${stats.scored} poäng totalt`} icon={<Flame className="h-4 w-4" />} />
              </section>

              <section className="rounded-3xl p-4" style={{ background: GREEN_LIGHT, border: `1.5px solid ${GREEN_BORDER}` }}>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <Sparkles className="mx-auto h-4 w-4" style={{ color: GREEN }} />
                    <p className="mt-2 text-2xl font-black" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>{stats.one_eighties}</p>
                    <p className="text-[10px] uppercase tracking-[0.14em]" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>180s</p>
                  </div>
                  <div>
                    <Ticket className="mx-auto h-4 w-4" style={{ color: GREEN }} />
                    <p className="mt-2 text-2xl font-black" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>{stats.high_checkout || "-"}</p>
                    <p className="text-[10px] uppercase tracking-[0.14em]" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>Hög checkout</p>
                  </div>
                  <div>
                    <Target className="mx-auto h-4 w-4" style={{ color: GREEN }} />
                    <p className="mt-2 text-2xl font-black" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>{stats.checkouts}</p>
                    <p className="text-[10px] uppercase tracking-[0.14em]" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>Checkouts</p>
                  </div>
                </div>
              </section>

              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-lg font-black" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>Senaste matcher</h2>
                  <span className="rounded-full px-2 py-1 text-[10px] font-bold" style={{ background: BLUE_LIGHT, color: BLUE, fontFamily: FONT_HEADING }}>
                    {stats.recent_matches.length}
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {stats.recent_matches.map((match) => (
                    <MatchRow key={match.id} match={match} />
                  ))}
                </div>
              </section>
            </>
          )}
        </motion.div>
      </main>
    </div>
  );
}
