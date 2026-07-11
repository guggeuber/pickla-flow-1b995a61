export const CANONICAL_PUBLIC_ORIGIN = 'https://playpickla.com';

function normalizeOrigin(value: string | null | undefined) {
  if (!value) return '';
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function isLocalOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function isPicklaProductionOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && (url.hostname === 'playpickla.com' || url.hostname === 'www.playpickla.com');
  } catch {
    return false;
  }
}

function isLocalRequest(req?: Request) {
  if (!req) return false;
  try {
    const url = new URL(req.url);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export function canonicalPublicOrigin(req?: Request, fallbackLocalOrigin = 'http://localhost:8080') {
  const requestOrigin = normalizeOrigin(req?.headers.get('origin'));
  if (requestOrigin && isLocalOrigin(requestOrigin)) return requestOrigin;
  if (requestOrigin && isPicklaProductionOrigin(requestOrigin)) return CANONICAL_PUBLIC_ORIGIN;

  const configured = normalizeOrigin(Deno.env.get('PUBLIC_SITE_URL') || Deno.env.get('SITE_URL'));
  if (configured && isLocalOrigin(configured)) return configured;
  if (configured && isPicklaProductionOrigin(configured)) return CANONICAL_PUBLIC_ORIGIN;

  if (configured) return configured;
  if (isLocalRequest(req)) return fallbackLocalOrigin;
  return CANONICAL_PUBLIC_ORIGIN;
}

export function canonicalPublicUrl(path: string, req?: Request, fallbackLocalOrigin = 'http://localhost:8080') {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${canonicalPublicOrigin(req, fallbackLocalOrigin)}${normalizedPath}`;
}
