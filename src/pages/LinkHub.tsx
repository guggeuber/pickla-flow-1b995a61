import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  User,
  ChevronUp,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, useRef, useCallback, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import picklaLogo from "@/assets/pickla-logo.svg";

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const BASE_URL = `https://${PROJECT_ID}.supabase.co/functions/v1`;

interface Story {
  id: string;
  image_url: string;
  caption: string | null;
  created_at: string;
  expires_at: string;
  venue_id: string | null;
}

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

function useStories() {
  return useQuery({
    queryKey: ["community-stories"],
    staleTime: 30000,
    queryFn: async () => {
      const { data } = await supabase
        .from("community_stories" as any)
        .select("id, image_url, caption, created_at, expires_at, venue_id")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(20);
      return (data || []) as unknown as Story[];
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

function getTodayHoursString(openingHours: any[]): string {
  if (!openingHours?.length) return "";
  const now = new Date();
  const day = now.getDay();
  const todayHours = openingHours.find((h: any) => h.day_of_week === day);
  if (!todayHours || todayHours.is_closed) return "stängt idag";
  return `${todayHours.open_time.slice(0, 5).replace(":", "")}–${todayHours.close_time.slice(0, 5).replace(":", "")}`;
}

const LinkHub = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const slug = searchParams.get("v") || "pickla-arena-sthlm";

  const { data, isLoading } = usePublicVenue(slug);
  const { data: stories } = useStories();

  const venue = data?.venue;
  const openingHours = data?.openingHours || [];
  const open = useMemo(() => isOpenNow(openingHours), [openingHours]);
  const hoursStr = useMemo(() => getTodayHoursString(openingHours), [openingHours]);

  const [currentStory, setCurrentStory] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showContent, setShowContent] = useState(false);

  // Auto-advance stories
  useEffect(() => {
    if (!stories?.length || showContent) return;
    const timer = setTimeout(() => {
      setCurrentStory((c) => (c + 1) % stories.length);
    }, 5000);
    return () => clearTimeout(timer);
  }, [currentStory, stories, showContent]);

  // Touch handling for vertical swipe
  const touchStart = useRef<number | null>(null);
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStart.current = e.touches[0].clientY;
  }, []);
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStart.current === null) return;
    const diff = touchStart.current - e.changedTouches[0].clientY;
    if (diff > 60) {
      // Swiped up — show content panel
      setShowContent(true);
    } else if (diff < -60 && showContent) {
      setShowContent(false);
    }
    touchStart.current = null;
  }, [showContent]);

  // Tap left/right to change story
  const handleStoryTap = useCallback((e: React.MouseEvent) => {
    if (!stories?.length) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < rect.width / 3) {
      setCurrentStory((c) => Math.max(0, c - 1));
    } else if (x > (rect.width * 2) / 3) {
      setCurrentStory((c) => Math.min(stories.length - 1, c + 1));
    }
  }, [stories]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#000" }}>
        <Loader2 className="w-6 h-6 animate-spin text-white" />
      </div>
    );
  }

  const hasStories = stories && stories.length > 0;
  const activeStory = hasStories ? stories[currentStory] : null;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 flex flex-col"
      style={{ background: "#000" }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* ═══ FULLSCREEN STORY BACKGROUND ═══ */}
      <div className="absolute inset-0" onClick={handleStoryTap}>
        <AnimatePresence mode="wait">
          {activeStory ? (
            <motion.img
              key={activeStory.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              src={activeStory.image_url}
              alt={activeStory.caption || ""}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : venue?.cover_image_url ? (
            <motion.img
              key="venue-cover"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              src={venue.cover_image_url}
              alt={venue.name}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0" style={{ background: "#F5D5D5" }} />
          )}
        </AnimatePresence>

        {/* Gradient overlays for readability */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "linear-gradient(to bottom, rgba(0,0,0,0.45) 0%, transparent 35%, transparent 65%, rgba(0,0,0,0.5) 100%)",
          }}
        />
      </div>

      {/* ═══ STORY PROGRESS BARS ═══ */}
      {hasStories && (
        <div className="absolute top-[env(safe-area-inset-top,12px)] left-4 right-4 flex gap-1 z-20 pt-3">
          {stories.map((_, i) => (
            <div
              key={i}
              className="flex-1 h-[2px] rounded-full overflow-hidden"
              style={{ background: "rgba(255,255,255,0.3)" }}
            >
              <motion.div
                className="h-full rounded-full bg-white"
                initial={{ width: i < currentStory ? "100%" : "0%" }}
                animate={{
                  width: i < currentStory ? "100%" : i === currentStory ? "100%" : "0%",
                }}
                transition={
                  i === currentStory
                    ? { duration: 5, ease: "linear" }
                    : { duration: 0 }
                }
              />
            </div>
          ))}
        </div>
      )}

      {/* ═══ TOP OVERLAY: Logo + Status ═══ */}
      <div className="relative z-10 px-5 pt-10">
        <motion.img
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          src={picklaLogo}
          alt="Pickla"
          className="h-12 w-auto"
          style={{ filter: "brightness(0) invert(1)" }}
        />
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="mt-1.5 flex items-center gap-2"
        >
          <span
            className="text-sm font-semibold tracking-wide"
            style={{
              color: open ? "#00E676" : "rgba(255,255,255,0.6)",
              fontFamily: "'Space Grotesk', monospace",
              textDecoration: "underline",
              textDecorationColor: open ? "rgba(0,230,118,0.3)" : "rgba(255,255,255,0.2)",
              textUnderlineOffset: "3px",
            }}
          >
            idag {open ? "öppet" : "stängt"} {hoursStr && open ? hoursStr : ""}
          </span>
        </motion.div>

        {/* Address line */}
        {venue?.address && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="mt-0.5 text-xs font-bold uppercase tracking-widest"
            style={{
              color: "#00E676",
              fontFamily: "'Space Grotesk', monospace",
            }}
          >
            {venue.address}{venue.phone ? `, ${venue.phone}` : ""}
          </motion.p>
        )}
      </div>

      {/* ═══ CAPTION (if story has one) ═══ */}
      {activeStory?.caption && (
        <div className="relative z-10 mt-auto px-5 mb-2">
          <p
            className="text-white text-sm font-semibold"
            style={{ textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}
          >
            {activeStory.caption}
          </p>
        </div>
      )}

      {/* ═══ SWIPE UP INDICATOR ═══ */}
      <motion.div
        className="relative z-10 flex flex-col items-center pb-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        {!showContent && (
          <motion.div
            animate={{ y: [0, -6, 0] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="flex flex-col items-center cursor-pointer"
            onClick={() => setShowContent(true)}
          >
            <ChevronUp className="w-5 h-5 text-white/60" />
          </motion.div>
        )}
      </motion.div>

      {/* ═══ BOTTOM NAV BAR ═══ */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="relative z-20 flex items-center justify-between px-6 pb-[env(safe-area-inset-bottom,16px)] pt-3"
        style={{
          background: "linear-gradient(to top, rgba(0,0,0,0.6), transparent)",
        }}
      >
        <a
          href="https://chat.whatsapp.com/pickla"
          target="_blank"
          rel="noopener noreferrer"
          className="text-white/90 text-sm font-semibold underline underline-offset-2 decoration-white/30 active:opacity-70 transition-opacity"
          style={{ fontFamily: "'Space Grotesk', monospace" }}
        >
          join whatsapp
        </a>

        <a
          href="https://pickla.xyz/book"
          target="_blank"
          rel="noopener noreferrer"
          className="text-white/90 text-sm font-semibold underline underline-offset-2 decoration-white/30 active:opacity-70 transition-opacity"
          style={{ fontFamily: "'Space Grotesk', monospace" }}
        >
          book
        </a>

        <button
          onClick={() => {
            if (user) {
              navigate(`/my?v=${slug}`);
            } else {
              navigate(`/auth?redirect=/my&v=${slug}`);
            }
          }}
          className="text-white/90 active:opacity-70 transition-opacity p-1"
        >
          <User className="w-5 h-5" />
        </button>
      </motion.div>

      {/* ═══ SWIPE-UP CONTENT PANEL ═══ */}
      <AnimatePresence>
        {showContent && (
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="absolute inset-0 z-30 flex flex-col overflow-y-auto"
            style={{ background: "#F5D5D5" }}
          >
            {/* Drag handle */}
            <div className="sticky top-0 z-10 flex justify-center pt-3 pb-2" style={{ background: "#F5D5D5" }}>
              <button
                onClick={() => setShowContent(false)}
                className="w-10 h-1 rounded-full active:opacity-60"
                style={{ background: "rgba(62,61,57,0.3)" }}
              />
            </div>

            <div className="px-5 pb-20 flex flex-col gap-5">
              {/* Quick actions */}
              <div className="flex gap-3">
                <a
                  href="https://pickla.xyz/book"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-4 rounded-xl text-xs font-bold tracking-wider text-center active:scale-95 transition-transform"
                  style={{
                    background: "rgba(62,61,57,0.04)",
                    border: "1.5px solid rgba(62,61,57,0.2)",
                    color: "#3E3D39",
                    fontFamily: "'Space Grotesk', monospace",
                  }}
                >
                  BOKA BANA
                </a>
                <a
                  href="https://games.pickla.xyz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-4 rounded-xl text-xs font-bold tracking-wider text-center active:scale-95 transition-transform"
                  style={{
                    background: "rgba(245,220,190,0.4)",
                    border: "1.5px solid rgba(62,61,57,0.1)",
                    color: "#3E3D39",
                    fontFamily: "'Space Grotesk', monospace",
                  }}
                >
                  event
                </a>
              </div>

              {/* Community link */}
              <button
                onClick={() => navigate("/community")}
                className="rounded-xl p-4 flex items-center gap-3 active:scale-[0.97] transition-transform text-left"
                style={{
                  background: "rgba(255,255,255,0.6)",
                  border: "1.5px solid rgba(62,61,57,0.1)",
                }}
              >
                <span className="text-sm font-semibold" style={{ color: "#3E3D39" }}>Community</span>
                <span className="text-xs" style={{ color: "rgba(62,61,57,0.5)" }}>Ranking, Crews & Clash →</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default LinkHub;
