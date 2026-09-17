import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { loadAcquisitionData, resolveAcquisitionFacts } from "../../public-web/acquisitionData";
import { renderPublicWebPage } from "../../public-web/renderPage";
import { PUBLIC_WEB_ROUTES, renderPublicWebSitemap } from "../../public-web/registry";

const route = PUBLIC_WEB_ROUTES[0];
const provenance = {
  venue: "https://example.test/api-bookings/public-venue",
  locationDetails: "https://example.test/api-corporate/public-company",
  courts: "https://example.test/api-bookings/public-courts",
  prices: "https://example.test/api-event-public/public-prices",
};

const openingHours = Array.from({ length: 7 }, (_, day) => ({
  day_of_week: day,
  open_time: day === 1 ? "17:00:00" : "10:00:00",
  close_time: day === 5 ? "23:59:00" : "22:00:00",
  is_closed: false,
}));

const venuePayload = {
  venue: {
    id: "venue-1",
    name: "Pickla Arena Stockholm",
    slug: "pickla-arena-sthlm",
    address: "Svetsarvägen 22",
    city: "Solna",
    status: "active",
  },
  openingHours,
};

const compatibilityPayload = {
  venue: {
    name: "Pickla Arena Stockholm",
    slug: "pickla-arena-sthlm",
    address: "Svetsarvägen 22",
    postal_code: "171 41",
    city: "Solna",
    country: "SE",
  },
};

const courtsPayload = {
  courts: Array.from({ length: 8 }, (_, index) => ({
    id: `court-${index + 1}`,
    sport_type: "pickleball",
    court_type: "indoor",
    is_available: true,
  })),
};

const pricesPayload = {
  court_pricing: [
    { id: "weekday", type: "hourly", price: 321, days_of_week: [1, 2, 3, 4, 5], time_from: "10:00:00", time_to: "16:00:00" },
    { id: "weekend", type: "hourly", price: 499, days_of_week: [0, 6], time_from: "10:00:00", time_to: "18:00:00" },
  ],
  first_visit: { available: true, public_price_sek: 177 },
};

