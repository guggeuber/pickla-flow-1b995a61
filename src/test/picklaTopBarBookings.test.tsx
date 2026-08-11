import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { PicklaTopBar } from "@/components/PicklaTopBar";

const { useMyBookingsMock } = vi.hoisted(() => ({
  useMyBookingsMock: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1", email: "spelare@pickla.test" } }),
}));

vi.mock("@/hooks/useMyBookings", () => ({
  useMyBookings: useMyBookingsMock,
}));

vi.mock("@/lib/venueStatus", () => ({
  useVenueStatusBySlug: () => ({
    venue: { id: "venue-1", name: "Pickla Arena Stockholm" },
    status: { open: true, venueStatusTone: "open" },
  }),
}));

vi.mock("@/hooks/useGlobalShopCartIndicator", () => ({
  useGlobalShopCartIndicator: () => ({ count: 0, reference: null }),
}));

vi.mock("@/components/VenueStatusDrawer", () => ({
  VenueStatusDrawer: () => null,
}));

function booking(
  id: string,
  court: string,
  startTime: string,
  endTime: string,
  status = "confirmed",
) {
  return {
    id,
    booking_ref: id,
    status,
    start_time: startTime,
    end_time: endTime,
    venue_courts: { name: court },
  };
}

function renderMenu() {
  render(
    <MemoryRouter>
      <PicklaTopBar />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Öppna meny" }));
}

describe("PicklaTopBar booking preview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T12:00:00Z"));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    useMyBookingsMock.mockReset();
  });

  it("shows only ongoing and future bookings, nearest first", () => {
    useMyBookingsMock.mockReturnValue({
      data: [
        booking("later", "Bana senare", "2026-08-12T15:00:00Z", "2026-08-12T16:00:00Z"),
        booking("completed", "Bana klar", "2026-08-10T10:00:00Z", "2026-08-10T11:00:00Z", "completed"),
        booking("soon", "Bana snart", "2026-08-11T13:00:00Z", "2026-08-11T14:00:00Z"),
        booking("cancelled", "Bana avbokad", "2026-08-11T15:00:00Z", "2026-08-11T16:00:00Z", "cancelled"),
        booking("ongoing", "Bana pågår", "2026-08-11T11:30:00Z", "2026-08-11T12:30:00Z"),
      ],
    });

    renderMenu();

    expect(screen.queryByText("Bana klar")).not.toBeInTheDocument();
    expect(screen.queryByText("Bana avbokad")).not.toBeInTheDocument();
    expect(screen.getAllByText(/^Bana (pågår|snart|senare)$/).map((node) => node.textContent)).toEqual([
      "Bana pågår",
      "Bana snart",
      "Bana senare",
    ]);
    expect(screen.getAllByText("Upcoming")).toHaveLength(3);
  });

  it("uses the upcoming empty state and has no statistics entry", () => {
    useMyBookingsMock.mockReturnValue({ data: [] });

    renderMenu();

    expect(screen.getByText("Inga kommande bokningar")).toBeInTheDocument();
    expect(screen.queryByText("Min statistik")).not.toBeInTheDocument();
  });
});
