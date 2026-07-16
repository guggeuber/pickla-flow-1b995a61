import { supabase } from "@/integrations/supabase/client";
import { errorMessage, isStaleChunkError, showChunkRecovery } from "@/lib/appRecovery";

declare const __BUILD_TIME__: string;

const BUILD_ID = typeof __BUILD_TIME__ === "undefined" ? "local" : __BUILD_TIME__;

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
  let storedSlug: string | null = null;
  try {
    storedSlug = localStorage.getItem("pickla:lastVenueSlug");
  } catch {
    // Storage can be unavailable in locked-down browser contexts.
  }
  return params.get("v") || storedSlug || "pickla-arena-sthlm";
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

async function anonymizedUserId(userId?: string | null) {
  if (!userId || !globalThis.crypto?.subtle) return null;
  try {
    const bytes = new TextEncoder().encode(`pickla-client:${userId}`);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .slice(0, 12)
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

export async function reportClientEvent(event: ClientEvent) {
  if (!PROJECT_ID || typeof window === "undefined") return;

  const fingerprint = event.fingerprint || `${event.event_type}:${event.message}:${window.location.pathname}`;
  if (!shouldSend(fingerprint)) return;

  const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
  const anonymousUserId = await anonymizedUserId(data.session?.user?.id);
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
      release: BUILD_ID,
      anonymous_user_id: anonymousUserId,
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

export function reportReactRenderError(error: unknown, componentStack: string) {
  const message = errorMessage(error);
  return reportClientEvent({
    event_type: "client_react_render_error",
    severity: "critical",
    message,
    fingerprint: `react:${message}`,
    metadata: {
      stack: cleanStack(error instanceof Error ? error.stack : undefined),
      component_stack: cleanStack(componentStack),
    },
  });
}

export function reportBootstrapFailure(error: unknown) {
  const message = errorMessage(error);
  return reportClientEvent({
    event_type: isStaleChunkError(error) ? "client_stale_chunk_error" : "client_bootstrap_error",
    severity: "critical",
    message,
    fingerprint: `bootstrap:${message}`,
    metadata: {
      stack: cleanStack(error instanceof Error ? error.stack : undefined),
    },
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
    if (isStaleChunkError(event.error || event.message)) showChunkRecovery(event.error || event.message);
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
    if (isStaleChunkError(reason)) showChunkRecovery(reason);
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
