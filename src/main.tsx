import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
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
  const root = createRoot(document.getElementById("root")!);

  if (MAINTENANCE_MODE) {
    const { default: MaintenancePage } = await import("./pages/MaintenancePage");
    root.render(<MaintenancePage />);
    return;
  }

  const [{ default: App }, { installClientObservability }] = await Promise.all([
    import("./App.tsx"),
    import("./lib/clientObservability.ts"),
  ]);
  installClientObservability();
  root.render(<App />);
}

bootstrap();
