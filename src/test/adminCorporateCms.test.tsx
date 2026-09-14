import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CorporatePublicPageEditor } from "@/components/admin/AdminCorporate";
import { apiPatch } from "@/lib/api";
import { removeCorporatePageImage, uploadCorporatePageImage } from "@/lib/corporatePublicPage";

vi.mock("@/lib/api", () => ({ apiGet: vi.fn(), apiPatch: vi.fn(), apiPost: vi.fn() }));
vi.mock("@/lib/corporatePublicPage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/corporatePublicPage")>();
  return {
    ...actual,
    uploadCorporatePageImage: vi.fn(),
    removeCorporatePageImage: vi.fn(),
    corporatePageImagePublicUrl: vi.fn(async (path: string) => `https://assets.test/${path}`),
  };
});

const account = {
  id: "c0910000-0000-4000-8000-000000000020",
  company_name: "Ericsson",
  slug: "ericsson",
  public_visibility: "unlisted",
  public_page: {
    hero_headline: "Ericsson × Pickla",
    short_intro: "Weekly pickleball.",
    hero_image_path: null,
    gallery_image_paths: [
      "corporate-accounts/c0910000-0000-4000-8000-000000000020/gallery-11111111-1111-4111-8111-111111111111.webp",
      "corporate-accounts/c0910000-0000-4000-8000-000000000020/gallery-22222222-2222-4222-8222-222222222222.webp",
    ],
    pickleball_heading: "NEW TO PICKLEBALL? PERFECT.",
    pickleball_body: "Easy to learn.",
    pickla_heading: "WELCOME TO PICKLA",
    pickla_body: "A dedicated community.",
    practical_information: "Bring indoor shoes.",
    help_contact_text: "Ask your coordinator.",
  },
};

function renderEditor() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><CorporatePublicPageEditor account={account} onSaved={vi.fn()} /></QueryClientProvider>);
}

describe("Corporate Admin light CMS", () => {
  beforeEach(() => {
    vi.mocked(apiPatch).mockImplementation(async (_functionName, path, body) => {
      if (path !== "admin-page-content") return {};
      return { ...(body as Record<string, unknown>), help_contact_text: (body as Record<string, unknown>).help_contact_text || null } as never;
    });
    vi.mocked(uploadCorporatePageImage).mockResolvedValue("corporate-accounts/c0910000-0000-4000-8000-000000000020/hero.webp");
    vi.mocked(removeCorporatePageImage).mockResolvedValue(undefined);
  });

  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("edits structured copy and previews the slug directly", async () => {
    renderEditor();
    fireEvent.click(screen.getByText("Publik företagssida"));
    expect(screen.getByRole("link", { name: /Förhandsvisa publik sida/ })).toHaveAttribute("href", expect.stringMatching(/\/foretag\/ericsson$/));
    fireEvent.change(screen.getByLabelText("Hero-rubrik"), { target: { value: "Ericsson teammates × Pickla" } });
    fireEvent.change(screen.getByLabelText("Praktisk information"), { target: { value: "Meet us on the top floor." } });
    fireEvent.click(screen.getByRole("button", { name: "Spara publik sida" }));
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith("api-corporate", "admin-page-content", expect.objectContaining({
      account_id: account.id,
      hero_headline: "Ericsson teammates × Pickla",
      practical_information: "Meet us on the top floor.",
    })));
  });

  it("changes the hero and adds an optimized account-owned gallery image", async () => {
    renderEditor();
    fireEvent.click(screen.getByText("Publik företagssida"));
    const image = new File(["image"], "team.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Ladda upp hero-bild"), { target: { files: [image] } });
    await waitFor(() => expect(uploadCorporatePageImage).toHaveBeenCalledWith({ accountId: account.id, role: "hero", file: image }));
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith("api-corporate", "admin-page-content", expect.objectContaining({ hero_image_path: expect.stringContaining("/hero.webp") })));

    vi.mocked(uploadCorporatePageImage).mockResolvedValueOnce("corporate-accounts/c0910000-0000-4000-8000-000000000020/gallery-33333333-3333-4333-8333-333333333333.webp");
    fireEvent.change(screen.getByLabelText("Lägg till galleribild"), { target: { files: [image] } });
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith("api-corporate", "admin-page-content", expect.objectContaining({
      gallery_image_paths: expect.arrayContaining([expect.stringContaining("gallery-33333333")]),
    })));
  });

  it("reorders, selects and removes gallery images without accepting arbitrary URLs", async () => {
    renderEditor();
    fireEvent.click(screen.getByText("Publik företagssida"));
    fireEvent.click(screen.getByRole("button", { name: "Flytta bild 2 upp" }));
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith("api-corporate", "admin-page-content", expect.objectContaining({
      gallery_image_paths: [account.public_page.gallery_image_paths[1], account.public_page.gallery_image_paths[0]],
    })));
    fireEvent.click(screen.getAllByRole("button", { name: "Välj som hero" })[0]);
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith("api-corporate", "admin-page-content", expect.objectContaining({ hero_image_path: expect.stringContaining("gallery-") })));
    fireEvent.click(screen.getByRole("button", { name: "Ta bort bild 1" }));
    await waitFor(() => expect(removeCorporatePageImage).toHaveBeenCalledWith(account.id, expect.stringContaining("gallery-")));
  });
});
