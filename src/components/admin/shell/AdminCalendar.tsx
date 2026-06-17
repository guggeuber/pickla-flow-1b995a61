import { type InputHTMLAttributes, type TextareaHTMLAttributes, useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  Ban,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  EyeOff,
  Loader2,
  Plus,
  ShieldAlert,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";
import { useAdminCalendar, type AdminCalendarItem } from "@/hooks/useAdmin";
import { ax, AX_GRID_BG } from "./axTheme";
import { AX_TYPE, AxCard, AxChip, AxSectionLabel } from "./axPrimitives";

interface Props {
  venueId: string | undefined;
  onOpenModule: (id: string) => void;
}

interface MembershipTier {
  id: string;
  name: string;
  is_active: boolean;
}

interface TierPricing {
  tier_id: string;
  product_type: string;
  fixed_price: number | null;
  discount_percent: number | null;
}

interface MembershipEntitlement {
  tier_id: string;
  entitlement_type: string;
  value: number | null;
}

type SpecialPassPricingMode = "standard" | "fixed_ticket" | "member_discount";
type ActivitySessionMetadata = {
  online_price_sek?: number | null;
  desk_price_sek?: number | null;
  pricing_channel_mode?: string | null;
};

/* ───────── helpers ───────── */

function todayStockholm() {
  return DateTime.now().setZone("Europe/Stockholm").toISODate()!;
}

function labelDate(value: string, compact = false) {
  const date = DateTime.fromISO(value, { zone: "Europe/Stockholm" });
  if (!date.isValid) return value;
  return compact ? date.toFormat("ccc d/M") : date.toFormat("cccc d LLLL");
}

function kindLabel(kind: string) {
  if (kind === "activity") return "Aktivitet";
  if (kind === "event") return "Event";
  if (kind === "drift") return "Drift";
  if (kind === "block") return "Block";
  return kind;
}

function weekRange(selectedDate: string) {
  const day = DateTime.fromISO(selectedDate, { zone: "Europe/Stockholm" });
  const start = (day.isValid ? day : DateTime.now().setZone("Europe/Stockholm")).startOf("week");
  return {
    from: start.toISODate()!,
    to: start.plus({ days: 6 }).toISODate()!,
    dates: Array.from({ length: 7 }, (_, index) => start.plus({ days: index }).toISODate()!),
  };
}

function productKeyForSessionType(sessionType: string) {
  if (sessionType === "group_training") return "group_training";
  if (sessionType === "event") return "event_fee";
  return "open_play_slot";
}

function formatSek(amount: number) {
  return `${Math.round(amount).toLocaleString("sv-SE")} kr`;
}

function tierEffectivePrice(rule: TierPricing | undefined, standardPrice: number) {
  if (!rule) return standardPrice;
  if (rule.fixed_price != null) return Math.max(0, Math.round(Number(rule.fixed_price)));
  if (rule.discount_percent != null) {
    return Math.max(0, Math.round(standardPrice * (1 - Number(rule.discount_percent || 0) / 100)));
  }
  return standardPrice;
}

function clampPercent(value: string | number) {
  return Math.min(100, Math.max(0, Math.round(Number(value || 0))));
}

function parseSek(value: string | number) {
  return Math.max(0, Math.round(Number(value || 0)));
}

function deskPriceForOnline(value: string | number) {
  return parseSek(value) + 20;
}

/* Tone per kind. Used for timeline strip + chip color. */
const KIND_TONE: Record<string, { strip: string; chipTone: "lime" | "magenta" | "danger" | "sun"; label: string; glow: string }> = {
  activity: { strip: ax("lime"), chipTone: "lime", label: "AKTIVITET", glow: ax("lime", 0.35) },
  event: { strip: ax("magenta"), chipTone: "magenta", label: "EVENT", glow: ax("magenta", 0.35) },
  drift: { strip: ax("danger"), chipTone: "danger", label: "DRIFT", glow: ax("danger", 0.35) },
  block: { strip: ax("sun"), chipTone: "sun", label: "BLOCK", glow: ax("sun", 0.35) },
};

/* ───────── small primitives ───────── */

function PadInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl px-3.5 py-3 text-sm outline-none transition ${props.className || ""}`}
      style={{
        background: ax("surface"),
        border: `1px solid ${ax("border")}`,
        color: "white",
        fontSize: "16px", // iOS no-zoom
      }}
    />
  );
}

function PadTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full min-h-20 rounded-xl px-3.5 py-3 text-sm outline-none ${props.className || ""}`}
      style={{
        background: ax("surface"),
        border: `1px solid ${ax("border")}`,
        color: "white",
        fontSize: "16px",
      }}
    />
  );
}

function PadSelect({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl px-3.5 py-3 text-sm outline-none"
      style={{
        background: ax("surface"),
        border: `1px solid ${ax("border")}`,
        color: "white",
        fontSize: "16px",
      }}
    >
      {children}
    </select>
  );
}

/* ───────── Day strip (horizontal date picker) ───────── */

