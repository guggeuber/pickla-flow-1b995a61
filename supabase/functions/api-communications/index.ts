import {
  corsHeaders,
  errorResponse,
  jsonResponse,
  privateErrorResponse,
  privateJsonResponse,
} from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import { requireSuperAdmin } from '../_shared/authorization.ts';
import {
  isCanonicallyMarketingEligible,
  isValidCommunicationEmail,
  normalizeCommunicationEmail,
  PICKLA_MAIL_CONSENT_STATEMENT,
  PICKLA_MAIL_POLICY_VERSION,
  PICKLA_MAIL_TOPIC,
  PICKLA_MAIL_TOPIC_LABEL,
  resendWebhookAction,
  sanitizeFirstName,
  verifyOpaqueUnsubscribeToken,
} from '../_shared/communications.ts';

const PICKLA_ORGANIZATION_SLUG = 'pickla';
const RESEND_API_BASE = 'https://api.resend.com';
const PUBLIC_SUBSCRIBE_SOURCES = new Set(['public_web', 'public_web_paper', 'event_editorial']);

type AdminClient = ReturnType<typeof getServiceClient>;

type SubscriberRow = {
  id: string;
  email: string;
  first_name: string | null;
  marketing_status: 'active' | 'unsubscribed';
  suppressed_at: string | null;
  resend_contact_id: string | null;
};

class ResendSyncError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ResendSyncError';
  }
}

function requestId(req: Request) {
  return req.headers.get('x-pickla-request-id') || req.headers.get('x-request-id') || crypto.randomUUID();
}

function endpoint(req: Request) {
  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  const functionIndex = parts.lastIndexOf('api-communications');
  return functionIndex >= 0 ? parts.slice(functionIndex + 1).join('/') : '';
}

async function picklaOrganization(admin: AdminClient) {
  const { data, error } = await admin
    .from('organizations')
    .select('id')
    .eq('slug', PICKLA_ORGANIZATION_SLUG)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error('Pickla organization is not configured');
  return data.id as string;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function base64ToBytes(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}

async function verifyResendWebhook(req: Request) {
  const raw = await req.text();
  const secret = Deno.env.get('RESEND_COMMUNICATIONS_WEBHOOK_SECRET');
  if (!secret) throw new Error('Webhook is not configured');

  const id = req.headers.get('svix-id') || '';
  const timestamp = req.headers.get('svix-timestamp') || '';
  const signatureHeader = req.headers.get('svix-signature') || '';
  if (!id || !timestamp || !signatureHeader) throw new Error('Invalid webhook');

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) {
    throw new Error('Invalid webhook');
  }

  const signedContent = `${id}.${timestamp}.${raw}`;
  const keyBytes = base64ToBytes(secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent)));
  const signatures = signatureHeader
    .split(' ')
    .flatMap((part) => part.split(','))
    .filter((part) => part && part !== 'v1');
  if (!signatures.some((signature) => constantTimeEqual(base64ToBytes(signature), expected))) {
    throw new Error('Invalid webhook');
  }

  return {
    id,
    raw,
    event: JSON.parse(raw) as Record<string, unknown>,
  };
}

