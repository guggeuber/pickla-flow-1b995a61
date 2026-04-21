import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Send, Share2, Check, ImageIcon, X, Loader2 } from "lucide-react";
import { apiPost } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { DateTime } from "luxon";
import { ChannelCard } from "@/components/hub/ChannelCard";
import { ActionCard } from "@/components/hub/ActionCard";
import { BotMessage } from "@/components/hub/BotMessage";
import { PlayerNav } from "@/components/PlayerNav";

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
  content: string | null;
  metadata: Record<string, any>;
  created_at: string;
  reply_to_id?: string | null;
}

interface Reaction {
  id: string;
  message_id: string;
  room_id: string;
  user_id: string;
  emoji: string;
}

interface RoomPreview {
  lastMessage: string;
  lastMessageAt: string;
  senderName: string | null;
  senderAvatarUrl: string | null;
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
  return timeStr.slice(0, 5);
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
      const todayDow = now.weekday === 7 ? 0 : now.weekday;

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
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_messages", filter: `room_id=eq.${roomId}` },
        (payload) => setMessages((prev) => prev.map((m) => m.id === payload.new.id ? payload.new as ChatMessage : m))
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [roomId]);

  return { messages, loading };
}

function useExistingResourceRooms(venueId: string | undefined, resourceIds: string[]) {
  const key = resourceIds.slice().sort().join(",");
  return useQuery({
    queryKey: ["hub-resource-rooms", venueId, key],
    enabled: !!venueId && resourceIds.length > 0,
    staleTime: 60000,
    queryFn: async () => {
      const { data } = await supabase
        .from("chat_rooms")
        .select("id, resource_id")
        .eq("venue_id", venueId!)
        .in("resource_id", resourceIds);
      const map: Record<string, string> = {};
      for (const r of data ?? []) map[r.resource_id] = r.id;
      return map;
    },
  });
}

function useRoomPreviews(roomIds: string[]) {
  const key = roomIds.slice().sort().join(",");
  return useQuery({
    queryKey: ["hub-room-previews", key],
    enabled: roomIds.length > 0,
    staleTime: 15000,
    refetchInterval: 30000,
    queryFn: async () => {
      const { data: messages } = await supabase
        .from("chat_messages")
        .select("room_id, content, created_at, user_id, message_type")
        .in("room_id", roomIds)
        .order("created_at", { ascending: false });

      if (!messages?.length) return {} as Record<string, RoomPreview>;

      const lastByRoom: Record<string, typeof messages[0]> = {};
      for (const msg of messages) {
        if (!lastByRoom[msg.room_id]) lastByRoom[msg.room_id] = msg;
      }

      const userIds = [
        ...new Set(Object.values(lastByRoom).map((m) => m.user_id).filter((id): id is string => !!id)),
      ];
      const profileMap: Record<string, { display_name: string | null; avatar_url: string | null }> = {};
      if (userIds.length) {
        const { data: profiles } = await supabase
          .from("player_profiles")
          .select("auth_user_id, display_name, avatar_url")
          .in("auth_user_id", userIds);
        for (const p of profiles ?? []) {
          profileMap[p.auth_user_id] = { display_name: p.display_name, avatar_url: p.avatar_url };
        }
      }

      const result: Record<string, RoomPreview> = {};
      for (const [roomId, msg] of Object.entries(lastByRoom)) {
        const profile = msg.user_id ? profileMap[msg.user_id] : null;
        const previewText =
          msg.metadata?.type === "gif" ? "🎬 GIF" :
          msg.metadata?.type === "image" ? "📷 Bild" :
          msg.content ?? "Meddelande raderat";
        result[roomId] = {
          lastMessage: previewText,
          lastMessageAt: msg.created_at,
          senderName: profile?.display_name ?? null,
          senderAvatarUrl: profile?.avatar_url ?? null,
        };
      }
      return result;
    },
  });
}

// iOS Safari/PWA doesn't support navigator.vibrate — fire a silent AudioContext
// click instead. Must resume() because iOS suspends new contexts by default,
// and must close via onended so the context isn't torn down before it plays.
const _AC = (window.AudioContext ?? (window as any).webkitAudioContext) as typeof AudioContext | undefined;

function haptic(ms = 10) {
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
    if (!_AC) return;
    try {
      const ctx = new _AC();
      const play = () => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.01;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.002);
        osc.onended = () => ctx.close().catch(() => {});
      };
      ctx.state === "suspended" ? ctx.resume().then(play) : play();
    } catch {}
  } else {
    navigator.vibrate?.(ms);
  }
}

