import {
  corsHeaders,
  errorResponse,
  htmlResponse,
  jsonResponse,
  privateErrorResponse,
  privateJsonResponse,
} from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import { requireSuperAdmin } from '../_shared/authorization.ts';
import {
  createOpaqueConfirmationToken,
  hmacScopeHashes,
  isCanonicallyMarketingEligible,
  isValidCommunicationEmail,
  normalizeCommunicationEmail,
  PICKLA_MAIL_ACCOUNT_CONSENT_NOTICE,
  PICKLA_MAIL_ACCOUNT_CONSENT_STATEMENT,
  PICKLA_MAIL_POLICY_VERSION,
  PICKLA_MAIL_PUBLIC_CONSENT_NOTICE,
  PICKLA_MAIL_PUBLIC_CONSENT_STATEMENT,
  PICKLA_MAIL_TOPIC,
  PICKLA_MAIL_TOPIC_LABEL,
  publicSendModeAllows,
  proxyCredentialIsAuthorized,
  renderPicklaConfirmationEmail,
  resendWebhookAction,
  sanitizeFirstName,
  secretRingIsReady,
  sha256Hex,
  verifyOpaqueConfirmationToken,
  verifyOpaqueUnsubscribeToken,
  type MarketingStatus,
  type PreferenceStatus,
} from '../_shared/communications.ts';

const PICKLA_ORGANIZATION_SLUG = 'pickla';
const RESEND_API_BASE = 'https://api.resend.com';
const EXPECTED_RESEND_DOMAIN = 'playpickla.com';
const EXPECTED_RESEND_TOPIC_NAME = 'Pickla news & community';
const PUBLIC_SUBSCRIBE_SOURCES = new Set(['public_web', 'public_web_root', 'event_editorial']);
const CONFIRMATION_PATH = '/mail/confirm';
const SETUP_CACHE_MS = 5 * 60 * 1000;

type AdminClient = ReturnType<typeof getServiceClient>;

type SubscriberRow = {
  id: string;
  email: string;
  first_name: string | null;
  marketing_status: MarketingStatus;
  suppressed_at: string | null;
  resend_contact_id: string | null;
};

type ProviderSetup = {
  checked_at: string;
  api_key_configured: boolean;
  domain_configured: boolean;
  domain_verified: boolean;
  sending_enabled: boolean;
  tracking_off: boolean;
  topic_configured: boolean;
  topic_name_valid: boolean;
  topic_default_opt_out: boolean;
  topic_public: boolean;
  ready: boolean;
};

class ResendSyncError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ResendSyncError';
  }
}

let providerSetupCache: { expiresAt: number; value: ProviderSetup } | null = null;

function requestId(req: Request) {
  const supplied = req.headers.get('x-pickla-request-id') || req.headers.get('x-request-id') || '';
  return /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : crypto.randomUUID();
}

function endpoint(req: Request) {
  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  const functionIndex = parts.lastIndexOf('api-communications');
  return functionIndex >= 0 ? parts.slice(functionIndex + 1).join('/') : '';
}

function confirmationSecrets() {
  return Deno.env.get('COMMUNICATION_CONFIRMATION_SECRETS') || '';
}

function unsubscribeSecrets() {
  return Deno.env.get('COMMUNICATION_UNSUBSCRIBE_SECRETS') || '';
}

function proxySecrets() {
  return Deno.env.get('COMMUNICATION_PROXY_SECRETS') || '';
}

function rateLimitSecrets() {
  return Deno.env.get('COMMUNICATION_RATE_LIMIT_SECRETS') || '';
}

function requestHasTrustedProxy(req: Request) {
  return proxyCredentialIsAuthorized(req.headers.get('x-pickla-mail-proxy'), proxySecrets());
}

function liveProxyGateIsReady(req: Request) {
  return Deno.env.get('COMMUNICATION_WAF_VERIFIED') === 'true' && requestHasTrustedProxy(req);
}

