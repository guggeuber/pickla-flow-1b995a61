import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Send, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { DateTime } from "luxon";
import { ChannelCard } from "@/components/hub/ChannelCard";
import { ActionCard } from "@/components/hub/ActionCard";
import { BotMessage } from "@/components/hub/BotMessage";

// ── Design tokens ────────────────────────────────────────────────────────────
const HUB_BG = "#faf8f5";
const HUB_CARD = "#ffffff";
const HUB_BORDER = "rgba(0,0,0,0.07)";
const HUB_NAVY = "#1a1f3a";
const HUB_RED = "#CC2936";
const HUB_GREEN = "#22c55e";
const HUB_TEXT = "#111827";
const HUB_SUB = "#6b7280";
const HUB_MUTED = "#9ca3af";
const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

// ── Types ────────────────────────────────────────────────────────────────────
interface ChatRoom {
  id: string;
  venue_id: string;
  room_type: "daily" | "booking" | "event" | "ritual";
  title: string;
  subtitle?: string;
  emoji: string;
  resource_id?: string;
  is_public: boolean;
  session_date?: string;
  updated_at: string;
}

interface ChatMessage {
  id: string;
  room_id: string;
  user_id: string | null;
  message_type: "text" | "bot" | "action_card" | "booking_card";
  content: string;
  metadata: Record<string, any>;
  created_at: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function relativeTime(iso: string): string {
  const dt = DateTime.fromISO(iso, { zone: "utc" }).setZone("Europe/Stockholm");
  const now = DateTime.now().setZone("Europe/Stockholm");
  const diff = now.diff(dt, ["minutes", "hours", "days"]);
  if (diff.minutes < 1) return "nu";
  if (diff.minutes < 60) return `${Math.floor(diff.minutes)}m`;
  if (diff.hours < 24) return dt.toFormat("HH:mm");
  return dt.toFormat("d/M");
}

function formatSwedishTime(timeStr: string): string {
  return timeStr.slice(0, 5); // "18:00:00" → "18:00"
}

// ── Hooks ────────────────────────────────────────────────────────────────────
function useVenue(slug: string) {
  return useQuery({
    queryKey: ["venue-slug", slug],
    staleTime: 300000,
    queryFn: async () => {
      const { data } = await supabase
        .from("venues")
        .select("id, name, slug")
        .eq("slug", slug)
        .single();
      return data;
    },
  });
}

function usePlayerCount(venueId: string | undefined) {
  return useQuery({
    queryKey: ["hub-players", venueId],
    enabled: !!venueId,
    refetchInterval: 60000,
    queryFn: async () => {
      const now = DateTime.now().setZone("Europe/Stockholm").toUTC().toISO()!;
      const { count } = await supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("venue_id", venueId!)
        .neq("status", "cancelled")
        .lte("start_time", now)
        .gte("end_time", now);
      return count ?? 0;
    },
  });
}

function useDailyRoom(venueId: string | undefined) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["hub-daily-room", venueId],
    enabled: !!venueId,
    staleTime: 300000,
    queryFn: async () => {
      const today = DateTime.now().setZone("Europe/Stockholm").toISODate()!;
      const { data, error } = await supabase.rpc("upsert_daily_chat_room", {
        p_venue_id: venueId!,
        p_session_date: today,
        p_name: "Pickla Idag",
      });
      if (error || !data?.length) {
        // Fallback: plain fetch if RPC fails
        const { data: existing } = await supabase
          .from("chat_rooms")
          .select("*")
          .eq("venue_id", venueId!)
          .eq("room_type", "daily")
          .eq("session_date", today)
          .maybeSingle();
        return existing as ChatRoom | null;
      }
      return data[0] as ChatRoom;
    },
  });
}

