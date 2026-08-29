import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({ fetchCourseCatalog: vi.fn() }));

vi.mock("@/lib/courses", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/courses")>();
  return { ...original, fetchCourseCatalog: mocks.fetchCourseCatalog };
});
vi.mock("@/components/PicklaTopBar", () => ({ PicklaTopBar: () => <div data-testid="topbar" /> }));

import CoursesPage from "@/pages/CoursesPage";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/courses"]}><CoursesPage /></MemoryRouter></QueryClientProvider>);
}

describe("Course discovery first paint", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the public discovery shell immediately and uses an auth-free projection", () => {
    mocks.fetchCourseCatalog.mockImplementation(() => new Promise(() => undefined));
    renderPage();

    expect(screen.getByRole("heading", { name: "Lär dig spela." })).toBeInTheDocument();
    expect(screen.getByText(/Kurser och träningsupplägg/)).toBeInTheDocument();
    expect(screen.getByTestId("topbar")).toBeInTheDocument();
    expect(mocks.fetchCourseCatalog).toHaveBeenCalledWith("pickla-arena-sthlm", { auth: "omit" });
  });

  it("renders the complete card from the bounded public contract", async () => {
    mocks.fetchCourseCatalog.mockResolvedValue({
      items: [{
        id: "series-1",
        name: "Pickla Start",
        description: "Series fallback",
        image_urls: [],
        start_date: "2026-10-01",
        registration_state: "open",
        capacity: { available_count: 7 },
        format: { description: "Nybörjarkurs", presentation_type: "course" },
      }],
    });
    renderPage();

    expect(await screen.findByRole("heading", { name: "Pickla Start" })).toBeInTheDocument();
    expect(screen.getByText("Nybörjarkurs")).toBeInTheDocument();
    expect(screen.getByText(/7 platser kvar/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Visa kurs/ })).toBeInTheDocument();
  });
});
