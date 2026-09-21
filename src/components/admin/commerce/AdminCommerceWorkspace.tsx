import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { motion } from "framer-motion";
import {
  AlertTriangle, Archive, ArrowLeft, Boxes, Check, ChevronDown, ChevronRight,
  ClipboardCheck, ExternalLink, History, Loader2, Package,
  PackageCheck, Plus, Receipt, RefreshCw, RotateCcw, Search, ShoppingBag,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import {
  filterAndSortProducts, productSalesModeLabel, type ProductCatalogFilters,
  type ProductCatalogStatus,
} from "@/lib/adminProductCatalog";
import {
  buildVariantMatrix, normalizeCode, productInventoryState, sek, sekFromMinor,
  skuBaseFromName, variantLabel, type AdminCommerceProduct, type CommerceOrder,
  type CommerceOrderLine, type CommerceSection, type InventoryOperations,
  type ProductDetailTab, type ProductVariant, type TrackedProductDetail,
  type VariantMatrixRow,
} from "@/lib/adminCommerce";
import { ax, AX_GRID_BG } from "@/components/admin/shell/axTheme";
import { AxChip } from "@/components/admin/shell/axPrimitives";
import { Switch } from "@/components/ui/switch";
import {
  DraftProductMediaPicker,
  ProductMediaEditor,
  uploadPendingProductMedia,
  type PendingProductImage,
} from "@/components/admin/commerce/ProductMediaEditor";
import CommerceOrderDetailDrawer from "@/components/commerce/CommerceOrderDetailDrawer";
import Customer360Drawer from "@/components/customers/Customer360Drawer";
import { fetchStaffCommerceOrders, type StaffCommerceOrderSummary } from "@/lib/commerce";

type ProductRelationship = {
  id: string;
  source_product_id: string;
  target_product_id: string;
  is_active: boolean;
  relationship_type: "offered_with";
  sort_order: number;
};

type ProductDraft = {
  name: string;
  description: string;
  price: string;
  vatRate: string;
  status: ProductCatalogStatus;
  standaloneEnabled: boolean;
  activityAddonEnabled: boolean;
  fulfillment: "desk_pickup" | "digital" | "participation";
  category: string;
  sport: string;
  commerceKind: "rental" | "merchandise";
  inventoryPolicy: "stockless" | "tracked";
  hasVariants: boolean;
  colors: string;
  sizes: string;
  locationName: string;
};

const INPUT = "w-full rounded-xl border bg-transparent px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-blue-400";
const PANEL = { background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}` };
const EMPTY_FILTERS: ProductCatalogFilters = { search: "", status: "all", salesMode: "all", category: "", sport: "", sort: "name" };

const splitValues = (value: string) => value.split(",").map((part) => part.trim()).filter(Boolean);
const productKey = (name: string) => normalizeCode(name).replace(/-/g, "_") || "produkt";
const receiptFor = (order: CommerceOrder) => Array.isArray(order.booking_receipts) ? order.booking_receipts[0] : order.booking_receipts;
const relation = <T,>(value: T | T[] | null | undefined) => Array.isArray(value) ? value[0] || null : value || null;

function emptyDraft(): ProductDraft {
  return {
    name: "", description: "", price: "", vatRate: "25", status: "draft",
    standaloneEnabled: true, activityAddonEnabled: false, fulfillment: "desk_pickup",
    category: "", sport: "", commerceKind: "merchandise",
    inventoryPolicy: "stockless", hasVariants: true, colors: "Black, Off-white",
    sizes: "S, M, L, XL", locationName: "Butik / reception",
  };
}

function draftFromProduct(product: AdminCommerceProduct): ProductDraft {
  return {
    ...emptyDraft(), name: product.name, description: product.description || "",
    price: String(product.base_price_sek ?? 0), vatRate: String(product.vat_rate ?? 0),
    status: product.status, standaloneEnabled: product.standalone_enabled,
    activityAddonEnabled: product.activity_addon_enabled,
    fulfillment: product.fulfillment_presentation || "desk_pickup",
    category: product.category || "", sport: product.sport || "",
    commerceKind: product.commerce_kind === "rental" ? "rental" : "merchandise",
    inventoryPolicy: product.inventory_policy || "stockless",
  };
}

function humanError(error: Error) {
  const message = error.message || "Något gick fel";
  if (/duplicate key|23505|normalized_sku|option_signature/i.test(message)) return "SKU eller variantkombinationen finns redan. Välj en unik SKU och kombination.";
  if (/identity|locked|operational use/i.test(message)) return "Variantens identitet är låst efter användning. Ändra visningsnamn/pris eller arkivera varianten i stället.";
  if (/expected_version|inventory_version_conflict/i.test(message)) return "Lagret ändrades av någon annan. Uppdatera saldot och försök igen.";
  if (/shortage|commitments/i.test(message)) return "Den fysiska räkningen understiger reserverat eller allokerat lager. Bekräfta brist för att skapa en blockerande incident.";
  return message;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block text-xs font-black" style={{ color: ax("muted") }}><span>{label}</span>{hint ? <span className="ml-1 font-normal">· {hint}</span> : null}<span className="mt-1.5 block">{children}</span></label>;
}

function EmptyState({ icon: Icon, title, body, action }: { icon: typeof Package; title: string; body: string; action?: React.ReactNode }) {
  return <div className="rounded-2xl px-5 py-10 text-center" style={PANEL}><Icon className="mx-auto h-7 w-7" style={{ color: ax("electricSoft") }} /><h3 className="mt-3 font-display text-base font-black text-white">{title}</h3><p className="mx-auto mt-1 max-w-md text-xs leading-relaxed" style={{ color: ax("muted") }}>{body}</p>{action ? <div className="mt-4">{action}</div> : null}</div>;
}

function StatusChip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "lime" | "sun" | "danger" | "electric" }) {
  return <span className="inline-flex rounded-full px-2 py-1 font-mono text-[9px] font-black uppercase tracking-[0.12em]" style={{ background: ax(tone === "neutral" ? "border" : tone, 0.16), color: tone === "neutral" ? ax("muted") : ax(tone) }}>{children}</span>;
}

function Metric({ label, value, attention }: { label: string; value: number | string; attention?: boolean }) {
  return <div className="rounded-xl p-3" style={{ background: ax("surface"), border: `1px solid ${attention ? ax("danger", 0.5) : ax("borderSoft")}` }}><p className="font-mono text-[9px] font-black uppercase tracking-[0.12em]" style={{ color: ax("muted") }}>{label}</p><p className="mt-1 text-lg font-black" style={{ color: attention ? ax("danger") : "white" }}>{value}</p></div>;
}

function CommerceNav({ section, onChange }: { section: CommerceSection; onChange: (section: CommerceSection) => void }) {
  const items: Array<{ id: CommerceSection; label: string; icon: typeof Package }> = [
    { id: "products", label: "Produkter", icon: Package },
    { id: "inventory", label: "Lager", icon: Boxes },
    { id: "orders", label: "Ordrar", icon: Receipt },
  ];
  return <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Commerce">
    {items.map(({ id, label, icon: Icon }) => <button key={id} type="button" role="tab" aria-selected={section === id} onClick={() => onChange(id)} className="min-h-12 rounded-xl px-3 text-xs font-black" style={{ background: section === id ? ax("electric", 0.2) : ax("surfaceHi"), border: `1px solid ${section === id ? ax("electric", 0.65) : ax("borderSoft")}`, color: section === id ? "white" : ax("muted") }}><Icon className="mr-1.5 inline h-4 w-4" />{label}</button>)}
  </div>;
}

function TrackedGate({ detail }: { detail?: TrackedProductDetail }) {
  const enabled = detail?.listing?.tracked_sales_enabled === true && detail?.venue?.tracked_merch_sales_enabled === true;
  return <div className="rounded-2xl p-4" style={{ background: enabled ? ax("lime", 0.08) : ax("sun", 0.08), border: `1px solid ${enabled ? ax("lime", 0.35) : ax("sun", 0.35)}` }}>
    <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: enabled ? ax("lime") : ax("sun") }} /><div><p className="text-sm font-black text-white">{enabled ? "Spårad försäljning är aktiverad" : "Spårad försäljning är avstängd"}</p><p className="mt-1 text-xs leading-relaxed" style={{ color: ax("muted") }}>{enabled ? "Befintliga checkout-, pickup- och returflöden fortsätter följa R2A." : "Produkten kan konfigureras och publiceras som katalogutkast, men nya spårade köp kräver separat aktiveringsgranskning. Den här ytan aktiverar inte flaggan."}</p></div></div>
  </div>;
}

function TrackedSetupRecovery({ venueId, product, detail, refresh }: { venueId: string; product: AdminCommerceProduct; detail: TrackedProductDetail; refresh: () => Promise<void> }) {
  const [colors, setColors] = useState("Black, Off-white");
  const [sizes, setSizes] = useState("S, M, L, XL");
  const [locationName, setLocationName] = useState("Butik / reception");
  const seller = relation(detail.venue?.franchisees);
  const setup = useMutation({
    mutationFn: () => {
      if (!detail.venue?.franchisee_id || !seller) throw new Error("Anläggningen saknar verifierad juridisk säljare.");
      return apiPost("api-admin", "tracked-product-setup", {
        venueId, product_id: product.id, seller_franchisee_id: detail.venue.franchisee_id,
        location_name: locationName.trim(), location_code: "retail", tracked_sales_enabled: false,
        options: [
          { code: "color", label: "Färg", sort_order: 10, values: splitValues(colors).map((value, index) => ({ code: normalizeCode(value), label: value, sort_order: index * 10 })) },
          { code: "size", label: "Storlek", sort_order: 20, values: splitValues(sizes).map((value, index) => ({ code: normalizeCode(value), label: value, sort_order: index * 10 })) },
        ],
      });
    },
    onSuccess: async () => { await refresh(); toast.success("Säljare, plats och alternativ konfigurerades. Försäljning förblir avstängd."); },
    onError: (error: Error) => toast.error(humanError(error)),
  });
  return <section className="space-y-4 rounded-2xl p-5" style={PANEL} data-testid="tracked-setup-recovery"><div><h3 className="text-base font-black text-white">Slutför variantkonfiguration</h3><p className="mt-1 text-xs leading-relaxed" style={{ color: ax("muted") }}>Det här utkastet har ännu ingen venue-listing. Konfigurera juridisk säljare, utlämningsplats och obligatoriska alternativ. Inget saldo skapas och försäljning förblir avstängd.</p></div><TrackedGate detail={detail} /><div className="grid gap-3 sm:grid-cols-2"><Field label="Juridisk säljare"><input value={seller?.legal_name || "Saknas"} disabled className={INPUT} style={{ borderColor: ax("border"), opacity: 0.65 }} /></Field><Field label="Lager- och utlämningsplats"><input value={locationName} onChange={(event) => setLocationName(event.target.value)} className={INPUT} style={{ borderColor: ax("border") }} /></Field><Field label="Färger" hint="kommatecken"><input value={colors} onChange={(event) => setColors(event.target.value)} className={INPUT} style={{ borderColor: ax("border") }} /></Field><Field label="Storlekar" hint="kommatecken"><input value={sizes} onChange={(event) => setSizes(event.target.value)} className={INPUT} style={{ borderColor: ax("border") }} /></Field></div><button type="button" onClick={() => setup.mutate()} disabled={setup.isPending || !seller} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-xs font-black disabled:opacity-40" style={{ background: ax("electric"), color: ax("ink") }}>{setup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Boxes className="h-4 w-4" />} Konfigurera säkert utkast</button></section>;
}

function ProductList({ products, onOpen, onCreate }: { products: AdminCommerceProduct[]; onOpen: (product: AdminCommerceProduct) => void; onCreate: () => void }) {
  const [filters, setFilters] = useState<ProductCatalogFilters>(EMPTY_FILTERS);
  const [inventoryFilter, setInventoryFilter] = useState<"all" | "tracked" | "stockless">("all");
  const filtered = useMemo(() => filterAndSortProducts(products, filters).filter((product) => inventoryFilter === "all" || product.inventory_policy === inventoryFilter), [products, filters, inventoryFilter]);
  const categories = useMemo(() => Array.from(new Set(products.map((product) => product.category).filter(Boolean) as string[])).sort(), [products]);
  const statusTone = (product: AdminCommerceProduct) => product.status === "active" ? "lime" : product.status === "draft" ? "sun" : "neutral";

  return <div className="space-y-4" data-testid="admin-commerce-products">
    <div className="flex items-start justify-between gap-4"><div><p className="font-mono text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: ax("magenta") }}>Commerce · Produkter</p><h2 className="mt-1 font-display text-2xl font-black text-white">Produktkatalog</h2><p className="mt-1 text-xs" style={{ color: ax("muted") }}>En produktidentitet för butik, aktivitetstillval och uthyrning.</p></div><motion.button whileTap={{ scale: 0.96 }} type="button" onClick={onCreate} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-xs font-black text-white" style={{ background: `linear-gradient(135deg, ${ax("electric")}, ${ax("magenta")})` }}><Plus className="h-4 w-4" /> Ny produkt</motion.button></div>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_150px_160px_150px]">
      <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: ax("muted") }} /><input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Sök produkt, kategori eller sport" className={`${INPUT} pl-9`} style={{ borderColor: ax("border"), background: ax("surfaceHi") }} /></div>
      <select aria-label="Produktstatus" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as ProductCatalogFilters["status"] }))} className={INPUT} style={{ borderColor: ax("border"), background: ax("surfaceHi") }}><option value="all">Alla statusar</option><option value="active">Aktiva</option><option value="draft">Utkast</option><option value="archived">Arkiverade</option></select>
      <select aria-label="Försäljningssätt" value={filters.salesMode} onChange={(event) => setFilters((current) => ({ ...current, salesMode: event.target.value as ProductCatalogFilters["salesMode"] }))} className={INPUT} style={{ borderColor: ax("border"), background: ax("surfaceHi") }}><option value="all">Alla kanaler</option><option value="standalone">Fristående butik</option><option value="addon">Aktivitetstillval</option><option value="both">Butik + aktivitet</option></select>
      {categories.length ? <select aria-label="Kategori" value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))} className={INPUT} style={{ borderColor: ax("border"), background: ax("surfaceHi") }}><option value="">Alla kategorier</option>{categories.map((category) => <option key={category}>{category}</option>)}</select> : null}
      <select aria-label="Sport" value={filters.sport} onChange={(event) => setFilters((current) => ({ ...current, sport: event.target.value }))} className={INPUT} style={{ borderColor: ax("border"), background: ax("surfaceHi") }}><option value="">Alla sporter</option>{Array.from(new Set(products.map((product) => product.sport).filter(Boolean) as string[])).map((sport) => <option key={sport}>{sport}</option>)}</select>
      <select aria-label="Lagerspårning" value={inventoryFilter} onChange={(event) => setInventoryFilter(event.target.value as typeof inventoryFilter)} className={INPUT} style={{ borderColor: ax("border"), background: ax("surfaceHi") }}><option value="all">Alla lagerlägen</option><option value="tracked">Lagerspårad</option><option value="stockless">Lager ej spårat</option></select>
      <select aria-label="Sortering" value={filters.sort} onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value as ProductCatalogFilters["sort"] }))} className={INPUT} style={{ borderColor: ax("border"), background: ax("surfaceHi") }}><option value="name">Namn A–Ö</option><option value="price_asc">Lägsta pris</option><option value="price_desc">Högsta pris</option></select>
    </div>
    <p className="font-mono text-[10px] font-bold" style={{ color: ax("muted") }}>{filtered.length} AV {products.length} PRODUKTER</p>
    {filtered.length === 0 ? <EmptyState icon={Package} title="Inga produkter matchar" body="Justera filtren eller skapa en ny produkt som utkast." /> : <div className="space-y-2">
      {filtered.map((product) => <button key={product.id} type="button" onClick={() => onOpen(product)} className="grid w-full gap-3 rounded-2xl p-4 text-left transition-transform active:scale-[0.99] sm:grid-cols-[minmax(0,1fr)_120px_150px_auto] sm:items-center" style={PANEL} data-testid={`commerce-product-${product.id}`}>
        <span className="flex min-w-0 items-center gap-3"><span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl" style={{ background: ax("surface") }}>{product.image_url ? <img src={product.image_url} alt="" className="h-full w-full object-cover" /> : <ShoppingBag className="h-5 w-5" style={{ color: ax("muted") }} />}</span><span className="min-w-0"><span className="flex flex-wrap items-center gap-1.5"><span className="truncate text-sm font-black text-white">{product.name}</span><StatusChip tone={statusTone(product)}>{product.status === "active" ? "Aktiv" : product.status === "draft" ? "Utkast" : "Arkiverad"}</StatusChip>{product.inventory_policy === "tracked" ? <StatusChip tone="electric">Lagerspårad</StatusChip> : null}</span><span className="mt-1 block truncate text-[11px]" style={{ color: ax("muted") }}>{productSalesModeLabel(product)} · {product.fulfillment_presentation === "desk_pickup" ? "Hämtas i receptionen" : product.fulfillment_presentation || "Leverans saknas"}</span></span></span>
        <span><span className="block text-sm font-black text-white">{sek(product.base_price_sek)}</span><span className="text-[10px]" style={{ color: ax("muted") }}>{product.vat_rate}% moms</span></span>
        <span><span className="block text-xs font-bold text-white">{product.inventory_policy === "tracked" ? `${product.variant_count || 0} varianter` : "Utan lagersaldo"}</span><span className="text-[10px]" style={{ color: product.inventory_summary?.incident_blocked ? ax("danger") : ax("muted") }}>{productInventoryState(product)}</span></span>
        <ChevronRight className="hidden h-4 w-4 sm:block" style={{ color: ax("muted") }} />
      </button>)}
    </div>}
  </div>;
}

function RelationshipEditor({ product, products, relationships, onToggle, pending }: { product: AdminCommerceProduct; products: AdminCommerceProduct[]; relationships: ProductRelationship[]; onToggle: (sourceId: string, targetId: string, relationshipId?: string) => void; pending: boolean }) {
  if (product.inventory_policy === "tracked") return null;
  const participation = product.commerce_kind === "participation";
  const candidates = products.filter((candidate) => participation ? candidate.id !== product.id && candidate.activity_addon_enabled : candidate.commerce_kind === "participation");
  if (!participation && !product.activity_addon_enabled) return null;
  return <section className="rounded-2xl p-4" style={PANEL}><h3 className="text-sm font-black text-white">Produktrelationer</h3><p className="mt-1 text-xs" style={{ color: ax("muted") }}>{participation ? "Välj stockless-produkter som kan köpas till aktiviteten." : "Välj aktiviteter som får erbjuda produkten som tillval."}</p><div className="mt-3 space-y-2">{candidates.length ? candidates.map((candidate) => {
    const sourceId = participation ? product.id : candidate.id;
    const targetId = participation ? candidate.id : product.id;
    const existing = relationships.find((item) => item.source_product_id === sourceId && item.target_product_id === targetId && item.is_active);
    return <label key={candidate.id} className="flex items-center justify-between rounded-xl p-3" style={{ background: ax("surface") }}><span><span className="block text-xs font-black text-white">{candidate.name}</span><span className="text-[10px]" style={{ color: ax("muted") }}>{sek(candidate.base_price_sek)}</span></span><input type="checkbox" checked={Boolean(existing)} disabled={pending} onChange={() => onToggle(sourceId, targetId, existing?.id)} className="h-5 w-5 accent-blue-500" /></label>;
  }) : <p className="text-xs" style={{ color: ax("muted") }}>Inga kompatibla produkter ännu.</p>}</div></section>;
}

function VariantWorkspace({ venueId, product, detail, refresh }: { venueId: string; product: AdminCommerceProduct; detail: TrackedProductDetail; refresh: () => Promise<void> }) {
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [skuValue, setSkuValue] = useState("");
  const [override, setOverride] = useState("");
  const [editing, setEditing] = useState<ProductVariant | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const optionValueIds = detail.options.map((option) => selected[option.id]).filter(Boolean);
      if (!skuValue.trim() || optionValueIds.length !== detail.options.length) throw new Error("SKU och ett värde för varje alternativ krävs.");
      const payload = { venueId, product_id: product.id, variant_id: editing?.id || null, sku: skuValue.trim(), title: detail.options.map((option) => option.product_option_values.find((value) => value.id === selected[option.id])?.label).filter(Boolean).join(" / "), price_override_minor: override === "" ? null : Math.round(Number(override) * 100), option_value_ids: optionValueIds, status: editing?.status === "archived" ? "archived" : "active" };
      return editing ? apiPatch("api-admin", "product-variants", payload) : apiPost("api-admin", "product-variants", payload);
    },
    onSuccess: async () => { setSelected({}); setSkuValue(""); setOverride(""); setEditing(null); await refresh(); toast.success("Varianten sparades"); },
    onError: (error: Error) => toast.error(humanError(error)),
  });
  const archive = useMutation({
    mutationFn: (variant: ProductVariant) => apiPatch("api-admin", "product-variants", { venueId, product_id: product.id, variant_id: variant.id, sku: variant.sku, title: variant.title, price_override_minor: variant.price_override_minor, image_url: variant.image_url, option_value_ids: variant.product_variant_option_values.map((value) => value.option_value_id), status: variant.status === "archived" ? "active" : "archived" }),
    onSuccess: async () => { await refresh(); toast.success("Variantstatus uppdaterad"); },
    onError: (error: Error) => toast.error(humanError(error)),
  });
  const chooseEdit = (variant: ProductVariant) => { setEditing(variant); setSkuValue(variant.sku); setOverride(variant.price_override_minor == null ? "" : String(variant.price_override_minor / 100)); setSelected(Object.fromEntries(variant.product_variant_option_values.map((value) => [value.option_id, value.option_value_id]))); };

  return <div className="space-y-4" data-testid="commerce-variant-workspace">
    <section className="rounded-2xl p-4" style={PANEL}><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-black text-white">{editing ? `Redigera ${editing.sku}` : "Lägg till variant"}</h3><p className="mt-1 text-xs" style={{ color: ax("muted") }}>Varje SKU och kombination måste vara unik. Använd identiteten konsekvent mellan platser.</p></div>{editing ? <button type="button" onClick={() => { setEditing(null); setSelected({}); setSkuValue(""); setOverride(""); }} className="text-xs font-bold" style={{ color: ax("muted") }}>Avbryt</button> : null}</div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">{detail.options.map((option) => <Field key={option.id} label={option.label}><select value={selected[option.id] || ""} onChange={(event) => setSelected((current) => ({ ...current, [option.id]: event.target.value }))} className={INPUT} style={{ borderColor: ax("border") }}><option value="">Välj</option>{option.product_option_values.filter((value) => value.status !== "archived").map((value) => <option key={value.id} value={value.id}>{value.label}</option>)}</select></Field>)}</div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="SKU"><input value={skuValue} onChange={(event) => setSkuValue(event.target.value)} placeholder={`${skuBaseFromName(product.name)}-BLK-M`} className={INPUT} style={{ borderColor: ax("border") }} /></Field><Field label="Prisoverride" hint="tomt ärver baspris"><input type="number" min="0" step="0.01" value={override} onChange={(event) => setOverride(event.target.value)} placeholder={String(product.base_price_sek)} className={INPUT} style={{ borderColor: ax("border") }} /></Field></div>
      <button type="button" onClick={() => save.mutate()} disabled={save.isPending} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl px-4 text-xs font-black" style={{ background: ax("electric"), color: ax("ink") }}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{editing ? "Spara variant" : "Skapa variant"}</button>
    </section>
    <section className="overflow-hidden rounded-2xl" style={PANEL}><div className="border-b px-4 py-3" style={{ borderColor: ax("borderSoft") }}><h3 className="text-sm font-black text-white">Varianter · {detail.variants.length}</h3></div>{detail.variants.length ? detail.variants.map((variant) => <div key={variant.id} className="grid gap-3 border-b p-4 last:border-0 sm:grid-cols-[minmax(0,1fr)_130px_120px_auto] sm:items-center" style={{ borderColor: ax("borderSoft") }}><div><p className="text-sm font-black text-white">{variantLabel(variant, detail.options)}</p><p className="font-mono text-[10px]" style={{ color: ax("muted") }}>SKU {variant.sku}</p></div><p className="text-xs text-white">{variant.price_override_minor == null ? `Ärver ${sek(product.base_price_sek)}` : sekFromMinor(variant.price_override_minor)}</p><StatusChip tone={variant.status === "active" ? "lime" : "neutral"}>{variant.status === "active" ? "Aktiv" : "Arkiverad"}</StatusChip><div className="flex gap-2"><button type="button" onClick={() => chooseEdit(variant)} className="rounded-lg px-2 py-1.5 text-[10px] font-black" style={{ border: `1px solid ${ax("border")}`, color: "white" }}>Redigera</button><button type="button" onClick={() => archive.mutate(variant)} disabled={archive.isPending} className="rounded-lg px-2 py-1.5 text-[10px] font-black" style={{ border: `1px solid ${ax("border")}`, color: variant.status === "active" ? ax("danger") : ax("lime") }}>{variant.status === "active" ? "Arkivera" : "Återaktivera"}</button></div></div>) : <div className="p-6 text-center text-xs" style={{ color: ax("muted") }}>Inga varianter har skapats.</div>}</section>
  </div>;
}

function InventoryWorkspace({ venueId, product, detail, operations, refresh, onLoadMore, loadingMore }: { venueId: string; product: AdminCommerceProduct; detail: TrackedProductDetail; operations?: InventoryOperations; refresh: () => Promise<void>; onLoadMore?: () => void; loadingMore?: boolean }) {
  const [mode, setMode] = useState<"receive" | "count">("receive");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [allowShortage, setAllowShortage] = useState(false);
  const [incidentEvidence, setIncidentEvidence] = useState<Record<string, string>>({});
  const locationId = detail.listing?.default_inventory_location_id;
  const submit = useMutation({
    mutationFn: async () => {
      if (!locationId || !reason.trim()) throw new Error("Plats och orsak krävs.");
      const rows = detail.variants.filter((variant) => quantities[variant.id] !== "" && quantities[variant.id] !== undefined);
      if (!rows.length) throw new Error("Ange antal för minst en variant.");
      for (const variant of rows) {
        const quantity = Math.floor(Number(quantities[variant.id]));
        if (!Number.isFinite(quantity) || (mode === "receive" && quantity <= 0) || (mode === "count" && quantity < 0)) throw new Error(`Ogiltigt antal för ${variant.sku}.`);
        if (mode === "receive") await apiPost("api-commerce", "inventory-receive", { venue_id: venueId, variant_id: variant.id, location_id: locationId, quantity, reason: reason.trim(), reference: reason.trim(), idempotency_key: crypto.randomUUID() });
        else {
          if (!variant.inventory) throw new Error(`${variant.sku} saknar ett befintligt lagersaldo att räkna om.`);
          await apiPost("api-commerce", "inventory-correct", { venue_id: venueId, variant_id: variant.id, location_id: locationId, physical_on_hand: quantity, expected_version: variant.inventory.version, allow_shortage: allowShortage, reason: reason.trim(), idempotency_key: crypto.randomUUID() });
        }
      }
      return rows.length;
    },
    onSuccess: async (count) => { setQuantities({}); setReason(""); setAllowShortage(false); await refresh(); toast.success(`${count} lagerrad${count === 1 ? "" : "er"} uppdaterades med spårbar rörelse`); },
    onError: (error: Error) => toast.error(humanError(error)),
  });
  const resolveIncident = useMutation({
    mutationFn: (id: string) => {
      const evidence = String(incidentEvidence[id] || "").trim();
      if (!evidence) throw new Error("Verifieringsunderlag krävs.");
      return apiPost("api-commerce", "inventory-incident-resolve", { venue_id: venueId, incident_id: id, evidence: { operator_note: evidence, verified_at: new Date().toISOString() }, idempotency_key: crypto.randomUUID() });
    },
    onSuccess: async () => { await refresh(); toast.success("Incidenten stängdes med verifieringsunderlag"); },
    onError: (error: Error) => toast.error(humanError(error)),
  });
  const productVariantIds = new Set(detail.variants.map((variant) => variant.id));
  const movements = (operations?.movements || []).filter((movement) => productVariantIds.has(movement.variant_id));
  const incidents = (operations?.incidents || []).filter((incident) => {
    const level = relation(incident.inventory_levels);
    return level ? productVariantIds.has(level.variant_id) : false;
  });

  return <div className="space-y-4" data-testid="commerce-inventory-workspace">
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4"><Metric label="Fysiskt på hand" value={detail.variants.reduce((sum, variant) => sum + Number(variant.inventory?.on_hand || 0), 0)} /><Metric label="Reserverat" value={detail.variants.reduce((sum, variant) => sum + Number(variant.inventory?.reserved || 0), 0)} /><Metric label="Allokerat, väntar uthämtning" value={detail.variants.reduce((sum, variant) => sum + Number(variant.inventory?.allocated || 0), 0)} /><Metric label="Tillgängligt att sälja" value={detail.variants.reduce((sum, variant) => sum + Number(variant.inventory?.available_to_sell || 0), 0)} attention={detail.variants.some((variant) => Number(variant.inventory?.available_to_sell || 0) < 0)} /></div>
    <section className="rounded-2xl p-4" style={PANEL}><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-black text-white">Lageroperation</h3><p className="mt-1 text-xs" style={{ color: ax("muted") }}>{relation(detail.listing?.inventory_locations)?.name || product.listing?.location_name || "Utlämningsplats"} · varje ändring skapar en oföränderlig rörelse.</p></div><div className="flex rounded-xl p-1" style={{ background: ax("surface") }}><button type="button" onClick={() => setMode("receive")} className="rounded-lg px-3 py-2 text-[10px] font-black" style={{ background: mode === "receive" ? ax("electric") : "transparent", color: mode === "receive" ? ax("ink") : ax("muted") }}>Ta emot varor</button><button type="button" onClick={() => setMode("count")} className="rounded-lg px-3 py-2 text-[10px] font-black" style={{ background: mode === "count" ? ax("electric") : "transparent", color: mode === "count" ? ax("ink") : ax("muted") }}>Korrigera / räkna</button></div></div>
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead><tr style={{ color: ax("muted") }}><th className="pb-2">Variant</th><th className="pb-2">På hand</th><th className="pb-2">Reserverat</th><th className="pb-2">Allokerat</th><th className="pb-2">Tillgängligt</th><th className="pb-2">{mode === "receive" ? "Ta emot" : "Fysiskt räknat"}</th></tr></thead><tbody>{detail.variants.filter((variant) => variant.status !== "archived").map((variant) => <tr key={variant.id} className="border-t" style={{ borderColor: ax("borderSoft") }}><td className="py-3 pr-3"><span className="block font-black text-white">{variantLabel(variant, detail.options)}</span><span className="font-mono text-[9px]" style={{ color: ax("muted") }}>{variant.sku}</span></td><td className="py-3 text-white">{variant.inventory?.on_hand || 0}</td><td className="py-3 text-white">{variant.inventory?.reserved || 0}</td><td className="py-3 text-white">{variant.inventory?.allocated || 0}</td><td className="py-3 font-black" style={{ color: Number(variant.inventory?.available_to_sell || 0) <= 0 ? ax("sun") : ax("lime") }}>{variant.inventory?.available_to_sell || 0}</td><td className="py-3"><input aria-label={`${mode === "receive" ? "Ta emot" : "Räkna"} ${variant.sku}`} type="number" min={mode === "receive" ? 1 : 0} value={quantities[variant.id] || ""} onChange={(event) => setQuantities((current) => ({ ...current, [variant.id]: event.target.value }))} className="w-24 rounded-lg border bg-transparent px-2 py-2 text-white" style={{ borderColor: ax("border") }} /></td></tr>)}</tbody></table></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"><Field label="Orsak / referens"><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder={mode === "receive" ? "Leverans 2026-09-21 / följesedel" : "Fysisk inventering och kontroll"} className={INPUT} style={{ borderColor: ax("border") }} /></Field><button type="button" onClick={() => submit.mutate()} disabled={submit.isPending} className="self-end rounded-xl px-4 py-3 text-xs font-black" style={{ background: ax("electric"), color: ax("ink") }}>{submit.isPending ? "Sparar…" : mode === "receive" ? "Bekräfta mottagning" : "Spara inventering"}</button></div>
      {mode === "count" ? <label className="mt-3 flex items-start gap-2 text-xs" style={{ color: ax("muted") }}><input type="checkbox" checked={allowShortage} onChange={(event) => setAllowShortage(event.target.checked)} className="mt-0.5" /><span>Bekräfta verklig brist om räknat saldo understiger reserverade/allokerade åtaganden. Detta skapar en blockerande incident—det klampar inte bort differensen.</span></label> : null}
    </section>
    {incidents.some((incident) => incident.status === "open") ? <section className="rounded-2xl p-4" style={{ background: ax("danger", 0.07), border: `1px solid ${ax("danger", 0.4)}` }}><h3 className="text-sm font-black" style={{ color: ax("danger") }}>Lager behöver åtgärdas</h3><p className="mt-1 text-xs" style={{ color: ax("muted") }}>Korrigera fysisk sanning först. Stäng sedan incidenten med verifieringsunderlag.</p>{incidents.filter((incident) => incident.status === "open").map((incident) => <div key={incident.id} className="mt-3 rounded-xl p-3" style={{ background: ax("surface") }}><p className="text-xs font-black text-white">{incident.incident_type.replaceAll("_", " ")} · underskott {incident.deficit_quantity}</p><div className="mt-2 flex gap-2"><input value={incidentEvidence[incident.id] || ""} onChange={(event) => setIncidentEvidence((current) => ({ ...current, [incident.id]: event.target.value }))} placeholder="Fysisk omräkning, åtgärd och referens" className={INPUT} style={{ borderColor: ax("border") }} /><button type="button" onClick={() => resolveIncident.mutate(incident.id)} className="shrink-0 rounded-xl px-3 text-xs font-black" style={{ border: `1px solid ${ax("danger", 0.5)}`, color: ax("danger") }}>Verifiera & stäng</button></div></div>)}</section> : null}
    <section className="rounded-2xl p-4" style={PANEL}><div className="flex items-center gap-2"><History className="h-4 w-4" style={{ color: ax("electricSoft") }} /><h3 className="text-sm font-black text-white">Lagerrörelser</h3></div><p className="mt-1 text-xs" style={{ color: ax("muted") }}>Senaste rörelserna laddas först när Lager öppnas.</p><div className="mt-3 space-y-2">{movements.length ? movements.map((movement) => <div key={movement.id} className="grid gap-2 rounded-xl p-3 sm:grid-cols-[120px_minmax(0,1fr)_auto]" style={{ background: ax("surface") }}><span className="font-mono text-[10px]" style={{ color: ax("muted") }}>{DateTime.fromISO(movement.occurred_at).setZone("Europe/Stockholm").toFormat("yyyy-LL-dd HH:mm")}</span><span><span className="block text-xs font-black text-white">{movement.movement_type.replaceAll("_", " ")}</span><span className="text-[10px]" style={{ color: ax("muted") }}>{movement.reason} · {movement.source_entity_type}</span></span><span className="font-mono text-[10px] text-white">HAND {movement.on_hand_delta >= 0 ? "+" : ""}{movement.on_hand_delta} · RES {movement.reserved_delta >= 0 ? "+" : ""}{movement.reserved_delta} · ALLOK {movement.allocated_delta >= 0 ? "+" : ""}{movement.allocated_delta}</span></div>) : <p className="py-4 text-center text-xs" style={{ color: ax("muted") }}>Inga lagerrörelser för produkten.</p>}</div>{operations?.movements_page?.has_more && onLoadMore ? <button type="button" disabled={loadingMore} onClick={onLoadMore} className="mt-3 w-full rounded-xl px-3 py-2.5 text-xs font-black disabled:opacity-40" style={{ border: `1px solid ${ax("border")}`, color: "white" }}>{loadingMore ? "Hämtar…" : "Ladda äldre rörelser"}</button> : null}</section>
  </div>;
}

function RefundAndReturn({ venueId, order, line, operations, refresh }: { venueId: string; order: CommerceOrder; line: CommerceOrderLine; operations: InventoryOperations; refresh: () => Promise<void> }) {
  const allocation = operations.allocations.find((item) => item.commerce_order_line_id === line.id);
  const [refundQty, setRefundQty] = useState("1");
  const [returnQty, setReturnQty] = useState("1");
  const [outcome, setOutcome] = useState<"return_sellable" | "return_damaged" | "uncollected_present" | "uncollected_missing">("return_sellable");
  const relevantRefunds = operations.refunds.filter((refund) => refund.commerce_order_id === order.id && refund.commerce_refund_lines?.some((item) => item.commerce_order_line_id === line.id));
  const consumed = relevantRefunds.filter((refund) => ["preparing", "pending", "succeeded"].includes(refund.status)).flatMap((refund) => refund.commerce_refund_lines).filter((item) => item.commerce_order_line_id === line.id).reduce((sum, item) => sum + Number(item.quantity), 0);
  const refundable = Math.max(0, Number(line.quantity) - consumed);
  const succeeded = relevantRefunds.find((refund) => refund.status === "succeeded");
  const refund = useMutation({
    mutationFn: () => apiPost<{ recovery_pending?: boolean }>("api-commerce", "refund", { venue_id: venueId, order_id: order.id, lines: [{ line_id: line.id, quantity: Math.floor(Number(refundQty)) }], reason: "Admin quantity refund", idempotency_key: crypto.randomUUID() }),
    onSuccess: async (result) => { await refresh(); toast[result.recovery_pending ? "warning" : "success"](result.recovery_pending ? "Återbetalningen inväntar avstämning" : "Ekonomisk återbetalning registrerad"); },
    onError: (error: Error) => toast.error(humanError(error)),
  });
  const disposition = useMutation({
    mutationFn: () => {
      if (!allocation) throw new Error("Ingen lagerallokering finns för orderraden.");
      return apiPost("api-commerce", "physical-disposition", { venue_id: venueId, line_id: line.id, quantity: Math.floor(Number(returnQty)), outcome, refund_id: succeeded?.id || null, reason: ({ return_sellable: "Sellable return accepted by Admin", return_damaged: "Damaged return accepted by Admin", uncollected_present: "Refunded uncollected unit confirmed physically present", uncollected_missing: "Refunded uncollected unit confirmed physically missing" })[outcome], idempotency_key: crypto.randomUUID() });
    },
    onSuccess: async () => { await refresh(); toast.success("Fysisk disposition registrerad separat från återbetalningen"); },
    onError: (error: Error) => toast.error(humanError(error)),
  });
  if (line.inventory_policy !== "tracked") return null;
  return <div className="mt-3 grid gap-3 lg:grid-cols-2">
    <section className="rounded-xl p-3" style={{ background: ax("surface"), border: `1px solid ${ax("borderSoft")}` }}><h4 className="text-xs font-black text-white">Ekonomisk återbetalning</h4><p className="mt-1 text-[10px] leading-relaxed" style={{ color: ax("muted") }}>Återbetalar betalningen. Ändrar inte fysiskt lager, pickup-historik eller returstatus.</p><p className="mt-2 text-[10px]" style={{ color: ax("muted") }}>Återbetalningsbart: {refundable} · providerstatus: {relevantRefunds.map((item) => item.status).join(", ") || "ingen"}</p><div className="mt-2 flex gap-2"><input aria-label="Antal att återbetala" type="number" min="1" max={refundable} value={refundQty} onChange={(event) => setRefundQty(event.target.value)} className="w-20 rounded-lg border bg-transparent px-2 text-white" style={{ borderColor: ax("border") }} /><button type="button" disabled={refund.isPending || refundable < 1 || Number(refundQty) < 1 || Number(refundQty) > refundable} onClick={() => refund.mutate()} className="rounded-lg px-3 py-2 text-[10px] font-black disabled:opacity-40" style={{ background: ax("electric"), color: ax("ink") }}>Starta återbetalning</button></div></section>
    <section className="rounded-xl p-3" style={{ background: ax("surface"), border: `1px solid ${ax("borderSoft")}` }}><h4 className="text-xs font-black text-white">Fysisk retur / disposition</h4><p className="mt-1 text-[10px] leading-relaxed" style={{ color: ax("muted") }}>Registrerar vad som faktiskt hände med varan. Skapar ingen ekonomisk återbetalning automatiskt.</p><div className="mt-2 grid grid-cols-[90px_minmax(0,1fr)] gap-2"><input aria-label="Antal i fysisk disposition" type="number" min="1" value={returnQty} onChange={(event) => setReturnQty(event.target.value)} className="rounded-lg border bg-transparent px-2 text-white" style={{ borderColor: ax("border") }} /><select aria-label="Fysiskt utfall" value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)} className="rounded-lg border bg-transparent px-2 text-white" style={{ borderColor: ax("border") }}><option value="return_sellable">Returnerad, säljbar</option><option value="return_damaged">Returnerad, skadad</option><option value="uncollected_present">Ej uthämtad, finns</option><option value="uncollected_missing">Ej uthämtad, saknas</option></select></div><button type="button" disabled={disposition.isPending || !allocation || Number(returnQty) < 1} onClick={() => disposition.mutate()} className="mt-2 rounded-lg px-3 py-2 text-[10px] font-black disabled:opacity-40" style={{ border: `1px solid ${ax("magenta", 0.55)}`, color: ax("magenta") }}>Registrera fysisk sanning</button></section>
  </div>;
}

function OrdersWorkspace({ venueId, operations, refresh, productId, onLoadMore, loadingMore }: { venueId: string; operations: InventoryOperations; refresh: () => Promise<void>; productId?: string; onLoadMore?: () => void; loadingMore?: boolean }) {
  const [status, setStatus] = useState("all");
  const [fulfillment, setFulfillment] = useState("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [orderDetailId, setOrderDetailId] = useState<string | null>(null);
  const [customerTarget, setCustomerTarget] = useState<{ customerId?: string | null; userId?: string | null; commerceOrderId?: string | null } | null>(null);
  const normalizedSearch = search.trim();
  const usesCanonicalSearch = !productId && normalizedSearch.length > 0;
  const staffOrdersQuery = useQuery({
    queryKey: ["staff-commerce-orders", venueId, normalizedSearch],
    enabled: usesCanonicalSearch,
    queryFn: () => fetchStaffCommerceOrders(venueId, normalizedSearch),
  });
  const orders = useMemo(() => operations.orders.filter((order) => {
    if (productId && !order.lines.some((line) => line.product_id === productId)) return false;
    if (status !== "all" && order.status !== status) return false;
    if (fulfillment !== "all" && !order.lines.some((line) => line.fulfillment_status === fulfillment)) return false;
    if (usesCanonicalSearch) return true;
    const needle = normalizedSearch.toLocaleLowerCase("sv-SE");
    if (!needle) return true;
    return [order.id, order.guest_name, receiptFor(order)?.receipt_number, ...order.lines.flatMap((line) => [line.product_name, line.sku])]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase("sv-SE").includes(needle));
  }), [fulfillment, normalizedSearch, operations.orders, productId, status, usesCanonicalSearch]);
  const searchResults = useMemo(() => (staffOrdersQuery.data?.orders || []).filter((order: StaffCommerceOrderSummary) => {
    if (status !== "all" && order.order_status !== status) return false;
    if (fulfillment !== "all" && !order.products.some((line) => line.fulfillment_status === fulfillment)) return false;
    return true;
  }), [fulfillment, staffOrdersQuery.data?.orders, status]);
  const openCustomer = (target: { customerId?: string | null; userId?: string | null; commerceOrderId?: string | null }) => {
    setOrderDetailId(null);
    setCustomerTarget(target);
  };
  const openOrder = (orderId: string) => {
    setCustomerTarget(null);
    setOrderDetailId(orderId);
  };

  return <div className="space-y-4" data-testid="admin-commerce-orders">
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_180px]">
      <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: ax("muted") }} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Sök order, kvitto, kund, e-post eller SKU" className={`${INPUT} pl-9`} style={{ borderColor: ax("border"), background: ax("surfaceHi") }} /></div>
      <select aria-label="Orderstatus" value={status} onChange={(event) => setStatus(event.target.value)} className={INPUT} style={{ borderColor: ax("border"), background: ax("surfaceHi") }}><option value="all">Alla orderstatusar</option><option value="paid">Betald</option><option value="checkout_pending">Checkout pågår</option><option value="attention">Behöver åtgärd</option><option value="cancelled">Avbruten</option><option value="expired">Utgången</option></select>
      <select aria-label="Utlämningsstatus" value={fulfillment} onChange={(event) => setFulfillment(event.target.value)} className={INPUT} style={{ borderColor: ax("border"), background: ax("surfaceHi") }}><option value="all">Alla utlämningsstatusar</option><option value="pending_pickup">Väntar på uthämtning</option><option value="collected">Uthämtad</option><option value="attention">Behöver åtgärd</option><option value="not_collected">Ej uthämtad</option></select>
    </div>

    {usesCanonicalSearch ? staffOrdersQuery.isLoading ? <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin" style={{ color: ax("muted") }} /></div> : staffOrdersQuery.isError ? <EmptyState icon={AlertTriangle} title="Ordersökningen kunde inte genomföras" body="Ingen data ändrades. Försök igen." /> : searchResults.length ? <div className="space-y-2" data-testid="canonical-order-search-results">
      {searchResults.map((order) => <button key={order.order_id} type="button" onClick={() => openOrder(order.order_id)} className="grid w-full gap-3 rounded-2xl p-4 text-left sm:grid-cols-[minmax(0,1fr)_130px_130px_auto] sm:items-center" style={PANEL}>
        <span className="min-w-0"><span className="flex flex-wrap items-center gap-2"><span className="text-sm font-black text-white">{order.order_reference}</span><StatusChip tone={order.order_status === "paid" ? "lime" : order.order_status === "attention" ? "danger" : "neutral"}>{order.order_status.replaceAll("_", " ")}</StatusChip></span><span className="mt-1 block truncate text-[10px]" style={{ color: ax("muted") }}>{order.customer_name}{order.customer_email ? ` · ${order.customer_email}` : ""} · {order.identity_state === "guest" ? "Gäst" : "Kanonisk kund"}</span></span>
        <span className="text-xs text-white">{order.products.reduce((sum, line) => sum + line.quantity, 0)} beställt</span>
        <span className="text-xs text-white">{order.products.reduce((sum, line) => sum + line.remaining_quantity, 0)} återstår</span>
        <ChevronRight className="h-4 w-4" style={{ color: ax("muted") }} />
      </button>)}
    </div> : <EmptyState icon={Receipt} title="Inga orderträffar" body="Sökningen matchar orderreferens, kvitto, kanonisk kundidentitet, orderalias, e-post, produkt eller SKU inom vald venue." /> : orders.length ? orders.map((order) => {
      const receipt = receiptFor(order);
      const open = expanded === order.id;
      const tracked = order.lines.some((line) => line.inventory_policy === "tracked");
      return <article key={order.id} className="overflow-hidden rounded-2xl" style={PANEL}>
        <button type="button" onClick={() => setExpanded(open ? null : order.id)} className="grid w-full gap-3 p-4 text-left sm:grid-cols-[minmax(0,1fr)_130px_130px_auto] sm:items-center"><span><span className="flex flex-wrap items-center gap-2"><span className="text-sm font-black text-white">{receipt?.receipt_number || `Order ${order.id.slice(0, 8)}`}</span><StatusChip tone={order.status === "paid" ? "lime" : order.status === "attention" ? "danger" : order.status === "checkout_pending" ? "sun" : "neutral"}>{order.status.replaceAll("_", " ")}</StatusChip>{tracked ? <StatusChip tone="electric">Lagerspårad</StatusChip> : null}</span><span className="mt-1 block text-[10px]" style={{ color: ax("muted") }}>{order.guest_name || "Kund"} · {DateTime.fromISO(order.created_at).setZone("Europe/Stockholm").toFormat("yyyy-LL-dd HH:mm")}</span></span><span className="text-xs text-white">{order.lines.length} orderrad{order.lines.length === 1 ? "" : "er"}</span><span className="text-sm font-black text-white">{sekFromMinor(order.total_inc_vat_minor)}</span><ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} style={{ color: ax("muted") }} /></button>
        {open ? <div className="border-t p-4" style={{ borderColor: ax("borderSoft") }}>
          <div className="flex flex-wrap items-center justify-between gap-3"><div className="grid flex-1 gap-2 sm:grid-cols-3"><Metric label="Totalt inkl. moms" value={sekFromMinor(order.total_inc_vat_minor)} /><Metric label="Moms" value={sekFromMinor(order.vat_amount_minor)} /><Metric label="Betalning" value={receipt?.payment_status || order.status} /></div><button type="button" onClick={() => openOrder(order.id)} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-xs font-black" style={{ background: ax("electric"), color: ax("ink") }}>Öppna komplett order <ExternalLink className="h-3.5 w-3.5" /></button></div>
          <div className="mt-4 space-y-3">{order.lines.map((line) => <div key={line.id} className="rounded-xl p-3" style={{ background: ax("surface") }}><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-black text-white">{line.product_name} × {line.quantity}</p><p className="mt-0.5 font-mono text-[9px]" style={{ color: ax("muted") }}>{line.sku ? `SKU ${line.sku} · ` : ""}{String(line.variant_snapshot?.title || "")}</p></div><div className="text-right"><p className="text-xs font-black text-white">{sekFromMinor(line.line_total_inc_vat_minor)}</p><p className="text-[9px]" style={{ color: ax("muted") }}>{line.vat_rate}% moms · {line.fulfillment_status.replaceAll("_", " ")}</p></div></div>{line.fulfillment_type === "desk_pickup" && !["collected", "not_collected"].includes(line.fulfillment_status) ? <Link to="/desk" className="mt-2 inline-flex items-center gap-1 text-[10px] font-black" style={{ color: ax("electricSoft") }}>Hantera uthämtning i Desk <ExternalLink className="h-3 w-3" /></Link> : null}<RefundAndReturn venueId={venueId} order={order} line={line} operations={operations} refresh={refresh} /></div>)}</div>
          {operations.dispositions.some((item) => item.commerce_order_id === order.id) ? <div className="mt-3"><p className="font-mono text-[9px] font-black uppercase tracking-[0.15em]" style={{ color: ax("muted") }}>Fysisk historik</p>{operations.dispositions.filter((item) => item.commerce_order_id === order.id).map((item) => <p key={item.id} className="mt-1 text-[10px]" style={{ color: ax("muted") }}>{item.outcome.replaceAll("_", " ")} × {item.quantity} · {DateTime.fromISO(item.created_at).setZone("Europe/Stockholm").toFormat("yyyy-LL-dd HH:mm")}</p>)}</div> : null}
        </div> : null}
      </article>;
    }) : <EmptyState icon={Receipt} title="Inga ordrar matchar" body="Orderhistorik laddas från samma kanoniska order- och kvittosanning som kund och Desk använder." />}
    {!usesCanonicalSearch && operations.orders_page?.has_more && onLoadMore ? <button type="button" disabled={loadingMore} onClick={onLoadMore} className="w-full rounded-xl px-4 py-3 text-xs font-black disabled:opacity-40" style={{ border: `1px solid ${ax("border")}`, color: "white" }}>{loadingMore ? "Hämtar…" : "Ladda äldre ordrar"}</button> : null}
    <CommerceOrderDetailDrawer open={Boolean(orderDetailId)} onClose={() => setOrderDetailId(null)} venueId={venueId} orderId={orderDetailId} onOpenCustomer={openCustomer} />
    <Customer360Drawer open={Boolean(customerTarget)} onClose={() => setCustomerTarget(null)} venueId={venueId} customerId={customerTarget?.customerId} userId={customerTarget?.userId} commerceOrderId={customerTarget?.commerceOrderId} onOpenOrder={openOrder} />
  </div>;
}

function ProductWizard({ venueId, products, onCancel, onCreated }: { venueId: string; products: AdminCommerceProduct[]; onCancel: () => void; onCreated: (product: AdminCommerceProduct) => void }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft);
  const [pendingImages, setPendingImages] = useState<PendingProductImage[]>([]);
  const [matrixEdits, setMatrixEdits] = useState<Record<string, Pick<VariantMatrixRow, "sku" | "priceOverride">>>({});
  const colors = useMemo(() => draft.hasVariants ? splitValues(draft.colors) : ["Standard"], [draft.colors, draft.hasVariants]);
  const sizes = useMemo(() => draft.hasVariants ? splitValues(draft.sizes) : ["Standard"], [draft.sizes, draft.hasVariants]);
  const matrix = useMemo(() => buildVariantMatrix(draft.name, colors, sizes, matrixEdits), [draft.name, colors, sizes, matrixEdits]);
  const create = useMutation({
    mutationFn: async () => {
      if (!draft.name.trim()) throw new Error("Produktnamn krävs.");
      if (!Number.isFinite(Number(draft.price)) || Number(draft.price) < 0) throw new Error("Ange ett giltigt pris.");
      const baseKey = productKey(draft.name);
      const uniqueKey = products.some((product) => product.product_key === baseKey) ? `${baseKey}_${Date.now().toString(36)}` : baseKey;
      const tracked = draft.inventoryPolicy === "tracked";
      const saved = await apiPost<AdminCommerceProduct>("api-admin", "products", {
        venueId, product_key: uniqueKey, name: draft.name.trim(), description: draft.description.trim() || null,
        base_price_sek: Math.round(Number(draft.price)), vat_rate: Number(draft.vatRate), status: "draft",
        fulfillment_presentation: tracked ? "desk_pickup" : draft.fulfillment,
        category: draft.category.trim() || null, sport: draft.sport.trim() || null,
        image_url: null, commerce_kind: draft.commerceKind,
        inventory_policy: draft.inventoryPolicy, standalone_enabled: tracked ? true : draft.standaloneEnabled,
        activity_addon_enabled: tracked ? false : draft.activityAddonEnabled, sort_order: products.length * 10,
      });
      if (!tracked) {
        await uploadPendingProductMedia(venueId, saved.id, pendingImages);
        return saved;
      }
      let createdVariants = 0;
      try {
        const before = await apiGet<TrackedProductDetail>("api-admin", "product-variants", { venueId, productId: saved.id });
        const seller = relation(before.venue?.franchisees);
        if (!before.venue?.franchisee_id || !seller) throw new Error("Anläggningen saknar verifierad juridisk säljare.");
        const optionDefinitions = draft.hasVariants ? [
          { code: "color", label: "Färg", sort_order: 10, values: colors.map((value, index) => ({ code: normalizeCode(value), label: value, sort_order: index * 10 })) },
          { code: "size", label: "Storlek", sort_order: 20, values: sizes.map((value, index) => ({ code: normalizeCode(value), label: value, sort_order: index * 10 })) },
        ] : [{ code: "variant", label: "Variant", sort_order: 10, values: [{ code: "standard", label: "Standard", sort_order: 0 }] }];
        await apiPost("api-admin", "tracked-product-setup", { venueId, product_id: saved.id, seller_franchisee_id: before.venue.franchisee_id, location_name: draft.locationName.trim(), location_code: "retail", tracked_sales_enabled: false, options: optionDefinitions });
        const configured = await apiGet<TrackedProductDetail>("api-admin", "product-variants", { venueId, productId: saved.id });
        for (const row of matrix) {
          const optionValueIds = draft.hasVariants ? [
            configured.options.find((option) => option.code === "color")?.product_option_values.find((value) => value.code === normalizeCode(row.color))?.id,
            configured.options.find((option) => option.code === "size")?.product_option_values.find((value) => value.code === normalizeCode(row.size))?.id,
          ].filter(Boolean) : [configured.options[0]?.product_option_values[0]?.id].filter(Boolean);
          if (optionValueIds.length !== configured.options.length) throw new Error(`Alternativ saknas för ${row.color} / ${row.size}.`);
          await apiPost("api-admin", "product-variants", { venueId, product_id: saved.id, sku: row.sku.trim(), title: draft.hasVariants ? `${row.color} / ${row.size}` : "Standard", price_override_minor: row.priceOverride === "" ? null : Math.round(Number(row.priceOverride) * 100), option_value_ids: optionValueIds, status: "active" });
          createdVariants += 1;
        }
        await uploadPendingProductMedia(venueId, saved.id, pendingImages);
        return saved;
      } catch (error) {
        throw new Error(`Utkastet skapades säkert med försäljning avstängd, men variantkonfigurationen stannade efter ${createdVariants}/${matrix.length}: ${humanError(error as Error)}`);
      }
    },
    onSuccess: async (saved) => { await queryClient.invalidateQueries({ queryKey: ["admin-access-products", venueId] }); toast.success("Produktutkastet skapades. Spårad försäljning är fortfarande avstängd."); onCreated(saved); },
    onError: (error: Error) => { void queryClient.invalidateQueries({ queryKey: ["admin-access-products", venueId] }); toast.error(humanError(error), { duration: 8000 }); },
  });
  const canContinue = step === 1 || (step === 2 && draft.name.trim() && draft.price !== "") || (step === 3 && matrix.length > 0 && matrix.every((row) => row.sku.trim()));
  return <div className="space-y-4" data-testid="commerce-product-wizard"><div className="flex items-center gap-3"><button type="button" onClick={onCancel} className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: ax("surfaceHi"), color: "white" }} aria-label="Avbryt produkt"><ArrowLeft className="h-4 w-4" /></button><div><p className="font-mono text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: ax("magenta") }}>Ny produkt · steg {step} av 4</p><h2 className="font-display text-xl font-black text-white">{step === 1 ? "Välj produkttyp" : step === 2 ? "Produktinformation" : step === 3 ? "Varianter och SKU" : "Granska utkast"}</h2></div></div>
    <div className="grid grid-cols-4 gap-2">{[1, 2, 3, 4].map((value) => <span key={value} className="h-1 rounded-full" style={{ background: value <= step ? ax("electric") : ax("border") }} />)}</div>
    {step === 1 ? <div className="grid gap-3 sm:grid-cols-2">{([['merchandise', 'Fysisk vara', 'T-shirts, hoodies, kepsar och framtida tillbehör.'], ['rental', 'Uthyrning', 'Befintliga produkter som Hyr rack fortsätter utan lagersaldo.']] as const).map(([kind, title, body]) => <button key={kind} type="button" onClick={() => setDraft((current) => ({ ...current, commerceKind: kind, inventoryPolicy: kind === "rental" ? "stockless" : current.inventoryPolicy }))} className="rounded-2xl p-5 text-left" style={{ ...PANEL, borderColor: draft.commerceKind === kind ? ax("electric") : ax("borderSoft") }}><ShoppingBag className="h-5 w-5" style={{ color: kind === "merchandise" ? ax("magenta") : ax("electricSoft") }} /><h3 className="mt-3 text-base font-black text-white">{title}</h3><p className="mt-1 text-xs leading-relaxed" style={{ color: ax("muted") }}>{body}</p></button>)}</div> : null}
    {step === 1 && draft.commerceKind === "merchandise" ? <section className="rounded-2xl p-4" style={PANEL}><label className="flex items-center justify-between gap-4"><span><span className="block text-sm font-black text-white">Spåra lagersaldo per variant</span><span className="mt-1 block text-xs" style={{ color: ax("muted") }}>På hand, reserverat, allokerat och tillgängligt. R2A stödjer endast fristående shop + pickup.</span></span><Switch checked={draft.inventoryPolicy === "tracked"} onCheckedChange={(checked) => setDraft((current) => ({ ...current, inventoryPolicy: checked ? "tracked" : "stockless", activityAddonEnabled: checked ? false : current.activityAddonEnabled, standaloneEnabled: checked ? true : current.standaloneEnabled, fulfillment: checked ? "desk_pickup" : current.fulfillment }))} /></label></section> : null}
    {step === 2 ? <div className="space-y-4">
      <section className="rounded-2xl p-4" style={PANEL}><DraftProductMediaPicker images={pendingImages} onChange={setPendingImages} productName={draft.name} /></section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3 rounded-2xl p-4" style={PANEL}>
          <h3 className="text-sm font-black text-white">Produkt</h3>
          <Field label="Namn"><input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} className={INPUT} style={{ borderColor: ax("border") }} /></Field>
          <Field label="Beskrivning"><textarea rows={3} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} className={INPUT} style={{ borderColor: ax("border") }} /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Pris SEK"><input type="number" min="0" value={draft.price} onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))} className={INPUT} style={{ borderColor: ax("border") }} /></Field><Field label="Moms %"><input type="number" min="0" max="100" value={draft.vatRate} onChange={(event) => setDraft((current) => ({ ...current, vatRate: event.target.value }))} className={INPUT} style={{ borderColor: ax("border") }} /></Field></div>
        </section>
        <section className="space-y-4 rounded-2xl p-4" style={PANEL}>
          <h3 className="text-sm font-black text-white">Var säljs den?</h3>
          {draft.inventoryPolicy === "tracked" ? <><TrackedGate /><p className="text-xs" style={{ color: ax("muted") }}>Fristående shop · hämtas i receptionen · aktivitetstillval stöds inte för spårad vara i R2A.</p><Field label="Utlämningsplats"><input value={draft.locationName} onChange={(event) => setDraft((current) => ({ ...current, locationName: event.target.value }))} className={INPUT} style={{ borderColor: ax("border") }} /></Field></> : <><label className="flex items-center justify-between gap-4"><span><span className="block text-sm font-bold text-white">Fristående shop</span><span className="text-xs" style={{ color: ax("muted") }}>Kan köpas utan aktivitet.</span></span><Switch checked={draft.standaloneEnabled} onCheckedChange={(checked) => setDraft((current) => ({ ...current, standaloneEnabled: checked }))} /></label><label className="flex items-center justify-between gap-4"><span><span className="block text-sm font-bold text-white">Aktivitetstillval</span><span className="text-xs" style={{ color: ax("muted") }}>Relation väljs efter att produkten skapats.</span></span><Switch checked={draft.activityAddonEnabled} onCheckedChange={(checked) => setDraft((current) => ({ ...current, activityAddonEnabled: checked }))} /></label></>}
        </section>
      </div>
      <details className="rounded-2xl p-4" style={PANEL}><summary className="cursor-pointer text-sm font-black text-white">Avancerat</summary><p className="mt-1 text-xs" style={{ color: ax("muted") }}>Kategori, sport och ovanliga leveranssätt.</p><div className="mt-4 grid gap-3 sm:grid-cols-3"><Field label="Kategori"><input value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))} placeholder="Kläder" className={INPUT} style={{ borderColor: ax("border") }} /></Field><Field label="Sport"><input value={draft.sport} onChange={(event) => setDraft((current) => ({ ...current, sport: event.target.value }))} placeholder="Pickleball" className={INPUT} style={{ borderColor: ax("border") }} /></Field><Field label="Leverans"><select value={draft.fulfillment} disabled={draft.inventoryPolicy === "tracked"} onChange={(event) => setDraft((current) => ({ ...current, fulfillment: event.target.value as ProductDraft["fulfillment"] }))} className={INPUT} style={{ borderColor: ax("border") }}><option value="desk_pickup">Hämtas i receptionen</option><option value="digital">Digital</option><option value="participation">Deltagande</option></select></Field></div></details>
    </div> : null}
    {step === 3 ? draft.inventoryPolicy === "tracked" ? <div className="space-y-4"><section className="rounded-2xl p-4" style={PANEL}><label className="flex items-center justify-between gap-4"><span><span className="block text-sm font-black text-white">Produkten har färg-/storleksvarianter</span><span className="text-xs" style={{ color: ax("muted") }}>Om nej skapas en synlig kanonisk Standard-variant med unik SKU.</span></span><Switch checked={draft.hasVariants} onCheckedChange={(checked) => { setDraft((current) => ({ ...current, hasVariants: checked })); setMatrixEdits({}); }} /></label>{draft.hasVariants ? <div className="mt-4 grid gap-3 sm:grid-cols-2"><Field label="Färger" hint="kommatecken"><input value={draft.colors} onChange={(event) => { setDraft((current) => ({ ...current, colors: event.target.value })); setMatrixEdits({}); }} className={INPUT} style={{ borderColor: ax("border") }} /></Field><Field label="Storlekar" hint="kommatecken"><input value={draft.sizes} onChange={(event) => { setDraft((current) => ({ ...current, sizes: event.target.value })); setMatrixEdits({}); }} className={INPUT} style={{ borderColor: ax("border") }} /></Field></div> : null}</section><section className="overflow-hidden rounded-2xl" style={PANEL}><div className="border-b px-4 py-3" style={{ borderColor: ax("borderSoft") }}><h3 className="text-sm font-black text-white">Genererad variantmatris · {matrix.length}</h3><p className="mt-1 text-xs" style={{ color: ax("muted") }}>SKU-förslag är redigerbara. Tomt variantpris ärver {sek(Number(draft.price))}.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead><tr style={{ color: ax("muted") }}><th className="p-3">Färg</th><th className="p-3">Storlek</th><th className="p-3">SKU</th><th className="p-3">Prisoverride SEK</th></tr></thead><tbody>{matrix.map((row) => <tr key={row.key} className="border-t" style={{ borderColor: ax("borderSoft") }}><td className="p-3 text-white">{row.color}</td><td className="p-3 text-white">{row.size}</td><td className="p-3"><input aria-label={`SKU ${row.color} ${row.size}`} value={row.sku} onChange={(event) => setMatrixEdits((current) => ({ ...current, [row.key]: { sku: event.target.value, priceOverride: current[row.key]?.priceOverride || row.priceOverride } }))} className="w-full rounded-lg border bg-transparent px-2 py-2 font-mono text-[10px] text-white" style={{ borderColor: ax("border") }} /></td><td className="p-3"><input aria-label={`Pris ${row.color} ${row.size}`} type="number" min="0" step="0.01" value={row.priceOverride} onChange={(event) => setMatrixEdits((current) => ({ ...current, [row.key]: { sku: current[row.key]?.sku || row.sku, priceOverride: event.target.value } }))} placeholder="Ärver" className="w-28 rounded-lg border bg-transparent px-2 py-2 text-white" style={{ borderColor: ax("border") }} /></td></tr>)}</tbody></table></div></section></div> : <EmptyState icon={Boxes} title="Ingen variantkonfiguration krävs" body="Stockless-produkten använder befintlig Commerce-semantik utan lagersaldo." /> : null}
    {step === 4 ? <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]"><section className="rounded-2xl p-5" style={PANEL}><div className="flex items-start gap-4"><span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl" style={{ background: ax("surface") }}>{pendingImages[0] ? <img src={pendingImages[0].preview} alt={pendingImages[0].altText} className="h-full w-full object-cover" /> : <ShoppingBag className="h-5 w-5" style={{ color: ax("muted") }} />}</span><div><h3 className="text-lg font-black text-white">{draft.name}</h3><p className="mt-1 text-xs" style={{ color: ax("muted") }}>{draft.description || "Ingen beskrivning"}</p><div className="mt-3 flex flex-wrap gap-2"><StatusChip tone="sun">Utkast</StatusChip><StatusChip tone={draft.inventoryPolicy === "tracked" ? "electric" : "neutral"}>{draft.inventoryPolicy === "tracked" ? `${matrix.length} lagerspårade varianter` : "Utan lagersaldo"}</StatusChip>{pendingImages.length ? <StatusChip tone="electric">{pendingImages.length} bilder</StatusChip> : null}</div></div></div><div className="mt-5 grid grid-cols-2 gap-2"><Metric label="Baspris" value={sek(Number(draft.price))} /><Metric label="Moms" value={`${draft.vatRate}%`} /><Metric label="Kanal" value={draft.inventoryPolicy === "tracked" || draft.standaloneEnabled ? "Fristående shop" : draft.activityAddonEnabled ? "Aktivitet" : "Ej till salu"} /><Metric label="Leverans" value={draft.inventoryPolicy === "tracked" || draft.fulfillment === "desk_pickup" ? "Hämtas i receptionen" : draft.fulfillment} /></div></section><aside className="space-y-3"><TrackedGate /><button type="button" onClick={() => create.mutate()} disabled={create.isPending} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-black" style={{ background: `linear-gradient(135deg, ${ax("electric")}, ${ax("magenta")})`, color: "white" }}>{create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Skapa säkert utkast</button><p className="text-center text-[10px]" style={{ color: ax("muted") }}>Bilderna laddas upp först när utkastet skapas. Ingen spårad försäljning aktiveras.</p></aside></div> : null}
    <div className="sticky bottom-2 z-10 flex items-center justify-between rounded-2xl p-2 backdrop-blur-xl" style={{ background: ax("surface", 0.92), border: `1px solid ${ax("border")}` }}><button type="button" onClick={() => step === 1 ? onCancel() : setStep((value) => value - 1)} className="min-h-11 rounded-xl px-4 py-2.5 text-xs font-black" style={{ border: `1px solid ${ax("border")}`, color: ax("muted") }}>{step === 1 ? "Avbryt" : "Tillbaka"}</button>{step < 4 ? <button type="button" disabled={!canContinue} onClick={() => setStep((value) => value + 1)} className="min-h-11 rounded-xl px-5 py-2.5 text-xs font-black disabled:opacity-40" style={{ background: ax("electric"), color: ax("ink") }}>Fortsätt</button> : null}</div>
  </div>;
}

function ProductDetail({ venueId, product, products, relationships, operations, onBack, refreshAll, onLoadMoreOrders, ordersLoadingMore, onLoadMoreMovements, movementsLoadingMore }: { venueId: string; product: AdminCommerceProduct; products: AdminCommerceProduct[]; relationships: ProductRelationship[]; operations?: InventoryOperations; onBack: () => void; refreshAll: () => Promise<void>; onLoadMoreOrders?: () => void; ordersLoadingMore?: boolean; onLoadMoreMovements?: () => void; movementsLoadingMore?: boolean }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ProductDetailTab>("overview");
  const [draft, setDraft] = useState(() => draftFromProduct(product));
  const trackedQuery = useQuery<TrackedProductDetail>({ queryKey: ["admin-product-variants", venueId, product.id], queryFn: () => apiGet("api-admin", "product-variants", { venueId, productId: product.id }), enabled: product.inventory_policy === "tracked" });
  const refresh = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["admin-product-variants", venueId, product.id] }), refreshAll()]); };
  const save = useMutation({
    mutationFn: () => apiPatch<AdminCommerceProduct>("api-admin", "products", { venueId, productId: product.id, name: draft.name.trim(), description: draft.description.trim() || null, base_price_sek: Math.round(Number(draft.price)), vat_rate: Number(draft.vatRate), status: draft.status, fulfillment_presentation: product.inventory_policy === "tracked" ? "desk_pickup" : draft.fulfillment, category: draft.category.trim() || null, sport: draft.sport.trim() || null, commerce_kind: draft.commerceKind, inventory_policy: product.inventory_policy, standalone_enabled: product.inventory_policy === "tracked" ? true : draft.standaloneEnabled, activity_addon_enabled: product.inventory_policy === "tracked" ? false : draft.activityAddonEnabled }),
    onSuccess: async () => { await refresh(); toast.success("Produkten sparades i kanonisk Commerce"); },
    onError: (error: Error) => toast.error(humanError(error)),
  });
  const relationMutation = useMutation({
    mutationFn: ({ sourceId, targetId, relationshipId }: { sourceId: string; targetId: string; relationshipId?: string }) => relationshipId ? apiDelete("api-admin", "product-relationships", { venueId, relationshipId }) : apiPost("api-admin", "product-relationships", { venueId, source_product_id: sourceId, target_product_id: targetId, is_active: true, sort_order: 0 }),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(humanError(error)),
  });
  const tabs: Array<{ id: ProductDetailTab; label: string }> = [{ id: "overview", label: "Översikt" }, ...(product.inventory_policy === "tracked" ? [{ id: "variants" as const, label: "Varianter" }, { id: "inventory" as const, label: "Lager" }] : []), { id: "sales", label: "Försäljning" }, { id: "orders", label: "Ordrar" }];
  const detail = trackedQuery.data;
  return <div className="space-y-4" data-testid="commerce-product-detail"><div className="flex items-center gap-3"><button type="button" onClick={onBack} className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: ax("surfaceHi"), color: "white" }} aria-label="Tillbaka till produkter"><ArrowLeft className="h-4 w-4" /></button><div className="min-w-0 flex-1"><p className="font-mono text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: ax("magenta") }}>Commerce · Produkt</p><h2 className="truncate font-display text-xl font-black text-white">{product.name}</h2></div>{product.status !== "archived" ? <button type="button" onClick={() => { setDraft((current) => ({ ...current, status: current.status === "active" ? "draft" : "active" })); }} className="rounded-xl px-3 py-2 text-[10px] font-black" style={{ border: `1px solid ${ax("border")}`, color: draft.status === "active" ? ax("sun") : ax("lime") }}>{draft.status === "active" ? "Flytta till utkast" : "Publicera katalogstatus"}</button> : null}</div>
    <div className="flex gap-2 overflow-x-auto pb-1" role="tablist">{tabs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} className="shrink-0 rounded-xl px-3 py-2 text-xs font-black" style={{ background: tab === item.id ? ax("electric", 0.2) : ax("surfaceHi"), border: `1px solid ${tab === item.id ? ax("electric", 0.6) : ax("borderSoft")}`, color: tab === item.id ? "white" : ax("muted") }}>{item.label}</button>)}</div>
    {product.inventory_policy === "tracked" && trackedQuery.isLoading ? <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin" style={{ color: ax("muted") }} /></div> : null}
    {tab === "overview" ? <ProductMediaEditor venueId={venueId} productId={product.id} productName={draft.name || product.name} media={product.media || []} onChanged={refresh} /> : null}
    {tab === "overview" ? <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_330px]"><section className="space-y-3 rounded-2xl p-4" style={PANEL}><h3 className="text-sm font-black text-white">Produktinformation</h3><Field label="Namn"><input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} className={INPUT} style={{ borderColor: ax("border") }} /></Field><Field label="Beskrivning"><textarea rows={4} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} className={INPUT} style={{ borderColor: ax("border") }} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Baspris SEK"><input type="number" min="0" value={draft.price} onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))} className={INPUT} style={{ borderColor: ax("border") }} /></Field><Field label="Moms %"><input type="number" min="0" max="100" value={draft.vatRate} onChange={(event) => setDraft((current) => ({ ...current, vatRate: event.target.value }))} className={INPUT} style={{ borderColor: ax("border") }} /></Field></div><div className="grid grid-cols-2 gap-3"><Field label="Kategori"><input value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))} className={INPUT} style={{ borderColor: ax("border") }} /></Field><Field label="Sport"><input value={draft.sport} onChange={(event) => setDraft((current) => ({ ...current, sport: event.target.value }))} className={INPUT} style={{ borderColor: ax("border") }} /></Field></div><Field label="Produktstatus"><select aria-label="Produktstatus" value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as ProductCatalogStatus }))} className={INPUT} style={{ borderColor: ax("border") }}><option value="draft">Utkast</option><option value="active">Aktiv</option><option value="archived">Arkiverad</option></select></Field><button type="button" aria-label="Spara" onClick={() => save.mutate()} disabled={save.isPending || !draft.name.trim()} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-xs font-black" style={{ background: ax("electric"), color: ax("ink") }}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Spara ändringar</button></section><aside className="space-y-3"><section className="rounded-2xl p-4" style={PANEL}><h3 className="text-sm font-black text-white">Tillstånd</h3><div className="mt-3 flex flex-wrap gap-2"><StatusChip tone={product.status === "active" ? "lime" : product.status === "draft" ? "sun" : "neutral"}>{product.status}</StatusChip><StatusChip tone={product.inventory_policy === "tracked" ? "electric" : "neutral"}>{product.inventory_policy === "tracked" ? "Lagerspårad" : "Utan lagersaldo"}</StatusChip></div><p className="mt-3 text-xs leading-relaxed" style={{ color: ax("muted") }}>{product.sales_block_reason || product.sales_state_label}</p>{product.store_eligible && product.store_path ? <Link to={product.store_path} className="mt-3 inline-flex items-center gap-1 text-xs font-black" style={{ color: ax("electricSoft") }}>Visa i kundshop <ExternalLink className="h-3 w-3" /></Link> : null}</section>{product.inventory_policy === "tracked" ? <TrackedGate detail={detail} /> : null}<section className="rounded-2xl p-4" style={PANEL}><h3 className="text-sm font-black text-white">Livscykel</h3><p className="mt-1 text-xs" style={{ color: ax("muted") }}>Arkivering bevarar historiska order-, kvitto- och lagerreferenser.</p><button type="button" onClick={() => setDraft((current) => ({ ...current, status: current.status === "archived" ? "draft" : "archived" }))} className="mt-3 inline-flex items-center gap-2 text-xs font-black" style={{ color: product.status === "archived" ? ax("lime") : ax("danger") }}>{product.status === "archived" ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}{product.status === "archived" ? "Återställ som utkast" : "Arkivera vid nästa sparning"}</button></section></aside></div> : null}
    {tab === "variants" && detail ? detail.listing ? <VariantWorkspace venueId={venueId} product={product} detail={detail} refresh={refresh} /> : <TrackedSetupRecovery venueId={venueId} product={product} detail={detail} refresh={refresh} /> : null}
    {tab === "inventory" && detail ? detail.listing ? <InventoryWorkspace venueId={venueId} product={product} detail={detail} operations={operations} refresh={refresh} onLoadMore={onLoadMoreMovements} loadingMore={movementsLoadingMore} /> : <TrackedSetupRecovery venueId={venueId} product={product} detail={detail} refresh={refresh} /> : null}
    {tab === "sales" ? <div className="grid gap-4 lg:grid-cols-2"><section className="space-y-4 rounded-2xl p-4" style={PANEL}><h3 className="text-sm font-black text-white">Försäljningssätt</h3>{product.inventory_policy === "tracked" ? <><TrackedGate detail={detail} /><p className="text-xs" style={{ color: ax("muted") }}>Fristående shop och pickup i receptionen är R2A-kontraktet. Spårat aktivitetstillval avvisas uttryckligen.</p></> : <><label className="flex items-center justify-between gap-4"><span><span className="block text-sm font-bold text-white">Fristående shop</span><span className="text-xs" style={{ color: ax("muted") }}>Köp utan aktivitet.</span></span><Switch checked={draft.standaloneEnabled} onCheckedChange={(checked) => setDraft((current) => ({ ...current, standaloneEnabled: checked }))} /></label><label className="flex items-center justify-between gap-4"><span><span className="block text-sm font-bold text-white">Aktivitetstillval</span><span className="text-xs" style={{ color: ax("muted") }}>Stockless endast.</span></span><Switch checked={draft.activityAddonEnabled} onCheckedChange={(checked) => setDraft((current) => ({ ...current, activityAddonEnabled: checked }))} /></label><button type="button" onClick={() => save.mutate()} className="rounded-xl px-4 py-2.5 text-xs font-black" style={{ background: ax("electric"), color: ax("ink") }}>Spara försäljning</button></>}</section><RelationshipEditor product={{ ...product, activity_addon_enabled: draft.activityAddonEnabled }} products={products} relationships={relationships} onToggle={(sourceId, targetId, relationshipId) => relationMutation.mutate({ sourceId, targetId, relationshipId })} pending={relationMutation.isPending} /></div> : null}
    {tab === "orders" && operations ? <OrdersWorkspace venueId={venueId} operations={operations} refresh={refresh} productId={product.id} onLoadMore={onLoadMoreOrders} loadingMore={ordersLoadingMore} /> : null}
  </div>;
}

export default function AdminCommerceWorkspace({ venueId, initialSection = "products", onBack }: { venueId: string; initialSection?: CommerceSection; onBack?: () => void }) {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const handledProductDeepLink = useRef<string | null>(null);
  const [section, setSection] = useState<CommerceSection>(initialSection);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => setSection(initialSection), [initialSection]);
  const productsQuery = useQuery<AdminCommerceProduct[]>({ queryKey: ["admin-access-products", venueId], queryFn: () => apiGet("api-admin", "products", { venueId }) });
  const relationshipsQuery = useQuery<ProductRelationship[]>({ queryKey: ["admin-product-relationships", venueId], queryFn: () => apiGet("api-admin", "product-relationships", { venueId }) });
  const needsOperations = section !== "products" || Boolean(selectedProductId);
  const operationsQuery = useQuery<InventoryOperations>({ queryKey: ["commerce-inventory-operations", venueId], queryFn: () => apiGet("api-commerce", "inventory-operations", { venueId, orderLimit: 50, movementLimit: 50 }), enabled: needsOperations });
  const loadMoreOrders = useMutation({
    mutationFn: () => apiGet<InventoryOperations>("api-commerce", "inventory-operations", { venueId, orderLimit: 50, movementLimit: 1, orderBefore: operationsQuery.data?.orders_page?.next_before || "" }),
    onSuccess: (page) => queryClient.setQueryData<InventoryOperations>(["commerce-inventory-operations", venueId], (current) => current ? {
      ...current,
      orders: [...current.orders, ...page.orders.filter((order) => !current.orders.some((existing) => existing.id === order.id))],
      orders_page: page.orders_page,
    } : page),
    onError: (error: Error) => toast.error(humanError(error)),
  });
  const loadMoreMovements = useMutation({
    mutationFn: () => apiGet<InventoryOperations>("api-commerce", "inventory-operations", { venueId, orderLimit: 1, movementLimit: 50, movementBefore: operationsQuery.data?.movements_page?.next_before || "" }),
    onSuccess: (page) => queryClient.setQueryData<InventoryOperations>(["commerce-inventory-operations", venueId], (current) => current ? {
      ...current,
      movements: [...current.movements, ...page.movements.filter((movement) => !current.movements.some((existing) => existing.id === movement.id))],
      movements_page: page.movements_page,
    } : page),
    onError: (error: Error) => toast.error(humanError(error)),
  });
  const products = useMemo(() => productsQuery.data || [], [productsQuery.data]);
  const selected = products.find((product) => product.id === selectedProductId) || null;
  const linkedProductId = searchParams.get("productId");
  useEffect(() => {
    if (!linkedProductId || handledProductDeepLink.current === linkedProductId || products.length === 0) return;
    if (!products.some((product) => product.id === linkedProductId)) return;
    handledProductDeepLink.current = linkedProductId;
    setSection("products");
    setCreating(false);
    setSelectedProductId(linkedProductId);
  }, [linkedProductId, products]);
  const refreshAll = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["admin-access-products", venueId] }), queryClient.invalidateQueries({ queryKey: ["admin-product-relationships", venueId] }), queryClient.invalidateQueries({ queryKey: ["commerce-inventory-operations", venueId] }), queryClient.invalidateQueries({ queryKey: ["commerce-catalog", venueId] })]); };
  const openSection = (next: CommerceSection) => { setSection(next); setSelectedProductId(null); setCreating(false); };
  if (productsQuery.isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin" style={{ color: ax("muted") }} /></div>;
  if (productsQuery.isError) return <EmptyState icon={AlertTriangle} title="Commerce kunde inte hämtas" body="Kontrollera behörighet och försök igen. Ingen ändring har gjorts." action={<button type="button" onClick={() => void productsQuery.refetch()} className="rounded-xl px-4 py-2 text-xs font-black" style={{ background: ax("electric"), color: ax("ink") }}>Försök igen</button>} />;
  return <div className="space-y-5" data-testid="admin-commerce-workspace">
    {!selected && !creating ? <div className="relative overflow-hidden rounded-3xl p-5" style={{ background: `linear-gradient(135deg, ${ax("surface")}, ${ax("electric", 0.12)}, ${ax("magenta", 0.08)})`, border: `1px solid ${ax("border")}` }}><div className="absolute inset-0 opacity-30" style={AX_GRID_BG} /><div className="relative flex items-start gap-3">{onBack ? <button type="button" onClick={onBack} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: ax("surfaceHi"), color: "white" }} aria-label="Tillbaka till Catalog"><ArrowLeft className="h-4 w-4" /></button> : null}<div><p className="font-mono text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: ax("electricSoft") }}>Admin OS · Commerce</p><h1 className="mt-1 font-display text-2xl font-black text-white">En produkt- och ordersanning</h1><p className="mt-1 max-w-xl text-xs leading-relaxed" style={{ color: ax("muted") }}>Produkter, lager och ordrar ovanpå samma kanoniska Commerce som kundshop, Stripe, kvitton och Desk.</p></div></div></div> : null}
    {!selected && !creating ? <CommerceNav section={section} onChange={openSection} /> : null}
    {creating ? <ProductWizard venueId={venueId} products={products} onCancel={() => setCreating(false)} onCreated={(product) => { setCreating(false); setSelectedProductId(product.id); }} /> : selected ? <ProductDetail venueId={venueId} product={selected} products={products} relationships={relationshipsQuery.data || []} operations={operationsQuery.data} onBack={() => setSelectedProductId(null)} refreshAll={refreshAll} onLoadMoreOrders={() => loadMoreOrders.mutate()} ordersLoadingMore={loadMoreOrders.isPending} onLoadMoreMovements={() => loadMoreMovements.mutate()} movementsLoadingMore={loadMoreMovements.isPending} /> : section === "products" ? <ProductList products={products} onOpen={(product) => setSelectedProductId(product.id)} onCreate={() => setCreating(true)} /> : operationsQuery.isLoading ? <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin" style={{ color: ax("muted") }} /></div> : operationsQuery.isError || !operationsQuery.data ? <EmptyState icon={AlertTriangle} title="Operationsdata kunde inte hämtas" body="Ingen mutation har gjorts. Uppdatera och försök igen." /> : section === "orders" ? <><div><p className="font-mono text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: ax("magenta") }}>Commerce · Ordrar</p><h2 className="mt-1 font-display text-2xl font-black text-white">Orderhistorik och efterköp</h2><p className="mt-1 text-xs" style={{ color: ax("muted") }}>Betalning, kvitto, uthämtning, återbetalning och fysisk retur utan sammanblandning.</p></div><OrdersWorkspace venueId={venueId} operations={operationsQuery.data} refresh={refreshAll} onLoadMore={() => loadMoreOrders.mutate()} loadingMore={loadMoreOrders.isPending} /></> : <><div className="flex items-start justify-between gap-4"><div><p className="font-mono text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: ax("magenta") }}>Commerce · Lager</p><h2 className="mt-1 font-display text-2xl font-black text-white">Lageröversikt</h2><p className="mt-1 text-xs" style={{ color: ax("muted") }}>Öppna en produkt för mottagning, fysisk räkning och komplett rörelsehistorik.</p></div><button type="button" onClick={() => void operationsQuery.refetch()} className="grid h-10 w-10 place-items-center rounded-xl" style={{ ...PANEL, color: "white" }} aria-label="Uppdatera lager"><RefreshCw className="h-4 w-4" /></button></div><div className="grid grid-cols-2 gap-2 lg:grid-cols-4"><Metric label="Fysiskt på hand" value={operationsQuery.data.levels.reduce((sum, level) => sum + Number(level.on_hand), 0)} /><Metric label="Reserverat" value={operationsQuery.data.levels.reduce((sum, level) => sum + Number(level.reserved), 0)} /><Metric label="Allokerat" value={operationsQuery.data.levels.reduce((sum, level) => sum + Number(level.allocated), 0)} /><Metric label="Tillgängligt" value={operationsQuery.data.levels.reduce((sum, level) => sum + Number(level.available_to_sell), 0)} attention={operationsQuery.data.levels.some((level) => level.incident_blocked)} /></div><div className="space-y-2">{products.filter((product) => product.inventory_policy === "tracked").length ? products.filter((product) => product.inventory_policy === "tracked").map((product) => <button key={product.id} type="button" onClick={() => setSelectedProductId(product.id)} className="grid w-full gap-3 rounded-2xl p-4 text-left sm:grid-cols-[minmax(0,1fr)_repeat(4,90px)_auto] sm:items-center" style={PANEL}><span><span className="block text-sm font-black text-white">{product.name}</span><span className="text-[10px]" style={{ color: ax("muted") }}>{product.variant_count || 0} varianter · {product.listing?.location_name || "Ej konfigurerad"}</span></span><span className="text-xs text-white"><span className="block font-mono text-[8px]" style={{ color: ax("muted") }}>PÅ HAND</span>{product.inventory_summary?.on_hand || 0}</span><span className="text-xs text-white"><span className="block font-mono text-[8px]" style={{ color: ax("muted") }}>RESERVERAT</span>{product.inventory_summary?.reserved || 0}</span><span className="text-xs text-white"><span className="block font-mono text-[8px]" style={{ color: ax("muted") }}>ALLOKERAT</span>{product.inventory_summary?.allocated || 0}</span><span className="text-xs font-black" style={{ color: Number(product.inventory_summary?.available_to_sell || 0) <= 0 ? ax("sun") : ax("lime") }}><span className="block font-mono text-[8px]" style={{ color: ax("muted") }}>TILLGÄNGLIGT</span>{product.inventory_summary?.available_to_sell || 0}</span><ChevronRight className="h-4 w-4" style={{ color: ax("muted") }} /></button>) : <EmptyState icon={Boxes} title="Inga lagerspårade produkter" body="Skapa en fysisk vara och välj lagerspårning. Befintliga stockless-produkter ändras inte." action={<button type="button" onClick={() => { setSection("products"); setCreating(true); }} className="rounded-xl px-4 py-2 text-xs font-black" style={{ background: ax("electric"), color: ax("ink") }}>Skapa produkt</button>} />}</div>{operationsQuery.data.incidents.some((incident) => incident.status === "open") ? <div className="rounded-2xl p-4" style={{ background: ax("danger", 0.07), border: `1px solid ${ax("danger", 0.4)}` }}><p className="text-sm font-black" style={{ color: ax("danger") }}>{operationsQuery.data.incidents.filter((incident) => incident.status === "open").length} öppna lagerincidenter</p><p className="mt-1 text-xs" style={{ color: ax("muted") }}>Öppna berörd produkt och Lager för korrigering och verifierad stängning.</p></div> : null}</>}
  </div>;
}
