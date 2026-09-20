import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  createFrontendVersionCoordinator,
  FRONTEND_VERSION_CHECK_INTERVAL_MS,
  type FrontendVersionCoordinatorDependencies,
  type FrontendVersionTrigger,
} from "@/lib/frontendVersionCoordinator";
import { recoverLegacyClients, type LegacyRecoveryClient } from "@/lib/legacyClientRecovery";
import { FrontendReleaseLookupError } from "@/lib/frontendRelease";
import { classifyFrontendReload } from "@/lib/frontendVersionPolicy";

const buildA = { sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", built_at: "2026-07-02T23:59:00.000Z" };
const buildB = { sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", built_at: "2026-09-13T10:06:00.000Z" };
const buildC = { sha: "cccccccccccccccccccccccccccccccccccccccc", built_at: "2026-09-20T10:06:00.000Z" };

function coordinatorHarness(input?: {
  pathname?: string;
  online?: boolean;
  serverBuild?: typeof buildA;
  controller?: { postMessage: ReturnType<typeof vi.fn> } | null;
  fetchError?: Error;
  reloadMarker?: string | null;
}) {
  let pathname = input?.pathname ?? "/today";
  let online = input?.online ?? true;
  let now = 100_000;
  let marker: string | null = input?.reloadMarker ?? null;
  const reload = vi.fn();
  const report = vi.fn();
  const update = vi.fn(async () => undefined);
  const controller = input && "controller" in input ? input.controller : null;
  const fetchCurrentBuild = vi.fn(async () => {
    if (input?.fetchError) throw input.fetchError;
    return input?.serverBuild ?? buildB;
  });
  const deps: FrontendVersionCoordinatorDependencies = {
    runningBuild: buildA,
    fetchCurrentBuild,
    getPathname: () => pathname,
    isOnline: () => online,
    getController: () => controller ?? null,
    reload,
    getReloadMarker: () => marker,
    setReloadMarker: (sha) => { marker = sha; },
    now: () => now,
    getPwaSurface: () => pathname.startsWith("/desk")
      ? "desk"
      : pathname.startsWith("/hub/admin") ? "admin" : "customer",
    report,
  };
  const coordinator = createFrontendVersionCoordinator(deps);
  coordinator.setRegistration({ update });
  return {
    coordinator,
    reload,
    report,
    update,
    fetchCurrentBuild,
    setPathname: (next: string) => { pathname = next; },
    setOnline: (next: boolean) => { online = next; },
    advance: (milliseconds: number) => { now += milliseconds; },
    marker: () => marker,
  };
}

describe("frontend version convergence", () => {
  it("does not reload a client already on the current immutable build", async () => {
    const harness = coordinatorHarness({ serverBuild: buildA });
    await harness.coordinator.check("bootstrap", true);
    expect(harness.reload).not.toHaveBeenCalled();
    expect(harness.report).toHaveBeenCalledWith("version_checked", expect.objectContaining({
      running_sha: buildA.sha,
      current_sha: buildA.sha,
    }));
  });

  it("reloads a stale safe document at most once per current build", async () => {
    const harness = coordinatorHarness();
    await harness.coordinator.check("bootstrap", true);
    expect(harness.reload).toHaveBeenCalledTimes(1);
    expect(harness.marker()).toBe(buildB.sha);

    harness.advance(60_000);
    await harness.coordinator.check("pageshow", true);
    expect(harness.reload).toHaveBeenCalledTimes(1);
    expect(harness.report).toHaveBeenCalledWith("convergence_failure", expect.objectContaining({
      stage: "reload_already_attempted",
    }));
  });

  it.each<FrontendVersionTrigger>(["pageshow", "visibility", "online", "periodic", "route"])(
    "converges a modern long-lived safe client on %s",
    async (trigger) => {
      const harness = coordinatorHarness();
      await harness.coordinator.check(trigger, true);
      expect(harness.reload).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["/today", "/desk", "/hub/admin"])(
    "converges build A to build B through the shared coordinator on %s",
    async (pathname) => {
      const harness = coordinatorHarness({ pathname });
      await harness.coordinator.check("bootstrap", true);
      expect(harness.reload).toHaveBeenCalledTimes(1);
      expect(harness.marker()).toBe(buildB.sha);
    },
  );

  it("waits for the current worker build before reloading a controlled document", async () => {
    const worker = { postMessage: vi.fn() };
    const harness = coordinatorHarness({ controller: worker });
    await harness.coordinator.check("bootstrap", true);
    expect(harness.update).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "PICKLA_GET_BUILD" });
    expect(harness.reload).not.toHaveBeenCalled();

    harness.coordinator.handleWorkerMessage({ type: "PICKLA_SW_BUILD", build: buildB });
    expect(harness.reload).toHaveBeenCalledTimes(1);
  });

  it("acknowledges a new worker but requires the authoritative endpoint before convergence", async () => {
    const harness = coordinatorHarness();
    const reply = vi.fn();
    harness.coordinator.handleWorkerMessage({ type: "PICKLA_VERSION_ACTIVATED", build: buildB }, reply);
    expect(reply).toHaveBeenCalledWith({ type: "PICKLA_VERSION_CLIENT_ACK", running_build: buildA });
    expect(harness.reload).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(harness.fetchCurrentBuild).toHaveBeenCalled());
    await vi.waitFor(() => expect(harness.reload).toHaveBeenCalledTimes(1));
  });

  it("never treats an older controller announcement as authoritative current truth", async () => {
    const historicalWorker = {
      sha: "dddddddddddddddddddddddddddddddddddddddd",
      built_at: "2026-06-01T10:00:00.000Z",
    };
    const harness = coordinatorHarness({ serverBuild: buildA });
    harness.coordinator.handleWorkerMessage({ type: "PICKLA_SW_BUILD", build: historicalWorker });
    expect(harness.reload).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(harness.fetchCurrentBuild).toHaveBeenCalled());
    expect(harness.report).not.toHaveBeenCalledWith("stale_detected", expect.objectContaining({
      current_sha: buildA.sha,
    }));
  });

  it("rejects an older endpoint identity without reloading the current client", async () => {
    const harness = coordinatorHarness({ serverBuild: buildA });
    const currentHarness = createFrontendVersionCoordinator({
      runningBuild: buildB,
      fetchCurrentBuild: harness.fetchCurrentBuild,
      getPathname: () => "/today",
      isOnline: () => true,
      getController: () => null,
      reload: harness.reload,
      getReloadMarker: () => null,
      setReloadMarker: vi.fn(),
      now: () => 100_000,
      getPwaSurface: () => "customer",
      report: harness.report,
    });
    await currentHarness.check("bootstrap", true);
    expect(harness.reload).not.toHaveBeenCalled();
    expect(harness.report).toHaveBeenCalledWith("backward_version_rejected", expect.objectContaining({
      running_sha: buildB.sha,
      authoritative_sha: buildA.sha,
      reload_count: 0,
    }));
  });

  it("converges A and B to C while C rejects stale A and B responses", async () => {
    for (const runningBuild of [buildA, buildB]) {
      const reload = vi.fn();
      const coordinator = createFrontendVersionCoordinator({
        runningBuild,
        fetchCurrentBuild: async () => buildC,
        getPathname: () => "/today",
        isOnline: () => true,
        getController: () => null,
        reload,
        getReloadMarker: () => null,
        setReloadMarker: vi.fn(),
        now: () => 100_000,
        getPwaSurface: () => "customer",
        report: vi.fn(),
      });
      await coordinator.check("bootstrap", true);
      expect(reload).toHaveBeenCalledTimes(1);
    }

    for (const staleBuild of [buildA, buildB]) {
      const reload = vi.fn();
      const coordinator = createFrontendVersionCoordinator({
        runningBuild: buildC,
        fetchCurrentBuild: async () => staleBuild,
        getPathname: () => "/today",
        isOnline: () => true,
        getController: () => null,
        reload,
        getReloadMarker: () => null,
        setReloadMarker: vi.fn(),
        now: () => 100_000,
        getPwaSurface: () => "customer",
        report: vi.fn(),
      });
      await coordinator.check("pageshow", true);
      expect(reload).not.toHaveBeenCalled();
    }
  });

  it("represents the production regression: current a8b7ce9 rejects historical d047229", async () => {
    const current = { sha: "a8b7ce92c969970c680f22705f601bf82e61abe2", built_at: "2026-09-18T22:51:05.654Z" };
    const historical = { sha: "d0472290c67cc79b4add324da4699c62aab19a77", built_at: "2026-09-18T13:46:42.000Z" };
    const reload = vi.fn();
    const report = vi.fn();
    const coordinator = createFrontendVersionCoordinator({
      runningBuild: current,
      fetchCurrentBuild: async () => historical,
      getPathname: () => "/",
      isOnline: () => true,
      getController: () => null,
      reload,
      getReloadMarker: () => null,
      setReloadMarker: vi.fn(),
      now: () => 100_000,
      getPwaSurface: () => "customer",
      report,
    });
    await coordinator.check("bootstrap", true);
    expect(reload).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith("backward_version_rejected", expect.objectContaining({
      authoritative_sha: historical.sha,
    }));
  });

  it("defers checkout and auth surfaces, then converges after navigation to a safe view", async () => {
    for (const unsafePath of ["/cart", "/auth/callback", "/booking/confirmed", "/membership/confirmed"]) {
      const harness = coordinatorHarness({ pathname: unsafePath });
      await harness.coordinator.check("bootstrap", true);
      expect(harness.reload).not.toHaveBeenCalled();
      expect(harness.report).toHaveBeenCalledWith("reload_deferred", expect.objectContaining({ pathname: unsafePath }));

      harness.setPathname("/today");
      harness.coordinator.routeChanged();
      expect(harness.reload).toHaveBeenCalledTimes(1);
    }
  });

  it("defers an explicit in-flight Stripe handoff even on an otherwise safe activity page", async () => {
    const harness = coordinatorHarness({ pathname: "/p/open-play-session" });
    const release = harness.coordinator.beginCriticalSection("stripe_checkout_handoff");
    await harness.coordinator.check("bootstrap", true);
    expect(harness.reload).not.toHaveBeenCalled();
    release();
    expect(harness.reload).toHaveBeenCalledTimes(1);
  });

  it.each(["/desk", "/hub/admin/schedule"])(
    "defers an unsaved operational form on %s and converges after release",
    async (pathname) => {
      const harness = coordinatorHarness({ pathname });
      const release = harness.coordinator.beginCriticalSection("unsaved_form");
      await harness.coordinator.check("bootstrap", true);
      expect(harness.reload).not.toHaveBeenCalled();
      release();
      expect(harness.reload).toHaveBeenCalledTimes(1);
    },
  );

  it("does not fabricate current state or reload while offline, and retries when online", async () => {
    const harness = coordinatorHarness({ online: false });
    await harness.coordinator.check("bootstrap", true);
    expect(harness.fetchCurrentBuild).not.toHaveBeenCalled();
    expect(harness.reload).not.toHaveBeenCalled();

    harness.setOnline(true);
    await harness.coordinator.check("online", true);
    expect(harness.fetchCurrentBuild).toHaveBeenCalledTimes(1);
    expect(harness.reload).toHaveBeenCalledTimes(1);
  });

  it("never reloads when the authoritative endpoint fails", async () => {
    const harness = coordinatorHarness({ fetchError: new Error("offline") });
    await harness.coordinator.check("bootstrap", true);
    expect(harness.reload).not.toHaveBeenCalled();
    expect(harness.report).toHaveBeenCalledWith("version_check_failure", expect.objectContaining({
      stage: "version_check",
      reload_count: 0,
    }));
  });

  it.each([
    ["timeout", new FrontendReleaseLookupError("timeout", "timed out")],
    ["500", new FrontendReleaseLookupError("http_5xx", "500", 500)],
    ["malformed JSON", new FrontendReleaseLookupError("malformed_json", "bad JSON")],
    ["missing SHA", new FrontendReleaseLookupError("missing_sha", "missing SHA")],
  ])("fails safely without a reload on endpoint %s", async (_label, fetchError) => {
    const harness = coordinatorHarness({ fetchError });
    await harness.coordinator.check("bootstrap", true);
    expect(harness.reload).not.toHaveBeenCalled();
    expect(harness.report).toHaveBeenCalledWith("version_check_failure", expect.objectContaining({
      failure_kind: fetchError.failureKind,
      reload_count: 0,
    }));
  });

  it("reports successful convergence after the reloaded build proves itself current", async () => {
    const harness = coordinatorHarness({ serverBuild: buildA, reloadMarker: buildA.sha });
    await harness.coordinator.check("bootstrap", true);
    expect(harness.report).toHaveBeenCalledWith("convergence_success", expect.objectContaining({
      running_sha: buildA.sha,
      authoritative_sha: buildA.sha,
      pwa_surface: "customer",
      reload_count: 1,
    }));
  });

  it("repeated stale responses never create a reload loop", async () => {
    const reload = vi.fn();
    const report = vi.fn();
    let now = 100_000;
    const coordinator = createFrontendVersionCoordinator({
      runningBuild: buildB,
      fetchCurrentBuild: async () => buildA,
      getPathname: () => "/today",
      isOnline: () => true,
      getController: () => null,
      reload,
      getReloadMarker: () => null,
      setReloadMarker: vi.fn(),
      now: () => now,
      getPwaSurface: () => "customer",
      report,
    });
    await coordinator.check("bootstrap", true);
    now += 60_000;
    await coordinator.check("pageshow", true);
    expect(reload).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalledWith("convergence_executed", expect.anything());
  });

  it("does not classify a same-build controllerchange transport failure as convergence failure", async () => {
    const harness = coordinatorHarness({ serverBuild: buildA });
    await harness.coordinator.check("bootstrap", true);
    harness.fetchCurrentBuild.mockRejectedValueOnce(new TypeError("Load failed"));
    harness.advance(30_000);

    await harness.coordinator.check("controllerchange", true);

    expect(harness.report).toHaveBeenCalledWith("version_check_failure", expect.objectContaining({
      running_sha: buildA.sha,
      current_sha: buildA.sha,
      stage: "version_check",
      trigger: "controllerchange",
    }));
    expect(harness.report).not.toHaveBeenCalledWith("convergence_failure", expect.objectContaining({
      stage: "version_check",
    }));
  });

  it("uses a bounded hourly periodic interval", () => {
    expect(FRONTEND_VERSION_CHECK_INTERVAL_MS).toBe(3_600_000);
  });

  it("rate-limits registration.update across noisy lifecycle events", async () => {
    const worker = { postMessage: vi.fn() };
    const harness = coordinatorHarness({ controller: worker, serverBuild: buildA });
    await harness.coordinator.check("bootstrap", true);
    await harness.coordinator.check("pageshow", true);
    await harness.coordinator.check("visibility", true);
    expect(harness.update).toHaveBeenCalledTimes(1);

    harness.advance(30_000);
    await harness.coordinator.check("online", true);
    expect(harness.update).toHaveBeenCalledTimes(2);
  });
});

