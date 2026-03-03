import { motion } from "framer-motion";
import { Users, Shield, Lock, Unlock } from "lucide-react";
import { CrewBadge } from "./CrewBadge";

interface CrewCardProps {
  crew: {
    id: string;
    name: string;
    description?: string | null;
    badge_emoji: string;
    badge_color: string;
    crew_type: string;
    min_rating: number;
    max_members: number;
    member_count?: number;
    crew_score?: number;
  };
  onSelect: (id: string) => void;
}

export function CrewCard({ crew, onSelect }: CrewCardProps) {
  const memberCount = crew.member_count || 0;
  const score = crew.crew_score || 0;
  const activityLevel =
    score > 8000 ? "High" : score > 3000 ? "Medium" : "Low";
  const activityColor =
    activityLevel === "High"
      ? "#4CAF50"
      : activityLevel === "Medium"
      ? "#FF9800"
      : "rgba(62,61,57,0.4)";

  const typeIcon =
    crew.crew_type === "open" ? Unlock : crew.crew_type === "invite_only" ? Shield : Lock;
  const TypeIcon = typeIcon;

  return (
    <motion.button
      onClick={() => onSelect(crew.id)}
      className="w-full rounded-2xl p-4 text-left transition-all active:scale-[0.98]"
      style={{
        background: "rgba(255,255,255,0.6)",
        border: "1.5px solid rgba(62,61,57,0.08)",
        boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
      }}
      whileTap={{ scale: 0.98 }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <CrewBadge emoji={crew.badge_emoji} color={crew.badge_color} size="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p
              className="font-bold text-sm truncate"
              style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#3E3D39" }}
            >
              {crew.name}
            </p>
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0"
              style={{ background: "rgba(62,61,57,0.06)", color: "rgba(62,61,57,0.5)" }}
            >
              {memberCount}/{crew.max_members}
            </span>
          </div>
          {crew.description && (
            <p
              className="text-[11px] truncate mt-0.5"
              style={{ color: "rgba(62,61,57,0.5)" }}
            >
              {crew.description}
            </p>
          )}
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: "Crew Score", value: score.toLocaleString(), color: "#E86C24" },
          { label: "Activity", value: activityLevel, color: activityColor },
          { label: "Req. Level", value: crew.min_rating, color: "#3E3D39" },
          {
            label: "Type",
            value: (
              <span className="flex items-center gap-1">
                <TypeIcon className="w-3 h-3" />
                {crew.crew_type === "open" ? "Open" : crew.crew_type === "invite_only" ? "Invite" : "Closed"}
              </span>
            ),
            color: "#3E3D39",
          },
        ].map((s, i) => (
          <div
            key={i}
            className="text-center rounded-lg p-1.5"
            style={{ background: "rgba(62,61,57,0.03)" }}
          >
            <p
              className="text-xs font-bold"
              style={{ fontFamily: "'Space Grotesk', sans-serif", color: s.color }}
            >
              {s.value}
            </p>
            <p
              className="text-[8px] uppercase tracking-wider font-semibold mt-0.5"
              style={{ color: "rgba(62,61,57,0.35)" }}
            >
              {s.label}
            </p>
          </div>
        ))}
      </div>
    </motion.button>
  );
}
