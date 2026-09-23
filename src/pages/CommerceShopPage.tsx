import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Loader2, Minus, Plus, ShoppingBag } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { PicklaTopBar } from "@/components/PicklaTopBar";
import StorefrontCartDrawer from "@/components/storefront/StorefrontCartDrawer";
import { useStandaloneShopCart } from "@/hooks/useStandaloneShopCart";
import { apiGet } from "@/lib/api";
import {
  COMMERCE_PICKUP_COPY,
  commerceCartItemKey,
  commerceProductMaxQuantity,
  fetchCommerceCatalog,
  formatCommerceMoney,
} from "@/lib/commerce";
import {
  isEnhancedStorefrontProduct,
  storefrontErrorMessage,
  storefrontImageSources,
  storefrontMedia,
  storefrontOptions,
  storefrontPrice,
  storefrontProductPath,
} from "@/lib/storefront";

interface PublicVenueResponse { venue: { id: string } }

const FONT_GROTESK = "'Space Grotesk', sans-serif";

export default function CommerceShopPage() {
  const [params] = useSearchParams();
  const venueSlug = params.get("v") || "pickla-arena-sthlm";
  const locale = params.get("lang") === "en" ? "en-SE" : "sv-SE";
  const venue = useQuery({ queryKey: ["public-venue", venueSlug], queryFn: () => apiGet<PublicVenueResponse>("api-bookings", "public-venue", { slug: venueSlug }) });
  const venueId = venue.data?.venue.id;
  const catalog = useQuery({ queryKey: ["commerce-catalog", venueId, locale], queryFn: () => fetchCommerceCatalog(venueId!, locale), enabled: Boolean(venueId) });
  const cart = useStandaloneShopCart(venueId);
  const products = useMemo(() => (catalog.data?.products || []).filter((product) => product.store_eligible === true), [catalog.data?.products]);
  const enhanced = products.filter(isEnhancedStorefrontProduct);
  const legacy = products.filter((product) => !isEnhancedStorefrontProduct(product));
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [galleryProductId, setGalleryProductId] = useState<string | null>(null);
  const galleryProduct = legacy.find((product) => product.id === galleryProductId) || null;

  const change = async (cartKey: string, delta: number, maximum: number) => {
    const next = { ...cart.quantities, [cartKey]: Math.max(0, Math.min(maximum, Number(cart.quantities[cartKey] || 0) + delta)) };
    try { await cart.queueQuantities(next); setCartOpen(true); }
    catch (error) { toast.error(storefrontErrorMessage(error)); void catalog.refetch(); }
  };

  const loading = catalog.isLoading || venue.isLoading || cart.isLoading;
  return <div className="min-h-[100dvh] overflow-x-hidden bg-[#fbfaf7] text-neutral-950">
    <PicklaTopBar slug={venueSlug} background="#fbfaf7" />
    <main className="pb-36 pt-[calc(env(safe-area-inset-top,0px)+98px)]">
      <header className="mx-auto max-w-[1440px] px-5 pb-9 pt-8 sm:px-8 lg:pb-14 lg:pt-16"><p className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-neutral-500">Pickla goods</p><div className="mt-3 flex flex-col justify-between gap-5 lg:flex-row lg:items-end"><h1 className="max-w-3xl text-[48px] font-black leading-[0.88] tracking-[-0.065em] sm:text-7xl lg:text-[92px]" style={{ fontFamily: FONT_GROTESK }}>Saker för<br />spelet.</h1><p className="max-w-sm text-[15px] leading-relaxed text-neutral-600 lg:pb-2">Utvalt av Pickla. Köp online och hämta där du spelar.</p></div></header>

      {loading ? <section className="mx-auto grid max-w-[1440px] grid-cols-2 gap-px bg-black/10 sm:px-8 lg:grid-cols-3"><div className="aspect-[4/5] animate-pulse bg-neutral-200" /><div className="aspect-[4/5] animate-pulse bg-neutral-100" /></section> : catalog.data && !catalog.data.commerce_available ? <div className="mx-auto max-w-xl px-5 py-16 text-center text-sm text-neutral-500">{catalog.data.message || "Pickla Butik är inte öppen just nu."}</div> : products.length === 0 ? <div className="mx-auto max-w-xl px-5 py-16 text-center"><ShoppingBag className="mx-auto h-6 w-6 text-neutral-400" /><p className="mt-4 text-sm text-neutral-500">Nya Pickla-saker är på väg.</p></div> : <>
        {enhanced.length ? <section className="mx-auto grid max-w-[1440px] grid-cols-2 gap-x-2 gap-y-9 px-2 sm:gap-x-4 sm:px-8 lg:grid-cols-3 lg:gap-y-16" aria-label="Produkter">{enhanced.map((product, index) => {
          const image = storefrontMedia(product)[0];
          const source = image ? storefrontImageSources(image.url) : null;
          const options = storefrontOptions(product);
          const colors = options.find((option) => option.code === "color")?.values || [];
          const activeVariants = product.variants?.filter((variant) => !variant.sold_out) || [];
          const priceCandidates = (product.variants?.length ? product.variants.map((variant) => storefrontPrice(product, variant).resolved_price_minor) : [storefrontPrice(product).resolved_price_minor]).filter((value) => value >= 0);
          const minimumPrice = priceCandidates.length ? Math.min(...priceCandidates) : storefrontPrice(product).resolved_price_minor;
          const allSoldOut = product.inventory_policy === "tracked" && activeVariants.length === 0;
          return <Link key={product.id} to={storefrontProductPath(product, venueSlug)} className="group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-4" data-testid={`storefront-card-${product.id}`}>
            <div className="relative aspect-[4/5] overflow-hidden bg-[#ece9e3]">{source ? <img src={source.src} srcSet={source.srcSet} sizes="(min-width: 1024px) 33vw, 50vw" alt={image?.alt_text || product.name} loading={index < 2 ? "eager" : "lazy"} fetchPriority={index === 0 ? "high" : "auto"} decoding="async" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.015]" /> : <span className="grid h-full place-items-center"><ShoppingBag className="h-6 w-6 text-neutral-400" /></span>}{allSoldOut ? <span className="absolute left-3 top-3 rounded-full bg-white/90 px-3 py-1.5 font-mono text-[9px] font-bold uppercase tracking-wide">Slutsåld</span> : null}<span className="absolute bottom-3 right-3 grid h-10 w-10 translate-y-2 place-items-center rounded-full bg-white opacity-0 shadow-sm transition group-hover:translate-y-0 group-hover:opacity-100"><ArrowRight className="h-4 w-4" /></span></div>
            <div className="px-2 pt-3 sm:px-0"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="truncate text-[15px] font-black sm:text-lg" style={{ fontFamily: FONT_GROTESK }}>{product.name}</h2><p className="mt-1 line-clamp-1 text-[11px] text-neutral-500 sm:text-xs">{product.presentation?.short_description}</p></div><p className="shrink-0 text-[13px] font-black sm:text-sm">{priceCandidates.some((value) => value !== minimumPrice) ? "Från " : ""}{formatCommerceMoney(minimumPrice)}</p></div>{colors.length ? <div className="mt-3 flex items-center gap-1.5" aria-label={`${colors.length} färger`}>{colors.slice(0, 5).map((color) => <span key={color.value_id} title={color.value_label} className="h-3.5 w-3.5 rounded-full border border-black/15" style={{ backgroundColor: color.swatch || "#dedbd3" }} />)}<span className="ml-1 font-mono text-[9px] text-neutral-500">{colors.length} färger</span></div> : null}</div>
          </Link>;
        })}</section> : null}

        {legacy.length ? <section className="mx-auto mt-20 max-w-4xl px-5 sm:px-8" aria-label="Övrigt hos Pickla"><div className="flex items-end justify-between border-b border-black/15 pb-4"><div><p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-500">Mer på Pickla</p><h2 className="mt-2 text-3xl font-black tracking-[-0.04em]" style={{ fontFamily: FONT_GROTESK }}>Spela, hyr, ta med.</h2></div></div><div className="divide-y divide-black/10">{legacy.map((product) => {
          const tracked = product.inventory_policy === "tracked";
          const variants = product.variants || [];
          const selectedVariant = tracked ? variants.find((variant) => variant.id === selectedVariants[product.id]) || variants.find((variant) => !variant.sold_out) || variants[0] : null;
          const cartKey = commerceCartItemKey({ product_id: product.id, variant_id: selectedVariant?.id, pickup_location_id: tracked ? product.listing?.pickup_location_id : undefined });
          const quantity = Number(cart.quantities[cartKey] || 0);
          const maximum = tracked ? Math.max(0, Math.min(commerceProductMaxQuantity(product), Number(selectedVariant?.available_to_sell || 0))) : commerceProductMaxQuantity(product);
          const image = storefrontMedia(product)[0];
          const source = image ? storefrontImageSources(image.url) : null;
          return <article key={product.id} className="grid grid-cols-[72px_minmax(0,1fr)] gap-4 py-5 sm:grid-cols-[88px_minmax(0,1fr)_auto] sm:items-center"><button type="button" onClick={() => image && setGalleryProductId(product.id)} disabled={!image} aria-label={image ? `Visa bilder för ${product.name}` : undefined} className="aspect-square overflow-hidden rounded-2xl bg-[#ece9e3] disabled:cursor-default">{source ? <img src={source.src} srcSet={source.srcSet} sizes="88px" alt={image.alt_text || product.name} loading="lazy" className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center"><ShoppingBag className="h-4 w-4 text-neutral-400" /></span>}</button><div className="min-w-0"><h3 className="font-black">{product.name}</h3><p className="mt-1 line-clamp-2 text-xs leading-relaxed text-neutral-500">{product.description || (product.fulfillment_presentation === "desk_pickup" ? COMMERCE_PICKUP_COPY : "Tillgång hos Pickla.")}</p>{tracked ? <select aria-label={`Variant ${product.name}`} value={selectedVariant?.id || ""} onChange={(event) => setSelectedVariants((current) => ({ ...current, [product.id]: event.target.value }))} className="mt-3 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-xs font-bold">{variants.map((variant) => <option key={variant.id} value={variant.id} disabled={variant.sold_out}>{variant.options.map((option) => option.value_label).join(" / ") || variant.title || variant.sku}{variant.sold_out ? " · Slutsåld" : ""}</option>)}</select> : null}<p className="mt-2 text-sm font-black">{formatCommerceMoney(storefrontPrice(product, selectedVariant).resolved_price_minor)}</p></div><div className="col-start-2 flex items-center gap-2 sm:col-start-auto"><button type="button" onClick={() => void change(cartKey, -1, maximum)} disabled={quantity === 0} className="grid h-11 w-11 place-items-center rounded-full border border-black/15 bg-white disabled:text-neutral-300" aria-label={`Minska ${product.name}`}><Minus className="h-4 w-4" /></button><span className="w-6 text-center text-sm font-black" aria-live="polite">{quantity}</span><button type="button" onClick={() => void change(cartKey, 1, maximum)} disabled={(!selectedVariant && tracked) || quantity >= maximum} className="grid h-11 w-11 place-items-center rounded-full bg-neutral-950 text-white disabled:bg-neutral-300" aria-label={`Öka ${product.name}`}><Plus className="h-4 w-4" /></button></div></article>;
        })}</div></section> : null}
      </>}
      {cart.isError ? <p className="mx-auto mt-8 max-w-xl px-5 text-center text-sm text-neutral-600">Varukorgen kunde inte hämtas. Försök igen.</p> : null}
    </main>

    {galleryProduct ? <div className="fixed inset-0 z-50 overflow-y-auto bg-black/75 px-4 py-[max(24px,env(safe-area-inset-top))]" role="dialog" aria-modal="true" aria-label={`Bilder för ${galleryProduct.name}`} onClick={() => setGalleryProductId(null)}><div className="mx-auto max-w-xl overflow-hidden rounded-[28px] bg-[#fbfaf7] p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between gap-4"><div><p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-500">Produktbilder</p><h2 className="mt-1 text-xl font-black">{galleryProduct.name}</h2></div><button type="button" onClick={() => setGalleryProductId(null)} className="min-h-11 rounded-full border border-black/15 px-4 text-sm font-black">Stäng</button></div><div className="mt-4 grid gap-3">{storefrontMedia(galleryProduct).map((item, index) => { const source = storefrontImageSources(item.url); return <figure key={item.id} className="overflow-hidden rounded-2xl bg-[#ece9e3]"><img src={source.src} srcSet={source.srcSet} sizes="(min-width: 640px) 560px, calc(100vw - 48px)" alt={item.alt_text || galleryProduct.name} loading={index === 0 ? "eager" : "lazy"} decoding="async" className="aspect-square w-full object-cover" /></figure>; })}</div></div></div> : null}
    {cart.lineCount > 0 ? <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-black/10 bg-[#fbfaf7]/95 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+10px)] pt-3 backdrop-blur-xl"><button type="button" onClick={() => setCartOpen(true)} disabled={cart.isUpdating} className="mx-auto flex min-h-14 w-full max-w-md items-center justify-between rounded-full bg-neutral-950 px-5 text-sm font-black text-white disabled:bg-neutral-400"><span className="inline-flex items-center gap-2">{cart.isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingBag className="h-4 w-4" />} Varukorg · {cart.lineCount}</span><span>{formatCommerceMoney(cart.resolvedTotalMinor)}</span></button></footer> : null}
    <StorefrontCartDrawer open={cartOpen} onOpenChange={setCartOpen} cart={cart} products={products} venueSlug={venueSlug} />
  </div>;
}
