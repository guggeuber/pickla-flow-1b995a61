import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useAdminPricing, useAdminMutation } from "@/hooks/useAdmin";
import { Check, CreditCard, Loader2, Pencil, Plus, Tag, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { DateTime } from "luxon";
import { apiGet } from "@/lib/api";
import { formatSek, resolveProductPricingPreview } from "@/lib/activityPricing";

const DAY_LABELS = ["Sön", "Mån", "Tis", "Ons", "Tor", "Fre", "Lör"];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const SPORT_TYPES = [
  { value: "", label: "Alla sporter" },
  { value: "pickleball", label: "Pickleball" },
  { value: "dart", label: "Dart" },
];
const COURT_TYPES = [
  { value: "", label: "Alla bantyper" },
  { value: "indoor", label: "Indoor" },
  { value: "outdoor", label: "Outdoor" },
  { value: "vip", label: "VIP" },
];
const CHANNELS = ["online", "desk", "corporate", "affiliate", "host", "ambassador", "guest", "member"];
const PROMOTIONS = [
  { key: "none", label: "Ingen promotion" },
  { key: "future_code", label: "Promo code (framtid)" },
  { key: "future_referral", label: "Referral (framtid)" },
  { key: "future_campaign", label: "Campaign (framtid)" },
];

type MembershipTier = {
  id: string;
  name: string;
  is_active: boolean;
};

type TierPricing = {
  tier_id: string;
  product_type: string;
  fixed_price: number | null;
  discount_percent: number | null;
  label?: string | null;
};

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}>
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{label}</p>
      <p className="mt-1 text-lg font-display font-black">{value}</p>
    </div>
  );
}

function PricePill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg px-2 py-1.5" style={{ background: "hsl(var(--surface-1))" }}>
      <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="font-bold">{value}</p>
    </div>
  );
}

