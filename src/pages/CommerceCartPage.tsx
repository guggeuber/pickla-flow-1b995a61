import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, LockKeyhole, PackageCheck, ShoppingBag } from "lucide-react";
import { DateTime } from "luxon";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { apiPost } from "@/lib/api";
import {
  commerceJourneyId,
  commerceRacketOrderSummaryInstruction,
  commerceRacketPickupQuantity,
  fetchCommerceOrder,
  formatCommerceMoney,
  isCommerceOrderIdReference,
  type CommerceOrderLine,
} from "@/lib/commerce";
import { preserveIntendedRoute } from "@/lib/entryResolver";
import {
  CHECKOUT_EMAIL_REQUIRED_MESSAGE,
  PURCHASE_SESSION_ERROR_MESSAGE,
  PurchaseSessionError,
  isCartVersionConflict,
  isCheckoutEmailRequired,
  purchaseErrorMessage,
  withPurchaseSessionRecovery,
} from "@/lib/purchaseSessionRecovery";

type ResolvedLine = CommerceOrderLine & { unit_price_minor: number; product_name: string };

function nestedNumber(value: unknown, path: string[]) {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return 0;
    current = (current as Record<string, unknown>)[key];
  }
  return Number(current || 0);
}

function lineTotalMinor(line: CommerceOrderLine) {
  return Number(line.unit_price_minor || 0) * Number(line.quantity || 1);
}

function lineVatMinor(line: CommerceOrderLine) {
  const total = lineTotalMinor(line);
  const rate = Number(line.vat_rate || 0);
  return rate > 0 ? Math.round(total * rate / (100 + rate)) : 0;
}

function originalUnitPriceMinor(line: CommerceOrderLine) {
  const resolvedBase = nestedNumber(line.resolver_snapshot, ["debug", "base_amount_sek"]);
  const productBase = nestedNumber(line.product_snapshot, ["base_price_sek"]);
  return Math.max(Number(line.unit_price_minor || 0), Math.round((resolvedBase || productBase) * 100));
}

function includedLineLabel(line: CommerceOrderLine) {
  if (line.commerce_kind !== "participation" || Number(line.unit_price_minor || 0) !== 0) return "";
  const snapshot = line.resolver_snapshot || {};
  const debug = (snapshot.debug && typeof snapshot.debug === "object" ? snapshot.debug : {}) as Record<string, unknown>;
  const reason = String(snapshot.pricing_reason || debug.pricing_reason || "");
  const accessDecision = String(snapshot.access_decision || debug.access_decision || "");
  const membershipName = String(snapshot.membership_tier_name || debug.membership_tier_name || "");
  if (reason === "playing_host" || reason === "host_comp") return "Ingår — du är värd";
  if (accessDecision === "day_access_included") return "Ingår idag";
  return `Ingår i ${membershipName || "medlemskap"}`;
}

