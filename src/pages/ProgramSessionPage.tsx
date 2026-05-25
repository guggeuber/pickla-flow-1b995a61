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
  Radio,
  ShieldCheck,
  Sparkles,
  Ticket,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import picklaLogo from "@/assets/pickla-logo.svg";

const BG = "#070b1a";
const CARD = "rgba(255,255,255,0.94)";
const TEXT = "#0f172a";
const MUTED = "#64748b";
const NAVY = "#1a1f3a";
const GREEN = "#16a34a";
const RED = "#e84c61";
const PINK = "#e8b4b8";
const BORDER = "rgba(255,255,255,0.18)";
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

function safePath(path: string) {
  return path.startsWith("/") && !path.startsWith("//") ? path : "/hub";
}

export default function ProgramSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
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
  const basePrice = Number(product?.base_price_sek ?? session?.price_sek ?? 0);
  const productKey = session?.product_key || product?.product_key || "day_access";

  const { data: membership } = useQuery({
    queryKey: ["program-membership", user?.id, session?.venue_id],
    enabled: !!user?.id && !!session?.venue_id,
    staleTime: 30000,
    queryFn: () => apiGet("api-memberships", "user", { userId: user!.id, venueId: session!.venue_id }),
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

  const tierPricing = (membership?.tier_pricing || []).find((p: any) => p.product_type === productKey);
  const memberPrice = (() => {
    if (!tierPricing) return basePrice;
    if (tierPricing.fixed_price != null) return Math.round(Number(tierPricing.fixed_price));
    if (tierPricing.discount_percent) return Math.round(basePrice * (1 - Number(tierPricing.discount_percent) / 100) * 100) / 100;
    return basePrice;
  })();
  const hasDiscount = memberPrice < basePrice;

  const activeRegistrations = registrations.filter((r: any) => r.status !== "cancelled");
  const isRegistered = !!user?.id && activeRegistrations.some((r: any) => r.user_id === user.id);
  const capacity = Number(session?.capacity || 0);
  const spotsLeft = capacity ? Math.max(capacity - activeRegistrations.length, 0) : null;
  const progressPct = capacity ? Math.min(100, Math.round((activeRegistrations.length / capacity) * 100)) : 22;

  const now = DateTime.now().setZone("Europe/Stockholm");
  const startTime = session?.start_time ? String(session.start_time).slice(0, 5) : "";
  const endTime = session?.end_time ? String(session.end_time).slice(0, 5) : "";
  const dayLabel = occurrence.hasSame(now, "day")
    ? "Idag"
    : occurrence.hasSame(now.plus({ days: 1 }), "day")
      ? "Imorgon"
      : `${DAY_NAMES[occurrence.weekday % 7]} ${occurrence.toFormat("d MMM", { locale: "sv" })}`;

  const openChat = async () => {
    if (!session || !venue || openingChat) return;
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
      p_resource_id: session.id,
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
        background: `linear-gradient(180deg, rgba(7,11,26,0.62) 0%, rgba(7,11,26,0.92) 42%, ${BG} 100%), radial-gradient(circle at 20% 8%, rgba(232,180,184,0.38), transparent 34%), radial-gradient(circle at 86% 22%, rgba(22,163,74,0.18), transparent 30%), ${BG}`,
        color: "#fff",
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <header className="sticky top-0 z-20 mx-auto flex w-full max-w-md items-center justify-between px-4 pb-3 pt-5 backdrop-blur-xl">
        <button type="button" onClick={() => navigate(-1)} className="grid h-11 w-11 place-items-center rounded-full bg-white/10 active:scale-95" aria-label="Tillbaka">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <img src={picklaLogo} alt="Pickla" className="h-6 w-auto brightness-0 invert" />
        <button type="button" onClick={openChat} className="grid h-11 w-11 place-items-center rounded-full bg-white/10 active:scale-95" aria-label="Chatta">
          {openingChat ? <Loader2 className="h-5 w-5 animate-spin" /> : <MessageCircle className="h-5 w-5" />}
        </button>
      </header>

      <main className="mx-auto flex min-h-[calc(100dvh-72px)] w-full max-w-md flex-col px-4 pb-5">
        <section className="pt-8">
          <div className="mb-4 flex items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-black" style={{ background: "rgba(232,76,97,0.95)" }}>
              <Radio className="h-3.5 w-3.5" /> AKTIVITET
            </span>
            <span className="rounded-full bg-white/12 px-3 py-1.5 text-xs font-bold text-white/80">
              {activeRegistrations.length} anmälda
            </span>
          </div>

          <p className="text-xs font-black uppercase tracking-[0.18em] text-white/62" style={{ fontFamily: FONT_HEADING }}>
            {session.activity_series?.name || "Pickla program"}
          </p>
          <h1 className="mt-2 text-[42px] font-black leading-[0.95] tracking-tight" style={{ fontFamily: FONT_HEADING }}>
            {session.name}
          </h1>
          <p className="mt-4 flex items-center gap-2 text-sm font-bold text-white/78">
            <CalendarDays className="h-4 w-4" /> {dayLabel} · {startTime}-{endTime}
          </p>
        </section>

        <section className="mt-8 rounded-[28px] p-4 text-left" style={{ background: CARD, color: TEXT, boxShadow: "0 24px 70px rgba(0,0,0,0.26)" }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: MUTED, fontFamily: FONT_HEADING }}>
                Anmälan
              </p>
              <h2 className="mt-1 text-2xl font-black leading-tight" style={{ fontFamily: FONT_HEADING }}>
                {isRegistered ? "Du är inne" : "Ta din plats"}
              </h2>
            </div>
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl" style={{ background: isRegistered ? "#dcfce7" : "#f1f5f9", color: isRegistered ? GREEN : NAVY }}>
              {isRegistered ? <CheckCircle2 className="h-6 w-6" /> : <Ticket className="h-6 w-6" />}
            </div>
          </div>

          <div className="mt-4 rounded-2xl p-3" style={{ background: "#f8fafc", border: "1px solid rgba(15,23,42,0.07)" }}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-black">
                <Users className="h-4 w-4" style={{ color: NAVY }} />
                {capacity ? `${activeRegistrations.length}/${capacity} platser` : `${activeRegistrations.length} anmälda`}
              </div>
              <span className="text-xs font-black" style={{ color: spotsLeft === 0 ? RED : GREEN }}>
                {spotsLeft == null ? "öppet" : spotsLeft === 0 ? "fullt" : `${spotsLeft} kvar`}
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full" style={{ width: `${progressPct}%`, background: spotsLeft === 0 ? RED : GREEN }} />
            </div>
          </div>

          <div className="mt-4 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.12em]" style={{ color: MUTED }}>Access</p>
              <p className="mt-1 text-sm font-bold">{product?.name || "Aktivitetsbiljett"}</p>
              <p className="mt-0.5 text-xs" style={{ color: MUTED }}>{venue?.name || "Pickla"}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-black uppercase tracking-[0.12em]" style={{ color: MUTED }}>Pris</p>
              <p className="mt-1 text-2xl font-black" style={{ fontFamily: FONT_HEADING, color: hasDiscount ? GREEN : TEXT }}>
                {hasDiscount && <span className="mr-2 text-sm line-through" style={{ color: MUTED }}>{formatSek(basePrice)}</span>}
                {formatSek(memberPrice)}
              </p>
            </div>
          </div>

          {isRegistered ? (
            <button
              type="button"
              onClick={openChat}
              disabled={openingChat}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-sm font-black active:scale-[0.98] disabled:opacity-60"
              style={{ background: GREEN, color: "#fff", fontFamily: FONT_HEADING }}
            >
              {openingChat ? <><Loader2 className="h-4 w-4 animate-spin" /> Öppnar chat</> : <>Gå till chatten <ChevronRight className="h-4 w-4" /></>}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCheckout}
              disabled={submitting || spotsLeft === 0}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-sm font-black active:scale-[0.98] disabled:opacity-60"
              style={{ background: spotsLeft === 0 ? "#94a3b8" : NAVY, color: "#fff", fontFamily: FONT_HEADING }}
            >
              {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Öppnar anmälan</> : spotsLeft === 0 ? "Fullt" : <>Anmäl mig · {formatSek(memberPrice)}</>}
            </button>
          )}
        </section>

        <section className="mt-4 grid gap-3">
          <button
            type="button"
            onClick={openChat}
            className="flex w-full items-center gap-3 rounded-[24px] border p-4 text-left active:scale-[0.99]"
            style={{ borderColor: BORDER, background: "rgba(255,255,255,0.1)" }}
          >
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl" style={{ background: "rgba(255,255,255,0.12)" }}>
              <MessageCircle className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-black" style={{ fontFamily: FONT_HEADING }}>Live chat</p>
              <p className="truncate text-sm text-white/62">Frågor, spontana lag, sena platser och staff updates.</p>
            </div>
            <ChevronRight className="h-5 w-5 text-white/58" />
          </button>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[22px] border p-4" style={{ borderColor: BORDER, background: "rgba(255,255,255,0.08)" }}>
              <ShieldCheck className="mb-3 h-5 w-5" style={{ color: GREEN }} />
              <p className="text-sm font-black" style={{ fontFamily: FONT_HEADING }}>Din plats</p>
              <p className="mt-1 text-xs leading-snug text-white/58">Anmälan kopplas till ditt konto och används vid incheckning.</p>
            </div>
            <div className="rounded-[22px] border p-4" style={{ borderColor: BORDER, background: "rgba(255,255,255,0.08)" }}>
              <Sparkles className="mb-3 h-5 w-5" style={{ color: PINK }} />
              <p className="text-sm font-black" style={{ fontFamily: FONT_HEADING }}>Community</p>
              <p className="mt-1 text-xs leading-snug text-white/58">Chatten är öppen för frågor, sena platser och uppdateringar.</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
