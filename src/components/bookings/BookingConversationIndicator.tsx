import { MessageCircle } from "lucide-react";

export function BookingConversationIndicator({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <span
      aria-label="Konversation finns"
      title="Konversation finns"
      className="inline-flex h-6 w-6 items-center justify-center rounded-full"
      style={{ background: "rgba(0,102,255,0.08)", color: "#0066FF" }}
    >
      <MessageCircle aria-hidden="true" className="h-3.5 w-3.5" />
    </span>
  );
}
