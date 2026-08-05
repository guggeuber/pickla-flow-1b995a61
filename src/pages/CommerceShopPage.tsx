import { useQuery } from "@tanstack/react-query";
import { Loader2, Minus, Plus, ShoppingBag } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { PicklaTopBar } from "@/components/PicklaTopBar";
import { useStandaloneShopCart } from "@/hooks/useStandaloneShopCart";
import { apiGet } from "@/lib/api";
import {
  COMMERCE_PICKUP_COPY,
  commerceProductMaxQuantity,
  fetchCommerceCatalog,
  formatCommerceMoney,
} from "@/lib/commerce";

interface PublicVenueResponse {
  venue: { id: string };
}

export default function CommerceShopPage() {
  const [params] = useSearchParams();
  const slug = params.get("v") || "pickla-arena-sthlm";
  const navigate = useNavigate();
  const venue = useQuery({
    queryKey: ["public-venue", slug],
    queryFn: () => apiGet<PublicVenueResponse>("api-bookings", "public-venue", { slug }),
  });
  const venueId = venue.data?.venue.id;
  const catalog = useQuery({
    queryKey: ["commerce-catalog", venueId],
    queryFn: () => fetchCommerceCatalog(venueId!),
    enabled: Boolean(venueId),
  });
  const cart = useStandaloneShopCart(venueId);
  const products = (catalog.data?.products || []).filter((product) => product.store_eligible === true);

  const change = (productId: string, delta: number, maximum: number) => {
    const next = {
      ...cart.quantities,
      [productId]: Math.max(0, Math.min(maximum, Number(cart.quantities[productId] || 0) + delta)),
    };
    void cart.queueQuantities(next).catch((error: Error) => toast.error(error.message));
  };

  return (
    <div className="min-h-[100dvh] bg-white text-slate-950">
      <PicklaTopBar slug={slug} background="#ffffff" />

      <main className="mx-auto max-w-xl px-4 pb-36 pt-[calc(env(safe-area-inset-top,0px)+96px)]">
        <h1 className="mb-5 text-2xl font-black">Butik</h1>
        {catalog.isLoading || venue.isLoading || cart.isLoading ? <Loader2 className="mx-auto mt-12 h-6 w-6 animate-spin" /> : catalog.data && !catalog.data.commerce_available ? (
          <div className="border-y border-black/10 py-8 text-center text-sm text-slate-500">{catalog.data.message || "Pickla Butik är inte öppen just nu."}</div>
        ) : products.length === 0 ? (
          <div className="border-y border-black/10 py-8 text-center text-sm text-slate-500">Inga butiksprodukter är öppna för köp just nu.</div>
        ) : (
          <div className="divide-y divide-black/10 border-y border-black/10">
            {products.map((product) => {
              const quantity = Number(cart.quantities[product.id] || 0);
              const maximum = commerceProductMaxQuantity(product);
              return (
                <article key={product.id} className="flex items-center gap-4 py-5">
                  {product.image_url ? <img src={product.image_url} alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover" /> : <span className="grid h-16 w-16 shrink-0 place-items-center bg-slate-100"><ShoppingBag className="h-5 w-5" /></span>}
                  <div className="min-w-0 flex-1">
                    <h2 className="font-black">{product.name}</h2>
                    <p className="mt-1 text-xs text-slate-500">{product.description || (product.fulfillment_presentation === "desk_pickup" ? COMMERCE_PICKUP_COPY : product.fulfillment_presentation === "digital" ? "Levereras digitalt." : "Tillgång hos Pickla.")}</p>
                    <p className="mt-2 font-bold">{formatCommerceMoney(product.base_price_sek * 100)}</p>
                  </div>
                  <div className="flex items-center gap-2" aria-label={`Antal ${product.name}`}>
                    <button type="button" onClick={() => change(product.id, -1, maximum)} disabled={quantity === 0} className="grid h-10 w-10 place-items-center rounded-full border border-black/15 disabled:text-slate-300" aria-label={`Minska ${product.name}`}><Minus className="h-4 w-4" /></button>
                    <span className="w-5 text-center font-black" aria-live="polite">{quantity}</span>
                    <button type="button" onClick={() => change(product.id, 1, maximum)} disabled={quantity >= maximum} className="grid h-10 w-10 place-items-center rounded-full bg-slate-950 text-white disabled:bg-slate-300" aria-label={`Öka ${product.name}`}><Plus className="h-4 w-4" /></button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {cart.isError ? <p className="mt-6 text-sm text-slate-600">Varukorgen kunde inte hämtas. Försök igen.</p> : null}
      </main>

      {cart.lineCount > 0 && cart.reference ? (
        <footer className="fixed inset-x-0 bottom-0 border-t border-black/10 bg-white px-4 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-3">
          <button type="button" onClick={() => navigate(`/cart?token=${encodeURIComponent(cart.reference)}&v=${encodeURIComponent(slug)}`)} disabled={cart.isUpdating} className="mx-auto flex h-14 w-full max-w-xl items-center justify-center gap-2 rounded-2xl bg-slate-950 font-black text-white disabled:bg-slate-300 disabled:text-slate-500">
            {cart.isUpdating ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShoppingBag className="h-5 w-5" />}
            Din varukorg · {cart.lineCount}
          </button>
        </footer>
      ) : null}
    </div>
  );
}