async function resendRequest(path: string, method: 'POST' | 'PATCH', body: Record<string, unknown>) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) throw new ResendSyncError(0, 'Resend API key is not configured');
  const response = await fetch(`${RESEND_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.message === 'string' ? payload.message : `Resend sync failed (${response.status})`;
    throw new ResendSyncError(response.status, message.slice(0, 300));
  }
  return payload as Record<string, unknown>;
}

async function syncResendContact(subscriber: SubscriberRow, subscribed: boolean) {
  const topicId = Deno.env.get('RESEND_NEWS_COMMUNITY_TOPIC_ID');
  if (!Deno.env.get('RESEND_API_KEY') || !topicId) {
    return { status: 'not_configured' as const, contactId: subscriber.resend_contact_id, error: null };
  }

  const topicSubscription = subscribed ? 'opt_in' : 'opt_out';
  let contactId = subscriber.resend_contact_id;
  try {
    const created = await resendRequest('/contacts', 'POST', {
      email: subscriber.email,
      ...(subscriber.first_name ? { first_name: subscriber.first_name } : {}),
      unsubscribed: !subscribed,
      topics: [{ id: topicId, subscription: topicSubscription }],
    });
    contactId = typeof created.id === 'string' ? created.id : contactId;
  } catch (error) {
    if (!(error instanceof ResendSyncError) || error.status !== 409) throw error;
    const identifier = encodeURIComponent(contactId || subscriber.email);
    const updated = await resendRequest(`/contacts/${identifier}`, 'PATCH', {
      ...(subscriber.first_name ? { first_name: subscriber.first_name } : {}),
      unsubscribed: !subscribed,
    });
    contactId = typeof updated.id === 'string' ? updated.id : contactId;
    await resendRequest(`/contacts/${encodeURIComponent(contactId || subscriber.email)}/topics`, 'PATCH', {
      topics: [{ id: topicId, subscription: topicSubscription }],
    });
  }

  return { status: 'synced' as const, contactId, error: null };
}

async function persistSyncResult(
  admin: AdminClient,
  subscriberId: string,
  result: { status: 'synced' | 'failed' | 'not_configured'; contactId?: string | null; error?: string | null },
) {
  await admin
    .from('communication_subscribers')
    .update({
      resend_contact_id: result.contactId || null,
      resend_sync_status: result.status,
      resend_sync_error: result.error || null,
      resend_synced_at: result.status === 'synced' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', subscriberId);
}

async function synchronizeSubscriber(admin: AdminClient, subscriberId: string, topicStatus: string) {
  const { data, error } = await admin
    .from('communication_subscribers')
    .select('id, email, first_name, marketing_status, suppressed_at, resend_contact_id')
    .eq('id', subscriberId)
    .single();
  if (error || !data) throw new Error(error?.message || 'Subscriber not found');
  const subscriber = data as SubscriberRow;
  const eligible = isCanonicallyMarketingEligible({
    marketingStatus: subscriber.marketing_status,
    suppressedAt: subscriber.suppressed_at,
    preferenceStatus: topicStatus === 'subscribed' ? 'subscribed' : 'unsubscribed',
  });

  try {
    const result = await syncResendContact(subscriber, eligible);
    await persistSyncResult(admin, subscriberId, result);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : 'Unknown Resend sync failure';
    await persistSyncResult(admin, subscriberId, {
      status: 'failed',
      contactId: subscriber.resend_contact_id,
      error: message,
    });
    console.error('Pickla Mail Resend synchronization failed', {
      subscriber_id: subscriberId,
      error_class: error instanceof Error ? error.name : 'unknown',
    });
  }
}

async function matchingCustomerId(admin: AdminClient, organizationId: string, userId: string, email: string) {
  const fields = 'id, primary_email, email_normalized';
  const { data: authCustomer } = await admin
    .from('customers')
    .select(fields)
    .eq('organization_id', organizationId)
    .eq('auth_user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  if (authCustomer) {
    const customerEmail = normalizeCommunicationEmail(authCustomer.email_normalized || authCustomer.primary_email);
    if (customerEmail === email) return authCustomer.id as string;
  }

  const { data: emailCustomer } = await admin
    .from('customers')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('email_normalized', email)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  return emailCustomer?.id as string | undefined;
}

async function recordPreference({
  admin,
  organizationId,
  email,
  firstName,
  customerId,
  subscribed,
  source,
  req,
  actorUserId,
  syncProvider = true,
}: {
  admin: AdminClient;
  organizationId: string;
  email: string;
  firstName?: string | null;
  customerId?: string | null;
  subscribed: boolean;
  source: string;
  req: Request;
  actorUserId?: string | null;
  syncProvider?: boolean;
}) {
  const { data, error } = await admin.rpc('record_communication_preference', {
    p_organization_id: organizationId,
    p_email: email,
    p_first_name: firstName || null,
    p_customer_id: customerId || null,
    p_topic_key: PICKLA_MAIL_TOPIC,
    p_status: subscribed ? 'subscribed' : 'unsubscribed',
    p_source: source,
    p_policy_version: subscribed ? PICKLA_MAIL_POLICY_VERSION : null,
    p_consent_statement: subscribed ? PICKLA_MAIL_CONSENT_STATEMENT : null,
    p_request_id: requestId(req),
    p_actor_user_id: actorUserId || null,
  });
  if (error) throw new Error(error.message);
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.subscriber_id) throw new Error('Communication preference was not recorded');
  if (syncProvider) await synchronizeSubscriber(admin, result.subscriber_id, result.preference_status);
  return result as {
    subscriber_id: string;
    preference_status: 'subscribed' | 'unsubscribed';
    marketing_status: 'active' | 'unsubscribed';
    is_suppressed: boolean;
  };
}

async function publicSubscribe(req: Request, admin: AdminClient) {
  const body = await req.json().catch(() => ({}));
  if (String(body.website || '').trim()) return jsonResponse({ accepted: true });

  const email = normalizeCommunicationEmail(body.email);
  if (!isValidCommunicationEmail(email)) return errorResponse('Ange en giltig e-postadress', 400);
  if (body.consent !== true) return errorResponse('Du behöver aktivt godkänna e-postutskicken', 400);
  const requestedSource = String(body.source || 'public_web');
  const source = PUBLIC_SUBSCRIBE_SOURCES.has(requestedSource) ? requestedSource : 'public_web';
  const organizationId = await picklaOrganization(admin);
  await recordPreference({
    admin,
    organizationId,
    email,
    firstName: sanitizeFirstName(body.firstName),
    subscribed: true,
    source,
    req,
  });

  // The response deliberately does not reveal whether the address was new,
  // already subscribed, linked to a customer, or suppressed.
  return jsonResponse({ accepted: true });
}

async function authenticatedIdentity(req: Request) {
  const auth = await getAuthenticatedClient(req);
  if (auth.error || !auth.userId || !auth.user) throw new Error('Unauthorized');
  const email = normalizeCommunicationEmail(auth.user.email);
  if (!isValidCommunicationEmail(email) || !auth.user.email_confirmed_at) throw new Error('Verified email required');
  return { userId: auth.userId, email, user: auth.user };
}

async function preferenceState(req: Request, admin: AdminClient) {
  const identity = await authenticatedIdentity(req);
  const organizationId = await picklaOrganization(admin);
  const customerId = await matchingCustomerId(admin, organizationId, identity.userId, identity.email);
  const { data: subscriber } = await admin
    .from('communication_subscribers')
    .select('id, customer_id, marketing_status, suppressed_at, communication_preferences(status, topic_key)')
    .eq('organization_id', organizationId)
    .eq('email_normalized', identity.email)
    .maybeSingle();

  if (subscriber?.id && customerId && !subscriber.customer_id) {
    // Calling the idempotent preference RPC with the current state links a
    // verified account without creating a second marketing identity.
    const preferences = Array.isArray(subscriber.communication_preferences)
      ? subscriber.communication_preferences
      : [];
    const current = preferences.find((row: { topic_key?: string }) => row.topic_key === PICKLA_MAIL_TOPIC);
    if (current?.status) {
      await recordPreference({
        admin,
        organizationId,
        email: identity.email,
        firstName: sanitizeFirstName(identity.user.user_metadata?.first_name),
        customerId,
        subscribed: current.status === 'subscribed',
        source: 'verified_account_email',
        req,
        actorUserId: identity.userId,
      });
    }
  }

  const { data: refreshed } = await admin
    .from('communication_subscribers')
    .select('marketing_status, suppressed_at, communication_preferences(status, topic_key)')
    .eq('organization_id', organizationId)
    .eq('email_normalized', identity.email)
    .maybeSingle();
  const preferences = Array.isArray(refreshed?.communication_preferences)
    ? refreshed.communication_preferences
    : [];
  const preference = preferences.find((row: { topic_key?: string }) => row.topic_key === PICKLA_MAIL_TOPIC);
  const subscribed = refreshed
    ? isCanonicallyMarketingEligible({
      marketingStatus: refreshed.marketing_status,
      suppressedAt: refreshed.suppressed_at,
      preferenceStatus: preference?.status || null,
    })
    : false;
  return privateJsonResponse({
    topic: PICKLA_MAIL_TOPIC,
    label: PICKLA_MAIL_TOPIC_LABEL,
    subscribed,
    suppressed: Boolean(refreshed?.suppressed_at),
  });
}

async function updateAuthenticatedPreference(req: Request, admin: AdminClient) {
  const identity = await authenticatedIdentity(req);
  const body = await req.json().catch(() => ({}));
  if (typeof body.subscribed !== 'boolean') return privateErrorResponse('Ogiltig inställning', 400);
  const organizationId = await picklaOrganization(admin);
  const customerId = await matchingCustomerId(admin, organizationId, identity.userId, identity.email);
  const result = await recordPreference({
    admin,
    organizationId,
    email: identity.email,
    firstName: sanitizeFirstName(identity.user.user_metadata?.first_name),
    customerId,
    subscribed: body.subscribed,
    source: 'account_settings',
    req,
    actorUserId: identity.userId,
  });
  return privateJsonResponse({
    topic: PICKLA_MAIL_TOPIC,
    label: PICKLA_MAIL_TOPIC_LABEL,
    subscribed: result.preference_status === 'subscribed'
      && result.marketing_status === 'active'
      && !result.is_suppressed,
    suppressed: result.is_suppressed,
  });
}

function unsubscribeHtml() {
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>E-postinställning · Pickla</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fffaf7;color:#071126;font-family:Inter,system-ui,sans-serif}.card{width:min(520px,calc(100% - 32px));box-sizing:border-box;padding:36px;border:1px solid rgba(7,17,38,.14);border-radius:28px;background:white;box-shadow:0 20px 60px rgba(7,17,38,.1)}.tag{font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#b62068}h1{margin:14px 0;font-size:clamp(34px,8vw,54px);line-height:1}p{line-height:1.6;color:#566176}a{display:inline-flex;margin-top:14px;color:#071126;font-weight:800}</style></head><body><main class="card"><p class="tag">Pickla Mail</p><h1>Klart.</h1><p>Om länken hör till en prenumeration är Pickla news &amp; community nu avslutad. Nödvändiga boknings-, betalnings- och konto­mail påverkas inte.</p><a href="https://playpickla.com">Till Pickla</a></main></body></html>`;
}

