import {
  getSessionSingleFlight,
  isTerminalAuthFailureInProgress,
  rememberTerminallyRejectedAccessToken,
  recoverSessionAfterUnauthorized,
  terminateInvalidSessionSingleFlight,
} from "@/lib/authSessionSingleFlight";
import { reportApiFailure } from "@/lib/clientObservability";

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const BASE_URL = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL || `https://${PROJECT_ID}.supabase.co/functions/v1`;
const SLOW_API_MS = 700;

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly data?: Record<string, unknown>;

  constructor(message: string, status: number, data?: Record<string, unknown>) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = typeof data?.code === "string" ? data.code : undefined;
    this.data = data;
  }
}

export type ApiRequestOptions = {
  auth?: "session" | "omit";
  expectedStatuses?: number[];
  signal?: AbortSignal;
  publicRead?: {
    maxRetries?: 0 | 1;
    retryDelayMs?: number;
    staleRetained?: boolean;
  };
};

type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type ApiRequestInput = {
  method: ApiMethod;
  fn: string;
  endpoint: string;
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  options: ApiRequestOptions;
};

function shouldReportApiFailure(status: number, options: ApiRequestOptions) {
  return !options.expectedStatuses?.includes(status);
}

function buildHeaders(includeJsonContentType: boolean, accessToken: string | null) {
  const headers: Record<string, string> = {};
  if (includeJsonContentType) headers["Content-Type"] = "application/json";
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

async function getRequestAccessToken(authMode: ApiRequestOptions["auth"] = "session") {
  if (authMode === "omit") return null;
  if (isTerminalAuthFailureInProgress()) {
    throw new ApiRequestError("Authentication session is being cleared", 401);
  }

  const { data: { session } } = await getSessionSingleFlight();
  if (isTerminalAuthFailureInProgress()) {
    throw new ApiRequestError("Authentication session is being cleared", 401);
  }
  return session?.access_token ?? null;
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
  return {
    message: typeof data?.error === "string" ? data.error : `API error ${res.status}`,
    data: data && typeof data === "object" && Object.keys(data).some((key) => key !== "error")
      ? data as Record<string, unknown>
      : undefined,
  };
}

type PublicReadFailure = {
  status?: number;
  message: string;
  data?: Record<string, unknown>;
  requestId?: string;
};

function responseRequestId(response: Response, data?: Record<string, unknown>) {
  const header = response.headers.get("x-pickla-request-id");
  if (header) return header;
  return typeof data?.request_id === "string" ? data.request_id : undefined;
}

export function isTransientPublicReadFailure(failure: PublicReadFailure | unknown) {
  if (failure instanceof Error && !("status" in failure)) return failure.name !== "AbortError";
  const shaped = failure as PublicReadFailure;
  if (shaped.status === 502 || shaped.status === 503 || shaped.status === 504) return true;
  if (shaped.status !== 500) return false;
  const errorClass = typeof shaped.data?.error_class === "string" ? shaped.data.error_class : "";
  if (["auth_jwt_validation", "transport", "upstream_postgrest", "timeout"].includes(errorClass)) return true;
  return /jwt issued at future|failed to fetch|network|connection|timeout|timed out/i.test(shaped.message || "");
}

function publicReadDelay(delayMs: number, signal?: AbortSignal) {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timeout = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function requestUrl(fn: string, endpoint: string, params?: Record<string, string>) {
  const url = new URL(`${BASE_URL}/${fn}/${endpoint}`);
  if (params) Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

async function publicReadRequest<T>({ method, fn, endpoint, params, body, options }: ApiRequestInput): Promise<T> {
  const startedAt = performance.now();
  const url = requestUrl(fn, endpoint, params);
  const includeJsonContentType = body !== undefined;
  const accessToken = await getRequestAccessToken(options.auth);
  const maxRetries = options.publicRead?.maxRetries ?? 1;
  const retryDelayMs = Math.max(0, options.publicRead?.retryDelayMs ?? 250);
  let firstFailure: PublicReadFailure | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: buildHeaders(includeJsonContentType, accessToken),
        signal: options.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      if ((error as Error | null)?.name === "AbortError") throw error;
      const failure: PublicReadFailure = {
        status: 503,
        message: error instanceof Error ? error.message : "Public read network failure",
        data: { code: "public_read_network_error", error_class: "transport" },
      };
      firstFailure ||= failure;
      if (attempt < maxRetries && isTransientPublicReadFailure(error)) {
        await publicReadDelay(retryDelayMs, options.signal);
        continue;
      }
      reportApiFailure({
        method,
        fn,
        endpoint,
        status: failure.status,
        message: failure.message,
        duration_ms: Math.round(performance.now() - startedAt),
        request_id: failure.requestId,
        initial_request_id: firstFailure.requestId,
        error_class: "transport",
        retry_count: attempt,
        retry_outcome: "failed",
        stale_retained: Boolean(options.publicRead?.staleRetained),
      });
      throw new ApiRequestError("Kunde inte hämta data just nu", 503, failure.data);
    }

    const requestId = response.headers.get("x-pickla-request-id") || undefined;
    if (response.ok) {
      logApiTiming(method, url, startedAt, response.status);
      if (firstFailure) {
        reportApiFailure({
          method,
          fn,
          endpoint,
          status: firstFailure.status,
          message: firstFailure.message,
          duration_ms: Math.round(performance.now() - startedAt),
          request_id: firstFailure.requestId,
          final_request_id: requestId,
          error_class: typeof firstFailure.data?.error_class === "string" ? firstFailure.data.error_class : undefined,
          retry_count: attempt,
          retry_outcome: "recovered",
          stale_retained: Boolean(options.publicRead?.staleRetained),
        });
      }
      return response.json();
    }

    const errorBody = await readErrorBody(response);
    const failure: PublicReadFailure = {
      status: response.status,
      message: errorBody.message,
      data: errorBody.data,
      requestId: responseRequestId(response, errorBody.data),
    };
    firstFailure ||= failure;
    if (attempt < maxRetries && isTransientPublicReadFailure(failure)) {
      await publicReadDelay(retryDelayMs, options.signal);
      continue;
    }

    const expected = !shouldReportApiFailure(response.status, options);
    logApiTiming(method, url, startedAt, response.status, undefined, expected);
    if (!expected) {
      reportApiFailure({
        method,
        fn,
        endpoint,
        status: response.status,
        message: errorBody.message,
        duration_ms: Math.round(performance.now() - startedAt),
        request_id: failure.requestId,
        initial_request_id: firstFailure.requestId,
        error_class: typeof errorBody.data?.error_class === "string" ? errorBody.data.error_class : undefined,
        retry_count: attempt,
        retry_outcome: "failed",
        stale_retained: Boolean(options.publicRead?.staleRetained),
      });
    }
    throw new ApiRequestError(errorBody.message, response.status, errorBody.data);
  }

  throw new ApiRequestError("Kunde inte hämta data just nu", 503);
}

async function apiRequest<T>({ method, fn, endpoint, params, body, options }: ApiRequestInput): Promise<T> {
  if (options.publicRead) return publicReadRequest<T>({ method, fn, endpoint, params, body, options });
  const startedAt = performance.now();
  const url = requestUrl(fn, endpoint, params);
  const includeJsonContentType = body !== undefined;
  const originalAccessToken = await getRequestAccessToken(options.auth);

  const send = (accessToken: string | null) => fetch(url, {
    method,
    headers: buildHeaders(includeJsonContentType, accessToken),
    signal: options.signal,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  let response = await send(originalAccessToken);
  const shouldRecover = response.status === 401
    && options.auth !== "omit"
    && Boolean(originalAccessToken)
    && !options.expectedStatuses?.includes(401);

  if (shouldRecover) {
    const recovery = await recoverSessionAfterUnauthorized(originalAccessToken!);
    if (recovery.accessToken) {
      response = await send(recovery.accessToken);
      if (response.status === 401) {
        rememberTerminallyRejectedAccessToken(originalAccessToken!);
        rememberTerminallyRejectedAccessToken(recovery.accessToken);
        await terminateInvalidSessionSingleFlight();
      }
    } else if (!recovery.terminalFailureAlreadyHandled) {
      await terminateInvalidSessionSingleFlight();
    }
  }

  const expected = !shouldReportApiFailure(response.status, options);
  logApiTiming(method, url, startedAt, response.status, undefined, expected);
  if (!response.ok) {
    const errorBody = await readErrorBody(response);
    const message = errorBody.message;
    if (!expected) {
      reportApiFailure({
        method,
        fn,
        endpoint,
        status: response.status,
        message,
        duration_ms: Math.round(performance.now() - startedAt),
      });
    }
    throw new ApiRequestError(message, response.status, errorBody.data);
  }

  return response.json();
}

export function apiGet<T = unknown>(
  fn: string,
  endpoint: string,
  params?: Record<string, string>,
  options: ApiRequestOptions = {},
) {
  return apiRequest<T>({ method: "GET", fn, endpoint, params, options });
}

export function apiPost<T = unknown>(
  fn: string,
  endpoint: string,
  body: Record<string, unknown>,
  options: ApiRequestOptions = {},
) {
  return apiRequest<T>({ method: "POST", fn, endpoint, body, options });
}

export function apiPut<T = unknown>(
  fn: string,
  endpoint: string,
  body: Record<string, unknown>,
  options: ApiRequestOptions = {},
) {
  return apiRequest<T>({ method: "PUT", fn, endpoint, body, options });
}

export function apiPatch<T = unknown>(
  fn: string,
  endpoint: string,
  body: Record<string, unknown>,
  options: ApiRequestOptions = {},
) {
  return apiRequest<T>({ method: "PATCH", fn, endpoint, body, options });
}

export function apiDelete<T = unknown>(
  fn: string,
  endpoint: string,
  params?: Record<string, string>,
  options: ApiRequestOptions = {},
) {
  return apiRequest<T>({ method: "DELETE", fn, endpoint, params, options });
}
