import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { renderBootstrapRecovery } from "@/lib/appRecovery";
import "./index.css";

const MAINTENANCE_MODE = import.meta.env.VITE_MAINTENANCE_MODE === "true";
const hadServiceWorkerController =
  typeof navigator !== "undefined" && "serviceWorker" in navigator && Boolean(navigator.serviceWorker.controller);

let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | undefined;

if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadServiceWorkerController || refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  updateServiceWorker = registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      registration?.update();
    },
    onNeedRefresh() {
      updateServiceWorker?.(true);
    },
  });
}

async function bootstrap() {
  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error("Application root is missing");
  const root = createRoot(rootElement);
  let observability: typeof import("./lib/clientObservability.ts") | undefined;

  try {
    observability = await import("./lib/clientObservability.ts");
    observability.installClientObservability();

    if (MAINTENANCE_MODE) {
      const { default: MaintenancePage } = await import("./pages/MaintenancePage");
      root.render(
        <AppErrorBoundary>
          <MaintenancePage />
        </AppErrorBoundary>,
      );
      return;
    }

    const { default: App } = await import("./App.tsx");
    root.render(
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>,
    );
  } catch (error) {
    void observability?.reportBootstrapFailure(error);
    root.unmount();
    renderBootstrapRecovery(rootElement, error);
  }
}

void bootstrap();
