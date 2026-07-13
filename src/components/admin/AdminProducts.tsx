import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ChevronLeft, ChevronRight, ExternalLink, Image as ImageIcon, Loader2, Package, Plus, RotateCcw, Search, Save, X } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import {
  filterAndSortProducts,
  productSalesModeLabel,
  ProductCatalogFilters,
  ProductCatalogStatus,
} from "@/lib/adminProductCatalog";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Switch } from "@/components/ui/switch";

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
  status: ProductCatalogStatus;
  standalone_enabled: boolean;
  activity_addon_enabled: boolean;
  fulfillment_presentation: "desk_pickup" | "digital" | "participation" | null;
  category: string | null;
  sport: string | null;
  image_url: string | null;
  venue_commerce_enabled?: boolean;
  store_eligible?: boolean;
  activity_addon_eligible?: boolean;
  sales_state_label?: string;
  sales_block_reason?: string | null;
  store_path?: string | null;
}

interface ProductRelationship {
  id: string;
  source_product_id: string;
  target_product_id: string;
  is_active: boolean;
}

interface ProductDraft {
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
  imageUrl: string;
}

const PAGE_SIZE = 50;
const inputClass = "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary";

const emptyDraft = (): ProductDraft => ({
  name: "",
  description: "",
  price: "",
  vatRate: "25",
  status: "draft",
  standaloneEnabled: false,
  activityAddonEnabled: false,
  fulfillment: "desk_pickup",
  category: "",
  sport: "",
  imageUrl: "",
});

const draftFromProduct = (product: AccessProduct): ProductDraft => ({
  name: product.name,
  description: product.description || "",
  price: String(product.base_price_sek ?? 0),
  vatRate: String(product.vat_rate ?? 0),
  status: product.status || (product.is_active ? "active" : "archived"),
  standaloneEnabled: Boolean(product.standalone_enabled),
  activityAddonEnabled: Boolean(product.activity_addon_enabled),
  fulfillment: product.fulfillment_presentation || (product.fulfillment_type === "participation" ? "participation" : "desk_pickup"),
  category: product.category || "",
  sport: product.sport || "",
  imageUrl: product.image_url || "",
});

const keyFromName = (name: string) => name.trim().toLowerCase()
  .replace(/å/g, "a").replace(/ä/g, "a").replace(/ö/g, "o")
  .replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

const formatPrice = (amount: number) => `${Math.round(Number(amount || 0)).toLocaleString("sv-SE")} kr`;
const statusLabel = (status: ProductCatalogStatus) => status === "active" ? "Aktiv" : status === "archived" ? "Arkiverad" : "Utkast";
const fulfillmentLabel = (value: AccessProduct["fulfillment_presentation"]) => value === "participation" ? "Deltagande" : value === "digital" ? "Digital" : "Hämtas vid disken";

function RelationshipSelector({
  product,
  products,
  relationships,
  onToggle,
  pending,
}: {
  product: AccessProduct;
  products: AccessProduct[];
  relationships: ProductRelationship[];
  onToggle: (sourceId: string, targetId: string, relationshipId?: string) => void;
  pending: boolean;
}) {
  const [search, setSearch] = useState("");
  const productIsParticipation = product.commerce_kind === "participation";
  const candidates = products.filter((candidate) => productIsParticipation
    ? candidate.id !== product.id && candidate.activity_addon_enabled
    : candidate.commerce_kind === "participation");
  const rows = candidates.map((candidate) => {
    const sourceId = productIsParticipation ? product.id : candidate.id;
    const targetId = productIsParticipation ? candidate.id : product.id;
    const relationship = relationships.find((item) => item.source_product_id === sourceId && item.target_product_id === targetId && item.is_active);
    return { candidate, sourceId, targetId, relationship };
  }).filter(({ candidate }) => !search.trim() || candidate.name.toLocaleLowerCase("sv-SE").includes(search.trim().toLocaleLowerCase("sv-SE")))
    .sort((left, right) => Number(Boolean(right.relationship)) - Number(Boolean(left.relationship)) || left.candidate.name.localeCompare(right.candidate.name, "sv-SE"));

  if (!productIsParticipation && !product.activity_addon_enabled) return null;

  return (
    <section className="border-t border-border px-4 py-5">
      <h3 className="text-sm font-bold">{productIsParticipation ? "Produkter som kan läggas till" : "Kan köpas tillsammans med"}</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        {productIsParticipation ? `Gäller alla pass som använder produkten ${product.name}.` : "Välj vilka aktivitetsprodukter som får erbjuda den här produkten."}
      </p>
      <div className="relative mt-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Sök aktivitet eller produkt" className={`${inputClass} pl-9`} />
      </div>
      <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-border">
        {rows.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">Inga matchande produkter.</p>
        ) : rows.map(({ candidate, sourceId, targetId, relationship }) => (
          <label key={candidate.id} className="flex cursor-pointer items-center justify-between gap-3 border-b border-border px-3 py-3 last:border-0">
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{candidate.name}</span>
              <span className="text-xs text-muted-foreground">{formatPrice(candidate.base_price_sek)}</span>
            </span>
            <input
              type="checkbox"
              checked={Boolean(relationship)}
              disabled={pending}
              onChange={() => onToggle(sourceId, targetId, relationship?.id)}
              className="h-5 w-5 accent-primary"
            />
          </label>
        ))}
      </div>
    </section>
  );
}

