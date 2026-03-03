import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { motion } from "framer-motion";
import { Loader2, Crown, Medal, Award } from "lucide-react";

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.05 } } };
const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } };

const podiumIcons = [Crown, Medal, Award];
const podiumColors = ["#FFD700", "#C0C0C0", "#CD7F32"];

export function LeaderboardTab() {
  const { user } = useAuth();

  const { data: players, isLoading } = useQuery({
    queryKey: ["leaderboard"],
    staleTime: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_profiles")
        .select("id, auth_user_id, display_name, avatar_url, pickla_rating, total_matches, total_wins")
        .order("pickla_rating", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: "#3E3D39" }} />
      </div>
    );
  }

  const myRank = players?.findIndex((p) => p.auth_user_id === user?.id);
  const top3 = players?.slice(0, 3) || [];
  const rest = players?.slice(3) || [];

  return (
    <div className="flex flex-col gap-4">
      {/* Top 3 podium */}
      {top3.length > 0 && (
        <div className="flex items-end justify-center gap-3 pt-4 pb-2">
          {[1, 0, 2].map((idx) => {
            const p = top3[idx];
            if (!p) return <div key={idx} className="flex-1" />;
            const PodiumIcon = podiumIcons[idx];
            const isFirst = idx === 0;
            return (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
                className="flex flex-col items-center gap-1.5"
                style={{ flex: 1 }}
              >
                <PodiumIcon className="w-5 h-5" style={{ color: podiumColors[idx] }} />
                <div
                  className={`${isFirst ? "w-16 h-16" : "w-12 h-12"} rounded-full flex items-center justify-center`}
                  style={{
                    background: `${podiumColors[idx]}20`,
                    border: `2px solid ${podiumColors[idx]}`,
                  }}
                >
                  <span className={`${isFirst ? "text-xl" : "text-base"} font-black`} style={{ color: "#3E3D39" }}>
                    {(p.display_name || "?").charAt(0).toUpperCase()}
                  </span>
                </div>
                <p className="text-xs font-semibold text-center truncate max-w-[80px]" style={{ color: "#3E3D39" }}>
                  {p.display_name || "Anonym"}
                </p>
                <p className="text-base font-black" style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#E86C24" }}>
                  {p.pickla_rating}
                </p>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Your position */}
      {user && myRank !== undefined && myRank >= 0 && (
        <div
          className="rounded-xl p-3 flex items-center gap-3"
          style={{ background: "rgba(232,108,36,0.08)", border: "1.5px solid rgba(232,108,36,0.2)" }}
        >
          <span className="text-sm font-black w-8 text-center" style={{ color: "#E86C24" }}>#{myRank + 1}</span>
          <span className="text-sm font-semibold flex-1" style={{ color: "#3E3D39" }}>Din position</span>
          <span className="text-sm font-bold" style={{ color: "#E86C24" }}>
            {players?.[myRank]?.pickla_rating}
          </span>
        </div>
      )}

      {/* Rest of leaderboard */}
      <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col gap-1">
        {rest.map((p, i) => {
          const isMe = p.auth_user_id === user?.id;
          return (
            <motion.div
              key={p.id}
              variants={item}
              className="rounded-xl p-3 flex items-center gap-3"
              style={{
                background: isMe ? "rgba(232,108,36,0.06)" : "rgba(255,255,255,0.5)",
                border: isMe ? "1.5px solid rgba(232,108,36,0.2)" : "1px solid rgba(62,61,57,0.06)",
              }}
            >
              <span className="text-xs font-bold w-6 text-center" style={{ color: "rgba(62,61,57,0.4)" }}>
                {i + 4}
              </span>
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                style={{ background: "rgba(62,61,57,0.08)" }}
              >
                <span className="text-xs font-bold" style={{ color: "#3E3D39" }}>
                  {(p.display_name || "?").charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: "#3E3D39" }}>
                  {p.display_name || "Anonym"}
                </p>
                <p className="text-[10px]" style={{ color: "rgba(62,61,57,0.4)" }}>
                  {p.total_wins || 0}W / {p.total_matches || 0}M
                </p>
              </div>
              <span className="text-sm font-black" style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#E86C24" }}>
                {p.pickla_rating}
              </span>
            </motion.div>
          );
        })}
      </motion.div>
    </div>
  );
}
