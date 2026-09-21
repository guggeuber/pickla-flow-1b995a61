import {
  authConcurrencySnapshot,
  getSessionSingleFlight,
  isTerminalAuthFailureInProgress,
  rememberTerminallyRejectedAccessToken,
  recoverSessionAfterUnauthorized,
  terminateInvalidSessionSingleFlight,
} from "@/lib/authSessionSingleFlight";
import { reportApiFailure } from "@/lib/clientObservability";
import { markReliabilityMilestone } from "@/lib/reliabilityTiming";

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

export type ClientFailureKind =
  | "real_http_4xx"
  | "real_http_5xx"
  | "network_error"
  | "timeout"
  | "aborted"
  | "offline"
  | "auth_refresh_failure"
  | "service_worker_failure"
  | "version_check_failure"
  | "parse_failure"
  | "unknown_transport_failure";

export class ApiTransportError extends Error {
  readonly failureKind: ClientFailureKind;
  readonly requestId: string;

  constructor(message: string, failureKind: ClientFailureKind, requestId: string) {
    super(message);
    this.name = failureKind === "aborted" ? "AbortError" : "ApiTransportError";
    this.failureKind = failureKind;
    this.requestId = requestId;
  }
}

export type ApiClientTiming = {
  client_request_id: string;
  response_request_id?: string;
  total_ms: number;
  auth_ms: number;
  fetch_ms: number;
  parse_ms: number;
  retry_count: number;
  fetch_attempt_count: number;
  auth_refresh_ms?: number;
  status?: number;
  failure_kind?: ClientFailureKind;
  auth_state_before: ReturnType<typeof authConcurrencySnapshot>;
  resource_timing?: Record<string, unknown>;
};

export type ApiRequestOptions = {
  auth?: "session" | "omit";
  expectedStatuses?: number[];
  signal?: AbortSignal;
  publicRead?: {
    maxRetries?: 0 | 1;
    retryDelayMs?: number;
    staleRetained?: boolean;
  };
  onTiming?: (timing: ApiClientTiming) => void;
};

type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type ApiRequestInput = {
  method: ApiMethod;
  fn: string;
  endpoint: string;
  params?: Record<string, string>;
  body?: Record<string, unknown> | FormData;
  options: ApiRequestOptions;
};

function shouldReportApiFailure(status: number, options: ApiRequestOptions) {
  return !options.expectedStatuses?.includes(status);
}

function buildHeaders(
  includeJsonContentType: boolean,
  accessToken: string | null,
  requestId: string,
  includeCorrelationHeader = true,
) {
  const headers: Record<string, string> = {};
  if (includeJsonContentType) headers["Content-Type"] = "application/json";
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (includeCorrelationHeader) headers["x-pickla-request-id"] = requestId;
  return headers;
}