function useDailyBotData(venueId: string | undefined) {
  return useQuery({
    queryKey: ["hub-daily-data", venueId],
    enabled: !!venueId,
    refetchInterval: 120000,
    staleTime: 60000,
    queryFn: async () => {
      const now = DateTime.now().setZone("Europe/Stockholm");
      const nowISO = now.toUTC().toISO()!;
      const todayDow = now.weekday === 7 ? 0 : now.weekday; // 0=Sun,1=Mon,...6=Sat

      // Free courts right now (pickleball only)
      const [{ data: allCourts }, { data: activeBookings }] = await Promise.all([
        supabase
          .from("venue_courts")
          .select("id, name")
          .eq("venue_id", venueId!)
          .eq("is_available", true)
          .eq("sport_type", "pickleball"),
        supabase
          .from("bookings")
          .select("venue_court_id")
          .eq("venue_id", venueId!)
          .neq("status", "cancelled")
          .lte("start_time", nowISO)
          .gte("end_time", nowISO),
      ]);

      const bookedIds = new Set((activeBookings || []).map((b: any) => b.venue_court_id));
      const freeCount = (allCourts || []).filter((c: any) => !bookedIds.has(c.id)).length;
      const totalCount = (allCourts || []).length;

      // Next open play session
      const { data: sessions } = await supabase
        .from("open_play_sessions")
        .select("*")
        .eq("venue_id", venueId!);

      const nowTime = now.toFormat("HH:mm:ss");
      let nextSession: any = null;

      for (let offset = 0; offset <= 6; offset++) {
        const checkDow = (todayDow + offset) % 7;
        const candidates = (sessions || []).filter((s: any) => {
          const days: number[] = s.day_of_week || [];
          if (!days.includes(checkDow)) return false;
          if (offset === 0 && s.start_time <= nowTime) return false;
          return true;
        });
        if (candidates.length > 0) {
          nextSession = { ...candidates[0], daysOffset: offset };
          break;
        }
      }

      return { freeCount, totalCount, nextSession };
    },
  });
}

function useBookingRooms(venueId: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: ["hub-bookings", venueId, userId],
    enabled: !!venueId && !!userId,
    staleTime: 60000,
    queryFn: async () => {
      const now = DateTime.now().setZone("Europe/Stockholm").toUTC().toISO()!;
      const { data } = await supabase
        .from("bookings")
        .select("id, booking_ref, start_time, end_time, venue_courts(name), access_code")
        .eq("user_id", userId!)
        .neq("status", "cancelled")
        .gte("end_time", now)
        .order("start_time", { ascending: true })
        .limit(5);
      return (data || []) as any[];
    },
  });
}

function useEventRooms(venueId: string | undefined) {
  return useQuery({
    queryKey: ["hub-events", venueId],
    enabled: !!venueId,
    staleTime: 300000,
    queryFn: async () => {
      const { data } = await supabase
        .from("events")
        .select("id, name, display_name, event_type, status, start_date, logo_url, primary_color")
        .eq("venue_id", venueId!)
        .eq("is_public", true)
        .in("status", ["upcoming", "active", "live"])
        .order("start_date", { ascending: true })
        .limit(6);
      return (data || []) as any[];
    },
  });
}

