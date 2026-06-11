import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Loader2, Plus, Save, Trash2, Star, StarOff, Eye, EyeOff, ArrowUp, ArrowDown, Package2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type ProductType = "package" | "resource";

interface EventProduct {
  id: string;
  venue_id: string | null;
  type: ProductType;
  name: string;
  slug: string | null;
  short_description: string | null;
  long_description: string | null;
  category: string | null;
  price_from_sek: number | null;
  price_sek: number | null;
  price_unit: string | null;
  min_people: number | null;
  max_people: number | null;
  duration_minutes: number | null;
  included_items: string[] | null;
  recommended_for: string[] | null;
  image_url: string | null;
  is_active: boolean;
  is_featured: boolean;
  included_by_default: boolean;
  sort_order: number;
  metadata: Record<string, unknown> | null;
}

const db = supabase as any;
const TABLE = "event_products";

const slugify = (s: string) =>
  s.trim().toLowerCase()
    .replace(/å|ä/g, "a").replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const emptyProduct = (type: ProductType, venue_id: string): Partial<EventProduct> => ({
  venue_id, type,
  name: "", slug: "", short_description: "", long_description: "", category: "",
  price_from_sek: null, price_sek: null,
  price_unit: type === "package" ? "per person" : "fast pris",
  min_people: null, max_people: null, duration_minutes: null,
  included_items: [], recommended_for: [],
  image_url: "", is_active: true, is_featured: false, included_by_default: false,
  sort_order: 0,
});

