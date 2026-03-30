import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ChatTab } from "@/components/community/ChatTab";
import { PlayNowTab } from "@/components/community/PlayNowTab";
import { ProfileTab } from "@/components/community/ProfileTab";
import { ArrowLeft, MessageCircle, Play, User } from "lucide-react";

const FONT_GROTESK = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

type Tab = "chat" | "play" | "profile";

const tabs: { key: Tab; label: string; icon: typeof MessageCircle }[] = [
  { key: "chat", label: "Chat", icon: MessageCircle },
  { key: "play", label: "Play", icon: Play },
  { key: "profile", label: "Me", icon: User },
];

const CommunityPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const initialTab = (searchParams.get("tab") as Tab) || "chat";
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  useEffect(() => {
    const t = searchParams.get("tab") as Tab;
    if (t && ["chat", "play", "profile"].includes(t)) setActiveTab(t);
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-neutral-100">
        <div className="px-5 pt-[env(safe-area-inset-top,12px)] pb-3 flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="w-8 h-8 rounded-lg flex items-center justify-center active:scale-90 transition-transform"
            style={{ background: "#f5f5f5" }}
          >
            <ArrowLeft className="w-4 h-4 text-neutral-600" />
          </button>
          <h1
            className="text-base font-bold tracking-tight text-neutral-900 flex-1"
            style={{ fontFamily: FONT_GROTESK }}
          >
            Community
          </h1>
        </div>

        {/* Tab bar */}
        <div className="flex px-5 gap-1">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-xs font-semibold transition-all relative"
                style={{
                  fontFamily: FONT_MONO,
                  color: isActive ? "#0066FF" : "#9CA3AF",
                }}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
                {isActive && (
                  <motion.div
                    layoutId="community-tab-indicator"
                    className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full"
                    style={{ background: "#0066FF" }}
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 px-5 py-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
          >
            {activeTab === "chat" && <ChatTab />}
            {activeTab === "play" && <PlayNowTab />}
            {activeTab === "profile" && <ProfileTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};

export default CommunityPage;
