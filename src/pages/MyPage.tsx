import { useState } from "react";

declare const __BUILD_TIME__: string;
import { motion, AnimatePresence } from "framer-motion";
import { Calendar, Ticket, LogOut, Loader2, Check, Pencil, Save, Phone, Gift, Copy, Send, Trash2, ShoppingBag, Building2, ChevronRight, CreditCard, Plus, Bell, ChevronDown, Sparkles, Share2, X } from "lucide-react";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { QRCodeSVG } from "qrcode.react";
import { PlayerNav } from "@/components/PlayerNav";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { subscribeToPush } from "@/lib/push";
import picklaLogo from "@/assets/pickla-logo.svg";

const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

// Brand colors for player-facing light theme
const BLUE = "#0066FF";
const BLUE_LIGHT = "rgba(0,102,255,0.08)";
const BLUE_BORDER = "rgba(0,102,255,0.15)";
const GREEN = "#22C55E";
const GREEN_LIGHT = "rgba(34,197,94,0.08)";
const GREEN_BORDER = "rgba(34,197,94,0.15)";
const TEXT_PRIMARY = "#111827";
const TEXT_SECONDARY = "#6B7280";
const TEXT_MUTED = "#9CA3AF";
const CARD_BG = "#FFFFFF";
const CARD_BORDER = "#E5E7EB";
const PAGE_BG = "#F8FAFC";

type PlayerProfileContact = {
  phone?: string | null;
};

type MyEventSummary = {
  id: string;
  name: string | null;
  display_name: string | null;
  slug: string | null;
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string | null;
  venues?: { name: string | null } | null;
};

type MyEventRegistration = {
  id: string;
  event_id: string;
  name: string;
  email: string | null;
  auth_user_id: string | null;
  created_at: string | null;
  events: MyEventSummary | null;
};

function usePlayerProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["player-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_profiles")
        .select("*")
        .eq("auth_user_id", user!.id)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

function useMyBookings() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-bookings", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("*, venue_courts(name)")
        .eq("user_id", user!.id)
        .order("start_time", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });
}

function getEventDateTime(event?: MyEventSummary | null, end = false) {
  const date = (end ? event?.end_date : event?.start_date) || event?.start_date || event?.end_date;
  const time = (end ? event?.end_time : event?.start_time) || event?.start_time || event?.end_time;
  if (!date) return null;

  const datePart = String(date).slice(0, 10);
  return new Date(time ? `${datePart}T${time}` : `${datePart}T${end ? "23:59:59" : "00:00:00"}`);
}

function useMyEventRegistrations(profile?: PlayerProfileContact | null) {
  const { user } = useAuth();
  return useQuery<MyEventRegistration[]>({
    queryKey: ["my-event-registrations", user?.id, user?.email, profile?.phone],
    enabled: !!user,
    queryFn: async () => {
      const selectFields = "id, event_id, name, email, auth_user_id, created_at, events(id, name, display_name, slug, start_date, end_date, start_time, end_time, status, venues(name))";
      const queries = [
        supabase.from("players").select(selectFields).eq("auth_user_id", user!.id),
      ];

      if (user?.email) {
        queries.push(supabase.from("players").select(selectFields).eq("email", user.email));
      }

      if (profile?.phone) {
        queries.push(supabase.from("players").select(selectFields).eq("email", profile.phone));
      }

      const results = await Promise.all(queries);
      const firstError = results.find((result) => result.error)?.error;
      if (firstError) throw firstError;

      const seen = new Set<string>();
      return results
        .flatMap((result) => (result.data || []) as unknown as MyEventRegistration[])
        .filter((registration) => {
          if (seen.has(registration.id)) return false;
          seen.add(registration.id);
          return true;
        })
        .sort((a, b) => {
          const aTime = getEventDateTime(a.events)?.getTime() ?? 0;
          const bTime = getEventDateTime(b.events)?.getTime() ?? 0;
          return bTime - aTime;
        });
    },
  });
}

function useMyPasses() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-passes", user?.id],
    enabled: !!user,
    staleTime: 10000,
    queryFn: () => apiGet("api-day-passes", "my-passes"),
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
        .select("id, tier_id, status, starts_at, expires_at, membership_tiers(name, color, description, monthly_price, membership_tier_pricing(product_type, fixed_price, discount_percent, label), membership_entitlements(entitlement_type, value, period, sport_type))")
        .eq("user_id", user!.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });
}

function useCorporateMemberships() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-corporate", user?.id],
    enabled: !!user,
    staleTime: 30000,
    queryFn: () => apiGet("api-corporate", "my"),
  });
}

