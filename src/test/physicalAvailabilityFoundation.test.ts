import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const migration = readFileSync("supabase/migrations/20260909120000_physical_availability_foundation_v1.sql", "utf8");
const shared = readFileSync("supabase/functions/_shared/physical_availability.ts", "utf8");
const bookings = readFileSync("supabase/functions/api-bookings/index.ts", "utf8");
const webhook = readFileSync("supabase/functions/api-stripe-webhook/index.ts", "utf8");
const admin = readFileSync("supabase/functions/api-admin/index.ts", "utf8");
const eventSales = readFileSync("supabase/functions/event-sales-agent/index.ts", "utf8");

function between(source: string, start: string, end: string) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

function loadPhysicalAvailabilityRuntime() {
  const source = between(
    shared,
    "function isAvailabilityDecision",
    "export async function checkPhysicalActivitySchedule",
  ).replaceAll("export ", "");
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const factory = new Function(
    `${javascript}; return {
      checkPhysicalAvailability,
      claimPhysicalBookings,
    };`,
  );
  return factory() as {
    checkPhysicalAvailability: (client: unknown, input: Record<string, unknown>) => Promise<unknown>;
    claimPhysicalBookings: (client: unknown, venueId: string, claims: Record<string, unknown>[]) => Promise<unknown>;
  };
}

describe("Physical Availability Foundation V1", () => {
  it("defines one structured, service-only, PII-free physical decision", () => {
    expect(migration).toContain("FUNCTION public.check_physical_availability(");
    for (const type of ["venue_closed", "court_unavailable", "booking", "activity_occurrence", "resource_block"]) {
      expect(migration).toContain(`'${type}'`);
    }
    expect(migration).toContain("'interval_semantics', '[start,end)'");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("TO service_role");
    const canonical = between(migration, "CREATE OR REPLACE FUNCTION public.check_physical_availability", "CREATE OR REPLACE FUNCTION public.lock_physical_resources");
    expect(canonical).not.toMatch(/customer_name|customer_email|customer_phone|access_code|stripe_session|receipt|payment/i);
  });

  it("uses half-open local-time occurrence semantics including hidden/cancelled overrides", () => {
    expect(migration).toContain("booking.start_time < p_ends_at");
    expect(migration).toContain("booking.end_time > p_starts_at");
    expect(migration).toContain("block.starts_at < p_ends_at");
    expect(migration).toContain("block.ends_at > p_starts_at");
    expect(migration).toContain("CASE WHEN session.end_time <= session.start_time THEN 1 ELSE 0 END");
    expect(migration).toContain("AT TIME ZONE v_timezone");
    expect(migration).toContain("override.status IN ('cancelled', 'hidden')");
  });

  it("serializes every physical writer on one deterministic lock namespace", () => {
    const lock = between(migration, "CREATE OR REPLACE FUNCTION public.lock_physical_resources", "CREATE OR REPLACE FUNCTION public.lock_course_resources");
    expect(lock).toContain("ORDER BY court_id");
    expect(lock).toContain("pg_advisory_xact_lock");
    expect(lock).toContain("'physical_resource:'");
    expect(migration).toContain("SELECT public.lock_physical_resources(p_venue_id, p_court_ids)");
    expect(migration).toContain("trg_guard_booking_physical_claim");
    expect(migration).toContain("trg_guard_activity_session_physical_claim");
    expect(migration).toContain("trg_guard_resource_block_physical_claim");
  });

  it("makes multi-court booking and B2B block sets transactional", () => {
    const bookingClaim = between(migration, "CREATE OR REPLACE FUNCTION public.claim_physical_bookings", "CREATE OR REPLACE FUNCTION public.guard_booking_physical_claim");
    expect(bookingClaim).toContain("PERFORM public.lock_physical_resources");
    expect(bookingClaim).toContain("public.check_physical_availability");
    expect(bookingClaim).toContain("INSERT INTO public.bookings");
    expect(migration).toContain("FUNCTION public.claim_physical_resource_blocks");
    expect(migration).toContain("FUNCTION public.reconcile_physical_resource_blocks");
    expect(eventSales).toContain("admin.rpc('reconcile_physical_resource_blocks'");
  });

  it("routes booking read, checkout and every booking commit through the contract", () => {
    const publicRead = between(bookings, "path === 'public-courts'", "path === 'public-open-bookings'");
    const checkout = between(bookings, "path === 'create-checkout'", "// ── Entitlement check");
    const publicBook = between(bookings, "path === 'public-book'", "// Public customer price projection");
    const directCreate = between(bookings, "path === 'create'", "// PATCH /api-bookings/update");
    expect(publicRead).toContain("checkPhysicalAvailability");
    expect(publicRead).not.toContain("source_id:");
    expect(checkout).toContain("checkPhysicalAvailability");
    expect(publicBook).toContain("claimPhysicalBookings");
    expect(directCreate).toContain("claimPhysicalBookings");
    expect(bookings).toContain("bookings = await claimPhysicalBookings(adminFree");
  });

  it("fails closed instead of translating lookup errors into free capacity", () => {
    expect(shared).toContain("throw new PhysicalAvailabilityLookupError");
    expect(bookings).toContain("return errorResponse('Tillgängligheten kunde inte verifieras. Försök igen.', 503)");
    expect(admin).toContain("status: 503");
    expect(eventSales).toContain("Ingen bokning bekräftades.', 503");
  });

  it("denies both read decisions and final claims when the canonical RPC lookup fails", async () => {
    const runtime = loadPhysicalAvailabilityRuntime();
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "dependency unavailable" } }),
    };

    await expect(runtime.checkPhysicalAvailability(client, {
      venueId: "venue-a",
      courtIds: ["court-a"],
      startsAt: "2030-01-01T09:00:00Z",
      endsAt: "2030-01-01T10:00:00Z",
    })).rejects.toMatchObject({ name: "PhysicalAvailabilityLookupError" });

    await expect(runtime.claimPhysicalBookings(client, "venue-a", [{
      venue_id: "venue-a",
      venue_court_id: "court-a",
      user_id: "user-a",
      start_time: "2030-01-01T09:00:00Z",
      end_time: "2030-01-01T10:00:00Z",
    }])).rejects.toMatchObject({ name: "PhysicalAvailabilityLookupError" });
  });

  it("uses the same final claim in the paid webhook and records the non-destructive recovery state", () => {
    const courtHandler = between(webhook, "async function handleCourtBooking", "// ── Shared: resolve a real user");
    expect(courtHandler).toContain("claimPhysicalBookings(serviceClient");
    expect(courtHandler).toContain("delivery_status:");
    expect(courtHandler).toContain("recordPaidCapacityConflict");
    expect(courtHandler).toContain("Payment remains recorded for manual resolution");
    expect(courtHandler).not.toContain("refund");
    expect(courtHandler).not.toMatch(/from\('bookings'\)\.insert/);
  });

  it("routes Activity and Corporate-compatible preview through canonical truth", () => {
    expect(admin).toContain("checkPhysicalActivitySchedule(admin");
    const compatibility = between(migration, "CREATE OR REPLACE FUNCTION public.preview_course_resource_schedule", "REVOKE ALL ON FUNCTION public.preview_course_resource_schedule");
    expect(compatibility).toContain("public.check_physical_availability");
    expect(compatibility).toContain("p_exclude_session_id");
    expect(compatibility).toContain("p_exclude_series_id");
  });

  it("does not add a speculative index or a second physical-capacity table", () => {
    expect(migration).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i);
    expect(migration).not.toMatch(/CREATE\s+TABLE/i);
    expect(migration).not.toMatch(/capacity_holds/i);
  });
});