function publicOrigin() {
  const candidate = (Deno.env.get('COMMUNICATION_PUBLIC_ORIGIN') || 'https://playpickla.com').replace(/\/$/, '');
  const parsed = new URL(candidate);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Communication public origin is invalid');
  }
  return parsed.origin;
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

  return { id, raw, event: JSON.parse(raw) as Record<string, unknown> };
}

async function resendRequest(
  path: string,
  method: 'GET' | 'POST' | 'PATCH',
  body?: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) throw new ResendSyncError(0, 'Resend API key is not configured');
  const response = await fetch(`${RESEND_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.message === 'string' ? payload.message : `Resend request failed (${response.status})`;
    throw new ResendSyncError(response.status, message.slice(0, 300));
  }
  return payload as Record<string, unknown>;
}

async function inspectResendSetup(force = false): Promise<ProviderSetup> {
  if (!force && providerSetupCache && providerSetupCache.expiresAt > Date.now()) return providerSetupCache.value;

  const apiKey = Deno.env.get('RESEND_API_KEY') || '';
  const domainId = Deno.env.get('RESEND_DOMAIN_ID') || '';
  const topicId = Deno.env.get('RESEND_NEWS_COMMUNITY_TOPIC_ID') || '';
  const setup: ProviderSetup = {
    checked_at: new Date().toISOString(),
    api_key_configured: Boolean(apiKey),
    domain_configured: Boolean(domainId),
    domain_verified: false,
    sending_enabled: false,
    tracking_off: false,
    topic_configured: Boolean(topicId),
    topic_name_valid: false,
    topic_default_opt_out: false,
    topic_public: false,
    ready: false,
  };

  if (!apiKey || !domainId || !topicId) return setup;

  const [domain, topic] = await Promise.all([
    resendRequest(`/domains/${encodeURIComponent(domainId)}`, 'GET'),
    resendRequest(`/topics/${encodeURIComponent(topicId)}`, 'GET'),
  ]);
  const capabilities = domain.capabilities && typeof domain.capabilities === 'object'
    ? domain.capabilities as Record<string, unknown>
    : {};
  setup.domain_verified = domain.name === EXPECTED_RESEND_DOMAIN && domain.status === 'verified';
  setup.sending_enabled = capabilities.sending === 'enabled';
  setup.tracking_off = domain.open_tracking === false && domain.click_tracking === false;
  setup.topic_name_valid = topic.name === EXPECTED_RESEND_TOPIC_NAME;
  setup.topic_default_opt_out = topic.default_subscription === 'opt_out';
  setup.topic_public = topic.visibility === 'public';
  setup.ready = setup.domain_verified
    && setup.sending_enabled
    && setup.tracking_off
    && setup.topic_name_valid
    && setup.topic_default_opt_out
    && setup.topic_public;
  providerSetupCache = { expiresAt: Date.now() + SETUP_CACHE_MS, value: setup };
  return setup;
}

async function syncResendContact(subscriber: SubscriberRow, subscribed: boolean) {
  const setup = await inspectResendSetup();
  const topicId = Deno.env.get('RESEND_NEWS_COMMUNITY_TOPIC_ID') || '';
  if (!setup.ready) throw new ResendSyncError(0, 'Resend domain/topic safety gate is not ready');

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
  result: { status: 'synced' | 'failed'; contactId?: string | null; error?: string | null },
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

async function synchronizeSubscriber(admin: AdminClient, subscriberId: string) {
  const { data, error } = await admin
    .from('communication_subscribers')
    .select('id, email, first_name, marketing_status, suppressed_at, resend_contact_id, communication_preferences!inner(topic_key, status, confirmed_at)')
    .eq('id', subscriberId)
    .eq('communication_preferences.topic_key', PICKLA_MAIL_TOPIC)
    .single();
  if (error || !data) throw new Error(error?.message || 'Subscriber not found');
  const subscriber = data as SubscriberRow;
  const rawPreferences = (data as Record<string, unknown>).communication_preferences;
  const preference = (Array.isArray(rawPreferences) ? rawPreferences[0] : rawPreferences) as {
    status?: PreferenceStatus;
    confirmed_at?: string | null;
  } | null;
  const subscribed = isCanonicallyMarketingEligible({
    marketingStatus: subscriber.marketing_status,
    suppressedAt: subscriber.suppressed_at,
    preferenceStatus: preference?.status || 'unsubscribed',
    confirmedAt: preference?.confirmed_at || null,
  });

  try {
    const result = await syncResendContact(subscriber, subscribed);
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

function clientNetworkAddress(req: Request) {
  const proxied = requestHasTrustedProxy(req) ? req.headers.get('x-pickla-client-network')?.trim() : '';
  if (proxied && /^[0-9a-f.:]{3,64}$/i.test(proxied)) return proxied;
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return req.headers.get('cf-connecting-ip')?.trim()
    || req.headers.get('x-real-ip')?.trim()
    || forwarded
    || null;
}

async function consumeRateLimit(
  admin: AdminClient,
  action: string,
  scope: string,
  limit: number,
  windowSeconds: number,
  blockSeconds: number,
) {
  const scopeHashes = await hmacScopeHashes(`${action}:${scope}`, rateLimitSecrets());
  const results = await Promise.all(scopeHashes.map((scopeHash) => admin.rpc('check_communication_rate_limit', {
    p_action_key: action,
    p_scope_hash: scopeHash,
    p_limit: limit,
    p_window_seconds: windowSeconds,
    p_block_seconds: blockSeconds,
  })));
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(failed.error.message);
  return results.every((result) => result.data === true);
}

async function enforcePublicSubscribeRateLimit(req: Request, admin: AdminClient, email: string) {
  const network = clientNetworkAddress(req);
  if (!network) throw new Error('Client network identity is unavailable');
  const [emailAllowed, networkAllowed] = await Promise.all([
    consumeRateLimit(admin, 'public_subscribe_email', email, 3, 15 * 60, 60 * 60),
    consumeRateLimit(admin, 'public_subscribe_network', network, 10, 15 * 60, 60 * 60),
  ]);
  return emailAllowed && networkAllowed;
}

async function markConfirmationDelivery(
  admin: AdminClient,
  subscriberId: string,
  tokenHash: string,
  result: { status: 'sent' | 'failed'; messageId?: string | null; error?: string | null },
) {
  await admin
    .from('communication_preferences')
    .update({
      confirmation_delivery_status: result.status,
      confirmation_delivery_error: result.error?.slice(0, 300) || null,
      confirmation_message_id: result.messageId || null,
      confirmation_sent_at: result.status === 'sent' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('subscriber_id', subscriberId)
    .eq('topic_key', PICKLA_MAIL_TOPIC)
    .eq('confirmation_token_hash', tokenHash)
    .eq('status', 'pending_confirmation');
}

async function sendConfirmationEmail(email: string, token: string, tokenHash: string) {
  const setup = await inspectResendSetup(true);
  if (!setup.ready) throw new ResendSyncError(0, 'Resend domain/topic safety gate is not ready');
  const confirmUrl = `${publicOrigin()}${CONFIRMATION_PATH}?token=${encodeURIComponent(token)}`;
  const content = renderPicklaConfirmationEmail(confirmUrl);
  const payload = await resendRequest('/emails', 'POST', {
    from: 'Pickla <hello@playpickla.com>',
    to: [email],
    subject: content.subject,
    html: content.html,
    text: content.text,
    tags: [{ name: 'category', value: 'confirm_email' }],
  }, { 'Idempotency-Key': `pickla-confirm-${tokenHash.slice(0, 48)}` });
  return typeof payload.id === 'string' ? payload.id : null;
}

async function publicSubscribe(req: Request, admin: AdminClient) {
  const body = await req.json().catch(() => ({}));
  if (String(body.website || '').trim()) return jsonResponse({ accepted: true, confirmation_required: true }, 202);

  const email = normalizeCommunicationEmail(body.email);
  if (!isValidCommunicationEmail(email)) return errorResponse('Enter a valid email address', 400);
  if (body.consent !== true) return errorResponse('Active email consent is required', 400);
  if (body.audience !== 'adult_or_parent_guardian') return errorResponse('This signup is for adults', 400);

  let allowed: boolean;
  try {
    allowed = await enforcePublicSubscribeRateLimit(req, admin, email);
  } catch {
    return errorResponse('Signup protection is not configured', 503);
  }
  if (!allowed) return errorResponse('Too many attempts. Try again later.', 429);

  const sendMode = Deno.env.get('COMMUNICATION_SEND_MODE') || 'canary';
  const canaryEmails = Deno.env.get('COMMUNICATION_CANARY_EMAILS') || '';
  if (sendMode === 'live' && !liveProxyGateIsReady(req)) {
    return errorResponse('Signup protection is not configured', 503);
  }
  if (!publicSendModeAllows(email, sendMode, canaryEmails)) {
    return jsonResponse({ accepted: true, confirmation_required: true }, 202);
  }

  const requestedSource = String(body.source || 'public_web');
  const source = PUBLIC_SUBSCRIBE_SOURCES.has(requestedSource) ? requestedSource : 'public_web';
  const createdToken = await createOpaqueConfirmationToken(confirmationSecrets());
  const tokenHash = await sha256Hex(createdToken.token);
  const organizationId = await picklaOrganization(admin);
  const { data, error } = await admin.rpc('begin_communication_confirmation', {
    p_organization_id: organizationId,
    p_email: email,
    p_first_name: sanitizeFirstName(body.firstName),
    p_topic_key: PICKLA_MAIL_TOPIC,
    p_source: source,
    p_policy_version: PICKLA_MAIL_POLICY_VERSION,
    p_consent_statement: PICKLA_MAIL_PUBLIC_CONSENT_STATEMENT,
    p_consent_notice: PICKLA_MAIL_PUBLIC_CONSENT_NOTICE,
    p_confirmation_token_hash: tokenHash,
    p_confirmation_expires_at: createdToken.expiresAt,
    p_request_id: requestId(req),
  });
  if (error) throw new Error(error.message);
  const result = Array.isArray(data) ? data[0] : data;

  if (result?.subscriber_id && result.should_send_confirmation === true) {
    try {
      const messageId = await sendConfirmationEmail(email, createdToken.token, tokenHash);
      await markConfirmationDelivery(admin, result.subscriber_id, tokenHash, { status: 'sent', messageId });
    } catch (sendError) {
      await markConfirmationDelivery(admin, result.subscriber_id, tokenHash, {
        status: 'failed',
        error: sendError instanceof Error ? sendError.message : 'Confirmation delivery failed',
      });
      console.error('Pickla Mail confirmation delivery failed', {
        subscriber_id: result.subscriber_id,
        error_class: sendError instanceof Error ? sendError.name : 'unknown',
      });
    }
  }

  // Non-enumerating response for new, existing, subscribed, or suppressed identities.
  return jsonResponse({ accepted: true, confirmation_required: true }, 202);
}

function confirmationHtml(result: 'confirmed' | 'invalid') {
  const confirmed = result === 'confirmed';
  const heading = confirmed ? "You're in 🥒" : 'This link is no longer valid.';
  const body = confirmed
    ? 'Pickla news & community is now confirmed. Welcome to the loop.'
    : 'No subscription was activated. Return to Pickla and request a new confirmation email.';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Email confirmation · Pickla</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fffaf7;color:#071126;font-family:Inter,system-ui,sans-serif}.card{width:min(560px,calc(100% - 32px));box-sizing:border-box;padding:clamp(28px,7vw,52px);border-radius:28px;background:#071126;color:#fff;box-shadow:0 20px 60px rgba(7,17,38,.16)}.tag{margin:0;color:#32efa0;font-size:12px;font-weight:850;letter-spacing:.16em;text-transform:uppercase}h1{margin:14px 0;font-size:clamp(36px,9vw,58px);line-height:1}p{line-height:1.65;color:#dbe3f1}a{display:inline-flex;margin-top:14px;padding:14px 18px;border-radius:14px;background:#f43278;color:#071126;font-weight:900;text-decoration:none}</style></head><body><main class="card"><p class="tag">Pickla Mail</p><h1>${heading}</h1><p>${body}</p><a href="https://playpickla.com">Go to Pickla</a></main></body></html>`;
}

