import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Flame, ChevronRight, Target, ShoppingBag, Gift, Crown, Trophy, Zap } from "lucide-react";

const walkInOffers = [
  { title: "Förläng till 90 min", sub: "+120 kr — 68% accepterar", icon: Target, tag: "Hot" },
  { title: "Dryckespaket", sub: "+89 kr — 2 vatten + smoothie", icon: ShoppingBag, tag: "Bästsäljare" },
  { title: "First Timer → Play Pass", sub: "990 kr/mån — visa besparingar", icon: Gift, tag: "Konvertera" },
  { title: "VIP Upgrade", sub: "Bana 5, premium — +150 kr", icon: Crown, tag: "Premium" },
];

const SalesScreen = () => {
  return (
    <div className="pb-24 px-4 pt-2 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold tracking-tight">Sell</h1>
        <div className="flex items-center gap-1.5 bg-primary/10 rounded-lg px-2.5 py-1">
          <Flame className="w-3.5 h-3.5 text-primary" />
          <span className="text-[10px] font-bold text-primary uppercase tracking-wider">Sell Mode</span>
        </div>
      </div>

      {/* Revenue Hero — BIG number */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="revenue-hero rounded-2xl p-6 text-center">
        <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Intäkt idag</p>
        <p className="text-5xl font-display font-black text-foreground animate-count-up">12 400</p>
        <p className="text-lg font-display font-bold text-muted-foreground -mt-1">kr</p>
        <div className="flex items-center justify-center gap-1 mt-2">
          <TrendingUp className="w-3.5 h-3.5 text-revenue-up" />
          <span className="text-sm font-bold text-revenue-up">+12% vs igår</span>
        </div>
      </motion.div>

      {/* Walk-in Upsells — action center */}
      <div>
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2 flex items-center gap-1.5">
          <Flame className="w-3.5 h-3.5 text-primary" /> Upsell-möjligheter
        </h2>
        <div className="space-y-1.5">
          {walkInOffers.map((offer, i) => (
            <motion.button key={offer.title} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.06 }} whileTap={{ scale: 0.97 }} className="w-full sell-block rounded-2xl p-4 flex items-center gap-3 text-left">
              <div className="w-10 h-10 rounded-xl bg-sell/15 text-sell flex items-center justify-center flex-shrink-0">
                <offer.icon className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold">{offer.title}</p>
                <p className="text-[11px] text-muted-foreground">{offer.sub}</p>
              </div>
              <span className="text-[9px] px-2 py-1 rounded-full bg-sell/15 text-sell font-bold">{offer.tag}</span>
            </motion.button>
          ))}
        </div>
      </div>

      {/* Breakdown */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: "Walk-ins", value: "6 800 kr", sub: "59%", trend: "up" },
          { label: "Prepaid", value: "5 600 kr", sub: "41%", trend: "down" },
          { label: "Medlemskap", value: "3 sålda", sub: "5 970 kr", trend: "up" },
          { label: "Upsells", value: "2 400 kr", sub: "Dryck + Gear", trend: "up" },
        ].map((item, i) => (
          <motion.div key={item.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + i * 0.06 }} className="stat-card">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{item.label}</p>
            <p className="text-base font-display font-bold">{item.value}</p>
            <div className="flex items-center gap-1 mt-0.5">
              {item.trend === "up" ? <TrendingUp className="w-3 h-3 text-revenue-up" /> : <TrendingDown className="w-3 h-3 text-revenue-down" />}
              <span className="text-[10px] text-muted-foreground">{item.sub}</span>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Staff Performance — Gamified */}
      <div>
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2 flex items-center gap-1.5">
          <Trophy className="w-3.5 h-3.5 text-sell" /> Ditt pass
        </h2>
        <div className="glass-card rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
                <Zap className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-bold">8 bokningar · 3 upsells</p>
                <p className="text-[10px] text-muted-foreground">12 check-ins idag</p>
              </div>
            </div>
            <span className="text-2xl font-display font-black text-primary">72%</span>
          </div>
          <div className="w-full h-2.5 rounded-full overflow-hidden" style={{ background: 'hsl(var(--surface-3))' }}>
            <motion.div initial={{ width: 0 }} animate={{ width: "72%" }} transition={{ delay: 0.4, duration: 0.8 }} className="bg-primary h-full rounded-full" />
          </div>
          <p className="text-xs text-muted-foreground">72% av dagsmål — <span className="text-primary font-bold">pusha för 100%! 🔥</span></p>

          {/* Streak */}
          <div className="flex items-center gap-2 bg-court-free/10 rounded-xl p-3 animate-streak">
            <span className="text-xl">🔥</span>
            <div>
              <p className="text-sm font-bold text-court-free">3 upsells i rad!</p>
              <p className="text-[10px] text-muted-foreground">Bästa streak idag</p>
            </div>
          </div>
        </div>
      </div>

      {/* Nudges */}
      <div className="space-y-1.5">
        {[
          { text: "3 kunder spelat 3x denna vecka → sälj Play-medlem", hot: true },
          { text: "Låg beläggning 14–16 → kör happy hour-pris", hot: false },
        ].map((nudge, i) => (
          <motion.button key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 + i * 0.08 }} whileTap={{ scale: 0.97 }} className={`w-full glass-card rounded-2xl p-3.5 flex items-center gap-3 text-left ${nudge.hot ? 'animate-glow' : ''}`}>
            <Zap className="w-4 h-4 text-primary flex-shrink-0" />
            <span className="text-sm flex-1">{nudge.text}</span>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </motion.button>
        ))}
      </div>
    </div>
  );
};

export default SalesScreen;