function useRoomMessages(roomId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!roomId) { setMessages([]); return; }
    setLoading(true);

    supabase
      .from("chat_messages")
      .select("*")
      .eq("room_id", roomId)
      .order("created_at", { ascending: true })
      .limit(100)
      .then(({ data }) => {
        setMessages((data || []) as ChatMessage[]);
        setLoading(false);
      });

    const channel = supabase
      .channel(`hub:${roomId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `room_id=eq.${roomId}` },
        (payload) => setMessages((prev) => [...prev, payload.new as ChatMessage])
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [roomId]);

  return { messages, loading };
}

// ── ChatRoom ─────────────────────────────────────────────────────────────────
interface ChatRoomProps {
  room: ChatRoom;
  venueId: string;
  onBack: () => void;
}

function ChatRoom({ room, venueId, onBack }: ChatRoomProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { messages, loading: msgsLoading } = useRoomMessages(room.id);
  const { data: botData } = useDailyBotData(room.room_type === "daily" ? venueId : undefined);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  // Join room on mount
  useEffect(() => {
    if (!user?.id || !room.id) return;
    supabase.from("chat_participants").upsert(
      { room_id: room.id, user_id: user.id },
      { onConflict: "room_id,user_id", ignoreDuplicates: true }
    );
  }, [room.id, user?.id]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, botData]);

  const sendMessage = async () => {
    if (!input.trim() || !user?.id || sending) return;
    setSending(true);
    const content = input.trim();
    setInput("");
    await supabase.from("chat_messages").insert({
      room_id: room.id,
      user_id: user.id,
      message_type: "text",
      content,
    });
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // Build booking-room display
  const bookingMeta = room.room_type === "booking" && room.resource_id
    ? { ref: room.resource_id, code: room.subtitle?.match(/\d{4}/)?.[0] }
    : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        background: HUB_BG,
      }}
    >
      {/* Header */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: HUB_BG,
          borderBottom: `1px solid ${HUB_BORDER}`,
          padding: "env(safe-area-inset-top,12px) 16px 12px",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <button
          onClick={onBack}
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            border: `1px solid ${HUB_BORDER}`,
            background: HUB_CARD,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <ArrowLeft style={{ width: 16, height: 16, color: HUB_TEXT }} />
        </button>

        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: HUB_NAVY,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 17,
            flexShrink: 0,
          }}
        >
          {room.emoji}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontFamily: FONT_HEADING, fontSize: 15, fontWeight: 700, color: HUB_TEXT }}>
            {room.title}
          </p>
          {room.subtitle && (
            <p style={{ fontSize: 10, fontFamily: FONT_MONO, color: HUB_MUTED }}>
              {room.subtitle}
            </p>
          )}
        </div>
      </div>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px",
          paddingBottom: 8,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {/* Daily room: synthetic bot messages */}
        {room.room_type === "daily" && botData && (
          <>
            <BotMessage
              content={
                botData.freeCount > 0
                  ? `${botData.freeCount} av ${botData.totalCount} banor är lediga just nu 🎾`
                  : `Alla ${botData.totalCount} banor är bokade just nu 🔥`
              }
              time="nu"
            />

            {botData.nextSession && (
              <ActionCard
                title={`${botData.nextSession.name || "Open Play"} · ${formatSwedishTime(botData.nextSession.start_time)}`}
                description={
                  botData.nextSession.daysOffset === 0
                    ? "Idag"
                    : botData.nextSession.daysOffset === 1
                    ? "Imorgon"
                    : `Om ${botData.nextSession.daysOffset} dagar`
                }
                ctaLabel="Köp inträde"
                ctaPrice={botData.nextSession.price_sek}
                onAction={() => navigate("/openplay")}
              />
            )}

            {botData.freeCount > 0 && (
              <ActionCard
                title="Boka en ledig bana"
                description={`${botData.freeCount} ${botData.freeCount === 1 ? "bana" : "banor"} tillgänglig${botData.freeCount === 1 ? "" : "a"} nu`}
                ctaLabel="Boka nu"
                onAction={() => navigate("/book")}
              />
            )}
          </>
        )}

        {/* Booking room: booking card */}
        {room.room_type === "booking" && (
          <div
            style={{
              background: HUB_NAVY,
              borderRadius: 14,
              padding: "12px 14px",
              marginBottom: 4,
            }}
          >
            <p style={{ fontFamily: FONT_MONO, fontSize: 10, color: "rgba(255,255,255,0.5)", marginBottom: 2 }}>
              DIN BOKNING
            </p>
            <p style={{ fontFamily: FONT_HEADING, fontSize: 15, fontWeight: 700, color: "#fff" }}>
              {room.title}
            </p>
            {room.subtitle && (
              <p style={{ fontSize: 12, fontFamily: FONT_MONO, color: "rgba(255,255,255,0.6)", marginTop: 2 }}>
                {room.subtitle}
              </p>
            )}
          </div>
        )}

        {/* Event room: action card */}
        {room.room_type === "event" && room.resource_id && (
          <ActionCard
            title={room.title}
            description={room.subtitle}
            ctaLabel="Se event"
            onAction={() => navigate(`/event/${room.resource_id}`)}
          />
        )}

        {/* Loading state */}
        {msgsLoading && (
          <div style={{ display: "flex", justifyContent: "center", padding: 16 }}>
            <Loader2 style={{ width: 18, height: 18, color: HUB_MUTED, animation: "spin 1s linear infinite" }} />
          </div>
        )}

        {/* User messages */}
        {messages.map((msg) => {
          const isOwn = msg.user_id === (typeof window !== "undefined" ? null : null); // resolved below
          return <MessageBubble key={msg.id} message={msg} currentUserId={user?.id} />;
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      {user ? (
        <div
          style={{
            padding: "10px 16px",
            paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))",
            borderTop: `1px solid ${HUB_BORDER}`,
            background: HUB_CARD,
            display: "flex",
            gap: 8,
            alignItems: "flex-end",
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Skriv ett meddelande..."
            rows={1}
            style={{
              flex: 1,
              background: HUB_BG,
              border: `1px solid ${HUB_BORDER}`,
              borderRadius: 12,
              padding: "9px 12px",
              fontSize: 14,
              fontFamily: "Inter, sans-serif",
              color: HUB_TEXT,
              resize: "none",
              outline: "none",
              lineHeight: 1.4,
              maxHeight: 88,
              overflowY: "auto",
            }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || sending}
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: input.trim() ? HUB_RED : HUB_BORDER,
              border: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              cursor: input.trim() ? "pointer" : "default",
              transition: "background 0.15s",
            }}
          >
            <Send style={{ width: 15, height: 15, color: input.trim() ? "#fff" : HUB_MUTED }} />
          </button>
        </div>
      ) : (
        <div
          style={{
            padding: "12px 16px",
            paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
            borderTop: `1px solid ${HUB_BORDER}`,
            background: HUB_CARD,
            textAlign: "center",
          }}
        >
          <button
            onClick={() => navigate("/auth?redirect=/hub")}
            style={{
              fontFamily: FONT_MONO,
              fontSize: 13,
              color: HUB_RED,
              fontWeight: 700,
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            Logga in för att chatta →
          </button>
        </div>
      )}
    </div>
  );
}

// ── MessageBubble ─────────────────────────────────────────────────────────────
function MessageBubble({ message, currentUserId }: { message: ChatMessage; currentUserId?: string }) {
  const isOwn = message.user_id === currentUserId;
  const isBot = message.message_type === "bot";

  if (isBot) {
    return <BotMessage content={message.content} time={relativeTime(message.created_at)} />;
  }

  return (
    <div
      style={{
        display: "flex",
        justifyContent: isOwn ? "flex-end" : "flex-start",
        marginBottom: 2,
      }}
    >
      <div
        style={{
          maxWidth: "75%",
          padding: "8px 12px",
          borderRadius: isOwn ? "14px 4px 14px 14px" : "4px 14px 14px 14px",
          background: isOwn ? HUB_NAVY : HUB_CARD,
          border: isOwn ? "none" : `1px solid ${HUB_BORDER}`,
          boxShadow: isOwn ? "none" : "0 1px 2px rgba(0,0,0,0.04)",
        }}
      >
        <p style={{ fontSize: 14, color: isOwn ? "#fff" : HUB_TEXT, lineHeight: 1.4 }}>
          {message.content}
        </p>
        <p
          style={{
            fontSize: 9,
            fontFamily: FONT_MONO,
            color: isOwn ? "rgba(255,255,255,0.45)" : HUB_MUTED,
            marginTop: 3,
            textAlign: "right",
          }}
        >
          {relativeTime(message.created_at)}
        </p>
      </div>
    </div>
  );
}

// ── Hub List ─────────────────────────────────────────────────────────────────
function HubList({
  venueId,
  playerCount,
  dailyRoom,
  bookings,
  events,
  onSelectRoom,
}: {
  venueId: string;
  playerCount: number;
  dailyRoom: ChatRoom | null | undefined;
  bookings: any[];
  events: any[];
  onSelectRoom: (room: ChatRoom) => void;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();

  const openBookingRoom = useCallback(async (booking: any) => {
    const courtName = booking.venue_courts?.name || "Bana";
    const time = DateTime.fromISO(booking.start_time, { zone: "utc" })
      .setZone("Europe/Stockholm")
      .toFormat("HH:mm");
    const date = DateTime.fromISO(booking.start_time, { zone: "utc" })
      .setZone("Europe/Stockholm")
      .toFormat("d MMM");
    const subtitle = `${date} · ${time} · Kod: ${booking.access_code || "—"}`;

    const { data } = await supabase.rpc("upsert_resource_chat_room", {
      p_venue_id: venueId,
      p_resource_id: booking.booking_ref,
      p_room_type: "booking",
      p_title: `${courtName} · ${time}`,
      p_subtitle: subtitle,
      p_emoji: "🎾",
      p_is_public: false,
    });

    if (data?.[0]) onSelectRoom(data[0] as ChatRoom);
  }, [venueId, onSelectRoom]);

  const openEventRoom = useCallback(async (event: any) => {
    const { data } = await supabase.rpc("upsert_resource_chat_room", {
      p_venue_id: venueId,
      p_resource_id: event.id,
      p_room_type: "event",
      p_title: event.display_name || event.name,
      p_subtitle: event.start_date
        ? DateTime.fromISO(event.start_date).toFormat("d MMM")
        : null,
      p_emoji: "🏆",
      p_is_public: true,
    });

    if (data?.[0]) onSelectRoom(data[0] as ChatRoom);
  }, [venueId, onSelectRoom]);

  return (
    <div style={{ minHeight: "100dvh", background: HUB_BG }}>
      {/* Header */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: HUB_BG,
          padding: "env(safe-area-inset-top,14px) 20px 14px",
          borderBottom: `1px solid ${HUB_BORDER}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p
              style={{
                fontFamily: FONT_MONO,
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.1em",
                color: HUB_TEXT,
              }}
            >
              PICKLA HUB
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 1 }}>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: HUB_GREEN,
                  display: "inline-block",
                  boxShadow: `0 0 0 2px rgba(34,197,94,0.2)`,
                }}
              />
              <span style={{ fontSize: 11, fontFamily: FONT_MONO, color: HUB_GREEN, fontWeight: 700 }}>
                LIVE
              </span>
              {playerCount > 0 && (
                <span style={{ fontSize: 11, fontFamily: FONT_MONO, color: HUB_MUTED }}>
                  · {playerCount} inne just nu
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Channel list */}
      <div style={{ padding: "16px 16px 120px" }}>

        {/* ── Pickla Idag ──────────────────────────────────────────── */}
        <SectionLabel label="Idag" />
        {dailyRoom ? (
          <ChannelCard
            emoji="📅"
            title="Pickla Idag"
            subtitle="Öppen kanal · lediga banor & Open Play"
            isLive
            isPinned
            onClick={() => onSelectRoom(dailyRoom)}
          />
        ) : (
          <SkeletonCard />
        )}

        {/* ── Mina bokningar ────────────────────────────────────────── */}
        {user && bookings.length > 0 && (
          <>
            <SectionLabel label="Mina bokningar" />
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {bookings.map((b) => {
                const dt = DateTime.fromISO(b.start_time, { zone: "utc" }).setZone("Europe/Stockholm");
                const courtName = b.venue_courts?.name || "Bana";
                const timeStr = dt.toFormat("HH:mm");
                const dateStr = dt.toFormat("EEE d/M", { locale: "sv" });
                return (
                  <ChannelCard
                    key={b.id}
                    emoji="🎾"
                    title={`${courtName} · ${timeStr}`}
                    subtitle={`${dateStr} · Kod: ${b.access_code || "—"}`}
                    onClick={() => openBookingRoom(b)}
                  />
                );
              })}
            </div>
          </>
        )}

        {/* ── Events & Ritualer ─────────────────────────────────────── */}
        {events.length > 0 && (
          <>
            <SectionLabel label="Events & Ritualer" />
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {events.map((ev) => {
                const dateStr = ev.start_date
                  ? DateTime.fromISO(ev.start_date).toFormat("d MMM", { locale: "sv" })
                  : "";
                return (
                  <ChannelCard
                    key={ev.id}
                    emoji="🏆"
                    title={ev.display_name || ev.name}
                    subtitle={dateStr || ev.event_type}
                    onClick={() => openEventRoom(ev)}
                  />
                );
              })}
            </div>
          </>
        )}

        {!user && (
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => navigate("/auth?redirect=/hub")}
            style={{
              width: "100%",
              marginTop: 12,
              background: HUB_NAVY,
              border: "none",
              borderRadius: 14,
              padding: "14px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              cursor: "pointer",
            }}
          >
            <span style={{ fontFamily: FONT_HEADING, fontSize: 14, fontWeight: 700, color: "#fff" }}>
              Logga in för att chatta
            </span>
            <span style={{ fontSize: 14, color: "rgba(255,255,255,0.5)" }}>→</span>
          </motion.button>
        )}
      </div>

      {/* Bottom nav */}
      <nav
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 32px",
          paddingBottom: "calc(14px + env(safe-area-inset-bottom, 0px))",
          background: `linear-gradient(to top, ${HUB_BG} 0%, ${HUB_BG} 60%, transparent 100%)`,
          zIndex: 20,
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 13,
            fontWeight: 700,
            color: HUB_RED,
            textDecoration: "underline",
            textDecorationColor: HUB_RED,
            textUnderlineOffset: 3,
          }}
        >
          hub
        </span>
        <button
          onClick={() => navigate("/book")}
          style={{
            fontFamily: FONT_MONO,
            fontSize: 13,
            fontWeight: 700,
            color: HUB_TEXT,
            background: "none",
            border: "none",
            cursor: "pointer",
            textDecoration: "underline",
            textDecorationColor: "rgba(0,0,0,0.12)",
            textUnderlineOffset: 3,
          }}
        >
          boka
        </button>
        <button
          onClick={() => navigate("/my")}
          style={{
            fontFamily: FONT_MONO,
            fontSize: 13,
            fontWeight: 700,
            color: HUB_TEXT,
            background: "none",
            border: "none",
            cursor: "pointer",
            textDecoration: "underline",
            textDecorationColor: "rgba(0,0,0,0.12)",
            textUnderlineOffset: 3,
          }}
        >
          me
        </button>
      </nav>
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function SectionLabel({ label }: { label: string }) {
  return (
    <p
      style={{
        fontFamily: FONT_MONO,
        fontSize: 10,
        fontWeight: 700,
        color: HUB_MUTED,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        margin: "18px 4px 8px",
      }}
    >
      {label}
    </p>
  );
}

