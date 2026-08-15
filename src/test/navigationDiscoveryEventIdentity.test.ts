import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { inheritedEventImages, namedEventImagePath, nextNamedEventImageSlot } from "@/lib/eventMedia";

const read = (path: string) => readFileSync(path, "utf8");

describe("Navigation, discovery and event identity contract", () => {
  it("keeps booking language customer-facing and exposes first-class discovery routes", () => {
    const booking = read("src/pages/BookingPage.tsx");
    const app = read("src/App.tsx");
    const menu = read("src/components/PicklaTopBar.tsx");
    expect(booking).not.toContain("Boka aktivitet");
    expect(booking).toContain("Boka bana");
    expect(app).toContain('path="/prices"');
    expect(app).toContain('path="/courses"');
    expect(menu).toContain("Spela idag");
    expect(menu).not.toContain("Boka pickleball");
    expect(menu).not.toContain("Boka darts");
  });

  it("uses a restrained list instead of a price matrix and keeps membership purchase discoverable", () => {
    const page = read("src/pages/PricesMembershipPage.tsx");
    expect(page).toContain("Priser & medlemskap");
    expect(page).toContain("/membership?v=");
    expect(page).toContain("Första gången? Prova för 99 kr — racket ingår.");
    expect(page).not.toMatch(/<table|line-through|överstruk/i);
  });

  it("inherits Series images before Format images without placeholders", () => {
    const formatImage = "https://example.test/format.jpg";
    const seriesImage = "https://example.test/series.jpg";
    expect(inheritedEventImages({ image_urls: [seriesImage], activity_formats: { image_urls: [formatImage] } })).toEqual([seriesImage]);
    expect(inheritedEventImages({ image_urls: [], activity_formats: { image_urls: [formatImage] } })).toEqual([formatImage]);
    expect(inheritedEventImages({ image_urls: [], activity_formats: { image_urls: [] } })).toEqual([]);
    const schedule = read("src/components/session/SessionScheduleRow.tsx");
    expect(schedule).toContain("presentation.imageUrls?.[0]");
    expect(schedule).not.toMatch(/placeholder.*image|image.*placeholder/i);
  });

  it("uses canonical event-logos paths with three stable slots", () => {
    const url = "https://project.supabase.co/storage/v1/object/public/event-logos/activity-formats/00000000-0000-4000-8000-000000000001/1.webp?v=1";
    expect(namedEventImagePath(url)).toBe("activity-formats/00000000-0000-4000-8000-000000000001/1.webp");
    expect(nextNamedEventImageSlot([url])).toBe(2);
    expect(read("src/lib/eventMedia.ts")).toContain('NAMED_EVENT_IMAGE_BUCKET = "event-logos"');
  });

  it("keeps Prova-på session-scoped, fixed at 99 SEK and invisible to returning customers", () => {
    const migration = read("supabase/migrations/20260815120000_navigation_discovery_event_identity.sql");
    const resolver = read("supabase/functions/_shared/activity_pricing.ts");
    const publicApi = read("supabase/functions/api-event-public/index.ts");
    const admin = read("supabase/functions/api-admin/index.ts");
    expect(migration).toContain("first_visit_price_minor = 9900");
    expect(migration).not.toContain("campaign_starts_at");
    expect(resolver).toContain("hasPriorPaidParticipation");
    expect(resolver).toContain("pricingReason = 'first_visit_offer'");
    expect(publicApi).toContain("offer?.applied ?");
    expect(admin).toContain("Prova-på får inte aktiveras på Fredagsklubben");
    expect(read("src/pages/ProgramSessionPage.tsx")).toContain("Racket finns att låna.");
  });

  it("uses named images in schedule, detail and OG while Home keeps compact Course truth", () => {
    const today = read("src/pages/TodayPage.tsx");
    const event = read("src/pages/EventPage.tsx");
    const og = read("supabase/functions/api-event-public/index.ts");
    expect(today).toContain("imageUrls: inheritedEventImages");
    expect(event).toContain("eventHero = event.background_url || eventLogo");
    expect(og).toContain("preview.activity_session.image_urls?.[0]");
    expect(og).toContain("path === 'event-og'");
    expect(og).toContain("path === 'course-og'");
    const courseCard = today.slice(today.indexOf('data-testid="home-course-card"'), today.indexOf('courseHome?.mode === "next"'));
    expect(courseCard).toContain("course.format?.description");
    expect(courseCard).not.toContain("full_description");
    expect(courseCard).toContain("rounded-full bg-black");
  });
});