async function confirmWithToken(req: Request, admin: AdminClient) {
  if ((Deno.env.get('COMMUNICATION_SEND_MODE') || 'canary') === 'live' && !liveProxyGateIsReady(req)) {
    return htmlResponse(confirmationHtml('invalid'));
  }
  const token = new URL(req.url).searchParams.get('token') || '';
  const network = clientNetworkAddress(req);
  if (!network) return htmlResponse(confirmationHtml('invalid'));
  try {
    const allowed = await consumeRateLimit(admin, 'confirm_network', network, 30, 15 * 60, 60 * 60);
    if (!allowed) return htmlResponse(confirmationHtml('invalid'), 429);
  } catch {
    return htmlResponse(confirmationHtml('invalid'), 503);
  }

  const verified = await verifyOpaqueConfirmationToken(token, confirmationSecrets());
  if (!verified) return htmlResponse(confirmationHtml('invalid'));
  const tokenHash = await sha256Hex(token);
  const { data, error } = await admin.rpc('confirm_communication_preference', {
    p_confirmation_token_hash: tokenHash,
    p_source: 'double_opt_in_email',
    p_request_id: requestId(req),
  });
  if (error) throw new Error(error.message);
  const result = Array.isArray(data) ? data[0] : data;
  const confirmed = result?.confirmation_result === 'confirmed'
    || result?.confirmation_result === 'already_confirmed';
  if (confirmed && result?.subscriber_id) {
    await synchronizeSubscriber(admin, result.subscriber_id);
  }
  return htmlResponse(confirmationHtml(confirmed ? 'confirmed' : 'invalid'));
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
    p_consent_statement: subscribed ? PICKLA_MAIL_ACCOUNT_CONSENT_STATEMENT : null,
    p_consent_notice: subscribed ? PICKLA_MAIL_ACCOUNT_CONSENT_NOTICE : null,
    p_request_id: requestId(req),
    p_actor_user_id: actorUserId || null,
  });
  if (error) throw new Error(error.message);
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.subscriber_id) throw new Error('Communication preference was not recorded');
  if (syncProvider && result.marketing_status !== 'suppressed') {
    await synchronizeSubscriber(admin, result.subscriber_id);
  }
  return result as {
    subscriber_id: string;
    preference_status: PreferenceStatus;
    marketing_status: MarketingStatus;
    is_suppressed: boolean;
  };
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
  const { data: subscriber } = await admin
    .from('communication_subscribers')
    .select('marketing_status, suppressed_at, communication_preferences(status, topic_key, confirmed_at, confirmation_expires_at)')
    .eq('organization_id', organizationId)
    .eq('email_normalized', identity.email)
    .maybeSingle();
  const preferences = Array.isArray(subscriber?.communication_preferences)
    ? subscriber.communication_preferences
    : [];
  const preference = preferences.find((row: { topic_key?: string }) => row.topic_key === PICKLA_MAIL_TOPIC);
  const eligible = subscriber
    ? isCanonicallyMarketingEligible({
      marketingStatus: subscriber.marketing_status,
      suppressedAt: subscriber.suppressed_at,
      preferenceStatus: preference?.status || null,
      confirmedAt: preference?.confirmed_at || null,
    })
    : false;
  const status: MarketingStatus = subscriber?.marketing_status === 'suppressed'
    ? 'suppressed'
    : subscriber?.marketing_status === 'pending_confirmation'
      ? 'pending_confirmation'
      : eligible
        ? 'subscribed'
        : 'unsubscribed';
  return privateJsonResponse({
    topic: PICKLA_MAIL_TOPIC,
    label: PICKLA_MAIL_TOPIC_LABEL,
    status,
    subscribed: status === 'subscribed',
    suppressed: status === 'suppressed',
    confirmation_expires_at: status === 'pending_confirmation' ? preference?.confirmation_expires_at || null : null,
  });
}

