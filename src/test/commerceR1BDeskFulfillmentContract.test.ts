import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const commerceApi = readFileSync("supabase/functions/api-commerce/index.ts", "utf8");
const deskToday = readFileSync("src/components/desk/shell/DeskToday.tsx", "utf8");
const apiE2e = readFileSync("supabase/tests/commerce_r1_api_e2e.mjs", "utf8");

function sourceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

type OrderFixture = { id: string; venue_id: string; status: string };
type LineFixture = {
  id: string;
  commerce_order_id: string;
  fulfillment_type: string;
  fulfillment_status: string;
};

function oldCanonicalLineIds(
  orders: OrderFixture[],
  lines: LineFixture[],
  venueId: string,
  fulfillmentStatus: string,
) {
  const eligibleOrderIds = new Set(orders
    .filter((order) => order.venue_id === venueId && ["paid", "attention"].includes(order.status))
    .map((order) => order.id));
  return lines
    .filter((line) => eligibleOrderIds.has(line.commerce_order_id))
    .filter((line) => line.fulfillment_type === "desk_pickup" && line.fulfillment_status === fulfillmentStatus)
    .map((line) => line.id)
    .sort();
}

function joinedCanonicalLineIds(
  orders: OrderFixture[],
  lines: LineFixture[],
  venueId: string,
  fulfillmentStatus: string,
) {
  const orderById = new Map(orders.map((order) => [order.id, order]));
  return lines
    .filter((line) => {
      const order = orderById.get(line.commerce_order_id);
      return order?.venue_id === venueId && ["paid", "attention"].includes(order.status);
    })
    .filter((line) => line.fulfillment_type === "desk_pickup" && line.fulfillment_status === fulfillmentStatus)
    .map((line) => line.id)
    .sort();
}

function fulfillmentRequestLengths(orderCount: number) {
  const host = "https://ptnvhbniiiapzbyofctg.supabase.co";
  const table = `${host}/rest/v1/commerce_order_lines`;
  const orderIds = Array.from({ length: orderCount }, (_, index) =>
    `c2b10000-0000-4000-8000-${String(index).padStart(12, "0")}`);
  const oldParams = new URLSearchParams({
    select: "id,commerce_order_id,product_name,quantity,fulfillment_status,fulfilled_at,activity_session_id",
    commerce_order_id: `in.(${orderIds.join(",")})`,
    fulfillment_type: "eq.desk_pickup",
    order: "created_at.asc",
    fulfillment_status: "eq.pending_pickup",
  });
  const joinedParams = new URLSearchParams({
    select: "id,commerce_order_id,product_name,quantity,fulfillment_status,fulfilled_at,activity_session_id,commerce_orders!inner(id,customer_id,guest_name,status,booking_receipts!commerce_orders_booking_receipt_id_fkey(receipt_number))",
    "commerce_orders.venue_id": "eq.c2b00000-0000-4000-8000-000000000001",
    "commerce_orders.status": "in.(paid,attention)",
    fulfillment_type: "eq.desk_pickup",
    order: "created_at.asc",
    fulfillment_status: "eq.pending_pickup",
  });
  return {
    old: orderCount === 0 ? 0 : `${table}?${oldParams}`.length,
    joined: `${table}?${joinedParams}`.length,
  };
}

