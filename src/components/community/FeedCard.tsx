import { motion } from "framer-motion";
import { Heart, Share2, Trophy, UserCheck, CalendarPlus, Star, Swords } from "lucide-react";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQueryClient } from "@tanstack/react-query";

interface FeedItem {
  id: string;
  feed_type: string;
  title: string;
  content: any;
  created_at: string;
  venue_id: string | null;
  venues?: { name: string; slug: string } | null;
  player_profiles?: { display_name: string | null; avatar_url: string | null } | null;
  like_count: number;
  user_liked: boolean;
}

const feedTypeConfig: Record<string, { icon: typeof Trophy; label: string; color: string }> = {
  match_result: { icon: Trophy, label: "Matchresultat", color: "#E86C24" },
  checkin: { icon: UserCheck, label: "Check-in", color: "#4CAF50" },
  event_created: { icon: CalendarPlus, label: "Nytt event", color: "#2196F3" },
  achievement: { icon: Star, label: "Achievement", color: "#FFD700" },
  crew_challenge_created: { icon: Swords, label: "Clash", color: "#9C27B0" },
  crew_challenge_accepted: { icon: Swords, label: "Clash accepterad", color: "#4CAF50" },
  crew_challenge_completed: { icon: Swords, label: "Clash avslutad", color: "#E86C24" },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just nu";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function FeedCard({ item }: { item: FeedItem }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [liked, setLiked] = useState(item.user_liked);
  const [likeCount, setLikeCount] = useState(item.like_count);
  const [liking, setLiking] = useState(false);

  const config = feedTypeConfig[item.feed_type] || feedTypeConfig.match_result;
  const Icon = config.icon;

  const handleLike = async () => {
    if (!user || liking) return;
    setLiking(true);
    try {
      if (liked) {
        await (supabase as any).from("feed_likes").delete().eq("feed_item_id", item.id).eq("auth_user_id", user.id);
        setLiked(false);
        setLikeCount((c) => Math.max(0, c - 1));
      } else {
        await (supabase as any).from("feed_likes").insert({ feed_item_id: item.id, auth_user_id: user.id });
        setLiked(true);
        setLikeCount((c) => c + 1);
      }
      queryClient.invalidateQueries({ queryKey: ["community-feed"] });
    } catch (e) {
      // revert
    } finally {
      setLiking(false);
    }
  };

  const handleShare = async () => {
    const text = `${item.title} — Pickla`;
    if (navigator.share) {
      await navigator.share({ text, url: window.location.href });
    } else {
      await navigator.clipboard.writeText(text);
    }
  };

  const renderContent = () => {
    if (item.feed_type === "match_result" && item.content) {
      const c = item.content;
      return (
        <div className="flex items-center justify-between mt-2 rounded-xl p-3" style={{ background: "rgba(62,61,57,0.04)" }}>
          <div className="text-center flex-1">
            <p className="text-sm font-bold" style={{ color: "#3E3D39" }}>{c.team1_name}</p>
            <p className="text-2xl font-black" style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#3E3D39" }}>{c.team1_score}</p>
          </div>
          <span className="text-xs font-bold px-2" style={{ color: "rgba(62,61,57,0.3)" }}>VS</span>
          <div className="text-center flex-1">
            <p className="text-sm font-bold" style={{ color: "#3E3D39" }}>{c.team2_name}</p>
            <p className="text-2xl font-black" style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#3E3D39" }}>{c.team2_score}</p>
          </div>
        </div>
      );
    }
    if (item.feed_type === "event_created" && item.content) {
      return (
        <p className="text-xs mt-1" style={{ color: "rgba(62,61,57,0.6)" }}>
          {item.content.format} · {item.content.event_type}
          {item.content.start_date && ` · ${new Date(item.content.start_date).toLocaleDateString("sv-SE", { day: "numeric", month: "short" })}`}
        </p>
      );
    }
    if (item.feed_type?.startsWith("crew_challenge") && item.content) {
      const c = item.content;
      return (
        <div className="flex items-center justify-between mt-2 rounded-xl p-3" style={{ background: "rgba(156,39,176,0.06)" }}>
          <div className="text-center flex-1">
            <p className="text-sm font-bold" style={{ color: "#3E3D39" }}>{c.challenger_name || "Crew"}</p>
          </div>
          <span className="text-xs font-black px-2" style={{ color: "rgba(62,61,57,0.3)" }}>⚔️</span>
          <div className="text-center flex-1">
            <p className="text-sm font-bold" style={{ color: "#3E3D39" }}>{c.challenged_name || "Crew"}</p>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <motion.div
      className="rounded-2xl p-4"
      style={{
        background: "rgba(255,255,255,0.6)",
        border: "1.5px solid rgba(62,61,57,0.1)",
        boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-2">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
          style={{ background: `${config.color}15` }}
        >
          <Icon className="w-4 h-4" style={{ color: config.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: config.color }}>{config.label}</span>
            {item.venues?.name && (
              <span className="text-[10px]" style={{ color: "rgba(62,61,57,0.4)" }}>· {item.venues.name}</span>
            )}
          </div>
          <p className="text-sm font-semibold truncate" style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#3E3D39" }}>
            {item.title}
          </p>
        </div>
        <span className="text-[10px] shrink-0" style={{ color: "rgba(62,61,57,0.4)" }}>{timeAgo(item.created_at)}</span>
      </div>

      {renderContent()}

      {/* Actions */}
      <div className="flex items-center gap-4 mt-3 pt-2" style={{ borderTop: "1px solid rgba(62,61,57,0.08)" }}>
        <button
          onClick={handleLike}
          disabled={!user}
          className="flex items-center gap-1.5 transition-all active:scale-90"
        >
          <Heart
            className="w-4 h-4 transition-colors"
            style={{ color: liked ? "#E53935" : "rgba(62,61,57,0.3)" }}
            fill={liked ? "#E53935" : "none"}
          />
          <span className="text-xs font-medium" style={{ color: liked ? "#E53935" : "rgba(62,61,57,0.4)" }}>
            {likeCount > 0 ? likeCount : ""}
          </span>
        </button>
        <button onClick={handleShare} className="flex items-center gap-1.5 transition-all active:scale-90">
          <Share2 className="w-4 h-4" style={{ color: "rgba(62,61,57,0.3)" }} />
          <span className="text-xs font-medium" style={{ color: "rgba(62,61,57,0.4)" }}>Dela</span>
        </button>
      </div>
    </motion.div>
  );
}
