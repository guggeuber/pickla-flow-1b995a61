import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { motion } from "framer-motion";
import { Loader2, Swords, Check, X, Trophy } from "lucide-react";
import { CrewBadge } from "./CrewBadge";
import { toast } from "sonner";

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.05 } } };
const item = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } };

interface Props {
  crewId: string;
  isLeader: boolean;
}

export function ChallengesList({ crewId, isLeader }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: challenges, isLoading } = useQuery({
    queryKey: ["crew-challenges", crewId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crew_challenges")
        .select(`
          *,
          challenger:crews!crew_challenges_challenger_crew_id_fkey(id, name, badge_emoji, badge_color),
          challenged:crews!crew_challenges_challenged_crew_id_fkey(id, name, badge_emoji, badge_color)
        `)
        .or(`challenger_crew_id.eq.${crewId},challenged_crew_id.eq.${crewId}`)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
  });

  const handleRespond = async (challengeId: string, accept: boolean) => {
    const { error } = await supabase
      .from("crew_challenges")
      .update({ status: accept ? "accepted" : "declined" })
      .eq("id", challengeId);

    if (error) {
      toast.error("Kunde inte svara på utmaningen");
      return;
    }
    toast.success(accept ? "Utmaning accepterad! ⚔️" : "Utmaning avvisad");
    qc.invalidateQueries({ queryKey: ["crew-challenges", crewId] });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="w-4 h-4 animate-spin" style={{ color: "#3E3D39" }} />
      </div>
    );
  }

  if (!challenges || challenges.length === 0) {
    return (
      <div className="flex flex-col items-center py-6 gap-2">
        <Swords className="w-6 h-6" style={{ color: "rgba(62,61,57,0.2)" }} />
        <p className="text-xs" style={{ color: "rgba(62,61,57,0.4)" }}>
          Inga utmaningar ännu
        </p>
      </div>
    );
  }

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col gap-2">
      {challenges.map((ch: any) => {
        const isChallenger = ch.challenger_crew_id === crewId;
        const opponent = isChallenger ? ch.challenged : ch.challenger;
        const isPending = ch.status === "pending";
        const canRespond = isPending && !isChallenger && isLeader;

        const statusConfig: Record<string, { label: string; color: string; icon: typeof Swords }> = {
          pending: { label: "Väntar", color: "#FF9800", icon: Swords },
          accepted: { label: "Accepterad", color: "#4CAF50", icon: Check },
          declined: { label: "Avvisad", color: "rgba(62,61,57,0.4)", icon: X },
          completed: { label: "Avslutad", color: "#E86C24", icon: Trophy },
        };
        const status = statusConfig[ch.status] || statusConfig.pending;
        const StatusIcon = status.icon;

        return (
          <motion.div
            key={ch.id}
            variants={item}
            className="rounded-xl p-3"
            style={{
              background: "rgba(255,255,255,0.5)",
              border: `1.5px solid ${isPending && !isChallenger ? "rgba(232,108,36,0.3)" : "rgba(62,61,57,0.08)"}`,
            }}
          >
            <div className="flex items-center gap-3 mb-2">
              <CrewBadge
                emoji={opponent?.badge_emoji || "⚡"}
                color={opponent?.badge_color || "#E86C24"}
                size="sm"
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold" style={{ color: "rgba(62,61,57,0.4)" }}>
                  {isChallenger ? "Du utmanade" : "Utmanad av"}
                </p>
                <p className="text-sm font-bold truncate" style={{ color: "#3E3D39" }}>
                  {opponent?.name || "Okänt crew"}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <StatusIcon className="w-3.5 h-3.5" style={{ color: status.color }} />
                <span className="text-[10px] font-bold" style={{ color: status.color }}>
                  {status.label}
                </span>
              </div>
            </div>

            {ch.message && (
              <p className="text-[11px] italic mb-2 pl-11" style={{ color: "rgba(62,61,57,0.5)" }}>
                "{ch.message}"
              </p>
            )}

            {/* Result for completed */}
            {ch.status === "completed" && ch.result && (
              <div
                className="rounded-lg p-2 mt-1 flex items-center justify-center gap-3"
                style={{ background: "rgba(232,108,36,0.06)" }}
              >
                <Trophy className="w-4 h-4" style={{ color: "#E86C24" }} />
                <span className="text-xs font-bold" style={{ color: "#E86C24" }}>
                  {(ch.result as any)?.winner_name || "Resultat registrerat"}
                </span>
              </div>
            )}

            {/* Accept/Decline buttons */}
            {canRespond && (
              <div className="flex gap-2 mt-2 pl-11">
                <button
                  onClick={() => handleRespond(ch.id, true)}
                  className="flex-1 rounded-lg py-2 text-xs font-bold transition-all active:scale-95 flex items-center justify-center gap-1.5"
                  style={{ background: "#E86C24", color: "#fff" }}
                >
                  <Check className="w-3.5 h-3.5" />
                  Acceptera
                </button>
                <button
                  onClick={() => handleRespond(ch.id, false)}
                  className="flex-1 rounded-lg py-2 text-xs font-bold transition-all active:scale-95"
                  style={{
                    background: "rgba(62,61,57,0.06)",
                    border: "1px solid rgba(62,61,57,0.1)",
                    color: "rgba(62,61,57,0.6)",
                  }}
                >
                  Avvisa
                </button>
              </div>
            )}

            <p className="text-[9px] mt-2 pl-11" style={{ color: "rgba(62,61,57,0.3)" }}>
              {new Date(ch.created_at).toLocaleDateString("sv-SE")}
            </p>
          </motion.div>
        );
      })}
    </motion.div>
  );
}
