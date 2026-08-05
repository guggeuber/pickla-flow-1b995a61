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

const venueId = "venue-global-cart";
const reference = "c".repeat(64);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function orderWithQuantity(quantity: number) {
  return {
    order: { status: "draft", draft_scope: "shop" },
    lines: quantity > 0 ? [{ quantity }] : [],
  };
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.auth.user = null;
  mocks.auth.loading = false;
  mocks.fetchOrder.mockReset();
});

afterEach(cleanup);

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
});
