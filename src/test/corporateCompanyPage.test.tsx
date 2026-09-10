import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import CorporateCompanyPage from "@/pages/CorporateCompanyPage";
import { apiGet } from "@/lib/api";

vi.mock("@/components/PicklaTopBar", () => ({ PicklaTopBar: ({ slug }: { slug: string }) => <div data-testid="topbar">{slug}</div> }));
vi.mock("@/lib/api", () => ({ apiGet: vi.fn() }));

const response = {
  company: { company_name: "Ericsson", slug: "ericsson", public_intro: "Ett erbjudande för Ericsson-medarbetare." },
  venue: { name: "Pickla Solna", slug: "solna", address: "Gatan 1", city: "Solna", postal_code: "171 00", country: "SE", latitude: null, longitude: null },
  series: [{
    id: "series-1", name: "Ericsson höstspel", description: null, start_date: "2026-09-21", end_date: "2026-12-30", included_items: ["Rack", "Bollar"],
    participation: { mode: "external", state: "external_pending", message: "Deltagandet hanteras av Ericsson. Mer bokningsinformation kommer snart.", cta: null },
    sessions: [
      { id: "monday", session_date: "2026-09-21", start_time: "17:00:00", end_time: "18:00:00", occurrence_index: 1, courts: [{ id: "court-1", name: "Bana B1", sport_type: "pickleball" }] },
      { id: "wednesday", session_date: "2026-09-23", start_time: "17:00:00", end_time: "18:00:00", occurrence_index: 2, courts: [{ id: "court-1", name: "Bana B1", sport_type: "pickleball" }] },
    ],
  }],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/foretag/ericsson"]}><Routes><Route path="/foretag/:slug" element={<CorporateCompanyPage />} /></Routes></MemoryRouter></QueryClientProvider>);
}

describe("public corporate company page", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("derives the visible schedule, court and inclusions from the API Sessions", async () => {
    vi.mocked(apiGet).mockResolvedValue(response);
    renderPage();
    expect(await screen.findByRole("heading", { name: /Ericsson/ })).toBeInTheDocument();
    expect(screen.getByText(/Måndagar 17:00–18:00/)).toBeInTheDocument();
    expect(screen.getByText(/Onsdagar 17:00–18:00/)).toBeInTheDocument();
    expect(screen.getByText("Bana B1")).toBeInTheDocument();
    expect(screen.getByText("Rack")).toBeInTheDocument();
    expect(screen.getByText("Bollar")).toBeInTheDocument();
    expect(screen.getByText(/Deltagandet hanteras av Ericsson/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Gå till bokning/ })).not.toBeInTheDocument();
  });

  it("renders a valid external CTA with safe navigation attributes", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      ...response,
      series: [{ ...response.series[0], participation: { mode: "external", state: "external_ready", message: null, cta: { label: "Boka via ESIK", url: "https://booking.example.test/ericsson" } } }],
    });
    renderPage();
    const cta = await screen.findByRole("link", { name: /Boka via ESIK/ });
    expect(cta).toHaveAttribute("href", "https://booking.example.test/ericsson");
    expect(cta).toHaveAttribute("target", "_blank");
    expect(cta).toHaveAttribute("rel", "noopener noreferrer");
  });
});
