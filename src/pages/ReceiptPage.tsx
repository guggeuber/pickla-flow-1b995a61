import type { ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Copy, Download, Loader2, Printer, Share2, X } from "lucide-react";
import { DateTime } from "luxon";
import { toast } from "sonner";
import picklaLogo from "@/assets/pickla-logo.svg";
import { apiGet } from "@/lib/api";

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

type ReceiptSnapshot = {
  id: string;
  receipt_number: string;
  booking_refs?: string[] | null;
  purchase_type?: string | null;
  product_description?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  personal_identity_number?: string | null;
  payment_method?: string | null;
  payment_provider?: string | null;
  payment_status?: string | null;
  total_inc_vat?: number | null;
  total_ex_vat?: number | null;
  vat_amount?: number | null;
  total_inc_vat_sek?: number | null;
  total_ex_vat_sek?: number | null;
  vat_amount_sek?: number | null;
  vat_rate?: number | null;
  currency?: string | null;
  stripe_session_id?: string | null;
  stripe_payment_intent_id?: string | null;
  issued_at?: string | null;
  metadata?: Record<string, unknown> | null;
};

function formatMoney(amount: number) {
  return `${Number(amount || 0).toLocaleString("sv-SE", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  })} kr`;
}

function formatDateTime(value?: string | null) {
  if (!value) return null;
  const date = DateTime.fromISO(value, { zone: "utc" }).setZone("Europe/Stockholm");
  if (!date.isValid) return null;
  return date.setLocale("sv").toFormat("d MMM yyyy, HH:mm");
}

