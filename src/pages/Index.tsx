import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import BottomNav, { type Tab } from "@/components/BottomNav";
import TodayScreen from "@/screens/TodayScreen";
import CustomersScreen from "@/screens/CustomersScreen";
import BookScreen from "@/screens/BookScreen";
import SalesScreen from "@/screens/SalesScreen";
import OpsScreen from "@/screens/OpsScreen";

const screens: Record<Tab, React.FC> = {
  today: TodayScreen,
  customers: CustomersScreen,
  book: BookScreen,
  sales: SalesScreen,
  ops: OpsScreen,
};

const Index = () => {
  const [activeTab, setActiveTab] = useState<Tab>("today");

  const Screen = screens[activeTab];

  return (
    <div className="min-h-screen bg-background max-w-md mx-auto relative">
      <div className="pt-safe-top">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            <Screen />
          </motion.div>
        </AnimatePresence>
      </div>
      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
};

export default Index;
