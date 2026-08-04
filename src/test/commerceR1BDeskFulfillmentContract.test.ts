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

describe("Commerce R1B Desk fulfillment contract", () => {
  it("uses explicit database projections and one strict response serializer", () => {
    const loader = sourceBetween(commerceApi, "async function loadDeskFulfillmentItems", "const commerceHandler");
    const serializer = sourceBetween(commerceApi, "function serializeDeskFulfillmentItem", "async function loadDeskFulfillmentItems");

    expect(loader).not.toContain("select('*')");
    expect(loader).toContain("select('id, customer_id, guest_name, status, booking_receipts!commerce_orders_booking_receipt_id_fkey(receipt_number)')");
    expect(loader).toContain("select('id, commerce_order_id, product_name, quantity, fulfillment_status, fulfilled_at, activity_session_id')");
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

  it("makes both GET and PATCH return the canonical serialized contract", () => {
    const route = sourceBetween(commerceApi, "if (req.method === 'GET' && path === 'fulfillment')", "return errorResponse('Not found', 404)");
    expect(route).not.toContain("select('*')");
    expect(route).not.toContain("...line");
    expect(route).not.toContain("item: data");
    expect(route.match(/loadDeskFulfillmentItems/g)).toHaveLength(2);
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
