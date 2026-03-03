import { motion } from "framer-motion";
import { Zap, Trophy, User, Swords } from "lucide-react";

type Tab = "feed" | "ranking" | "crews" | "profile";

const tabs: { key: Tab; label: string; icon: typeof Zap }[] = [
  { key: "feed", label: "Feed", icon: Zap },
  { key: "ranking", label: "Ranking", icon: Trophy },
  { key: "crews", label: "Crews", icon: Swords },
  { key: "profile", label: "Profil", icon: User },
];

export function CommunityNav({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around px-4 py-2 safe-area-bottom"
      style={{
        background: "rgba(245,213,213,0.95)",
        backdropFilter: "blur(20px)",
        borderTop: "1px solid rgba(62,61,57,0.1)",
      }}
    >
      {tabs.map((tab) => {
        const isActive = active === tab.key;
        const Icon = tab.icon;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className="flex flex-col items-center gap-0.5 py-2 px-4 rounded-xl transition-all relative min-w-[64px]"
          >
            {isActive && (
              <motion.div
                layoutId="community-tab-bg"
                className="absolute inset-0 rounded-xl"
                style={{ background: "rgba(232,108,36,0.1)" }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
            <Icon
              className="w-5 h-5 relative z-10"
              style={{ color: isActive ? "#E86C24" : "rgba(62,61,57,0.4)" }}
            />
            <span
              className="text-[10px] font-semibold relative z-10 tracking-wide"
              style={{ color: isActive ? "#E86C24" : "rgba(62,61,57,0.4)" }}
            >
              {tab.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
