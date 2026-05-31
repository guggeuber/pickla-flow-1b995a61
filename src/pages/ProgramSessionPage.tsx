import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Loader2,
  MessageCircle,
  Ticket,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { activityPriceLabels, formatSek } from "@/lib/activityPricing";
import picklaLogo from "@/assets/pickla-logo.svg";

const BG = "#fbf7f2";
const CARD = "#ffffff";
const TEXT = "#0f172a";
const MUTED = "#64748b";
const NAVY = "#1a1f3a";
const GREEN = "#16a34a";
const RED = "#e84c61";
const BORDER = "rgba(15,23,42,0.10)";
const FONT_HEADING = "'Space Grotesk', sans-serif";

const DAY_NAMES = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];

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

function safePath(path: string) {
  return path.startsWith("/") && !path.startsWith("//") ? path : "/hub";
}

function programChatResourceId(sessionId: string, occurrenceDate: string | null | undefined) {
  return `activity_session:${sessionId}:${occurrenceDate || "next"}`;
}

export default function ProgramSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [openingChat, setOpeningChat] = useState(false);

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
  const basePrice = Number(session?.price_sek ?? product?.base_price_sek ?? 0);
  const productKey = session?.product_key || product?.product_key || "day_access";

  const { data: membership } = useQuery({
    queryKey: ["program-membership", user?.id, session?.venue_id],
    enabled: !!user?.id && !!session?.venue_id,
    staleTime: 30000,
    queryFn: () => apiGet("api-memberships", "user", { userId: user!.id, venueId: session!.venue_id }),
  });

  const { data: dayAccess } = useQuery({
    queryKey: ["program-day-access", user?.id, session?.venue_id, occurrenceDate],
    enabled: !!user?.id && !!session?.venue_id && !!occurrenceDate,
    staleTime: 30000,
    queryFn: async () => {
      const { data } = await supabase
        .from("access_entitlements")
        .select("id")
        .eq("user_id", user!.id)
        .eq("venue_id", session!.venue_id)
        .eq("entitlement_type", "day_access")
        .eq("status", "active")
        .eq("valid_date", occurrenceDate)
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const { data: registrations = [] } = useQuery({
    queryKey: ["program-registrations", session?.id, occurrenceDate],
    enabled: !!session?.id && !!occurrenceDate,
    staleTime: 10000,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("session_registrations")
        .select("id, user_id, status")
        .eq("activity_session_id", session!.id)
        .eq("session_date", occurrenceDate);
      if (error) return [];
      return rows || [];
    },
  });

  const pricing = activityPriceLabels({
    basePrice,
    productKey,
    membership,
    hasDayAccess: !!dayAccess,
  });
  const memberPrice = pricing.finalPrice;
  const hasDiscount = pricing.hasDiscount;

  const activeRegistrations = registrations.filter((r: any) => r.status !== "cancelled");
  const isRegistered = !!user?.id && activeRegistrations.some((r: any) => r.user_id === user.id);
  const capacity = Number(session?.capacity || 0);
  const spotsLeft = capacity ? Math.max(capacity - activeRegistrations.length, 0) : null;
  const progressPct = capacity ? Math.min(100, Math.round((activeRegistrations.length / capacity) * 100)) : 22;
  const selectedAccess = pricing.includedLabel?.includes("Unlimited")
    ? "unlimited"
    : pricing.includedLabel?.includes("idag")
      ? "day"
      : hasDiscount
        ? "access"
        : "activity";
  const accessRows = [
    {
      key: "activity",
      title: "Aktivitetsbiljett",
      subtitle: "Ett schemalagt pass",
      value: formatSek(basePrice),
    },
    {
      key: "access",
      title: "Pickla Access",
      subtitle: "199 kr/mån · 40% rabatt",
      value: formatSek(pricing.accessPrice),
      sale: formatSek(basePrice),
    },
    {
      key: "unlimited",
      title: "Pickla Unlimited",
      subtitle: "699 kr/mån · allt Open Play",
      value: "Ingår",
    },
    {
      key: "day",
      title: "Dagsmedlemskap",
      subtitle: "199 kr · full access idag",
      value: "Ingår idag",
    },
  ];

  const now = DateTime.now().setZone("Europe/Stockholm");
  const startTime = session?.start_time ? String(session.start_time).slice(0, 5) : "";
  const endTime = session?.end_time ? String(session.end_time).slice(0, 5) : "";
  const dayLabel = occurrence.hasSame(now, "day")
    ? "Idag"
    : occurrence.hasSame(now.plus({ days: 1 }), "day")
      ? "Imorgon"
      : `${DAY_NAMES[occurrence.weekday % 7]} ${occurrence.toFormat("d MMM", { locale: "sv" })}`;

  const redirectToAuth = () => {
    const redirect = `${window.location.pathname}${window.location.search}`;
    sessionStorage.setItem("pickla_auth_redirect", redirect);
    navigate(`/auth?redirect=${encodeURIComponent(redirect)}`);
  };

  const openChat = async () => {
    if (!session || !venue || openingChat) return;
    if (authLoading) return;
    if (!user?.id) {
      redirectToAuth();
      return;
    }
    setOpeningChat(true);
    try {
      const { path } = await ensureProgramChatRoom();
      navigate(path);
    } catch (err: any) {
      toast.error(err.message || "Kunde inte öppna chatten");
    } finally {
      setOpeningChat(false);
    }
  };

  const ensureProgramChatRoom = async () => {
    if (!session || !venue) throw new Error("Aktiviteten saknas");
    const { data: rooms, error } = await supabase.rpc("upsert_resource_chat_room", {
      p_venue_id: session.venue_id,
      p_resource_id: programChatResourceId(session.id, occurrenceDate),
      p_room_type: "event",
      p_title: session.name,
      p_subtitle: `${dayLabel} · ${startTime}-${endTime}`,
      p_emoji: "📅",
      p_is_public: true,
    });
    if (error) throw error;
    const roomId = rooms?.[0]?.id;
    return {
      roomId: roomId || "",
      path: roomId ? `/chat/${roomId}?v=${venue.slug || venueSlug}` : `/hub?v=${venue.slug || venueSlug}`,
    };
  };

  const announceJoin = async (roomId: string) => {
    if (!roomId || !user?.id) return;
    const { data: profile } = await supabase
      .from("player_profiles")
      .select("display_name")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    const name = profile?.display_name || user.email?.split("@")[0] || "En spelare";
    await supabase.from("chat_messages").insert({
      room_id: roomId,
      user_id: user.id,
      message_type: "bot",
      content: `${name} kommer`,
      metadata: {
        channel: "activity_registration",
        activity_session_id: session?.id,
        session_date: occurrenceDate,
      },
    });
  };

  const handleCheckout = async () => {
    if (!session || !venue || submitting) return;
    if (authLoading) return;
    if (!user?.id) {
      redirectToAuth();
      return;
    }
    setSubmitting(true);
    try {
      const { roomId, path: chatPath } = await ensureProgramChatRoom();
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
          chat_room_id: roomId,
          user_id: user?.id || "",
          slug: venue.slug || venueSlug,
          redirect_path: chatPath,
          success_path: `/booking/confirmed?type=session_ticket&next=${encodeURIComponent(chatPath)}`,
        },
      });

      if (result.free) {
        toast.success("Klart! Din access är aktiverad.");
        await qc.invalidateQueries({ queryKey: ["program-registrations", session.id, occurrenceDate] });
        await announceJoin(roomId);
        navigate(safePath(result.redirect || chatPath));
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
      <div className="min-h-[100dvh] grid place-items-center" style={{ background: BG }}>
        <Loader2 className="w-6 h-6 animate-spin text-white" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-[100dvh] grid place-items-center px-6 text-center" style={{ background: BG, color: "#fff" }}>
        <div>
          <p className="text-xl font-bold" style={{ fontFamily: FONT_HEADING }}>Passet hittades inte</p>
          <button onClick={() => navigate(`/hub?v=${venueSlug}`)} className="mt-4 rounded-2xl px-5 py-3 font-bold" style={{ background: "#fff", color: NAVY }}>
            Till hubben
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-[100dvh]"
      style={{
        background: BG,
        color: TEXT,
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <header className="fixed left-0 right-0 top-0 z-30 mx-auto flex w-full max-w-md items-center justify-between px-4 pb-3 pt-[calc(env(safe-area-inset-top,0px)+14px)]">
        <button type="button" onClick={() => navigate(-1)} className="grid h-12 w-12 place-items-center rounded-full bg-white shadow-[0_10px_30px_rgba(15,23,42,0.12)] active:scale-95" aria-label="Tillbaka">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <img src={picklaLogo} alt="Pickla" className="h-6 w-auto" />
        <button type="button" onClick={openChat} className="grid h-12 w-12 place-items-center rounded-full bg-white shadow-[0_10px_30px_rgba(15,23,42,0.12)] active:scale-95" aria-label="Chatta">
          {openingChat ? <Loader2 className="h-5 w-5 animate-spin" /> : <MessageCircle className="h-5 w-5" />}
        </button>
      </header>

      <main className="mx-auto min-h-[100dvh] w-full max-w-md">
        <section className="relative min-h-[48dvh] overflow-hidden px-5 pb-24 pt-[calc(env(safe-area-inset-top,0px)+92px)]">
          <div className="absolute inset-0 opacity-80" style={{
            background: "radial-gradient(circle at 18% 20%, rgba(22,163,74,0.12), transparent 25%), radial-gradient(circle at 86% 18%, rgba(26,31,58,0.10), transparent 28%), linear-gradient(180deg, #fffaf5 0%, #f3eee8 100%)",
          }} />
          <div className="relative">
            <p className="text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: MUTED, fontFamily: FONT_HEADING }}>
              {session.activity_series?.name || "Pickla program"}
            </p>
            <h1 className="mt-2 text-[48px] font-black leading-[0.92] tracking-tight text-slate-950" style={{ fontFamily: FONT_HEADING }}>
              {session.name}
            </h1>
            <p className="mt-5 flex items-center gap-2 text-[15px] font-black text-slate-800">
              <CalendarDays className="h-4 w-4" /> {dayLabel} · {startTime}-{endTime}
            </p>
          </div>

          <div className="relative mt-8 grid gap-3">
            <div className="ml-auto max-w-[82%] rounded-[24px] bg-white px-4 py-3 shadow-[0_14px_38px_rgba(15,23,42,0.08)]">
              <p className="text-[12px] font-black text-slate-950" style={{ fontFamily: FONT_HEADING }}>Live chat</p>
              <p className="mt-1 text-[13px] leading-snug text-slate-500">Någon söker dubbelpartner till passet.</p>
            </div>
            <div className="max-w-[78%] rounded-[24px] bg-slate-950 px-4 py-3 text-white shadow-[0_14px_38px_rgba(15,23,42,0.14)]">
              <p className="text-[13px] font-bold">{spotsLeft == null ? "Öppet för anmälan" : spotsLeft === 0 ? "Fullt just nu" : `${spotsLeft} platser kvar`}</p>
            </div>
            <button
              type="button"
              onClick={openChat}
              className="ml-auto flex max-w-[86%] items-center gap-3 rounded-[24px] bg-white px-4 py-3 text-left shadow-[0_14px_38px_rgba(15,23,42,0.08)] active:scale-[0.99]"
            >
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-slate-100">
                <MessageCircle className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-black text-slate-950" style={{ fontFamily: FONT_HEADING }}>Öppna chat</p>
                <p className="truncate text-sm text-slate-500">Frågor, sena platser och staff updates</p>
              </div>
              <ChevronRight className="h-5 w-5 text-slate-400" />
            </button>
          </div>
        </section>

        <section className="-mt-12 rounded-t-[34px] px-4 pb-[calc(env(safe-area-inset-bottom,0px)+20px)] pt-4" style={{ background: CARD, boxShadow: "0 -18px 48px rgba(15,23,42,0.12)" }}>
          <div className="mx-auto mb-4 h-1.5 w-14 rounded-full bg-slate-200" />

          <div className="flex items-end justify-between gap-4 px-1 pb-3">
            <div>
              <h2 className="text-[30px] font-black leading-none text-slate-950" style={{ fontFamily: FONT_HEADING }}>
                {isRegistered ? "Du är inne" : "Välj access"}
              </h2>
              <p className="mt-2 text-sm font-bold text-slate-500">
                Aktivitet, dagsmedlemskap eller medlemspris.
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">Platser</p>
              <p className="text-lg font-black text-slate-950">{capacity ? `${activeRegistrations.length}/${capacity}` : activeRegistrations.length}</p>
            </div>
          </div>

          <div className="mb-4 rounded-[22px] border p-3" style={{ borderColor: BORDER, background: "#f8fafc" }}>
            <div className="flex items-center justify-between gap-3 text-sm font-black text-slate-950">
              <span className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                {spotsLeft == null ? "Öppet" : spotsLeft === 0 ? "Fullt" : `${spotsLeft} kvar`}
              </span>
              <span style={{ color: spotsLeft === 0 ? RED : GREEN }}>{isRegistered ? "Anmäld" : "Live"}</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full" style={{ width: `${progressPct}%`, background: spotsLeft === 0 ? RED : GREEN }} />
            </div>
          </div>

          <div className="grid gap-2">
            {accessRows.map((row) => {
              const active = selectedAccess === row.key;
              return (
                <div
                  key={row.key}
                  className="grid grid-cols-[44px_1fr_auto] items-center gap-3 rounded-[22px] border px-3 py-3"
                  style={{
                    borderColor: active ? "#0f172a" : BORDER,
                    borderWidth: active ? 2 : 1,
                    background: active ? "#fff" : "#f8fafc",
                  }}
                >
                  <div className="grid h-11 w-11 place-items-center rounded-2xl" style={{ background: active ? "#111827" : "#eef2f7", color: active ? "#fff" : NAVY }}>
                    {active ? <CheckCircle2 className="h-5 w-5" /> : <Ticket className="h-5 w-5" />}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[17px] font-black text-slate-950" style={{ fontFamily: FONT_HEADING }}>{row.title}</p>
                    <p className="truncate text-[13px] font-bold text-slate-500">{row.subtitle}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[20px] font-black text-slate-950" style={{ fontFamily: FONT_HEADING }}>{row.value}</p>
                    {row.sale && <p className="text-[13px] font-bold text-slate-400 line-through">{row.sale}</p>}
                  </div>
                </div>
              );
            })}
          </div>

          {pricing.includedLabel && (
            <div className="mt-3 rounded-[20px] bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">
              {pricing.includedLabel} för dig.
            </div>
          )}

          <div className="mt-5 rounded-[22px] border px-4 py-3" style={{ borderColor: BORDER }}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-black text-slate-950" style={{ fontFamily: FONT_HEADING }}>{product?.name || "Aktivitetsbiljett"}</p>
                <p className="text-sm font-bold text-slate-500">Dagsmedlemskap 199 kr ger hela dagen</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">Pris</p>
                <p className="text-2xl font-black text-slate-950" style={{ fontFamily: FONT_HEADING }}>
                  {pricing.includedLabel || formatSek(memberPrice)}
                </p>
              </div>
            </div>
          </div>

          {isRegistered ? (
            <button
              type="button"
              onClick={openChat}
              disabled={openingChat}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-[18px] py-4 text-[17px] font-black active:scale-[0.98] disabled:opacity-60"
              style={{ background: GREEN, color: "#fff", fontFamily: FONT_HEADING }}
            >
              {openingChat ? <><Loader2 className="h-4 w-4 animate-spin" /> Öppnar chat</> : <>Gå till chatten <ChevronRight className="h-4 w-4" /></>}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCheckout}
              disabled={submitting || spotsLeft === 0}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-[18px] py-4 text-[17px] font-black active:scale-[0.98] disabled:opacity-60"
              style={{ background: spotsLeft === 0 ? "#94a3b8" : "#000", color: "#fff", fontFamily: FONT_HEADING }}
            >
              {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Öppnar anmälan</> : spotsLeft === 0 ? "Fullt" : <>Anmäl mig · {pricing.checkoutLabel}</>}
            </button>
          )}
        </section>
      </main>
    </div>
  );
}
