import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { clearCustomerQueryCache } from "@/lib/authQueryCache";

describe("terminal auth cache cleanup", () => {
  it("removes private customer data while retaining public storefront data", async () => {
    const queryClient = new QueryClient();
    const cancelQueries = vi.spyOn(queryClient, "cancelQueries");
    const userId = "customer-user-id";

    queryClient.setQueryData(["player-profile", userId], { name: "Gunnar" });
    queryClient.setQueryData(["my-membership", userId], { tier: "Founder" });
    queryClient.setQueryData(["my-bookings", userId], [{ id: "booking-id" }]);
    queryClient.setQueryData(["booking", "booking-reference"], { id: "booking-id" });
    queryClient.setQueryData(["payment-methods"], [{ last4: "4242" }]);
    queryClient.setQueryData(["authenticated-account-bootstrap", userId], { profile: {} });
    queryClient.setQueryData(["commerce-catalog", "venue-id"], { items: ["public-product"] });
    queryClient.setQueryData(["course-catalog", "pickla-arena-sthlm"], { items: ["public-course"] });
    queryClient.setQueryData(["public-venue", "pickla-arena-sthlm"], { id: "venue-id" });

    await clearCustomerQueryCache(queryClient, userId);

    expect(cancelQueries).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(["player-profile", userId])).toBeUndefined();
    expect(queryClient.getQueryData(["my-membership", userId])).toBeUndefined();
    expect(queryClient.getQueryData(["my-bookings", userId])).toBeUndefined();
    expect(queryClient.getQueryData(["booking", "booking-reference"])).toBeUndefined();
    expect(queryClient.getQueryData(["payment-methods"])).toBeUndefined();
    expect(queryClient.getQueryData(["authenticated-account-bootstrap", userId])).toBeUndefined();
    expect(queryClient.getQueryData(["commerce-catalog", "venue-id"])).toEqual({ items: ["public-product"] });
    expect(queryClient.getQueryData(["course-catalog", "pickla-arena-sthlm"])).toEqual({ items: ["public-course"] });
    expect(queryClient.getQueryData(["public-venue", "pickla-arena-sthlm"])).toEqual({ id: "venue-id" });
  });
});
