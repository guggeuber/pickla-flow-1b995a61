import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  drawer: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ apiGet: mocks.apiGet }));
vi.mock("@/components/operations/OperationsBookingDrawer", () => ({
  OperationsBookingDrawer: (props: { booking?: { customer_email?: string | null } | null; readOnly?: boolean }) => {
    mocks.drawer(props);
    return <div data-testid="loaded-booking-detail">{props.booking?.customer_email}</div>;
  },
}));

import { AdminBookingDetailDrawer } from "@/components/operations/AdminBookingDetailDrawer";

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("authorized admin booking detail path", () => {
  beforeEach(() => {
    mocks.apiGet.mockReset();
    mocks.drawer.mockReset();
    mocks.apiGet.mockResolvedValue({
      source_id: "11111111-1111-4111-8111-111111111111",
      customer_email: "detail-only@example.com",
      access_code: "1234",
      payment_status: "paid",
    });
  });

  it("does not fetch sensitive detail while the summary drawer is closed", () => {
    renderWithQuery(
      <AdminBookingDetailDrawer
        open={false}
        venueId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        bookingId="11111111-1111-4111-8111-111111111111"
        onClose={vi.fn()}
      />,
    );
    expect(mocks.apiGet).not.toHaveBeenCalled();
    expect(mocks.drawer).not.toHaveBeenCalled();
  });

  it("fetches detail through the venue-scoped api-admin path only after opening", async () => {
    renderWithQuery(
      <AdminBookingDetailDrawer
        open
        venueId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        bookingId="11111111-1111-4111-8111-111111111111"
        onClose={vi.fn()}
        readOnly
      />,
    );

    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledWith("api-admin", "booking-detail", {
      venueId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      bookingId: "11111111-1111-4111-8111-111111111111",
    }));
    expect(await screen.findByTestId("loaded-booking-detail")).toHaveTextContent("detail-only@example.com");
    expect(mocks.drawer).toHaveBeenLastCalledWith(expect.objectContaining({ readOnly: true }));
  });
});
