import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Loader2, Hash, Users, ChevronLeft, Zap } from "lucide-react";

const FONT_GROTESK = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";
const BLUE = "#0066FF";

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

/* ── Channel List ── */
function ChannelList({ channels, onSelect }: { channels: ChatChannel[]; onSelect: (c: ChatChannel) => void }) {
  const venueChannels = channels.filter(c => c.channel_type === "venue");
  const crewChannels = channels.filter(c => c.channel_type === "crew");
  const sportChannels = channels.filter(c => c.channel_type === "sport");

  const ICONS: Record<string, typeof Hash> = { venue: Hash, sport: Zap, crew: Users };

  const renderGroup = (title: string, items: ChatChannel[], type: string) => {
    if (items.length === 0) return null;
    const Icon = ICONS[type] || Hash;
    return (
      <div className="mb-5">
        <p className="text-[10px] font-bold uppercase tracking-widest mb-2 text-neutral-400" style={{ fontFamily: FONT_MONO }}>
          {title}
        </p>
        <div className="flex flex-col gap-1">
          {items.map(ch => (
            <button
              key={ch.id}
              onClick={() => onSelect(ch)}
              className="flex items-center gap-3 rounded-xl px-3 py-3 text-left transition-all active:scale-[0.98] bg-neutral-50 border border-neutral-100 hover:border-neutral-200"
            >
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-neutral-100">
                <Icon className="w-3.5 h-3.5 text-neutral-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-neutral-900 truncate" style={{ fontFamily: FONT_GROTESK }}>
                  #{ch.name}
                </p>
                {ch.description && (
                  <p className="text-[11px] text-neutral-400 truncate">{ch.description}</p>
                )}
              </div>
              {ch.sport_type && (
                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase shrink-0 bg-neutral-100 text-neutral-500">
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
      {renderGroup("Channels", venueChannels, "venue")}
      {renderGroup("Sport", sportChannels, "sport")}
      {renderGroup("Crews", crewChannels, "crew")}
      {channels.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="w-12 h-12 rounded-full flex items-center justify-center bg-neutral-100">
            <Hash className="w-6 h-6 text-neutral-400" />
          </div>
          <p className="text-sm font-semibold text-neutral-900">No channels yet</p>
          <p className="text-xs text-center max-w-[200px] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
            Channels will appear here when created.
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Message Bubble ── */
function MessageBubble({ msg, isOwn }: { msg: ChatMessage; isOwn: boolean }) {
  const name = msg.player_profiles?.display_name || "Player";
  const avatar = msg.player_profiles?.avatar_url;

  return (
    <div className={`flex gap-2 ${isOwn ? "flex-row-reverse" : ""}`}>
      {!isOwn && (
        avatar ? (
          <img src={avatar} alt={name} className="w-7 h-7 rounded-full object-cover shrink-0 mt-1" />
        ) : (
          <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-1 bg-neutral-100">
            <span className="text-[10px] font-bold text-neutral-500">
              {name.charAt(0).toUpperCase()}
            </span>
          </div>
        )
      )}
      <div className={`max-w-[75%] ${isOwn ? "items-end" : "items-start"} flex flex-col`}>
        {!isOwn && (
          <span className="text-[10px] font-semibold mb-0.5 px-1 text-neutral-400">{name}</span>
        )}
        <div
          className="rounded-2xl px-3.5 py-2"
          style={{
            background: isOwn ? BLUE : "#f5f5f5",
            borderTopRightRadius: isOwn ? 6 : 16,
            borderTopLeftRadius: isOwn ? 16 : 6,
          }}
        >
          <p className={`text-[13px] leading-relaxed ${isOwn ? "text-white" : "text-neutral-900"}`}>
            {msg.content}
          </p>
        </div>
        <span className="text-[9px] mt-0.5 px-1 text-neutral-300" style={{ fontFamily: FONT_MONO }}>
          {timeAgo(msg.created_at)}
        </span>
      </div>
    </div>
  );
}

/* ── Chat Room ── */
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
    } catch {
      setMessage(text);
    }
    setSending(false);
  }, [message, sending, channel.id, profileId]);

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 140px)" }}>
      {/* Channel header */}
      <div className="flex items-center gap-3 pb-3 mb-3 border-b border-neutral-100">
        <button
          onClick={onBack}
          className="w-8 h-8 rounded-lg flex items-center justify-center active:scale-90 bg-neutral-50"
        >
          <ChevronLeft className="w-4 h-4 text-neutral-600" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-neutral-900 truncate" style={{ fontFamily: FONT_GROTESK }}>
            #{channel.name}
          </p>
          {channel.description && (
            <p className="text-[10px] text-neutral-400 truncate">{channel.description}</p>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-3">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-neutral-300" />
          </div>
        ) : messages && messages.length > 0 ? (
          messages.map(msg => (
            <MessageBubble key={msg.id} msg={msg} isOwn={msg.sender_profile_id === profileId} />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <p className="text-xs text-neutral-400" style={{ fontFamily: FONT_MONO }}>
              No messages yet — be the first! 🎉
            </p>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="pt-3 mt-2 border-t border-neutral-100">
        <div className="flex items-center gap-2">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Type a message..."
            className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none bg-neutral-50 border border-neutral-200 text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-300"
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

/* ── Main Tab ── */
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
        <div className="w-12 h-12 rounded-full flex items-center justify-center bg-neutral-100">
          <MessageCircle className="w-6 h-6 text-neutral-400" />
        </div>
        <p className="text-sm font-semibold text-neutral-900">Sign in to chat</p>
        <a
          href="/auth?redirect=/community"
          className="px-6 py-2.5 rounded-xl text-sm font-bold text-white"
          style={{ background: BLUE }}
        >
          Sign in
        </a>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-neutral-300" />
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
