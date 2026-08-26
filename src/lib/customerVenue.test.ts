import { describe, expect, it, vi } from "vitest";

import {
  CANONICAL_CUSTOMER_VENUE,
  rememberValidCustomerVenue,
  resolveCustomerVenueContext,
} from "@/lib/customerVenue";

function storage(initial?: string) {
  const values = new Map<string, string>();
  if (initial) values.set("pickla_customer_venue_slug", initial);
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  };
}

describe("customer venue fast path", () => {
  it("lets a valid explicit venue win over locally remembered context", () => {
    const result = resolveCustomerVenueContext("future-pickla-venue", storage("locally-known-venue"));
    expect(result).toEqual({
      slug: "future-pickla-venue",
      source: "explicit",
      canUseBeforeRemoteValidation: false,
    });
  });

  it("uses a previously validated local venue without blocking discovery", () => {
    expect(resolveCustomerVenueContext(null, storage("locally-known-venue"))).toEqual({
      slug: "locally-known-venue",
      source: "local",
      canUseBeforeRemoteValidation: true,
    });
  });

  it("uses the canonical one-venue deployment primitive immediately", () => {
    expect(resolveCustomerVenueContext(null, storage())).toEqual({
      slug: CANONICAL_CUSTOMER_VENUE.slug,
      source: "canonical",
      canUseBeforeRemoteValidation: true,
    });
  });

  it("fails a malformed explicit venue closed instead of falling back", () => {
    expect(resolveCustomerVenueContext("not a valid slug", storage("locally-known-venue"))).toEqual({
      slug: "invalid-venue-context",
      source: "explicit",
      canUseBeforeRemoteValidation: false,
    });
  });

  it("only remembers remotely validated slug-shaped venues", () => {
    const target = storage();
    rememberValidCustomerVenue("future-pickla-venue", target);
    rememberValidCustomerVenue("bad venue", target);
    expect(target.setItem).toHaveBeenCalledTimes(1);
    expect(resolveCustomerVenueContext(null, target)).toMatchObject({ slug: "future-pickla-venue", source: "local" });
  });
});
