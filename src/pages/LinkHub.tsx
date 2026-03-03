import { motion } from "framer-motion";
import { Loader2, User } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import picklaLogo from "@/assets/pickla-logo.svg";
import { format } from "date-fns";

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

interface UpcomingEvent {
  id: string;
  name: string;
  display_name: string | null;
  start_date: string | null;
  logo_url: string | null;
  category: string;
  slug: string | null;
}

function useUpcomingEvents(venueId: string | undefined) {
  return useQuery({
    queryKey: ["upcoming-events", venueId],
    enabled: !!venueId,
    staleTime: 60000,
    queryFn: async () => {
      const { data } = await supabase
        .from("events")
        .select("id, name, display_name, start_date, show_on_sticker, logo_url, category, slug")
        .eq("venue_id", venueId!)
        .eq("show_on_sticker", true)
        .gte("start_date", new Date().toISOString().slice(0, 10))
        .order("start_date", { ascending: true })
        .limit(4);
      return (data || []) as unknown as UpcomingEvent[];
    },
  });
}

function useCategoryLogos(venueId: string | undefined) {
  return useQuery({
    queryKey: ["venue-cat-logos", venueId],
    enabled: !!venueId,
    staleTime: 60000,
    queryFn: async () => {
      const { data } = await supabase
        .from("venue_event_categories")
        .select("category_key, logo_url")
        .eq("venue_id", venueId!);
      const map: Record<string, string> = {};
      data?.forEach((d: any) => { if (d.logo_url) map[d.category_key] = d.logo_url; });
      return map;
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
  const { data: upcomingEvents } = useUpcomingEvents(venue?.id);
  const { data: catLogos } = useCategoryLogos(venue?.id);
  const openingHours = data?.openingHours || [];
  const open = useMemo(() => isOpenNow(openingHours), [openingHours]);
  const hoursStr = useMemo(() => getTodayHoursString(openingHours), [openingHours]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <Loader2 className="w-6 h-6 animate-spin text-white" />
      </div>
    );
  }

  const hasStories = stories && stories.length > 0;

  // Combine venue cover + stories into one image feed
  const allImages: { id: string; url: string; caption: string | null }[] = [];
  if (hasStories) {
    stories.forEach((s) => allImages.push({ id: s.id, url: s.image_url, caption: s.caption }));
  }
  if (!allImages.length && venue?.cover_image_url) {
    allImages.push({ id: "venue-cover", url: venue.cover_image_url, caption: venue.name });
  }

  return (
    <div className="min-h-screen" style={{ background: "#1a1e2e" }}>
      {/* ═══ STICKY TOP: Logo + Status ═══ */}
      <header
        className="fixed top-0 left-0 right-0 z-40 px-5 pt-[env(safe-area-inset-top,12px)] pb-3 flex items-end justify-between"
        style={{
          background: "linear-gradient(to bottom, rgba(26,30,46,0.8) 0%, rgba(26,30,46,0.4) 50%, transparent 100%)",
        }}
      >
        <div className="pt-2">
          <img
            src={picklaLogo}
            alt="Pickla"
            className="h-14 w-auto"
            style={{ filter: "brightness(0) invert(1)" }}
          />
          <div className="mt-1 flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-full inline-block"
              style={{ background: open ? "#00E676" : "rgba(255,255,255,0.35)" }}
            />
            <span
              className="text-[13px] font-bold tracking-wider uppercase"
              style={{
                color: open ? "#00E676" : "rgba(255,255,255,0.5)",
                fontFamily: "'Space Mono', monospace",
              }}
            >
              {open ? "öppet" : "stängt"} {hoursStr}
            </span>
          </div>
          <div className="mt-1 flex flex-col gap-0.5">
            <a href="https://maps.google.com/?q=Svetsarvägen+22,+171+41+Solna" target="_blank" rel="noopener noreferrer" className="text-[11px] text-white/50 underline underline-offset-2 decoration-white/20 active:opacity-60 transition-opacity" style={{ fontFamily: "'Space Mono', monospace" }}>
              Svetsarvägen 22, Solna
            </a>
            <a href="mailto:hello@picklaparks.com" className="text-[11px] text-white/50 active:opacity-60 transition-opacity" style={{ fontFamily: "'Space Mono', monospace" }}>
              hello@picklaparks.com
            </a>
            <a href="tel:+46883363" className="text-[11px] text-white/50 active:opacity-60 transition-opacity" style={{ fontFamily: "'Space Mono', monospace" }}>
              08-83 33 63
            </a>
          </div>
        </div>
      </header>

      {/* ═══ SCROLLABLE IMAGE FEED ═══ */}
      <main>
        {allImages.length > 0 ? (
          allImages.map((img, i) => (
            <div
              key={img.id}
              className="relative w-full"
            >
              <img
                src={img.url}
                alt={img.caption || ""}
                className="w-full block"
                style={{ minHeight: "60vh", objectFit: "contain" }}
                loading={i > 0 ? "lazy" : "eager"}
              />
              {/* Caption overlay at bottom of each image */}
              {img.caption && i !== 0 && (
                <div
                  className="absolute bottom-0 left-0 right-0 px-5 pb-5 pt-16"
                  style={{
                    background: "linear-gradient(to top, rgba(26,30,46,0.6), transparent)",
                  }}
                >
                  <p
                    className="text-white text-lg font-bold"
                    style={{
                      fontFamily: "'Space Mono', monospace",
                      textShadow: "0 1px 6px rgba(0,0,0,0.4)",
                    }}
                  >
                    {img.caption}
                  </p>
                </div>
              )}
            </div>
          ))
        ) : (
          <div
            className="w-full flex items-center justify-center"
            style={{ height: "80vh", background: "#F5D5D5" }}
          >
            <img
              src={picklaLogo}
              alt="Pickla"
              className="h-16 w-auto opacity-30"
            />
          </div>
        )}

        {/* Spacer so content isn't hidden behind bottom bar */}
        <div className="h-20" />
      </main>

      {/* ═══ FIXED BOTTOM NAV ═══ */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-between px-6 pb-8 pt-12"
        style={{
          background: "linear-gradient(to top, rgba(26,30,46,0.95) 0%, rgba(26,30,46,0.7) 40%, rgba(26,30,46,0.3) 70%, transparent 100%)",
        }}
      >
        <a
          href="https://chat.whatsapp.com/pickla"
          target="_blank"
          rel="noopener noreferrer"
          className="text-white/90 text-[15px] font-bold underline underline-offset-4 decoration-white/25 active:opacity-60 transition-opacity"
          style={{ fontFamily: "'Space Mono', monospace" }}
        >
          join whatsapp
        </a>

        <a
          href="https://pickla.xyz/book"
          target="_blank"
          rel="noopener noreferrer"
          className="text-white/90 text-[15px] font-bold underline underline-offset-4 decoration-white/25 active:opacity-60 transition-opacity"
          style={{ fontFamily: "'Space Mono', monospace" }}
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
          className="text-white/90 active:opacity-60 transition-opacity p-1"
        >
          <User className="w-6 h-6" />
        </button>
      </nav>

      {/* Floating event stickers — fixed on screen */}
      {upcomingEvents && upcomingEvents.length > 0 && (
        <div className="fixed left-0 top-[65%] z-30 flex flex-col items-start gap-2">
          {upcomingEvents.map((evt) => {
            const logo = evt.logo_url || catLogos?.[evt.category];
            return (
              <button
                key={evt.id}
                onClick={() => navigate(evt.slug ? `/e/${evt.slug}` : `/event/${evt.id}`)}
                className="inline-flex items-center gap-2.5 pl-3 pr-2.5 py-2 active:scale-95 transition-transform text-left"
                style={{
                  background: "rgba(255,255,255,0.92)",
                  backdropFilter: "blur(8px)",
                  fontFamily: "'Space Mono', monospace",
                }}
              >
                {logo && (
                  <img src={logo} alt="" className="h-6 max-w-[28px] object-contain flex-shrink-0" />
                )}
                <span
                  className="text-[14px] font-bold underline underline-offset-4"
                  style={{ color: "#2a3a8f" }}
                >
                  {(evt.display_name || evt.name).toLowerCase()}{" "}
                  {evt.start_date ? format(new Date(evt.start_date), "d/M") : ""}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default LinkHub;