function DayStrip({
  selectedDate,
  onSelect,
  counts,
}: {
  selectedDate: string;
  onSelect: (d: string) => void;
  counts: Record<string, number>;
}) {
  const base = DateTime.fromISO(selectedDate, { zone: "Europe/Stockholm" });
  const start = (base.isValid ? base : DateTime.now().setZone("Europe/Stockholm")).minus({ days: 3 });
  const days = Array.from({ length: 7 }, (_, i) => start.plus({ days: i }));
  const today = todayStockholm();
  return (
    <div className="flex gap-2 overflow-x-auto px-1 pb-1 [-webkit-overflow-scrolling:touch]">
      {days.map((d) => {
        const iso = d.toISODate()!;
        const isSel = iso === selectedDate;
        const isToday = iso === today;
        const count = counts[iso] || 0;
        return (
          <motion.button
            key={iso}
            whileTap={{ scale: 0.94 }}
            onClick={() => onSelect(iso)}
            className="flex min-w-[64px] flex-col items-center gap-1 rounded-2xl px-3 py-2.5"
            style={{
              background: isSel ? ax("electric", 0.18) : ax("surfaceHi"),
              border: `1px solid ${isSel ? ax("electric", 0.6) : ax("borderSoft")}`,
              boxShadow: isSel ? `0 8px 24px -14px ${ax("electric", 0.7)}` : "none",
            }}
          >
            <span
              className="text-[9px] font-mono font-bold uppercase tracking-[0.18em]"
              style={{ color: isSel ? ax("electricSoft") : ax("muted") }}
            >
              {d.toFormat("ccc")}
            </span>
            <span
              className="font-display text-xl font-black leading-none"
              style={{ color: "white" }}
            >
              {d.toFormat("d")}
            </span>
            <span
              className="flex h-1.5 w-1.5 rounded-full"
              style={{
                background: count > 0 ? ax("lime") : isToday ? ax("electric") : "transparent",
              }}
            />
          </motion.button>
        );
      })}
    </div>
  );
}

/* ───────── Item card on timeline ───────── */

