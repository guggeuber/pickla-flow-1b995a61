import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { Loader2, Plus, Crown, Trash2, ChevronUp, Tag, Save } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

interface MembershipTier {
  id: string;
  name: string;
  description: string | null;
  color: string;
  discount_percent: number;
  monthly_price: number;
  sort_order: number;
  is_active: boolean;
  is_assignable?: boolean;
}

interface TierPricing {
  id: string;
  tier_id: string;
  product_type: string;
  fixed_price: number | null;
  discount_percent: number | null;
  vat_rate: number;
  label: string | null;
}

interface MembershipEntitlement {
  id: string;
  tier_id: string;
  entitlement_type: string;
  value: number | null;
  period: string | null;
  sport_type: string | null;
}

interface AccessProduct {
  product_key: string;
  name: string;
}

interface ProductTypeOption {
  key: string;
  label: string;
}

interface AdminMembership {
  id: string;
  user_id: string;
  venue_id: string;
  tier_id: string;
  status: string;
  starts_at: string;
  expires_at: string | null;
  notes: string | null;
  user_email?: string | null;
  user_name?: string | null;
  user_phone?: string | null;
  membership_tiers?: Pick<MembershipTier, "id" | "name" | "color" | "discount_percent" | "monthly_price"> | null;
}

const FALLBACK_PRODUCT_TYPES = [
  { key: "court_hourly", label: "Bana per timme" },
  { key: "day_access", label: "Day Pass / dagsmedlemskap" },
  { key: "open_play_slot", label: "Open Play Slot" },
  { key: "group_training", label: "Gruppträning" },
  { key: "group_training_day_access", label: "Gruppträning + Day Pass" },
  { key: "day_access_voucher", label: "Day Pass Voucher" },
  { key: "day_pass", label: "Dagspass (legacy)" },
  { key: "event_fee", label: "Event-avgift" },
  { key: "guest_pass", label: "Gästpass" },
];

const EditableTierPricingRow = ({
  pricing,
  productTypes,
  onDelete,
}: {
  pricing: TierPricing;
  productTypes: ProductTypeOption[];
  onDelete: (id: string) => void;
}) => {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"fixed" | "percent">(pricing.fixed_price != null ? "fixed" : "percent");
  const [value, setValue] = useState(String(pricing.fixed_price ?? pricing.discount_percent ?? 0));
  const [vat, setVat] = useState(String(pricing.vat_rate ?? 6));
  const [label, setLabel] = useState(pricing.label || productTypes.find((p) => p.key === pricing.product_type)?.label || pricing.product_type);

  useEffect(() => {
    setMode(pricing.fixed_price != null ? "fixed" : "percent");
    setValue(String(pricing.fixed_price ?? pricing.discount_percent ?? 0));
    setVat(String(pricing.vat_rate ?? 6));
    setLabel(pricing.label || productTypes.find((p) => p.key === pricing.product_type)?.label || pricing.product_type);
  }, [pricing, productTypes]);

  const updatePricing = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiPatch("api-memberships", "tier-pricing", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tier-pricing", pricing.tier_id] });
      toast.success("Prisregel uppdaterad");
    },
    onError: (e: any) => toast.error(e.message || "Kunde inte uppdatera prisregeln"),
  });

  const handleSave = () => {
    const parsedValue = Number(value);
    const parsedVat = Number(vat);
    if (Number.isNaN(parsedValue) || parsedValue < 0) {
      toast.error("Ogiltigt pris/rabatt");
      return;
    }
    updatePricing.mutate({
      id: pricing.id,
      label: label.trim() || null,
      fixed_price: mode === "fixed" ? parsedValue : null,
      discount_percent: mode === "percent" ? parsedValue : null,
      vat_rate: Number.isNaN(parsedVat) ? 6 : parsedVat,
    });
  };

  return (
    <div className="rounded-xl p-3 space-y-2" style={{ background: "hsl(var(--surface-2))" }}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold">{productTypes.find((p) => p.key === pricing.product_type)?.label || pricing.product_type}</p>
          <p className="text-[10px] text-muted-foreground">{pricing.product_type}</p>
        </div>
        <button onClick={() => onDelete(pricing.id)} className="text-muted-foreground/50 hover:text-destructive">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Visningsnamn"
        className="w-full rounded-xl px-3 py-2 text-xs outline-none"
        style={{ background: "hsl(var(--surface-1))", border: "1px solid hsl(var(--border))" }}
      />
      <div className="grid grid-cols-3 gap-2">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as "fixed" | "percent")}
          className="rounded-xl px-3 py-2 text-xs outline-none"
          style={{ background: "hsl(var(--surface-1))", border: "1px solid hsl(var(--border))" }}
        >
          <option value="fixed">Fast pris</option>
          <option value="percent">Rabatt %</option>
        </select>
        <input
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="rounded-xl px-3 py-2 text-xs outline-none"
          style={{ background: "hsl(var(--surface-1))", border: "1px solid hsl(var(--border))" }}
        />
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={vat}
            onChange={(e) => setVat(e.target.value)}
            className="w-full rounded-xl px-3 py-2 text-xs outline-none"
            style={{ background: "hsl(var(--surface-1))", border: "1px solid hsl(var(--border))" }}
          />
          <span className="text-[10px] text-muted-foreground">% moms</span>
        </div>
      </div>
      <button
        onClick={handleSave}
        disabled={updatePricing.isPending}
        className="w-full flex items-center justify-center gap-2 rounded-xl py-2 bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50"
      >
        {updatePricing.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
        Spara prisregel
      </button>
    </div>
  );
};

