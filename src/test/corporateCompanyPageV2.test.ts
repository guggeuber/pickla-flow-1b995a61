import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildCorporatePublicMedia,
  buildCorporateSchedulePresentation,
  corporatePageImagePath,
  formatCorporateAddress,
  isCorporatePageImagePath,
  validateCorporateImageFile,
} from "@/lib/corporatePublicPage";
import {
  canListPublicCorporateAccount,
  canResolvePublicCorporateAccount,
  defaultCorporatePublicPageContent,
  normalizeCorporatePageGallery,
  normalizeCorporatePublicPageContent,
} from "../../supabase/functions/_shared/corporate";

const ACCOUNT_ID = "c0910000-0000-4000-8000-000000000020";
const session = (id: string, date: string, start = "17:00:00", end = "18:00:00") => ({
  id,
  session_date: date,
  start_time: start,
  end_time: end,
  occurrence_index: Number(id.replace(/\D/g, "")) || 1,
  courts: [{ id: "court-8", name: "Bana 8", sport_type: "pickleball" }],
});

describe("Corporate company page V2 employee presentation", () => {
  it("turns canonical concrete Sessions into human schedule copy without accounting counts", () => {
    const sessions = [
      session("s1", "2026-09-21"),
      session("s2", "2026-09-23"),
      session("s3", "2026-12-28"),
      session("s4", "2026-12-30"),
    ];
    expect(buildCorporateSchedulePresentation(sessions)).toEqual({
      weekdayLabel: "Mondays & Wednesdays",
      timeLabel: "17:00–18:00",
      dateRangeLabel: "21 September – 30 December",
      primaryTime: "17:00–18:00",
      hasExceptions: false,
    });
    expect(JSON.stringify(buildCorporateSchedulePresentation(sessions))).not.toContain("×");
  });

  it("flags a concrete occurrence time exception instead of hiding it in Series copy", () => {
    const result = buildCorporateSchedulePresentation([
      session("s1", "2026-09-21"),
      session("s2", "2026-09-23", "18:00:00", "19:00:00"),
      session("s3", "2026-09-28"),
    ]);
    expect(result.primaryTime).toBe("17:00–18:00");
    expect(result.hasExceptions).toBe(true);
  });

  it("renders the canonical venue address as one navigable human string", () => {
    expect(formatCorporateAddress({ address: "Svetsarvägen 22", postal_code: "171 41", city: "Solna" }))
      .toBe("Svetsarvägen 22, 171 41 Solna");
  });

  it("ships concise reusable English defaults without unsupported ranking or statistics", () => {
    const defaults = defaultCorporatePublicPageContent("Ericsson");
    expect(defaults.hero_headline).toBe("Ericsson × Pickla");
    expect(defaults.pickleball_heading).toBe("NEW TO PICKLEBALL? PERFECT.");
    expect(defaults.pickla_heading).toBe("WELCOME TO PICKLA");
    expect(defaults.pickla_body).toContain("one of Europe’s leading dedicated pickleball communities");
    expect(JSON.stringify(defaults)).not.toMatch(/#1|million|participants/i);
  });
});

describe("Corporate page CMS and image boundaries", () => {
  it("projects hero-only semantics while preserving non-hero gallery order", () => {
    const media = buildCorporatePublicMedia(
      "https://project.test/storage/gallery-hero.webp?v=current",
      [
        "https://project.test/storage/gallery-1.webp?v=one",
        "https://project.test/storage/gallery-hero.webp?v=legacy",
        "https://project.test/storage/gallery-2.webp?v=two",
        "https://project.test/storage/gallery-1.webp?v=newer",
      ],
      "/assets/default-community.jpg",
    );

    expect(media.heroImage).toBe("https://project.test/storage/gallery-hero.webp?v=current");
    expect(media.galleryImages).toEqual([
      "https://project.test/storage/gallery-1.webp?v=one",
      "https://project.test/storage/gallery-2.webp?v=two",
    ]);
  });

  it("keeps structured editorial fields separate from schedule and participation truth", () => {
    const path = corporatePageImagePath(ACCOUNT_ID, "gallery", "11111111-1111-4111-8111-111111111111");
    const normalized = normalizeCorporatePublicPageContent({
      hero_headline: "Ericsson × Pickla",
      short_intro: "Weekly pickleball.",
      hero_image_path: path,
      gallery_image_paths: [path],
      pickleball_heading: "New to pickleball?",
      pickleball_body: "Easy to learn.",
      pickla_heading: "Welcome to Pickla",
      pickla_body: "A dedicated community.",
      practical_information: "Bring indoor shoes.",
      help_contact_text: "Ask your coordinator.",
    }, ACCOUNT_ID);
    expect(normalized.gallery_image_paths).toEqual([path]);
    expect(normalized).not.toHaveProperty("sessions");
    expect(normalized).not.toHaveProperty("participation");
    expect(normalized).not.toHaveProperty("court_ids");
  });

  it("accepts only account-owned optimized image paths and at most six gallery images", () => {
    const path = corporatePageImagePath(ACCOUNT_ID, "hero");
    expect(path).toBe(`corporate-accounts/${ACCOUNT_ID}/hero.webp`);
    expect(isCorporatePageImagePath(path, ACCOUNT_ID)).toBe(true);
    expect(isCorporatePageImagePath(path, "d0910000-0000-4000-8000-000000000020")).toBe(false);
    expect(() => normalizeCorporatePageGallery(Array.from({ length: 7 }, () => path), ACCOUNT_ID)).toThrow(/at most 6/);
    expect(() => normalizeCorporatePageGallery(["activity-series/other/1.webp"], ACCOUNT_ID)).toThrow(/account-owned/);
  });

  it("validates MIME and source size before browser-side WebP optimization", () => {
    expect(() => validateCorporateImageFile({ type: "image/webp", size: 1024 })).not.toThrow();
    expect(() => validateCorporateImageFile({ type: "image/svg+xml", size: 1024 })).toThrow(/JPG, PNG or WebP/);
    expect(() => validateCorporateImageFile({ type: "image/jpeg", size: 5 * 1024 * 1024 + 1 })).toThrow(/5 MB/);
  });
});

describe("Corporate V2 permanent architecture contracts", () => {
  const api = readFileSync("supabase/functions/api-corporate/index.ts", "utf8");
  const migration = readFileSync("supabase/migrations/20260914120000_corporate_company_page_v2_cms.sql", "utf8");
  const page = readFileSync("src/pages/CorporateCompanyPage.tsx", "utf8");

  it("keeps direct unlisted resolution while excluding unlisted accounts from discovery", () => {
    expect(canResolvePublicCorporateAccount({ is_active: true, public_visibility: "unlisted", slug: "ericsson" })).toBe(true);
    expect(canListPublicCorporateAccount({ is_active: true, public_visibility: "unlisted", slug: "ericsson" })).toBe(false);
  });

  it("reads and writes CMS content through strict public and authorized admin paths", () => {
    expect(api).toContain("projectCorporatePageContent(serviceClient, account, context.pageContent)");
    expect(api).toContain("path === 'admin-page-content'");
    const handler = api.slice(api.indexOf("path === 'admin-page-content'"), api.indexOf("path === 'admin-orders'"));
    expect(handler.indexOf("requireVenueRole")).toBeLessThan(handler.indexOf(".upsert("));
    expect(handler).toContain("normalizeCorporatePublicPageContent");
    expect(migration).toContain("REVOKE ALL ON public.corporate_public_page_content FROM PUBLIC, anon, authenticated");
  });

  it("keeps the public projection on an explicit privacy allowlist", () => {
    const publicLoader = api.slice(api.indexOf("async function loadPublicCorporateContext"), api.indexOf("async function requireCorporateSeriesVenue"));
    for (const forbidden of ["invite_token", "contact_email", "contact_phone", "purchaser_name", "total_price", "notes", "updated_by"]) {
      expect(publicLoader).not.toContain(forbidden);
    }
    expect(publicLoader).toContain("hero_headline");
    expect(publicLoader).toContain("gallery_image_paths");
  });

  it("reflects hidden/cancelled occurrence overrides and never replaces Sessions with CMS schedule fields", () => {
    expect(api).toContain("activeCorporateSessions(sessions || [], excluded)");
    expect(api).toContain(".in('status', ['hidden', 'cancelled'])");
    const contentTable = migration.slice(
      migration.indexOf("CREATE TABLE IF NOT EXISTS public.corporate_public_page_content"),
      migration.indexOf("ALTER TABLE public.corporate_public_page_content ENABLE ROW LEVEL SECURITY"),
    );
    expect(contentTable).not.toMatch(/\b(session_date|start_time|end_time|court_ids|participation_management_mode)\b/i);
  });

  it("fixes the shared company CTA with explicit high-contrast interactive states and mobile layout", () => {
    expect(page).toContain("Discover more at Pickla");
    expect(page).toContain("bg-[#111a35]");
    expect(page).toContain("text-white");
    expect(page).toContain("hover:text-white");
    expect(page).toContain("active:text-white");
    expect(page).toContain("focus-visible:ring-[#ed3f8f]");
    expect(page).toContain("grid lg:grid-cols-[1.05fr_0.95fr]");
    expect(page).toContain("sizes=\"(max-width: 1023px) 100vw, 48vw\"");
  });
});
