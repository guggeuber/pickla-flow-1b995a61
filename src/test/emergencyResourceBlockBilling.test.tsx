import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminResourceBlocks, {
  buildResourceBlockBillingSummary,
  parseBillingRateMinor,
  type ResourceBlock,
} from "@/components/admin/AdminResourceBlocks";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiGet: api.get,
  apiPost: api.post,
  apiPatch: api.patch,
  apiDelete: api.delete,
}));

const venueId = "7ff6e5dc-f27a-473b-af4e-2b358340ab81";
const customerId = "b1111111-1111-4111-8111-111111111111";
const adminApiSource = readFileSync("supabase/functions/api-admin/index.ts", "utf8");
const bookingApiSource = readFileSync("supabase/functions/api-bookings/index.ts", "utf8");

function courtBlock(id: string, startsAt: string, endsAt: string, overrides: Partial<ResourceBlock> = {}): ResourceBlock {
  return {
    id,
    title: "Pickla Tournament",
    reason: "event",
    status: "confirmed",
    starts_at: startsAt,
    ends_at: endsAt,
    blocks_public_booking: true,
    metadata: {
      group_id: "group-1",
      block_ref: "BLK-2026-ER1",
      customer_id: customerId,
      billing_rate_minor: 50_000,
    },
    event_resource_catalog: {
      id: `resource-${id}`,
      name: `Bana ${id}`,
      resource_type: "court",
      venue_court_id: `court-${id}`,
    },
    customer: { id: customerId, display_name: "Exempelbolaget" },
    ...overrides,
  };
}

function groupFor(blocks: ResourceBlock[], overrides: Record<string, unknown> = {}) {
  const active = blocks.filter((block) => block.status === "hold" || block.status === "confirmed");
  return {
    key: "group-1",
    blockRef: "BLK-2026-ER1",
    title: "Pickla Tournament",
    reason: "event",
    status: active[0]?.status || "released",
    starts_at: active[0]?.starts_at || blocks[0].starts_at,
    ends_at: active[0]?.ends_at || blocks[0].ends_at,
    note: "Företagsturnering",
    blocks,
    isVenue: false,
    isAdjusted: false,
    hasConfirmed: active.some((block) => block.status === "confirmed"),
    hasHold: active.some((block) => block.status === "hold"),
    customerId,
    customerName: "Exempelbolaget",
    billingRateMinor: 50_000,
    ...overrides,
  } as any;
}

function renderResourceBlocks() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminResourceBlocks venueId={venueId} />
    </QueryClientProvider>,
  );
}