export default function CommerceCartPage() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const checkoutInFlight = useRef<Promise<{ url?: string; free?: boolean; redirect?: string }> | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [guestSessionFallback, setGuestSessionFallback] = useState(false);
  const [forceEmailEntry, setForceEmailEntry] = useState(false);

  const authenticatedDraftReference = isCommerceOrderIdReference(token);
  const runAsGuest = !authenticatedDraftReference && (guestSessionFallback || !user);

  const orderQuery = useQuery({
    queryKey: ["commerce-order", token, user?.id || "guest"],
    queryFn: () => runAsGuest
      ? fetchCommerceOrder(token, { auth: "omit" })
      : withPurchaseSessionRecovery(
        () => fetchCommerceOrder(token),
        undefined,
        authenticatedDraftReference ? undefined : async () => {
          setGuestSessionFallback(true);
          return fetchCommerceOrder(token, { auth: "omit" });
        },
      ),
    enabled: token.length >= 32 && !authLoading && (!authenticatedDraftReference || !!user),
  });
  const resolveQuery = useQuery({
    queryKey: ["commerce-resolve", token, orderQuery.data?.order.version, user?.id || "guest"],
    enabled: orderQuery.data?.order.status === "draft",
    queryFn: () => runAsGuest
      ? apiPost<{ order: { id: string; version: number; currency: string }; lines: ResolvedLine[]; checkout_ready?: boolean }>("api-commerce", "resolve", { token }, { auth: "omit" })
      : withPurchaseSessionRecovery(
        () => apiPost<{ order: { id: string; version: number; currency: string }; lines: ResolvedLine[]; checkout_ready?: boolean }>("api-commerce", "resolve", { token }),
        undefined,
        authenticatedDraftReference ? undefined : async () => {
          setGuestSessionFallback(true);
          return apiPost<{ order: { id: string; version: number; currency: string }; lines: ResolvedLine[]; checkout_ready?: boolean }>("api-commerce", "resolve", { token }, { auth: "omit" });
        },
      ),
  });
  const lines = useMemo(
    () => resolveQuery.data?.lines || orderQuery.data?.lines || [],
    [orderQuery.data?.lines, resolveQuery.data?.lines],
  );
  const total = useMemo(() => lines.reduce((sum, line) => sum + lineTotalMinor(line), 0), [lines]);
  const totalVat = useMemo(() => lines.reduce((sum, line) => sum + lineVatMinor(line), 0), [lines]);
  const totalSavings = useMemo(() => lines.reduce((sum, line) => (
    sum + Math.max(0, originalUnitPriceMinor(line) - Number(line.unit_price_minor || 0)) * Number(line.quantity || 1)
  ), 0), [lines]);
  const hasParticipation = lines.some((line) => line.commerce_kind === "participation");
  const activity = orderQuery.data?.activity_access;
  const activityDate = activity
    ? DateTime.fromISO(activity.session_date, { zone: "Europe/Stockholm" }).setLocale("sv").toFormat("cccc d MMMM")
    : "";
  const racketQuantity = commerceRacketPickupQuantity(lines);
  const racketInstruction = commerceRacketOrderSummaryInstruction(racketQuantity);
  const serverPricingReady = resolveQuery.isSuccess && !resolveQuery.isError;

  const checkout = useMutation({
    mutationFn: () => {
      if (checkoutInFlight.current) return checkoutInFlight.current;
      const sendCheckout = (auth: "session" | "omit") => apiPost<{ url?: string; free?: boolean; redirect?: string }>("api-commerce", "checkout", {
        token,
        expected_version: orderQuery.data?.order.version,
        guest_email: email.trim() || null,
        guest_name: name.trim() || null,
        journey_id: commerceJourneyId(),
        success_path: `/commerce/confirmed?token=${encodeURIComponent(token)}`,
        cancel_path: `/cart?token=${encodeURIComponent(token)}`,
      }, { auth });
      const request = runAsGuest
        ? sendCheckout("omit")
        : withPurchaseSessionRecovery(
          () => sendCheckout("session"),
          undefined,
          hasParticipation ? undefined : async () => {
            setGuestSessionFallback(true);
            if (!email.trim() && !orderQuery.data?.order.contact_email_present) {
              setForceEmailEntry(true);
              throw new Error(CHECKOUT_EMAIL_REQUIRED_MESSAGE);
            }
            return sendCheckout("omit");
          },
        );
      checkoutInFlight.current = request;
      const clearRequest = () => {
        if (checkoutInFlight.current === request) checkoutInFlight.current = null;
      };
      void request.then(clearRequest, clearRequest);
      return request;
    },
    onSuccess: (result) => {
      if (result.free && result.redirect) navigate(result.redirect, { replace: true });
      else if (result.url) window.location.assign(result.url);
      else toast.error("Kassan kunde inte öppnas");
    },
    onError: async (error: Error) => {
      if (isCheckoutEmailRequired(error)) {
        setForceEmailEntry(true);
        await orderQuery.refetch();
        toast.error(CHECKOUT_EMAIL_REQUIRED_MESSAGE);
        return;
      }
      if (isCartVersionConflict(error)) {
        await orderQuery.refetch();
        toast.info("Köpet uppdaterades. Kontrollera och försök igen.");
        return;
      }
      toast.error(purchaseErrorMessage(error, "Kassan kunde inte öppnas"));
    },
  });

  if (orderQuery.isLoading || authLoading) return <div className="min-h-[100dvh] bg-[#fbf7f2] grid place-items-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (authenticatedDraftReference && !user) return <div className="min-h-[100dvh] bg-[#fbf7f2] grid place-items-center px-6 text-center"><div><p className="mb-4 font-bold">Logga in för att fortsätta ditt köp.</p><button type="button" onClick={() => { preserveIntendedRoute(`/cart?token=${encodeURIComponent(token)}`); navigate("/auth"); }} className="h-12 rounded-2xl bg-slate-950 px-6 font-black text-white">Logga in</button></div></div>;
  if (!token || orderQuery.error || !orderQuery.data) return <div className="min-h-[100dvh] bg-[#fbf7f2] grid place-items-center px-6 text-center"><p>{orderQuery.error instanceof PurchaseSessionError ? PURCHASE_SESSION_ERROR_MESSAGE : "Varukorgen kunde inte öppnas."}</p></div>;
  if (orderQuery.data.order.status !== "draft") {
    navigate(`/commerce/confirmed?token=${encodeURIComponent(token)}`, { replace: true });
    return null;
  }

  const showGuestDetails = runAsGuest;
  const showEmailRecovery = forceEmailEntry && !showGuestDetails;
  const needsEmail = (showGuestDetails || showEmailRecovery) && !email.trim();

  return (
    <div className="min-h-[100dvh] bg-[#fbf7f2] text-slate-950">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-black/10 bg-[#fbf7f2]/95 px-4 pb-3 pt-[calc(env(safe-area-inset-top,0px)+12px)] backdrop-blur">
        <button type="button" onClick={() => navigate(-1)} className="grid h-11 w-11 place-items-center rounded-full border border-black/10 bg-white" aria-label="Tillbaka"><ArrowLeft className="h-5 w-5" /></button>
        <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Pickla</p><h1 className="text-xl font-black">Ordersammanfattning</h1></div>
      </header>
      <main className={`mx-auto grid w-full max-w-xl gap-4 px-4 py-5 ${racketInstruction ? "pb-64" : "pb-52"}`}>
        {activity ? (
          <section className="rounded-2xl border border-black/10 bg-white p-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Aktivitet</p>
            <h2 className="mt-1 text-lg font-black">{activity.name}</h2>
            <p className="mt-2 text-sm font-semibold text-slate-600">{activityDate} · {String(activity.start_time || "").slice(0, 5)}–{String(activity.end_time || "").slice(0, 5)}</p>
            {activity.venue_name ? <p className="mt-1 text-sm text-slate-500">{activity.venue_name}</p> : null}
          </section>
        ) : null}
        <section className="overflow-hidden rounded-2xl border border-black/10 bg-white">
          {lines.map((line) => (
            <div key={line.id} className="flex items-start justify-between gap-4 border-b border-black/10 px-4 py-4 last:border-0">
              <div className="flex min-w-0 gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100">{line.commerce_kind === "participation" ? <PackageCheck className="h-5 w-5" /> : <ShoppingBag className="h-5 w-5" />}</span>
                <div>
                  <p className="font-bold">{line.product_name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{line.fulfillment_type === "desk_pickup" ? `Antal ${line.quantity} · Hämtas vid desken` : "Personlig plats"}</p>
                  <p className="mt-1 text-[11px] font-semibold text-slate-400">Varav moms {formatCommerceMoney(lineVatMinor(line))}</p>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className={includedLineLabel(line) ? "font-black text-emerald-700" : "font-black"}>{includedLineLabel(line) || formatCommerceMoney(lineTotalMinor(line))}</p>
                {originalUnitPriceMinor(line) > Number(line.unit_price_minor || 0) ? <p className="mt-1 text-xs text-slate-400 line-through">{formatCommerceMoney(originalUnitPriceMinor(line) * Number(line.quantity || 1))}</p> : null}
              </div>
            </div>
          ))}
        </section>
        {showGuestDetails || showEmailRecovery ? (
          <section className="grid gap-3 rounded-2xl border border-black/10 bg-white p-4">
            <div><h2 className="font-black">Kvitto och uthämtning</h2><p className="text-sm text-slate-500">Vi skickar din säkra orderlänk till e-postadressen.</p></div>
            {showGuestDetails ? <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Namn" className="h-12 rounded-xl border border-black/15 px-3 text-base" /> : null}
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="E-post" type="email" className="h-12 rounded-xl border border-black/15 px-3 text-base" />
          </section>
        ) : null}
        {resolveQuery.isError ? <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">Priset eller platsen kunde inte bekräftas. Gå tillbaka och försök igen.</p> : null}
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500"><LockKeyhole className="h-4 w-4" /> En betalning, ett kvitto. Moms beräknas per rad.</div>
      </main>
      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-black/10 bg-white px-4 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-3">
        <div className="mx-auto max-w-xl">
          {racketInstruction ? <p className="mb-3 rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold leading-relaxed text-slate-600">{racketInstruction}</p> : null}
          <div className="mb-1 flex items-center justify-between"><span className="text-sm text-slate-500">Totalt</span><span className="text-2xl font-black">{serverPricingReady ? formatCommerceMoney(total) : "—"}</span></div>
          <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-500"><span>Varav moms</span><span>{serverPricingReady ? formatCommerceMoney(totalVat) : "—"}</span></div>
          {totalSavings > 0 ? <p className="mb-3 text-sm font-bold text-emerald-700">Du sparar {formatCommerceMoney(totalSavings)}</p> : null}
          <p className="mb-3 text-center text-xs font-semibold text-slate-500">Platsen bekräftas direkt efter betalning.</p>
          <button type="button" onClick={() => checkout.mutate()} disabled={checkout.isPending || !serverPricingReady || needsEmail} className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 text-base font-black text-white disabled:opacity-40">{checkout.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : null}{serverPricingReady ? `Betala ${formatCommerceMoney(total)}` : "Kontrollerar pris…"}</button>
        </div>
      </footer>
    </div>
  );
}
