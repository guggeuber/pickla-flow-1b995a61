import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Loader2, Zap } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { FeedCard } from "@/components/community/FeedCard";
import picklaLogo from "@/assets/pickla-logo.svg";

const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08 } } };
const item = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 26 } } };

const plans = [
  { title: "Day Pass – 165 kr", subtitle: "Play today", accent: false },
  { title: "Pickla Member – 399 kr / month", subtitle: "Join the community", accent: true },
  { title: "Unlimited – 799 kr / month", subtitle: "Play anytime", accent: false },
];

const PlayPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: feedItems, isLoading: feedLoading } = useQuery({
    queryKey: ["community-feed"],
    staleTime: 15000,
    queryFn: async () => {
      const { data: feed, error } = await (supabase as any)
        .from("community_feed")
        .select("*, venues(name, slug)")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;

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

  return (
    <div className="min-h-screen" style={{ background: "#F5D5D5", color: "#3E3D39" }}>
      {/* Header with back */}
      <div className="px-5 pt-6 pb-3 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-transform"
          style={{ background: "rgba(62,61,57,0.08)" }}
        >
          <ArrowLeft className="w-5 h-5" style={{ color: "#3E3D39" }} />
        </button>
        <img src={picklaLogo} alt="Pickla" className="h-7 w-auto" />
      </div>

      <motion.div variants={container} initial="hidden" animate="show" className="px-5 pb-12 flex flex-col gap-6">
        {/* Hero */}
        <motion.div variants={item} className="text-center pt-2">
          <h1
            className="text-2xl font-black tracking-tight uppercase"
            style={{ fontFamily: FONT_HEADING }}
          >
            Play at Pickla
          </h1>
        </motion.div>

        {/* Open Play section */}
        <motion.div variants={item} className="text-center">
          <h2 className="text-lg font-bold mb-1" style={{ fontFamily: FONT_HEADING }}>
            Open Play Today
          </h2>
          <p className="text-sm" style={{ color: "rgba(62,61,57,0.6)", fontFamily: FONT_MONO }}>
            Join games, rotate courts, meet players.
          </p>
        </motion.div>

        {/* Membership cards */}
        <div className="flex flex-col gap-3">
          {plans.map((plan) => (
            <motion.button
              key={plan.title}
              variants={item}
              className="w-full rounded-2xl p-5 text-left transition-all active:scale-[0.98]"
              style={{
                background: plan.accent ? "#3E3D39" : "rgba(255,255,255,0.7)",
                border: plan.accent ? "none" : "1.5px solid rgba(62,61,57,0.1)",
                boxShadow: plan.accent ? "0 8px 32px rgba(62,61,57,0.2)" : "0 2px 12px rgba(0,0,0,0.04)",
              }}
            >
              <p
                className="text-[15px] font-bold tracking-tight"
                style={{ fontFamily: FONT_HEADING, color: plan.accent ? "#fff" : "#3E3D39" }}
              >
                {plan.title}
              </p>
              <p
                className="text-xs mt-0.5"
                style={{ fontFamily: FONT_MONO, color: plan.accent ? "rgba(255,255,255,0.6)" : "rgba(62,61,57,0.5)" }}
              >
                {plan.subtitle}
              </p>
            </motion.button>
          ))}
        </div>

        {/* Book a court CTA */}
        <motion.div
          variants={item}
          className="rounded-2xl p-5 text-center"
          style={{ background: "rgba(232,108,36,0.06)", border: "1.5px solid rgba(232,108,36,0.15)" }}
        >
          <p className="text-sm mb-3" style={{ fontFamily: FONT_HEADING, color: "#3E3D39", fontWeight: 600 }}>
            Prefer a private court?
          </p>
          <button
            onClick={() => navigate("/book")}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all active:scale-95"
            style={{ background: "#E86C24", color: "#fff", fontFamily: FONT_MONO }}
          >
            Book a court
            <ArrowRight className="w-4 h-4" />
          </button>
        </motion.div>

        {/* Community Feed */}
        <motion.div variants={item}>
          <h3
            className="text-base font-bold mb-3 uppercase tracking-tight"
            style={{ fontFamily: FONT_HEADING }}
          >
            What's happening
          </h3>

          {feedLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: "#3E3D39" }} />
            </div>
          ) : feedItems && feedItems.length > 0 ? (
            <div className="flex flex-col gap-3">
              {feedItems.map((fi: any) => (
                <FeedCard key={fi.id} item={fi} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "rgba(232,108,36,0.1)" }}>
                <Zap className="w-6 h-6" style={{ color: "#E86C24" }} />
              </div>
              <p className="text-xs" style={{ color: "rgba(62,61,57,0.5)", fontFamily: FONT_MONO }}>
                Inga aktiviteter än
              </p>
            </div>
          )}
        </motion.div>
      </motion.div>
    </div>
  );
};

export default PlayPage;
