import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: { user: null as { id: string } | null, loading: false },
  fetchOrder: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/api", () => ({
  ApiRequestError: class ApiRequestError extends Error {
    status: number;

    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
}));
vi.mock("@/lib/commerce", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/commerce")>();
  return { ...actual, fetchCommerceOrder: mocks.fetchOrder };
});

import { useGlobalShopCartIndicator } from "@/hooks/useGlobalShopCartIndicator";
import { notifyStandaloneCartUpdated, writeStandaloneCartIdentity } from "@/lib/commerce";
import { ApiRequestError } from "@/lib/api";

const venueId = "venue-global-cart";
const reference = "c".repeat(64);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function orderWithQuantity(quantity: number, overrides: Record<string, unknown> = {}) {
  return {
    order: {
      id: "order-global-cart",
      venue_id: venueId,
      status: "draft",
      draft_scope: "shop",
      version: 1,
      currency: "SEK",
      total_inc_vat_minor: 0,
      total_ex_vat_minor: 0,
      vat_amount_minor: 0,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      ...overrides,
    },
    lines: quantity > 0 ? [{ quantity }] : [],
  };
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.auth.user = null;
  mocks.auth.loading = false;
  mocks.fetchOrder.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("global Shop cart indicator", () => {
  it("does not create or fetch a cart when no persisted Shop cart exists", () => {
    const { result } = renderHook(() => useGlobalShopCartIndicator(venueId), { wrapper });

    expect(result.current).toEqual({ count: 0, reference: "" });
    expect(mocks.fetchOrder).not.toHaveBeenCalled();
  });

  it("shows the quantity from the persisted guest cart without using session auth", async () => {
    writeStandaloneCartIdentity(venueId, {
      idempotencyKey: "i".repeat(64),
      reference,
      owner: "guest",
    });
    mocks.fetchOrder.mockResolvedValue(orderWithQuantity(3));

    const { result } = renderHook(() => useGlobalShopCartIndicator(venueId), { wrapper });

    await waitFor(() => expect(result.current).toEqual({ count: 3, reference }));
    expect(mocks.fetchOrder).toHaveBeenCalledWith(reference, { auth: "omit" });
  });

  it("refreshes the global count after a same-tab cart update", async () => {
    writeStandaloneCartIdentity(venueId, {
      idempotencyKey: "i".repeat(64),
      reference,
      owner: "guest",
    });
    mocks.fetchOrder
      .mockResolvedValueOnce(orderWithQuantity(1))
      .mockResolvedValueOnce(orderWithQuantity(2));

    const { result } = renderHook(() => useGlobalShopCartIndicator(venueId), { wrapper });
    await waitFor(() => expect(result.current.count).toBe(1));

    act(() => notifyStandaloneCartUpdated(venueId));
    await waitFor(() => expect(result.current.count).toBe(2));
  });

  it("never derives a badge from stale localStorage when the canonical cart is unavailable", async () => {
    writeStandaloneCartIdentity(venueId, {
      idempotencyKey: "i".repeat(64),
      reference,
      owner: "guest",
    });
    mocks.fetchOrder.mockRejectedValue(new ApiRequestError("Cart not found", 404));

    const { result } = renderHook(() => useGlobalShopCartIndicator(venueId), { wrapper });

    await waitFor(() => expect(mocks.fetchOrder).toHaveBeenCalledTimes(1));
    expect(result.current).toEqual({ count: 0, reference: "" });
  });

  it.each([
    ["empty", orderWithQuantity(0)],
    ["expired", orderWithQuantity(2, { expires_at: new Date(Date.now() - 60_000).toISOString() })],
    ["completed checkout", orderWithQuantity(2, { status: "checkout_pending" })],
    ["activity draft", orderWithQuantity(2, { draft_scope: `activity:${"a".repeat(36)}:2026-08-06` })],
    ["another venue", orderWithQuantity(2, { venue_id: "venue-other" })],
  ])("hides the badge for a canonical %s cart state", async (_name, response) => {
    writeStandaloneCartIdentity(venueId, {
      idempotencyKey: "i".repeat(64),
      reference,
      owner: "guest",
    });
    mocks.fetchOrder.mockResolvedValue(response);

    const { result } = renderHook(() => useGlobalShopCartIndicator(venueId), { wrapper });

    await waitFor(() => expect(mocks.fetchOrder).toHaveBeenCalledTimes(1));
    expect(result.current).toEqual({ count: 0, reference: "" });
  });

  it("binds the count and navigation reference to the same latest canonical response", async () => {
    const referenceA = "a".repeat(64);
    const referenceB = "b".repeat(64);
    let resolveA: (value: ReturnType<typeof orderWithQuantity>) => void = () => undefined;
    const pendingA = new Promise<ReturnType<typeof orderWithQuantity>>((resolve) => { resolveA = resolve; });
    mocks.fetchOrder.mockImplementation((cartReference: string) => (
      cartReference === referenceA ? pendingA : Promise.resolve(orderWithQuantity(0))
    ));
    writeStandaloneCartIdentity(venueId, {
      idempotencyKey: "i".repeat(64),
      reference: referenceA,
      owner: "guest",
    });

    const { result } = renderHook(() => useGlobalShopCartIndicator(venueId), { wrapper });
    await waitFor(() => expect(mocks.fetchOrder).toHaveBeenCalledWith(referenceA, { auth: "omit" }));

    act(() => writeStandaloneCartIdentity(venueId, {
      idempotencyKey: "j".repeat(64),
      reference: referenceB,
      owner: "guest",
    }));
    await waitFor(() => expect(mocks.fetchOrder).toHaveBeenCalledWith(referenceB, { auth: "omit" }));
    resolveA(orderWithQuantity(4));

    await waitFor(() => expect(result.current).toEqual({ count: 0, reference: "" }));
  });

  it("does not carry one venue's canonical count into another venue", async () => {
    writeStandaloneCartIdentity(venueId, {
      idempotencyKey: "i".repeat(64),
      reference,
      owner: "guest",
    });
    mocks.fetchOrder.mockResolvedValue(orderWithQuantity(2));

    const { result, rerender } = renderHook(
      ({ activeVenue }) => useGlobalShopCartIndicator(activeVenue),
      { wrapper, initialProps: { activeVenue: venueId } },
    );
    await waitFor(() => expect(result.current).toEqual({ count: 2, reference }));

    rerender({ activeVenue: "venue-without-cart" });

    await waitFor(() => expect(result.current).toEqual({ count: 0, reference: "" }));
    expect(mocks.fetchOrder).toHaveBeenCalledTimes(1);
  });

  it("converges after a cross-tab broadcast and clears the final-line badge", async () => {
    const channels = new Set<TestBroadcastChannel>();
    class TestBroadcastChannel {
      name: string;
      onmessage: ((event: MessageEvent) => void) | null = null;

      constructor(name: string) {
        this.name = name;
        channels.add(this);
      }

      postMessage(data: unknown) {
        for (const channel of channels) {
          if (channel !== this && channel.name === this.name) channel.onmessage?.({ data } as MessageEvent);
        }
      }

      close() {
        channels.delete(this);
      }
    }
    vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
    writeStandaloneCartIdentity(venueId, {
      idempotencyKey: "i".repeat(64),
      reference,
      owner: "guest",
    });
    mocks.fetchOrder
      .mockResolvedValueOnce(orderWithQuantity(1))
      .mockResolvedValueOnce(orderWithQuantity(0));

    const { result } = renderHook(() => useGlobalShopCartIndicator(venueId), { wrapper });
    await waitFor(() => expect(result.current).toEqual({ count: 1, reference }));

    act(() => {
      const sender = new TestBroadcastChannel(`pickla-commerce-shop:${venueId}`);
      sender.postMessage({ venueId });
      sender.close();
    });

    await waitFor(() => expect(result.current).toEqual({ count: 0, reference: "" }));
  });
});
