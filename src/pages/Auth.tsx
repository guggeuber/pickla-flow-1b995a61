import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LogIn, UserPlus, Loader2, Mail, Lock, User, ArrowLeft } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PicklaTopBar } from "@/components/PicklaTopBar";
import {
  consumePreservedIntendedRoute,
  getPreservedIntendedRoute,
  markFirstRunWelcome,
  preserveIntendedRoute,
  resolveEntryDestination,
  safeLocalPath,
} from "@/lib/entryResolver";

const FONT_GROTESK = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

const Auth = () => {
  const { user, loading, signIn, signUp } = useAuth();
  const [searchParams] = useSearchParams();
  const redirectTo = safeLocalPath(searchParams.get("redirect"));
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-neutral-300" />
      </div>
    );
  }

  const venueParam = searchParams.get("v");
  const fullRedirect = venueParam && redirectTo && !redirectTo.includes("v=")
    ? `${redirectTo}${redirectTo.includes("?") ? "&" : "?"}v=${venueParam}`
    : redirectTo;

  if (user) {
    const intended = consumePreservedIntendedRoute() || fullRedirect;
    return <Navigate to={resolveEntryDestination({ intendedRoute: intended, venueSlug: venueParam })} replace />;
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
        if (!getPreservedIntendedRoute() && !fullRedirect) markFirstRunWelcome();
        if (fullRedirect) preserveIntendedRoute(fullRedirect);
        toast.success("Konto skapat! Kolla din e-post för att verifiera.");
        setMode("login");
      }
    }
    setSubmitting(false);
  };

  const isDesk = redirectTo.startsWith("/desk") || redirectTo.startsWith("/hub");

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset`,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
    } else {
      setResetSent(true);
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 pt-[calc(env(safe-area-inset-top,0px)+84px)]">
      <PicklaTopBar slug={venueParam || "pickla-arena-sthlm"} showVenue={false} background="#ffffff" />
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-[340px] space-y-8"
      >
        {/* Logo + heading */}
        <div className="text-center space-y-3">
          <div>
            <h1
              className="text-[28px] font-bold text-neutral-900 tracking-tight"
              style={{ fontFamily: FONT_GROTESK }}
            >
              {mode === "forgot" ? "Återställ lösenord" : mode === "signup" ? "Skapa konto" : isDesk ? "Desk login" : "Logga in"}
            </h1>
            <p
              className="text-[11px] text-neutral-400 mt-1 uppercase tracking-widest"
              style={{ fontFamily: FONT_MONO }}
            >
              {isDesk ? "PICKLA STAFF" : "PICKLA KONTO"}
            </p>
          </div>
        </div>

        {/* Mode Switcher */}
        {mode !== "forgot" && <div className="bg-neutral-50 rounded-2xl p-1 flex">
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
        </div>}

        {/* Form */}
        {mode !== "forgot" && <AnimatePresence mode="wait">
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

            {mode === "login" && (
              <button
                type="button"
                onClick={() => { setMode("forgot"); setResetSent(false); }}
                className="text-[11px] text-neutral-400 hover:text-neutral-600 transition-colors text-left"
                style={{ fontFamily: FONT_MONO }}
              >
                Glömt lösenord?
              </button>
            )}

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
            {mode === "signup" && (
              <p
                className="px-2 text-center text-[10px] leading-relaxed text-neutral-400"
                style={{ fontFamily: FONT_MONO }}
              >
                Genom att skapa konto godkänner du Picklas{" "}
                <Link to="/terms" className="underline underline-offset-2 hover:text-neutral-600">
                  villkor
                </Link>{" "}
                och{" "}
                <Link to="/privacy" className="underline underline-offset-2 hover:text-neutral-600">
                  integritetspolicy
                </Link>
                .
              </p>
            )}
          </motion.form>
        </AnimatePresence>}

        {/* Forgot password view */}
        <AnimatePresence>
          {mode === "forgot" && (
            <motion.div
              key="forgot"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25 }}
              className="space-y-4"
            >
              {resetSent ? (
                <p className="text-[13px] text-neutral-600 text-center leading-relaxed" style={{ fontFamily: FONT_MONO }}>
                  Kolla din mejl — vi har skickat en återställningslänk
                </p>
              ) : (
                <form onSubmit={handleForgot} className="space-y-3">
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
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-3.5 rounded-2xl bg-neutral-900 text-white text-[13px] font-bold uppercase tracking-wider active:scale-[0.98] transition-transform disabled:opacity-40 flex items-center justify-center gap-2"
                    style={{ fontFamily: FONT_MONO }}
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Skicka återställningslänk"}
                  </button>
                </form>
              )}
              <button
                type="button"
                onClick={() => setMode("login")}
                className="flex items-center gap-1.5 text-[11px] text-neutral-400 hover:text-neutral-600 transition-colors mx-auto"
                style={{ fontFamily: FONT_MONO }}
              >
                <ArrowLeft className="w-3 h-3" /> Tillbaka
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        <p
          className="text-center text-[10px] text-neutral-300 uppercase tracking-widest"
          style={{ fontFamily: FONT_MONO }}
        >
          PICKLA © 2025
          <span className="mx-2">·</span>
          <Link to="/privacy" className="hover:text-neutral-500">INTEGRITET</Link>
        </p>
      </motion.div>
    </div>
  );
};

export default Auth;
