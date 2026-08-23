import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

import MyPage from "@/pages/MyPage";

const auth = vi.hoisted(() => ({
  user: {
    id: "hotfix-user-id",
    email: "hotfix@example.test",
    user_metadata: { display_name: "Hotfix User" },
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: auth.user,
    loading: false,
    signOut: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/components/PicklaTopBar", () => ({
  PicklaTopBar: () => null,
}));

vi.mock("@/components/ui/drawer", () => ({
  Drawer: ({ open, children }: { open?: boolean; children: ReactNode }) =>
    open ? <section role="dialog">{children}</section> : null,
  DrawerContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
}

function seedMyPageQueries(queryClient: QueryClient, input: {
  bookings?: Record<string, unknown>[];
  registrations?: Record<string, unknown>[];
  courses?: Record<string, unknown>[];
}) {
  const currentYear = new Date().getFullYear();
  queryClient.setQueryData(["player-profile", auth.user.id], {
    id: "profile-id",
    display_name: "Hotfix User",
    first_name: "Hotfix",
    last_name: "User",
    phone: null,
  });
  queryClient.setQueryData(["my-bookings", auth.user.id], input.bookings || []);
  queryClient.setQueryData(["my-session-registrations", auth.user.id], input.registrations || []);
  queryClient.setQueryData(["my-courses", auth.user.id], { items: input.courses || [] });
  queryClient.setQueryData(["my-event-registrations", auth.user.id], []);
  queryClient.setQueryData(["my-membership", auth.user.id], null);
  queryClient.setQueryData(["my-passes", auth.user.id], {
    passes: [],
    allowance: { has_membership: false, passes_allowed: 0, passes_remaining: 0 },
    guest_vouchers: { allowed: 0, issued: 0, remaining: 0, vouchers: [] },
  });
  queryClient.setQueryData(["my-activity-threads", auth.user.id], []);
  queryClient.setQueryData(["wellness-certificate", currentYear], { items: [] });
  queryClient.setQueryData(["wellness-certificate", currentYear + 1], { items: [] });
  queryClient.setQueryData(["my-corporate", auth.user.id], { memberships: [], packages: [] });
  queryClient.setQueryData(["commerce-my-orders"], { orders: [], lines: [] });
  for (const registration of input.registrations || []) {
    queryClient.setQueryData(["commerce-registration-order", registration.id, auth.user.id], {
      available: true,
      state: "free",
      order_id: "commerce-order-id",
      registration_id: registration.id,
      paid: false,
      policy: "before_activity_start",
    });
  }
  queryClient.setQueryData(["payment-methods"], { methods: [] });
  queryClient.setQueryData(["venue-id-for-push", "pickla-arena-sthlm"], "venue-id");
}

function renderMyPage(route: string, input: {
  bookings?: Record<string, unknown>[];
  registrations?: Record<string, unknown>[];
  courses?: Record<string, unknown>[];
}) {
  const queryClient = createQueryClient();
  seedMyPageQueries(queryClient, input);
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <MyPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    },
  });
});

describe("MyPage detail routes", () => {
  it("uses Format identity for an owned social event and keeps House Comp copy", async () => {
    renderMyPage("/my", {
      courses: [{
        commitment: { id: "commitment-parker", status: "active" },
        series: {
          id: "series-parker",
          venue_id: "venue-id",
          name: "Parker",
          format_name: "Parker Brunch",
          start_date: "2026-09-05",
          end_date: "2026-09-05",
          total_sessions: 1,
          presentation_type: "social_event",
        },
        participant: { kind: "customer" },
        next_session: { id: "session-parker", session_date: "2026-09-05", start_time: "13:00:00", end_time: "18:00:00" },
        completed_sessions: 0,
        total_sessions: 1,
        access: { label: "Friplats", detail: "Ingår · Pickla" },
      }],
    });

    expect(await screen.findByText("Parker Brunch")).toBeInTheDocument();
    expect(screen.queryByText("Parker")).not.toBeInTheDocument();
    expect(screen.getByText("Friplats · Ingår · Pickla")).toBeInTheDocument();
  });

  it("keeps the concrete Series run name for an owned Course", async () => {
    renderMyPage("/my", {
      courses: [{
        commitment: { id: "commitment-course", status: "active" },
        series: {
          id: "series-course",
          venue_id: "venue-id",
          name: "Pickla 101 · Höst 2026",
          format_name: "Pickla 101",
          start_date: "2026-09-08",
          end_date: "2026-09-29",
          total_sessions: 4,
          presentation_type: "course",
        },
        participant: { kind: "customer" },
        next_session: { id: "session-course", session_date: "2026-09-08", start_time: "18:00:00", end_time: "19:00:00" },
        completed_sessions: 0,
        total_sessions: 4,
        access: null,
      }],
    });

    expect(await screen.findByText("Pickla 101 · Höst 2026")).toBeInTheDocument();
  });

  it("renders a valid registration detail drawer from /my?registration=<valid-id>", async () => {
    const registrationId = "valid-registration-id";
    const sessionDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    renderMyPage(`/my?registration=${registrationId}`, {
      registrations: [{
        id: registrationId,
        venue_id: "venue-id",
        activity_session_id: "activity-session-id",
        session_date: sessionDate,
        user_id: auth.user.id,
        status: "confirmed",
        price_paid_sek: 0,
        stripe_session_id: null,
        created_at: new Date().toISOString(),
        activity_sessions: {
          id: "activity-session-id",
          name: "Hotfix Open Play",
          session_type: "open_play",
          session_date: sessionDate,
          start_time: "18:00:00",
          end_time: "20:00:00",
          venue_id: "venue-id",
          venues: { name: "Pickla Arena", slug: "pickla-arena-sthlm" },
        },
      }],
    });

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("Hotfix Open Play")).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Gå till chatt" })).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Avboka" })).toBeInTheDocument();
  });

  it("renders a valid booking detail drawer from /my?booking=<valid-ref>", async () => {
    const bookingRef = "VALID-BOOKING-REF";
    const startsAt = new Date(Date.now() + 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);

    renderMyPage(`/my?booking=${bookingRef}`, {
      bookings: [{
        id: "booking-id",
        booking_ref: bookingRef,
        venue_id: "venue-id",
        user_id: auth.user.id,
        status: "confirmed",
        start_time: startsAt.toISOString(),
        end_time: endsAt.toISOString(),
        access_code: "1234",
        notes: "hotfix-booking",
        total_price: 0,
        venue_courts: { name: "Bana Hotfix" },
        is_participant_place: true,
        participant: {
          id: "participant-id",
          user_id: auth.user.id,
          display_name: "Hotfix Player",
          payment_status: "free",
        },
      }],
    });

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("Bana Hotfix")).toBeInTheDocument();
    expect(within(drawer).getByText("Hotfix Player")).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Gå till chatt" })).toBeInTheDocument();
  });
});