function CorporateSection() {
  const { data } = useCorporateMemberships();
  const navigate = useNavigate();

  if (!data?.memberships?.length) return null;

  return (
    <motion.div variants={item}>
      <div className="flex items-center gap-2 mb-2">
        <Building2 className="w-4 h-4" style={{ color: BLUE }} />
        <span className="text-sm font-semibold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>Företag</span>
      </div>
      <div className="flex flex-col gap-2">
        {data.memberships.map((m: any) => {
          const account = m.corporate_accounts;
          const pkg = data.packages?.find((p: any) => p.corporate_account_id === account?.id);
          const remaining = pkg ? pkg.total_hours - pkg.used_hours : null;

          return (
            <button
              key={m.id}
              onClick={() => {
                if (m.role === 'admin') {
                  navigate(`/corp/dashboard?id=${account?.id}`);
                }
              }}
              className="rounded-xl p-3 flex items-center justify-between text-left active:scale-[0.98] transition-transform"
              style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}` }}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: BLUE_LIGHT }}>
                  <Building2 className="w-4 h-4" style={{ color: BLUE }} />
                </div>
                <div>
                  <p className="text-sm font-medium" style={{ color: TEXT_PRIMARY }}>{account?.company_name || "Företag"}</p>
                  <p className="text-[11px]" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
                    {m.role === 'admin' ? 'Admin' : 'Medlem'}
                    {remaining !== null && ` · ${remaining}h kvar`}
                  </p>
                </div>
              </div>
              {m.role === 'admin' && <ChevronRight className="w-4 h-4" style={{ color: TEXT_MUTED }} />}
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08 } } };
const item = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } };

function formatMembershipBenefit(entitlement: any) {
  const sportLabel = entitlement.sport_type && entitlement.sport_type !== "pickleball" ? ` (${entitlement.sport_type})` : "";

  switch (entitlement.entitlement_type) {
    case "court_hours_per_week":
      return `${entitlement.value || 0}h banbokning per vecka${sportLabel}`;
    case "open_play_unlimited":
      return `Obegränsad open play${sportLabel}`;
    case "free_day_pass_monthly":
      return `${entitlement.value || 1} gratis dagspass per månad${sportLabel}`;
    case "court_discount_pct":
      return `${entitlement.value || 0}% rabatt på banbokning${sportLabel}`;
    case "day_pass_discount_pct":
      return `${entitlement.value || 0}% rabatt på dagspass${sportLabel}`;
    default:
      return entitlement.entitlement_type?.replaceAll("_", " ") || "Medlemsförmån";
  }
}

function formatTierPricingBenefit(pricing: any) {
  const label = pricing.label || {
    court_hourly: "Bana per timme",
    day_pass: "Dagspass",
    event_fee: "Event-avgift",
    guest_pass: "Gästpass",
  }[pricing.product_type] || pricing.product_type;

  if (pricing.fixed_price != null) {
    return `${label}: ${Math.round(Number(pricing.fixed_price))} kr`;
  }

  if (pricing.discount_percent) {
    return `${label}: ${pricing.discount_percent}% rabatt`;
  }

  return label;
}

function MembershipDetailsSheet({
  membership,
  open,
  onOpenChange,
}: {
  membership: any | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState(false);

  if (!membership) return null;

  const tier = membership.membership_tiers;
  const tierPricing = tier?.membership_tier_pricing || [];
  const entitlements = tierPricing.length > 0 ? [] : (tier?.membership_entitlements || []);
  const startsAt = membership.starts_at ? new Date(membership.starts_at) : null;
  const expiresAt = membership.expires_at ? new Date(membership.expires_at) : null;
  const nextBillingDate = expiresAt || (startsAt ? new Date(startsAt.getFullYear(), startsAt.getMonth() + 1, startsAt.getDate()) : null);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await apiPost("api-memberships", "cancel", { membershipId: membership.id });
    } catch {
      setCancelling(false);
      toast.error("Kunde inte avsluta medlemskapet. Kontakta personalen så hjälper vi dig.");
      return;
    }
    setCancelling(false);

    toast.success("Medlemskapet är avslutat");
    queryClient.invalidateQueries({ queryKey: ["my-membership"] });
    onOpenChange(false);
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent style={{ background: CARD_BG }}>
        <div className="px-5 pb-6 pt-2 max-w-md mx-auto w-full">
          <p className="text-xs uppercase tracking-wider mb-1" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
            Medlemskap
          </p>
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0" style={{ background: `${tier?.color || GREEN}20` }}>
              <Sparkles className="w-5 h-5" style={{ color: tier?.color || GREEN }} />
            </div>
            <div>
              <p className="text-xl font-bold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>{tier?.name || "Medlem"}</p>
              <p className="text-sm mt-1" style={{ color: TEXT_SECONDARY }}>{tier?.description || "Aktivt medlemskap"}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-5">
            <div className="rounded-xl p-3" style={{ background: PAGE_BG, border: `1px solid ${CARD_BORDER}` }}>
              <p className="text-[10px] uppercase tracking-wider" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>Pris</p>
              <p className="text-sm font-bold mt-1" style={{ color: TEXT_PRIMARY }}>
                {tier?.monthly_price ? `${Math.round(tier.monthly_price)} kr/mån` : "Ingår"}
              </p>
            </div>
            <div className="rounded-xl p-3" style={{ background: PAGE_BG, border: `1px solid ${CARD_BORDER}` }}>
              <p className="text-[10px] uppercase tracking-wider" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>Nästa dragning</p>
              <p className="text-sm font-bold mt-1" style={{ color: TEXT_PRIMARY }}>
                {nextBillingDate ? nextBillingDate.toLocaleDateString("sv-SE", { day: "numeric", month: "short" }) : "Ej satt"}
              </p>
            </div>
          </div>

          <div className="mt-5">
            <p className="text-sm font-semibold mb-2" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>Förmåner</p>
            <div className="flex flex-col gap-2">
              {tierPricing.length > 0 ? tierPricing.map((pricing: any, idx: number) => (
                <div key={`${pricing.product_type}-${idx}`} className="flex items-start gap-2 rounded-xl px-3 py-2" style={{ background: GREEN_LIGHT, border: `1px solid ${GREEN_BORDER}` }}>
                  <Check className="w-4 h-4 shrink-0 mt-0.5" style={{ color: GREEN }} />
                  <p className="text-sm" style={{ color: TEXT_PRIMARY }}>{formatTierPricingBenefit(pricing)}</p>
                </div>
              )) : entitlements.length > 0 ? entitlements.map((entitlement: any, idx: number) => (
                <div key={`${entitlement.entitlement_type}-${idx}`} className="flex items-start gap-2 rounded-xl px-3 py-2" style={{ background: GREEN_LIGHT, border: `1px solid ${GREEN_BORDER}` }}>
                  <Check className="w-4 h-4 shrink-0 mt-0.5" style={{ color: GREEN }} />
                  <p className="text-sm" style={{ color: TEXT_PRIMARY }}>{formatMembershipBenefit(entitlement)}</p>
                </div>
              )) : (
                <p className="text-xs" style={{ color: TEXT_MUTED }}>Inga förmåner är konfigurerade ännu.</p>
              )}
            </div>
          </div>

          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="w-full mt-6 py-3 rounded-xl text-sm font-bold active:scale-[0.98] transition-transform disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.18)", color: "#EF4444", fontFamily: FONT_HEADING }}
          >
            {cancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : "Avsluta medlemskap"}
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function ProfileCard({ profile, user, displayName }: { profile: any; user: any; displayName: string }) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(displayName);
  const [editPhone, setEditPhone] = useState(profile?.phone || "");
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("player_profiles")
      .update({ display_name: editName.trim(), phone: editPhone.trim() })
      .eq("auth_user_id", user.id);
    setSaving(false);
    if (error) {
      toast.error("Kunde inte spara");
    } else {
      toast.success("Uppgifter sparade");
      queryClient.invalidateQueries({ queryKey: ["player-profile"] });
      setEditing(false);
    }
  };

  return (
    <motion.div
      variants={item}
      className="rounded-2xl p-5"
      style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}`, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center shrink-0"
          style={{ background: BLUE_LIGHT }}
        >
          <span className="text-lg font-bold" style={{ color: BLUE }}>
            {displayName.charAt(0).toUpperCase()}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="flex flex-col gap-2">
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="text-sm rounded-lg px-3 py-1.5 outline-none"
                placeholder="Namn"
                style={{ fontFamily: FONT_HEADING, background: PAGE_BG, border: `1px solid ${CARD_BORDER}`, color: TEXT_PRIMARY }}
              />
              <div className="flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 shrink-0" style={{ color: TEXT_MUTED }} />
                <input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="text-sm rounded-lg px-3 py-1.5 outline-none flex-1"
                  placeholder="Telefonnummer"
                  style={{ fontFamily: FONT_MONO, background: PAGE_BG, border: `1px solid ${CARD_BORDER}`, color: TEXT_PRIMARY }}
                />
              </div>
            </div>
          ) : (
            <div className="min-w-0">
              <p className="font-semibold truncate" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>{displayName}</p>
              <p className="text-xs truncate" style={{ color: TEXT_MUTED }}>{user.email}</p>
              {profile?.phone && (
                <p className="text-xs mt-0.5" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>{profile.phone}</p>
              )}
            </div>
          )}
        </div>

        {/* Compact QR membership card */}
        {!editing && (
          <div
            className="rounded-xl p-1.5 shrink-0 bg-white"
            style={{ border: `1.5px solid ${CARD_BORDER}`, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
            title="Min incheckning"
          >
            <QRCodeSVG
              value={JSON.stringify({ type: "pickla_user", uid: user.id })}
              size={52}
              level="M"
              bgColor="#ffffff"
              fgColor="#1a1e2e"
            />
          </div>
        )}

        {editing ? (
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={handleSave}
            disabled={saving}
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: BLUE_LIGHT }}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: TEXT_MUTED }} /> : <Save className="w-4 h-4" style={{ color: BLUE }} />}
          </motion.button>
        ) : (
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => { setEditName(displayName); setEditPhone(profile?.phone || ""); setEditing(true); }}
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: PAGE_BG, border: `1px solid ${CARD_BORDER}` }}
          >
            <Pencil className="w-4 h-4" style={{ color: TEXT_MUTED }} />
          </motion.button>
        )}
      </div>
    </motion.div>
  );
}

