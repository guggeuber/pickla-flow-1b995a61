import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import picklaLogo from "@/assets/pickla-logo.svg";
import { CalendarDays, ArrowLeft } from "lucide-react";
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

function useUpcomingEvents() {
  return useQuery({
    queryKey: ["public-events-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, name, display_name, slug, start_date, start_time, entry_fee, entry_fee_type, is_drop_in, logo_url, category, sport_type")
        .in("status", ["upcoming", "active"])
        .eq("is_public", true)
        .order("start_date", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });
}

const EventsListPage = () => {
  const navigate = useNavigate();
  const { data: events, isLoading } = useUpcomingEvents();

  const formatDate = (d: string | null) => {
    if (!d) return "";
    return DateTime.fromISO(d, { zone: "utc" }).setZone("Europe/Stockholm").toFormat("d MMM", { locale: "sv" });
  };

  const formatTime = (t: string | null) => {
    if (!t) return "";
    return t.slice(0, 5);
  };

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
        <h1 className="text-[22px] font-bold tracking-tight" style={{ fontFamily: FONT_HEADING }}>Aktiviteter</h1>
        <p className="text-[13px] mt-1" style={{ color: TEXT_MUTED, fontFamily: FONT_MONO }}>Turneringar, stegar och community-events</p>
      </div>

      {/* Events */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center py-16">
          <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: `${DARK_BLUE} transparent ${DARK_BLUE} transparent` }} />
        </div>
      ) : !events?.length ? (
        <div className="flex-1 flex flex-col items-center justify-center py-16 text-center">
          <CalendarDays className="w-10 h-10 mb-3" style={{ color: PINK }} />
          <p className="text-[15px] font-semibold" style={{ fontFamily: FONT_HEADING }}>Inga kommande events just nu</p>
          <p className="text-[12px] mt-1" style={{ color: TEXT_MUTED, fontFamily: FONT_MONO }}>Håll utkik — nya events dyker upp snart!</p>
        </div>
      ) : (
        <motion.div variants={container} initial="hidden" animate="show" className="w-full max-w-md flex flex-col gap-2.5 pb-8">
          {events.map((ev) => (
            <motion.div
              key={ev.id}
              variants={item}
              onClick={() => navigate(ev.slug ? `/e/${ev.slug}` : `/event/${ev.id}`)}
              className="rounded-2xl p-4 cursor-pointer active:scale-[0.98] transition-transform"
              style={{ background: "#FFFFFF", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
            >
              <div className="flex items-start gap-3">
                {ev.logo_url && (
                  <img src={ev.logo_url} alt="" className="w-10 h-10 rounded-xl object-cover flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[15px] font-bold tracking-tight truncate" style={{ fontFamily: FONT_HEADING }}>
                      {ev.display_name || ev.name}
                    </h2>
                    {ev.is_drop_in && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: PINK, color: "#fff" }}>
                        Drop-in
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[12px]" style={{ color: TEXT_MUTED, fontFamily: FONT_MONO }}>
                      {formatDate(ev.start_date)}
                      {ev.start_time && ` · ${formatTime(ev.start_time)}`}
                    </span>
                    {ev.entry_fee != null && ev.entry_fee > 0 && (
                      <span className="text-[12px] font-semibold" style={{ color: DARK_BLUE, fontFamily: FONT_MONO }}>
                        {ev.entry_fee_type === "day_pass" ? "Dagspass" : `${ev.entry_fee} kr`}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
};

export default EventsListPage;
