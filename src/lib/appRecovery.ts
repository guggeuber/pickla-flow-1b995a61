const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;

const STALE_CHUNK_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /chunkloaderror/i,
  /loading chunk [\d-]+ failed/i,
  /module script.*mime type/i,
  /expected a javascript(?:-or-wasm)? module script/i,
];

export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Unknown application error";
}

export function isStaleChunkError(error: unknown) {
  const message = errorMessage(error);
  return STALE_CHUNK_PATTERNS.some((pattern) => pattern.test(message));
}

export async function clearStaleAppCaches() {
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
    await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)));
  }

  if (typeof caches !== "undefined") {
    const keys = await caches.keys().catch(() => []);
    await Promise.all(
      keys
        .filter((key) => /pickla|workbox|precache|runtime|api-cache/i.test(key))
        .map((key) => caches.delete(key).catch(() => false)),
    );
  }
}

function clearLocalAuthStorage() {
  if (!PROJECT_ID || typeof localStorage === "undefined") return;
  try {
    const prefix = `sb-${PROJECT_ID}-auth-token`;
    Object.keys(localStorage)
      .filter((key) => key === prefix || key.startsWith(`${prefix}.`))
      .forEach((key) => localStorage.removeItem(key));
  } catch {
    // Recovery must continue even if storage is unavailable.
  }
}

export async function reloadApp(options: { clearCaches?: boolean } = {}) {
  if (options.clearCaches) await clearStaleAppCaches();
  window.location.reload();
}

export async function signOutAndRecover() {
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    clearLocalAuthStorage();
  }
  await clearStaleAppCaches();
  window.location.assign("/auth");
}

function recoveryButton(label: string, primary = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  Object.assign(button.style, {
    width: "100%",
    border: primary ? "1px solid #111111" : "1px solid rgba(17,17,17,0.16)",
    borderRadius: "14px",
    background: primary ? "#111111" : "#ffffff",
    color: primary ? "#ffffff" : "#111111",
    padding: "13px 16px",
    font: "700 15px 'Inter', system-ui, sans-serif",
    cursor: "pointer",
  });
  return button;
}

function recoveryPanel(error: unknown) {
  const panel = document.createElement("main");
  panel.setAttribute("role", "alert");
  panel.setAttribute("aria-live", "assertive");
  Object.assign(panel.style, {
    minHeight: "100dvh",
    display: "grid",
    placeItems: "center",
    padding: "24px",
    background: "#fffaf7",
    color: "#111111",
  });

  const card = document.createElement("section");
  Object.assign(card.style, {
    width: "min(100%, 420px)",
    border: "1px solid rgba(17,17,17,0.08)",
    borderRadius: "24px",
    background: "#ffffff",
    padding: "28px",
    boxShadow: "0 16px 48px rgba(17,17,17,0.08)",
  });

  const eyebrow = document.createElement("p");
  eyebrow.textContent = "PICKLA";
  Object.assign(eyebrow.style, {
    margin: "0 0 12px",
    color: "#ed3f8f",
    font: "800 11px 'Space Grotesk', system-ui, sans-serif",
    letterSpacing: "0.18em",
  });

  const heading = document.createElement("h1");
  heading.textContent = "Something went wrong while loading your account.";
  Object.assign(heading.style, {
    margin: "0",
    font: "800 28px/1.05 'Space Grotesk', system-ui, sans-serif",
  });

  const copy = document.createElement("p");
  copy.textContent = "Your account is safe. Try loading the app again or sign out and try again.";
  Object.assign(copy.style, {
    margin: "14px 0 22px",
    color: "#6b6664",
    font: "500 15px/1.5 'Inter', system-ui, sans-serif",
  });

  const actions = document.createElement("div");
  Object.assign(actions.style, { display: "grid", gap: "10px" });
  const retry = recoveryButton("Try again", true);
  const signOut = recoveryButton("Sign out");
  retry.addEventListener("click", () => {
    retry.disabled = true;
    void reloadApp({ clearCaches: isStaleChunkError(error) });
  });
  signOut.addEventListener("click", () => {
    signOut.disabled = true;
    void signOutAndRecover();
  });
  actions.append(retry, signOut);
  card.append(eyebrow, heading, copy, actions);
  panel.append(card);
  return panel;
}

export function renderBootstrapRecovery(root: HTMLElement, error: unknown) {
  root.replaceChildren(recoveryPanel(error));
}

export function showChunkRecovery(error: unknown) {
  if (typeof document === "undefined" || document.getElementById("pickla-chunk-recovery")) return;
  const overlay = document.createElement("div");
  overlay.id = "pickla-chunk-recovery";
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
  });
  overlay.append(recoveryPanel(error));
  document.body.append(overlay);
}
