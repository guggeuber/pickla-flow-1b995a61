import { classifyFrontendReload } from "@/lib/frontendVersionPolicy";

export const LEGACY_CLIENT_HANDSHAKE_MS = 2_500;

export type LegacyRecoveryClient = {
  id: string;
  url: string;
  postMessage(message: unknown): void;
  navigate(url: string): Promise<unknown>;
};

type RecoverLegacyClientsInput = {
  build: { sha: string; built_at: string };
  acknowledgedClientIds: Set<string>;
  listClients: () => Promise<LegacyRecoveryClient[]>;
  waitForAcknowledgements: () => Promise<void>;
  origin: string;
  onDiagnostic?: (event: string, detail: Record<string, unknown>) => void;
};

/**
 * Gives modern documents a chance to acknowledge the update contract, then
 * performs a real navigation for safe same-origin clients that did not answer.
 * A pre-July client has no message handler, so it follows this fallback path.
 */
export async function recoverLegacyClients(input: RecoverLegacyClientsInput) {
  const initialClients = await input.listClients();
  for (const client of initialClients) {
    try {
      client.postMessage({ type: "PICKLA_VERSION_ACTIVATED", build: input.build });
    } catch {
      input.onDiagnostic?.("legacy_client_handshake_failure", { client_id: client.id });
    }
  }

  await input.waitForAcknowledgements();

  const currentClients = await input.listClients();
  for (const client of currentClients) {
    if (input.acknowledgedClientIds.has(client.id)) continue;

    let url: URL;
    try {
      url = new URL(client.url);
    } catch {
      input.onDiagnostic?.("legacy_client_invalid_url", { client_id: client.id });
      continue;
    }

    if (url.origin !== input.origin) continue;
    const safety = classifyFrontendReload(url.pathname);
    if (!safety.safe) {
      input.onDiagnostic?.("legacy_reload_deferred", {
        client_id: client.id,
        pathname: url.pathname,
        reason: safety.reason,
      });
      continue;
    }

    try {
      await client.navigate(url.href);
      input.onDiagnostic?.("legacy_convergence_executed", {
        client_id: client.id,
        pathname: url.pathname,
        target_sha: input.build.sha,
      });
    } catch {
      input.onDiagnostic?.("legacy_convergence_failure", {
        client_id: client.id,
        pathname: url.pathname,
        target_sha: input.build.sha,
      });
    }
  }
}
