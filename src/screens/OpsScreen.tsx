import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Wrench, Radio, Megaphone, CheckCircle2, Circle, Clock, Sparkles, Flame, Trophy } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

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
  { id: 11, text: "Sluträkning kassa", category: "close", time: "Vid stängning", done: false },
  { id: 12, text: "Rapportera skador", category: "check", done: false },
];

const categoryConfig = {
  clean: { label: "Städ", emoji: "🧹" },
  restock: { label: "Påfyllning", emoji: "📦" },
  check: { label: "Kontroll", emoji: "👀" },
  close: { label: "Stängning", emoji: "🔒" },
};

const incidents = [
  { time: "13:45", text: "Nät löst på Bana 3", status: "open" },
  { time: "11:20", text: "Lampa blinkar Bana 5", status: "resolved" },
];

const OpsScreen = () => {
  const [eventMode, setEventMode] = useState(false);
  const [tasks, setTasks] = useState<ShiftTask[]>(initialShiftTasks);
  const navigate = useNavigate();
  const toggleTask = (id: number) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));
  };

  const doneCount = tasks.filter(t => t.done).length;
  const totalCount = tasks.length;
  const progress = Math.round((doneCount / totalCount) * 100);
  const streak = (() => {
    let count = 0;
    for (const t of tasks) { if (t.done) count++; else break; }
    return count;
  })();

  const grouped = Object.keys(categoryConfig).map(key => ({
    key: key as keyof typeof categoryConfig,
    ...categoryConfig[key as keyof typeof categoryConfig],
    tasks: tasks.filter(t => t.category === key),
  }));

  return (
    <div className="pb-24 px-4 pt-2 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold tracking-tight">Ops</h1>
        {progress === 100 && <div className="flex items-center gap-1.5 bg-court-free/10 rounded-lg px-2.5 py-1"><Sparkles className="w-3.5 h-3.5 text-court-free" /><span className="text-[10px] font-bold text-court-free uppercase">Klart!</span></div>}
      </div>

      {/* Shift Progress — Hero */}
      <div className="glass-card rounded-2xl p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Passlistа</p>
            <p className="text-2xl font-display font-bold">{doneCount}<span className="text-muted-foreground text-base">/{totalCount}</span></p>
          </div>
          <div className="text-right">
            <p className={`text-3xl font-display font-black ${progress === 100 ? 'text-court-free' : 'text-primary'}`}>{progress}%</p>
          </div>
        </div>
        <div className="w-full h-2.5 rounded-full overflow-hidden" style={{ background: 'hsl(var(--surface-3))' }}>
          <motion.div className="h-full rounded-full" style={{ background: progress === 100 ? 'hsl(var(--court-free))' : 'hsl(var(--primary))' }} initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ type: "spring", stiffness: 100, damping: 20 }} />
        </div>
        {streak >= 3 && (
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 mt-3 bg-sell/10 rounded-xl p-2.5 animate-streak">
            <Flame className="w-4 h-4 text-sell" />
            <span className="text-xs font-bold text-sell">{streak} i rad! 🔥</span>
          </motion.div>
        )}
      </div>

      {/* Task Groups */}
      <div className="space-y-3">
        {grouped.map(group => {
          const groupDone = group.tasks.filter(t => t.done).length;
          const groupTotal = group.tasks.length;
          return (
            <div key={group.key}>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
                  <span>{group.emoji}</span>{group.label}
                </p>
                <span className={`text-[10px] font-bold ${groupDone === groupTotal ? 'text-court-free' : 'text-muted-foreground'}`}>{groupDone}/{groupTotal}</span>
              </div>
              <div className="space-y-1">
                {group.tasks.map(task => (
                  <motion.button key={task.id} whileTap={{ scale: 0.97 }} onClick={() => toggleTask(task.id)} className={`w-full rounded-2xl p-3 flex items-center gap-3 text-left transition-all ${task.done ? 'bg-court-free/8 border border-court-free/15' : 'glass-card'}`}>
                    <motion.div animate={task.done ? { scale: [1, 1.3, 1] } : {}} transition={{ duration: 0.3 }}>
                      {task.done ? <CheckCircle2 className="w-5 h-5 text-court-free flex-shrink-0" /> : <Circle className="w-5 h-5 text-muted-foreground/30 flex-shrink-0" />}
                    </motion.div>
                    <span className={`text-sm font-medium flex-1 ${task.done ? 'line-through text-muted-foreground' : ''}`}>{task.text}</span>
                    {task.time && <span className="text-[9px] text-muted-foreground flex items-center gap-1 flex-shrink-0"><Clock className="w-2.5 h-2.5" />{task.time}</span>}
                  </motion.button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Event Ops CTA */}
      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={() => navigate("/event-ops")}
        className="w-full rounded-2xl p-4 flex items-center gap-3 border border-court-vip/30"
        style={{ background: "linear-gradient(135deg, hsl(270 55% 55% / 0.1), hsl(24 85% 52% / 0.08))" }}
      >
        <div className="w-10 h-10 rounded-xl bg-court-vip/20 flex items-center justify-center">
          <Trophy className="w-5 h-5 text-court-vip" />
        </div>
        <div className="flex-1 text-left">
          <p className="text-sm font-bold">Event Ops</p>
          <p className="text-[10px] text-muted-foreground">Live banstyrning & poängrapportering</p>
        </div>
        <Radio className="w-4 h-4 text-court-vip" />
      </motion.button>

      {/* Event Mode */}
      <div className="glass-card rounded-2xl p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Radio className={`w-5 h-5 ${eventMode ? 'text-court-active' : 'text-muted-foreground'}`} />
          <div>
            <p className="text-sm font-semibold">Event Mode</p>
            <p className="text-[10px] text-muted-foreground">Låser bokningar, aktiverar event-UI</p>
          </div>
        </div>
        <motion.button whileTap={{ scale: 0.9 }} onClick={() => setEventMode(!eventMode)} className={`w-12 h-7 rounded-full relative transition-colors duration-200 ${eventMode ? 'bg-primary' : 'bg-border'}`}>
          <motion.div animate={{ x: eventMode ? 22 : 2 }} transition={{ type: "spring", stiffness: 500, damping: 30 }} className="absolute top-1 w-5 h-5 rounded-full bg-foreground shadow-md" />
        </motion.button>
      </div>

      {/* Court Maintenance */}
      <div>
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Banunderhåll</h2>
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3, 4, 5, 6].map(court => (
            <motion.button key={court} whileTap={{ scale: 0.92 }} className="glass-card rounded-xl p-3 text-center">
              <Wrench className="w-3.5 h-3.5 mx-auto text-muted-foreground mb-1" />
              <span className="text-xs font-semibold">Bana {court}</span>
              <span className="text-[9px] text-revenue-up block mt-0.5 font-bold">OK</span>
            </motion.button>
          ))}
        </div>
      </div>

      {/* Incidents */}
      <div>
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Incidentlogg</h2>
        <div className="space-y-1.5">
          {incidents.map((inc, i) => (
            <div key={i} className="glass-card rounded-2xl p-3 flex items-center gap-3">
              <AlertTriangle className={`w-4 h-4 flex-shrink-0 ${inc.status === 'open' ? 'text-badge-unpaid' : 'text-muted-foreground'}`} />
              <div className="flex-1">
                <p className="text-sm font-medium">{inc.text}</p>
                <p className="text-[10px] text-muted-foreground">{inc.time}</p>
              </div>
              <span className={`status-chip text-[9px] ${inc.status === 'open' ? 'bg-badge-unpaid/15 text-badge-unpaid' : 'bg-muted text-muted-foreground'}`}>{inc.status === 'open' ? 'Öppen' : 'Löst'}</span>
            </div>
          ))}
          <motion.button whileTap={{ scale: 0.97 }} className="w-full glass-card rounded-2xl p-3 flex items-center justify-center gap-2 text-primary">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm font-semibold">Logga incident</span>
          </motion.button>
        </div>
      </div>

      {/* Broadcast */}
      <motion.button whileTap={{ scale: 0.96 }} className="w-full bg-primary text-primary-foreground rounded-2xl py-4 font-semibold text-sm flex items-center justify-center gap-2">
        <Megaphone className="w-4 h-4" />
        Broadcast till skärmar
      </motion.button>
    </div>
  );
};

export default OpsScreen;
