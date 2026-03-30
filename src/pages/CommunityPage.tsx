import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion, AnimatePresence } from "framer-motion";
import { ForumFeed } from "@/components/community/ForumFeed";
import { ActivityFeed } from "@/components/community/ActivityFeed";
import { ProfileTab } from "@/components/community/ProfileTab";
import { ArrowLeft, MessageSquareText, Activity, User } from "lucide-react";

const FONT_GROTESK = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

type Tab = "forum" | "activity" | "profile";

const tabs: { key: Tab; label: string; icon: typeof MessageSquareText }[] = [
  { key: "forum", label: "Forum", icon: MessageSquareText },
  { key: "activity", label: "Activity", icon: Activity },
  { key: "profile", label: "Me", icon: User },
];

function useNewContentBadges() {
  // Check for new forum posts since last visit
  const { data: forumBadge } = useQuery({
    queryKey: ["forum-badge"],
    staleTime: 30000,
    queryFn: async () => {
      const lastSeen = localStorage.getItem("community_forum_last_seen");
      if (!lastSeen) return true; // never visited = show badge
      const { count, error } = await (supabase as any)
        .from("forum_posts")
        .select("id", { count: "exact", head: true })
        .gt("created_at", lastSeen);
      if (error) return false;
      return (count || 0) > 0;
    },
  });

  // Check for new activity since last visit
  const { data: activityBadge } = useQuery({
    queryKey: ["activity-badge"],
    staleTime: 30000,
    queryFn: async () => {
      const lastSeen = localStorage.getItem("community_activity_last_seen");
      if (!lastSeen) return true;
      const { count, error } = await (supabase as any)
        .from("community_feed")
        .select("id", { count: "exact", head: true })
        .gt("created_at", lastSeen);
      if (error) return false;
      return (count || 0) > 0;
    },
  });

  return { forumBadge: !!forumBadge, activityBadge: !!activityBadge };
}

const CommunityPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const initialTab = (searchParams.get("tab") as Tab) || "forum";
  const [activeTab, setActiveTab] = useState<Tab>(
    ["forum", "activity", "profile"].includes(initialTab) ? initialTab : "forum"
  );
  const { forumBadge, activityBadge } = useNewContentBadges();

  useEffect(() => {
    const t = searchParams.get("tab") as Tab;
    if (t && ["forum", "activity", "profile"].includes(t)) setActiveTab(t);
  }, [searchParams]);

  const getBadge = (key: Tab) => {
    if (key === "forum" && forumBadge && activeTab !== "forum") return true;
    if (key === "activity" && activityBadge && activeTab !== "activity") return true;
    return false;
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-neutral-100">
        <div className="px-5 pt-[env(safe-area-inset-top,12px)] pb-2 flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="w-8 h-8 rounded-lg flex items-center justify-center active:scale-90 transition-transform bg-neutral-50"
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
            const hasBadge = getBadge(tab.key);
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-xs font-semibold transition-all relative"
                style={{
                  fontFamily: FONT_MONO,
                  color: isActive ? "#111" : "#9CA3AF",
                }}
              >
                <div className="relative">
                  <Icon className="w-3.5 h-3.5" />
                  {hasBadge && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500 border border-white" />
                  )}
                </div>
                {tab.label}
                {isActive && (
                  <motion.div
                    layoutId="community-tab-indicator"
                    className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-neutral-900"
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
            {activeTab === "forum" && <ForumFeed />}
            {activeTab === "activity" && <ActivityFeed />}
            {activeTab === "profile" && <ProfileTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};

export default CommunityPage;