export default function AdminEventProducts({ venueId }: { venueId: string }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<ProductType>("package");
  const [editing, setEditing] = useState<Partial<EventProduct> | null>(null);

  const { data, isLoading } = useQuery<EventProduct[]>({
    queryKey: ["admin-event-products", venueId],
    enabled: !!venueId,
    queryFn: async () => {
      const { data, error } = await db
        .from(TABLE).select("*")
        .eq("venue_id", venueId)
        .order("type").order("sort_order").order("name");
      if (error) throw error;
      return (data || []) as EventProduct[];
    },
  });

  const items = useMemo(() => (data || []).filter((p) => p.type === tab), [data, tab]);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-event-products", venueId] });

  const upsert = useMutation({
    mutationFn: async (body: Partial<EventProduct>) => {
      const payload = {
        ...body,
        venue_id: venueId,
        slug: body.slug?.trim() || (body.name ? slugify(body.name) : null),
        price_from_sek: body.price_from_sek === null || body.price_from_sek === undefined || (body.price_from_sek as any) === "" ? null : Number(body.price_from_sek),
        price_sek: body.price_sek === null || body.price_sek === undefined || (body.price_sek as any) === "" ? null : Number(body.price_sek),
        min_people: body.min_people ? Number(body.min_people) : null,
        max_people: body.max_people ? Number(body.max_people) : null,
        duration_minutes: body.duration_minutes ? Number(body.duration_minutes) : null,
        sort_order: Number(body.sort_order || 0),
      };
      const { error } = body.id
        ? await db.from(TABLE).update(payload).eq("id", body.id)
        : await db.from(TABLE).insert(payload);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Sparat"); invalidate(); setEditing(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from(TABLE).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Borttagen"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: async (p: { id: string; patch: Partial<EventProduct> }) => {
      const { error } = await db.from(TABLE).update(p.patch).eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const reorder = (p: EventProduct, dir: -1 | 1) => {
    toggle.mutate({ id: p.id, patch: { sort_order: Math.max(0, p.sort_order + dir) } });
  };

  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["package", "resource"] as ProductType[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-xl px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
              tab === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            {t === "package" ? "Paket" : "Resurser & Add-ons"}
          </button>
        ))}
      </div>

      <button
        onClick={() => setEditing(emptyProduct(tab, venueId))}
        className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-border py-3 text-sm font-semibold text-primary hover:bg-primary/5"
      >
        <Plus className="w-4 h-4" /> Lägg till {tab === "package" ? "paket" : "resurs"}
      </button>

      <div className="space-y-2">
        {items.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-6">Inga {tab === "package" ? "paket" : "resurser"} ännu.</p>
        )}
        {items.map((p) => (
          <div key={p.id} className="glass-card rounded-2xl p-3 flex items-center gap-3">
            {p.image_url ? (
              <img src={p.image_url} alt="" className="w-12 h-12 rounded-xl object-cover" />
            ) : (
              <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
                {p.type === "package" ? <Package2 className="w-5 h-5 text-muted-foreground" /> : <Sparkles className="w-5 h-5 text-muted-foreground" />}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-bold truncate">{p.name || "(namnlöst)"}</p>
                {p.is_featured && <Star className="w-3 h-3 text-amber-500 fill-amber-500" />}
                {!p.is_active && <span className="text-[9px] bg-muted px-1.5 rounded">DOLD</span>}
              </div>
              <p className="text-[10px] text-muted-foreground truncate">
                {p.category || (p.type === "package" ? "Paket" : "Add-on")}
                {p.price_from_sek != null && ` · från ${p.price_from_sek} kr`}
                {p.price_sek != null && ` · ${p.price_sek} kr`}
                {p.price_unit && ` / ${p.price_unit}`}
              </p>
            </div>
            <div className="flex items-center gap-0.5">
              <button onClick={() => reorder(p, -1)} className="p-1.5 hover:bg-muted rounded-lg" title="Upp"><ArrowUp className="w-3.5 h-3.5" /></button>
              <button onClick={() => reorder(p, 1)} className="p-1.5 hover:bg-muted rounded-lg" title="Ner"><ArrowDown className="w-3.5 h-3.5" /></button>
              <button
                onClick={() => toggle.mutate({ id: p.id, patch: { is_featured: !p.is_featured } })}
                className="p-1.5 hover:bg-muted rounded-lg"
                title="Featured"
              >
                {p.is_featured ? <Star className="w-3.5 h-3.5 text-amber-500" /> : <StarOff className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => toggle.mutate({ id: p.id, patch: { is_active: !p.is_active } })}
                className="p-1.5 hover:bg-muted rounded-lg"
                title="Aktiv"
              >
                {p.is_active ? <Eye className="w-3.5 h-3.5 text-court-free" /> : <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />}
              </button>
              <button onClick={() => setEditing(p)} className="px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10 rounded-lg">Edit</button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <ProductEditor
          product={editing}
          onCancel={() => setEditing(null)}
          onSave={(b) => upsert.mutate(b)}
          onDelete={editing.id ? () => { if (confirm("Ta bort?")) { remove.mutate(editing.id!); setEditing(null); } } : undefined}
          saving={upsert.isPending}
        />
      )}
    </div>
  );
}

function ProductEditor({
  product, onCancel, onSave, onDelete, saving,
}: {
  product: Partial<EventProduct>;
  onCancel: () => void;
  onSave: (b: Partial<EventProduct>) => void;
  onDelete?: () => void;
  saving?: boolean;
}) {
  const [form, setForm] = useState<Partial<EventProduct>>(product);
  useEffect(() => setForm(product), [product]);
  const isPackage = form.type === "package";

  const set = <K extends keyof EventProduct>(k: K, v: EventProduct[K] | null) =>
    setForm((f) => ({ ...f, [k]: v as any }));

  const includedText = (form.included_items || []).join("\n");
  const recoText = (form.recommended_for || []).join("\n");

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="fixed inset-0 z-50 bg-background/95 backdrop-blur overflow-y-auto"
    >
      <div className="max-w-2xl mx-auto p-4 pb-24 space-y-4">
        <div className="flex items-center justify-between sticky top-0 bg-background py-2">
          <h2 className="text-lg font-display font-bold">{form.id ? "Redigera" : "Nytt"} {isPackage ? "paket" : "resurs"}</h2>
          <button onClick={onCancel} className="text-sm text-muted-foreground">Stäng</button>
        </div>

        <div className="space-y-3">
          <div>
            <Label>Namn *</Label>
            <Input value={form.name || ""} onChange={(e) => set("name", e.target.value)} placeholder={isPackage ? "Starter" : "Food package"} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Slug</Label>
              <Input value={form.slug || ""} onChange={(e) => set("slug", e.target.value)} placeholder="auto från namn" />
            </div>
            <div>
              <Label>Kategori</Label>
              <Input value={form.category || ""} onChange={(e) => set("category", e.target.value)} placeholder={isPackage ? "tag, t.ex. Mest populär" : "Mat / Dryck / Tech"} />
            </div>
          </div>
          <div>
            <Label>Kort beskrivning</Label>
            <Input value={form.short_description || ""} onChange={(e) => set("short_description", e.target.value)} />
          </div>
          <div>
            <Label>Lång beskrivning</Label>
            <Textarea rows={3} value={form.long_description || ""} onChange={(e) => set("long_description", e.target.value)} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            {isPackage ? (
              <div>
                <Label>Pris från (SEK)</Label>
                <Input type="number" value={form.price_from_sek ?? ""} onChange={(e) => set("price_from_sek", e.target.value ? Number(e.target.value) : null)} />
              </div>
            ) : (
              <div>
                <Label>Pris (SEK)</Label>
                <Input type="number" value={form.price_sek ?? ""} onChange={(e) => set("price_sek", e.target.value ? Number(e.target.value) : null)} />
              </div>
            )}
            <div>
              <Label>Prisenhet</Label>
              <Input value={form.price_unit || ""} onChange={(e) => set("price_unit", e.target.value)} placeholder="per person" />
            </div>
            <div>
              <Label>Sortering</Label>
              <Input type="number" value={form.sort_order ?? 0} onChange={(e) => set("sort_order", Number(e.target.value) as any)} />
            </div>
          </div>

          {isPackage && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Min personer</Label>
                <Input type="number" value={form.min_people ?? ""} onChange={(e) => set("min_people", e.target.value ? Number(e.target.value) : null)} />
              </div>
              <div>
                <Label>Max personer</Label>
                <Input type="number" value={form.max_people ?? ""} onChange={(e) => set("max_people", e.target.value ? Number(e.target.value) : null)} />
              </div>
              <div>
                <Label>Längd (min)</Label>
                <Input type="number" value={form.duration_minutes ?? ""} onChange={(e) => set("duration_minutes", e.target.value ? Number(e.target.value) : null)} />
              </div>
            </div>
          )}

          <div>
            <Label>Ingår i paketet (1 per rad)</Label>
            <Textarea rows={4} value={includedText} onChange={(e) => set("included_items", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) as any)} />
          </div>
          {isPackage && (
            <div>
              <Label>Rekommenderas för (1 per rad)</Label>
              <Textarea rows={2} value={recoText} onChange={(e) => set("recommended_for", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) as any)} />
            </div>
          )}
          <div>
            <Label>Bild URL</Label>
            <Input value={form.image_url || ""} onChange={(e) => set("image_url", e.target.value)} placeholder="https://..." />
          </div>

          <div className="flex flex-wrap gap-4 pt-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!form.is_active} onChange={(e) => set("is_active", e.target.checked as any)} />
              Aktiv
            </label>
            {isPackage && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!form.is_featured} onChange={(e) => set("is_featured", e.target.checked as any)} />
                Featured (mest populär)
              </label>
            )}
            {!isPackage && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!form.included_by_default} onChange={(e) => set("included_by_default", e.target.checked as any)} />
                Ingår som default
              </label>
            )}
          </div>

          {/* Live preview */}
          <div className="pt-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Förhandsvisning</p>
            <PreviewCard p={form as EventProduct} />
          </div>

          <div className="flex gap-2 pt-3">
            <Button onClick={() => onSave(form)} disabled={!form.name || saving} className="flex-1">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4 mr-2" /> Spara</>}
            </Button>
            {onDelete && (
              <Button variant="destructive" onClick={onDelete}>
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function PreviewCard({ p }: { p: EventProduct }) {
  const featured = p.is_featured;
  const isPackage = p.type === "package";
  return (
    <div className={`rounded-[24px] p-5 ring-1 ${featured ? "bg-neutral-950 text-white ring-neutral-950" : "bg-white text-neutral-900 ring-black/10"}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-[20px] font-bold">{p.name || "Namn"}</h3>
        {p.category && (
          <span className={`rounded-full px-2 py-0.5 text-[9px] uppercase tracking-[0.2em] ${featured ? "bg-[#32ef87] text-neutral-950" : "bg-neutral-100 text-neutral-600"}`}>
            {p.category}
          </span>
        )}
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        {isPackage && p.price_from_sek != null && (
          <>
            <span className={`text-[10px] uppercase ${featured ? "text-white/60" : "text-neutral-500"}`}>från</span>
            <span className="text-[32px] leading-none">{p.price_from_sek}</span>
            <span className={`text-[12px] ${featured ? "text-white/60" : "text-neutral-500"}`}>kr / {p.price_unit || "pers"}</span>
          </>
        )}
        {!isPackage && p.price_sek != null && (
          <>
            <span className="text-[28px] leading-none">{p.price_sek}</span>
            <span className={`text-[12px] ${featured ? "text-white/60" : "text-neutral-500"}`}>kr {p.price_unit ? `/ ${p.price_unit}` : ""}</span>
          </>
        )}
      </div>
      {(p.included_items || []).length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {(p.included_items || []).map((i, idx) => (
            <li key={idx} className="text-[13px]">• {i}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
