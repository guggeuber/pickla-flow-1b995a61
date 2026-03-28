import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useParams, useNavigate } from "react-router-dom";
import { Loader2, Gift, Mail, Lock, User } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { apiGet, apiPost } from "@/lib/api";
import { toast } from "sonner";
import picklaLogo from "@/assets/pickla-logo.svg";

const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

const PENDING_CLAIM_KEY = "pickla_pending_claim_token";

export const getPendingClaimToken = () => localStorage.getItem(PENDING_CLAIM_KEY);
export const clearPendingClaimToken = () => localStorage.removeItem(PENDING_CLAIM_KEY);

const ClaimPassPage = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading, signUp, signIn } = useAuth();
  const [claiming, setClaiming] = useState(false);
  const [mode, setMode] = useState<"register" | "login">("register");
  const [formData, setFormData] = useState({ name: "", email: "", password: "" });

  // Persist token so claim survives navigation away
  useEffect(() => {
    if (token) localStorage.setItem(PENDING_CLAIM_KEY, token);
  }, [token]);

  const { data: shareInfo, isLoading } = useQuery({
    queryKey: ["share-info", token],
    enabled: !!token,
    queryFn: () => apiGet("api-day-passes", "share-info", { token: token! }),
  });

  const handleClaim = async () => {
    if (!token) return;
    setClaiming(true);
    try {
      await apiPost("api-day-passes", "claim", { token });
      toast.success("Dagspass hämtat! Du hittar det under Mitt konto.");
      navigate("/my");
    } catch (err: any) {
      toast.error(err.message || "Kunde inte hämta passet");
    }
    setClaiming(false);
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setClaiming(true);
    try {
      if (mode === "register") {
        const { error } = await signUp(formData.email, formData.password, formData.name);
        if (error) { toast.error(error.message); setClaiming(false); return; }
        toast.success("Konto skapat! Kolla din e-post för verifiering, logga sedan in för att hämta ditt pass.");
        setMode("login");
      } else {
        const { error } = await signIn(formData.email, formData.password);
        if (error) { toast.error(error.message); setClaiming(false); return; }
        // After login, claim will happen via useEffect
      }
    } catch {
      toast.error("Något gick fel");
    }
    setClaiming(false);
  };

  // Auto-claim when user becomes authenticated
  useEffect(() => {
    if (user && shareInfo?.status === "pending" && !claiming) {
      handleClaim();
    }
  }, [user, shareInfo]);

  if (isLoading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#1a1e2e" }}>
        <Loader2 className="w-6 h-6 animate-spin text-white" />
      </div>
    );
  }

  if (!shareInfo || shareInfo.status === "claimed") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ background: "#1a1e2e" }}>
        <img src={picklaLogo} alt="Pickla" className="h-12 mb-6" style={{ filter: "brightness(0) invert(1)" }} />
        <p className="text-white/60 text-sm text-center" style={{ fontFamily: FONT_MONO }}>
          {shareInfo?.status === "claimed" ? "Det här passet har redan hämtats." : "Passet hittades inte."}
        </p>
        <button onClick={() => navigate("/my")} className="mt-4 text-sm underline" style={{ color: "#E86C24", fontFamily: FONT_MONO }}>
          Gå till mitt konto
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "#1a1e2e" }}>
      <div className="px-6 pt-12 pb-20 max-w-md mx-auto flex flex-col items-center">
        <img src={picklaLogo} alt="Pickla" className="h-12 mb-8" style={{ filter: "brightness(0) invert(1)" }} />

        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-full rounded-2xl p-6 text-center"
          style={{ background: "rgba(232,108,36,0.1)", border: "2px solid rgba(232,108,36,0.2)" }}
        >
          <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: "rgba(232,108,36,0.2)" }}>
            <Gift className="w-8 h-8" style={{ color: "#E86C24" }} />
          </div>
          <h1 className="text-xl font-black text-white mb-2" style={{ fontFamily: FONT_HEADING }}>
            Du har fått ett dagspass!
          </h1>
          <p className="text-sm text-white/50 mb-1" style={{ fontFamily: FONT_MONO }}>
            Från {shareInfo.sharer_name}
          </p>
          <p className="text-xs text-white/30" style={{ fontFamily: FONT_MONO }}>
            Giltigt: {new Date(shareInfo.day_passes?.valid_date).toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </motion.div>

        {user ? (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full mt-6">
            <button
              onClick={handleClaim}
              disabled={claiming}
              className="w-full py-4 rounded-2xl text-white text-sm font-black uppercase tracking-wider active:scale-[0.98] transition-transform disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: "#E86C24", fontFamily: FONT_MONO }}
            >
              {claiming ? <Loader2 className="w-4 h-4 animate-spin" /> : "HÄMTA DITT PASS"}
            </button>
          </motion.div>
        ) : (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full mt-6">
            <p className="text-sm text-white/50 text-center mb-4" style={{ fontFamily: FONT_MONO }}>
              {mode === "register" ? "Skapa konto för att hämta ditt pass" : "Logga in för att hämta ditt pass"}
            </p>
            <form onSubmit={handleAuth} className="space-y-3">
              {mode === "register" && (
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/25" />
                  <input
                    type="text"
                    placeholder="Ditt namn"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-3.5 pl-11 rounded-2xl bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-white/30"
                    style={{ fontFamily: FONT_MONO }}
                    required
                  />
                </div>
              )}
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/25" />
                <input
                  type="email"
                  placeholder="E-post"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-4 py-3.5 pl-11 rounded-2xl bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-white/30"
                  style={{ fontFamily: FONT_MONO }}
                  required
                />
              </div>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/25" />
                <input
                  type="password"
                  placeholder="Lösenord (min 6 tecken)"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-4 py-3.5 pl-11 rounded-2xl bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-white/30"
                  style={{ fontFamily: FONT_MONO }}
                  required
                  minLength={6}
                />
              </div>
              <button
                type="submit"
                disabled={claiming}
                className="w-full py-4 rounded-2xl text-white text-sm font-black uppercase tracking-wider active:scale-[0.98] transition-transform disabled:opacity-40 flex items-center justify-center gap-2"
                style={{ background: "#E86C24", fontFamily: FONT_MONO }}
              >
                {claiming ? <Loader2 className="w-4 h-4 animate-spin" /> : mode === "register" ? "SKAPA KONTO" : "LOGGA IN"}
              </button>
            </form>
            <button
              onClick={() => setMode(mode === "register" ? "login" : "register")}
              className="w-full mt-3 text-xs text-center underline text-white/40"
              style={{ fontFamily: FONT_MONO }}
            >
              {mode === "register" ? "Har du redan konto? Logga in" : "Inget konto? Registrera dig"}
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default ClaimPassPage;
