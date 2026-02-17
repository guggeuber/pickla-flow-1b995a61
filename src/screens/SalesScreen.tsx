import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Users, Zap, Star, ChevronRight } from "lucide-react";

const nudges = [
  { text: "3 customers played 3x this week — sell Play membership", icon: Star, action: "View" },
  { text: "Court utilization low 2–4 PM — push happy hour pricing", icon: Zap, action: "Details" },
];

const SalesScreen = () => {
  return (
    <div className="pb-24 px-4 pt-2 space-y-5">
      <h1 className="text-2xl font-display font-bold tracking-tight">Sales</h1>

      {/* Revenue Hero */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card rounded-2xl p-5 text-center"
      >
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Revenue Today</p>
        <p className="text-4xl font-display font-bold text-foreground animate-count-up">$2,847</p>
        <div className="flex items-center justify-center gap-1 mt-2">
          <TrendingUp className="w-3.5 h-3.5 text-revenue-up" />
          <span className="text-sm font-semibold text-revenue-up">+12% vs yesterday</span>
        </div>
      </motion.div>

      {/* Breakdown */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Walk-ins", value: "$1,680", pct: "59%", trend: "up" },
          { label: "Prepaid", value: "$1,167", pct: "41%", trend: "down" },
          { label: "Memberships", value: "3 sold", sub: "$597", trend: "up" },
          { label: "Upsells", value: "$240", sub: "Drinks + Gear", trend: "up" },
        ].map((item, i) => (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + i * 0.08 }}
            className="stat-card"
          >
            <p className="text-xs text-muted-foreground mb-1">{item.label}</p>
            <p className="text-lg font-display font-bold">{item.value}</p>
            <div className="flex items-center gap-1 mt-0.5">
              {item.trend === "up" ? (
                <TrendingUp className="w-3 h-3 text-revenue-up" />
              ) : (
                <TrendingDown className="w-3 h-3 text-revenue-down" />
              )}
              <span className="text-[11px] text-muted-foreground">{item.pct || item.sub}</span>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Staff Performance */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Your Shift</h2>
        <div className="glass-card rounded-2xl p-4 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm">Bookings made</span>
            <span className="font-display font-bold text-lg">8</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm">Upsells</span>
            <span className="font-display font-bold text-lg">3</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm">Check-ins</span>
            <span className="font-display font-bold text-lg">12</span>
          </div>
          <div className="w-full bg-border rounded-full h-2 mt-2">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: "72%" }}
              transition={{ delay: 0.5, duration: 0.8 }}
              className="bg-primary h-2 rounded-full"
            />
          </div>
          <p className="text-xs text-muted-foreground">72% of daily target</p>
        </div>
      </div>

      {/* Nudges */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">💡 Sales Nudges</h2>
        <div className="space-y-2">
          {nudges.map((nudge, i) => (
            <motion.button
              key={i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.6 + i * 0.1 }}
              whileTap={{ scale: 0.97 }}
              className="w-full glass-card rounded-2xl p-4 flex items-start gap-3 text-left animate-glow"
            >
              <nudge.icon className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
              <span className="text-sm flex-1">{nudge.text}</span>
              <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SalesScreen;
