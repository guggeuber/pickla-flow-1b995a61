import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { FeedCard } from "./FeedCard";
import { motion } from "framer-motion";
import { Loader2, Zap } from "lucide-react";

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06 } } };
const item = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 26 } } };

export function FeedTab() {
  const { user } = useAuth();

  const { data: feedItems, isLoading } = useQuery({
    queryKey: ["community-feed"],
    staleTime: 15000,
    queryFn: async () => {
      const { data: feed, error } = await (supabase as any)
        .from("community_feed")
        .select("*, venues(name, slug)")
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;

      // Get like counts
      const feedIds = (feed || []).map((f: any) => f.id);
      let likeCounts: Record<string, number> = {};
      let userLikes: Set<string> = new Set();

      if (feedIds.length > 0) {
        const { data: likes } = await (supabase as any)
          .from("feed_likes")
          .select("feed_item_id, auth_user_id")
          .in("feed_item_id", feedIds);

        (likes || []).forEach((l: any) => {
          likeCounts[l.feed_item_id] = (likeCounts[l.feed_item_id] || 0) + 1;
          if (user && l.auth_user_id === user.id) userLikes.add(l.feed_item_id);
        });
      }

      return (feed || []).map((f: any) => ({
        ...f,
        like_count: likeCounts[f.id] || 0,
        user_liked: userLikes.has(f.id),
      }));
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: "#3E3D39" }} />
      </div>
    );
  }

  if (!feedItems?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "rgba(232,108,36,0.1)" }}>
          <Zap className="w-7 h-7" style={{ color: "#E86C24" }} />
        </div>
        <p className="text-sm font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#3E3D39" }}>
          Inga aktiviteter än
        </p>
        <p className="text-xs text-center max-w-[200px]" style={{ color: "rgba(62,61,57,0.5)" }}>
          Spela matcher och checka in för att se aktivitet här!
        </p>
      </div>
    );
  }

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col gap-3">
      {feedItems.map((fi: any) => (
        <motion.div key={fi.id} variants={item}>
          <FeedCard item={fi} />
        </motion.div>
      ))}
    </motion.div>
  );
}
