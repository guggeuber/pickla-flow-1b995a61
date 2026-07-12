import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Ticket } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { preserveIntendedRoute } from "@/lib/entryResolver";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";
import { canonicalAppOrigin, canonicalRedirectUrl, enforceCanonicalHost } from "@/lib/canonicalOrigin";
import { BookingParticipantSummary, type BookingParticipantSummaryData } from "@/components/bookings/BookingParticipantSummary";
import { SessionActions, SessionDrawerShell, SessionPeopleRow, SessionPriceBlock } from "@/components/session";
import { openBookingToPresentation } from "@/lib/sessionPresentation";

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
    committed_count?: number;
    source?: "open_booking" | "private_invite" | string;
    pace_label?: string | null;
    open_for_more_note?: string | null;
    booker_first_name?: string | null;
  };
  participant_summary?: BookingParticipantSummaryData;
  pricing?: {
    price_minor: number;
    price_sek: number;
    label: string;
    reason?: string;
    membership_tier_names?: string[];
    requires_payment: boolean;
  } | null;
  identity_required?: boolean;
};

function isUsableSession(session: Session | null) {
  if (!session?.access_token || !session.user?.id) return false;
  if (session.expires_at && session.expires_at * 1000 <= Date.now()) return false;
  return true;
}

export default function ClaimBookingParticipantPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { loading: authLoading, session } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const [verifiedSession, setVerifiedSession] = useState<Session | null>(null);
  const [authNotice, setAuthNotice] = useState("");
  const previousAuthKeyRef = useRef("initial");
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const isWrongAuthOrigin = Boolean(canonicalRedirectUrl());
  const verifiedUser = isUsableSession(verifiedSession) ? verifiedSession?.user ?? null : null;

  useEffect(() => {
    if (!isWrongAuthOrigin) return;
    enforceCanonicalHost();
  }, [isWrongAuthOrigin]);

  useEffect(() => {
    if (authLoading || isWrongAuthOrigin) return;
    let active = true;
    setSessionHydrated(false);
    const hydrate = async () => {
      const fresh = isUsableSession(session) ? session : null;
      if (fresh) return { data: { session: fresh } };
      return supabase.auth.getSession();
    };
    hydrate().then(({ data }) => {
      if (!active) return;
      const session = isUsableSession(data.session) ? data.session : null;
      setVerifiedSession(session);
      setSessionHydrated(true);
    }).catch((error) => {
      if (!active) return;
      console.error("[booking-participant-claim] auth hydration failed", error?.name, error?.message);
      setVerifiedSession(null);
      setSessionHydrated(true);
    });
    return () => {
      active = false;
    };
  }, [authLoading, isWrongAuthOrigin, session?.access_token, session?.user?.id]);

  const authKey = verifiedUser?.id
    ? `${verifiedUser.id}:${verifiedSession?.access_token?.slice(-10) || "session"}`
    : "guest";

  const { data, isLoading, error, refetch } = useQuery<InviteInfo>({
    queryKey: ["booking-participant-invite", token, authKey],
    queryFn: () => apiGet("api-bookings", "booking-participant-invite", { token: token || "" }),
    enabled: Boolean(token) && !authLoading && sessionHydrated && !isWrongAuthOrigin,
  });

  useEffect(() => {
    if (!token || !sessionHydrated) return;
    const previous = previousAuthKeyRef.current;
    previousAuthKeyRef.current = authKey;
    if (previous === "initial" || previous === authKey) return;
    queryClient.invalidateQueries({ queryKey: ["booking-participant-invite", token] });
  }, [authKey, queryClient, sessionHydrated, token]);

  useEffect(() => {
    const meta = verifiedUser?.user_metadata || {};
    const name = String(meta.display_name || meta.full_name || meta.name || "").trim();
    if (name && !displayName) setDisplayName(name);
    if (verifiedUser?.email && !email) setEmail(verifiedUser.email);
  }, [displayName, email, verifiedUser]);

  const courtLine = (data?.booking?.courts || [])
    .map((court) => court.name || (court.court_number ? `Bana ${court.court_number}` : null))
    .filter(Boolean)
    .join(", ");

  const nameValid = displayName.trim().length > 0;
  const isOpenPrivateBooking = data?.booking?.source === "open_booking";
  const hasPlayPlus = (data?.pricing?.membership_tier_names || []).some((name) => /play\+/i.test(name));
  const authenticatedPricingResolving = Boolean(verifiedUser) && (!data?.pricing || isLoading);
  const claimDisabled = submitting || authLoading || !sessionHydrated || !verifiedUser || !data?.booking || authenticatedPricingResolving || !nameValid;
  const claimDebugState = {
    authLoaded: !authLoading && sessionHydrated,
    inviteLoaded: Boolean(data?.invite),
    bookingLoaded: Boolean(data?.booking),
    customerResolved: Boolean(verifiedUser),
    profileResolved: Boolean(displayName.trim() || verifiedUser?.user_metadata),
    nameValid,
    isLoading,
    authLoading,
    sessionHydrated,
    verifiedSessionPresent: Boolean(verifiedSession?.access_token),
    submitting,
    pricingResolved: Boolean(data?.pricing),
    capacityState: data?.booking ? `${data.booking.claimed_count}/${data.booking.capacity}` : null,
    holdState: "not_acquired_until_checkout",
    disabled: claimDisabled,
  };

  const participantPeople = (data?.participant_summary?.participants || [])
    .filter((participant) => participant.committed)
    .map((participant) => ({
      id: participant.id,
      display_name: participant.display_name || "Spelare",
      avatar_url: null,
    }));

  const sessionPresentation = data?.booking
    ? openBookingToPresentation({
        id: token || data.booking.booking_ref,
        bookerFirstName: data.booking.booker_first_name,
        startsAt: data.booking.start_time,
        endsAt: data.booking.end_time,
        venueName: data.venue?.name,
        resourceNames: courtLine ? [courtLine] : [],
        people: participantPeople,
        committedCount: Number(data.booking.committed_count ?? data.participant_summary?.committed_count ?? 0),
        capacity: Number(data.booking.capacity || data.participant_summary?.capacity || 0),
        placesLeft: Math.max(
          0,
          Number(data.booking.capacity || data.participant_summary?.capacity || 0) -
            Number(data.booking.committed_count ?? data.participant_summary?.committed_count ?? 0),
        ),
        pace: data.booking.pace_label,
        description: data.booking.open_for_more_note,
        pricing: verifiedUser
          ? data.pricing
            ? Number(data.pricing.price_sek || 0) <= 0
              ? { kind: "included", label: data.pricing.label || "Ingår", amountSek: 0 }
              : { kind: "amount", amountSek: data.pricing.price_sek, contextLabel: data.pricing.label || "Din del av banan" }
            : { kind: "pending", label: "Hämtar personligt pris", contextLabel: "Vi kontrollerar medlemskap och rätt pris." }
          : { kind: "status", label: "Logga in för att hämta din plats" },
        primaryAction: {
          key: verifiedUser ? "claim" : "login",
          label: verifiedUser
            ? data.pricing?.requires_payment
              ? "Betala och hämta plats"
              : "Hämta plats"
            : "Logga in",
        },
        route: currentPath,
      })
    : null;

  const goToIdentity = () => {
    preserveIntendedRoute(currentPath);
    navigate(`/auth?redirect=${encodeURIComponent(currentPath)}`);
  };

  const handleClaim = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token || !data?.booking?.venue_id) return;
    if (!displayName.trim()) {
      console.info("[booking-participant-claim] blocked before submit", claimDebugState);
      toast.error("Skriv ditt namn först.");
      return;
    }

    setSubmitting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const currentSession = isUsableSession(sessionData.session) ? sessionData.session : null;
      if (!currentSession) {
        console.info("[booking-participant-claim] missing verified session before submit", claimDebugState);
        setVerifiedSession(null);
        setAuthNotice("Logga in för att hämta din plats.");
        preserveIntendedRoute(currentPath);
        return;
      }
      const claim = await apiPost<any>("api-bookings", "booking-participant-claim", {
        token,
        displayName: displayName.trim(),
        email: email.trim(),
        phone: phone.trim(),
      });

      if (claim.free || Number(claim.amount_sek || 0) <= 0) {
        toast.success("Din plats är klar.");
        navigate(claim.ticket_url ? new URL(claim.ticket_url, canonicalAppOrigin()).pathname : (claim.booking_ref ? `/b/${claim.booking_ref}` : "/my"));
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
          customer_email: email.trim() || currentSession.user.email || "",
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

  if (isLoading || authLoading || !sessionHydrated || isWrongAuthOrigin) {
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

  if (!sessionPresentation) return null;

  return (
    <SessionDrawerShell
      standalone
      presentation={sessionPresentation}
      onOpenChange={(open) => {
        if (!open) navigate("/today");
      }}
      footer={
        !verifiedUser ? (
          <SessionActions
            primary={{
              key: "login",
              label: "Logga in",
              onClick: goToIdentity,
              icon: <Ticket className="h-5 w-5" />,
            }}
          />
        ) : (
          <SessionActions
            primary={{
              key: "claim",
              label: data.pricing?.requires_payment ? "Betala och hämta plats" : "Hämta plats",
              type: "submit",
              form: "booking-participant-claim-form",
              disabled: claimDisabled,
              icon: submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Ticket className="h-5 w-5" />,
            }}
          />
        )
      }
    >
      <SessionPeopleRow presentation={sessionPresentation} variant="drawer" />

      <SessionPriceBlock presentation={sessionPresentation} variant="drawer" />

      {data.booking.open_for_more_note ? (
        <div className="rounded-3xl border border-neutral-200 bg-[#fbfaf7] p-4">
          <p className="text-sm leading-relaxed text-neutral-600">{data.booking.open_for_more_note}</p>
        </div>
      ) : null}

      <BookingParticipantSummary summary={data.participant_summary} compact />

      {!verifiedUser ? (
        <div className="rounded-3xl border border-neutral-200 bg-[#fbfaf7] p-4">
          <p className="text-lg font-black text-neutral-900" style={{ fontFamily: FONT_GROTESK }}>
            Logga in för att hämta din plats
          </p>
          <p className="mt-2 text-sm leading-relaxed text-neutral-500" style={{ fontFamily: FONT_MONO }}>
            Efter inloggning kommer du tillbaka hit.
          </p>
          {authNotice ? (
            <p className="mt-3 rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-600" style={{ fontFamily: FONT_MONO }}>
              {authNotice}
            </p>
          ) : null}
        </div>
      ) : (
        <>
          {isOpenPrivateBooking && data.pricing?.requires_payment && hasPlayPlus ? (
            <p className="rounded-2xl border border-neutral-200 bg-[#fbfaf7] px-4 py-3 text-xs text-neutral-500" style={{ fontFamily: FONT_MONO }}>
              Ingår inte i Play+. Det här är en delad privat bana, inte Open Play.
            </p>
          ) : null}
          <form id="booking-participant-claim-form" onSubmit={handleClaim} className="space-y-3">
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
          </form>
        </>
      )}
    </SessionDrawerShell>
  );
}
