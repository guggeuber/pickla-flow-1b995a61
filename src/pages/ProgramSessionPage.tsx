import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, CalendarDays, Check, Loader2, MessageCircle, Ticket, Users } from "lucide-react";
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
const FONT_HEADING = "'Space Grotesk', sans-serif";

function safeLocalPath(path: string) {
  return path.startsWith("/") && !path.startsWith("//") ? path : "/today";
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
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [joined, setJoined] = useState(false);
  const requestedDate = searchParams.get("date");
  const venueSlug = searchParams.get("v") || "pickla-arena-sthlm";
  const programPath = `/program/${sessionId || ""}?${new URLSearchParams({
    ...(requestedDate ? { date: requestedDate } : {}),
    v: venueSlug,
  }).toString()}`;
  const todayPath = `/today?v=${encodeURIComponent(venueSlug)}`;

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

  const session = data?.activity_session || directSession;
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

  const { data: registrations = [] } = useQuery({
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
  const isRegistered = joined || (!!user?.id && registrations.some((row: any) => row.user_id === user.id));
  const userHasMembership = hasActiveMembership(membership);
  const pricing = activityPriceLabels({
    basePrice: Number(session?.price_sek || 165),
    productKey: session?.product_key,
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
    if (isFull || isRegistered || !session || !occurrenceDate) return;
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
        setJoined(true);
        toast.success("Du är anmäld");
        queryClient.invalidateQueries({ queryKey: ["program-session-registrations"] });
        return;
      }
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
          <DrawerContent className="z-[60] max-h-[88vh] rounded-t-[30px] border-0 bg-white px-5 pb-[calc(env(safe-area-inset-bottom,0px)+18px)] pt-2 text-slate-950">
            <div className="mx-auto flex w-full max-w-md flex-col gap-3 overflow-y-auto pb-2">
              <div className="flex items-start justify-between gap-4 pt-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-[0.22em]" style={{ color: MUTED }}>
                    {sessionTypeLabel(session.session_type)}
                  </p>
                  <h2 className="mt-1 text-[30px] font-bold leading-[1.02] tracking-tight" style={{ fontFamily: FONT_HEADING }}>
                    {session.name}
                  </h2>
                  <p className="mt-2 text-[14px] font-medium" style={{ color: MUTED }}>
                    {dateLabel} · {timeLabel}
                  </p>
                </div>
                <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl" style={{ background: "#f1f5f9" }}>
                  <Ticket className="h-7 w-7" />
                </div>
              </div>

              <div className="-mx-5 overflow-x-auto px-5 pb-1 pt-1" style={{ scrollbarWidth: "none" }}>
                <div className="flex w-max gap-2">
                {pricing.publicChips.map((chip) => (
                  <span
                    key={chip}
                    className="shrink-0 rounded-full px-3 py-2 text-[12px] font-semibold"
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
              </div>

              <div className="rounded-[20px] p-4" style={{ background: SOFT, border: `1px solid ${BORDER}` }}>
                <div className="flex items-center justify-between gap-4">
                  <span className="inline-flex items-center gap-2 text-[16px] font-semibold">
                    <Users className="h-5 w-5" />
                    {spotsLeft == null ? "Öppet" : spotsLeft === 0 ? "Fullt" : `${spotsLeft} kvar`}
                  </span>
                  <span className="text-[14px] font-semibold" style={{ color: isFull ? "#be123c" : GREEN }}>
                    {isRegistered ? "Anmäld" : "Live"}
                  </span>
                </div>
                {capacity ? (
                  <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-200">
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

              <div className="grid gap-2.5">
                {pricing.detailRows.map((row) => {
                  const isMembershipUpsell = !userHasMembership && (row.label.includes("Access") || row.label.includes("Unlimited"));
                  const isDayUpsell = !dayAccess && row.label.includes("Dagsmedlemskap");
                  const clickable = isMembershipUpsell || isDayUpsell;
                  return (
                    <button
                      key={row.label}
                      type="button"
                      onClick={() => clickable && openUpsell(row.label)}
                      className="grid grid-cols-[1fr_auto] items-center gap-4 rounded-[20px] p-4 text-left"
                      style={{
                        background: SOFT,
                        border: `1.5px solid ${clickable ? "rgba(15,23,42,0.20)" : BORDER}`,
                      }}
                    >
                      <span>
                        <span className="block text-[18px] font-semibold" style={{ fontFamily: FONT_HEADING }}>
                          {row.label}
                        </span>
                        {isMembershipUpsell && (
                          <span className="mt-1 block text-[13px] font-medium" style={{ color: MUTED }}>
                            {row.label.includes("Access") ? `Köp Access och boka för ${row.value}` : "Köp Unlimited och boka när det ingår"}
                          </span>
                        )}
                        {isDayUpsell && (
                          <span className="mt-1 block text-[13px] font-medium" style={{ color: MUTED }}>
                            Uppgradera till heldag
                          </span>
                        )}
                      </span>
                      <span className="text-[23px] font-bold" style={{ fontFamily: FONT_HEADING }}>
                        {row.value}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="grid gap-3 pt-1">
                <button
                  type="button"
                  onClick={startSignup}
                  disabled={loading || isRegistered || isFull}
                  className="flex h-16 items-center justify-center gap-3 rounded-[24px] px-5 text-[19px] font-bold disabled:opacity-60"
                  style={{
                    background: isRegistered ? "#dcfce7" : isFull ? "#e2e8f0" : NAVY,
                    color: isRegistered ? "#15803d" : isFull ? "#334155" : "white",
                    fontFamily: FONT_HEADING,
                  }}
                >
                  {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : isRegistered ? <Check className="h-5 w-5" /> : null}
                  {isRegistered
                    ? "Anmäld"
                    : isFull
                      ? "Fullt"
                      : `${user?.id ? "Anmäl" : "Logga in & anmäl"} · ${pricing.checkoutLabel}`}
                </button>
                <button
                  type="button"
                  onClick={openChat}
                  disabled={!room?.id}
                  className="flex h-14 items-center justify-center gap-2 rounded-[22px] bg-slate-100 px-5 text-[16px] font-semibold text-slate-950 disabled:opacity-70"
                  style={{ fontFamily: FONT_HEADING }}
                >
                  {previewLoading && !room?.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <MessageCircle className="h-5 w-5" />}
                  {previewLoading && !room?.id ? "Laddar chat" : "Öppna chat"}
                </button>
              </div>
            </div>
          </DrawerContent>
        </Drawer>
      )}
    </div>
  );
}