async function updateAuthenticatedPreference(req: Request, admin: AdminClient) {
  const identity = await authenticatedIdentity(req);
  const body = await req.json().catch(() => ({}));
  if (typeof body.subscribed !== 'boolean') return privateErrorResponse('Ogiltig inställning', 400);
  if (body.subscribed && body.audience !== 'adult_or_parent_guardian') {
    return privateErrorResponse('Inställningen är endast för vuxna eller vårdnadshavare', 400);
  }
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
  const status: MarketingStatus = result.is_suppressed
    ? 'suppressed'
    : result.marketing_status;
  return privateJsonResponse({
    topic: PICKLA_MAIL_TOPIC,
    label: PICKLA_MAIL_TOPIC_LABEL,
    status,
    subscribed: status === 'subscribed',
    suppressed: status === 'suppressed',
    confirmation_expires_at: null,
  });
}

function unsubscribeHtml() {
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>E-postinställning · Pickla</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fffaf7;color:#071126;font-family:Inter,system-ui,sans-serif}.card{width:min(520px,calc(100% - 32px));box-sizing:border-box;padding:36px;border:1px solid rgba(7,17,38,.14);border-radius:28px;background:white;box-shadow:0 20px 60px rgba(7,17,38,.1)}.tag{font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#b62068}h1{margin:14px 0;font-size:clamp(34px,8vw,54px);line-height:1}p{line-height:1.6;color:#566176}a{display:inline-flex;margin-top:14px;color:#071126;font-weight:800}</style></head><body><main class="card"><p class="tag">Pickla Mail</p><h1>Klart.</h1><p>Om länken hör till en prenumeration är Pickla news &amp; community nu avslutad. Nödvändiga boknings-, betalnings- och kontomail påverkas inte.</p><a href="https://playpickla.com">Till Pickla</a></main></body></html>`;
}