const TierPricingEditor = ({ tier, venueId }: { tier: MembershipTier; venueId: string }) => {
  const qc = useQueryClient();
  const { data: pricing, isLoading } = useQuery<TierPricing[]>({
    queryKey: ["tier-pricing", tier.id],
    queryFn: () => apiGet("api-memberships", "tier-pricing", { tierId: tier.id }),
  });
  const { data: products } = useQuery<AccessProduct[]>({
    queryKey: ["admin-access-products", venueId],
    queryFn: () => apiGet("api-admin", "products", { venueId }),
  });

  const [newProduct, setNewProduct] = useState("");
  const [newMode, setNewMode] = useState<"fixed" | "percent">("fixed");
  const [newValue, setNewValue] = useState("");
  const [newVat, setNewVat] = useState("6");

  const addPricing = useMutation({
    mutationFn: (body: any) => apiPost("api-memberships", "tier-pricing", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tier-pricing", tier.id] });
      toast.success("Pris tillagt!");
      setNewProduct(""); setNewValue("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deletePricing = useMutation({
    mutationFn: (id: string) => apiDelete("api-memberships", `tier-pricing?id=${id}`),
    onMutate: async (id: string) => {
      const queryKey = ["tier-pricing", tier.id];
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<TierPricing[]>(queryKey);
      qc.setQueryData<TierPricing[]>(queryKey, (current = []) => current.filter((item) => item.id !== id));
      return { previous };
    },
    onSuccess: () => {
      toast.success("Borttaget");
    },
    onError: (e: any, _id, context) => {
      if (context?.previous) qc.setQueryData(["tier-pricing", tier.id], context.previous);
      toast.error(e?.message || "Kunde inte ta bort prisregeln");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["tier-pricing", tier.id] });
    },
  });

  const handleAdd = () => {
    if (!newProduct || !newValue) { toast.error("Välj produkt och ange värde"); return; }
    const val = parseFloat(newValue);
    if (isNaN(val) || val < 0) { toast.error("Ogiltigt värde"); return; }

    addPricing.mutate({
      tierId: tier.id,
      product_type: newProduct,
      fixed_price: newMode === "fixed" ? val : null,
      discount_percent: newMode === "percent" ? val : null,
      vat_rate: parseFloat(newVat) || 6,
      label: productTypes.find(p => p.key === newProduct)?.label || newProduct,
    });
  };

  // Products already configured
  const productTypes = [
    { key: "court_hourly", label: "Bana per timme" },
    ...((products || []).map((product) => ({ key: product.product_key, label: product.name }))),
    ...FALLBACK_PRODUCT_TYPES.filter((fallback) => !(products || []).some((product) => product.product_key === fallback.key) && fallback.key !== "court_hourly"),
  ];
  const usedProducts = (pricing || []).map(p => p.product_type);
  const availableProducts = productTypes.filter(p => !usedProducts.includes(p.key));

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Prislista</p>

      {isLoading && <Loader2 className="w-4 h-4 animate-spin text-primary" />}

      {(pricing || []).map((p) => (
        <EditableTierPricingRow key={p.id} pricing={p} productTypes={productTypes} onDelete={(id) => deletePricing.mutate(id)} />
      ))}

      {availableProducts.length > 0 && (
        <div className="space-y-2 pt-1">
          <div className="grid grid-cols-2 gap-2">
            <select
              value={newProduct}
              onChange={(e) => setNewProduct(e.target.value)}
              className="rounded-xl px-3 py-2 text-xs outline-none"
              style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
            >
              <option value="">Välj produkt...</option>
              {availableProducts.map(p => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
            <select
              value={newMode}
              onChange={(e) => setNewMode(e.target.value as "fixed" | "percent")}
              className="rounded-xl px-3 py-2 text-xs outline-none"
              style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
            >
              <option value="fixed">Fast pris (kr)</option>
              <option value="percent">Rabatt (%)</option>
            </select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input
              type="number" placeholder={newMode === "fixed" ? "Pris" : "% rabatt"}
              className="rounded-xl px-3 py-2 text-xs outline-none col-span-1"
              style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
              value={newValue} onChange={(e) => setNewValue(e.target.value)}
            />
            <div className="flex items-center gap-1 col-span-1">
              <input
                type="number" placeholder="6"
                className="rounded-xl px-3 py-2 text-xs outline-none w-full"
                style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
                value={newVat} onChange={(e) => setNewVat(e.target.value)}
              />
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">% moms</span>
            </div>
            <button
              onClick={handleAdd}
              disabled={addPricing.isPending}
              className="rounded-xl py-2 bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50 col-span-1"
            >
              {addPricing.isPending ? "..." : "+ Lägg till"}
            </button>
          </div>
        </div>
      )}

      {availableProducts.length === 0 && pricing && pricing.length > 0 && (
        <p className="text-[10px] text-muted-foreground">Alla produkter konfigurerade ✓</p>
      )}
    </div>
  );
};

const MembershipBenefitsEditor = ({ tier }: { tier: MembershipTier }) => {
  const qc = useQueryClient();
  const { data: entitlements, isLoading } = useQuery<MembershipEntitlement[]>({
    queryKey: ["tier-entitlements", tier.id],
    queryFn: () => apiGet("api-memberships", "tier-entitlements", { tierId: tier.id }),
  });

  const [courtHours, setCourtHours] = useState("0");
  const [openPlayUnlimited, setOpenPlayUnlimited] = useState(false);
  const [guestVouchers, setGuestVouchers] = useState("0");

  useEffect(() => {
    if (!entitlements) return;
    const valueFor = (type: string) => {
      const row = entitlements.find((item) => item.entitlement_type === type && (item.sport_type || "pickleball") === "pickleball");
      return Number(row?.value || 0);
    };
    setCourtHours(String(valueFor("court_hours_per_week")));
    setOpenPlayUnlimited(valueFor("open_play_unlimited") > 0);
    setGuestVouchers(String(valueFor("guest_day_vouchers_monthly")));
  }, [entitlements]);

  const saveBenefits = useMutation({
    mutationFn: (body: any) => apiPatch("api-memberships", "tier-entitlements", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tier-entitlements", tier.id] });
      toast.success("Förmåner sparade");
    },
    onError: (e: any) => toast.error(e.message || "Kunde inte spara förmåner"),
  });

  const handleSave = () => {
    saveBenefits.mutate({
      tierId: tier.id,
      courtHoursPerWeek: Number(courtHours || 0),
      openPlayUnlimited,
      guestDayVouchersMonthly: Number(guestVouchers || 0),
    });
  };

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Förmåner</p>
      {isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin text-primary" />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label className="space-y-1">
              <span className="text-[10px] text-muted-foreground">Fria ban-timmar / vecka</span>
              <input
                type="number"
                min="0"
                step="0.5"
                className="w-full rounded-xl px-3 py-2 text-xs outline-none"
                style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
                value={courtHours}
                onChange={(e) => setCourtHours(e.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] text-muted-foreground">Gästpass / månad</span>
              <input
                type="number"
                min="0"
                step="1"
                className="w-full rounded-xl px-3 py-2 text-xs outline-none"
                style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
                value={guestVouchers}
                onChange={(e) => setGuestVouchers(e.target.value)}
              />
            </label>
            <label
              className="flex items-center justify-between gap-3 rounded-xl px-3 py-2"
              style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
            >
              <span className="text-xs">Open Play ingår</span>
              <input
                type="checkbox"
                checked={openPlayUnlimited}
                onChange={(e) => setOpenPlayUnlimited(e.target.checked)}
              />
            </label>
          </div>
          <button
            onClick={handleSave}
            disabled={saveBenefits.isPending}
            className="w-full rounded-xl py-2 bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50"
          >
            {saveBenefits.isPending ? "Sparar..." : "Spara förmåner"}
          </button>
        </>
      )}
    </div>
  );
};

