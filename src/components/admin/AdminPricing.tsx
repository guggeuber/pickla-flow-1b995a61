import { useState } from "react";
import { useAdminPricing, useAdminMutation } from "@/hooks/useAdmin";
import { Loader2, Plus, Tag } from "lucide-react";
import { toast } from "sonner";

const AdminPricing = ({ venueId }: { venueId: string }) => {
  const { data: pricing, isLoading } = useAdminPricing(venueId);
  const { addPricing, updatePricing } = useAdminMutation(venueId);
  const [name, setName] = useState("");
  const [type, setType] = useState("hourly");
  const [price, setPrice] = useState("");
  const [desc, setDesc] = useState("");

  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto mt-8" />;

  const handleAdd = () => {
    if (!name || !price) return;
    addPricing.mutate({ name, type, price: parseFloat(price), description: desc || undefined }, {
      onSuccess: () => { toast.success("Prisregel tillagd!"); setName(""); setPrice(""); setDesc(""); },
      onError: (e) => toast.error(e.message),
    });
  };

  const toggleActive = (rule: any) => {
    updatePricing.mutate({ ruleId: rule.id, is_active: !rule.is_active }, {
      onSuccess: () => toast.success(rule.is_active ? "Inaktiverad" : "Aktiverad"),
    });
  };

  return (
    <div className="space-y-4">
      <div className="glass-card rounded-2xl p-4 space-y-3">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Ny prisregel</p>
        <input placeholder="Namn (t.ex. Peak Hour)" className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }} value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}>
            <option value="hourly">Per timme</option>
            <option value="day_pass">Dagspass</option>
            <option value="membership">Medlemskap</option>
            <option value="other">Övrigt</option>
          </select>
          <input placeholder="Pris (kr)" type="number" className="rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }} value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <input placeholder="Beskrivning (valfritt)" className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }} value={desc} onChange={(e) => setDesc(e.target.value)} />
        <button onClick={handleAdd} disabled={addPricing.isPending} className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-50">
          {addPricing.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Lägg till
        </button>
      </div>

      <div className="space-y-1.5">
        {(pricing || []).map((rule: any) => (
          <div key={rule.id} className="glass-card rounded-2xl p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-sell/10 flex items-center justify-center">
              <Tag className="w-4 h-4 text-sell" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">{rule.name}</p>
              <p className="text-[10px] text-muted-foreground">{rule.type} · {rule.description || "–"}</p>
            </div>
            <span className="text-sm font-display font-bold text-foreground">{rule.price} kr</span>
            <button onClick={() => toggleActive(rule)} className={`text-[10px] px-2 py-1 rounded-full font-semibold ${rule.is_active ? "bg-badge-paid/15 text-badge-paid" : "bg-destructive/15 text-destructive"}`}>
              {rule.is_active ? "Aktiv" : "Av"}
            </button>
          </div>
        ))}
        {(!pricing || pricing.length === 0) && (
          <p className="text-sm text-muted-foreground text-center py-6">Inga prisregler ännu</p>
        )}
      </div>
    </div>
  );
};

export default AdminPricing;
