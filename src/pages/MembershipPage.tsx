import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Mail, Lock, User, Phone, Check, ChevronDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import picklaLogo from "@/assets/pickla-logo.svg";

const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08 } } };
const item = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 26 } } };

function useMembershipTiers() {
  return useQuery({
    queryKey: ["membership-tiers-full"],
    staleTime: 60000,
    queryFn: async () => {
      const { data: tiers } = await supabase
        .from("membership_tiers")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });

      const { data: pricing } = await supabase
        .from("membership_tier_pricing")
        .select("tier_id, product_type, fixed_price, discount_percent, label")
        .in("product_type", ["day_pass", "event_fee"]);

      return (tiers || []).map((t: any) => ({
        ...t,
        pricing: (pricing || []).filter((p: any) => p.tier_id === t.id),
      }));
    },
  });
}

function useActiveMembership() {
  const { user } = useAuth();
  return useQuery({
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
}

const MembershipPage = () => {
  const navigate = useNavigate();
  const { user, signUp } = useAuth();
  const { data: tiers, isLoading } = useMembershipTiers();
  const { data: activeMembership } = useActiveMembership();
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: "", email: "", phone: "", password: "" });
  const [submitting, setSubmitting] = useState(false);

  const hasMembership = !!activeMembership;

  const handleSignupAndRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTierId) return;

    setSubmitting(true);
    try {
      if (user) {
        // Already logged in — update phone if provided
        if (formData.phone) {
          await supabase
            .from("player_profiles")
            .update({ phone: formData.phone })
            .eq("auth_user_id", user.id);
        }
        toast.success("Tack! Vi kontaktar dig för att aktivera ditt medlemskap.");
        setSelectedTierId(null);
      } else {
        // Create account
        if (!formData.name.trim()) {
          toast.error("Ange ditt namn");
          setSubmitting(false);
          return;
        }
        const { error } = await signUp(formData.email, formData.password, formData.name);
        if (error) {
          toast.error(error.message);
          setSubmitting(false);
          return;
        }

        // After signup the trigger creates player_profile, but we need to update phone
        // This will happen on next login since we can't guarantee the profile exists yet
        toast.success("Konto skapat! Kolla din e-post för att verifiera. Vi kontaktar dig för att aktivera medlemskapet.");
        setSelectedTierId(null);
        setFormData({ name: "", email: "", phone: "", password: "" });
      }
    } catch {
      toast.error("Något gick fel, försök igen.");
    }
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-white" style={{ color: "#3E3D39" }}>
      {/* Header */}
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
            Medlemskap
          </h1>
          <p className="text-sm mt-2" style={{ color: "rgba(62,61,57,0.5)", fontFamily: FONT_MONO }}>
            Välj ditt medlemskap och börja spela
          </p>
        </motion.div>

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
                Du har redan ett aktivt medlemskap
              </p>
            </div>
          </motion.div>
        )}

        {/* Tier cards */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: "#3E3D39" }} />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {(tiers || []).map((tier: any) => {
              const isSelected = selectedTierId === tier.id;
              const dayPassPricing = tier.pricing?.find((p: any) => p.product_type === "day_pass");
              const eventFeePricing = tier.pricing?.find((p: any) => p.product_type === "event_fee");

              return (
                <motion.div key={tier.id} variants={item}>
                  <button
                    onClick={() => !hasMembership && setSelectedTierId(isSelected ? null : tier.id)}
                    className="w-full rounded-2xl p-5 text-left transition-all active:scale-[0.99]"
                    style={{
                      background: isSelected ? `${tier.color || "#E86C24"}08` : "rgba(255,255,255,0.8)",
                      border: `2px solid ${isSelected ? (tier.color || "#E86C24") + "40" : "rgba(62,61,57,0.08)"}`,
                      boxShadow: isSelected ? `0 4px 20px ${tier.color || "#E86C24"}15` : "0 2px 12px rgba(0,0,0,0.04)",
                    }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm"
                          style={{ background: tier.color || "#E86C24" }}
                        >
                          {tier.name?.[0]?.toUpperCase() || "M"}
                        </div>
                        <div>
                          <p className="text-[15px] font-bold tracking-tight" style={{ fontFamily: FONT_HEADING }}>
                            {tier.name}
                          </p>
                          {tier.description && (
                            <p className="text-[11px] mt-0.5" style={{ color: "rgba(62,61,57,0.5)", fontFamily: FONT_MONO }}>
                              {tier.description}
                            </p>
                          )}
                        </div>
                      </div>
                      {!hasMembership && (
                        <ChevronDown
                          className="w-4 h-4 flex-shrink-0 mt-1 transition-transform"
                          style={{
                            color: "rgba(62,61,57,0.3)",
                            transform: isSelected ? "rotate(180deg)" : "rotate(0deg)",
                          }}
                        />
                      )}
                    </div>

                    {/* Pricing info */}
                    <div className="flex flex-wrap gap-2 mt-3">
                      {tier.monthly_price != null && tier.monthly_price > 0 && (
                        <span
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold"
                          style={{
                            background: `${tier.color || "#E86C24"}12`,
                            color: tier.color || "#E86C24",
                            fontFamily: FONT_MONO,
                          }}
                        >
                          {Math.round(tier.monthly_price)} kr/mån
                        </span>
                      )}
                      {dayPassPricing && (
                        <span
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold"
                          style={{
                            background: "rgba(62,61,57,0.05)",
                            color: "rgba(62,61,57,0.6)",
                            fontFamily: FONT_MONO,
                          }}
                        >
                          Dagspass: {dayPassPricing.fixed_price != null ? `${Math.round(dayPassPricing.fixed_price)} kr` : dayPassPricing.discount_percent ? `-${dayPassPricing.discount_percent}%` : "Gratis"}
                        </span>
                      )}
                      {eventFeePricing && (
                        <span
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold"
                          style={{
                            background: "rgba(62,61,57,0.05)",
                            color: "rgba(62,61,57,0.6)",
                            fontFamily: FONT_MONO,
                          }}
                        >
                          Event: {eventFeePricing.fixed_price != null ? (eventFeePricing.fixed_price === 0 ? "Gratis" : `${Math.round(eventFeePricing.fixed_price)} kr`) : eventFeePricing.discount_percent ? `-${eventFeePricing.discount_percent}%` : "Gratis"}
                        </span>
                      )}
                    </div>
                  </button>

                  {/* Inline signup form */}
                  <AnimatePresence>
                    {isSelected && !hasMembership && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        className="overflow-hidden"
                      >
                        <form
                          onSubmit={handleSignupAndRequest}
                          className="pt-4 pb-2 space-y-3"
                        >
                          {user ? (
                            <>
                              <p className="text-[13px] font-medium" style={{ fontFamily: FONT_HEADING, color: "#3E3D39" }}>
                                Du är inloggad som {user.email}
                              </p>
                              <div className="relative">
                                <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "rgba(62,61,57,0.25)" }} />
                                <input
                                  type="tel"
                                  placeholder="telefonnummer (valfritt)"
                                  value={formData.phone}
                                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                  className="w-full px-4 py-3.5 pl-11 rounded-2xl bg-neutral-50 border border-neutral-200 text-neutral-900 text-[14px] placeholder:text-neutral-300 focus:outline-none focus:border-neutral-400 transition-colors"
                                  style={{ fontFamily: FONT_MONO }}
                                />
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="relative">
                                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "rgba(62,61,57,0.25)" }} />
                                <input
                                  type="text"
                                  placeholder="ditt namn"
                                  value={formData.name}
                                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                  className="w-full px-4 py-3.5 pl-11 rounded-2xl bg-neutral-50 border border-neutral-200 text-neutral-900 text-[14px] placeholder:text-neutral-300 focus:outline-none focus:border-neutral-400 transition-colors"
                                  style={{ fontFamily: FONT_MONO }}
                                  required
                                />
                              </div>
                              <div className="relative">
                                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "rgba(62,61,57,0.25)" }} />
                                <input
                                  type="email"
                                  placeholder="e-post"
                                  value={formData.email}
                                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                  className="w-full px-4 py-3.5 pl-11 rounded-2xl bg-neutral-50 border border-neutral-200 text-neutral-900 text-[14px] placeholder:text-neutral-300 focus:outline-none focus:border-neutral-400 transition-colors"
                                  style={{ fontFamily: FONT_MONO }}
                                  required
                                />
                              </div>
                              <div className="relative">
                                <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "rgba(62,61,57,0.25)" }} />
                                <input
                                  type="tel"
                                  placeholder="telefonnummer"
                                  value={formData.phone}
                                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                  className="w-full px-4 py-3.5 pl-11 rounded-2xl bg-neutral-50 border border-neutral-200 text-neutral-900 text-[14px] placeholder:text-neutral-300 focus:outline-none focus:border-neutral-400 transition-colors"
                                  style={{ fontFamily: FONT_MONO }}
                                />
                              </div>
                              <div className="relative">
                                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "rgba(62,61,57,0.25)" }} />
                                <input
                                  type="password"
                                  placeholder="lösenord (min 6 tecken)"
                                  value={formData.password}
                                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                  className="w-full px-4 py-3.5 pl-11 rounded-2xl bg-neutral-50 border border-neutral-200 text-neutral-900 text-[14px] placeholder:text-neutral-300 focus:outline-none focus:border-neutral-400 transition-colors"
                                  style={{ fontFamily: FONT_MONO }}
                                  required
                                  minLength={6}
                                />
                              </div>
                            </>
                          )}

                          <button
                            type="submit"
                            disabled={submitting}
                            className="w-full py-3.5 rounded-2xl text-white text-[13px] font-bold uppercase tracking-wider active:scale-[0.98] transition-transform disabled:opacity-40 flex items-center justify-center gap-2"
                            style={{
                              background: tier.color || "#E86C24",
                              fontFamily: FONT_MONO,
                            }}
                          >
                            {submitting ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : user ? (
                              "ANSÖK OM MEDLEMSKAP"
                            ) : (
                              "SKAPA KONTO & ANSÖK"
                            )}
                          </button>

                          <p className="text-[10px] text-center" style={{ color: "rgba(62,61,57,0.4)", fontFamily: FONT_MONO }}>
                            Medlemskapet aktiveras av personalen. Betalning sker i desken.
                          </p>
                        </form>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Already have account */}
        {!user && (
          <motion.div variants={item} className="text-center">
            <button
              onClick={() => navigate("/auth?redirect=/membership")}
              className="text-[12px] font-bold underline underline-offset-4"
              style={{ color: "rgba(62,61,57,0.5)", fontFamily: FONT_MONO }}
            >
              Har du redan ett konto? Logga in
            </button>
          </motion.div>
        )}

        {/* Info */}
        <motion.div
          variants={item}
          className="rounded-2xl p-5 text-center"
          style={{ background: "rgba(62,61,57,0.03)", border: "1.5px solid rgba(62,61,57,0.08)" }}
        >
          <p className="text-[12px]" style={{ color: "rgba(62,61,57,0.5)", fontFamily: FONT_MONO }}>
            Frågor? Kontakta oss via{" "}
            <a
              href="https://chat.whatsapp.com/HL1XcYaNFSuE56q7MqCpdw"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold"
              style={{ color: "#25D366" }}
            >
              WhatsApp
            </a>
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default MembershipPage;
