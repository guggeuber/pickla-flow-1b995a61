import { supabase } from "@/integrations/supabase/client";

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const BASE_URL = `https://${PROJECT_ID}.supabase.co/functions/v1`;

type ClientEventSeverity = "info" | "warning" | "error" | "critical";

type ClientEvent = {
  event_type: string;
  severity: ClientEventSeverity;
  message: string;
  route?: string;
  fingerprint?: string;
  metadata?: Record<string, unknown>;
};

let installed = false;
const sentFingerprints = new Map<string, number>();

function currentVenueSlug() {
  const params = new URLSearchParams(window.location.search);
  return params.get("v") || localStorage.getItem("pickla:lastVenueSlug") || "pickla-arena-sthlm";
}

function shouldSend(fingerprint: string) {
  const now = Date.now();
  const lastSent = sentFingerprints.get(fingerprint) || 0;
  if (now - lastSent < 60_000) return false;
  sentFingerprints.set(fingerprint, now);
  return true;
}

function cleanStack(stack?: string) {
  if (!stack) return undefined;
  return stack.split("\n").slice(0, 8).join("\n").slice(0, 2000);
}

export async function reportClientEvent(event: ClientEvent) {
  if (!PROJECT_ID || typeof window === "undefined") return;

  const fingerprint = event.fingerprint || `${event.event_type}:${event.message}:${window.location.pathname}`;
  if (!shouldSend(fingerprint)) return;

  const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;

  const body = {
    venue_slug: currentVenueSlug(),
    event_type: event.event_type,
    severity: event.severity,
    message: event.message.slice(0, 500),
    route: `${window.location.pathname}${window.location.search}`.slice(0, 500),
    fingerprint: fingerprint.slice(0, 500),
    user_agent: navigator.userAgent,
    metadata: {
      url: window.location.href,
      ...event.metadata,
    },
  };

  fetch(`${BASE_URL}/api-ops/client-event`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {
    // Observability must never break the customer flow.
  });
}

export function reportApiFailure(input: {
  method: string;
  fn: string;
  endpoint: string;
  status?: number;
  message: string;
  duration_ms: number;
}) {
  if (input.fn === "api-ops" && input.endpoint === "client-event") return;
  const severity: ClientEventSeverity = !input.status || input.status >= 500 ? "error" : "warning";
  reportClientEvent({
    event_type: "client_api_error",
    severity,
    message: `${input.method} ${input.fn}/${input.endpoint} ${input.status ?? "ERR"}: ${input.message}`,
    fingerprint: `api:${input.method}:${input.fn}:${input.endpoint}:${input.status ?? "ERR"}`,
    metadata: input,
  });
}

export function installClientObservability() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event) => {
    reportClientEvent({
      event_type: "client_runtime_error",
      severity: "error",
      message: event.message || "Runtime error",
      fingerprint: `runtime:${event.filename}:${event.lineno}:${event.colno}:${event.message}`,
      metadata: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: cleanStack(event.error?.stack),
      },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason || "Unhandled rejection");
    reportClientEvent({
      event_type: "client_unhandled_rejection",
      severity: "error",
      message,
      fingerprint: `promise:${message}`,
      metadata: {
        stack: cleanStack(reason instanceof Error ? reason.stack : undefined),
      },
    });
  });
}
