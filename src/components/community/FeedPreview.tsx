import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ChevronRight, Trophy, CalendarPlus, Swords, Dumbbell, Star, UserCheck } from "lucide-react";
import { format, parseISO } from "date-fns";
import { sv } from "date-fns/locale";
import type { LucideIcon } from "lucide-react";

const typeConfig: Record<string, { icon: LucideIcon; label: string; color: string }> = {
  match_result: { icon: Trophy, label: "Match", color: "#E86C24" },
  event_created: { icon: CalendarPlus, label: "Event", color: "#2196F3" },
  crew_challenge_created: { icon: Swords, label: "Clash", color: "#9C27B0" },
  crew_challenge_accepted: { icon: Swords, label: "Clash", color: "#4CAF50" },
  crew_challenge_completed: { icon: Swords, label: "Clash", color: "#E86C24" },
  crew_session: { icon: Dumbbell, label: "Träning", color: "#2196F3" },
  checkin: { icon: UserCheck, label: "Check-in", color: "#4CAF50" },
  achievement: { icon: Star, label: "Achievement", color: "#FFD700" },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "nu";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function FeedPreview() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: feedItems } = useQuery({
    queryKey: ["feed-preview"],
    staleTime: 30000,
    queryFn: async () => {
      const { data } = await supabase
        .from("community_feed")
        .select("id, feed_type, title, content, created_at, venue_id")
        .order("created_at", { ascending: false })
        .limit(3);
      return data || [];
    },
  });

  if (!feedItems?.length) return null;

  return (
    <div className="w-full flex flex-col gap-2.5">
      {/* Section header */}
      <div className="flex items-center gap-2">
        <span
          className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: "rgba(62,61,57,0.5)" }}
        >
          Senaste
        </span>
        <div className="flex-1 h-px" style={{ background: "rgba(62,61,57,0.12)" }} />
      </div>

      {feedItems.map((item, i) => {
        const cfg = typeConfig[item.feed_type] || typeConfig.match_result;
        const Icon = cfg.icon;
        return (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="rounded-xl p-3 flex items-center gap-3"
            style={{
              background: "rgba(255,255,255,0.6)",
              border: "1.5px solid rgba(62,61,57,0.08)",
            }}
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: `${cfg.color}15` }}
            >
              <Icon className="w-4 h-4" style={{ color: cfg.color }} />
            </div>
            <div className="flex-1 min-w-0">
              <p
                className="text-xs font-semibold truncate"
                style={{ color: "#3E3D39" }}
              >
                {item.title}
              </p>
              <p className="text-[10px]" style={{ color: "rgba(62,61,57,0.45)" }}>
                {cfg.label} · {timeAgo(item.created_at)}
              </p>
            </div>
          </motion.div>
        );
      })}

      {/* See more */}
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        onClick={() => navigate("/community")}
        className="flex items-center justify-center gap-1 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95"
        style={{
          color: "#E86C24",
          background: "rgba(232,108,36,0.06)",
          border: "1px solid rgba(232,108,36,0.15)",
        }}
      >
        Se mer <ChevronRight className="w-3.5 h-3.5" />
      </motion.button>
    </div>
  );
}
