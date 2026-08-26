import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";

import { PicklaTopBar } from "@/components/PicklaTopBar";

const { useAuthMock, useCustomerUpcomingMock } = vi.hoisted(() => ({ useAuthMock: vi.fn(), useCustomerUpcomingMock: vi.fn() }));

vi.mock("@/hooks/useAuth", () => ({ useAuth: useAuthMock }));
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

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location-probe">{location.pathname}{location.search}</span>;
}

describe("PicklaTopBar global navigation and booking ownership", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T12:00:00Z"));
    useAuthMock.mockReturnValue({ user: { id: "user-1", email: "spelare@pickla.test" } });
    useCustomerUpcomingMock.mockReturnValue({ data: [] });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    useAuthMock.mockReset();
    useCustomerUpcomingMock.mockReset();
  });

  it("uses the final intent-led order without Course, Series or duplicate My Page rows", () => {
    renderMenu();
    const nav = screen.getByRole("navigation", { name: "Huvudmeny" });
    const expected = ["Schema", "Boka bana", "Träna", "Tävla", "Event & företag", "Medlemskap & priser", "Butik"];
    expect(within(nav).getAllByRole("button").map((button) => button.textContent)).toEqual(expected);
    expect(within(nav).queryByRole("button", { name: "Kurser" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("button", { name: "Seriespel" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("button", { name: "Min sida" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Min sida spelare@pickla.test/i })).toBeInTheDocument();
    expect(screen.getByText("spelare@pickla.test")).toBeInTheDocument();
    const playToday = screen.getByRole("button", { name: /Spela idag/i });
    expect(playToday).toHaveClass("border", "bg-white");
    expect(playToday).not.toHaveClass("bg-neutral-950", "text-white");
    expect(screen.queryByText("Boka pickleball")).not.toBeInTheDocument();
    expect(screen.queryByText("Boka darts")).not.toBeInTheDocument();
    expect(screen.queryByText("MENY")).not.toBeInTheDocument();
    expect(screen.queryByText("Min statistik")).not.toBeInTheDocument();
  });

  it.each([
    ["Träna", "/courses?v=pickla-arena-sthlm"],
    ["Tävla", "/seriespel?v=pickla-arena-sthlm"],
    ["Event & företag", "/event-foretag?v=pickla-arena-sthlm"],
  ])("routes %s through the existing venue context", (label, destination) => {
    render(<MemoryRouter initialEntries={["/today?v=pickla-arena-sthlm"]}><PicklaTopBar /><LocationProbe /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Öppna meny" }));
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(screen.getByTestId("location-probe")).toHaveTextContent(destination);
  });

  it("keeps the account card as the canonical signed-in My Page entry", () => {
    render(<MemoryRouter><PicklaTopBar /><LocationProbe /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Öppna meny" }));
    fireEvent.click(screen.getByRole("button", { name: /Min sida spelare@pickla.test/i }));
    expect(screen.getByTestId("location-probe")).toHaveTextContent("/my?v=pickla-arena-sthlm");
  });

  it("keeps signed-out navigation safe through the account card", () => {
    useAuthMock.mockReturnValue({ user: null });
    render(<MemoryRouter><PicklaTopBar /><LocationProbe /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Öppna meny" }));
    expect(screen.queryByText("Kommande")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Logga in Fortsätt till ditt konto/i }));
    expect(screen.getByTestId("location-probe")).toHaveTextContent("/auth?v=pickla-arena-sthlm");
  });

  it("preserves the Spela idag route while using secondary hierarchy", () => {
    render(<MemoryRouter initialEntries={["/shop?v=pickla-arena-sthlm"]}><PicklaTopBar /><LocationProbe /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Öppna meny" }));
    fireEvent.click(screen.getByRole("button", { name: /Spela idag/i }));
    expect(screen.getByTestId("location-probe")).toHaveTextContent("/today?v=pickla-arena-sthlm");
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

  it("renders the menu immediately but defers Upcoming and account identity until verification", () => {
    useAuthMock.mockReturnValue({
      user: { id: "user-1", email: "private@pickla.test" },
      loading: false,
      authStatus: "local_session",
    });
    renderMenu();

    expect(useCustomerUpcomingMock).toHaveBeenLastCalledWith("pickla-arena-sthlm", false);
    expect(screen.getByText("Verifierar konto…")).toBeInTheDocument();
    expect(screen.getByText("Hämtar kommande…")).toBeInTheDocument();
    expect(screen.queryByText("private@pickla.test")).not.toBeInTheDocument();
  });

  it("keeps an unknown hydrating session distinct from an anonymous account", () => {
    useAuthMock.mockReturnValue({ user: null, loading: true, authStatus: "session_hydrating" });
    renderMenu();

    expect(screen.getByText("Verifierar konto…")).toBeInTheDocument();
    expect(screen.queryByText("Logga in")).not.toBeInTheDocument();
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