function SkeletonCard() {
  return (
    <div
      style={{
        height: 72,
        borderRadius: 16,
        background: HUB_CARD,
        border: `1px solid ${HUB_BORDER}`,
        animation: "pulse 1.5s ease-in-out infinite",
      }}
    />
  );
}

// ── HubPage (root) ────────────────────────────────────────────────────────────
const HubPage = () => {
  const [searchParams] = useSearchParams();
  const slug = searchParams.get("v") || "pickla-arena-sthlm";
  const { user } = useAuth();

  const { data: venue } = useVenue(slug);
  const venueId = venue?.id;

  const { data: playerCount = 0 } = usePlayerCount(venueId);
  const { data: dailyRoom } = useDailyRoom(venueId);
  const { data: botData } = useDailyBotData(venueId);
  const { data: bookings = [] } = useBookingRooms(venueId, user?.id);
  const { data: events = [] } = useEventRooms(venueId);

  const [activeRoom, setActiveRoom] = useState<ChatRoom | null>(null);

  if (!venueId) {
    return (
      <div style={{ minHeight: "100dvh", background: HUB_BG, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Loader2 style={{ width: 24, height: 24, color: HUB_MUTED, animation: "spin 1s linear infinite" }} />
      </div>
    );
  }

  return (
    <div style={{ position: "relative", overflow: "hidden" }}>
      <HubList
        venueId={venueId}
        playerCount={playerCount}
        dailyRoom={dailyRoom}
        bookings={bookings}
        events={events}
        onSelectRoom={setActiveRoom}
      />

      <AnimatePresence>
        {activeRoom && (
          <motion.div
            key={activeRoom.id}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 32 }}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 50,
              background: HUB_BG,
            }}
          >
            <ChatRoom
              room={activeRoom}
              venueId={venueId}
              onBack={() => setActiveRoom(null)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default HubPage;
