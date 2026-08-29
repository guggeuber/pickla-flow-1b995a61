import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { inheritedEventImages, namedEventImagePath, nextNamedEventImageSlot } from "@/lib/eventMedia";
import { customerCourtPriceLabel, customerFacingDescription } from "@/lib/customerPricing";

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
    expect(page).toContain("Första gången? Spela för 99 kr.");
    expect(page).toContain("Racket finns att låna.");
    expect(page).toContain('description="Spela Open Play hela dagen."');
    expect(page).toContain("courseItems.length ?");
    expect(page).not.toContain("product.description || \"Spela Open Play hela dagen.\"");
    expect(page).not.toMatch(/<table|line-through|överstruk/i);
  });

  it("keeps customer court pricing public without exposing booking operations", () => {
    const bookings = read("supabase/functions/api-bookings/index.ts");
    const publicPricing = bookings.slice(bookings.indexOf("Public customer price projection"), bookings.indexOf("try {", bookings.indexOf("Public customer price projection")));
    expect(publicPricing).toContain("path === 'pricing'");
    expect(publicPricing).toContain(".eq('is_public', true)");
    expect(publicPricing).toContain("id, name, type, price, days_of_week, time_from, time_to");
    expect(publicPricing).not.toContain("getAuthenticatedClient");
  });

  it("projects operational court bands and unsafe product copy into customer language", () => {
    expect(customerCourtPriceLabel({ name: "Förmiddag låg", time_from: "10:00", time_to: "12:00", days_of_week: [1, 2, 3, 4, 5] })).toBe("Förmiddag");
    expect(customerCourtPriceLabel({ name: "Eftermiddag Låg", time_from: "14:00", time_to: "16:00", days_of_week: [1, 2, 3, 4, 5] })).toBe("Eftermiddag");
    expect(customerCourtPriceLabel({ name: "Eftermiddag kväll hög", time_from: "16:00", time_to: "22:00", days_of_week: [1, 2, 3, 4, 5] })).toBe("Kväll");
    expect(customerCourtPriceLabel({ name: "Helg hög", time_from: "09:00", time_to: "22:00", days_of_week: [0, 6] })).toBe("Helg");
    expect(customerFacingDescription("Kan användas som upsell från enstaka aktivitetspass.", "Spela Open Play hela dagen.")).toBe("Spela Open Play hela dagen.");
  });

  it("inherits Series images before Format images without placeholders", () => {
    const formatImage = "https://example.test/format.jpg";
    const seriesImage = "https://example.test/series.jpg";
    expect(inheritedEventImages({ activity_series: { image_urls: [seriesImage], activity_formats: { image_urls: [formatImage] } } })).toEqual([seriesImage]);
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
    expect(resolver).toContain("firstVisitEligibilityForCustomer");
    expect(resolver).toContain("pricingReason = 'first_visit_offer'");
    const onceMigration = read("supabase/migrations/20260816120000_first_visit_offer_once.sql");
    expect(onceMigration).toContain("registration.status IN ('confirmed', 'checked_in', 'no_show', 'cancelled')");
    expect(onceMigration).toContain("IN ('activity_ticket', 'day_pass')");
    expect(onceMigration).toContain("acquire_first_visit_activity_pricing_hold");
    expect(onceMigration).toContain("pg_advisory_xact_lock");
    expect(onceMigration).toContain("idx_capacity_holds_one_active_first_visit_per_customer");
    expect(onceMigration).toContain("hold.stripe_session_id IS NOT NULL");
    expect(onceMigration).not.toContain("booking_participants");
    expect(onceMigration).not.toContain("commerce_order_lines");
    const commerce = read("supabase/functions/api-commerce/index.ts");
    expect(commerce).toContain("applyFirstVisit: false");
    expect(commerce).toContain("FIRST_VISIT_STRIPE_EXPIRY_SECONDS");
    expect(commerce).toContain("FIRST_VISIT_HOLD_TTL_SECONDS");
    expect(commerce).toContain("expireStripeCheckoutSession");
    expect(commerce).toContain("reconcileExpiredFirstVisitCheckouts");
    expect(publicApi).toContain("customer_presentation: decision.customerPresentation");
    expect(admin).toContain("Prova-på får inte aktiveras på Fredagsklubben");
    expect(read("src/pages/ProgramSessionPage.tsx")).toContain("Racket finns att låna.");
  });

  it("drives Home, schedule and detail prices from the canonical customer projection", () => {
    const today = read("src/pages/TodayPage.tsx");
    const schedule = read("src/pages/OpenPlayPage.tsx");
    const detail = read("src/pages/ProgramSessionPage.tsx");
    const publicApi = read("supabase/functions/api-event-public/index.ts");
    expect(publicApi).toContain("customer_presentation: decision.customerPresentation");
    expect(today).toContain("customerPrice.displayPriceSek");
    expect(today).toContain("featuredPricing?.customer_presentation?.displayLabel");
    expect(schedule).toContain("resolvedPrice?.displayPriceSek");
    expect(detail).toContain("selectedCustomerPrice?.displayPriceSek");
    expect(detail).toContain("selectedCustomerPrice?.displayLabel");
  });

  it("uses named images in schedule, detail and OG while Home keeps compact Series truth", () => {
    const today = read("src/pages/TodayPage.tsx");
    const homeSeries = read("src/components/series/SeriesRegistrationCard.tsx");
    const openPlay = read("src/pages/OpenPlayPage.tsx");
    const event = read("src/pages/EventPage.tsx");
    const og = read("supabase/functions/api-event-public/index.ts");
    expect(today).toContain("imageUrls: inheritedEventImages");
    expect(openPlay).toContain("scarcity_mode, activity_series(image_urls, activity_formats(image_urls))");
    expect(openPlay).toContain("imageUrls: inheritedEventImages(session)");
    expect(event).toContain("eventHero = event.background_url || eventLogo");
    expect(og).toContain("preview.activity_session.image_urls?.[0]");
    expect(og).toContain("path === 'event-og'");
    expect(og).toContain("path === 'course-og'");
    expect(today).toContain("<SeriesRegistrationCard");
    expect(homeSeries).toContain("series.format?.description");
    expect(homeSeries).not.toContain("full_description");
    expect(homeSeries).toContain("rounded-full bg-black");
  });
});
