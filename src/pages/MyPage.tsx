import { motion } from "framer-motion";
import { User, Calendar, Ticket, LogOut, ArrowLeft, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08 } } };
const item = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } };

const MyPage = () => {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const venueSlug = searchParams.get("v") || "pickla-arena-sthlm";

  const { data: profile, isLoading: profileLoading } = usePlayerProfile();
  const { data: bookings } = useMyBookings();
  const { data: dayPasses } = useMyDayPasses();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to={`/auth?redirect=/my&v=${venueSlug}`} replace />;

  const displayName = profile?.display_name || user.email?.split("@")[0] || "Spelare";
  const activeBookings = bookings?.filter((b) => b.status === "confirmed" || b.status === "pending") || [];
  const activePasses = dayPasses?.filter((p) => p.status === "active") || [];

  return (
    <div className="min-h-screen bg-background flex flex-col items-center px-4 pt-6 pb-12">
      {/* Header */}
      <div className="w-full max-w-sm flex items-center justify-between mb-6">
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => navigate(`/links?v=${venueSlug}`)}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          style={{ background: "hsl(var(--surface-1))" }}
        >
          <ArrowLeft className="w-4 h-4" />
        </motion.button>
        <h1 className="text-lg font-bold tracking-tight text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          Mitt konto
        </h1>
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={async () => {
            await signOut();
            navigate(`/links?v=${venueSlug}`);
          }}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          style={{ background: "hsl(var(--surface-1))" }}
        >
          <LogOut className="w-4 h-4" />
        </motion.button>
      </div>

      <motion.div variants={container} initial="hidden" animate="show" className="w-full max-w-sm flex flex-col gap-4">
        {/* Profile card */}
        <motion.div
          variants={item}
          className="rounded-2xl p-5"
          style={{ background: "hsl(var(--surface-1))", border: "1px solid hsl(var(--border))" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--sell)))" }}
            >
              <span className="text-lg font-bold text-primary-foreground">
                {displayName.charAt(0).toUpperCase()}
              </span>
            </div>
            <div>
              <p className="text-foreground font-semibold">{displayName}</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
            </div>
          </div>
          {profile && (
            <div className="flex gap-4 mt-4 pt-3" style={{ borderTop: "1px solid hsl(var(--border))" }}>
              <div className="text-center flex-1">
                <p className="text-lg font-bold text-foreground">{profile.total_matches || 0}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Matcher</p>
              </div>
              <div className="text-center flex-1">
                <p className="text-lg font-bold text-foreground">{profile.total_wins || 0}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Vinster</p>
              </div>
              <div className="text-center flex-1">
                <p className="text-lg font-bold text-primary">{profile.pickla_rating || 1000}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Rating</p>
              </div>
            </div>
          )}
        </motion.div>

        {/* Active bookings */}
        <motion.div variants={item}>
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Mina bokningar</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-primary/15 text-primary">{activeBookings.length}</span>
          </div>
          {activeBookings.length === 0 ? (
            <div
              className="rounded-2xl p-4 text-center"
              style={{ background: "hsl(var(--surface-1))", border: "1px solid hsl(var(--border))" }}
            >
              <p className="text-xs text-muted-foreground">Inga aktiva bokningar</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {activeBookings.slice(0, 5).map((b) => (
                <div
                  key={b.id}
                  className="rounded-xl p-3 flex items-center justify-between"
                  style={{ background: "hsl(var(--surface-1))", border: "1px solid hsl(var(--border))" }}
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {(b as any).venue_courts?.name || "Bana"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(b.start_time).toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" })}
                      {" "}
                      {new Date(b.start_time).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}
                      –
                      {new Date(b.end_time).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <span
                    className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                    style={{
                      background: b.status === "confirmed" ? "hsl(var(--success) / 0.15)" : "hsl(var(--sell) / 0.15)",
                      color: b.status === "confirmed" ? "hsl(var(--success))" : "hsl(var(--sell))",
                    }}
                  >
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
            <Ticket className="w-4 h-4 text-sell" />
            <span className="text-sm font-semibold text-foreground">Mina dagspass</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-sell/15 text-sell">{activePasses.length}</span>
          </div>
          {activePasses.length === 0 ? (
            <div
              className="rounded-2xl p-4 text-center"
              style={{ background: "hsl(var(--surface-1))", border: "1px solid hsl(var(--border))" }}
            >
              <p className="text-xs text-muted-foreground">Inga aktiva dagspass</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {activePasses.map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl p-3 flex items-center justify-between"
                  style={{ background: "hsl(var(--surface-1))", border: "1px solid hsl(var(--border))" }}
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">Dagspass</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(p.valid_date).toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" })}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-foreground">{p.price || 0} SEK</span>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </motion.div>
    </div>
  );
};

export default MyPage;
