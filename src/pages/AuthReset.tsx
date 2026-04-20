import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Lock, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import picklaLogo from "@/assets/pickla-logo.svg";

const FONT_MONO = "'Space Mono', monospace";
const FONT_GROTESK = "'Space Grotesk', sans-serif";

const AuthReset = () => {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    return () => subscription.unsubscribe();
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
      navigate("/my");
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

        {!ready ? (
          <p className="text-center text-[13px] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
            Väntar på återställningslänk…
          </p>
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
