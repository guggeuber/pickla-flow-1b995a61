export const CANONICAL_PRODUCTION_ORIGIN = "https://playpickla.com";
export const CANONICAL_PRODUCTION_HOST = "playpickla.com";
export const LEGACY_WWW_PRODUCTION_HOST = "www.playpickla.com";

type LocationLike = Pick<Location, "origin" | "hostname" | "pathname" | "search" | "hash">;

export function isProductionPicklaHost(hostname: string) {
  return hostname === CANONICAL_PRODUCTION_HOST || hostname === LEGACY_WWW_PRODUCTION_HOST;
}

export function canonicalAppOrigin(locationLike: LocationLike = window.location) {
  return isProductionPicklaHost(locationLike.hostname)
    ? CANONICAL_PRODUCTION_ORIGIN
    : locationLike.origin;
}

export function canonicalAppUrl(path = "/", locationLike: LocationLike = window.location) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${canonicalAppOrigin(locationLike)}${normalizedPath}`;
}

export function canonicalRedirectUrl(locationLike: LocationLike = window.location) {
  if (locationLike.hostname !== LEGACY_WWW_PRODUCTION_HOST) return "";
  return `${CANONICAL_PRODUCTION_ORIGIN}${locationLike.pathname}${locationLike.search}${locationLike.hash}`;
}

export function enforceCanonicalHost(locationLike: LocationLike = window.location) {
  const nextUrl = canonicalRedirectUrl(locationLike);
  if (!nextUrl) return false;
  window.location.replace(nextUrl);
  return true;
}
