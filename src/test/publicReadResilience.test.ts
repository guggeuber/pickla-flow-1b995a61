import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyPublicReadError,
  createPublicReadContext,
  publicReadFailureResponse,
  publicReadNotFoundResponse,
  resolvePublicVenueQuery,
  safeServiceCredentialDiagnostic,
} from "../../supabase/functions/_shared/public_read_resilience";

const eventPublicSource = readFileSync("supabase/functions/api-event-public/index.ts", "utf8");
const bookingsSource = readFileSync("supabase/functions/api-bookings/index.ts", "utf8");

function fakeServiceJwt() {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ iss: "supabase", role: "service_role", iat: 1780860158, exp: 2096436158 })}.private-signature`;
}

describe("public read venue classification", () => {
  it("returns a found venue only when the query succeeds with a row", async () => {
    const context = createPublicReadContext("api-event-public", "today-primary");
    const result = await resolvePublicVenueQuery(context, async () => ({
      data: { id: "venue-1", slug: "pickla-arena-sthlm" },
      error: null,
    }));
    expect(result).toEqual({ kind: "found", data: { id: "venue-1", slug: "pickla-arena-sthlm" } });
    expect(context.timings.venue).toEqual(expect.any(Number));
  });

  it("returns not_found only for a successful no-row result", async () => {
    const context = createPublicReadContext("api-bookings", "public-venue");
    await expect(resolvePublicVenueQuery(context, async () => ({ data: null, error: null })))
      .resolves.toEqual({ kind: "not_found" });

    const response = publicReadNotFoundResponse("Venue not found", context);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: "Venue not found",
      code: "venue_not_found",
      error_class: "not_found",
      request_id: context.requestId,
    }));
    expect(response.status).toBe(404);
  });

  it("keeps PostgREST JWT and transport failures out of the not_found branch", async () => {
    const jwtContext = createPublicReadContext("api-event-public", "today-primary");
    await expect(resolvePublicVenueQuery(jwtContext, async () => ({
      data: null,
      error: { code: "PGRST303", message: "JWT issued at future" },
    }))).resolves.toEqual({
      kind: "error",
      error: { code: "PGRST303", message: "JWT issued at future" },
    });

    const transportContext = createPublicReadContext("api-bookings", "public-venue");
    const transport = new TypeError("Failed to fetch");
    const result = await resolvePublicVenueQuery(transportContext, async () => { throw transport; });
    expect(result).toEqual({ kind: "error", error: transport });
  });

  it("classifies the small required error taxonomy consistently", () => {
    expect(classifyPublicReadError({ code: "PGRST303", message: "JWT issued at future" }))
      .toMatchObject({ errorClass: "auth_jwt_validation", status: 503, postgrestCode: "PGRST303" });
    expect(classifyPublicReadError(new TypeError("Failed to fetch")))
      .toMatchObject({ errorClass: "transport", status: 503 });
    expect(classifyPublicReadError({ name: "AbortError", message: "Timed out" }))
      .toMatchObject({ errorClass: "timeout", status: 503 });
    expect(classifyPublicReadError({ code: "PGRST205", message: "Table unavailable" }))
      .toMatchObject({ errorClass: "upstream_postgrest", status: 502 });
  });
});

describe("safe public read incident diagnostics", () => {
  const originalCrypto = globalThis.crypto;

  beforeEach(() => {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: originalCrypto });
    vi.restoreAllMocks();
  });

  it("returns a correlation ID and logs only safe service credential metadata", async () => {
    const serviceJwt = fakeServiceJwt();
    const context = createPublicReadContext("api-event-public", "today-primary");
    context.timings.venue = 12;
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await publicReadFailureResponse({
      context,
      stage: "venue",
      error: {
        code: "PGRST303",
        message: `JWT issued at future Bearer ${serviceJwt}`,
        details: "private sql and customer@example.test",
      },
      serviceCredential: serviceJwt,
    });
    const body = await response.json();
    const serializedLog = String(log.mock.calls[0][0]);

    expect(response.status).toBe(503);
    expect(response.headers.get("x-pickla-request-id")).toBe(context.requestId);
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain("x-pickla-request-id");
    expect(response.headers.get("Server-Timing")).toContain("venue;dur=12");
    expect(body).toEqual({
      error: "Kunde inte hämta data just nu",
      code: "public_read_unavailable",
      error_class: "auth_jwt_validation",
      request_id: context.requestId,
    });
    expect(serializedLog).toContain('"stage":"venue"');
    expect(serializedLog).toContain('"role":"service_role"');
    expect(serializedLog).toContain('"iat":1780860158');
    expect(serializedLog).toContain('"exp":2096436158');
    expect(serializedLog).toMatch(/"fingerprint_sha256_prefix":"[a-f0-9]{16}"/);
    expect(serializedLog).not.toContain(serviceJwt);
    expect(serializedLog).not.toContain("private-signature");
    expect(serializedLog).not.toContain("customer@example.test");
    expect(JSON.stringify(body)).not.toContain("JWT issued at future");
  });

  it("uses a one-way truncated fingerprint rather than credential material", async () => {
    const serviceJwt = fakeServiceJwt();
    const diagnostic = await safeServiceCredentialDiagnostic(serviceJwt);
    expect(diagnostic).toMatchObject({
      token_type: "legacy_jwt",
      role: "service_role",
      iat: 1780860158,
      exp: 2096436158,
    });
    expect(diagnostic.fingerprint_sha256_prefix).toMatch(/^[a-f0-9]{16}$/);
    expect(JSON.stringify(diagnostic)).not.toContain(serviceJwt);
  });

  it("classifies a JWT failure from a non-venue primary stage consistently", async () => {
    const context = createPublicReadContext("api-event-public", "today-primary");
    context.timings.sessions = 9;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await publicReadFailureResponse({
      context,
      stage: "sessions",
      error: { code: "PGRST303", message: "JWT issued at future" },
      serviceCredential: fakeServiceJwt(),
    });
    await expect(response.json()).resolves.toMatchObject({
      code: "public_read_unavailable",
      error_class: "auth_jwt_validation",
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("x-pickla-request-id")).toBe(context.requestId);
  });
});

describe("critical endpoint integration contracts", () => {
  it("today-primary uses measured stages, a true no-row 404, and classified query failures", () => {
    const route = eventPublicSource.slice(
      eventPublicSource.indexOf("path === 'today-primary'"),
      eventPublicSource.indexOf("path === 'first-visit-offers'"),
    );
    expect(route).toContain("resolvePublicVenueQuery(readContext");
    expect(route).toContain(".maybeSingle()");
    for (const stage of ["sessions", "series_occurrences", "events", "overrides", "committed_counts"]) {
      expect(route).toContain(`'${stage}'`);
    }
    expect(route).toContain("publicReadNotFoundResponse('Venue not found', readContext)");
    expect(route).toContain("publicReadFailureResponse({");
    expect(route).not.toContain("req.headers.get('Authorization')");
    expect(route).not.toContain("getAuthenticatedClient");
    expect(route).not.toContain("if (venueResult.error || !venueResult.data?.id) return errorResponse('Venue not found', 404)");
  });

  it("public-venue eliminates the false 404 while retaining a true no-row 404", () => {
    const route = bookingsSource.slice(
      bookingsSource.indexOf("path === 'public-venue'"),
      bookingsSource.indexOf("path === 'display-device'"),
    );
    expect(route).toContain("resolvePublicVenueQuery(readContext");
    expect(route).toContain(".maybeSingle()");
    expect(route).toContain("publicReadNotFoundResponse('Venue not found', readContext)");
    expect(route).toContain("publicReadFailureResponse({");
    for (const result of ["hoursResult", "operationOverridesResult", "eventsResult", "linksResult"]) {
      expect(route).toContain(`if (${result}.error)`);
    }
    expect(route).not.toContain("req.headers.get('Authorization')");
    expect(route).not.toContain("getAuthenticatedClient");
    expect(route).not.toContain("if (vErr || !venue) return errorResponse('Venue not found', 404)");
  });
});