async function unsubscribeWithToken(req: Request, admin: AdminClient) {
  const token = new URL(req.url).searchParams.get('token') || '';
  const subscriberId = await verifyOpaqueUnsubscribeToken(token, unsubscribeSecrets());
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
  if (req.headers.get('accept')?.includes('application/json')) return jsonResponse({ accepted: true });
  return htmlResponse(unsubscribeHtml());
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
  const payloadDigest = await sha256Hex(verified.raw);
  const emailDigest = action.email ? await sha256Hex(action.email) : null;
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
  const [active, pending, newSubscribers, unsubscribes, suppressed, bounces, complaints, syncFailures, confirmationFailures] = await Promise.all([
    admin.from('communication_subscribers')
      .select('id, communication_preferences!inner(topic_key, status, confirmed_at)', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('marketing_status', 'subscribed')
      .eq('communication_preferences.topic_key', PICKLA_MAIL_TOPIC)
      .eq('communication_preferences.status', 'subscribed')
      .not('communication_preferences.confirmed_at', 'is', null),
    admin.from('communication_subscribers').select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId).eq('marketing_status', 'pending_confirmation'),
    admin.from('communication_consent_events').select('id, communication_subscribers!inner(organization_id)', { count: 'exact', head: true })
      .eq('communication_subscribers.organization_id', organizationId).in('event_type', ['subscribe', 'resubscribe']).gte('occurred_at', since),
    admin.from('communication_consent_events').select('id, communication_subscribers!inner(organization_id)', { count: 'exact', head: true })
      .eq('communication_subscribers.organization_id', organizationId).eq('event_type', 'unsubscribe').gte('occurred_at', since),
    admin.from('communication_subscribers').select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId).eq('marketing_status', 'suppressed'),
    admin.from('communication_consent_events')
      .select('id, communication_subscribers!inner(organization_id)', { count: 'exact', head: true })
      .eq('communication_subscribers.organization_id', organizationId)
      .eq('event_type', 'suppress')
      .contains('metadata', { reason: 'hard_bounce' }),
    admin.from('communication_consent_events')
      .select('id, communication_subscribers!inner(organization_id)', { count: 'exact', head: true })
      .eq('communication_subscribers.organization_id', organizationId)
      .eq('event_type', 'suppress')
      .contains('metadata', { reason: 'spam_complaint' }),
    admin.from('communication_subscribers').select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId).eq('resend_sync_status', 'failed'),
    admin.from('communication_preferences')
      .select('id, communication_subscribers!inner(organization_id)', { count: 'exact', head: true })
      .eq('communication_subscribers.organization_id', organizationId)
      .eq('confirmation_delivery_status', 'failed'),
  ]);
  const results = [active, pending, newSubscribers, unsubscribes, suppressed, bounces, complaints, syncFailures, confirmationFailures];
  const queryError = results.find((result) => result.error)?.error;
  if (queryError) return privateErrorResponse('Could not load communication summary', 500);

  let providerSetup: ProviderSetup;
  try {
    providerSetup = await inspectResendSetup(true);
  } catch {
    providerSetup = {
      checked_at: new Date().toISOString(),
      api_key_configured: Boolean(Deno.env.get('RESEND_API_KEY')),
      domain_configured: Boolean(Deno.env.get('RESEND_DOMAIN_ID')),
      domain_verified: false,
      sending_enabled: false,
      tracking_off: false,
      topic_configured: Boolean(Deno.env.get('RESEND_NEWS_COMMUNITY_TOPIC_ID')),
      topic_name_valid: false,
      topic_default_opt_out: false,
      topic_public: false,
      ready: false,
    };
  }
  const sendMode = Deno.env.get('COMMUNICATION_SEND_MODE') || 'canary';
  const gates = {
    send_mode: sendMode,
    canary_allowlist_configured: Boolean((Deno.env.get('COMMUNICATION_CANARY_EMAILS') || '').trim()),
    rate_limit_secret_ring_configured: secretRingIsReady(rateLimitSecrets()),
    confirmation_secret_ring_configured: secretRingIsReady(confirmationSecrets()),
    unsubscribe_secret_ring_configured: secretRingIsReady(unsubscribeSecrets()),
    proxy_secret_ring_configured: secretRingIsReady(proxySecrets()),
    webhook_secret_configured: Boolean(Deno.env.get('RESEND_COMMUNICATIONS_WEBHOOK_SECRET')),
    waf_verified: Deno.env.get('COMMUNICATION_WAF_VERIFIED') === 'true',
  };
  return privateJsonResponse({
    topic: PICKLA_MAIL_TOPIC,
    topic_label: PICKLA_MAIL_TOPIC_LABEL,
    active_subscribers: active.count || 0,
    pending_confirmations: pending.count || 0,
    new_subscribers_30d: newSubscribers.count || 0,
    unsubscribes_30d: unsubscribes.count || 0,
    suppressed: suppressed.count || 0,
    bounces: bounces.count || 0,
    complaints: complaints.count || 0,
    sync_failures: syncFailures.count || 0,
    confirmation_delivery_failures: confirmationFailures.count || 0,
    provider_setup: providerSetup,
    production_gates: gates,
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
    if (req.method === 'GET' && path === 'confirm') return await confirmWithToken(req, admin);
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
