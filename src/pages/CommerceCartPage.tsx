import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
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

  if (orderQuery.isLoading || authLoading) return <div className="grid min-h-[100dvh] place-items-center bg-white"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (authenticatedDraftReference && !user) return <div className="grid min-h-[100dvh] place-items-center bg-white px-6 text-center"><div><p className="mb-4 font-bold">Logga in för att fortsätta ditt köp.</p><button type="button" onClick={() => { preserveIntendedRoute(`/cart?token=${encodeURIComponent(token)}`); navigate("/auth"); }} className="h-12 rounded-2xl bg-slate-950 px-6 font-black text-white">Logga in</button></div></div>;
  if (!token || orderQuery.error || !orderQuery.data) return <div className="grid min-h-[100dvh] place-items-center bg-white px-6 text-center"><p>{orderQuery.error instanceof PurchaseSessionError ? PURCHASE_SESSION_ERROR_MESSAGE : "Varukorgen kunde inte öppnas."}</p></div>;
  if (orderQuery.data.order.status !== "draft") {
    navigate(`/commerce/confirmed?token=${encodeURIComponent(token)}`, { replace: true });
    return null;
  }

  const showGuestDetails = runAsGuest;
  const showEmailRecovery = forceEmailEntry && !showGuestDetails;
  const needsEmail = (showGuestDetails || showEmailRecovery) && !email.trim();

  return (
    <div className="min-h-[100dvh] bg-white text-slate-950">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-black/10 bg-white/95 px-4 pb-3 pt-[calc(env(safe-area-inset-top,0px)+12px)] backdrop-blur">
        <button type="button" onClick={() => navigate(-1)} className="grid h-11 w-11 place-items-center rounded-full border border-black/10 bg-white" aria-label="Tillbaka"><ArrowLeft className="h-5 w-5" /></button>
        <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Pickla</p><h1 className="text-xl font-black">Ordersammanfattning</h1></div>
      </header>
      <main className="mx-auto w-full max-w-xl px-5 py-6 pb-52">
        {activity ? (
          <section className="pb-6">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Aktivitet</p>
            <h2 className="mt-1 text-lg font-black">{activity.name}</h2>
            <p className="mt-2 text-sm font-semibold text-slate-600">{activityDate} · {String(activity.start_time || "").slice(0, 5)}–{String(activity.end_time || "").slice(0, 5)}</p>
            {activity.venue_name ? <p className="mt-1 text-sm text-slate-500">{activity.venue_name}</p> : null}
          </section>
        ) : null}
        <section className={activity ? "border-t border-black/10" : ""}>
          {lines.map((line) => {
            const isRacketLine = commerceRacketPickupQuantity([line]) > 0;
            const isActivityParticipationLine = Boolean(activity) && line.commerce_kind === "participation";
            const lineName = isActivityParticipationLine ? "Personlig plats" : line.product_name;
            const lineMetadata = isRacketLine && racketInstruction
              ? `Antal ${line.quantity} · ${racketInstruction}`
              : line.fulfillment_type === "desk_pickup"
                ? `Antal ${line.quantity} · Hämtas ut i desken`
                : isActivityParticipationLine
                  ? null
                  : "Personlig plats";
            return (
              <div key={line.id} className="flex items-start justify-between gap-4 border-b border-black/10 py-5 last:border-b-0">
                <div className="min-w-0">
                  <p className="font-bold">{lineName}</p>
                  {lineMetadata ? <p className="mt-1 text-xs leading-relaxed text-slate-600">{lineMetadata}</p> : null}
                  <p className="mt-1 text-[11px] font-semibold text-slate-400">Varav moms {formatCommerceMoney(lineVatMinor(line))}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-black">{includedLineLabel(line) || formatCommerceMoney(lineTotalMinor(line))}</p>
                  {originalUnitPriceMinor(line) > Number(line.unit_price_minor || 0) ? <p className="mt-1 text-xs text-slate-400 line-through">{formatCommerceMoney(originalUnitPriceMinor(line) * Number(line.quantity || 1))}</p> : null}
                </div>
              </div>
            );
          })}
        </section>
        {showGuestDetails || showEmailRecovery ? (
          <section className="grid gap-3 border-t border-black/10 pt-6">
            <div><h2 className="font-black">Dina uppgifter</h2><p className="text-sm text-slate-500">Vi skickar kvitto och orderinformation till din e-postadress.</p></div>
            {showGuestDetails ? <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Namn" className="h-12 rounded-xl border border-black/15 px-3 text-base outline-none focus:border-slate-950 focus:ring-1 focus:ring-slate-950" /> : null}
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="E-post" type="email" className="h-12 rounded-xl border border-black/15 px-3 text-base outline-none focus:border-slate-950 focus:ring-1 focus:ring-slate-950" />
          </section>
        ) : null}
        {resolveQuery.isError ? <p className="mt-6 border-t border-black/15 pt-5 text-sm font-semibold text-slate-700">Priset eller platsen kunde inte bekräftas. Gå tillbaka och försök igen.</p> : null}
      </main>
      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-black/10 bg-white px-4 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-3">
        <div className="mx-auto max-w-xl">
          <div className="mb-1 flex items-center justify-between"><span className="text-sm text-slate-500">Totalt</span><span className="text-2xl font-black">{serverPricingReady ? formatCommerceMoney(total) : "—"}</span></div>
          <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-500"><span>Varav moms</span><span>{serverPricingReady ? formatCommerceMoney(totalVat) : "—"}</span></div>
          {totalSavings > 0 ? <p className="mb-3 text-sm font-bold text-slate-700">Du sparar {formatCommerceMoney(totalSavings)}</p> : null}
          <p className="mb-3 text-center text-xs font-semibold text-slate-500">Platsen bekräftas direkt efter betalning.</p>
          <button type="button" onClick={() => checkout.mutate()} disabled={checkout.isPending || !serverPricingReady || needsEmail} className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 text-base font-black text-white disabled:bg-slate-300 disabled:text-slate-500 disabled:opacity-100">{checkout.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : null}{serverPricingReady ? `Betala ${formatCommerceMoney(total)}` : "Kontrollerar pris…"}</button>
        </div>
      </footer>
    </div>
  );
}
