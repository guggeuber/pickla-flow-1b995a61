import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CommerceOrderPage from "@/pages/CommerceOrderPage";

const mocks = vi.hoisted(() => ({
  fetchOrder: vi.fn(),
  checkInGuest: vi.fn(),
  checkInRegistration: vi.fn(),
  checkInAvailable: false,
  auth: { loading: false, user: null as { id: string } | null },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/components/PicklaTopBar", () => ({
  PicklaTopBar: () => <div data-testid="pickla-top-bar" />,
}));
vi.mock("@/lib/activityTiming", () => ({ activityCheckInAvailable: () => mocks.checkInAvailable }));
vi.mock("@/lib/entryResolver", () => ({ preserveIntendedRoute: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/commerce", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/commerce")>();
  return {
    ...actual,
    fetchCommerceOrder: mocks.fetchOrder,
    confirmCommerceGuestIdentity: vi.fn(),
    claimCommerceOrderAccount: vi.fn(),
    checkInCommerceGuest: mocks.checkInGuest,
    checkInCommerceRegistration: mocks.checkInRegistration,
    cancelCommerceActivityOrder: vi.fn(),
  };
});

const participationLine = {
  id: "line-participation",
  product_id: "product-participation",
  product_key: "open_play",
  product_name: "Onsdag Open Play",
  commerce_kind: "participation",
  quantity: 1,
  unit_price_minor: 16500,
  line_total_inc_vat_minor: 16500,
  vat_rate: 6,
  vat_amount_minor: 934,
  fulfillment_type: "participation",
  fulfillment_status: "not_required",
};

function racketLine(quantity: number, fulfillmentStatus = "pending_pickup") {
  return {
    id: "line-racket",
    product_id: "product-racket",
    product_key: "rental_racket",
    product_name: "Hyrrack",
    commerce_kind: "rental",
    quantity,
    unit_price_minor: 5000,
    line_total_inc_vat_minor: 5000 * quantity,
    vat_rate: 6,
    vat_amount_minor: Math.round(5000 * quantity * 6 / 106),
    fulfillment_type: "desk_pickup",
    fulfillment_status: fulfillmentStatus,
    product_snapshot: { customer_instruction_code: "desk_pickup_racket_by_name" },
  };
}

function orderResponse(overrides: Record<string, unknown> = {}, lines = [participationLine]) {
  return {
    order: {
      id: "order-12345678",
      venue_id: "venue-1",
      status: "paid",
      version: 2,
      currency: "SEK",
      total_inc_vat_minor: lines.reduce((sum, line) => sum + Number(line.line_total_inc_vat_minor), 0),
      total_ex_vat_minor: 0,
      vat_amount_minor: 0,
      guest_claimed: false,
      requires_guest_claim: true,
      account_claimed: false,
      customer_name: "Ada R1",
      ...overrides,
    },
    lines,
    receipt: { receipt_number: "R-2026-0042" },
    activity_access: {
      activity_session_id: "activity-1",
      session_date: "2026-07-30",
      name: "Onsdag Open Play",
      start_time: "10:00",
      end_time: "12:00",
      venue_name: "Pickla Solna",
      venue_slug: "solna",
      registration_id: "registration-1",
      registration_status: "confirmed",
    },
  };
}

