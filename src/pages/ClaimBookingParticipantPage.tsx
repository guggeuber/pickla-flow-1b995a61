import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Ticket, Users } from "lucide-react";
import { DateTime } from "luxon";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { preserveIntendedRoute } from "@/lib/entryResolver";
import picklaLogo from "@/assets/pickla-logo.svg";

const FONT_GROTESK = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

type InviteInfo = {
  venue?: { name?: string; slug?: string };
  booking?: {
    booking_ref: string;
    venue_id: string;
    start_time: string;
    end_time: string;
    duration_hours: number;
    courts: { name?: string | null; court_number?: number | null }[];
    capacity: number;
    claimed_count: number;
  };
  pricing?: {
    price_minor: number;
    price_sek: number;
    label: string;
    requires_payment: boolean;
  } | null;
  identity_required?: boolean;
};

export default function ClaimBookingParticipantPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data, isLoading, error, refetch } = useQuery<InviteInfo>({
    queryKey: ["booking-participant-invite", token, user?.id || "guest"],
    queryFn: () => apiGet("api-bookings", "booking-participant-invite", { token: token || "" }),
    enabled: Boolean(token) && !authLoading,
  });

  useEffect(() => {
    const meta = user?.user_metadata || {};
    const name = String(meta.display_name || meta.full_name || meta.name || "").trim();
    if (name && !displayName) setDisplayName(name);
    if (user?.email && !email) setEmail(user.email);
  }, [displayName, email, user]);

  const dateLine = useMemo(() => {
    if (!data?.booking?.start_time || !data?.booking?.end_time) return "";
    const start = DateTime.fromISO(data.booking.start_time, { zone: "utc" }).setZone("Europe/Stockholm");
    const end = DateTime.fromISO(data.booking.end_time, { zone: "utc" }).setZone("Europe/Stockholm");
    return `${start.setLocale("sv").toFormat("cccc d MMM")} · ${start.toFormat("HH:mm")}–${end.toFormat("HH:mm")}`;
  }, [data?.booking?.end_time, data?.booking?.start_time]);

  const courtLine = (data?.booking?.courts || [])
    .map((court) => court.name || (court.court_number ? `Bana ${court.court_number}` : null))
    .filter(Boolean)
    .join(", ");

  const formatMoney = (value: number) => `${Number(value || 0).toLocaleString("sv-SE", { maximumFractionDigits: 2 })} kr`;
  const currentPath = `${window.location.pathname}${window.location.search}`;

  const goToIdentity = () => {
    preserveIntendedRoute(currentPath);
    navigate(`/auth?redirect=${encodeURIComponent(currentPath)}`);
  };

  const handleClaim = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token || !data?.booking?.venue_id) return;
    if (!user) {
      goToIdentity();
      return;
    }
    if (!displayName.trim()) {
      toast.error("Skriv ditt namn först.");
      return;
    }

    setSubmitting(true);
    try {
      const claim = await apiPost<any>("api-bookings", "booking-participant-claim", {
        token,
        displayName: displayName.trim(),
        email: email.trim(),
        phone: phone.trim(),
      });

      if (claim.free || Number(claim.amount_sek || 0) <= 0) {
        toast.success("Din plats är klar.");
        navigate(claim.ticket_url ? new URL(claim.ticket_url, window.location.origin).pathname : (claim.booking_ref ? `/b/${claim.booking_ref}` : "/my"));
        return;
      }

      if (!email.trim()) {
        toast.error("E-post krävs för betalning.");
        await refetch();
        return;
      }

      const checkout = await apiPost<any>("api-bookings", "create-checkout", {
        product_type: "booking_participant",
        amount_sek: Number(claim.amount_sek || 0),
        venue_id: data.booking.venue_id,
        metadata: {
          booking_participant_id: claim.participant_id,
          customer_name: displayName.trim(),
          customer_email: email.trim() || user.email || "",
          customer_phone: phone.trim(),
          success_path: "/booking/confirmed?type=booking_participant",
        },
      });
      if (checkout?.url) {
        window.location.href = checkout.url;
        return;
      }
      toast.error("Kunde inte starta betalningen.");
    } catch (err: any) {
      toast.error(err?.message || "Något gick fel.");
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading || authLoading) {
    return (
      <div className="min-h-[100dvh] bg-[#f7f4ee] grid place-items-center">
        <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (error || !data?.booking) {
    return (
      <div className="min-h-[100dvh] bg-[#f7f4ee] px-6 py-10">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-neutral-500" style={{ fontFamily: FONT_MONO }}>
          <ArrowLeft className="h-4 w-4" />
          Tillbaka
        </Link>
        <div className="mt-20 rounded-[28px] bg-white border border-neutral-200 p-6 text-center">
          <p className="text-lg font-bold" style={{ fontFamily: FONT_GROTESK }}>Länken hittades inte</p>
          <p className="mt-2 text-sm text-neutral-500" style={{ fontFamily: FONT_MONO }}>Be bokaren skicka en ny medspelarlänk.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#f7f4ee] text-neutral-950">
      <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-5 py-6">
        <div className="flex items-center justify-between">
          <Link to="/" className="grid h-11 w-11 place-items-center rounded-full bg-white border border-neutral-200">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <img src={picklaLogo} alt="Pickla" className="h-7 w-auto" />
          <div className="h-11 w-11" />
        </div>

        <section className="mt-8 rounded-[32px] bg-white border border-neutral-200 p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
                Medspelare
              </p>
              <h1 className="mt-3 text-[32px] leading-none font-black tracking-tight" style={{ fontFamily: FONT_GROTESK }}>
                Din plats på banan
              </h1>
            </div>
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-neutral-100">
              <Users className="h-7 w-7" />
            </div>
          </div>

          <div className="mt-6 space-y-2 text-sm text-neutral-600" style={{ fontFamily: FONT_MONO }}>
            <p>{dateLine}</p>
            {courtLine && <p>{courtLine}</p>}
            <p>{data.booking.claimed_count}/{data.booking.capacity} spelare klara</p>
          </div>

          {!user ? (
            <div className="mt-6 rounded-3xl border border-neutral-200 bg-[#fbfaf7] p-4">
              <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
                Personlig plats
              </p>
              <p className="mt-2 text-lg font-black text-neutral-900" style={{ fontFamily: FONT_GROTESK }}>
                Identifiera dig för att få din personliga plats.
              </p>
              <p className="mt-2 text-sm leading-relaxed text-neutral-500" style={{ fontFamily: FONT_MONO }}>
                Priset visas först efter login, eftersom Founder, Play, Play+ och drop-in kan ha olika rätt.
              </p>
              <button
                type="button"
                onClick={goToIdentity}
                className="mt-4 inline-flex w-full items-center justify-center gap-3 rounded-full bg-neutral-950 px-5 py-4 text-base font-black text-white"
                style={{ fontFamily: FONT_GROTESK }}
              >
                <Ticket className="h-5 w-5" />
                Identifiera mig
              </button>
            </div>
          ) : (
            <>
              <div className="mt-6 rounded-3xl border border-neutral-200 bg-[#fbfaf7] p-4">
                <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
                  Din plats
                </p>
                <div className="mt-2 flex items-end justify-between gap-4">
                  <p className="text-lg font-bold text-neutral-700" style={{ fontFamily: FONT_GROTESK }}>
                    {data.pricing?.label || "Din del av banan"}
                  </p>
                  <p className="text-[34px] leading-none font-black" style={{ fontFamily: FONT_GROTESK }}>
                    {formatMoney(data.pricing?.price_sek || 0)}
                  </p>
                </div>
              </div>

              <form onSubmit={handleClaim} className="mt-6 space-y-3">
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Ditt namn"
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-4 text-base outline-none focus:border-neutral-400"
                  style={{ fontFamily: FONT_MONO }}
                  required
                />
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="E-post för kvitto"
                  type="email"
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-4 text-base outline-none focus:border-neutral-400"
                  style={{ fontFamily: FONT_MONO }}
                  required={Boolean(data.pricing?.requires_payment)}
                />
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="Telefon (valfritt)"
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-4 text-base outline-none focus:border-neutral-400"
                  style={{ fontFamily: FONT_MONO }}
                />
                <button
                  type="submit"
                  disabled={submitting || !data.pricing}
                  className="mt-2 inline-flex w-full items-center justify-center gap-3 rounded-full bg-neutral-950 px-5 py-4 text-base font-black text-white disabled:opacity-50"
                  style={{ fontFamily: FONT_GROTESK }}
                >
                  {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Ticket className="h-5 w-5" />}
                  {data.pricing?.requires_payment ? "Betala och hämta plats" : "Hämta plats"}
                </button>
              </form>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
