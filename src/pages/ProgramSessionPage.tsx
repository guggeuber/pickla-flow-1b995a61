import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { ArrowLeft, CalendarDays, CheckCircle2, Loader2, MessageCircle, Ticket } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import picklaLogo from "@/assets/pickla-logo.svg";

const CREAM = "#faf8f5";
const CARD = "#ffffff";
const TEXT = "#111827";
const MUTED = "#6b7280";
const NAVY = "#1a1f3a";
const GREEN = "#16a34a";
const BORDER = "rgba(17,24,39,0.1)";
const FONT_HEADING = "'Space Grotesk', sans-serif";

const DAY_NAMES = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];

const formatSek = (amount: number) =>
  `${amount.toLocaleString("sv-SE", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  })} kr`;

function nextOccurrence(session: any, requestedDate?: string | null) {
  if (requestedDate) return DateTime.fromISO(requestedDate, { zone: "Europe/Stockholm" });
  if (session?.session_date) return DateTime.fromISO(session.session_date, { zone: "Europe/Stockholm" });

  const now = DateTime.now().setZone("Europe/Stockholm");
  const recurrenceDays = session?.recurrence_days || [];
  for (let offset = 0; offset < 14; offset++) {
    const date = now.plus({ days: offset });
    const jsDow = date.weekday % 7;
    if (!recurrenceDays.includes(jsDow)) continue;
    if (offset === 0 && session?.end_time) {
      const [endHour, endMinute] = String(session.end_time).split(":").map(Number);
      const endAt = date.set({ hour: endHour || 0, minute: endMinute || 0, second: 0, millisecond: 0 });
      if (now > endAt) continue;
    }
    return date;
  }

  return now;
}

