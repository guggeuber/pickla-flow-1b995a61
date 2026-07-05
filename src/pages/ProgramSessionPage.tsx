import { useMemo, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, CalendarDays, Check, Loader2, MessageCircle, Share2, Star, Ticket } from "lucide-react";
import { DateTime } from "luxon";
import { toast } from "sonner";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { apiGet, apiPost } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAccessSnapshot } from "@/hooks/useAccessSnapshot";
import { fetchActivitySessionOverrides, isPublicActivityOverrideHidden, occurrenceOverrideKey } from "@/lib/activitySessionOverrides";
import picklaLogo from "@/assets/pickla-logo.svg";
import { MemberStrip } from "@/components/ui/MemberStrip";
import { PriceLine } from "@/components/ui/PriceLine";
import { PeopleRow, ScarcityBadge } from "@/components/ui/PeopleRow";
import { formatSek } from "@/lib/activityPricing";

const BG = "#fbf7f2";
const TEXT = "#020617";
const MUTED = "#64748b";
const BORDER = "rgba(15,23,42,0.10)";
const NAVY = "#111827";
const MENU_BORDER = "rgba(17,17,17,0.12)";
const FONT_HEADING = "'Space Grotesk', sans-serif";

function safeLocalPath(path: string) {
  return path.startsWith("/") && !path.startsWith("//") ? path : "/today";
}

function publicProgramPath(sessionId: string, date: string | null | undefined, venueSlug: string) {
  const params = new URLSearchParams({
    ...(date ? { date } : {}),
    v: venueSlug,
  });
  return `/p/${encodeURIComponent(sessionId)}${params.toString() ? `?${params.toString()}` : ""}`;
}

function sessionTypeLabel(type?: string | null) {
  if (type === "open_play") return "Open Play";
  if (type === "group_training") return "Träning";
  return type || "Aktivitet";
}

