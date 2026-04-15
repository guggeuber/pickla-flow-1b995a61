import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";
import picklaLogo from "@/assets/pickla-logo.svg";

const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO    = "'Space Mono', monospace";

export default function MembershipConfirmed() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-6 px-5 text-center">
      <img src={picklaLogo} alt="Pickla" className="h-8 w-auto opacity-20 mb-2" />

      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 22 }}
      >
        <CheckCircle2 className="w-16 h-16 text-emerald-500" />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <h1
          className="text-[26px] font-bold text-neutral-900 tracking-tight"
          style={{ fontFamily: FONT_HEADING }}
        >
          välkommen som medlem!
        </h1>
        <p
          className="text-neutral-400 text-[12px] mt-2 max-w-xs mx-auto"
          style={{ fontFamily: FONT_MONO }}
        >
          ditt medlemskap är nu aktivt — vi ses på banan
        </p>
      </motion.div>

      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        onClick={() => navigate("/my")}
        className="mt-2 px-6 py-2.5 rounded-xl text-[13px] font-bold"
        style={{ background: "#1a1f3a", color: "#fff", fontFamily: FONT_MONO }}
      >
        min sida →
      </motion.button>
    </div>
  );
}
