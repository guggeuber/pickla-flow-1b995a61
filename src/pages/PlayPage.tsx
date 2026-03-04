import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Loader2, Zap, Ticket, Check } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { FeedCard } from "@/components/community/FeedCard";
import picklaLogo from "@/assets/pickla-logo.svg";
import { useState } from "react";
import { toast } from "sonner";

const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08 } } };
const item = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 26 } } };

const DAY_PASS_PRICE = 165;

const plans = [
  { title: "Pickla Member – 399 kr / month", subtitle: "Join the community", accent: true },
  { title: "Unlimited – 799 kr / month", subtitle: "Play anytime", accent: false },
];

const PlayPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [showDayPassForm, setShowDayPassForm] = useState(false);
  const [dpName, setDpName] = useState("");
  const [dpPhone, setDpPhone] = useState("");
  const [dpSubmitting, setDpSubmitting] = useState(false);
  const [dpRef, setDpRef] = useState<string | null>(null);

  const bgColor = user ? "#F5D5D5" : "#FFFFFF";

  // Check if user has active membership
  const { data: activeMembership } = useQuery({
    queryKey: ["my-membership", user?.id],
    enabled: !!user,
    staleTime: 30000,
    queryFn: async () => {
      const { data } = await supabase
        .from("memberships")
        .select("id, tier_id, membership_tiers(name)")
        .eq("user_id", user!.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const hasMembership = !!activeMembership;

  // Community feed
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

  const handleDayPassPurchase = async () => {
    if (!dpName.trim() || !dpPhone.trim()) {
      toast.error("Fyll i namn och telefon");
      return;
    }
    setDpSubmitting(true);
    try {
      const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const BASE_URL = `https://${PROJECT_ID}.supabase.co/functions/v1`;
      const res = await fetch(`${BASE_URL}/api-day-passes/public-purchase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: dpName.trim(),
          phone: dpPhone.trim(),
          price: DAY_PASS_PRICE,
          user_id: user?.id || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Kunde inte skapa dagspass");
      }
      const result = await res.json();
      setDpRef(result.ref || result.id?.slice(0, 8)?.toUpperCase());
      toast.success("Dagspass skapat!");
    } catch (err: any) {
      toast.error(err.message || "Något gick fel");
    } finally {
      setDpSubmitting(false);
    }
  };

  const handleFeedCardClick = (fi: any) => {
    if (fi.event_id) {
      // Try to find slug from content
      const slug = fi.content?.slug;
      if (slug) {
        navigate(`/e/${slug}`);
      } else {
        navigate(`/event/${fi.event_id}`);
      }
    }
  };

  return (
    <div className="min-h-screen" style={{ background: bgColor, color: "#3E3D39" }}>
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
          <h1 className="text-2xl font-black tracking-tight uppercase" style={{ fontFamily: FONT_HEADING }}>
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

        {/* Day Pass — always visible */}
        <motion.div variants={item}>
          {dpRef ? (
            // Confirmation state
            <div
              className="rounded-2xl p-6 text-center"
              style={{ background: "rgba(76,175,80,0.08)", border: "1.5px solid rgba(76,175,80,0.2)" }}
            >
              <div className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center" style={{ background: "rgba(76,175,80,0.15)" }}>
                <Check className="w-6 h-6" style={{ color: "#4CAF50" }} />
              </div>
              <p className="text-sm font-bold mb-1" style={{ fontFamily: FONT_HEADING }}>Dagspass klart!</p>
              <p className="text-2xl font-black tracking-tight mb-2" style={{ fontFamily: FONT_MONO, color: "#3E3D39" }}>
                {dpRef}
              </p>
              <p className="text-xs" style={{ color: "rgba(62,61,57,0.5)", fontFamily: FONT_MONO }}>
                Visa koden i kassan och betala innan du spelar
              </p>
            </div>
          ) : showDayPassForm ? (
            // Purchase form
            <div
              className="rounded-2xl p-5"
              style={{ background: "rgba(255,255,255,0.8)", border: "1.5px solid rgba(62,61,57,0.1)" }}
            >
              <div className="flex items-center gap-2 mb-4">
                <Ticket className="w-5 h-5" style={{ color: "#E86C24" }} />
                <p className="text-[15px] font-bold" style={{ fontFamily: FONT_HEADING }}>
                  Day Pass – {DAY_PASS_PRICE} kr
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <input
                  type="text"
                  placeholder="Namn"
                  value={dpName}
                  onChange={(e) => setDpName(e.target.value)}
                  className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                  style={{
                    background: "rgba(62,61,57,0.04)",
                    border: "1.5px solid rgba(62,61,57,0.1)",
                    fontFamily: FONT_MONO,
                  }}
                />
                <input
                  type="tel"
                  placeholder="Telefon"
                  value={dpPhone}
                  onChange={(e) => setDpPhone(e.target.value)}
                  className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                  style={{
                    background: "rgba(62,61,57,0.04)",
                    border: "1.5px solid rgba(62,61,57,0.1)",
                    fontFamily: FONT_MONO,
                  }}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowDayPassForm(false)}
                    className="flex-1 rounded-xl px-4 py-3 text-sm font-semibold transition-all active:scale-95"
                    style={{ background: "rgba(62,61,57,0.06)", color: "#3E3D39", fontFamily: FONT_MONO }}
                  >
                    Avbryt
                  </button>
                  <button
                    onClick={handleDayPassPurchase}
                    disabled={dpSubmitting}
                    className="flex-1 rounded-xl px-4 py-3 text-sm font-bold transition-all active:scale-95 disabled:opacity-50"
                    style={{ background: "#E86C24", color: "#fff", fontFamily: FONT_MONO }}
                  >
                    {dpSubmitting ? "…" : `Köp – ${DAY_PASS_PRICE} kr`}
                  </button>
                </div>
              </div>
              <p className="text-[10px] mt-3 text-center" style={{ color: "rgba(62,61,57,0.4)", fontFamily: FONT_MONO }}>
                Du betalar i kassan. Visa din referenskod vid incheckning.
              </p>
            </div>
          ) : (
            // Day pass button
            <motion.button
              onClick={() => setShowDayPassForm(true)}
              className="w-full rounded-2xl p-5 text-left transition-all active:scale-[0.98]"
              style={{
                background: "rgba(255,255,255,0.7)",
                border: "1.5px solid rgba(62,61,57,0.1)",
                boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
              }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[15px] font-bold tracking-tight" style={{ fontFamily: FONT_HEADING, color: "#3E3D39" }}>
                    Day Pass – {DAY_PASS_PRICE} kr
                  </p>
                  <p className="text-xs mt-0.5" style={{ fontFamily: FONT_MONO, color: "rgba(62,61,57,0.5)" }}>
                    Play today
                  </p>
                </div>
                <Ticket className="w-5 h-5" style={{ color: "#E86C24" }} />
              </div>
            </motion.button>
          )}
        </motion.div>

        {/* Membership cards — only if no active membership */}
        {!hasMembership && (
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
        )}

        {/* Active membership badge */}
        {hasMembership && (
          <motion.div
            variants={item}
            className="rounded-2xl p-4 flex items-center gap-3"
            style={{ background: "rgba(76,175,80,0.08)", border: "1.5px solid rgba(76,175,80,0.15)" }}
          >
            <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(76,175,80,0.15)" }}>
              <Check className="w-4 h-4" style={{ color: "#4CAF50" }} />
            </div>
            <div>
              <p className="text-sm font-bold" style={{ fontFamily: FONT_HEADING }}>
                {(activeMembership as any)?.membership_tiers?.name || "Medlem"}
              </p>
              <p className="text-[11px]" style={{ color: "rgba(62,61,57,0.5)", fontFamily: FONT_MONO }}>
                Du har ett aktivt medlemskap
              </p>
            </div>
          </motion.div>
        )}

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
                <div
                  key={fi.id}
                  onClick={() => handleFeedCardClick(fi)}
                  className={fi.event_id ? "cursor-pointer" : ""}
                >
                  <FeedCard item={fi} />
                </div>
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