export default function ProgramSessionPage({ overlayOnly = false }: { overlayOnly?: boolean }) {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [interestLoading, setInterestLoading] = useState(false);
  const [queueLoading, setQueueLoading] = useState(false);
  const [optimisticInterest, setOptimisticInterest] = useState<{ count: number; mine: boolean } | null>(null);
  const requestedDate = searchParams.get("date");
  const venueSlug = searchParams.get("v") || "pickla-arena-sthlm";
  const programPath = sessionId ? publicProgramPath(sessionId, requestedDate, venueSlug) : "/today";
  const todayPath = `/today?v=${encodeURIComponent(venueSlug)}`;
  const routeState = location.state as { activitySession?: any } | null;
  const optimisticSession = routeState?.activitySession || null;

  const { data: directSession, isLoading: sessionLoading } = useQuery({
    queryKey: ["program-session-direct", sessionId],
    enabled: !!sessionId,
    staleTime: 60000,
    queryFn: async () => {
      const { data: row, error: sessionError } = await supabase
        .from("activity_sessions")
        .select("id, name, session_type, session_date, recurrence_days, start_time, end_time, capacity, price_sek, product_key, venue_id, access_policy, metadata")
        .eq("id", sessionId!)
        .maybeSingle();
      if (sessionError) throw sessionError;
      return row;
    },
  });

  const earlyVenueId = directSession?.venue_id || optimisticSession?.venue_id || null;
  const earlyOccurrenceDate = requestedDate || directSession?.session_date || optimisticSession?.session_date || null;
  const accessSnapshot = useAccessSnapshot({ venueId: earlyVenueId, sessionDate: earlyOccurrenceDate });
  const waitForAccessSnapshot = !!user?.id && !!earlyVenueId && accessSnapshot.isLoading;

  const { data, isLoading: previewLoading, error } = useQuery({
    queryKey: [
      "program-session-entry",
      user?.id || "anon",
      sessionId,
      earlyOccurrenceDate || requestedDate || "date-pending",
      venueSlug,
      accessSnapshot.version,
    ],
    enabled: !!sessionId && !waitForAccessSnapshot,
    staleTime: user?.id ? 0 : 15000,
    queryFn: () => apiGet<any>("api-event-public", "activity-preview", {
      sessionId: sessionId!,
      venueSlug,
      ...(requestedDate ? { date: requestedDate } : {}),
    }),
  });

  const session = data?.activity_session || directSession || optimisticSession;
  const room = data?.room;
  const occurrenceDate = data?.occurrence_date || requestedDate || session?.session_date || null;
  const venueId = session?.venue_id || data?.venue?.id;
  const { data: occurrenceOverrideMap = new Map() } = useQuery({
    queryKey: ["program-session-override", venueId, sessionId, occurrenceDate],
    enabled: !!venueId && !!sessionId && !!occurrenceDate,
    staleTime: 10000,
    queryFn: () => fetchActivitySessionOverrides(venueId!, [sessionId!], occurrenceDate!, occurrenceDate!),
  });
  const occurrenceOverride = sessionId && occurrenceDate
    ? occurrenceOverrideMap.get(occurrenceOverrideKey(sessionId, occurrenceDate))
    : null;
  const occurrenceHidden = isPublicActivityOverrideHidden(occurrenceOverride?.status) || Boolean(error && !data?.activity_session);
  const accessSnapshotForResolvedSession = useAccessSnapshot({ venueId, sessionDate: occurrenceDate });
  const isLoading = sessionLoading && (previewLoading || waitForAccessSnapshot);

  const { data: registrations = [], refetch: refetchRegistrations } = useQuery({
    queryKey: ["program-session-registrations", sessionId, occurrenceDate, user?.id],
    enabled: !!sessionId && !!occurrenceDate,
    staleTime: 10000,
    queryFn: async () => {
      const { data: rows } = await supabase
        .from("session_registrations")
        .select("id, user_id, status")
        .eq("activity_session_id", sessionId!)
        .eq("session_date", occurrenceDate);
      return (rows || []).filter((row: any) => row.status !== "cancelled");
    },
  });

  const capacity = Number(session?.capacity || 0);
  const registrationCount = Number(data?.registrations?.count ?? registrations.length ?? 0);
  const spotsLeft = capacity ? Math.max(capacity - registrationCount, 0) : null;
  const isFull = spotsLeft === 0;
  const isRegistered = !!user?.id && registrations.some((row: any) => row.user_id === user.id);
  const userIsInterested = optimisticInterest?.mine ?? Boolean(data?.interests?.user_is_interested);
  const backendPricing = data?.activityTicketPricing || data?.pricing || null;
  const pricingDebug = backendPricing?.debug || {};
  const pricingMode = String(pricingDebug.pricing_mode || session?.metadata?.pricing_mode || "standard");
  const onlinePrice = Number(pricingDebug.online_price_sek ?? session?.metadata?.online_price_sek ?? backendPricing?.baseAmountSek ?? session?.price_sek ?? 0);
  const deskPrice = Number(pricingDebug.desk_price_sek ?? session?.metadata?.desk_price_sek ?? onlinePrice);
  const memberDiscountPercent = Number(pricingDebug.member_discount_percent ?? session?.metadata?.member_discount_percent ?? 0);
  const specialMemberPrice = pricingMode === "member_discount"
    ? Math.max(0, Math.round(onlinePrice * (1 - memberDiscountPercent / 100) * 100) / 100)
    : onlinePrice;
  const pricingPending = !!user?.id && (
    waitForAccessSnapshot ||
    accessSnapshotForResolvedSession.isLoading ||
    previewLoading ||
    !backendPricing
  );
  const basePrice = Number(backendPricing?.baseAmountSek ?? session?.price_sek ?? 0);
  const effectivePrice = Number(backendPricing?.effectivePriceSek ?? backendPricing?.finalAmountSek ?? basePrice);
  const displayedPrice = pricingPending ? "Hämtar pris..." : effectivePrice <= 0 ? 0 : effectivePrice;
  const checkoutLabel = pricingPending
    ? "Hämtar ditt pris..."
    : backendPricing?.checkoutLabel || formatSek(effectivePrice);
  const pricingIsIncluded = !pricingPending && backendPricing?.requiresCheckout === false;
  const requiresCheckout = !pricingPending && backendPricing?.requiresCheckout === true;
  const userHasMembership = Boolean(accessSnapshotForResolvedSession.data?.hasActiveMembership);
  const membershipName = String(
    backendPricing?.membershipTierName ||
    pricingDebug.membership_tier_name ||
    accessSnapshotForResolvedSession.data?.membershipTierName ||
    ""
  );
  const includedLabel = pricingIsIncluded
    ? backendPricing?.accessDecision === "day_access_included"
      ? "Ingår idag"
      : `Ingår i ${membershipName || "medlemskap"}`
    : null;
  const memberContextLine = !userHasMembership && pricingMode === "member_discount" && specialMemberPrice < onlinePrice
    ? <>Medlemmar spelar för {formatSek(specialMemberPrice)} eller fritt</>
    : !userHasMembership && pricingMode === "standard"
      ? <>Medlemmar kan spela billigare eller fritt</>
      : undefined;
  const savedTodaySek = !pricingPending && pricingIsIncluded && basePrice > effectivePrice
    ? Math.round((basePrice - effectivePrice) * 100) / 100
    : 0;
  const ctaLabel = isRegistered
    ? "Anmäld"
    : isFull
      ? userIsInterested ? "I kö ✓" : "Ställ mig i kö"
      : pricingPending
        ? "Hämtar ditt pris..."
        : `${user?.id ? (pricingIsIncluded ? "Anmäl" : "Fortsätt till betalning") : "Logga in & anmäl"} · ${checkoutLabel}`;

  const timeLabel = useMemo(() => {
    if (!session) return "";
    const start = session.start_time ? String(session.start_time).slice(0, 5) : "";
    const end = session.end_time ? String(session.end_time).slice(0, 5) : "";
    return [start, end].filter(Boolean).join("-");
  }, [session]);

  const dateLabel = occurrenceDate
    ? DateTime.fromISO(occurrenceDate, { zone: "Europe/Stockholm" }).toRelativeCalendar({ locale: "sv" }) || occurrenceDate
    : "";

  const openChat = () => {
    if (!room?.id) {
      toast.info("Chatten laddar strax");
      return;
    }
    navigate(`/chat/${room.id}?v=${encodeURIComponent(venueSlug)}`);
  };

  const announceJoin = async () => {
    if (!room?.id || !user?.id) return;
    const { data: profile } = await supabase
      .from("player_profiles")
      .select("display_name")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    const name = profile?.display_name || user.email?.split("@")[0] || "En spelare";
    await supabase.from("chat_messages").insert({
      room_id: room.id,
      user_id: user.id,
      message_type: "bot",
      content: `${name} kommer`,
      metadata: {
        channel: "activity_registration",
        activity_session_id: sessionId,
        session_date: occurrenceDate,
      },
    });
  };

  const startSignup = async () => {
    if (isFull) {
      await toggleInterest("primary");
      return;
    }
    if (occurrenceHidden) {
      toast.error("Aktiviteten är inte tillgänglig för anmälan");
      return;
    }
    if (isRegistered || !session || !occurrenceDate) return;
    if (!user?.id) {
      navigate(`/auth?redirect=${encodeURIComponent(safeLocalPath(programPath))}`);
      return;
    }
    if (!backendPricing || pricingPending) {
      toast.info("Hämtar ditt pris...");
      return;
    }
    if (loading) return;
    setLoading(true);
    try {
      const result = await apiPost("api-bookings", "create-checkout", {
        product_type: "activity_ticket",
        amount_sek: backendPricing.effectivePriceSek ?? backendPricing.finalAmountSek ?? 0,
        venue_id: session.venue_id,
          metadata: {
            date: occurrenceDate,
            activity_session_id: sessionId,
            chat_room_id: room?.id || "",
            session_name: session.name,
            session_type: session.session_type || "open_play",
            product_key: backendPricing?.productKey || session.product_key || "",
            preview_effective_amount_sek: String(backendPricing.effectivePriceSek ?? backendPricing.finalAmountSek ?? ""),
            pricing_reason: backendPricing.pricingReason || "",
            user_id: user.id,
            slug: venueSlug,
          redirect_path: safeLocalPath(programPath),
          success_path: `/booking/confirmed?type=session_ticket&next=${encodeURIComponent(safeLocalPath(programPath))}`,
        },
      });
      if (result.free) {
        await announceJoin();
        queryClient.invalidateQueries({ queryKey: ["access-snapshot"] });
        queryClient.invalidateQueries({ queryKey: ["program-session-entry"] });
        queryClient.invalidateQueries({ queryKey: ["program-session-registrations"] });
        await refetchRegistrations();
        toast.success("Du är anmäld");
        return;
      }
      if (!result.url) throw new Error("Kunde inte starta betalning");
      window.location.href = result.url;
    } catch (err: any) {
      toast.error(err.message || "Kunde inte starta anmälan");
    } finally {
      setLoading(false);
    }
  };

  const toggleInterest = async (source: "secondary" | "primary" = "secondary") => {
    if (!session || !occurrenceDate) return;
    if (!user?.id) {
      navigate(`/auth?redirect=${encodeURIComponent(safeLocalPath(programPath))}`);
      return;
    }
    if (interestLoading || queueLoading) return;
    if (source === "primary") setQueueLoading(true);
    else setInterestLoading(true);
    try {
      const result = await apiPost<any>("api-event-public", "activity-interest", {
        sessionId,
        date: occurrenceDate,
        venueSlug,
      });
      setOptimisticInterest({
        count: Number(result.interested_count || 0),
        mine: Boolean(result.user_is_interested),
      });
      toast.success(result.user_is_interested ? "Du är markerad som intresserad" : "Intresse borttaget");
      queryClient.invalidateQueries({ queryKey: ["program-session-entry"] });
    } catch (err: any) {
      toast.error(err.message || "Kunde inte uppdatera intresse");
    } finally {
      if (source === "primary") setQueueLoading(false);
      else setInterestLoading(false);
    }
  };

  const shareActivity = async () => {
    if (!session || !occurrenceDate) return;
    const sharePath = publicProgramPath(session.id, occurrenceDate, venueSlug);
    const shareUrl = `${window.location.origin}${sharePath}`;
    const shareText = `${session.name} ${dateLabel} ${timeLabel} — häng på! ${shareUrl}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: session.name,
          text: shareText,
          url: shareUrl,
        });
        return;
      }
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Länk kopierad");
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(shareUrl);
        toast.success("Länk kopierad");
      } catch {
        toast.error("Kunde inte dela länken");
      }
    }
  };

  const closeDrawer = (open: boolean) => {
    if (!open) {
      if (overlayOnly) navigate(-1);
      else navigate(todayPath);
    }
  };

  return (
    <div
      className={overlayOnly ? "contents" : "min-h-[100dvh] px-5 pb-8 pt-[calc(env(safe-area-inset-top,0px)+22px)]"}
      style={{ background: BG, color: TEXT }}
    >
      {!overlayOnly && (
      <>
      <div className="mx-auto flex max-w-md items-center justify-between">
        <button
          type="button"
          onClick={() => navigate(todayPath)}
          className="grid h-14 w-14 place-items-center rounded-full bg-white shadow-sm"
          style={{ border: `1px solid ${BORDER}` }}
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <img src={picklaLogo} alt="Pickla" className="h-8 w-auto" />
        <button
          type="button"
          onClick={openChat}
          disabled={!room?.id}
          className="grid h-14 w-14 place-items-center rounded-full bg-white shadow-sm disabled:opacity-40"
          style={{ border: `1px solid ${BORDER}` }}
        >
          <MessageCircle className="h-6 w-6" />
        </button>
      </div>

      <main className="mx-auto mt-12 max-w-md">
        {isLoading || (!session && !error && !occurrenceHidden) ? (
          <div className="grid justify-items-center gap-4 rounded-[28px] bg-white p-10 text-center shadow-sm" style={{ border: `1px solid ${BORDER}` }}>
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            <p className="text-lg font-black" style={{ fontFamily: FONT_HEADING }}>Hämtar aktiviteten</p>
          </div>
        ) : occurrenceHidden || (error && !session) ? (
          <div className="grid gap-4 rounded-[28px] bg-white p-7 text-center shadow-sm" style={{ border: `1px solid ${BORDER}` }}>
            <p className="text-xl font-black" style={{ fontFamily: FONT_HEADING }}>Aktiviteten hittades inte</p>
            <p className="text-sm font-bold" style={{ color: MUTED }}>Gå tillbaka till Pickla Idag och välj ett annat pass.</p>
            <button type="button" onClick={() => navigate(todayPath)} className="rounded-full bg-slate-950 px-5 py-3 text-sm font-black text-white">
              Till Pickla Idag
            </button>
          </div>
        ) : (
          <section className="pb-48">
            <p className="mb-4 text-[13px] font-black uppercase tracking-[0.24em]" style={{ color: MUTED }}>
              {sessionTypeLabel(session.session_type)}
            </p>
            <h1 className="text-[58px] font-black leading-[0.92] tracking-tight sm:text-[64px]" style={{ fontFamily: FONT_HEADING }}>
              {session.name}
            </h1>
            <div className="mt-8 flex items-center gap-3 text-[20px] font-black">
              <CalendarDays className="h-6 w-6" />
              <span>{dateLabel} · {timeLabel}</span>
            </div>
            <button
              type="button"
              onClick={openChat}
              className="mt-10 flex w-full items-center gap-3 rounded-2xl bg-white/70 p-3 text-left shadow-sm disabled:opacity-50"
              disabled={!room?.id}
              style={{ border: `1px solid ${BORDER}` }}
            >
              <span className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: "#eef2ff" }}>
                <MessageCircle className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold" style={{ fontFamily: FONT_HEADING }}>Öppna chatt</span>
                <span className="block truncate text-xs font-medium" style={{ color: MUTED }}>
                  Frågor och sena platser
                </span>
              </span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </section>
        )}
      </main>
      </>
      )}

      {session && !occurrenceHidden && (
        <Drawer open onOpenChange={closeDrawer} shouldScaleBackground={false}>
          <DrawerContent className="z-[60] h-[88dvh] max-h-[720px] overflow-hidden rounded-t-[28px] border-0 bg-white p-0 text-neutral-950">
            <DrawerTitle className="sr-only">{session.name}</DrawerTitle>
            <DrawerDescription className="sr-only">
              Välj biljett, se ditt pris och anmäl dig till aktiviteten.
            </DrawerDescription>
            <div className="mx-auto flex h-full w-full max-w-md min-w-0 flex-col overflow-hidden">
              <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4 pt-4 [overscroll-behavior:contain]">
                <div className="flex min-w-0 flex-col gap-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-[0.24em] text-neutral-400" style={{ fontFamily: "'Space Mono', monospace" }}>
                        {sessionTypeLabel(session.session_type)}
                      </p>
                      <h2 className="mt-1 text-[25px] font-black leading-none text-neutral-950" style={{ fontFamily: FONT_HEADING }}>
                        {session.name}
                      </h2>
                      <p className="mt-1.5 text-[13px] font-normal text-neutral-500">
                        {dateLabel} · {timeLabel}
                      </p>
                      <div className="mt-2">
                        <PeopleRow participantCount={registrationCount} />
                      </div>
                    </div>
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#f4f0ee]">
                      <Ticket className="h-6 w-6 text-neutral-950" />
                    </div>
                  </div>

                  <ScarcityBadge remaining={spotsLeft} capacity={capacity} />

                  {pricingIsIncluded ? (
                    <MemberStrip
                      planName={backendPricing?.accessDecision === "day_access_included" ? "dagspass" : membershipName || "medlemskap"}
                      amountSek={effectivePrice}
                    />
                  ) : (
                    <div className="rounded-[22px] bg-[#f8fafc] px-4 py-3" style={{ border: `1px solid ${MENU_BORDER}` }}>
                      <PriceLine
                        amountSek={displayedPrice}
                        contextLine={!userHasMembership && memberContextLine ? (
                          <details className="[&:not([open])_.price-details]:hidden">
                            <summary className="cursor-pointer select-none list-none text-neutral-700 underline underline-offset-2">
                              {memberContextLine} · Se detaljer
                            </summary>
                            <div className="price-details mt-3 grid gap-1.5 text-[12px] font-semibold text-neutral-500">
                              <div className="flex justify-between gap-3">
                                <span>Online</span>
                                <span>{formatSek(onlinePrice || basePrice)}</span>
                              </div>
                              {deskPrice > onlinePrice ? (
                                <div className="flex justify-between gap-3">
                                  <span>På plats</span>
                                  <span>{formatSek(deskPrice)}</span>
                                </div>
                              ) : null}
                              {pricingMode === "member_discount" && specialMemberPrice < onlinePrice ? (
                                <div className="flex justify-between gap-3">
                                  <span>Medlem</span>
                                  <span>{formatSek(specialMemberPrice)}</span>
                                </div>
                              ) : null}
                              {pricingMode === "standard" ? (
                                <p className="pt-1 text-neutral-400">
                                  Medlemspris eller inkludering beror på aktivt medlemskap.
                                </p>
                              ) : null}
                            </div>
                          </details>
                        ) : undefined}
                        size="lg"
                      />
                    </div>
                  )}
                  <div className="rounded-[22px] bg-[#f8fafc] px-4 py-3" style={{ border: `1px solid ${MENU_BORDER}` }}>
                    {pricingPending && (
                      <p className="text-[12px] font-semibold text-neutral-500">
                        Vi kontrollerar medlemskap, dagsaccess och entitlements.
                      </p>
                    )}
                    {isRegistered && savedTodaySek > 0 && (
                      <p className="text-[12px] font-semibold text-neutral-500">
                        Du sparade {formatSek(savedTodaySek)} idag.
                      </p>
                    )}
                    {requiresCheckout && (
                      <p className="mt-1 text-[12px] text-neutral-500">
                        Betalning sker via Stripe innan platsen bekräftas.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div
                className="shrink-0 bg-white px-6 pb-[calc(env(safe-area-inset-bottom,0px)+14px)] pt-3"
                style={{ borderTop: `1px solid ${BORDER}`, boxShadow: "0 -16px 32px rgba(15,23,42,0.08)" }}
              >
              <div className="mx-auto grid max-w-md gap-2">
                <button
                  type="button"
                  onClick={startSignup}
                  disabled={loading || queueLoading || isRegistered || pricingPending}
                  className="flex h-14 items-center justify-center gap-3 rounded-[22px] px-5 text-[17px] font-semibold disabled:opacity-60"
                  style={{
                    background: isRegistered || (isFull && userIsInterested) ? "#dcfce7" : NAVY,
                    color: isRegistered || (isFull && userIsInterested) ? "#15803d" : "white",
                    fontFamily: FONT_HEADING,
                  }}
                >
                  {loading || queueLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : isRegistered ? <Check className="h-5 w-5" /> : null}
                  {ctaLabel}
                </button>
                <div className={`grid gap-2 ${isRegistered ? "grid-cols-2" : "grid-cols-3"}`}>
                  <button
                    type="button"
                    onClick={toggleInterest}
                    disabled={interestLoading || queueLoading}
                    className="flex h-12 min-w-0 items-center justify-center gap-1.5 rounded-2xl bg-slate-100 px-2 text-[13px] font-normal text-slate-950 disabled:opacity-70"
                    style={{ fontFamily: FONT_HEADING }}
                  >
                    {interestLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : userIsInterested ? <Check className="h-4 w-4" /> : <Star className="h-4 w-4" />}
                    <span className="truncate">{userIsInterested ? "Intresserad" : "Intresserad"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={openChat}
                    disabled={!room?.id}
                    className="flex h-12 min-w-0 items-center justify-center gap-1.5 rounded-2xl bg-slate-100 px-2 text-[13px] font-normal text-slate-950 disabled:opacity-70"
                    style={{ fontFamily: FONT_HEADING }}
                  >
                    {previewLoading && !room?.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
                    <span className="truncate">Chatt</span>
                  </button>
                  {!isRegistered ? (
                    <button
                      type="button"
                      onClick={shareActivity}
                      className="flex h-12 min-w-0 items-center justify-center gap-1.5 rounded-2xl bg-slate-100 px-2 text-[13px] font-normal text-slate-950"
                      style={{ fontFamily: FONT_HEADING }}
                    >
                      <Share2 className="h-4 w-4" />
                      <span className="truncate">Dela</span>
                    </button>
                  ) : null}
                </div>
                {isRegistered ? (
                  <button
                    type="button"
                    onClick={shareActivity}
                    className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-slate-100 px-4 text-[14px] font-semibold text-slate-950"
                    style={{ fontFamily: FONT_HEADING }}
                  >
                    <Share2 className="h-4 w-4" />
                    Bjud in en vän
                  </button>
                ) : null}
              </div>
              </div>
            </div>
          </DrawerContent>
        </Drawer>
      )}
    </div>
  );
}
