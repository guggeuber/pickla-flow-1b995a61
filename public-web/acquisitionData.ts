import {
  PUBLIC_WEB_API_ORIGIN,
  type PublicWebRoute,
} from "./registry";

export type OpeningHour = {
  dayOfWeek: number;
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
};

export type PublicCourtPrice = {
  id: string;
  priceSek: number;
  daysOfWeek: number[];
  timeFrom: string | null;
  timeTo: string | null;
};

export type AcquisitionFacts = {
  venue: {
    name: string;
    slug: string;
    streetAddress: string;
    postalCode: string;
    city: string;
    country: string;
  };
  openingHours: OpeningHour[];
  indoorPickleballCourtCount: number;
  courtPrices: PublicCourtPrice[];
  startingCourtPriceSek: number;
  firstVisit: {
    available: boolean;
    priceSek: number | null;
  };
  provenance: {
    venue: string;
    locationDetails: string;
    courts: string;
    prices: string;
  };
};

type JsonRecord = Record<string, unknown>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const REQUEST_TIMEOUT_MS = 10_000;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function records(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return [];
  return value.map(record).filter((row): row is JsonRecord => row !== null);
}

function requiredText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Public Web generation failed: missing ${label}`);
  }
  return value.trim();
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function publicWebDate() {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function normalizePostalCode(value: unknown) {
  const raw = requiredText(value, "venue postal code").replace(/\s/g, "");
  if (!/^\d{5}$/.test(raw)) {
    throw new Error("Public Web generation failed: invalid venue postal code");
  }
  return `${raw.slice(0, 3)} ${raw.slice(3)}`;
}

function normalizeTime(value: unknown, label: string) {
  const time = requiredText(value, label).slice(0, 5);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error(`Public Web generation failed: invalid ${label}`);
  }
  return time;
}

function normalizeOpeningHours(value: unknown) {
  const hours = records(value).map((row) => {
    const dayOfWeek = Number(row.day_of_week);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      throw new Error("Public Web generation failed: invalid opening-hours day");
    }
    const isClosed = row.is_closed === true;
    return {
      dayOfWeek,
      openTime: isClosed ? null : normalizeTime(row.open_time, "opening time"),
      closeTime: isClosed ? null : normalizeTime(row.close_time, "closing time"),
      isClosed,
    } satisfies OpeningHour;
  });
  const uniqueDays = new Set(hours.map((row) => row.dayOfWeek));
  if (hours.length !== 7 || uniqueDays.size !== 7) {
    throw new Error("Public Web generation failed: complete weekly opening hours are required");
  }
  return hours.sort((a, b) => a.dayOfWeek - b.dayOfWeek);
}

function normalizeCourtPrices(value: unknown) {
  const prices = records(value).map((row) => {
    if (row.type !== "hourly") {
      throw new Error("Public Web generation failed: unsupported court pricing unit");
    }
    const priceSek = Number(row.price);
    const daysOfWeek = Array.isArray(row.days_of_week)
      ? row.days_of_week.map(Number)
      : [];
    if (!Number.isFinite(priceSek) || priceSek <= 0) {
      throw new Error("Public Web generation failed: invalid public court price");
    }
    if (!daysOfWeek.length || daysOfWeek.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      throw new Error("Public Web generation failed: invalid court pricing days");
    }
    return {
      id: requiredText(row.id, "court pricing id"),
      priceSek,
      daysOfWeek,
      timeFrom: optionalText(row.time_from) ? normalizeTime(row.time_from, "court pricing start time") : null,
      timeTo: optionalText(row.time_to) ? normalizeTime(row.time_to, "court pricing end time") : null,
    } satisfies PublicCourtPrice;
  });
  if (!prices.length) {
    throw new Error("Public Web generation failed: canonical public court pricing is required");
  }
  return prices.sort((a, b) => {
    const firstDisplayDayA = Math.min(...a.daysOfWeek.map((day) => (day + 6) % 7));
    const firstDisplayDayB = Math.min(...b.daysOfWeek.map((day) => (day + 6) % 7));
    return firstDisplayDayA - firstDisplayDayB
      || String(a.timeFrom).localeCompare(String(b.timeFrom))
      || a.priceSek - b.priceSek;
  });
}

function assertMatchingCompatibilityVenue(primary: JsonRecord, compatibility: JsonRecord, expectedSlug: string) {
  const primarySlug = requiredText(primary.slug, "venue slug");
  const compatibilitySlug = requiredText(compatibility.slug, "compatibility venue slug");
  const primaryAddress = requiredText(primary.address, "venue street address");
  const compatibilityAddress = requiredText(compatibility.address, "compatibility venue street address");
  const primaryCity = requiredText(primary.city, "venue city");
  const compatibilityCity = requiredText(compatibility.city, "compatibility venue city");
  if (
    primarySlug !== expectedSlug
    || compatibilitySlug !== expectedSlug
    || primaryAddress !== compatibilityAddress
    || primaryCity !== compatibilityCity
  ) {
    throw new Error("Public Web generation failed: compatibility venue does not match canonical venue");
  }
}

export function resolveAcquisitionFacts({
  route,
  venuePayload,
  courtsPayload,
  pricesPayload,
  compatibilityPayload,
  provenance,
}: {
  route: PublicWebRoute;
  venuePayload: unknown;
  courtsPayload: unknown;
  pricesPayload: unknown;
  compatibilityPayload?: unknown;
  provenance: AcquisitionFacts["provenance"];
}): AcquisitionFacts {
  const venueRoot = record(venuePayload);
  const venue = record(venueRoot?.venue);
  if (!venue) throw new Error("Public Web generation failed: canonical venue projection is unavailable");

  const compatibilityRoot = record(compatibilityPayload);
  const compatibilityVenue = record(compatibilityRoot?.venue);
  const postalSource = optionalText(venue.postal_code) && optionalText(venue.country)
    ? venue
    : compatibilityVenue;
  if (postalSource !== venue) {
    if (!compatibilityVenue) {
      throw new Error("Public Web generation failed: venue postal code is unavailable");
    }
    assertMatchingCompatibilityVenue(venue, compatibilityVenue, route.venueSlug);
  }

  const slug = requiredText(venue.slug, "venue slug");
  if (slug !== route.venueSlug) {
    throw new Error("Public Web generation failed: venue slug mismatch");
  }
  const city = requiredText(venue.city, "venue city");
  if (city !== route.expectedCity) {
    throw new Error("Public Web generation failed: venue city does not match route metadata");
  }
  if (venue.status !== "active") {
    throw new Error("Public Web generation failed: venue is not active");
  }

  const courtsRoot = record(courtsPayload);
  const indoorPickleballCourts = records(courtsRoot?.courts).filter((court) =>
    court.sport_type === "pickleball"
    && court.court_type === "indoor"
    && court.is_available === true
  );
  if (!indoorPickleballCourts.length) {
    throw new Error("Public Web generation failed: no active indoor pickleball courts");
  }

  const pricesRoot = record(pricesPayload);
  if (!pricesRoot) throw new Error("Public Web generation failed: canonical public prices are unavailable");
  const courtPrices = normalizeCourtPrices(pricesRoot.court_pricing);
  const firstVisit = record(pricesRoot.first_visit);
  const firstVisitPrice = Number(firstVisit?.public_price_sek);

  return {
    venue: {
      name: requiredText(venue.name, "venue name"),
      slug,
      streetAddress: requiredText(venue.address, "venue street address"),
      postalCode: normalizePostalCode(postalSource?.postal_code),
      city,
      country: requiredText(postalSource?.country, "venue country"),
    },
    openingHours: normalizeOpeningHours(venueRoot?.openingHours),
    indoorPickleballCourtCount: indoorPickleballCourts.length,
    courtPrices,
    startingCourtPriceSek: Math.min(...courtPrices.map((price) => price.priceSek)),
    firstVisit: {
      available: firstVisit?.available === true,
      priceSek: Number.isFinite(firstVisitPrice) && firstVisitPrice > 0 ? firstVisitPrice : null,
    },
    provenance,
  };
}

async function fetchJson(fetchImpl: FetchLike, url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Public Web generation failed: ${url} (${message})`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadAcquisitionData(
  route: PublicWebRoute,
  options: {
    fetchImpl?: FetchLike;
    apiOrigin?: string;
    date?: string;
  } = {},
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiOrigin = (options.apiOrigin ?? process.env.PUBLIC_WEB_API_ORIGIN ?? PUBLIC_WEB_API_ORIGIN).replace(/\/$/, "");
  const date = options.date ?? publicWebDate();
  const venueUrl = `${apiOrigin}/api-bookings/public-venue?slug=${encodeURIComponent(route.venueSlug)}`;
  const courtsUrl = `${apiOrigin}/api-bookings/public-courts?slug=${encodeURIComponent(route.venueSlug)}&date=${encodeURIComponent(date)}&showAll=true`;
  const pricesUrl = `${apiOrigin}/api-event-public/public-prices?venueSlug=${encodeURIComponent(route.venueSlug)}`;
  const [venuePayload, courtsPayload, pricesPayload] = await Promise.all([
    fetchJson(fetchImpl, venueUrl),
    fetchJson(fetchImpl, courtsUrl),
    fetchJson(fetchImpl, pricesUrl),
  ]);

  const venue = record(record(venuePayload)?.venue);
  const needsCompatibilityLocation = !optionalText(venue?.postal_code) || !optionalText(venue?.country);
  const compatibilityUrl = `${apiOrigin}/api-corporate/public-company?slug=${encodeURIComponent(route.compatibility.corporateVenueSlug)}`;
  const compatibilityPayload = needsCompatibilityLocation
    ? await fetchJson(fetchImpl, compatibilityUrl)
    : undefined;

  return resolveAcquisitionFacts({
    route,
    venuePayload,
    courtsPayload,
    pricesPayload,
    compatibilityPayload,
    provenance: {
      venue: venueUrl,
      locationDetails: needsCompatibilityLocation ? compatibilityUrl : venueUrl,
      courts: courtsUrl,
      prices: pricesUrl,
    },
  });
}
