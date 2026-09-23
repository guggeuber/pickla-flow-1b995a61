import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Expand, Image as ImageIcon, Minus, Plus } from "lucide-react";
import type { CarouselApi } from "@/components/ui/carousel";
import { Carousel, CarouselContent, CarouselItem } from "@/components/ui/carousel";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { CommerceProduct } from "@/lib/commerce";
import { storefrontImageSources, storefrontMedia } from "@/lib/storefront";

export default function ProductGallery({ product, colorValueId }: { product: CommerceProduct; colorValueId?: string | null }) {
  const media = useMemo(() => storefrontMedia(product, colorValueId), [colorValueId, product]);
  const galleryKey = `${colorValueId || "all"}:${media.map((item) => item.id).join(":")}`;
  const [api, setApi] = useState<CarouselApi>();
  const [index, setIndex] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  const syncIndex = useCallback((carousel?: CarouselApi) => setIndex(carousel?.selectedScrollSnap() || 0), []);
  useEffect(() => {
    if (!api) return;
    api.scrollTo(0, true);
    syncIndex(api);
    api.on("select", syncIndex);
    return () => { api.off("select", syncIndex); };
  }, [api, galleryKey, syncIndex]);
  useEffect(() => { setIndex(0); setZoomed(false); }, [galleryKey]);

  if (!media.length) {
    return <div className="grid aspect-[4/5] w-full place-items-center bg-[#ece9e3] text-neutral-400"><div className="text-center"><ImageIcon className="mx-auto h-7 w-7" /><p className="mt-2 text-xs font-bold">Bild kommer</p></div></div>;
  }
  const active = media[Math.min(index, media.length - 1)];

  return <>
    <section className="relative" aria-label={`Produktbilder för ${product.name}`} data-testid="product-gallery">
      <Carousel key={galleryKey} setApi={setApi} opts={{ align: "start", containScroll: "trimSnaps", duration: 22 }} className="group" aria-label={`${product.name}, bildgalleri`}>
        <CarouselContent className="ml-0 touch-pan-y">
          {media.map((item, mediaIndex) => {
            const source = storefrontImageSources(item.url);
            return <CarouselItem key={item.id} className="pl-0"><button type="button" onClick={() => { setIndex(mediaIndex); setFullscreen(true); }} className="relative block aspect-[4/5] w-full overflow-hidden bg-[#ece9e3] text-left" aria-label={`Öppna bild ${mediaIndex + 1} av ${media.length} i fullskärm`}><img src={source.src} srcSet={source.srcSet} sizes="(min-width: 1024px) 58vw, 100vw" alt={item.alt_text || `${product.name}, bild ${mediaIndex + 1}`} loading={mediaIndex === 0 ? "eager" : "lazy"} fetchPriority={mediaIndex === 0 ? "high" : "auto"} decoding="async" className="h-full w-full object-cover" /><span className="absolute bottom-4 right-4 grid h-11 w-11 place-items-center rounded-full bg-white/90 shadow-sm backdrop-blur" aria-hidden="true"><Expand className="h-4 w-4" /></span></button></CarouselItem>;
          })}
        </CarouselContent>
      </Carousel>
      {media.length > 1 ? <><div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center"><span className="rounded-full bg-black/70 px-3 py-1.5 font-mono text-[10px] font-bold text-white backdrop-blur">{index + 1} / {media.length}</span></div><button type="button" onClick={() => api?.scrollPrev()} disabled={!api?.canScrollPrev()} className="absolute left-4 top-1/2 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/90 shadow-sm disabled:opacity-0 lg:grid" aria-label="Föregående produktbild"><ChevronLeft className="h-5 w-5" /></button><button type="button" onClick={() => api?.scrollNext()} disabled={!api?.canScrollNext()} className="absolute right-4 top-1/2 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/90 shadow-sm disabled:opacity-0 lg:grid" aria-label="Nästa produktbild"><ChevronRight className="h-5 w-5" /></button></> : null}
      {media.length > 1 ? <div className="mt-3 hidden grid-cols-5 gap-2 px-4 lg:grid">{media.slice(0, 5).map((item, mediaIndex) => { const source = storefrontImageSources(item.url); return <button key={item.id} type="button" onClick={() => api?.scrollTo(mediaIndex)} aria-label={`Visa produktbild ${mediaIndex + 1}`} aria-current={index === mediaIndex} className="aspect-[4/5] overflow-hidden rounded-xl border-2 bg-[#ece9e3] transition" style={{ borderColor: index === mediaIndex ? "#111827" : "transparent" }}><img src={source.src} srcSet={source.srcSet} sizes="120px" alt="" loading="lazy" className="h-full w-full object-cover" /></button>; })}</div> : null}
    </section>

    <Dialog open={fullscreen} onOpenChange={(open) => { setFullscreen(open); if (!open) setZoomed(false); }}>
      <DialogContent className="inset-0 left-0 top-0 h-[100dvh] max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden border-0 bg-[#f3f1ec] p-0 text-neutral-950 data-[state=open]:slide-in-from-bottom-0 sm:rounded-none [&>button]:right-5 [&>button]:top-[calc(env(safe-area-inset-top,0px)+18px)] [&>button]:z-20 [&>button]:grid [&>button]:h-11 [&>button]:w-11 [&>button]:place-items-center [&>button]:rounded-full [&>button]:bg-white/90 [&>button]:opacity-100">
        <DialogTitle className="sr-only">{product.name} i fullskärm</DialogTitle><DialogDescription className="sr-only">Nyp för att zooma eller dubbeltryck på bilden.</DialogDescription>
        <div className="flex h-full flex-col pt-[env(safe-area-inset-top,0px)]"><div className="flex min-h-16 items-center px-5"><p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em]">{index + 1} / {media.length}</p></div><div className="relative min-h-0 flex-1 overflow-auto overscroll-contain" style={{ touchAction: "pan-x pan-y pinch-zoom" }}><button type="button" onDoubleClick={() => setZoomed((value) => !value)} onClick={() => undefined} className="grid h-full min-h-full w-full place-items-center" aria-label={zoomed ? "Återställ zoom" : "Zooma bild"}><img src={storefrontImageSources(active.url).src} srcSet={storefrontImageSources(active.url).srcSet} sizes="100vw" alt={active.alt_text || product.name} className={`max-h-full object-contain transition-transform duration-200 ${zoomed ? "w-[180%] max-w-none scale-110" : "h-full w-full"}`} /></button></div><div className="flex min-h-20 items-center justify-between px-5 pb-[env(safe-area-inset-bottom,0px)]"><div className="flex gap-2"><button type="button" onClick={() => { const next = Math.max(0, index - 1); setIndex(next); api?.scrollTo(next); setZoomed(false); }} disabled={index === 0} className="grid h-11 w-11 place-items-center rounded-full border border-black/15 bg-white disabled:opacity-30" aria-label="Föregående bild"><ChevronLeft className="h-5 w-5" /></button><button type="button" onClick={() => { const next = Math.min(media.length - 1, index + 1); setIndex(next); api?.scrollTo(next); setZoomed(false); }} disabled={index === media.length - 1} className="grid h-11 w-11 place-items-center rounded-full border border-black/15 bg-white disabled:opacity-30" aria-label="Nästa bild"><ChevronRight className="h-5 w-5" /></button></div><button type="button" onClick={() => setZoomed((value) => !value)} className="flex h-11 items-center gap-2 rounded-full border border-black/15 bg-white px-4 text-xs font-bold">{zoomed ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{zoomed ? "Återställ" : "Zooma"}</button></div></div>
      </DialogContent>
    </Dialog>
  </>;
}