function useLongPress(callback: () => void, delay = 500) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const start = useCallback(() => {
    fired.current = false;
    timer.current = setTimeout(() => {
      fired.current = true;
      haptic(12);
      callback();
    }, delay);
  }, [callback, delay]);
  const cancel = useCallback(() => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } }, []);
  return {
    onMouseDown: start, onMouseUp: cancel, onMouseLeave: cancel,
    onTouchStart: start, onTouchEnd: cancel, onTouchMove: cancel,
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); if (fired.current) e.stopPropagation(); },
  };
}

function useRoomReactions(roomId: string | null) {
  const [reactions, setReactions] = useState<Record<string, Reaction[]>>({});
  useEffect(() => {
    if (!roomId) { setReactions({}); return; }
    supabase.from("chat_reactions").select("id, message_id, room_id, user_id, emoji")
      .eq("room_id", roomId)
      .then(({ data }) => {
        const grouped: Record<string, Reaction[]> = {};
        for (const r of (data ?? []) as Reaction[]) {
          if (!grouped[r.message_id]) grouped[r.message_id] = [];
          grouped[r.message_id].push(r);
        }
        setReactions(grouped);
      });
    const channel = supabase.channel(`reactions:${roomId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_reactions", filter: `room_id=eq.${roomId}` },
        (payload) => {
          const r = payload.new as Reaction;
          setReactions((prev) => ({ ...prev, [r.message_id]: [...(prev[r.message_id] ?? []), r] }));
        })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "chat_reactions", filter: `room_id=eq.${roomId}` },
        (payload) => {
          const r = payload.old as Partial<Reaction>;
          if (!r.message_id || !r.id) return;
          setReactions((prev) => ({ ...prev, [r.message_id!]: (prev[r.message_id!] ?? []).filter((x) => x.id !== r.id) }));
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [roomId]);
  return reactions;
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
  const qc = useQueryClient();
  const { messages, loading: msgsLoading } = useRoomMessages(room.id);
  const { data: botData } = useDailyBotData(room.room_type === "daily" ? venueId : undefined);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const reactions = useRoomReactions(room.id);
  const [contextMsg, setContextMsg] = useState<ChatMessage | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [gifQuery, setGifQuery] = useState("");
  const [gifResults, setGifResults] = useState<{ id: string; url: string; thumb: string }[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // #3 — push input above keyboard on iOS
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      setKeyboardOffset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  const shareRoom = async () => {
    const url = `${window.location.origin}/hub?join=${room.id}`;
    if (navigator.share) {
      await navigator.share({ title: room.title, text: "Gå med i min bokningschat på Pickla!", url });
    } else {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  useEffect(() => {
    if (!showGifPicker) return;
    const apiKey = import.meta.env.VITE_GIPHY_API_KEY;
    if (!apiKey) return;
    const timer = setTimeout(async () => {
      setGifLoading(true);
      const endpoint = gifQuery.trim()
        ? `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(gifQuery)}&limit=18&rating=g`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${apiKey}&limit=18&rating=g`;
      const res = await fetch(endpoint).then((r) => r.json()).catch(() => null);
      setGifResults(
        (res?.data ?? []).map((g: any) => ({
          id: g.id,
          url: g.images.original.url,
          thumb: g.images.fixed_height_small.url,
        }))
      );
      setGifLoading(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [showGifPicker, gifQuery]);

  const sendGif = async (gif: { url: string; thumb: string }) => {
    if (!user?.id) return;
    setShowGifPicker(false);
    await supabase.from("chat_messages").insert({
      room_id: room.id,
      user_id: user.id,
      message_type: "text",
      content: gif.url,
      metadata: { type: "gif", thumb: gif.thumb },
    });
    qc.invalidateQueries({ queryKey: ["hub-room-previews"] });
  };

  const uploadImage = async (file: File) => {
    if (!user?.id || uploading) return;
    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `${user.id}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("chat-images").upload(path, file);
    if (!error) {
      const { data: urlData } = supabase.storage.from("chat-images").getPublicUrl(path);
      await supabase.from("chat_messages").insert({
        room_id: room.id,
        user_id: user.id,
        message_type: "text",
        content: urlData.publicUrl,
        metadata: { type: "image" },
      });
      qc.invalidateQueries({ queryKey: ["hub-room-previews"] });
    }
    setUploading(false);
  };

  useEffect(() => {
    if (!user?.id || !room.id) return;
    supabase.from("chat_participants").upsert(
      { room_id: room.id, user_id: user.id },
      { onConflict: "room_id,user_id", ignoreDuplicates: true }
    );
  }, [room.id, user?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, botData]);

  const sendMessage = async () => {
    if (!input.trim() || !user?.id || sending) return;
    setSending(true);
    const content = input.trim();
    setInput("");
    if (editingMessage) {
      setEditingMessage(null);
      await supabase.from("chat_messages").update({ content }).eq("id", editingMessage.id).eq("user_id", user.id);
      setSending(false);
      return;
    }
    const replyRef = replyTo?.id ?? null;
    setReplyTo(null);
    await supabase.from("chat_messages").insert({
      room_id: room.id,
      user_id: user.id,
      message_type: "text",
      content,
      ...(replyRef ? { reply_to_id: replyRef } : {}),
    });
    qc.invalidateQueries({ queryKey: ["hub-room-previews"] });
    const preview = content.length > 60 ? content.slice(0, 60) + "…" : content;
    apiPost("api-notifications", "chat-message", { room_id: room.id, preview }).catch(() => {});
    setSending(false);
  };

  const handleReact = async (messageId: string, emoji: string) => {
    if (!user?.id) return;
    haptic(10);
    const existing = (reactions[messageId] ?? []).find((r) => r.emoji === emoji && r.user_id === user.id);
    if (existing) {
      await supabase.from("chat_reactions").delete().eq("id", existing.id);
    } else {
      await supabase.from("chat_reactions").insert({ message_id: messageId, room_id: room.id, user_id: user.id, emoji });
    }
  };

  const handleDelete = async (msg: ChatMessage) => {
    if (!user?.id) return;
    await supabase.from("chat_messages").update({ content: null }).eq("id", msg.id).eq("user_id", user.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        boxSizing: "border-box",
        // #3 — pad bottom by keyboard height so input floats above it
        paddingBottom: keyboardOffset,
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
        <motion.button
          whileTap={{ scale: 0.97 }}
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
        </motion.button>

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
            <p style={{ fontSize: 10, fontFamily: "Inter, sans-serif", color: HUB_MUTED }}>
              {room.subtitle}
            </p>
          )}
        </div>

        {room.room_type === "booking" && (
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={shareRoom}
            title="Bjud in"
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              border: `1px solid ${copied ? HUB_GREEN : HUB_BORDER}`,
              background: copied ? "rgba(34,197,94,0.08)" : HUB_CARD,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "all 0.2s",
              cursor: "pointer",
            }}
          >
            {copied
              ? <Check style={{ width: 15, height: 15, color: HUB_GREEN }} />
              : <Share2 style={{ width: 15, height: 15, color: HUB_TEXT }} />}
          </motion.button>
        )}
      </div>

      {/* Messages — #1 scroll feel */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          WebkitOverflowScrolling: "touch" as any,
          overscrollBehavior: "contain",
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
            <p style={{ fontFamily: FONT_HEADING, fontSize: 10, color: "rgba(255,255,255,0.5)", marginBottom: 2, letterSpacing: "0.06em" }}>
              DIN BOKNING
            </p>
            <p style={{ fontFamily: FONT_HEADING, fontSize: 15, fontWeight: 700, color: "#fff" }}>
              {room.title}
            </p>
            {room.subtitle && (
              <p style={{ fontSize: 12, fontFamily: "Inter, sans-serif", color: "rgba(255,255,255,0.6)", marginTop: 2 }}>
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

        {/* #8 — message skeletons while loading */}
        {msgsLoading && (
          <>
            <MessageSkeleton align="start" />
            <MessageSkeleton align="end" wide />
            <MessageSkeleton align="start" wide />
            <MessageSkeleton align="end" />
          </>
        )}

        {/* User messages */}
        {messages.map((msg) => {
          const replyToMsg = msg.reply_to_id ? messages.find((m) => m.id === msg.reply_to_id) : undefined;
          return (
            <MessageBubble
              key={msg.id}
              message={msg}
              currentUserId={user?.id}
              replyToMessage={replyToMsg}
              reactions={reactions[msg.id] ?? []}
              onLongPress={() => setContextMsg(msg)}
              onReactionToggle={(emoji) => handleReact(msg.id, emoji)}
            />
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* Input — #3 sticky so it hugs the bottom of the (shrinking) container */}
      {user ? (
        <div
          style={{
            flexShrink: 0,
            borderTop: `1px solid ${HUB_BORDER}`,
            background: HUB_CARD,
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
          }}
        >
          {/* Reply preview bar */}
          {replyTo && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: `1px solid ${HUB_BORDER}` }}>
              <div style={{ flex: 1, borderLeft: `2px solid ${HUB_RED}`, paddingLeft: 8 }}>
                <p style={{ fontSize: 10, fontFamily: FONT_HEADING, color: HUB_RED, fontWeight: 700, marginBottom: 1, letterSpacing: "0.05em" }}>SVARA PÅ</p>
                <p style={{ fontSize: 12, color: HUB_TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {replyTo.content?.slice(0, 60) ?? "Meddelande"}
                </p>
              </div>
              <motion.button whileTap={{ scale: 0.97 }} onClick={() => setReplyTo(null)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                <X style={{ width: 14, height: 14, color: HUB_MUTED }} />
              </motion.button>
            </div>
          )}
          {/* Edit mode bar */}
          {editingMessage && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: `1px solid ${HUB_BORDER}` }}>
              <div style={{ flex: 1, borderLeft: `2px solid ${HUB_MUTED}`, paddingLeft: 8 }}>
                <p style={{ fontSize: 10, fontFamily: FONT_HEADING, color: HUB_MUTED, fontWeight: 700, marginBottom: 1, letterSpacing: "0.05em" }}>REDIGERA</p>
                <p style={{ fontSize: 12, color: HUB_TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {editingMessage.content?.slice(0, 60) ?? ""}
                </p>
              </div>
              <motion.button whileTap={{ scale: 0.97 }} onClick={() => { setEditingMessage(null); setInput(""); }} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                <X style={{ width: 14, height: 14, color: HUB_MUTED }} />
              </motion.button>
            </div>
          )}

          {/* GIF picker panel */}
          {showGifPicker && (
            <div style={{ borderBottom: `1px solid ${HUB_BORDER}`, padding: "10px 12px" }}>
              <input
                autoFocus
                value={gifQuery}
                onChange={(e) => setGifQuery(e.target.value)}
                placeholder="Sök GIF..."
                style={{
                  width: "100%",
                  background: HUB_BG,
                  border: `1px solid ${HUB_BORDER}`,
                  borderRadius: 8,
                  padding: "7px 10px",
                  fontSize: 13,
                  color: HUB_TEXT,
                  outline: "none",
                  marginBottom: 8,
                  boxSizing: "border-box",
                }}
              />
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 4,
                  maxHeight: 180,
                  overflowY: "auto",
                  WebkitOverflowScrolling: "touch" as any,
                }}
              >
                {gifLoading
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <div
                        key={i}
                        style={{ height: 72, borderRadius: 8, background: HUB_BG, animation: "pulse 1.5s infinite" }}
                      />
                    ))
                  : gifResults.map((gif) => (
                      <motion.button
                        key={gif.id}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => sendGif(gif)}
                        style={{ padding: 0, border: "none", borderRadius: 8, overflow: "hidden", cursor: "pointer" }}
                      >
                        <img
                          src={gif.thumb}
                          alt=""
                          style={{ width: "100%", height: 72, objectFit: "cover", display: "block" }}
                        />
                      </motion.button>
                    ))}
              </div>
            </div>
          )}

          <div style={{ padding: "10px 12px", display: "flex", gap: 6, alignItems: "flex-end" }}>
            {/* GIF toggle */}
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => setShowGifPicker((v) => !v)}
              style={{
                height: 38,
                padding: "0 10px",
                borderRadius: 10,
                border: `1px solid ${showGifPicker ? HUB_RED : HUB_BORDER}`,
                background: showGifPicker ? "rgba(204,41,54,0.07)" : HUB_BG,
                fontFamily: FONT_HEADING,
                fontSize: 11,
                fontWeight: 700,
                color: showGifPicker ? HUB_RED : HUB_MUTED,
                cursor: "pointer",
                flexShrink: 0,
                letterSpacing: "0.05em",
              }}
            >
              GIF
            </motion.button>

            {/* Image upload */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0])}
            />
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                border: `1px solid ${HUB_BORDER}`,
                background: HUB_BG,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                cursor: uploading ? "default" : "pointer",
              }}
            >
              {uploading
                ? <Loader2 style={{ width: 15, height: 15, color: HUB_MUTED, animation: "spin 1s linear infinite" }} />
                : <ImageIcon style={{ width: 15, height: 15, color: HUB_MUTED }} />}
            </motion.button>

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
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={sendMessage}
              disabled={!input.trim() || sending}
              style={{
                height: 38,
                padding: editingMessage ? "0 12px" : "0",
                width: editingMessage ? "auto" : 38,
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
              {editingMessage
                ? <span style={{ fontSize: 13, fontFamily: FONT_HEADING, fontWeight: 700, color: input.trim() ? "#fff" : HUB_MUTED, letterSpacing: "0.05em" }}>Spara</span>
                : <Send style={{ width: 15, height: 15, color: input.trim() ? "#fff" : HUB_MUTED }} />}
            </motion.button>
          </div>
        </div>
      ) : (
        <div
          style={{
            flexShrink: 0,
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
              fontFamily: FONT_HEADING,
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

      {/* Context menu overlay */}
      {contextMsg && (
        <ContextOverlay
          message={contextMsg}
          currentUserId={user?.id}
          reactions={reactions[contextMsg.id] ?? []}
          onReact={(emoji) => { handleReact(contextMsg.id, emoji); setContextMsg(null); }}
          onReply={() => { setReplyTo(contextMsg); setContextMsg(null); }}
          onCopy={() => { if (contextMsg.content) navigator.clipboard.writeText(contextMsg.content); setContextMsg(null); }}
          onDelete={() => { handleDelete(contextMsg); setContextMsg(null); }}
          onEdit={() => { setEditingMessage(contextMsg); setInput(contextMsg.content ?? ""); setContextMsg(null); }}
          onDismiss={() => setContextMsg(null)}
        />
      )}
    </div>
  );
}

// ── ReactionBar ───────────────────────────────────────────────────────────────
function ReactionBar({ reactions, currentUserId, onToggle }: {
  reactions: Reaction[];
  currentUserId?: string;
  onToggle: (emoji: string) => void;
}) {
  if (!reactions.length) return null;
  const grouped: Record<string, { count: number; userReacted: boolean }> = {};
  for (const r of reactions) {
    if (!grouped[r.emoji]) grouped[r.emoji] = { count: 0, userReacted: false };
    grouped[r.emoji].count++;
    if (r.user_id === currentUserId) grouped[r.emoji].userReacted = true;
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {Object.entries(grouped).map(([emoji, { count, userReacted }]) => (
        <motion.button key={emoji} whileTap={{ scale: 0.97 }} onClick={() => onToggle(emoji)} style={{
          padding: "2px 7px", borderRadius: 12,
          border: "none",
          background: "#fff",
          boxShadow: "0 1px 4px rgba(0,0,0,0.13)",
          fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 3,
        }}>
          <span>{emoji}</span>
          <span style={{ fontSize: 11, fontFamily: "Inter, sans-serif", color: userReacted ? HUB_RED : HUB_MUTED, fontWeight: userReacted ? 700 : 400 }}>{count}</span>
        </motion.button>
      ))}
    </div>
  );
}

// ── ContextOverlay ────────────────────────────────────────────────────────────
const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const ALL_EMOJIS = ["😀","😂","😍","🥰","😎","🤔","😅","😭","😡","🥳","👍","👎","❤️","🔥","💯","🎉","🙏","👏","💪","🤝","⚡","✅","🏆","🎯","🚀","💡","😴","🤯","👀","💬","🎾","🏓","⭐","🌟","💥","🤣","😬","🙈","🤷","💃"];

function ContextOverlay({ message, currentUserId, reactions, onReact, onReply, onCopy, onDelete, onEdit, onDismiss }: {
  message: ChatMessage;
  currentUserId?: string;
  reactions: Reaction[];
  onReact: (emoji: string) => void;
  onReply: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onDismiss: () => void;
}) {
  const isOwn = message.user_id === currentUserId;
  const isMedia = message.metadata?.type === "gif" || message.metadata?.type === "image";
  const [showGrid, setShowGrid] = useState(false);
  return (
    <div onClick={onDismiss} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.55)", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <motion.div onClick={(e) => e.stopPropagation()} initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} transition={{ type: "spring", stiffness: 380, damping: 32 }}
        style={{ background: HUB_CARD, borderRadius: "20px 20px 0 0", paddingBottom: "env(safe-area-inset-bottom, 8px)" }}>
        {showGrid ? (
          <>
            <div style={{ padding: "12px 16px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${HUB_BORDER}` }}>
              <p style={{ fontSize: 10, fontFamily: FONT_HEADING, fontWeight: 700, color: HUB_MUTED, letterSpacing: "0.06em" }}>VÄLJ REAKTION</p>
              <motion.button whileTap={{ scale: 0.97 }} onClick={() => setShowGrid(false)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                <X style={{ width: 16, height: 16, color: HUB_MUTED }} />
              </motion.button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", padding: "10px 8px 4px", maxHeight: 240, overflowY: "auto", WebkitOverflowScrolling: "touch" as any }}>
              {ALL_EMOJIS.map((emoji) => (
                <motion.button key={emoji} whileTap={{ scale: 0.85 }} onClick={() => onReact(emoji)} style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: 28, lineHeight: 1, padding: "6px 0",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>{emoji}</motion.button>
              ))}
            </div>
          </>
        ) : (
          <>
            {/* Message preview */}
            <div style={{ padding: "14px 16px 12px", borderBottom: `1px solid ${HUB_BORDER}` }}>
              <p style={{ fontSize: 10, fontFamily: FONT_HEADING, fontWeight: 700, color: HUB_MUTED, marginBottom: 3, letterSpacing: "0.06em" }}>{isOwn ? "DITT MEDDELANDE" : "MEDDELANDE"}</p>
              <p style={{ fontSize: 14, color: HUB_TEXT, lineHeight: 1.4 }}>
                {message.content?.slice(0, 100) ?? "Meddelande raderat"}{(message.content?.length ?? 0) > 100 ? "…" : ""}
              </p>
            </div>
            {/* Emoji row */}
            <div style={{ display: "flex", alignItems: "center", padding: "10px 12px", gap: 6, justifyContent: "space-around", borderBottom: `1px solid ${HUB_BORDER}` }}>
              {QUICK_EMOJIS.map((emoji) => {
                const active = reactions.some((r) => r.emoji === emoji && r.user_id === currentUserId);
                return (
                  <motion.button key={emoji} whileTap={{ scale: 0.97 }} onClick={() => onReact(emoji)} style={{
                    width: 44, height: 44, borderRadius: 22, fontSize: 22, cursor: "pointer",
                    border: `${active ? "2px" : "1px"} solid ${active ? HUB_RED : HUB_BORDER}`,
                    background: active ? "rgba(204,41,54,0.07)" : HUB_BG,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>{emoji}</motion.button>
                );
              })}
              <motion.button whileTap={{ scale: 0.97 }} onClick={() => setShowGrid(true)} style={{ width: 44, height: 44, borderRadius: 22, border: `1px solid ${HUB_BORDER}`, background: HUB_BG, fontSize: 18, color: HUB_MUTED, cursor: "pointer" }}>+</motion.button>
            </div>
            {/* Actions */}
            {[
              { label: "Svara", icon: "↩️", action: onReply, show: true },
              { label: "Redigera", icon: "✏️", action: onEdit, show: isOwn && !isMedia && !!message.content },
              { label: "Kopiera", icon: "📋", action: onCopy, show: !!message.content && !isMedia },
              { label: "Radera", icon: "🗑️", action: onDelete, show: isOwn, danger: true },
            ].filter((a) => a.show).map(({ label, icon, action, danger }) => (
              <motion.button key={label} whileTap={{ scale: 0.98 }} onClick={action} style={{
                width: "100%", padding: "15px 16px", background: "none", border: "none",
                borderBottom: `1px solid ${HUB_BORDER}`, display: "flex", alignItems: "center",
                gap: 12, cursor: "pointer", textAlign: "left",
              }}>
                <span style={{ fontSize: 18 }}>{icon}</span>
                <span style={{ fontSize: 15, color: (danger as boolean | undefined) ? HUB_RED : HUB_TEXT, fontFamily: "Inter, sans-serif" }}>{label}</span>
              </motion.button>
            ))}
          </>
        )}
      </motion.div>
    </div>
  );
}

// ── MessageBubble ─────────────────────────────────────────────────────────────
function MessageBubble({ message, currentUserId, replyToMessage, reactions, onLongPress, onReactionToggle }: {
  message: ChatMessage;
  currentUserId?: string;
  replyToMessage?: ChatMessage;
  reactions: Reaction[];
  onLongPress: () => void;
  onReactionToggle: (emoji: string) => void;
}) {
  const isOwn = message.user_id === currentUserId;
  const isBot = message.message_type === "bot";
  const isDeleted = message.content === null;
  const isMedia = !isDeleted && (message.metadata?.type === "gif" || message.metadata?.type === "image");
  const longPress = useLongPress(onLongPress);
  const hasReactions = reactions.length > 0;

  if (isBot) {
    return <BotMessage content={message.content ?? ""} time={relativeTime(message.created_at)} />;
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isOwn ? "flex-end" : "flex-start",
        marginBottom: hasReactions ? 22 : 2,
      }}
    >
      {/* position: relative on the bubble itself so reactions anchor to its corner,
          not the full-width outer flex container (matters for transparent image bubbles) */}
      <div
        {...longPress}
        style={{
          position: "relative",
          maxWidth: "75%",
          padding: "8px 12px",
          borderRadius: isOwn ? "14px 4px 14px 14px" : "4px 14px 14px 14px",
          background: isMedia ? "transparent" : isOwn ? HUB_NAVY : HUB_CARD,
          border: isMedia ? "none" : isOwn ? "none" : `1px solid ${HUB_BORDER}`,
          boxShadow: isMedia ? "none" : isOwn ? "none" : "0 1px 2px rgba(0,0,0,0.04)",
          overflow: "visible",
          userSelect: "none",
        }}
      >
        {replyToMessage && (
          <div style={{ borderLeft: `2px solid ${isOwn ? "rgba(255,255,255,0.35)" : HUB_RED}`, paddingLeft: 7, marginBottom: 6, opacity: 0.75 }}>
            <p style={{ fontSize: 11, color: isOwn ? "rgba(255,255,255,0.8)" : HUB_MUTED, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {replyToMessage.content?.slice(0, 60) ?? "Meddelande raderat"}
            </p>
          </div>
        )}

        {isDeleted ? (
          <p style={{ fontSize: 13, color: isOwn ? "rgba(255,255,255,0.5)" : HUB_MUTED, fontStyle: "italic" }}>
            Meddelande raderat
          </p>
        ) : isMedia ? (
          <img
            src={message.metadata?.thumb || message.content!}
            alt=""
            style={{ maxWidth: 220, maxHeight: 180, borderRadius: 10, display: "block" }}
            onClick={() => window.open(message.content!, "_blank")}
          />
        ) : (
          <p style={{ fontSize: 14, color: isOwn ? "#fff" : HUB_TEXT, lineHeight: 1.4 }}>
            {message.content}
          </p>
        )}
        <p style={{ fontSize: 9, fontFamily: "Inter, sans-serif", color: isOwn ? "rgba(255,255,255,0.45)" : HUB_MUTED, marginTop: isMedia ? 2 : 3, textAlign: "right", padding: isMedia ? "0 4px 2px" : 0 }}>
          {relativeTime(message.created_at)}
        </p>

        {/* Reactions anchored to bubble's bottom corner — works for text, image, and GIF */}
        {hasReactions && (
          <div style={{
            position: "absolute",
            bottom: -12,
            ...(isOwn ? { right: 8 } : { left: 8 }),
          }}>
            <ReactionBar reactions={reactions} currentUserId={currentUserId} onToggle={onReactionToggle} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Skeletons ─────────────────────────────────────────────────────────────────
function MessageSkeleton({ align = "start", wide = false }: { align?: "start" | "end"; wide?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: align === "end" ? "flex-end" : "flex-start" }}>
      <div
        style={{
          width: wide ? "60%" : "40%",
          height: 36,
          borderRadius: align === "end" ? "14px 4px 14px 14px" : "4px 14px 14px 14px",
          background: align === "end" ? "rgba(26,31,58,0.12)" : HUB_CARD,
          border: align === "end" ? "none" : `1px solid ${HUB_BORDER}`,
          animation: "pulse 1.5s ease-in-out infinite",
        }}
      />
    </div>
  );
}

function HubSkeleton() {
  return (
    <div style={{ padding: "16px 16px 0" }}>
      {/* Section label */}
      <div style={{ width: 40, height: 10, borderRadius: 4, background: HUB_BORDER, marginBottom: 10, marginTop: 18, animation: "pulse 1.5s ease-in-out infinite" }} />
      {/* Cards */}
      {[72, 72, 72].map((h, i) => (
        <div key={i} style={{ height: h, borderRadius: 16, background: HUB_CARD, border: `1px solid ${HUB_BORDER}`, marginBottom: 8, animation: "pulse 1.5s ease-in-out infinite" }} />
      ))}
      <div style={{ width: 80, height: 10, borderRadius: 4, background: HUB_BORDER, marginBottom: 10, marginTop: 18, animation: "pulse 1.5s ease-in-out infinite" }} />
      {[72].map((h, i) => (
        <div key={i} style={{ height: h, borderRadius: 16, background: HUB_CARD, border: `1px solid ${HUB_BORDER}`, marginBottom: 8, animation: "pulse 1.5s ease-in-out infinite" }} />
      ))}
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

  const bookingResourceIds = bookings.map((b) => b.booking_ref).filter(Boolean);
  const eventResourceIds = events.map((e) => e.id).filter(Boolean);
  const { data: resourceRoomMap = {} } = useExistingResourceRooms(venueId, [
    ...bookingResourceIds,
    ...eventResourceIds,
  ]);

  const allRoomIds = [
    dailyRoom?.id,
    ...Object.values(resourceRoomMap),
  ].filter((id): id is string => !!id);

  const { data: previews = {} } = useRoomPreviews(allRoomIds);

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
                fontFamily: FONT_HEADING,
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.08em",
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
              <span style={{ fontSize: 11, fontFamily: FONT_HEADING, color: HUB_GREEN, fontWeight: 700 }}>
                LIVE
              </span>
              {playerCount > 0 && (
                <span style={{ fontSize: 11, fontFamily: "Inter, sans-serif", color: HUB_MUTED }}>
                  · {playerCount} inne just nu
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Channel list — #1 overscroll contain, #6 prevent pull-to-refresh propagation */}
      <div style={{ padding: "16px 16px 120px", overscrollBehavior: "contain" }}>

        {/* ── Pickla Idag ──────────────────────────────────────────── */}
        <SectionLabel label="Idag" />
        {dailyRoom ? (
          <ChannelCard
            emoji="📅"
            title="Pickla Idag"
            subtitle="Öppen kanal · lediga banor & Open Play"
            isLive
            isPinned
            lastMessage={previews[dailyRoom.id]?.lastMessage}
            lastMessageTime={previews[dailyRoom.id]?.lastMessageAt ? relativeTime(previews[dailyRoom.id].lastMessageAt) : undefined}
            senderName={previews[dailyRoom.id]?.senderName ?? undefined}
            senderAvatarUrl={previews[dailyRoom.id]?.senderAvatarUrl ?? undefined}
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
                    lastMessage={b.booking_ref && resourceRoomMap[b.booking_ref] ? previews[resourceRoomMap[b.booking_ref]]?.lastMessage : undefined}
                    lastMessageTime={b.booking_ref && resourceRoomMap[b.booking_ref] && previews[resourceRoomMap[b.booking_ref]]?.lastMessageAt ? relativeTime(previews[resourceRoomMap[b.booking_ref]].lastMessageAt) : undefined}
                    senderName={b.booking_ref && resourceRoomMap[b.booking_ref] ? previews[resourceRoomMap[b.booking_ref]]?.senderName ?? undefined : undefined}
                    senderAvatarUrl={b.booking_ref && resourceRoomMap[b.booking_ref] ? previews[resourceRoomMap[b.booking_ref]]?.senderAvatarUrl ?? undefined : undefined}
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
                    lastMessage={resourceRoomMap[ev.id] ? previews[resourceRoomMap[ev.id]]?.lastMessage : undefined}
                    lastMessageTime={resourceRoomMap[ev.id] && previews[resourceRoomMap[ev.id]]?.lastMessageAt ? relativeTime(previews[resourceRoomMap[ev.id]].lastMessageAt) : undefined}
                    senderName={resourceRoomMap[ev.id] ? previews[resourceRoomMap[ev.id]]?.senderName ?? undefined : undefined}
                    senderAvatarUrl={resourceRoomMap[ev.id] ? previews[resourceRoomMap[ev.id]]?.senderAvatarUrl ?? undefined : undefined}
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

      <PlayerNav />
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function SectionLabel({ label }: { label: string }) {
  return (
    <p
      style={{
        fontFamily: FONT_HEADING,
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
  const joinRoomId = searchParams.get("join");
  const { user } = useAuth();

  const { data: venue } = useVenue(slug);
  const venueId = venue?.id;

  const { data: playerCount = 0 } = usePlayerCount(venueId);
  const { data: dailyRoom } = useDailyRoom(venueId);
  const { data: botData } = useDailyBotData(venueId);
  const { data: bookings = [] } = useBookingRooms(venueId, user?.id);
  const { data: events = [] } = useEventRooms(venueId);

  const [activeRoom, setActiveRoom] = useState<ChatRoom | null>(null);

  // Push a history entry when ChatRoom opens so the native PWA back gesture
  // closes the overlay instead of navigating away from /hub
  useEffect(() => {
    if (!activeRoom) return;
    history.pushState({ chatRoom: true }, "");
    const handlePop = () => setActiveRoom(null);
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, [activeRoom?.id]);

  useEffect(() => {
    if (!joinRoomId || !user?.id || activeRoom) return;
    supabase.rpc("join_chat_room", { p_room_id: joinRoomId }).then(({ data }) => {
      if (data?.[0]) setActiveRoom(data[0] as ChatRoom);
    });
  }, [joinRoomId, user?.id]);

  // #8 — skeleton instead of spinner while venue loads
  if (!venueId) {
    return (
      <div style={{ minHeight: "100dvh", background: HUB_BG }}>
        <div style={{
          position: "sticky", top: 0, zIndex: 10, background: HUB_BG,
          padding: "env(safe-area-inset-top,14px) 20px 14px",
          borderBottom: `1px solid ${HUB_BORDER}`,
        }}>
          <div style={{ width: 90, height: 14, borderRadius: 6, background: HUB_BORDER, animation: "pulse 1.5s ease-in-out infinite" }} />
          <div style={{ width: 60, height: 10, borderRadius: 4, background: HUB_BORDER, marginTop: 6, animation: "pulse 1.5s ease-in-out infinite" }} />
        </div>
        <HubSkeleton />
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
        onSelectRoom={async (room) => {
          await supabase.rpc("join_chat_room", { p_room_id: room.id });
          setActiveRoom(room);
        }}
      />

      <AnimatePresence>
        {activeRoom && (
          <motion.div
            key={activeRoom.id}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 32 }}
            // #4 — swipe right to dismiss; dragElastic=0 prevents rubber-band
            // that iOS mistakes for native back gesture
            drag="x"
            dragConstraints={{ left: 0, right: 300 }}
            dragElastic={0}
            dragMomentum={false}
            dragDirectionLock
            onDragEnd={(e, info) => {
              e.stopPropagation();
              if (info.offset.x > 80) setActiveRoom(null);
            }}
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
