import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { ApiRequestError, apiPost, type ApiRequestOptions } from "@/lib/api";
import {
  clearStandaloneCartIdentity,
  commerceCartItemsFromLines,
  commerceJourneyId,
  createCommerceCart,
  fetchCommerceOrder,
  readStandaloneCartIdentity,
  updateCommerceCart,
  writeStandaloneCartIdentity,
  type CommerceCartItemInput,
  type CommerceOrderLine,
  type CommerceOrderResponse,
  type StandaloneCartIdentity,
} from "@/lib/commerce";

type ResolvedCart = {
  order: { id: string; version: number; currency: string };
  lines: CommerceOrderLine[];
  checkout_ready: boolean;
};

function authOptions(userId?: string | null): ApiRequestOptions {
  return userId ? {} : { auth: "omit" };
}

async function resolveStandaloneCart(reference: string, userId?: string | null) {
  return apiPost<ResolvedCart>("api-commerce", "resolve", { token: reference }, authOptions(userId));
}

async function withResolvedLines(response: CommerceOrderResponse, reference: string, userId?: string | null) {
  if (response.lines.length === 0) return response;
  const resolved = await resolveStandaloneCart(reference, userId);
  return { ...response, order: { ...response.order, version: resolved.order.version }, lines: resolved.lines };
}

export function useStandaloneShopCart(venueId?: string | null) {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id || null;
  const queryClient = useQueryClient();
  const [optimisticQuantities, setOptimisticQuantities] = useState<Record<string, number> | null>(null);
  const [pendingUpdates, setPendingUpdates] = useState(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const queryKey = useMemo(() => ["standalone-shop-cart", venueId, userId || "guest"] as const, [venueId, userId]);

  const cartQuery = useQuery({
    queryKey,
    enabled: Boolean(venueId) && !authLoading,
    retry: false,
    queryFn: async () => {
      let identity = readStandaloneCartIdentity(venueId!, userId);
      const options = authOptions(userId);
      if (identity.reference) {
        try {
          const existing = await fetchCommerceOrder(identity.reference, options);
          if (existing.order.status === "draft") {
            identity = { ...identity, owner: userId || "guest" };
            writeStandaloneCartIdentity(venueId!, identity);
            return withResolvedLines(existing, identity.reference, userId);
          }
          clearStandaloneCartIdentity(venueId!);
          identity = readStandaloneCartIdentity(venueId!, userId);
        } catch (error) {
          const status = Number((error as { status?: unknown })?.status || 0);
          if (status === 409 && userId && identity.owner === "guest") {
            clearStandaloneCartIdentity(venueId!);
            identity = readStandaloneCartIdentity(venueId!, userId);
          } else if (status === 404 || status === 410 || status === 403) {
            clearStandaloneCartIdentity(venueId!);
            identity = readStandaloneCartIdentity(venueId!, userId);
          } else {
            throw error;
          }
        }
      }
      const created = await createCommerceCart({
        venueId: venueId!,
        source: "commerce_shop",
        draftScope: "shop",
        items: [],
        idempotencyKey: identity.idempotencyKey,
        journeyId: commerceJourneyId(),
      }, options);
      const reference = String(created.cart_token || created.order.id);
      const persisted: StandaloneCartIdentity = {
        idempotencyKey: identity.idempotencyKey,
        reference,
        owner: userId || "guest",
      };
      writeStandaloneCartIdentity(venueId!, persisted);
      return withResolvedLines(created, reference, userId);
    },
  });

  const serverQuantities = useMemo(() => Object.fromEntries(
    (cartQuery.data?.lines || []).map((line) => [String(line.product_id || ""), Number(line.quantity || 0)]),
  ), [cartQuery.data?.lines]);
  const quantities = optimisticQuantities || serverQuantities;
  const refetchCart = cartQuery.refetch;

  useEffect(() => {
    if (!optimisticQuantities) return;
    if (pendingUpdates === 0) setOptimisticQuantities(null);
  }, [optimisticQuantities, pendingUpdates]);

  useEffect(() => {
    if (!venueId || typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(`pickla-commerce-shop:${venueId}`);
    channel.onmessage = () => void refetchCart();
    return () => channel.close();
  }, [venueId, refetchCart]);

  const queueQuantities = useCallback((next: Record<string, number>) => {
    if (!venueId || !cartQuery.data) return Promise.reject(new Error("Varukorgen är inte klar."));
    const normalized = Object.fromEntries(Object.entries(next).filter(([, quantity]) => Number(quantity) > 0));
    setOptimisticQuantities(normalized);
    setPendingUpdates((count) => count + 1);

    const task = queue.current.then(async () => {
      const current = queryClient.getQueryData<CommerceOrderResponse>(queryKey) || cartQuery.data;
      const reference = readStandaloneCartIdentity(venueId, userId).reference;
      if (!reference) throw new Error("Varukorgen kunde inte öppnas.");
      const items: CommerceCartItemInput[] = Object.entries(normalized).map(([productId, quantity]) => ({
        product_id: productId,
        quantity,
      }));
      const updated = await updateCommerceCart({
        reference,
        expectedVersion: current.order.version,
        items,
      }, authOptions(userId));
      const resolved = items.length > 0
        ? await resolveStandaloneCart(reference, userId)
        : { order: updated.order, lines: [], checkout_ready: false };
      const canonical: CommerceOrderResponse = { ...updated, order: { ...updated.order, version: resolved.order.version }, lines: resolved.lines };
      queryClient.setQueryData(queryKey, canonical);
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel(`pickla-commerce-shop:${venueId}`);
        channel.postMessage({ version: canonical.order.version });
        channel.close();
      }
    }).catch(async (error) => {
      await cartQuery.refetch();
      setOptimisticQuantities(null);
      if (error instanceof ApiRequestError && error.status === 409) {
        throw new Error("Varukorgen ändrades i en annan flik. Kontrollera den igen.");
      }
      throw error;
    }).finally(() => {
      setPendingUpdates((count) => Math.max(0, count - 1));
    });
    queue.current = task.catch(() => undefined);
    return task;
  }, [cartQuery, queryClient, queryKey, userId, venueId]);

  const lineCount = useMemo(() => Object.values(quantities).reduce((sum, quantity) => sum + Number(quantity || 0), 0), [quantities]);
  const resolvedTotalMinor = useMemo(() => (cartQuery.data?.lines || []).reduce(
    (sum, line) => sum + Number(line.unit_price_minor || 0) * Number(line.quantity || 0),
    0,
  ), [cartQuery.data?.lines]);

  return {
    ...cartQuery,
    quantities,
    lineCount,
    resolvedTotalMinor,
    isUpdating: pendingUpdates > 0,
    queueQuantities,
    reference: venueId ? readStandaloneCartIdentity(venueId, userId).reference : "",
    items: commerceCartItemsFromLines(cartQuery.data?.lines || []),
  };
}
