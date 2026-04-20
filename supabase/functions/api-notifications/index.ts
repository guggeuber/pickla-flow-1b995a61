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
// web-push handles RFC 8291 payload encryption, correct Content-Encoding,
// apns-topic header, and VAPID JWT auth — all in one call.
import webpush from 'https://esm.sh/web-push@3.6.7';

async function sendWebPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: string,
  vapidPublicKey: string,
  vapidPrivateKey: string,
  vapidSubject: string,
): Promise<{ ok: boolean; status?: number; body?: string }> {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  try {
    const result = await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      payload,
    );
    return { ok: true, status: result.statusCode };
  } catch (err: any) {
    console.error('Push delivery failed', { status: err.statusCode, body: err.body, endpoint: subscription.endpoint.slice(-30) });
    return { ok: false, status: err.statusCode, body: err.body };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const path = url.pathname.split('/').pop() || '';

  const admin = getServiceClient();

  // test-push is unauthenticated — handle before auth check
  if (req.method === 'POST' && path === 'test-push') {
    try {
      const body = await req.json();
      const { user_id } = body;
      if (!user_id) return errorResponse('Missing user_id');

      const vapidPublicKey  = Deno.env.get('VAPID_PUBLIC_KEY');
      const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
      const vapidSubject    = Deno.env.get('VAPID_SUBJECT') || 'mailto:info@playpickla.com';
      if (!vapidPublicKey || !vapidPrivateKey) return errorResponse('VAPID not configured', 500);

      const { data: subs, error: subErr } = await admin
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .eq('user_id', user_id);

      if (subErr) return errorResponse(subErr.message);
      if (!subs?.length) return jsonResponse({ sent: 0, total: 0, note: 'No subscriptions found for this user_id' });

      const payload = JSON.stringify({ title: 'Pickla test', body: 'Push funkar! 🎯', url: '/hub' });
      const results = await Promise.allSettled(
        subs.map((sub: { endpoint: string; p256dh: string; auth: string }) =>
          sendWebPush(sub, payload, vapidPublicKey, vapidPrivateKey, vapidSubject)
        )
      );
      const details = results.map((r, i) => {
        const ep = (subs[i] as { endpoint: string }).endpoint.slice(-30);
        if (r.status === 'fulfilled') {
          const v = (r as PromiseFulfilledResult<{ ok: boolean; status?: number; body?: string }>).value;
          return { endpoint: ep, ok: v.ok, status: v.status, body: v.body };
        }
        return { endpoint: ep, ok: false, error: (r as PromiseRejectedResult).reason?.message };
      });
      const sent = details.filter((d) => d.ok).length;
      return jsonResponse({ sent, total: subs.length, details });
    } catch (e) {
      return errorResponse((e as Error).message, 500);
    }
  }

  const { client, userId, error } = await getAuthenticatedClient(req);
  if (error || !client || !userId) return errorResponse(error || 'Unauthorized', 401);

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

    // ── POST /chat-message — push to all room participants except sender ──────
    if (req.method === 'POST' && path === 'chat-message') {
      const body = await req.json();
      const { room_id, preview } = body;
      if (!room_id || !preview) return errorResponse('Missing room_id or preview');

      const vapidPublicKey  = Deno.env.get('VAPID_PUBLIC_KEY');
      const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
      const vapidSubject    = Deno.env.get('VAPID_SUBJECT') || 'mailto:info@playpickla.com';
      if (!vapidPublicKey || !vapidPrivateKey) return jsonResponse({ sent: 0 });

      // Participants excluding the sender
      const { data: participants } = await admin
        .from('chat_participants')
        .select('user_id')
        .eq('room_id', room_id)
        .neq('user_id', userId);
      if (!participants?.length) return jsonResponse({ sent: 0 });

      const participantIds = participants.map((p: { user_id: string }) => p.user_id);

      // Push subscriptions for those users
      const { data: subs } = await admin
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .in('user_id', participantIds);
      if (!subs?.length) return jsonResponse({ sent: 0 });

      // Room title for notification header
      const { data: room } = await admin
        .from('chat_rooms')
        .select('title')
        .eq('id', room_id)
        .maybeSingle();

      const payload = JSON.stringify({
        title: room?.title || 'Pickla Hub',
        body: preview,
        url: `/hub?join=${room_id}`,
      });

      const results = await Promise.allSettled(
        subs.map((sub: { endpoint: string; p256dh: string; auth: string }) =>
          sendWebPush(sub, payload, vapidPublicKey, vapidPrivateKey, vapidSubject)
        )
      );
      const sent = results.filter(
        (r) => r.status === 'fulfilled' && (r as PromiseFulfilledResult<{ ok: boolean }>).value?.ok
      ).length;
      return jsonResponse({ sent, total: subs.length });
    }

    return errorResponse('Not found', 404);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
