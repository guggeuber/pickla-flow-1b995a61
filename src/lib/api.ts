import { getSessionSingleFlight } from "@/lib/authSessionSingleFlight";
import { reportApiFailure } from "@/lib/clientObservability";

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const BASE_URL = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL || `https://${PROJECT_ID}.supabase.co/functions/v1`;
const SLOW_API_MS = 700;

export class ApiRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

export type ApiRequestOptions = {
  auth?: "session" | "omit";
  expectedStatuses?: number[];
};

function shouldReportApiFailure(status: number, options: ApiRequestOptions) {
  return !options.expectedStatuses?.includes(status);
}

async function getAuthHeaders(
  includeJsonContentType = true,
  authMode: ApiRequestOptions["auth"] = "session",
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  if (includeJsonContentType) {
    headers["Content-Type"] = "application/json";
  }
  if (authMode === "session") {
    const { data: { session } } = await getSessionSingleFlight();
    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }
  }
  return headers;
}

function logApiTiming(method: string, url: string, startedAt: number, status?: number, error?: unknown, expected = false) {
  if (expected) return;
  const duration = Math.round(performance.now() - startedAt);
  if (!import.meta.env.DEV && duration < SLOW_API_MS && !error) return;

  const label = `[api] ${method} ${new URL(url).pathname} ${status ?? "ERR"} ${duration}ms`;
  if (error || status && status >= 400) {
    console.warn(label, error || "");
  } else if (duration >= SLOW_API_MS) {
    console.info(label);
  } else {
    console.debug(label);
  }
}

async function readErrorBody(res: Response) {
  const data = await res.json().catch(() => ({}));
  return data.error || `API error ${res.status}`;
}

export async function apiGet<T = unknown>(
  fn: string,
  endpoint: string,
  params?: Record<string, string>,
  options: ApiRequestOptions = {},
): Promise<T> {
  const headers = await getAuthHeaders(false, options.auth);
  const url = new URL(`${BASE_URL}/${fn}/${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const startedAt = performance.now();
  const requestUrl = url.toString();
  const res = await fetch(requestUrl, { headers });
  logApiTiming("GET", requestUrl, startedAt, res.status, undefined, !shouldReportApiFailure(res.status, options));
  if (!res.ok) {
    const message = await readErrorBody(res);
    if (shouldReportApiFailure(res.status, options)) {
      reportApiFailure({
        method: "GET",
        fn,
        endpoint,
        status: res.status,
        message,
        duration_ms: Math.round(performance.now() - startedAt),
      });
    }
    throw new ApiRequestError(message, res.status);
  }
  return res.json();
}

export async function apiPost<T = unknown>(
  fn: string,
  endpoint: string,
  body: Record<string, unknown>,
  options: ApiRequestOptions = {},
): Promise<T> {
  const headers = await getAuthHeaders(true, options.auth);
  const requestUrl = `${BASE_URL}/${fn}/${endpoint}`;
  const startedAt = performance.now();
  const res = await fetch(requestUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  logApiTiming("POST", requestUrl, startedAt, res.status, undefined, !shouldReportApiFailure(res.status, options));
  if (!res.ok) {
    const message = await readErrorBody(res);
    if (shouldReportApiFailure(res.status, options)) {
      reportApiFailure({
        method: "POST",
        fn,
        endpoint,
        status: res.status,
        message,
        duration_ms: Math.round(performance.now() - startedAt),
      });
    }
    throw new ApiRequestError(message, res.status);
  }
  return res.json();
}

export async function apiPut<T = unknown>(
  fn: string,
  endpoint: string,
  body: Record<string, unknown>,
  options: ApiRequestOptions = {},
): Promise<T> {
  const headers = await getAuthHeaders(true, options.auth);
  const requestUrl = `${BASE_URL}/${fn}/${endpoint}`;
  const startedAt = performance.now();
  const res = await fetch(requestUrl, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
  logApiTiming("PUT", requestUrl, startedAt, res.status);
  if (!res.ok) {
    const message = await readErrorBody(res);
    reportApiFailure({
      method: "PUT",
      fn,
      endpoint,
      status: res.status,
      message,
      duration_ms: Math.round(performance.now() - startedAt),
    });
    throw new ApiRequestError(message, res.status);
  }
  return res.json();
}

export async function apiPatch<T = unknown>(
  fn: string,
  endpoint: string,
  body: Record<string, unknown>
): Promise<T> {
  const headers = await getAuthHeaders();
  const requestUrl = `${BASE_URL}/${fn}/${endpoint}`;
  const startedAt = performance.now();
  const res = await fetch(requestUrl, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  logApiTiming("PATCH", requestUrl, startedAt, res.status);
  if (!res.ok) {
    const message = await readErrorBody(res);
    reportApiFailure({
      method: "PATCH",
      fn,
      endpoint,
      status: res.status,
      message,
      duration_ms: Math.round(performance.now() - startedAt),
    });
    throw new Error(message);
  }
  return res.json();
}

export async function apiDelete<T = unknown>(
  fn: string,
  endpoint: string,
  params?: Record<string, string>
): Promise<T> {
  const headers = await getAuthHeaders();
  const url = new URL(`${BASE_URL}/${fn}/${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const startedAt = performance.now();
  const requestUrl = url.toString();
  const res = await fetch(requestUrl, { method: "DELETE", headers });
  logApiTiming("DELETE", requestUrl, startedAt, res.status);
  if (!res.ok) {
    const message = await readErrorBody(res);
    reportApiFailure({
      method: "DELETE",
      fn,
      endpoint,
      status: res.status,
      message,
      duration_ms: Math.round(performance.now() - startedAt),
    });
    throw new Error(message);
  }
  return res.json();
}
