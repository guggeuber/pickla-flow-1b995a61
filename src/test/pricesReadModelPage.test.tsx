import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useVerifiedAccount } from "@/hooks/useVerifiedAccount";
import {
  fetchPricesFirstVisitEligibility,
  fetchPublicPrices,
  type PublicPricesResponse,
} from "@/lib/publicPrices";
import PricesMembershipPage from "@/pages/PricesMembershipPage";

vi.mock("@/components/PicklaTopBar", () => ({
  PicklaTopBar: () => <div data-testid="topbar" />,
}));
vi.mock("@/hooks/useVerifiedAccount", () => ({ useVerifiedAccount: vi.fn() }));
vi.mock("@/lib/publicPrices", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/publicPrices")>();
  return {
    ...actual,
    fetchPublicPrices: vi.fn(),
    fetchPricesFirstVisitEligibility: vi.fn(),
  };
});

const publicPrices: PublicPricesResponse = {
  memberships: [
    { id: "play", name: "Play", description: "Grundmedlemskap med rabatter och förmåner", monthly_price: 199 },
    { id: "play-plus", name: "Play +", description: "Premium med gratis dagspass varje dag", monthly_price: 699 },
  ],
  court_pricing: [
    { id: "morning", name: "Förmiddag låg", type: "hourly", price: 295, days_of_week: [1, 2, 3, 4, 5], time_from: "10:00:00", time_to: "12:00:00" },
    { id: "lunch", name: "Lunch", type: "hourly", price: 395, days_of_week: [1, 2, 3, 4, 5], time_from: "12:00:00", time_to: "14:00:00" },
    { id: "weekend", name: "Helg", type: "hourly", price: 410, days_of_week: [0, 6], time_from: "06:00:00", time_to: "23:00:00" },
  ],
  day_passes: [
    { id: "day", name: "Dagsmedlemskap", description: "Spela Open Play hela dagen.", base_price_sek: 199 },
    { id: "parker", name: "Parker Brunch", description: "Spela Open Play hela dagen.", base_price_sek: 199 },
  ],
  punch_cards: [
    { id: "punch", name: "Klippkort 10", description: "Tio tillfällen", base_price_sek: 1495 },
  ],
  courses: [
    { id: "next", name: "Pickla Next", description: "För dig som har spelat ett tag och vill ta nästa steg — coached play i liten grupp.", base_price_sek: 1195 },
    { id: "start", name: "Pickla Start", description: "Dina första fyra veckor med Pickleball på Pickla", base_price_sek: 795 },
  ],
  first_visit: {
    available: true,
    title: "Första gången? 165 kr, racket ingår — kom på Open Play ikväll.",
    description: null,
    public_price_sek: 165,
    route: "/today?v=pickla-arena-sthlm",
  },
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/prices?v=pickla-arena-sthlm"]}>
        <PricesMembershipPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Prices read-model page parity", () => {
  beforeEach(() => {
    vi.mocked(fetchPublicPrices).mockResolvedValue(publicPrices);
    vi.mocked(fetchPricesFirstVisitEligibility).mockResolvedValue({ eligible: false });
    vi.mocked(useVerifiedAccount).mockReturnValue({
      state: "anonymous",
      account: null,
      verifiedUserId: null,
      isVerified: false,
      retry: async () => undefined,
    });
  });

  it("preserves public copy, products, ordering, prices and CTA destinations", async () => {
    renderPage();

    expect(await screen.findByText("Spela på ditt sätt.")).toBeInTheDocument();
    expect(screen.getByText("Första gången? 165 kr, racket ingår — kom på Open Play ikväll.")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "Dagspass",
      "Medlemskap",
      "Banpriser",
      "Kurser",
      "Klippkort",
    ]);
    for (const text of ["Dagsmedlemskap", "Parker Brunch", "Play", "Play +", "Pickla Next", "Pickla Start", "Klippkort 10"]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    for (const text of ["199 kr/mån", "699 kr/mån", "295 kr/tim", "395 kr/tim", "410 kr/tim"]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole("button", { name: /Play Grundmedlemskap/ }));
    expect(screen.getByTestId("location")).toHaveTextContent("/membership?v=pickla-arena-sthlm");
    fireEvent.click(screen.getByRole("button", { name: /Förmiddag/ }));
    expect(screen.getByTestId("location")).toHaveTextContent("/book?v=pickla-arena-sthlm");
    fireEvent.click(screen.getByRole("button", { name: /Pickla Next/ }));
    expect(screen.getByTestId("location")).toHaveTextContent("/course/next?v=pickla-arena-sthlm");
    fireEvent.click(screen.getByRole("button", { name: /Klippkort 10/ }));
    expect(screen.getByTestId("location")).toHaveTextContent("/shop?v=pickla-arena-sthlm");
  });

  it("keeps returning-customer First Visit personalization private and non-blocking", async () => {
    vi.mocked(useVerifiedAccount).mockReturnValue({
      state: "verified",
      account: null,
      verifiedUserId: "verified-user",
      isVerified: true,
      retry: async () => undefined,
    });
    renderPage();

    expect(await screen.findByText("Dagsmedlemskap")).toBeInTheDocument();
    await waitFor(() => expect(fetchPricesFirstVisitEligibility).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Första gången? 165 kr, racket ingår — kom på Open Play ikväll.")).not.toBeInTheDocument();
  });
});
