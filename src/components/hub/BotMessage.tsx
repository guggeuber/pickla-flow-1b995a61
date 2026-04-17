const FONT_MONO = "'Space Mono', monospace";

interface BotMessageProps {
  content: string;
  time?: string;
}

export function BotMessage({ content, time }: BotMessageProps) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
      {/* Bot avatar */}
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: "#1a1f3a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 13,
          flexShrink: 0,
          marginTop: 2,
        }}
      >
        🤖
      </div>

      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 3 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              fontFamily: FONT_MONO,
              color: "#1a1f3a",
              letterSpacing: "0.05em",
            }}
          >
            PICKLA BOT
          </span>
          {time && (
            <span style={{ fontSize: 9, fontFamily: FONT_MONO, color: "#9ca3af" }}>
              {time}
            </span>
          )}
        </div>

        <div
          style={{
            background: "#f0eeec",
            borderRadius: "4px 14px 14px 14px",
            padding: "8px 12px",
            display: "inline-block",
            maxWidth: "100%",
          }}
        >
          <p
            style={{
              fontSize: 13,
              color: "#111827",
              lineHeight: 1.5,
              whiteSpace: "pre-line",
            }}
          >
            {content}
          </p>
        </div>
      </div>
    </div>
  );
}