function renderOrder() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/commerce/confirmed?token=${"x".repeat(32)}`]}>
        <CommerceOrderPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.auth.loading = false;
  mocks.auth.user = null;
  mocks.fetchOrder.mockReset();
  mocks.fetchOrder.mockResolvedValue(orderResponse());
  mocks.checkInGuest.mockReset().mockResolvedValue({ checked_in: true, registration_id: "registration-1" });
  mocks.checkInRegistration.mockReset().mockResolvedValue({ checked_in: true });
  mocks.checkInAvailable = false;
});

afterEach(cleanup);

describe("Commerce R1 confirmed purchase state", () => {
  it("never says the place is confirmed while the webhook is still pending", async () => {
    mocks.fetchOrder.mockResolvedValue(orderResponse({ status: "checkout_pending" }));
    renderOrder();

    expect(await screen.findByRole("heading", { name: "Vi bekräftar ditt köp" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Platsen är din" })).not.toBeInTheDocument();
  });

  it("shows the authoritative success details and guest claim entry after confirmation", async () => {
    renderOrder();

    expect(await screen.findByRole("heading", { name: "Platsen är din" })).toBeInTheDocument();
    expect(screen.getByText("Du är anmäld till Onsdag Open Play.")).toBeInTheDocument();
    expect(screen.getByText("Pickla Solna")).toBeInTheDocument();
    expect(screen.getByText("Referens R-2026-0042")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Vem ska spela?" })).toBeInTheDocument();
    expect(screen.queryByText(/Du har hyrt/)).not.toBeInTheDocument();
  });

  it.each([
    [1, "Du har hyrt 1 rack. Hämtas vid disken."],
    [2, "Du har hyrt 2 rack. Hämtas vid disken."],
  ])("shows confirmed pickup copy for Hyrrack quantity %s", async (quantity, pickupCopy) => {
    const lines = [participationLine, racketLine(Number(quantity))];
    mocks.fetchOrder.mockResolvedValue(orderResponse({}, lines));
    renderOrder();

    expect(await screen.findByRole("heading", { name: "Platsen är din" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hyrrack" })).toBeInTheDocument();
    expect(screen.getByText(pickupCopy)).toBeInTheDocument();
  });

  it("does not instruct collection after a full refund", async () => {
    const lines = [participationLine, racketLine(1, "not_collected")];
    mocks.fetchOrder.mockResolvedValue(orderResponse({}, lines));
    renderOrder();

    expect(await screen.findByRole("heading", { name: "Platsen är din" })).toBeInTheDocument();
    expect(screen.queryByText("Ej längre tillgänglig för uthämtning")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Hyrrack" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Hämtas vid disken/)).not.toBeInTheDocument();
  });

  it("keeps the confirmed ticket neutral and free of success colours", async () => {
    mocks.fetchOrder.mockResolvedValue(orderResponse({ requires_guest_claim: false }));
    renderOrder();

    const ticketHeading = await screen.findByText("Din biljett");
    expect(ticketHeading.closest("section")).toHaveClass("border-y", "border-black/10");
    expect(ticketHeading.closest("section")).not.toHaveClass("bg-success", "border-success", "bg-emerald-50", "rounded-[24px]");
    expect(screen.getByTestId("commerce-success-check").parentElement).not.toHaveClass("rounded-full", "bg-slate-100");
    expect(screen.getByTestId("commerce-ticket-icon").parentElement).not.toHaveClass("bg-slate-950", "text-white");
  });

  it("moves member management to the canonical registration drawer route", async () => {
    mocks.auth.user = { id: "member-1" };
    mocks.fetchOrder.mockResolvedValue(orderResponse({
      requires_guest_claim: false,
      account_claimed: true,
    }));
    renderOrder();

    const managementLink = await screen.findByRole("link", { name: "Visa bokning" });
    expect(managementLink).toHaveAttribute("href", "/my?registration=registration-1&v=solna");
    expect(screen.getByRole("link", { name: "Öppna aktivitet och chatt" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Chatt" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dela" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Visa biljett" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Spara bokningen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Avboka" })).not.toBeInTheDocument();
  });

  it("checks in an account-owned purchase through durable registration truth", async () => {
    mocks.auth.user = { id: "member-1" };
    mocks.checkInAvailable = true;
    mocks.fetchOrder.mockResolvedValue(orderResponse({
      requires_guest_claim: false,
      account_claimed: true,
    }));
    renderOrder();

    fireEvent.click(await screen.findByRole("button", { name: "Checka in" }));

    await waitFor(() => expect(mocks.checkInRegistration).toHaveBeenCalledWith("venue-1", "registration-1"));
    expect(mocks.checkInGuest).not.toHaveBeenCalled();
  });

  it("keeps possession-token check-in for an account-later guest", async () => {
    mocks.checkInAvailable = true;
    mocks.fetchOrder.mockResolvedValue(orderResponse({
      requires_guest_claim: false,
      account_claimed: false,
    }));
    renderOrder();

    fireEvent.click(await screen.findByRole("button", { name: "Checka in" }));

    await waitFor(() => expect(mocks.checkInGuest).toHaveBeenCalledWith("x".repeat(32)));
    expect(mocks.checkInRegistration).not.toHaveBeenCalled();
  });

  it("keeps account-later guests on the ticket activation journey", async () => {
    mocks.fetchOrder.mockResolvedValue(orderResponse({
      requires_guest_claim: false,
      account_claimed: false,
    }));
    renderOrder();

    expect(await screen.findByRole("button", { name: "Spara bokningen" })).toBeInTheDocument();
    expect(screen.getByText("Skapa konto och få biljett, kvitto och bokningshistorik på Min sida.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Visa biljett" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Visa bokning" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Öppna aktivitet och chatt" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Till Min sida" })).not.toBeInTheDocument();
  });

  it("does not expose direct cancellation on immediate success", async () => {
    mocks.fetchOrder.mockResolvedValue(orderResponse({ requires_guest_claim: false }));
    renderOrder();

    expect(await screen.findByRole("heading", { name: "Platsen är din" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Avboka" })).not.toBeInTheDocument();
  });

  it("does not repeat participation order lines, totals or retail actions after success", async () => {
    mocks.fetchOrder.mockResolvedValue(orderResponse({ requires_guest_claim: false }));
    renderOrder();

    expect(await screen.findByRole("heading", { name: "Platsen är din" })).toBeInTheDocument();
    expect(screen.queryByText("Personlig plats")).not.toBeInTheDocument();
    expect(screen.queryByText("Totalt")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Fortsätt handla" })).not.toBeInTheDocument();
  });
});
