export type StartupSurface = "customer" | "desk" | "admin" | "other";

export type ReliabilityMilestone = {
  at_ms: number;
  wall_time: string;
  detail?: Record<string, unknown>;
};

type ReliabilityState = {
  started_at_ms: number;
  started_at_wall: string;
  milestones: Record<string, ReliabilityMilestone>;
  startup_reported: boolean;
  hidden_at_ms: number | null;
};

declare global {
  interface Window {
    __PICKLA_RELIABILITY_BOOTSTRAP__?: {
      started_at_ms: number;
      started_at_wall: string;
      document_available_ms?: number;
    };
    __PICKLA_RELIABILITY_STATE__?: ReliabilityState;
  }
}

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : 0;
}

function state(): ReliabilityState | null {
  if (typeof window === "undefined") return null;
  if (!window.__PICKLA_RELIABILITY_STATE__) {
    const bootstrap = window.__PICKLA_RELIABILITY_BOOTSTRAP__;
    const documentAvailableAt = bootstrap?.document_available_ms ?? nowMs();
    window.__PICKLA_RELIABILITY_STATE__ = {
      started_at_ms: bootstrap?.started_at_ms ?? nowMs(),
      started_at_wall: bootstrap?.started_at_wall ?? new Date().toISOString(),
      milestones: {
        document_bootstrap: {
          at_ms: 0,
          wall_time: bootstrap?.started_at_wall ?? new Date().toISOString(),
        },
        document_available: {
          at_ms: Math.max(0, Math.round((documentAvailableAt - (bootstrap?.started_at_ms ?? documentAvailableAt)) * 10) / 10),
          wall_time: new Date().toISOString(),
        },
      },
      startup_reported: false,
      hidden_at_ms: null,
    };
  }
  return window.__PICKLA_RELIABILITY_STATE__;
}

export function markReliabilityMilestone(
  name: string,
  detail?: Record<string, unknown>,
  options: { replace?: boolean } = {},
) {
  const current = state();
  if (!current || current.milestones[name] && !options.replace) return current?.milestones[name] ?? null;
  const milestone: ReliabilityMilestone = {
    at_ms: Math.max(0, Math.round((nowMs() - current.started_at_ms) * 10) / 10),
    wall_time: new Date().toISOString(),
    ...(detail ? { detail } : {}),
  };
  current.milestones[name] = milestone;
  return milestone;
}

export function reliabilityMilestones() {
  return { ...(state()?.milestones ?? {}) };
}

export function surfaceForPath(pathname = typeof window === "undefined" ? "" : window.location.pathname): StartupSurface {
  if (pathname === "/desk" || pathname.startsWith("/desk/")) return "desk";
  if (pathname === "/hub/admin" || pathname.startsWith("/hub/admin/") || pathname.startsWith("/admin/")) return "admin";
  if (pathname === "/" || pathname === "/today") return "customer";
  return "other";
}

function displayMode() {
  if (typeof window === "undefined") return "unknown";
  if (window.matchMedia?.("(display-mode: standalone)").matches) return "standalone";
  if ((navigator as Navigator & { standalone?: boolean }).standalone) return "standalone";
  return "browser";
}

function navigationTiming() {
  if (typeof performance === "undefined") return null;
  const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (!entry) return null;
  return {
    response_start_ms: Math.round(entry.responseStart),
    response_end_ms: Math.round(entry.responseEnd),
    dom_interactive_ms: Math.round(entry.domInteractive),
    dom_content_loaded_ms: Math.round(entry.domContentLoadedEventEnd),
    load_event_end_ms: Math.round(entry.loadEventEnd),
    transfer_size: entry.transferSize,
  };
}

export function completeStartupTiming(surface: StartupSurface) {
  const current = state();
  if (!current || current.startup_reported) return;
  current.startup_reported = true;
  const milestones = reliabilityMilestones();
  if (!milestones.version_check_completed && !milestones.version_check_failed) {
    markReliabilityMilestone("version_check_deferred_at_actionable", {
      reason: "not_complete_before_actionable_ui",
    });
  }
  if (import.meta.env.MODE === "test") return;
  void import("@/lib/clientObservability").then(({ reportClientEvent }) => reportClientEvent({
    event_type: "client_startup_waterfall",
    severity: "info",
    message: `${surface} startup waterfall`,
    fingerprint: `startup-waterfall:${surface}:${Date.now()}`,
    metadata: {
      surface,
      display_mode: displayMode(),
      navigation: navigationTiming(),
      milestones: reliabilityMilestones(),
    },
    privacy_safe: true,
  })).catch(() => undefined);
}

export function installWarmResumeTiming() {
  if (typeof document === "undefined") return;
  const current = state();
  if (!current) return;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      current.hidden_at_ms = nowMs();
      return;
    }
    if (document.visibilityState !== "visible" || current.hidden_at_ms === null) return;
    const hiddenForMs = Math.max(0, Math.round(nowMs() - current.hidden_at_ms));
    current.hidden_at_ms = null;
    const resumedAt = nowMs();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (import.meta.env.MODE === "test") return;
      void import("@/lib/clientObservability").then(({ reportClientEvent }) => reportClientEvent({
        event_type: "client_warm_resume",
        severity: "info",
        message: `${surfaceForPath()} warm resume`,
        fingerprint: `warm-resume:${surfaceForPath()}:${Math.floor(Date.now() / 60_000)}`,
        metadata: {
          surface: surfaceForPath(),
          display_mode: displayMode(),
          hidden_for_ms: hiddenForMs,
          resume_to_two_frames_ms: Math.round(nowMs() - resumedAt),
          service_worker_controlled: Boolean(navigator.serviceWorker?.controller),
        },
        privacy_safe: true,
      })).catch(() => undefined);
    }));
  });
}

export function resetReliabilityTimingForTests() {
  if (typeof window !== "undefined") delete window.__PICKLA_RELIABILITY_STATE__;
}