function BookingDetailsSheet({
  booking,
  open,
  onOpenChange,
}: {
  booking: any | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  if (!booking) return null;

  const courtName = booking.venue_courts?.name || "Bana";
  const start = new Date(booking.start_time);
  const end = new Date(booking.end_time);
  const dateLabel = start.toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long" });
  const timeLabel = `${start.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}–${end.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}`;

  const handleCancel = async () => {
    setCancelling(true);
    const { error } = await supabase
      .from("bookings")
      .update({ status: "cancelled" })
      .eq("id", booking.id);
    setCancelling(false);
    if (error) {
      toast.error("Kunde inte avboka");
    } else {
      toast.success("Bokningen är avbokad");
      queryClient.invalidateQueries({ queryKey: ["my-bookings"] });
      onOpenChange(false);
      setConfirmCancel(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setConfirmCancel(false); }}>
      <DrawerContent style={{ background: CARD_BG }}>
        <div className="px-5 pb-6 pt-2 max-w-md mx-auto w-full">
          <p className="text-xs uppercase tracking-wider mb-1" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
            Bokning
          </p>
          <p className="text-xl font-bold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>{courtName}</p>
          <p className="text-sm mt-1" style={{ color: TEXT_SECONDARY }}>{dateLabel}</p>
          <p className="text-sm" style={{ fontFamily: FONT_MONO, color: TEXT_SECONDARY }}>{timeLabel}</p>
          {booking.access_code && (
            <div className="mt-3 rounded-xl px-3 py-2 inline-flex items-center gap-2" style={{ background: BLUE_LIGHT, border: `1px solid ${BLUE_BORDER}` }}>
              <span className="text-[10px] uppercase tracking-wider" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>Kod</span>
              <span className="text-base font-bold" style={{ fontFamily: FONT_MONO, color: BLUE }}>{booking.access_code}</span>
            </div>
          )}

          <div className="flex flex-col gap-2 mt-5">
            <button
              onClick={() => { onOpenChange(false); navigate(`/hub?booking=${encodeURIComponent(booking.booking_ref || booking.id)}`); }}
              className="w-full py-3 rounded-xl text-white text-sm font-bold active:scale-[0.98] transition-transform"
              style={{ background: BLUE, fontFamily: FONT_HEADING }}
            >
              Gå till chatt
            </button>
            <button
              onClick={() => { onOpenChange(false); navigate(`/b/${booking.access_code || booking.id}`); }}
              className="w-full py-3 rounded-xl text-sm font-bold active:scale-[0.98] transition-transform"
              style={{ background: PAGE_BG, border: `1px solid ${CARD_BORDER}`, color: TEXT_PRIMARY, fontFamily: FONT_HEADING }}
            >
              Visa kvitto
            </button>
            {confirmCancel ? (
              <div className="rounded-xl p-3 flex flex-col gap-2" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}>
                <p className="text-xs text-center" style={{ color: TEXT_SECONDARY }}>Säker på att du vill avboka?</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmCancel(false)}
                    className="flex-1 py-2.5 rounded-lg text-xs font-bold"
                    style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}`, color: TEXT_PRIMARY, fontFamily: FONT_HEADING }}
                  >
                    Behåll
                  </button>
                  <button
                    onClick={handleCancel}
                    disabled={cancelling}
                    className="flex-1 py-2.5 rounded-lg text-xs font-bold text-white disabled:opacity-50 flex items-center justify-center"
                    style={{ background: "#EF4444", fontFamily: FONT_HEADING }}
                  >
                    {cancelling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Ja, avboka"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmCancel(true)}
                className="w-full py-3 rounded-xl text-sm font-bold active:scale-[0.98] transition-transform"
                style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", color: "#EF4444", fontFamily: FONT_HEADING }}
              >
                Avboka
              </button>
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function DayPassSection() {
  const { data, isLoading } = useMyPasses();
  const queryClient = useQueryClient();
  const [sharingPassId, setSharingPassId] = useState<string | null>(null);
  const [recipientName, setRecipientName] = useState("");
  const [sharing, setSharing] = useState(false);
  const [justCreatedGift, setJustCreatedGift] = useState<{ token: string; recipientName: string } | null>(null);

  const passes = data?.passes || [];
  const allowance = data?.allowance || { has_membership: false, passes_allowed: 0, passes_remaining: 0 };

  const activePasses = passes.filter((p: any) => p.status === 'active' && !p.share);
  const sharedPasses = passes.filter((p: any) => p.share?.status === 'pending');

  const buildLink = (token: string) => `${window.location.origin}/pass/${token}`;
  const getRecipientLabel = (share: any) => share?.recipient_name || share?.recipient_email || "en vän";
  const buildGiftMessage = (token: string, name: string) =>
    `Jag har gett dig ett dagspass på Pickla, ${name}! Hämta det här: ${buildLink(token)}`;

  const handleShare = async (dayPassId: string) => {
    const name = recipientName.trim();
    if (!name) { toast.error("Skriv vem passet är till"); return; }
    setSharing(true);
    try {
      const result = await apiPost("api-day-passes", "share", {
        day_pass_id: dayPassId,
        recipient_name: name,
      });
      setJustCreatedGift({ token: result.token, recipientName: name });
      setRecipientName("");
      setSharingPassId(null);
      queryClient.invalidateQueries({ queryKey: ["my-passes"] });
      toast.success("Gåvolänk skapad! Dela den med din vän.");
    } catch (err: any) {
      toast.error(err.message || "Kunde inte skapa gåvolänk");
    }
    setSharing(false);
  };

  const handleRevoke = async (shareId: string) => {
    try {
      await apiDelete("api-day-passes", "revoke-share", { id: shareId });
      queryClient.invalidateQueries({ queryKey: ["my-passes"] });
      toast.success("Delning borttagen");
    } catch (err: any) {
      toast.error(err.message || "Kunde inte ta bort delningen");
    }
  };

  const copyGiftMessage = (token: string, name: string) => {
    navigator.clipboard.writeText(buildGiftMessage(token, name));
    toast.success("Meddelande kopierat!");
  };

  const shareGift = async (token: string, name: string) => {
    const url = buildLink(token);
    const text = buildGiftMessage(token, name);

    if (navigator.share) {
      try {
        await navigator.share({ title: `Dagspass till ${name}`, text, url });
        return;
      } catch {
        return;
      }
    }

    copyGiftMessage(token, name);
  };

  if (isLoading) {
    return (
      <motion.div variants={item} className="flex justify-center py-4">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: TEXT_MUTED }} />
      </motion.div>
    );
  }

  return (
    <motion.div variants={item}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Ticket className="w-4 h-4" style={{ color: BLUE }} />
          <span className="text-sm font-semibold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>Mina dagspass</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: BLUE_LIGHT, color: BLUE }}>
            {activePasses.length}
          </span>
        </div>
      </div>

      {/* Member allowance info */}
      {allowance.has_membership && allowance.passes_allowed > 0 && (
        <div className="rounded-xl px-3 py-2 mb-3 flex items-center gap-2" style={{ background: GREEN_LIGHT, border: `1px solid ${GREEN_BORDER}` }}>
          <Gift className="w-3.5 h-3.5 shrink-0" style={{ color: GREEN }} />
          <p className="text-[11px]" style={{ fontFamily: FONT_MONO, color: TEXT_SECONDARY }}>
            <span className="font-bold" style={{ color: TEXT_PRIMARY }}>{allowance.passes_remaining}</span> av {allowance.passes_allowed} gratispass kvar denna månad
          </p>
        </div>
      )}

      {/* Just created share link */}
      <AnimatePresence>
        {justCreatedGift && (
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="rounded-2xl p-3 mb-3"
            style={{ background: GREEN_LIGHT, border: `1px solid ${GREEN_BORDER}` }}
          >
            <div className="flex items-start gap-2">
              <Check className="w-4 h-4 shrink-0 mt-0.5" style={{ color: GREEN }} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>
                  Dagspass till {justCreatedGift.recipientName}
                </p>
                <p className="text-xs truncate mt-0.5" style={{ fontFamily: FONT_MONO, color: TEXT_SECONDARY }}>
                  {buildLink(justCreatedGift.token)}
                </p>
              </div>
              <button
                onClick={() => setJustCreatedGift(null)}
                className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 active:scale-95 transition-transform"
                style={{ background: CARD_BG, border: `1px solid ${GREEN_BORDER}` }}
                aria-label="Stäng gåvolänk"
              >
                <X className="w-3.5 h-3.5" style={{ color: TEXT_MUTED }} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <button
                onClick={() => copyGiftMessage(justCreatedGift.token, justCreatedGift.recipientName)}
                className="py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5"
                style={{ background: CARD_BG, border: `1px solid ${GREEN_BORDER}`, color: GREEN, fontFamily: FONT_MONO }}
              >
                <Copy className="w-3.5 h-3.5" /> Kopiera
              </button>
              <button
                onClick={() => shareGift(justCreatedGift.token, justCreatedGift.recipientName)}
                className="py-2 rounded-xl text-xs font-bold text-white flex items-center justify-center gap-1.5"
                style={{ background: GREEN, fontFamily: FONT_MONO }}
              >
                <Share2 className="w-3.5 h-3.5" /> Dela
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active passes */}
      {activePasses.length === 0 && sharedPasses.length === 0 ? (
        <div className="rounded-2xl p-4 text-center" style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}` }}>
          <p className="text-xs" style={{ color: TEXT_MUTED }}>Inga aktiva dagspass</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {activePasses.map((p: any) => (
            <div key={p.id}>
              <div className="rounded-xl p-3 flex items-center justify-between" style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}` }}>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium" style={{ color: TEXT_PRIMARY }}>Dagspass</p>
                    {p.is_free && (
                      <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold" style={{ background: GREEN_LIGHT, color: GREEN }}>GRATIS</span>
                    )}
                  </div>
                  <p className="text-xs" style={{ color: TEXT_MUTED }}>
                    {new Date(p.valid_date).toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" })}
                  </p>
                </div>
                {!p.is_free && <span className="text-xs font-bold mr-2" style={{ color: TEXT_SECONDARY }}>{p.price} SEK</span>}
                <button
                  onClick={() => { setSharingPassId(sharingPassId === p.id ? null : p.id); setRecipientName(""); setJustCreatedGift(null); }}
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: sharingPassId === p.id ? BLUE_LIGHT : PAGE_BG, border: `1px solid ${sharingPassId === p.id ? BLUE_BORDER : CARD_BORDER}` }}
                  aria-label="Ge bort dagspass"
                >
                  <Gift className="w-3.5 h-3.5" style={{ color: sharingPassId === p.id ? BLUE : TEXT_MUTED }} />
                </button>
              </div>

              {/* Share form inline */}
              <AnimatePresence>
                {sharingPassId === p.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="pt-2">
                      <p className="text-[11px] mb-2" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
                        Skapa en personlig gåvolänk att skicka via SMS, DM eller WhatsApp.
                      </p>
                      <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Namn, t.ex. Gösta"
                        value={recipientName}
                        onChange={(e) => setRecipientName(e.target.value)}
                        className="flex-1 px-3 py-2.5 rounded-xl text-xs outline-none"
                        style={{ fontFamily: FONT_MONO, background: PAGE_BG, border: `1px solid ${CARD_BORDER}`, color: TEXT_PRIMARY }}
                      />
                      <button
                        onClick={() => handleShare(p.id)}
                        disabled={sharing}
                        className="px-4 py-2.5 rounded-xl text-white text-xs font-bold active:scale-[0.98] transition-transform disabled:opacity-40"
                        style={{ background: BLUE, fontFamily: FONT_MONO }}
                      >
                        {sharing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Skapa"}
                      </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}

          {/* Shared (pending) passes */}
          {sharedPasses.length > 0 && (
            <div className="pt-1">
              <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>Delade pass</p>
              {sharedPasses.map((p: any) => (
                <div key={p.id} className="rounded-xl p-3 flex items-center gap-2 mb-1.5" style={{ background: BLUE_LIGHT, border: `1px solid ${BLUE_BORDER}` }}>
                  <Send className="w-3 h-3 shrink-0" style={{ color: BLUE }} />
                  <span className="text-xs truncate flex-1" style={{ fontFamily: FONT_MONO, color: TEXT_SECONDARY }}>
                    {getRecipientLabel(p.share)}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-bold shrink-0" style={{ background: BLUE_LIGHT, color: BLUE }}>
                    Väntande
                  </span>
                  {p.share?.token && (
                    <button
                      onClick={() => copyGiftMessage(p.share.token, getRecipientLabel(p.share))}
                      className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: PAGE_BG, border: `1px solid ${CARD_BORDER}` }}
                    >
                      <Copy className="w-3 h-3" style={{ color: TEXT_MUTED }} />
                    </button>
                  )}
                  {p.share && (
                    <button
                      onClick={() => handleRevoke(p.share.id)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}
                    >
                      <Trash2 className="w-3 h-3 text-red-400" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

const CARD_BRAND_LABEL: Record<string, string> = {
  visa: "Visa", mastercard: "Mastercard", amex: "Amex",
  discover: "Discover", jcb: "JCB", unionpay: "UnionPay",
};

function WalletSection() {
  const qc = useQueryClient();
  const [addingCard, setAddingCard] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["payment-methods"],
    queryFn: () => apiGet("api-stripe", "payment-methods"),
    staleTime: 60000,
  });

  const methods: any[] = data?.methods || [];

  const handleAddCard = async () => {
    setAddingCard(true);
    try {
      const { url } = await apiPost("api-stripe", "setup-session", {});
      if (url) window.location.href = url;
    } catch (err: any) {
      toast.error(err.message || "Kunde inte starta kortregistrering");
      setAddingCard(false);
    }
  };

  const handleRemoveCard = async (pmId: string) => {
    setRemovingId(pmId);
    try {
      await apiDelete("api-stripe", "payment-method", { pmId });
      qc.invalidateQueries({ queryKey: ["payment-methods"] });
      toast.success("Kort borttaget");
    } catch (err: any) {
      toast.error(err.message || "Kunde inte ta bort kort");
    }
    setRemovingId(null);
  };

  return (
    <motion.div variants={item}>
      <div className="flex items-center gap-2 mb-2">
        <CreditCard className="w-4 h-4" style={{ color: BLUE }} />
        <span className="text-sm font-semibold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>Wallet</span>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}` }}>
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-4 h-4 animate-spin" style={{ color: TEXT_MUTED }} />
          </div>
        ) : methods.length === 0 ? (
          <div className="px-4 py-4 text-center">
            <p className="text-xs" style={{ color: TEXT_MUTED }}>Inga sparade kort</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: CARD_BORDER }}>
            {methods.map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: PAGE_BG, border: `1px solid ${CARD_BORDER}` }}>
                  <CreditCard className="w-4 h-4" style={{ color: TEXT_MUTED }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium" style={{ color: TEXT_PRIMARY }}>
                    {CARD_BRAND_LABEL[m.brand] || m.brand} ···· {m.last4}
                  </p>
                  <p className="text-[11px]" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
                    {m.exp_month}/{String(m.exp_year).slice(-2)}
                  </p>
                </div>
                <button
                  onClick={() => handleRemoveCard(m.id)}
                  disabled={removingId === m.id}
                  className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}
                >
                  {removingId === m.id
                    ? <Loader2 className="w-3 h-3 animate-spin text-red-400" />
                    : <Trash2 className="w-3 h-3 text-red-400" />}
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={handleAddCard}
          disabled={addingCard}
          className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium active:bg-gray-50 transition-colors"
          style={{ borderTop: methods.length > 0 || !isLoading ? `1px solid ${CARD_BORDER}` : undefined, color: BLUE, fontFamily: FONT_HEADING }}
        >
          {addingCard ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Lägg till kort
        </button>
      </div>
    </motion.div>
  );
}

