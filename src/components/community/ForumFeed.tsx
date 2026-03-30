import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2, ArrowBigUp, ArrowBigDown, MessageCircle, Plus, Pin, Send, X,
  ChevronLeft, MoreHorizontal, Trash2
} from "lucide-react";
import { toast } from "sonner";

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
];

const TAG_COLORS: Record<string, string> = {
  question: "#3B82F6",
  equipment: "#F59E0B",
  lfg: "#22C55E",
  events: "#8B5CF6",
  tips: "#EC4899",
  general: "#6B7280",
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

/* ── Post Card ── */
function PostCard({ post, onOpen }: { post: any; onOpen: () => void }) {
  const tagColor = TAG_COLORS[post.tag] || "#6B7280";

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
        {post.is_pinned && <Pin className="w-3 h-3 text-amber-500 ml-auto" />}
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
        {post.body && (
          <p className="text-[13px] text-neutral-500 line-clamp-2 leading-relaxed">
            {post.body}
          </p>
        )}
      </button>

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
  const tagColor = TAG_COLORS[post.tag] || "#6B7280";

  const { data: profile } = useQuery({
    queryKey: ["my-profile-id"],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("player_profiles").select("id").eq("auth_user_id", user!.id).single();
      return data;
    },
  });

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

  const handleSendComment = async () => {
    const text = comment.trim();
    if (!text || !user || !profile || sending) return;
    setSending(true);
    setComment("");
    try {
      await (supabase as any).from("post_comments").insert({
        post_id: post.id,
        author_profile_id: profile.id,
        body: text,
      });
      qc.invalidateQueries({ queryKey: ["post-comments", post.id] });
      qc.invalidateQueries({ queryKey: ["forum-posts"] });
    } catch {
      setComment(text);
      toast.error("Could not post comment");
    }
    setSending(false);
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
        {post.body && <p className="text-[14px] text-neutral-600 leading-relaxed whitespace-pre-wrap">{post.body}</p>}
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
                  <p className="text-[13px] text-neutral-600 mt-0.5 leading-relaxed">{c.body}</p>
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

      {/* Comment input */}
      {user ? (
        <div className="pt-3 mt-3 border-t border-neutral-100">
          <div className="flex items-center gap-2">
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendComment(); } }}
              placeholder="Add a comment..."
              className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none bg-neutral-50 border border-neutral-200 text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-300"
            />
            <button
              onClick={handleSendComment}
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

  const { data: profile } = useQuery({
    queryKey: ["my-profile-id"],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("player_profiles").select("id").eq("auth_user_id", user!.id).single();
      return data;
    },
  });

  const handleSubmit = async () => {
    if (!title.trim() || !user || !profile || posting) return;
    setPosting(true);
    try {
      await (supabase as any).from("forum_posts").insert({
        author_profile_id: profile.id,
        title: title.trim(),
        body: body.trim(),
        tag,
      });
      qc.invalidateQueries({ queryKey: ["forum-posts"] });
      toast.success("Post created! 🎉");
      setTitle("");
      setBody("");
      setTag("general");
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
        className="bg-white w-full max-w-lg rounded-t-3xl p-5 pb-8"
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

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="w-full text-base font-bold rounded-xl px-4 py-3 mb-3 outline-none bg-neutral-50 border border-neutral-200 text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-300"
          style={{ fontFamily: FONT_GROTESK }}
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What's on your mind? (optional)"
          rows={4}
          className="w-full text-sm rounded-xl px-4 py-3 mb-4 outline-none bg-neutral-50 border border-neutral-200 text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-300 resize-none"
        />

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
  const [showCreate, setShowCreate] = useState(false);

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

      return (data || []).map((p: any) => ({ ...p, user_vote: userVotes[p.id] || 0 }));
    },
  });

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

      {/* Posts */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-neutral-300" /></div>
      ) : posts && posts.length > 0 ? (
        <div className="flex flex-col gap-3">
          {posts.map((post: any) => (
            <PostCard key={post.id} post={post} onOpen={() => setSelectedPost(post)} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <MessageCircle className="w-6 h-6 text-neutral-300" />
          <p className="text-sm font-semibold text-neutral-500" style={{ fontFamily: FONT_GROTESK }}>
            No posts yet
          </p>
          <p className="text-[11px] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
            Be the first to start a discussion!
          </p>
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
