import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import CommerceShopPage from "@/pages/CommerceShopPage";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}));
const cart = vi.hoisted(() => ({ queue: vi.fn() }));

vi.mock("@/lib/api", () => ({
  apiGet: api.get,
  apiPost: api.post,
  apiPut: api.put,
}));

vi.mock("@/hooks/useStandaloneShopCart", () => ({
  useStandaloneShopCart: () => ({
    quantities: {}, lineCount: 0, resolvedTotalMinor: 0, reference: "cart-token-cart-token-cart-token-12",
    isLoading: false, isError: false, isUpdating: false, queueQuantities: cart.queue,
  }),
}));

const venueId = "7ff6e5dc-f27a-473b-af4e-2b358340ab81";

describe("CommerceShopPage", () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    api.put.mockReset();
    cart.queue.mockReset();
    cart.queue.mockResolvedValue(undefined);
    api.post.mockResolvedValue({ cart_token: "cart-token" });
    api.get.mockImplementation((_fn: string, endpoint: string, params: Record<string, string>) => {
      if (endpoint === "public-venue") {
        return Promise.resolve({ venue: { id: venueId, slug: "pickla-arena-sthlm" } });
      }
      if (endpoint === "catalog") {
        return Promise.resolve({
          commerce_available: true,
          message: null,
          relationships: [],
          products: [{
            id: "product-bag",
            venue_id: venueId,
            product_key: "pink_pickla_bag",
            name: "Pink Pickla Bag",
            description: "Hämtas vid disken.",
            commerce_kind: "merchandise",
            fulfillment_type: "desk_pickup",
            fulfillment_presentation: "desk_pickup",
            base_price_sek: 200,
            vat_rate: 25,
            sort_order: 210,
            status: "active",
            standalone_enabled: true,
            activity_addon_enabled: false,
            category: null,
            sport: null,
            image_url: null,
            store_eligible: true,
          }],
        });
      }
      return Promise.reject(new Error(`Unexpected endpoint: ${endpoint}`));
    });
  });

  afterEach(cleanup);

  it("loads the catalog with the nested public venue id", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/shop?v=pickla-arena-sthlm"]}>
          <CommerceShopPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Pink Pickla Bag" })).toBeInTheDocument();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("api-commerce", "catalog", { venueId }));

    fireEvent.click(screen.getByRole("button", { name: "Öka Pink Pickla Bag" }));
    await waitFor(() => expect(cart.queue).toHaveBeenCalledWith({ "product-bag": 1 }));
  });
});
