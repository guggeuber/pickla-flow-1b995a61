import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mergeInvestorSettings, type InvestorSettings } from "@/lib/investorContent";
import AdminInvestorPage from "@/pages/AdminInvestorPage";
import InvestMemoPage from "@/pages/InvestMemoPage";
import InvestPage from "@/pages/InvestPage";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiGet: mocks.apiGet,
  apiPost: mocks.apiPost,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: vi.fn(),
        getPublicUrl: vi.fn(),
      }),
    },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mocks.apiGet.mockReset();
  mocks.apiPost.mockReset();
});

describe("investor content ownership", () => {
  it("saves a memo section in admin and renders it with unchanged offer values", async () => {
    let persistedSettings: InvestorSettings = mergeInvestorSettings({
      id: "settings-1",
      headline: "Editable investor hero",
      public_thesis: "Editable public thesis",
      round_size_sek: 1_250_000,
      valuation_sek: 5_000_000,
      share_price_sek: 10_000,
      shares_offered: 125,
      minimum_shares: 5,
      minimum_investment_sek: 50_000,
      memo_sections: [
        { kicker: "01 · Vision", title: "Original memo title", body: "Original memo body" },
      ],
    });

    mocks.apiGet.mockImplementation(async (_fn: string, endpoint: string) => {
      if (endpoint === "leads") return { leads: [] };
      if (endpoint === "admin-settings") return { settings: persistedSettings, assets: [] };
      if (endpoint === "tokens") return { tokens: [] };
      if (endpoint === "settings") return { settings: persistedSettings, assets: [] };
      throw new Error(`Unexpected endpoint ${endpoint}`);
    });
    mocks.apiPost.mockImplementation(async (_fn: string, endpoint: string, body: Record<string, unknown>) => {
      if (endpoint !== "save-settings") throw new Error(`Unexpected endpoint ${endpoint}`);
      persistedSettings = mergeInvestorSettings(body as Partial<InvestorSettings>);
      return { settings: persistedSettings };
    });

    render(<AdminInvestorPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Content & assets" }));
    const titleInput = await screen.findByLabelText("Section 1 title");
    fireEvent.change(titleInput, { target: { value: "Updated memo title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mocks.apiPost).toHaveBeenCalledWith(
        "api-investor",
        "save-settings",
        expect.objectContaining({
          memo_sections: [
            expect.objectContaining({ title: "Updated memo title" }),
          ],
          round_size_sek: 1_250_000,
          valuation_sek: 5_000_000,
        }),
      );
    });

    cleanup();
    const memoFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        lead: {
          name: "Investor",
          email: "investor@example.com",
          submitted_interest_at: null,
          requested_shares: null,
        },
        settings: persistedSettings,
        assets: [],
      }),
    });
    vi.stubGlobal("fetch", memoFetch);

    render(
      <MemoryRouter initialEntries={["/invest/memo/test-token"]}>
        <Routes>
          <Route path="/invest/memo/:token" element={<InvestMemoPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Updated memo title")).toBeInTheDocument();
    expect(screen.getByText("1 250 000 SEK")).toBeInTheDocument();
    expect(screen.getByText("5 000 000 SEK")).toBeInTheDocument();
    expect(memoFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api-investor/memo?token=test-token"),
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );

    cleanup();
    render(<InvestPage />);

    expect(await screen.findByText("Editable investor hero")).toBeInTheDocument();
    expect(screen.getByText("Editable public thesis")).toBeInTheDocument();
  });
});
