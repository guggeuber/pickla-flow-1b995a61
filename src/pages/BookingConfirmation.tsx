import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, CheckCircle2, MapPin, Clock, Share2, CalendarPlus, Copy } from "lucide-react";
import { DateTime } from "luxon";
import { toast } from "sonner";
import picklaLogo from "@/assets/pickla-logo.svg";

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const BASE_URL = `https://${PROJECT_ID}.supabase.co/functions/v1`;
const FONT_GROTESK = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

function generateICS(title: string, start: string, end: string, location: string, description: string) {
  const fmt = (d: string) => new Date(d).toISOString().replace(/[-:]/g, "").split(".")[0];
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Pickla//Booking//EN
BEGIN:VEVENT
DTSTART:${fmt(start)}
DTEND:${fmt(end)}
SUMMARY:${title}
LOCATION:${location}
DESCRIPTION:${description}
END:VEVENT
END:VCALENDAR`;
}

export default function BookingConfirmation() {
  const { ref } = useParams<{ ref: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ["booking", ref],
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/api-bookings/public-booking?ref=${ref}`);
      if (!res.ok) throw new Error("Bokningen hittades inte");
      return res.json();
    },
    enabled: !!ref,
  });

  const booking = data?.booking;
  const venue = data?.venue;
  const courts = data?.courts || [];
  const totalPrice = data?.totalPrice || 0;

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title: `Bokning ${ref}`, url });
    } else {
      await navigator.clipboard.writeText(url);
      toast.success("Länk kopierad!");
    }
  };

  const handleAddToCalendar = () => {
    if (!booking || !venue) return;
    const courtNames = courts.map((c: any) => c.court_name).join(", ");
    const customerName = booking.notes?.split(" | ")[0] || "";
    const title = `Pickleball – ${courtNames}`;
    const location = [venue.name, venue.address, venue.city].filter(Boolean).join(", ");
    const description = `Bokningsnr: ${ref}\\n${customerName}\\nBanor: ${courtNames}\\nPris: ${totalPrice} kr`;

    const ics = generateICS(title, booking.start_time, booking.end_time, location, description);
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bokning-${ref}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyRef = () => {
    navigator.clipboard.writeText(ref || "");
    toast.success("Bokningsnummer kopierat!");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-neutral-300" />
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-3 px-4">
        <p className="text-neutral-400 text-[13px]" style={{ fontFamily: FONT_MONO }}>
          bokningen hittades inte
        </p>
        <Link to="/" className="text-[12px] text-neutral-500 underline underline-offset-4" style={{ fontFamily: FONT_MONO }}>
          tillbaka
        </Link>
      </div>
    );
  }

  const startDT = DateTime.fromISO(booking.start_time, { zone: "utc" }).setZone("Europe/Stockholm");
  const endDT = DateTime.fromISO(booking.end_time, { zone: "utc" }).setZone("Europe/Stockholm");
  const customerName = booking.notes?.split(" | ")[0] || "";
  const customerPhone = booking.notes?.split(" | ")[1] || "";
  const isCancelled = booking.status === "cancelled";
  const courtNames = courts.map((c: any) => c.court_name).join(", ");

  return (
    <div className="min-h-[100dvh] bg-white flex flex-col">
      {/* Top bar */}
      <div className="px-4 pt-[env(safe-area-inset-top,10px)] pb-1 flex items-center justify-between">
        <span className="text-[10px] text-neutral-300" style={{ fontFamily: FONT_MONO }}>bokning</span>
        <Link to={venue?.slug ? `/?v=${venue.slug}` : "/"}>
          <img src={picklaLogo} alt="Pickla" className="h-5 w-auto opacity-20 hover:opacity-40 transition-opacity" />
        </Link>
      </div>

      {/* Status + ref */}
      <div className="flex flex-col items-center gap-1.5 py-4 px-4">
        <CheckCircle2 className={`w-10 h-10 ${isCancelled ? "text-neutral-300" : "text-emerald-500"}`} />
        <h1
          className="text-[22px] font-bold text-neutral-900 tracking-tight"
          style={{ fontFamily: FONT_GROTESK }}
        >
          {isCancelled ? "avbokad" : "bokad!"}
        </h1>
        <button
          onClick={handleCopyRef}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-neutral-100 active:bg-neutral-200 transition-colors"
        >
          <span className="text-[12px] font-bold text-neutral-600 tracking-wider" style={{ fontFamily: FONT_MONO }}>
            {ref}
          </span>
          <Copy className="w-2.5 h-2.5 text-neutral-400" />
        </button>
      </div>

      <div className="h-px bg-neutral-100 mx-4" />

      {/* Compact details row */}
      <div className="px-4 py-3 space-y-1.5">
        {venue && (
          <div className="flex items-center gap-2">
            <MapPin className="w-3.5 h-3.5 text-neutral-300 flex-shrink-0" />
            <p className="text-[13px] font-bold text-neutral-900 truncate" style={{ fontFamily: FONT_GROTESK }}>
              {venue.name}
            </p>
          </div>
        )}
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-neutral-300 flex-shrink-0" />
          <p className="text-[13px] font-medium text-neutral-900" style={{ fontFamily: FONT_GROTESK }}>
            {startDT.setLocale("sv").toFormat("EEE d MMM")} · {startDT.toFormat("HH:mm")}–{endDT.toFormat("HH:mm")}
          </p>
        </div>
      </div>

      <div className="h-px bg-neutral-100 mx-4" />

      {/* Courts + total — compact inline */}
      <div className="px-4 py-3">
        <div className="flex justify-between items-center">
          <span className="text-[12px] text-neutral-500" style={{ fontFamily: FONT_MONO }}>
            {courtNames}
          </span>
          <span className="text-[14px] font-bold text-neutral-900" style={{ fontFamily: FONT_GROTESK }}>
            {totalPrice} kr
          </span>
        </div>
      </div>

      {/* Access code */}
      {!isCancelled && booking.access_code && (
        <div className="mx-4 mb-2 px-4 py-3 rounded-xl bg-amber-50 border-2 border-amber-300/60 flex flex-col items-center gap-1 text-center">
          <p className="text-[9px] font-bold text-amber-700 uppercase tracking-widest" style={{ fontFamily: FONT_MONO }}>
            incheckningskod
          </p>
          <p
            className="font-bold text-amber-900 tracking-[0.25em] leading-none"
            style={{ fontFamily: FONT_MONO, fontSize: "clamp(2rem, 10vw, 3rem)" }}
          >
            {booking.access_code}
          </p>
          <p className="text-[10px] text-amber-700" style={{ fontFamily: FONT_MONO }}>
            Slå in koden vid banorna
          </p>
        </div>
      )}

      {/* Check-in notice */}
      {!isCancelled && (
        <div className="mx-4 mb-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200/60">
          <p className="text-[11px] text-amber-800 leading-snug" style={{ fontFamily: FONT_MONO }}>
            betalning &amp; incheckning i desken – kom 15 min innan
          </p>
        </div>
      )}

      {/* Spacer to push buttons to bottom */}
      <div className="flex-1 min-h-3" />

      {/* Action buttons */}
      {!isCancelled && (
        <div className="px-4 pb-2 flex gap-2">
          <button
            onClick={handleAddToCalendar}
            className="flex-1 py-3 rounded-xl bg-neutral-900 text-white text-[11px] font-bold uppercase tracking-wider active:scale-[0.98] transition-transform flex items-center justify-center gap-1.5"
            style={{ fontFamily: FONT_MONO }}
          >
            <CalendarPlus className="w-3.5 h-3.5" />
            kalender
          </button>
          <button
            onClick={handleShare}
            className="flex-1 py-3 rounded-xl bg-neutral-50 border border-neutral-200 text-neutral-700 text-[11px] font-bold uppercase tracking-wider active:scale-[0.98] transition-transform flex items-center justify-center gap-1.5"
            style={{ fontFamily: FONT_MONO }}
          >
            <Share2 className="w-3.5 h-3.5" />
            dela
          </button>
        </div>
      )}

      {/* Book again + customer */}
      <div className="px-4 pb-[env(safe-area-inset-bottom,12px)] pt-1 flex items-center justify-between">
        {customerName && (
          <span className="text-[10px] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
            {customerName}{customerPhone ? ` · ${customerPhone}` : ""}
          </span>
        )}
        {venue?.slug && (
          <Link
            to={`/book?v=${venue.slug}${customerName ? `&name=${encodeURIComponent(customerName)}` : ""}${customerPhone ? `&phone=${encodeURIComponent(customerPhone)}` : ""}`}
            className="text-[11px] text-neutral-400 underline underline-offset-4 ml-auto"
            style={{ fontFamily: FONT_MONO }}
          >
            boka igen
          </Link>
        )}
      </div>
    </div>
  );
}
