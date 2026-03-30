import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2, ArrowBigUp, ArrowBigDown, MessageCircle, Plus, Pin, Send, X,
  ChevronLeft, Users, CalendarDays, MapPin, Clock, Image as ImageIcon, BarChart3, ExternalLink, Paperclip, Search, Smile,
  Pencil, MoreHorizontal, Check, Trash2
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

const FONT_GROTESK = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";
const BLUE = "#0066FF";

const TAGS = [
  { key: "all", label: "All" },
  { key: "general", label: "General" },
  { key: "question", label: "Question" },
  { key: "equipment", label: "Equipment" },
  { key: "lfg", label: "LFG" },
  { key: "events", label: "Events" },
  { key: "tips", label: "Tips" },
  { key: "poll", label: "Poll" },
];

const SPORT_FILTERS = [
  { key: "all", label: "All Sports", emoji: "🏟️" },
  { key: "pickleball", label: "Pickleball", emoji: "🏓" },
  { key: "dart", label: "Dart", emoji: "🎯" },
];

const TAG_COLORS: Record<string, string> = {
  question: "#3B82F6",
  equipment: "#F59E0B",
  lfg: "#22C55E",
  events: "#8B5CF6",
  tips: "#EC4899",
  general: "#6B7280",
  poll: "#F97316",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

/* ── Link Preview Component ── */
function LinkPreview({ url }: { url: string }) {
  const { data: preview, isLoading } = useQuery({
    queryKey: ["link-preview", url],
    staleTime: 300000, // 5 min cache
    queryFn: async () => {
      try {
        const res = await supabase.functions.invoke("api-link-preview", {
          body: { url },
        });
        if (res.error) return null;
        return res.data as { title?: string; description?: string; image?: string; site_name?: string } | null;
      } catch {
        return null;
      }
    },
  });

  if (isLoading) {
    return (
      <div className="mt-2 rounded-xl border border-neutral-100 p-3 animate-pulse bg-neutral-50">
        <div className="h-3 w-2/3 bg-neutral-200 rounded mb-2" />
        <div className="h-2 w-full bg-neutral-100 rounded" />
      </div>
    );
  }

  if (!preview || (!preview.title && !preview.description && !preview.image)) {
    return null;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 block rounded-xl border border-neutral-100 overflow-hidden hover:border-neutral-200 transition-colors"
      onClick={(e) => e.stopPropagation()}
    >
      {preview.image && (
        <img
          src={preview.image}
          alt={preview.title || ""}
          className="w-full h-32 object-cover"
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      )}
      <div className="p-3">
        {preview.site_name && (
          <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">{preview.site_name}</span>
        )}
        {preview.title && (
          <p className="text-[13px] font-semibold text-neutral-800 leading-snug line-clamp-2">{preview.title}</p>
        )}
        {preview.description && (
          <p className="text-[11px] text-neutral-500 line-clamp-2 mt-0.5">{preview.description}</p>
        )}
      </div>
    </a>
  );
}

/* ── Rich Body Renderer (links + images + link previews) ── */
function RichBody({ text, clamp = false }: { text: string; clamp?: boolean }) {
  const urlRegex = /(https?:\/\/[^\s<]+)/g;
  const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg)(\?[^\s]*)?$/i;
  const gifExtension = /\.gif(\?[^\s]*)?$/i;

  const parts = text.split(urlRegex);
  const urls: string[] = [];
  const mediaUrls: string[] = [];

  const textParts = parts.map((part, i) => {
    if (urlRegex.test(part)) {
      urlRegex.lastIndex = 0;
      if (imageExtensions.test(part)) {
        mediaUrls.push(part);
        // Don't render inline in text — we'll show as media block below
        return null;
      }
      // Non-image URL — collect for preview
      urls.push(part);
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-blue-500 hover:underline break-all"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="w-3 h-3 shrink-0" />
          {(() => { try { return new URL(part).hostname; } catch { return part; } })()}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });

  // Filter out null entries (media URLs removed from text flow)
  const filteredTextParts = textParts.filter(Boolean);

  return (
    <div>
      {/* Text content */}
      {filteredTextParts.length > 0 && (
        <p className={`text-[13px] text-neutral-500 leading-relaxed whitespace-pre-wrap ${clamp ? "line-clamp-2" : ""}`}>
          {filteredTextParts}
        </p>
      )}
      {/* Media — full-width like Reddit */}
      {mediaUrls.length > 0 && (
        <div className="mt-2 space-y-2">
          {(clamp ? mediaUrls.slice(0, 1) : mediaUrls).map((src, i) => (
            <div key={`media-${i}`} className="relative rounded-2xl overflow-hidden border border-neutral-100 bg-neutral-50">
              <img
                src={src}
                alt={gifExtension.test(src) ? "GIF" : "Shared image"}
                className="w-full max-h-80 object-cover"
                loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
              {gifExtension.test(src) && (
                <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[9px] font-black tracking-wide bg-black/60 text-white">
                  GIF
                </span>
              )}
            </div>
          ))}
          {clamp && mediaUrls.length > 1 && (
            <p className="text-[11px] text-neutral-400 font-semibold" style={{ fontFamily: FONT_MONO }}>
              +{mediaUrls.length - 1} more image{mediaUrls.length > 2 ? "s" : ""}
            </p>
          )}
        </div>
      )}
      {/* Link previews — show max 1 in card, max 2 in detail */}
      {urls.slice(0, clamp ? 1 : 2).map((u, i) => <LinkPreview key={`lp-${i}`} url={u} />)}
    </div>
  );
}

/* ── Vote Button ── */
function VoteButton({ postId, currentCount, userVote }: { postId: string; currentCount: number; userVote: number }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [optimisticCount, setOptimisticCount] = useState(currentCount);
  const [optimisticVote, setOptimisticVote] = useState(userVote);
  const [voting, setVoting] = useState(false);

  const handleVote = async (value: number) => {
    if (!user || voting) return;
    setVoting(true);
    const newValue = optimisticVote === value ? 0 : value;
    const diff = newValue - optimisticVote;
    setOptimisticVote(newValue);
    setOptimisticCount(c => c + diff);

    try {
      if (newValue === 0) {
        await (supabase as any).from("post_votes").delete().eq("post_id", postId).eq("auth_user_id", user.id);
      } else if (optimisticVote === 0) {
        await (supabase as any).from("post_votes").insert({ post_id: postId, auth_user_id: user.id, vote_value: newValue });
      } else {
        await (supabase as any).from("post_votes").update({ vote_value: newValue }).eq("post_id", postId).eq("auth_user_id", user.id);
      }
    } catch {
      setOptimisticVote(userVote);
      setOptimisticCount(currentCount);
    }
    setVoting(false);
  };

  return (
    <div className="flex items-center gap-0.5 rounded-full bg-neutral-100 px-1">
      <button onClick={() => handleVote(1)} disabled={!user}
        className="p-1 rounded-full transition-colors active:scale-90"
        style={{ color: optimisticVote === 1 ? BLUE : "#9CA3AF" }}>
        <ArrowBigUp className="w-5 h-5" fill={optimisticVote === 1 ? BLUE : "none"} />
      </button>
      <span className="text-xs font-bold min-w-[20px] text-center" style={{ fontFamily: FONT_MONO, color: optimisticCount > 0 ? BLUE : optimisticCount < 0 ? "#EF4444" : "#9CA3AF" }}>
        {optimisticCount}
      </span>
      <button onClick={() => handleVote(-1)} disabled={!user}
        className="p-1 rounded-full transition-colors active:scale-90"
        style={{ color: optimisticVote === -1 ? "#EF4444" : "#9CA3AF" }}>
        <ArrowBigDown className="w-5 h-5" fill={optimisticVote === -1 ? "#EF4444" : "none"} />
      </button>
    </div>
  );
}

/* ── LFG Signup Button ── */
function LfgSignupButton({ postId }: { postId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data: signups } = useQuery({
    queryKey: ["post-signups", postId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("forum_post_signups")
        .select("*, player_profiles(display_name)")
        .eq("post_id", postId);
      return data || [];
    },
  });

  const { data: profile } = useQuery({
    queryKey: ["my-profile-id"],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("player_profiles").select("id").eq("auth_user_id", user!.id).single();
      return data;
    },
  });

  const isSignedUp = profile && signups?.some((s: any) => s.player_profile_id === profile.id);
  const count = signups?.length || 0;

  const toggle = async () => {
    if (!user || !profile || busy) return;
    setBusy(true);
    try {
      if (isSignedUp) {
        await (supabase as any).from("forum_post_signups").delete().eq("post_id", postId).eq("player_profile_id", profile.id);
      } else {
        await (supabase as any).from("forum_post_signups").insert({ post_id: postId, player_profile_id: profile.id });
        toast.success("You're in! 🎾");
      }
      qc.invalidateQueries({ queryKey: ["post-signups", postId] });
    } catch {
      toast.error("Could not update signup");
    }
    setBusy(false);
  };

  return (
    <div className="mt-3 rounded-xl p-3" style={{ background: "#22C55E10", border: "1.5px solid #22C55E30" }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4" style={{ color: "#22C55E" }} />
          <span className="text-xs font-bold" style={{ color: "#22C55E", fontFamily: FONT_MONO }}>
            {count} joined
          </span>
          {signups && signups.length > 0 && (
            <span className="text-[10px] text-neutral-400 truncate max-w-[140px]">
              {signups.map((s: any) => s.player_profiles?.display_name || "?").join(", ")}
            </span>
          )}
        </div>
        {user ? (
          <button
            onClick={toggle}
            disabled={busy}
            className="px-4 py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-95"
            style={{
              background: isSignedUp ? "#EF444415" : "#22C55E",
              color: isSignedUp ? "#EF4444" : "#fff",
              fontFamily: FONT_MONO,
            }}
          >
            {busy ? "..." : isSignedUp ? "Leave" : "Join"}
          </button>
        ) : (
          <a href="/auth?redirect=/community" className="text-[11px] font-bold" style={{ color: BLUE }}>
            Sign in
          </a>
        )}
      </div>
    </div>
  );
}

/* ── Poll Component ── */
function PollView({ postId, compact = false }: { postId: string; compact?: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [voting, setVoting] = useState(false);

  const { data: options } = useQuery({
    queryKey: ["poll-options", postId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("forum_poll_options")
        .select("*")
        .eq("post_id", postId)
        .order("sort_order", { ascending: true });
      return data || [];
    },
  });

  const { data: votes } = useQuery({
    queryKey: ["poll-votes", postId],
    queryFn: async () => {
      if (!options?.length) return [];
      const optionIds = options.map((o: any) => o.id);
      const { data } = await (supabase as any)
        .from("forum_poll_votes")
        .select("*")
        .in("option_id", optionIds);
      return data || [];
    },
    enabled: !!options?.length,
  });

  if (!options?.length) return null;

  const totalVotes = votes?.length || 0;
  const voteCounts: Record<string, number> = {};
  (votes || []).forEach((v: any) => {
    voteCounts[v.option_id] = (voteCounts[v.option_id] || 0) + 1;
  });
  const userVote = votes?.find((v: any) => v.auth_user_id === user?.id);
  const hasVoted = !!userVote;

  const handleVote = async (optionId: string) => {
    if (!user || voting) return;
    setVoting(true);
    try {
      if (userVote) {
        await (supabase as any).from("forum_poll_votes").delete().eq("id", userVote.id);
      }
      if (!userVote || userVote.option_id !== optionId) {
        await (supabase as any).from("forum_poll_votes").insert({ option_id: optionId, auth_user_id: user.id });
      }
      qc.invalidateQueries({ queryKey: ["poll-votes", postId] });
    } catch {
      toast.error("Could not vote");
    }
    setVoting(false);
  };

  if (compact) {
    return (
      <div className="mt-2 flex items-center gap-2">
        <BarChart3 className="w-3.5 h-3.5" style={{ color: "#F97316" }} />
        <span className="text-[11px] font-semibold" style={{ color: "#F97316", fontFamily: FONT_MONO }}>
          {options.length} options · {totalVotes} votes
        </span>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      {options.map((opt: any) => {
        const count = voteCounts[opt.id] || 0;
        const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
        const isSelected = userVote?.option_id === opt.id;

        return (
          <button
            key={opt.id}
            onClick={() => handleVote(opt.id)}
            disabled={!user || voting}
            className="w-full relative rounded-xl overflow-hidden text-left transition-all active:scale-[0.98]"
            style={{
              border: isSelected ? "1.5px solid #F9731660" : "1.5px solid #e5e5e5",
              padding: "10px 14px",
            }}
          >
            {hasVoted && (
              <div
                className="absolute inset-y-0 left-0 rounded-xl transition-all"
                style={{ width: `${pct}%`, background: isSelected ? "#F9731618" : "#f5f5f5" }}
              />
            )}
            <div className="relative flex items-center justify-between">
              <span className="text-[13px] font-semibold" style={{ color: isSelected ? "#F97316" : "#374151" }}>
                {opt.label}
              </span>
              {hasVoted && (
                <span className="text-[11px] font-bold" style={{ color: "#9CA3AF", fontFamily: FONT_MONO }}>
                  {pct}%
                </span>
              )}
            </div>
          </button>
        );
      })}
      <p className="text-[10px] text-neutral-400 text-center" style={{ fontFamily: FONT_MONO }}>
        {totalVotes} vote{totalVotes !== 1 ? "s" : ""} · {hasVoted ? "tap to change" : "tap to vote"}
      </p>
    </div>
  );
}

/* ── Image Upload Helper ── */
function useImageUpload() {
  const { user } = useAuth();
  const [uploading, setUploading] = useState(false);

  const upload = useCallback(async (file: File): Promise<string | null> => {
    if (!user) return null;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("forum-images").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
      });
      if (error) throw error;
      const { data: urlData } = supabase.storage.from("forum-images").getPublicUrl(path);
      return urlData.publicUrl;
    } catch (err: any) {
      toast.error("Upload failed: " + (err.message || "Unknown error"));
      return null;
    } finally {
      setUploading(false);
    }
  }, [user]);

  return { upload, uploading };
}

