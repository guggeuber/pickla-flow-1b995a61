export const CANONICAL_CUSTOMER_VENUE = {
  slug: "pickla-arena-sthlm",
  name: "Pickla Arena Stockholm",
  timezone: "Europe/Stockholm",
} as const;

const CUSTOMER_VENUE_STORAGE_KEY = "pickla_customer_venue_slug";
const VALID_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type VenueStorage = Pick<Storage, "getItem" | "setItem">;

function normalizedVenueSlug(value: string | null | undefined) {
  const slug = String(value || "").trim().toLowerCase();
  return VALID_SLUG.test(slug) ? slug : null;
}

function browserStorage(): VenueStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export type CustomerVenueContext = {
  slug: string;
  source: "explicit" | "local" | "canonical";
  canUseBeforeRemoteValidation: boolean;
};

/**
 * Resolves the customer venue without a network dependency. Explicit context
 * always wins. A non-canonical explicit slug is validated remotely before it
 * can drive customer data; canonical and previously validated local slugs can
 * start public reads immediately.
 */
export function resolveCustomerVenueContext(
  explicitSlug?: string | null,
  storage: VenueStorage | null = browserStorage(),
): CustomerVenueContext {
  const explicit = normalizedVenueSlug(explicitSlug);
  if (explicit) {
    return {
      slug: explicit,
      source: "explicit",
      canUseBeforeRemoteValidation: explicit === CANONICAL_CUSTOMER_VENUE.slug,
    };
  }
  if (String(explicitSlug || "").trim()) {
    return {
      slug: "invalid-venue-context",
      source: "explicit",
      canUseBeforeRemoteValidation: false,
    };
  }

  const local = normalizedVenueSlug(storage?.getItem(CUSTOMER_VENUE_STORAGE_KEY));
  if (local) return { slug: local, source: "local", canUseBeforeRemoteValidation: true };

  return {
    slug: CANONICAL_CUSTOMER_VENUE.slug,
    source: "canonical",
    canUseBeforeRemoteValidation: true,
  };
}

export function rememberValidCustomerVenue(slug: string, storage: VenueStorage | null = browserStorage()) {
  const normalized = normalizedVenueSlug(slug);
  if (!normalized || !storage) return;
  try {
    storage.setItem(CUSTOMER_VENUE_STORAGE_KEY, normalized);
  } catch {
    // Local venue memory is an optimization only.
  }
}
