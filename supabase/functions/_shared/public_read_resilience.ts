import { jsonResponse } from './cors.ts';

export type PublicReadErrorClass =
  | 'not_found'
  | 'auth_jwt_validation'
  | 'transport'
  | 'upstream_postgrest'
  | 'timeout'
  | 'unknown';

type PublicReadErrorLike = {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  status?: unknown;
};

type PublicReadQueryResult<T> = {
  data: T | null;
  error: unknown | null;
};

export type PublicReadTimings = Record<string, number>;

export type PublicReadContext = {
  requestId: string;
  functionName: string;
  endpoint: string;
  startedAt: number;
  requestStartedAt: string;
  timings: PublicReadTimings;
};

export type PublicVenueResolution<T> =
  | { kind: 'found'; data: T }
  | { kind: 'not_found' }
  | { kind: 'error'; error: unknown };

export class PublicReadStageError extends Error {
  readonly stage: string;
  readonly originalError: unknown;

  constructor(stage: string, error: unknown) {
    super(error instanceof Error ? error.message : String(error || 'Public read stage failed'));
    this.name = 'PublicReadStageError';
    this.stage = stage;
    this.originalError = error;
  }
}

function runtimeEnv(name: string) {
  try {
    const runtime = (globalThis as typeof globalThis & {
      Deno?: { env?: { get?: (key: string) => string | undefined } };
    }).Deno;
    return runtime?.env?.get?.(name);
  } catch {
    return undefined;
  }
}

function safeErrorShape(error: unknown) {
  const value = error && typeof error === 'object' ? error as PublicReadErrorLike : {};
  return {
    name: typeof value.name === 'string' ? value.name : '',
    message: typeof value.message === 'string' ? value.message : String(error || 'Unknown public read failure'),
    code: typeof value.code === 'string' ? value.code : '',
    status: typeof value.status === 'number' ? value.status : null,
  };
}

export function sanitizePublicReadDiagnostic(value: unknown) {
  return String(value || 'Unknown public read failure')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){2}\b/g, '[redacted-jwt]')
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+\b/g, '[redacted-key]')
    .slice(0, 240);
}

export function classifyPublicReadError(error: unknown): {
  errorClass: Exclude<PublicReadErrorClass, 'not_found'>;
  status: number;
  postgrestCode: string | null;
  message: string;
} {
  const shaped = safeErrorShape(error);
  const searchable = `${shaped.code} ${shaped.name} ${shaped.message}`.toLowerCase();
  const message = sanitizePublicReadDiagnostic(shaped.message);
  const postgrestCode = /^PGRST\d+$/i.test(shaped.code) ? shaped.code.toUpperCase() : null;

  if (postgrestCode === 'PGRST303' || /jwt.+(?:future|claim|validat|parsing)|issued at future/.test(searchable)) {
    return { errorClass: 'auth_jwt_validation', status: 503, postgrestCode, message };
  }
  if (shaped.name === 'AbortError' || /timeout|timed out|deadline exceeded/.test(searchable)) {
    return { errorClass: 'timeout', status: 503, postgrestCode, message };
  }
  if (/failed to fetch|network|connection|econn|socket|dns|http\/2|stream error/.test(searchable)) {
    return { errorClass: 'transport', status: 503, postgrestCode, message };
  }
  if (postgrestCode) {
    return { errorClass: 'upstream_postgrest', status: 502, postgrestCode, message };
  }
  if (shaped.status && shaped.status >= 500) {
    return { errorClass: 'upstream_postgrest', status: 502, postgrestCode, message };
  }
  return { errorClass: 'unknown', status: 503, postgrestCode, message };
}

function decodeJwtClaims(credential: string) {
  const parts = credential.split('.');
  if (parts.length !== 3) return null;
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = globalThis.atob(padded);
    const claims = JSON.parse(decoded) as { role?: unknown; iat?: unknown; exp?: unknown };
    return {
      role: typeof claims.role === 'string' ? claims.role : null,
      iat: typeof claims.iat === 'number' ? claims.iat : null,
      exp: typeof claims.exp === 'number' ? claims.exp : null,
    };
  } catch {
    return null;
  }
}

export async function safeServiceCredentialDiagnostic(credential: string | undefined) {
  const claims = credential ? decodeJwtClaims(credential) : null;
  let fingerprint: string | null = null;
  if (credential && globalThis.crypto?.subtle) {
    try {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(credential));
      fingerprint = Array.from(new Uint8Array(digest))
        .slice(0, 8)
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      fingerprint = null;
    }
  }
  return {
    token_type: claims ? 'legacy_jwt' : credential ? 'opaque_server_key' : 'unavailable',
    role: claims?.role || 'service_role',
    fingerprint_sha256_prefix: fingerprint,
    iat: claims?.iat ?? null,
    exp: claims?.exp ?? null,
  };
}

