import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, ChevronDown, MapPin, Ruler, Share2, ShoppingBag } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { PicklaTopBar } from "@/components/PicklaTopBar";
import ProductGallery from "@/components/storefront/ProductGallery";
import StorefrontCartDrawer from "@/components/storefront/StorefrontCartDrawer";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useStandaloneShopCart } from "@/hooks/useStandaloneShopCart";
import { apiGet, apiPost } from "@/lib/api";
import {
  commerceCartItemKey,
  commerceJourneyId,
  commerceProductMaxQuantity,
  fetchCommerceCatalog,
  formatCommerceMoney,
} from "@/lib/commerce";
import {
  STOREFRONT_COLOR_OPTION_CODE,
  STOREFRONT_SIZE_OPTION_CODE,
  resolveStorefrontVariant,
  storefrontAvailability,
  storefrontErrorMessage,
  storefrontOptionValueState,
  storefrontOptions,
  storefrontPrice,
} from "@/lib/storefront";

interface PublicVenueResponse { venue: { id: string; name?: string } }

const FONT_GROTESK = "'Space Grotesk', sans-serif";

function ProductSkeleton() {
  return <div className="min-h-[100dvh] bg-[#fbfaf7] pt-[calc(env(safe-area-inset-top,0px)+80px)]"><div className="mx-auto grid max-w-[1440px] animate-pulse lg:grid-cols-[minmax(0,58%)_minmax(360px,1fr)]"><div className="aspect-[4/5] bg-[#ece9e3] lg:min-h-[760px]" /><div className="space-y-5 px-5 py-8 lg:px-12 lg:py-20"><div className="h-4 w-24 rounded bg-neutral-200" /><div className="h-12 w-4/5 rounded bg-neutral-200" /><div className="h-7 w-28 rounded bg-neutral-200" /><div className="h-28 rounded-2xl bg-neutral-200" /><div className="h-14 rounded-full bg-neutral-200" /></div></div></div>;
}

function UpsertMeta({ name, property, content }: { name?: string; property?: string; content: string }) {
  useEffect(() => {
    const selector = name ? `meta[name="${name}"]` : `meta[property="${property}"]`;
    let meta = document.head.querySelector<HTMLMetaElement>(selector);
    const created = !meta;
    if (!meta) { meta = document.createElement("meta"); if (name) meta.name = name; if (property) meta.setAttribute("property", property); document.head.appendChild(meta); }
    const previous = meta.content;
    meta.content = content;
    return () => { if (created) meta?.remove(); else if (meta) meta.content = previous; };
  }, [content, name, property]);
  return null;
}