export default function ProgramSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);

  const requestedDate = searchParams.get("date");
  const venueSlug = searchParams.get("v") || "pickla-arena-sthlm";

  const { data, isLoading } = useQuery({
    queryKey: ["program-session", sessionId],
    enabled: !!sessionId,
    queryFn: async () => {
      const { data: session, error } = await supabase
        .from("activity_sessions")
        .select("*, activity_series(id, name, series_type)")
        .eq("id", sessionId!)
        .maybeSingle();

      if (error) throw error;
      if (!session) throw new Error("Passet finns inte längre");

      const { data: venue } = await supabase
        .from("venues")
        .select("id, name, slug, address, city")
        .eq("id", (session as any).venue_id)
        .maybeSingle();

      const { data: product } = (session as any).product_key
        ? await supabase
            .from("access_products")
            .select("product_key, name, product_kind, session_type, base_price_sek, grants")
            .eq("venue_id", (session as any).venue_id)
            .eq("product_key", (session as any).product_key)
            .eq("is_active", true)
            .maybeSingle()
        : { data: null };

      return { session: session as any, venue: venue as any, product: product as any };
    },
  });

  const occurrence = useMemo(() => nextOccurrence(data?.session, requestedDate), [data?.session, requestedDate]);
  const occurrenceDate = occurrence.toISODate();
  const session = data?.session;
  const venue = data?.venue;
  const product = data?.product;
  const basePrice = Number(product?.base_price_sek ?? session?.price_sek ?? 0);
  const productKey = session?.product_key || product?.product_key || "day_access";

  const { data: membership } = useQuery({
    queryKey: ["program-membership", user?.id, session?.venue_id],
    enabled: !!user?.id && !!session?.venue_id,
    staleTime: 30000,
    queryFn: () => apiGet("api-memberships", "user", { userId: user!.id, venueId: session!.venue_id }),
  });

  const tierPricing = (membership?.tier_pricing || []).find((p: any) => p.product_type === productKey);
  const memberPrice = (() => {
    if (!tierPricing) return basePrice;
    if (tierPricing.fixed_price != null) return Math.round(Number(tierPricing.fixed_price));
    if (tierPricing.discount_percent) return Math.round(basePrice * (1 - Number(tierPricing.discount_percent) / 100) * 100) / 100;
    return basePrice;
  })();
  const hasDiscount = memberPrice < basePrice;

  const startTime = session?.start_time ? String(session.start_time).slice(0, 5) : "";
  const endTime = session?.end_time ? String(session.end_time).slice(0, 5) : "";
  const dayLabel = occurrence.hasSame(DateTime.now().setZone("Europe/Stockholm"), "day")
    ? "Idag"
    : occurrence.hasSame(DateTime.now().setZone("Europe/Stockholm").plus({ days: 1 }), "day")
      ? "Imorgon"
      : `${DAY_NAMES[occurrence.weekday % 7]} ${occurrence.toFormat("d MMM", { locale: "sv" })}`;

  const handleCheckout = async () => {
    if (!session || !venue || submitting) return;
    setSubmitting(true);
    try {
      const result = await apiPost("api-bookings", "create-checkout", {
        product_type: "day_pass",
        amount_sek: session.price_sek ?? basePrice,
        venue_id: session.venue_id,
        metadata: {
          product_key: productKey,
          session_name: session.name,
          session_type: session.session_type || product?.session_type || "open_play",
          date: occurrenceDate,
          activity_session_id: session.id,
          user_id: user?.id || "",
          slug: venue.slug || venueSlug,
          redirect_path: `/hub?v=${venue.slug || venueSlug}`,
          success_path: `/booking/confirmed?type=day_pass&next=${encodeURIComponent(`/hub?v=${venue.slug || venueSlug}`)}`,
        },
      });

      if (result.free) {
        toast.success("Klart! Din access är aktiverad.");
        navigate(result.redirect || `/hub?v=${venue.slug || venueSlug}`);
        return;
      }

      window.location.href = result.url;
    } catch (err: any) {
      toast.error(err.message || "Kunde inte starta anmälan");
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] grid place-items-center" style={{ background: CREAM }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: NAVY }} />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-[100dvh] grid place-items-center px-6 text-center" style={{ background: CREAM, color: TEXT }}>
        <div>
          <p className="text-xl font-bold" style={{ fontFamily: FONT_HEADING }}>Passet hittades inte</p>
          <button onClick={() => navigate(`/hub?v=${venueSlug}`)} className="mt-4 rounded-2xl px-5 py-3 font-bold" style={{ background: NAVY, color: "#fff" }}>
            Till hubben
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] px-5" style={{ background: CREAM, color: TEXT, paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      <header className="mx-auto flex w-full max-w-md items-center gap-3 pb-5 pt-8">
        <button type="button" onClick={() => navigate(-1)} className="rounded-xl p-2 active:scale-95" aria-label="Tillbaka">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <img src={picklaLogo} alt="Pickla" className="h-6 w-auto" />
      </header>

      <main className="mx-auto w-full max-w-md pb-10">
        <section className="rounded-[28px] p-5" style={{ background: CARD, border: `1px solid ${BORDER}`, boxShadow: "0 18px 50px rgba(17,24,39,0.08)" }}>
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: MUTED, fontFamily: FONT_HEADING }}>
                {session.activity_series?.name || "Pickla program"}
              </p>
              <h1 className="mt-2 text-3xl font-black leading-[1.02]" style={{ fontFamily: FONT_HEADING }}>
                {session.name}
              </h1>
            </div>
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl" style={{ background: "#eef2ff", color: NAVY }}>
              <Ticket className="h-6 w-6" />
            </div>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center gap-3 rounded-2xl p-3" style={{ background: "#f8fafc" }}>
              <CalendarDays className="h-5 w-5" style={{ color: NAVY }} />
              <div>
                <p className="text-sm font-bold">{dayLabel}</p>
                <p className="text-xs" style={{ color: MUTED }}>{startTime}-{endTime}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-2xl p-3" style={{ background: "#f8fafc" }}>
              <CheckCircle2 className="h-5 w-5" style={{ color: GREEN }} />
              <div>
                <p className="text-sm font-bold">{product?.name || "Accessbiljett"}</p>
                <p className="text-xs" style={{ color: MUTED }}>
                  {venue?.name || "Pickla"} {session.capacity ? `· max ${session.capacity} platser` : ""}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em]" style={{ color: MUTED }}>Pris</p>
              <p className="mt-1 text-3xl font-black" style={{ fontFamily: FONT_HEADING, color: hasDiscount ? GREEN : TEXT }}>
                {hasDiscount && <span className="mr-2 text-base line-through" style={{ color: MUTED }}>{formatSek(basePrice)}</span>}
                {formatSek(memberPrice)}
              </p>
              {hasDiscount && <p className="mt-1 text-xs font-bold" style={{ color: GREEN }}>medlemspris</p>}
            </div>
          </div>

          <button
            type="button"
            onClick={handleCheckout}
            disabled={submitting}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-sm font-black active:scale-[0.98] disabled:opacity-60"
            style={{ background: NAVY, color: "#fff", fontFamily: FONT_HEADING }}
          >
            {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Öppnar anmälan</> : <>Anmäl mig · {formatSek(memberPrice)}</>}
          </button>

          <button
            type="button"
            onClick={() => navigate(`/hub?v=${venue?.slug || venueSlug}`)}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold active:scale-[0.98]"
            style={{ background: "#f8fafc", color: TEXT, border: `1px solid ${BORDER}` }}
          >
            <MessageCircle className="h-4 w-4" /> Till chatten
          </button>
        </section>
      </main>
    </div>
  );
}
