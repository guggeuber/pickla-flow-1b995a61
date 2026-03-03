import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { motion } from "framer-motion";
import { Loader2, ArrowLeft, Swords, LogOut, UserPlus } from "lucide-react";
import { CrewBadge } from "./CrewBadge";
import { toast } from "sonner";
import { useState } from "react";

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.05 } } };
const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } };

interface Props {
  crewId: string;
  onBack: () => void;
}

export function CrewDetailView({ crewId, onBack }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [joining, setJoining] = useState(false);

  const { data: crew, isLoading } = useQuery({
    queryKey: ["crew-detail", crewId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crews")
        .select("*")
        .eq("id", crewId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: members } = useQuery({
    queryKey: ["crew-members", crewId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crew_members")
        .select("*, player_profiles(id, auth_user_id, display_name, avatar_url, pickla_rating, total_matches, total_wins)")
        .eq("crew_id", crewId)
        .order("joined_at", { ascending: true });
      if (error) throw error;
      // Sort by rating desc
      return (data || []).sort(
        (a: any, b: any) =>
          (b.player_profiles?.pickla_rating || 0) - (a.player_profiles?.pickla_rating || 0)
      );
    },
  });

  const myMembership = members?.find(
    (m: any) => m.player_profiles?.auth_user_id === user?.id
  );
  const isLeader = myMembership?.role === "leader" || myMembership?.role === "co_leader";
  const crewScore = members?.reduce(
    (sum: number, m: any) => sum + (m.player_profiles?.pickla_rating || 0),
    0
  ) || 0;

  const handleJoin = async () => {
    if (!user) return;
    setJoining(true);
    try {
      const { data: profile } = await supabase
        .from("player_profiles")
        .select("id, pickla_rating")
        .eq("auth_user_id", user.id)
        .single();

      if (!profile) {
        toast.error("Du behöver en spelarprofil");
        return;
      }

      if (crew?.min_rating && (profile.pickla_rating || 0) < crew.min_rating) {
        toast.error(`Du behöver minst ${crew.min_rating} rating`);
        return;
      }

      if (members && members.length >= (crew?.max_members || 50)) {
        toast.error("Crewet är fullt");
        return;
      }

      const { error } = await supabase.from("crew_members").insert({
        crew_id: crewId,
        player_profile_id: profile.id,
        role: "member",
      });

      if (error) {
        if (error.code === "23505") toast.error("Du är redan med i ett crew");
        else toast.error("Kunde inte gå med");
        return;
      }

      toast.success("Du gick med i crewet! 🎉");
      qc.invalidateQueries({ queryKey: ["crew-members", crewId] });
      qc.invalidateQueries({ queryKey: ["my-crew"] });
    } finally {
      setJoining(false);
    }
  };

  const handleLeave = async () => {
    if (!myMembership) return;
    const { error } = await supabase
      .from("crew_members")
      .delete()
      .eq("id", myMembership.id);

    if (error) {
      toast.error("Kunde inte lämna crewet");
      return;
    }
    toast.success("Du har lämnat crewet");
    qc.invalidateQueries({ queryKey: ["crew-members", crewId] });
    qc.invalidateQueries({ queryKey: ["my-crew"] });
    qc.invalidateQueries({ queryKey: ["crews"] });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: "#3E3D39" }} />
      </div>
    );
  }

  if (!crew) return null;

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col gap-4">
      {/* Back button */}
      <motion.button
        variants={item}
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm font-medium self-start"
        style={{ color: "rgba(62,61,57,0.5)" }}
      >
        <ArrowLeft className="w-4 h-4" />
        Tillbaka
      </motion.button>

      {/* Crew header */}
      <motion.div
        variants={item}
        className="rounded-2xl p-5"
        style={{
          background: "rgba(255,255,255,0.6)",
          border: "1.5px solid rgba(62,61,57,0.1)",
          boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
        }}
      >
        <div className="flex items-center gap-4 mb-4">
          <CrewBadge emoji={crew.badge_emoji || "⚡"} color={crew.badge_color || "#E86C24"} size="lg" />
          <div className="flex-1">
            <h2
              className="font-bold text-lg"
              style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#3E3D39" }}
            >
              {crew.name}
            </h2>
            {crew.description && (
              <p className="text-xs mt-1" style={{ color: "rgba(62,61,57,0.5)" }}>
                {crew.description}
              </p>
            )}
            <span
              className="text-[10px] font-semibold mt-1 inline-block"
              style={{ color: "rgba(62,61,57,0.4)" }}
            >
              {members?.length || 0}/{crew.max_members} medlemmar
            </span>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          {[
            { label: "Crew Score", value: crewScore.toLocaleString(), color: "#E86C24" },
            {
              label: "Activity",
              value: crewScore > 8000 ? "High" : crewScore > 3000 ? "Medium" : "Low",
              color: crewScore > 8000 ? "#4CAF50" : crewScore > 3000 ? "#FF9800" : "rgba(62,61,57,0.4)",
            },
            { label: "Req. Level", value: crew.min_rating || 0, color: "#3E3D39" },
            {
              label: "Type",
              value: crew.crew_type === "open" ? "Open" : crew.crew_type === "invite_only" ? "Invite" : "Closed",
              color: "#3E3D39",
            },
          ].map((s, i) => (
            <div key={i} className="text-center rounded-xl p-2" style={{ background: "rgba(62,61,57,0.04)" }}>
              <p className="text-sm font-bold" style={{ fontFamily: "'Space Grotesk', sans-serif", color: s.color }}>
                {s.value}
              </p>
              <p className="text-[8px] uppercase tracking-wider font-semibold" style={{ color: "rgba(62,61,57,0.35)" }}>
                {s.label}
              </p>
            </div>
          ))}
        </div>

        {/* Actions */}
        {user && !myMembership && crew.crew_type === "open" && (
          <button
            onClick={handleJoin}
            disabled={joining}
            className="w-full rounded-xl py-3 text-sm font-bold transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: "#E86C24", color: "#fff" }}
          >
            <UserPlus className="w-4 h-4" />
            {joining ? "Går med..." : "Gå med"}
          </button>
        )}
        {myMembership && !isLeader && (
          <button
            onClick={handleLeave}
            className="w-full rounded-xl py-3 text-sm font-medium transition-all active:scale-95 flex items-center justify-center gap-2"
            style={{ background: "rgba(62,61,57,0.06)", border: "1px solid rgba(62,61,57,0.1)", color: "rgba(62,61,57,0.6)" }}
          >
            <LogOut className="w-4 h-4" />
            Lämna crew
          </button>
        )}
      </motion.div>

      {/* Members list */}
      <motion.div variants={item}>
        <h3
          className="text-sm font-semibold mb-2"
          style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#3E3D39" }}
        >
          Medlemmar
        </h3>
        <div className="flex flex-col gap-1.5">
          {members?.map((m: any, i: number) => {
            const p = m.player_profiles;
            const roleLabel =
              m.role === "leader" ? "👑" : m.role === "co_leader" ? "⭐" : m.role === "elder" ? "🛡" : "";
            return (
              <motion.div
                key={m.id}
                variants={item}
                className="rounded-xl p-3 flex items-center gap-3"
                style={{
                  background: p?.auth_user_id === user?.id ? "rgba(232,108,36,0.06)" : "rgba(255,255,255,0.5)",
                  border: p?.auth_user_id === user?.id ? "1.5px solid rgba(232,108,36,0.2)" : "1px solid rgba(62,61,57,0.06)",
                }}
              >
                <span className="text-xs font-bold w-6 text-center" style={{ color: "rgba(62,61,57,0.4)" }}>
                  #{i + 1}
                </span>
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: "rgba(62,61,57,0.08)" }}
                >
                  <span className="text-xs font-bold" style={{ color: "#3E3D39" }}>
                    {(p?.display_name || "?").charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: "#3E3D39" }}>
                    {roleLabel} {p?.display_name || "Anonym"}
                  </p>
                  <p className="text-[10px]" style={{ color: "rgba(62,61,57,0.4)" }}>
                    {p?.total_wins || 0}W / {p?.total_matches || 0}M
                  </p>
                </div>
                <span
                  className="text-sm font-black"
                  style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#E86C24" }}
                >
                  {p?.pickla_rating || 0}
                </span>
              </motion.div>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}