export default function CommerceProductPage() {
  const { slug: routeSlug = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const venueSlug = params.get("v") || "pickla-arena-sthlm";
  const locale = params.get("lang") === "en" ? "en-SE" : "sv-SE";
  const venue = useQuery({ queryKey: ["public-venue", venueSlug], queryFn: () => apiGet<PublicVenueResponse>("api-bookings", "public-venue", { slug: venueSlug }) });
  const venueId = venue.data?.venue.id;
  const catalog = useQuery({ queryKey: ["commerce-catalog", venueId, locale], queryFn: () => fetchCommerceCatalog(venueId!, locale), enabled: Boolean(venueId) });
  const product = catalog.data?.products.find((item) => item.presentation?.slug === routeSlug && item.presentation.publication_state === "published") || null;
  const cart = useStandaloneShopCart(venueId);
  const options = useMemo(() => product ? storefrontOptions(product) : [], [product]);
  const colorOption = options.find((option) => option.code === STOREFRONT_COLOR_OPTION_CODE);
  const sizeOption = options.find((option) => option.code === STOREFRONT_SIZE_OPTION_CODE);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const [sizeGuideOpen, setSizeGuideOpen] = useState(false);
  const [primaryActionVisible, setPrimaryActionVisible] = useState(true);
  const purchaseActionRef = useRef<HTMLButtonElement>(null);
  const productViewRecorded = useRef<string | null>(null);
  const journeyId = useMemo(() => commerceJourneyId(), []);

  useEffect(() => {
    if (!colorOption || selections[colorOption.code]) return;
    const publicColorCode = params.get("color");
    const initial = colorOption.values.find((value) => value.value_code === publicColorCode) || colorOption.values[0];
    if (initial) setSelections((current) => ({ ...current, [colorOption.code]: initial.value_id }));
  }, [colorOption, params, selections]);

  useEffect(() => {
    const node = purchaseActionRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setPrimaryActionVisible(entry.isIntersecting), { threshold: 0.25 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [product?.id]);

  useEffect(() => {
    if (!product || !venueId || productViewRecorded.current === product.id) return;
    productViewRecorded.current = product.id;
    void apiPost("api-commerce", "event", { event_name: "product_view", venue_id: venueId, product_id: product.id, journey_id: journeyId, source: "storefront_product" }).catch(() => undefined);
  }, [journeyId, product, venueId]);

  useEffect(() => {
    if (!product?.presentation) return;
    const previous = document.title;
    document.title = product.presentation.seo_title || `${product.name} | Pickla`;
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"][data-storefront]');
    if (!canonical) { canonical = document.createElement("link"); canonical.rel = "canonical"; canonical.dataset.storefront = "true"; document.head.appendChild(canonical); }
    canonical.href = `${window.location.origin}/shop/products/${encodeURIComponent(product.presentation.slug)}`;
    return () => { document.title = previous; canonical?.remove(); };
  }, [product]);

  if (venue.isLoading || catalog.isLoading || cart.isLoading) return <ProductSkeleton />;
  if (!catalog.data?.commerce_available || !product) return <div className="min-h-[100dvh] bg-[#fbfaf7] text-neutral-950"><PicklaTopBar slug={venueSlug} background="#fbfaf7" /><main className="mx-auto max-w-xl px-5 pb-20 pt-[calc(env(safe-area-inset-top,0px)+120px)] text-center"><span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-neutral-100"><ShoppingBag className="h-6 w-6" /></span><h1 className="mt-6 text-3xl font-black tracking-tight" style={{ fontFamily: FONT_GROTESK }}>Produkten finns inte här</h1><p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-neutral-500">Den kan vara opublicerad, arkiverad eller inte längre tillgänglig.</p><Link to={`/shop?v=${encodeURIComponent(venueSlug)}`} className="mt-8 inline-flex min-h-12 items-center rounded-full bg-neutral-950 px-6 text-sm font-black text-white">Till butiken</Link></main></div>;

  const selectedColorId = colorOption ? selections[colorOption.code] : null;
  const selectedColor = colorOption?.values.find((value) => value.value_id === selectedColorId) || null;
  const variant = resolveStorefrontVariant(product, selections);
  const availability = storefrontAvailability(product, variant);
  const pricing = storefrontPrice(product, variant);
  const allSelected = options.every((option) => Boolean(selections[option.code]));
  const currentKey = variant && product.listing ? commerceCartItemKey({ product_id: product.id, variant_id: variant.id, pickup_location_id: product.listing.pickup_location_id }) : commerceCartItemKey({ product_id: product.id });
  const currentQuantity = Number(cart.quantities[currentKey] || 0);
  const maximum = variant ? Math.max(0, Math.min(commerceProductMaxQuantity(product), Number(variant.available_to_sell || 0))) : commerceProductMaxQuantity(product);
  const ctaReason = !allSelected
    ? `Välj ${(options.find((option) => !selections[option.code])?.label || "alternativ").toLowerCase()}`
    : !variant && product.inventory_policy === "tracked"
      ? "Kombinationen är inte tillgänglig"
      : availability.state === "sold_out" ? "Slutsåld"
        : availability.state === "unavailable" ? "Inte tillgänglig"
          : currentQuantity >= maximum ? "Max antal i varukorgen" : "Lägg i varukorg";
  const canAdd = allSelected && (product.inventory_policy !== "tracked" || Boolean(variant)) && ["available", "low_stock"].includes(availability.state) && currentQuantity < maximum && !cart.isUpdating;

  const choose = (optionCode: string, valueId: string, valueCode: string) => {
    setSelections((current) => {
      const next = { ...current, [optionCode]: valueId };
      if (optionCode === STOREFRONT_COLOR_OPTION_CODE && sizeOption && current[sizeOption.code]) {
        const matchingVariantExists = (product.variants || []).some((candidate) => candidate.status === "active"
          && candidate.options.some((fact) => fact.option_code === optionCode && fact.value_id === valueId)
          && candidate.options.some((fact) => fact.option_code === sizeOption.code && fact.value_id === current[sizeOption.code]));
        if (!matchingVariantExists) delete next[sizeOption.code];
      }
      return next;
    });
    if (optionCode === STOREFRONT_COLOR_OPTION_CODE) {
      const nextParams = new URLSearchParams(params);
      nextParams.set("color", valueCode);
      setParams(nextParams, { replace: true });
    }
    void apiPost("api-commerce", "event", { event_name: "variant_selected", venue_id: venueId, product_id: product.id, journey_id: journeyId, option_code: optionCode, value_code: valueCode, source: "storefront_product" }).catch(() => undefined);
  };

  const addToCart = async () => {
    if (!canAdd) { if (!allSelected) toast.info(ctaReason); return; }
    try {
      await cart.queueQuantities({ ...cart.quantities, [currentKey]: currentQuantity + 1 });
      setJustAdded(true);
      setCartOpen(true);
      void apiPost("api-commerce", "event", { event_name: "add_to_cart", venue_id: venueId, product_id: product.id, variant_id: variant?.id || "", journey_id: journeyId, source: "storefront_product" }).catch(() => undefined);
    } catch (error) {
      toast.error(storefrontErrorMessage(error));
      void catalog.refetch();
    }
  };

  const share = async () => {
    const shareData = { title: product.name, text: product.presentation?.short_description || product.name, url: window.location.href };
    try { if (navigator.share) await navigator.share(shareData); else { await navigator.clipboard.writeText(window.location.href); toast.success("Länk kopierad"); } }
    catch (error) { if ((error as Error)?.name !== "AbortError") toast.error("Länken kunde inte delas"); }
  };

  const seoDescription = product.presentation?.seo_description || product.presentation?.short_description || product.description || product.name;
  const ogImage = product.media?.find((item) => item.is_cover)?.url || product.image_url || "";
  return <div className="min-h-[100dvh] overflow-x-hidden bg-[#fbfaf7] text-neutral-950">
    <UpsertMeta name="description" content={seoDescription} /><UpsertMeta property="og:title" content={product.presentation?.seo_title || product.name} /><UpsertMeta property="og:description" content={seoDescription} />{ogImage ? <UpsertMeta property="og:image" content={ogImage} /> : null}<UpsertMeta property="og:url" content={window.location.href} />
    <PicklaTopBar slug={venueSlug} background="#fbfaf7" />
    <main className="pb-32 pt-[calc(env(safe-area-inset-top,0px)+80px)] lg:pb-20">
      <div className="mx-auto max-w-[1440px]"><div className="flex items-center justify-between px-5 py-4 lg:px-8"><Link to={`/shop?v=${encodeURIComponent(venueSlug)}`} className="inline-flex min-h-11 items-center gap-2 text-xs font-black"><ArrowLeft className="h-4 w-4" /> Butik</Link><button type="button" onClick={() => void share()} className="grid h-11 w-11 place-items-center rounded-full border border-black/10 bg-white" aria-label="Dela produkt"><Share2 className="h-4 w-4" /></button></div>
        <div className="grid items-start lg:grid-cols-[minmax(0,58%)_minmax(380px,1fr)] lg:gap-0">
          <ProductGallery product={product} colorValueId={selectedColorId} />
          <section className="px-5 py-8 lg:sticky lg:top-24 lg:px-12 lg:pb-20 lg:pt-16 xl:px-16" aria-label="Köp produkten">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-500">Pickla essentials</p><h1 className="mt-3 text-[34px] font-black leading-[0.98] tracking-[-0.05em] sm:text-5xl" style={{ fontFamily: FONT_GROTESK }}>{product.name}</h1>{product.presentation?.short_description ? <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-neutral-600">{product.presentation.short_description}</p> : null}
            <div className="mt-6 flex flex-wrap items-end gap-x-3 gap-y-1"><p className="text-[25px] font-black tracking-[-0.03em]">{formatCommerceMoney(pricing.resolved_price_minor)}</p>{pricing.discount_minor > 0 ? <><p className="pb-1 text-sm text-neutral-400 line-through">{formatCommerceMoney(pricing.public_price_minor)}</p><span className="mb-1 rounded-full bg-emerald-100 px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-wide text-emerald-800">{pricing.membership_tier_name || "Medlemspris"}</span></> : null}</div>

            <div className="mt-8 space-y-7">{options.map((option) => {
              const isColor = option.code === STOREFRONT_COLOR_OPTION_CODE;
              const selected = option.values.find((value) => selections[option.code] === value.value_id);
              return <fieldset key={option.id}><legend className="flex w-full items-baseline justify-between text-sm font-black"><span>{option.label}</span>{selected ? <span className="font-normal text-neutral-500">{selected.value_label}</span> : null}</legend><div className={`mt-3 flex flex-wrap ${isColor ? "gap-3" : "gap-2"}`}>{option.values.map((value) => {
                const stateSelections = isColor && sizeOption ? Object.fromEntries(Object.entries(selections).filter(([code]) => code !== sizeOption.code)) : selections;
                const state = storefrontOptionValueState({ product, optionCode: option.code, valueId: value.value_id, selections: stateSelections });
                const isSelected = selections[option.code] === value.value_id;
                const disabled = !state.exists || !state.available;
                const soldOut = state.exists && !state.available;
                return <button key={value.value_id} type="button" onClick={() => choose(option.code, value.value_id, value.value_code)} disabled={disabled} aria-pressed={isSelected} aria-label={`${value.value_label}${soldOut ? ", slutsåld" : ""}`} className={isColor ? "group inline-flex min-h-12 items-center gap-2 rounded-full border px-3.5 text-xs font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 disabled:opacity-30" : "relative grid min-h-12 min-w-12 place-items-center rounded-xl border px-4 text-sm font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 disabled:opacity-30"} style={{ borderColor: isSelected ? "#111827" : "rgba(17,24,39,.16)", background: isSelected ? "#111827" : "white", color: isSelected ? "white" : "#111827" }}>{isColor ? <><span className="grid h-6 w-6 place-items-center rounded-full border border-black/15 bg-white"><span className="h-4 w-4 rounded-full border border-black/10" style={{ backgroundColor: value.swatch || "#dedbd3" }} />{isSelected ? <Check className="absolute h-3 w-3 mix-blend-difference" /> : null}</span><span>{value.value_label}</span></> : <><span className={soldOut ? "opacity-45" : ""}>{value.value_label}</span>{soldOut ? <span className="absolute h-px w-8 rotate-[-35deg] bg-neutral-400" aria-hidden="true" /> : null}</>}</button>;
              })}</div></fieldset>;
            })}</div>

            {sizeOption && product.presentation?.size_guide ? <button type="button" onClick={() => setSizeGuideOpen(true)} className="mt-4 inline-flex min-h-11 items-center gap-2 text-xs font-black underline decoration-black/25 underline-offset-4"><Ruler className="h-4 w-4" /> Storleksguide</button> : null}
            <div className="mt-7 flex items-start gap-3 border-y border-black/10 py-4"><MapPin className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="text-sm font-black">Hämta på {product.listing?.pickup_location_name || "Pickla"}</p><p className={`mt-1 text-xs ${availability.state === "sold_out" || availability.state === "unavailable" ? "text-neutral-500" : availability.state === "low_stock" ? "text-amber-700" : "text-emerald-700"}`} aria-live="polite">{availability.label}</p></div></div>
            <button ref={purchaseActionRef} type="button" onClick={() => void addToCart()} disabled={!canAdd} className="mt-6 flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-neutral-950 px-5 text-[15px] font-black text-white transition active:scale-[0.99] disabled:bg-neutral-300 disabled:text-neutral-600" aria-describedby="storefront-cta-reason"><ShoppingBag className="h-4 w-4" /> {ctaReason}</button><p id="storefront-cta-reason" className="mt-2 min-h-4 text-center text-[11px] text-neutral-500">{!allSelected ? `${ctaReason} för att fortsätta.` : availability.state === "sold_out" ? "Välj en annan kombination." : "Betalning sker säkert via Stripe."}</p>
          </section>
        </div>

        <section className="mx-auto max-w-4xl px-5 py-12 lg:py-20" aria-label="Produktinformation"><div className="grid gap-8 lg:grid-cols-[1fr_1.3fr]"><div><p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-500">Detaljer</p><h2 className="mt-3 text-3xl font-black tracking-[-0.04em]" style={{ fontFamily: FONT_GROTESK }}>Gjord för spelet.<br />Bra efteråt.</h2></div><div className="divide-y divide-black/10 border-y border-black/10">{[
          ["Om produkten", product.presentation?.long_description],
          ["Storlek & passform", product.presentation?.fit],
          ["Material & skötsel", [product.presentation?.material, product.presentation?.care].filter(Boolean).join("\n\n")],
          ["Hämta på Pickla", `Hämtas på ${product.listing?.pickup_location_name || "vald Pickla-anläggning"}. Din order visar när varan är redo för upphämtning.`],
          ["Retur / återbetalning", product.presentation?.returns_policy],
        ].filter((item) => Boolean(item[1])).map(([title, body]) => <details key={title} className="group"><summary className="flex min-h-16 cursor-pointer list-none items-center justify-between py-4 text-sm font-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"><span>{title}</span><ChevronDown className="h-4 w-4 transition group-open:rotate-180" /></summary><p className="whitespace-pre-line pb-5 text-sm leading-7 text-neutral-600">{body}</p></details>)}</div></div></section>
      </div>
    </main>

    {!primaryActionVisible ? <div className="fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-[#fbfaf7]/95 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+10px)] pt-3 backdrop-blur-xl lg:hidden" data-testid="storefront-sticky-cta"><div className="mx-auto flex max-w-md items-center gap-3"><div className="min-w-0 flex-1"><p className="truncate text-xs font-black">{variant?.options.map((option) => option.value_label).join(" · ") || ctaReason}</p><p className="mt-0.5 text-sm font-black">{formatCommerceMoney(pricing.resolved_price_minor)}</p></div><button type="button" onClick={() => void addToCart()} disabled={!canAdd} className="min-h-12 shrink-0 rounded-full bg-neutral-950 px-5 text-sm font-black text-white disabled:bg-neutral-300">{canAdd ? "Lägg i varukorg" : ctaReason}</button></div></div> : null}

    <StorefrontCartDrawer open={cartOpen} onOpenChange={(open) => { setCartOpen(open); if (!open) setJustAdded(false); }} cart={cart} products={catalog.data.products} venueSlug={venueSlug} justAdded={justAdded} />
    <Dialog open={sizeGuideOpen} onOpenChange={setSizeGuideOpen}><DialogContent className="bottom-0 left-0 top-auto max-h-[88dvh] w-full max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-t-[28px] border-0 bg-[#fbfaf7] p-6 text-neutral-950 sm:left-1/2 sm:top-1/2 sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[28px]"><DialogTitle className="font-display text-2xl font-black">Storleksguide</DialogTitle><DialogDescription className="text-sm leading-relaxed text-neutral-500">{product.presentation?.size_guide?.body || "Mått för den här produkten."}</DialogDescription>{product.presentation?.size_guide?.columns?.length ? <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[420px] border-collapse text-left text-sm"><thead><tr>{product.presentation.size_guide.columns.map((column) => <th key={column} className="border-b border-black/15 px-3 py-3 font-black">{column}</th>)}</tr></thead><tbody>{(product.presentation.size_guide.rows || []).map((row, rowIndex) => { const cells = Array.isArray(row) ? row : [row.label || "", ...(row.values || [])]; return <tr key={`${cells[0]}-${rowIndex}`}>{cells.map((cell, cellIndex) => <td key={`${cell}-${cellIndex}`} className="border-b border-black/10 px-3 py-3 text-neutral-600 first:font-black first:text-neutral-950">{cell}</td>)}</tr>; })}</tbody></table></div> : null}</DialogContent></Dialog>
  </div>;
}
