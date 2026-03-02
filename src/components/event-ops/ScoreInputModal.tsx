import { useState } from "react";
import { motion } from "framer-motion";
import { X, Minus, Plus, Trophy, Play, CheckCircle2 } from "lucide-react";
import { useUpdateMatchScore } from "@/hooks/useEventOps";
import { toast } from "sonner";

interface ScoreInputModalProps {
  match: {
    id: string;
    team1_score: number | null;
    team2_score: number | null;
    status: string | null;
    team1: any;
    team2: any;
    round: number;
    match_number: number;
  };
  onClose: () => void;
}

const ScoreInputModal = ({ match, onClose }: ScoreInputModalProps) => {
  const [score1, setScore1] = useState(match.team1_score ?? 0);
  const [score2, setScore2] = useState(match.team2_score ?? 0);
  const updateScore = useUpdateMatchScore();

  const handleSubmit = (status: "in_progress" | "completed") => {
    updateScore.mutate(
      { matchId: match.id, team1Score: score1, team2Score: score2, status },
      {
        onSuccess: () => {
          toast.success(
            status === "completed"
              ? `Match ${match.match_number} klar — ${score1}-${score2}`
              : `Match ${match.match_number} startad`
          );
          onClose();
        },
        onError: () => toast.error("Kunde inte uppdatera match"),
      }
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-t-3xl p-6 space-y-5"
        style={{ background: "hsl(220 18% 11%)", borderTop: "1px solid hsl(220 14% 22%)" }}
      >
        {/* Handle */}
        <div className="w-10 h-1 rounded-full bg-muted mx-auto" />

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold">Match #{match.match_number}</h3>
            <p className="text-xs text-muted-foreground">Round {match.round}</p>
          </div>
          <button onClick={onClose} className="tap-target rounded-xl hover:bg-secondary">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Score inputs */}
        <div className="space-y-4">
          <ScoreRow
            teamName={match.team1?.name ?? "Team 1"}
            teamColor={match.team1?.color}
            score={score1}
            onChange={setScore1}
          />
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs font-bold text-muted-foreground">VS</span>
            <div className="flex-1 h-px bg-border" />
          </div>
          <ScoreRow
            teamName={match.team2?.name ?? "Team 2"}
            teamColor={match.team2?.color}
            score={score2}
            onChange={setScore2}
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          {match.status === "scheduled" && (
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => handleSubmit("in_progress")}
              className="flex-1 py-3.5 rounded-xl bg-court-active/20 text-court-active font-semibold text-sm flex items-center justify-center gap-2 border border-court-active/30"
              disabled={updateScore.isPending}
            >
              <Play className="w-4 h-4" />
              Starta match
            </motion.button>
          )}
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => handleSubmit("completed")}
            className="flex-1 py-3.5 rounded-xl bg-success/20 text-success font-semibold text-sm flex items-center justify-center gap-2 border border-success/30"
            disabled={updateScore.isPending}
          >
            {match.status === "scheduled" ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Rapportera
              </>
            ) : (
              <>
                <Trophy className="w-4 h-4" />
                Avsluta match
              </>
            )}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
};

function ScoreRow({
  teamName,
  teamColor,
  score,
  onChange,
}: {
  teamName: string;
  teamColor?: string;
  score: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="w-3 h-10 rounded-full"
        style={{ background: teamColor || "hsl(var(--muted))" }}
      />
      <span className="flex-1 text-sm font-semibold truncate">{teamName}</span>
      <div className="flex items-center gap-2">
        <motion.button
          whileTap={{ scale: 0.85 }}
          onClick={() => onChange(Math.max(0, score - 1))}
          className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center"
        >
          <Minus className="w-4 h-4" />
        </motion.button>
        <span className="w-12 text-center text-2xl font-black tabular-nums">{score}</span>
        <motion.button
          whileTap={{ scale: 0.85 }}
          onClick={() => onChange(score + 1)}
          className="w-10 h-10 rounded-xl bg-primary/20 text-primary flex items-center justify-center"
        >
          <Plus className="w-4 h-4" />
        </motion.button>
      </div>
    </div>
  );
}

export default ScoreInputModal;
