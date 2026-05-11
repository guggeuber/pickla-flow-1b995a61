import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Loader2, Package, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";

interface AccessProduct {
  id: string;
  product_key: string;
  name: string;
  description: string | null;
  product_kind: string;
  session_type: string | null;
  base_price_sek: number;
  vat_rate: number;
  is_active: boolean;
  sort_order: number;
}

const PRODUCT_KINDS = [
  { key: "day_access", label: "Day Pass / dagsmedlemskap" },
  { key: "session_ticket", label: "Session ticket" },
  { key: "session_with_day_access", label: "Session + Day Pass" },
  { key: "voucher", label: "Voucher / gåva" },
  { key: "membership", label: "Membership" },
];

const SESSION_TYPES = [
  { key: "", label: "Ingen / gäller hela dagen" },
  { key: "open_play", label: "Open Play" },
  { key: "group_training", label: "Gruppträning" },
  { key: "pickla_open", label: "Pickla Open" },
  { key: "event", label: "Event" },
];

const keyFromName = (name: string) =>
  name.trim().toLowerCase().replace(/å/g, "a").replace(/ä/g, "a").replace(/ö/g, "o").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

const AdminProducts = ({ venueId }: { venueId: string }) => {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [productKey, setProductKey] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState("day_access");
  const [sessionType, setSessionType] = useState("");
  const [price, setPrice] = useState("");

  const { data: products, isLoading } = useQuery<AccessProduct[]>({
    queryKey: ["admin-access-products", venueId],
    queryFn: () => apiGet("api-admin", "products", { venueId }),
  });

  const saveProduct = useMutation({
    mutationFn: (body: any) => apiPost("api-admin", "products", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-access-products", venueId] });
      toast.success("Produkt sparad");
      setName(""); setProductKey(""); setDescription(""); setPrice("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateProduct = useMutation({
    mutationFn: (body: any) => apiPatch("api-admin", "products", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-access-products", venueId] });
      toast.success("Produkt uppdaterad");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteProduct = useMutation({
    mutationFn: (productId: string) => apiDelete("api-admin", "products", { venueId, productId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-access-products", venueId] });
      toast.success("Produkt borttagen");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleCreate = () => {
    const safeKey = productKey || keyFromName(name);
    if (!name.trim() || !safeKey) {
      toast.error("Namn krävs");
      return;
    }

    saveProduct.mutate({
      venueId,
      product_key: safeKey,
      name: name.trim(),
      description: description.trim() || null,
      product_kind: kind,
      session_type: sessionType || null,
      base_price_sek: Math.round(Number(price || 0)),
      vat_rate: 6,
      grants: {
        entitlement_type: kind === "voucher" ? "voucher" : kind === "session_ticket" ? "session_ticket" : "day_access",
        includes_session_types: sessionType ? [sessionType] : ["open_play"],
        includes_session_ticket: kind === "session_with_day_access",
      },
      sort_order: (products?.length || 0) * 10,
      is_active: true,
    });
  };

  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto mt-8" />;

  return (
    <div className="space-y-4">
      <div className="glass-card rounded-2xl p-4 space-y-3">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Ny produkt</p>
        <input
          placeholder="Namn, t.ex. Gruppträning + Day Pass"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!productKey) setProductKey(keyFromName(e.target.value));
          }}
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
          style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
        />
        <input
          placeholder="Produktnyckel"
          value={productKey}
          onChange={(e) => setProductKey(keyFromName(e.target.value))}
          className="w-full rounded-xl px-3 py-2.5 text-sm font-mono outline-none"
          style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
        />
        <textarea
          placeholder="Beskrivning"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none min-h-[72px]"
          style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
        />
        <div className="grid grid-cols-2 gap-2">
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-xl px-3 py-2.5 text-xs outline-none" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}>
            {PRODUCT_KINDS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
          <select value={sessionType} onChange={(e) => setSessionType(e.target.value)} className="rounded-xl px-3 py-2.5 text-xs outline-none" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}>
            {SESSION_TYPES.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input
            type="number"
            placeholder="Pris SEK"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
          />
          <button onClick={handleCreate} disabled={saveProduct.isPending} className="rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50 flex items-center gap-2">
            {saveProduct.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Lägg till
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {(products || []).map((product) => (
          <motion.div key={product.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="glass-card rounded-2xl p-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
                <Package className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold">{product.name}</p>
                <p className="text-[10px] text-muted-foreground font-mono">{product.product_key}</p>
                {product.description && <p className="text-xs text-muted-foreground mt-1">{product.description}</p>}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <span className="status-chip bg-primary/15 text-primary text-[9px]">{product.product_kind}</span>
                  {product.session_type && <span className="status-chip bg-muted text-muted-foreground text-[9px]">{product.session_type}</span>}
                  <span className="status-chip bg-court-free/15 text-court-free text-[9px]">{product.base_price_sek} kr</span>
                </div>
              </div>
              <div className="flex flex-col gap-1 items-end">
                <button
                  onClick={() => updateProduct.mutate({ productId: product.id, is_active: !product.is_active })}
                  className={`text-[10px] px-2 py-1 rounded-full font-semibold ${product.is_active ? "bg-badge-paid/15 text-badge-paid" : "bg-destructive/15 text-destructive"}`}
                >
                  {product.is_active ? "Aktiv" : "Av"}
                </button>
                <button onClick={() => { if (confirm("Ta bort produkten?")) deleteProduct.mutate(product.id); }} className="text-muted-foreground/50 hover:text-destructive">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default AdminProducts;
