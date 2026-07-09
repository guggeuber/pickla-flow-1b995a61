import type { ReactNode } from "react";
import { useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, Loader2, CheckCircle2, Share2, CalendarPlus, Copy, Printer, X } from "lucide-react";
import { DateTime } from "luxon";
import { toast } from "sonner";
import picklaLogo from "@/assets/pickla-logo.svg";
import { apiPost } from "@/lib/api";

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const BASE_URL = `https://${PROJECT_ID}.supabase.co/functions/v1`;
const FONT_GROTESK = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";
const PICKLA_COMPANY = {
  name: "Pickla Solna AB",
  org: "5569774481",
  fTax: "Godkänd för F-skatt",
  visit: "Pickla Solna Business Park, Svetsarvägen 22, 171 41 Solna",
  postal: "Sjöstadskajen 1, 178 51 Ekerö",
  contact: "solna@picklaparks.com · 08-83 33 63",
};

type BookingCourtRow = {
  ref?: string;
  court_name?: string | null;
  price?: number | null;
};

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
  const navigate = useNavigate();

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
  const courts: BookingCourtRow[] = data?.courts || [];
  const participants = Array.isArray(data?.participants) ? data.participants : [];
  const totalPrice = data?.totalPrice || 0;
  const receipt = data?.receipt;
  const [creatingInvite, setCreatingInvite] = useState(false);

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title: `Bokning ${ref}`, url });
    } else {
      await navigator.clipboard.writeText(url);
      toast.success("Länk kopierad!");
    }
  };

  const handleInvitePlayers = async () => {
    if (!ref) return;
    setCreatingInvite(true);
    try {
      const result = await apiPost<{ url?: string }>("api-bookings", "booking-participant-invite", { bookingRef: ref });
      if (!result.url) throw new Error("Ingen länk skapades");
      await navigator.clipboard.writeText(result.url);
      toast.success("Medspelarlänk kopierad");
    } catch (err: any) {
      toast.error(err?.message || "Kunde inte skapa medspelarlänk. Logga in som bokare och försök igen.");
    } finally {
      setCreatingInvite(false);
    }
  };

  const handleAddToCalendar = () => {
    if (!booking || !venue) return;
    const courtNames = courts.map((court) => court.court_name).filter(Boolean).join(", ");
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

  const handlePrint = () => window.print();

  const handleDownloadPdf = () => {
    toast.info("Välj Spara som PDF i utskriftsdialogen.");
    window.print();
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
  const customerName = receipt?.customer_name || booking.notes?.split(" | ")[0] || "";
  const customerPhone = receipt?.customer_phone || booking.notes?.split(" | ")[1] || "";
  const isCancelled = booking.status === "cancelled";
  const courtNames = courts.map((court) => court.court_name).filter(Boolean).join(", ");
  const receiptNumber = receipt?.receipt_number || ref;
  const paymentStatus = receipt?.payment_status === "free" || totalPrice === 0 ? "0 kr / gratis" : "Betald";
  const totalIncVat = Number(receipt?.total_inc_vat_sek ?? receipt?.total_inc_vat ?? totalPrice);
  const vatRate = Number(receipt?.vat_rate || 6);
  const fallbackVatAmount = Math.round(totalIncVat * vatRate / (100 + vatRate) * 100) / 100;
  const vatAmount = Number(receipt?.vat_amount_sek ?? receipt?.vat_amount ?? fallbackVatAmount);
  const totalExVat = Number(receipt?.total_ex_vat_sek ?? receipt?.total_ex_vat ?? Math.max(totalIncVat - fallbackVatAmount, 0));
  const issuedAt = receipt?.issued_at
    ? DateTime.fromISO(receipt.issued_at, { zone: "utc" }).setZone("Europe/Stockholm")
    : startDT;
  const currency = receipt?.currency || "SEK";
  const customerEmail = receipt?.customer_email || "";
  const productDescription = receipt?.product_description || (courts.length > 1 ? "Banbokning flera banor" : "Banbokning");
  const paymentMethod = receipt?.payment_method || (receipt?.payment_provider === "stripe" ? "Kort via Stripe" : "Pickla");
  const formatMoney = (amount: number) => `${Number(amount || 0).toLocaleString("sv-SE", { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 })} kr`;
  const Row = ({ label, value, strong = false }: { label: string; value: ReactNode; strong?: boolean }) => (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-neutral-100 last:border-0">
      <span className="text-[11px] uppercase tracking-wider text-neutral-400" style={{ fontFamily: FONT_MONO }}>
        {label}
      </span>
      <span
        className={`text-right ${strong ? "text-[16px] font-bold text-neutral-950" : "text-[13px] text-neutral-700"}`}
        style={{ fontFamily: strong ? FONT_GROTESK : FONT_MONO }}
      >
        {value}
      </span>
    </div>
  );

  return (
    <div className="min-h-[100dvh] bg-[#f7f4ee] flex flex-col text-neutral-950 print:bg-white">
      <div className="px-5 pt-[calc(env(safe-area-inset-top,0px)+18px)] pb-3 flex items-center justify-between print:hidden">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="grid h-11 w-11 place-items-center rounded-full bg-white border border-neutral-200 active:scale-[0.98]"
          aria-label="Tillbaka"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Link to={venue?.slug ? `/?v=${venue.slug}` : "/"}>
          <img src={picklaLogo} alt="Pickla" className="h-6 w-auto" />
        </Link>
        <button
          type="button"
          onClick={() => navigate(venue?.slug ? `/my?v=${venue.slug}` : "/my")}
          className="grid h-11 w-11 place-items-center rounded-full bg-white border border-neutral-200 active:scale-[0.98]"
          aria-label="Stäng"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex flex-col items-center gap-2 px-5 py-5 text-center">
        <CheckCircle2 className={`w-10 h-10 ${isCancelled ? "text-neutral-300" : "text-emerald-500"}`} />
        <h1
          className="text-[34px] leading-none font-bold tracking-tight"
          style={{ fontFamily: FONT_GROTESK }}
        >
          {isCancelled ? "Avbokad" : totalIncVat > 0 ? "Kvitto" : "Bokad"}
        </h1>
        <button
          onClick={handleCopyRef}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-white border border-neutral-200 active:bg-neutral-50 transition-colors"
        >
          <span className="text-[12px] font-bold text-neutral-600 tracking-wider uppercase" style={{ fontFamily: FONT_MONO }}>
            {receiptNumber}
          </span>
          <Copy className="w-2.5 h-2.5 text-neutral-400" />
        </button>
      </div>

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-28">
        <section className="rounded-[28px] bg-white border border-neutral-200 p-5 shadow-sm print:rounded-none print:shadow-none print:border-neutral-300">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-neutral-400" style={{ fontFamily: FONT_MONO }}>
                Säljare
              </p>
              <p className="mt-1 text-lg font-bold text-neutral-950" style={{ fontFamily: FONT_GROTESK }}>
                {PICKLA_COMPANY.name}
              </p>
              <p className="text-[12px] text-neutral-500" style={{ fontFamily: FONT_MONO }}>
                Org.nr {PICKLA_COMPANY.org} · {PICKLA_COMPANY.fTax}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-neutral-500" style={{ fontFamily: FONT_MONO }}>
                Besök: {PICKLA_COMPANY.visit}<br />
                Post: {PICKLA_COMPANY.postal}<br />
                {PICKLA_COMPANY.contact}
              </p>
            </div>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-bold text-emerald-600" style={{ fontFamily: FONT_MONO }}>
              {paymentStatus}
            </span>
          </div>

          <div className="mt-6">
            <Row label="Kvittonr" value={receiptNumber} />
            <Row label="Bokning" value={ref} />
            <Row label="Utfärdat" value={issuedAt.setLocale("sv").toFormat("d MMM yyyy, HH:mm")} />
            <Row label="Produkt" value={productDescription} />
            <Row
              label="Tid"
              value={`${startDT.setLocale("sv").toFormat("EEE d MMM")} · ${startDT.toFormat("HH:mm")}–${endDT.toFormat("HH:mm")}`}
            />
            <Row label={courts.length > 1 ? "Banor" : "Bana"} value={courtNames || "Bana"} />
            {customerName && <Row label="Kund" value={customerName} />}
            {customerEmail && <Row label="E-post" value={customerEmail} />}
            {customerPhone && <Row label="Telefon" value={customerPhone} />}
            {receipt?.personal_identity_number && <Row label="Personnummer" value={receipt.personal_identity_number} />}
          </div>
        </section>

        {totalIncVat > 0 && (
          <section className="mt-4 rounded-[24px] bg-white border border-neutral-200 p-5 shadow-sm">
            <Row label="Betalsätt" value={paymentMethod} />
            <Row label="Pris" value={formatMoney(totalIncVat)} strong />
            <Row label={`Moms (${vatRate} %)`} value={formatMoney(vatAmount)} />
            <Row label="Totalt inkl. moms" value={formatMoney(totalIncVat)} strong />
            <Row label="Belopp exkl. moms" value={formatMoney(totalExVat)} />
            <Row label="Valuta" value={currency} />
            {receipt?.stripe_session_id && <Row label="Stripe checkout" value={receipt.stripe_session_id} />}
            {receipt?.stripe_payment_intent_id && <Row label="Stripe payment" value={receipt.stripe_payment_intent_id} />}
            <p className="mt-4 text-[11px] leading-relaxed text-neutral-400" style={{ fontFamily: FONT_MONO }}>
              Detta Pickla-kvitto visar betalningens moms och friskvårdsunderlag. Betalningen hanteras via Stripe.
            </p>
          </section>
        )}

        <section className="mt-4 rounded-[24px] bg-white border border-neutral-200 p-5 shadow-sm print:hidden">
          <p className="text-sm font-bold text-neutral-950" style={{ fontFamily: FONT_GROTESK }}>Friskvårdskvitto</p>
          <p className="mt-1 text-xs leading-relaxed text-neutral-500" style={{ fontFamily: FONT_MONO }}>
            Behöver du personnummer på underlaget? Öppna friskvårdssidan och fyll i det bara när du behöver lämna in kvittot.
          </p>
          <Link
            to="/wellness"
            className="mt-3 inline-flex w-full items-center justify-center rounded-2xl bg-neutral-950 px-4 py-3 text-sm font-bold text-white"
            style={{ fontFamily: FONT_GROTESK }}
          >
            Skapa friskvårdsunderlag
          </Link>
        </section>

        {!isCancelled && booking.access_code && (
          <section className="mt-4 rounded-[24px] bg-amber-50 border-2 border-amber-200 px-5 py-4 flex flex-col items-center gap-1 text-center">
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
          </section>
        )}

        {!isCancelled && (
          <section className="mt-4 rounded-[24px] bg-white border border-neutral-200 p-5 shadow-sm print:hidden">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-neutral-950" style={{ fontFamily: FONT_GROTESK }}>Play Rights</p>
                <p className="mt-1 text-xs leading-relaxed text-neutral-500" style={{ fontFamily: FONT_MONO }}>
                  Varje spelare har egen plats, betalstatus och check-in.
                </p>
              </div>
              <span className="rounded-full bg-neutral-100 px-3 py-1 text-[11px] font-bold text-neutral-500" style={{ fontFamily: FONT_MONO }}>
                {participants.length || 1}/4+
              </span>
            </div>
            {participants.length > 0 && (
              <div className="mt-4 space-y-2">
                {participants.map((participant: any) => (
                  <div key={participant.id} className="flex items-center justify-between rounded-2xl border border-neutral-100 bg-neutral-50 px-3 py-2">
                    <span className="text-sm font-bold text-neutral-700" style={{ fontFamily: FONT_GROTESK }}>
                      {participant.display_name}
                    </span>
                    <span className="text-[11px] uppercase tracking-wider text-neutral-400" style={{ fontFamily: FONT_MONO }}>
                      {participant.payment_status === "paid" ? "Betald" : participant.payment_status === "free" ? "Ingår" : "Obetald"}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={handleInvitePlayers}
              disabled={creatingInvite}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-neutral-950 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
              style={{ fontFamily: FONT_GROTESK }}
            >
              {creatingInvite ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
              Bjud in spelare
            </button>
          </section>
        )}
      </main>

      {!isCancelled && (
        <div className="fixed inset-x-0 bottom-0 z-20 mx-auto grid max-w-md grid-cols-4 gap-2 px-5 pb-[calc(env(safe-area-inset-bottom,0px)+14px)] pt-3 bg-gradient-to-t from-[#f7f4ee] via-[#f7f4ee] to-transparent print:hidden">
          <button
            onClick={handleAddToCalendar}
            className="py-3 rounded-2xl bg-white border border-neutral-200 text-neutral-700 text-[10px] font-bold uppercase tracking-wider active:scale-[0.98] transition-transform flex items-center justify-center gap-1.5"
            style={{ fontFamily: FONT_MONO }}
          >
            <CalendarPlus className="w-3.5 h-3.5" />
            kalender
          </button>
          <button
            onClick={handlePrint}
            className="py-3 rounded-2xl bg-white border border-neutral-200 text-neutral-700 text-[10px] font-bold uppercase tracking-wider active:scale-[0.98] transition-transform flex items-center justify-center gap-1.5"
            style={{ fontFamily: FONT_MONO }}
          >
            <Printer className="w-3.5 h-3.5" />
            skriv ut
          </button>
          <button
            onClick={handleDownloadPdf}
            className="py-3 rounded-2xl bg-neutral-950 text-white text-[10px] font-bold uppercase tracking-wider active:scale-[0.98] transition-transform flex items-center justify-center gap-1.5"
            style={{ fontFamily: FONT_MONO }}
          >
            <Download className="w-3.5 h-3.5" />
            pdf
          </button>
          <button
            onClick={handleShare}
            className="py-3 rounded-2xl bg-white border border-neutral-200 text-neutral-700 text-[10px] font-bold uppercase tracking-wider active:scale-[0.98] transition-transform flex items-center justify-center gap-1.5"
            style={{ fontFamily: FONT_MONO }}
          >
            <Share2 className="w-3.5 h-3.5" />
            dela
          </button>
        </div>
      )}
    </div>
  );
}
