import { motion } from "framer-motion";
import { Activity, Users, TrendingUp, Zap, ChevronRight, Check } from "lucide-react";

const courts = [
  { id: 1, name: "Court 1", status: "free" as const },
  { id: 2, name: "Court 2", status: "active" as const, players: "Sarah M. vs Jake T.", time: "12 min left" },
  { id: 3, name: "Court 3", status: "soon" as const, time: "Starts 2:30" },
  { id: 4, name: "Court 4", status: "free" as const },
  { id: 5, name: "Court 5", status: "vip" as const, players: "Corp Event", time: "45 min left" },
  { id: 6, name: "Court 6", status: "active" as const, players: "Mike R. vs Ana P.", time: "28 min left" },
];

const upcoming = [
  { time: "2:30", court: "Court 3", customer: "Emma Wilson", paid: true, checkedIn: false },
  { time: "3:00", court: "Court 1", customer: "Tom Harris", paid: false, checkedIn: false },
  { time: "3:00", court: "Court 4", customer: "Lisa Chen", paid: true, checkedIn: false },
  { time: "3:30", court: "Court 2", customer: "David Park", paid: true, checkedIn: false },
];

const statusConfig = {
  free: { class: "court-free", label: "Free" },
  active: { class: "court-active", label: "In Play" },
  soon: { class: "court-soon", label: "Soon" },
  vip: { class: "court-vip", label: "VIP" },
};

const TodayScreen = () => {
  return (
    <div className="pb-24 px-4 pt-2 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-muted-foreground text-sm">Tuesday, Feb 17</p>
          <h1 className="text-2xl font-display font-bold tracking-tight">Today</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-court-free pulse-live" />
          <span className="text-xs font-medium text-muted-foreground">Live</span>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Revenue", value: "$2,847", icon: TrendingUp, trend: "+12%" },
          { label: "Occupancy", value: "67%", icon: Activity, trend: "4/6 courts" },
          { label: "Walk-ins", value: "14", icon: Zap, trend: "+3 vs avg" },
          { label: "Check-ins", value: "8/12", icon: Users, trend: "4 pending" },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, duration: 0.4 }}
            className="stat-card"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <stat.icon className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-medium text-muted-foreground">{stat.label}</span>
            </div>
            <p className="text-xl font-display font-bold text-foreground">{stat.value}</p>
            <p className="text-[11px] text-primary font-medium mt-0.5">{stat.trend}</p>
          </motion.div>
        ))}
      </div>

      {/* Court Grid */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Courts</h2>
        <div className="grid grid-cols-3 gap-2.5">
          {courts.map((court, i) => (
            <motion.button
              key={court.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3 + i * 0.05 }}
              className={`court-cell ${statusConfig[court.status].class}`}
              whileTap={{ scale: 0.92 }}
            >
              <span className="text-[11px] font-semibold opacity-70">{court.name}</span>
              <span className="text-xs font-bold">{statusConfig[court.status].label}</span>
              {court.time && (
                <span className="text-[10px] opacity-70">{court.time}</span>
              )}
            </motion.button>
          ))}
        </div>
        <div className="flex items-center gap-4 mt-3 px-1">
          {Object.entries(statusConfig).map(([key, val]) => (
            <div key={key} className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full`} style={{ background: `hsl(var(--court-${key}))` }} />
              <span className="text-[10px] text-muted-foreground">{val.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Upcoming */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Upcoming</h2>
        <div className="space-y-2">
          {upcoming.map((booking, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.5 + i * 0.08 }}
              className="glass-card rounded-2xl p-3.5 flex items-center gap-3"
            >
              <div className="text-center min-w-[44px]">
                <p className="text-sm font-display font-bold">{booking.time}</p>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{booking.customer}</p>
                <p className="text-xs text-muted-foreground">{booking.court}</p>
              </div>
              <span className={`status-chip ${booking.paid ? 'bg-badge-paid text-badge-paid-foreground' : 'bg-badge-unpaid text-badge-unpaid-foreground'}`}>
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
    </div>
  );
};

export default TodayScreen;
