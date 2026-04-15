import { useNavigate, Navigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import picklaLogo from "@/assets/pickla-logo.svg";
import { ArrowRight } from "lucide-react";

const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

const CREAM = "#faf8f5";
const DARK_BLUE = "#1a1f3a";
const PINK = "#e8b4b8";
const TEXT_DARK = "#1a1a1a";
const TEXT_MUTED = "rgba(26,26,26,0.55)";

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.1 } } };
const item = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 28 } } };

const cards = [
  {
    title: "Boka bana",
    sub: "Välj din tid och bana · från 295 kr/h",
    cta: "Boka nu →",
    to: "/book",
  },
  {
    title: "Open Play",
    sub: "Hoppa in och spela med andra · 165 kr",
    sub2: "Fredagsklubben after work · 99 kr",
    cta: "Köp dagspass →",
    to: "/openplay",
  },
  {
    title: "Bli medlem",
    sub: "Spelrätter från 99 kr/mån · Obegränsat spel och förmåner",
    cta: "Se medlemskap →",
    to: "/membership",
  },
  {
    title: "Aktiviteter",
    sub: "Tisdagsstegen, turneringar och community-events",
    cta: "Se vad som händer →",
    to: "/events",
  },
];

const PlayPage = () => {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  // Redirect authenticated users to /my
  if (!loading && user) {
    return <Navigate to="/my" replace />;
  }

  if (loading) return null;

  return (
    <div
      className="min-h-[100dvh] flex flex-col items-center px-5"
      style={{ background: CREAM, color: TEXT_DARK, paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {/* Logo */}
      <div className="pt-10 pb-6">
        <img src={picklaLogo} alt="Pickla" className="h-8 w-auto" />
      </div>

      {/* Cards */}
      <motion.div variants={container} initial="hidden" animate="show" className="w-full max-w-md flex flex-col gap-3 pb-8">
        {cards.map((c) => (
          <motion.div
            key={c.title}
            variants={item}
            className="rounded-2xl p-5"
            style={{
              background: "#FFFFFF",
              boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
            }}
          >
            <h2 className="text-[17px] font-bold tracking-tight" style={{ fontFamily: FONT_HEADING, color: TEXT_DARK }}>
              {c.title}
            </h2>
            <p className="text-[13px] mt-1" style={{ color: TEXT_MUTED, fontFamily: FONT_MONO }}>{c.sub}</p>
            {c.sub2 && (
              <p className="text-[12px] mt-0.5" style={{ color: PINK, fontFamily: FONT_MONO, fontWeight: 600 }}>{c.sub2}</p>
            )}
            <button
              onClick={() => navigate(c.to)}
              className="mt-3 inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-[13px] font-bold transition-all active:scale-95"
              style={{ background: DARK_BLUE, color: "#fff", fontFamily: FONT_MONO }}
            >
              {c.cta}
            </button>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
};

export default PlayPage;
