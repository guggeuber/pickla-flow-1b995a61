import { motion } from "framer-motion";
import { Play, CheckCircle2, Clock } from "lucide-react";

interface CourtTileProps {
  court: {
    id: string;
    name: string;
    court_number: number;
    is_available: boolean | null;
  };
  match?: {
    id: string;
    team1_score: number | null;
    team2_score: number | null;
    status: string | null;
    started_at: string | null;
    team1: any;
    team2: any;
    stage: string | null;
  };
  now: Date;
  onTap: (matchId: string) => void;
}

function getElapsed(startedAt: string | null, now: Date) {
  if (!startedAt) return null;
  const diff = Math.floor((now.getTime() - new Date(startedAt).getTime()) / 1000);
  const mins = Math.floor(diff / 60);
  const secs = diff % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

const CourtTile = ({ court, match, now, onTap }: CourtTileProps) => {
  const isActive = !!match && match.status === "in_progress";
  const isFinals = match?.stage === "semifinal" || match?.stage === "final" || match?.stage === "third_place";
  const elapsed = isActive ? getElapsed(match.started_at, now) : null;

  const statusClass = isFinals
    ? "court-vip"
    : isActive
    ? "court-active"
    : "court-free";

  const statusLabel = isFinals
    ? match.stage === "final" ? "FINAL" : "SEMIFINAL"
    : isActive
    ? "PÅGÅR"
    : "LEDIG";

  return (
    <motion.button
      whileTap={{ scale: 0.93 }}
      onClick={() => match ? onTap(match.id) : undefined}
      className={`court-cell ${statusClass} min-h-[120px] relative`}
    >
      {/* Court number */}
      <div className="text-[10px] font-bold uppercase tracking-widest opacity-60">
        Bana {court.court_number}
      </div>

      {isActive && match ? (
        <>
          {/* Teams */}
          <div className="w-full space-y-1 mt-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold truncate max-w-[60%]">{match.team1?.name ?? "Team 1"}</span>
              <span className="text-lg font-black">{match.team1_score ?? 0}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold truncate max-w-[60%]">{match.team2?.name ?? "Team 2"}</span>
              <span className="text-lg font-black">{match.team2_score ?? 0}</span>
            </div>
          </div>

          {/* Timer */}
          <div className="flex items-center gap-1 mt-1">
            <Clock className="w-3 h-3 opacity-70" />
            <span className={`text-xs font-mono font-bold ${elapsed && parseInt(elapsed) >= 20 ? "animate-glow" : ""}`}>
              {elapsed}
            </span>
          </div>

          {/* Status badge */}
          <div className="absolute top-2 right-2">
            <span className="flex items-center gap-0.5">
              <Play className="w-2.5 h-2.5" />
              <span className="text-[9px] font-bold">{statusLabel}</span>
            </span>
          </div>
        </>
      ) : (
        <>
          <div className="mt-2">
            <CheckCircle2 className="w-8 h-8 opacity-40" />
          </div>
          <span className="text-[10px] font-bold mt-1">{statusLabel}</span>
        </>
      )}
    </motion.button>
  );
};

export default CourtTile;
