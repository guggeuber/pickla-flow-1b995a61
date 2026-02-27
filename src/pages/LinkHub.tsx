import { motion } from "framer-motion";
import {
  MessageCircle,
  Instagram,
  Calendar,
  Ticket,
  Gamepad2,
  Bot,
  ExternalLink,
  Zap,
} from "lucide-react";

const links = [
  {
    title: "Boka Bana",
    description: "Reservera din bana direkt",
    icon: Calendar,
    url: "https://pickla.xyz/book",
    color: "primary" as const,
    highlight: true,
  },
  {
    title: "Köp Dagspass",
    description: "Spela hela dagen — ett pris",
    icon: Ticket,
    url: "https://pickla.xyz/daypass",
    color: "sell" as const,
    highlight: true,
  },
  {
    title: "Live Games",
    description: "Följ matcher & resultat live",
    icon: Gamepad2,
    url: "https://games.pickla.xyz",
    color: "success" as const,
  },
  {
    title: "WhatsApp Community",
    description: "Gå med i vår community",
    icon: MessageCircle,
    url: "https://chat.whatsapp.com/pickla",
    color: "success" as const,
  },
  {
    title: "Instagram",
    description: "@pickla.xyz — följ oss",
    icon: Instagram,
    url: "https://instagram.com/pickla.xyz",
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

const colorMap: Record<string, { bg: string; border: string; icon: string }> = {
  primary: {
    bg: "hsl(var(--primary) / 0.1)",
    border: "hsl(var(--primary) / 0.25)",
    icon: "hsl(var(--primary))",
  },
  sell: {
    bg: "hsl(var(--sell) / 0.1)",
    border: "hsl(var(--sell) / 0.25)",
    icon: "hsl(var(--sell))",
  },
  success: {
    bg: "hsl(var(--success) / 0.1)",
    border: "hsl(var(--success) / 0.25)",
    icon: "hsl(var(--success))",
  },
  "court-vip": {
    bg: "hsl(var(--court-vip) / 0.1)",
    border: "hsl(var(--court-vip) / 0.25)",
    icon: "hsl(var(--court-vip))",
  },
};

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.07, delayChildren: 0.2 },
  },
};

const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } },
};

const LinkHub = () => {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center px-4 py-10">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, type: "spring" }}
        className="flex flex-col items-center mb-8"
      >
        {/* Logo / Avatar */}
        <div
          className="w-24 h-24 rounded-full flex items-center justify-center mb-4 animate-glow"
          style={{
            background: "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--sell)))",
          }}
        >
          <Zap className="w-12 h-12 text-primary-foreground" />
        </div>

        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          PICKLA
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Padel & Pickleball — Stockholm
        </p>

        {/* Live indicator */}
        <div className="flex items-center gap-2 mt-3">
          <span className="w-2 h-2 rounded-full bg-success pulse-live" />
          <span className="text-xs text-success font-medium uppercase tracking-wider">
            Open Now
          </span>
        </div>
      </motion.div>

      {/* Links */}
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="w-full max-w-sm flex flex-col gap-3"
      >
        {links.map((link) => {
          const colors = colorMap[link.color] || colorMap.primary;
          return (
            <motion.a
              key={link.title}
              variants={item}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative rounded-2xl p-4 flex items-center gap-4 transition-all duration-200 active:scale-[0.97] cursor-pointer"
              style={{
                background: colors.bg,
                border: `1.5px solid ${colors.border}`,
              }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
            >
              {/* Highlight shimmer for CTAs */}
              {link.highlight && (
                <div
                  className="absolute inset-0 rounded-2xl opacity-30 animate-sell-shimmer pointer-events-none"
                  style={{
                    background: `linear-gradient(90deg, transparent 0%, ${colors.icon} 50%, transparent 100%)`,
                    backgroundSize: "200% auto",
                    mixBlendMode: "overlay",
                  }}
                />
              )}

              {/* Icon */}
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: `${colors.icon}20` }}
              >
                <link.icon className="w-5 h-5" style={{ color: colors.icon }} />
              </div>

              {/* Text */}
              <div className="flex-1 min-w-0">
                <span className="text-foreground font-semibold text-sm block">
                  {link.title}
                </span>
                <span className="text-muted-foreground text-xs block mt-0.5">
                  {link.description}
                </span>
              </div>

              {/* Arrow */}
              <ExternalLink
                className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              />
            </motion.a>
          );
        })}
      </motion.div>

      {/* Footer */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="mt-10 text-center"
      >
        <p className="text-muted-foreground text-xs">
          ⚡ Powered by Pickla
        </p>
      </motion.div>
    </div>
  );
};

export default LinkHub;
