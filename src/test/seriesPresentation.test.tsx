import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SeriesRegistrationCard } from "@/components/series/SeriesRegistrationCard";
import type { CourseDetail } from "@/lib/courses";
import {
  occurrenceCountLabel,
  seriesCustomerTitle,
  seriesPresentation,
} from "@/lib/seriesPresentation";
import { frozenSeriesLinePriceLabel, seriesBookingCta, seriesPricePresentation } from "@/lib/seriesCustomerPricing";

const read = (path: string) => readFileSync(path, "utf8");

function fixture(presentationType: "course" | "social_event" | "clinic" | "tournament"): CourseDetail {
  return {
    id: `series-${presentationType}`,
    venue_id: "venue-1",
    format_id: `format-${presentationType}`,
    name: presentationType === "social_event" ? "Parker" : "Pickla 101 · Hösten 2026",
    description: null,
    image_urls: ["https://example.test/parker-brunch.webp"],
    status: "active",
    start_date: "2026-09-05",
    end_date: "2026-09-05",
    total_sessions: presentationType === "social_event" ? 1 : 4,
    registration_opens_at: "2026-08-01T00:00:00Z",
    registration_closes_at: "2026-09-01T00:00:00Z",
    recurrence_days: [6],
    start_time: "13:00",
    end_time: "18:00",
    court_ids: [],
    registration_state: "open",
    customer_has_commitment: false,
    format: {
      id: `format-${presentationType}`,
      name: presentationType === "social_event" ? "Parker Brunch" : "Pickla 101",
      description: presentationType === "social_event"
        ? "Brunch, pickleball och människor i huset."
        : "Fyra veckor. Åtta spelare, två banor, en coach.",
      full_description: "Full beskrivning",
      image_urls: ["https://example.test/parker-brunch.webp"],
      presentation_type: presentationType,
      age_group: "adult",
      level: "beginner",
      requires_instructor: true,
    },
    product: { id: "product-1", product_key: "parker", name: "Plats", description: null, base_price_sek: 199, vat_rate: 6, status: "active", is_active: true, scarcity_mode: "early_bird", early_bird_price_minor: 14900, early_bird_slots: 10 },
    pricing: presentationType === "social_event" ? {
      scope_type: "activity_series",
      list_price_minor: 19900,
      final_price_minor: 14900,
      pricing_reason: "early_bird",
      sales_channel: "online",
      checkout_label: "149 kr",
      membership_tier_name: null,
      early_bird: { configured: true, active: true, applied: true, price_minor: 14900, slots: 10, remaining: 10 },
    } : null,
    venue: { id: "venue-1", name: "Pickla Stockholm", slug: "pickla-arena-sthlm" },
    sessions: [],
    capacity: { capacity: 40, committed_count: 0, active_holds_count: 0, available_count: 40 },
    included_access: {
      open_play_series_period: {
        enabled: presentationType === "course",
        starts_at: presentationType === "course" ? "2026-09-04T22:00:00Z" : null,
        expires_at: presentationType === "course" ? "2026-09-26T22:00:00Z" : null,
        start_date: presentationType === "course" ? "2026-09-05" : null,
        end_date: presentationType === "course" ? "2026-09-26" : null,
        period_source: "active_series_occurrences",
      },
    },
  };
}

