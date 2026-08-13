import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Minus, Plus, ShoppingBag, Ticket, Trash2 } from "lucide-react";
import { DateTime } from "luxon";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { PicklaTopBar } from "@/components/PicklaTopBar";
import { apiPost } from "@/lib/api";
import {
  COMMERCE_PICKUP_COPY,
  commerceJourneyId,
  commerceRacketOrderSummaryInstruction,
  commerceRacketPickupQuantity,
  fetchCommerceOrder,
  formatCommerceMoney,
  isCommerceOrderIdReference,
  notifyStandaloneCartUpdated,
  updateCommerceCart,
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
  const venueSlug = params.get("v") || "pickla-arena-sthlm";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  const checkoutInFlight = useRef<Promise<{ url?: string; free?: boolean; redirect?: string }> | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [guestSessionFallback, setGuestSessionFallback] = useState(false);
  const [forceEmailEntry, setForceEmailEntry] = useState(false);
  const [standaloneQuantities, setStandaloneQuantities] = useState<Record<string, number> | null>(null);
  const [cartUpdatesPending, setCartUpdatesPending] = useState(0);
  const cartUpdateQueue = useRef<Promise<void>>(Promise.resolve());

  const authenticatedDraftReference = isCommerceOrderIdReference(token);
  const runAsGuest = !authenticatedDraftReference && (guestSessionFallback || !user);

  const orderQueryKey = useMemo(() => ["commerce-order", token, user?.id || "guest"] as const, [token, user?.id]);
  const orderQuery = useQuery({
    queryKey: orderQueryKey,
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
  const standaloneShopCart = orderQuery.data?.order.draft_scope === "shop";
  const serverQuantities = useMemo(() => Object.fromEntries(lines.map((line) => [String(line.product_id || ""), Number(line.quantity || 0)])), [lines]);
  const visibleQuantities = standaloneQuantities || serverQuantities;
  const visibleLines = useMemo(() => standaloneShopCart
    ? lines.filter((line) => Number(visibleQuantities[String(line.product_id || "")] || 0) > 0).map((line) => ({ ...line, quantity: Number(visibleQuantities[String(line.product_id || "")] || 0) }))
    : lines, [lines, standaloneShopCart, visibleQuantities]);
  const visibleItemCount = useMemo(() => visibleLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0), [visibleLines]);
  const total = useMemo(() => visibleLines.reduce((sum, line) => sum + lineTotalMinor(line), 0), [visibleLines]);
  const totalSavings = useMemo(() => lines.reduce((sum, line) => (
    sum + Math.max(0, originalUnitPriceMinor(line) - Number(line.unit_price_minor || 0)) * Number(line.quantity || 1)
  ), 0), [lines]);
  const hasParticipation = lines.some((line) => line.commerce_kind === "participation");
  const activity = orderQuery.data?.activity_access;
  const course = orderQuery.data?.course_access;
  const activityDate = activity
    ? DateTime.fromISO(activity.session_date, { zone: "Europe/Stockholm" }).setLocale("sv").toFormat("cccc d MMMM")
    : "";
  const racketQuantity = commerceRacketPickupQuantity(lines);
  const racketInstruction = commerceRacketOrderSummaryInstruction(racketQuantity);
  const serverPricingReady = resolveQuery.isSuccess && !resolveQuery.isError;

  useEffect(() => {
    if (!standaloneShopCart || cartUpdatesPending > 0) return;
    setStandaloneQuantities(null);
  }, [cartUpdatesPending, standaloneShopCart, serverQuantities]);

  const queueStandaloneUpdate = (next: Record<string, number>) => {
    const desired = Object.fromEntries(Object.entries(next).filter(([, quantity]) => Number(quantity) > 0));
    setStandaloneQuantities(desired);
    setCartUpdatesPending((count) => count + 1);
    const task = cartUpdateQueue.current.then(async () => {
      const latestResult = await orderQuery.refetch();
      const latest = latestResult.data;
      if (!latest) throw new Error("Varukorgen kunde inte uppdateras.");
      const items = Object.entries(desired).map(([productId, quantity]) => ({ product_id: productId, quantity }));
      const sendUpdate = (auth: "session" | "omit") => updateCommerceCart({
        reference: token,
        expectedVersion: latest.order.version,
        items,
      }, { auth });
      const updated = runAsGuest
        ? await sendUpdate("omit")
        : await withPurchaseSessionRecovery(
          () => sendUpdate("session"),
          undefined,
          authenticatedDraftReference ? undefined : () => sendUpdate("omit"),
        );
      queryClient.setQueryData(orderQueryKey, updated);
      if (items.length > 0) {
        const sendResolve = (auth: "session" | "omit") => apiPost<{ order: { id: string; version: number; currency: string }; lines: ResolvedLine[]; checkout_ready?: boolean }>("api-commerce", "resolve", { token }, { auth });
        const resolved = runAsGuest
          ? await sendResolve("omit")
          : await withPurchaseSessionRecovery(
            () => sendResolve("session"),
            undefined,
            authenticatedDraftReference ? undefined : () => sendResolve("omit"),
          );
        queryClient.setQueryData(["commerce-resolve", token, updated.order.version, user?.id || "guest"], resolved);
      } else {
        queryClient.setQueryData(["commerce-resolve", token, updated.order.version, user?.id || "guest"], {
          order: { id: updated.order.id, version: updated.order.version, currency: updated.order.currency },
          lines: [],
          checkout_ready: false,
        });
      }
      notifyStandaloneCartUpdated(latest.order.venue_id);
    }).catch(async (error: Error) => {
      setStandaloneQuantities(null);
      await orderQuery.refetch();
      toast.error(error.message || "Varukorgen kunde inte uppdateras.");
      throw error;
    }).finally(() => setCartUpdatesPending((count) => Math.max(0, count - 1)));
    cartUpdateQueue.current = task.catch(() => undefined);
    return task;
  };

  const checkout = useMutation({
    mutationFn: () => {
      if (checkoutInFlight.current) return checkoutInFlight.current;
      const sendCheckout = (auth: "session" | "omit") => apiPost<{ url?: string; free?: boolean; redirect?: string }>("api-commerce", "checkout", {
        token,
        expected_version: orderQuery.data?.order.version,
        guest_email: email.trim() || null,
        guest_name: name.trim() || null,
        journey_id: commerceJourneyId(),
        success_path: `/commerce/confirmed?token=${encodeURIComponent(token)}&v=${encodeURIComponent(resolvedVenueSlug)}`,
        cancel_path: `/cart?token=${encodeURIComponent(token)}&v=${encodeURIComponent(resolvedVenueSlug)}`,
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
      if (standaloneShopCart && (result.free || result.url) && orderQuery.data?.order.venue_id) {
        notifyStandaloneCartUpdated(orderQuery.data.order.venue_id);
      }
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

  const resolvedVenueSlug = activity?.venue_slug || course?.venue_slug || venueSlug;
  if (orderQuery.isLoading || authLoading) return <div className="min-h-[100dvh] bg-white"><PicklaTopBar slug={resolvedVenueSlug} background="#ffffff" /><div className="grid min-h-[100dvh] place-items-center pt-20"><Loader2 className="h-6 w-6 animate-spin" /></div></div>;
  if (authenticatedDraftReference && !user) return <div className="min-h-[100dvh] bg-white"><PicklaTopBar slug={resolvedVenueSlug} background="#ffffff" /><div className="grid min-h-[100dvh] place-items-center px-6 pt-20 text-center"><div><p className="mb-4 font-bold">Logga in för att fortsätta ditt köp.</p><button type="button" onClick={() => { preserveIntendedRoute(`/cart?token=${encodeURIComponent(token)}&v=${encodeURIComponent(resolvedVenueSlug)}`); navigate("/auth"); }} className="h-12 rounded-2xl bg-slate-950 px-6 font-black text-white">Logga in</button></div></div></div>;
  if (!token || orderQuery.error || !orderQuery.data) return <div className="min-h-[100dvh] bg-white"><PicklaTopBar slug={resolvedVenueSlug} background="#ffffff" /><div className="grid min-h-[100dvh] place-items-center px-6 pt-20 text-center"><p>{orderQuery.error instanceof PurchaseSessionError ? PURCHASE_SESSION_ERROR_MESSAGE : "Varukorgen kunde inte öppnas."}</p></div></div>;
  if (orderQuery.data.order.status !== "draft") {
    navigate(`/commerce/confirmed?token=${encodeURIComponent(token)}&v=${encodeURIComponent(resolvedVenueSlug)}`, { replace: true });
    return null;
  }

  const showGuestDetails = runAsGuest;
  const showEmailRecovery = forceEmailEntry && !showGuestDetails;
  const needsEmail = (showGuestDetails || showEmailRecovery) && !email.trim();

  return (
    <div className="min-h-[100dvh] bg-white text-slate-950">
      <PicklaTopBar slug={resolvedVenueSlug} background="#ffffff" />
      <main className={`mx-auto w-full max-w-xl px-5 pt-[calc(env(safe-area-inset-top,0px)+96px)] ${standaloneShopCart && visibleLines.length === 0 ? "pb-16" : "pb-52"}`}>
        <div className="mb-5 flex items-end justify-between gap-4">
          <h1 className="text-2xl font-black">{standaloneShopCart ? "Din varukorg" : "Ordersammanfattning"}</h1>
          {standaloneShopCart ? <span className="shrink-0 text-sm font-bold text-slate-500">{visibleItemCount} {visibleItemCount === 1 ? "artikel" : "artiklar"}</span> : null}
        </div>
        {activity ? (
          <section className="pb-6">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Aktivitet</p>
            <h2 className="mt-1 text-lg font-black">{activity.name}</h2>
            <p className="mt-2 text-sm font-semibold text-slate-600">{activityDate} · {String(activity.start_time || "").slice(0, 5)}–{String(activity.end_time || "").slice(0, 5)}</p>
            {activity.venue_name ? <p className="mt-1 text-sm text-slate-500">{activity.venue_name}</p> : null}
          </section>
        ) : null}
        {course ? (
          <section className="pb-6">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Kurs</p>
            <h2 className="mt-1 text-lg font-black">{course.name}</h2>
            <p className="mt-2 text-sm font-semibold text-slate-600">{course.total_sessions} tillfällen · start {DateTime.fromISO(course.start_date).setLocale("sv").toFormat("d MMMM")}</p>
            {course.participant_name ? <p className="mt-1 text-sm text-slate-500">Deltagare: {course.participant_name}</p> : null}
            {course.venue_name ? <p className="mt-1 text-sm text-slate-500">{course.venue_name}</p> : null}
          </section>
        ) : null}
        <section className={activity || course ? "border-t border-black/10" : ""}>
          {visibleLines.map((line) => {
            const isRacketLine = commerceRacketPickupQuantity([line]) > 0;
            const isActivityParticipationLine = Boolean(activity) && line.commerce_kind === "participation";
            const isCourseLine = Boolean(course) && line.resolver_snapshot?.purchase_kind === "course";
            const isDayPassLine = line.product_key === "day_access" || line.resolver_snapshot?.purchase_kind === "day_pass";
            const lineName = isCourseLine ? "Kursplats" : isDayPassLine ? line.product_name : isActivityParticipationLine ? "Personlig plats" : line.product_name;
            const LineIcon = line.commerce_kind === "participation" ? Ticket : ShoppingBag;
            const lineMetadata = isRacketLine && racketInstruction
              ? `Antal ${line.quantity} · ${racketInstruction}`
              : line.fulfillment_type === "desk_pickup"
                ? `Antal ${line.quantity} · ${COMMERCE_PICKUP_COPY}`
                : isDayPassLine
                  ? "Alla Open Play-pass idag."
                  : isCourseLine
                    ? "En plats för hela kursserien."
                  : isActivityParticipationLine
                    ? null
                  : "Personlig plats";
            return (
              <div key={line.id} className="flex items-start justify-between gap-4 border-b border-black/10 py-5 last:border-b-0">
                <div className="flex min-w-0 items-start gap-3">
                  <LineIcon data-testid={line.commerce_kind === "participation" ? "commerce-line-ticket-icon" : "commerce-line-product-icon"} className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <div className="min-w-0">
                    <p className="font-bold">{lineName}</p>
                    {lineMetadata ? <p className="mt-1 text-xs leading-relaxed text-slate-600">{lineMetadata}</p> : null}
                    {standaloneShopCart ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => void queueStandaloneUpdate({ ...visibleQuantities, [String(line.product_id)]: Math.max(0, Number(line.quantity) - 1) }).catch(() => undefined)} className="grid h-9 w-9 place-items-center rounded-full border border-black/15" aria-label={`Minska ${line.product_name}`}><Minus className="h-4 w-4" /></button>
                          <span className="w-5 text-center font-black" aria-live="polite">{line.quantity}</span>
                          <button type="button" onClick={() => void queueStandaloneUpdate({ ...visibleQuantities, [String(line.product_id)]: Math.min(Number(line.product_snapshot?.max_quantity || 20), Number(line.quantity) + 1) }).catch(() => undefined)} disabled={Number(line.quantity) >= Number(line.product_snapshot?.max_quantity || 20)} className="grid h-9 w-9 place-items-center rounded-full bg-slate-950 text-white disabled:bg-slate-300" aria-label={`Öka ${line.product_name}`}><Plus className="h-4 w-4" /></button>
                        </div>
                        <button type="button" onClick={() => void queueStandaloneUpdate({ ...visibleQuantities, [String(line.product_id)]: 0 }).catch(() => undefined)} className="inline-flex h-9 items-center gap-1 px-2 text-xs font-bold text-slate-500" aria-label={`Ta bort ${line.product_name}`}><Trash2 className="h-3.5 w-3.5" />Ta bort</button>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-black">{includedLineLabel(line) || formatCommerceMoney(lineTotalMinor(line))}</p>
                  {originalUnitPriceMinor(line) > Number(line.unit_price_minor || 0) ? <p className="mt-1 text-xs text-slate-400 line-through">{formatCommerceMoney(originalUnitPriceMinor(line) * Number(line.quantity || 1))}</p> : null}
                </div>
              </div>
            );
          })}
          {standaloneShopCart && visibleLines.length === 0 ? (
            <div className="py-14 text-center">
              <ShoppingBag className="mx-auto h-6 w-6 text-slate-300" />
              <p className="mt-4 font-black">Varukorgen är tom</p>
              <button type="button" onClick={() => navigate(`/shop?v=${encodeURIComponent(venueSlug)}`)} className="mt-3 text-sm font-bold underline underline-offset-4">Fortsätt handla</button>
            </div>
          ) : null}
        </section>
        {visibleLines.length > 0 && (showGuestDetails || showEmailRecovery) ? (
          <section className="grid gap-3 border-t border-black/10 pt-6">
            <h2 className="font-black">Dina uppgifter</h2>
            {showGuestDetails ? <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Namn" className="h-12 rounded-xl border border-black/15 px-3 text-base outline-none focus:border-slate-950 focus:ring-1 focus:ring-slate-950" /> : null}
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="E-post" type="email" className="h-12 rounded-xl border border-black/15 px-3 text-base outline-none focus:border-slate-950 focus:ring-1 focus:ring-slate-950" />
          </section>
        ) : null}
        {resolveQuery.isError ? <p className="mt-6 border-t border-black/15 pt-5 text-sm font-semibold text-slate-700">Priset eller platsen kunde inte bekräftas. Gå tillbaka och försök igen.</p> : null}
      </main>
      {(!standaloneShopCart || visibleLines.length > 0) ? <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-black/10 bg-white px-4 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-3">
        <div className="mx-auto max-w-xl">
          <div className="mb-1 flex items-center justify-between"><span className="text-sm text-slate-500">Totalt</span><span className="text-2xl font-black">{serverPricingReady ? formatCommerceMoney(total) : "—"}</span></div>
          {totalSavings > 0 ? <p className="mb-3 text-sm font-bold text-slate-700">Du sparar {formatCommerceMoney(totalSavings)}</p> : null}
          <button type="button" onClick={() => checkout.mutate()} disabled={checkout.isPending || cartUpdatesPending > 0 || !serverPricingReady || needsEmail || visibleItemCount === 0} className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 text-base font-black text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 disabled:bg-slate-300 disabled:text-slate-500 disabled:opacity-100">{checkout.isPending || cartUpdatesPending > 0 ? <Loader2 className="h-5 w-5 animate-spin" /> : null}{serverPricingReady ? standaloneShopCart ? `Till kassan · ${formatCommerceMoney(total)}` : `Betala ${formatCommerceMoney(total)}` : "Kontrollerar pris…"}</button>
        </div>
      </footer> : null}
    </div>
  );
}
