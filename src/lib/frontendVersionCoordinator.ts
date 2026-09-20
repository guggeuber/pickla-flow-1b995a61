import {
  parseFrontendBuildIdentity,
  RUNNING_FRONTEND_BUILD,
  type FrontendBuildIdentity,
} from "@/lib/frontendBuild";
import {
  AUTHORITATIVE_RELEASE_URL,
  classifyFrontendRelease,
  fetchAuthoritativeFrontendRelease,
  FrontendReleaseLookupError,
} from "@/lib/frontendRelease";
import { classifyFrontendReload } from "@/lib/frontendVersionPolicy";

export const FRONTEND_VERSION_URL = AUTHORITATIVE_RELEASE_URL;
export const FRONTEND_VERSION_CHECK_INTERVAL_MS = 60 * 60 * 1_000;
export const FRONTEND_VERSION_MIN_CHECK_GAP_MS = 30_000;
const RELOAD_MARKER_KEY = "pickla:frontend-convergence-build";

export type FrontendVersionTrigger =
  | "bootstrap"
  | "pageshow"
  | "visibility"
  | "online"
  | "periodic"
  | "route"
  | "controllerchange"
  | "worker_refresh";

export type FrontendVersionDiagnostic =
  | "version_checked"
  | "version_check_failure"
  | "stale_detected"
  | "backward_version_rejected"
  | "reload_deferred"
  | "convergence_executed"
  | "convergence_success"
  | "convergence_failure";

type WorkerMessenger = {
  postMessage(message: unknown): void;
};

type RegistrationLike = {
  update(): Promise<unknown>;
};

export type FrontendVersionCoordinatorDependencies = {
  runningBuild: FrontendBuildIdentity;
  fetchCurrentBuild: () => Promise<FrontendBuildIdentity>;
  getPathname: () => string;
  isOnline: () => boolean;
  getController: () => WorkerMessenger | null;
  reload: () => void;
  getReloadMarker: () => string | null;
  setReloadMarker: (sha: string) => void;
  now: () => number;
  getPwaSurface: () => string;
  report: (event: FrontendVersionDiagnostic, detail: Record<string, unknown>) => void;
};

export type FrontendVersionCoordinator = ReturnType<typeof createFrontendVersionCoordinator>;

