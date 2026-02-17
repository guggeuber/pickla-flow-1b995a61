import { motion } from "framer-motion";
import { AlertTriangle, Wrench, Radio, Megaphone, ChevronRight, ToggleLeft } from "lucide-react";
import { useState } from "react";

const incidents = [
  { time: "1:45 PM", text: "Net loose on Court 3", status: "open" },
  { time: "11:20 AM", text: "Light flickering Court 5", status: "resolved" },
];

const OpsScreen = () => {
  const [eventMode, setEventMode] = useState(false);

  return (
    <div className="pb-24 px-4 pt-2 space-y-5">
      <h1 className="text-2xl font-display font-bold tracking-tight">Ops</h1>

      {/* Event Mode */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card rounded-2xl p-4 flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <Radio className={`w-5 h-5 ${eventMode ? 'text-court-active' : 'text-muted-foreground'}`} />
          <div>
            <p className="text-sm font-semibold">Event Mode</p>
            <p className="text-xs text-muted-foreground">Locks bookings, activates event UI</p>
          </div>
        </div>
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => setEventMode(!eventMode)}
          className={`w-12 h-7 rounded-full relative transition-colors duration-200 ${eventMode ? 'bg-primary' : 'bg-border'}`}
        >
          <motion.div
            animate={{ x: eventMode ? 22 : 2 }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            className="absolute top-1 w-5 h-5 rounded-full bg-card shadow-md"
          />
        </motion.button>
      </motion.div>

      {/* Court Maintenance */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Court Maintenance</h2>
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3, 4, 5, 6].map(court => (
            <motion.button
              key={court}
              whileTap={{ scale: 0.92 }}
              className="glass-card rounded-xl p-3 text-center"
            >
              <Wrench className="w-4 h-4 mx-auto text-muted-foreground mb-1" />
              <span className="text-xs font-semibold">Court {court}</span>
              <span className="text-[10px] text-revenue-up block mt-0.5">OK</span>
            </motion.button>
          ))}
        </div>
      </div>

      {/* Incidents */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Incident Log</h2>
        <div className="space-y-2">
          {incidents.map((inc, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              className="glass-card rounded-2xl p-3.5 flex items-center gap-3"
            >
              <AlertTriangle className={`w-4 h-4 flex-shrink-0 ${inc.status === 'open' ? 'text-badge-unpaid' : 'text-muted-foreground'}`} />
              <div className="flex-1">
                <p className="text-sm font-medium">{inc.text}</p>
                <p className="text-xs text-muted-foreground">{inc.time}</p>
              </div>
              <span className={`status-chip ${inc.status === 'open' ? 'bg-badge-unpaid text-badge-unpaid-foreground' : 'bg-muted text-muted-foreground'}`}>
                {inc.status}
              </span>
            </motion.div>
          ))}
          <motion.button
            whileTap={{ scale: 0.97 }}
            className="w-full glass-card rounded-2xl p-3.5 flex items-center justify-center gap-2 text-primary"
          >
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm font-semibold">Log Incident</span>
          </motion.button>
        </div>
      </div>

      {/* Broadcast */}
      <motion.button
        whileTap={{ scale: 0.96 }}
        className="w-full bg-primary text-primary-foreground rounded-2xl py-4 font-semibold text-sm flex items-center justify-center gap-2"
      >
        <Megaphone className="w-4 h-4" />
        Broadcast to Screens
      </motion.button>
    </div>
  );
};

export default OpsScreen;