const AdminPricing = ({ venueId }: { venueId: string }) => {
  const { data: pricing, isLoading } = useAdminPricing(venueId);
  const { addPricing, updatePricing, deletePricing } = useAdminMutation(venueId);
  const today = DateTime.now().setZone("Europe/Stockholm");
  const productsQ = useQuery<any[]>({
    queryKey: ["admin-products", venueId],
    enabled: !!venueId,
    queryFn: () => apiGet("api-admin", "products", { venueId }),
  });
  const tiersQ = useQuery<MembershipTier[]>({
    queryKey: ["membership-tiers", venueId],
    enabled: !!venueId,
    queryFn: () => apiGet("api-memberships", "tiers", { venueId, includeHidden: "true" }),
  });
  const tierPricingQueries = useQueries({
    queries: (tiersQ.data || []).map((tier) => ({
      queryKey: ["tier-pricing", tier.id],
      queryFn: () => apiGet<TierPricing[]>("api-memberships", "tier-pricing", { tierId: tier.id }),
      enabled: !!tier.id,
    })),
  });
  const calendarQ = useQuery<any>({
    queryKey: ["admin-pricing-calendar-preview", venueId],
    enabled: !!venueId,
    queryFn: () => apiGet("api-admin", "calendar", {
      venueId,
      from: today.toISODate()!,
      to: today.plus({ days: 14 }).toISODate()!,
    }),
  });
  const [name, setName] = useState("");
  const [type, setType] = useState("hourly");
  const [price, setPrice] = useState("");
  const [desc, setDesc] = useState("");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(ALL_DAYS);
  const [timeFrom, setTimeFrom] = useState("06:00");
  const [timeTo, setTimeTo] = useState("23:00");
  const [sportType, setSportType] = useState("");
  const [courtType, setCourtType] = useState("");
  const [previewChannel, setPreviewChannel] = useState("online");
  const [previewProductId, setPreviewProductId] = useState("");
  const [previewMembershipId, setPreviewMembershipId] = useState("guest");
  const [previewPromotion, setPreviewPromotion] = useState("none");
  const [previewSessionId, setPreviewSessionId] = useState("");
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any | null>(null);

  const products = productsQ.data || [];
  const membershipTiers = (tiersQ.data || []).filter((tier) => tier.is_active !== false);
  const allTierPricing = tierPricingQueries.flatMap((query) => query.data || []);
  const calendarItems = Array.isArray(calendarQ.data?.items) ? calendarQ.data.items : [];
  const activityChannelRows = calendarItems
    .filter((item: any) => item.kind === "activity")
    .filter((item: any) => Number(item.online_price_sek ?? item.price_sek ?? 0) > 0 || Number(item.desk_price_sek ?? 0) > 0)
    .slice(0, 12);
  const activeRules = (pricing || []).filter((rule: any) => rule.is_active !== false);
  const inactiveRules = (pricing || []).filter((rule: any) => rule.is_active === false);
  const selectedPreview = useMemo(() => {
    const selectedProduct = products.find((product: any) => product.id === previewProductId) || products[0];
    const selectedMembership = previewMembershipId === "guest"
      ? null
      : membershipTiers.find((tier) => tier.id === previewMembershipId) || null;
    const matchingSessions = activityChannelRows.filter((item: any) => !selectedProduct?.product_key || item.product_key === selectedProduct.product_key);
    const selectedSession = previewSessionId
      ? matchingSessions.find((item: any) => item.id === previewSessionId) || null
      : null;
    const channelPrices = selectedSession
      ? {
        online: Number(selectedSession.online_price_sek ?? selectedSession.price_sek ?? selectedProduct?.base_price_sek ?? 0),
        desk: Number(selectedSession.desk_price_sek ?? selectedSession.online_price_sek ?? selectedProduct?.base_price_sek ?? 0),
        corporate: selectedSession.corporate_price_sek ?? null,
        affiliate: selectedSession.affiliate_price_sek ?? null,
        host: selectedSession.host_price_sek ?? null,
        ambassador: selectedSession.ambassador_price_sek ?? null,
        guest: Number(selectedSession.online_price_sek ?? selectedSession.price_sek ?? selectedProduct?.base_price_sek ?? 0),
        member: Number(selectedSession.online_price_sek ?? selectedSession.price_sek ?? selectedProduct?.base_price_sek ?? 0),
      }
      : null;
    return {
      ...resolveProductPricingPreview({
        product: selectedProduct,
        membership: selectedMembership ? { id: selectedMembership.id, name: selectedMembership.name } : { id: null, name: "Gäst", isGuest: true },
        tierPricing: allTierPricing,
        channel: previewChannel,
        channelPrices,
        promotion: previewPromotion === "none" ? null : { label: PROMOTIONS.find((item) => item.key === previewPromotion)?.label || "Promotion" },
      }),
      product: selectedProduct,
      session: selectedSession,
      matchingSessions,
    };
  }, [activityChannelRows, allTierPricing, membershipTiers, previewChannel, previewMembershipId, previewProductId, previewPromotion, previewSessionId, products]);

  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto mt-8" />;

  const toggleDay = (day: number) => {
    setDaysOfWeek((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  };

  const handleAdd = () => {
    if (!name || !price || daysOfWeek.length === 0) {
      toast.error("Fyll i namn, pris och minst en dag");
      return;
    }
    addPricing.mutate(
      {
        name,
        type,
        price: parseFloat(price),
        description: desc || undefined,
        days_of_week: daysOfWeek,
        time_from: timeFrom,
        time_to: timeTo,
        sport_type: sportType || null,
        court_type: courtType || null,
      },
      {
        onSuccess: () => {
          toast.success("Prisregel tillagd!");
          setName("");
          setPrice("");
          setDesc("");
          setDaysOfWeek(ALL_DAYS);
          setTimeFrom("06:00");
          setTimeTo("23:00");
          setSportType("");
          setCourtType("");
        },
        onError: (e) => toast.error(e.message),
      }
    );
  };

  const toggleActive = (rule: any) => {
    updatePricing.mutate(
      { ruleId: rule.id, is_active: !rule.is_active },
      { onSuccess: () => toast.success(rule.is_active ? "Inaktiverad" : "Aktiverad") }
    );
  };

  const startEdit = (rule: any) => {
    setEditingRuleId(rule.id);
    setEditForm({
      name: rule.name || "",
      type: rule.type || "hourly",
      price: String(rule.price || ""),
      description: rule.description || "",
      days_of_week: rule.days_of_week?.length ? rule.days_of_week : ALL_DAYS,
      time_from: (rule.time_from || "06:00").slice(0, 5),
      time_to: (rule.time_to || "23:00").slice(0, 5),
      sport_type: rule.sport_type || "",
      court_type: rule.court_type || "",
    });
  };

  const cancelEdit = () => {
    setEditingRuleId(null);
    setEditForm(null);
  };

  const saveEdit = () => {
    if (!editingRuleId || !editForm) return;
    updatePricing.mutate(
      {
        ruleId: editingRuleId,
        name: editForm.name,
        type: editForm.type,
        price: parseFloat(editForm.price),
        description: editForm.description || null,
        days_of_week: editForm.days_of_week,
        time_from: editForm.time_from,
        time_to: editForm.time_to,
        sport_type: editForm.sport_type || null,
        court_type: editForm.court_type || null,
      },
      {
        onSuccess: () => {
          toast.success("Prisregel uppdaterad");
          cancelEdit();
        },
        onError: (e: any) => toast.error(e.message),
      }
    );
  };

  const handleDelete = (ruleId: string) => {
    if (!confirm("Ta bort denna prisregel?")) return;
    deletePricing.mutate(ruleId, {
      onSuccess: () => toast.success("Borttagen"),
      onError: (e: any) => toast.error(e.message),
    });
  };

  const formatDays = (days: number[] | null) => {
    if (!days || days.length === 0 || days.length === 7) return "alla dagar";
    return days.map((d) => DAY_LABELS[d]).join(", ");
  };

  const formatTimeRange = (from: string | null, to: string | null) => {
    const f = from || "00:00";
    const t = to || "23:59";
    if (f === "00:00" && (t === "23:59" || t === "23:00")) return "hela dagen";
    return `${f.slice(0, 5)}–${t.slice(0, 5)}`;
  };

  const formatScope = (rule: any) => {
    const sport = SPORT_TYPES.find((s) => s.value === rule.sport_type)?.label;
    const court = COURT_TYPES.find((c) => c.value === rule.court_type)?.label;
    return [sport, court].filter(Boolean).join(" · ") || "Alla banor";
  };

  return (
    <div className="space-y-4">
      <div className="glass-card rounded-2xl p-4 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
            <CreditCard className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-bold">Financial Operations · Pricing</p>
            <p className="text-xs text-muted-foreground">
              Baspris kommer från produkter, banprisregler eller konkreta pass. Channel modifiers visas ovanpå samma källa.
            </p>
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-4">
          <Metric label="Produkter" value={String(products.length)} />
          <Metric label="Aktiva regler" value={String(activeRules.length)} />
          <Metric label="Inaktiva/utgångna" value={String(inactiveRules.length)} />
          <Metric label="Channel sessions" value={String(activityChannelRows.length)} />
        </div>
        <div className="rounded-xl p-3" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Kanaler</p>
          <div className="flex flex-wrap gap-1.5">
            {CHANNELS.map((channel) => (
              <span key={channel} className="status-chip bg-primary/10 text-primary text-[9px]">{channel}</span>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Promo är inte en kanal. Kampanjer, vouchers och referral-rabatter ligger som promotion-steg efter kanal och medlemskap.
          </p>
        </div>
      </div>

      <div className="glass-card rounded-2xl p-4 space-y-3">
        <div>
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Product Engine simulator</p>
          <p className="mt-1 text-xs text-muted-foreground">Produkt → medlemskap → kanal → promotion → slutpris.</p>
        </div>
        <div className="grid gap-2 md:grid-cols-5">
          <select
            value={previewProductId || products[0]?.id || ""}
            onChange={(e) => {
              setPreviewProductId(e.target.value);
              setPreviewSessionId("");
            }}
            className="rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
          >
            {products.map((product: any) => (
              <option key={product.id} value={product.id}>{product.name} · {product.product_key}</option>
            ))}
          </select>
          <select
            value={previewMembershipId}
            onChange={(e) => setPreviewMembershipId(e.target.value)}
            className="rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
          >
            <option value="guest">Gäst / standard</option>
            {membershipTiers.map((tier) => <option key={tier.id} value={tier.id}>{tier.name}</option>)}
          </select>
          <select
            value={previewChannel}
            onChange={(e) => setPreviewChannel(e.target.value)}
            className="rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
          >
            {CHANNELS.map((channel) => <option key={channel} value={channel}>{channel}</option>)}
          </select>
          <select
            value={previewPromotion}
            onChange={(e) => setPreviewPromotion(e.target.value)}
            className="rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
          >
            {PROMOTIONS.map((promotion) => <option key={promotion.key} value={promotion.key}>{promotion.label}</option>)}
          </select>
          <select
            value={previewSessionId}
            onChange={(e) => setPreviewSessionId(e.target.value)}
            className="rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
          >
            <option value="">Produktens baspris</option>
            {selectedPreview.matchingSessions.map((item: any) => (
              <option key={item.id} value={item.id}>{item.title} · {item.date} {item.time}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-2 md:grid-cols-5">
          <PricePill label="Baspris" value={formatSek(selectedPreview.basePrice)} />
          <PricePill
            label={`Kanal ${selectedPreview.channel}`}
            value={`${selectedPreview.channelAdjustment >= 0 ? "+" : ""}${formatSek(selectedPreview.channelAdjustment)}`}
          />
          <PricePill
            label={selectedPreview.membershipName}
            value={`${selectedPreview.membershipAdjustment >= 0 ? "+" : ""}${formatSek(selectedPreview.membershipAdjustment)}`}
          />
          <PricePill
            label={selectedPreview.promotionLabel}
            value={`${selectedPreview.promotionAdjustment >= 0 ? "+" : ""}${formatSek(selectedPreview.promotionAdjustment)}`}
          />
          <div className="rounded-lg px-3 py-2" style={{ background: "hsl(var(--surface-1))" }}>
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Slutpris</p>
            <p className="text-lg font-black">{selectedPreview.included ? "Ingår" : formatSek(selectedPreview.finalPrice)}</p>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Previewn muterar inget. Den använder produktens baspris, aktiva medlemsregler och eventuella channel-priser från valt schemapass.
        </p>
      </div>

      {activityChannelRows.length > 0 && (
        <div className="glass-card rounded-2xl p-4 space-y-3">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Channel modifiers på kommande pass</p>
          <div className="grid gap-2 md:grid-cols-2">
            {activityChannelRows.map((item: any) => {
              const online = Number(item.online_price_sek ?? item.price_sek ?? 0);
              const desk = Number(item.desk_price_sek ?? online);
              return (
                <div key={item.id} className="rounded-xl p-3" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}>
                  <p className="text-sm font-bold">{item.title}</p>
                  <p className="text-[10px] text-muted-foreground">{item.date} · {item.time} · {item.session_type}</p>
                  <div className="mt-2 grid grid-cols-3 gap-1.5 text-[11px]">
                    <PricePill label="Online" value={formatSek(online)} />
                    <PricePill label="Desk" value={formatSek(desk)} />
                    <PricePill label="Diff" value={`${desk - online >= 0 ? "+" : ""}${formatSek(desk - online)}`} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="glass-card rounded-2xl p-4 space-y-3">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Ny prisregel</p>

        <input
          placeholder="Namn (t.ex. Peak Hour)"
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
          style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <div className="grid grid-cols-2 gap-2">
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
          >
            <option value="hourly">Per timme</option>
            <option value="day_pass">Dagspass</option>
            <option value="event">Event (per deltagare)</option>
            <option value="guest_pass">Gästpass</option>
            <option value="membership">Medlemskap</option>
            <option value="other">Övrigt</option>
          </select>
          <input
            placeholder="Pris (kr)"
            type="number"
            className="rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <select
            value={sportType}
            onChange={(e) => setSportType(e.target.value)}
            className="rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
          >
            {SPORT_TYPES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select
            value={courtType}
            onChange={(e) => setCourtType(e.target.value)}
            className="rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
          >
            {COURT_TYPES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>

        {/* Day picker */}
        <div>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Gäller dagar</p>
          <div className="flex gap-1">
            {ALL_DAYS.map((day) => (
              <button
                key={day}
                onClick={() => toggleDay(day)}
                className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                  daysOfWeek.includes(day)
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {DAY_LABELS[day]}
              </button>
            ))}
          </div>
        </div>

        {/* Time range */}
        <div>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Tidsfönster</p>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="time"
              value={timeFrom}
              onChange={(e) => setTimeFrom(e.target.value)}
              className="rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
            />
            <input
              type="time"
              value={timeTo}
              onChange={(e) => setTimeTo(e.target.value)}
              className="rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
            />
          </div>
        </div>

        <input
          placeholder="Beskrivning (valfritt)"
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
          style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
        />

        <button
          onClick={handleAdd}
          disabled={addPricing.isPending}
          className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-50"
        >
          {addPricing.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Lägg till
        </button>
      </div>

      <div className="space-y-1.5">
        {(pricing || []).map((rule: any) => {
          const isEditing = editingRuleId === rule.id && editForm;

          return (
            <div key={rule.id} className="glass-card rounded-2xl p-4">
              {isEditing ? (
                <div className="space-y-2">
                  <input
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                    style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={editForm.type}
                      onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
                      className="rounded-xl px-3 py-2.5 text-sm outline-none"
                      style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
                    >
                      <option value="hourly">Per timme</option>
                      <option value="day_pass">Dagspass</option>
                      <option value="event">Event</option>
                      <option value="guest_pass">Gästpass</option>
                      <option value="membership">Medlemskap</option>
                      <option value="other">Övrigt</option>
                    </select>
                    <input
                      type="number"
                      value={editForm.price}
                      onChange={(e) => setEditForm({ ...editForm, price: e.target.value })}
                      className="rounded-xl px-3 py-2.5 text-sm outline-none"
                      style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={editForm.sport_type}
                      onChange={(e) => setEditForm({ ...editForm, sport_type: e.target.value })}
                      className="rounded-xl px-3 py-2.5 text-sm outline-none"
                      style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
                    >
                      {SPORT_TYPES.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <select
                      value={editForm.court_type}
                      onChange={(e) => setEditForm({ ...editForm, court_type: e.target.value })}
                      className="rounded-xl px-3 py-2.5 text-sm outline-none"
                      style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
                    >
                      {COURT_TYPES.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="time"
                      value={editForm.time_from}
                      onChange={(e) => setEditForm({ ...editForm, time_from: e.target.value })}
                      className="rounded-xl px-3 py-2.5 text-sm outline-none"
                      style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
                    />
                    <input
                      type="time"
                      value={editForm.time_to}
                      onChange={(e) => setEditForm({ ...editForm, time_to: e.target.value })}
                      className="rounded-xl px-3 py-2.5 text-sm outline-none"
                      style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
                    />
                  </div>
                  <div className="flex gap-1">
                    {ALL_DAYS.map((day) => (
                      <button
                        key={day}
                        onClick={() => {
                          const nextDays = editForm.days_of_week.includes(day)
                            ? editForm.days_of_week.filter((d: number) => d !== day)
                            : [...editForm.days_of_week, day].sort();
                          setEditForm({ ...editForm, days_of_week: nextDays });
                        }}
                        className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                          editForm.days_of_week.includes(day)
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {DAY_LABELS[day]}
                      </button>
                    ))}
                  </div>
                  <input
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    placeholder="Beskrivning"
                    className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                    style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
                  />
                  <div className="flex gap-2">
                    <button onClick={saveEdit} className="flex-1 rounded-xl py-2.5 bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center gap-1">
                      <Check className="w-3.5 h-3.5" /> Spara
                    </button>
                    <button onClick={cancelEdit} className="flex-1 rounded-xl py-2.5 bg-muted text-muted-foreground text-xs font-semibold flex items-center justify-center gap-1">
                      <X className="w-3.5 h-3.5" /> Avbryt
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-sell/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Tag className="w-4 h-4 text-sell" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">{rule.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {rule.type === "hourly" ? "Per timme" : rule.type === "day_pass" ? "Dagspass" : rule.type === "event" ? "Event" : rule.type === "guest_pass" ? "Gästpass" : rule.type}
                      {" · "}
                      {formatScope(rule)}
                      {" · "}
                      {formatDays(rule.days_of_week)}
                      {" · "}
                      {formatTimeRange(rule.time_from, rule.time_to)}
                    </p>
                    {rule.description && (
                      <p className="text-[10px] text-muted-foreground/70 mt-0.5">{rule.description}</p>
                    )}
                  </div>
                  <span className="text-sm font-display font-bold text-foreground whitespace-nowrap">{rule.price} kr</span>
                  <div className="flex flex-col gap-1 items-end">
                    <button
                      onClick={() => toggleActive(rule)}
                      className={`text-[10px] px-2 py-1 rounded-full font-semibold ${
                        rule.is_active ? "bg-badge-paid/15 text-badge-paid" : "bg-destructive/15 text-destructive"
                      }`}
                    >
                      {rule.is_active ? "Aktiv" : "Av"}
                    </button>
                    <button onClick={() => startEdit(rule)} className="text-muted-foreground/50 hover:text-primary transition-colors">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => handleDelete(rule.id)} className="text-muted-foreground/50 hover:text-destructive transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {(!pricing || pricing.length === 0) && (
          <p className="text-sm text-muted-foreground text-center py-6">Inga prisregler ännu</p>
        )}
      </div>
    </div>
  );
};

export default AdminPricing;