function SettingsSection() {
  const [searchParams] = useSearchParams();
  const venueSlug = searchParams.get("v") || "pickla-arena-sthlm";
  const { data: venueId } = useQuery({
    queryKey: ["venue-id-for-push", venueSlug],
    staleTime: Infinity,
    queryFn: async () => {
      const { data } = await supabase.from("venues").select("id").eq("slug", venueSlug).maybeSingle();
      return data?.id as string | undefined;
    },
  });

  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return "unsupported";
    return Notification.permission;
  });
  const [enabling, setEnabling] = useState(false);

  const handleEnablePush = async () => {
    setEnabling(true);
    const ok = await subscribeToPush(venueId);
    setEnabling(false);
    if (ok) {
      setPermission("granted");
      toast.success("Notiser aktiverade!");
    } else {
      setPermission(Notification.permission);
      if (Notification.permission === "denied") {
        toast.error("Notiser blockerade — ändra i Safari-inställningar");
      }
    }
  };

  if (permission === "unsupported") return null;

  return (
    <motion.div variants={item}>
      <div className="flex items-center gap-2 mb-2">
        <Bell className="w-4 h-4" style={{ color: TEXT_MUTED }} />
        <span className="text-sm font-semibold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>Inställningar</span>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}` }}>
        {permission === "granted" ? (
          <div className="flex items-center gap-2 px-4 py-3">
            <Check className="w-4 h-4 shrink-0" style={{ color: "#22C55E" }} />
            <span className="text-sm font-medium" style={{ color: "#22C55E", fontFamily: FONT_HEADING }}>
              Notiser aktiverade
            </span>
          </div>
        ) : permission === "denied" ? (
          <div className="flex items-center gap-2 px-4 py-3">
            <Bell className="w-4 h-4 shrink-0" style={{ color: "#EF4444" }} />
            <span className="text-sm" style={{ color: "#EF4444", fontFamily: FONT_HEADING }}>
              Notiser blockerade — ändra i Safari-inställningar
            </span>
          </div>
        ) : (
          <button
            onClick={handleEnablePush}
            disabled={enabling}
            className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium active:bg-gray-50 transition-colors"
            style={{ color: TEXT_PRIMARY, fontFamily: FONT_HEADING }}
          >
            {enabling ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: TEXT_MUTED }} /> : <span>🔔</span>}
            Aktivera notiser
          </button>
        )}
      </div>

      <p className="text-xs mt-2 text-right" style={{ color: TEXT_MUTED, fontFamily: FONT_HEADING }}>
        Version {__BUILD_TIME__.replace("T", " ")}
      </p>
    </motion.div>
  );
}

