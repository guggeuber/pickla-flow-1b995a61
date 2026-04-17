import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";

const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

interface ActionCardProps {
  title: string;
  description?: string;
  spotsTotal?: number;
  spotsTaken?: number;
  ctaLabel: string;
  ctaPrice?: number;
  loading?: boolean;
  onAction: () => void;
}

export function ActionCard({
  title,
  description,
  spotsTotal,
  spotsTaken = 0,
  ctaLabel,
  ctaPrice,
  loading = false,
  onAction,
}: ActionCardProps) {
  const hasSpots = spotsTotal !== undefined && spotsTotal > 0;
  const spotsLeft = hasSpots ? spotsTotal! - spotsTaken : null;
  const fillPct = hasSpots ? Math.min((spotsTaken / spotsTotal!) * 100, 100) : null;
  const isFull = hasSpots && spotsLeft === 0;

  return (
    <div
      style={{
        background: "#1a1f3a",
        borderRadius: 14,
        padding: "14px 16px",
        margin: "4px 0",
      }}
    >
      {/* Title row */}
      <p
        style={{
          fontFamily: FONT_HEADING,
          fontSize: 15,
          fontWeight: 700,
          color: "#ffffff",
          marginBottom: description ? 4 : 8,
        }}
      >
        {title}
      </p>

      {description && (
        <p
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.6)",
            fontFamily: FONT_MONO,
            marginBottom: 10,
          }}
        >
          {description}
        </p>
      )}

      {/* Spots progress */}
      {hasSpots && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
            {Array.from({ length: spotsTotal! }).map((_, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: 6,
                  borderRadius: 3,
                  background: i < spotsTaken ? "#CC2936" : "rgba(255,255,255,0.15)",
                  transition: "background 0.3s",
                }}
              />
            ))}
          </div>
          <p style={{ fontSize: 11, fontFamily: FONT_MONO, color: "rgba(255,255,255,0.55)" }}>
            {isFull ? (
              <span style={{ color: "#CC2936" }}>Fullbokad</span>
            ) : (
              <>
                <span style={{ color: "rgba(255,255,255,0.9)", fontWeight: 700 }}>
                  {spotsLeft}
                </span>{" "}
                av {spotsTotal} platser kvar
              </>
            )}
          </p>
        </div>
      )}

      {/* CTA */}
      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={onAction}
        disabled={loading || isFull === true}
        style={{
          width: "100%",
          background: isFull ? "rgba(255,255,255,0.1)" : "#CC2936",
          color: isFull ? "rgba(255,255,255,0.35)" : "#ffffff",
          border: "none",
          borderRadius: 10,
          padding: "10px 0",
          fontFamily: FONT_MONO,
          fontSize: 13,
          fontWeight: 700,
          cursor: isFull ? "not-allowed" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          letterSpacing: "0.02em",
        }}
      >
        {loading ? (
          <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} />
        ) : (
          <>
            {ctaLabel}
            {ctaPrice !== undefined && ctaPrice > 0 && (
              <span style={{ opacity: 0.8 }}>— {ctaPrice} kr</span>
            )}
          </>
        )}
      </motion.button>
    </div>
  );
}
