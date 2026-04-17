// Web Push subscription helpers

import { apiGet, apiPost, apiDelete } from "@/lib/api";

export async function subscribeToPush(venueId?: string): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;

  try {
    // Get VAPID public key from backend
    const { publicKey } = await apiGet("api-notifications", "vapid-key");
    if (!publicKey) return false;

    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    if (existing) await existing.unsubscribe();

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    const json = subscription.toJSON();
    const keys = json.keys as { p256dh: string; auth: string };

    await apiPost("api-notifications", "subscribe", {
      endpoint: json.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      venue_id: venueId,
    });

    return true;
  } catch {
    return false;
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const sub = await registration.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await apiDelete("api-notifications", "subscribe", { endpoint });
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}
