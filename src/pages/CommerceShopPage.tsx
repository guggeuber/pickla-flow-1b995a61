import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Minus, Plus, ShoppingBag } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { apiGet } from "@/lib/api";
import { createCommerceCart, fetchCommerceCatalog, formatCommerceMoney } from "@/lib/commerce";

export default function CommerceShopPage() {
  const [params] = useSearchParams();
  const slug = params.get("v") || "pickla-arena-sthlm";
  const navigate = useNavigate();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const venue = useQuery({ queryKey: ["public-venue", slug], queryFn: () => apiGet<any>("api-bookings", "public-venue", { slug }) });
  const catalog = useQuery({ queryKey: ["commerce-catalog", venue.data?.id], queryFn: () => fetchCommerceCatalog(venue.data.id), enabled: !!venue.data?.id });
  const products = (catalog.data?.products || []).filter((product) => product.commerce_kind === "merchandise");
  const selected = useMemo(() => products.filter((product) => (quantities[product.id] || 0) > 0), [products, quantities]);
  const totalMinor = selected.reduce((sum, product) => sum + (quantities[product.id] || 0) * Number(product.base_price_sek || 0) * 100, 0);
  const createCart = useMutation({
    mutationFn: () => createCommerceCart({ venueId: venue.data.id, source: "commerce_shop", items: selected.map((product) => ({ product_id: product.id, quantity: quantities[product.id] })) }),
    onSuccess: (result) => navigate(`/cart?token=${encodeURIComponent(result.cart_token || "")}`),
    onError: (error: Error) => toast.error(error.message),
  });
  const change = (id: string, delta: number) => setQuantities((current) => ({ ...current, [id]: Math.max(0, Math.min(20, (current[id] || 0) + delta)) }));

  return (
    <div className="min-h-[100dvh] bg-[#fbf7f2] text-slate-950">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-black/10 bg-[#fbf7f2]/95 px-4 pb-3 pt-[calc(env(safe-area-inset-top,0px)+12px)] backdrop-blur"><button type="button" onClick={() => navigate(-1)} className="grid h-11 w-11 place-items-center rounded-full border border-black/10 bg-white" aria-label="Tillbaka"><ArrowLeft className="h-5 w-5" /></button><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Pickla</p><h1 className="text-xl font-black">Hämta vid disken</h1></div></header>
      <main className="mx-auto max-w-xl px-4 py-5 pb-36">
        <p className="mb-5 text-sm text-slate-600">Beställ innan du kommer. Allt hämtas på Pickla, ingen frakt.</p>
        {catalog.isLoading || venue.isLoading ? <Loader2 className="mx-auto mt-12 h-6 w-6 animate-spin" /> : products.length === 0 ? <div className="rounded-2xl border border-black/10 bg-white p-6 text-center text-sm text-slate-500">Inga butiksprodukter är öppna för köp just nu.</div> : <div className="grid gap-3">{products.map((product) => <article key={product.id} className="flex items-center gap-4 rounded-2xl border border-black/10 bg-white p-4"><span className="grid h-12 w-12 place-items-center rounded-xl bg-slate-100"><ShoppingBag className="h-5 w-5" /></span><div className="min-w-0 flex-1"><h2 className="font-black">{product.name}</h2><p className="text-xs text-slate-500">{product.description || "Hämtas vid disken."}</p><p className="mt-1 font-bold">{formatCommerceMoney(product.base_price_sek * 100)}</p></div><div className="flex items-center gap-2"><button type="button" onClick={() => change(product.id, -1)} className="grid h-9 w-9 place-items-center rounded-full border border-black/10" aria-label="Minska"><Minus className="h-4 w-4" /></button><span className="w-5 text-center font-black">{quantities[product.id] || 0}</span><button type="button" onClick={() => change(product.id, 1)} className="grid h-9 w-9 place-items-center rounded-full bg-slate-950 text-white" aria-label="Öka"><Plus className="h-4 w-4" /></button></div></article>)}</div>}
      </main>
      {selected.length > 0 ? <footer className="fixed inset-x-0 bottom-0 border-t border-black/10 bg-white px-4 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-3"><button type="button" onClick={() => createCart.mutate()} disabled={createCart.isPending} className="mx-auto flex h-14 w-full max-w-xl items-center justify-center gap-2 rounded-2xl bg-slate-950 font-black text-white disabled:opacity-50">{createCart.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : null}Granska köp · {formatCommerceMoney(totalMinor)}</button></footer> : null}
    </div>
  );
}