/* ── GIF Search (Tenor via public proxy) ── */
function GifPicker({ onSelect, onClose }: { onSelect: (url: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const searchGifs = async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    try {
      // Use Tenor's public v2 API with the public test key
      const res = await fetch(
        `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}&key=AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ&client_key=pickla_community&limit=12&media_filter=gif`
      );
      const data = await res.json();
      const urls = (data.results || []).map((r: any) => {
        // Get the smallest GIF format
        const media = r.media_formats;
        return media?.tinygif?.url || media?.gif?.url || media?.mediumgif?.url || "";
      }).filter(Boolean);
      setResults(urls);
    } catch {
      setResults([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    const t = setTimeout(() => searchGifs(query), 400);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3 shadow-lg">
      <div className="flex items-center gap-2 mb-2">
        <Search className="w-4 h-4 text-neutral-400" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search GIFs..."
          className="flex-1 text-sm outline-none bg-transparent text-neutral-900 placeholder:text-neutral-400"
          style={{ fontSize: "16px" }}
        />
        <button onClick={onClose} className="p-1 rounded-lg bg-neutral-100 active:scale-90">
          <X className="w-3.5 h-3.5 text-neutral-500" />
        </button>
      </div>
      {loading && <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-neutral-300" /></div>}
      {!loading && results.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5 max-h-48 overflow-y-auto">
          {results.map((url, i) => (
            <button
              key={i}
              onClick={() => onSelect(url)}
              className="rounded-lg overflow-hidden active:scale-95 transition-transform"
            >
              <img src={url} alt="GIF" className="w-full h-20 object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {!loading && query && results.length === 0 && (
        <p className="text-[11px] text-neutral-400 text-center py-3" style={{ fontFamily: FONT_MONO }}>No GIFs found</p>
      )}
      {!query && (
        <p className="text-[11px] text-neutral-400 text-center py-3" style={{ fontFamily: FONT_MONO }}>
          Type to search for GIFs ✨
        </p>
      )}
    </div>
  );
}

/* ── Inline Event Card ── */
function EventCard({ event, onOpen }: { event: any; onOpen: () => void }) {
  const navigate = useNavigate();

  // Fetch comment count for linked event post
  const { data: eventCommentCount } = useQuery({
    queryKey: ["event-comment-count", event.id],
    staleTime: 30000,
    queryFn: async () => {
      const eventName = event.display_name || event.name;
      const { data } = await (supabase as any)
        .from("forum_posts")
        .select("comment_count")
        .eq("tag", "events")
        .ilike("title", `%${eventName.substring(0, 30)}%`)
        .limit(1);
      return data?.[0]?.comment_count || 0;
    },
  });

  const startDate = event.start_date ? new Date(event.start_date) : null;
  const eventUrl = event.slug ? `/e/${event.slug}` : `/e/${event.id}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-neutral-100 p-4 cursor-pointer active:bg-neutral-50 transition-colors"
      style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
      onClick={onOpen}
    >
      <div className="flex items-center gap-2 mb-2">
        <CalendarDays className="w-4 h-4" style={{ color: "#8B5CF6" }} />
        <span
          className="inline-block px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide"
          style={{ background: "#8B5CF615", color: "#8B5CF6" }}
        >
          Event
        </span>
        {startDate && (
          <span className="text-[10px] text-neutral-400 ml-auto" style={{ fontFamily: FONT_MONO }}>
            {startDate.toLocaleDateString("sv-SE", { day: "numeric", month: "short" })}
          </span>
        )}
      </div>
      <h3 className="text-[15px] font-bold text-neutral-900 leading-snug mb-1" style={{ fontFamily: FONT_GROTESK }}>
        {event.display_name || event.name}
      </h3>
      {event.description && (
        <p className="text-[13px] text-neutral-500 line-clamp-2 leading-relaxed mb-2">{event.description}</p>
      )}
      <div className="flex items-center gap-3 text-[11px] text-neutral-400">
        {event.venues?.name && (
          <span className="flex items-center gap-1">
            <MapPin className="w-3 h-3" /> {event.venues.name}
          </span>
        )}
        {event.start_time && (
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" /> {String(event.start_time).substring(0, 5)}
          </span>
        )}
      </div>
      <div className="flex gap-2 mt-3">
        <button
          onClick={(e) => { e.stopPropagation(); navigate(eventUrl); }}
          className="flex-1 text-center py-2 rounded-xl text-[11px] font-bold transition-all active:scale-95"
          style={{ background: `${BLUE}10`, color: BLUE, fontFamily: FONT_MONO }}
        >
          View & Sign up →
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          className="px-3 py-2 rounded-xl text-[11px] font-bold transition-all active:scale-95 flex items-center gap-1"
          style={{ background: "#f5f5f5", color: "#9CA3AF" }}
        >
          <MessageCircle className="w-3.5 h-3.5" />
          {(eventCommentCount || 0) > 0 ? eventCommentCount : "Discuss"}
        </button>
      </div>
    </motion.div>
  );
}

/* ── Event Detail / Discussion View ── */
function EventDetail({ event, onBack }: { event: any; onBack: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const startDate = event.start_date ? new Date(event.start_date) : null;
  const eventUrl = event.slug ? `/e/${event.slug}` : `/e/${event.id}`;
  const { upload, uploading } = useImageUpload();
  const [showGifPicker, setShowGifPicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: profile } = useQuery({
    queryKey: ["my-profile-id"],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("player_profiles").select("id").eq("auth_user_id", user!.id).single();
      return data;
    },
  });

  // Find or create a forum post linked to this event
  const { data: eventPost } = useQuery({
    queryKey: ["event-post", event.id],
    queryFn: async () => {
      const { data: existing } = await (supabase as any)
        .from("forum_posts")
        .select("*")
        .eq("tag", "events")
        .ilike("title", `%${(event.display_name || event.name).substring(0, 30)}%`)
        .limit(1);
      if (existing && existing.length > 0) return existing[0];
      return null;
    },
  });

  const { data: comments, isLoading: commentsLoading } = useQuery({
    queryKey: ["post-comments", eventPost?.id],
    enabled: !!eventPost,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("post_comments")
        .select("*, player_profiles(display_name, avatar_url)")
        .eq("post_id", eventPost.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  const handleCreateEventPost = async () => {
    if (!user || !profile) return null;
    try {
      const { data: newPost } = await (supabase as any).from("forum_posts").insert({
        author_profile_id: profile.id,
        title: `📅 ${event.display_name || event.name}`,
        body: event.description || "Event discussion thread",
        tag: "events",
      }).select().single();
      qc.invalidateQueries({ queryKey: ["event-post", event.id] });
      qc.invalidateQueries({ queryKey: ["forum-posts"] });
      return newPost;
    } catch {
      return null;
    }
  };

  const handleSendComment = async (text?: string) => {
    const commentText = (text || comment).trim();
    if (!commentText || !user || !profile || sending) return;
    setSending(true);
    if (!text) setComment("");

    let postId = eventPost?.id;
    if (!postId) {
      const created = await handleCreateEventPost();
      postId = created?.id;
    }
    if (!postId) {
      toast.error("Could not create discussion");
      setSending(false);
      return;
    }

    try {
      await (supabase as any).from("post_comments").insert({
        post_id: postId,
        author_profile_id: profile.id,
        body: commentText,
      });
      qc.invalidateQueries({ queryKey: ["post-comments", postId] });
      qc.invalidateQueries({ queryKey: ["forum-posts"] });
      qc.invalidateQueries({ queryKey: ["event-comment-count", event.id] });
    } catch {
      if (!text) setComment(commentText);
      toast.error("Could not post comment");
    }
    setSending(false);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await upload(file);
    if (url) {
      await handleSendComment(url);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleGifSelect = async (gifUrl: string) => {
    setShowGifPicker(false);
    await handleSendComment(gifUrl);
  };

  return (
    <div className="flex flex-col" style={{ minHeight: "calc(100vh - 200px)" }}>
      {/* Header */}
      <div className="flex items-center gap-3 pb-3 mb-3 border-b border-neutral-100">
        <button onClick={onBack} className="w-8 h-8 rounded-lg flex items-center justify-center active:scale-90 bg-neutral-50">
          <ChevronLeft className="w-4 h-4 text-neutral-600" />
        </button>
        <span className="text-sm font-semibold text-neutral-500" style={{ fontFamily: FONT_GROTESK }}>Event Discussion</span>
      </div>

      {/* Event info */}
      <div className="mb-4 rounded-2xl p-4" style={{ background: "#8B5CF608", border: "1.5px solid #8B5CF620" }}>
        <div className="flex items-center gap-2 mb-2">
          <CalendarDays className="w-4 h-4" style={{ color: "#8B5CF6" }} />
          <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "#8B5CF6" }}>Event</span>
        </div>
        <h2 className="text-lg font-bold text-neutral-900 mb-1" style={{ fontFamily: FONT_GROTESK }}>
          {event.display_name || event.name}
        </h2>
        {event.description && (
          <p className="text-[13px] text-neutral-500 leading-relaxed mb-2">{event.description}</p>
        )}
        <div className="flex items-center gap-3 text-[11px] text-neutral-400">
          {event.venues?.name && (
            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {event.venues.name}</span>
          )}
          {startDate && (
            <span>{startDate.toLocaleDateString("sv-SE", { day: "numeric", month: "short" })}</span>
          )}
          {event.start_time && (
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {String(event.start_time).substring(0, 5)}</span>
          )}
        </div>
        <button
          onClick={() => navigate(eventUrl)}
          className="mt-3 w-full text-center py-2.5 rounded-xl text-[11px] font-bold transition-all active:scale-95"
          style={{ background: BLUE, color: "#fff", fontFamily: FONT_MONO }}
        >
          View Event & Sign Up →
        </button>
      </div>

      {/* Vote on event post */}
      {eventPost && (
        <div className="flex items-center gap-3 mb-4">
          <VoteButton postId={eventPost.id} currentCount={eventPost.upvote_count || 0} userVote={0} />
          <span className="text-xs text-neutral-400" style={{ fontFamily: FONT_MONO }}>
            {comments?.length || 0} comments
          </span>
        </div>
      )}

      {/* Comments */}
      <div className="flex-1">
        <p className="text-xs font-bold uppercase tracking-widest text-neutral-400 mb-3" style={{ fontFamily: FONT_MONO }}>
          Discussion
        </p>
        {eventPost && commentsLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-neutral-300" /></div>
        ) : comments && comments.length > 0 ? (
          <div className="space-y-3">
            {comments.map((c: any) => (
              <div key={c.id} className="flex gap-2">
                <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-neutral-100 mt-0.5">
                  <span className="text-[9px] font-bold text-neutral-500">
                    {(c.player_profiles?.display_name || "?").charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-neutral-700">
                      {c.player_profiles?.display_name || "Anonymous"}
                    </span>
                    <span className="text-[10px] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
                      {timeAgo(c.created_at)}
                    </span>
                  </div>
                  <RichBody text={c.body} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-neutral-400 text-center py-6" style={{ fontFamily: FONT_MONO }}>
            No comments yet — start the discussion!
          </p>
        )}
      </div>

      {/* GIF Picker */}
      {showGifPicker && (
        <div className="mb-2">
          <GifPicker onSelect={handleGifSelect} onClose={() => setShowGifPicker(false)} />
        </div>
      )}

      {/* Comment input */}
      {user ? (
        <div className="pt-3 mt-3 border-t border-neutral-100">
          <input type="file" ref={fileInputRef} accept="image/*" className="hidden" onChange={handleImageUpload} />
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-neutral-50 active:scale-90 transition-transform"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin text-neutral-400" /> : <Paperclip className="w-4 h-4 text-neutral-400" />}
            </button>
            <button
              onClick={() => setShowGifPicker(!showGifPicker)}
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-neutral-50 active:scale-90 transition-transform"
            >
              <span className="text-sm">GIF</span>
            </button>
            <input
              ref={inputRef}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendComment(); } }}
              placeholder="Add a comment..."
              className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none bg-neutral-50 border border-neutral-200 text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-300"
              style={{ fontSize: "16px" }}
            />
            <button
              onClick={() => handleSendComment()}
              disabled={!comment.trim() || sending}
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all active:scale-90 disabled:opacity-30"
              style={{ background: BLUE }}
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : <Send className="w-4 h-4 text-white" />}
            </button>
          </div>
        </div>
      ) : (
        <div className="pt-3 mt-3 border-t border-neutral-100 text-center">
          <a href="/auth?redirect=/community" className="text-xs font-semibold" style={{ color: BLUE }}>
            Sign in to comment
          </a>
        </div>
      )}
    </div>
  );
}

/* ── Post Card ── */
function PostCard({ post, onOpen }: { post: any; onOpen: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const tagColor = TAG_COLORS[post.tag] || "#6B7280";
  const isLfg = post.tag === "lfg";
  const isPoll = post.tag === "poll";
  const [showMenu, setShowMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ["my-profile-id"],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("player_profiles").select("id").eq("auth_user_id", user!.id).single();
      return data;
    },
  });

  const isAuthor = profile && post.author_profile_id === profile.id;

  const handleDelete = async () => {
    if (!confirm("Delete this post?")) return;
    setDeleting(true);
    try {
      await (supabase as any).from("forum_posts").delete().eq("id", post.id);
      qc.invalidateQueries({ queryKey: ["forum-posts"] });
      toast.success("Post deleted");
    } catch {
      toast.error("Could not delete post");
    }
    setDeleting(false);
    setShowMenu(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-neutral-100 p-4 active:bg-neutral-50 transition-colors"
      style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-neutral-100">
          <span className="text-[9px] font-bold text-neutral-500">
            {(post.player_profiles?.display_name || "?").charAt(0).toUpperCase()}
          </span>
        </div>
        <span className="text-[11px] font-semibold text-neutral-600">
          {post.player_profiles?.display_name || "Anonymous"}
        </span>
        <span className="text-[10px] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
          {timeAgo(post.created_at)}
        </span>
        {post.sport_type && post.sport_type !== "pickleball" && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-neutral-100 text-neutral-500 font-semibold">
            {SPORT_FILTERS.find(s => s.key === post.sport_type)?.emoji || "🏟️"} {post.sport_type}
          </span>
        )}
        {post.is_pinned && <Pin className="w-3 h-3 text-amber-500 ml-auto" />}
        {isAuthor && !post.is_pinned && (
          <div className="ml-auto relative">
            <button
              onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
              className="w-7 h-7 rounded-lg flex items-center justify-center bg-neutral-50 active:scale-90 transition-transform"
            >
              <MoreHorizontal className="w-4 h-4 text-neutral-400" />
            </button>
            {showMenu && (
              <div className="absolute right-0 top-8 z-20 bg-white rounded-xl border border-neutral-100 shadow-lg py-1 min-w-[120px]">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowMenu(false); onOpen(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[12px] font-semibold text-neutral-700 hover:bg-neutral-50"
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(); }}
                  disabled={deleting}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[12px] font-semibold text-red-500 hover:bg-red-50"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tag */}
      <span
        className="inline-block px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide mb-1.5"
        style={{ background: `${tagColor}15`, color: tagColor }}
      >
        {post.tag}
      </span>

      {/* Title & body */}
      <button onClick={onOpen} className="text-left w-full">
        <h3 className="text-[15px] font-bold text-neutral-900 leading-snug mb-1" style={{ fontFamily: FONT_GROTESK }}>
          {post.title}
        </h3>
        {post.body && <RichBody text={post.body} clamp />}
      </button>

      {/* LFG signup inline */}
      {isLfg && <LfgSignupButton postId={post.id} />}

      {/* Poll compact preview */}
      {isPoll && <PollView postId={post.id} compact />}

      {/* Actions */}
      <div className="flex items-center gap-3 mt-3">
        <VoteButton postId={post.id} currentCount={post.upvote_count} userVote={post.user_vote || 0} />
        <button onClick={onOpen} className="flex items-center gap-1.5 text-neutral-400 hover:text-neutral-600 transition-colors">
          <MessageCircle className="w-4 h-4" />
          <span className="text-xs font-semibold" style={{ fontFamily: FONT_MONO }}>{post.comment_count || 0}</span>
        </button>
      </div>
    </motion.div>
  );
}

/* ── Post Detail / Thread View ── */
function PostDetail({ post, onBack }: { post: any; onBack: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const tagColor = TAG_COLORS[post.tag] || "#6B7280";
  const isLfg = post.tag === "lfg";
  const isPoll = post.tag === "poll";
  const { upload, uploading } = useImageUpload();
  const [showGifPicker, setShowGifPicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(post.title);
  const [editBody, setEditBody] = useState(post.body || "");
  const [saving, setSaving] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ["my-profile-id"],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("player_profiles").select("id").eq("auth_user_id", user!.id).single();
      return data;
    },
  });

  const isAuthor = profile && post.author_profile_id === profile.id;

  const handleSaveEdit = async () => {
    if (!editTitle.trim() || saving) return;
    setSaving(true);
    try {
      await (supabase as any).from("forum_posts").update({
        title: editTitle.trim(),
        body: editBody.trim(),
      }).eq("id", post.id);
      post.title = editTitle.trim();
      post.body = editBody.trim();
      qc.invalidateQueries({ queryKey: ["forum-posts"] });
      toast.success("Post updated!");
      setEditing(false);
    } catch {
      toast.error("Could not save changes");
    }
    setSaving(false);
  };

  const { data: comments, isLoading: commentsLoading } = useQuery({
    queryKey: ["post-comments", post.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("post_comments")
        .select("*, player_profiles(display_name, avatar_url)")
        .eq("post_id", post.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  const handleSendComment = async (text?: string) => {
    const commentText = (text || comment).trim();
    if (!commentText || !user || !profile || sending) return;
    setSending(true);
    if (!text) setComment("");
    try {
      await (supabase as any).from("post_comments").insert({
        post_id: post.id,
        author_profile_id: profile.id,
        body: commentText,
      });
      qc.invalidateQueries({ queryKey: ["post-comments", post.id] });
      qc.invalidateQueries({ queryKey: ["forum-posts"] });
    } catch {
      if (!text) setComment(commentText);
      toast.error("Could not post comment");
    }
    setSending(false);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await upload(file);
    if (url) await handleSendComment(url);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleGifSelect = async (gifUrl: string) => {
    setShowGifPicker(false);
    await handleSendComment(gifUrl);
  };

  return (
    <div className="flex flex-col" style={{ minHeight: "calc(100vh - 200px)" }}>
      {/* Header */}
      <div className="flex items-center gap-3 pb-3 mb-3 border-b border-neutral-100">
        <button onClick={onBack} className="w-8 h-8 rounded-lg flex items-center justify-center active:scale-90 bg-neutral-50">
          <ChevronLeft className="w-4 h-4 text-neutral-600" />
        </button>
        <span className="text-sm font-semibold text-neutral-500" style={{ fontFamily: FONT_GROTESK }}>Thread</span>
      </div>

      {/* Post */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-full flex items-center justify-center bg-neutral-100">
            <span className="text-xs font-bold text-neutral-500">
              {(post.player_profiles?.display_name || "?").charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <span className="text-sm font-semibold text-neutral-800">
              {post.player_profiles?.display_name || "Anonymous"}
            </span>
            <span className="text-[10px] text-neutral-400 ml-2" style={{ fontFamily: FONT_MONO }}>
              {timeAgo(post.created_at)}
            </span>
          </div>
        </div>
        <span className="inline-block px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide mb-2"
          style={{ background: `${tagColor}15`, color: tagColor }}>
          {post.tag}
        </span>
        <h2 className="text-lg font-bold text-neutral-900 mb-2" style={{ fontFamily: FONT_GROTESK }}>{post.title}</h2>
        {post.body && <RichBody text={post.body} />}

        {isLfg && <LfgSignupButton postId={post.id} />}
        {isPoll && <PollView postId={post.id} />}

        <div className="flex items-center gap-3 mt-3">
          <VoteButton postId={post.id} currentCount={post.upvote_count} userVote={post.user_vote || 0} />
          <span className="text-xs text-neutral-400" style={{ fontFamily: FONT_MONO }}>
            {post.comment_count} comments
          </span>
        </div>
      </div>

      {/* Comments */}
      <div className="flex-1">
        <p className="text-xs font-bold uppercase tracking-widest text-neutral-400 mb-3" style={{ fontFamily: FONT_MONO }}>
          Comments
        </p>
        {commentsLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-neutral-300" /></div>
        ) : comments && comments.length > 0 ? (
          <div className="space-y-3">
            {comments.map((c: any) => (
              <div key={c.id} className="flex gap-2">
                <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-neutral-100 mt-0.5">
                  <span className="text-[9px] font-bold text-neutral-500">
                    {(c.player_profiles?.display_name || "?").charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-neutral-700">
                      {c.player_profiles?.display_name || "Anonymous"}
                    </span>
                    <span className="text-[10px] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
                      {timeAgo(c.created_at)}
                    </span>
                  </div>
                  <RichBody text={c.body} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-neutral-400 text-center py-6" style={{ fontFamily: FONT_MONO }}>
            No comments yet — be the first!
          </p>
        )}
      </div>

      {/* GIF Picker */}
      {showGifPicker && (
        <div className="mb-2">
          <GifPicker onSelect={handleGifSelect} onClose={() => setShowGifPicker(false)} />
        </div>
      )}

      {/* Comment input */}
      {user ? (
        <div className="pt-3 mt-3 border-t border-neutral-100">
          <input type="file" ref={fileInputRef} accept="image/*" className="hidden" onChange={handleImageUpload} />
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-neutral-50 active:scale-90 transition-transform"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin text-neutral-400" /> : <Paperclip className="w-4 h-4 text-neutral-400" />}
            </button>
            <button
              onClick={() => setShowGifPicker(!showGifPicker)}
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-neutral-50 active:scale-90 transition-transform text-[11px] font-bold text-neutral-400"
            >
              GIF
            </button>
            <input
              ref={inputRef}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendComment(); } }}
              placeholder="Add a comment..."
              className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none bg-neutral-50 border border-neutral-200 text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-300"
              style={{ fontSize: "16px" }}
            />
            <button
              onClick={() => handleSendComment()}
              disabled={!comment.trim() || sending}
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all active:scale-90 disabled:opacity-30"
              style={{ background: BLUE }}
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : <Send className="w-4 h-4 text-white" />}
            </button>
          </div>
        </div>
      ) : (
        <div className="pt-3 mt-3 border-t border-neutral-100 text-center">
          <a href="/auth?redirect=/community" className="text-xs font-semibold" style={{ color: BLUE }}>
            Sign in to comment
          </a>
        </div>
      )}
    </div>
  );
}

/* ── Create Post Modal ── */
function CreatePostSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tag, setTag] = useState("general");
  const [posting, setPosting] = useState(false);
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const { upload, uploading } = useImageUpload();
  const [showGifPicker, setShowGifPicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: profile } = useQuery({
    queryKey: ["my-profile-id"],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("player_profiles").select("id").eq("auth_user_id", user!.id).single();
      return data;
    },
  });

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await upload(file);
    if (url) {
      setBody(prev => prev ? prev + "\n" + url : url);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleGifSelect = (gifUrl: string) => {
    setShowGifPicker(false);
    setBody(prev => prev ? prev + "\n" + gifUrl : gifUrl);
  };

  const handleSubmit = async () => {
    if (!title.trim() || !user || !profile || posting) return;
    if (tag === "poll" && pollOptions.filter(o => o.trim()).length < 2) {
      toast.error("Add at least 2 poll options");
      return;
    }
    setPosting(true);
    try {
      const { data: newPost } = await (supabase as any).from("forum_posts").insert({
        author_profile_id: profile.id,
        title: title.trim(),
        body: body.trim(),
        tag,
      }).select().single();

      if (tag === "poll" && newPost) {
        const validOptions = pollOptions.filter(o => o.trim());
        for (let i = 0; i < validOptions.length; i++) {
          await (supabase as any).from("forum_poll_options").insert({
            post_id: newPost.id,
            label: validOptions[i].trim(),
            sort_order: i,
          });
        }
      }

      qc.invalidateQueries({ queryKey: ["forum-posts"] });
      toast.success("Post created! 🎉");
      setTitle("");
      setBody("");
      setTag("general");
      setPollOptions(["", ""]);
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Could not create post");
    }
    setPosting(false);
  };

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 400 }}
        className="bg-white w-full max-w-lg rounded-t-3xl p-5 pb-8 overflow-y-auto"
        style={{ maxHeight: "85vh" }}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-neutral-900" style={{ fontFamily: FONT_GROTESK }}>New Post</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center bg-neutral-100 active:scale-90">
            <X className="w-4 h-4 text-neutral-500" />
          </button>
        </div>

        {/* Tag selector */}
        <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
          {TAGS.filter(t => t.key !== "all").map(t => (
            <button
              key={t.key}
              onClick={() => setTag(t.key)}
              className="px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap transition-all"
              style={{
                background: tag === t.key ? `${TAG_COLORS[t.key] || "#6B7280"}15` : "#f5f5f5",
                color: tag === t.key ? TAG_COLORS[t.key] || "#6B7280" : "#9CA3AF",
                border: tag === t.key ? `1.5px solid ${TAG_COLORS[t.key] || "#6B7280"}40` : "1.5px solid transparent",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tag === "lfg" && (
          <div className="rounded-xl p-3 mb-3" style={{ background: "#22C55E08", border: "1px solid #22C55E20" }}>
            <p className="text-[11px] text-neutral-500" style={{ fontFamily: FONT_MONO }}>
              💡 LFG posts let others join directly — perfect for "looking for game" requests!
            </p>
          </div>
        )}

        {tag === "poll" && (
          <div className="rounded-xl p-3 mb-3" style={{ background: "#F9731608", border: "1px solid #F9731620" }}>
            <p className="text-[11px] text-neutral-500 mb-2" style={{ fontFamily: FONT_MONO }}>
              📊 Add options for your poll below
            </p>
          </div>
        )}

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={tag === "lfg" ? "e.g. Söker motståndare imorgon kl 10" : tag === "poll" ? "Your poll question" : "Title"}
          className="w-full text-base font-bold rounded-xl px-4 py-3 mb-3 outline-none bg-neutral-50 border border-neutral-200 text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-300"
          style={{ fontFamily: FONT_GROTESK, fontSize: "16px" }}
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={tag === "lfg" ? "Describe level, venue, time etc..." : "What's on your mind? (optional)"}
          rows={3}
          className="w-full text-sm rounded-xl px-4 py-3 mb-2 outline-none bg-neutral-50 border border-neutral-200 text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-300 resize-none"
          style={{ fontSize: "16px" }}
        />

        {/* Media buttons */}
        <div className="flex gap-2 mb-4">
          <input type="file" ref={fileInputRef} accept="image/*" className="hidden" onChange={handleImageUpload} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-neutral-50 border border-neutral-200 text-neutral-500 active:scale-95 transition-all"
          >
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
            Photo
          </button>
          <button
            onClick={() => setShowGifPicker(!showGifPicker)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-neutral-50 border border-neutral-200 text-neutral-500 active:scale-95 transition-all"
          >
            <Smile className="w-3.5 h-3.5" />
            GIF
          </button>
        </div>

        {/* GIF Picker */}
        {showGifPicker && (
          <div className="mb-4">
            <GifPicker onSelect={handleGifSelect} onClose={() => setShowGifPicker(false)} />
          </div>
        )}

        {/* Poll options */}
        {tag === "poll" && (
          <div className="mb-4 space-y-2">
            {pollOptions.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={opt}
                  onChange={(e) => {
                    const newOpts = [...pollOptions];
                    newOpts[i] = e.target.value;
                    setPollOptions(newOpts);
                  }}
                  placeholder={`Option ${i + 1}`}
                  className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none bg-neutral-50 border border-neutral-200 text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-300"
                  style={{ fontSize: "16px" }}
                />
                {pollOptions.length > 2 && (
                  <button
                    onClick={() => setPollOptions(pollOptions.filter((_, j) => j !== i))}
                    className="w-8 h-8 rounded-lg flex items-center justify-center bg-neutral-100 text-neutral-400 active:scale-90"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
            {pollOptions.length < 6 && (
              <button
                onClick={() => setPollOptions([...pollOptions, ""])}
                className="text-[11px] font-bold px-3 py-1.5 rounded-lg transition-all active:scale-95"
                style={{ color: "#F97316", background: "#F9731610" }}
              >
                + Add option
              </button>
            )}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={!title.trim() || posting}
          className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.98] disabled:opacity-40"
          style={{ background: BLUE, fontFamily: FONT_MONO }}
        >
          {posting ? "Posting..." : "Post"}
        </button>
      </motion.div>
    </motion.div>
  );
}

/* ── Main Forum Feed ── */
export function ForumFeed() {
  const { user } = useAuth();
  const [activeTag, setActiveTag] = useState("all");
  const [sort, setSort] = useState<"hot" | "new">("hot");
  const [selectedPost, setSelectedPost] = useState<any>(null);
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Fetch upcoming events inline
  const { data: upcomingEvents } = useQuery({
    queryKey: ["upcoming-events-inline"],
    staleTime: 60000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("events")
        .select("id, name, display_name, description, slug, start_date, start_time, sport_type, venues(name)")
        .eq("is_public", true)
        .gte("start_date", new Date().toISOString())
        .order("start_date", { ascending: true })
        .limit(3);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: posts, isLoading } = useQuery({
    queryKey: ["forum-posts", activeTag, sort],
    staleTime: 15000,
    queryFn: async () => {
      let query = (supabase as any)
        .from("forum_posts")
        .select("*, player_profiles(display_name, avatar_url)");

      if (activeTag !== "all") {
        query = query.eq("tag", activeTag);
      }

      if (sort === "hot") {
        query = query.order("is_pinned", { ascending: false }).order("upvote_count", { ascending: false });
      } else {
        query = query.order("is_pinned", { ascending: false }).order("created_at", { ascending: false });
      }

      const { data, error } = await query.limit(50);
      if (error) throw error;

      // Get user votes
      let userVotes: Record<string, number> = {};
      if (user && data?.length) {
        const postIds = data.map((p: any) => p.id);
        const { data: votes } = await (supabase as any)
          .from("post_votes")
          .select("post_id, vote_value")
          .eq("auth_user_id", user.id)
          .in("post_id", postIds);
        (votes || []).forEach((v: any) => { userVotes[v.post_id] = v.vote_value; });
      }

      // Save latest timestamp for badge
      if (data?.length) {
        localStorage.setItem("community_forum_last_seen", new Date().toISOString());
      }

      return (data || []).map((p: any) => ({ ...p, user_vote: userVotes[p.id] || 0 }));
    },
  });

  // Merge events inline into posts when showing "all" or "events" tag
  const showEvents = (activeTag === "all" || activeTag === "events") && upcomingEvents && upcomingEvents.length > 0;

  // Event detail view
  if (selectedEvent) {
    return (
      <AnimatePresence mode="wait">
        <motion.div key="event-detail" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
          <EventDetail event={selectedEvent} onBack={() => setSelectedEvent(null)} />
        </motion.div>
      </AnimatePresence>
    );
  }

  if (selectedPost) {
    return (
      <AnimatePresence mode="wait">
        <motion.div key="detail" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
          <PostDetail post={selectedPost} onBack={() => setSelectedPost(null)} />
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <div>
      {/* Sort tabs */}
      <div className="flex items-center gap-1 mb-3">
        {(["hot", "new"] as const).map(s => (
          <button
            key={s}
            onClick={() => setSort(s)}
            className="px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wide transition-all"
            style={{
              fontFamily: FONT_MONO,
              background: sort === s ? "#111" : "transparent",
              color: sort === s ? "#fff" : "#9CA3AF",
            }}
          >
            {s === "hot" ? "🔥 Hot" : "🕐 New"}
          </button>
        ))}
      </div>

      {/* Tag filter */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1 -mx-1 px-1">
        {TAGS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTag(t.key)}
            className="px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap transition-all"
            style={{
              background: activeTag === t.key ? "#111" : "#f5f5f5",
              color: activeTag === t.key ? "#fff" : "#9CA3AF",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Posts + inline events */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-neutral-300" /></div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Show events at top */}
          {showEvents && upcomingEvents.map((ev: any) => (
            <EventCard key={`event-${ev.id}`} event={ev} onOpen={() => setSelectedEvent(ev)} />
          ))}

          {posts && posts.length > 0 ? (
            posts.map((post: any) => (
              <PostCard key={post.id} post={post} onOpen={() => setSelectedPost(post)} />
            ))
          ) : !showEvents ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <MessageCircle className="w-6 h-6 text-neutral-300" />
              <p className="text-sm font-semibold text-neutral-500" style={{ fontFamily: FONT_GROTESK }}>
                No posts yet
              </p>
              <p className="text-[11px] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
                Be the first to start a discussion!
              </p>
            </div>
          ) : null}
        </div>
      )}

      {/* FAB */}
      {user && (
        <button
          onClick={() => setShowCreate(true)}
          className="fixed bottom-24 right-5 w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg active:scale-90 transition-transform z-30"
          style={{ background: BLUE, boxShadow: `0 8px 24px ${BLUE}40` }}
        >
          <Plus className="w-6 h-6 text-white" />
        </button>
      )}

      <AnimatePresence>
        {showCreate && <CreatePostSheet open={showCreate} onClose={() => setShowCreate(false)} />}
      </AnimatePresence>
    </div>
  );
}
