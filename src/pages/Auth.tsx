import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LogIn, UserPlus, Loader2, Mail, Lock, User } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Navigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import picklaLogo from "@/assets/pickla-logo.svg";

const Auth = () => {
  const { user, loading, signIn, signUp } = useAuth();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/";
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
      </div>
    );
  }

  const venueParam = searchParams.get("v");
  const fullRedirect = venueParam && !redirectTo.includes("v=") ? `${redirectTo}${redirectTo.includes("?") ? "&" : "?"}v=${venueParam}` : redirectTo;
  if (user) return <Navigate to={fullRedirect} replace />;

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

  const isDesk = !redirectTo.startsWith("/my");

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6">
      {/* Subtle gradient overlay */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse at 50% 0%, hsl(var(--primary) / 0.06) 0%, transparent 60%)",
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-[340px] space-y-8 relative z-10"
      >
        {/* Logo */}
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
            <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              {isDesk ? "Pickla Desk" : "Pickla"}
            </h1>
            <p className="text-xs text-muted-foreground mt-1" style={{ fontFamily: "'Space Mono', monospace" }}>
              {mode === "login"
                ? isDesk ? "STAFF LOGIN" : "LOGGA IN"
                : "SKAPA KONTO"}
            </p>
          </div>
        </div>

        {/* Mode Switcher */}
        <div className="glass-card rounded-xl p-1 flex">
          {(["login", "signup"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="flex-1 relative py-2.5 rounded-lg text-xs font-semibold transition-all"
              style={{
                fontFamily: "'Space Mono', monospace",
                color: mode === m ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))",
                background: mode === m ? "hsl(var(--primary))" : "transparent",
              }}
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
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Ditt namn"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full glass-card rounded-xl py-3.5 pl-11 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                  required
                />
              </div>
            )}

            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="email"
                placeholder="E-post"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full glass-card rounded-xl py-3.5 pl-11 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                required
              />
            </div>

            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="password"
                placeholder="Lösenord"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full glass-card rounded-xl py-3.5 pl-11 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                required
                minLength={6}
              />
            </div>

            <motion.button
              type="submit"
              disabled={submitting}
              whileTap={{ scale: 0.97 }}
              className="w-full bg-primary text-primary-foreground rounded-xl py-4 font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50 mt-2 transition-all active:scale-[0.97]"
              style={{ fontFamily: "'Space Mono', monospace" }}
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
            </motion.button>
          </motion.form>
        </AnimatePresence>

        {/* Footer */}
        <p className="text-center text-[10px] text-muted-foreground" style={{ fontFamily: "'Space Mono', monospace" }}>
          PICKLA © 2025
        </p>
      </motion.div>
    </div>
  );
};

export default Auth;
