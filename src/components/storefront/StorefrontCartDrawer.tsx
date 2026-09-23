import { Loader2, Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import type { useStandaloneShopCart } from "@/hooks/useStandaloneShopCart";
import {
  commerceCartItemKey,
  commerceProductMaxQuantity,
  formatCommerceMoney,
  type CommerceProduct,
} from "@/lib/commerce";
import {
  STOREFRONT_COLOR_OPTION_CODE,
  storefrontErrorMessage,
  storefrontImageSources,
  storefrontMedia,
} from "@/lib/storefront";

type ShopCart = ReturnType<typeof useStandaloneShopCart>;

export default function StorefrontCartDrawer({
  open,
  onOpenChange,
  cart,
  products,
  venueSlug,
  justAdded = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cart: ShopCart;
  products: CommerceProduct[];
  venueSlug: string;
  justAdded?: boolean;
}) {
  const navigate = useNavigate();
  const productById = new Map(products.map((product) => [product.id, product]));
  const lines = cart.data?.lines || [];
  const regularSubtotal = lines.reduce((sum, line) => sum + Number(line.unit_price_minor || 0) * Number(line.quantity || 0), 0);
  const discount = lines.reduce((sum, line) => sum + Number(line.discount_minor || 0), 0);
  const subtotal = regularSubtotal - discount;
  const vat = lines.reduce((sum, line) => {
    const total = Number(line.unit_price_minor || 0) * Number(line.quantity || 0) - Number(line.discount_minor || 0);
    const rate = Number(line.vat_rate || 0);
    return sum + Math.round(total * rate / (100 + rate));
  }, 0);

  const change = async (key: string, quantity: number) => {
    try {
      await cart.queueQuantities({ ...cart.quantities, [key]: Math.max(0, quantity) });
    } catch (error) {
      toast.error(storefrontErrorMessage(error));
    }
  };

  return <Drawer open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
    <DrawerContent className="max-h-[92dvh] rounded-t-[30px] border-0 bg-[#fbfaf7] text-neutral-950 shadow-[0_-30px_80px_rgba(0,0,0,.25)] sm:left-auto sm:right-5 sm:top-5 sm:mt-0 sm:h-[calc(100dvh-40px)] sm:max-h-none sm:w-[min(480px,calc(100vw-40px))] sm:rounded-[30px]">
      <DrawerHeader className="flex-row items-start justify-between px-5 pb-4 pt-3 text-left sm:pt-6">
        <div>{justAdded ? <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700">Tillagd i varukorgen</p> : null}<DrawerTitle className="mt-1 font-display text-[25px] font-black tracking-[-0.035em]">Din varukorg</DrawerTitle><DrawerDescription className="mt-1 text-[13px] text-neutral-500">{cart.lineCount ? `${cart.lineCount} ${cart.lineCount === 1 ? "vara" : "varor"} · hämtas hos Pickla` : "Varukorgen är tom"}</DrawerDescription></div>
        <DrawerClose className="grid h-11 w-11 place-items-center rounded-full border border-black/10 bg-white" aria-label="Stäng varukorgen"><X className="h-4 w-4" /></DrawerClose>
      </DrawerHeader>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-y border-black/10 px-5">
        {lines.length === 0 ? <div className="grid min-h-60 place-items-center text-center"><div><span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-neutral-100"><ShoppingBag className="h-5 w-5" /></span><p className="mt-4 text-sm font-bold">Redo för något Pickla?</p></div></div> : lines.map((line) => {
          const product = productById.get(String(line.product_id || ""));
          const variant = product?.variants?.find((item) => item.id === line.variant_id) || null;
          const color = variant?.options.find((option) => option.option_code === STOREFRONT_COLOR_OPTION_CODE);
          const options = variant?.options.map((option) => option.value_label).join(" · ") || "";
          const media = product ? storefrontMedia(product, color?.value_id)[0] : null;
          const image = media ? storefrontImageSources(media.url) : null;
          const key = commerceCartItemKey({ product_id: String(line.product_id || ""), variant_id: line.variant_id || undefined, pickup_location_id: line.pickup_location_id || undefined });
          const maximum = product && variant
            ? Math.max(0, Math.min(commerceProductMaxQuantity(product), Number(variant.available_to_sell || 0)))
            : product ? commerceProductMaxQuantity(product) : 100;
          return <article key={line.id} className="grid grid-cols-[88px_minmax(0,1fr)] gap-4 border-b border-black/10 py-5 last:border-0">
            <div className="aspect-[4/5] overflow-hidden rounded-2xl bg-[#efede8]">{image ? <img src={image.src} srcSet={image.srcSet} sizes="88px" alt={media?.alt_text || line.product_name} className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center"><ShoppingBag className="h-5 w-5 text-neutral-400" /></span>}</div>
            <div className="min-w-0"><div className="flex items-start justify-between gap-3"><div><h3 className="text-[15px] font-black leading-tight">{line.product_name}</h3>{options ? <p className="mt-1 text-[12px] text-neutral-500">{options}</p> : null}<p className="mt-1 text-[11px] text-neutral-500">Hämtas på {product?.listing?.pickup_location_name || "Pickla"}</p></div><button type="button" onClick={() => void change(key, 0)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-neutral-500 hover:bg-neutral-100" aria-label={`Ta bort ${line.product_name}`}><Trash2 className="h-4 w-4" /></button></div><div className="mt-4 flex items-center justify-between gap-3"><div className="flex items-center rounded-full border border-black/15 bg-white"><button type="button" onClick={() => void change(key, Number(line.quantity) - 1)} className="grid h-9 w-9 place-items-center" aria-label={`Minska ${line.product_name}`}><Minus className="h-3.5 w-3.5" /></button><span className="w-7 text-center text-xs font-black" aria-live="polite">{line.quantity}</span><button type="button" disabled={Number(line.quantity) >= maximum} onClick={() => void change(key, Number(line.quantity) + 1)} className="grid h-9 w-9 place-items-center disabled:text-neutral-300" aria-label={`Öka ${line.product_name}`}><Plus className="h-3.5 w-3.5" /></button></div><p className="text-sm font-black">{formatCommerceMoney(Number(line.unit_price_minor) * Number(line.quantity) - Number(line.discount_minor || 0))}</p></div></div>
          </article>;
        })}
      </div>

      <div className="shrink-0 px-5 pb-[calc(env(safe-area-inset-bottom,0px)+18px)] pt-4">
        {lines.length ? <div className="space-y-2 text-sm"><div className="flex justify-between"><span className="text-neutral-500">Delsumma</span><span className="font-bold">{formatCommerceMoney(subtotal)}</span></div>{discount > 0 ? <div className="flex justify-between text-emerald-700"><span>{lines.find((line) => Number(line.discount_minor || 0) > 0)?.resolver_snapshot?.membership_tier_name as string || "Medlemsförmån"}</span><span className="font-bold">−{formatCommerceMoney(discount)}</span></div> : null}<div className="flex justify-between text-[12px] text-neutral-500"><span>Varav moms</span><span>{formatCommerceMoney(vat)}</span></div></div> : null}
        <div className="mt-4 grid gap-2"><button type="button" disabled={!cart.reference || lines.length === 0 || cart.isUpdating} onClick={() => { onOpenChange(false); navigate(`/cart?token=${encodeURIComponent(cart.reference)}&v=${encodeURIComponent(venueSlug)}`); }} className="flex min-h-14 items-center justify-center gap-2 rounded-full bg-neutral-950 px-5 text-[15px] font-black text-white disabled:bg-neutral-300">{cart.isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Till betalning</button><DrawerClose className="min-h-11 text-sm font-bold underline decoration-black/25 underline-offset-4">Fortsätt handla</DrawerClose></div>
      </div>
    </DrawerContent>
  </Drawer>;
}
