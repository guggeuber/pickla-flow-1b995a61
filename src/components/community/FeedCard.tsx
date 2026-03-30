import { motion } from "framer-motion";
import { Heart, Share2, Trophy, UserCheck, CalendarPlus, Star, Swords, Dumbbell, Check, X, Users } from "lucide-react";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";

const BLUE = "#0066FF";
const GREEN = "#22C55E";
const TEXT_PRIMARY = "#111827";
const TEXT_MUTED = "#9CA3AF";

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
  match_result: { icon: Trophy, label: "Match Result", color: BLUE },
  checkin: { icon: UserCheck, label: "Check-in", color: GREEN },
  event_created: { icon: CalendarPlus, label: "New Event", color: "#2196F3" },
  achievement: { icon: Star, label: "Achievement", color: "#FFD700" },
  crew_challenge_created: { icon: Swords, label: "Clash", color: "#9C27B0" },
  crew_challenge_accepted: { icon: Swords, label: "Clash Accepted", color: GREEN },
  crew_challenge_completed: { icon: Swords, label: "Clash Complete", color: BLUE },
  crew_session: { icon: Dumbbell, label: "Training", color: "#2196F3" },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function SessionSignupButton({ sessionId }: { sessionId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);

  const { data: myProfile } = useQuery({
    queryKey: ["my-profile-id"],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("player_profiles")
        .select("id")
        .eq("auth_user_id", user!.id)
        .single();
      return data;
    },
  });

  const { data: signups } = useQuery({
    queryKey: ["session-signups", sessionId],
    queryFn: async () => {
      const { data } = await supabase
        .from("crew_session_signups" as any)
        .select("id, player_profile_id, player_profiles(display_name, avatar_url)")
        .eq("crew_session_id", sessionId)
        .eq("status", "signed_up");
      return data || [];
    },
  });

  const mySignup = (signups as any[])?.find((s: any) => s.player_profile_id === myProfile?.id);
  const signupCount = (signups as any[])?.length || 0;

  const handleToggle = async () => {
    if (!user || !myProfile) return;
    setLoading(true);
    try {
      if (mySignup) {
        await supabase.from("crew_session_signups" as any).delete().eq("id", mySignup.id);
        toast.success("Removed");
      } else {
        const { error } = await supabase.from("crew_session_signups" as any).insert({
          crew_session_id: sessionId,
          player_profile_id: myProfile.id,
          status: "signed_up",
        });
        if (error) {
          if (error.code === "23505") toast.error("Already signed up");
          else throw error;
          return;
        }
        toast.success("Signed up! ✅");
      }
      qc.invalidateQueries({ queryKey: ["session-signups", sessionId] });
    } catch (err: any) {
      toast.error(err.message || "Could not update signup");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-2">
      {signupCount > 0 && (
        <div className="flex items-center gap-1 mb-2 flex-wrap">
          {(signups || []).slice(0, 8).map((s: any) => {
            const name = s.player_profiles?.display_name || "?";
            const avatarUrl = s.player_profiles?.avatar_url;
            return (
              <div key={s.id} className="flex items-center gap-1 rounded-full px-1.5 py-0.5"
                style={{ background: "rgba(62,61,57,0.06)" }} title={name}>
                {avatarUrl ? (
                  <img src={avatarUrl} alt={name} className="w-4 h-4 rounded-full object-cover" />
                ) : (
                  <div className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold shrink-0"
                    style={{ background: `${BLUE}15`, color: BLUE }}>
                    {name.charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="text-[10px] font-medium truncate max-w-[60px]" style={{ color: TEXT_PRIMARY }}>{name}</span>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-[11px]" style={{ color: TEXT_MUTED }}>
          <Users className="w-3 h-3" />
          {signupCount} signed up
        </span>
        {user && (
          <button onClick={handleToggle} disabled={loading}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 flex items-center gap-1 disabled:opacity-50"
            style={{
              background: mySignup ? "rgba(62,61,57,0.06)" : BLUE,
              color: mySignup ? "rgba(62,61,57,0.6)" : "#fff",
              border: mySignup ? "1px solid rgba(62,61,57,0.1)" : "none",
            }}>
            {mySignup ? (<><X className="w-3 h-3" /> Leave</>) : (<><Check className="w-3 h-3" /> Join</>)}
          </button>
        )}
      </div>
    </div>
  );
}

export function FeedCard({ item: feedItem }: { item: FeedItem }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [liked, setLiked] = useState(feedItem.user_liked);
  const [likeCount, setLikeCount] = useState(feedItem.like_count);
  const [liking, setLiking] = useState(false);

  const config = feedTypeConfig[feedItem.feed_type] || feedTypeConfig.match_result;
  const Icon = config.icon;

  const handleLike = async () => {
    if (!user || liking) return;
    setLiking(true);
    try {
      if (liked) {
        await (supabase as any).from("feed_likes").delete().eq("feed_item_id", feedItem.id).eq("auth_user_id", user.id);
        setLiked(false);
        setLikeCount((c) => Math.max(0, c - 1));
      } else {
        await (supabase as any).from("feed_likes").insert({ feed_item_id: feedItem.id, auth_user_id: user.id });
        setLiked(true);
        setLikeCount((c) => c + 1);
      }
      queryClient.invalidateQueries({ queryKey: ["community-feed"] });
    } catch (e) {}
    finally { setLiking(false); }
  };

  const handleShare = async () => {
    const text = `${feedItem.title} — Pickla`;
    if (navigator.share) {
      await navigator.share({ text, url: window.location.href });
    } else {
      await navigator.clipboard.writeText(text);
    }
  };

  const renderContent = () => {
    if (feedItem.feed_type === "crew_session" && feedItem.content) {
      const c = feedItem.content;
      return (
        <div className="mt-2">
          <div className="rounded-xl p-3" style={{ background: "rgba(33,150,243,0.06)" }}>
            <div className="flex items-center gap-3 text-[11px]" style={{ color: "rgba(62,61,57,0.6)" }}>
              <span>📅 {c.session_date ? format(parseISO(c.session_date), "EEE d MMM") : ""}</span>
              <span>🕐 {c.start_time ? format(parseISO(c.start_time), "HH:mm") : ""}–{c.end_time ? format(parseISO(c.end_time), "HH:mm") : ""}</span>
            </div>
            {(c.venue_name || c.court_name) && (
              <p className="text-[11px] mt-1" style={{ color: TEXT_MUTED }}>
                📍 {[c.venue_name, c.court_name].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          {c.session_id && <SessionSignupButton sessionId={c.session_id} />}
        </div>
      );
    }
    if (feedItem.feed_type === "match_result" && feedItem.content) {
      const c = feedItem.content;
      return (
        <div className="flex items-center justify-between mt-2 rounded-xl p-3" style={{ background: "rgba(62,61,57,0.04)" }}>
          <div className="text-center flex-1">
            <p className="text-sm font-bold" style={{ color: TEXT_PRIMARY }}>{c.team1_name}</p>
            <p className="text-2xl font-black" style={{ fontFamily: "'Space Grotesk', sans-serif", color: TEXT_PRIMARY }}>{c.team1_score}</p>
          </div>
          <span className="text-xs font-bold px-2" style={{ color: TEXT_MUTED }}>VS</span>
          <div className="text-center flex-1">
            <p className="text-sm font-bold" style={{ color: TEXT_PRIMARY }}>{c.team2_name}</p>
            <p className="text-2xl font-black" style={{ fontFamily: "'Space Grotesk', sans-serif", color: TEXT_PRIMARY }}>{c.team2_score}</p>
          </div>
        </div>
      );
    }
    if (feedItem.feed_type === "event_created" && feedItem.content) {
      return (
        <p className="text-xs mt-1" style={{ color: TEXT_MUTED }}>
          {feedItem.content.format} · {feedItem.content.event_type}
          {feedItem.content.start_date && ` · ${new Date(feedItem.content.start_date).toLocaleDateString("en-US", { day: "numeric", month: "short" })}`}
        </p>
      );
    }
    if (feedItem.feed_type?.startsWith("crew_challenge") && feedItem.content) {
      const c = feedItem.content;
      return (
        <div className="flex items-center justify-between mt-2 rounded-xl p-3" style={{ background: "rgba(156,39,176,0.06)" }}>
          <div className="text-center flex-1">
            <p className="text-sm font-bold" style={{ color: TEXT_PRIMARY }}>{c.challenger_name || "Crew"}</p>
          </div>
          <span className="text-xs font-black px-2" style={{ color: TEXT_MUTED }}>⚔️</span>
          <div className="text-center flex-1">
            <p className="text-sm font-bold" style={{ color: TEXT_PRIMARY }}>{c.challenged_name || "Crew"}</p>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <motion.div className="rounded-2xl p-4"
      style={{ background: "rgba(255,255,255,0.6)", border: "1.5px solid rgba(62,61,57,0.1)", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
      <div className="flex items-center gap-2.5 mb-2">
        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
          style={{ background: `${config.color}15` }}>
          <Icon className="w-4 h-4" style={{ color: config.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: config.color }}>{config.label}</span>
            {feedItem.venues?.name && (
              <span className="text-[10px]" style={{ color: TEXT_MUTED }}>· {feedItem.venues.name}</span>
            )}
          </div>
          <p className="text-sm font-semibold truncate" style={{ fontFamily: "'Space Grotesk', sans-serif", color: TEXT_PRIMARY }}>
            {feedItem.title}
          </p>
        </div>
        <span className="text-[10px] shrink-0" style={{ color: TEXT_MUTED }}>{timeAgo(feedItem.created_at)}</span>
      </div>
      {renderContent()}
      <div className="flex items-center gap-4 mt-3 pt-2" style={{ borderTop: "1px solid rgba(62,61,57,0.08)" }}>
        <button onClick={handleLike} disabled={!user} className="flex items-center gap-1.5 transition-all active:scale-90">
          <Heart className="w-4 h-4 transition-colors" style={{ color: liked ? "#E53935" : TEXT_MUTED }} fill={liked ? "#E53935" : "none"} />
          <span className="text-xs font-medium" style={{ color: liked ? "#E53935" : TEXT_MUTED }}>{likeCount > 0 ? likeCount : ""}</span>
        </button>
        <button onClick={handleShare} className="flex items-center gap-1.5 transition-all active:scale-90">
          <Share2 className="w-4 h-4" style={{ color: TEXT_MUTED }} />
          <span className="text-xs font-medium" style={{ color: TEXT_MUTED }}>Share</span>
        </button>
      </div>
    </motion.div>
  );
}
