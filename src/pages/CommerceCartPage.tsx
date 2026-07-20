import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, LockKeyhole, PackageCheck, ShoppingBag } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { apiPost } from "@/lib/api";
import {
  fetchCommerceOrder,
  formatCommerceMoney,
  readCommerceDraftReference,
  rememberCommerceDraftReference,
  type CommerceResolvedOrder,
} from "@/lib/commerce";

export default function CommerceCartPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [draftReference] = useState(
    () => params.get("token") || readCommerceDraftReference(),
  );
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    if (!draftReference) return;
    rememberCommerceDraftReference(draftReference);
    if (params.has("token")) navigate("/cart", { replace: true });
  }, [draftReference, navigate, params]);

  const orderQuery = useQuery({
    queryKey: ["commerce-order", draftReference, user?.id || "guest"],
    queryFn: () => fetchCommerceOrder(draftReference),
    enabled: draftReference.length >= 32 && !authLoading,
  });

  const resolveQuery = useQuery({
    queryKey: ["commerce-resolve", draftReference, orderQuery.data?.order.version, user?.id || "guest"],
    enabled: orderQuery.data?.order.status === "draft",
    queryFn: () => apiPost<CommerceResolvedOrder>("api-commerce", "resolve", {
      draft_ref: draftReference,
    }),
  });
  const lines = resolveQuery.data?.lines || orderQuery.data?.lines || [];
  const total = resolveQuery.data?.order.total_inc_vat_minor
    ?? orderQuery.data?.order.total_inc_vat_minor
    ?? 0;

  const checkout = useMutation({
    mutationFn: () => apiPost<{ url?: string; free?: boolean; redirect?: string }>("api-commerce", "checkout", {
      draft_ref: draftReference,
      expected_version: orderQuery.data?.order.version,
      guest_email: email.trim() || null,
      guest_name: name.trim() || null,
      success_path: "/commerce/confirmed",
      cancel_path: "/cart",
    }),
    onSuccess: (result) => {
      if (result.free && result.redirect) navigate(result.redirect, { replace: true });
      else if (result.url) window.location.assign(result.url);
      else toast.error("Kassan kunde inte öppnas");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (orderQuery.isLoading || authLoading) return <div className="min-h-[100dvh] bg-[#fbf7f2] grid place-items-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!draftReference || orderQuery.error || !orderQuery.data) return <div className="min-h-[100dvh] bg-[#fbf7f2] grid place-items-center px-6 text-center"><p>Köpet kunde inte öppnas.</p></div>;
  if (orderQuery.data.order.status !== "draft") {
    navigate("/commerce/confirmed", { replace: true });
    return null;
  }

  const needsEmail = !user
    && !email.trim()
    && !orderQuery.data.order.contact_email_present;

  return (
    <div className="min-h-[100dvh] bg-[#fbf7f2] text-slate-950">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-black/10 bg-[#fbf7f2]/95 px-4 pb-3 pt-[calc(env(safe-area-inset-top,0px)+12px)] backdrop-blur">
        <button type="button" onClick={() => navigate(-1)} className="grid h-11 w-11 place-items-center rounded-full border border-black/10 bg-white" aria-label="Tillbaka"><ArrowLeft className="h-5 w-5" /></button>
        <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Pickla</p><h1 className="text-xl font-black">Ditt köp</h1></div>
      </header>
      <main className="mx-auto grid w-full max-w-xl gap-4 px-4 py-5 pb-40">
        <section className="overflow-hidden rounded-2xl border border-black/10 bg-white">
          {lines.map((line) => (
            <div key={line.id} className="flex items-start justify-between gap-4 border-b border-black/10 px-4 py-4 last:border-0">
              <div className="flex min-w-0 gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100">{line.commerce_kind === "participation" ? <PackageCheck className="h-5 w-5" /> : <ShoppingBag className="h-5 w-5" />}</span>
                <div><p className="font-bold">{line.product_name}</p><p className="mt-0.5 text-xs text-slate-500">{line.fulfillment_type === "desk_pickup" ? "Hämtas vid disken" : "Personlig plats"}{line.quantity > 1 ? ` · ${line.quantity} st` : ""}</p></div>
              </div>
              <p className="shrink-0 font-black">{formatCommerceMoney(Number(line.line_total_inc_vat_minor || 0))}</p>
            </div>
          ))}
        </section>
        {!user ? (
          <section className="grid gap-3 rounded-2xl border border-black/10 bg-white p-4">
            <div><h2 className="font-black">Kvitto och biljett</h2><p className="text-sm text-slate-500">Vi skickar din säkra orderlänk till e-postadressen.</p></div>
            {orderQuery.data.order.contact_email_present ? <p className="text-sm font-semibold text-emerald-700">E-post finns sparad för det här köpet.</p> : null}
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Namn" className="h-12 rounded-xl border border-black/15 px-3 text-base" />
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="E-post" type="email" className="h-12 rounded-xl border border-black/15 px-3 text-base" />
          </section>
        ) : null}
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500"><LockKeyhole className="h-4 w-4" /> En betalning, ett kvitto. Moms beräknas per rad.</div>
      </main>
      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-black/10 bg-white px-4 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-3">
        <div className="mx-auto max-w-xl">
          <div className="mb-3 flex items-center justify-between"><span className="text-sm text-slate-500">Totalt</span><span className="text-2xl font-black">{formatCommerceMoney(total)}</span></div>
          <button type="button" onClick={() => checkout.mutate()} disabled={checkout.isPending || resolveQuery.isLoading || needsEmail} className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 text-base font-black text-white disabled:opacity-40">{checkout.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : null}{total === 0 ? "Boka plats" : `Betala ${formatCommerceMoney(total)}`}</button>
        </div>
      </footer>
    </div>
  );
}
