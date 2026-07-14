import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { investorDefaults, mergeInvestorSettings, type InvestorSettings } from "@/lib/investorContent";
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
  it("shows only a stable skeleton until database content and assets are ready", async () => {
    let resolveRequest: ((value: unknown) => void) | undefined;
    const request = new Promise((resolve) => { resolveRequest = resolve; });
    const databaseSettings = mergeInvestorSettings({
      headline: "Database investor headline",
      subheadline: "Database investor subheadline",
      public_thesis: "Database investor thesis",
    });
    const heroAsset = {
      id: "hero-1",
      organization_id: null,
      asset_type: "hero" as const,
      title: "Database hero",
      description: null,
      storage_path: "investor/database-hero.jpg",
      public_url: "https://example.com/database-hero.jpg",
      sort_order: 0,
      is_active: true,
    };

    mocks.apiGet.mockReturnValue(request);
    render(<InvestPage />);

    expect(screen.getByTestId("investor-page-skeleton")).toBeInTheDocument();
    expect(screen.queryByText(investorDefaults.headline!)).not.toBeInTheDocument();
    expect(screen.queryByText("Database investor headline")).not.toBeInTheDocument();
    expect(mocks.apiGet).toHaveBeenCalledTimes(1);

    resolveRequest?.({ settings: databaseSettings, assets: [heroAsset] });

    expect(await screen.findByText("Database investor headline")).toBeInTheDocument();
    expect(screen.queryByTestId("investor-page-skeleton")).not.toBeInTheDocument();
    const heroImage = screen.getByRole("img", { name: "Database hero" });
    expect(screen.getByTestId("investor-hero-image")).toHaveClass("aspect-[4/3]");
    expect(screen.getByTestId("investor-hero-image-skeleton")).toBeInTheDocument();

    fireEvent.load(heroImage);
    await waitFor(() => expect(screen.queryByTestId("investor-hero-image-skeleton")).not.toBeInTheDocument());
    expect(mocks.apiGet).toHaveBeenCalledTimes(1);
  });

  it("shows an unavailable state instead of fallback copy when loading fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let rejectRequest: ((reason?: unknown) => void) | undefined;
    const request = new Promise((_resolve, reject) => { rejectRequest = reject; });
    mocks.apiGet.mockReturnValue(request);

    render(<InvestPage />);

    expect(screen.getByTestId("investor-page-skeleton")).toBeInTheDocument();
    expect(screen.queryByText(investorDefaults.headline!)).not.toBeInTheDocument();

    rejectRequest?.(new Error("Network unavailable"));

    expect(await screen.findByRole("heading", { name: "Investor content unavailable" })).toBeInTheDocument();
    expect(screen.queryByText(investorDefaults.headline!)).not.toBeInTheDocument();
    expect(mocks.apiGet).toHaveBeenCalledTimes(1);
  });

  it("creates a name-only private memo in the existing investor list", async () => {
    const settings = mergeInvestorSettings({ id: "settings-1" });
    mocks.apiGet.mockImplementation(async (_fn: string, endpoint: string) => {
      if (endpoint === "leads") return { leads: [] };
      if (endpoint === "admin-settings") return { settings, assets: [] };
      if (endpoint === "tokens") return { tokens: [] };
      throw new Error(`Unexpected endpoint ${endpoint}`);
    });
    mocks.apiPost.mockImplementation(async (_fn: string, endpoint: string, body: Record<string, unknown>) => {
      if (endpoint !== "create-private-memo") throw new Error(`Unexpected endpoint ${endpoint}`);
      return {
        memo_url: "https://playpickla.com/invest/memo/private-token",
        lead: {
          id: "private-lead-1",
          name: body.name,
          email: String(body.email || ""),
          status: "approved",
          approved_at: "2026-07-14T10:00:00.000Z",
          rejected_at: null,
          opened_at: null,
          submitted_interest_at: null,
          requested_shares: null,
          token_expires_at: "2026-08-13T10:00:00.000Z",
          message: null,
          metadata: { source: "private_invite", internal_note: body.internal_note },
          created_at: "2026-07-14T10:00:00.000Z",
        },
      };
    });

    render(<AdminInvestorPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Private memo" }));
    fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Ben Fletcher" } });
    fireEvent.click(screen.getByRole("button", { name: "Create memo" }));

    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("api-investor", "create-private-memo", {
      name: "Ben Fletcher",
      email: null,
      internal_note: null,
    }));
    expect(await screen.findByRole("heading", { name: "Private memo created" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open memo" })).toHaveAttribute("href", "https://playpickla.com/invest/memo/private-token");
    expect(screen.getByText("Ben Fletcher")).toBeInTheDocument();
    expect(screen.getByText("Private")).toBeInTheDocument();
  });

  it("sends optional private memo email and note and renders both in the existing list", async () => {
    const settings = mergeInvestorSettings({ id: "settings-1" });
    mocks.apiGet.mockImplementation(async (_fn: string, endpoint: string) => {
      if (endpoint === "leads") return { leads: [] };
      if (endpoint === "admin-settings") return { settings, assets: [] };
      if (endpoint === "tokens") return { tokens: [] };
      throw new Error(`Unexpected endpoint ${endpoint}`);
    });
    mocks.apiPost.mockImplementation(async (_fn: string, endpoint: string, body: Record<string, unknown>) => ({
      memo_url: "https://playpickla.com/invest/memo/private-token",
      lead: {
        id: "private-lead-2",
        name: body.name,
        email: body.email,
        status: "approved",
        approved_at: "2026-07-14T10:00:00.000Z",
        rejected_at: null,
        opened_at: null,
        submitted_interest_at: null,
        requested_shares: null,
        token_expires_at: "2026-08-13T10:00:00.000Z",
        message: null,
        metadata: { source: "private_invite", internal_note: body.internal_note },
        created_at: "2026-07-14T10:00:00.000Z",
      },
    }));

    render(<AdminInvestorPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Private memo" }));
    fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Ben Fletcher" } });
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "ben@example.com" } });
    fireEvent.change(screen.getByLabelText(/Internal note/), { target: { value: "Known contact" } });
    fireEvent.click(screen.getByRole("button", { name: "Create memo" }));

    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("api-investor", "create-private-memo", {
      name: "Ben Fletcher",
      email: "ben@example.com",
      internal_note: "Known contact",
    }));
    expect(await screen.findByText(/ben@example.com/)).toBeInTheDocument();
    expect(screen.getByText("Known contact")).toBeInTheDocument();
  });

  it("renders every existing public lead lifecycle state exactly as before", async () => {
    const settings = mergeInvestorSettings({ id: "settings-1" });
    const baseLead = {
      approved_at: null,
      rejected_at: null,
      opened_at: null,
      submitted_interest_at: null,
      requested_shares: null,
      token_expires_at: null,
      message: null,
      metadata: { source: "invest_page" },
      created_at: "2026-07-01T10:00:00.000Z",
    };
    const leads = [
      { ...baseLead, id: "pending", name: "Pending Person", email: "pending@example.com", status: "pending" },
      { ...baseLead, id: "approved", name: "Approved Person", email: "approved@example.com", status: "approved", approved_at: "2026-07-02T10:00:00.000Z" },
      { ...baseLead, id: "opened", name: "Opened Person", email: "opened@example.com", status: "opened", approved_at: "2026-07-02T10:00:00.000Z", opened_at: "2026-07-03T10:00:00.000Z" },
      { ...baseLead, id: "interested", name: "Interested Person", email: "interested@example.com", status: "interested", approved_at: "2026-07-02T10:00:00.000Z", opened_at: "2026-07-03T10:00:00.000Z", submitted_interest_at: "2026-07-04T10:00:00.000Z" },
      // Existing revoke uses status=rejected and clears the token; it has no new status value.
      { ...baseLead, id: "revoked", name: "Revoked Person", email: "revoked@example.com", status: "rejected", approved_at: "2026-07-02T10:00:00.000Z" },
    ];
    mocks.apiGet.mockImplementation(async (_fn: string, endpoint: string) => {
      if (endpoint === "leads") return { leads };
      if (endpoint === "admin-settings") return { settings, assets: [] };
      if (endpoint === "tokens") return { tokens: [] };
      throw new Error(`Unexpected endpoint ${endpoint}`);
    });

    render(<AdminInvestorPage />);

    const pendingRow = (await screen.findByText("Pending Person")).closest("div.rounded-xl") as HTMLElement;
    const approvedRow = screen.getByText("Approved Person").closest("div.rounded-xl") as HTMLElement;
    const openedRow = screen.getByText("Opened Person").closest("div.rounded-xl") as HTMLElement;
    const interestedRow = screen.getByText("Interested Person").closest("div.rounded-xl") as HTMLElement;
    const revokedRow = screen.getByText("Revoked Person").closest("div.rounded-xl") as HTMLElement;

    expect(within(pendingRow).getByText("pending")).toBeInTheDocument();
    expect(within(pendingRow).getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(within(pendingRow).getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(within(approvedRow).getByText("approved")).toBeInTheDocument();
    expect(within(openedRow).getByText("opened")).toBeInTheDocument();
    expect(within(interestedRow).getByText("interested")).toBeInTheDocument();
    expect(within(revokedRow).getByText("rejected")).toBeInTheDocument();
    expect(within(revokedRow).queryByText("revoked")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Revoke" })).toHaveLength(3);
    expect(screen.queryByText("Private")).not.toBeInTheDocument();
  });

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
          name: "Ben Fletcher",
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
    expect(screen.getByRole("heading", { name: "Ben Fletcher, Editable investor hero" })).toBeInTheDocument();
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
