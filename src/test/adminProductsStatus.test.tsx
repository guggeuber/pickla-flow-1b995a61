import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import AdminProducts from "@/components/admin/AdminProducts";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiGet: api.get,
  apiPatch: api.patch,
  apiPost: api.post,
  apiDelete: api.remove,
}));

vi.mock("@/components/ui/drawer", () => ({
  Drawer: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null,
  DrawerContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DrawerTitle: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h2 {...props}>{children}</h2>,
  DrawerDescription: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => <p {...props}>{children}</p>,
}));

const venueId = "7ff6e5dc-f27a-473b-af4e-2b358340ab81";
const archivedBag = {
  id: "product-bag",
  product_key: "pink_pickla_bag",
  name: "Pink Pickla Bag",
  description: "Pickla bag",
  product_kind: "merchandise",
  session_type: null,
  base_price_sek: 200,
  vat_rate: 25,
  is_active: false,
  sort_order: 10,
  commerce_kind: "merchandise",
  fulfillment_type: "desk_pickup",
  commerce_enabled: false,
  status: "archived",
  standalone_enabled: true,
  activity_addon_enabled: false,
  fulfillment_presentation: "desk_pickup",
  category: "Merch",
  sport: null,
  image_url: null,
  venue_commerce_enabled: true,
  store_eligible: false,
  activity_addon_eligible: false,
  sales_state_label: "Arkiverad",
  sales_block_reason: null,
  store_path: null,
} as const;

describe("Admin Products status", () => {
  let serverProducts: Array<Record<string, unknown>>;

  beforeEach(() => {
    serverProducts = [{ ...archivedBag }];
    api.get.mockReset();
    api.patch.mockReset();
    api.post.mockReset();
    api.remove.mockReset();
    api.get.mockImplementation((_fn: string, endpoint: string) => Promise.resolve(
      endpoint === "products" ? serverProducts.map((product) => ({ ...product })) : [],
    ));
    api.patch.mockImplementation((_fn: string, _endpoint: string, payload: Record<string, unknown>) => {
      const saved = {
        ...serverProducts[0],
        ...payload,
        status: payload.status,
        is_active: payload.status === "active",
        commerce_enabled: payload.status === "active" && payload.standalone_enabled === true,
        sales_state_label: payload.status === "active" ? "Aktiv - säljs i butik" : "Arkiverad",
        store_eligible: payload.status === "active" && payload.standalone_enabled === true,
        store_path: payload.status === "active" && payload.standalone_enabled === true ? "/shop?v=pickla-arena-sthlm" : null,
      };
      serverProducts = [saved];
      return Promise.resolve({ ...saved });
    });
  });

  afterEach(cleanup);

  it("keeps an operator status edit through a catalog refetch and persists it", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AdminProducts venueId={venueId} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Pink Pickla Bag/ }));
    const statusSelect = await screen.findByLabelText("Produktstatus");
    fireEvent.change(statusSelect, { target: { value: "active" } });
    expect(statusSelect).toHaveValue("active");

    queryClient.setQueryData(["admin-access-products", venueId], [{ ...archivedBag }]);
    await waitFor(() => expect(statusSelect).toHaveValue("active"));

    fireEvent.click(screen.getByRole("button", { name: "Spara" }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(
      "api-admin",
      "products",
      expect.objectContaining({ productId: archivedBag.id, status: "active" }),
    ));
    await waitFor(() => expect(statusSelect).toHaveValue("active"));
    expect(queryClient.getQueryData<Array<Record<string, unknown>>>(["admin-access-products", venueId])?.[0]).toMatchObject({
      status: "active",
      is_active: true,
    });
  });
});
