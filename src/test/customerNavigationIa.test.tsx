import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import EventBusinessPage, { picklaBusinessContactHref } from "@/pages/EventBusinessPage";

vi.mock("@/components/PicklaTopBar", () => ({ PicklaTopBar: ({ slug }: { slug: string }) => <div data-testid="topbar">{slug}</div> }));

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location-probe">{location.pathname}{location.search}</span>;
}

function renderDestination() {
  return render(<MemoryRouter initialEntries={["/event-foretag?v=venue-north"]}><Routes>
    <Route path="/event-foretag" element={<EventBusinessPage />} />
    <Route path="/book/group" element={<LocationProbe />} />
  </Routes></MemoryRouter>);
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

  it("offers a truthful B2B contact instead of fake self-service", () => {
    renderDestination();
    expect(screen.getByRole("heading", { name: "Återkommande spel eller bredare samarbete" })).toBeInTheDocument();
    const contact = screen.getByRole("link", { name: /Kontakta Pickla/i });
    expect(contact).toHaveAttribute("href", picklaBusinessContactHref("venue-north"));
    expect(contact.getAttribute("href")).toMatch(/^mailto:hello@picklaparks\.com/);
    expect(screen.getByText(/Det skapar ingen beställning, bokning eller företagsprodukt/i)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
