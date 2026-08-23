import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { PicklaTopBar } from "@/components/PicklaTopBar";

const { useCustomerUpcomingMock } = vi.hoisted(() => ({ useCustomerUpcomingMock: vi.fn() }));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "user-1", email: "spelare@pickla.test" } }) }));
vi.mock("@/hooks/useCustomerUpcoming", () => ({ useCustomerUpcoming: useCustomerUpcomingMock }));
vi.mock("@/lib/venueStatus", () => ({
  useVenueStatusBySlug: () => ({ venue: { id: "venue-1", name: "Pickla Arena Stockholm" }, status: { open: true, venueStatusTone: "open" } }),
}));
vi.mock("@/hooks/useGlobalShopCartIndicator", () => ({ useGlobalShopCartIndicator: () => ({ count: 0, reference: null }) }));
vi.mock("@/components/VenueStatusDrawer", () => ({ VenueStatusDrawer: () => null }));

function upcoming(id: string, title: string, startsAt: string, source: "court_booking" | "session_registration" | "series_occurrence") {
  return {
    id,
    source,
    title,
    typeLabel: source === "court_booking" ? "Bana" : source === "series_occurrence" ? "EVENT" : "Open Play",
    stateLabel: source === "court_booking" ? "Bokad" : source === "series_occurrence" ? "Du har en plats" : "Anmäld",
    startsAt,
    endsAt: null,
    timeLabel: startsAt,
    venue: { name: "Pickla Stockholm", slug: "pickla-arena-sthlm" },
    destinationUrl: source === "court_booking" ? `/my?booking=${id}` : source === "series_occurrence" ? `/course/${id}` : `/program/${id}`,
  };
}

function renderMenu() {
  render(<MemoryRouter><PicklaTopBar /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Öppna meny" }));
}

describe("PicklaTopBar global navigation and booking ownership", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T12:00:00Z"));
    useCustomerUpcomingMock.mockReturnValue({ data: [] });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    useCustomerUpcomingMock.mockReset();
  });

  it("uses the ratified six-row menu and restores the contextual account card", () => {
    renderMenu();
    const expected = ["Schema", "Boka bana", "Kurser", "Priser & medlemskap", "Butik", "Min sida"];
    expect(screen.getAllByRole("button").filter((button) => expected.includes(button.textContent || "")).map((button) => button.textContent)).toEqual(expected);
    expect(screen.getByText("spelare@pickla.test")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Spela idag/i })).toBeInTheDocument();
    expect(screen.queryByText("Boka pickleball")).not.toBeInTheDocument();
    expect(screen.queryByText("Boka darts")).not.toBeInTheDocument();
    expect(screen.queryByText("MENY")).not.toBeInTheDocument();
    expect(screen.queryByText("Min statistik")).not.toBeInTheDocument();
  });

  it("shows the three nearest customer-owned activities across canonical sources", () => {
    useCustomerUpcomingMock.mockReturnValue({
      data: [
        upcoming("court", "Bana 1", "idag 13:00", "court_booking"),
        upcoming("open-play", "Open Play", "idag 17:00", "session_registration"),
        upcoming("parker", "Parker Brunch", "lör 13:00", "series_occurrence"),
        upcoming("later", "Bana senare", "sön 18:00", "court_booking"),
      ],
    });
    renderMenu();
    expect(screen.getByText("Kommande")).toBeInTheDocument();
    expect(screen.getByText("Bana 1")).toBeInTheDocument();
    expect(screen.getByText("Open Play")).toBeInTheDocument();
    expect(screen.getByText("Parker Brunch")).toBeInTheDocument();
    expect(screen.queryByText("Bana senare")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Visa alla på Min sida" })).toBeInTheDocument();
  });

  it("uses the upcoming empty state", () => {
    renderMenu();
    expect(screen.getByText("Inget kommande just nu")).toBeInTheDocument();
  });

  it("centers the open and close controls in the same desktop max-width rail", () => {
    render(<MemoryRouter><PicklaTopBar /></MemoryRouter>);
    const open = screen.getByRole("button", { name: "Öppna meny" });
    expect(open.parentElement).toHaveClass("max-w-md", "w-full", "px-5");
    fireEvent.click(open);
    const close = screen.getByRole("button", { name: "Stäng meny" });
    expect(close.parentElement).toHaveClass("max-w-md", "w-full", "grid-cols-[40px_1fr_40px]");
  });
});
