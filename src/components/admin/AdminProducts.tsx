import { useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AlertTriangle, Loader2, Package, Plus, Save, Trash2 } from "lucide-react";
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
  commerce_kind: "participation" | "rental" | "merchandise" | null;
  fulfillment_type: "participation" | "desk_pickup" | null;
  commerce_enabled: boolean;
  resolver_rules?: Record<string, unknown>;
}

interface ProductRelationship {
  id: string;
  source_product_id: string;
  target_product_id: string;
  relationship_type: "offered_with";
  is_active: boolean;
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

const PRODUCT_KINDS = [
  { key: "day_access", label: "Day Pass / dagsmedlemskap" },
  { key: "session_ticket", label: "Session ticket" },
  { key: "session_with_day_access", label: "Session + Day Pass" },
  { key: "voucher", label: "Voucher / gåva" },
  { key: "membership", label: "Membership" },
  { key: "rental", label: "Hyra" },
  { key: "merchandise", label: "Vara" },
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

const formatPrice = (amount: number) => `${Math.round(Number(amount || 0)).toLocaleString("sv-SE")} kr`;

const REQUIRED_PRODUCTS = [
  {
    product_key: "open_play_slot",
    name: "Open Play-biljett",
    description: "En biljett till ett schemalagt Open Play-pass. Priset sätts på passet i Schema.",
    product_kind: "session_ticket",
    session_type: "open_play",
    base_price_sek: 0,
    grants: {
      entitlement_type: "session_ticket",
    },
    sort_order: 0,
  },
  {
    product_key: "day_access",
    name: "Dagsmedlemskap",
    description: "Heldagstillgång. Kan användas som upsell från enstaka aktivitetspass.",
    product_kind: "day_access",
    session_type: null,
    base_price_sek: 199,
    grants: {
      entitlement_type: "day_access",
      includes_session_types: ["open_play"],
    },
    sort_order: 1,
  },
  {
    product_key: "group_training",
    name: "Gruppträning",
    description: "Biljett till schemalagt träningspass. Priset sätts på passet i Schema.",
    product_kind: "session_ticket",
    session_type: "group_training",
    base_price_sek: 0,
    grants: {
      entitlement_type: "session_ticket",
    },
    sort_order: 2,
  },
];

const ProductPriceCard = ({
  product,
  tiers,
  tierPricing,
  onUpdate,
  onDelete,
}: {
  product: AccessProduct;
  tiers: MembershipTier[];
  tierPricing: TierPricing[];
  onUpdate: (body: Record<string, unknown>) => void;
  onDelete: (productId: string) => void;
}) => {
  const [basePrice, setBasePrice] = useState(String(product.base_price_sek ?? 0));
  const [name, setName] = useState(product.name);
  const [vatRate, setVatRate] = useState(String(product.vat_rate ?? 0));
  const [commerceKind, setCommerceKind] = useState(product.commerce_kind || "");
  const [fulfillmentType, setFulfillmentType] = useState(product.fulfillment_type || "");
  const isDayAccess = product.product_key === "day_access";
  const isSessionPricedProduct = product.product_kind === "session_ticket" && product.product_key !== "day_access";
  const hasBadDayAccessPrice = isDayAccess && Number(product.base_price_sek || 0) <= 0;

  const previewRows = tiers
    .filter((tier) => tier.is_active)
    .map((tier) => {
      const rule = tierPricing.find((row) => row.tier_id === tier.id && row.product_type === product.product_key);
      if (!rule) return null;
      const base = Number(product.base_price_sek || 0);
      const price = rule.fixed_price != null
        ? Number(rule.fixed_price)
        : Math.max(0, Math.round(base * (1 - Number(rule.discount_percent || 0) / 100)));
      const suffix = rule.fixed_price != null ? "fast pris" : `${rule.discount_percent}% rabatt`;
      const displayPrice = isSessionPricedProduct && rule.fixed_price == null ? suffix : price <= 0 ? "Ingår" : formatPrice(price);
      return { tierName: tier.name, displayPrice, suffix };
    })
    .filter(Boolean) as Array<{ tierName: string; displayPrice: string; suffix: string }>;

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="glass-card rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
          <Package className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0 space-y-3">
          <div>
            <p className="text-sm font-bold">{product.name}</p>
            <p className="text-[10px] text-muted-foreground font-mono">{product.product_key}</p>
            {product.description && <p className="text-xs text-muted-foreground mt-1">{product.description}</p>}
            <div className="flex flex-wrap gap-1.5 mt-2">
              <span className="status-chip bg-primary/15 text-primary text-[9px]">{product.product_kind}</span>
              {product.session_type && <span className="status-chip bg-muted text-muted-foreground text-[9px]">{product.session_type}</span>}
              <span className="status-chip bg-court-free/15 text-court-free text-[9px]">{product.base_price_sek} kr</span>
            </div>
          </div>

          {isDayAccess && (
            <div className="rounded-xl p-3 text-xs space-y-1" style={{ background: "hsl(var(--surface-2))" }}>
              <p className="font-semibold">Canonical plats för dagsmedlemskap</p>
              <p className="text-muted-foreground">
                Baspriset sätts här. Medlemsrabatter sätts på medlemskapsnivån under prislistan för produktnyckel <span className="font-mono">day_access</span>.
              </p>
              {hasBadDayAccessPrice && (
                <p className="flex items-center gap-1.5 text-amber-400 font-semibold">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Baspris saknas eller är 0 kr. Då använder backend bara en nöd-fallback tills produkten är sparad.
                </p>
              )}
            </div>
          )}

          {isSessionPricedProduct && (
            <div className="rounded-xl p-3 text-xs space-y-1" style={{ background: "hsl(var(--surface-2))" }}>
              <p className="font-semibold">Produktnyckel för schemapass</p>
              <p className="text-muted-foreground">
                Produktens baspris är huvudpris för pass som använder den här produkten. Schema ska bara ändra pris när ett enskilt pass uttryckligen behöver avvika. Medlemsrabatter sätts på medlemskapsnivån för produktnyckel <span className="font-mono">{product.product_key}</span>.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_auto] gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-xl px-3 py-2 text-xs outline-none"
              style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
            />
            <input
              type="number"
              value={basePrice}
              onChange={(e) => setBasePrice(e.target.value)}
              className="rounded-xl px-3 py-2 text-xs outline-none"
              style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
            />
            <button
              onClick={() => onUpdate({
                productId: product.id,
                name: name.trim() || product.name,
                base_price_sek: Math.max(0, Math.round(Number(basePrice || 0))),
                vat_rate: Math.max(0, Number(vatRate || 0)),
                commerce_kind: commerceKind || null,
                fulfillment_type: fulfillmentType || null,
              })}
              className="rounded-xl bg-primary px-3 py-2 text-xs font-bold text-primary-foreground flex items-center justify-center gap-2"
            >
              <Save className="w-3.5 h-3.5" />
              Spara pris
            </button>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="grid gap-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Commerce-typ
              <select value={commerceKind} onChange={(event) => setCommerceKind(event.target.value)} className="rounded-xl px-3 py-2 text-xs normal-case" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}>
                <option value="">Inte klassificerad</option>
                <option value="participation">Participation</option>
                <option value="rental">Rental</option>
                <option value="merchandise">Merchandise</option>
              </select>
            </label>
            <label className="grid gap-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Leverans
              <select value={fulfillmentType} onChange={(event) => setFulfillmentType(event.target.value)} className="rounded-xl px-3 py-2 text-xs normal-case" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}>
                <option value="">Inte vald</option>
                <option value="participation">Participation</option>
                <option value="desk_pickup">Hämtas vid desk</option>
              </select>
            </label>
            <label className="grid gap-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Moms %
              <input type="number" min="0" max="100" step="0.01" value={vatRate} onChange={(event) => setVatRate(event.target.value)} className="rounded-xl px-3 py-2 text-xs normal-case" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }} />
            </label>
          </div>

          <div className="rounded-xl p-3" style={{ background: "hsl(var(--surface-2))" }}>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Medlemspris-preview</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="rounded-full px-3 py-2 text-xs flex items-center justify-between" style={{ background: "hsl(var(--surface-1))" }}>
                <span className="text-muted-foreground">Vanlig kund</span>
                <span className="font-bold">{formatPrice(product.base_price_sek)}</span>
              </div>
              {previewRows.length > 0 ? previewRows.map((row) => (
                <div key={`${product.product_key}-${row.tierName}`} className="rounded-full px-3 py-2 text-xs flex items-center justify-between" style={{ background: "hsl(var(--surface-1))" }}>
                  <span className="text-muted-foreground">{row.tierName} · {row.suffix}</span>
                  <span className="font-bold">{row.displayPrice}</span>
                </div>
              )) : (
                <div className="rounded-full px-3 py-2 text-xs text-muted-foreground" style={{ background: "hsl(var(--surface-1))" }}>
                  Inga medlemsprisregler för den här produkten ännu.
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1 items-end">
          <button
            onClick={() => onUpdate({ productId: product.id, is_active: !product.is_active })}
            className={`text-[10px] px-2 py-1 rounded-full font-semibold ${product.is_active ? "bg-badge-paid/15 text-badge-paid" : "bg-destructive/15 text-destructive"}`}
          >
            {product.is_active ? "Aktiv" : "Av"}
          </button>
          <button
            onClick={() => onUpdate({ productId: product.id, commerce_enabled: !product.commerce_enabled })}
            disabled={!product.commerce_enabled && (!product.commerce_kind || !product.fulfillment_type)}
            className={`text-[10px] px-2 py-1 rounded-full font-semibold disabled:opacity-40 ${product.commerce_enabled ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}
          >
            {product.commerce_enabled ? "Commerce på" : "Commerce av"}
          </button>
          <button onClick={() => { if (confirm("Ta bort produkten?")) onDelete(product.id); }} className="text-muted-foreground/50 hover:text-destructive">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </motion.div>
  );
};

const AdminProducts = ({ venueId }: { venueId: string }) => {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [productKey, setProductKey] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState("day_access");
  const [sessionType, setSessionType] = useState("");
  const [price, setPrice] = useState("");
  const [vatRate, setVatRate] = useState("6");
  const [relationshipSource, setRelationshipSource] = useState("");
  const [relationshipTarget, setRelationshipTarget] = useState("");

  const { data: products, isLoading } = useQuery<AccessProduct[]>({
    queryKey: ["admin-access-products", venueId],
    queryFn: () => apiGet("api-admin", "products", { venueId }),
  });
  const { data: tiers } = useQuery<MembershipTier[]>({
    queryKey: ["membership-tiers", venueId],
    enabled: !!venueId,
    queryFn: () => apiGet("api-memberships", "tiers", { venueId, includeHidden: "true" }),
  });
  const { data: relationships = [] } = useQuery<ProductRelationship[]>({
    queryKey: ["admin-product-relationships", venueId],
    queryFn: () => apiGet("api-admin", "product-relationships", { venueId }),
  });
  const tierPricingQueries = useQueries({
    queries: (tiers || []).map((tier) => ({
      queryKey: ["tier-pricing", tier.id],
      queryFn: () => apiGet<TierPricing[]>("api-memberships", "tier-pricing", { tierId: tier.id }),
      enabled: !!tier.id,
    })),
  });
  const allTierPricing = tierPricingQueries.flatMap((query) => query.data || []);
  const missingRequiredProducts = REQUIRED_PRODUCTS.filter(
    (required) => !(products || []).some((product) => product.product_key === required.product_key),
  );

  const saveProduct = useMutation({
    mutationFn: (body: any) => apiPost("api-admin", "products", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-access-products", venueId] });
      toast.success("Produkt sparad");
      setName(""); setProductKey(""); setDescription(""); setPrice(""); setVatRate("6");
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

  const saveRelationship = useMutation({
    mutationFn: () => apiPost("api-admin", "product-relationships", {
      venueId,
      source_product_id: relationshipSource,
      target_product_id: relationshipTarget,
      is_active: true,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-product-relationships", venueId] });
      toast.success("Tillval kopplat");
      setRelationshipSource("");
      setRelationshipTarget("");
    },
    onError: (error: any) => toast.error(error.message),
  });

  const deleteRelationship = useMutation({
    mutationFn: (relationshipId: string) => apiDelete("api-admin", "product-relationships", { venueId, relationshipId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-product-relationships", venueId] }),
    onError: (error: any) => toast.error(error.message),
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
      vat_rate: Number(vatRate || 0),
      commerce_kind: kind === "rental" ? "rental" : kind === "merchandise" ? "merchandise" : null,
      fulfillment_type: kind === "rental" || kind === "merchandise" ? "desk_pickup" : null,
      commerce_enabled: false,
      grants: kind === "rental" || kind === "merchandise" ? {} : {
        entitlement_type: kind === "voucher" ? "voucher" : kind === "session_ticket" ? "session_ticket" : "day_access",
        includes_session_types: sessionType ? [sessionType] : ["open_play"],
        includes_session_ticket: kind === "session_with_day_access",
      },
      sort_order: (products?.length || 0) * 10,
      is_active: true,
    });
  };

  const createRequiredProduct = (required: typeof REQUIRED_PRODUCTS[number]) => {
    saveProduct.mutate({
      venueId,
      product_key: required.product_key,
      name: required.name,
      description: required.description,
      product_kind: required.product_kind,
      session_type: required.session_type,
      base_price_sek: required.base_price_sek,
      vat_rate: 6,
      grants: required.grants,
      sort_order: required.sort_order,
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
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_120px_auto]">
          <input
            type="number"
            placeholder="Pris SEK"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
          />
          <input
            type="number"
            min="0"
            max="100"
            step="0.01"
            placeholder="Moms %"
            value={vatRate}
            onChange={(event) => setVatRate(event.target.value)}
            className="rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
          />
          <button onClick={handleCreate} disabled={saveProduct.isPending} className="rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50 flex items-center gap-2">
            {saveProduct.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Lägg till
          </button>
        </div>
      </div>

      <div className="glass-card rounded-2xl p-4 space-y-3">
        <div>
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Tillval till aktivitet</p>
          <p className="mt-1 text-xs text-muted-foreground">Kopplingen avgör vilka hyresprodukter som får ligga i samma köp som biljetten.</p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <select value={relationshipSource} onChange={(event) => setRelationshipSource(event.target.value)} className="rounded-xl px-3 py-2.5 text-xs" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}>
            <option value="">Aktivitetsprodukt</option>
            {(products || []).filter((product) => product.commerce_kind === "participation").map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
          </select>
          <select value={relationshipTarget} onChange={(event) => setRelationshipTarget(event.target.value)} className="rounded-xl px-3 py-2.5 text-xs" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}>
            <option value="">Hyresprodukt</option>
            {(products || []).filter((product) => product.commerce_kind === "rental").map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
          </select>
          <button type="button" onClick={() => saveRelationship.mutate()} disabled={!relationshipSource || !relationshipTarget || saveRelationship.isPending} className="rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground disabled:opacity-40">Koppla</button>
        </div>
        {relationships.map((relationship) => {
          const source = (products || []).find((product) => product.id === relationship.source_product_id);
          const target = (products || []).find((product) => product.id === relationship.target_product_id);
          return (
            <div key={relationship.id} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-xs" style={{ background: "hsl(var(--surface-2))" }}>
              <span>{source?.name || "Produkt"} + {target?.name || "Tillval"}</span>
              <button type="button" onClick={() => deleteRelationship.mutate(relationship.id)} className="text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          );
        })}
      </div>

      {missingRequiredProducts.length > 0 && (
        <div className="glass-card rounded-2xl p-4 space-y-3 border border-amber-500/30">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold">Saknad kärnprodukt</p>
              <p className="text-xs text-muted-foreground mt-1">
                Dagsmedlemskap behöver en produkt i katalogen. Utan den blir priset svårbegripligt och backend måste använda nöd-fallback.
              </p>
            </div>
          </div>
          {missingRequiredProducts.map((required) => (
            <button
              key={required.product_key}
              onClick={() => createRequiredProduct(required)}
              disabled={saveProduct.isPending}
              className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
            >
              Skapa {required.name} · {required.base_price_sek} kr
            </button>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {(products || []).map((product) => (
          <ProductPriceCard
            key={product.id}
            product={product}
            tiers={tiers || []}
            tierPricing={allTierPricing}
            onUpdate={(body) => updateProduct.mutate(body)}
            onDelete={(productId) => deleteProduct.mutate(productId)}
          />
        ))}
      </div>
    </div>
  );
};

export default AdminProducts;
