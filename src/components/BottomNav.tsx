import { motion } from "framer-motion";
import { CalendarDays, Users, BookOpen, TrendingUp, Settings } from "lucide-react";

type Tab = "today" | "customers" | "book" | "sales" | "ops";

interface BottomNavProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

const tabs: { id: Tab; label: string; icon: typeof CalendarDays }[] = [
  { id: "today", label: "Today", icon: CalendarDays },
  { id: "customers", label: "Customers", icon: Users },
  { id: "book", label: "Book", icon: BookOpen },
  { id: "sales", label: "Sales", icon: TrendingUp },
  { id: "ops", label: "Ops", icon: Settings },
];

const BottomNav = ({ activeTab, onTabChange }: BottomNavProps) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card/90 backdrop-blur-xl border-t border-border safe-area-bottom">
      <div className="flex items-center justify-around px-2 py-1 max-w-md mx-auto">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <motion.button
              key={tab.id}
              whileTap={{ scale: 0.85 }}
              onClick={() => onTabChange(tab.id)}
              className={`bottom-nav-item relative ${isActive ? 'bottom-nav-active' : 'text-muted-foreground'}`}
            >
              {tab.id === "book" ? (
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center -mt-3 shadow-lg ${isActive ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}>
                  <tab.icon className="w-5 h-5" />
                </div>
              ) : (
                <tab.icon className="w-5 h-5" />
              )}
              <span className="text-[10px] font-semibold">{tab.label}</span>
              {isActive && tab.id !== "book" && (
                <motion.div
                  layoutId="activeIndicator"
                  className="absolute -top-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary"
                />
              )}
            </motion.button>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;
export type { Tab };
