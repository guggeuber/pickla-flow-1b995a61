import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.1 } } };
const item = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 26 } } };

const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

const plans = [
  {
    title: "Day Pass – 165 kr",
    subtitle: "Play today",
    accent: false,
  },
  {
    title: "Pickla Member – 399 kr / month",
    subtitle: "Join the community",
    accent: true,
  },
  {
    title: "Unlimited – 799 kr / month",
    subtitle: "Play anytime",
    accent: false,
  },
];

export function PlayNowTab() {
  const navigate = useNavigate();

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col gap-6 pb-8">
      {/* Hero */}
      <motion.div variants={item} className="text-center pt-4">
        <h2
          className="text-2xl font-black tracking-tight uppercase"
          style={{ fontFamily: FONT_HEADING, color: "#3E3D39" }}
        >
          Play at Pickla
        </h2>
      </motion.div>

      {/* Open Play section */}
      <motion.div variants={item} className="text-center">
        <h3
          className="text-lg font-bold mb-1"
          style={{ fontFamily: FONT_HEADING, color: "#3E3D39" }}
        >
          Open Play Today
        </h3>
        <p className="text-sm" style={{ color: "rgba(62,61,57,0.6)", fontFamily: FONT_MONO }}>
          Join games, rotate courts, meet players.
        </p>
      </motion.div>

      {/* Membership cards */}
      <div className="flex flex-col gap-3">
        {plans.map((plan) => (
          <motion.button
            key={plan.title}
            variants={item}
            className="w-full rounded-2xl p-5 text-left transition-all active:scale-[0.98]"
            style={{
              background: plan.accent ? "#3E3D39" : "rgba(255,255,255,0.7)",
              border: plan.accent ? "none" : "1.5px solid rgba(62,61,57,0.1)",
              boxShadow: plan.accent
                ? "0 8px 32px rgba(62,61,57,0.2)"
                : "0 2px 12px rgba(0,0,0,0.04)",
            }}
          >
            <p
              className="text-[15px] font-bold tracking-tight"
              style={{
                fontFamily: FONT_HEADING,
                color: plan.accent ? "#fff" : "#3E3D39",
              }}
            >
              {plan.title}
            </p>
            <p
              className="text-xs mt-0.5"
              style={{
                fontFamily: FONT_MONO,
                color: plan.accent ? "rgba(255,255,255,0.6)" : "rgba(62,61,57,0.5)",
              }}
            >
              {plan.subtitle}
            </p>
          </motion.button>
        ))}
      </div>

      {/* Book a court CTA */}
      <motion.div
        variants={item}
        className="mt-4 rounded-2xl p-5 text-center"
        style={{
          background: "rgba(232,108,36,0.06)",
          border: "1.5px solid rgba(232,108,36,0.15)",
        }}
      >
        <p
          className="text-sm mb-3"
          style={{ fontFamily: FONT_HEADING, color: "#3E3D39", fontWeight: 600 }}
        >
          Prefer a private court?
        </p>
        <button
          onClick={() => navigate("/book")}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all active:scale-95"
          style={{
            background: "#E86C24",
            color: "#fff",
            fontFamily: FONT_MONO,
          }}
        >
          Book a court
          <ArrowRight className="w-4 h-4" />
        </button>
      </motion.div>
    </motion.div>
  );
}
