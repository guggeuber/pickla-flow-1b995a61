import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LogIn, UserPlus, Loader2, Mail, Lock, User } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Navigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import picklaLogo from "@/assets/pickla-logo.svg";

const FONT_GROTESK = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

const REDIRECT_KEY = "pickla_auth_redirect";

const Auth = () => {
  const { user, loading, signIn, signUp } = useAuth();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/my";
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-neutral-300" />
      </div>
    );
  }

  const venueParam = searchParams.get("v");
  const fullRedirect = venueParam && !redirectTo.includes("v=") ? `${redirectTo}${redirectTo.includes("?") ? "&" : "?"}v=${venueParam}` : redirectTo;

  if (user) {
    // sessionStorage takes priority (set by ProtectedRoute), then ?redirect param, then /my
    const intended = sessionStorage.getItem(REDIRECT_KEY);
    if (intended) sessionStorage.removeItem(REDIRECT_KEY);
    return <Navigate to={intended || fullRedirect} replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    if (mode === "login") {
      const { error } = await signIn(email, password);
      if (error) toast.error(error.message);
    } else {
      if (!displayName.trim()) {
        toast.error("Ange ditt namn");
        setSubmitting(false);
        return;
      }
      const { error } = await signUp(email, password, displayName);
      if (error) {
        toast.error(error.message);
      } else {
        toast.success("Konto skapat! Kolla din e-post för att verifiera.");
        setMode("login");
      }
    }
    setSubmitting(false);
  };

  const isDesk = redirectTo.startsWith("/desk") || redirectTo.startsWith("/hub");

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-[340px] space-y-8"
      >
        {/* Logo + heading */}
        <div className="text-center space-y-3">
          <motion.img
            src={picklaLogo}
            alt="Pickla"
            className="w-10 h-10 mx-auto"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.4 }}
          />
          <div>
            <h1
              className="text-[28px] font-bold text-neutral-900 tracking-tight"
              style={{ fontFamily: FONT_GROTESK }}
            >
              {isDesk ? "Pickla Desk" : "Pickla"}
            </h1>
            <p
              className="text-[11px] text-neutral-400 mt-1 uppercase tracking-widest"
              style={{ fontFamily: FONT_MONO }}
            >
              {mode === "login"
                ? isDesk ? "STAFF LOGIN" : "LOGGA IN"
                : "SKAPA KONTO"}
            </p>
          </div>
        </div>

        {/* Mode Switcher */}
        <div className="bg-neutral-50 rounded-2xl p-1 flex">
          {(["login", "signup"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all ${
                mode === m
                  ? "bg-neutral-900 text-white"
                  : "text-neutral-400"
              }`}
              style={{ fontFamily: FONT_MONO }}
            >
              {m === "login" ? "LOGGA IN" : "REGISTRERA"}
            </button>
          ))}
        </div>

        {/* Form */}
        <AnimatePresence mode="wait">
          <motion.form
            key={mode}
            initial={{ opacity: 0, x: mode === "login" ? -16 : 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: mode === "login" ? 16 : -16 }}
            transition={{ duration: 0.25 }}
            onSubmit={handleSubmit}
            className="space-y-3"
          >
            {mode === "signup" && (
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-300" />
                <input
                  type="text"
                  placeholder="ditt namn"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-4 py-3.5 pl-11 rounded-2xl bg-neutral-50 border border-neutral-200 text-neutral-900 text-[14px] placeholder:text-neutral-300 focus:outline-none focus:border-neutral-400 transition-colors"
                  style={{ fontFamily: FONT_MONO }}
                  required
                />
              </div>
            )}

            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-300" />
              <input
                type="email"
                placeholder="e-post"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3.5 pl-11 rounded-2xl bg-neutral-50 border border-neutral-200 text-neutral-900 text-[14px] placeholder:text-neutral-300 focus:outline-none focus:border-neutral-400 transition-colors"
                style={{ fontFamily: FONT_MONO }}
                required
              />
            </div>

            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-300" />
              <input
                type="password"
                placeholder="lösenord"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3.5 pl-11 rounded-2xl bg-neutral-50 border border-neutral-200 text-neutral-900 text-[14px] placeholder:text-neutral-300 focus:outline-none focus:border-neutral-400 transition-colors"
                style={{ fontFamily: FONT_MONO }}
                required
                minLength={6}
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3.5 rounded-2xl bg-neutral-900 text-white text-[13px] font-bold uppercase tracking-wider active:scale-[0.98] transition-transform disabled:opacity-40 flex items-center justify-center gap-2 mt-2"
              style={{ fontFamily: FONT_MONO }}
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : mode === "login" ? (
                <>
                  <LogIn className="w-4 h-4" /> LOGGA IN
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" /> SKAPA KONTO
                </>
              )}
            </button>
          </motion.form>
        </AnimatePresence>

        {/* Footer */}
        <p
          className="text-center text-[10px] text-neutral-300 uppercase tracking-widest"
          style={{ fontFamily: FONT_MONO }}
        >
          PICKLA © 2025
        </p>
      </motion.div>
    </div>
  );
};

export default Auth;
