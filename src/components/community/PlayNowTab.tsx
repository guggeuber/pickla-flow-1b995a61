import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.1 } } };
const item = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 26 } } };

const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";
const BLUE = "#0066FF";

function useMembershipTiers() {
  return useQuery({
    queryKey: ["membership-tiers-public"],
    staleTime: 60000,
    queryFn: async () => {
      const { data: tiers } = await supabase
        .from("membership_tiers")
        .select("id, name, description, monthly_price, color, sort_order")
        .eq("is_active", true)
        .order("sort_order");
      if (!tiers || tiers.length === 0) return [];
      const tierIds = tiers.map((t) => t.id);
      const { data: pricing } = await supabase
        .from("membership_tier_pricing")
        .select("tier_id, product_type, fixed_price, label")
        .in("tier_id", tierIds)
        .eq("product_type", "day_pass");
      return tiers.map((tier) => {
        const dayPassPrice = pricing?.find((p) => p.tier_id === tier.id);
        return { ...tier, dayPassPrice: dayPassPrice?.fixed_price ?? null, dayPassLabel: dayPassPrice?.label ?? null };
      });
    },
  });
}

export function PlayNowTab() {
  const navigate = useNavigate();
  const { data: tiers, isLoading } = useMembershipTiers();

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col gap-6 pb-8">
      <motion.div variants={item} className="text-center pt-4">
        <h2 className="text-2xl font-black tracking-tight uppercase" style={{ fontFamily: FONT_HEADING, color: "#3E3D39" }}>
          Play at Pickla
        </h2>
      </motion.div>

      <motion.div variants={item} className="text-center">
        <h3 className="text-lg font-bold mb-1" style={{ fontFamily: FONT_HEADING, color: "#3E3D39" }}>
          Memberships & Pricing
        </h3>
        <p className="text-sm" style={{ color: "rgba(62,61,57,0.6)", fontFamily: FONT_MONO }}>
          Find the plan that fits you.
        </p>
      </motion.div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: "#3E3D39" }} />
        </div>
      ) : tiers && tiers.length > 0 ? (
        <div className="flex flex-col gap-3">
          {tiers.map((tier, i) => {
            const isAccent = i === Math.floor(tiers.length / 2);
            return (
              <motion.div key={tier.id} variants={item} className="w-full rounded-2xl p-5 text-left"
                style={{
                  background: isAccent ? "#3E3D39" : "rgba(255,255,255,0.7)",
                  border: isAccent ? "none" : "1.5px solid rgba(62,61,57,0.1)",
                  boxShadow: isAccent ? "0 8px 32px rgba(62,61,57,0.2)" : "0 2px 12px rgba(0,0,0,0.04)",
                }}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[15px] font-bold tracking-tight"
                      style={{ fontFamily: FONT_HEADING, color: isAccent ? "#fff" : "#3E3D39" }}>
                      {tier.name}
                    </p>
                    {tier.description && (
                      <p className="text-xs mt-0.5"
                        style={{ fontFamily: FONT_MONO, color: isAccent ? "rgba(255,255,255,0.6)" : "rgba(62,61,57,0.5)" }}>
                        {tier.description}
                      </p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0 ml-3">
                    {tier.monthly_price != null && tier.monthly_price > 0 && (
                      <p className="text-sm font-bold"
                        style={{ fontFamily: FONT_MONO, color: isAccent ? "#fff" : tier.color || BLUE }}>
                        {Math.round(tier.monthly_price)} kr/mo
                      </p>
                    )}
                    {tier.dayPassPrice != null && (
                      <p className="text-[10px] mt-0.5"
                        style={{ fontFamily: FONT_MONO, color: isAccent ? "rgba(255,255,255,0.5)" : "rgba(62,61,57,0.4)" }}>
                        {tier.dayPassLabel || "Day Pass"}: {Math.round(tier.dayPassPrice)} kr
                      </p>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <motion.div variants={item} className="rounded-2xl p-5 text-center"
          style={{ background: "rgba(62,61,57,0.03)", border: "1.5px dashed rgba(62,61,57,0.1)" }}>
          <p className="text-sm" style={{ color: "rgba(62,61,57,0.4)", fontFamily: FONT_MONO }}>
            No memberships configured yet
          </p>
        </motion.div>
      )}

      <motion.div variants={item} className="mt-4 rounded-2xl p-5 text-center"
        style={{ background: `${BLUE}08`, border: `1.5px solid ${BLUE}20` }}>
        <p className="text-sm mb-3" style={{ fontFamily: FONT_HEADING, color: "#3E3D39", fontWeight: 600 }}>
          Prefer a private court?
        </p>
        <button
          onClick={() => navigate("/book")}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all active:scale-95 text-white"
          style={{ background: BLUE, fontFamily: FONT_MONO }}
        >
          Book a court
          <ArrowRight className="w-4 h-4" />
        </button>
      </motion.div>
    </motion.div>
  );
}