export default function AdminProducts({ venueId }: { venueId: string }) {
  const queryClient = useQueryClient();
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<ProductCatalogFilters>({ search: "", status: "all", salesMode: "all", category: "", sport: "", sort: "name" });

  const productsQuery = useQuery<AccessProduct[]>({
    queryKey: ["admin-access-products", venueId],
    queryFn: () => apiGet("api-admin", "products", { venueId }),
  });
  const relationshipsQuery = useQuery<ProductRelationship[]>({
    queryKey: ["admin-product-relationships", venueId],
    queryFn: () => apiGet("api-admin", "product-relationships", { venueId }),
  });
  const products = useMemo(() => productsQuery.data || [], [productsQuery.data]);
  const relationships = useMemo(() => relationshipsQuery.data || [], [relationshipsQuery.data]);
  const selectedProduct = products.find((product) => product.id === selectedProductId) || null;

  useEffect(() => setPage(1), [filters]);

  const invalidateCatalog = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["admin-access-products", venueId] }),
    queryClient.invalidateQueries({ queryKey: ["commerce-catalog", venueId] }),
  ]);

  const saveProduct = useMutation({
    mutationFn: async () => {
      if (!draft.name.trim()) throw new Error("Namn krävs");
      const body: Record<string, unknown> = {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        base_price_sek: Math.max(0, Math.round(Number(draft.price || 0))),
        vat_rate: Math.max(0, Number(draft.vatRate || 0)),
        status: draft.status,
        fulfillment_presentation: draft.fulfillment,
        category: draft.category.trim() || null,
        sport: draft.sport.trim() || null,
        image_url: draft.imageUrl.trim() || null,
      };
      if (selectedProduct?.commerce_kind !== "participation") {
        body.standalone_enabled = draft.standaloneEnabled;
        body.activity_addon_enabled = draft.activityAddonEnabled;
      }
      let saved: AccessProduct;
      if (selectedProduct) {
        saved = await apiPatch<AccessProduct>("api-admin", "products", { venueId, productId: selectedProduct.id, ...body });
      } else {
        const baseKey = keyFromName(draft.name) || "produkt";
        const productKey = products.some((product) => product.product_key === baseKey) ? `${baseKey}_${Date.now().toString(36)}` : baseKey;
        saved = await apiPost<AccessProduct>("api-admin", "products", { venueId, product_key: productKey, sort_order: products.length * 10, ...body });
      }
      if (saved.status !== draft.status || saved.is_active !== (draft.status === "active")) {
        throw new Error("Statusändringen kunde inte sparas. Ladda om och försök igen.");
      }
      return saved;
    },
    onSuccess: async (saved: AccessProduct) => {
      queryClient.setQueryData<AccessProduct[]>(["admin-access-products", venueId], (current) => {
        if (!current) return [saved];
        const exists = current.some((product) => product.id === saved.id);
        return exists ? current.map((product) => product.id === saved.id ? saved : product) : [...current, saved];
      });
      setDraft(draftFromProduct(saved));
      await invalidateCatalog();
      setCreating(false);
      setSelectedProductId(saved.id);
      if (saved.sales_block_reason) toast.warning(saved.sales_block_reason);
      else toast.success(saved.sales_state_label || "Produkten är sparad");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const relationshipMutation = useMutation({
    mutationFn: ({ sourceId, targetId, relationshipId }: { sourceId: string; targetId: string; relationshipId?: string }) => relationshipId
      ? apiDelete("api-admin", "product-relationships", { venueId, relationshipId })
      : apiPost("api-admin", "product-relationships", { venueId, source_product_id: sourceId, target_product_id: targetId, is_active: true }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-product-relationships", venueId] });
      await queryClient.invalidateQueries({ queryKey: ["commerce-catalog", venueId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const filteredProducts = useMemo(() => filterAndSortProducts(products, filters), [products, filters]);
  const categories = useMemo(() => Array.from(new Set(products.map((product) => product.category).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, "sv-SE")), [products]);
  const sports = useMemo(() => Array.from(new Set(products.map((product) => product.sport).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, "sv-SE")), [products]);
  const pageCount = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const visibleProducts = filteredProducts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const drawerOpen = creating || Boolean(selectedProduct);

  const openNewProduct = () => {
    setSelectedProductId(null);
    setDraft(emptyDraft());
    setCreating(true);
  };
  const openProduct = (product: AccessProduct) => {
    setCreating(false);
    setSelectedProductId(product.id);
    setDraft(draftFromProduct(product));
  };
  const closeDrawer = () => {
    setCreating(false);
    setSelectedProductId(null);
  };

  if (productsQuery.isLoading) return <Loader2 className="mx-auto mt-10 h-5 w-5 animate-spin text-primary" />;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">Produkter</h2>
          <p className="mt-1 text-sm text-muted-foreground">Det Pickla säljer, samlat på ett ställe.</p>
        </div>
        <button type="button" onClick={openNewProduct} className="flex h-10 shrink-0 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-bold text-primary-foreground">
          <Plus className="h-4 w-4" /> Ny produkt
        </button>
      </div>

      <div className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Sök produkt" className={`${inputClass} pl-9`} />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as ProductCatalogFilters["status"] }))} className={inputClass} aria-label="Status">
            <option value="all">Alla statusar</option><option value="active">Aktiva</option><option value="draft">Utkast</option><option value="archived">Arkiverade</option>
          </select>
          <select value={filters.salesMode} onChange={(event) => setFilters((current) => ({ ...current, salesMode: event.target.value as ProductCatalogFilters["salesMode"] }))} className={inputClass} aria-label="Försäljningssätt">
            <option value="all">Alla försäljningssätt</option><option value="standalone">Butik</option><option value="addon">Aktivitetstillval</option><option value="both">Butik + aktivitet</option>
          </select>
          <select value={filters.sort} onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value as ProductCatalogFilters["sort"] }))} className={inputClass} aria-label="Sortering">
            <option value="name">Namn A–Ö</option><option value="price_asc">Lägsta pris</option><option value="price_desc">Högsta pris</option>
          </select>
          {categories.length > 0 && <select value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))} className={inputClass} aria-label="Kategori"><option value="">Alla kategorier</option>{categories.map((value) => <option key={value}>{value}</option>)}</select>}
          {sports.length > 0 && <select value={filters.sport} onChange={(event) => setFilters((current) => ({ ...current, sport: event.target.value }))} className={inputClass} aria-label="Sport"><option value="">Alla sporter</option>{sports.map((value) => <option key={value}>{value}</option>)}</select>}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs text-muted-foreground">
          <span>{filteredProducts.length} produkter</span><span>{products.length > PAGE_SIZE ? `Sida ${page} av ${pageCount}` : ""}</span>
        </div>
        {visibleProducts.length === 0 ? (
          <div className="px-4 py-12 text-center"><Package className="mx-auto h-6 w-6 text-muted-foreground" /><p className="mt-2 text-sm text-muted-foreground">Inga produkter matchar urvalet.</p></div>
        ) : visibleProducts.map((product) => (
          <button key={product.id} type="button" onClick={() => openProduct(product)} className="grid w-full grid-cols-[1fr_auto] items-center gap-3 border-b border-border px-3 py-3 text-left last:border-0 hover:bg-muted/40 sm:grid-cols-[minmax(0,1fr)_120px_150px_150px_auto]">
            <span className="min-w-0"><span className="block truncate text-sm font-bold">{product.name}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground sm:hidden">{productSalesModeLabel(product)} · {fulfillmentLabel(product.fulfillment_presentation)}</span></span>
            <span className="text-sm font-bold sm:text-right">{formatPrice(product.base_price_sek)}</span>
            <span className="hidden text-xs text-muted-foreground sm:block">{product.sales_state_label || statusLabel(product.status)}</span>
            <span className="hidden text-xs text-muted-foreground sm:block">{productSalesModeLabel(product)}</span>
            <span className="hidden text-xs text-muted-foreground sm:block">{fulfillmentLabel(product.fulfillment_presentation)}</span>
            <ChevronRight className="hidden h-4 w-4 text-muted-foreground sm:block" />
          </button>
        ))}
      </div>

      {pageCount > 1 && <div className="flex items-center justify-between"><button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1} className="rounded-lg border border-border p-2 disabled:opacity-30" aria-label="Föregående sida"><ChevronLeft className="h-4 w-4" /></button><span className="text-xs text-muted-foreground">{page} / {pageCount}</span><button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={page === pageCount} className="rounded-lg border border-border p-2 disabled:opacity-30" aria-label="Nästa sida"><ChevronRight className="h-4 w-4" /></button></div>}

      <Drawer open={drawerOpen} onOpenChange={(open) => { if (!open) closeDrawer(); }} shouldScaleBackground={false}>
        <DrawerContent className="max-h-[92dvh]">
          <div className="flex items-start justify-between border-b border-border px-4 pb-4 pt-2">
            <div className="min-w-0"><DrawerTitle className="truncate text-left">{creating ? "Ny produkt" : selectedProduct?.name}</DrawerTitle><DrawerDescription className="mt-1 text-left">Pris, försäljning och leverans.</DrawerDescription></div>
            <button type="button" onClick={closeDrawer} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted" aria-label="Stäng"><X className="h-4 w-4" /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <section className="space-y-3 px-4 py-5">
              <h3 className="text-sm font-bold">Grunduppgifter</h3>
              <label className="block text-xs font-semibold text-muted-foreground">Namn<input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} className={`${inputClass} mt-1 text-foreground`} /></label>
              <label className="block text-xs font-semibold text-muted-foreground">Beskrivning<textarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} rows={3} className={`${inputClass} mt-1 resize-none text-foreground`} /></label>
              <div className="grid grid-cols-2 gap-2"><label className="block text-xs font-semibold text-muted-foreground">Pris<input type="number" min="0" value={draft.price} onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))} className={`${inputClass} mt-1 text-foreground`} /></label><label className="block text-xs font-semibold text-muted-foreground">Moms %<input type="number" min="0" max="100" step="0.01" value={draft.vatRate} onChange={(event) => setDraft((current) => ({ ...current, vatRate: event.target.value }))} className={`${inputClass} mt-1 text-foreground`} /></label></div>
              <label className="block text-xs font-semibold text-muted-foreground">Status<select aria-label="Produktstatus" value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as ProductCatalogStatus }))} className={`${inputClass} mt-1 text-foreground`}><option value="draft">Utkast</option><option value="active">Aktiv</option><option value="archived">Arkiverad</option></select></label>
              <div className="grid grid-cols-2 gap-2"><label className="block text-xs font-semibold text-muted-foreground">Kategori<input value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))} placeholder="T.ex. Hyra" className={`${inputClass} mt-1 text-foreground`} /></label><label className="block text-xs font-semibold text-muted-foreground">Sport<input value={draft.sport} onChange={(event) => setDraft((current) => ({ ...current, sport: event.target.value }))} placeholder="Valfritt" className={`${inputClass} mt-1 text-foreground`} /></label></div>
              <label className="block text-xs font-semibold text-muted-foreground">Bildlänk<div className="relative mt-1"><ImageIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={draft.imageUrl} onChange={(event) => setDraft((current) => ({ ...current, imageUrl: event.target.value }))} placeholder="https://…" className={`${inputClass} pl-9 text-foreground`} /></div></label>
            </section>

            <section className="space-y-4 border-t border-border px-4 py-5">
              <h3 className="text-sm font-bold">Försäljning</h3>
              {selectedProduct?.commerce_kind === "participation" ? (
                <p className="text-sm text-muted-foreground">Produkten säljs genom de pass och program som använder den.</p>
              ) : (
                <>
                  <label className="flex items-center justify-between gap-4"><span><span className="block text-sm font-semibold">Säljs fristående i butiken</span><span className="block text-xs text-muted-foreground">Kunden kan köpa produkten utan en aktivitet.</span></span><Switch checked={draft.standaloneEnabled} onCheckedChange={(checked) => setDraft((current) => ({ ...current, standaloneEnabled: checked }))} /></label>
                  <label className="flex items-center justify-between gap-4"><span><span className="block text-sm font-semibold">Kan läggas till på aktivitet</span><span className="block text-xs text-muted-foreground">Kräver att minst en aktivitet väljs nedan.</span></span><Switch checked={draft.activityAddonEnabled} onCheckedChange={(checked) => setDraft((current) => ({ ...current, activityAddonEnabled: checked }))} /></label>
                </>
              )}
              {selectedProduct && (
                <div className={`rounded-lg border p-3 ${selectedProduct.sales_block_reason ? "border-amber-500/30 bg-amber-500/10" : "border-border bg-muted/30"}`}>
                  <p className="text-sm font-bold">{draft.status !== selectedProduct.status ? statusLabel(draft.status) : selectedProduct.sales_state_label || statusLabel(selectedProduct.status)}</p>
                  {draft.status !== selectedProduct.status ? (
                    <p className="mt-1 text-xs text-muted-foreground">Spara för att statusändringen ska börja gälla.</p>
                  ) : selectedProduct.sales_block_reason ? (
                    <p className="mt-1 text-xs text-muted-foreground">{selectedProduct.sales_block_reason}</p>
                  ) : null}
                  {draft.status === selectedProduct.status && selectedProduct.store_eligible && selectedProduct.store_path && (
                    <Link to={selectedProduct.store_path} className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-primary">
                      Visa i butik <ExternalLink className="h-4 w-4" />
                    </Link>
                  )}
                </div>
              )}
            </section>

            <section className="border-t border-border px-4 py-5">
              <h3 className="text-sm font-bold">Leverans</h3>
              {selectedProduct?.commerce_kind === "participation" ? (
                <p className="mt-2 text-sm text-muted-foreground">Deltagande</p>
              ) : (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {([['desk_pickup', 'Hämtas vid disken'], ['digital', 'Digital'], ['participation', 'Deltagande']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setDraft((current) => ({ ...current, fulfillment: value }))} className={`min-h-12 rounded-lg border px-2 text-xs font-semibold ${draft.fulfillment === value ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground"}`}>{label}</button>)}
                </div>
              )}
            </section>

            {selectedProduct && <RelationshipSelector product={{ ...selectedProduct, activity_addon_enabled: draft.activityAddonEnabled }} products={products} relationships={relationships} onToggle={(sourceId, targetId, relationshipId) => relationshipMutation.mutate({ sourceId, targetId, relationshipId })} pending={relationshipMutation.isPending} />}

            {selectedProduct && <section className="border-t border-border px-4 py-5">{draft.status === "archived" ? <button type="button" onClick={() => setDraft((current) => ({ ...current, status: "active" }))} className="flex items-center gap-2 text-sm font-semibold text-primary"><RotateCcw className="h-4 w-4" /> Återställ som aktiv</button> : <button type="button" onClick={() => setDraft((current) => ({ ...current, status: "archived" }))} className="flex items-center gap-2 text-sm font-semibold text-destructive"><Archive className="h-4 w-4" /> Arkivera produkt</button>}</section>}
          </div>
          <div className="border-t border-border bg-background px-4 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-3">
            <button type="button" onClick={() => saveProduct.mutate()} disabled={saveProduct.isPending || !draft.name.trim()} className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary font-bold text-primary-foreground disabled:opacity-40">{saveProduct.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Spara</button>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
