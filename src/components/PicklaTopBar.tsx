import { ArrowRight, BarChart3, Calendar, LogIn, Menu, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  getBookingChatResourceId,
  getBookingCourtLabel,
  groupBookingRows,
} from "@/lib/bookingGroups";
import picklaLogo from "@/assets/pickla-logo.svg";

const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

type PicklaTopBarProps = {
  slug?: string;
  venueName?: string;
  venueOpen?: boolean;
  showVenue?: boolean;
  onVenueClick?: () => void;
  background?: string;
};

function useRecentBookings(userId?: string) {
  return useQuery({
    queryKey: ["topbar-recent-bookings", userId],
    enabled: !!userId,
    staleTime: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("*, venue_courts(name)")
        .eq("user_id", userId!)
        .in("status", ["confirmed", "pending"])
        .order("start_time", { ascending: false })
        .limit(30);
      if (error) throw error;
      return groupBookingRows(data || []);
    },
  });
}

function formatBookingTime(booking: any) {
  const start = new Date(booking.start_time);
  const end = new Date(booking.end_time);
  return `${start.toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" })} ${start.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}-${end.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}`;
}

export function PicklaTopBar({
  slug = "pickla-arena-sthlm",
  venueName = "Pickla Stockholm",
  venueOpen = true,
  showVenue = true,
  onVenueClick,
  background = "#fffaf7",
}: PicklaTopBarProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const { data: recentBookings = [] } = useRecentBookings(user?.id);
  const visibleBookings = useMemo(() => recentBookings, [recentBookings]);

  const go = (href: string) => {
    setOpen(false);
    navigate(href);
  };

  return (
    <>
      <header
        className="fixed left-0 right-0 top-0 z-50 border-b border-black/5 px-5 pb-3 pt-[calc(env(safe-area-inset-top,0px)+14px)] backdrop-blur-xl"
        style={{ background: `${background}f2` }}
      >
        <div className={`mx-auto grid max-w-md items-center gap-3 ${showVenue ? "grid-cols-[40px_auto_minmax(0,1fr)]" : "grid-cols-[40px_1fr_40px]"}`}>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-black/10 bg-white text-neutral-950 shadow-sm active:scale-[0.98]"
            aria-label="Öppna meny"
          >
            <Menu className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={() => navigate(`/?v=${encodeURIComponent(slug)}`)}
            className={`shrink-0 active:scale-[0.98] ${showVenue ? "" : "justify-self-center"}`}
            aria-label="Till startsidan"
          >
            <img src={picklaLogo} alt="Pickla" className="h-8 w-auto" />
          </button>

          {showVenue && (
            <button
              type="button"
              onClick={onVenueClick}
              className="min-w-0 flex-1 justify-center flex items-center gap-1.5 rounded-full bg-white px-3 py-2 text-[12px] shadow-sm active:scale-[0.98]"
              style={{ fontFamily: FONT_MONO }}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: venueOpen ? "#32ef87" : "#d1d5db" }} />
              <span className="truncate">{venueName}</span>
            </button>
          )}

          {!showVenue && <div className="h-10 w-10" />}
        </div>
      </header>

      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-[80]">
            <motion.button
              type="button"
              aria-label="Stäng meny"
              className="absolute inset-0 bg-black/35 backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />

            <motion.aside
              className="absolute bottom-0 left-0 top-0 flex w-[min(86vw,390px)] flex-col overflow-hidden bg-white shadow-2xl"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 32, stiffness: 360 }}
            >
              <div className="flex items-center justify-between px-5 pb-4 pt-[calc(env(safe-area-inset-top,0px)+22px)]">
              <div>
                <p className="text-[10px] uppercase tracking-[0.24em] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
                  meny
                </p>
                <h2 className="mt-1 text-[25px] font-black leading-none text-neutral-950" style={{ fontFamily: FONT_HEADING }}>
                  Pickla
                </h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-full p-2 text-neutral-950">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-7 overflow-y-auto px-5 pb-32">
              <section className="space-y-2">
                {[
                  ["Boka pickleball", `/book?v=${slug}&sport=pickleball`],
                  ["Boka darts", `/book?v=${slug}&sport=dart`],
                  ["Boka event", `/book/group?v=${slug}`],
                ].map(([label, href]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => go(href)}
                    className="flex w-full items-center justify-between rounded-2xl border border-neutral-200 bg-white px-4 py-4 text-left text-neutral-950"
                    style={{ fontFamily: FONT_HEADING }}
                  >
                    <span>{label}</span>
                    <Plus className="h-5 w-5 text-neutral-500" />
                  </button>
                ))}
              </section>

              {user && (
                <section className="space-y-2">
                  <p className="px-1 text-[10px] uppercase tracking-[0.24em] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
                    mina senaste bokningar
                  </p>
                  {visibleBookings.length > 0 ? (
                    visibleBookings.map((booking: any) => {
                      const ref = booking.primary_booking_ref || booking.booking_ref || booking.id || getBookingChatResourceId(booking);
                      return (
                        <button
                          key={getBookingChatResourceId(booking) || ref}
                          type="button"
                          onClick={() => go(`/my?booking=${encodeURIComponent(ref)}&v=${encodeURIComponent(slug)}`)}
                          className="flex w-full items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-left text-neutral-950"
                        >
                          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#f4f0ee] text-neutral-950">
                            <Calendar className="h-5 w-5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-bold" style={{ fontFamily: FONT_HEADING }}>
                              {getBookingCourtLabel(booking)}
                            </span>
                            <span className="block truncate text-[12px] text-neutral-500">
                              {formatBookingTime(booking)}
                            </span>
                          </span>
                          <ArrowRight className="h-4 w-4 shrink-0 text-neutral-400" />
                        </button>
                      );
                    })
                  ) : (
                    <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-4 text-[13px] text-neutral-500">
                      Inga bokningar ännu
                    </div>
                  )}
                </section>
              )}

              <section className="space-y-2">
                {user && (
                  <button
                    type="button"
                    onClick={() => go(`/stats?v=${slug}`)}
                    className="flex w-full items-center justify-between rounded-2xl border border-neutral-200 bg-white px-4 py-4 text-left text-neutral-950"
                    style={{ fontFamily: FONT_HEADING }}
                  >
                    <span className="flex items-center gap-3">
                      <BarChart3 className="h-5 w-5 text-neutral-500" />
                      Min statistik
                    </span>
                    <ArrowRight className="h-4 w-4 text-neutral-400" />
                  </button>
                )}
              </section>
            </div>

            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-white via-white to-white/70 px-5 pb-[calc(env(safe-area-inset-bottom,0px)+18px)] pt-5">
              <button
                type="button"
                onClick={() => go(user ? `/my?v=${slug}` : `/auth?redirect=/my&v=${slug}`)}
                className="flex w-full items-center gap-3 rounded-2xl border border-neutral-200 bg-[#fffaf7] px-4 py-3 text-left shadow-sm"
              >
                {user ? (
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-neutral-950 text-sm font-black text-white" style={{ fontFamily: FONT_HEADING }}>
                    {(user.email || "P").slice(0, 1).toUpperCase()}
                  </span>
                ) : (
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-neutral-950 text-white">
                    <LogIn className="h-5 w-5" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold text-neutral-950" style={{ fontFamily: FONT_HEADING }}>
                    {user ? "Min sida" : "Logga in"}
                  </span>
                  <span className="block truncate text-[12px] text-neutral-500">
                    {user ? user.email : "Fortsätt till ditt konto"}
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 text-neutral-400" />
              </button>
            </div>
          </motion.aside>
        </div>
        )}
      </AnimatePresence>
    </>
  );
}
