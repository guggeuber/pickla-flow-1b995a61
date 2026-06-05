import { createRoot } from "react-dom/client";
import "./index.css";

const MAINTENANCE_MODE = import.meta.env.VITE_MAINTENANCE_MODE === "true";

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
