import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { PicklaTopBar } from "@/components/PicklaTopBar";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
vi.mock("@/lib/venueStatus", () => ({
  useVenueStatusBySlug: () => ({ venue: { id: "venue-1", name: "Pickla Arena Stockholm" }, status: { open: true, venueStatusTone: "open" } }),
}));
vi.mock("@/hooks/useGlobalShopCartIndicator", () => ({ useGlobalShopCartIndicator: () => ({ count: 0, reference: null }) }));
vi.mock("@/components/VenueStatusDrawer", () => ({ VenueStatusDrawer: () => null }));

afterEach(cleanup);

describe("PicklaTopBar global navigation", () => {
  it("uses the ratified six-row menu without duplicate sport booking entries", () => {
    render(<MemoryRouter><PicklaTopBar /></MemoryRouter>);
    const open = screen.getByRole("button", { name: "Öppna meny" });
    fireEvent.click(open);

    const expected = ["Schema", "Boka bana", "Kurser", "Priser & medlemskap", "Butik", "Min sida"];
    expect(screen.getAllByRole("button").filter((button) => expected.includes(button.textContent || "")).map((button) => button.textContent)).toEqual(expected);
    expect(screen.queryByText("Boka pickleball")).not.toBeInTheDocument();
    expect(screen.queryByText("Boka darts")).not.toBeInTheDocument();
    expect(screen.queryByText("MENY")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Spela idag/i })).toBeInTheDocument();
  });

  it("keeps the close control in the same 40px grid position as the hamburger", () => {
    render(<MemoryRouter><PicklaTopBar /></MemoryRouter>);
    const open = screen.getByRole("button", { name: "Öppna meny" });
    expect(open).toHaveClass("h-10", "w-10");
    fireEvent.click(open);
    const close = screen.getByRole("button", { name: "Stäng meny" });
    expect(close).toHaveClass("h-10", "w-10");
    expect(close.parentElement).toHaveClass("grid-cols-[40px_1fr_40px]", "px-5");
  });
});
