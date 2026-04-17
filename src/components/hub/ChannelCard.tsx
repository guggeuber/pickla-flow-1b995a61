import { motion } from "framer-motion";

const HUB_CARD = "#ffffff";
const HUB_BORDER = "rgba(0,0,0,0.07)";
const HUB_SHADOW = "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)";
const HUB_TEXT = "#111827";
const HUB_SUB = "#6b7280";
const HUB_MUTED = "#9ca3af";
const HUB_RED = "#CC2936";
const HUB_GREEN = "#22c55e";
const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

interface ChannelCardProps {
  emoji: string;
  title: string;
  subtitle?: string;
  lastMessage?: string;
  lastMessageTime?: string;
  unreadCount?: number;
  participantCount?: number;
  isLive?: boolean;
  isPinned?: boolean;
  onClick: () => void;
}

export function ChannelCard({
  emoji,
  title,
  subtitle,
  lastMessage,
  lastMessageTime,
  unreadCount = 0,
  participantCount = 0,
  isLive = false,
  isPinned = false,
  onClick,
}: ChannelCardProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.985 }}
      onClick={onClick}
      className="w-full text-left"
      style={{
        background: HUB_CARD,
        border: `1px solid ${HUB_BORDER}`,
        borderRadius: 16,
        boxShadow: isPinned ? `0 2px 8px rgba(0,0,0,0.08)` : HUB_SHADOW,
        padding: "14px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      {/* Emoji badge */}
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          background: isPinned ? "#1a1f3a" : "#f4f3f1",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 20,
          flexShrink: 0,
        }}
      >
        {emoji}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <span
            style={{
              fontFamily: FONT_HEADING,
              fontSize: 14,
              fontWeight: 700,
              color: HUB_TEXT,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {title}
          </span>
          {isLive && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                fontSize: 9,
                fontWeight: 700,
                fontFamily: FONT_MONO,
                color: HUB_GREEN,
                letterSpacing: "0.05em",
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: HUB_GREEN,
                  display: "inline-block",
                }}
              />
              LIVE
            </span>
          )}
        </div>

        {subtitle && (
          <p
            style={{
              fontSize: 11,
              fontFamily: FONT_MONO,
              color: HUB_SUB,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginBottom: lastMessage ? 3 : 0,
            }}
          >
            {subtitle}
          </p>
        )}

        {lastMessage && (
          <p
            style={{
              fontSize: 12,
              color: unreadCount > 0 ? HUB_TEXT : HUB_MUTED,
              fontWeight: unreadCount > 0 ? 500 : 400,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {lastMessage}
          </p>
        )}
      </div>

      {/* Right side */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 6,
          flexShrink: 0,
        }}
      >
        {lastMessageTime && (
          <span style={{ fontSize: 10, fontFamily: FONT_MONO, color: HUB_MUTED }}>
            {lastMessageTime}
          </span>
        )}
        {unreadCount > 0 ? (
          <span
            style={{
              minWidth: 18,
              height: 18,
              borderRadius: 9,
              background: HUB_RED,
              color: "#fff",
              fontSize: 10,
              fontWeight: 700,
              fontFamily: FONT_MONO,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 5px",
            }}
          >
            {unreadCount}
          </span>
        ) : participantCount > 0 ? (
          <ParticipantDots count={participantCount} />
        ) : null}
      </div>
    </motion.button>
  );
}

function ParticipantDots({ count }: { count: number }) {
  const visible = Math.min(count, 4);
  const colors = ["#1a1f3a", "#CC2936", "#22c55e", "#f59e0b"];
  return (
    <div style={{ display: "flex" }}>
      {Array.from({ length: visible }).map((_, i) => (
        <div
          key={i}
          style={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: colors[i % colors.length],
            border: "1.5px solid white",
            marginLeft: i === 0 ? 0 : -5,
          }}
        />
      ))}
      {count > 4 && (
        <div
          style={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "#e5e7eb",
            border: "1.5px solid white",
            marginLeft: -5,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 7,
            fontWeight: 700,
            color: "#6b7280",
          }}
        >
          +{count - 4}
        </div>
      )}
    </div>
  );
}