function metadataString(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getActivityTime(receipt: ReceiptSnapshot) {
  const date = metadataString(receipt.metadata, "date") || metadataString(receipt.metadata, "session_date");
  const start = metadataString(receipt.metadata, "start_time");
  const end = metadataString(receipt.metadata, "end_time");
  if (!date && !start) return null;

  const dateLabel = date
    ? DateTime.fromISO(date, { zone: "Europe/Stockholm" }).setLocale("sv").toFormat("EEE d MMM")
    : null;
  const timeLabel = start && end ? `${start.slice(0, 5)}-${end.slice(0, 5)}` : start?.slice(0, 5) || null;
  return [dateLabel, timeLabel].filter(Boolean).join(" · ");
}

export default function ReceiptPage() {
  const { ref } = useParams<{ ref: string }>();
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ["receipt", ref],
    queryFn: () => apiGet<{ receipt: ReceiptSnapshot }>("api-bookings", "receipt", { ref: ref || "" }),
    enabled: !!ref,
  });

  const receipt = data?.receipt;

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title: `Kvitto ${receipt?.receipt_number || ref}`, url });
    } else {
      await navigator.clipboard.writeText(url);
      toast.success("Länk kopierad");
    }
  };

  const handleCopyRef = () => {
    navigator.clipboard.writeText(receipt?.receipt_number || ref || "");
    toast.success("Kvittonummer kopierat");
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

  if (error || !receipt) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-3 px-4">
        <p className="text-neutral-400 text-[13px]" style={{ fontFamily: FONT_MONO }}>
          kvittot hittades inte
        </p>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-[12px] text-neutral-500 underline underline-offset-4"
          style={{ fontFamily: FONT_MONO }}
        >
          tillbaka
        </button>
      </div>
    );
  }

  const totalIncVat = Number(receipt.total_inc_vat_sek ?? receipt.total_inc_vat ?? 0);
  const vatRate = Number(receipt.vat_rate || 6);
  const fallbackVatAmount = Math.round((totalIncVat * vatRate) / (100 + vatRate) * 100) / 100;
  const vatAmount = Number(receipt.vat_amount_sek ?? receipt.vat_amount ?? fallbackVatAmount);
  const totalExVat = Number(receipt.total_ex_vat_sek ?? receipt.total_ex_vat ?? Math.max(totalIncVat - vatAmount, 0));
  const receiptNumber = receipt.receipt_number || ref || "";
  const issuedAt = formatDateTime(receipt.issued_at) || "Tid saknas";
  const productDescription = receipt.product_description || "Pickla-köp";
  const activityTime = getActivityTime(receipt);
  const currency = receipt.currency || "SEK";
  const paymentMethod = receipt.payment_method || (receipt.payment_provider === "stripe" ? "Kort via Stripe" : "Pickla");
  const paymentStatus = receipt.payment_status === "free" || totalIncVat === 0 ? "0 kr / gratis" : "Betald";
  const issuedYear = receipt.issued_at
    ? DateTime.fromISO(receipt.issued_at, { zone: "utc" }).setZone("Europe/Stockholm").year
    : DateTime.now().setZone("Europe/Stockholm").year;

  const Row = ({ label, value, strong = false }: { label: string; value: ReactNode; strong?: boolean }) => (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-neutral-100 last:border-0">
      <span className="text-[11px] uppercase tracking-wider text-neutral-400" style={{ fontFamily: FONT_MONO }}>
        {label}
      </span>
      <span
        className={`text-right break-words min-w-0 ${strong ? "text-[16px] font-bold text-neutral-950" : "text-[13px] text-neutral-700"}`}
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
        <Link to="/">
          <img src={picklaLogo} alt="Pickla" className="h-6 w-auto" />
        </Link>
        <button
          type="button"
          onClick={() => navigate("/my")}
          className="grid h-11 w-11 place-items-center rounded-full bg-white border border-neutral-200 active:scale-[0.98]"
          aria-label="Stäng"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex flex-col items-center gap-2 px-5 py-5 text-center">
        <CheckCircle2 className="w-10 h-10 text-emerald-500" />
        <h1 className="text-[34px] leading-none font-bold tracking-tight" style={{ fontFamily: FONT_GROTESK }}>
          Kvitto
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
            {receipt.booking_refs?.length ? <Row label="Referens" value={receipt.booking_refs.join(", ")} /> : null}
            <Row label="Utfärdat" value={issuedAt} />
            <Row label="Produkt" value={productDescription} />
            {activityTime && <Row label="Tid" value={activityTime} />}
            {receipt.customer_name && <Row label="Kund" value={receipt.customer_name} />}
            {receipt.customer_email && <Row label="E-post" value={receipt.customer_email} />}
            {receipt.customer_phone && <Row label="Telefon" value={receipt.customer_phone} />}
            {receipt.personal_identity_number && <Row label="Personnummer" value={receipt.personal_identity_number} />}
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
            {receipt.stripe_session_id && <Row label="Stripe checkout" value={receipt.stripe_session_id} />}
            {receipt.stripe_payment_intent_id && <Row label="Stripe payment" value={receipt.stripe_payment_intent_id} />}
            <p className="mt-4 text-[11px] leading-relaxed text-neutral-400" style={{ fontFamily: FONT_MONO }}>
              Detta Pickla-kvitto visar betalningens moms och friskvårdsunderlag. Betalningen hanteras via Stripe.
            </p>
          </section>
        )}

        <section className="mt-4 rounded-[24px] bg-white border border-neutral-200 p-5 shadow-sm print:hidden">
          <p className="text-sm font-bold text-neutral-950" style={{ fontFamily: FONT_GROTESK }}>
            Friskvårdskvitto
          </p>
          <p className="mt-1 text-xs leading-relaxed text-neutral-500" style={{ fontFamily: FONT_MONO }}>
            Behöver du personnummer på underlaget? Öppna friskvårdssidan och fyll i det bara när du behöver lämna in kvittot.
          </p>
          <Link
            to={`/wellness?year=${issuedYear}`}
            className="mt-3 inline-flex w-full items-center justify-center rounded-2xl bg-neutral-950 px-4 py-3 text-sm font-bold text-white"
            style={{ fontFamily: FONT_GROTESK }}
          >
            Skapa friskvårdsunderlag
          </Link>
        </section>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto grid max-w-md grid-cols-3 gap-2 px-5 pb-[calc(env(safe-area-inset-bottom,0px)+14px)] pt-3 bg-gradient-to-t from-[#f7f4ee] via-[#f7f4ee] to-transparent print:hidden">
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
    </div>
  );
}