const MyPage = () => {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const venueSlug = searchParams.get("v") || "pickla-arena-sthlm";
  const isActivityPage = pathname.startsWith("/activity");
  const authRedirectPath = isActivityPage ? "/activity" : "/my";

  const { data: profile } = usePlayerProfile();
  const { data: bookings } = useMyBookings();
  const { data: eventRegistrations } = useMyEventRegistrations(profile);
  const { data: activeMembership } = useActiveMembership();
  const queryClient = useQueryClient();

  const [selectedBooking, setSelectedBooking] = useState<any | null>(null);
  const [showMembershipDetails, setShowMembershipDetails] = useState(false);
  const [showPast, setShowPast] = useState(false);

  // Show success toast when returning from Stripe card setup
  useState(() => {
    if (searchParams.get("card_saved") === "1") {
      toast.success("Kort sparat!");
      queryClient.invalidateQueries({ queryKey: ["payment-methods"] });
    }
  });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: PAGE_BG }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: BLUE }} />
      </div>
    );
  }

  if (!user) return <Navigate to={`/auth?redirect=${authRedirectPath}&v=${venueSlug}`} replace />;

  const displayName = profile?.display_name || user.email?.split("@")[0] || "Spelare";
  const now = Date.now();
  const activeBookings = (bookings || []).filter((b: any) => (b.status === "confirmed" || b.status === "pending") && new Date(b.end_time).getTime() >= now);
  const pastBookings = (bookings || []).filter((b: any) => (b.status === "confirmed" || b.status === "pending") && new Date(b.end_time).getTime() < now);
  const activeEventRegistrations = (eventRegistrations || []).filter((registration) => {
    const eventEnd = getEventDateTime(registration.events, true);
    return eventEnd ? eventEnd.getTime() >= now : true;
  });
  const pastEventRegistrations = (eventRegistrations || []).filter((registration) => {
    const eventEnd = getEventDateTime(registration.events, true);
    return eventEnd ? eventEnd.getTime() < now : false;
  });
  const activeBookingCount = activeBookings.length + activeEventRegistrations.length;
  const pastBookingCount = pastBookings.length + pastEventRegistrations.length;
  const membershipTier = (activeMembership as any)?.membership_tiers;
  const openBookingChat = (booking: any) => {
    navigate(`/hub?booking=${encodeURIComponent(booking.booking_ref || booking.id)}`);
  };

  return (
    <div className="min-h-screen" style={{ background: PAGE_BG }}>
      {/* ═══ STICKY TOP: Logo ═══ */}
      <header
        className="fixed top-0 left-0 right-0 z-40 px-5 pt-[env(safe-area-inset-top,12px)] pb-3 flex items-end justify-between"
        style={{
          background: "linear-gradient(to bottom, rgba(248,250,252,0.95) 0%, rgba(248,250,252,0.7) 50%, transparent 100%)",
        }}
      >
        <div className="pt-2">
          <img
            src={picklaLogo}
            alt="Pickla"
            className="h-7 w-auto"
          />
        </div>
        {!isActivityPage ? (
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={async () => {
              await signOut();
              navigate(`/?v=${venueSlug}`);
            }}
            className="w-9 h-9 rounded-xl flex items-center justify-center mb-1"
            style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}
          >
            <LogOut className="w-4 h-4" style={{ color: TEXT_MUTED }} />
          </motion.button>
        ) : (
          <div className="w-9 h-9 mb-1" />
        )}
      </header>

      {/* ═══ MAIN CONTENT ═══ */}
      <main className="pt-24 px-5 pb-28">
        <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col gap-4 max-w-md mx-auto">
          <motion.div variants={item}>
            <p className="text-lg font-bold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>
              {isActivityPage ? "Aktivitet" : `Hej ${displayName} 👋`}
            </p>
            <p className="text-xs mt-1" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
              {isActivityPage ? "Kommande, tidigare och delade spel." : "Konto, medlemskap och betalning."}
            </p>
          </motion.div>

          {!isActivityPage && (
            <>
              {/* Profile card with edit */}
              <ProfileCard profile={profile} user={user} displayName={displayName} />

              {/* Membership */}
              {activeMembership ? (
                <motion.button
                  variants={item}
                  onClick={() => setShowMembershipDetails(true)}
                  className="rounded-2xl p-5 text-left active:scale-[0.98] transition-transform"
                  style={{
                    background: membershipTier?.color
                      ? `${membershipTier.color}10`
                      : GREEN_LIGHT,
                    border: `1.5px solid ${membershipTier?.color ? membershipTier.color + "30" : GREEN_BORDER}`,
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: `${membershipTier?.color || GREEN}20` }}>
                      <Check className="w-5 h-5" style={{ color: membershipTier?.color || GREEN }} />
                    </div>
                    <div>
                      <p className="text-sm font-bold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>
                        {membershipTier?.name || "Medlem"}
                      </p>
                      <p className="text-[11px]" style={{ fontFamily: FONT_MONO, color: TEXT_SECONDARY }}>
                        {membershipTier?.description || "Aktivt medlemskap"}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 ml-auto shrink-0" style={{ color: TEXT_MUTED }} />
                  </div>
                </motion.button>
              ) : (
                <motion.button
                  variants={item}
                  onClick={() => navigate("/membership")}
                  className="rounded-2xl p-4 text-left active:scale-[0.98] transition-transform"
                  style={{
                    background: BLUE_LIGHT,
                    border: `1.5px solid ${BLUE_BORDER}`,
                  }}
                >
                  <p className="text-sm font-bold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>
                    Bli medlem
                  </p>
                  <p className="text-[11px]" style={{ fontFamily: FONT_MONO, color: TEXT_SECONDARY }}>
                    Se medlemskap och priser →
                  </p>
                </motion.button>
              )}
            </>
          )}

          {/* Active bookings */}
          {isActivityPage && (
          <motion.div variants={item}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4" style={{ color: BLUE }} />
                <span className="text-sm font-semibold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>Mina bokningar</span>
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: BLUE_LIGHT, color: BLUE }}>{activeBookingCount}</span>
              </div>
            </div>
            {activeBookingCount === 0 ? (
              <div className="rounded-2xl p-4 text-center" style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}` }}>
                <p className="text-xs" style={{ color: TEXT_MUTED }}>Inga kommande bokningar</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {activeBookings.slice(0, 5).map((b: any) => (
                  <button
                    key={b.id}
                    onClick={() => openBookingChat(b)}
                    className="rounded-xl p-3 flex items-center justify-between text-left active:scale-[0.98] transition-transform"
                    style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}` }}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium" style={{ color: TEXT_PRIMARY }}>{b.venue_courts?.name || "Bana"}</p>
                      <p className="text-xs" style={{ color: TEXT_MUTED }}>
                        {new Date(b.start_time).toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" })}
                        {" "}
                        {new Date(b.start_time).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}–{new Date(b.end_time).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                      <p className="text-[11px] mt-1" style={{ color: TEXT_SECONDARY }}>
                        Öppna bokningschatten →
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: b.status === "confirmed" ? GREEN_LIGHT : BLUE_LIGHT, color: b.status === "confirmed" ? GREEN : BLUE }}>
                        {b.status === "confirmed" ? "Bekräftad" : "Väntande"}
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedBooking(b);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            setSelectedBooking(b);
                          }
                        }}
                        className="px-2 py-1 rounded-full text-[10px] font-bold"
                        style={{ background: PAGE_BG, border: `1px solid ${CARD_BORDER}`, color: TEXT_SECONDARY, fontFamily: FONT_HEADING }}
                      >
                        Info
                      </span>
                    </div>
                  </button>
                ))}
                {activeEventRegistrations.map((registration) => {
                  const event = registration.events;
                  const eventStart = getEventDateTime(event);
                  const eventEnd = getEventDateTime(event, true);
                  const eventPath = event?.slug ? `/e/${event.slug}` : `/event/${registration.event_id}`;

                  return (
                    <button
                      key={registration.id}
                      onClick={() => navigate(eventPath)}
                      className="rounded-xl p-3 flex items-center justify-between text-left active:scale-[0.98] transition-transform"
                      style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}` }}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: TEXT_PRIMARY }}>{event?.display_name || event?.name || "Event"}</p>
                        <p className="text-xs" style={{ color: TEXT_MUTED }}>
                          {eventStart
                            ? eventStart.toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" })
                            : "Datum kommer"}
                          {eventStart && event?.start_time ? ` ${eventStart.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}` : ""}
                          {eventEnd && event?.end_time ? `–${eventEnd.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}` : ""}
                        </p>
                      </div>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: GREEN_LIGHT, color: GREEN }}>
                        Anmäld
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {pastBookingCount > 0 && (
              <div className="mt-2">
                <button
                  onClick={() => setShowPast(!showPast)}
                  className="w-full flex items-center justify-center gap-1 py-2 rounded-xl text-xs font-medium active:scale-[0.98] transition-transform"
                  style={{ color: TEXT_SECONDARY, fontFamily: FONT_HEADING }}
                >
                  {showPast ? "Dölj tidigare bokningar" : `Visa tidigare bokningar (${pastBookingCount})`}
                  <ChevronDown className="w-3.5 h-3.5 transition-transform" style={{ transform: showPast ? "rotate(180deg)" : "none" }} />
                </button>
                <AnimatePresence>
                  {showPast && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="flex flex-col gap-2 pt-1">
                        {pastBookings.map((b: any) => (
                          <button
                            key={b.id}
                            onClick={() => setSelectedBooking(b)}
                            className="rounded-xl p-3 flex items-center justify-between text-left opacity-70 active:scale-[0.98] transition-transform"
                            style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}` }}
                          >
                            <div>
                              <p className="text-sm font-medium" style={{ color: TEXT_PRIMARY }}>{b.venue_courts?.name || "Bana"}</p>
                              <p className="text-xs" style={{ color: TEXT_MUTED }}>
                                {new Date(b.start_time).toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" })}
                                {" "}
                                {new Date(b.start_time).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}–{new Date(b.end_time).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}
                              </p>
                            </div>
                          </button>
                        ))}
                        {pastEventRegistrations.map((registration) => {
                          const event = registration.events;
                          const eventStart = getEventDateTime(event);
                          const eventPath = event?.slug ? `/e/${event.slug}` : `/event/${registration.event_id}`;

                          return (
                            <button
                              key={registration.id}
                              onClick={() => navigate(eventPath)}
                              className="rounded-xl p-3 flex items-center justify-between text-left opacity-70 active:scale-[0.98] transition-transform"
                              style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}` }}
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate" style={{ color: TEXT_PRIMARY }}>{event?.display_name || event?.name || "Event"}</p>
                                <p className="text-xs" style={{ color: TEXT_MUTED }}>
                                  {eventStart
                                    ? eventStart.toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" })
                                    : "Datum saknas"}
                                </p>
                              </div>
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: GREEN_LIGHT, color: GREEN }}>
                                Anmäld
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
          )}

          {/* Day passes — directly under bookings */}
          {isActivityPage && <DayPassSection />}

          {/* Corporate memberships */}
          {!isActivityPage && <CorporateSection />}

          {/* Wallet: saved cards */}
          {!isActivityPage && <WalletSection />}

          {/* Settings: push notifications etc */}
          {!isActivityPage && <SettingsSection />}
        </motion.div>
      </main>

      <BookingDetailsSheet
        booking={selectedBooking}
        open={!!selectedBooking}
        onOpenChange={(o) => { if (!o) setSelectedBooking(null); }}
      />

      <MembershipDetailsSheet
        membership={activeMembership}
        open={showMembershipDetails}
        onOpenChange={setShowMembershipDetails}
      />

      <PlayerNav />
    </div>
  );
};

export default MyPage;
