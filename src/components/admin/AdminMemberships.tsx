import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Plus, Crown, Trash2, ChevronDown, ChevronUp, Tag } from "lucide-react";
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

const PRODUCT_TYPES = [
  { key: "court_hourly", label: "Bana per timme" },
  { key: "day_pass", label: "Dagspass" },
  { key: "event_fee", label: "Event-avgift" },
  { key: "guest_pass", label: "Gästpass" },
];

const TierPricingEditor = ({ tier, venueId }: { tier: MembershipTier; venueId: string }) => {
  const qc = useQueryClient();
  const { data: pricing, isLoading } = useQuery<TierPricing[]>({
    queryKey: ["tier-pricing", tier.id],
    queryFn: () => apiGet("api-memberships", "tier-pricing", { tierId: tier.id }),
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tier-pricing", tier.id] });
      toast.success("Borttaget");
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
      label: PRODUCT_TYPES.find(p => p.key === newProduct)?.label || newProduct,
    });
  };

  // Products already configured
  const usedProducts = (pricing || []).map(p => p.product_type);
  const availableProducts = PRODUCT_TYPES.filter(p => !usedProducts.includes(p.key));

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Prislista</p>

      {isLoading && <Loader2 className="w-4 h-4 animate-spin text-primary" />}

      {(pricing || []).map((p) => (
        <div key={p.id} className="flex items-center justify-between rounded-xl px-3 py-2" style={{ background: "hsl(var(--surface-2))" }}>
          <div>
            <p className="text-xs font-semibold">{p.label || p.product_type}</p>
            <p className="text-[10px] text-muted-foreground">
              {p.fixed_price != null ? `${p.fixed_price} kr` : `${p.discount_percent}% rabatt`}
              {" · "}{p.vat_rate}% moms
            </p>
          </div>
          <button onClick={() => deletePricing.mutate(p.id)} className="text-muted-foreground/50 hover:text-destructive">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
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

const AdminMemberships = ({ venueId }: { venueId: string }) => {
  const qc = useQueryClient();
  const { data: tiers, isLoading } = useQuery<MembershipTier[]>({
    queryKey: ["membership-tiers", venueId],
    enabled: !!venueId,
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      console.log("[AdminMemberships] token:", session?.access_token?.slice(0, 20) ?? "NULL");
      return apiGet("api-memberships", "tiers", { venueId });
    },
  });

  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [color, setColor] = useState("#E86C24");
  const [monthlyPrice, setMonthlyPrice] = useState("");
  const [expandedTier, setExpandedTier] = useState<string | null>(null);

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
                  {tier.is_active ? "Aktiv" : "Av"}
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
    </div>
  );
};

export default AdminMemberships;
