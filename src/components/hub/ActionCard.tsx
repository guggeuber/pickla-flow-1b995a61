import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { ScarcityBadge } from "@/components/ui/PeopleRow";

const FONT_HEADING = "'Space Grotesk', sans-serif";

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
  const isFull = hasSpots && spotsLeft === 0;

  return (
    <motion.div
      whileTap={{ scale: 0.97 }}
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
            fontFamily: "Inter, sans-serif",
            marginBottom: 10,
          }}
        >
          {description}
        </p>
      )}

      {hasSpots && (
        <div style={{ marginBottom: 12 }}>
          <ScarcityBadge
            remaining={spotsLeft}
            capacity={spotsTotal}
            style={{ background: "rgba(255,255,255,0.12)", color: "#fff" }}
          />
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
          fontFamily: FONT_HEADING,
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
    </motion.div>
  );
}
