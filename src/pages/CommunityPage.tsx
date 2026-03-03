import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CommunityNav } from "@/components/community/CommunityNav";
import { FeedTab } from "@/components/community/FeedTab";
import { LeaderboardTab } from "@/components/community/LeaderboardTab";
import { CrewsTab } from "@/components/community/CrewsTab";
import { ProfileTab } from "@/components/community/ProfileTab";
import picklaLogo from "@/assets/pickla-logo.svg";

type Tab = "feed" | "ranking" | "crews" | "profile";

const CommunityPage = () => {
  const [activeTab, setActiveTab] = useState<Tab>("feed");

  return (
    <div
      className="min-h-screen flex flex-col pb-20"
      style={{ background: "#F5D5D5", color: "#3E3D39" }}
    >
      {/* Header */}
      <div className="px-5 pt-6 pb-3 flex items-center justify-between">
        <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>
          <img src={picklaLogo} alt="Pickla" className="h-8 w-auto" />
        </motion.div>
        <motion.h1
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-base font-bold tracking-tight"
          style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#3E3D39" }}
        >
          Community
        </motion.h1>
        <div className="w-8" /> {/* spacer */}
      </div>

      {/* Content */}
      <div className="flex-1 px-5">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === "feed" && <FeedTab />}
            {activeTab === "ranking" && <LeaderboardTab />}
            {activeTab === "crews" && <CrewsTab />}
            {activeTab === "profile" && <ProfileTab />}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom nav */}
      <CommunityNav active={activeTab} onChange={setActiveTab} />
    </div>
  );
};

export default CommunityPage;
