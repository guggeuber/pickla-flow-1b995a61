import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

declare const __BUILD_TIME__: string;
import { motion, AnimatePresence } from "framer-motion";
import { Calendar, Ticket, Loader2, Check, Pencil, Save, Phone, Gift, Copy, Send, Trash2, ShoppingBag, Building2, ChevronRight, CreditCard, Plus, Bell, ChevronDown, Sparkles, Share2, X, MessageCircle, FileText, LogOut, UserCheck } from "lucide-react";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { QRCodeSVG } from "qrcode.react";
import { PicklaTopBar } from "@/components/PicklaTopBar";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import {
  getBookingAccessCodes,
  getBookingChatResourceId,
  getBookingCourtLabel,
  getBookingCourtNamesLabel,
  getBookingIds,
  getLegacyDirectBookingTimeResourceId,
  groupBookingRows,
  stripBookingCodesFromText,
} from "@/lib/bookingGroups";
import { subscribeToPush } from "@/lib/push";
import { ThreadRow } from "@/components/ui/ThreadRow";
import { activityCheckInAvailable, activityTimingLabel } from "@/lib/activityTiming";
import { getDisplayName, getFirstName } from "@/lib/displayName";
import { shareOrCopy } from "@/lib/share";
import { canonicalAppUrl } from "@/lib/canonicalOrigin";

const DartStatsChart = lazy(() => import("@/components/my/DartStatsChart"));

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

type MyActivitySessionSummary = {
  id: string;
  name: string | null;
  session_type: string | null;
  session_date: string | null;
  start_time: string | null;
  end_time: string | null;
  venue_id: string | null;
  venues?: { name: string | null; slug: string | null } | null;
};

type MySessionRegistration = {
  id: string;
  venue_id: string | null;
  activity_session_id: string;
  session_date: string;
  user_id: string;
  status: string | null;
  price_paid_sek: number | null;
  stripe_session_id: string | null;
  created_at: string | null;
  activity_sessions: MyActivitySessionSummary | null;
};

type MyReceiptItem = {
  id: string;
  type: string;
  date: string;
  label: string;
  reference: string | null;
  amount: number;
  vat_amount: number;
  payment_method: string | null;
  stripe_session_id: string | null;
};

type ActivityThreadRoom = {
  id: string;
  room_type: "daily" | "booking" | "event" | "ritual";
  title: string;
  subtitle: string | null;
  emoji: string | null;
  resource_id: string | null;
  updated_at: string | null;
};

type ActivityThread = {
  room: ActivityThreadRoom;
  joined_at: string | null;
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
      const response = await apiGet<{ items: any[] }>("api-bookings", "my-bookings");
      return response.items || [];
    },
  });
}

