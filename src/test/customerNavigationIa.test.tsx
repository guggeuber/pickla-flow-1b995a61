import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import EventBusinessPage from "@/pages/EventBusinessPage";
import { picklaBusinessContactHref } from "@/lib/corporatePublic";

vi.mock("@/components/PicklaTopBar", () => ({ PicklaTopBar: ({ slug }: { slug: string }) => <div data-testid="topbar">{slug}</div> }));
vi.mock("@/lib/api", () => ({ apiGet: vi.fn().mockResolvedValue({ companies: [{ company_name: "Ericsson", slug: "ericsson", public_intro: "Spela med oss" }] }) }));

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location-probe">{location.pathname}{location.search}</span>;
}

function renderDestination() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={["/event-foretag?v=venue-north"]}><Routes>
    <Route path="/event-foretag" element={<EventBusinessPage />} />
    <Route path="/book/group" element={<LocationProbe />} />
    <Route path="/foretag/:slug" element={<LocationProbe />} />
  </Routes></MemoryRouter></QueryClientProvider>);
}

describe("customer Event & företag discovery", () => {
  afterEach(cleanup);

  it("reuses the canonical group-event inquiry with venue context", () => {
    renderDestination();
    expect(screen.getByTestId("topbar")).toHaveTextContent("venue-north");
    fireEvent.click(screen.getByRole("link", { name: /Starta eventförfrågan/i }));
    expect(screen.getByTestId("location-probe")).toHaveTextContent("/book/group?v=venue-north");

    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).toContain('<Route path="/book/group" element={<GroupBookingPage />} />');
  });

  it("lists explicitly public companies without search and retains a truthful contact path", async () => {
    renderDestination();
    expect(await screen.findByRole("heading", { name: "Hitta ert företagsupplägg" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("link", { name: /Ericsson/i }));
    expect(screen.getByTestId("location-probe")).toHaveTextContent("/foretag/ericsson");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    cleanup();
    renderDestination();
    const contact = await screen.findByRole("link", { name: /Prata med Pickla/i });
    expect(contact).toHaveAttribute("href", picklaBusinessContactHref("venue-north"));
    expect(contact.getAttribute("href")).toMatch(/^mailto:hello@picklaparks\.com/);
  });
});
