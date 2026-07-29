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
  commerceJourneyId: () => "test-commerce-journey-id",
  commerceRacketPickupQuantity: (lines: Array<Record<string, unknown>>) => lines.reduce((sum, line) => (
    line.product_name === "Hyrrack" ? sum + Number(line.quantity || 0) : sum
  ), 0),
  commerceRacketOrderSummaryInstruction: (quantity: number) => quantity <= 0
    ? null
    : "Hämtas ut i desken genom att uppge ditt namn.",
  fetchCommerceOrder: mocks.fetchOrder,
  formatCommerceMoney: (minor: number) => `${minor / 100} kr`,
  isCommerceOrderIdReference: () => false,
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
  it("presents an included membership line, VAT and savings from resolved server pricing", async () => {
    const includedOrder = {
      order: {
        id: "order-1",
        venue_id: "venue-1",
        status: "draft",
        version: 1,
        currency: "SEK",
        total_inc_vat_minor: 0,
        total_ex_vat_minor: 0,
        vat_amount_minor: 0,
      },
      lines: [{
        id: "line-1",
        product_id: "product-1",
        product_key: "open_play",
        product_name: "Open Play",
        commerce_kind: "participation",
        quantity: 1,
        unit_price_minor: 0,
        line_total_inc_vat_minor: 0,
        vat_rate: 6,
        vat_amount_minor: 0,
        fulfillment_type: "participation",
        fulfillment_status: "pending",
        resolver_snapshot: {
          pricing_reason: "membership_entitlement",
          membership_tier_name: "Founder",
          debug: { base_amount_sek: 165 },
        },
      }],
    };
    mocks.fetchOrder.mockResolvedValue(includedOrder);
    mocks.apiPost.mockImplementation(async (_fn: string, endpoint: string) => {
      if (endpoint === "resolve") return { order: { id: "order-1", version: 1, currency: "SEK" }, lines: includedOrder.lines };
      throw new Error(`Unexpected endpoint ${endpoint}`);
    });

    renderCart();

    expect(await screen.findByText("Ingår i Founder")).toBeInTheDocument();
    expect(screen.getByText("Du sparar 165 kr")).toBeInTheDocument();
    expect(screen.getByText("Ingår i Founder")).not.toHaveClass("text-emerald-700");
    expect(screen.getByText("Du sparar 165 kr")).toHaveClass("text-slate-700");
    await waitFor(() => expect(screen.getByRole("button", { name: "Betala 0 kr" })).toBeEnabled());
    expect(screen.getByText(/Varav moms 0 kr/)).toBeInTheDocument();
    expect(screen.getByText("Varav moms")).toBeInTheDocument();
  });

  it("shows a server-priced order summary without pickup copy when no racket is selected", async () => {
    const initialOrder = await mocks.fetchOrder();
    mocks.apiPost.mockImplementation(async (_fn: string, endpoint: string) => {
      if (endpoint === "resolve") return { order: { id: "order-1", version: 1, currency: "SEK" }, lines: initialOrder.lines, checkout_ready: true };
      throw new Error(`Unexpected endpoint ${endpoint}`);
    });

    renderCart();

    expect(await screen.findByRole("heading", { name: "Ordersammanfattning" })).toBeInTheDocument();
    expect(screen.getByText("Platsen bekräftas direkt efter betalning.")).toBeInTheDocument();
    expect(screen.queryByText(/Uppge ditt namn/)).not.toBeInTheDocument();
    expect(screen.queryByText(/En betalning, ett kvitto/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Betala 59.4 kr" })).toBeEnabled());
  });

  it("keeps the activity details once and simplifies its purchase line", async () => {
    const initialOrder = await mocks.fetchOrder();
    const orderWithActivity = {
      ...initialOrder,
      activity_access: {
        activity_session_id: "activity-1",
        session_date: "2026-07-30",
        name: "Open Play",
        start_time: "18:00",
        end_time: "20:00",
        venue_name: "Pickla Solna",
      },
    };
    mocks.fetchOrder.mockResolvedValue(orderWithActivity);
    mocks.apiPost.mockImplementation(async (_fn: string, endpoint: string) => {
      if (endpoint === "resolve") return { order: { id: "order-1", version: 1, currency: "SEK" }, lines: initialOrder.lines, checkout_ready: true };
      throw new Error(`Unexpected endpoint ${endpoint}`);
    });

    renderCart();

    expect(await screen.findByRole("heading", { name: "Open Play" })).toBeInTheDocument();
    expect(screen.getAllByText("Open Play")).toHaveLength(1);
    expect(screen.getByText("Personlig plats")).toBeInTheDocument();
    const ticketIcon = screen.getByTestId("commerce-line-ticket-icon");
    expect(ticketIcon).toHaveClass("text-slate-400");
    expect(ticketIcon.parentElement).not.toHaveClass("bg-slate-100", "rounded-xl");
  });

  it("keeps guest contact details separate from pickup guidance", async () => {
    mocks.auth.user = null;
    const initialOrder = await mocks.fetchOrder();
    mocks.apiPost.mockImplementation(async (_fn: string, endpoint: string) => {
      if (endpoint === "resolve") return { order: { id: "order-1", version: 1, currency: "SEK" }, lines: initialOrder.lines, checkout_ready: true };
      throw new Error(`Unexpected endpoint ${endpoint}`);
    });

    renderCart();

    expect(await screen.findByRole("heading", { name: "Dina uppgifter" })).toBeInTheDocument();
    expect(screen.getByText("Vi skickar kvitto och orderinformation till din e-postadress.")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Namn")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("E-post")).toBeInTheDocument();
    expect(screen.queryByText("Kvitto och uthämtning")).not.toBeInTheDocument();
    expect(screen.queryByText(/En betalning, ett kvitto/)).not.toBeInTheDocument();
  });

  it.each([
    [1, "Betala 109.4 kr"],
    [2, "Betala 159.4 kr"],
  ])("shows the contextual pickup instruction for Hyrrack quantity %s", async (quantity, paymentLabel) => {
    const initialOrder = await mocks.fetchOrder();
    const lines = [...initialOrder.lines, {
      id: "line-racket",
      product_id: "product-racket",
      product_key: "rental_racket",
      product_name: "Hyrrack",
      commerce_kind: "rental",
      quantity,
      unit_price_minor: 5000,
      line_total_inc_vat_minor: 5000 * Number(quantity),
      vat_rate: 6,
      vat_amount_minor: Math.round(5000 * Number(quantity) * 6 / 106),
      fulfillment_type: "desk_pickup",
      fulfillment_status: "not_required",
    }];
    mocks.fetchOrder.mockResolvedValue({ ...initialOrder, lines });
    mocks.apiPost.mockImplementation(async (_fn: string, endpoint: string) => {
      if (endpoint === "resolve") return { order: { id: "order-1", version: 1, currency: "SEK" }, lines, checkout_ready: true };
      throw new Error(`Unexpected endpoint ${endpoint}`);
    });

    renderCart();

    const pickupCopy = `Antal ${quantity} · Hämtas ut i desken genom att uppge ditt namn.`;
    expect(await screen.findByText(pickupCopy)).toBeInTheDocument();
    expect(screen.getByText(pickupCopy).parentElement).toHaveTextContent("Hyrrack");
    const productIcon = screen.getByTestId("commerce-line-product-icon");
    expect(productIcon).toHaveClass("text-slate-400");
    expect(productIcon.parentElement).not.toHaveClass("bg-slate-100", "rounded-xl");
    expect(screen.queryByText("Uppge ditt namn i desken så hjälper vi dig.")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: paymentLabel })).toBeEnabled());
  });

  it("uses explicit neutral disabled and enabled payment states", async () => {
    mocks.auth.user = null;
    const initialOrder = await mocks.fetchOrder();
    mocks.apiPost.mockImplementation(async (_fn: string, endpoint: string) => {
      if (endpoint === "resolve") return { order: { id: "order-1", version: 1, currency: "SEK" }, lines: initialOrder.lines, checkout_ready: true };
      throw new Error(`Unexpected endpoint ${endpoint}`);
    });

    renderCart();

    const paymentButton = await screen.findByRole("button", { name: "Betala 59.4 kr" });
    expect(paymentButton).toBeDisabled();
    expect(paymentButton).toHaveClass("bg-slate-950", "disabled:bg-slate-300", "disabled:opacity-100");

    fireEvent.change(screen.getByPlaceholderText("Namn"), { target: { value: "Ada Andersson" } });
    fireEvent.change(screen.getByPlaceholderText("E-post"), { target: { value: "ada@example.com" } });

    await waitFor(() => expect(paymentButton).toBeEnabled());
    expect(paymentButton).toHaveClass("bg-slate-950", "text-white");
  });

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

    await waitFor(() => expect(checkoutOptions).toHaveLength(2), { timeout: 3000 });
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
        contact_email_present: true,
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
    const guestCheckout = await screen.findByRole("button", { name: "Betala 50 kr" });
    await waitFor(() => expect(guestCheckout).toBeEnabled());
    fireEvent.click(guestCheckout);

    await waitFor(() => expect(checkoutOptions).toHaveLength(2), { timeout: 3000 });
    expect(checkoutOptions).toEqual([{ auth: "session" }, { auth: "omit" }]);
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).not.toHaveBeenCalledWith(expect.stringMatching(/jwt|token/i));
  });
});