export function createPublicReadContext(functionName: string, endpoint: string): PublicReadContext {
  return {
    requestId: globalThis.crypto?.randomUUID?.() || `pickla-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    functionName,
    endpoint,
    startedAt: performance.now(),
    requestStartedAt: new Date().toISOString(),
    timings: { request_start: 0 },
  };
}

export async function measurePublicReadStage<T>(
  context: PublicReadContext,
  stage: string,
  operation: () => PromiseLike<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await operation();
  } catch (error) {
    throw new PublicReadStageError(stage, error);
  } finally {
    context.timings[stage] = Math.round(performance.now() - startedAt);
  }
}

export async function resolvePublicVenueQuery<T>(
  context: PublicReadContext,
  operation: () => PromiseLike<PublicReadQueryResult<T>>,
): Promise<PublicVenueResolution<T>> {
  try {
    const result = await measurePublicReadStage(context, 'venue', operation);
    if (result.error) return { kind: 'error', error: result.error };
    if (!result.data) return { kind: 'not_found' };
    return { kind: 'found', data: result.data };
  } catch (error) {
    return {
      kind: 'error',
      error: error instanceof PublicReadStageError ? error.originalError : error,
    };
  }
}

function runtimeContext() {
  return {
    edge_region: runtimeEnv('SB_REGION') || null,
    deployment_id: runtimeEnv('DENO_DEPLOYMENT_ID') || null,
    execution_id: runtimeEnv('SB_EXECUTION_ID') || null,
    release_sha: runtimeEnv('RELEASE_SHA') || runtimeEnv('GIT_SHA') || null,
  };
}

function serverTimingHeader(timings: PublicReadTimings) {
  return Object.entries(timings)
    .filter(([, duration]) => Number.isFinite(duration) && duration >= 0)
    .map(([name, duration]) => `${name.replace(/[^a-zA-Z0-9_-]/g, '_')};dur=${Math.round(duration)}`)
    .join(', ');
}

export function attachPublicReadHeaders(response: Response, context: PublicReadContext) {
  response.headers.set('x-pickla-request-id', context.requestId);
  response.headers.set('Access-Control-Expose-Headers', 'x-pickla-request-id, Server-Timing');
  response.headers.set('Timing-Allow-Origin', '*');
  const timing = serverTimingHeader(context.timings);
  if (timing) response.headers.set('Server-Timing', timing);
  return response;
}

export function publicReadJsonResponse(
  data: unknown,
  context: PublicReadContext,
  status = 200,
  cacheSeconds = 0,
) {
  const serializationStartedAt = performance.now();
  const response = jsonResponse(data, status, cacheSeconds);
  context.timings.serialization = Math.round(performance.now() - serializationStartedAt);
  context.timings.total = Math.round(performance.now() - context.startedAt);
  return attachPublicReadHeaders(response, context);
}

export function publicReadNotFoundResponse(message: string, context: PublicReadContext) {
  return publicReadJsonResponse({
    error: message,
    code: 'venue_not_found',
    error_class: 'not_found',
    request_id: context.requestId,
  }, context, 404);
}

export function publicReadClientErrorResponse(message: string, status: number, context: PublicReadContext) {
  return publicReadJsonResponse({ error: message, request_id: context.requestId }, context, status);
}

export async function publicReadFailureResponse(input: {
  context: PublicReadContext;
  stage: string;
  error: unknown;
  serviceCredential?: string;
}) {
  const { context, stage, error } = input;
  const classified = classifyPublicReadError(error);
  const credential = await safeServiceCredentialDiagnostic(input.serviceCredential);
  context.timings.total = Math.round(performance.now() - context.startedAt);
  const diagnostic = {
    event: 'public_read_failure',
    request_id: context.requestId,
    function_name: context.functionName,
    endpoint: context.endpoint,
    stage,
    status: classified.status,
    error_class: classified.errorClass,
    duration_ms: context.timings[stage] ?? null,
    total_ms: context.timings.total,
    postgrest_code: classified.postgrestCode,
    message: classified.message,
    request_started_at: context.requestStartedAt,
    edge_timestamp: new Date().toISOString(),
    ...runtimeContext(),
    credential,
  };
  console.error(JSON.stringify(diagnostic));

  return publicReadJsonResponse({
    error: 'Kunde inte hämta data just nu',
    code: 'public_read_unavailable',
    error_class: classified.errorClass,
    request_id: context.requestId,
  }, context, classified.status);
}