describe("Series presentation projection", () => {
  it("centralizes labels, CTA, discovery and presentation metadata", () => {
    expect(seriesPresentation("course")).toMatchObject({ label: "KURS", bookingCta: "Boka kurs", listedInCourses: true });
    expect(seriesPresentation("social_event")).toMatchObject({ label: "EVENT", bookingCta: "Boka plats", hideSingleOccurrenceCount: true, imageProminence: "prominent", listedInCourses: false });
    expect(seriesPresentation("clinic")).toMatchObject({ label: "CLINIC", bookingCta: "Boka plats", showInstructor: true, listedInCourses: false });
    expect(seriesPresentation("tournament")).toMatchObject({ label: "TURNERING", bookingCta: "Boka plats", listedInCourses: false });
    expect(seriesPresentation("unknown").type).toBe("course");
    expect(occurrenceCountLabel(1)).toBe("1 tillfälle");
    expect(occurrenceCountLabel(2)).toBe("2 tillfällen");
  });

  it("gives Parker Brunch a prominent Home image and place CTA", () => {
    const onOpen = vi.fn();
    render(<SeriesRegistrationCard series={fixture("social_event")} onOpen={onOpen} />);
    expect(screen.getByText("EVENT · Anmälan öppen")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Parker Brunch" })).toBeInTheDocument();
    expect(screen.getByTestId("home-series-image")).toHaveAttribute("src", "https://example.test/parker-brunch.webp");
    expect(screen.getByTestId("home-series-image")).not.toHaveClass("object-cover");
    expect(screen.getByText("Early Bird · 149 kr")).toBeInTheDocument();
    expect(screen.getByText("Första 10 platserna · sedan 199 kr")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Boka Early Bird · 149 kr" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("formats only the canonical winning Series price and frozen cart reason", () => {
    const membership = seriesPricePresentation({
      basePriceSek: 199,
      pricing: {
        scope_type: "activity_series",
        list_price_minor: 19900,
        final_price_minor: 12900,
        pricing_reason: "membership_tier_pricing",
        sales_channel: "online",
        checkout_label: "129 kr",
        membership_tier_name: "Play+",
        early_bird: { configured: true, active: true, applied: false, price_minor: 14900, slots: 10, remaining: 7 },
      },
    });
    expect(membership).toEqual({ label: "Medlemspris", finalPriceMinor: 12900, primary: "Medlemspris · 129 kr", context: "Play+" });
    expect(membership.primary).not.toContain("Early Bird");
    expect(seriesBookingCta(membership, "Boka plats")).toBe("Boka plats · 129 kr");
    expect(frozenSeriesLinePriceLabel({ pricing_reason: "early_bird" })).toBe("Early Bird");
    expect(frozenSeriesLinePriceLabel({ pricing_reason: "membership_tier_pricing", membership_tier_name: "Play+" })).toBe("Medlemspris · Play+");
  });

  it("uses Format identity for social events without changing Course run names", () => {
    expect(seriesCustomerTitle({ seriesName: "Parker", formatName: "Parker Brunch", presentationType: "social_event" })).toBe("Parker Brunch");
    expect(seriesCustomerTitle({ seriesName: "Pickla 101 · Hösten 2026", formatName: "Pickla 101", presentationType: "course" })).toBe("Pickla 101 · Hösten 2026");
  });

  it("uses the shared artwork-led Home shell and canonical benefit USP for Course", () => {
    render(<SeriesRegistrationCard series={fixture("course")} onOpen={() => undefined} />);
    expect(screen.getByText("KURS · Anmälan öppen")).toBeInTheDocument();
    expect(screen.getByTestId("home-series-image")).toHaveAttribute("src", "https://example.test/parker-brunch.webp");
    expect(screen.getByTestId("home-series-image")).not.toHaveClass("object-cover");
    expect(screen.getByText("Fri Open Play ingår")).toBeInTheDocument();
    expect(screen.getByText("Spela fritt mellan kurstillfällena")).toBeInTheDocument();
    expect(screen.queryByText("Pris · 199 kr")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Boka kurs · 199 kr" })).toBeInTheDocument();
  });

  it("does not fabricate artwork, benefit or open registration state", () => {
    const noArtwork = fixture("course");
    noArtwork.image_urls = [];
    noArtwork.included_access!.open_play_series_period.enabled = false;
    noArtwork.registration_state = "closed";
    render(<SeriesRegistrationCard series={noArtwork} onOpen={() => undefined} />);
    expect(screen.queryByTestId("home-series-image")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-series-benefit")).not.toBeInTheDocument();
    expect(screen.getByText("Pris · 199 kr")).toBeInTheDocument();
    expect(screen.getByText("KURS · Anmälan stängd")).toBeInTheDocument();
  });

  it("filters /courses at both API and UI boundaries", () => {
    const api = read("supabase/functions/api-courses/index.ts");
    const page = read("src/pages/CoursesPage.tsx");
    expect(api).toContain(".eq('activity_formats.presentation_type', 'course')");
    expect(api).toContain("projected.format?.presentation_type === 'course'");
    expect(page).toContain("listedInCourses");
  });

  it("keeps presentation type out of Series commercial and operational writes", () => {
    const migration = read("supabase/migrations/20260820120000_series_presentation_types.sql");
    const courses = read("supabase/functions/api-courses/index.ts");
    const commerce = read("supabase/functions/api-commerce/index.ts");
    const formatWrite = courses.slice(courses.indexOf("path === 'format'"), courses.indexOf("path === 'series-preview'"));
    const seriesWrite = courses.slice(courses.indexOf("path === 'series-preview'"));
    expect(migration).toContain("Customer presentation only");
    expect(formatWrite).toContain("presentation_type");
    expect(seriesWrite).not.toContain("presentation_type:");
    expect(commerce.match(/presentation_type/g)).toHaveLength(3);
    expect(commerce).not.toMatch(/presentation_type\s*===|presentation_type\s*!==/);
  });

  it("uses the canonical Series to Format image inheritance without a placeholder", () => {
    const courses = read("supabase/functions/api-courses/index.ts");
    const og = read("supabase/functions/api-event-public/index.ts");
    const courseOg = og.slice(og.indexOf("path === 'course-og'"), og.indexOf("path === 'first-visit-offers'"));
    expect(courses).toContain("seriesImages.length ? seriesImages : formatImages");
    expect(courses).not.toContain("sessionImages");
    expect(courseOg).not.toContain("firstSession");
    expect(courseOg).toContain("inheritedNamedEventImages({ image_urls: series.image_urls, activity_formats: courseFormat })");
    expect(courseOg).toContain("|| null");
    expect(courseOg).not.toContain("og-pickla.jpg");
  });
});