function response(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

describe("Public Web foundation", () => {
  it("loads one canonical acquisition model and uses compatibility location only when required", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("public-venue")) return response(venuePayload);
      if (url.includes("public-courts")) return response(courtsPayload);
      if (url.includes("public-prices")) return response(pricesPayload);
      if (url.includes("public-company")) return response(compatibilityPayload);
      return response({}, 404);
    });

    const facts = await loadAcquisitionData(route, {
      fetchImpl,
      apiOrigin: "https://example.test",
      date: "2026-09-18",
    });

    expect(facts.venue).toMatchObject({ streetAddress: "Svetsarvägen 22", postalCode: "171 41", city: "Solna" });
    expect(facts.indoorPickleballCourtCount).toBe(8);
    expect(facts.startingCourtPriceSek).toBe(321);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual(expect.arrayContaining([
      "https://example.test/api-bookings/public-venue?slug=pickla-arena-sthlm",
      "https://example.test/api-bookings/public-courts?slug=pickla-arena-sthlm&date=2026-09-18&showAll=true",
      "https://example.test/api-event-public/public-prices?venueSlug=pickla-arena-sthlm",
      "https://example.test/api-corporate/public-company?slug=ericsson",
    ]));
  });

  it("renders complete search and conversion content without the Customer app", () => {
    const facts = resolveAcquisitionFacts({
      route,
      venuePayload,
      courtsPayload,
      pricesPayload,
      compatibilityPayload,
      provenance,
    });
    const html = renderPublicWebPage({
      route,
      facts,
      assets: { logo: "/public-web/pickla-logo.svg", venuePhoto: "/public-web/pickla-venue.jpg" },
    });

    expect(html).toContain("<title>Pickleball i Stockholm – 8 inomhusbanor i Solna | Pickla</title>");
    expect(html).toContain("Spela pickleball på 8 inomhusbanor i Solna Business Park");
    expect(html).toContain('<link rel="canonical" href="https://playpickla.com/pickleball-stockholm">');
    expect(html).toContain("<h1>Spela pickleball i Stockholm – 8 inomhusbanor i Solna</h1>");
    expect(html).toContain("Svetsarvägen 22");
    expect(html).toContain("171 41");
    expect(html).toContain("Från 321 kr/timme");
    expect(html).toContain('"SportsActivityLocation"');
    expect(html).toContain('href="/book?v=pickla-arena-sthlm&amp;ref=public-web-pickleball-stockholm"');
    expect(html).toContain('href="/openplay?v=pickla-arena-sthlm&amp;ref=public-web-pickleball-stockholm"');
    expect(html).toContain('href="/courses?v=pickla-arena-sthlm&amp;ref=public-web-pickleball-stockholm"');
    expect(html).not.toContain('id="root"');
    expect(html).not.toContain("AuthProvider");
    expect(html).not.toContain("registerSW");
    expect(html).not.toContain("manifest.webmanifest");
    expect(html).not.toMatch(/<script\s+[^>]*src=/);
  });

  it("fails generation instead of inventing missing critical facts", () => {
    expect(() => resolveAcquisitionFacts({
      route,
      venuePayload,
      courtsPayload,
      pricesPayload,
      provenance,
    })).toThrow("venue postal code is unavailable");

    expect(() => resolveAcquisitionFacts({
      route,
      venuePayload: { ...venuePayload, openingHours: openingHours.slice(0, 6) },
      courtsPayload,
      pricesPayload,
      compatibilityPayload,
      provenance,
    })).toThrow("complete weekly opening hours are required");

    expect(() => resolveAcquisitionFacts({
      route,
      venuePayload,
      courtsPayload: { courts: [] },
      pricesPayload,
      compatibilityPayload,
      provenance,
    })).toThrow("no active indoor pickleball courts");

    expect(() => resolveAcquisitionFacts({
      route,
      venuePayload,
      courtsPayload,
      pricesPayload: { court_pricing: [] },
      compatibilityPayload,
      provenance,
    })).toThrow("canonical public court pricing is required");
  });

  it("generates a non-www, public-only sitemap from the route registry", () => {
    const sitemap = renderPublicWebSitemap();
    expect(sitemap).toContain("<loc>https://playpickla.com/pickleball-stockholm</loc>");
    expect(sitemap).not.toContain("www.playpickla.com");
    expect(sitemap).not.toMatch(/\/(?:my|desk|hub\/admin|ops|checkout|receipt)/);
    expect(sitemap).not.toContain("lastmod");
  });

  it("keeps the Public Web artifact outside the SPA and preserves PWA startup contracts", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const pwaSurface = readFileSync("src/lib/pwaSurface.ts", "utf8");
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
    const robots = readFileSync("public/robots.txt", "utf8");
    const bookings = readFileSync("supabase/functions/api-bookings/index.ts", "utf8");

    expect(app).not.toContain('path="/pickleball-stockholm"');
    expect(pwaSurface).toContain('startUrl: "/"');
    expect(pwaSurface).toContain('startUrl: "/desk"');
    expect(pwaSurface).toContain('startUrl: "/hub/admin"');
    expect(vercel.rewrites[1]).toEqual({ source: "/pickleball-stockholm", destination: "/pickleball-stockholm/index.html" });
    expect(vercel.rewrites[vercel.rewrites.length - 1]).toEqual({ source: "/(.*)", destination: "/index.html" });
    expect(vercel.headers).toContainEqual(expect.objectContaining({
      source: "/((?!pickleball-stockholm$|.*\\.[^/]+$).*)",
    }));
    expect(robots.match(/^User-agent:/gm)).toHaveLength(1);
    expect(robots).not.toContain("User-agent: Googlebot");
    expect(bookings).toContain("postal_code, country, latitude, longitude");
  });
});
