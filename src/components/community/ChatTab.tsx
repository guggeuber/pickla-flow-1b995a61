import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Loader2, Hash, Users, ChevronLeft, Zap } from "lucide-react";

const BLUE = "#0066FF";
const GREEN = "#22C55E";
const TEXT_PRIMARY = "#111827";
const TEXT_MUTED = "#9CA3AF";

interface ChatChannel {
  id: string;
  name: string;
  description: string | null;
  channel_type: string;
  sport_type: string | null;
  venue_id: string | null;
  crew_id: string | null;
}

interface ChatMessage {
  id: string;
  content: string;
  message_type: string;
  created_at: string;
  sender_profile_id: string;
  player_profiles?: { display_name: string | null; avatar_url: string | null } | null;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function ChannelList({ channels, onSelect }: { channels: ChatChannel[]; onSelect: (c: ChatChannel) => void }) {
  const venueChannels = channels.filter(c => c.channel_type === "venue");
  const crewChannels = channels.filter(c => c.channel_type === "crew");
  const sportChannels = channels.filter(c => c.channel_type === "sport");

  const renderGroup = (title: string, items: ChatChannel[], icon: typeof Hash) => {
    if (items.length === 0) return null;
    const Icon = icon;
    return (
      <div className="mb-4">
        <p className="text-[10px] font-bold uppercase tracking-widest mb-2 px-1" style={{ color: TEXT_MUTED }}>{title}</p>
        <div className="flex flex-col gap-1.5">
          {items.map(ch => (
            <button
              key={ch.id}
              onClick={() => onSelect(ch)}
              className="flex items-center gap-3 rounded-xl px-3 py-3 text-left transition-all active:scale-[0.98]"
              style={{ background: "rgba(255,255,255,0.6)", border: "1.5px solid rgba(0,0,0,0.06)" }}
            >
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: `${BLUE}10` }}>
                <Icon className="w-4 h-4" style={{ color: BLUE }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate" style={{ fontFamily: "'Space Grotesk', sans-serif", color: TEXT_PRIMARY }}>
                  {ch.name}
                </p>
                {ch.description && (
                  <p className="text-[11px] truncate" style={{ color: TEXT_MUTED }}>{ch.description}</p>
                )}
              </div>
              {ch.sport_type && (
                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase shrink-0"
                  style={{ background: `${GREEN}15`, color: GREEN }}>
                  {ch.sport_type}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div>
      {renderGroup("Channels", venueChannels, Hash)}
      {renderGroup("Sport", sportChannels, Zap)}
      {renderGroup("Crews", crewChannels, Users)}
      {channels.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: `${BLUE}10` }}>
            <Hash className="w-7 h-7" style={{ color: BLUE }} />
          </div>
          <p className="text-sm font-semibold" style={{ color: TEXT_PRIMARY }}>No channels yet</p>
          <p className="text-xs text-center max-w-[200px]" style={{ color: TEXT_MUTED }}>
            Channels will appear here when created by venue admins.
          </p>
        </div>
      )}
    </div>
  );
}

function MessageBubble({ msg, isOwn }: { msg: ChatMessage; isOwn: boolean }) {
  const name = msg.player_profiles?.display_name || "Player";
  const avatar = msg.player_profiles?.avatar_url;

  return (
    <div className={`flex gap-2 ${isOwn ? "flex-row-reverse" : ""}`}>
      {!isOwn && (
        avatar ? (
          <img src={avatar} alt={name} className="w-7 h-7 rounded-full object-cover shrink-0 mt-1" />
        ) : (
          <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-1"
            style={{ background: `${BLUE}15` }}>
            <span className="text-[10px] font-bold" style={{ color: BLUE }}>
              {name.charAt(0).toUpperCase()}
            </span>
          </div>
        )
      )}
      <div className={`max-w-[75%] ${isOwn ? "items-end" : "items-start"} flex flex-col`}>
        {!isOwn && (
          <span className="text-[10px] font-semibold mb-0.5 px-1" style={{ color: TEXT_MUTED }}>{name}</span>
        )}
        <div
          className="rounded-2xl px-3.5 py-2"
          style={{
            background: isOwn ? BLUE : "rgba(255,255,255,0.8)",
            border: isOwn ? "none" : "1px solid rgba(0,0,0,0.06)",
            borderTopRightRadius: isOwn ? 6 : 16,
            borderTopLeftRadius: isOwn ? 16 : 6,
          }}
        >
          <p className="text-[13px] leading-relaxed" style={{ color: isOwn ? "#fff" : TEXT_PRIMARY }}>
            {msg.content}
          </p>
        </div>
        <span className="text-[9px] mt-0.5 px-1" style={{ color: TEXT_MUTED }}>{timeAgo(msg.created_at)}</span>
      </div>
    </div>
  );
}

function ChatRoom({ channel, onBack, profileId }: { channel: ChatChannel; onBack: () => void; profileId: string }) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: messages, isLoading } = useQuery({
    queryKey: ["chat-messages", channel.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("chat_messages")
        .select("*, player_profiles(display_name, avatar_url)")
        .eq("channel_id", channel.id)
        .order("created_at", { ascending: true })
        .limit(100);
      if (error) throw error;
      return (data || []) as ChatMessage[];
    },
  });

  // Realtime subscription
  useEffect(() => {
    const sub = supabase
      .channel(`chat-${channel.id}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "chat_messages",
        filter: `channel_id=eq.${channel.id}`,
      }, () => {
        queryClient.invalidateQueries({ queryKey: ["chat-messages", channel.id] });
      })
      .subscribe();

    return () => { supabase.removeChannel(sub); };
  }, [channel.id, queryClient]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = message.trim();
    if (!text || sending) return;
    setSending(true);
    setMessage("");
    try {
      await (supabase as any).from("chat_messages").insert({
        channel_id: channel.id,
        sender_profile_id: profileId,
        content: text,
        message_type: "text",
      });
    } catch (err) {
      setMessage(text);
    }
    setSending(false);
  }, [message, sending, channel.id, profileId]);

  return (
    <div className="flex flex-col h-[calc(100vh-160px)]">
      {/* Channel header */}
      <div className="flex items-center gap-3 pb-3 mb-3" style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
        <button onClick={onBack} className="w-8 h-8 rounded-lg flex items-center justify-center active:scale-90"
          style={{ background: "rgba(0,0,0,0.04)" }}>
          <ChevronLeft className="w-4 h-4" style={{ color: TEXT_PRIMARY }} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate" style={{ fontFamily: "'Space Grotesk', sans-serif", color: TEXT_PRIMARY }}>
            # {channel.name}
          </p>
          {channel.description && (
            <p className="text-[10px] truncate" style={{ color: TEXT_MUTED }}>{channel.description}</p>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-3">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: TEXT_MUTED }} />
          </div>
        ) : messages && messages.length > 0 ? (
          messages.map(msg => (
            <MessageBubble key={msg.id} msg={msg} isOwn={msg.sender_profile_id === profileId} />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <p className="text-xs" style={{ color: TEXT_MUTED }}>No messages yet — be the first! 🎉</p>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="pt-3 mt-2" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
        <div className="flex items-center gap-2">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Type a message..."
            className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none"
            style={{ background: "rgba(255,255,255,0.8)", border: "1.5px solid rgba(0,0,0,0.08)", color: TEXT_PRIMARY }}
          />
          <button
            onClick={handleSend}
            disabled={!message.trim() || sending}
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all active:scale-90 disabled:opacity-30"
            style={{ background: BLUE }}
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin text-white" />
            ) : (
              <Send className="w-4 h-4 text-white" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ChatTab() {
  const { user } = useAuth();
  const [selectedChannel, setSelectedChannel] = useState<ChatChannel | null>(null);

  const { data: profile } = useQuery({
    queryKey: ["my-profile-id"],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("player_profiles")
        .select("id")
        .eq("auth_user_id", user!.id)
        .single();
      return data;
    },
  });

  const { data: channels, isLoading } = useQuery({
    queryKey: ["chat-channels"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("chat_channels")
        .select("*")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data || []) as ChatChannel[];
    },
  });

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: `${BLUE}10` }}>
          <Hash className="w-7 h-7" style={{ color: BLUE }} />
        </div>
        <p className="text-sm font-semibold" style={{ color: TEXT_PRIMARY }}>Sign in to chat</p>
        <a href="/auth?redirect=/community" className="px-6 py-2.5 rounded-xl text-sm font-bold text-white" style={{ background: BLUE }}>
          Sign in
        </a>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: TEXT_MUTED }} />
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      {selectedChannel && profile ? (
        <motion.div key="room" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
          <ChatRoom channel={selectedChannel} onBack={() => setSelectedChannel(null)} profileId={profile.id} />
        </motion.div>
      ) : (
        <motion.div key="list" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
          <ChannelList channels={channels || []} onSelect={setSelectedChannel} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
