import { useState } from "react";
import { motion } from "framer-motion";
import { Calendar, Ticket, LogOut, Loader2, Check, Pencil, Save, Phone } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import picklaLogo from "@/assets/pickla-logo.svg";

const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

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

function useMyBookings() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-bookings", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("*, venue_courts(name)")
        .eq("user_id", user!.id)
        .order("start_time", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });
}

function useMyDayPasses() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-day-passes", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("day_passes")
        .select("*")
        .eq("user_id", user!.id)
        .order("valid_date", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });
}

function useActiveMembership() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-membership", user?.id],
    enabled: !!user,
    staleTime: 30000,
    queryFn: async () => {
      const { data } = await supabase
        .from("memberships")
        .select("id, tier_id, status, starts_at, expires_at, membership_tiers(name, color, description)")
        .eq("user_id", user!.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      return data;
    },
  });
}

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08 } } };
const item = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } };

const MyPage = () => {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const venueSlug = searchParams.get("v") || "pickla-arena-sthlm";

  const { data: profile } = usePlayerProfile();
  const { data: bookings } = useMyBookings();
  const { data: dayPasses } = useMyDayPasses();
  const { data: activeMembership } = useActiveMembership();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#1a1e2e" }}>
        <Loader2 className="w-6 h-6 animate-spin text-white" />
      </div>
    );
  }

  if (!user) return <Navigate to={`/auth?redirect=/my&v=${venueSlug}`} replace />;

  const displayName = profile?.display_name || user.email?.split("@")[0] || "Spelare";
  const activeBookings = bookings?.filter((b) => b.status === "confirmed" || b.status === "pending") || [];
  const activePasses = dayPasses?.filter((p) => p.status === "active") || [];
  const membershipTier = (activeMembership as any)?.membership_tiers;

  return (
    <div className="min-h-screen" style={{ background: "#1a1e2e" }}>
      {/* ═══ STICKY TOP: Logo ═══ */}
      <header
        className="fixed top-0 left-0 right-0 z-40 px-5 pt-[env(safe-area-inset-top,12px)] pb-3 flex items-end justify-between"
        style={{
          background: "linear-gradient(to bottom, rgba(26,30,46,0.8) 0%, rgba(26,30,46,0.4) 50%, transparent 100%)",
        }}
      >
        <div className="pt-2">
          <img
            src={picklaLogo}
            alt="Pickla"
            className="h-14 w-auto"
            style={{ filter: "brightness(0) invert(1)" }}
          />
        </div>
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={async () => {
            await signOut();
            navigate(`/?v=${venueSlug}`);
          }}
          className="w-9 h-9 rounded-xl flex items-center justify-center mb-1"
          style={{ background: "rgba(255,255,255,0.1)" }}
        >
          <LogOut className="w-4 h-4 text-white/70" />
        </motion.button>
      </header>

      {/* ═══ MAIN CONTENT ═══ */}
      <main className="pt-28 px-5 pb-28">
        <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col gap-4 max-w-md mx-auto">
          {/* Profile card with edit */}
          <ProfileCard
            profile={profile}
            user={user}
            displayName={displayName}
          />

          {/* Membership */}
          {activeMembership ? (
            <motion.div
              variants={item}
              className="rounded-2xl p-5"
              style={{
                background: membershipTier?.color
                  ? `${membershipTier.color}22`
                  : "rgba(76,175,80,0.08)",
                border: `1.5px solid ${membershipTier?.color || "rgba(76,175,80,0.2)"}44`,
              }}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: `${membershipTier?.color || "#4CAF50"}33` }}>
                  <Check className="w-5 h-5" style={{ color: membershipTier?.color || "#4CAF50" }} />
                </div>
                <div>
                  <p className="text-sm font-bold text-white" style={{ fontFamily: FONT_HEADING }}>
                    {membershipTier?.name || "Medlem"}
                  </p>
                  <p className="text-[11px] text-white/40" style={{ fontFamily: FONT_MONO }}>
                    {membershipTier?.description || "Aktivt medlemskap"}
                  </p>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.button
              variants={item}
              onClick={() => navigate("/play")}
              className="rounded-2xl p-4 text-left active:scale-[0.98] transition-transform"
              style={{
                background: "rgba(232,108,36,0.1)",
                border: "1.5px solid rgba(232,108,36,0.2)",
              }}
            >
              <p className="text-sm font-bold text-white" style={{ fontFamily: FONT_HEADING }}>
                Bli medlem
              </p>
              <p className="text-[11px] text-white/40" style={{ fontFamily: FONT_MONO }}>
                Se medlemskap och priser →
              </p>
            </motion.button>
          )}

          {/* Active bookings */}
          <motion.div variants={item}>
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-4 h-4" style={{ color: "#E86C24" }} />
              <span className="text-sm font-semibold text-white" style={{ fontFamily: FONT_HEADING }}>Mina bokningar</span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: "rgba(232,108,36,0.15)", color: "#E86C24" }}>{activeBookings.length}</span>
            </div>
            {activeBookings.length === 0 ? (
              <div className="rounded-2xl p-4 text-center" style={{ background: "rgba(255,255,255,0.04)", border: "1.5px solid rgba(255,255,255,0.06)" }}>
                <p className="text-xs text-white/30">Inga aktiva bokningar</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {activeBookings.slice(0, 5).map((b) => (
                  <div key={b.id} className="rounded-xl p-3 flex items-center justify-between" style={{ background: "rgba(255,255,255,0.04)", border: "1.5px solid rgba(255,255,255,0.06)" }}>
                    <div>
                      <p className="text-sm font-medium text-white">{(b as any).venue_courts?.name || "Bana"}</p>
                      <p className="text-xs text-white/40">
                        {new Date(b.start_time).toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" })}
                        {" "}
                        {new Date(b.start_time).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}–{new Date(b.end_time).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: b.status === "confirmed" ? "rgba(76,175,80,0.15)" : "rgba(232,108,36,0.15)", color: b.status === "confirmed" ? "#4CAF50" : "#E86C24" }}>
                      {b.status === "confirmed" ? "Bekräftad" : "Väntande"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </motion.div>

          {/* Day passes */}
          <motion.div variants={item}>
            <div className="flex items-center gap-2 mb-2">
              <Ticket className="w-4 h-4" style={{ color: "#E86C24" }} />
              <span className="text-sm font-semibold text-white" style={{ fontFamily: FONT_HEADING }}>Mina dagspass</span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: "rgba(232,108,36,0.15)", color: "#E86C24" }}>{activePasses.length}</span>
            </div>
            {activePasses.length === 0 ? (
              <div className="rounded-2xl p-4 text-center" style={{ background: "rgba(255,255,255,0.04)", border: "1.5px solid rgba(255,255,255,0.06)" }}>
                <p className="text-xs text-white/30">Inga aktiva dagspass</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {activePasses.map((p) => (
                  <div key={p.id} className="rounded-xl p-3 flex items-center justify-between" style={{ background: "rgba(255,255,255,0.04)", border: "1.5px solid rgba(255,255,255,0.06)" }}>
                    <div>
                      <p className="text-sm font-medium text-white">Dagspass</p>
                      <p className="text-xs text-white/40">
                        {new Date(p.valid_date).toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" })}
                      </p>
                    </div>
                    <span className="text-sm font-bold text-white">{p.price || 0} SEK</span>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </motion.div>
      </main>

      {/* ═══ FIXED BOTTOM NAV — same as LinkHub ═══ */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-between px-6 pb-8 pt-12"
        style={{
          background: "linear-gradient(to top, rgba(26,30,46,0.95) 0%, rgba(26,30,46,0.7) 40%, rgba(26,30,46,0.3) 70%, transparent 100%)",
        }}
      >
        <a
          href="https://chat.whatsapp.com/HL1XcYaNFSuE56q7MqCpdw"
          target="_blank"
          rel="noopener noreferrer"
          className="text-white/90 text-[13px] font-bold underline underline-offset-4 decoration-white/25 active:opacity-60 transition-opacity"
          style={{ fontFamily: FONT_MONO }}
        >
          chat
        </a>
        <button
          onClick={() => navigate("/play")}
          className="text-white/90 text-[13px] font-bold underline underline-offset-4 decoration-white/25 active:opacity-60 transition-opacity"
          style={{ fontFamily: FONT_MONO }}
        >
          play
        </button>
        <span
          className="text-white text-[13px] font-bold underline underline-offset-4 decoration-white/60"
          style={{ fontFamily: FONT_MONO }}
        >
          me
        </span>
      </nav>
    </div>
  );
};

export default MyPage;
