type StatusError = {
  status?: unknown;
  name?: unknown;
};

export function errorStatus(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const status = (error as StatusError).status;
  return typeof status === "number" ? status : null;
}

/**
 * Auth recovery belongs to the request layer. React Query may retry transient
 * network/5xx failures, but must never multiply authorization failures.
 */
export function shouldRetryQuery(failureCount: number, error: unknown) {
  const status = errorStatus(error);
  if (status === 401 || status === 403) return false;
  if ((error as StatusError | null)?.name === "AbortError") return false;
  if (status !== null && (status < 500 || status >= 600)) return false;
  return failureCount < 3;
}
