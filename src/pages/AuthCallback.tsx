import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import picklaLogo from "@/assets/pickla-logo.svg";

const CREAM = "#faf8f5";
const DARK_BLUE = "#1a1f3a";
const TEXT_DARK = "#1a1a1a";
const TEXT_MUTED = "rgba(26,26,26,0.55)";
const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

const REDIRECT_DELAY = 4000;

export default function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [secondsLeft, setSecondsLeft] = useState(Math.round(REDIRECT_DELAY / 1000));

  // Detect Supabase auth callback — ?type=signup or hash #access_token
  const type = searchParams.get("type");
  const hasAccessToken = window.location.hash.includes("access_token");
  const isSignup = type === "signup" || hasAccessToken;

  useEffect(() => {
    const timer = setTimeout(() => navigate("/play", { replace: true }), REDIRECT_DELAY);

    const interval = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) { clearInterval(interval); return 0; }
        return s - 1;
      });
    }, 1000);

    return () => { clearTimeout(timer); clearInterval(interval); };
  }, [navigate]);

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

        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.2, type: "spring", stiffness: 300, damping: 22 }}
          className="text-5xl"
        >
          🎯
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
        >
          <h1
            className="text-[26px] font-bold tracking-tight"
            style={{ fontFamily: FONT_HEADING, color: TEXT_DARK }}
          >
            Välkommen till Pickla!
          </h1>
          <p
            className="text-[13px] mt-2"
            style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}
          >
            {isSignup ? "Din e-post är bekräftad" : "Du är inloggad"}
          </p>
        </motion.div>

        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          onClick={() => navigate("/play", { replace: true })}
          className="mt-2 px-8 py-3 rounded-2xl text-[14px] font-bold active:scale-95 transition-transform"
          style={{ background: DARK_BLUE, color: "#fff", fontFamily: FONT_MONO }}
        >
          Kom igång →
        </motion.button>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="text-[11px]"
          style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}
        >
          Vidarebefordrar om {secondsLeft}s…
        </motion.p>
      </motion.div>
    </div>
  );
}
