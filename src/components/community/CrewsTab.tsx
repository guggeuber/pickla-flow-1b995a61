import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { motion } from "framer-motion";
import { Loader2, Plus } from "lucide-react";
import { CrewCard } from "./CrewCard";
import { CrewDetailView } from "./CrewDetailView";
import { CreateCrewModal } from "./CreateCrewModal";
import { useNavigate } from "react-router-dom";

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06 } } };
const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } };

export function CrewsTab() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectedCrewId, setSelectedCrewId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState<"all" | "open">("all");

  // Check if user already has a crew
  const { data: myCrew } = useQuery({
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

  const { data: crews, isLoading } = useQuery({
    queryKey: ["crews", filter],
    staleTime: 30000,
    queryFn: async () => {
      let query = supabase.from("crews").select("*");
      if (filter === "open") query = query.eq("crew_type", "open");

      const { data: crewsData, error } = await query.order("created_at", { ascending: false });
      if (error) throw error;

      // Get member counts and scores
      const crewIds = crewsData?.map((c) => c.id) || [];
      if (crewIds.length === 0) return [];

      const { data: members } = await supabase
        .from("crew_members")
        .select("crew_id, player_profiles(pickla_rating)")
        .in("crew_id", crewIds);

      const crewStats = new Map<string, { count: number; score: number }>();
      members?.forEach((m: any) => {
        const stats = crewStats.get(m.crew_id) || { count: 0, score: 0 };
        stats.count++;
        stats.score += m.player_profiles?.pickla_rating || 0;
        crewStats.set(m.crew_id, stats);
      });

      return (crewsData || [])
        .map((c) => ({
          ...c,
          member_count: crewStats.get(c.id)?.count || 0,
          crew_score: crewStats.get(c.id)?.score || 0,
        }))
        .sort((a, b) => b.crew_score - a.crew_score);
    },
  });

  if (selectedCrewId) {
    return <CrewDetailView crewId={selectedCrewId} onBack={() => setSelectedCrewId(null)} />;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: "#3E3D39" }} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* My crew banner */}
      {myCrew && (
        <motion.button
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={() => setSelectedCrewId((myCrew as any).crew_id)}
          className="w-full rounded-xl p-3 flex items-center gap-3 transition-all active:scale-[0.98]"
          style={{
            background: "rgba(232,108,36,0.08)",
            border: "1.5px solid rgba(232,108,36,0.2)",
          }}
        >
          <span className="text-lg">{(myCrew as any).crews?.badge_emoji || "⚡"}</span>
          <div className="text-left flex-1">
            <p className="text-xs font-semibold" style={{ color: "#E86C24" }}>Ditt Crew</p>
            <p className="text-sm font-bold" style={{ color: "#3E3D39" }}>
              {(myCrew as any).crews?.name}
            </p>
          </div>
          <span className="text-xs font-semibold" style={{ color: "rgba(62,61,57,0.4)" }}>
            {(myCrew as any).role === "leader" ? "👑 Leader" : "Member"}
          </span>
        </motion.button>
      )}

      {/* Header + Create */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {(["all", "open"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{
                background: filter === f ? "#E86C24" : "rgba(255,255,255,0.5)",
                color: filter === f ? "#fff" : "rgba(62,61,57,0.5)",
              }}
            >
              {f === "all" ? "Alla" : "Öppna"}
            </button>
          ))}
        </div>
        {user && !myCrew && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95"
            style={{ background: "#E86C24", color: "#fff" }}
          >
            <Plus className="w-3.5 h-3.5" />
            Skapa Crew
          </button>
        )}
        {!user && (
          <button
            onClick={() => navigate("/auth?redirect=/community")}
            className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95"
            style={{ background: "#E86C24", color: "#fff" }}
          >
            Logga in
          </button>
        )}
      </div>

      {/* Crew list */}
      {crews && crews.length > 0 ? (
        <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col gap-3">
          {crews.map((crew) => (
            <motion.div key={crew.id} variants={item}>
              <CrewCard crew={crew} onSelect={setSelectedCrewId} />
            </motion.div>
          ))}
        </motion.div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <span className="text-3xl">⚡</span>
          <p className="text-sm font-medium" style={{ color: "rgba(62,61,57,0.5)" }}>
            Inga crews ännu — var först att skapa ett!
          </p>
        </div>
      )}

      <CreateCrewModal open={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  );
}