describe("Commerce R1B Desk fulfillment contract", () => {
  it("uses explicit database projections and one strict response serializer", () => {
    const loader = sourceBetween(commerceApi, "async function loadDeskFulfillmentItems", "const commerceHandler");
    const serializer = sourceBetween(commerceApi, "function serializeDeskFulfillmentItem", "async function loadDeskFulfillmentItems");

    expect(loader).not.toContain("select('*')");
    expect(loader).toContain("commerce_orders!inner(id, customer_id, guest_name, status, booking_receipts!commerce_orders_booking_receipt_id_fkey(receipt_number))");
    expect(loader).toContain("select('id, commerce_order_id, product_name, quantity, fulfillment_status, fulfilled_at, activity_session_id,");
    expect(loader).toContain("select('id, display_name, first_name, last_name')");
    expect(loader).toContain("select('id, name')");

    for (const field of [
      "line_id", "order_reference", "customer_name", "activity_title", "product_name",
      "quantity", "order_status", "fulfillment_status", "fulfilled_at",
      "pickup_instruction", "pickup_eligible",
    ]) {
      expect(serializer).toContain(`${field}:`);
    }
    expect(serializer).not.toMatch(/paid_at|booking_receipt_id|stripe|payment|resolver_snapshot|metadata|beneficiary|storage_path/);
  });

  it("keeps Desk reads set-based, venue-scoped and independent of historical order count", () => {
    const loader = sourceBetween(commerceApi, "async function loadDeskFulfillmentItems", "const commerceHandler");

    expect(loader).toContain(".from('commerce_order_lines')");
    expect(loader).toContain("commerce_orders!inner(");
    expect(loader).toContain(".eq('commerce_orders.venue_id', venueId)");
    expect(loader).toContain(".in('commerce_orders.status', ['paid', 'attention'])");
    expect(loader).toContain(".eq('fulfillment_type', 'desk_pickup')");
    expect(loader).not.toContain(".from('commerce_orders')");
    expect(loader).not.toContain(".in('commerce_order_id'");
    expect(loader).not.toContain("orderIds");
  });

  it("preserves paid/attention queue parity and excludes other statuses and venues", () => {
    const orders: OrderFixture[] = [
      { id: "paid", venue_id: "venue-a", status: "paid" },
      { id: "attention", venue_id: "venue-a", status: "attention" },
      { id: "draft", venue_id: "venue-a", status: "draft" },
      { id: "checkout", venue_id: "venue-a", status: "checkout_pending" },
      { id: "cancelled", venue_id: "venue-a", status: "cancelled" },
      { id: "refunded", venue_id: "venue-a", status: "refunded" },
      { id: "expired", venue_id: "venue-a", status: "expired" },
      { id: "other", venue_id: "venue-b", status: "paid" },
    ];
    const lines: LineFixture[] = [
      { id: "pending-paid", commerce_order_id: "paid", fulfillment_type: "desk_pickup", fulfillment_status: "pending_pickup" },
      { id: "pending-attention", commerce_order_id: "attention", fulfillment_type: "desk_pickup", fulfillment_status: "pending_pickup" },
      { id: "collected-paid", commerce_order_id: "paid", fulfillment_type: "desk_pickup", fulfillment_status: "collected" },
      { id: "draft-line", commerce_order_id: "draft", fulfillment_type: "desk_pickup", fulfillment_status: "pending_pickup" },
      { id: "checkout-line", commerce_order_id: "checkout", fulfillment_type: "desk_pickup", fulfillment_status: "pending_pickup" },
      { id: "cancelled-line", commerce_order_id: "cancelled", fulfillment_type: "desk_pickup", fulfillment_status: "pending_pickup" },
      { id: "refunded-line", commerce_order_id: "refunded", fulfillment_type: "desk_pickup", fulfillment_status: "pending_pickup" },
      { id: "expired-line", commerce_order_id: "expired", fulfillment_type: "desk_pickup", fulfillment_status: "pending_pickup" },
      { id: "other-line", commerce_order_id: "other", fulfillment_type: "desk_pickup", fulfillment_status: "pending_pickup" },
      { id: "participation", commerce_order_id: "paid", fulfillment_type: "participation", fulfillment_status: "pending_pickup" },
    ];

    for (const status of ["pending_pickup", "collected"]) {
      expect(joinedCanonicalLineIds(orders, lines, "venue-a", status))
        .toEqual(oldCanonicalLineIds(orders, lines, "venue-a", status));
    }
    expect(joinedCanonicalLineIds(orders, lines, "venue-a", "pending_pickup"))
      .toEqual(["pending-attention", "pending-paid"]);
    expect(joinedCanonicalLineIds(orders, lines, "venue-a", "collected"))
      .toEqual(["collected-paid"]);
  });

  it("keeps the joined request bounded at 0/1/10/50/100/600 historical orders", () => {
    const counts = [0, 1, 10, 50, 100, 600];
    const sizes = counts.map(fulfillmentRequestLengths);

    expect(new Set(sizes.map((size) => size.joined)).size).toBe(1);
    expect(sizes.every((size) => size.joined < 1_000)).toBe(true);
    expect(sizes.at(-1)?.old).toBeGreaterThan(20_000);
    expect(sizes[1].old).toBeLessThan(sizes.at(-1)?.old || 0);
  });

  it("makes both GET and PATCH return the canonical serialized contract", () => {
    const route = sourceBetween(commerceApi, "if (req.method === 'GET' && path === 'fulfillment')", "return errorResponse('Not found', 404)");
    expect(route).not.toContain("select('*')");
    expect(route).not.toContain("...line");
    expect(route).not.toContain("item: data");
    expect(route.match(/loadDeskFulfillmentItems/g)).toHaveLength(2);
  });

  it("maps only outbound transport failures to 503 and retains the validation 400 fallback", () => {
    const catchBlock = sourceBetween(commerceApi, "} catch (error) {", "const localFunctionPort");
    expect(commerceApi).toContain("isUpstreamTransportError");
    expect(catchBlock).toContain("if (isUpstreamTransportError(error)) return errorResponse('Commerce service temporarily unavailable', 503)");
    expect(catchBlock).toContain("return errorResponse(message, 400)");
    expect(catchBlock.indexOf("isUpstreamTransportError(error)")).toBeLessThan(catchBlock.lastIndexOf("return errorResponse(message, 400)"));
  });

  it("keeps the frontend on the allowlisted response type and the E2E privacy scan recursive", () => {
    expect(deskToday).toContain("DeskFulfillmentResponse");
    expect(deskToday).toContain("line.line_id");
    expect(deskToday).toContain("line.order_reference");
    expect(deskToday).not.toContain("line.commerce_order_id");
    expect(deskToday).not.toContain("line.order?.");

    expect(apiE2e).toContain("function assertDeskPayloadPrivate");
    expect(apiE2e).toContain("assertDeskPayloadPrivate(child");
    expect(apiE2e).toContain("assertDeskPayloadPrivate(pendingDeskPayload)");
    expect(apiE2e).toContain("assertDeskPayloadPrivate(collectedResponse)");
    expect(apiE2e).toContain("assertDeskPayloadPrivate(collectedDeskPayload)");
  });
});
