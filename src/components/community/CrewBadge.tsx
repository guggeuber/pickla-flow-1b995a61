import { motion } from "framer-motion";

interface CrewBadgeProps {
  emoji: string;
  color: string;
  size?: "sm" | "md" | "lg";
}

const sizes = {
  sm: "w-8 h-8 text-sm",
  md: "w-12 h-12 text-xl",
  lg: "w-16 h-16 text-2xl",
};

export function CrewBadge({ emoji, color, size = "md" }: CrewBadgeProps) {
  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={`${sizes[size]} rounded-xl flex items-center justify-center shrink-0`}
      style={{
        background: `${color}18`,
        border: `2px solid ${color}40`,
        boxShadow: `0 4px 12px ${color}20`,
      }}
    >
      <span>{emoji}</span>
    </motion.div>
  );
}