const TierDetailsEditor = ({ tier, venueId }: { tier: MembershipTier; venueId: string }) => {
  const qc = useQueryClient();
  const [name, setName] = useState(tier.name);
  const [description, setDescription] = useState(tier.description || "");
  const [color, setColor] = useState(tier.color || "#E86C24");
  const [monthlyPrice, setMonthlyPrice] = useState(String(tier.monthly_price || 0));
  const [sortOrder, setSortOrder] = useState(String(tier.sort_order || 0));

  useEffect(() => {
    setName(tier.name);
    setDescription(tier.description || "");
    setColor(tier.color || "#E86C24");
    setMonthlyPrice(String(tier.monthly_price || 0));
    setSortOrder(String(tier.sort_order || 0));
  }, [tier]);

  const updateTierDetails = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiPatch("api-memberships", "tiers", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["membership-tiers", venueId] });
      toast.success("Nivå uppdaterad");
    },
    onError: (e: any) => toast.error(e.message || "Kunde inte uppdatera nivån"),
  });

  const handleSave = () => {
    if (!name.trim()) {
      toast.error("Namn krävs");
      return;
    }
    updateTierDetails.mutate({
      tierId: tier.id,
      name: name.trim(),
      description: description.trim() || null,
      color,
      monthly_price: Number(monthlyPrice || 0),
      sort_order: Number(sortOrder || 0),
    });
  };

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Grundinfo</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Namn"
          className="rounded-xl px-3 py-2 text-xs outline-none"
          style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
        />
        <input
          value={monthlyPrice}
          onChange={(e) => setMonthlyPrice(e.target.value)}
          type="number"
          placeholder="Pris/mån"
          className="rounded-xl px-3 py-2 text-xs outline-none"
          style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Beskrivning"
          className="rounded-xl px-3 py-2 text-xs outline-none"
          style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-9 rounded-xl cursor-pointer border-0"
          />
          <input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            placeholder="Sortering"
            className="rounded-xl px-3 py-2 text-xs outline-none"
            style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
          />
        </div>
      </div>
      <button
        onClick={handleSave}
        disabled={updateTierDetails.isPending}
        className="w-full flex items-center justify-center gap-2 rounded-xl py-2 bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50"
      >
        {updateTierDetails.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
        Spara grundinfo
      </button>
    </div>
  );
};

