import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installClientObservability } from "./lib/clientObservability.ts";

installClientObservability();
createRoot(document.getElementById("root")!).render(<App />);
