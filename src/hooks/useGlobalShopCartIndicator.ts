import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { ApiRequestError } from "@/lib/api";
import {
  STANDALONE_CART_UPDATED_EVENT,
  fetchCommerceOrder,
  readStandaloneCartIdentity,
  standaloneCartStorageKey,
} from "@/lib/commerce";

export function useGlobalShopCartIndicator(venueId?: string | null) {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id || null;
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!venueId || typeof window === "undefined") return;
    const refresh = (event?: Event) => {
      const eventVenueId = (event as CustomEvent<{ venueId?: string }> | undefined)?.detail?.venueId;
      if (!eventVenueId || eventVenueId === venueId) setRevision((value) => value + 1);
    };
    const refreshFromStorage = (event: StorageEvent) => {
      if (event.key === standaloneCartStorageKey(venueId)) refresh();
    };
    window.addEventListener(STANDALONE_CART_UPDATED_EVENT, refresh);
    window.addEventListener("storage", refreshFromStorage);
    const channel = typeof BroadcastChannel === "undefined"
      ? null
      : new BroadcastChannel(`pickla-commerce-shop:${venueId}`);
    if (channel) channel.onmessage = () => refresh();
    return () => {
      window.removeEventListener(STANDALONE_CART_UPDATED_EVENT, refresh);
      window.removeEventListener("storage", refreshFromStorage);
      channel?.close();
    };
  }, [venueId]);

  const identity = useMemo(
    () => venueId ? readStandaloneCartIdentity(venueId, userId) : null,
    [revision, userId, venueId],
  );
  const reference = identity?.reference || "";
  const cartQuery = useQuery({
    queryKey: ["global-shop-cart-indicator", venueId, userId || "guest", reference, revision],
    enabled: Boolean(venueId) && reference.length >= 32 && !authLoading,
    retry: false,
    queryFn: async () => {
      try {
        const response = await fetchCommerceOrder(reference, identity?.owner === "guest" ? { auth: "omit" } : {});
        if (response.order.status !== "draft" || response.order.draft_scope !== "shop") return null;
        return response;
      } catch (error) {
        if (error instanceof ApiRequestError && [403, 404, 409, 410].includes(error.status)) return null;
        throw error;
      }
    },
  });

  const count = (cartQuery.data?.lines || []).reduce(
    (sum, line) => sum + Math.max(0, Number(line.quantity || 0)),
    0,
  );

  return { count, reference: count > 0 ? reference : "" };
}
