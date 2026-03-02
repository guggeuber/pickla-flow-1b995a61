import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Radio, ListOrdered, Users, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import LiveCourtControl from "@/components/event-ops/LiveCourtControl";
import MatchQueue from "@/components/event-ops/MatchQueue";
import PlayerCheckin from "@/components/event-ops/PlayerCheckin";

type OpsTab = "live" | "queue" | "players";

const tabs: { id: OpsTab; label: string; icon: typeof Radio }[] = [
  { id: "live", label: "Live", icon: Radio },
  { id: "queue", label: "Queue", icon: ListOrdered },
  { id: "players", label: "Players", icon: Users },
];

const screens: Record<OpsTab, React.FC> = {
  live: LiveCourtControl,
  queue: MatchQueue,
  players: PlayerCheckin,
};

const EventOps = () => {
  const [activeTab, setActiveTab] = useState<OpsTab>("live");
  const navigate = useNavigate();
  const Screen = screens[activeTab];

  return (
    <div className="min-h-screen bg-background max-w-md mx-auto relative flex flex-col">
      {/* Top header */}
      <div className="sticky top-0 z-40 px-4 pt-4 pb-2" style={{ background: 'hsl(220 20% 8% / 0.95)', backdropFilter: 'blur(20px)' }}>
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => navigate("/")} className="tap-target rounded-xl hover:bg-secondary">
            <ArrowLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold tracking-tight">Event Ops</h1>
            <p className="text-xs text-muted-foreground">Live banstyrning</p>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-success pulse-live" />
            <span className="text-xs font-semibold text-success">LIVE</span>
          </div>
        </div>

        {/* Sub-navigation */}
        <div className="flex gap-1 p-1 rounded-xl bg-secondary/50">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-lg"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Screen content */}
      <div className="flex-1 overflow-y-auto pb-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            <Screen />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};

export default EventOps;
