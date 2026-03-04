import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Loader2, Zap, Ticket, Check, Clock, Users } from "lucide-react";
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

// Fetch today's and upcoming public events with tier pricing
function useTodayEvents() {
  return useQuery({
    queryKey: ["play-events-today"],
    staleTime: 15000,
    refetchInterval: 60000,
    queryFn: async () => {
      const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const BASE_URL = `https://${PROJECT_ID}.supabase.co/functions/v1`;
      const res = await fetch(`${BASE_URL}/api-event-public/list`);
      if (!res.ok) return [];
      const events = await res.json();
      return events || [];
    },
  });
}

function useTierPricing() {
  return useQuery({
    queryKey: ["play-tier-pricing"],
    staleTime: 60000,
    queryFn: async () => {
      const { data } = await supabase
        .from("membership_tier_pricing")
        .select("tier_id, product_type, fixed_price, discount_percent, label, membership_tiers(id, name, color, sort_order)")
        .in("product_type", ["event_fee", "day_pass"]);
      return data || [];
    },
  });
}

function EventPriceBadges({ event, tierPricing }: { event: any; tierPricing: any[] }) {
  const basePrice = event.entry_fee != null ? Number(event.entry_fee) : null;
  const isDayPass = event.entry_fee_type === 'day_pass';
  const productType = isDayPass ? 'day_pass' : 'event_fee';

  // Find tier-specific prices
  const relevantTiers = tierPricing
    .filter((tp: any) => tp.product_type === productType)
    .sort((a: any, b: any) => (a.membership_tiers?.sort_order || 0) - (b.membership_tiers?.sort_order || 0));

  // If no base price set and no tier pricing, show nothing special
  if ((basePrice === null || basePrice === 0) && relevantTiers.length === 0) {
    return <span className="text-[11px] font-semibold" style={{ color: "#4CAF50", fontFamily: FONT_MONO }}>Gratis</span>;
  }

  // If base price is set but no tier pricing configured, just show the base price
  if (relevantTiers.length === 0 && basePrice && basePrice > 0) {
    return <span className="text-[11px] font-semibold" style={{ color: "#3E3D39", fontFamily: FONT_MONO }}>{Math.round(basePrice)} kr</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {relevantTiers.map((tp: any) => {
        let price: number;
        if (tp.fixed_price != null) {
          price = tp.fixed_price;
        } else if (tp.discount_percent && basePrice && basePrice > 0) {
          price = basePrice * (1 - tp.discount_percent / 100);
        } else {
          price = basePrice || 0;
        }
        return (
          <span
            key={tp.tier_id}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold"
            style={{
              background: `${tp.membership_tiers?.color || '#666'}15`,
              color: tp.membership_tiers?.color || '#666',
              fontFamily: FONT_MONO,
            }}
          >
            {tp.label || tp.membership_tiers?.name}: {price === 0 ? 'Gratis' : `${Math.round(price)} kr`}
          </span>
        );
      })}
      {/* Guest/base price - only show if basePrice > 0 */}
      {basePrice != null && basePrice > 0 && (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold"
          style={{
            background: "rgba(62,61,57,0.06)",
            color: "rgba(62,61,57,0.6)",
            fontFamily: FONT_MONO,
          }}
        >
          Gäst: {`${Math.round(basePrice)} kr`}
        </span>
      )}
    </div>
  );
}

const PlayPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

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

  const { data: events, isLoading: eventsLoading } = useTodayEvents();
  const { data: tierPricing } = useTierPricing();

  // Split events into today and upcoming
  const today = new Date().toISOString().slice(0, 10);
  const todayEvents = (events || []).filter((e: any) => {
    if (!e.start_date) return false;
    const eventDate = new Date(e.start_date).toISOString().slice(0, 10);
    return eventDate === today;
  });
  const upcomingEvents = (events || []).filter((e: any) => {
    if (!e.start_date) return true; // no date = show in upcoming
    const eventDate = new Date(e.start_date).toISOString().slice(0, 10);
    return eventDate > today;
  });

  // Community feed - exclude event_created to avoid duplicates
  const { data: feedItems, isLoading: feedLoading } = useQuery({
    queryKey: ["community-feed"],
    staleTime: 15000,
    queryFn: async () => {
      const { data: feed, error } = await (supabase as any)
        .from("community_feed")
        .select("*, venues(name, slug)")
        .neq("feed_type", "event_created")
        .order("created_at", { ascending: false })
        .limit(30);
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

  const handleFeedCardClick = (fi: any) => {
    if (fi.event_id) {
      const slug = fi.content?.slug;
      if (slug) {
        navigate(`/e/${slug}`);
      } else {
        navigate(`/event/${fi.event_id}`);
      }
    }
  };

  const handleEventClick = (evt: any) => {
    if (evt.slug) {
      navigate(`/e/${evt.slug}`);
    } else {
      navigate(`/event/${evt.id}`);
    }
  };

  const renderEventCard = (evt: any) => (
    <motion.button
      key={evt.id}
      variants={item}
      onClick={() => handleEventClick(evt)}
      className="w-full rounded-2xl p-4 text-left transition-all active:scale-[0.98]"
      style={{
        background: "rgba(255,255,255,0.8)",
        border: "1.5px solid rgba(62,61,57,0.08)",
        boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
      }}
    >
      <div className="flex items-start gap-3">
        {evt.logo_url ? (
          <img src={evt.logo_url} alt="" className="w-10 h-10 rounded-xl object-cover flex-shrink-0" />
        ) : (
          <div
            className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center text-sm font-bold"
            style={{ background: evt.primary_color || "rgba(232,108,36,0.1)", color: "#fff" }}
          >
            {(evt.display_name || evt.name || "?")[0].toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold tracking-tight truncate" style={{ fontFamily: FONT_HEADING, color: "#3E3D39" }}>
            {evt.display_name || evt.name}
          </p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {evt.start_date && (
              <span className="text-[11px] flex items-center gap-0.5" style={{ color: "rgba(62,61,57,0.5)", fontFamily: FONT_MONO }}>
                📅 {new Date(evt.start_date).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })}
              </span>
            )}
            {evt.start_time && (
              <span className="text-[11px] flex items-center gap-0.5" style={{ color: "rgba(62,61,57,0.5)", fontFamily: FONT_MONO }}>
                <Clock className="w-3 h-3" />
                {evt.start_time.slice(0, 5)}{evt.end_time ? `–${evt.end_time.slice(0, 5)}` : ''}
              </span>
            )}
            {evt.is_drop_in && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md font-semibold" style={{ background: "rgba(76,175,80,0.1)", color: "#4CAF50", fontFamily: FONT_MONO }}>
                Drop-in
              </span>
            )}
            {evt.entry_fee_type === 'day_pass' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md font-semibold" style={{ background: "rgba(232,108,36,0.1)", color: "#E86C24", fontFamily: FONT_MONO }}>
                Dagspass
              </span>
            )}
          </div>
          <EventPriceBadges event={evt} tierPricing={tierPricing || []} />
        </div>
        <ArrowRight className="w-4 h-4 flex-shrink-0 mt-1" style={{ color: "rgba(62,61,57,0.3)" }} />
      </div>
    </motion.button>
  );

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

        {/* Today's activities */}
        <motion.div variants={item}>
          <h2 className="text-base font-bold mb-3 uppercase tracking-tight" style={{ fontFamily: FONT_HEADING }}>
            🏓 Idag
          </h2>
          {eventsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: "#3E3D39" }} />
            </div>
          ) : todayEvents.length > 0 ? (
            <div className="flex flex-col gap-3">
              {todayEvents.map(renderEventCard)}
            </div>
          ) : (
            <div
              className="rounded-2xl p-5 text-center"
              style={{ background: "rgba(62,61,57,0.03)", border: "1.5px dashed rgba(62,61,57,0.1)" }}
            >
              <p className="text-sm" style={{ color: "rgba(62,61,57,0.4)", fontFamily: FONT_MONO }}>
                Inga aktiviteter idag
              </p>
            </div>
          )}
        </motion.div>

        {/* Upcoming events */}
        {upcomingEvents.length > 0 && (
          <motion.div variants={item}>
            <h2 className="text-base font-bold mb-3 uppercase tracking-tight" style={{ fontFamily: FONT_HEADING }}>
              📅 Kommande
            </h2>
            <div className="flex flex-col gap-3">
              {upcomingEvents.slice(0, 5).map(renderEventCard)}
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
            Boka egen bana
          </p>
          <button
            onClick={() => navigate("/book")}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all active:scale-95"
            style={{ background: "#E86C24", color: "#fff", fontFamily: FONT_MONO }}
          >
            Boka bana
            <ArrowRight className="w-4 h-4" />
          </button>
        </motion.div>

        {/* Active membership badge or small membership link */}
        {hasMembership ? (
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
        ) : (
          <motion.button
            variants={item}
            onClick={() => navigate("/community")}
            className="rounded-2xl p-4 flex items-center gap-3 text-left transition-all active:scale-[0.98]"
            style={{ background: "rgba(62,61,57,0.03)", border: "1.5px solid rgba(62,61,57,0.08)" }}
          >
            <Users className="w-5 h-5" style={{ color: "rgba(62,61,57,0.4)" }} />
            <div>
              <p className="text-sm font-semibold" style={{ fontFamily: FONT_HEADING, color: "#3E3D39" }}>Bli medlem</p>
              <p className="text-[11px]" style={{ color: "rgba(62,61,57,0.4)", fontFamily: FONT_MONO }}>Se medlemskap & förmåner</p>
            </div>
            <ArrowRight className="w-4 h-4 ml-auto" style={{ color: "rgba(62,61,57,0.3)" }} />
          </motion.button>
        )}

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
