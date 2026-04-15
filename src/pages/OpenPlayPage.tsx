import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { apiPost } from "@/lib/api";
import { toast } from "sonner";
import picklaLogo from "@/assets/pickla-logo.svg";
import { ArrowLeft, Loader2, Zap } from "lucide-react";
import { DateTime } from "luxon";

const CREAM = "#faf8f5";
const DARK_BLUE = "#1a1f3a";
const PINK = "#e8b4b8";
const TEXT_DARK = "#1a1a1a";
const TEXT_MUTED = "rgba(26,26,26,0.55)";
const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08 } } };
const item = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 28 } } };

const DAY_NAMES = ["Söndag", "Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag"];

function useOpenPlaySessions() {
  return useQuery({
    queryKey: ["open-play-sessions"],
    queryFn: async () => {
      const { data: venue } = await supabase
        .from("venues")
        .select("id")
        .eq("slug", "pickla-arena-sthlm")
        .single();

      if (!venue) return { sessions: [], venueId: null };

      const { data, error } = await supabase
        .from("open_play_sessions")
        .select("*")
        .eq("venue_id", venue.id)
        .eq("is_active", true)
        .order("start_time", { ascending: true });

      if (error) throw error;
      return { sessions: data || [], venueId: venue.id };
    },
  });
}

const OpenPlayPage = () => {
  const navigate = useNavigate();
  const { data: queryData, isLoading } = useOpenPlaySessions();
  const sessions = queryData?.sessions ?? [];
  const venueId = queryData?.venueId ?? null;
  const [loadingSlot, setLoadingSlot] = useState<string | null>(null);

  const now = DateTime.now().setZone("Europe/Stockholm");

  const handleBuyDayPass = async (slot: { session: typeof sessions[0]; date: DateTime }) => {
    const slotKey = `${slot.session.id}-${slot.date.toISODate()}`;
    if (loadingSlot || !venueId) return;
    setLoadingSlot(slotKey);
    try {
      const result = await apiPost("api-bookings", "create-checkout", {
        product_type: "day_pass",
        amount_sek: slot.session.price_sek,
        venue_id: venueId,
        metadata: {
          session_name: slot.session.name,
          date: slot.date.toISODate(),
          open_play_session_id: slot.session.id,
        },
      });
      window.location.href = result.url;
    } catch (err: any) {
      toast.error(err.message || "Kunde inte starta betalning");
      setLoadingSlot(null);
    }
  };

  // Build a list of upcoming session slots for the next 7 days
  const upcomingSlots = (() => {
    if (!sessions?.length) return [];
    const slots: { session: typeof sessions[0]; date: DateTime; dayName: string }[] = [];
    
    for (let offset = 0; offset < 7; offset++) {
      const date = now.plus({ days: offset });
      const jsDow = date.weekday % 7; // Convert Luxon weekday to JS weekday (0=Sun)
      
      for (const s of sessions) {
        if (s.day_of_week.includes(jsDow)) {
          // Skip if session already ended today
          if (offset === 0) {
            const endParts = s.end_time.split(":");
            const endHour = parseInt(endParts[0]);
            if (now.hour >= endHour) continue;
          }
          slots.push({
            session: s,
            date,
            dayName: offset === 0 ? "Idag" : offset === 1 ? "Imorgon" : DAY_NAMES[date.weekday % 7 === 0 ? 0 : date.weekday % 7],
          });
        }
      }
    }
    return slots;
  })();

  return (
    <div
      className="min-h-[100dvh] flex flex-col items-center px-5"
      style={{ background: CREAM, color: TEXT_DARK, paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {/* Header */}
      <div className="pt-8 pb-4 w-full max-w-md flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg active:scale-95" style={{ color: TEXT_DARK }}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <img src={picklaLogo} alt="Pickla" className="h-6 w-auto" />
      </div>

      <div className="w-full max-w-md pb-2">
        <h1 className="text-[22px] font-bold tracking-tight" style={{ fontFamily: FONT_HEADING }}>Open Play</h1>
        <p className="text-[13px] mt-1" style={{ color: TEXT_MUTED, fontFamily: FONT_MONO }}>Hoppa in och spela med andra — ingen bokning krävs</p>
      </div>

      {/* Sessions */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center py-16">
          <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: `${DARK_BLUE} transparent ${DARK_BLUE} transparent` }} />
        </div>
      ) : !upcomingSlots.length ? (
        <div className="flex-1 flex flex-col items-center justify-center py-16 text-center">
          <Zap className="w-10 h-10 mb-3" style={{ color: PINK }} />
          <p className="text-[15px] font-semibold" style={{ fontFamily: FONT_HEADING }}>Inga Open Play-pass just nu</p>
          <p className="text-[12px] mt-1" style={{ color: TEXT_MUTED, fontFamily: FONT_MONO }}>Kolla tillbaka snart!</p>
        </div>
      ) : (
        <motion.div variants={container} initial="hidden" animate="show" className="w-full max-w-md flex flex-col gap-2.5 pb-8">
          {upcomingSlots.map((slot, i) => {
            const isFriday = slot.date.weekday === 5;
            return (
              <motion.div
                key={`${slot.session.id}-${slot.date.toISODate()}`}
                variants={item}
                className="rounded-2xl p-4"
                style={{ background: "#FFFFFF", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-[15px] font-bold tracking-tight" style={{ fontFamily: FONT_HEADING }}>
                        {slot.session.name}
                      </h2>
                      {isFriday && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: PINK, color: "#fff" }}>
                          After Work
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] mt-1" style={{ color: TEXT_MUTED, fontFamily: FONT_MONO }}>
                      {slot.dayName} {slot.date.toFormat("d/M")} · {slot.session.start_time.slice(0, 5)}–{slot.session.end_time.slice(0, 5)}
                    </p>
                  </div>
                  <span className="text-[15px] font-bold" style={{ fontFamily: FONT_MONO, color: DARK_BLUE }}>
                    {slot.session.price_sek} kr
                  </span>
                </div>
                <button
                  onClick={() => handleBuyDayPass(slot)}
                  disabled={!!loadingSlot}
                  className="mt-3 w-full py-2.5 rounded-xl text-[13px] font-bold transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-60"
                  style={{ background: DARK_BLUE, color: "#fff", fontFamily: FONT_MONO }}
                >
                  {loadingSlot === `${slot.session.id}-${slot.date.toISODate()}` ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Öppnar betalning…</>
                  ) : (
                    `Köp dagspass · ${slot.session.price_sek} kr →`
                  )}
                </button>
              </motion.div>
            );
          })}
        </motion.div>
      )}
    </div>
  );
};

export default OpenPlayPage;