describe("legacy client recovery", () => {
  function legacyClient(url: string) {
    return {
      id: "legacy-client",
      url,
      postMessage: vi.fn(),
      navigate: vi.fn(async () => null),
    } satisfies LegacyRecoveryClient;
  }

  it("replaces the actual pre-July resident pricing client without requiring old-JS cooperation", async () => {
    const client = legacyClient("https://playpickla.com/p/open-play?date=2026-09-13");
    let executingBuild = buildA;
    let displayedOpenPlayPriceSek = 165;
    client.navigate.mockImplementation(async () => {
      executingBuild = buildB;
      displayedOpenPlayPriceSek = 99;
      return null;
    });
    await recoverLegacyClients({
      build: buildB,
      acknowledgedClientIds: new Set(),
      listClients: async () => [client],
      waitForAcknowledgements: async () => undefined,
      origin: "https://playpickla.com",
    });
    expect(client.postMessage).toHaveBeenCalledWith({ type: "PICKLA_VERSION_ACTIVATED", build: buildB });
    expect(client.navigate).toHaveBeenCalledOnce();
    expect(client.navigate).toHaveBeenCalledWith(client.url);
    expect(executingBuild.sha).toBe(buildB.sha);
    expect(displayedOpenPlayPriceSek).toBe(99);
  });

  it("does not navigate a modern client that acknowledges the contract", async () => {
    const client = legacyClient("https://playpickla.com/today");
    const acknowledged = new Set<string>();
    await recoverLegacyClients({
      build: buildB,
      acknowledgedClientIds: acknowledged,
      listClients: async () => [client],
      waitForAcknowledgements: async () => { acknowledged.add(client.id); },
      origin: "https://playpickla.com",
    });
    expect(client.navigate).not.toHaveBeenCalled();
  });

  it.each(["/", "/desk", "/hub/admin"])(
    "recovers an old %s surface without requiring old-JS cooperation",
    async (pathname) => {
      const client = legacyClient(`https://playpickla.com${pathname}`);
      await recoverLegacyClients({
        build: buildB,
        acknowledgedClientIds: new Set(),
        listClients: async () => [client],
        waitForAcknowledgements: async () => undefined,
        origin: "https://playpickla.com",
      });
      expect(client.postMessage).toHaveBeenCalledWith({ type: "PICKLA_VERSION_ACTIVATED", build: buildB });
      expect(client.navigate).toHaveBeenCalledWith(client.url);
    },
  );

  it("never blindly navigates a legacy client on a protected transaction URL", async () => {
    for (const pathname of ["/cart", "/auth/callback", "/commerce/confirmed", "/booking/confirmed"]) {
      const client = legacyClient(`https://playpickla.com${pathname}`);
      await recoverLegacyClients({
        build: buildB,
        acknowledgedClientIds: new Set(),
        listClients: async () => [client],
        waitForAcknowledgements: async () => undefined,
        origin: "https://playpickla.com",
      });
      expect(client.navigate).not.toHaveBeenCalled();
    }
  });
});

