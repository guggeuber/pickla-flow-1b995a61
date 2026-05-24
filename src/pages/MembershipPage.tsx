import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Loader2, Mail, Lock, User, Phone, Check, Star, Zap, Crown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { apiPost } from "@/lib/api";
import { toast } from "sonner";
import picklaLogo from "@/assets/pickla-logo.svg";

const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.1 } } };
const item = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 260, damping: 24 } } };

type TierPricing = {
  product_type: string;
  fixed_price: number | null;
  discount_percent?: number | null;
  label?: string | null;
};

type TierEntitlement = {
  entitlement_type: string;
  value: number;
  period?: string | null;
  sport_type?: string | null;
};

type MembershipTier = {
  id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  sort_order?: number | null;
  discount_percent?: number | null;
  monthly_price?: number | null;
  membership_tier_pricing?: TierPricing[] | null;
  membership_entitlements?: TierEntitlement[] | null;
};

function useVenue(slug: string) {
  return useQuery({
    queryKey: ["membership-venue", slug],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("venues")
        .select("id, name, slug")
        .eq("slug", slug)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

function useMembershipTiers(venueId?: string) {
  return useQuery({
    queryKey: ["membership-tiers-full", venueId],
    enabled: !!venueId,
    staleTime: 60000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("membership_tiers")
        .select(`
          *,
          membership_tier_pricing(product_type, fixed_price, discount_percent, label),
          membership_entitlements(entitlement_type, value, period, sport_type)
        `)
        .eq("venue_id", venueId!)
        .eq("is_active", true)
        .order("sort_order", { ascending: true });

      if (error) throw error;
      return (data || []) as MembershipTier[];
    },
  });
}

function useActiveMembership(venueId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-membership", user?.id, venueId],
    enabled: !!user && !!venueId,
    staleTime: 30000,
    queryFn: async () => {
      const { data } = await supabase
        .from("memberships")
        .select("id, tier_id, membership_tiers(name)")
        .eq("user_id", user!.id)
        .eq("venue_id", venueId!)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      return data;
    },
  });
}

function usePlayerProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["player-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("player_profiles")
        .select("display_name, phone")
        .eq("auth_user_id", user!.id)
        .maybeSingle();
      return data;
    },
  });
}

const formatAmount = (value: number) => {
  if (Number.isInteger(value)) return String(value);
  return value.toLocaleString("sv-SE", { maximumFractionDigits: 1 });
};

// Build benefit list from actual tier configuration, not marketing filler.
function getTierBenefits(tier: MembershipTier): string[] {
  const benefits: string[] = [];
  const pricing = tier.membership_tier_pricing || [];
  const entitlements = tier.membership_entitlements || [];

  const courtHours = entitlements.find((e) => e.entitlement_type === "court_hours_per_week");
  const openPlay = entitlements.find((e) => e.entitlement_type === "open_play_unlimited");
  const guestVouchers = entitlements.find((e) => e.entitlement_type === "guest_day_vouchers_monthly");

  if (courtHours?.value) {
    benefits.push(`${formatAmount(courtHours.value)} fria ban-timmar per vecka`);
  }
  if (openPlay?.value) {
    benefits.push("Open Play ingår");
  }
  if (guestVouchers?.value) {
    benefits.push(`${formatAmount(guestVouchers.value)} gästpass per månad`);
  }

  const dayPass = pricing.find((p) => ["day_pass", "day_access"].includes(p.product_type));
  const openPlaySlot = pricing.find((p) => p.product_type === "open_play_slot");
  const training = pricing.find((p) => ["event_fee", "group_training", "group_training_day_access"].includes(p.product_type));
  const courtHourly = pricing.find((p) => ["court_hourly", "court_booking"].includes(p.product_type));

  if (dayPass) {
    if (dayPass.fixed_price === 0) benefits.push("Dagspass ingår");
    else if (dayPass.fixed_price != null) benefits.push(`Dagspass för bara ${Math.round(dayPass.fixed_price)} kr`);
    else if (dayPass.discount_percent) benefits.push(`${dayPass.discount_percent}% rabatt på dagspass`);
  }
  if (openPlaySlot) {
    if (openPlaySlot.fixed_price === 0) benefits.push("Open Play-pass ingår");
    else if (openPlaySlot.fixed_price != null) benefits.push(`Open Play från ${Math.round(openPlaySlot.fixed_price)} kr`);
    else if (openPlaySlot.discount_percent) benefits.push(`${openPlaySlot.discount_percent}% rabatt på Open Play`);
  }
  if (training) {
    if (training.fixed_price === 0) benefits.push("Gruppträning ingår");
    else if (training.fixed_price != null) benefits.push(`Gruppträning från ${Math.round(training.fixed_price)} kr`);
    else if (training.discount_percent) benefits.push(`${training.discount_percent}% rabatt på träning/event`);
  }
  if (courtHourly) {
    if (courtHourly.discount_percent) benefits.push(`${courtHourly.discount_percent}% rabatt på banbokning`);
    else if (courtHourly.fixed_price != null) benefits.push(`Boka bana för ${Math.round(courtHourly.fixed_price)} kr/h`);
  }

  return benefits.slice(0, 6);
}

