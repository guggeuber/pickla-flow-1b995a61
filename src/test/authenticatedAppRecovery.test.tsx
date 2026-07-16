import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { AuthenticatedBootstrapGate } from "@/components/AuthenticatedAppBootstrap";
import {
  loadAccountBootstrapWith,
  normalizeAccountIdentity,
  type AccountBootstrap,
} from "@/lib/accountBootstrap";
import { isStaleChunkError, showChunkRecovery } from "@/lib/appRecovery";
import { getFirstName } from "@/lib/displayName";

const affectedProductionShape: AccountBootstrap = {
  profile: {
    id: "profile-id",
    display_name: "Parker J Rogers",
    first_name: null,
    last_name: null,
    customer_id: "customer-id",
    phone: null,
  },
  customer: {
    id: "customer-id",
    display_name: "Parker J Rogers",
    first_name: null,
    last_name: null,
    customer_id: null,
    phone: null,
  },
  identityMissing: false,
};

function testQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function GateHarness({
  children = <h1>Authenticated landing</h1>,
  user = {
    id: "affected-user-id",
    email: "player@example.test",
    user_metadata: { display_name: "Parker J Rogers" },
  },
  authLoading = false,
  loadBootstrap = vi.fn().mockResolvedValue(affectedProductionShape),
  bypass = false,
}: {
  children?: ReactNode;
  user?: { id: string; email?: string; user_metadata?: Record<string, unknown> } | null;
  authLoading?: boolean;
  loadBootstrap?: (userId: string) => Promise<AccountBootstrap>;
  bypass?: boolean;
}) {
  return (
    <QueryClientProvider client={testQueryClient()}>
      <AuthenticatedBootstrapGate
        user={user}
        authLoading={authLoading}
        signOut={vi.fn().mockResolvedValue(undefined)}
        loadBootstrap={loadBootstrap}
        bypass={bypass}
      >
        {children}
      </AuthenticatedBootstrapGate>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  document.getElementById("pickla-chunk-recovery")?.remove();
  vi.restoreAllMocks();
});

describe("authenticated application resilience", () => {
  it.each(["sv-SE", "en-US"])("renders the authenticated landing page with %s", async (locale) => {
    Object.defineProperty(navigator, "language", { configurable: true, value: locale });
    render(<GateHarness />);
    expect(await screen.findByRole("heading", { name: "Authenticated landing" })).toBeInTheDocument();
  });

  it("accepts the exact affected null-name/phone shape without crashing", async () => {
    const loadBootstrap = vi.fn().mockResolvedValue(affectedProductionShape);
    render(<GateHarness loadBootstrap={loadBootstrap} />);

    expect(await screen.findByRole("heading", { name: "Authenticated landing" })).toBeInTheDocument();
    expect(loadBootstrap).toHaveBeenCalledWith("affected-user-id");
    expect(getFirstName({ playerProfile: affectedProductionShape.profile })).toBe("Parker");
  });

  it("normalizes malformed optional metadata instead of calling string methods on it", () => {
    expect(normalizeAccountIdentity({
      id: "profile-id",
      display_name: { unexpected: true },
      first_name: 17,
      last_name: ["Rogers"],
      phone: null,
    })).toEqual({
      id: "profile-id",
      display_name: null,
      first_name: null,
      last_name: null,
      customer_id: null,
      phone: null,
    });
    expect(getFirstName({
      authUser: {
        email: "safe-fallback@example.test",
        user_metadata: { display_name: { malformed: true } },
      },
    })).toBe("safe-fallback");
  });

  it("allows a temporarily or permanently missing optional identity row to load safely", async () => {
    const missingIdentity: AccountBootstrap = { profile: null, customer: null, identityMissing: true };
    render(<GateHarness loadBootstrap={vi.fn().mockResolvedValue(missingIdentity)} />);
    expect(await screen.findByRole("heading", { name: "Authenticated landing" })).toBeInTheDocument();
  });

  it("shows guarded recovery actions when the bootstrap request fails", async () => {
    render(<GateHarness loadBootstrap={vi.fn().mockRejectedValue(new Error("profile request failed"))} />);

    expect(await screen.findByRole("heading", {
      name: "Something went wrong while loading your account.",
    })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("keeps the landing page hidden until the auth session and account bootstrap are ready", async () => {
    const loadBootstrap = vi.fn().mockResolvedValue(affectedProductionShape);
    const queryClient = testQueryClient();
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <AuthenticatedBootstrapGate
          user={null}
          authLoading
          signOut={vi.fn().mockResolvedValue(undefined)}
          loadBootstrap={loadBootstrap}
        >
          <h1>Authenticated landing</h1>
        </AuthenticatedBootstrapGate>
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText("Loading account")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Authenticated landing" })).not.toBeInTheDocument();

    rerender(
      <QueryClientProvider client={queryClient}>
        <AuthenticatedBootstrapGate
          user={{ id: "new-user-id", email: "new@example.test" }}
          authLoading={false}
          signOut={vi.fn().mockResolvedValue(undefined)}
          loadBootstrap={loadBootstrap}
        >
          <h1>Authenticated landing</h1>
        </AuthenticatedBootstrapGate>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Authenticated landing" })).toBeInTheDocument();
    expect(loadBootstrap).toHaveBeenCalledWith("new-user-id");
  });

  it("does not interrupt auth callback/reset routes with account bootstrap", async () => {
    const loadBootstrap = vi.fn().mockRejectedValue(new Error("must not run"));
    render(
      <GateHarness loadBootstrap={loadBootstrap} bypass>
        <h1>Auth callback continues</h1>
      </GateHarness>,
    );
    expect(await screen.findByRole("heading", { name: "Auth callback continues" })).toBeInTheDocument();
  });

  it("loads through a missing-profile customer fallback", async () => {
    const client = {
      fetchProfile: vi.fn().mockResolvedValue({ data: null, error: null }),
      fetchCustomerById: vi.fn(),
      fetchCustomerByUserId: vi.fn().mockResolvedValue({
        data: {
          id: "customer-id",
          display_name: "Fallback Customer",
          first_name: null,
          last_name: null,
          primary_phone: null,
        },
        error: null,
      }),
    };

    await expect(loadAccountBootstrapWith(client, "user-id")).resolves.toMatchObject({
      profile: null,
      customer: { id: "customer-id", display_name: "Fallback Customer" },
      identityMissing: false,
    });
    expect(client.fetchCustomerByUserId).toHaveBeenCalledWith("user-id");
  });

  it("renders recovery UI instead of a black screen for a top-level React exception", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    function CrashingRoute(): never {
      throw new Error("render failed");
    }

    render(
      <AppErrorBoundary>
        <CrashingRoute />
      </AppErrorBoundary>,
    );

    expect(await screen.findByRole("heading", {
      name: "Something went wrong while loading your account.",
    })).toBeInTheDocument();
  });

  it("recognizes stale chunk failures and offers visible reload recovery", () => {
    const error = new TypeError("Failed to fetch dynamically imported module: /assets/App-old.js");
    expect(isStaleChunkError(error)).toBe(true);
    showChunkRecovery(error);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });
});
