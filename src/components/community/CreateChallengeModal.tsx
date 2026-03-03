import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { motion, AnimatePresence } from "framer-motion";
import { X, Swords, Loader2 } from "lucide-react";
import { CrewBadge } from "./CrewBadge";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
  myCrewId: string;
  myCrewName: string;
}

export function CreateChallengeModal({ open, onClose, myCrewId, myCrewName }: Props) {
  const { user } = useAuth();
  const [selectedCrewId, setSelectedCrewId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const { data: crews, isLoading } = useQuery({
    queryKey: ["crews-for-challenge", myCrewId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crews")
        .select("id, name, badge_emoji, badge_color")
        .neq("id", myCrewId)
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const handleSend = async () => {
    if (!selectedCrewId || !user) return;
    setSending(true);
    try {
      const { error } = await supabase.from("crew_challenges").insert({
        challenger_crew_id: myCrewId,
        challenged_crew_id: selectedCrewId,
        status: "pending",
        message: message.trim() || null,
      });

      if (error) {
        toast.error("Kunde inte skicka utmaning");
        return;
      }

      toast.success("Utmaning skickad! ⚔️");
      onClose();
      setSelectedCrewId(null);
      setMessage("");
    } finally {
      setSending(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end justify-center"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={onClose}
        >
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="w-full max-w-md rounded-t-3xl p-5 pb-8 max-h-[80vh] overflow-auto"
            style={{ background: "#F5D5D5" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3
                className="text-base font-bold flex items-center gap-2"
                style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#3E3D39" }}
              >
                <Swords className="w-5 h-5" style={{ color: "#E86C24" }} />
                Utmana ett Crew
              </h3>
              <button onClick={onClose} className="p-1 rounded-lg" style={{ color: "rgba(62,61,57,0.4)" }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs mb-4" style={{ color: "rgba(62,61,57,0.5)" }}>
              Skicka en Clash-utmaning från <strong>{myCrewName}</strong> till ett annat crew.
            </p>

            {/* Crew selection */}
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin" style={{ color: "#3E3D39" }} />
              </div>
            ) : (
              <div className="flex flex-col gap-2 mb-4 max-h-48 overflow-auto">
                {crews?.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCrewId(c.id)}
                    className="w-full rounded-xl p-3 flex items-center gap-3 transition-all"
                    style={{
                      background: selectedCrewId === c.id ? "rgba(232,108,36,0.1)" : "rgba(255,255,255,0.5)",
                      border: selectedCrewId === c.id
                        ? "2px solid rgba(232,108,36,0.4)"
                        : "1.5px solid rgba(62,61,57,0.08)",
                    }}
                  >
                    <CrewBadge emoji={c.badge_emoji || "⚡"} color={c.badge_color || "#E86C24"} size="sm" />
                    <p className="text-sm font-semibold" style={{ color: "#3E3D39" }}>
                      {c.name}
                    </p>
                  </button>
                ))}
                {(!crews || crews.length === 0) && (
                  <p className="text-xs text-center py-4" style={{ color: "rgba(62,61,57,0.4)" }}>
                    Inga andra crews att utmana
                  </p>
                )}
              </div>
            )}

            {/* Message */}
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Valfritt meddelande..."
              maxLength={200}
              className="w-full rounded-xl p-3 text-sm resize-none mb-4"
              rows={2}
              style={{
                background: "rgba(255,255,255,0.6)",
                border: "1.5px solid rgba(62,61,57,0.1)",
                color: "#3E3D39",
                outline: "none",
              }}
            />

            <button
              onClick={handleSend}
              disabled={!selectedCrewId || sending}
              className="w-full rounded-xl py-3 text-sm font-bold transition-all active:scale-95 disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: "#E86C24", color: "#fff" }}
            >
              <Swords className="w-4 h-4" />
              {sending ? "Skickar..." : "Skicka utmaning"}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
