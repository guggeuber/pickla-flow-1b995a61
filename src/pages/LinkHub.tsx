import { motion } from "framer-motion";
import {
  MessageCircle,
  Instagram,
  Calendar,
  Ticket,
  Gamepad2,
  Bot,
  ChevronRight,
  MapPin,
  Clock,
  Users,
  Music,
  Beer,
} from "lucide-react";

/* ── Featured event / happening ── */
const featuredEvent = {
  tag: "FREDAGSKLUBBEN",
  title: "OASEN",
  subtitle: "Happy Hour varje fredag 16–LATE",
  details: "Craft beer • DJ • Pickleball • Vibes",
  emoji: "🍻",
};

/* ── Quick actions (high-priority CTAs) ── */
const quickActions = [
  {
    title: "Boka Bana",
    icon: Calendar,
    url: "https://pickla.xyz/book",
    color: "primary" as const,
  },
  {
    title: "Dagspass",
    icon: Ticket,
    url: "https://pickla.xyz/daypass",
    color: "sell" as const,
  },
  {
    title: "Live Games",
    icon: Gamepad2,
    url: "https://games.pickla.xyz",
    color: "success" as const,
  },
];

/* ── Community links ── */
const communityLinks = [
  {
    title: "WhatsApp Community",
    description: "500+ spelare — häng med i chatten",
    icon: MessageCircle,
    url: "https://chat.whatsapp.com/pickla",
    color: "success" as const,
    memberCount: "500+",
  },
  {
    title: "Instagram",
    description: "@picklaparks — följ oss",
    icon: Instagram,
    url: "https://instagram.com/picklaparks",
    color: "court-vip" as const,
  },
  {
    title: "Chatta med oss",
    description: "Frågor? Vi svarar direkt",
    icon: Bot,
    url: "https://pickla.xyz/chat",
    color: "primary" as const,
  },
];

const colorMap: Record<string, { bg: string; border: string; icon: string; solid: string }> = {
  primary: {
    bg: "hsl(var(--primary) / 0.1)",
    border: "hsl(var(--primary) / 0.3)",
    icon: "hsl(var(--primary))",
    solid: "hsl(var(--primary))",
  },
  sell: {
    bg: "hsl(var(--sell) / 0.1)",
    border: "hsl(var(--sell) / 0.3)",
    icon: "hsl(var(--sell))",
    solid: "hsl(var(--sell))",
  },
  success: {
    bg: "hsl(var(--success) / 0.1)",
    border: "hsl(var(--success) / 0.3)",
    icon: "hsl(var(--success))",
    solid: "hsl(var(--success))",
  },
  "court-vip": {
    bg: "hsl(var(--court-vip) / 0.1)",
    border: "hsl(var(--court-vip) / 0.3)",
    icon: "hsl(var(--court-vip))",
    solid: "hsl(var(--court-vip))",
  },
};

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.15 },
  },
};

const item = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 26 } },
};