const EditableMembershipRow = ({
  membership,
  tiers,
  venueId,
}: {
  membership: AdminMembership;
  tiers: MembershipTier[];
  venueId: string;
}) => {
  const qc = useQueryClient();
  const [tierId, setTierId] = useState(membership.tier_id);
  const [status, setStatus] = useState(membership.status || "active");
  const [expiresAt, setExpiresAt] = useState(membership.expires_at || "");
  const [notes, setNotes] = useState(membership.notes || "");

  useEffect(() => {
    setTierId(membership.tier_id);
    setStatus(membership.status || "active");
    setExpiresAt(membership.expires_at || "");
    setNotes(membership.notes || "");
  }, [membership]);

  const updateMembership = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiPatch("api-memberships", "update", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["venue-memberships", venueId] });
      toast.success("Medlemskap uppdaterat");
    },
    onError: (e: any) => toast.error(e.message || "Kunde inte uppdatera medlemskapet"),
  });

  const handleSave = () => {
    updateMembership.mutate({
      membershipId: membership.id,
      tierId,
      status,
      expiresAt: expiresAt || null,
      notes: notes.trim() || null,
    });
  };

  const title = membership.user_name || membership.user_email || membership.user_id.slice(0, 8);

  return (
    <div className="rounded-2xl p-3 space-y-3" style={{ background: "hsl(var(--surface-2))" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{title}</p>
          <p className="text-[10px] text-muted-foreground truncate">
            {[membership.user_email, membership.user_phone].filter(Boolean).join(" · ") || membership.user_id}
          </p>
        </div>
        <span className="text-[10px] px-2 py-1 rounded-full bg-primary/10 text-primary font-semibold">
          {membership.membership_tiers?.name || "Medlem"}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <select
          value={tierId}
          onChange={(e) => setTierId(e.target.value)}
          className="rounded-xl px-3 py-2 text-xs outline-none"
          style={{ background: "hsl(var(--surface-1))", border: "1px solid hsl(var(--border))" }}
        >
          {tiers.filter((tier) => tier.is_assignable !== false).map((tier) => (
            <option key={tier.id} value={tier.id}>
              {tier.name}{tier.is_active ? "" : " · dold"}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-xl px-3 py-2 text-xs outline-none"
          style={{ background: "hsl(var(--surface-1))", border: "1px solid hsl(var(--border))" }}
        >
          <option value="active">Aktiv</option>
          <option value="cancelled">Avslutad</option>
          <option value="expired">Utgången</option>
        </select>
        <input
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          className="rounded-xl px-3 py-2 text-xs outline-none"
          style={{ background: "hsl(var(--surface-1))", border: "1px solid hsl(var(--border))" }}
        />
      </div>
      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Intern anteckning"
        className="w-full rounded-xl px-3 py-2 text-xs outline-none"
        style={{ background: "hsl(var(--surface-1))", border: "1px solid hsl(var(--border))" }}
      />
      <button
        onClick={handleSave}
        disabled={updateMembership.isPending}
        className="w-full flex items-center justify-center gap-2 rounded-xl py-2 bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50"
      >
        {updateMembership.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
        Spara medlemskap
      </button>
    </div>
  );
};

const ActiveMembershipsManager = ({ venueId, tiers }: { venueId: string; tiers: MembershipTier[] }) => {
  const { data: memberships, isLoading } = useQuery<AdminMembership[]>({
    queryKey: ["venue-memberships", venueId],
    enabled: !!venueId,
    queryFn: () => apiGet("api-memberships", "venue", { venueId }),
  });

  return (
    <div className="glass-card rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Aktiva medlemskap</p>
          <p className="text-[10px] text-muted-foreground">Byt nivå, slutdatum, status och interna anteckningar.</p>
        </div>
        {isLoading && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
      </div>
      <div className="space-y-2">
        {(memberships || []).map((membership) => (
          <EditableMembershipRow key={membership.id} membership={membership} tiers={tiers} venueId={venueId} />
        ))}
        {!isLoading && (!memberships || memberships.length === 0) && (
          <p className="text-sm text-muted-foreground text-center py-6">Inga aktiva medlemskap ännu</p>
        )}
      </div>
    </div>
  );
};

const AdminMemberships = ({ venueId }: { venueId: string }) => {
  const qc = useQueryClient();
  const { data: tiers, isLoading } = useQuery<MembershipTier[]>({
    queryKey: ["membership-tiers", venueId],
    enabled: !!venueId,
    queryFn: async () => {
      return apiGet("api-memberships", "tiers", { venueId, includeHidden: "true" });
    },
  });

  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [color, setColor] = useState("#E86C24");
  const [monthlyPrice, setMonthlyPrice] = useState("");
  const [expandedTier, setExpandedTier] = useState<string | null>(null);
  const [assignEmail, setAssignEmail] = useState("");
  const [assignName, setAssignName] = useState("");
  const [assignTierId, setAssignTierId] = useState("");
  const [assignNotes, setAssignNotes] = useState("");

  const addTier = useMutation({
    mutationFn: (body: any) => apiPost("api-memberships", "tiers", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["membership-tiers", venueId] });
      toast.success("Medlemskapsnivå skapad!");
      setName(""); setDesc(""); setMonthlyPrice("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateTier = useMutation({
    mutationFn: (body: any) => apiPatch("api-memberships", "tiers", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["membership-tiers", venueId] });
      toast.success("Uppdaterad");
    },
  });

  const deleteTier = useMutation({
    mutationFn: (tierId: string) => apiDelete("api-memberships", `tiers?tierId=${tierId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["membership-tiers", venueId] });
      toast.success("Borttagen");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const assignMembership = useMutation({
    mutationFn: (body: any) => apiPost("api-memberships", "assign-email", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["venue-memberships", venueId] });
      toast.success("Medlemskap tilldelat");
      setAssignEmail("");
      setAssignName("");
      setAssignNotes("");
    },
    onError: (e: any) => toast.error(e.message || "Kunde inte tilldela medlemskap"),
  });

  const handleAdd = () => {
    if (!name.trim()) { toast.error("Ange namn"); return; }
    addTier.mutate({
      venueId,
      name: name.trim(),
      description: desc || undefined,
      color,
      discount_percent: 0,
      monthly_price: parseFloat(monthlyPrice) || 0,
      sort_order: (tiers?.length || 0),
    });
  };

  const handleAssign = () => {
    if (!assignEmail.trim() || !assignTierId) {
      toast.error("Ange email och nivå");
      return;
    }
    assignMembership.mutate({
      venueId,
      email: assignEmail.trim(),
      displayName: assignName.trim() || undefined,
      tierId: assignTierId,
      notes: assignNotes.trim() || "Manuellt tilldelat i admin",
    });
  };

  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto mt-8" />;

  return (
    <div className="space-y-4">
      {/* Create new tier */}
      <div className="glass-card rounded-2xl p-4 space-y-3">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Ny medlemskapsnivå</p>

        <input
          placeholder="Namn (t.ex. Gold, Premium)"
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
          style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
          value={name} onChange={(e) => setName(e.target.value)}
        />

        <input
          placeholder="Beskrivning (valfritt)"
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
          style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
          value={desc} onChange={(e) => setDesc(e.target.value)}
        />

        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Färg</p>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-full h-10 rounded-xl cursor-pointer border-0"
            />
          </div>
          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Pris/mån</p>
            <input
              type="number" placeholder="0"
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
              value={monthlyPrice} onChange={(e) => setMonthlyPrice(e.target.value)}
            />
          </div>
        </div>

        <button
          onClick={handleAdd}
          disabled={addTier.isPending}
          className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-50"
        >
          {addTier.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Skapa nivå
        </button>
      </div>

      {/* Existing tiers */}
      <div className="space-y-1.5">
        {(tiers || []).map((tier) => (
          <motion.div
            key={tier.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card rounded-2xl p-4"
          >
            <div className="flex items-start gap-3">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ background: `${tier.color}20` }}
              >
                <Crown className="w-4 h-4" style={{ color: tier.color }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{tier.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {tier.monthly_price > 0 && `${tier.monthly_price} kr/mån`}
                </p>
                {tier.description && (
                  <p className="text-[10px] text-muted-foreground/70 mt-0.5">{tier.description}</p>
                )}
              </div>
              <div className="flex flex-col gap-1 items-end">
                <button
                  onClick={() => updateTier.mutate({ tierId: tier.id, is_active: !tier.is_active })}
                  className={`text-[10px] px-2 py-1 rounded-full font-semibold ${
                    tier.is_active ? "bg-badge-paid/15 text-badge-paid" : "bg-destructive/15 text-destructive"
                  }`}
                >
                  {tier.is_active ? "Publik" : "Dold"}
                </button>
                <button
                  onClick={() => updateTier.mutate({ tierId: tier.id, is_assignable: tier.is_assignable === false })}
                  className={`text-[10px] px-2 py-1 rounded-full font-semibold ${
                    tier.is_assignable !== false ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {tier.is_assignable !== false ? "Tilldelbar" : "Ej tilldelbar"}
                </button>
                <div className="flex gap-1">
                  <button
                    onClick={() => setExpandedTier(expandedTier === tier.id ? null : tier.id)}
                    className="text-muted-foreground/50 hover:text-primary transition-colors"
                  >
                    {expandedTier === tier.id ? <ChevronUp className="w-3.5 h-3.5" /> : <Tag className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => { if (confirm("Ta bort denna nivå?")) deleteTier.mutate(tier.id); }}
                    className="text-muted-foreground/50 hover:text-destructive transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            <AnimatePresence>
              {expandedTier === tier.id && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <TierDetailsEditor tier={tier} venueId={venueId} />
                  <MembershipBenefitsEditor tier={tier} />
                  <TierPricingEditor tier={tier} venueId={venueId} />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ))}
        {(!tiers || tiers.length === 0) && (
          <p className="text-sm text-muted-foreground text-center py-6">Inga medlemskapsnivåer ännu</p>
        )}
      </div>

      <ActiveMembershipsManager venueId={venueId} tiers={tiers || []} />

      <div className="glass-card rounded-2xl p-4 space-y-3">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Tilldela medlemskap</p>
        <div className="grid grid-cols-1 gap-2">
          <input
            placeholder="Kundens e-post"
            className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
            value={assignEmail}
            onChange={(e) => setAssignEmail(e.target.value)}
          />
          <input
            placeholder="Namn (valfritt, om kontot saknas)"
            className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
            value={assignName}
            onChange={(e) => setAssignName(e.target.value)}
          />
          <select
            value={assignTierId}
            onChange={(e) => setAssignTierId(e.target.value)}
            className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
          >
            <option value="">Välj nivå...</option>
            {(tiers || []).filter((tier) => tier.is_assignable !== false).map((tier) => (
              <option key={tier.id} value={tier.id}>
                {tier.name}{tier.is_active ? "" : " · dold"}
              </option>
            ))}
          </select>
          <input
            placeholder="Anteckning (t.ex. redan betalt Founder)"
            className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
            value={assignNotes}
            onChange={(e) => setAssignNotes(e.target.value)}
          />
        </div>
        <button
          onClick={handleAssign}
          disabled={assignMembership.isPending}
          className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-50"
        >
          {assignMembership.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crown className="w-4 h-4" />}
          Tilldela
        </button>
      </div>
    </div>
  );
};

export default AdminMemberships;
