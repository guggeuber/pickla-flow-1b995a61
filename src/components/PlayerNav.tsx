import { motion } from "framer-motion";
import { useNavigate, useLocation } from "react-router-dom";

const BG = "rgba(250,248,245,0.97)";
const BORDER = "rgba(0,0,0,0.07)";
const NAVY = "#1a1f3a";
const RED = "#CC2936";
const GREEN = "#22c55e";
const MUTED = "#9ca3af";
const FONT = "'Space Grotesk', sans-serif";

export function PlayerNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const isHub = pathname.startsWith("/hub");
  const isBook = pathname.startsWith("/book");
  const isMy = pathname.startsWith("/my");

  return (
    <nav
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-around",
        padding: "14px 32px",
        paddingBottom: "calc(14px + env(safe-area-inset-bottom, 0px))",
        background: `linear-gradient(to top, ${BG} 0%, ${BG} 65%, transparent 100%)`,
      }}
    >
      {/* Live → /hub */}
      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={() => navigate("/hub", { replace: true })}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          background: "none",
          border: "none",
          cursor: "pointer",
          fontFamily: FONT,
          fontSize: 13,
          fontWeight: 700,
          color: isHub ? RED : MUTED,
          textDecoration: isHub ? "underline" : "none",
          textDecorationColor: RED,
          textUnderlineOffset: 3,
          padding: 0,
        }}
      >
        {/* Pulse dot */}
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: isHub ? GREEN : MUTED,
            boxShadow: isHub ? `0 0 0 2px rgba(34,197,94,0.25)` : "none",
            flexShrink: 0,
            display: "inline-block",
          }}
        />
        Live
      </motion.button>

      {/* Boka → /book */}
      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={() => navigate("/book", { replace: true })}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          fontFamily: FONT,
          fontSize: 13,
          fontWeight: 700,
          color: isBook ? NAVY : MUTED,
          textDecoration: isBook ? "underline" : "none",
          textDecorationColor: NAVY,
          textUnderlineOffset: 3,
          padding: 0,
        }}
      >
        Boka
      </motion.button>

      {/* Mig → /my */}
      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={() => navigate("/my", { replace: true })}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          fontFamily: FONT,
          fontSize: 13,
          fontWeight: 700,
          color: isMy ? NAVY : MUTED,
          textDecoration: isMy ? "underline" : "none",
          textDecorationColor: NAVY,
          textUnderlineOffset: 3,
          padding: 0,
        }}
      >
        Mig
      </motion.button>
    </nav>
  );
}
