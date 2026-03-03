import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const EMOJIS = ["⚡", "🔥", "🏆", "⭐", "💎", "🦅", "🐉", "🎯", "🌊", "🍕", "🎸", "🚀"];
const COLORS = ["#E86C24", "#4CAF50", "#2196F3", "#9C27B0", "#FF5722", "#00BCD4", "#FFD700", "#E91E63"];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CreateCrewModal({ open, onClose }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [emoji, setEmoji] = useState("⚡");
  const [color, setColor] = useState("#E86C24");
  const [crewType, setCrewType] = useState("open");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!user || !name.trim()) return;
    setLoading(true);
    try {
      // Get player profile
      const { data: profile } = await supabase
        .from("player_profiles")
        .select("id")
        .eq("auth_user_id", user.id)
        .single();

      if (!profile) {
        toast.error("Du behöver en spelarprofil först");
        return;
      }

      // Create crew
      const { data: crew, error } = await supabase
        .from("crews")
        .insert({
          name: name.trim(),
          description: description.trim() || null,
          badge_emoji: emoji,
          badge_color: color,
          crew_type: crewType,
          created_by: user.id,
        })
        .select("id")
        .single();

      if (error) {
        if (error.code === "23505") toast.error("Det namnet är redan taget");
        else toast.error("Kunde inte skapa crew");
        return;
      }

      // Add creator as leader
      await supabase.from("crew_members").insert({
        crew_id: crew.id,
        player_profile_id: profile.id,
        role: "leader",
      });

      toast.success(`${name} har skapats! 🎉`);
      qc.invalidateQueries({ queryKey: ["crews"] });
      qc.invalidateQueries({ queryKey: ["my-crew"] });
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-end justify-center"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={onClose}
        >
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 400 }}
            className="w-full max-w-lg rounded-t-3xl p-6 max-h-[85vh] overflow-y-auto"
            style={{ background: "#F5D5D5" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2
                className="text-lg font-bold"
                style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#3E3D39" }}
              >
                Skapa Crew
              </h2>
              <button onClick={onClose} className="p-1">
                <X className="w-5 h-5" style={{ color: "rgba(62,61,57,0.4)" }} />
              </button>
            </div>

            {/* Name */}
            <label className="text-xs font-semibold mb-1 block" style={{ color: "rgba(62,61,57,0.6)" }}>
              Crewnamn
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={30}
              placeholder="T.ex. Pickle Vikings"
              className="w-full rounded-xl px-4 py-3 text-sm mb-4 outline-none"
              style={{
                background: "rgba(255,255,255,0.6)",
                border: "1.5px solid rgba(62,61,57,0.1)",
                color: "#3E3D39",
              }}
            />

            {/* Description */}
            <label className="text-xs font-semibold mb-1 block" style={{ color: "rgba(62,61,57,0.6)" }}>
              Beskrivning
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={120}
              rows={2}
              placeholder="Kort beskrivning av ert crew..."
              className="w-full rounded-xl px-4 py-3 text-sm mb-4 outline-none resize-none"
              style={{
                background: "rgba(255,255,255,0.6)",
                border: "1.5px solid rgba(62,61,57,0.1)",
                color: "#3E3D39",
              }}
            />

            {/* Badge */}
            <label className="text-xs font-semibold mb-2 block" style={{ color: "rgba(62,61,57,0.6)" }}>
              Badge
            </label>
            <div className="flex flex-wrap gap-2 mb-3">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => setEmoji(e)}
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-lg transition-all"
                  style={{
                    background: emoji === e ? `${color}20` : "rgba(255,255,255,0.5)",
                    border: emoji === e ? `2px solid ${color}` : "1px solid rgba(62,61,57,0.1)",
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 mb-4">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className="w-8 h-8 rounded-full transition-all"
                  style={{
                    background: c,
                    border: color === c ? "3px solid #3E3D39" : "2px solid transparent",
                    transform: color === c ? "scale(1.15)" : "scale(1)",
                  }}
                />
              ))}
            </div>

            {/* Type */}
            <label className="text-xs font-semibold mb-2 block" style={{ color: "rgba(62,61,57,0.6)" }}>
              Typ
            </label>
            <div className="flex gap-2 mb-6">
              {[
                { key: "open", label: "Öppen" },
                { key: "invite_only", label: "Inbjudan" },
                { key: "closed", label: "Stängd" },
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => setCrewType(t.key)}
                  className="flex-1 rounded-xl py-2.5 text-xs font-semibold transition-all"
                  style={{
                    background: crewType === t.key ? "#E86C24" : "rgba(255,255,255,0.5)",
                    color: crewType === t.key ? "#fff" : "rgba(62,61,57,0.6)",
                    border: crewType === t.key ? "none" : "1px solid rgba(62,61,57,0.1)",
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <button
              onClick={handleCreate}
              disabled={!name.trim() || loading}
              className="w-full rounded-xl py-3.5 text-sm font-bold transition-all active:scale-95 disabled:opacity-50"
              style={{ background: "#E86C24", color: "#fff" }}
            >
              {loading ? "Skapar..." : "Skapa Crew ⚡"}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
