import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, CheckCircle2, MapPin, Calendar, Clock, Share2, CalendarPlus, Copy } from "lucide-react";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { toast } from "sonner";
import picklaLogo from "@/assets/pickla-logo.svg";

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const BASE_URL = `https://${PROJECT_ID}.supabase.co/functions/v1`;
const FONT_GROTESK = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

function generateICS(title: string, start: string, end: string, location: string, description: string) {
  const fmt = (d: string) => new Date(d).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
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
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-3 px-5">
        <p className="text-neutral-400 text-[13px]" style={{ fontFamily: FONT_MONO }}>
          bokningen hittades inte
        </p>
        <Link to="/" className="text-[12px] text-neutral-500 underline underline-offset-4" style={{ fontFamily: FONT_MONO }}>
          tillbaka
        </Link>
      </div>
    );
  }

  const startDate = new Date(booking.start_time);
  const endDate = new Date(booking.end_time);
  const customerName = booking.notes?.split(" | ")[0] || "";
  const customerPhone = booking.notes?.split(" | ")[1] || "";
  const isCancelled = booking.status === "cancelled";

  return (
    <div className="min-h-screen bg-white pb-20">
      {/* Top bar */}
      <div className="px-5 pt-12 pb-3 flex items-center justify-between">
        <span className="text-[11px] text-neutral-300" style={{ fontFamily: FONT_MONO }}>bokning</span>
        <Link to={venue?.slug ? `/links/${venue.slug}` : "/"}>
          <img src={picklaLogo} alt="Pickla" className="h-6 w-auto opacity-20 hover:opacity-40 transition-opacity" />
        </Link>
      </div>

      {/* Status */}
      <div className="flex flex-col items-center gap-3 py-8 px-5">
        <CheckCircle2 className={`w-14 h-14 ${isCancelled ? "text-neutral-300" : "text-emerald-500"}`} />
        <h1
          className="text-[28px] font-bold text-neutral-900 tracking-tight"
          style={{ fontFamily: FONT_GROTESK }}
        >
          {isCancelled ? "avbokad" : "bokad!"}
        </h1>
        <button
          onClick={handleCopyRef}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-neutral-100 active:bg-neutral-200 transition-colors"
        >
          <span className="text-[13px] font-bold text-neutral-600 tracking-wider" style={{ fontFamily: FONT_MONO }}>
            {ref}
          </span>
          <Copy className="w-3 h-3 text-neutral-400" />
        </button>
      </div>

      <div className="h-px bg-neutral-100 mx-5" />

      {/* Details */}
      <div className="px-5 py-6 space-y-3">
        {venue && (
          <div className="flex items-start gap-3">
            <MapPin className="w-4 h-4 text-neutral-300 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-[14px] font-bold text-neutral-900" style={{ fontFamily: FONT_GROTESK }}>
                {venue.name}
              </p>
              {(venue.address || venue.city) && (
                <p className="text-[11px] text-neutral-400 mt-0.5" style={{ fontFamily: FONT_MONO }}>
                  {[venue.address, venue.city].filter(Boolean).join(", ")}
                </p>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <Calendar className="w-4 h-4 text-neutral-300 flex-shrink-0" />
          <p className="text-[14px] font-medium text-neutral-900" style={{ fontFamily: FONT_GROTESK }}>
            {format(startDate, "EEEE d MMMM yyyy", { locale: sv })}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Clock className="w-4 h-4 text-neutral-300 flex-shrink-0" />
          <p className="text-[14px] font-medium text-neutral-900" style={{ fontFamily: FONT_GROTESK }}>
            {format(startDate, "HH:mm")} – {format(endDate, "HH:mm")}
          </p>
        </div>
      </div>

      <div className="h-px bg-neutral-100 mx-5" />

      {/* Courts */}
      <div className="px-5 py-6">
        <h2 className="text-[11px] font-bold text-neutral-400 uppercase tracking-widest mb-3" style={{ fontFamily: FONT_MONO }}>
          {courts.length === 1 ? "bana" : "banor"}
        </h2>
        <div className="space-y-2">
          {courts.map((c: any, i: number) => (
            <div key={i} className="flex justify-between items-center py-2">
              <span className="text-[14px] font-bold text-neutral-900" style={{ fontFamily: FONT_GROTESK }}>
                {c.court_name}
              </span>
              <span className="text-[13px] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
                {c.price} kr
              </span>
            </div>
          ))}
        </div>
        <div className="h-px bg-neutral-100 mt-3 mb-3" />
        <div className="flex justify-between">
          <span className="text-[15px] font-bold text-neutral-900" style={{ fontFamily: FONT_GROTESK }}>
            totalt
          </span>
          <span className="text-[15px] font-bold text-neutral-900" style={{ fontFamily: FONT_GROTESK }}>
            {totalPrice} kr
          </span>
        </div>
      </div>

      {/* Check-in notice */}
      {!isCancelled && (
        <div className="mx-5 mt-1 mb-2 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200/60">
          <p className="text-[12px] text-amber-800 leading-relaxed" style={{ fontFamily: FONT_MONO }}>
            betalning &amp; incheckning sker i desken – kom minst 15 min innan din tid
          </p>
        </div>
      )}

      <div className="h-px bg-neutral-100 mx-5" />

      {/* Customer info */}
      {customerName && (
        <div className="px-5 py-6">
          <h2 className="text-[11px] font-bold text-neutral-400 uppercase tracking-widest mb-3" style={{ fontFamily: FONT_MONO }}>
            bokad av
          </h2>
          <p className="text-[14px] font-medium text-neutral-900" style={{ fontFamily: FONT_GROTESK }}>
            {customerName}
          </p>
          {customerPhone && (
            <p className="text-[12px] text-neutral-400 mt-1" style={{ fontFamily: FONT_MONO }}>
              {customerPhone}
            </p>
          )}
        </div>
      )}

      {/* Action buttons */}
      {!isCancelled && (
        <div className="px-5 space-y-3">
          <button
            onClick={handleAddToCalendar}
            className="w-full py-3.5 rounded-2xl bg-neutral-900 text-white text-[13px] font-bold uppercase tracking-wider active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
            style={{ fontFamily: FONT_MONO }}
          >
            <CalendarPlus className="w-4 h-4" />
            lägg till i kalender
          </button>
          <button
            onClick={handleShare}
            className="w-full py-3.5 rounded-2xl bg-neutral-50 border border-neutral-200 text-neutral-700 text-[13px] font-bold uppercase tracking-wider active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
            style={{ fontFamily: FONT_MONO }}
          >
            <Share2 className="w-4 h-4" />
            dela bokning
          </button>
        </div>
      )}

      {/* Book again */}
      {venue?.slug && (
        <div className="px-5 mt-8 text-center">
          <Link
            to={`/book?v=${venue.slug}`}
            className="text-[12px] text-neutral-400 underline underline-offset-4"
            style={{ fontFamily: FONT_MONO }}
          >
            boka igen
          </Link>
        </div>
      )}
    </div>
  );
}