function createClientRequestId() {
  return globalThis.crypto?.randomUUID?.()
    || `pickla-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function classifyClientFailure(error: unknown, signal?: AbortSignal): ClientFailureKind {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error || "");
  const abortReason = signal?.reason;
  const abortReasonName = abortReason instanceof Error ? abortReason.name : "";
  const abortReasonMessage = abortReason instanceof Error ? abortReason.message : String(abortReason || "");
  if (name === "ServiceWorkerError") return "service_worker_failure";
  if (
    name === "TimeoutError"
    || abortReasonName === "TimeoutError"
    || /timeout|timed out|deadline exceeded/i.test(`${message} ${abortReasonMessage}`)
  ) return "timeout";
  if (signal?.aborted || name === "AbortError") return "aborted";
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  if (error instanceof TypeError || /load failed|failed to fetch|network/i.test(message)) return "network_error";
  return "unknown_transport_failure";
}

function criticalSurface(fn: string, endpoint: string) {
  if (fn === "api-event-public" && ["today-personalized", "today-primary"].includes(endpoint)) return "customer";
  if (fn === "api-auth" && endpoint === "me") return "desk";
  if (fn === "api-admin" && endpoint === "check") return "admin";
  return null;
}

function markPrimaryRequest(fn: string, endpoint: string, phase: "started" | "received") {
  const surface = criticalSurface(fn, endpoint);
  if (!surface) return;
  markReliabilityMilestone(`primary_request_${phase}`, { surface, fn, endpoint });
}

function resourceTiming(url: string) {
  if (typeof performance === "undefined") return undefined;
  const entries = performance.getEntriesByName(url, "resource") as PerformanceResourceTiming[];
  const entry = entries.at(-1);
  if (!entry) return { available: false };
  return {
    available: true,
    timing_allowed: entry.responseStart > 0,
    fetch_start_ms: Math.round(entry.fetchStart),
    domain_lookup_ms: Math.max(0, Math.round(entry.domainLookupEnd - entry.domainLookupStart)),
    connect_ms: Math.max(0, Math.round(entry.connectEnd - entry.connectStart)),
    tls_ms: entry.secureConnectionStart > 0 ? Math.max(0, Math.round(entry.connectEnd - entry.secureConnectionStart)) : null,
    request_start_ms: Math.round(entry.requestStart),
    response_start_ms: Math.round(entry.responseStart),
    response_end_ms: Math.round(entry.responseEnd),
    duration_ms: Math.round(entry.duration),
    transfer_size: entry.transferSize,
  };
}

function emitTiming(options: ApiRequestOptions, timing: ApiClientTiming) {
  options.onTiming?.(timing);
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
  failureKind?: ClientFailureKind;
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

function requestUrl(
  fn: string,
  endpoint: string,
  params?: Record<string, string>,
  queryRequestId?: string,
) {
  const url = new URL(`${BASE_URL}/${fn}/${endpoint}`);
  if (params) Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  if (queryRequestId) url.searchParams.set("pickla_request_id", queryRequestId);
  return url.toString();
}

async function publicReadRequest<T>({ method, fn, endpoint, params, body, options }: ApiRequestInput): Promise<T> {
  const startedAt = performance.now();
  const includeJsonContentType = body !== undefined && !(body instanceof FormData);
  const authStartedAt = performance.now();
  const authStateBefore = authConcurrencySnapshot();
  const accessToken = await getRequestAccessToken(options.auth);
  const authMs = Math.round(performance.now() - authStartedAt);
  const maxRetries = options.publicRead?.maxRetries ?? 1;
  const retryDelayMs = Math.max(0, options.publicRead?.retryDelayMs ?? 250);
  let firstFailure: PublicReadFailure | null = null;
  markPrimaryRequest(fn, endpoint, "started");

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const clientRequestId = createClientRequestId();
    const correlationInQuery = method === "GET" && !accessToken && !includeJsonContentType;
    const url = requestUrl(fn, endpoint, params, correlationInQuery ? clientRequestId : undefined);
    const fetchStartedAt = performance.now();
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: buildHeaders(includeJsonContentType, accessToken, clientRequestId, !correlationInQuery),
        signal: options.signal,
        ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
      });
    } catch (error) {
      const failureKind = classifyClientFailure(error, options.signal);
      const failure: PublicReadFailure = {
        message: error instanceof Error ? error.message : "Public read network failure",
        data: { code: "public_read_network_error", error_class: failureKind },
        requestId: clientRequestId,
        failureKind,
      };
      firstFailure ||= failure;
      if (failureKind !== "aborted" && attempt < maxRetries && isTransientPublicReadFailure(error)) {
        await publicReadDelay(retryDelayMs, options.signal);
        continue;
      }
      const timing: ApiClientTiming = {
        client_request_id: clientRequestId,
        total_ms: Math.round(performance.now() - startedAt),
        auth_ms: authMs,
        fetch_ms: Math.round(performance.now() - fetchStartedAt),
        parse_ms: 0,
        retry_count: attempt,
        fetch_attempt_count: attempt + 1,
        failure_kind: failureKind,
        auth_state_before: authStateBefore,
        resource_timing: resourceTiming(url),
      };
      emitTiming(options, timing);
      reportApiFailure({
        method,
        fn,
        endpoint,
        message: failure.message,
        duration_ms: timing.total_ms,
        request_id: clientRequestId,
        initial_request_id: firstFailure.requestId,
        error_class: failureKind,
        failure_kind: failureKind,
        retry_count: attempt,
        retry_outcome: "failed",
        stale_retained: Boolean(options.publicRead?.staleRetained),
        timings: timing,
      });
      throw new ApiTransportError("Kunde inte hämta data just nu", failureKind, clientRequestId);
    }

    const fetchMs = Math.round(performance.now() - fetchStartedAt);
    markPrimaryRequest(fn, endpoint, "received");
    const requestId = response.headers.get("x-pickla-request-id") || undefined;
    if (response.ok) {
      logApiTiming(method, url, startedAt, response.status);
      const parseStartedAt = performance.now();
      let parsed: T;
      try {
        parsed = await response.json();
      } catch (error) {
        const timing: ApiClientTiming = {
          client_request_id: clientRequestId,
          response_request_id: requestId,
          total_ms: Math.round(performance.now() - startedAt),
          auth_ms: authMs,
          fetch_ms: fetchMs,
          parse_ms: Math.round(performance.now() - parseStartedAt),
          retry_count: attempt,
          fetch_attempt_count: attempt + 1,
          status: response.status,
          failure_kind: "parse_failure",
          auth_state_before: authStateBefore,
          resource_timing: resourceTiming(url),
        };
        emitTiming(options, timing);
        reportApiFailure({
          method, fn, endpoint, status: response.status,
          message: error instanceof Error ? error.message : "Response parse failed",
          duration_ms: timing.total_ms,
          request_id: requestId || clientRequestId,
          failure_kind: "parse_failure",
          error_class: "parse_failure",
          timings: timing,
        });
        throw new ApiTransportError("Kunde inte läsa svaret", "parse_failure", clientRequestId);
      }
      const timing: ApiClientTiming = {
        client_request_id: clientRequestId,
        response_request_id: requestId,
        total_ms: Math.round(performance.now() - startedAt),
        auth_ms: authMs,
        fetch_ms: fetchMs,
        parse_ms: Math.round(performance.now() - parseStartedAt),
        retry_count: attempt,
        fetch_attempt_count: attempt + 1,
        status: response.status,
        auth_state_before: authStateBefore,
        resource_timing: resourceTiming(url),
      };
      emitTiming(options, timing);
      if (firstFailure) {
        reportApiFailure({
          method,
          fn,
          endpoint,
          status: firstFailure.status,
          message: firstFailure.message,
          duration_ms: timing.total_ms,
          request_id: firstFailure.requestId,
          final_request_id: requestId,
          error_class: firstFailure.failureKind
            || (typeof firstFailure.data?.error_class === "string" ? firstFailure.data.error_class : undefined),
          failure_kind: firstFailure.failureKind,
          retry_count: attempt,
          retry_outcome: "recovered",
          stale_retained: Boolean(options.publicRead?.staleRetained),
          timings: timing,
        });
      }
      return parsed;
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
    const timing: ApiClientTiming = {
      client_request_id: clientRequestId,
      response_request_id: failure.requestId,
      total_ms: Math.round(performance.now() - startedAt),
      auth_ms: authMs,
      fetch_ms: fetchMs,
      parse_ms: 0,
      retry_count: attempt,
      fetch_attempt_count: attempt + 1,
      status: response.status,
      failure_kind: response.status >= 500 ? "real_http_5xx" : "real_http_4xx",
      auth_state_before: authStateBefore,
      resource_timing: resourceTiming(url),
    };
    emitTiming(options, timing);
    logApiTiming(method, url, startedAt, response.status, undefined, expected);
    if (!expected) {
      reportApiFailure({
        method,
        fn,
        endpoint,
        status: response.status,
        message: errorBody.message,
        duration_ms: timing.total_ms,
        request_id: failure.requestId,
        initial_request_id: firstFailure.requestId,
        error_class: typeof errorBody.data?.error_class === "string" ? errorBody.data.error_class : undefined,
        failure_kind: response.status >= 500 ? "real_http_5xx" : "real_http_4xx",
        retry_count: attempt,
        retry_outcome: "failed",
        stale_retained: Boolean(options.publicRead?.staleRetained),
        timings: timing,
      });
    }
    throw new ApiRequestError(errorBody.message, response.status, errorBody.data);
  }

  throw new ApiTransportError("Kunde inte hämta data just nu", "unknown_transport_failure", createClientRequestId());
}

async function apiRequest<T>({ method, fn, endpoint, params, body, options }: ApiRequestInput): Promise<T> {
  if (options.publicRead) return publicReadRequest<T>({ method, fn, endpoint, params, body, options });
  const startedAt = performance.now();
  const includeJsonContentType = body !== undefined && !(body instanceof FormData);
  const clientRequestId = createClientRequestId();
  const authStateBefore = authConcurrencySnapshot();
  const authStartedAt = performance.now();
  let originalAccessToken: string | null;
  try {
    originalAccessToken = await getRequestAccessToken(options.auth);
  } catch (error) {
    const timing: ApiClientTiming = {
      client_request_id: clientRequestId,
      total_ms: Math.round(performance.now() - startedAt),
      auth_ms: Math.round(performance.now() - authStartedAt),
      fetch_ms: 0,
      parse_ms: 0,
      retry_count: 0,
      fetch_attempt_count: 0,
      failure_kind: "auth_refresh_failure",
      auth_state_before: authStateBefore,
    };
    emitTiming(options, timing);
    reportApiFailure({
      method, fn, endpoint,
      message: error instanceof Error ? error.message : "Authentication session failed",
      duration_ms: timing.total_ms,
      request_id: clientRequestId,
      error_class: "auth_refresh_failure",
      failure_kind: "auth_refresh_failure",
      timings: timing,
    });
    throw new ApiTransportError("Authentication session failed", "auth_refresh_failure", clientRequestId);
  }
  const authMs = Math.round(performance.now() - authStartedAt);
  const correlationInQuery = method === "GET" && !originalAccessToken && !includeJsonContentType;
  const url = requestUrl(fn, endpoint, params, correlationInQuery ? clientRequestId : undefined);
  let fetchMs = 0;
  let fetchAttemptCount = 0;
  let authRefreshMs = 0;

  const send = async (accessToken: string | null) => {
    fetchAttemptCount += 1;
    const fetchStartedAt = performance.now();
    try {
      return await fetch(url, {
        method,
        headers: buildHeaders(includeJsonContentType, accessToken, clientRequestId, !correlationInQuery),
        signal: options.signal,
        ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
      });
    } finally {
      fetchMs += Math.round(performance.now() - fetchStartedAt);
    }
  };

  markPrimaryRequest(fn, endpoint, "started");
  let response: Response;
  try {
    response = await send(originalAccessToken);
  } catch (error) {
    const failureKind = classifyClientFailure(error, options.signal);
    const timing: ApiClientTiming = {
      client_request_id: clientRequestId,
      total_ms: Math.round(performance.now() - startedAt),
      auth_ms: authMs,
      fetch_ms: fetchMs,
      parse_ms: 0,
      retry_count: 0,
      fetch_attempt_count: fetchAttemptCount,
      failure_kind: failureKind,
      auth_state_before: authStateBefore,
      resource_timing: resourceTiming(url),
    };
    emitTiming(options, timing);
    reportApiFailure({
      method, fn, endpoint,
      message: error instanceof Error ? error.message : "Network request failed",
      duration_ms: timing.total_ms,
      request_id: clientRequestId,
      error_class: failureKind,
      failure_kind: failureKind,
      timings: timing,
    });
    throw new ApiTransportError(
      error instanceof Error ? error.message : "Network request failed",
      failureKind,
      clientRequestId,
    );
  }
  markPrimaryRequest(fn, endpoint, "received");
  const shouldRecover = response.status === 401
    && options.auth !== "omit"
    && Boolean(originalAccessToken)
    && !options.expectedStatuses?.includes(401);

  if (shouldRecover) {
    const recoveryStartedAt = performance.now();
    const recovery = await recoverSessionAfterUnauthorized(originalAccessToken!);
    authRefreshMs = Math.round(performance.now() - recoveryStartedAt);
    if (recovery.accessToken) {
      try {
        response = await send(recovery.accessToken);
      } catch (error) {
        const failureKind = classifyClientFailure(error, options.signal);
        const timing: ApiClientTiming = {
          client_request_id: clientRequestId,
          total_ms: Math.round(performance.now() - startedAt),
          auth_ms: authMs,
          auth_refresh_ms: authRefreshMs,
          fetch_ms: fetchMs,
          parse_ms: 0,
          retry_count: 1,
          fetch_attempt_count: fetchAttemptCount,
          failure_kind: failureKind,
          auth_state_before: authStateBefore,
          resource_timing: resourceTiming(url),
        };
        emitTiming(options, timing);
        reportApiFailure({
          method, fn, endpoint,
          message: error instanceof Error ? error.message : "Network request failed after auth refresh",
          duration_ms: timing.total_ms,
          request_id: clientRequestId,
          error_class: failureKind,
          failure_kind: failureKind,
          timings: timing,
        });
        throw new ApiTransportError("Network request failed after auth refresh", failureKind, clientRequestId);
      }
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
      const timing: ApiClientTiming = {
        client_request_id: clientRequestId,
        response_request_id: response.headers.get("x-pickla-request-id") || undefined,
        total_ms: Math.round(performance.now() - startedAt),
        auth_ms: authMs,
        auth_refresh_ms: authRefreshMs || undefined,
        fetch_ms: fetchMs,
        parse_ms: 0,
        retry_count: fetchAttemptCount - 1,
        fetch_attempt_count: fetchAttemptCount,
        status: response.status,
        failure_kind: response.status >= 500 ? "real_http_5xx" : "real_http_4xx",
        auth_state_before: authStateBefore,
        resource_timing: resourceTiming(url),
      };
      emitTiming(options, timing);
      reportApiFailure({
        method,
        fn,
        endpoint,
        status: response.status,
        message,
        duration_ms: timing.total_ms,
        request_id: timing.response_request_id || clientRequestId,
        failure_kind: timing.failure_kind,
        timings: timing,
      });
    }
    throw new ApiRequestError(message, response.status, errorBody.data);
  }

  const parseStartedAt = performance.now();
  try {
    const parsed = await response.json() as T;
    const timing: ApiClientTiming = {
      client_request_id: clientRequestId,
      response_request_id: response.headers.get("x-pickla-request-id") || undefined,
      total_ms: Math.round(performance.now() - startedAt),
      auth_ms: authMs,
      auth_refresh_ms: authRefreshMs || undefined,
      fetch_ms: fetchMs,
      parse_ms: Math.round(performance.now() - parseStartedAt),
      retry_count: fetchAttemptCount - 1,
      fetch_attempt_count: fetchAttemptCount,
      status: response.status,
      auth_state_before: authStateBefore,
      resource_timing: resourceTiming(url),
    };
    emitTiming(options, timing);
    return parsed;
  } catch (error) {
    const timing: ApiClientTiming = {
      client_request_id: clientRequestId,
      response_request_id: response.headers.get("x-pickla-request-id") || undefined,
      total_ms: Math.round(performance.now() - startedAt),
      auth_ms: authMs,
      auth_refresh_ms: authRefreshMs || undefined,
      fetch_ms: fetchMs,
      parse_ms: Math.round(performance.now() - parseStartedAt),
      retry_count: fetchAttemptCount - 1,
      fetch_attempt_count: fetchAttemptCount,
      status: response.status,
      failure_kind: "parse_failure",
      auth_state_before: authStateBefore,
      resource_timing: resourceTiming(url),
    };
    emitTiming(options, timing);
    reportApiFailure({
      method, fn, endpoint, status: response.status,
      message: error instanceof Error ? error.message : "Response parse failed",
      duration_ms: timing.total_ms,
      request_id: timing.response_request_id || clientRequestId,
      error_class: "parse_failure",
      failure_kind: "parse_failure",
      timings: timing,
    });
    throw new ApiTransportError("Kunde inte läsa svaret", "parse_failure", clientRequestId);
  }
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

export function apiPostForm<T = unknown>(
  fn: string,
  endpoint: string,
  body: FormData,
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