describe("ER-1 resource-block billing", () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    api.patch.mockReset();
    api.delete.mockReset();
    api.post.mockResolvedValue([]);
    api.get.mockImplementation((fn: string, path: string) => {
      if (fn === "api-admin" && path === "courts") {
        return Promise.resolve([
          { id: "court-1", name: "Bana 1", court_number: 1, sport_type: "pickleball" },
          { id: "court-2", name: "Bana 2", court_number: 2, sport_type: "pickleball" },
        ]);
      }
      if (fn === "api-admin" && path === "resource-blocks") return Promise.resolve([]);
      if (fn === "api-customers" && path === "list") {
        return Promise.resolve([{ id: customerId, customer_id: customerId, display_name: "Exempelbolaget" }]);
      }
      return Promise.reject(new Error(`Unexpected request: ${fn}/${path}`));
    });
  });

  afterEach(cleanup);

  it("keeps existing block creation unchanged when customer and rate are omitted", async () => {
    renderResourceBlocks();
    fireEvent.click(await screen.findByRole("button", { name: "Bana 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Skapa blockering" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const body = api.post.mock.calls[0][2];
    expect(body.venue_court_ids).toEqual(["court-1"]);
    expect(body).not.toHaveProperty("customer_id");
    expect(body).not.toHaveProperty("billing_rate_minor");
  });

  it("sends selected courts, customer id, and an integer minor-unit rate", async () => {
    renderResourceBlocks();
    fireEvent.change(screen.getByPlaceholderText("Sök kund"), { target: { value: "Ex" } });
    fireEvent.click(await screen.findByRole("button", { name: "Exempelbolaget" }));
    fireEvent.change(screen.getByLabelText("Manuellt pris per bantimme (valfritt)"), { target: { value: "594,40" } });
    fireEvent.click(screen.getByRole("button", { name: "Bana 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Bana 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Skapa blockering" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith("api-admin", "resource-blocks", expect.objectContaining({
      venue_court_ids: ["court-1", "court-2"],
      customer_id: customerId,
      billing_rate_minor: 59_440,
    })));
  });

  it("parses prices without using major-unit money as the persisted value", () => {
    expect(parseBillingRateMinor("500")).toBe(50_000);
    expect(parseBillingRateMinor("594,40")).toBe(59_440);
    expect(parseBillingRateMinor("")).toBeNull();
    expect(parseBillingRateMinor("59.444")).toBeUndefined();
  });

  it("calculates two courts times three hours as six court-hours", () => {
    const blocks = [
      courtBlock("1", "2026-07-24T16:00:00Z", "2026-07-24T19:00:00Z"),
      courtBlock("2", "2026-07-24T16:00:00Z", "2026-07-24T19:00:00Z"),
    ];
    const summary = buildResourceBlockBillingSummary(groupFor(blocks));
    expect(summary.courtMinutes).toBe(360);
    expect(summary.totalMinor).toBe(300_000);
    expect(summary.text).toContain("Totalt antal bantimmar: 6");
    expect(summary.text).toContain("Beräknat totalt exkl. moms: 3 000,00 kr");
  });

  it("sums individually adjusted court rows", () => {
    const summary = buildResourceBlockBillingSummary(groupFor([
      courtBlock("1", "2026-07-24T16:00:00Z", "2026-07-24T18:00:00Z"),
      courtBlock("2", "2026-07-24T17:00:00Z", "2026-07-24T18:30:00Z"),
    ]));
    expect(summary.courtMinutes).toBe(210);
    expect(summary.totalMinor).toBe(175_000);
  });

  it("excludes released, cancelled, and non-court rows", () => {
    const active = courtBlock("1", "2026-07-24T16:00:00Z", "2026-07-24T17:00:00Z");
    const released = courtBlock("2", "2026-07-24T16:00:00Z", "2026-07-24T20:00:00Z", { status: "released" });
    const cancelled = courtBlock("3", "2026-07-24T16:00:00Z", "2026-07-24T20:00:00Z", { status: "cancelled" });
    const lounge = courtBlock("4", "2026-07-24T16:00:00Z", "2026-07-24T20:00:00Z", {
      event_resource_catalog: { id: "lounge", name: "Lounge", resource_type: "space", venue_court_id: null },
    });
    const summary = buildResourceBlockBillingSummary(groupFor([active, released, cancelled, lounge]));
    expect(summary.courtCount).toBe(1);
    expect(summary.courtMinutes).toBe(60);
    expect(summary.totalMinor).toBe(50_000);
    expect(summary.text).not.toContain("Bana 2");
    expect(summary.text).not.toContain("Lounge");
  });

  it("never estimates court-hours for a whole-venue block", () => {
    const venueBlock = courtBlock("venue", "2026-07-24T16:00:00Z", "2026-07-24T20:00:00Z", {
      metadata: { scope: "venue", group_id: "group-1", block_ref: "BLK-2026-ER1", billing_rate_minor: 50_000 },
      event_resource_catalog: null,
    });
    const summary = buildResourceBlockBillingSummary(groupFor([venueBlock], { isVenue: true }));
    expect(summary.isWholeVenue).toBe(true);
    expect(summary.courtMinutes).toBeNull();
    expect(summary.totalMinor).toBeNull();
    expect(summary.text).toContain("Bantimmar kan inte beräknas för hela lokalen");
    expect(summary.text).not.toContain("Beräknat totalt exkl. moms");
  });

  it("enforces venue customer validation and preserves group billing metadata on added rows", () => {
    expect(adminApiSource).toContain("async function validateResourceBlockCustomer");
    expect(adminApiSource).toContain("await requireVenueRole(admin, userId, venueId, ['venue_admin'])");
    expect(adminApiSource).toContain("customer.organization_id !== venue.organization_id");
    expect(adminApiSource).toContain("!venueProfile");
    expect(adminApiSource).toContain("Customer is not available for this venue");
    expect(adminApiSource).toContain(".contains('metadata', { group_id: groupId })");
    expect(adminApiSource).toContain(".contains('metadata', { block_ref: blockRef })");
    expect(adminApiSource).toContain("customerId = groupCustomerIds[0] ?? null");
    expect(adminApiSource).toContain("billingRateMinor = groupRates[0] ?? null");
    expect(adminApiSource).toContain("if (!isUuid(customerId)) return errorResponse('Customer is not available for this venue', 400)");
    expect(adminApiSource).toContain("resourceIds.map((resourceId: string) => ({");
    expect(adminApiSource).toContain("metadata: { group_id: groupId, block_ref: blockRef, note, ...billingMetadata }");
  });

  it("does not let generic metadata patches bypass billing validation or change booking logic", () => {
    expect(adminApiSource).toContain("delete metadataPatch.customer_id");
    expect(adminApiSource).toContain("delete metadataPatch.billing_rate_minor");
    const bookingBlockLookup = bookingApiSource.slice(
      bookingApiSource.indexOf("async function getCourtResourceBlocks"),
      bookingApiSource.indexOf("function activityOccurrenceMatchesDate", bookingApiSource.indexOf("async function getCourtResourceBlocks")),
    );
    expect(bookingBlockLookup).not.toContain("customer_id");
    expect(bookingBlockLookup).not.toContain("billing_rate_minor");
    expect(bookingBlockLookup).toContain(".in('status', ['hold', 'confirmed'])");
    expect(bookingBlockLookup).toContain(".eq('blocks_public_booking', true)");
  });
});