async function unsubscribeWithToken(req: Request, admin: AdminClient) {
  const token = new URL(req.url).searchParams.get('token') || '';
  const secret = Deno.env.get('COMMUNICATION_UNSUBSCRIBE_SECRET') || '';
  const subscriberId = await verifyOpaqueUnsubscribeToken(token, secret);
  if (subscriberId) {
    const { data: subscriber } = await admin
      .from('communication_subscribers')
      .select('id, organization_id, customer_id, email, first_name')
      .eq('id', subscriberId)
      .maybeSingle();
    if (subscriber?.id) {
      await recordPreference({
        admin,
        organizationId: subscriber.organization_id,
        email: subscriber.email,
        firstName: subscriber.first_name,
        customerId: subscriber.customer_id,
        subscribed: false,
        source: req.method === 'POST' ? 'list_unsubscribe_one_click' : 'email_unsubscribe_link',
        req,
      });
    }
  }

  if (req.headers.get('accept')?.includes('application/json')) {
    return jsonResponse({ accepted: true });
  }
  return new Response(unsubscribeHtml(), {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

async function handleWebhook(req: Request, admin: AdminClient) {
  let verified: Awaited<ReturnType<typeof verifyResendWebhook>>;
  try {
    verified = await verifyResendWebhook(req);
  } catch {
    return errorResponse('Invalid webhook', 401);
  }

  const eventType = String(verified.event.type || 'unknown');
  const action = resendWebhookAction(verified.event);
  const payloadDigest = await sha256(verified.raw);
  const emailDigest = action.email ? await sha256(action.email) : null;
  const { data: existing } = await admin
    .from('communication_provider_events')
    .select('id, processing_status')
    .eq('provider', 'resend')
    .eq('provider_event_id', verified.id)
    .maybeSingle();
  if (existing?.processing_status === 'processed' || existing?.processing_status === 'ignored') {
    return jsonResponse({ received: true, duplicate: true });
  }

  let eventRowId = existing?.id as string | undefined;
  if (!eventRowId) {
    const { data: inserted, error: insertError } = await admin
      .from('communication_provider_events')
      .insert({
        provider: 'resend',
        provider_event_id: verified.id,
        event_type: eventType,
        payload_sha256: payloadDigest,
        email_sha256: emailDigest,
      })
      .select('id')
      .single();
    if (insertError?.code === '23505') return jsonResponse({ received: true, duplicate: true });
    if (insertError || !inserted?.id) return errorResponse('Webhook persistence failed', 500);
    eventRowId = inserted.id;
  }

  try {
    if ((action.kind === 'unsubscribe' || action.kind === 'suppress') && !action.email) {
      throw new Error('Webhook did not include a valid recipient');
    }
    let subscriberId: string | null = null;
    if (action.kind === 'unsubscribe' && action.email) {
      const organizationId = await picklaOrganization(admin);
      const result = await recordPreference({
        admin,
        organizationId,
        email: action.email,
        subscribed: false,
        source: 'resend_unsubscribe_webhook',
        req,
        syncProvider: false,
      });
      subscriberId = result.subscriber_id;
    } else if (action.kind === 'suppress' && action.email) {
      const organizationId = await picklaOrganization(admin);
      const { data, error } = await admin.rpc('suppress_communication_email', {
        p_organization_id: organizationId,
        p_email: action.email,
        p_reason: action.reason || 'provider_suppression',
        p_source: 'resend_webhook',
        p_provider: 'resend',
        p_provider_event_id: verified.id,
        p_request_id: requestId(req),
      });
      if (error) throw new Error(error.message);
      subscriberId = data as string;
    }
    if (subscriberId) {
      await admin.from('communication_subscribers').update({
        resend_sync_status: 'synced',
        resend_sync_error: null,
        resend_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', subscriberId);
    }

    const processingStatus = action.kind === 'ignore' || action.kind === 'observe' ? 'ignored' : 'processed';
    await admin.from('communication_provider_events').update({
      processing_status: processingStatus,
      processed_at: new Date().toISOString(),
      processing_error: null,
    }).eq('id', eventRowId);
    return jsonResponse({ received: true });
  } catch (error) {
    await admin.from('communication_provider_events').update({
      processing_status: 'failed',
      processing_error: error instanceof Error ? error.message.slice(0, 300) : 'Unknown processing error',
      processed_at: new Date().toISOString(),
    }).eq('id', eventRowId);
    return errorResponse('Webhook processing failed', 500);
  }
}

async function adminSummary(req: Request, admin: AdminClient) {
  const auth = await getAuthenticatedClient(req);
  if (auth.error || !auth.userId) return privateErrorResponse('Unauthorized', 401);
  try {
    await requireSuperAdmin(admin, auth.userId);
  } catch {
    return privateErrorResponse('Forbidden', 403);
  }
  const organizationId = await picklaOrganization(admin);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [active, newSubscribers, unsubscribes, suppressed, syncFailures] = await Promise.all([
    admin.from('communication_subscribers')
      .select('id, communication_preferences!inner(topic_key, status)', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('marketing_status', 'active')
      .is('suppressed_at', null)
      .eq('communication_preferences.topic_key', PICKLA_MAIL_TOPIC)
      .eq('communication_preferences.status', 'subscribed'),
    admin.from('communication_consent_events').select('id, communication_subscribers!inner(organization_id)', { count: 'exact', head: true })
      .eq('communication_subscribers.organization_id', organizationId).in('event_type', ['subscribe', 'resubscribe']).gte('occurred_at', since),
    admin.from('communication_consent_events').select('id, communication_subscribers!inner(organization_id)', { count: 'exact', head: true })
      .eq('communication_subscribers.organization_id', organizationId).eq('event_type', 'unsubscribe').gte('occurred_at', since),
    admin.from('communication_subscribers').select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId).not('suppressed_at', 'is', null),
    admin.from('communication_subscribers').select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId).eq('resend_sync_status', 'failed'),
  ]);
  const queryError = [active, newSubscribers, unsubscribes, suppressed, syncFailures].find((result) => result.error)?.error;
  if (queryError) return privateErrorResponse('Could not load communication summary', 500);
  return privateJsonResponse({
    topic: PICKLA_MAIL_TOPIC,
    topic_label: PICKLA_MAIL_TOPIC_LABEL,
    active_subscribers: active.count || 0,
    new_subscribers_30d: newSubscribers.count || 0,
    unsubscribes_30d: unsubscribes.count || 0,
    suppressed: suppressed.count || 0,
    sync_failures: syncFailures.count || 0,
    broadcast_send_available: false,
    provider: 'resend',
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const path = endpoint(req);
  const admin = getServiceClient();

  try {
    if (req.method === 'POST' && path === 'subscribe') return await publicSubscribe(req, admin);
    if (['GET', 'POST'].includes(req.method) && path === 'unsubscribe') return await unsubscribeWithToken(req, admin);
    if (req.method === 'POST' && path === 'webhook/resend') return await handleWebhook(req, admin);
    if (req.method === 'GET' && path === 'preference') return await preferenceState(req, admin);
    if (req.method === 'POST' && path === 'preference') return await updateAuthenticatedPreference(req, admin);
    if (req.method === 'GET' && path === 'admin-summary') return await adminSummary(req, admin);
    return errorResponse('Not found', 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message === 'Unauthorized' || message === 'Verified email required') return privateErrorResponse(message, 401);
    console.error('api-communications failed', { path, error_class: error instanceof Error ? error.name : 'unknown' });
    return errorResponse('Communication request failed', 500);
  }
});
