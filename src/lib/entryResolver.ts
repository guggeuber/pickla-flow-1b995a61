export const ENTRY_REDIRECT_KEY = "pickla_auth_redirect";
export const FIRST_RUN_WELCOME_KEY = "pickla_first_run_welcome";

const DEFAULT_ENTRY_ROUTE = "/today";

export function safeLocalPath(path: string | null | undefined) {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return "";
  return path;
}

function isMyPageRoute(path: string) {
  return path === "/my" || path.startsWith("/my?") || path.startsWith("/my/");
}

function defaultEntryRoute(venueSlug?: string | null) {
  return venueSlug ? `${DEFAULT_ENTRY_ROUTE}?v=${encodeURIComponent(venueSlug)}` : DEFAULT_ENTRY_ROUTE;
}

export function preserveIntendedRoute(path: string | null | undefined) {
  const safe = safeLocalPath(path);
  if (!safe) return;
  sessionStorage.setItem(ENTRY_REDIRECT_KEY, safe);
}

export function consumePreservedIntendedRoute() {
  const intended = safeLocalPath(sessionStorage.getItem(ENTRY_REDIRECT_KEY));
  if (intended) sessionStorage.removeItem(ENTRY_REDIRECT_KEY);
  return intended || "";
}

export function getPreservedIntendedRoute() {
  return safeLocalPath(sessionStorage.getItem(ENTRY_REDIRECT_KEY)) || "";
}

export function markFirstRunWelcome() {
  localStorage.setItem(FIRST_RUN_WELCOME_KEY, "1");
}

export function consumeFirstRunWelcome() {
  const shouldShow = localStorage.getItem(FIRST_RUN_WELCOME_KEY) === "1";
  if (shouldShow) localStorage.removeItem(FIRST_RUN_WELCOME_KEY);
  return shouldShow;
}

export function resolveEntryDestination({
  imminentSessionRoute,
  intendedRoute,
  venueSlug,
}: {
  imminentSessionRoute?: string | null;
  intendedRoute?: string | null;
  venueSlug?: string | null;
} = {}) {
  // P1 is intentionally input-only for now: no extra boot-time query is made here.
  const p1 = safeLocalPath(imminentSessionRoute);
  if (p1 && !isMyPageRoute(p1)) return p1;

  const p2 = safeLocalPath(intendedRoute);
  if (p2 && !isMyPageRoute(p2)) return p2;

  return defaultEntryRoute(venueSlug);
}
