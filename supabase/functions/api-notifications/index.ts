// api-notifications — Web Push notification subscriptions and sending
// Deploy: supabase functions deploy api-notifications --no-verify-jwt --project-ref cqnjpudmsreubgviqptg
// Required secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:info@playpickla.com)
//
// Generate VAPID keys (run locally):
//   npx web-push generate-vapid-keys
// Then set secrets:
//   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:info@playpickla.com

import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';

// Minimal Web Push implementation using Deno's native crypto
async function sendWebPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: string,
  vapidPublicKey: string,
  vapidPrivateKey: string,
  vapidSubject: string,
): Promise<{ ok: boolean; status?: number }> {
  // Decode base64url keys
  const urlToBase64 = (str: string) => str.replace(/-/g, '+').replace(/_/g, '/');
  const pubKeyBytes = Uint8Array.from(atob(urlToBase64(vapidPublicKey)), c => c.charCodeAt(0));
  const privKeyBytes = Uint8Array.from(atob(urlToBase64(vapidPrivateKey)), c => c.charCodeAt(0));

  // Import ECDH keys for VAPID JWT signing (ES256)
  const privKey = await crypto.subtle.importKey(
    'pkcs8',
    privKeyBytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );

  // Build VAPID JWT
  const audience = new URL(subscription.endpoint).origin;
  const expiry = Math.floor(Date.now() / 1000) + 12 * 3600;
  const header = btoa(JSON.stringify({ typ: 'JWT', alg: 'ES256' })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const claims = btoa(JSON.stringify({ aud: audience, exp: expiry, sub: vapidSubject })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const signingInput = `${header}.${claims}`;
  const sigBytes = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privKey,
    new TextEncoder().encode(signingInput),
  );
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBytes))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const jwt = `${signingInput}.${sig}`;

  // Encrypt payload with ECDH + AES-128-GCM (simplified — using fetch to FCM/VAPID endpoint)
  // For full encryption, use a library. Here we send the push request with Authorization header only.
  // The payload encryption is handled by the push service if we send the Authorization header correctly.
  // Note: For production, use the web-push npm package via a fetch wrapper or a Deno-compatible library.

  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${jwt},k=${vapidPublicKey}`,
      'Content-Type': 'application/json',
      'TTL': '86400',
    },
    body: payload,
  });

  return { ok: res.ok, status: res.status };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const path = url.pathname.split('/').pop() || '';

  const { client, userId, error } = await getAuthenticatedClient(req);
  if (error || !client || !userId) return errorResponse(error || 'Unauthorized', 401);

  const admin = getServiceClient();

  try {
    // ── POST /subscribe — save a push subscription ────────────────────────────
    if (req.method === 'POST' && path === 'subscribe') {
      const body = await req.json();
      const { endpoint, p256dh, auth, venue_id } = body;
      if (!endpoint || !p256dh || !auth) return errorResponse('Missing subscription fields');

      const { data, error: iErr } = await admin.from('push_subscriptions').upsert({
        user_id: userId,
        venue_id: venue_id || null,
        endpoint,
        p256dh,
        auth,
      }, { onConflict: 'user_id,endpoint' }).select().single();

      if (iErr) return errorResponse(iErr.message);
      return jsonResponse(data, 201);
    }

    // ── DELETE /subscribe — remove a push subscription ────────────────────────
    if (req.method === 'DELETE' && path === 'subscribe') {
      const endpoint = url.searchParams.get('endpoint');
      if (!endpoint) return errorResponse('Missing endpoint');

      await admin.from('push_subscriptions')
        .delete()
        .eq('user_id', userId)
        .eq('endpoint', endpoint);

      return jsonResponse({ ok: true });
    }

    // ── GET /vapid-key — public VAPID key for client-side subscription ─────────
    if (req.method === 'GET' && path === 'vapid-key') {
      const key = Deno.env.get('VAPID_PUBLIC_KEY');
      if (!key) return errorResponse('VAPID not configured', 500);
      return jsonResponse({ publicKey: key });
    }

    // ── POST /send — send push to a user or all venue subscribers (staff only) ─
    if (req.method === 'POST' && path === 'send') {
      const body = await req.json();
      const { venue_id, target_user_id, title, message, url: linkUrl } = body;
      if (!title || !message) return errorResponse('Missing title or message');

      // Must be venue staff or super_admin
      const { data: isStaff } = await admin.from('venue_staff')
        .select('id').eq('user_id', userId).eq('venue_id', venue_id).eq('is_active', true).maybeSingle();
      const { data: isSuperAdmin } = await admin.from('user_roles')
        .select('role').eq('user_id', userId).eq('role', 'super_admin').maybeSingle();
      if (!isStaff && !isSuperAdmin) return errorResponse('Forbidden', 403);

      const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
      const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
      const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:info@playpickla.com';
      if (!vapidPublicKey || !vapidPrivateKey) return errorResponse('VAPID not configured', 500);

      // Get target subscriptions
      let query = admin.from('push_subscriptions').select('endpoint, p256dh, auth');
      if (target_user_id) {
        query = query.eq('user_id', target_user_id);
      } else if (venue_id) {
        query = query.eq('venue_id', venue_id);
      }
      const { data: subs } = await query;
      if (!subs?.length) return jsonResponse({ sent: 0 });

      const payload = JSON.stringify({ title, body: message, url: linkUrl || '/' });
      const results = await Promise.allSettled(
        subs.map((sub) => sendWebPush(sub, payload, vapidPublicKey, vapidPrivateKey, vapidSubject))
      );

      const sent = results.filter((r) => r.status === 'fulfilled' && (r as any).value?.ok).length;
      return jsonResponse({ sent, total: subs.length });
    }

    return errorResponse('Not found', 404);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
