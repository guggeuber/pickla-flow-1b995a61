import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Loader2, LogOut, Trophy, Target, Flame, Star, TrendingUp, Swords } from "lucide-react";
import { CrewBadge } from "./CrewBadge";

const BLUE = "#0066FF";
const GREEN = "#22C55E";
const TEXT_PRIMARY = "#111827";
const TEXT_MUTED = "#9CA3AF";

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08 } } };
const item = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } };

function usePlayerProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["player-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_profiles")
        .select("*")
        .eq("auth_user_id", user!.id)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

function useMyFeed() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-feed", user?.id],
    enabled: !!user,
    staleTime: 30000,
    queryFn: async () => {
      const { data: profile } = await supabase
        .from("player_profiles")
        .select("id")
        .eq("auth_user_id", user!.id)
        .single();
      if (!profile) return [];
      const { data, error } = await (supabase as any)
        .from("community_feed")
        .select("*")
        .eq("player_profile_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
  });
}

const achievements = [
  { key: "first_match", label: "First Match", icon: Star, check: (p: any) => (p.total_matches || 0) >= 1 },
  { key: "ten_wins", label: "10 Wins", icon: Trophy, check: (p: any) => (p.total_wins || 0) >= 10 },
  { key: "fifty_matches", label: "50 Matches", icon: Target, check: (p: any) => (p.total_matches || 0) >= 50 },
  { key: "hundred_matches", label: "100 Matches", icon: Flame, check: (p: any) => (p.total_matches || 0) >= 100 },
];

function usePlayerCrew() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-crew", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data: profile } = await supabase
        .from("player_profiles")
        .select("id")
        .eq("auth_user_id", user!.id)
        .single();
      if (!profile) return null;
      const { data } = await supabase
        .from("crew_members")
        .select("crew_id, role, crews(id, name, badge_emoji, badge_color)")
        .eq("player_profile_id", profile.id)
        .limit(1)
        .single();
      return data;
    },
  });
}

export function ProfileTab() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { data: profile, isLoading } = usePlayerProfile();
  const { data: myFeed } = useMyFeed();
  const { data: myCrew } = usePlayerCrew();

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <p className="text-sm font-semibold" style={{ color: TEXT_PRIMARY }}>Sign in to view your profile</p>
        <button
          onClick={() => navigate("/auth?redirect=/community")}
          className="px-6 py-3 rounded-xl text-sm font-bold transition-all active:scale-95 text-white"
          style={{ background: BLUE }}
        >
          Sign in
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: TEXT_MUTED }} />
      </div>
    );
  }

  const displayName = profile?.display_name || user.email?.split("@")[0] || "Player";
  const winRate = profile?.total_matches ? Math.round(((profile.total_wins || 0) / profile.total_matches) * 100) : 0;

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col gap-4">
      {/* Profile card */}
      <motion.div
        variants={item}
        className="rounded-2xl p-5"
        style={{
          background: "rgba(255,255,255,0.6)",
          border: "1.5px solid rgba(62,61,57,0.1)",
          boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
        }}
      >
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{ background: `${BLUE}15`, border: `2px solid ${BLUE}40` }}
          >
            <span className="text-xl font-black" style={{ color: BLUE }}>
              {displayName.charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <p className="font-bold text-base" style={{ fontFamily: "'Space Grotesk', sans-serif", color: TEXT_PRIMARY }}>
              {displayName}
            </p>
            <p className="text-xs" style={{ color: TEXT_MUTED }}>{user.email}</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { value: profile?.pickla_rating || 1000, label: "Rating", color: BLUE },
            { value: profile?.total_matches || 0, label: "Matches", color: TEXT_PRIMARY },
            { value: profile?.total_wins || 0, label: "Wins", color: GREEN },
            { value: `${winRate}%`, label: "Win rate", color: TEXT_PRIMARY },
          ].map((s) => (
            <div key={s.label} className="text-center rounded-xl p-2" style={{ background: "rgba(62,61,57,0.04)" }}>
              <p className="text-lg font-black" style={{ fontFamily: "'Space Grotesk', sans-serif", color: s.color }}>{s.value}</p>
              <p className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: TEXT_MUTED }}>{s.label}</p>
            </div>
          ))}
        </div>

        {/* Crew */}
        {myCrew && (
          <div className="flex items-center gap-3 mt-3 rounded-xl p-3"
            style={{ background: `${BLUE}08`, border: `1px solid ${BLUE}20` }}>
            <CrewBadge
              emoji={(myCrew as any).crews?.badge_emoji || "⚡"}
              color={(myCrew as any).crews?.badge_color || BLUE}
              size="sm"
            />
            <div className="flex-1">
              <p className="text-[10px] font-semibold" style={{ color: TEXT_MUTED }}>Crew</p>
              <p className="text-sm font-bold" style={{ color: TEXT_PRIMARY }}>
                {(myCrew as any).crews?.name}
              </p>
            </div>
            <Swords className="w-4 h-4" style={{ color: BLUE }} />
          </div>
        )}
      </motion.div>

      {/* Achievements */}
      <motion.div variants={item}>
        <div className="flex items-center gap-2 mb-2">
          <Trophy className="w-4 h-4" style={{ color: "#FFD700" }} />
          <span className="text-sm font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif", color: TEXT_PRIMARY }}>Achievements</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {achievements.map((a) => {
            const unlocked = profile && a.check(profile);
            const AIcon = a.icon;
            return (
              <div key={a.key} className="rounded-xl p-3 flex items-center gap-2.5"
                style={{
                  background: unlocked ? "rgba(255,215,0,0.08)" : "rgba(62,61,57,0.03)",
                  border: unlocked ? "1.5px solid rgba(255,215,0,0.2)" : "1px solid rgba(62,61,57,0.06)",
                  opacity: unlocked ? 1 : 0.5,
                }}>
                <AIcon className="w-4 h-4" style={{ color: unlocked ? "#FFD700" : "rgba(62,61,57,0.3)" }} />
                <span className="text-xs font-medium" style={{ color: unlocked ? TEXT_PRIMARY : TEXT_MUTED }}>{a.label}</span>
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* Recent activity */}
      {myFeed && myFeed.length > 0 && (
        <motion.div variants={item}>
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4" style={{ color: BLUE }} />
            <span className="text-sm font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif", color: TEXT_PRIMARY }}>Recent Activity</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {myFeed.slice(0, 5).map((f: any) => (
              <div key={f.id} className="rounded-xl p-2.5 flex items-center gap-2"
                style={{ background: "rgba(255,255,255,0.5)", border: "1px solid rgba(62,61,57,0.06)" }}>
                <span className="text-xs font-medium flex-1 truncate" style={{ color: TEXT_PRIMARY }}>{f.title}</span>
                <span className="text-[10px] shrink-0" style={{ color: TEXT_MUTED }}>
                  {new Date(f.created_at).toLocaleDateString("en-US", { day: "numeric", month: "short" })}
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Sign out */}
      <motion.div variants={item} className="pt-4">
        <button
          onClick={async () => { await signOut(); navigate("/community"); }}
          className="w-full rounded-xl p-3 flex items-center justify-center gap-2 transition-all active:scale-95"
          style={{ background: "rgba(62,61,57,0.06)", border: "1px solid rgba(62,61,57,0.1)" }}
        >
          <LogOut className="w-4 h-4" style={{ color: TEXT_MUTED }} />
          <span className="text-sm font-medium" style={{ color: "rgba(62,61,57,0.6)" }}>Sign out</span>
        </button>
      </motion.div>
    </motion.div>
  );
}
