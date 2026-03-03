import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { Loader2, Plus, Crown, Trash2, Percent } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

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

const AdminMemberships = ({ venueId }: { venueId: string }) => {
  const qc = useQueryClient();
  const { data: tiers, isLoading } = useQuery<MembershipTier[]>({
    queryKey: ["membership-tiers", venueId],
    enabled: !!venueId,
    queryFn: () => apiGet("api-memberships", "tiers", { venueId }),
  });

  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [color, setColor] = useState("#E86C24");
  const [discount, setDiscount] = useState("");
  const [monthlyPrice, setMonthlyPrice] = useState("");

  const addTier = useMutation({
    mutationFn: (body: any) => apiPost("api-memberships", "tiers", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["membership-tiers", venueId] });
      toast.success("Medlemskapsnivå skapad!");
      setName(""); setDesc(""); setDiscount(""); setMonthlyPrice("");
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
      discount_percent: parseFloat(discount) || 0,
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

        <div className="grid grid-cols-3 gap-2">
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
            <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Rabatt %</p>
            <input
              type="number" placeholder="0"
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
              value={discount} onChange={(e) => setDiscount(e.target.value)}
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
            className="glass-card rounded-2xl p-4 flex items-start gap-3"
          >
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{ background: `${tier.color}20` }}
            >
              <Crown className="w-4 h-4" style={{ color: tier.color }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">{tier.name}</p>
              <p className="text-[10px] text-muted-foreground">
                {tier.discount_percent > 0 && `${tier.discount_percent}% rabatt`}
                {tier.discount_percent > 0 && tier.monthly_price > 0 && " · "}
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
              <button
                onClick={() => { if (confirm("Ta bort denna nivå?")) deleteTier.mutate(tier.id); }}
                className="text-muted-foreground/50 hover:text-destructive transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
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
