import { motion } from "framer-motion";
import {
  ChevronRight,
  Loader2,
  User,
  type LucideIcon,
  MessageCircle,
  Instagram,
  Bot,
  Calendar,
  Ticket,
  Gamepad2,
  Link as LinkIcon,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import picklaLogo from "@/assets/pickla-logo.svg";

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const BASE_URL = `https://${PROJECT_ID}.supabase.co/functions/v1`;

function usePublicVenue(slug: string) {
  return useQuery({
    queryKey: ["public-venue", slug],
    enabled: !!slug,
    staleTime: 60000,
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/api-bookings/public-venue?slug=${slug}`, {
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) return null;
      return res.json();
    },
  });
}

function isOpenNow(openingHours: any[]): boolean {
  if (!openingHours?.length) return false;
  const now = new Date();
  const day = now.getDay();
  const todayHours = openingHours.find((h: any) => h.day_of_week === day);
  if (!todayHours || todayHours.is_closed) return false;
  const timeStr = now.toTimeString().slice(0, 5);
  return timeStr >= todayHours.open_time.slice(0, 5) && timeStr < todayHours.close_time.slice(0, 5);
}

const quickActions = [
  { title: "BOKA BANA", url: "https://pickla.xyz/book" },
  { title: "DAGSPASS", url: "https://pickla.xyz/daypass" },
  { title: "EVENTS", url: "https://games.pickla.xyz" },
];

const iconMap: Record<string, LucideIcon> = {
  "message-circle": MessageCircle,
  instagram: Instagram,
  bot: Bot,
  calendar: Calendar,
  ticket: Ticket,
  gamepad2: Gamepad2,
  link: LinkIcon,
};

function resolveIcon(name: string): LucideIcon {
  return iconMap[name] || LinkIcon;
}

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.15 } } };
const item = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 26 } } };

function isInstagramUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?instagram\.com\/(p|reel)\/[\w-]+/i.test(url);
}

function getInstagramEmbedUrl(url: string): string {
  // Strip query params and ensure trailing slash, then add /embed
  const clean = url.split("?")[0].replace(/\/$/, "");
  return `${clean}/embed`;
}

function InstagramEmbed({ url }: { url: string }) {
  const embedUrl = getInstagramEmbedUrl(url);

  useEffect(() => {
    // Load Instagram embed script if not already loaded
    if (!(window as any).instgrm) {
      const script = document.createElement("script");
      script.src = "https://www.instagram.com/embed.js";
      script.async = true;
      document.body.appendChild(script);
    } else {
      (window as any).instgrm.Embeds.process();
    }
  }, [url]);

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1.5px solid rgba(62,61,57,0.1)" }}>
      <iframe
        src={embedUrl}
        className="w-full border-0"
        style={{ minHeight: 480 }}
        allowTransparency
        scrolling="no"
        title="Instagram post"
      />
    </div>
  );
}

const LinkHub = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const slug = searchParams.get("v") || "pickla-arena-sthlm";

  const { data, isLoading } = usePublicVenue(slug);

  const venue = data?.venue;
  const openingHours = data?.openingHours || [];
  const events = data?.events || [];
  const dynamicLinks = data?.links || [];
  const open = useMemo(() => isOpenNow(openingHours), [openingHours]);

  const today = new Date().toLocaleDateString("sv-SE", { day: "numeric", month: "numeric", year: "numeric" }).replace(/-/g, ".");

  const featuredEvent = events.length > 0 ? {
    tag: events[0].event_type?.toUpperCase() || "EVENT",
    title: events[0].display_name || events[0].name,
    subtitle: events[0].status === "live" ? "Pågår nu!" : events[0].start_date ? new Date(events[0].start_date).toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "short" }) : "",
  } : {
    tag: "FREDAGSKLUBBEN",
    title: "oasen fredagsklubben",
    subtitle: "Happy Hour varje fredag 16–LATE",
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#F5D5D5" }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#3E3D39" }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center px-5 pt-8 pb-16 relative" style={{ background: "#F5D5D5", color: "#3E3D39" }}>
      {/* ── Account button ── */}
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        whileTap={{ scale: 0.9 }}
        onClick={() => {
          if (user) {
            navigate(`/my?v=${slug}`);
          } else {
            navigate(`/auth?redirect=/my&v=${slug}`);
          }
        }}
        className="absolute top-4 right-4 z-10 flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors"
        style={{
          background: user ? "rgba(62,61,57,0.1)" : "rgba(62,61,57,0.06)",
          color: "#3E3D39",
          border: "1px solid rgba(62,61,57,0.15)",
        }}
      >
        <User className="w-3.5 h-3.5" />
        {user ? "Mitt konto" : "Logga in"}
      </motion.button>

      {/* ── Pickla Logo ── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, type: "spring" }}
        className="mb-8 mt-4"
      >
        <img src={picklaLogo} alt="Pickla" className="h-16 w-auto" />
      </motion.div>

      <motion.div variants={container} initial="hidden" animate="show" className="w-full max-w-sm flex flex-col gap-6">
        {/* ── Quick Action Buttons ── */}
        <motion.div variants={item} className="flex gap-3 justify-center">
          {quickActions.map((action) => (
            <a
              key={action.title}
              href={action.url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-5 py-3 rounded-lg text-xs font-bold tracking-wider transition-all duration-200 active:scale-95 text-center"
              style={{
                background: "rgba(62,61,57,0.04)",
                border: "1.5px solid rgba(62,61,57,0.2)",
                color: "#3E3D39",
                fontFamily: "'Space Grotesk', monospace",
              }}
            >
              {action.title}
            </a>
          ))}
        </motion.div>

        {/* ── Date ── */}
        <motion.div variants={item} className="px-1">
          <p className="text-lg font-bold tracking-tight" style={{ fontFamily: "'Space Grotesk', monospace", color: "#3E3D39" }}>
            {today}
          </p>
        </motion.div>

        {/* ── Featured Event Card ── */}
        <motion.div
          variants={item}
          className="relative rounded-2xl overflow-hidden"
          style={{
            background: "#fff",
            border: "1.5px solid rgba(62,61,57,0.1)",
            boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
          }}
        >
          {venue?.cover_image_url ? (
            <img
              src={venue.cover_image_url}
              alt={featuredEvent.title}
              className="w-full aspect-square object-cover"
            />
          ) : (
            <div className="w-full aspect-square flex items-center justify-center" style={{ background: "rgba(62,61,57,0.05)" }}>
              <p
                className="text-2xl font-black opacity-60"
                style={{ fontFamily: "'Space Grotesk', monospace" }}
              >
                {featuredEvent.title}
              </p>
            </div>
          )}
          {/* Overlay text at bottom of image */}
          <div className="absolute bottom-0 left-0 right-0 p-4" style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.4))" }}>
            <p className="text-white text-lg font-bold" style={{ fontFamily: "'Space Grotesk', monospace" }}>
              {featuredEvent.title}
            </p>
          </div>
          {/* Decorative swooshes */}
          <svg className="absolute -top-4 -right-4 w-24 h-24 opacity-30 pointer-events-none" viewBox="0 0 100 100" fill="none">
            <path d="M20 80 Q50 20 80 60" stroke="#E8A0A0" strokeWidth="3" strokeLinecap="round" fill="none" />
            <path d="M30 90 Q60 30 90 70" stroke="#E8A0A0" strokeWidth="2" strokeLinecap="round" fill="none" />
          </svg>
          <svg className="absolute -bottom-4 -left-4 w-24 h-24 opacity-30 pointer-events-none" viewBox="0 0 100 100" fill="none">
            <path d="M80 20 Q50 80 20 40" stroke="#E8A0A0" strokeWidth="3" strokeLinecap="round" fill="none" />
            <path d="M70 10 Q40 70 10 30" stroke="#E8A0A0" strokeWidth="2" strokeLinecap="round" fill="none" />
          </svg>
        </motion.div>

        {/* ── Open/closed status ── */}
        <motion.div variants={item} className="flex items-center gap-2 px-1">
          <span
            className={`w-2 h-2 rounded-full ${open ? "pulse-live" : ""}`}
            style={{ background: open ? "#4CAF50" : "#E53935" }}
          />
          <span className="text-xs font-semibold tracking-wide" style={{ color: open ? "#4CAF50" : "#E53935" }}>
            {open ? "ÖPPET NU" : "STÄNGT"}
          </span>
        </motion.div>

        {/* ── Community Links (dynamic from DB) ── */}
        {dynamicLinks.length > 0 && (
          <>
            <motion.div variants={item} className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "rgba(62,61,57,0.5)" }}>Community</span>
              <div className="flex-1 h-px" style={{ background: "rgba(62,61,57,0.12)" }} />
            </motion.div>

            {dynamicLinks.map((link: any) => {
              // Instagram embed for Instagram post/reel URLs
              if (isInstagramUrl(link.url)) {
                return (
                  <motion.div key={link.id} variants={item}>
                    <InstagramEmbed url={link.url} />
                  </motion.div>
                );
              }

              const Icon = resolveIcon(link.icon);
              return (
                <motion.a
                  key={link.id}
                  variants={item}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group rounded-xl p-4 flex items-center gap-3.5 transition-all duration-200 active:scale-[0.97]"
                  style={{
                    background: "rgba(255,255,255,0.6)",
                    border: "1.5px solid rgba(62,61,57,0.1)",
                  }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                >
                  {link.image_url ? (
                    <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0">
                      <img src={link.image_url} alt="" className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(62,61,57,0.06)" }}>
                      <Icon className="w-5 h-5" style={{ color: "#3E3D39" }} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-sm" style={{ color: "#3E3D39" }}>{link.title}</span>
                    {link.member_count && (
                      <span className="ml-2 px-1.5 py-0.5 rounded-full text-[9px] font-bold" style={{ background: "rgba(62,61,57,0.08)", color: "#3E3D39" }}>
                        {link.member_count}
                      </span>
                    )}
                    {link.description && (
                      <span className="text-xs mt-0.5 block" style={{ color: "rgba(62,61,57,0.5)" }}>{link.description}</span>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 shrink-0" style={{ color: "rgba(62,61,57,0.3)" }} />
                </motion.a>
              );
            })}
          </>
        )}
      </motion.div>

      {/* ── Footer — green pickla logo ── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7 }}
        className="mt-12"
      >
        <img
          src={picklaLogo}
          alt="Pickla"
          className="h-20 w-auto"
          style={{ filter: "brightness(0) saturate(100%) invert(73%) sepia(41%) saturate(632%) hue-rotate(92deg) brightness(96%) contrast(87%)" }}
        />
      </motion.div>
    </div>
  );
};

export default LinkHub;
