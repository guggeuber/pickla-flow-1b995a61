import { motion, AnimatePresence } from "framer-motion";
import { Activity, Users, TrendingUp, Zap, Check, Clock, ChevronRight, Timer, Plus, ArrowRight, X } from "lucide-react";
import { useState, useEffect } from "react";

type CourtStatus = "free" | "active" | "soon" | "vip";

interface Court {
  id: number;
  name: string;
  status: CourtStatus;
  players?: string;
  endsAt?: number;
  startsAt?: string;
}

const initialCourts: Court[] = [
  { id: 1, name: "Court 1", status: "free" },
  { id: 2, name: "Court 2", status: "active", players: "Sarah M.", endsAt: Date.now() + 12 * 60000 },
  { id: 3, name: "Court 3", status: "soon", startsAt: "2:30 PM" },
  { id: 4, name: "Court 4", status: "free" },
  { id: 5, name: "Court 5", status: "vip", players: "Corp Event", endsAt: Date.now() + 45 * 60000 },
  { id: 6, name: "Court 6", status: "active", players: "Mike R.", endsAt: Date.now() + 28 * 60000 },
];

const upcoming = [
  { time: "2:30", court: "Court 3", customer: "Emma Wilson", paid: true },
  { time: "3:00", court: "Court 1", customer: "Tom Harris", paid: false },
  { time: "3:00", court: "Court 4", customer: "Lisa Chen", paid: true },
  { time: "3:30", court: "Court 2", customer: "David Park", paid: true },
];

const statusConfig: Record<CourtStatus, { class: string; label: string; dot: string }> = {
  free: { class: "court-free", label: "Free", dot: "bg-court-free" },
  active: { class: "court-active", label: "In Play", dot: "bg-court-active" },
  soon: { class: "court-soon", label: "Ending Soon", dot: "bg-court-soon" },
  vip: { class: "court-vip", label: "VIP", dot: "bg-court-vip" },
};

const courtActions = [
  { label: "Check In", icon: Check, color: "bg-court-free text-court-free" },
  { label: "Extend 30 min", icon: Timer, color: "bg-primary/15 text-primary" },
  { label: "Add Drinks", icon: Plus, color: "bg-sell/15 text-sell" },
  { label: "Move Court", icon: ArrowRight, color: "bg-badge-vip/15 text-badge-vip" },
];

function useRealtimeClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function formatCountdown(endsAt: number, now: number) {
  const diff = Math.max(0, endsAt - now);
  const m = Math.floor(diff / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function getVenueStatus(occupancy: number) {
  if (occupancy >= 80) return { label: "Peak", color: "bg-court-active", textColor: "text-court-active" };
  if (occupancy >= 50) return { label: "Live", color: "bg-court-free", textColor: "text-court-free" };
  return { label: "Quiet", color: "bg-court-soon", textColor: "text-court-soon" };
}

const TodayScreen = () => {
  const now = useRealtimeClock();
  const [selectedCourt, setSelectedCourt] = useState<Court | null>(null);
  const occupancy = 67;
  const venueStatus = getVenueStatus(occupancy);

  return (
    <div className="pb-24 px-4 pt-2 space-y-4">
      {/* Top Bar — Control Tower */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${venueStatus.color} pulse-live`} />
          <span className={`text-xs font-bold uppercase tracking-wider ${venueStatus.textColor}`}>{venueStatus.label}</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1" style={{ background: 'hsl(var(--surface-2))' }}>
          <Clock className="w-3 h-3 text-primary" />
          <span className="text-sm font-bold tabular-nums">
            {now.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        </div>
      </div>

      {/* Revenue Strip — instant comprehension */}
      <div className="revenue-hero rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Today</p>
            <p className="text-2xl font-display font-bold text-foreground">12 400 kr</p>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-1 justify-end">
              <TrendingUp className="w-3 h-3 text-revenue-up" />
              <span className="text-xs font-bold text-revenue-up">+12%</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">{occupancy}% occupied · 14 check-ins</p>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: "Courts", value: "4/6", icon: Activity },
          { label: "Walk-ins", value: "14", icon: Zap },
          { label: "Pending", value: "4", icon: Users },
          { label: "Upsells", value: "3", icon: TrendingUp },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="rounded-xl p-2.5 text-center"
            style={{ background: 'hsl(var(--surface-1))' }}
          >
            <stat.icon className="w-3.5 h-3.5 text-primary mx-auto mb-1" />
            <p className="text-base font-display font-bold">{stat.value}</p>
            <p className="text-[9px] text-muted-foreground">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Court Grid — Large Tap Targets */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Courts</h2>
          <div className="flex gap-3">
            {Object.entries(statusConfig).map(([key, val]) => (
              <div key={key} className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${val.dot}`} />
                <span className="text-[9px] text-muted-foreground">{val.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {initialCourts.map((court, i) => (
            <motion.button
              key={court.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1 + i * 0.04 }}
              className={`court-cell min-h-[80px] ${statusConfig[court.status].class}`}
              whileTap={{ scale: 0.92 }}
              onClick={() => setSelectedCourt(court)}
            >
              <span className="text-[10px] font-bold opacity-60">{court.name}</span>
              <span className="text-xs font-extrabold">{statusConfig[court.status].label}</span>
              {court.players && (
                <span className="text-[9px] opacity-70 truncate max-w-full">{court.players}</span>
              )}
              {court.endsAt && (
                <span className="text-lg font-display font-black tabular-nums">
                  {formatCountdown(court.endsAt, now.getTime())}
                </span>
              )}
              {court.startsAt && (
                <span className="text-[10px] opacity-60">{court.startsAt}</span>
              )}
            </motion.button>
          ))}
        </div>
      </div>

      {/* Upcoming Check-ins */}
      <div>
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Upcoming</h2>
        <div className="space-y-1.5">
          {upcoming.map((booking, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + i * 0.06 }}
              className="glass-card rounded-2xl p-3 flex items-center gap-3"
            >
              <div className="text-center min-w-[40px]">
                <p className="text-sm font-display font-bold text-primary">{booking.time}</p>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{booking.customer}</p>
                <p className="text-[11px] text-muted-foreground">{booking.court}</p>
              </div>
              <span className={`status-chip text-[9px] ${booking.paid ? 'bg-badge-paid/15 text-badge-paid' : 'bg-badge-unpaid/15 text-badge-unpaid'}`}>
                {booking.paid ? "Paid" : "Unpaid"}
              </span>
              <motion.button
                whileTap={{ scale: 0.85 }}
                className="tap-target rounded-xl bg-primary text-primary-foreground w-9 h-9 flex items-center justify-center"
              >
                <Check className="w-4 h-4" />
              </motion.button>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Court Action Sheet — DoorDash style */}
      <AnimatePresence>
        {selectedCourt && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm"
              onClick={() => setSelectedCourt(null)}
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-50 max-w-md mx-auto rounded-t-3xl p-5 pb-10 space-y-3"
              style={{ background: 'hsl(var(--surface-1))', borderTop: '1px solid hsl(var(--border))' }}
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="text-lg font-display font-bold">{selectedCourt.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {statusConfig[selectedCourt.status].label}
                    {selectedCourt.players && ` · ${selectedCourt.players}`}
                    {selectedCourt.endsAt && ` · ${formatCountdown(selectedCourt.endsAt, now.getTime())} left`}
                  </p>
                </div>
                <motion.button whileTap={{ scale: 0.9 }} onClick={() => setSelectedCourt(null)} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'hsl(var(--surface-3))' }}>
                  <X className="w-4 h-4" />
                </motion.button>
              </div>
              {courtActions.map((action, i) => (
                <motion.button
                  key={action.label}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  whileTap={{ scale: 0.97 }}
                  className="action-sheet-item"
                >
                  <div className={`w-10 h-10 rounded-xl ${action.color} flex items-center justify-center`}>
                    <action.icon className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-semibold flex-1">{action.label}</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </motion.button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default TodayScreen;
