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
import "./index.css";

const MAINTENANCE_MODE = import.meta.env.VITE_MAINTENANCE_MODE === "true";
let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | undefined;

function reportFrontendVersionDiagnostic(
  event: FrontendVersionDiagnostic,
  detail: Record<string, unknown>,
) {
  const level = event === "convergence_failure" ? "error" : event === "version_checked" ? "info" : "warn";
  console[level](`[frontend-version] ${event}`, detail);
  if (event === "version_checked") return;
  void reportClientEvent({
    event_type: `frontend_${event}`,
    severity: event === "convergence_failure" ? "error" : event === "reload_deferred" ? "info" : "warning",
    message: event.replaceAll("_", " "),
    fingerprint: `frontend-version:${event}:${String(detail.current_sha || "unknown")}`,
    metadata: detail,
    privacy_safe: true,
  });
}

if (typeof navigator !== "undefined") {
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
