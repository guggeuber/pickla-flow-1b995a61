import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Loader2, MessageCircle, Ticket, X } from "lucide-react";
import { DateTime } from "luxon";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { preserveIntendedRoute } from "@/lib/entryResolver";
import { activityCheckInAvailable, activityTimingLabel } from "@/lib/activityTiming";
import picklaLogo from "@/assets/pickla-logo.svg";
import { BookingParticipantSummary, type BookingParticipantSummaryData } from "@/components/bookings/BookingParticipantSummary";

const FONT_GROTESK = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

type ParticipantTicketResponse = {
  ticket: { token: string; can_cancel: boolean; can_check_in: boolean };
  venue?: { id?: string; name?: string; slug?: string };
  booking: {
    booking_ref: string;
    chat_resource_id?: string;
    start_time: string;
    end_time: string;
    capacity?: number;
    courts: { id?: string; name?: string | null; court_number?: number | null }[];
  };
  participant_summary?: BookingParticipantSummaryData;
  participant: {
    id: string;
    display_name: string | null;
    price_minor: number;
    payment_status: string;
    checked_in_at: string | null;
  };
};

function moneyFromMinor(minor: number) {
  return `${Math.round(Number(minor || 0)) / 100} kr`;
}

export default function BookingParticipantTicketPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  const [checkingIn, setCheckingIn] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const { data, isLoading, error, refetch } = useQuery<ParticipantTicketResponse>({
    queryKey: ["booking-participant-ticket", token, user?.id || "guest"],
    enabled: Boolean(token) && !authLoading,
    queryFn: () => apiGet("api-bookings", "booking-participant-ticket", { token: token || "" }),
  });

  const timing = useMemo(() => {
    if (!data?.booking?.start_time || !data?.booking?.end_time) return null;
    const start = DateTime.fromISO(data.booking.start_time, { zone: "utc" }).setZone("Europe/Stockholm");
    const end = DateTime.fromISO(data.booking.end_time, { zone: "utc" }).setZone("Europe/Stockholm");
    return { start, end };
  }, [data?.booking?.end_time, data?.booking?.start_time]);

  const dateLabel = timing
    ? `${timing.start.setLocale("sv").toFormat("cccc d MMM")} · ${timing.start.toFormat("HH:mm")}–${timing.end.toFormat("HH:mm")}`
    : "";
  const courtLine = (data?.booking?.courts || [])
    .map((court) => court.name || (court.court_number ? `Bana ${court.court_number}` : null))
    .filter(Boolean)
    .join(", ");
  const checkedIn = Boolean(data?.participant?.checked_in_at);
  const checkInAvailable = timing ? activityCheckInAvailable({
    sessionDate: timing.start.toISODate(),
    startTime: timing.start.toFormat("HH:mm"),
    endTime: timing.end.toFormat("HH:mm"),
  }) : false;
  const timingLabel = timing ? activityTimingLabel({
    sessionDate: timing.start.toISODate(),
    startTime: timing.start.toFormat("HH:mm"),
    endTime: timing.end.toFormat("HH:mm"),
    checkedIn,
    checkInAvailable,
  }) : "";
  const paidEnough = ["paid", "free"].includes(String(data?.participant?.payment_status || "").toLowerCase());
  const needsAuth = !user;

  const goToAuth = () => {
    const currentPath = `${window.location.pathname}${window.location.search}`;
    preserveIntendedRoute(currentPath);
    navigate(`/auth?redirect=${encodeURIComponent(currentPath)}`);
  };

  const handleCheckIn = async () => {
    if (!data?.venue?.id || !data.participant.id) return;
    if (!user) return goToAuth();
    setCheckingIn(true);
    try {
      await apiPost("api-checkins", "self", {
        venue_id: data.venue.id,
        venue_slug: data.venue.slug || "",
        entry_type: "booking_participant",
        entitlement_id: data.participant.id,
      });
      toast.success("Du är incheckad");
      await refetch();
      queryClient.invalidateQueries({ queryKey: ["my-bookings"] });
    } catch (err: any) {
      toast.error(err?.message || "Kunde inte checka in");
    } finally {
      setCheckingIn(false);
    }
  };

  const handleCancel = async () => {
    if (!token) return;
    if (!user) return goToAuth();
    setCancelling(true);
    try {
      const result = await apiPost<{ refund_note?: string | null }>("api-bookings", "booking-participant-cancel", { token });
      toast.success(result.refund_note || "Din plats är avbokad");
      await refetch();
      queryClient.invalidateQueries({ queryKey: ["my-bookings"] });
    } catch (err: any) {
      toast.error(err?.message || "Kunde inte avboka platsen");
    } finally {
      setCancelling(false);
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
          <p className="text-lg font-bold" style={{ fontFamily: FONT_GROTESK }}>Biljetten hittades inte</p>
          <p className="mt-2 text-sm text-neutral-500" style={{ fontFamily: FONT_MONO }}>Be bokaren skicka länken igen.</p>
        </div>
      </div>
    );
  }

  const isCancelled = data.participant.payment_status === "cancelled";

  return (
    <div className="min-h-[100dvh] bg-[#f7f4ee] text-neutral-950">
      <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-5 py-6">
        <div className="flex items-center justify-between">
          <Link to="/my" className="grid h-11 w-11 place-items-center rounded-full bg-white border border-neutral-200">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <img src={picklaLogo} alt="Pickla" className="h-7 w-auto" />
          <div className="h-11 w-11" />
        </div>

        <section className="mt-8 rounded-[32px] bg-white border border-neutral-200 p-6 shadow-sm">
          <p className="text-[11px] uppercase tracking-[0.22em] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
            Din plats
          </p>
          <h1 className="mt-3 text-[34px] leading-none font-black tracking-tight" style={{ fontFamily: FONT_GROTESK }}>
            {courtLine || "Bana"}
          </h1>
          <p className="mt-4 text-sm text-neutral-500" style={{ fontFamily: FONT_MONO }}>{dateLabel}</p>
          {timingLabel && (
            <p className="mt-2 text-base font-black text-neutral-700" style={{ fontFamily: FONT_GROTESK }}>
              {isCancelled ? "Avbokad" : timingLabel}
            </p>
          )}

          <div className="mt-6 rounded-3xl border border-neutral-200 bg-[#fbfaf7] p-4">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-neutral-950 text-white">
                <Ticket className="h-6 w-6" />
              </div>
              <div>
                <p className="text-lg font-black" style={{ fontFamily: FONT_GROTESK }}>
                  {data.participant.display_name || "Din biljett"}
                </p>
                <p className="text-sm text-neutral-500" style={{ fontFamily: FONT_MONO }}>
                  {data.participant.payment_status === "free" ? "Ingår" : data.participant.payment_status === "paid" ? `Betald · ${moneyFromMinor(data.participant.price_minor)}` : "Väntar på betalning"}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4">
            <BookingParticipantSummary summary={data.participant_summary} />
          </div>

          {needsAuth && (
            <button
              onClick={goToAuth}
              className="mt-5 w-full rounded-full bg-neutral-950 px-5 py-4 text-base font-black text-white"
              style={{ fontFamily: FONT_GROTESK }}
            >
              Logga in för check-in
            </button>
          )}

          {!needsAuth && !isCancelled && (
            <div className="mt-5 space-y-3">
              <button
                onClick={handleCheckIn}
                disabled={checkingIn || checkedIn || !paidEnough || !checkInAvailable}
                className="inline-flex w-full items-center justify-center gap-3 rounded-full bg-neutral-950 px-5 py-4 text-base font-black text-white disabled:opacity-40"
                style={{ fontFamily: FONT_GROTESK }}
              >
                {checkingIn ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
                {checkedIn ? "Incheckad" : "Checka in"}
              </button>
              <button
                onClick={() => navigate(`/booking-chat/${encodeURIComponent(data.booking.chat_resource_id || data.booking.booking_ref || "")}`)}
                className="inline-flex w-full items-center justify-center gap-3 rounded-full border border-neutral-200 bg-white px-5 py-4 text-base font-black text-neutral-900"
                style={{ fontFamily: FONT_GROTESK }}
              >
                <MessageCircle className="h-5 w-5" />
                Gå till chatt
              </button>
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="inline-flex w-full items-center justify-center gap-3 rounded-full border border-red-100 bg-white px-5 py-4 text-sm font-black text-red-500 disabled:opacity-50"
                style={{ fontFamily: FONT_GROTESK }}
              >
                {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                Avboka min plats
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