export function createFrontendVersionCoordinator(deps: FrontendVersionCoordinatorDependencies) {
  let registration: RegistrationLike | null = null;
  let currentServerBuild: FrontendBuildIdentity | null = null;
  let controllerBuild: FrontendBuildIdentity | null = null;
  let pendingBuild: FrontendBuildIdentity | null = null;
  let checkInFlight: Promise<void> | null = null;
  let updateInFlight: Promise<void> | null = null;
  let lastCheckAt = Number.NEGATIVE_INFINITY;
  let lastUpdateAt = Number.NEGATIVE_INFINITY;
  let lastStaleSha: string | null = null;
  let lastDeferredKey: string | null = null;
  let lastFailureKey: string | null = null;
  let convergenceSuccessReported = false;
  const criticalReasons = new Map<string, number>();

  const baseDetail = (build?: FrontendBuildIdentity | null) => ({
    running_sha: deps.runningBuild.sha,
    running_built_at: deps.runningBuild.built_at,
    running_deployment_id: deps.runningBuild.deployment_id ?? null,
    current_sha: build?.sha ?? currentServerBuild?.sha ?? null,
    current_built_at: build?.built_at ?? currentServerBuild?.built_at ?? null,
    authoritative_sha: build?.sha ?? currentServerBuild?.sha ?? null,
    authoritative_built_at: build?.built_at ?? currentServerBuild?.built_at ?? null,
    authoritative_deployment_id: build?.deployment_id ?? currentServerBuild?.deployment_id ?? null,
    controller_sha: controllerBuild?.sha ?? null,
    request_id: "request_id" in (build || {})
      ? (build as FrontendBuildIdentity & { request_id?: string }).request_id ?? null
      : null,
    pwa_surface: deps.getPwaSurface(),
  });

  const pingController = () => {
    deps.getController()?.postMessage({ type: "PICKLA_GET_BUILD" });
  };

  const requestWorkerUpdate = async (trigger: FrontendVersionTrigger) => {
    if (!registration || !deps.isOnline()) return;
    if (updateInFlight) return updateInFlight;
    if (deps.now() - lastUpdateAt < FRONTEND_VERSION_MIN_CHECK_GAP_MS) return;

    lastUpdateAt = deps.now();
    updateInFlight = registration.update()
      .then(() => {
        pingController();
      })
      .catch((error: unknown) => {
        deps.report("convergence_failure", {
          ...baseDetail(pendingBuild),
          trigger,
          stage: "service_worker_update",
          error: error instanceof Error ? error.message : String(error),
          reload_count: 0,
        });
      })
      .finally(() => {
        updateInFlight = null;
      });
    return updateInFlight;
  };

  const executeReload = (build: FrontendBuildIdentity, trigger: FrontendVersionTrigger | "worker_activation") => {
    const existingMarker = deps.getReloadMarker();
    if (existingMarker === build.sha) {
      const failureKey = `${build.sha}:reload_already_attempted`;
      if (lastFailureKey !== failureKey) {
        lastFailureKey = failureKey;
        deps.report("convergence_failure", {
          ...baseDetail(build),
          trigger,
          stage: "reload_already_attempted",
          reload_count: 1,
        });
      }
      return;
    }

    deps.setReloadMarker(build.sha);
    deps.report("convergence_executed", {
      ...baseDetail(build),
      trigger,
      pathname: deps.getPathname(),
      reload_count: 1,
    });
    deps.reload();
  };

  const attemptConvergence = async (
    build: FrontendBuildIdentity,
    trigger: FrontendVersionTrigger | "worker_activation",
  ) => {
    if (build.sha === deps.runningBuild.sha) {
      pendingBuild = null;
      return;
    }

    pendingBuild = build;
    const safety = classifyFrontendReload(deps.getPathname(), criticalReasons.keys());
    if (!safety.safe) {
      const deferredKey = `${build.sha}:${safety.reason}:${deps.getPathname()}`;
      if (lastDeferredKey !== deferredKey) {
        lastDeferredKey = deferredKey;
        deps.report("reload_deferred", {
          ...baseDetail(build),
          trigger,
          pathname: deps.getPathname(),
          reason: safety.reason,
        });
      }
      return;
    }

    lastDeferredKey = null;
    const controller = deps.getController();
    if (!controller) {
      executeReload(build, trigger);
      return;
    }

    if (controllerBuild?.sha === build.sha) {
      executeReload(build, trigger);
      return;
    }

    await requestWorkerUpdate(trigger === "worker_activation" ? "controllerchange" : trigger);
    pingController();
  };

  const check = async (trigger: FrontendVersionTrigger, force = false) => {
    if (!deps.isOnline()) return;
    if (checkInFlight) return checkInFlight;
    if (!force && deps.now() - lastCheckAt < FRONTEND_VERSION_MIN_CHECK_GAP_MS) {
      if (pendingBuild) await attemptConvergence(pendingBuild, trigger);
      return;
    }

    lastCheckAt = deps.now();
    checkInFlight = (async () => {
      void requestWorkerUpdate(trigger);
      try {
        const build = await deps.fetchCurrentBuild();
        currentServerBuild = build;
        const relation = classifyFrontendRelease(deps.runningBuild, build);
        deps.report("version_checked", { ...baseDetail(build), trigger, relation });
        if (relation === "same") {
          pendingBuild = null;
          lastStaleSha = null;
          if (!convergenceSuccessReported && deps.getReloadMarker() === deps.runningBuild.sha) {
            convergenceSuccessReported = true;
            deps.report("convergence_success", {
              ...baseDetail(build),
              trigger,
              reload_count: 1,
            });
          }
          return;
        }

        if (relation === "older") {
          pendingBuild = null;
          deps.report("backward_version_rejected", {
            ...baseDetail(build),
            trigger,
            stage: "release_comparison",
            failure_kind: "older_release",
            reload_count: 0,
          });
          return;
        }

        if (relation === "unknown") {
          pendingBuild = null;
          throw new FrontendReleaseLookupError(
            "unknown_release",
            "authoritative release ordering could not be proven",
          );
        }

        if (lastStaleSha !== build.sha) {
          lastStaleSha = build.sha;
          deps.report("stale_detected", {
            ...baseDetail(build),
            trigger,
            pathname: deps.getPathname(),
            relation,
          });
        }
        await attemptConvergence(build, trigger);
      } catch (error: unknown) {
        pendingBuild = null;
        const lookupError = error instanceof FrontendReleaseLookupError ? error : null;
        deps.report("version_check_failure", {
          ...baseDetail(),
          trigger,
          stage: "version_check",
          error: error instanceof Error ? error.message : String(error),
          failure_kind: lookupError?.failureKind ?? "transport",
          status: lookupError?.status ?? null,
          request_id: lookupError?.requestId ?? null,
          reload_count: 0,
        });
      } finally {
        checkInFlight = null;
      }
    })();
    return checkInFlight;
  };

  const handleWorkerMessage = (
    data: unknown,
    reply?: (message: unknown) => void,
  ) => {
    if (!data || typeof data !== "object") return;
    const message = data as Record<string, unknown>;
    if (message.type !== "PICKLA_VERSION_ACTIVATED" && message.type !== "PICKLA_SW_BUILD") return;
    const build = parseFrontendBuildIdentity(message.build);
    if (!build) return;

    controllerBuild = build;
    if (message.type === "PICKLA_VERSION_ACTIVATED") {
      reply?.({
        type: "PICKLA_VERSION_CLIENT_ACK",
        running_build: deps.runningBuild,
      });
    }

    if (pendingBuild) {
      void attemptConvergence(pendingBuild, "controllerchange");
    }
    if (build.sha !== deps.runningBuild.sha || message.type === "PICKLA_VERSION_ACTIVATED") {
      void check("worker_refresh", true);
    }
  };

  const routeChanged = () => {
    if (pendingBuild) void attemptConvergence(pendingBuild, "route");
    else void check("route");
  };

  const beginCriticalSection = (reason: string) => {
    criticalReasons.set(reason, (criticalReasons.get(reason) || 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (criticalReasons.get(reason) || 1) - 1;
      if (remaining > 0) criticalReasons.set(reason, remaining);
      else criticalReasons.delete(reason);
      if (pendingBuild) void attemptConvergence(pendingBuild, "route");
    };
  };

  return {
    setRegistration(nextRegistration: RegistrationLike | null) {
      registration = nextRegistration;
      pingController();
    },
    check,
    routeChanged,
    beginCriticalSection,
    handleControllerChange() {
      controllerBuild = null;
      pingController();
      void check("controllerchange", true);
    },
    handleWorkerMessage,
    handleWorkerRefresh() {
      void check("worker_refresh", true);
    },
    getState() {
      return {
        currentServerBuild,
        controllerBuild,
        pendingBuild,
        criticalReasons: [...criticalReasons.keys()],
      };
    },
  };
}

let installedCoordinator: FrontendVersionCoordinator | null = null;
let releaseDirtyFormGuard: (() => void) | null = null;

export function installFrontendVersionCoordinator(
  report: FrontendVersionCoordinatorDependencies["report"],
) {
  if (installedCoordinator || typeof window === "undefined") return installedCoordinator;

  const coordinator = createFrontendVersionCoordinator({
    runningBuild: RUNNING_FRONTEND_BUILD,
    fetchCurrentBuild: fetchAuthoritativeFrontendRelease,
    getPathname: () => window.location.pathname,
    isOnline: () => navigator.onLine,
    getController: () => navigator.serviceWorker?.controller ?? null,
    reload: () => window.location.reload(),
    getReloadMarker: () => {
      try {
        return window.sessionStorage.getItem(RELOAD_MARKER_KEY);
      } catch {
        return null;
      }
    },
    setReloadMarker: (sha) => {
      try {
        window.sessionStorage.setItem(RELOAD_MARKER_KEY, sha);
      } catch {
        // The worker-build verification still prevents a blind reload loop.
      }
    },
    now: () => Date.now(),
    getPwaSurface: () => document.documentElement.dataset.pwaSurface || "customer",
    report,
  });
  installedCoordinator = coordinator;

  const runCheck = (trigger: FrontendVersionTrigger, force = false) => {
    void coordinator.check(trigger, force);
  };
  window.addEventListener("pageshow", () => runCheck("pageshow"));
  window.addEventListener("online", () => runCheck("online", true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") runCheck("visibility");
  });
  const markDirtyForm = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element) || releaseDirtyFormGuard) return;
    const isFormControl = target.matches("input, textarea, select, [contenteditable='true']");
    const isOperationalSurface = window.location.pathname === "/desk"
      || window.location.pathname.startsWith("/desk/")
      || window.location.pathname === "/hub/admin"
      || window.location.pathname.startsWith("/hub/admin/")
      || window.location.pathname.startsWith("/admin/")
      || window.location.pathname === "/ops"
      || window.location.pathname.startsWith("/ops/")
      || window.location.pathname === "/event-ops"
      || window.location.pathname.startsWith("/event-ops/");
    if (!target.closest("form") && !(isOperationalSurface && isFormControl)) return;
    releaseDirtyFormGuard = coordinator.beginCriticalSection("unsaved_form");
  };
  const clearDirtyForm = () => {
    releaseDirtyFormGuard?.();
    releaseDirtyFormGuard = null;
  };
  document.addEventListener("input", markDirtyForm, true);
  document.addEventListener("change", markDirtyForm, true);
  document.addEventListener("submit", clearDirtyForm, true);
  document.addEventListener("reset", clearDirtyForm, true);
  navigator.serviceWorker?.addEventListener("controllerchange", () => coordinator.handleControllerChange());
  navigator.serviceWorker?.addEventListener("message", (event: MessageEvent) => {
    coordinator.handleWorkerMessage(event.data, (message) => {
      const source = event.source as WorkerMessenger | null;
      (source || navigator.serviceWorker.controller)?.postMessage(message);
    });
  });

  window.setInterval(() => runCheck("periodic"), FRONTEND_VERSION_CHECK_INTERVAL_MS);
  void navigator.serviceWorker?.ready.then((registration) => coordinator.setRegistration(registration));
  runCheck("bootstrap", true);
  return coordinator;
}

export function setFrontendVersionRegistration(registration: ServiceWorkerRegistration | undefined) {
  installedCoordinator?.setRegistration(registration ?? null);
}

export function notifyFrontendRouteChange() {
  releaseDirtyFormGuard?.();
  releaseDirtyFormGuard = null;
  installedCoordinator?.routeChanged();
}

export function beginFrontendUpdateCriticalSection(reason: string) {
  return installedCoordinator?.beginCriticalSection(reason) ?? (() => undefined);
}

export function notifyFrontendWorkerRefresh() {
  installedCoordinator?.handleWorkerRefresh();
}
