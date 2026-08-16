import { ArrowRight, Calendar, LogIn, Menu, ShoppingBag, X } from "lucide-react";
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useVenueStatusBySlug } from "@/lib/venueStatus";
import { useGlobalShopCartIndicator } from "@/hooks/useGlobalShopCartIndicator";
import { VenueStatusDrawer } from "@/components/VenueStatusDrawer";
import picklaLogo from "@/assets/pickla-logo.svg";
import { useMyBookings } from "@/hooks/useMyBookings";
import { buildBookingHistory, formatBookingHistoryTime } from "@/lib/bookingHistory";
import { getBookingChatResourceId, getBookingCourtLabel } from "@/lib/bookingGroups";
import { BookingStatusChip } from "@/components/bookings/BookingStatusChip";

const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

type PicklaTopBarProps = { slug?: string; venueName?: string; showVenue?: boolean; background?: string };

export function PicklaTopBar({ slug = "pickla-arena-sthlm", venueName, showVenue = true, background = "#fffaf7" }: PicklaTopBarProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [venueSheetOpen, setVenueSheetOpen] = useState(false);
  const { data: bookingRows = [] } = useMyBookings();
  const upcomingBookings = useMemo(
    () => buildBookingHistory(bookingRows).filter((booking) => booking.history_status === "upcoming"),
    [bookingRows],
  );
  const { venue, status } = useVenueStatusBySlug(slug);
  const shopCart = useGlobalShopCartIndicator(venue?.id);
  const resolvedVenueName = venueName || venue?.name?.replace("Pickla Arena ", "Pickla ") || "Pickla Stockholm";
  const venueStatusTone = status?.venueStatusTone;
  const venueOpen = Boolean(status?.open);
  const dotColor = venueStatusTone === "exception" ? "#f97316" : venueStatusTone === "closed" ? "#ef4444" : venueOpen ? "#32ef87" : "#d1d5db";
  const go = (href: string) => { setOpen(false); navigate(href); };
  const openCart = () => {
    if (!shopCart.reference) return;
    setOpen(false);
    navigate(`/cart?token=${encodeURIComponent(shopCart.reference)}&v=${encodeURIComponent(slug)}`);
  };

  return <>
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-black/5 pb-3 pt-[calc(env(safe-area-inset-top,0px)+14px)] backdrop-blur-xl" style={{ background: `${background}f2` }}>
      <div className={`mx-auto grid w-full max-w-md items-center gap-3 px-5 ${showVenue ? shopCart.count > 0 ? "grid-cols-[40px_auto_minmax(0,1fr)_40px]" : "grid-cols-[40px_auto_minmax(0,1fr)]" : "grid-cols-[40px_1fr_40px]"}`}>
        <button type="button" onClick={() => setOpen(true)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-black/10 bg-white text-neutral-950 shadow-sm active:scale-[0.98]" aria-label="Öppna meny"><Menu className="h-5 w-5" /></button>
        <button type="button" onClick={() => navigate(`/?v=${encodeURIComponent(slug)}`)} className={`shrink-0 active:scale-[0.98] ${showVenue ? "" : "justify-self-center"}`} aria-label="Till startsidan"><img src={picklaLogo} alt="Pickla Arena logo" className="h-8 w-auto" /></button>
        {showVenue ? <button type="button" onClick={() => setVenueSheetOpen(true)} title={venueStatusTone === "exception" ? "Avvikande öppettider idag" : undefined} aria-label={venueStatusTone === "exception" ? `${resolvedVenueName} – avvikande öppettider idag` : resolvedVenueName} className="min-w-0 flex flex-1 items-center justify-center gap-1.5 rounded-full bg-white px-3 py-2 text-[12px] shadow-sm active:scale-[0.98]" style={{ fontFamily: FONT_MONO }}><span className="h-2.5 w-2.5 rounded-full" style={{ background: dotColor }} /><span className="truncate">{resolvedVenueName}</span></button> : null}
        {shopCart.count > 0 ? <button type="button" onClick={openCart} aria-label={`Öppna varukorg, ${shopCart.count} ${shopCart.count === 1 ? "artikel" : "artiklar"}`} className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full border border-black/10 bg-white text-neutral-950 shadow-sm active:scale-[0.98]"><ShoppingBag className="h-5 w-5" /><span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-neutral-950 px-1 text-[10px] font-bold leading-none text-white">{shopCart.count > 99 ? "99+" : shopCart.count}</span></button> : !showVenue ? <div className="h-10 w-10" /> : null}
      </div>
    </header>

    <AnimatePresence>{open ? <div className="fixed inset-0 z-[80]">
      <motion.aside className="absolute inset-0 flex min-h-dvh w-full flex-col overflow-hidden bg-white" initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }} transition={{ type: "spring", damping: 32, stiffness: 360 }}>
        <div className="mx-auto grid w-full max-w-md grid-cols-[40px_1fr_40px] items-center gap-3 px-5 pb-4 pt-[calc(env(safe-area-inset-top,0px)+14px)]">
          <button type="button" onClick={() => setOpen(false)} className="grid h-10 w-10 place-items-center rounded-full border border-black/10 bg-white text-neutral-950 shadow-sm" aria-label="Stäng meny" data-testid="menu-close"><X className="h-5 w-5" /></button>
          <img src={picklaLogo} alt="Pickla" className="h-8 w-auto justify-self-center" />
          {shopCart.count > 0 ? <button type="button" onClick={openCart} aria-label={`Öppna varukorg, ${shopCart.count} artiklar`} className="relative grid h-10 w-10 place-items-center rounded-full border border-black/10 bg-white"><ShoppingBag className="h-5 w-5" /><span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-neutral-950 px-1 text-[10px] font-bold text-white">{shopCart.count > 99 ? "99+" : shopCart.count}</span></button> : <span className="h-10 w-10" />}
        </div>
        <nav className="mx-auto w-full max-w-md flex-1 overflow-y-auto px-5 pt-5" aria-label="Huvudmeny">
          {[["Schema", `/today?v=${encodeURIComponent(slug)}`], ["Boka bana", `/book?v=${encodeURIComponent(slug)}`], ["Kurser", `/courses?v=${encodeURIComponent(slug)}`], ["Priser & medlemskap", `/prices?v=${encodeURIComponent(slug)}`], ["Butik", `/shop?v=${encodeURIComponent(slug)}`], ["Min sida", user ? `/my?v=${encodeURIComponent(slug)}` : `/auth?redirect=${encodeURIComponent("/my")}&v=${encodeURIComponent(slug)}`]].map(([label, href]) => <button key={label} type="button" onClick={() => go(href)} className="flex min-h-16 w-full items-center justify-between border-b border-black/10 px-1 text-left text-[21px] font-bold text-neutral-950" style={{ fontFamily: FONT_HEADING }}><span>{label}</span><ArrowRight className="h-4 w-4 text-neutral-400" /></button>)}
          {user ? <section className="mt-7 space-y-2 pb-5">
            <p className="px-1 text-[10px] uppercase tracking-[0.24em] text-neutral-400" style={{ fontFamily: FONT_MONO }}>Mina bokningar</p>
            {upcomingBookings.length ? upcomingBookings.map((booking) => {
              const ref = String(booking.primary_booking_ref || booking.booking_ref || booking.id || getBookingChatResourceId(booking));
              return <button key={getBookingChatResourceId(booking) || ref} type="button" onClick={() => go(`/my?booking=${encodeURIComponent(ref)}&v=${encodeURIComponent(slug)}`)} className="flex w-full items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-left text-neutral-950">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#f4f0ee]"><Calendar className="h-5 w-5" /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-bold" style={{ fontFamily: FONT_HEADING }}>{getBookingCourtLabel(booking)}</span><span className="block truncate text-[12px] text-neutral-500">{formatBookingHistoryTime(booking)}</span></span>
                <BookingStatusChip status={booking.history_status} />
                <ArrowRight className="h-4 w-4 shrink-0 text-neutral-400" />
              </button>;
            }) : <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-4 text-[13px] text-neutral-500">Inga kommande bokningar</div>}
          </section> : null}
        </nav>
        <div className="shrink-0 border-t border-black/10 bg-white">
          <div className="mx-auto w-full max-w-md px-5 pt-4">
            <button type="button" onClick={() => go(user ? `/my?v=${encodeURIComponent(slug)}` : `/auth?v=${encodeURIComponent(slug)}`)} className="flex w-full items-center gap-3 rounded-2xl border border-neutral-200 bg-[#fffaf7] px-4 py-3 text-left shadow-sm">
              {user ? <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-neutral-950 text-sm font-black text-white" style={{ fontFamily: FONT_HEADING }}>{(user.email || "P").slice(0, 1).toUpperCase()}</span> : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-neutral-950 text-white"><LogIn className="h-5 w-5" /></span>}
              <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-bold text-neutral-950" style={{ fontFamily: FONT_HEADING }}>{user ? "Min sida" : "Logga in"}</span><span className="block truncate text-[12px] text-neutral-500">{user ? user.email : "Fortsätt till ditt konto"}</span></span>
              <ArrowRight className="h-4 w-4 text-neutral-400" />
            </button>
          </div>
          <div className="mx-auto w-full max-w-md px-5 pb-[calc(env(safe-area-inset-bottom,0px)+18px)] pt-3"><button type="button" onClick={() => go(`/today?v=${encodeURIComponent(slug)}`)} className="flex min-h-14 w-full items-center justify-center gap-3 rounded-full bg-neutral-950 px-5 text-base font-black text-white" style={{ fontFamily: FONT_HEADING }}>Spela idag <ArrowRight className="h-4 w-4" /></button></div>
        </div>
      </motion.aside>
    </div> : null}</AnimatePresence>
    {showVenue ? <VenueStatusDrawer open={venueSheetOpen} onOpenChange={setVenueSheetOpen} venue={venue} status={status} /> : null}
  </>;
}
