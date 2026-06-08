import { useMemo, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, CalendarDays, Check, Loader2, MessageCircle, Share2, Star, Ticket, Users } from "lucide-react";
import { DateTime } from "luxon";
import { toast } from "sonner";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { apiGet, apiPost } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import picklaLogo from "@/assets/pickla-logo.svg";
import { activityPriceLabels, hasActiveMembership } from "@/lib/activityPricing";

const BG = "#fbf7f2";
const TEXT = "#020617";
const MUTED = "#64748b";
const BORDER = "rgba(15,23,42,0.10)";
const SOFT = "#f8fafc";
const NAVY = "#111827";
const GREEN = "#16a34a";
const MENU_BORDER = "rgba(17,17,17,0.12)";
const FONT_HEADING = "'Space Grotesk', sans-serif";

function safeLocalPath(path: string) {
  return path.startsWith("/") && !path.startsWith("//") ? path : "/today";
}

function sessionTypeLabel(type?: string | null) {
  if (type === "open_play") return "Open Play";
  if (type === "group_training") return "Träning";
  return type || "Aktivitet";
}

function activitySocialProofLabel(registrationsCount = 0, interestedCount = 0) {
  if (registrationsCount > 0 && interestedCount > 0) return `${registrationsCount} kommer · ${interestedCount} intresserade`;
  if (registrationsCount > 0) return `${registrationsCount} kommer`;
  if (interestedCount > 0) return `${interestedCount} intresserade`;
  return "";
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
  const programPath = `/program/${sessionId || ""}?${new URLSearchParams({
    ...(requestedDate ? { date: requestedDate } : {}),
    v: venueSlug,
  }).toString()}`;
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
        .select("id, name, session_type, session_date, recurrence_days, start_time, end_time, capacity, price_sek, product_key, venue_id")
        .eq("id", sessionId!)
        .maybeSingle();
      if (sessionError) throw sessionError;
      return row;
    },
  });

  const { data, isLoading: previewLoading, error } = useQuery({
    queryKey: ["program-session-entry", sessionId, requestedDate, venueSlug],
    enabled: !!sessionId,
    staleTime: 15000,
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
  const isLoading = sessionLoading && previewLoading;

  const { data: membership } = useQuery({
    queryKey: ["program-membership", user?.id, venueId],
    enabled: !!user?.id && !!venueId,
    staleTime: 30000,
    queryFn: () => apiGet("api-memberships", "user", { userId: user!.id, venueId }),
  });

  const { data: dayAccess } = useQuery({
    queryKey: ["program-day-access", user?.id, venueId, occurrenceDate],
    enabled: !!user?.id && !!venueId && !!occurrenceDate,
    staleTime: 30000,
    queryFn: async () => {
      const { data: row } = await supabase
        .from("access_entitlements")
        .select("id")
        .eq("user_id", user!.id)
        .eq("venue_id", venueId)
        .eq("entitlement_type", "day_access")
        .eq("status", "active")
        .eq("valid_date", occurrenceDate)
        .limit(1)
        .maybeSingle();
      return row;
    },
  });

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
  const interestedCount = optimisticInterest?.count ?? Number(data?.interests?.interested_count || 0);
  const userIsInterested = optimisticInterest?.mine ?? Boolean(data?.interests?.user_is_interested);
  const socialProofLabel = activitySocialProofLabel(registrationCount, interestedCount);
  const userHasMembership = hasActiveMembership(membership);
  const pricing = activityPriceLabels({
    basePrice: Number(session?.price_sek || 165),
    productKey: session?.product_key,
    sessionType: session?.session_type,
    membership,
    hasDayAccess: !!dayAccess,
  });

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
    if (isRegistered || !session || !occurrenceDate) return;
    if (!user?.id) {
      navigate(`/auth?redirect=${encodeURIComponent(safeLocalPath(programPath))}`);
      return;
    }
    if (loading) return;
    setLoading(true);
    try {
      const result = await apiPost("api-bookings", "create-checkout", {
        product_type: "day_pass",
        amount_sek: session.price_sek || 0,
        venue_id: session.venue_id,
        metadata: {
          date: occurrenceDate,
          activity_session_id: sessionId,
          chat_room_id: room?.id || "",
          session_name: session.name,
          session_type: session.session_type || "open_play",
          user_id: user.id,
          slug: venueSlug,
          redirect_path: safeLocalPath(programPath),
          success_path: `/booking/confirmed?type=session_ticket&next=${encodeURIComponent(safeLocalPath(programPath))}`,
        },
      });
      if (result.free) {
        await announceJoin();
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

  const openUpsell = (label: string) => {
    if ((label.includes("Access") || label.includes("Unlimited")) && !userHasMembership) {
      const params = new URLSearchParams();
      params.set("v", venueSlug);
      params.set("returnTo", safeLocalPath(programPath));
      navigate(`/membership?${params.toString()}`);
      return;
    }
    if (label.includes("Dagsmedlemskap") && !dayAccess) {
      toast.info("Dagsmedlemskap kommer strax här.");
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
      queryClient.invalidateQueries({ queryKey: ["program-session-entry", sessionId, requestedDate, venueSlug] });
    } catch (err: any) {
      toast.error(err.message || "Kunde inte uppdatera intresse");
    } finally {
      if (source === "primary") setQueueLoading(false);
      else setInterestLoading(false);
    }
  };

  const shareActivity = async () => {
    if (!session || !occurrenceDate) return;
    const sharePath = `/program/${session.id}?date=${encodeURIComponent(occurrenceDate)}&v=${encodeURIComponent(venueSlug)}`;
    const shareUrl = `${window.location.origin}${sharePath}`;
    const shareText = `Jag funderar på ${session.name} ${dateLabel} ${timeLabel} på Pickla. Häng på?`;
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
        {isLoading ? (
          <div className="grid justify-items-center gap-4 rounded-[28px] bg-white p-10 text-center shadow-sm" style={{ border: `1px solid ${BORDER}` }}>
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            <p className="text-lg font-black" style={{ fontFamily: FONT_HEADING }}>Hämtar aktiviteten</p>
          </div>
        ) : error && !session ? (
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
              className="mt-10 flex w-full items-center gap-4 rounded-[28px] bg-white p-5 text-left shadow-sm disabled:opacity-50"
              disabled={!room?.id}
              style={{ border: `1px solid ${BORDER}` }}
            >
              <span className="grid h-14 w-14 place-items-center rounded-2xl" style={{ background: "#eef2ff" }}>
                <MessageCircle className="h-7 w-7" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-black" style={{ fontFamily: FONT_HEADING }}>Öppna chat</span>
                <span className="block truncate text-sm font-bold" style={{ color: MUTED }}>
                  Frågor, sena platser och staff updates
                </span>
              </span>
              <ArrowRight className="h-5 w-5" />
            </button>
          </section>
        )}
      </main>
      </>
      )}

      {session && (
        <Drawer open onOpenChange={closeDrawer} shouldScaleBackground={false}>
          <DrawerContent className="z-[60] max-h-[88vh] overflow-hidden rounded-t-[28px] border-0 bg-white px-6 pb-[calc(env(safe-area-inset-bottom,0px)+16px)] pt-5 text-neutral-950">
            <div className="mx-auto flex w-full max-w-md min-w-0 flex-col gap-3 overflow-hidden pb-1">
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
                  {socialProofLabel && (
                    <p className="mt-1 text-[12px] font-normal text-neutral-400">
                      {socialProofLabel}
                    </p>
                  )}
                </div>
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#f4f0ee]">
                  <Ticket className="h-6 w-6 text-neutral-950" />
                </div>
              </div>

              <div className="flex min-w-0 flex-wrap gap-1.5">
                {pricing.publicChips.map((chip) => (
                  <span
                    key={chip}
                    className="rounded-full px-2.5 py-1.5 text-[11px] font-semibold"
                    style={{
                      background: chip.includes("ingår") ? "#ecfdf5" : SOFT,
                      color: chip.includes("ingår") ? GREEN : "#334155",
                      border: `1px solid ${chip.includes("ingår") ? "rgba(34,197,94,0.18)" : BORDER}`,
                    }}
                  >
                    {chip}
                  </span>
                ))}
              </div>

              <div className="rounded-2xl bg-white px-4 py-3" style={{ border: `1px solid ${MENU_BORDER}` }}>
                <div className="flex items-center justify-between gap-4">
                  <span className="inline-flex items-center gap-2 text-[15px] font-normal text-neutral-950" style={{ fontFamily: FONT_HEADING }}>
                    <Users className="h-4 w-4" />
                    {spotsLeft == null ? "Öppet" : spotsLeft === 0 ? "Fullt" : `${spotsLeft} kvar`}
                  </span>
                  <span className="text-[13px] font-semibold" style={{ color: isFull ? "#be123c" : "#16a34a" }}>
                    {isRegistered ? "Anmäld" : "Live"}
                  </span>
                </div>
                <p className="mt-1.5 text-[12px] font-normal text-neutral-400">
                  {socialProofLabel || "Inga anmälda ännu"}
                </p>
                {capacity ? (
                  <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, (registrationCount / capacity) * 100)}%`,
                        background: isFull ? "#be123c" : GREEN,
                      }}
                    />
                  </div>
                ) : null}
              </div>

              <div className="grid gap-2">
                {pricing.detailRows.map((row) => {
                  const isMembershipUpsell = !userHasMembership && (row.label.includes("Access") || row.label.includes("Unlimited"));
                  const isDayUpsell = !dayAccess && row.label.includes("Dagsmedlemskap");
                  const clickable = isMembershipUpsell || isDayUpsell;
                  return (
                    <button
                      key={row.label}
                      type="button"
                      onClick={() => clickable && openUpsell(row.label)}
                      className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-2xl bg-white px-4 py-3.5 text-left"
                      style={{
                        border: `1px solid ${MENU_BORDER}`,
                      }}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[16px] font-normal text-neutral-950" style={{ fontFamily: FONT_HEADING }}>
                          {row.label}
                        </span>
                        {isMembershipUpsell && (
                          <span className="mt-0.5 block truncate text-[12px] font-normal text-neutral-500">
                            {row.label.includes("Access") ? `Köp Access och boka för ${row.value}` : "Köp Unlimited och boka när det ingår"}
                          </span>
                        )}
                        {isDayUpsell && (
                          <span className="mt-0.5 block truncate text-[12px] font-normal text-neutral-500">
                            Uppgradera till heldag
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-[18px] font-normal text-neutral-950" style={{ fontFamily: FONT_HEADING }}>
                        {row.value}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="grid gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={startSignup}
                  disabled={loading || queueLoading || isRegistered}
                  className="flex h-14 items-center justify-center gap-3 rounded-[22px] px-5 text-[17px] font-semibold disabled:opacity-60"
                  style={{
                    background: isRegistered || (isFull && userIsInterested) ? "#dcfce7" : NAVY,
                    color: isRegistered || (isFull && userIsInterested) ? "#15803d" : "white",
                    fontFamily: FONT_HEADING,
                  }}
                >
                  {loading || queueLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : isRegistered ? <Check className="h-5 w-5" /> : null}
                  {isRegistered
                    ? "Anmäld"
                    : isFull
                      ? userIsInterested ? "I kö ✓" : "Ställ mig i kö"
                      : `${user?.id ? (pricing.checkoutLabel === "Ingår" ? "Anmäl" : "Fortsätt till betalning") : "Logga in & anmäl"} · ${pricing.checkoutLabel}`}
                </button>
                <div className="grid grid-cols-3 gap-2">
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
                    <span className="truncate">Lobbyn</span>
                  </button>
                  <button
                    type="button"
                    onClick={shareActivity}
                    className="flex h-12 min-w-0 items-center justify-center gap-1.5 rounded-2xl bg-slate-100 px-2 text-[13px] font-normal text-slate-950"
                    style={{ fontFamily: FONT_HEADING }}
                  >
                    <Share2 className="h-4 w-4" />
                    <span className="truncate">Dela</span>
                  </button>
                </div>
              </div>
            </div>
          </DrawerContent>
        </Drawer>
      )}
    </div>
  );
}
