import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/deskOps", () => ({
  addManualBookingParticipant: vi.fn(),
  checkInDeskBooking: vi.fn(),
  deskBookingCheckinEligibility: vi.fn(() => ({ ok: true })),
}));

vi.mock("@/components/customers/Customer360Drawer", () => ({
  default: () => null,
}));

import { OperationsBookingDrawer } from "@/components/operations/OperationsBookingDrawer";

const booking = {
  id: "capacity-booking-1",
  source_id: "booking-1",
  source_ids: ["booking-1"],
  venue_id: "venue-1",
  customer_name: "Privat bokning",
  customer_phone: "0700000000",
  customer_email: "private@example.com",
  courts: [{ id: "court-1", name: "Bana 1" }],
  starts_at: "2026-07-28T10:00:00.000Z",
  ends_at: "2026-07-28T11:00:00.000Z",
  status: "confirmed",
  amount_sek: 500,
  receipt_number: "SECRET-RECEIPT",
  access_code: "1234",
  notes: "private note",
};

function renderDrawer(readOnly: boolean) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OperationsBookingDrawer open booking={booking} onClose={vi.fn()} readOnly={readOnly} />
    </QueryClientProvider>,
  );
}

describe("Operations booking drawer read-only adapter", () => {
  it("removes all mutation and private booking controls for Capacity", () => {
    renderDrawer(true);
    expect(screen.getByText("Bokningsdetaljer")).toBeInTheDocument();
    expect(screen.getAllByText("Privat bokning").length).toBeGreaterThan(0);
    expect(screen.getByText("Bana 1")).toBeInTheDocument();
    expect(screen.getByText("confirmed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Checka in kund" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lägg till spelare manuellt" })).not.toBeInTheDocument();
    expect(screen.queryByText("private@example.com")).not.toBeInTheDocument();
    expect(screen.queryByText("0700000000")).not.toBeInTheDocument();
    expect(screen.queryByText("SECRET-RECEIPT")).not.toBeInTheDocument();
    expect(screen.queryByText("private note")).not.toBeInTheDocument();
    expect(screen.queryByText("1234")).not.toBeInTheDocument();
  });

  it("preserves the existing operational controls outside Capacity", () => {
    renderDrawer(false);
    expect(screen.getByRole("button", { name: "Checka in kund" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lägg till spelare manuellt" })).toBeInTheDocument();
  });

  it("shows canonical place truth and only valid participant payment actions", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <OperationsBookingDrawer
          open
          onClose={vi.fn()}
          booking={{
            ...booking,
            participant_summary: { confirmed_count: 1, reserved_count: 1, available_count: 2, capacity: 4 },
            participants: [
              { id: "paid", display_name: "Betald", payment_status: "paid", operational_state: "confirmed_paid", has_place: true },
              { id: "pending", display_name: "Pågår", payment_status: "pending", operational_state: "payment_pending", reserved: true, reservation_expires_at: "2026-09-13T12:30:00.000Z", can_resume_payment: true, invite_token: "pending-token" },
              { id: "expired", display_name: "Utgången", payment_status: "pending", operational_state: "payment_expired", amount_sek: 198, can_retry_payment: true, invite_token: "expired-token" },
              { id: "attention", display_name: "Kontroll", payment_status: "pending", operational_state: "payment_attention", requires_attention: true, invite_token: "attention-token" },
            ],
          }}
          readOnly={false}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText("1 har plats · 1 reserverad · 2 lediga")).toBeInTheDocument();
    expect(screen.getByText("HAR PLATS")).toBeInTheDocument();
    expect(screen.getByText("BETALNING PÅGÅR")).toBeInTheDocument();
    expect(screen.getByText("KRÄVER ÅTGÄRD")).toBeInTheDocument();
    expect(screen.queryByText("Claimad")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Kopiera .*betalningslänk/ })).toHaveLength(2);
  });
});
