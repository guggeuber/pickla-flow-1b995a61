import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { motion } from "framer-motion";
import { Calendar, Clock, MapPin, Users, Check, X } from "lucide-react";
import { format, parseISO, isBefore } from "date-fns";
import { sv } from "date-fns/locale";
import { toast } from "sonner";
import { useState } from "react";

const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } };

interface Props {
  crewId: string;
  isMember: boolean;
}

export function CrewSessionsList({ crewId, isMember }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const { data: sessions } = useQuery({
    queryKey: ["crew-sessions", crewId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crew_sessions" as any)
        .select("*")
        .eq("crew_id", crewId)
        .neq("status", "cancelled")
        .order("session_date", { ascending: true });
      if (error) throw error;
      return (data || []).filter((s: any) => !isBefore(parseISO(s.session_date), new Date(new Date().toDateString())));
    },
  });

  const { data: signups } = useQuery({
    queryKey: ["crew-session-signups", crewId],
    queryFn: async () => {
      if (!sessions?.length) return [];
      const ids = sessions.map((s: any) => s.id);
      const { data, error } = await supabase
        .from("crew_session_signups" as any)
        .select("*, player_profiles(display_name)")
        .in("crew_session_id", ids)
        .eq("status", "signed_up");
      if (error) throw error;
      return data || [];
    },
    enabled: !!sessions?.length,
  });

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

  const { data: courts } = useQuery({
    queryKey: ["courts-map"],
    queryFn: async () => {
      const { data } = await supabase.from("venue_courts").select("id, name");
      return data || [];
    },
  });

  const getSignupsForSession = (sessionId: string) =>
    signups?.filter((s: any) => s.crew_session_id === sessionId) || [];

  const isSignedUp = (sessionId: string) =>
    signups?.some((s: any) => s.crew_session_id === sessionId && s.player_profile_id === myProfile?.id);

  const handleSignup = async (sessionId: string) => {
    if (!myProfile) return;
    setLoadingId(sessionId);
    try {
      const { error } = await supabase.from("crew_session_signups" as any).insert({
        crew_session_id: sessionId,
        player_profile_id: myProfile.id,
        status: "signed_up",
      });
      if (error) {
        if (error.code === "23505") toast.error("Du är redan anmäld");
        else throw error;
        return;
      }
      toast.success("Anmäld! ✅");
      qc.invalidateQueries({ queryKey: ["crew-session-signups", crewId] });
    } catch (err: any) {
      toast.error(err.message || "Kunde inte anmäla");
    } finally {
      setLoadingId(null);
    }
  };

  const handleCancel = async (sessionId: string) => {
    if (!myProfile) return;
    setLoadingId(sessionId);
    try {
      const { error } = await supabase
        .from("crew_session_signups" as any)
        .delete()
        .eq("crew_session_id", sessionId)
        .eq("player_profile_id", myProfile.id);
      if (error) throw error;
      toast.success("Avanmäld");
      qc.invalidateQueries({ queryKey: ["crew-session-signups", crewId] });
    } catch (err: any) {
      toast.error(err.message || "Kunde inte avanmäla");
    } finally {
      setLoadingId(null);
    }
  };

  const getCourtName = (courtId: string) => courts?.find((c) => c.id === courtId)?.name || "";

  if (!sessions?.length) {
    return (
      <p className="text-xs text-center py-4" style={{ color: "rgba(62,61,57,0.4)" }}>
        Inga kommande träningar
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {sessions.map((session: any) => {
        const sessionSignups = getSignupsForSession(session.id);
        const signed = isSignedUp(session.id);
        const isFull = session.max_participants && sessionSignups.length >= session.max_participants;

        return (
          <motion.div
            key={session.id}
            variants={item}
            className="rounded-xl p-3.5"
            style={{
              background: "rgba(255,255,255,0.6)",
              border: signed ? "1.5px solid rgba(232,108,36,0.25)" : "1px solid rgba(62,61,57,0.08)",
            }}
          >
            <div className="flex items-start justify-between mb-2">
              <div>
                <h4 className="text-sm font-semibold" style={{ color: "#3E3D39" }}>
                  {session.title}
                </h4>
                <div className="flex items-center gap-3 mt-1">
                  <span className="flex items-center gap-1 text-[11px]" style={{ color: "rgba(62,61,57,0.5)" }}>
                    <Calendar className="w-3 h-3" />
                    {format(parseISO(session.session_date), "EEE d MMM", { locale: sv })}
                  </span>
                  <span className="flex items-center gap-1 text-[11px]" style={{ color: "rgba(62,61,57,0.5)" }}>
                    <Clock className="w-3 h-3" />
                    {format(parseISO(session.start_time), "HH:mm")}–{format(parseISO(session.end_time), "HH:mm")}
                  </span>
                </div>
                {session.venue_court_id && (
                  <span className="flex items-center gap-1 text-[11px] mt-0.5" style={{ color: "rgba(62,61,57,0.4)" }}>
                    <MapPin className="w-3 h-3" />
                    {getCourtName(session.venue_court_id)}
                  </span>
                )}
              </div>
              <span
                className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
                style={{
                  background: "rgba(76,175,80,0.1)",
                  color: "#4CAF50",
                }}
              >
                Bokad
              </span>
            </div>

            {/* Signups count */}
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-[11px]" style={{ color: "rgba(62,61,57,0.5)" }}>
                <Users className="w-3 h-3" />
                {sessionSignups.length}
                {session.max_participants ? ` / ${session.max_participants}` : ""} anmälda
              </span>

              {/* Signup/cancel button */}
              {isMember && user && (
                <button
                  onClick={() => (signed ? handleCancel(session.id) : handleSignup(session.id))}
                  disabled={loadingId === session.id || (!signed && isFull)}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 flex items-center gap-1 disabled:opacity-50"
                  style={{
                    background: signed ? "rgba(62,61,57,0.06)" : "#E86C24",
                    color: signed ? "rgba(62,61,57,0.6)" : "#fff",
                    border: signed ? "1px solid rgba(62,61,57,0.1)" : "none",
                  }}
                >
                  {signed ? (
                    <>
                      <X className="w-3 h-3" /> Avanmäl
                    </>
                  ) : (
                    <>
                      <Check className="w-3 h-3" /> Anmäl dig
                    </>
                  )}
                </button>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