describe("version policy and production contract", () => {
  it("classifies Today/activity as safe and transaction/finalization routes as unsafe", () => {
    expect(classifyFrontendReload("/today").safe).toBe(true);
    expect(classifyFrontendReload("/p/open-play").safe).toBe(true);
    expect(classifyFrontendReload("/cart").safe).toBe(false);
    expect(classifyFrontendReload("/auth/callback").safe).toBe(false);
    expect(classifyFrontendReload("/booking/confirmed").safe).toBe(false);
  });

  it("keeps the worker network-only and verifies the build/header contract", () => {
    const worker = readFileSync("src/sw.ts", "utf8");
    const vite = readFileSync("vite.config.ts", "utf8");
    const coordinator = readFileSync("src/lib/frontendVersionCoordinator.ts", "utf8");
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(worker).toContain("self.skipWaiting()");
    expect(worker).toContain("self.clients.claim()");
    expect(worker).toContain("new NetworkOnly()");
    expect(worker).toContain("recoverLegacyClients");
    expect(vite).toContain('fileName: "version.json"');
    expect(vite).toContain("__BUILD_SHA__");
    expect(readFileSync("src/main.tsx", "utf8")).toContain("privacy_safe: true");
    expect(coordinator).toContain('window.addEventListener("pageshow"');
    expect(coordinator).toContain('window.addEventListener("online"');
    expect(coordinator).toContain('document.addEventListener("visibilitychange"');
    expect(coordinator).toContain("FRONTEND_VERSION_CHECK_INTERVAL_MS");
    expect(coordinator).toContain('coordinator.beginCriticalSection("unsaved_form")');

    const headers = new Map(vercel.headers.map((entry: { source: string; headers: Array<{ key: string; value: string }> }) => [
      entry.source,
      entry.headers.find((header) => header.key === "Cache-Control")?.value,
    ]));
    expect(headers.get("/sw.js")).toContain("no-store");
    expect(headers.get("/version.json")).toContain("no-store");
    expect(headers.get("/api/release")).toContain("no-store");
    expect(headers.get("/manifest.webmanifest")).toContain("must-revalidate");
    expect(headers.get("/manifest-desk.webmanifest")).toContain("must-revalidate");
    expect(headers.get("/manifest-admin.webmanifest")).toContain("must-revalidate");
    expect(headers.get("/assets/(.*)")).toBe("public, max-age=31536000, immutable");
  });
});
