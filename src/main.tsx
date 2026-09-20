import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { renderBootstrapRecovery } from "@/lib/appRecovery";
import {
  installClientObservability,
  reportClientEvent,
  reportBootstrapFailure,
} from "@/lib/clientObservability";
import {
  installFrontendVersionCoordinator,
  notifyFrontendWorkerRefresh,
  setFrontendVersionRegistration,
  type FrontendVersionDiagnostic,
} from "@/lib/frontendVersionCoordinator";
import {
  installWarmResumeTiming,
  markReliabilityMilestone,
} from "@/lib/reliabilityTiming";
import "./index.css";

const MAINTENANCE_MODE = import.meta.env.VITE_MAINTENANCE_MODE === "true";
let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | undefined;

markReliabilityMilestone("main_js_evaluated");
markReliabilityMilestone("service_worker_state_known", {
  supported: typeof navigator !== "undefined" && "serviceWorker" in navigator,
  controlled: typeof navigator !== "undefined" && Boolean(navigator.serviceWorker?.controller),
});
installWarmResumeTiming();

function reportFrontendVersionDiagnostic(
  event: FrontendVersionDiagnostic,
  detail: Record<string, unknown>,
) {
  if (event === "version_checked") {
    markReliabilityMilestone("version_check_completed", {
      trigger: detail.trigger,
      current_matches_running: detail.current_sha === detail.running_sha,
    });
  } else if (event === "version_check_failure") {
    markReliabilityMilestone("version_check_failed", {
      trigger: detail.trigger,
      error_class: detail.failure_kind || "transport",
    });
  }
  const level = event === "convergence_failure"
    ? "error"
    : event === "version_checked" || event === "convergence_success" ? "info" : "warn";
  console[level](`[frontend-version] ${event}`, detail);
  if (event === "version_checked") return;
  void reportClientEvent({
    event_type: `frontend_${event}`,
    severity: event === "convergence_failure"
      ? "error"
      : event === "reload_deferred" || event === "convergence_success" ? "info" : "warning",
    message: event.replace(/_/g, " "),
    fingerprint: `frontend-version:${event}:${String(detail.current_sha || "unknown")}`,
    metadata: detail,
    privacy_safe: true,
  });
}

if (typeof navigator !== "undefined") {
  markReliabilityMilestone("version_check_started", { blocking: false });
  installFrontendVersionCoordinator(reportFrontendVersionDiagnostic);
}

if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  updateServiceWorker = registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      setFrontendVersionRegistration(registration);
    },
    onNeedRefresh() {
      void updateServiceWorker?.(false);
      notifyFrontendWorkerRefresh();
    },
  });
}

async function bootstrap() {
  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error("Application root is missing");
  const root = createRoot(rootElement);

  try {
    installClientObservability();

    if (MAINTENANCE_MODE) {
      const { default: MaintenancePage } = await import("./pages/MaintenancePage");
      root.render(
        <AppErrorBoundary>
          <MaintenancePage />
        </AppErrorBoundary>,
      );
      return;
    }

    root.render(
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>,
    );
  } catch (error) {
    void reportBootstrapFailure(error);
    root.unmount();
    renderBootstrapRecovery(rootElement, error);
  }
}

void bootstrap();
