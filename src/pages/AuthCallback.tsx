import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import picklaLogo from "@/assets/pickla-logo.svg";

const CREAM = "#faf8f5";
const DARK_BLUE = "#1a1f3a";
const TEXT_DARK = "#1a1a1a";
const TEXT_MUTED = "rgba(26,26,26,0.55)";
const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

export default function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const type = searchParams.get("type");
  const isSignup = type === "signup" || type === "email_change";

  useEffect(() => {
    const exchange = async () => {
      // PKCE flow: Supabase sends ?code= — must exchange for session
      const code = searchParams.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
        if (error) {
          setErrorMsg(error.message);
          setStatus("error");
          return;
        }
      }
      // Implicit flow fallback: #access_token already handled by Supabase client on load
      setStatus("success");
      setTimeout(() => navigate("/my", { replace: true }), 3000);
    };
    exchange();
  }, []);

  return (
    <div
      className="min-h-[100dvh] flex flex-col items-center justify-center px-6 text-center"
      style={{ background: CREAM, color: TEXT_DARK }}
    >
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center gap-6 max-w-xs"
      >
        <img src={picklaLogo} alt="Pickla" className="h-10 w-auto" />

        {status === "loading" && (
          <p className="text-[13px]" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
            Bekräftar…
          </p>
        )}

        {status === "error" && (
          <>
            <div className="text-5xl">❌</div>
            <div>
              <h1 className="text-[22px] font-bold" style={{ fontFamily: FONT_HEADING }}>
                Något gick fel
              </h1>
              <p className="text-[12px] mt-2" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
                {errorMsg}
              </p>
            </div>
            <button
              onClick={() => navigate("/auth", { replace: true })}
              className="px-8 py-3 rounded-2xl text-[14px] font-bold active:scale-95 transition-transform"
              style={{ background: DARK_BLUE, color: "#fff", fontFamily: FONT_MONO }}
            >
              Tillbaka →
            </button>
          </>
        )}

        {status === "success" && (
          <>
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 22 }}
              className="text-5xl"
            >
              🎯
            </motion.div>
            <div>
              <h1 className="text-[26px] font-bold tracking-tight" style={{ fontFamily: FONT_HEADING }}>
                Välkommen till Pickla!
              </h1>
              <p className="text-[13px] mt-2" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
                {isSignup ? "Din e-post är bekräftad" : "Du är inloggad"}
              </p>
            </div>
            <button
              onClick={() => navigate("/my", { replace: true })}
              className="px-8 py-3 rounded-2xl text-[14px] font-bold active:scale-95 transition-transform"
              style={{ background: DARK_BLUE, color: "#fff", fontFamily: FONT_MONO }}
            >
              Kom igång →
            </button>
          </>
        )}
      </motion.div>
    </div>
  );
}
