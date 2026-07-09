import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Lock, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import picklaLogo from "@/assets/pickla-logo.svg";
import { consumePreservedIntendedRoute, resolveEntryDestination } from "@/lib/entryResolver";

const FONT_MONO = "'Space Mono', monospace";
const FONT_GROTESK = "'Space Grotesk', sans-serif";

function urlParam(searchParams: URLSearchParams, hashParams: URLSearchParams, key: string) {
  return searchParams.get(key) || hashParams.get(key);
}

const AuthReset = () => {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [checkingLink, setCheckingLink] = useState(true);
  const [linkError, setLinkError] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let resolved = false;

    const markReady = () => {
      resolved = true;
      if (cancelled) return;
      setReady(true);
      setCheckingLink(false);
      setLinkError("");
      window.history.replaceState(null, "", "/auth/reset");
    };

    const failLink = (message: string) => {
      resolved = true;
      if (cancelled) return;
      setReady(false);
      setCheckingLink(false);
      setLinkError(message);
    };

    const recoverSession = async () => {
      const searchParams = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const authError = urlParam(searchParams, hashParams, "error_description")
        || urlParam(searchParams, hashParams, "error");

      if (authError) {
        failLink(authError);
        return;
      }

      const code = urlParam(searchParams, hashParams, "code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
        if (error) {
          failLink(error.message);
          return;
        }
        markReady();
        return;
      }

      const tokenHash = urlParam(searchParams, hashParams, "token_hash");
      if (tokenHash) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: "recovery",
        });
        if (error) {
          failLink(error.message);
          return;
        }
        markReady();
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        markReady();
        return;
      }

      if (!cancelled && !resolved) {
        setCheckingLink(false);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session) markReady();
    });

    recoverSession().catch((error) => {
      failLink(error instanceof Error ? error.message : "Länken kunde inte öppnas.");
    });

    const timeout = window.setTimeout(async () => {
      if (cancelled || resolved) return;
      const { data: { session } } = await supabase.auth.getSession();
      if (session) markReady();
      else setCheckingLink(false);
    }, 2500);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Lösenorden matchar inte");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Lösenordet uppdaterat!");
      navigate(resolveEntryDestination({ intendedRoute: consumePreservedIntendedRoute() }));
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-[340px] space-y-8"
      >
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
            <h1 className="text-[28px] font-bold text-neutral-900 tracking-tight" style={{ fontFamily: FONT_GROTESK }}>
              Pickla
            </h1>
            <p className="text-[11px] text-neutral-400 mt-1 uppercase tracking-widest" style={{ fontFamily: FONT_MONO }}>
              NYTT LÖSENORD
            </p>
          </div>
        </div>

        {checkingLink ? (
          <p className="text-center text-[13px] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
            Väntar på återställningslänk…
          </p>
        ) : !ready ? (
          <div className="space-y-4 text-center">
            <div>
              <h2 className="text-[18px] font-bold text-neutral-900" style={{ fontFamily: FONT_GROTESK }}>
                Länken kunde inte öppnas
              </h2>
              <p className="text-[12px] text-neutral-500 mt-2 leading-relaxed" style={{ fontFamily: FONT_MONO }}>
                {linkError || "Be om en ny återställningslänk och öppna den i samma webbläsare."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate("/auth", { replace: true })}
              className="w-full py-3.5 rounded-2xl bg-neutral-900 text-white text-[13px] font-bold uppercase tracking-wider active:scale-[0.98] transition-transform"
              style={{ fontFamily: FONT_MONO }}
            >
              Skicka ny länk
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-300" />
              <input
                type="password"
                placeholder="nytt lösenord"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3.5 pl-11 rounded-2xl bg-neutral-50 border border-neutral-200 text-neutral-900 text-[14px] placeholder:text-neutral-300 focus:outline-none focus:border-neutral-400 transition-colors"
                style={{ fontFamily: FONT_MONO }}
                required
                minLength={6}
              />
            </div>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-300" />
              <input
                type="password"
                placeholder="bekräfta lösenord"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
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
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Spara nytt lösenord"}
            </button>
          </form>
        )}
      </motion.div>
    </div>
  );
};

export default AuthReset;