function useMySessionRegistrations() {
  const { user } = useAuth();
  return useQuery<MySessionRegistration[]>({
    queryKey: ["my-session-registrations", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("session_registrations")
        .select("id, venue_id, activity_session_id, session_date, user_id, status, price_paid_sek, stripe_session_id, created_at, activity_sessions(id, name, session_type, session_date, start_time, end_time, venue_id, venues(name, slug))")
        .eq("user_id", user!.id)
        .neq("status", "cancelled")
        .order("session_date", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as unknown as MySessionRegistration[];
    },
  });
}

function useMyWellnessReceipts(year: number) {
  const { user } = useAuth();
  return useQuery<{ items: MyReceiptItem[] }>({
    queryKey: ["wellness-certificate", year],
    enabled: !!user,
    staleTime: 60000,
    queryFn: () => apiGet<{ items: MyReceiptItem[] }>("api-bookings", "wellness", { year: String(year) }),
  });
}

function useMyActivityThreads() {
  const { user } = useAuth();
  return useQuery<ActivityThread[]>({
    queryKey: ["my-activity-threads", user?.id],
    enabled: !!user,
    staleTime: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_participants")
        .select("joined_at, chat_rooms(id, room_type, title, subtitle, emoji, resource_id, updated_at)")
        .eq("user_id", user!.id)
        .order("joined_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return ((data || []) as any[])
        .map((row) => ({ joined_at: row.joined_at, room: row.chat_rooms }))
        .filter((row) => row.room && row.room.room_type !== "daily") as ActivityThread[];
    },
  });
}

function useActivityThreadPreviews(roomIds: string[]) {
  const key = roomIds.slice().sort().join(",");
  return useQuery({
    queryKey: ["activity-thread-previews", key],
    enabled: roomIds.length > 0,
    staleTime: 15000,
    refetchInterval: 30000,
    queryFn: async () => {
      const { data: messages } = await supabase
        .from("chat_messages")
        .select("room_id, content, created_at")
        .in("room_id", roomIds)
        .order("created_at", { ascending: false });
      const previews: Record<string, { content: string; created_at: string }> = {};
      for (const msg of messages || []) {
        if (!previews[msg.room_id]) {
          previews[msg.room_id] = {
            content: msg.content || "Meddelande raderat",
            created_at: msg.created_at,
          };
        }
      }
      return previews;
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

function getSessionRegistrationDateTime(registration?: MySessionRegistration | null, end = false) {
  const session = registration?.activity_sessions;
  const date = registration?.session_date || session?.session_date;
  const time = end ? session?.end_time : session?.start_time;
  if (!date) return null;

  const datePart = String(date).slice(0, 10);
  return new Date(time ? `${datePart}T${String(time).slice(0, 5)}` : `${datePart}T${end ? "23:59:59" : "00:00:00"}`);
}

function sessionRegistrationCheckinEligibility(registration?: MySessionRegistration | null) {
  if (!registration?.venue_id) return { ok: false, reason: "Passdata saknas" };
  if (registration.status === "checked_in") return { ok: false, reason: "Redan incheckad" };

  const session = registration.activity_sessions;
  const date = String(registration.session_date || session?.session_date || "").slice(0, 10);
  const startTime = String(session?.start_time || "").slice(0, 5);
  const endTime = String(session?.end_time || "").slice(0, 5);
  if (!date || !startTime || !endTime) return { ok: false, reason: "Tid saknas" };

  const now = DateTime.now().setZone("Europe/Stockholm");
  const start = DateTime.fromISO(`${date}T${startTime}:00`, { zone: "Europe/Stockholm" });
  const end = DateTime.fromISO(`${date}T${endTime}:00`, { zone: "Europe/Stockholm" });
  if (!start.isValid || !end.isValid) return { ok: false, reason: "Ogiltig tid" };
  if (now.toISODate() !== date) return { ok: false, reason: "Inte idag" };
  if (now < start.minus({ minutes: 30 })) return { ok: false, reason: `Öppnar ${start.minus({ minutes: 30 }).toFormat("HH:mm")}` };
  if (now > end) return { ok: false, reason: "Passerat" };
  if (!["confirmed", "paid", "checked_in"].includes(String(registration.status || "confirmed"))) return { ok: false, reason: "Inte bekräftad" };

  return { ok: true, reason: "" };
}

function getSessionRegistrationPath(registration: MySessionRegistration, fallbackVenueSlug: string) {
  const sessionDate = String(registration.session_date || registration.activity_sessions?.session_date || "").slice(0, 10);
  const venueSlug = registration.activity_sessions?.venues?.slug || fallbackVenueSlug;
  const params = new URLSearchParams();
  if (sessionDate) params.set("date", sessionDate);
  if (venueSlug) params.set("v", venueSlug);
  const query = params.toString();
  return `/program/${encodeURIComponent(registration.activity_session_id)}${query ? `?${query}` : ""}`;
}

function getActivityRoomResourceId(registration: MySessionRegistration) {
  const sessionDate = String(registration.session_date || registration.activity_sessions?.session_date || "").slice(0, 10);
  if (!registration.activity_session_id || !sessionDate) return null;
  return `activity_session:${registration.activity_session_id}:${sessionDate}`;
}

function getThreadPath(room: ActivityThreadRoom) {
  return `/chat/${encodeURIComponent(room.id)}`;
}

function getThreadInitials(title: string | null | undefined) {
  const words = String(title || "Pickla")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (words.slice(0, 2).map((word) => word[0]).join("") || "P").toUpperCase();
}

function formatThreadTimestamp(value?: string | null) {
  if (!value) return undefined;
  const dt = DateTime.fromISO(value, { zone: "utc" }).setZone("Europe/Stockholm");
  if (!dt.isValid) return undefined;
  const today = DateTime.now().setZone("Europe/Stockholm");
  return dt.hasSame(today, "day") ? dt.toFormat("HH:mm") : dt.toFormat("d MMM");
}

function isInternalThreadPreview(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  if (["källa", "typ"].some((marker) => normalized.includes(`${marker}:`))) return true;
  return normalized.includes("publik gruppboknings" + "förfrågan");
}

function getConsumerThreadPreview(content?: string | null) {
  const cleaned = stripBookingCodesFromText(content || "")?.trim() || "";
  if (!cleaned || isInternalThreadPreview(cleaned)) return undefined;
  return cleaned;
}

function getOwnedBookingThreadKeys(bookings: any[]) {
  const keys = new Set<string>();
  for (const booking of bookings) {
    const groupResourceId = getBookingChatResourceId(booking);
    if (groupResourceId) keys.add(groupResourceId);
    const legacyDirectResourceId = getLegacyDirectBookingTimeResourceId(booking);
    if (legacyDirectResourceId) keys.add(legacyDirectResourceId);
    if (booking.booking_ref) keys.add(booking.booking_ref);
    for (const row of booking.bookings || []) {
      if (row.booking_ref) keys.add(row.booking_ref);
      const rowResourceId = getBookingChatResourceId(row);
      if (rowResourceId) keys.add(rowResourceId);
      const legacyRowResourceId = getLegacyDirectBookingTimeResourceId(row);
      if (legacyRowResourceId) keys.add(legacyRowResourceId);
    }
  }
  return keys;
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
    case "guest_day_vouchers_monthly":
      return `${entitlement.value || 1} gästpass per månad${sportLabel}`;
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

function getMembershipBenefitRows(tier: any, benefitsData: any) {
  const entitlements = (tier?.membership_entitlements || [])
    .filter((entitlement: any) => Number(entitlement.value || 0) > 0);
  const rows = [...entitlements];
  const hasType = (type: string) => rows.some((row: any) => row.entitlement_type === type);

  const courtHours = benefitsData?.court_hours;
  if (!hasType("court_hours_per_week") && Number(courtHours?.allowed || 0) > 0) {
    rows.push({
      entitlement_type: "court_hours_per_week",
      value: courtHours.allowed,
      period: "week",
    });
  }

  if (!hasType("open_play_unlimited") && benefitsData?.open_play_unlimited) {
    rows.push({
      entitlement_type: "open_play_unlimited",
      value: 1,
      period: null,
    });
  }

  const guestVouchers = benefitsData?.guest_vouchers;
  if (!hasType("guest_day_vouchers_monthly") && Number(guestVouchers?.allowed || 0) > 0) {
    rows.push({
      entitlement_type: "guest_day_vouchers_monthly",
      value: guestVouchers.allowed,
      period: "month",
    });
  }

  return rows;
}

function getMembershipShortSummary(tier: any, benefitsData: any) {
  const rows = getMembershipBenefitRows(tier, benefitsData);
  const parts: string[] = [];
  const courtHours = rows.find((row: any) => row.entitlement_type === "court_hours_per_week");
  const guestVouchers = rows.find((row: any) => row.entitlement_type === "guest_day_vouchers_monthly");
  if (courtHours) parts.push(`${courtHours.value}h/vecka`);
  if (rows.some((row: any) => row.entitlement_type === "open_play_unlimited")) parts.push("Open Play ingår");
  if (guestVouchers) parts.push(`${guestVouchers.value} gästpass/mån`);
  return parts.join(" · ");
}

function MembershipDetailsSheet({
  membership,
  benefitsData,
  open,
  onOpenChange,
}: {
  membership: any | null;
  benefitsData?: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState(false);

  if (!membership) return null;

  const tier = membership.membership_tiers || benefitsData?.membership?.tier;
  const tierPricing = tier?.membership_tier_pricing || [];
  const entitlements = getMembershipBenefitRows(tier, benefitsData);
  const courtHours = benefitsData?.court_hours;
  const guestVouchers = benefitsData?.guest_vouchers;
  const startsAt = (membership.starts_at || benefitsData?.membership?.starts_at) ? new Date(membership.starts_at || benefitsData?.membership?.starts_at) : null;
  const expiresAt = (membership.expires_at || benefitsData?.membership?.expires_at) ? new Date(membership.expires_at || benefitsData?.membership?.expires_at) : null;
  const nextBillingDate = expiresAt || (startsAt ? new Date(startsAt.getFullYear(), startsAt.getMonth() + 1, startsAt.getDate()) : null);
  const hasMonthlyPrice = Number(tier?.monthly_price || 0) > 0;
  const billingLabel = expiresAt ? "Gäller till" : hasMonthlyPrice ? "Nästa dragning" : "Period";
  const priceLabel = hasMonthlyPrice ? `${Math.round(Number(tier.monthly_price))} kr/mån` : "Betalt / manuellt";

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
                {priceLabel}
              </p>
            </div>
            <div className="rounded-xl p-3" style={{ background: PAGE_BG, border: `1px solid ${CARD_BORDER}` }}>
              <p className="text-[10px] uppercase tracking-wider" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>{billingLabel}</p>
              <p className="text-sm font-bold mt-1" style={{ color: TEXT_PRIMARY }}>
                {nextBillingDate ? nextBillingDate.toLocaleDateString("sv-SE", { day: "numeric", month: "short" }) : "Ej satt"}
              </p>
            </div>
          </div>

          {(Number(courtHours?.allowed || 0) > 0 || benefitsData?.open_play_unlimited || Number(guestVouchers?.allowed || 0) > 0) && (
            <div className="mt-5 rounded-2xl p-3 space-y-2" style={{ background: GREEN_LIGHT, border: `1px solid ${GREEN_BORDER}` }}>
              {Number(courtHours?.allowed || 0) > 0 && (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs" style={{ color: TEXT_SECONDARY }}>Fria ban-timmar denna vecka</p>
                  <p className="text-sm font-bold" style={{ color: TEXT_PRIMARY }}>
                    {courtHours.remaining} / {courtHours.allowed}h kvar
                  </p>
                </div>
              )}
              {benefitsData?.open_play_unlimited && (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs" style={{ color: TEXT_SECONDARY }}>Open Play</p>
                  <p className="text-sm font-bold" style={{ color: TEXT_PRIMARY }}>Ingår</p>
                </div>
              )}
              {Number(guestVouchers?.allowed || 0) > 0 && (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs" style={{ color: TEXT_SECONDARY }}>Gästpass denna månad</p>
                  <p className="text-sm font-bold" style={{ color: TEXT_PRIMARY }}>
                    {guestVouchers.remaining} / {guestVouchers.allowed} kvar
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="mt-5">
            <p className="text-sm font-semibold mb-2" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>Förmåner</p>
            <div className="flex flex-col gap-2">
              {entitlements.length > 0 ? entitlements.map((entitlement: any, idx: number) => (
                <div key={`${entitlement.entitlement_type}-${idx}`} className="flex items-start gap-2 rounded-xl px-3 py-2" style={{ background: GREEN_LIGHT, border: `1px solid ${GREEN_BORDER}` }}>
                  <Check className="w-4 h-4 shrink-0 mt-0.5" style={{ color: GREEN }} />
                  <p className="text-sm" style={{ color: TEXT_PRIMARY }}>{formatMembershipBenefit(entitlement)}</p>
                </div>
              )) : (
                <p className="text-xs" style={{ color: TEXT_MUTED }}>Inga förmåner är konfigurerade ännu.</p>
              )}
            </div>
          </div>

          {tierPricing.length > 0 && (
            <div className="mt-5">
              <p className="text-sm font-semibold mb-2" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>Medlemspriser</p>
              <div className="flex flex-col gap-2">
                {tierPricing.map((pricing: any, idx: number) => (
                  <div key={`${pricing.product_type}-${idx}`} className="flex items-start gap-2 rounded-xl px-3 py-2" style={{ background: BLUE_LIGHT, border: `1px solid ${BLUE_BORDER}` }}>
                    <Check className="w-4 h-4 shrink-0 mt-0.5" style={{ color: BLUE }} />
                    <p className="text-sm" style={{ color: TEXT_PRIMARY }}>{formatTierPricingBenefit(pricing)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-5 rounded-xl px-3 py-2" style={{ background: PAGE_BG, border: `1px solid ${CARD_BORDER}` }}>
            <p className="text-[10px] uppercase tracking-wider mb-1" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>Villkor</p>
            <p className="text-xs leading-relaxed" style={{ color: TEXT_SECONDARY }}>
              Medlemsförmåner gäller enligt aktuell nivå. Fria timmar och gästpass nollställs per period och outnyttjade gästpass rullar inte vidare om de inte redan skapats.
            </p>
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
  const [editFirstName, setEditFirstName] = useState(profile?.first_name || "");
  const [editLastName, setEditLastName] = useState(profile?.last_name || "");
  const [editPhone, setEditPhone] = useState(profile?.phone || "");
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();
  const legalName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ");
  const showLegalName = legalName && legalName.toLowerCase() !== displayName.toLowerCase();

  const handleSave = async () => {
    const firstName = editFirstName.trim();
    const lastName = editLastName.trim();
    const nextDisplayName = editName.trim() || [firstName, lastName].filter(Boolean).join(" ");
    setSaving(true);
    const { error } = await supabase
      .from("player_profiles")
      .update({
        display_name: nextDisplayName,
        first_name: firstName || null,
        last_name: lastName || null,
        phone: editPhone.trim() || null,
      })
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
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold" style={{ color: TEXT_MUTED }}>Visningsnamn</span>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="text-sm rounded-lg px-3 py-1.5 outline-none"
                  placeholder="Visningsnamn"
                  style={{ fontFamily: FONT_HEADING, background: PAGE_BG, border: `1px solid ${CARD_BORDER}`, color: TEXT_PRIMARY }}
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex min-w-0 flex-col gap-1">
                  <span className="text-[11px] font-semibold" style={{ color: TEXT_MUTED }}>Förnamn</span>
                  <input
                    value={editFirstName}
                    onChange={(e) => setEditFirstName(e.target.value)}
                    className="text-sm rounded-lg px-3 py-1.5 outline-none min-w-0"
                    placeholder="Förnamn"
                    style={{ fontFamily: FONT_HEADING, background: PAGE_BG, border: `1px solid ${CARD_BORDER}`, color: TEXT_PRIMARY }}
                  />
                </label>
                <label className="flex min-w-0 flex-col gap-1">
                  <span className="text-[11px] font-semibold" style={{ color: TEXT_MUTED }}>Efternamn</span>
                  <input
                    value={editLastName}
                    onChange={(e) => setEditLastName(e.target.value)}
                    className="text-sm rounded-lg px-3 py-1.5 outline-none min-w-0"
                    placeholder="Efternamn"
                    style={{ fontFamily: FONT_HEADING, background: PAGE_BG, border: `1px solid ${CARD_BORDER}`, color: TEXT_PRIMARY }}
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold" style={{ color: TEXT_MUTED }}>Telefon</span>
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
              </label>
            </div>
          ) : (
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold leading-tight" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>{displayName}</p>
              <p className="mt-1 truncate text-xs" style={{ color: TEXT_MUTED }}>{user.email}</p>
              {profile?.phone && (
                <p className="mt-0.5 text-xs" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>{profile.phone}</p>
              )}
              {showLegalName && (
                <p className="mt-2 inline-flex max-w-full rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: PAGE_BG, color: TEXT_SECONDARY }}>
                  <span className="truncate">Medlemsnamn: {legalName}</span>
                </p>
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
            onClick={() => {
              setEditName(displayName);
              setEditFirstName(profile?.first_name || "");
              setEditLastName(profile?.last_name || "");
              setEditPhone(profile?.phone || "");
              setEditing(true);
            }}
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
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [invitePreparing, setInvitePreparing] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const inviteUrlRef = useRef<string | null>(null);
  const inviteRequestRef = useRef<Promise<string> | null>(null);
  const bookingRef = booking?.primary_booking_ref || booking?.booking_ref || booking?.bookings?.[0]?.booking_ref || null;
  const isParticipantPlace = Boolean((booking as any)?.is_participant_place || (booking as any)?.participant);

  useEffect(() => {
    inviteUrlRef.current = null;
    inviteRequestRef.current = null;
    setInviteUrl(null);
  }, [bookingRef]);

  const requestInviteUrl = useCallback(async () => {
    if (inviteUrlRef.current) return inviteUrlRef.current;
    if (!bookingRef) throw new Error("Bokningsnummer saknas");
    if (inviteRequestRef.current) return inviteRequestRef.current;

    setInvitePreparing(true);
    const request = apiPost<{ url?: string }>("api-bookings", "booking-participant-invite", { bookingRef })
      .then((result) => {
        if (!result.url) throw new Error("Ingen länk skapades");
        inviteUrlRef.current = result.url;
        setInviteUrl(result.url);
        return result.url;
      })
      .finally(() => {
        inviteRequestRef.current = null;
        setInvitePreparing(false);
      });

    inviteRequestRef.current = request;
    return request;
  }, [bookingRef]);

  useEffect(() => {
    if (!open || isParticipantPlace || !bookingRef) return;
    requestInviteUrl().catch((error) => {
      console.warn("[booking-share] Could not prepare invite link", {
        name: error?.name,
        message: error?.message,
      });
    });
  }, [bookingRef, isParticipantPlace, open, requestInviteUrl]);

  if (!booking) return null;

  const participant = (booking as any).participant || null;
  const courtName = getBookingCourtLabel(booking);
  const courtNames = getBookingCourtNamesLabel(booking);
  const accessCodes = getBookingAccessCodes(booking);
  const bookingIds = getBookingIds(booking);
  const start = new Date(booking.start_time);
  const end = new Date(booking.end_time);
  const startSthlm = DateTime.fromISO(booking.start_time, { zone: "utc" }).setZone("Europe/Stockholm");
  const endSthlm = DateTime.fromISO(booking.end_time, { zone: "utc" }).setZone("Europe/Stockholm");
  const dateLabel = start.toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long" });
  const timeLabel = `${start.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}–${end.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}`;
  const bookingTimingLabel = activityTimingLabel({
    sessionDate: startSthlm.toISODate(),
    startTime: startSthlm.toFormat("HH:mm"),
    endTime: endSthlm.toFormat("HH:mm"),
    checkedIn: Boolean(participant?.checked_in_at),
    checkInAvailable: isParticipantPlace ? activityCheckInAvailable({
      sessionDate: startSthlm.toISODate(),
      startTime: startSthlm.toFormat("HH:mm"),
      endTime: endSthlm.toFormat("HH:mm"),
    }) : false,
  });
  const participantCanCheckIn = isParticipantPlace
    && participant?.id
    && ["paid", "free"].includes(String(participant?.payment_status || "").toLowerCase())
    && !participant?.checked_in_at
    && activityCheckInAvailable({
      sessionDate: startSthlm.toISODate(),
      startTime: startSthlm.toFormat("HH:mm"),
      endTime: endSthlm.toFormat("HH:mm"),
    });

  const handleCancel = async () => {
    if (!bookingIds.length) return;
    setCancelling(true);
    try {
      await apiPost("api-bookings", "cancel", { bookingIds });
      toast.success("Bokningen är avbokad");
      await queryClient.invalidateQueries({ queryKey: ["my-bookings"] });
      await queryClient.refetchQueries({ queryKey: ["my-bookings"] });
      onOpenChange(false);
      setConfirmCancel(false);
    } catch (error: any) {
      toast.error(error?.message || "Kunde inte avboka");
    } finally {
      setCancelling(false);
    }
  };

  const handleParticipantCheckIn = async () => {
    if (!participant?.id || !booking.venue_id || checkingIn) return;
    setCheckingIn(true);
    try {
      await apiPost("api-checkins", "self", {
        venue_id: booking.venue_id,
        entry_type: "booking_participant",
        entitlement_id: participant.id,
      });
      toast.success("Du är incheckad");
      await queryClient.invalidateQueries({ queryKey: ["my-bookings"] });
      await queryClient.refetchQueries({ queryKey: ["my-bookings"] });
    } catch (error: any) {
      toast.error(error?.message || "Kunde inte checka in");
    } finally {
      setCheckingIn(false);
    }
  };

  const handleCancelParticipant = async () => {
    if (!participant?.id) return;
    setCancelling(true);
    try {
      const result = await apiPost<{ refund_note?: string | null }>("api-bookings", "booking-participant-cancel", {
        participantId: participant.id,
      });
      toast.success(result.refund_note || "Din plats är avbokad");
      await queryClient.invalidateQueries({ queryKey: ["my-bookings"] });
      await queryClient.refetchQueries({ queryKey: ["my-bookings"] });
      onOpenChange(false);
      setConfirmCancel(false);
    } catch (error: any) {
      toast.error(error?.message || "Kunde inte avboka platsen");
    } finally {
      setCancelling(false);
    }
  };

  const handleInvitePlayers = async () => {
    if (!bookingRef) {
      toast.error("Bokningsnummer saknas");
      return;
    }
    setCreatingInvite(true);
    try {
      const preparedUrl = inviteUrlRef.current || inviteUrl;
      const url = preparedUrl || await requestInviteUrl();
      const shareResult = await shareOrCopy({
        title: "Spela på Pickla",
        text: "Hämta din personliga plats och häng på.",
        url,
        copyText: url,
        preferNativeShare: Boolean(preparedUrl),
      });
      if (shareResult === "cancelled") return;
      toast.success(shareResult === "copied" ? "Spelarlänk kopierad" : "Spelarlänk delad");
    } catch (error: any) {
      toast.error(error?.message || "Kunde inte skapa medspelarlänk");
    } finally {
      setCreatingInvite(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setConfirmCancel(false); }}>
      <DrawerContent style={{ background: CARD_BG }}>
        <div className="px-5 pb-6 pt-2 max-w-md mx-auto w-full">
          <p className="text-xs uppercase tracking-wider mb-1" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
            {isParticipantPlace ? "Din plats" : "Bokning"}
          </p>
          <p className="text-xl font-bold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>Din plats</p>
          <p className="text-sm mt-1" style={{ color: TEXT_SECONDARY }}>{courtName}</p>
          {courtNames !== courtName && (
            <p className="text-xs mt-1" style={{ color: TEXT_MUTED }}>{courtNames}</p>
          )}
          <p className="text-sm mt-1" style={{ color: TEXT_SECONDARY }}>{dateLabel}</p>
          <p className="text-sm" style={{ fontFamily: FONT_MONO, color: TEXT_SECONDARY }}>{timeLabel}</p>
          {bookingTimingLabel && (
            <p className="text-sm font-bold mt-1" style={{ color: TEXT_SECONDARY, fontFamily: FONT_HEADING }}>
              {bookingTimingLabel}
            </p>
          )}
          {isParticipantPlace && participant && (
            <div className="mt-4 rounded-2xl p-4" style={{ background: PAGE_BG, border: `1.5px solid ${CARD_BORDER}` }}>
              <p className="text-[10px] uppercase tracking-wider" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
                Biljett
              </p>
              <p className="text-sm font-bold mt-1" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>
                {participant.display_name || "Din plats"}
              </p>
              <p className="text-xs mt-1" style={{ color: TEXT_MUTED }}>
                {participant.payment_status === "free"
                  ? "Ingår"
                  : participant.payment_status === "paid"
                  ? "Betald"
                  : "Väntar på betalning"}
              </p>
            </div>
          )}

          {!isParticipantPlace && accessCodes.length > 0 && (
            <div className="mt-4 rounded-2xl p-4" style={{ background: BLUE_LIGHT, border: `1.5px solid ${BLUE_BORDER}` }}>
              <p className="text-[10px] uppercase tracking-wider" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
                Check-in
              </p>
              <p className="text-sm font-bold mt-1" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>
                Checka in med din biljett
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {accessCodes.map((code) => (
                  <div key={code} className="rounded-xl px-4 py-2" style={{ background: CARD_BG, border: `1px solid ${BLUE_BORDER}` }}>
                    <span className="text-2xl font-bold tracking-widest" style={{ fontFamily: FONT_MONO, color: BLUE }}>{code}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2 mt-5">
            {isParticipantPlace ? (
              <button
                onClick={handleParticipantCheckIn}
                disabled={!participantCanCheckIn || checkingIn}
                className="w-full py-3 rounded-xl text-sm font-bold active:scale-[0.98] transition-transform flex items-center justify-center gap-2 disabled:opacity-50"
                style={{ background: TEXT_PRIMARY, color: CARD_BG, fontFamily: FONT_HEADING }}
              >
                {checkingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {participant?.checked_in_at ? "Incheckad" : "Checka in"}
              </button>
            ) : (
              <button
                onClick={handleInvitePlayers}
                disabled={creatingInvite || invitePreparing}
                className="w-full py-3 rounded-xl text-sm font-bold active:scale-[0.98] transition-transform flex items-center justify-center gap-2 disabled:opacity-50"
                style={{ background: TEXT_PRIMARY, color: CARD_BG, fontFamily: FONT_HEADING }}
              >
                {creatingInvite || invitePreparing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
                Bjud in spelare
              </button>
            )}
            <button
              onClick={() => { onOpenChange(false); navigate(`/booking-chat/${encodeURIComponent(getBookingChatResourceId(booking))}`); }}
              className="w-full py-3 rounded-xl text-sm font-bold active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
              style={{ background: PAGE_BG, border: `1px solid ${CARD_BORDER}`, color: TEXT_PRIMARY, fontFamily: FONT_HEADING }}
            >
              <MessageCircle className="w-4 h-4" />
              Gå till chatt
            </button>
            {!isParticipantPlace && (
              <button
                onClick={() => { onOpenChange(false); navigate(`/b/${booking.primary_booking_ref || booking.booking_ref || booking.id}`); }}
                className="w-full py-3 rounded-xl text-sm font-bold active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
                style={{ background: PAGE_BG, border: `1px solid ${CARD_BORDER}`, color: TEXT_PRIMARY, fontFamily: FONT_HEADING }}
              >
                <FileText className="w-4 h-4" />
                Visa kvitto
              </button>
            )}
            {confirmCancel ? (
              <div className="rounded-xl p-3 flex flex-col gap-2" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}>
                <p className="text-xs text-center" style={{ color: TEXT_SECONDARY }}>
                  {isParticipantPlace ? "Säker på att du vill avboka din plats?" : "Säker på att du vill avboka?"}
                </p>
                {isParticipantPlace && participant?.payment_status === "paid" && (
                  <p className="text-[11px] text-center" style={{ color: TEXT_MUTED }}>
                    Kontakta oss för återbetalning.
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmCancel(false)}
                    className="flex-1 py-2.5 rounded-lg text-xs font-bold"
                    style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}`, color: TEXT_PRIMARY, fontFamily: FONT_HEADING }}
                  >
                    Behåll
                  </button>
                  <button
                    onClick={isParticipantPlace ? handleCancelParticipant : handleCancel}
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
                style={{ background: "transparent", border: "1px solid rgba(239,68,68,0.16)", color: "#EF4444", fontFamily: FONT_HEADING }}
              >
                {isParticipantPlace ? "Avboka min plats" : "Avboka"}
              </button>
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function SessionRegistrationDetailsSheet({
  registration,
  open,
  onOpenChange,
  fallbackVenueSlug,
  activityThreads,
  receiptItems,
}: {
  registration: MySessionRegistration | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  fallbackVenueSlug: string;
  activityThreads: ActivityThread[];
  receiptItems: MyReceiptItem[];
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [openingLobby, setOpeningLobby] = useState(false);
  const checkinMutation = useMutation({
    mutationFn: () => apiPost("api-checkins", "self", {
      venue_id: registration?.venue_id,
      entry_type: "session_ticket",
      entitlement_id: registration?.id,
    }),
    onSuccess: () => {
      toast.success("Du är incheckad");
      queryClient.invalidateQueries({ queryKey: ["my-session-registrations", user?.id] });
    },
    onError: (error: any) => toast.error(error?.message || "Något gick fel — försök igen, vi håller din plats."),
  });

  if (!registration) return null;

  const session = registration.activity_sessions;
  const start = getSessionRegistrationDateTime(registration);
  const end = getSessionRegistrationDateTime(registration, true);
  const dateLabel = start
    ? start.toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long" })
    : "Datum kommer";
  const timeLabel = start
    ? `${start.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}${end ? `–${end.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}` : ""}`
    : "";
  const venueName = session?.venues?.name || "Pickla";
  const receipt = registration.stripe_session_id
    ? receiptItems.find((item) => item.stripe_session_id === registration.stripe_session_id)
    : null;
  const receiptAmount = typeof receipt?.amount === "number" && receipt.amount > 0 ? receipt.amount : null;
  const registrationAmount = typeof registration.price_paid_sek === "number" && registration.price_paid_sek > 0
    ? registration.price_paid_sek
    : null;
  const paidAmount = receiptAmount ?? registrationAmount;
  const programPath = getSessionRegistrationPath(registration, fallbackVenueSlug);
  const resourceId = getActivityRoomResourceId(registration);
  const chatRoom = resourceId
    ? activityThreads.find((thread) => thread.room.resource_id === resourceId)?.room
    : null;
  const venueSlug = session?.venues?.slug || fallbackVenueSlug;
  const isCheckedIn = registration.status === "checked_in";
  const checkinEligibility = sessionRegistrationCheckinEligibility(registration);
  const timingStatusLabel = activityTimingLabel({
    sessionDate: String(registration.session_date || session?.session_date || "").slice(0, 10),
    startTime: session?.start_time,
    endTime: session?.end_time,
    checkedIn: isCheckedIn,
    checkInAvailable: checkinEligibility.ok,
  });
  const money = (amount: number) =>
    `${Number(amount || 0).toLocaleString("sv-SE", { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 })} kr`;

  const handleOpenLobby = async () => {
    if (openingLobby) return;

    if (chatRoom) {
      onOpenChange(false);
      navigate(`${getThreadPath(chatRoom)}?v=${encodeURIComponent(venueSlug)}`);
      return;
    }

    if (!registration.venue_id || !resourceId) {
      toast.error("Något gick fel — försök igen, vi håller din plats.");
      return;
    }

    setOpeningLobby(true);
    try {
      const { data, error } = await supabase.rpc("upsert_resource_chat_room", {
        p_venue_id: registration.venue_id,
        p_resource_id: resourceId,
        p_room_type: "event",
        p_title: session?.name || "Aktivitet",
        p_subtitle: `${dateLabel}${timeLabel ? ` · ${timeLabel}` : ""}`,
        p_emoji: "🎟️",
        p_is_public: true,
      });
      if (error) throw error;
      const roomId = (data as Array<{ id?: string }> | null)?.[0]?.id;
      if (!roomId) throw new Error("Missing room id");
      onOpenChange(false);
      navigate(`/chat/${encodeURIComponent(roomId)}?v=${encodeURIComponent(venueSlug)}`);
    } catch (error) {
      console.error(error);
      toast.error("Något gick fel — försök igen, vi håller din plats.");
    } finally {
      setOpeningLobby(false);
    }
  };

  const handleShare = async () => {
    const url = canonicalAppUrl(programPath);
    const title = session?.name || "Aktivitet på Pickla";
    const text = `Häng med på ${title} på Pickla`;
    try {
      const result = await shareOrCopy({ title, text, url, copyText: url });
      if (result === "copied") toast.success("Länk kopierad");
    } catch (error) {
      toast.error("Kunde inte kopiera länken");
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent style={{ background: CARD_BG }}>
        <div className="px-5 pb-6 pt-2 max-w-md mx-auto w-full">
          <p className="text-xs uppercase tracking-wider mb-1" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
            Aktivitet
          </p>
          <p className="text-xl font-bold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>
            {session?.name || "Aktivitet"}
          </p>
          <p className="text-sm mt-1 capitalize" style={{ color: TEXT_SECONDARY }}>{dateLabel}</p>
          {timeLabel && <p className="text-sm" style={{ fontFamily: FONT_MONO, color: TEXT_SECONDARY }}>{timeLabel}</p>}
          {timingStatusLabel && (
            <p className="text-sm font-bold mt-1" style={{ color: TEXT_SECONDARY, fontFamily: FONT_HEADING }}>
              {timingStatusLabel}
            </p>
          )}

          <div className="mt-4 rounded-2xl p-4 flex items-center justify-between gap-3" style={{ background: PAGE_BG, border: `1.5px solid ${CARD_BORDER}` }}>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
                Biljett
              </p>
              <p className="text-sm font-bold mt-1 truncate" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>
                {venueName}
              </p>
              {receipt?.reference && (
                <p className="text-[11px] mt-1 truncate" style={{ color: TEXT_MUTED }}>
                  Kvitto {receipt.reference}
                </p>
              )}
            </div>
            <div className="text-right shrink-0">
              <span className="px-3 py-1 rounded-full text-xs font-bold" style={{ background: GREEN_LIGHT, color: GREEN, fontFamily: FONT_HEADING }}>
                {["confirmed", "checked_in", "paid"].includes(String(registration.status || "")) ? "Anmäld ✓" : "Väntande"}
              </span>
              {paidAmount !== null ? (
                <p className="text-sm font-bold mt-2" style={{ color: TEXT_PRIMARY, fontFamily: FONT_HEADING }}>
                  {money(paidAmount)}
                </p>
              ) : (
                <p className="text-sm font-bold mt-2" style={{ color: TEXT_PRIMARY, fontFamily: FONT_HEADING }}>
                  0 kr
                </p>
              )}
            </div>
          </div>

          <div className="mt-5">
            {isCheckedIn ? (
              <div className="w-full rounded-2xl px-4 py-4 text-center text-sm font-bold" style={{ background: GREEN_LIGHT, border: `1.5px solid ${GREEN_BORDER}`, color: GREEN, fontFamily: FONT_HEADING }}>
                Incheckad
              </div>
            ) : checkinEligibility.ok ? (
              <button
                onClick={() => checkinMutation.mutate()}
                disabled={checkinMutation.isPending}
                className="w-full py-4 rounded-2xl text-sm font-bold active:scale-[0.98] transition-transform flex items-center justify-center gap-2 disabled:opacity-60"
                style={{ background: GREEN, color: "white", fontFamily: FONT_HEADING }}
              >
                {checkinMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
                Checka in
              </button>
            ) : (
              <div className="w-full rounded-2xl px-4 py-4 text-center text-xs font-bold" style={{ background: PAGE_BG, border: `1.5px solid ${CARD_BORDER}`, color: TEXT_SECONDARY, fontFamily: FONT_HEADING }}>
                Check-in: {checkinEligibility.reason}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 mt-3">
            <button
              onClick={handleOpenLobby}
              disabled={openingLobby}
              className="col-span-2 w-full py-3 rounded-xl text-sm font-bold active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
              style={{ background: PAGE_BG, border: `1px solid ${CARD_BORDER}`, color: TEXT_PRIMARY, fontFamily: FONT_HEADING }}
            >
              {openingLobby ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
              Gå till chatt
            </button>
            <button
              onClick={handleShare}
              className="w-full py-3 rounded-xl text-sm font-bold active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
              style={{ background: PAGE_BG, border: `1px solid ${CARD_BORDER}`, color: TEXT_PRIMARY, fontFamily: FONT_HEADING }}
            >
              <Share2 className="w-4 h-4" />
              Dela
            </button>
            <button
              onClick={() => {
                if (!receipt?.reference) {
                  toast.info("Kvitto saknas för den här anmälan ännu");
                  return;
                }
                onOpenChange(false);
                navigate(`/receipt/${encodeURIComponent(receipt.reference)}`);
              }}
              className="w-full py-3 rounded-xl text-sm font-bold active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
              style={{ background: PAGE_BG, border: `1px solid ${CARD_BORDER}`, color: TEXT_PRIMARY, fontFamily: FONT_HEADING }}
            >
              <FileText className="w-4 h-4" />
              Kvitto
            </button>
            <button
              onClick={() => toast.info("Avbokning av aktivitetspass kommer här strax")}
              className="col-span-2 w-full py-3 rounded-xl text-sm font-bold active:scale-[0.98] transition-transform"
              style={{ background: "transparent", border: "1px solid rgba(239,68,68,0.16)", color: "#EF4444", fontFamily: FONT_HEADING }}
            >
              Avboka
            </button>
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
  const guestVoucherInfo = data?.guest_vouchers || { allowed: 0, issued: 0, remaining: 0, vouchers: [] };
  const guestVouchers = guestVoucherInfo.vouchers || [];

  const activePasses = passes.filter((p: any) => p.status === 'active' && !p.share);
  const sharedPasses = passes.filter((p: any) => p.share?.status === 'pending');
  const availableVouchers = guestVouchers.filter((p: any) => p.status === 'unused' && !p.recipient_name);
  const sharedVouchers = guestVouchers.filter((p: any) => p.status === 'unused' && p.recipient_name);
  const activeCount = activePasses.length + availableVouchers.length;

  const buildLink = (token: string) => canonicalAppUrl(`/pass/${token}`);
  const getRecipientLabel = (share: any) => share?.recipient_name || share?.recipient_email || "en vän";
  const buildGiftMessage = (token: string, name: string) =>
    `Jag har gett dig ett dagspass på Pickla, ${name}! Hämta det här: ${buildLink(token)}`;

  const handleShare = async (pass: any) => {
    const name = recipientName.trim();
    if (!name) { toast.error("Skriv vem passet är till"); return; }
    setSharing(true);
    try {
      const result = await apiPost("api-day-passes", "share", {
        ...(pass.is_voucher ? { voucher_id: pass.id } : { day_pass_id: pass.id }),
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
    shareOrCopy({ copyText: buildGiftMessage(token, name) })
      .then(() => toast.success("Meddelande kopierat!"))
      .catch(() => toast.error("Kunde inte kopiera meddelandet"));
  };

  const shareGift = async (token: string, name: string) => {
    const url = buildLink(token);
    const text = buildGiftMessage(token, name);

    try {
      const result = await shareOrCopy({ title: `Dagspass till ${name}`, text, url, copyText: text });
      if (result === "copied") toast.success("Meddelande kopierat!");
    } catch {
      toast.error("Kunde inte kopiera meddelandet");
    }
  };

  if (isLoading) {
    return null;
  }

  return (
    <motion.div variants={item}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Ticket className="w-4 h-4" style={{ color: BLUE }} />
          <span className="text-sm font-semibold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>Gästpass & dagspass</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: BLUE_LIGHT, color: BLUE }}>
            {activeCount}
          </span>
        </div>
      </div>

      {/* Guest voucher allowance info */}
      {allowance.has_membership && allowance.passes_allowed > 0 && (
        <div className="rounded-xl px-3 py-2 mb-3 space-y-1.5" style={{ background: GREEN_LIGHT, border: `1px solid ${GREEN_BORDER}` }}>
          <div className="flex items-center gap-2">
            <Gift className="w-3.5 h-3.5 shrink-0" style={{ color: GREEN }} />
            <p className="text-[11px]" style={{ fontFamily: FONT_MONO, color: TEXT_SECONDARY }}>
              <span className="font-bold" style={{ color: TEXT_PRIMARY }}>{allowance.passes_remaining}</span> av {allowance.passes_allowed} gästpass kvar denna månad
            </p>
          </div>
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
      {activePasses.length === 0 && availableVouchers.length === 0 && sharedPasses.length === 0 && sharedVouchers.length === 0 ? (
        <div className="rounded-2xl p-4 text-center" style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}` }}>
          <p className="text-xs" style={{ color: TEXT_MUTED }}>Inga aktiva dagspass</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {[...activePasses, ...availableVouchers].map((p: any) => (
            <div key={p.id}>
              <div className="rounded-xl p-3 flex items-center justify-between" style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}` }}>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium" style={{ color: TEXT_PRIMARY }}>{p.is_voucher ? "Gästpass" : "Dagspass"}</p>
                    {p.is_free && (
                      <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold" style={{ background: GREEN_LIGHT, color: GREEN }}>GRATIS</span>
                    )}
                  </div>
                  <p className="text-xs" style={{ color: TEXT_MUTED }}>
                    {p.is_voucher
                      ? `Gäller till ${new Date(p.expires_at).toLocaleDateString("sv-SE", { day: "numeric", month: "short" })}`
                      : new Date(p.valid_date).toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" })}
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
                        onClick={() => handleShare(p)}
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
          {(sharedPasses.length > 0 || sharedVouchers.length > 0) && (
            <div className="pt-1">
              <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>Delade pass</p>
              {[...sharedPasses, ...sharedVouchers].map((p: any) => (
                <div key={p.id} className="rounded-xl p-3 flex items-center gap-2 mb-1.5" style={{ background: BLUE_LIGHT, border: `1px solid ${BLUE_BORDER}` }}>
                  <Send className="w-3 h-3 shrink-0" style={{ color: BLUE }} />
                  <span className="text-xs truncate flex-1" style={{ fontFamily: FONT_MONO, color: TEXT_SECONDARY }}>
                    {p.is_voucher ? p.recipient_name : getRecipientLabel(p.share)}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-bold shrink-0" style={{ background: BLUE_LIGHT, color: BLUE }}>
                    Väntande
                  </span>
                  {(p.share?.token || p.token) && (
                    <button
                      onClick={() => copyGiftMessage(p.share?.token || p.token, p.is_voucher ? p.recipient_name : getRecipientLabel(p.share))}
                      className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: PAGE_BG, border: `1px solid ${CARD_BORDER}` }}
                    >
                      <Copy className="w-3 h-3" style={{ color: TEXT_MUTED }} />
                    </button>
                  )}
                  {p.share && !p.is_voucher && (
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

type DartRecentMatch = {
  id: string;
  target_score?: number;
  game_type?: string;
  started_at?: string | null;
  opponent_names?: string[];
  won?: boolean;
  average?: number;
  high_score?: number;
  checkout?: number;
  turns?: number;
  player1_legs?: number;
  player2_legs?: number;
  court?: { name?: string | null } | null;
};

type DartStats = {
  matches_played: number;
  wins: number;
  average: number;
  high_score: number;
  one_eighties: number;
  checkouts: number;
  high_checkout: number;
  last_10_average?: number;
  current_form?: string[];
  trend?: Array<{ match_id: string; label: string; date?: string; average: number; high_score: number; checkout: number }>;
  recent_matches?: DartRecentMatch[];
};

type DartMatchDetail = {
  match: DartRecentMatch & { winner_name?: string | null; checkout_rule?: string; in_rule?: string; best_of_legs?: number };
  player: { number: number; name: string; legs: number };
  opponents: Array<{ number: number; name: string; legs: number; is_bot?: boolean }>;
  turns: Array<{
    id: string;
    player_number: number;
    score: number;
    entered_score?: number;
    remaining_before: number;
    remaining_after: number;
    is_bust?: boolean;
    is_checkout?: boolean;
    in_opened?: boolean;
    leg_number: number;
  }>;
  stats: { turns: number; average: number; high_score: number; one_eighties: number; checkouts: number; high_checkout: number };
  opponent_stats: Array<{ player: { name: string }; turns: number; average: number; high_score: number }>;
};

function formatDartAverage(value?: number) {
  return Number(value || 0).toFixed(1);
}

function DartStatsSection() {
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const { data, isLoading } = useQuery<DartStats>({
    queryKey: ["my-dart-stats"],
    queryFn: () => apiGet("api-score", "my-stats"),
    staleTime: 30000,
  });
  const { data: detail, isLoading: detailLoading } = useQuery<DartMatchDetail>({
    queryKey: ["my-dart-match", selectedMatchId],
    enabled: !!selectedMatchId,
    queryFn: () => apiGet("api-score", "my-match", { matchId: selectedMatchId! }),
  });

  const matches = data?.recent_matches || [];
  const trend = data?.trend || [];
  const winRate = data?.matches_played ? Math.round((data.wins / data.matches_played) * 100) : 0;

  return (
    <motion.div variants={item}>
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="w-4 h-4" style={{ color: BLUE }} />
        <span className="text-sm font-semibold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>Dartstatistik</span>
      </div>
      <div className="rounded-2xl overflow-hidden" style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}` }}>
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-5">
            <Loader2 className="w-4 h-4 animate-spin" style={{ color: TEXT_MUTED }} />
            <span className="text-xs" style={{ color: TEXT_MUTED, fontFamily: FONT_MONO }}>hämtar score...</span>
          </div>
        ) : !data?.matches_played ? (
          <div className="px-4 py-5 text-center">
            <p className="text-xs" style={{ color: TEXT_MUTED }}>Koppla kontot med QR på paddan för att börja samla dartstatistik.</p>
          </div>
        ) : (
          <div className="p-4">
            <div className="grid grid-cols-4 gap-2">
              {[
                ["Matcher", data.matches_played],
                ["Vinst", `${winRate}%`],
                ["3-pil", formatDartAverage(data.average)],
                ["Högsta", data.high_score],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl p-2 text-center" style={{ background: PAGE_BG }}>
                  <p className="text-lg font-black" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>{value}</p>
                  <p className="text-[9px] uppercase tracking-[0.12em]" style={{ color: TEXT_MUTED }}>{label}</p>
                </div>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {[
                ["180", data.one_eighties],
                ["Checkouts", data.checkouts],
                ["Högsta ut", data.high_checkout || "-"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl p-2 text-center" style={{ background: BLUE_LIGHT }}>
                  <p className="text-base font-black" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>{value}</p>
                  <p className="text-[9px] uppercase tracking-[0.12em]" style={{ color: TEXT_MUTED }}>{label}</p>
                </div>
              ))}
            </div>
            {trend.length > 1 && (
              <div className="mt-4 h-36 rounded-xl p-2" style={{ background: PAGE_BG }}>
                <Suspense fallback={<div className="h-full rounded-xl animate-pulse" style={{ background: CARD_BG }} />}>
                  <DartStatsChart data={trend} blue={BLUE} green={GREEN} border={CARD_BORDER} />
                </Suspense>
              </div>
            )}
            <div className="mt-4 flex flex-col gap-2">
              {matches.slice(0, 6).map((match) => (
                <button
                  key={match.id}
                  onClick={() => setSelectedMatchId(match.id)}
                  className="rounded-xl p-3 text-left active:scale-[0.98] transition-transform"
                  style={{ background: PAGE_BG, border: `1px solid ${CARD_BORDER}` }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>
                        {match.target_score || match.game_type || 501} vs {(match.opponent_names || []).join(", ") || "motståndare"}
                      </p>
                      <p className="text-[11px]" style={{ color: TEXT_MUTED }}>
                        {match.started_at ? new Date(match.started_at).toLocaleDateString("sv-SE", { day: "numeric", month: "short" }) : "Datum saknas"}
                        {" · "}
                        {formatDartAverage(match.average)} avg · högsta {match.high_score || 0}
                      </p>
                    </div>
                    <span className="rounded-full px-2 py-1 text-[10px] font-bold" style={{ background: match.won ? GREEN_LIGHT : BLUE_LIGHT, color: match.won ? GREEN : BLUE }}>
                      {match.won ? "Vinst" : "Match"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <Drawer open={!!selectedMatchId} onOpenChange={(open) => !open && setSelectedMatchId(null)}>
        <DrawerContent className="max-h-[90vh]">
          <div className="mx-auto w-full max-w-md overflow-y-auto px-5 pb-8 pt-4">
            {detailLoading || !detail ? (
              <div className="flex items-center justify-center gap-2 py-12">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm" style={{ color: TEXT_MUTED }}>hämtar match...</span>
              </div>
            ) : (
              <>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em]" style={{ color: TEXT_MUTED, fontFamily: FONT_MONO }}>Matchdetalj</p>
                    <h2 className="text-3xl font-black" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>
                      {detail.match.target_score || detail.match.game_type || 501}
                    </h2>
                    <p className="text-xs" style={{ color: TEXT_SECONDARY }}>
                      Mot {detail.opponents.map((opponent) => opponent.name).join(", ")}
                    </p>
                  </div>
                  <button onClick={() => setSelectedMatchId(null)} className="rounded-full p-2" style={{ background: PAGE_BG }}>
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <StatMini label="3-pil" value={formatDartAverage(detail.stats.average)} />
                  <StatMini label="Högsta" value={String(detail.stats.high_score)} />
                  <StatMini label="Checkout" value={detail.stats.high_checkout ? String(detail.stats.high_checkout) : "-"} />
                </div>
                <div className="mt-4 rounded-2xl overflow-hidden" style={{ border: `1px solid ${CARD_BORDER}` }}>
                  {detail.turns.map((turn) => {
                    const mine = turn.player_number === detail.player.number;
                    return (
                      <div key={turn.id} className="grid grid-cols-[44px_1fr_auto] items-center gap-2 px-3 py-2" style={{ borderTop: `1px solid ${CARD_BORDER}`, background: mine ? "#fff" : PAGE_BG }}>
                        <span className="text-[10px]" style={{ color: TEXT_MUTED }}>L{turn.leg_number}</span>
                        <div>
                          <p className="text-sm font-bold" style={{ color: TEXT_PRIMARY }}>
                            {mine ? detail.player.name : detail.opponents.find((opponent) => opponent.number === turn.player_number)?.name || "Motståndare"}
                          </p>
                          <p className="text-[10px]" style={{ color: TEXT_MUTED }}>
                            {turn.remaining_before} → {turn.remaining_after}
                            {turn.is_bust ? " · bust" : ""}
                            {turn.is_checkout ? " · checkout" : ""}
                            {turn.in_opened ? " · öppnad" : ""}
                          </p>
                        </div>
                        <span className="font-display text-xl font-black" style={{ color: mine ? BLUE : TEXT_PRIMARY }}>
                          {turn.entered_score ?? turn.score}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </motion.div>
  );
}

function StatMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl p-3 text-center" style={{ background: PAGE_BG }}>
      <p className="text-xl font-black" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>{value}</p>
      <p className="text-[9px] uppercase tracking-[0.12em]" style={{ color: TEXT_MUTED }}>{label}</p>
    </div>
  );
}

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
          <div className="flex items-center justify-center gap-2 px-4 py-4">
            <Loader2 className="w-4 h-4 animate-spin" style={{ color: TEXT_MUTED }} />
            <span className="text-xs" style={{ color: TEXT_MUTED, fontFamily: FONT_MONO }}>
              hämtar kort...
            </span>
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

function LegalLinksSection() {
  return (
    <motion.div variants={item}>
      <div className="flex items-center gap-2 mb-2">
        <FileText className="w-4 h-4" style={{ color: TEXT_MUTED }} />
        <span className="text-sm font-semibold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>
          Konto & dokument
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Integritet", to: "/privacy" },
          { label: "Villkor", to: "/terms" },
          { label: "Cookies", to: "/cookies" },
        ].map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="rounded-xl border px-2 py-2 text-center text-[11px] font-semibold active:scale-[0.98]"
            style={{ borderColor: CARD_BORDER, color: TEXT_SECONDARY, fontFamily: FONT_HEADING }}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </motion.div>
  );
}

const MyPage = () => {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const venueSlug = searchParams.get("v") || "pickla-arena-sthlm";
  const isActivityPage = pathname.startsWith("/activity");
  const authRedirectPath = isActivityPage ? "/activity" : "/today";

  const { data: profile } = usePlayerProfile();
  const { data: bookings } = useMyBookings();
  const { data: sessionRegistrations } = useMySessionRegistrations();
  const { data: eventRegistrations } = useMyEventRegistrations(profile);
  const { data: activeMembership } = useActiveMembership();
  const { data: membershipBenefits } = useMyPasses();
  const { data: activityThreads = [] } = useMyActivityThreads();
  const currentYear = new Date().getFullYear();
  const { data: currentYearReceipts } = useMyWellnessReceipts(currentYear);
  const { data: nextYearReceipts } = useMyWellnessReceipts(currentYear + 1);
  const activityThreadIds = activityThreads.map((thread) => thread.room.id);
  const { data: threadPreviews = {} } = useActivityThreadPreviews(activityThreadIds);
  const queryClient = useQueryClient();

  const [selectedBooking, setSelectedBooking] = useState<Record<string, unknown> | null>(null);
  const [selectedSessionRegistration, setSelectedSessionRegistration] = useState<MySessionRegistration | null>(null);
  const [showMembershipDetails, setShowMembershipDetails] = useState(false);
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    const bookingRefParam = searchParams.get("booking");
    if (!bookingRefParam || selectedBooking || !bookings?.length) return;
    const grouped = groupBookingRows((bookings || []).filter((booking) => {
      const status = (booking as { status?: string }).status;
      return status === "confirmed" || status === "pending";
    }));
    const match = grouped.find((booking) => {
      const bookingRecord = booking as Record<string, unknown>;
      const keys = new Set<string>();
      if (bookingRecord.id) keys.add(String(bookingRecord.id));
      if (bookingRecord.booking_ref) keys.add(String(bookingRecord.booking_ref));
      if (bookingRecord.primary_booking_ref) keys.add(String(bookingRecord.primary_booking_ref));
      const chatKey = getBookingChatResourceId(booking);
      if (chatKey) keys.add(String(chatKey));
      const rows = Array.isArray(bookingRecord.bookings) ? bookingRecord.bookings : [];
      rows.forEach((row) => {
        const rowRecord = row as Record<string, unknown>;
        if (rowRecord.id) keys.add(String(rowRecord.id));
        if (rowRecord.booking_ref) keys.add(String(rowRecord.booking_ref));
      });
      return keys.has(bookingRefParam);
    });
    if (match) setSelectedBooking(match);
  }, [bookings, searchParams, selectedBooking]);

  useEffect(() => {
    const registrationParam = searchParams.get("registration");
    if (!registrationParam || selectedSessionRegistration || !sessionRegistrations?.length) return;
    const match = sessionRegistrations.find((registration) => registration.id === registrationParam);
    if (match) setSelectedSessionRegistration(match);
  }, [searchParams, selectedSessionRegistration, sessionRegistrations]);

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

  const displayName = getDisplayName({ playerProfile: profile, authUser: user, fallback: "Spelare" }) || "Spelare";
  const greetingName = getFirstName({ playerProfile: profile, authUser: user, fallback: displayName }) || displayName;
  const now = Date.now();
  const activeBookings = groupBookingRows((bookings || []).filter((b: any) => (b.status === "confirmed" || b.status === "pending") && new Date(b.end_time).getTime() >= now));
  const pastBookings = groupBookingRows((bookings || []).filter((b: any) => (b.status === "confirmed" || b.status === "pending") && new Date(b.end_time).getTime() < now));
  const activeSessionRegistrations = (sessionRegistrations || []).filter((registration) => {
    const sessionEnd = getSessionRegistrationDateTime(registration, true);
    return sessionEnd ? sessionEnd.getTime() >= now : true;
  });
  const pastSessionRegistrations = (sessionRegistrations || []).filter((registration) => {
    const sessionEnd = getSessionRegistrationDateTime(registration, true);
    return sessionEnd ? sessionEnd.getTime() < now : false;
  });
  const activeEventRegistrations = (eventRegistrations || []).filter((registration) => {
    const eventEnd = getEventDateTime(registration.events, true);
    return eventEnd ? eventEnd.getTime() >= now : true;
  });
  const pastEventRegistrations = (eventRegistrations || []).filter((registration) => {
    const eventEnd = getEventDateTime(registration.events, true);
    return eventEnd ? eventEnd.getTime() < now : false;
  });
  const activeBookingCount = activeBookings.length + activeSessionRegistrations.length + activeEventRegistrations.length;
  const pastBookingCount = pastBookings.length + pastSessionRegistrations.length + pastEventRegistrations.length;
  const ownedBookingThreadKeys = getOwnedBookingThreadKeys(activeBookings);
  const visibleActivityThreads = activityThreads.filter(({ room }) =>
    room.room_type !== "booking" || !room.resource_id || !ownedBookingThreadKeys.has(room.resource_id)
  );
  const visibleThreadRoomIds = visibleActivityThreads.map((thread) => thread.room.id);
  const visibleThreadPreviews = Object.fromEntries(
    Object.entries(threadPreviews).filter(([roomId]) => visibleThreadRoomIds.includes(roomId))
  );
  const visibleMessageThreads = visibleActivityThreads
    .map(({ room, joined_at }) => {
      const preview = visibleThreadPreviews[room.id];
      const previewText = getConsumerThreadPreview(preview?.content);
      return { room, joined_at, preview, previewText };
    })
    .filter((thread) => Boolean(thread.previewText));
  const receiptItems = [
    ...(currentYearReceipts?.items || []),
    ...(nextYearReceipts?.items || []),
  ];
  const membershipTier = (activeMembership as any)?.membership_tiers || (membershipBenefits as any)?.membership?.tier;
  const membershipSummary = getMembershipShortSummary(membershipTier, membershipBenefits);
  const closeBookingDetails = (open: boolean) => {
    if (open) return;
    setSelectedBooking(null);
    if (searchParams.has("booking")) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("booking");
      setSearchParams(nextParams, { replace: true });
    }
  };
  const openSessionRegistrationDetails = (registration: MySessionRegistration) => {
    setSelectedSessionRegistration(registration);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("registration", registration.id);
    setSearchParams(nextParams, { replace: false });
  };
  const closeSessionRegistrationDetails = (open: boolean) => {
    if (open) return;
    setSelectedSessionRegistration(null);
    if (searchParams.has("registration")) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("registration");
      setSearchParams(nextParams, { replace: true });
    }
  };
  const handleSignOut = async () => {
    await signOut();
    navigate(`/?v=${encodeURIComponent(venueSlug)}`);
  };

  return (
    <div className="min-h-screen" style={{ background: PAGE_BG }}>
      <PicklaTopBar slug={venueSlug} showVenue={false} background={PAGE_BG} />

      {/* ═══ MAIN CONTENT ═══ */}
      <main className="pt-[calc(env(safe-area-inset-top,0px)+104px)] px-5 pb-16">
        <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col gap-4 max-w-md mx-auto">
          <motion.div variants={item}>
            <p className="text-lg font-bold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>
              {isActivityPage ? "Aktivitet" : `Hej ${greetingName} 👋`}
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
                        {membershipSummary || membershipTier?.description || "Aktivt medlemskap"}
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
                    key={getBookingChatResourceId(b)}
                    onClick={() => setSelectedBooking(b)}
                    className="rounded-xl p-3 flex items-center justify-between text-left active:scale-[0.98] transition-transform"
                    style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}` }}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium" style={{ color: TEXT_PRIMARY }}>{getBookingCourtLabel(b)}</p>
                      <p className="text-xs" style={{ color: TEXT_MUTED }}>
                        {new Date(b.start_time).toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" })}
                        {" "}
                        {new Date(b.start_time).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}–{new Date(b.end_time).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                      {b.court_count > 1 && (
                        <p className="text-[11px] mt-1 truncate" style={{ color: TEXT_MUTED }}>
                          {getBookingCourtNamesLabel(b)}
                        </p>
                      )}
                      <p className="text-[11px] mt-1" style={{ color: TEXT_SECONDARY }}>
                        Visa detaljer →
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
                {activeSessionRegistrations.map((registration) => {
                  const session = registration.activity_sessions;
                  const sessionStart = getSessionRegistrationDateTime(registration);
                  const sessionEnd = getSessionRegistrationDateTime(registration, true);

                  return (
                    <button
                      key={registration.id}
                      onClick={() => openSessionRegistrationDetails(registration)}
                      className="rounded-xl p-3 flex items-center justify-between text-left active:scale-[0.98] transition-transform"
                      style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}` }}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: TEXT_PRIMARY }}>
                          {session?.name || "Aktivitet"}
                        </p>
                        <p className="text-xs" style={{ color: TEXT_MUTED }}>
                          {sessionStart
                            ? sessionStart.toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" })
                            : "Datum kommer"}
                          {sessionStart ? ` ${sessionStart.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}` : ""}
                          {sessionEnd ? `–${sessionEnd.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}` : ""}
                        </p>
                        <p className="text-[11px] mt-1" style={{ color: TEXT_SECONDARY }}>
                          Aktivitet · {session?.venues?.name || "Pickla"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: GREEN_LIGHT, color: GREEN }}>
                          Anmäld
                        </span>
                        <Ticket className="w-4 h-4" style={{ color: TEXT_MUTED }} />
                      </div>
                    </button>
                  );
                })}
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

            <div className="mt-4">
              <div className="flex items-center gap-2 mb-2">
                <MessageCircle className="w-4 h-4" style={{ color: BLUE }} />
                <span className="text-sm font-semibold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>Meddelanden</span>
                {visibleMessageThreads.length > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: BLUE_LIGHT, color: BLUE }}>{visibleMessageThreads.length}</span>
                )}
              </div>
              {visibleMessageThreads.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {visibleMessageThreads.slice(0, 6).map(({ room, joined_at, preview, previewText }) => (
                    <button
                      key={room.id}
                      onClick={() => navigate(getThreadPath(room))}
                      className="rounded-xl p-3 text-left active:scale-[0.98] transition-transform"
                      style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}` }}
                    >
                      <ThreadRow
                        avatarInitials={getThreadInitials(room.title)}
                        avatarUrl={null}
                        displayName={room.title || "Konversation"}
                        lastMessagePreview={previewText}
                        timestamp={formatThreadTimestamp(preview?.created_at || room.updated_at || joined_at)}
                      />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl p-3 text-sm" style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}`, color: TEXT_SECONDARY }}>
                  Inga konversationer än — de dyker upp när du anmäler dig till något.
                </div>
              )}
            </div>

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
                        {pastSessionRegistrations.map((registration) => {
                          const session = registration.activity_sessions;
                          const sessionStart = getSessionRegistrationDateTime(registration);
                          const sessionEnd = getSessionRegistrationDateTime(registration, true);

                          return (
                            <button
                              key={registration.id}
                              onClick={() => openSessionRegistrationDetails(registration)}
                              className="rounded-xl p-3 flex items-center justify-between text-left opacity-70 active:scale-[0.98] transition-transform"
                              style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}` }}
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate" style={{ color: TEXT_PRIMARY }}>{session?.name || "Aktivitet"}</p>
                                <p className="text-xs" style={{ color: TEXT_MUTED }}>
                                  {sessionStart
                                    ? sessionStart.toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" })
                                    : "Datum kommer"}
                                  {sessionStart ? ` ${sessionStart.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}` : ""}
                                  {sessionEnd ? `–${sessionEnd.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}` : ""}
                                </p>
                                <p className="text-[11px] mt-1" style={{ color: TEXT_SECONDARY }}>
                                  Aktivitet · {session?.venues?.name || "Pickla"}
                                </p>
                              </div>
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: PAGE_BG, color: TEXT_SECONDARY }}>
                                Aktivitet
                              </span>
                            </button>
                          );
                        })}
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

          {/* Day passes — directly under bookings */}
          <DayPassSection />

          {!isActivityPage && (
            <motion.button
              variants={item}
              onClick={() => navigate("/wellness")}
              className="rounded-2xl p-4 flex items-center gap-3 text-left active:scale-[0.98] transition-transform"
              style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}` }}
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: GREEN_LIGHT }}>
                <FileText className="w-5 h-5" style={{ color: GREEN }} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>
                  Friskvårdsintyg
                </p>
                <p className="text-[11px]" style={{ fontFamily: FONT_MONO, color: TEXT_SECONDARY }}>
                  Samla årets kvitton och skriv ut →
                </p>
              </div>
            </motion.button>
          )}

          {/* Corporate memberships */}
          {!isActivityPage && <CorporateSection />}

          {/* Wallet: saved cards */}
          {!isActivityPage && <WalletSection />}

          {/* Settings: push notifications etc */}
          {!isActivityPage && <SettingsSection />}

          {!isActivityPage && <LegalLinksSection />}

          {!isActivityPage && (
            <motion.button
              variants={item}
              onClick={handleSignOut}
              className="rounded-2xl p-4 flex items-center justify-between text-left active:scale-[0.98] transition-transform"
              style={{ background: "#F4F0EE", border: `1.5px solid ${CARD_BORDER}` }}
            >
              <span className="text-sm font-bold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>
                Logga ut
              </span>
              <LogOut className="w-4 h-4" style={{ color: TEXT_MUTED }} />
            </motion.button>
          )}
        </motion.div>
      </main>

      <BookingDetailsSheet
        booking={selectedBooking}
        open={!!selectedBooking}
        onOpenChange={closeBookingDetails}
      />

      <SessionRegistrationDetailsSheet
        registration={selectedSessionRegistration}
        open={!!selectedSessionRegistration}
        onOpenChange={closeSessionRegistrationDetails}
        fallbackVenueSlug={venueSlug}
        activityThreads={activityThreads}
        receiptItems={receiptItems}
      />

      <MembershipDetailsSheet
        membership={activeMembership}
        benefitsData={membershipBenefits}
        open={showMembershipDetails}
        onOpenChange={setShowMembershipDetails}
      />
    </div>
  );
};

export default MyPage;