function TimelineItem({
  item,
  onTap,
}: {
  item: AdminCalendarItem;
  onTap: () => void;
}) {
  const tone = KIND_TONE[item.kind] || KIND_TONE.activity;
  const disabled = item.override_status === "hidden" || item.override_status === "cancelled";
  const time = item.end_time ? `${item.time}–${item.end_time}` : item.time;
  const cap = item.capacity ?? null;
  const reg = item.registrations_count ?? null;
  const pct = cap && reg != null ? Math.min(100, Math.round((reg / cap) * 100)) : null;

  return (
    <motion.button
      whileTap={{ scale: 0.985 }}
      onClick={onTap}
      className="relative flex w-full gap-3 overflow-hidden rounded-2xl p-3 text-left"
      style={{
        background: ax("surfaceHi"),
        border: `1px solid ${ax("borderSoft")}`,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {/* color strip */}
      <span
        aria-hidden
        className="absolute inset-y-2 left-0 w-1 rounded-full"
        style={{ background: tone.strip, boxShadow: `0 0 14px ${tone.glow}` }}
      />
      <div className="ml-2 flex w-14 shrink-0 flex-col items-start">
        <span
          className="font-mono text-[11px] font-bold tracking-wider"
          style={{ color: ax("electricSoft") }}
        >
          {item.time}
        </span>
        {item.end_time && (
          <span
            className="font-mono text-[10px]"
            style={{ color: ax("muted") }}
          >
            {item.end_time}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <AxChip tone={tone.chipTone}>{tone.label}</AxChip>
          {item.kind === "activity" && item.override_status === "hidden" && <AxChip tone="neutral">DOLD</AxChip>}
          {item.kind === "activity" && item.override_status === "cancelled" && <AxChip tone="danger">AVBOKAD</AxChip>}
          {item.kind === "event" && item.visibility && <AxChip tone="neutral">{String(item.visibility).toUpperCase()}</AxChip>}
        </div>
        <p className="mt-1 truncate text-[15px] font-black leading-tight" style={{ color: "white" }}>
          {item.title}
        </p>
        <div className="mt-1.5 flex items-center gap-3 text-[11px]" style={{ color: ax("muted") }}>
          {reg != null && (
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" />
              {reg}
              {cap ? `/${cap}` : ""}
            </span>
          )}
          {pct != null && (
            <span className="flex h-1 w-16 overflow-hidden rounded-full" style={{ background: ax("borderSoft") }}>
              <span
                className="h-full"
                style={{
                  width: `${pct}%`,
                  background:
                    pct >= 90 ? ax("danger") : pct >= 60 ? ax("sun") : ax("lime"),
                }}
              />
            </span>
          )}
        </div>
      </div>
      <ChevronRight className="mt-1 h-4 w-4 shrink-0" style={{ color: ax("muted") }} />
    </motion.button>
  );
}

/* ───────── Bottom sheet (mobile-first) ───────── */

function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40"
            style={{ background: "hsl(0 0% 0% / 0.65)", backdropFilter: "blur(6px)" }}
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 280 }}
            className="fixed inset-x-0 bottom-0 z-50 max-h-[92vh] overflow-y-auto rounded-t-3xl pb-safe [-webkit-overflow-scrolling:touch]"
            style={{
              background: ax("surface"),
              border: `1px solid ${ax("border")}`,
              boxShadow: `0 -30px 60px -20px ${ax("electric", 0.25)}`,
            }}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between px-5 pb-3 pt-4" style={{ background: ax("surface") }}>
              <div className="absolute left-1/2 top-1.5 h-1.5 w-10 -translate-x-1/2 rounded-full" style={{ background: ax("border") }} />
              <h3 className="font-display text-lg font-black" style={{ color: "white" }}>
                {title}
              </h3>
              <button
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-full"
                style={{ background: ax("surfaceHi"), color: "white" }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 pb-6">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ───────── Main ───────── */

export default function AdminCalendar({ venueId, onOpenModule }: Props) {
  const qc = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(todayStockholm());
  const [openItem, setOpenItem] = useState<AdminCalendarItem | null>(null);
  const [openCreate, setOpenCreate] = useState(false);
  const [openDrift, setOpenDrift] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState<AdminCalendarItem | null>(null);

  // Specialpass form state
  const [activityTitle, setActivityTitle] = useState("Fredagsklubben");
  const [activityDate, setActivityDate] = useState(todayStockholm());
  const [activityStart, setActivityStart] = useState("17:00");
  const [activityEnd, setActivityEnd] = useState("21:00");
  const [activityPrice, setActivityPrice] = useState("99");
  const [activityDeskPrice, setActivityDeskPrice] = useState("119");
  const [deskPriceTouched, setDeskPriceTouched] = useState(false);
  const [activityCapacity, setActivityCapacity] = useState("32");
  const [activityType, setActivityType] = useState("open_play");
  const [pricingMode, setPricingMode] = useState<SpecialPassPricingMode>("standard");
  const [memberDiscountPercent, setMemberDiscountPercent] = useState("10");
  const [activityNote, setActivityNote] = useState("");
  const [activityVisibility, setActivityVisibility] = useState<"public" | "private">("public");
  const [includedInDayPass, setIncludedInDayPass] = useState(true);
  const [includedInUnlimited, setIncludedInUnlimited] = useState(true);

  // Drift form state
  const [driftTitle, setDriftTitle] = useState("Driftavvikelse");
  const [driftStart, setDriftStart] = useState("18:00");
  const [driftEnd, setDriftEnd] = useState("21:00");

  useEffect(() => {
    setActivityDate(selectedDate);
  }, [selectedDate]);

  const handleOnlinePriceChange = (value: string) => {
    setActivityPrice(value);
    if (!deskPriceTouched) setActivityDeskPrice(String(deskPriceForOnline(value)));
  };

  // Fetch 7-day range so DayStrip dots are accurate
  const range = useMemo(() => weekRange(selectedDate), [selectedDate]);
  const calendarQ = useAdminCalendar(venueId, range.from, range.to);
  const items = calendarQ.data?.items || [];

  const { data: membershipTiers = [] } = useQuery<MembershipTier[]>({
    queryKey: ["membership-tiers", venueId],
    enabled: !!venueId,
    queryFn: () => apiGet("api-memberships", "tiers", { venueId, includeHidden: "true" }),
  });

  const tierPricingQueries = useQueries({
    queries: membershipTiers.map((tier) => ({
      queryKey: ["tier-pricing", tier.id],
      queryFn: () => apiGet<TierPricing[]>("api-memberships", "tier-pricing", { tierId: tier.id }),
      enabled: !!tier.id,
    })),
  });

  const tierEntitlementQueries = useQueries({
    queries: membershipTiers.map((tier) => ({
      queryKey: ["tier-entitlements", tier.id],
      queryFn: () => apiGet<MembershipEntitlement[]>("api-memberships", "tier-entitlements", { tierId: tier.id }),
      enabled: !!tier.id,
    })),
  });

  const allTierPricing = tierPricingQueries.flatMap((query) => query.data || []);
  const allTierEntitlements = tierEntitlementQueries.flatMap((query) => query.data || []);

  const dayItems = useMemo(
    () =>
      items
        .filter((i) => i.date === selectedDate)
        .sort((a, b) => (a.time || "").localeCompare(b.time || "")),
    [items, selectedDate],
  );

  const countsByDate = useMemo(() => {
    const m: Record<string, number> = {};
    for (const i of items) m[i.date] = (m[i.date] || 0) + 1;
    return m;
  }, [items]);

  const pricingPreview = useMemo(() => {
    const standardPrice = parseSek(activityPrice);
    const deskPrice = parseSek(activityDeskPrice || deskPriceForOnline(activityPrice));
    const deskDifference = deskPrice - standardPrice;
    const capacity = parseSek(activityCapacity);
    const productKey = productKeyForSessionType(activityType);
    const activeTiers = membershipTiers.filter((tier) => tier.is_active);
    const includedMemberships: string[] = [];
    const discountedMemberships: string[] = [];
    const standardMemberships: string[] = [];
    const paidPrices = new Set<number>(standardPrice > 0 ? [standardPrice] : []);
    const discountPercent = clampPercent(memberDiscountPercent);

    if (pricingMode === "fixed_ticket") {
      activeTiers.forEach((tier) => standardMemberships.push(tier.name));
      const lowestPaidPrice = standardPrice;
      return {
        modeLabel: "Fixed ticket price",
        standardPrice,
        deskPrice,
        deskDifference,
        capacity,
        productKey,
        activeTierCount: activeTiers.length,
        includedMemberships,
        discountedMemberships,
        standardMemberships,
        dayPassBehavior: "Dagsmedlemskap ger inte access. Alla köper biljett.",
        maxRevenue: capacity * standardPrice,
        lowestPaidPrice,
        lowestPaidRevenue: capacity * lowestPaidPrice,
        hasIncludedAccess: false,
      };
    }

    if (pricingMode === "member_discount") {
      const memberPrice = Math.max(0, Math.round(standardPrice * (1 - discountPercent / 100)));
      activeTiers.forEach((tier) => {
        if (memberPrice < standardPrice) {
          discountedMemberships.push(`${tier.name} (${formatSek(memberPrice)})`);
        } else {
          standardMemberships.push(tier.name);
        }
      });
      const lowestPaidPrice = memberPrice;
      return {
        modeLabel: "Member discount",
        standardPrice,
        deskPrice,
        deskDifference,
        capacity,
        productKey,
        activeTierCount: activeTiers.length,
        includedMemberships,
        discountedMemberships,
        standardMemberships,
        dayPassBehavior: "Dagsmedlemskap ger inte access. Medlemmar får endast biljett-rabatt.",
        maxRevenue: capacity * standardPrice,
        lowestPaidPrice,
        lowestPaidRevenue: capacity * lowestPaidPrice,
        hasIncludedAccess: false,
      };
    }

    activeTiers.forEach((tier) => {
      if (!includedInUnlimited) {
        standardMemberships.push(tier.name);
        paidPrices.add(standardPrice);
        return;
      }

      const rule = allTierPricing.find((row) => row.tier_id === tier.id && row.product_type === productKey);
      const hasOpenPlayUnlimited = allTierEntitlements.some((row) =>
        row.tier_id === tier.id &&
        row.entitlement_type === "open_play_unlimited" &&
        Number(row.value || 0) > 0
      );
      const isIncludedByUnlimited = includedInUnlimited && productKey === "open_play_slot" && hasOpenPlayUnlimited;

      if (isIncludedByUnlimited) {
        includedMemberships.push(tier.name);
        return;
      }

      const effectivePrice = tierEffectivePrice(rule, standardPrice);
      if (rule && effectivePrice <= 0) {
        includedMemberships.push(`${tier.name} (${rule.fixed_price != null ? "fast 0 kr" : "100% rabatt"})`);
        return;
      }
      if (effectivePrice < standardPrice) {
        discountedMemberships.push(`${tier.name} (${formatSek(effectivePrice)})`);
        paidPrices.add(effectivePrice);
        return;
      }

      standardMemberships.push(tier.name);
      if (effectivePrice > 0) paidPrices.add(effectivePrice);
    });

    const lowestPaidPrice = paidPrices.size > 0 ? Math.min(...Array.from(paidPrices)) : 0;

    return {
      modeLabel: "Standard pricing",
      standardPrice,
      deskPrice,
      deskDifference,
      capacity,
      productKey,
      activeTierCount: activeTiers.length,
      includedMemberships,
      discountedMemberships,
      standardMemberships,
      dayPassBehavior: includedInDayPass
        ? "Dagsmedlemskap ger access till passet."
        : "Dagsmedlemskap ger inte access. Kunden behöver köpa passet separat.",
      maxRevenue: capacity * standardPrice,
      lowestPaidPrice,
      lowestPaidRevenue: capacity * lowestPaidPrice,
      hasIncludedAccess: includedInDayPass || includedMemberships.length > 0,
    };
  }, [
    activityCapacity,
    activityDeskPrice,
    activityPrice,
    activityType,
    allTierEntitlements,
    allTierPricing,
    includedInDayPass,
    includedInUnlimited,
    memberDiscountPercent,
    membershipTiers,
    pricingMode,
  ]);

  const invalidateCalendar = () => {
    qc.invalidateQueries({ queryKey: ["admin-calendar", venueId] });
    qc.invalidateQueries({ queryKey: ["admin-todays-plan", venueId] });
    qc.invalidateQueries({ queryKey: ["admin-venue-operation-overrides", venueId] });
    qc.invalidateQueries({ queryKey: ["admin-activity-sessions", venueId] });
  };

  const activityOverride = useMutation({
    mutationFn: ({ item, status }: { item: AdminCalendarItem; status: "hidden" | "cancelled" }) =>
      apiPost("api-admin", "activity-session-overrides", {
        venueId,
        activity_session_id: item.activity_session_id || item.source_id,
        session_date: item.date,
        status,
        reason: "Calendar operation",
        confirm: true,
      }),
    onSuccess: (_, vars) => {
      toast.success(vars.status === "hidden" ? "Aktivitet dold" : "Aktivitet avbokad");
      invalidateCalendar();
      setOpenItem(null);
      setConfirmCancel(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const createActivity = useMutation({
    mutationFn: () =>
      apiPost("api-admin", "activity-sessions", {
        venueId,
        name: activityTitle.trim(),
        session_type: activityType,
        product_key: productKeyForSessionType(activityType),
        session_date: activityDate,
        recurrence_days: null,
        start_time: activityStart,
        end_time: activityEnd,
        price_sek: parseSek(activityPrice),
        capacity: activityCapacity ? parseSek(activityCapacity) : null,
        is_active: true,
        publish_status: activityVisibility === "public" ? "published" : "hidden",
        access_policy: {
          sold_as: "activity_ticket",
          allows_day_access: pricingMode === "standard" && includedInDayPass,
          includes_day_access: false,
          member_benefit_key: pricingMode === "standard" && includedInUnlimited ? "open_play_unlimited" : null,
        },
        metadata: {
          public_note: activityNote.trim() || null,
          created_from: "admin_calendar",
          visibility: activityVisibility,
          pricing_mode: pricingMode,
          member_discount_percent: pricingMode === "member_discount" ? clampPercent(memberDiscountPercent) : null,
          day_pass_included: pricingMode === "standard" ? includedInDayPass : false,
          membership_included: pricingMode === "standard" ? includedInUnlimited : false,
          online_price_sek: parseSek(activityPrice),
          desk_price_sek: parseSek(activityDeskPrice || deskPriceForOnline(activityPrice)),
          pricing_channel_mode: "online_discount",
        },
      }),
    onSuccess: () => {
      toast.success("Specialpass publicerat");
      setSelectedDate(activityDate);
      invalidateCalendar();
      setOpenCreate(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const createDrift = useMutation({
    mutationFn: () =>
      apiPost("api-admin", "venue-operation-overrides", {
        venueId,
        title: driftTitle.trim() || "Driftavvikelse",
        reason: "Created from Admin Calendar",
        override_type: "other",
        date: selectedDate,
        start_time: driftStart,
        end_time: driftEnd,
        affects_entire_venue: true,
        venue_court_ids: [],
      }),
    onSuccess: () => {
      toast.success("Drift skapad");
      invalidateCalendar();
      setOpenDrift(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const moveDay = (d: number) => {
    const base = DateTime.fromISO(selectedDate, { zone: "Europe/Stockholm" });
    setSelectedDate(base.plus({ days: d }).toISODate()!);
  };

  if (!venueId) {
    return <p className="py-8 text-center text-sm" style={{ color: ax("muted") }}>Välj venue först.</p>;
  }

  const isToday = selectedDate === todayStockholm();
  const headerDate = DateTime.fromISO(selectedDate, { zone: "Europe/Stockholm" });

  return (
    <div className="space-y-4 pb-32">
      {/* ── HERO HEADER ── */}
      <div
        className="relative overflow-hidden rounded-3xl p-5"
        style={{
          background: `linear-gradient(135deg, ${ax("electric", 0.12)}, ${ax("magenta", 0.08)})`,
          border: `1px solid ${ax("borderSoft")}`,
        }}
      >
        <div className="absolute inset-0 opacity-40" style={AX_GRID_BG} />
        <div className="relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4" style={{ color: ax("electricSoft") }} />
              <p className={AX_TYPE.micro} style={{ color: ax("electricSoft") }}>
                CALENDAR · DAY OPS
              </p>
            </div>
            {calendarQ.isFetching && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: ax("muted") }} />
            )}
          </div>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div>
              <p className="font-display text-3xl font-black capitalize leading-none" style={{ color: "white" }}>
                {headerDate.toFormat("cccc")}
              </p>
              <p className="mt-1 font-mono text-sm" style={{ color: ax("muted") }}>
                {headerDate.toFormat("d LLLL yyyy")}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <motion.button
                whileTap={{ scale: 0.92 }}
                onClick={() => moveDay(-1)}
                className="flex h-10 w-10 items-center justify-center rounded-xl"
                style={{ background: ax("surfaceHi"), color: "white" }}
              >
                <ChevronLeft className="h-4 w-4" />
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => setSelectedDate(todayStockholm())}
                className="rounded-xl px-3.5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-wider"
                style={{
                  background: isToday ? ax("electric") : ax("surfaceHi"),
                  color: isToday ? "hsl(220 25% 10%)" : "white",
                }}
              >
                Idag
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.92 }}
                onClick={() => moveDay(1)}
                className="flex h-10 w-10 items-center justify-center rounded-xl"
                style={{ background: ax("surfaceHi"), color: "white" }}
              >
                <ChevronRight className="h-4 w-4" />
              </motion.button>
            </div>
          </div>
        </div>
      </div>

      {/* ── DAY STRIP ── */}
      <DayStrip selectedDate={selectedDate} onSelect={setSelectedDate} counts={countsByDate} />

      {/* ── QUICK ACTIONS ── */}
      <div className="grid grid-cols-2 gap-2.5">
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => setOpenCreate(true)}
          className="relative flex items-center gap-3 overflow-hidden rounded-2xl p-4 text-left"
          style={{
            background: `linear-gradient(135deg, ${ax("electric", 0.18)}, ${ax("magenta", 0.12)})`,
            border: `1px solid ${ax("electric", 0.45)}`,
            boxShadow: `0 10px 28px -16px ${ax("electric", 0.6)}`,
          }}
        >
          <div
            className="flex h-10 w-10 items-center justify-center rounded-xl"
            style={{ background: ax("electric"), color: "hsl(220 25% 10%)" }}
          >
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-black leading-tight" style={{ color: "white" }}>
              Skapa specialpass
            </p>
            <p className="mt-0.5 text-[11px]" style={{ color: ax("muted") }}>
              One-off, publikt & betalt
            </p>
          </div>
        </motion.button>

        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => setOpenDrift(true)}
          className="relative flex items-center gap-3 overflow-hidden rounded-2xl p-4 text-left"
          style={{
            background: ax("surfaceHi"),
            border: `1px dashed ${ax("danger", 0.5)}`,
          }}
        >
          <div
            className="flex h-10 w-10 items-center justify-center rounded-xl"
            style={{ background: ax("danger", 0.18), color: ax("danger") }}
          >
            <ShieldAlert className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-black leading-tight" style={{ color: "white" }}>
              Drift
            </p>
            <p className="mt-0.5 text-[11px]" style={{ color: ax("muted") }}>
              Operativ exception
            </p>
          </div>
        </motion.button>
      </div>

      {/* ── TIMELINE ── */}
      <div className="space-y-2.5">
        <AxSectionLabel icon={Clock} accent={ax("electricSoft")}>
          {dayItems.length === 0 ? "Inget planerat" : `${dayItems.length} på schemat`}
        </AxSectionLabel>

        {calendarQ.isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: ax("muted") }} />
          </div>
        ) : dayItems.length === 0 ? (
          <AxCard>
            <div className="flex items-center gap-3 py-2">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-xl"
                style={{ background: ax("surface"), border: `1px solid ${ax("border")}` }}
              >
                <CalendarDays className="h-4 w-4" style={{ color: ax("muted") }} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold" style={{ color: "white" }}>
                  Tom dag
                </p>
                <p className="text-[11px]" style={{ color: ax("muted") }}>
                  Skapa ett specialpass eller lägg in drift för {labelDate(selectedDate, true)}.
                </p>
              </div>
            </div>
          </AxCard>
        ) : (
          dayItems.map((item) => (
            <TimelineItem key={item.id} item={item} onTap={() => setOpenItem(item)} />
          ))
        )}
      </div>

      {/* ── ITEM ACTION SHEET ── */}
      <Sheet open={!!openItem} onClose={() => setOpenItem(null)} title={openItem?.title || ""}>
        {openItem && (
          <ItemActions
            item={openItem}
            onOpenModule={(id) => {
              setOpenItem(null);
              onOpenModule(id);
            }}
            onHide={() => activityOverride.mutate({ item: openItem, status: "hidden" })}
            onCancel={() => setConfirmCancel(openItem)}
            isPending={activityOverride.isPending}
          />
        )}
      </Sheet>

      {/* ── CANCEL CONFIRM ── */}
      <Sheet open={!!confirmCancel} onClose={() => setConfirmCancel(null)} title="Avboka pass?">
        {confirmCancel && (
          <div className="space-y-4 pt-2">
            <div
              className="rounded-2xl p-4"
              style={{
                background: ax("danger", 0.1),
                border: `1px solid ${ax("danger", 0.4)}`,
              }}
            >
              <p className="text-sm font-bold" style={{ color: "white" }}>
                {confirmCancel.title}
              </p>
              <p className="mt-1 text-xs" style={{ color: ax("muted") }}>
                {labelDate(confirmCancel.date)} · {confirmCancel.time}
                {confirmCancel.end_time ? `–${confirmCancel.end_time}` : ""}
              </p>
              {Number(confirmCancel.registrations_count || 0) > 0 && (
                <p className="mt-3 text-xs font-bold" style={{ color: ax("danger") }}>
                  ⚠ {confirmCancel.registrations_count} anmälda kommer att meddelas.
                </p>
              )}
            </div>
            <button
              onClick={() => activityOverride.mutate({ item: confirmCancel, status: "cancelled" })}
              disabled={activityOverride.isPending}
              className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 font-display text-sm font-black disabled:opacity-50"
              style={{ background: ax("danger"), color: "white" }}
            >
              {activityOverride.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Ban className="h-4 w-4" />
              )}
              Ja, avboka passet
            </button>
            <button
              onClick={() => setConfirmCancel(null)}
              className="w-full rounded-2xl py-3 text-sm font-bold"
              style={{ background: ax("surfaceHi"), color: "white" }}
            >
              Avbryt
            </button>
          </div>
        )}
      </Sheet>

      {/* ── SPECIALPASS CREATE SHEET ── */}
      <Sheet open={openCreate} onClose={() => setOpenCreate(false)} title="Skapa specialpass">
        <div className="space-y-5 pt-2">
          {/* Vad */}
          <Step n={1} label="Vad?">
            <PadInput
              value={activityTitle}
              onChange={(e) => setActivityTitle(e.target.value)}
              placeholder="Titel (t.ex. Fredagsklubben)"
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <PadSelect value={activityType} onChange={setActivityType}>
                <option value="club_night">Klubbkväll</option>
                <option value="open_play">Open Play</option>
                <option value="group_training">Gruppträning</option>
                <option value="event">Event</option>
              </PadSelect>
              <PadSelect value={activityVisibility} onChange={(v) => setActivityVisibility(v as "public" | "private")}>
                <option value="public">Publikt</option>
                <option value="private">Privat</option>
              </PadSelect>
            </div>
          </Step>

          {/* När */}
          <Step n={2} label="När?">
            <div className="grid grid-cols-3 gap-2">
              <PadInput type="date" value={activityDate} onChange={(e) => setActivityDate(e.target.value)} />
              <PadInput type="time" value={activityStart} onChange={(e) => setActivityStart(e.target.value)} />
              <PadInput type="time" value={activityEnd} onChange={(e) => setActivityEnd(e.target.value)} />
            </div>
          </Step>

          {/* Pris & kapacitet */}
          <Step n={3} label="Pris & kapacitet">
            <div className="mb-2">
              <PadSelect value={pricingMode} onChange={(v) => setPricingMode(v as SpecialPassPricingMode)}>
                <option value="standard">Standard pricing</option>
                <option value="fixed_ticket">Fixed ticket price</option>
                <option value="member_discount">Member discount</option>
              </PadSelect>
              <p className="mt-1.5 text-[11px]" style={{ color: ax("muted") }}>
                {pricingMode === "fixed_ticket"
                  ? "Alla betalar angivet pris. Medlemsrabatter och dagsmedlemskap används inte."
                  : pricingMode === "member_discount"
                  ? "Standardkunder betalar angivet pris. Aktiva medlemmar får rabatt."
                  : "Använder befintliga medlems- och dagsmedlemskapsregler."}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <PadInput
                type="number"
                inputMode="numeric"
                value={activityPrice}
                onChange={(e) => handleOnlinePriceChange(e.target.value)}
                placeholder="Onlinepris"
              />
              <PadInput
                type="number"
                inputMode="numeric"
                value={activityDeskPrice}
                onChange={(e) => {
                  setDeskPriceTouched(true);
                  setActivityDeskPrice(e.target.value);
                }}
                placeholder="Deskpris"
              />
            </div>
            <p className="mt-1.5 text-[11px] font-bold" style={{ color: ax("lime") }}>
              Billigare online – styr gäster till playpickla.com
            </p>
            <div className="mt-2">
              <PadInput
                type="number"
                inputMode="numeric"
                value={activityCapacity}
                onChange={(e) => setActivityCapacity(e.target.value)}
                placeholder="Max"
              />
            </div>
            {pricingMode === "standard" && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Toggle
                  label="Day pass"
                  checked={includedInDayPass}
                  onChange={setIncludedInDayPass}
                />
                <Toggle
                  label="Membership"
                  checked={includedInUnlimited}
                  onChange={setIncludedInUnlimited}
                />
              </div>
            )}
            {pricingMode === "member_discount" && (
              <div className="mt-2">
                <PadInput
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  value={memberDiscountPercent}
                  onChange={(e) => setMemberDiscountPercent(e.target.value)}
                  placeholder="Medlemsrabatt %"
                />
              </div>
            )}
            <PricingPreview preview={pricingPreview} />
          </Step>

          {/* Publicering */}
          <Step n={4} label="Publicering">
            <PadTextarea
              value={activityNote}
              onChange={(e) => setActivityNote(e.target.value)}
              placeholder="Publik beskrivning (valfritt)"
            />
          </Step>

          <button
            onClick={() => createActivity.mutate()}
            disabled={
              !activityTitle.trim() ||
              !activityDate ||
              !activityStart ||
              !activityEnd ||
              !activityPrice ||
              !activityCapacity ||
              createActivity.isPending
            }
            className="sticky bottom-0 flex w-full items-center justify-center gap-2 rounded-2xl py-4 font-display text-base font-black disabled:opacity-50"
            style={{
              background: `linear-gradient(135deg, ${ax("electric")}, ${ax("magenta")})`,
              color: "white",
              boxShadow: `0 14px 32px -16px ${ax("electric", 0.7)}`,
            }}
          >
            {createActivity.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Publicera specialpass
          </button>
        </div>
      </Sheet>

      {/* ── DRIFT CREATE SHEET ── */}
      <Sheet open={openDrift} onClose={() => setOpenDrift(false)} title="Skapa drift">
        <div className="space-y-4 pt-2">
          <div
            className="flex items-start gap-3 rounded-2xl p-3"
            style={{
              background: ax("danger", 0.08),
              border: `1px solid ${ax("danger", 0.3)}`,
            }}
          >
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" style={{ color: ax("danger") }} />
            <p className="text-[12px] leading-relaxed" style={{ color: ax("muted") }}>
              Drift är en operativ exception — t.ex. städ, läckage eller stängt. Gäller hela
              hallen för valt tidsfönster på {labelDate(selectedDate, true)}.
            </p>
          </div>
          <PadInput
            value={driftTitle}
            onChange={(e) => setDriftTitle(e.target.value)}
            placeholder="Vad händer? (t.ex. Stängt för städ)"
          />
          <div className="grid grid-cols-2 gap-2">
            <PadInput type="time" value={driftStart} onChange={(e) => setDriftStart(e.target.value)} />
            <PadInput type="time" value={driftEnd} onChange={(e) => setDriftEnd(e.target.value)} />
          </div>
          <button
            onClick={() => createDrift.mutate()}
            disabled={createDrift.isPending}
            className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 font-display text-sm font-black disabled:opacity-50"
            style={{ background: ax("danger"), color: "white" }}
          >
            {createDrift.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Ban className="h-4 w-4" />
            )}
            Skapa drift {labelDate(selectedDate, true)}
          </button>
        </div>
      </Sheet>
    </div>
  );
}

/* ───────── Item action sheet body ───────── */

function ItemActions({
  item,
  onOpenModule,
  onHide,
  onCancel,
  isPending,
}: {
  item: AdminCalendarItem;
  onOpenModule: (id: string) => void;
  onHide: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const tone = KIND_TONE[item.kind] || KIND_TONE.activity;
  const disabled = item.override_status === "hidden" || item.override_status === "cancelled";
  const time = item.end_time ? `${item.time}–${item.end_time}` : item.time;
  const cap = item.capacity ?? null;
  const reg = item.registrations_count ?? null;
  const onlinePrice = Number(item.online_price_sek ?? item.price_sek ?? 0);
  const deskPrice = Number(item.desk_price_sek ?? item.price_sek ?? 0);
  return (
    <div className="space-y-4 pt-2">
      <div
        className="relative overflow-hidden rounded-2xl p-4"
        style={{
          background: ax("surfaceHi"),
          border: `1px solid ${ax("borderSoft")}`,
        }}
      >
        <span
          aria-hidden
          className="absolute inset-y-3 left-0 w-1 rounded-full"
          style={{ background: tone.strip, boxShadow: `0 0 14px ${tone.glow}` }}
        />
        <div className="ml-3 flex flex-wrap items-center gap-1.5">
          <AxChip tone={tone.chipTone}>{tone.label}</AxChip>
          <span className="font-mono text-[11px] font-bold" style={{ color: ax("electricSoft") }}>
            {time}
          </span>
        </div>
        <div className="ml-3 mt-3 grid grid-cols-2 gap-3 text-[11px]" style={{ color: ax("muted") }}>
          {item.kind === "activity" && (onlinePrice > 0 || deskPrice > 0) && (
            <div>
              <p className="font-mono uppercase tracking-wider">Pris</p>
              <p className="mt-0.5 font-display text-lg font-black" style={{ color: "white" }}>
                Online {formatSek(onlinePrice)}
              </p>
              <p className="text-[10px] font-bold" style={{ color: ax("lime") }}>
                Desk {formatSek(deskPrice)}
              </p>
            </div>
          )}
          {reg != null && (
            <div>
              <p className="font-mono uppercase tracking-wider">Anmälda</p>
              <p className="mt-0.5 font-display text-lg font-black" style={{ color: "white" }}>
                {reg}
                {cap ? ` / ${cap}` : ""}
              </p>
            </div>
          )}
          {item.visibility && (
            <div>
              <p className="font-mono uppercase tracking-wider">Synlighet</p>
              <p className="mt-0.5 font-display text-lg font-black capitalize" style={{ color: "white" }}>
                {item.visibility}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-2">
        {item.moduleTarget && (
          <button
            onClick={() => onOpenModule(item.moduleTarget!)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 font-display text-sm font-black"
            style={{
              background: ax("electric"),
              color: "hsl(220 25% 10%)",
            }}
          >
            Öppna <ExternalLink className="h-4 w-4" />
          </button>
        )}
        {item.kind === "activity" && (
          <div className="grid grid-cols-2 gap-2">
            <button
              disabled={disabled || isPending}
              onClick={onHide}
              className="flex items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold disabled:opacity-40"
              style={{
                background: ax("surfaceHi"),
                border: `1px solid ${ax("border")}`,
                color: "white",
              }}
            >
              <EyeOff className="h-4 w-4" /> Dölj
            </button>
            <button
              disabled={disabled || isPending}
              onClick={onCancel}
              className="flex items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold disabled:opacity-40"
              style={{
                background: ax("danger", 0.15),
                border: `1px solid ${ax("danger", 0.5)}`,
                color: ax("danger"),
              }}
            >
              <Ban className="h-4 w-4" /> Avboka
            </button>
          </div>
        )}
        {!item.moduleTarget && item.kind !== "activity" && (
          <p className="text-center text-[11px]" style={{ color: ax("muted") }}>
            Inga snabbåtgärder för denna typ.
          </p>
        )}
      </div>
    </div>
  );
}

/* ───────── Step + Toggle helpers ───────── */

function PricingPreview({
  preview,
}: {
  preview: {
    modeLabel: string;
    standardPrice: number;
    deskPrice: number;
    deskDifference: number;
    capacity: number;
    productKey: string;
    activeTierCount: number;
    includedMemberships: string[];
    discountedMemberships: string[];
    standardMemberships: string[];
    dayPassBehavior: string;
    maxRevenue: number;
    lowestPaidPrice: number;
    lowestPaidRevenue: number;
    hasIncludedAccess: boolean;
  };
}) {
  return (
    <div
      className="mt-3 space-y-3 rounded-2xl p-3"
      style={{
        background: `linear-gradient(135deg, ${ax("electric", 0.1)}, ${ax("surfaceHi")})`,
        border: `1px solid ${ax("electric", 0.32)}`,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={AX_TYPE.micro} style={{ color: ax("electricSoft") }}>
            PRICING PREVIEW
          </p>
          <p className="mt-1 text-[11px]" style={{ color: ax("muted") }}>
            Visar befintliga medlems- och dagsmedlemskapsregler innan publicering.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <AxChip tone="neutral">{preview.modeLabel}</AxChip>
          <AxChip tone="neutral">{preview.productKey}</AxChip>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <PreviewMetric label="Online" value={formatSek(preview.standardPrice)} />
        <PreviewMetric
          label="Desk"
          value={formatSek(preview.deskPrice)}
          helper={`${preview.deskDifference >= 0 ? "+" : ""}${formatSek(preview.deskDifference)} vid desk`}
        />
        <PreviewMetric
          label="Online maxintäkt"
          value={formatSek(preview.maxRevenue)}
          helper={`${preview.capacity} x ${formatSek(preview.standardPrice)}`}
        />
        <PreviewMetric
          label="Lägsta betalda scenario"
          value={formatSek(preview.lowestPaidRevenue)}
          helper={`${preview.capacity} x ${formatSek(preview.lowestPaidPrice)}`}
        />
      </div>
      <p
        className="rounded-xl px-3 py-2 text-[11px] font-bold"
        style={{
          background: ax("lime", 0.08),
          border: `1px solid ${ax("lime", 0.24)}`,
          color: ax("lime"),
        }}
      >
        Billigare online – styr gäster till playpickla.com
      </p>

      <div className="space-y-2">
        <PreviewLine label="Aktiva tiers" value={`${preview.activeTierCount} tiers kontrolleras`} />
        <PreviewLine
          label="Ingår för"
          value={preview.includedMemberships.length > 0 ? preview.includedMemberships.join(", ") : "Inga tiers får fri access via nuvarande regler."}
        />
        <PreviewLine
          label="Rabatterat för"
          value={preview.discountedMemberships.length > 0 ? preview.discountedMemberships.join(", ") : "Inga rabatterade tier-priser hittades."}
        />
        <PreviewLine
          label="Betalar standardpris"
          value={preview.standardMemberships.length > 0 ? preview.standardMemberships.join(", ") : "Inga aktiva tiers betalar standardpris."}
        />
        <PreviewLine label="Day pass" value={preview.dayPassBehavior} />
      </div>

      {preview.hasIncludedAccess && (
        <p
          className="rounded-xl px-3 py-2 text-[11px] font-bold"
          style={{
            background: ax("lime", 0.1),
            border: `1px solid ${ax("lime", 0.28)}`,
            color: ax("lime"),
          }}
        >
          Intäkten blir lägre än max om platser tas av inkluderade medlemskap eller dagsmedlemskap.
        </p>
      )}
    </div>
  );
}

function PreviewMetric({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <div
      className="rounded-xl p-3"
      style={{
        background: ax("surfaceHi"),
        border: `1px solid ${ax("borderSoft")}`,
      }}
    >
      <p className="font-mono text-[9px] font-bold uppercase tracking-[0.16em]" style={{ color: ax("muted") }}>
        {label}
      </p>
      <p className="mt-1 font-display text-lg font-black" style={{ color: "white" }}>
        {value}
      </p>
      {helper && (
        <p className="mt-0.5 text-[10px]" style={{ color: ax("muted") }}>
          {helper}
        </p>
      )}
    </div>
  );
}

function PreviewLine({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-xl px-3 py-2"
      style={{
        background: ax("surface"),
        border: `1px solid ${ax("borderSoft")}`,
      }}
    >
      <p className="font-mono text-[9px] font-bold uppercase tracking-[0.16em]" style={{ color: ax("muted") }}>
        {label}
      </p>
      <p className="mt-0.5 text-[12px] font-bold leading-snug" style={{ color: "white" }}>
        {value}
      </p>
    </div>
  );
}

function Step({ n, label, children }: { n: number; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span
          className="flex h-6 w-6 items-center justify-center rounded-lg font-mono text-[11px] font-black"
          style={{ background: ax("electric"), color: "hsl(220 25% 10%)" }}
        >
          {n}
        </span>
        <p className="font-display text-sm font-black" style={{ color: "white" }}>
          {label}
        </p>
      </div>
      {children}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between rounded-xl px-3.5 py-3 text-[12px] font-bold"
      style={{
        background: checked ? ax("lime", 0.12) : ax("surfaceHi"),
        border: `1px solid ${checked ? ax("lime", 0.5) : ax("border")}`,
        color: checked ? ax("lime") : "white",
      }}
    >
      <span>{label}</span>
      <span
        className="flex h-5 w-9 items-center rounded-full p-0.5 transition"
        style={{ background: checked ? ax("lime", 0.6) : ax("border") }}
      >
        <motion.span
          animate={{ x: checked ? 16 : 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          className="h-4 w-4 rounded-full"
          style={{ background: "white" }}
        />
      </span>
    </button>
  );
}
