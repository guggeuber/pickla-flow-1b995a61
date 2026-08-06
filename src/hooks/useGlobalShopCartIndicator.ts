import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { ApiRequestError } from "@/lib/api";
import {
  canonicalStandaloneShopCartCount,
  STANDALONE_CART_UPDATED_EVENT,
  fetchCommerceOrder,
  isCanonicalStandaloneShopCart,
  readStandaloneCartIdentity,
  standaloneCartStorageKey,
  type CommerceOrderResponse,
} from "@/lib/commerce";

type ConfirmedShopCart = {
  reference: string;
  response: CommerceOrderResponse;
};

export function useGlobalShopCartIndicator(venueId?: string | null) {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id || null;
  const [revision, setRevision] = useState(0);
  const lastUpdateId = useRef("");

  useEffect(() => {
    if (!venueId || typeof window === "undefined") return;
    const refresh = (detail?: { venueId?: string; updateId?: string }) => {
      const eventVenueId = detail?.venueId;
      if (!eventVenueId || eventVenueId === venueId) setRevision((value) => value + 1);
      if (detail?.updateId) lastUpdateId.current = detail.updateId;
    };
    const refreshOnce = (detail?: { venueId?: string; updateId?: string }) => {
      if (detail?.updateId && detail.updateId === lastUpdateId.current) return;
      refresh(detail);
    };
    const refreshFromStorage = (event: StorageEvent) => {
      if (event.key === standaloneCartStorageKey(venueId)) refresh();
    };
    const refreshFromWindow = (event: Event) => {
      refreshOnce((event as CustomEvent<{ venueId?: string; updateId?: string }>).detail);
    };
    window.addEventListener(STANDALONE_CART_UPDATED_EVENT, refreshFromWindow);
    window.addEventListener("storage", refreshFromStorage);
    const channel = typeof BroadcastChannel === "undefined"
      ? null
      : new BroadcastChannel(`pickla-commerce-shop:${venueId}`);
    if (channel) channel.onmessage = (event) => refreshOnce(event.data);
    return () => {
      window.removeEventListener(STANDALONE_CART_UPDATED_EVENT, refreshFromWindow);
      window.removeEventListener("storage", refreshFromStorage);
      channel?.close();
    };
  }, [venueId]);

  const identity = venueId ? readStandaloneCartIdentity(venueId, userId) : null;
  const reference = identity?.reference || "";
  const cartQuery = useQuery({
    queryKey: ["global-shop-cart-indicator", venueId, userId || "guest", reference, revision],
    enabled: Boolean(venueId) && reference.length >= 32 && !authLoading,
    retry: false,
    queryFn: async () => {
      try {
        const response = await fetchCommerceOrder(reference, identity?.owner === "guest" ? { auth: "omit" } : {});
        if (!isCanonicalStandaloneShopCart(response, venueId)) return null;
        return { reference, response } satisfies ConfirmedShopCart;
      } catch (error) {
        if (error instanceof ApiRequestError && [403, 404, 409, 410].includes(error.status)) return null;
        throw error;
      }
    },
  });

  const confirmed = cartQuery.data?.reference === reference ? cartQuery.data : null;
  const count = canonicalStandaloneShopCartCount(confirmed?.response, venueId);

  return { count, reference: count > 0 ? confirmed?.reference || "" : "" };
}
