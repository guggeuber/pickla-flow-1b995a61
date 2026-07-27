import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CommerceCartPage from "@/pages/CommerceCartPage";

const mocks = vi.hoisted(() => ({
  apiPost: vi.fn(),
  fetchOrder: vi.fn(),
  refreshSession: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  auth: {
    loading: false,
    user: { id: "user-1" } as { id: string } | null,
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("@/lib/api", () => ({
  apiPost: mocks.apiPost,
}));

vi.mock("@/lib/commerce", () => ({
  fetchCommerceOrder: mocks.fetchOrder,
  formatCommerceMoney: (minor: number) => `${minor / 100} kr`,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { refreshSession: mocks.refreshSession } },
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, info: mocks.toastInfo },
}));

function renderCart() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/cart?token=${"x".repeat(32)}`]}>
        <CommerceCartPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.apiPost.mockReset();
  mocks.fetchOrder.mockReset();
  mocks.refreshSession.mockReset();
  mocks.toastError.mockReset();
  mocks.toastInfo.mockReset();
  mocks.auth.loading = false;
  mocks.auth.user = { id: "user-1" };
  mocks.fetchOrder.mockResolvedValue({
    order: {
      id: "order-1",
      venue_id: "venue-1",
      status: "draft",
      version: 1,
      currency: "SEK",
      total_inc_vat_minor: 5940,
      total_ex_vat_minor: 5604,
      vat_amount_minor: 336,
    },
    lines: [{
      id: "line-1",
      product_id: "product-1",
      product_key: "open_play",
      product_name: "Open Play",
      commerce_kind: "participation",
      quantity: 1,
      unit_price_minor: 5940,
      line_total_inc_vat_minor: 5940,
      vat_rate: 6,
      vat_amount_minor: 336,
      fulfillment_type: "participation",
      fulfillment_status: "pending",
    }],
  });
});

afterEach(cleanup);

describe("program purchase request UI guard", () => {
  it("waits for auth initialization before loading the purchase", async () => {
    mocks.auth.loading = true;
    const view = renderCart();

    expect(mocks.fetchOrder).not.toHaveBeenCalled();

    mocks.auth.loading = false;
    view.rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[`/cart?token=${"x".repeat(32)}`]}>
          <CommerceCartPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(mocks.fetchOrder).toHaveBeenCalledTimes(1));
  });

  it("shares one checkout request across rapid repeated clicks", async () => {
    let finishCheckout: (value: Record<string, unknown>) => void = () => undefined;
    const checkoutPending = new Promise<Record<string, unknown>>((resolve) => { finishCheckout = resolve; });
    mocks.apiPost.mockImplementation(async (_fn: string, endpoint: string) => {
      if (endpoint === "resolve") {
        return {
          order: { id: "order-1", version: 1, currency: "SEK" },
          lines: [{
            id: "line-1",
            product_name: "Open Play",
            commerce_kind: "participation",
            quantity: 1,
            unit_price_minor: 5940,
            fulfillment_type: "participation",
          }],
        };
      }
      if (endpoint === "checkout") return checkoutPending;
      throw new Error(`Unexpected endpoint ${endpoint}`);
    });

    renderCart();
    const button = await screen.findByRole("button", { name: "Betala 59.4 kr" });
    await waitFor(() => expect(button).toBeEnabled());

    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => {
      const checkoutCalls = mocks.apiPost.mock.calls.filter((call) => call[1] === "checkout");
      expect(checkoutCalls).toHaveLength(1);
    });

    finishCheckout({});
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("Kassan kunde inte öppnas"));
  });

  it("refreshes once and retries the exact checkout endpoint after the production JWT failure", async () => {
    const initialOrder = await mocks.fetchOrder();
    mocks.refreshSession.mockResolvedValue({
      data: { session: { access_token: "fresh-access-token" } },
      error: null,
    });
    const checkoutOptions: Array<Record<string, unknown> | undefined> = [];
    mocks.apiPost.mockImplementation(async (_fn: string, endpoint: string, _body: Record<string, unknown>, options?: Record<string, unknown>) => {
      if (endpoint === "resolve") {
        return { order: { id: "order-1", version: 1, currency: "SEK" }, lines: initialOrder.lines };
      }
      if (endpoint === "checkout") {
        checkoutOptions.push(options);
        if (checkoutOptions.length === 1) {
          throw Object.assign(new Error(
            "invalid JWT: unable to parse or verify signature, token is unverifiable: unrecognized JWT kid <nil> for algorithm ES256",
          ), { status: 400 });
        }
        return { free: true, redirect: "/my" };
      }
      throw new Error(`Unexpected endpoint ${endpoint}`);
    });

    renderCart();
    const checkoutButton = await screen.findByRole("button", { name: "Betala 59.4 kr" });
    await waitFor(() => expect(checkoutButton).toBeEnabled());
    fireEvent.click(checkoutButton);

    await waitFor(() => expect(checkoutOptions).toHaveLength(2));
    expect(checkoutOptions).toEqual([{ auth: "session" }, { auth: "session" }]);
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).not.toHaveBeenCalledWith(expect.stringMatching(/jwt|kid|es256|token/i));
  });

  it("shows only customer-safe copy when checkout refresh fails", async () => {
    const initialOrder = await mocks.fetchOrder();
    mocks.refreshSession.mockResolvedValue({
      data: { session: null },
      error: new Error("Invalid Refresh Token"),
    });
    mocks.apiPost.mockImplementation(async (_fn: string, endpoint: string) => {
      if (endpoint === "resolve") {
        return { order: { id: "order-1", version: 1, currency: "SEK" }, lines: initialOrder.lines };
      }
      if (endpoint === "checkout") {
        throw Object.assign(new Error(
          "invalid JWT: token is unverifiable: unrecognized JWT kid <nil> for algorithm ES256",
        ), { status: 400 });
      }
      throw new Error(`Unexpected endpoint ${endpoint}`);
    });

    renderCart();
    const checkoutButton = await screen.findByRole("button", { name: "Betala 59.4 kr" });
    await waitFor(() => expect(checkoutButton).toBeEnabled());
    fireEvent.click(checkoutButton);

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(
      "Vi kunde inte ladda köpet. Ladda om sidan och försök igen.",
    ));
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
    expect(mocks.apiPost.mock.calls.filter((call) => call[1] === "checkout")).toHaveLength(1);
    expect(mocks.toastError).not.toHaveBeenCalledWith(expect.stringMatching(/jwt|kid|es256|token/i));
  });

  it("refreshes the canonical version after missing email before the customer retries", async () => {
    const initialOrder = await mocks.fetchOrder();
    mocks.fetchOrder.mockReset();
    mocks.fetchOrder
      .mockResolvedValueOnce(initialOrder)
      .mockResolvedValue({
        ...initialOrder,
        order: { ...initialOrder.order, version: 3 },
      });
    const checkoutBodies: Array<Record<string, unknown>> = [];
    mocks.apiPost.mockImplementation(async (_fn: string, endpoint: string, body: Record<string, unknown>) => {
      if (endpoint === "resolve") {
        return {
          order: { id: "order-1", version: 1, currency: "SEK" },
          lines: initialOrder.lines,
        };
      }
      if (endpoint === "checkout") {
        checkoutBodies.push(body);
        if (checkoutBodies.length === 1) {
          throw Object.assign(new Error("E-post krävs för kvitto och uthämtning."), { status: 400 });
        }
        return { free: true, redirect: "/my" };
      }
      throw new Error(`Unexpected endpoint ${endpoint}`);
    });

    renderCart();
    const firstCheckout = await screen.findByRole("button", { name: "Betala 59.4 kr" });
    await waitFor(() => expect(firstCheckout).toBeEnabled());
    fireEvent.click(firstCheckout);

    const emailInput = await screen.findByPlaceholderText("E-post");
    await waitFor(() => expect(mocks.fetchOrder).toHaveBeenCalledTimes(2));
    fireEvent.change(emailInput, { target: { value: "guest@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Betala 59.4 kr" }));

    await waitFor(() => expect(checkoutBodies).toHaveLength(2));
    expect(checkoutBodies[0].expected_version).toBe(1);
    expect(checkoutBodies[1].expected_version).toBe(3);
    expect(checkoutBodies[1].guest_email).toBe("guest@example.com");
  });

  it("refetches a changed cart and does not classify its 409 as auth", async () => {
    const initialOrder = await mocks.fetchOrder();
    mocks.fetchOrder.mockReset();
    mocks.fetchOrder
      .mockResolvedValueOnce(initialOrder)
      .mockResolvedValue({ ...initialOrder, order: { ...initialOrder.order, version: 2 } });
    mocks.apiPost.mockImplementation(async (_fn: string, endpoint: string) => {
      if (endpoint === "resolve") {
        return { order: { id: "order-1", version: 1, currency: "SEK" }, lines: initialOrder.lines };
      }
      if (endpoint === "checkout") {
        throw Object.assign(new Error("Cart changed — review it again."), { status: 409 });
      }
      throw new Error(`Unexpected endpoint ${endpoint}`);
    });

    renderCart();
    const checkoutButton = await screen.findByRole("button", { name: "Betala 59.4 kr" });
    await waitFor(() => expect(checkoutButton).toBeEnabled());
    fireEvent.click(checkoutButton);

    await waitFor(() => expect(mocks.fetchOrder).toHaveBeenCalledTimes(2));
    expect(mocks.toastInfo).toHaveBeenCalledWith("Köpet uppdaterades. Kontrollera och försök igen.");
    expect(mocks.refreshSession).not.toHaveBeenCalled();
  });

  it("falls back to an auth-free checkout only for a permitted guest cart", async () => {
    const guestOrder = {
      order: {
        id: "order-guest",
        venue_id: "venue-1",
        status: "draft",
        version: 1,
        currency: "SEK",
        total_inc_vat_minor: 5000,
        total_ex_vat_minor: 4000,
        vat_amount_minor: 1000,
        guest_email: "guest@example.com",
      },
      lines: [{
        id: "line-merch",
        product_id: "product-merch",
        product_key: "shirt",
        product_name: "T-shirt",
        commerce_kind: "merchandise",
        quantity: 1,
        unit_price_minor: 5000,
        line_total_inc_vat_minor: 5000,
        vat_rate: 25,
        vat_amount_minor: 1000,
        fulfillment_type: "desk_pickup",
        fulfillment_status: "pending",
      }],
    };
    mocks.fetchOrder.mockResolvedValue(guestOrder);
    mocks.refreshSession.mockResolvedValue({ data: { session: null }, error: new Error("Invalid Refresh Token") });
    const checkoutOptions: Array<Record<string, unknown> | undefined> = [];
    mocks.apiPost.mockImplementation(async (_fn: string, endpoint: string, _body: Record<string, unknown>, options?: Record<string, unknown>) => {
      if (endpoint === "resolve") return { order: { id: "order-guest", version: 1, currency: "SEK" }, lines: guestOrder.lines };
      if (endpoint === "checkout") {
        checkoutOptions.push(options);
        if (checkoutOptions.length === 1) {
          throw Object.assign(new Error("invalid JWT: token is unverifiable"), { status: 400 });
        }
        return { free: true, redirect: "/my" };
      }
      throw new Error(`Unexpected endpoint ${endpoint}`);
    });

    renderCart();
    fireEvent.click(await screen.findByRole("button", { name: "Betala 50 kr" }));

    await waitFor(() => expect(checkoutOptions).toHaveLength(2));
    expect(checkoutOptions).toEqual([{ auth: "session" }, { auth: "omit" }]);
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).not.toHaveBeenCalledWith(expect.stringMatching(/jwt|token/i));
  });
});
