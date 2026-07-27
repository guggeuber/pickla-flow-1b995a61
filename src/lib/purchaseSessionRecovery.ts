import { refreshSessionSingleFlight } from "@/lib/authSessionSingleFlight";

export const PURCHASE_SESSION_ERROR_MESSAGE = "Vi kunde inte ladda köpet. Ladda om sidan och försök igen.";
export const CHECKOUT_EMAIL_REQUIRED_MESSAGE = "E-post krävs för kvitto och uthämtning.";

const AUTH_SESSION_MESSAGE = /(jwt|token expired|invalid token|refresh token|authorization header|unauthorized|auth session|session expired|lock.*stol|navigator lock)/i;
const UNVERIFIABLE_JWT_MESSAGE = /(invalid jwt|unable to parse or verify signature|token is unverifiable|unrecognized jwt kid|error while executing keyfunc)/i;

type RefreshResult = {
  data: { session: { access_token?: string } | null };
  error: unknown | null;
};

type RefreshSession = () => Promise<RefreshResult>;

export class PurchaseSessionError extends Error {
  constructor() {
    super(PURCHASE_SESSION_ERROR_MESSAGE);
    this.name = "PurchaseSessionError";
  }
}

export function isAuthSessionFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { message?: unknown; name?: unknown; status?: unknown };
  const message = typeof candidate.message === "string" ? candidate.message : "";
  const name = typeof candidate.name === "string" ? candidate.name : "";
  const status = Number(candidate.status || 0);

  if (status === 400) return UNVERIFIABLE_JWT_MESSAGE.test(message);
  if (status && status !== 401) return false;
  return AUTH_SESSION_MESSAGE.test(`${name} ${message}`);
}

export async function withPurchaseSessionRecovery<T>(
  request: () => Promise<T>,
  refreshSession: RefreshSession = () => refreshSessionSingleFlight(),
  guestFallback?: () => Promise<T>,
): Promise<T> {
  try {
    return await request();
  } catch (firstError) {
    if (!isAuthSessionFailure(firstError)) throw firstError;
  }

  let refreshed: RefreshResult;
  try {
    refreshed = await refreshSession();
  } catch {
    if (guestFallback) return guestFallback();
    throw new PurchaseSessionError();
  }
  if (refreshed.error || !refreshed.data.session?.access_token) {
    if (guestFallback) return guestFallback();
    throw new PurchaseSessionError();
  }

  try {
    return await request();
  } catch (retryError) {
    if (isAuthSessionFailure(retryError)) throw new PurchaseSessionError();
    throw retryError;
  }
}

export function purchaseErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof PurchaseSessionError || isAuthSessionFailure(error)) {
    return PURCHASE_SESSION_ERROR_MESSAGE;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

export function isCartVersionConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { message?: unknown; status?: unknown };
  return Number(candidate.status || 0) === 409
    && /cart changed|stale_cart_version/i.test(String(candidate.message || ""));
}

export function isCheckoutEmailRequired(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { message?: unknown; status?: unknown };
  const status = Number(candidate.status || 0);
  return (!status || status === 400)
    && String(candidate.message || "").includes(CHECKOUT_EMAIL_REQUIRED_MESSAGE);
}