const LinkHub = () => {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center px-4 pt-8 pb-12">
      {/* ── Header ── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, type: "spring" }}
        className="flex flex-col items-center mb-6"
      >
        {/* Logo circle */}
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center mb-3 shadow-lg"
          style={{
            background: "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--sell)))",
            boxShadow: "0 8px 32px hsl(var(--primary) / 0.3)",
          }}
        >
          <span className="text-3xl font-black text-primary-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>P</span>
        </div>

        <h1 className="text-2xl font-black tracking-tight text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          PICKLA
        </h1>
        <div className="flex items-center gap-1.5 mt-1 text-muted-foreground">
          <MapPin className="w-3 h-3" />
          <span className="text-xs">Solna Business Park, Stockholm</span>
        </div>

        {/* Open now badge */}
        <div className="flex items-center gap-2 mt-3 px-3 py-1 rounded-full" style={{ background: "hsl(var(--success) / 0.1)", border: "1px solid hsl(var(--success) / 0.2)" }}>
          <span className="w-2 h-2 rounded-full bg-success pulse-live" />
          <span className="text-xs text-success font-semibold tracking-wide">ÖPPET NU</span>
        </div>
      </motion.div>

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="w-full max-w-sm flex flex-col gap-4"
      >
        {/* ── Featured Event Card ── */}
        <motion.div
          variants={item}
          className="relative rounded-2xl overflow-hidden p-5"
          style={{
            background: "linear-gradient(135deg, hsl(var(--primary) / 0.15), hsl(var(--sell) / 0.1), hsl(var(--court-vip) / 0.08))",
            border: "1.5px solid hsl(var(--primary) / 0.25)",
          }}
        >
          {/* Shimmer overlay */}
          <div
            className="absolute inset-0 opacity-20 animate-sell-shimmer pointer-events-none"
            style={{
              background: "linear-gradient(90deg, transparent 0%, hsl(var(--primary) / 0.4) 50%, transparent 100%)",
              backgroundSize: "200% auto",
            }}
          />
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-primary text-primary-foreground">
                {featuredEvent.tag}
              </span>
              <div className="flex items-center gap-1 text-muted-foreground">
                <Clock className="w-3 h-3" />
                <span className="text-[10px]">Varje fredag</span>
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <h2 className="text-3xl font-black text-foreground tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                {featuredEvent.title}
              </h2>
              <span className="text-2xl">{featuredEvent.emoji}</span>
            </div>
            <p className="text-sm text-foreground/80 font-medium mt-1">{featuredEvent.subtitle}</p>
            <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><Beer className="w-3.5 h-3.5" /> Craft beer</span>
              <span className="flex items-center gap-1"><Music className="w-3.5 h-3.5" /> DJ</span>
              <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> Community</span>
            </div>
          </div>
        </motion.div>

        {/* ── Quick Action Buttons (horizontal row) ── */}
        <motion.div variants={item} className="grid grid-cols-3 gap-2">
          {quickActions.map((action) => {
            const colors = colorMap[action.color];
            return (
              <a
                key={action.title}
                href={action.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center gap-2 rounded-2xl p-4 transition-all duration-200 active:scale-95"
                style={{
                  background: colors.bg,
                  border: `1.5px solid ${colors.border}`,
                }}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: `${colors.solid}20` }}
                >
                  <action.icon className="w-5 h-5" style={{ color: colors.icon }} />
                </div>
                <span className="text-xs font-semibold text-foreground text-center leading-tight">
                  {action.title}
                </span>
              </a>
            );
          })}
        </motion.div>

        {/* ── Section label ── */}
        <motion.div variants={item} className="flex items-center gap-2 mt-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Community</span>
          <div className="flex-1 h-px bg-border" />
        </motion.div>

        {/* ── Community Links ── */}
        {communityLinks.map((link) => {
          const colors = colorMap[link.color];
          return (
            <motion.a
              key={link.title}
              variants={item}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative rounded-2xl p-4 flex items-center gap-3.5 transition-all duration-200 active:scale-[0.97]"
              style={{
                background: colors.bg,
                border: `1.5px solid ${colors.border}`,
              }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
            >
              {/* Icon */}
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: `${colors.solid}15` }}
              >
                <link.icon className="w-5 h-5" style={{ color: colors.icon }} />
              </div>

              {/* Text */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-foreground font-semibold text-sm">{link.title}</span>
                  {link.memberCount && (
                    <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold" style={{ background: `${colors.solid}20`, color: colors.icon }}>
                      {link.memberCount}
                    </span>
                  )}
                </div>
                <span className="text-muted-foreground text-xs mt-0.5 block">{link.description}</span>
              </div>

              {/* Arrow */}
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
            </motion.a>
          );
        })}

        {/* ── Upcoming events teaser ── */}
        <motion.div
          variants={item}
          className="rounded-2xl p-4 text-center"
          style={{
            background: "hsl(var(--surface-1))",
            border: "1px solid hsl(var(--border))",
          }}
        >
          <span className="text-lg mb-1 block">🏆</span>
          <p className="text-xs font-semibold text-foreground">Pickla Open</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Turneringar & events — kommer snart</p>
          <a
            href="https://games.pickla.xyz"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-2 text-[11px] font-semibold text-primary hover:underline"
          >
            Se kommande events <ChevronRight className="w-3 h-3" />
          </a>
        </motion.div>
      </motion.div>

      {/* ── Footer ── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7 }}
        className="mt-8 text-center"
      >
        <p className="text-muted-foreground text-[10px] tracking-wide">
          picklaparks.com ⚡ Solna, Stockholm
        </p>
      </motion.div>
    </div>
  );
};

export default LinkHub;
