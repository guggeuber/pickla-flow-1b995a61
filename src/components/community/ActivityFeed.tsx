import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { motion } from "framer-motion";
import { Loader2, Zap, Trophy, UserCheck, CalendarPlus, Swords, Dumbbell, Heart } from "lucide-react";

const FONT_GROTESK = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

const feedTypeConfig: Record<string, { emoji: string; color: string }> = {
  match_result: { emoji: "🏆", color: "#F59E0B" },
  checkin: { emoji: "🏓", color: "#22C55E" },
  event_created: { emoji: "📅", color: "#3B82F6" },
  crew_challenge_created: { emoji: "⚔️", color: "#8B5CF6" },
  crew_challenge_accepted: { emoji: "🤝", color: "#22C55E" },
  crew_challenge_completed: { emoji: "🏅", color: "#F59E0B" },
  crew_session: { emoji: "💪", color: "#3B82F6" },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "nu";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

function LikeButton({ feedItemId, likeCount, userLiked }: { feedItemId: string; likeCount: number; userLiked: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [optimisticLiked, setOptimisticLiked] = useState(userLiked);
  const [optimisticCount, setOptimisticCount] = useState(likeCount);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (!user || busy) return;
    setBusy(true);
    const wasLiked = optimisticLiked;
    setOptimisticLiked(!wasLiked);
    setOptimisticCount(c => wasLiked ? c - 1 : c + 1);

    try {
      if (wasLiked) {
        await (supabase as any).from("feed_likes").delete().eq("feed_item_id", feedItemId).eq("auth_user_id", user.id);
      } else {
        await (supabase as any).from("feed_likes").insert({ feed_item_id: feedItemId, auth_user_id: user.id });
      }
      qc.invalidateQueries({ queryKey: ["community-feed"] });
    } catch {
      setOptimisticLiked(wasLiked);
      setOptimisticCount(likeCount);
    }
    setBusy(false);
  };

  return (
    <button onClick={toggle} disabled={!user} className="flex items-center gap-1 text-[11px] transition-all active:scale-90">
      <Heart
        className="w-3.5 h-3.5 transition-colors"
        fill={optimisticLiked ? "#EF4444" : "none"}
        stroke={optimisticLiked ? "#EF4444" : "#9CA3AF"}
      />
      <span style={{ color: optimisticLiked ? "#EF4444" : "#9CA3AF", fontFamily: FONT_MONO }}>
        {optimisticCount}
      </span>
    </button>
  );
}

function ActivityCard({ item: fi }: { item: any }) {
  const config = feedTypeConfig[fi.feed_type] || feedTypeConfig.match_result;
  
  const renderMatchScore = () => {
    if (fi.feed_type !== "match_result" || !fi.content) return null;
    const c = fi.content;
    return (
      <div className="flex items-center gap-3 mt-2 rounded-xl p-3 bg-neutral-50">
        <div className="text-center flex-1">
          <p className="text-xs font-semibold text-neutral-700">{c.team1_name}</p>
          <p className="text-xl font-black text-neutral-900" style={{ fontFamily: FONT_GROTESK }}>{c.team1_score}</p>
        </div>
        <span className="text-[10px] font-bold text-neutral-400">VS</span>
        <div className="text-center flex-1">
          <p className="text-xs font-semibold text-neutral-700">{c.team2_name}</p>
          <p className="text-xl font-black text-neutral-900" style={{ fontFamily: FONT_GROTESK }}>{c.team2_score}</p>
        </div>
      </div>
    );
  };

  return (
    <div className="flex gap-3 py-3">
      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 bg-neutral-100 text-base">
        {config.emoji}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[13px] font-semibold text-neutral-900 leading-snug" style={{ fontFamily: FONT_GROTESK }}>
            {fi.title}
          </p>
          <span className="text-[10px] text-neutral-400 shrink-0 mt-0.5" style={{ fontFamily: FONT_MONO }}>
            {timeAgo(fi.created_at)}
          </span>
        </div>
        {fi.venues?.name && (
          <p className="text-[11px] text-neutral-400 mt-0.5">📍 {fi.venues.name}</p>
        )}
        {renderMatchScore()}
        <div className="flex items-center gap-4 mt-2">
          <LikeButton feedItemId={fi.id} likeCount={fi.like_count || 0} userLiked={fi.user_liked || false} />
        </div>
      </div>
    </div>
  );
}

export function ActivityFeed() {
  const { user } = useAuth();

  const { data: feedItems, isLoading } = useQuery({
    queryKey: ["community-feed"],
    staleTime: 15000,
    queryFn: async () => {
      const { data: feed, error } = await (supabase as any)
        .from("community_feed")
        .select("*, venues(name, slug)")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      const feedIds = (feed || []).map((f: any) => f.id);
      let likeCounts: Record<string, number> = {};
      let userLikes: Record<string, boolean> = {};
      if (feedIds.length > 0) {
        const { data: likes } = await (supabase as any)
          .from("feed_likes")
          .select("feed_item_id, auth_user_id")
          .in("feed_item_id", feedIds);
        (likes || []).forEach((l: any) => {
          likeCounts[l.feed_item_id] = (likeCounts[l.feed_item_id] || 0) + 1;
          if (user && l.auth_user_id === user.id) userLikes[l.feed_item_id] = true;
        });
      }
      // Save latest timestamp for badge
      if (feed?.length) {
        localStorage.setItem("community_activity_last_seen", new Date().toISOString());
      }
      return (feed || []).map((f: any) => ({
        ...f,
        like_count: likeCounts[f.id] || 0,
        user_liked: userLikes[f.id] || false,
      }));
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-neutral-300" />
      </div>
    );
  }

  if (!feedItems?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2">
        <Zap className="w-6 h-6 text-neutral-300" />
        <p className="text-sm font-semibold text-neutral-500" style={{ fontFamily: FONT_GROTESK }}>No activity yet</p>
        <p className="text-[11px] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
          Play matches and check in to see activity here
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-neutral-100">
      {feedItems.map((fi: any) => (
        <ActivityCard key={fi.id} item={fi} />
      ))}
    </div>
  );
}
