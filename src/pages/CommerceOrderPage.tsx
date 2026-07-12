import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, PackageCheck, ReceiptText } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { fetchCommerceOrder, formatCommerceMoney } from "@/lib/commerce";

export default function CommerceOrderPage() {
  const [params] = useSearchParams();
  const routeParams = useParams<{ token?: string }>();
  const token = routeParams.token || params.get("token") || "";
  const query = useQuery({ queryKey: ["commerce-order", token], queryFn: () => fetchCommerceOrder(token), enabled: token.length >= 32, refetchInterval: (state) => state.state.data?.order.status === "checkout_pending" ? 1200 : false });
  if (query.isLoading) return <div className="min-h-[100dvh] bg-[#fbf7f2] grid place-items-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!query.data) return <div className="min-h-[100dvh] bg-[#fbf7f2] grid place-items-center px-6 text-center">Ordern kunde inte öppnas.</div>;
  const { order, lines, receipt } = query.data;
  const waiting = order.status === "checkout_pending";
  return (
    <div className="min-h-[100dvh] bg-[#fbf7f2] px-4 pb-12 pt-[calc(env(safe-area-inset-top,0px)+36px)] text-slate-950">
      <main className="mx-auto max-w-lg">
        <div className="mb-7 text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-emerald-700">{waiting ? <Loader2 className="h-7 w-7 animate-spin" /> : <CheckCircle2 className="h-7 w-7" />}</span><h1 className="mt-4 text-3xl font-black">{waiting ? "Vi bekräftar ditt köp" : "Ditt köp är klart"}</h1><p className="mt-2 text-sm text-slate-500">{waiting ? "Det tar vanligtvis bara några sekunder." : "Spara den här sidan för kvitto och uthämtning."}</p></div>
        <section className="overflow-hidden rounded-2xl border border-black/10 bg-white">
          {lines.map((line) => <div key={line.id} className="flex items-center justify-between gap-3 border-b border-black/10 px-4 py-4 last:border-0"><div className="flex items-center gap-3"><PackageCheck className="h-5 w-5 text-slate-500" /><div><p className="font-bold">{line.product_name}{line.quantity > 1 ? ` · ${line.quantity} st` : ""}</p><p className="text-xs text-slate-500">{line.fulfillment_type === "desk_pickup" ? line.fulfillment_status === "collected" ? "Uthämtad" : "Hämtas vid disken" : "Din plats"}</p></div></div><p className="font-black">{formatCommerceMoney(line.line_total_inc_vat_minor || line.unit_price_minor * line.quantity)}</p></div>)}
        </section>
        <section className="mt-4 rounded-2xl border border-black/10 bg-white p-4"><div className="flex items-center justify-between"><span className="text-sm text-slate-500">Totalt</span><strong className="text-xl">{formatCommerceMoney(order.total_inc_vat_minor)}</strong></div>{receipt ? <p className="mt-3 flex items-center gap-2 text-xs text-slate-500"><ReceiptText className="h-4 w-4" /> Kvitto {(receipt as any).receipt_number}</p> : null}</section>
        <div className="mt-6 grid gap-2"><Link to="/my" className="flex h-12 items-center justify-center rounded-2xl bg-slate-950 font-bold text-white">Till Min sida</Link><Link to="/shop" className="flex h-12 items-center justify-center rounded-2xl border border-black/10 bg-white font-bold">Fortsätt handla</Link></div>
      </main>
    </div>
  );
}
