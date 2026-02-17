import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Wrench, Radio, Megaphone, CheckCircle2, Circle, Clock, Sparkles } from "lucide-react";
import { useState } from "react";

interface ShiftTask {
  id: number;
  text: string;
  done: boolean;
  category: "clean" | "restock" | "check" | "close";
  time?: string;
}

const initialShiftTasks: ShiftTask[] = [
  { id: 1, text: "Städa toaletter", category: "clean", time: "Var 2:e timme", done: false },
  { id: 2, text: "Torka av bänkar & bord", category: "clean", done: false },
  { id: 3, text: "Fyll på handdukar", category: "restock", done: false },
  { id: 4, text: "Kontrollera nät alla banor", category: "check", done: false },
  { id: 5, text: "Fyll på kyl & snacks", category: "restock", done: false },
  { id: 6, text: "Sopa banorna", category: "clean", time: "Var 3:e timme", done: false },
  { id: 7, text: "Töm papperskorgar", category: "clean", done: false },
  { id: 8, text: "Kolla belysning", category: "check", done: false },
  { id: 9, text: "Stäng av musik & lampor", category: "close", time: "Vid stängning", done: false },
  { id: 10, text: "Lås in utrustning", category: "close", time: "Vid stängning", done: false },
];

const categoryConfig = {
  clean: { label: "Städ", emoji: "🧹" },
  restock: { label: "Påfyllning", emoji: "📦" },
  check: { label: "Kontroll", emoji: "👀" },
  close: { label: "Stängning", emoji: "🔒" },
};

const incidents = [
  { time: "1:45 PM", text: "Net loose on Court 3", status: "open" },
  { time: "11:20 AM", text: "Light flickering Court 5", status: "resolved" },
];

const OpsScreen = () => {
  const [eventMode, setEventMode] = useState(false);
  const [tasks, setTasks] = useState<ShiftTask[]>(initialShiftTasks);

  const toggleTask = (id: number) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));
  };

  const doneCount = tasks.filter(t => t.done).length;
  const totalCount = tasks.length;
  const progress = Math.round((doneCount / totalCount) * 100);

  const grouped = Object.keys(categoryConfig).map(key => ({
    key: key as keyof typeof categoryConfig,
    ...categoryConfig[key as keyof typeof categoryConfig],
    tasks: tasks.filter(t => t.category === key),
  }));

  return (
    <div className="pb-24 px-4 pt-2 space-y-5">
      <h1 className="text-2xl font-display font-bold tracking-tight">Ops</h1>

      {/* Shift Checklist */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Passlistа</h2>
          <div className="flex items-center gap-2">
            {progress === 100 && <Sparkles className="w-3.5 h-3.5 text-sell" />}
            <span className={`text-sm font-display font-bold ${progress === 100 ? 'text-court-free' : 'text-foreground'}`}>
              {doneCount}/{totalCount}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full h-2 bg-secondary rounded-full mb-4 overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ background: progress === 100 ? 'hsl(var(--court-free))' : 'hsl(var(--primary))' }}
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ type: "spring", stiffness: 100, damping: 20 }}
          />
        </div>

        <div className="space-y-4">
          {grouped.map(group => (
            <div key={group.key}>
              <p className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1.5">
                <span>{group.emoji}</span>
                {group.label}
              </p>
              <div className="space-y-1.5">
                {group.tasks.map(task => (
                  <motion.button
                    key={task.id}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => toggleTask(task.id)}
                    className={`w-full rounded-2xl p-3.5 flex items-center gap-3 text-left transition-all duration-200 ${
                      task.done ? 'bg-court-free/10 border border-court-free/20' : 'glass-card'
                    }`}
                  >
                    <motion.div
                      animate={task.done ? { scale: [1, 1.3, 1] } : {}}
                      transition={{ duration: 0.3 }}
                    >
                      {task.done ? (
                        <CheckCircle2 className="w-5 h-5 text-court-free flex-shrink-0" />
                      ) : (
                        <Circle className="w-5 h-5 text-muted-foreground/40 flex-shrink-0" />
                      )}
                    </motion.div>
                    <span className={`text-sm font-medium flex-1 transition-all ${task.done ? 'line-through text-muted-foreground' : ''}`}>
                      {task.text}
                    </span>
                    {task.time && (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1 flex-shrink-0">
                        <Clock className="w-2.5 h-2.5" />
                        {task.time}
                      </span>
                    )}
                  </motion.button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

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