function getTierTerms(tier: MembershipTier): string[] {
  const monthlyPrice = Number(tier.monthly_price || 0);
  if (monthlyPrice > 0) {
    return [
      "Betalning hanteras säkert via Stripe.",
      "Förmåner gäller enligt medlemskapets villkor och aktiveras efter genomförd betalning.",
      "Medlemskapet förnyas månadsvis om inget annat anges i villkoren.",
    ];
  }
  return [
    "Det här medlemskapet kräver manuell aktivering av Pickla.",
    "Ingen betalning tas i detta flöde.",
  ];
}

const TIER_ICONS = [Star, Zap, Crown];
const MembershipPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, signUp } = useAuth();
  const slug = searchParams.get("v") || "pickla-arena-sthlm";
  const { data: venue, isLoading: isVenueLoading } = useVenue(slug);
  const { data: tiers, isLoading } = useMembershipTiers(venue?.id);
  const { data: activeMembership } = useActiveMembership(venue?.id);
  const { data: profile } = usePlayerProfile();
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: "", email: "", phone: "", password: "" });
  const [submitting, setSubmitting] = useState(false);

  const hasMembership = !!activeMembership;
  const profilePhone = profile?.phone || "";

  useEffect(() => {
    if (profilePhone && !formData.phone) {
      setFormData((current) => ({ ...current, phone: profilePhone }));
    }
  }, [profilePhone, formData.phone]);

  const handleSignupAndRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTierId) return;

    const tier = (tiers || []).find((t) => t.id === selectedTierId);
    if (!tier) return;

    setSubmitting(true);
    try {
      // For free tiers: skip Stripe, keep manual activation flow
      if (!tier.monthly_price || tier.monthly_price <= 0) {
        toast.success("Tack! Vi kontaktar dig för att aktivera ditt kostnadsfria medlemskap.");
        setSelectedTierId(null);
        setSubmitting(false);
        return;
      }

      // For paid tiers: create account if needed, then redirect to Stripe
      let userId = user?.id || "";
      if (!user) {
        if (!formData.name.trim() || !formData.email.trim()) {
          toast.error("Ange namn och e-post");
          setSubmitting(false);
          return;
        }
        const { error } = await signUp(formData.email, formData.password, formData.name);
        if (error) {
          toast.error(error.message);
          setSubmitting(false);
          return;
        }
        // useAuth state hasn't updated yet after signUp — fetch user directly
        const { data: { user: freshUser } } = await supabase.auth.getUser();
        userId = freshUser?.id || "";
      }

      const result = await apiPost("api-bookings", "create-checkout", {
        product_type: "membership",
        amount_sek: Math.round(tier.monthly_price),
        metadata: {
          tier_id:        tier.id,
          tier_name:      tier.name,
          user_id:        userId,
          customer_name:  user ? "" : formData.name.trim(),
          customer_email: user ? (user.email || "") : formData.email.trim(),
          customer_phone: formData.phone.trim(),
          slug,
        },
      });
      window.location.href = result.url;
    } catch (err: any) {
      toast.error(err.message || "Något gick fel, försök igen.");
      setSubmitting(false);
    }
  };

  const bestValueIndex = tiers && tiers.length > 1 ? tiers.length - 1 : -1;

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

      <motion.div variants={container} initial="hidden" animate="show" className="px-5 pb-12 flex flex-col gap-5">
        {/* Hero section */}
        <motion.div variants={item} className="text-center pt-2 pb-1">
          <h1 className="text-[26px] font-black tracking-tight" style={{ fontFamily: FONT_HEADING }}>
            Spela mer. Betala mindre.
          </h1>
          <p className="text-[13px] mt-2 leading-relaxed" style={{ color: "rgba(62,61,57,0.55)", fontFamily: FONT_MONO }}>
            Medlemskap, fria timmar, Open Play och medlemspriser samlat på ditt konto.
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
        {isVenueLoading || isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: "#3E3D39" }} />
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {(tiers || []).map((tier, idx: number) => {
              const isSelected = selectedTierId === tier.id;
              const benefits = getTierBenefits(tier);
              const terms = getTierTerms(tier);
              const isBestValue = idx === bestValueIndex;
              const TierIcon = TIER_ICONS[Math.min(idx, TIER_ICONS.length - 1)];
              const tierColor = tier.color || "#E86C24";
              const monthlyPrice = Number(tier.monthly_price || 0);
              const isPaidTier = monthlyPrice > 0;

              return (
                <motion.div key={tier.id} variants={item} className="relative">
                  {/* Badge above card */}
                  {isBestValue && (
                    <div className="flex justify-center -mb-3 relative z-10">
                      <span
                        className="px-4 py-1 rounded-full text-[11px] font-black uppercase tracking-widest text-white"
                        style={{ background: tierColor, fontFamily: FONT_MONO }}
                      >
                        Mest värde
                      </span>
                    </div>
                  )}

                  <div
                    className="rounded-2xl overflow-hidden transition-all"
                    style={{
                      border: `2px solid ${isBestValue ? tierColor + "50" : "rgba(62,61,57,0.08)"}`,
                      boxShadow: isBestValue
                        ? `0 8px 32px ${tierColor}20, 0 2px 8px rgba(0,0,0,0.04)`
                        : "0 2px 12px rgba(0,0,0,0.04)",
                    }}
                  >
                    {/* Card header */}
                    <div className="p-5 pb-4">
                      <div className="flex items-center gap-3 mb-3">
                        <div
                          className="w-11 h-11 rounded-xl flex items-center justify-center"
                          style={{ background: `${tierColor}15` }}
                        >
                          <TierIcon className="w-5 h-5" style={{ color: tierColor }} />
                        </div>
                        <div>
                          <p className="text-[17px] font-black tracking-tight" style={{ fontFamily: FONT_HEADING }}>
                            {tier.name}
                          </p>
                          {tier.description && (
                            <p className="text-[11px]" style={{ color: "rgba(62,61,57,0.5)", fontFamily: FONT_MONO }}>
                              {tier.description}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Benefits list */}
                      <div className="space-y-2.5 mt-4">
                        {benefits.length > 0 ? (
                          benefits.map((benefit, i) => (
                            <div key={i} className="flex items-start gap-2.5">
                              <Check
                                className="w-4 h-4 flex-shrink-0 mt-0.5"
                                style={{ color: tierColor }}
                                strokeWidth={3}
                              />
                              <p className="text-[13px] leading-snug" style={{ fontFamily: FONT_HEADING, color: "#3E3D39" }}>
                                {benefit}
                              </p>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-2xl px-4 py-3" style={{ background: "rgba(62,61,57,0.04)" }}>
                            <p className="text-[12px] leading-relaxed" style={{ color: "rgba(62,61,57,0.58)", fontFamily: FONT_MONO }}>
                              Pickla uppdaterar förmånerna för detta medlemskap. Kontakta oss om du vill köpa detta idag.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* CTA section */}
                    {!hasMembership && (
                      <div className="px-5 pb-5">
                        <button
                          onClick={() => setSelectedTierId(isSelected ? null : tier.id)}
                          className="w-full py-4 rounded-2xl text-white text-[14px] font-black uppercase tracking-wider active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                          style={{
                            background: tierColor,
                            fontFamily: FONT_MONO,
                            boxShadow: `0 4px 16px ${tierColor}40`,
                          }}
                        >
                          {isSelected
                            ? "VALT – FYLL I NEDAN"
                            : isPaidTier
                            ? `${Math.round(monthlyPrice)} KR/MÅN – VÄLJ`
                            : "VÄLJ MEDLEMSKAP"}
                        </button>

                        {isPaidTier && (
                          <p className="text-[10px] text-center mt-2" style={{ color: "rgba(62,61,57,0.4)", fontFamily: FONT_MONO }}>
                            Betalning sker säkert via Stripe.
                          </p>
                        )}
                        {!isPaidTier && (
                          <p className="text-[10px] text-center mt-2" style={{ color: "rgba(62,61,57,0.4)", fontFamily: FONT_MONO }}>
                            Aktiveras manuellt av Pickla.
                          </p>
                        )}
                      </div>
                    )}
                  </div>

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
                              {profilePhone ? (
                                <div className="flex items-center gap-2 rounded-2xl bg-neutral-50 border border-neutral-200 px-4 py-3.5">
                                  <Phone className="w-4 h-4 shrink-0" style={{ color: "rgba(62,61,57,0.35)" }} />
                                  <span className="text-[13px]" style={{ fontFamily: FONT_MONO, color: "rgba(62,61,57,0.65)" }}>
                                    {profilePhone}
                                  </span>
                                </div>
                              ) : (
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
                              )}
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
                              background: tierColor,
                              fontFamily: FONT_MONO,
                            }}
                          >
                            {submitting ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : user ? (
                              isPaidTier ? "BETALA MED STRIPE" : "SKICKA INTRESSE"
                            ) : isPaidTier ? (
                              "SKAPA KONTO & BETALA"
                            ) : (
                              "SKAPA KONTO & SKICKA"
                            )}
                          </button>

                          <div className="rounded-2xl px-4 py-3" style={{ background: "rgba(62,61,57,0.035)" }}>
                            <p className="text-[10px] leading-relaxed" style={{ color: "rgba(62,61,57,0.5)", fontFamily: FONT_MONO }}>
                              {terms.join(" ")} Genom att fortsätta godkänner du Picklas köp- och medlemsvillkor.
                            </p>
                          </div>
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
              onClick={() => navigate(`/auth?redirect=${encodeURIComponent(`/membership?v=${slug}`)}`)}
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
