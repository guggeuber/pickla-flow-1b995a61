export const PICKLA_MAIL_TOPIC = 'news_community';
export const PICKLA_MAIL_TOPIC_LABEL = 'Pickla news & community';
export const PICKLA_MAIL_POLICY_VERSION = 'pickla-mail-v1-2026-09-18';
export const PICKLA_MAIL_CONSENT_STATEMENT =
  'Ja, jag vill få Pickla news & community via e-post. Jag kan avsluta när som helst. Läs vår integritetspolicy.';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CanonicalMarketingState = {
  marketingStatus: 'active' | 'unsubscribed';
  suppressedAt?: string | null;
  preferenceStatus?: 'subscribed' | 'unsubscribed' | null;
};

export type ResendWebhookAction = {
  kind: 'unsubscribe' | 'suppress' | 'observe' | 'ignore';
  email: string | null;
  reason?: string;
};

export function normalizeCommunicationEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

export function isValidCommunicationEmail(value: unknown) {
  const email = normalizeCommunicationEmail(value);
  return email.length >= 3 && email.length <= 320 && EMAIL_PATTERN.test(email);
}

export function sanitizeFirstName(value: unknown) {
  const firstName = String(value || '').trim().replace(/\s+/g, ' ');
  return firstName ? firstName.slice(0, 80) : null;
}

export function isCanonicallyMarketingEligible(state: CanonicalMarketingState) {
  return state.marketingStatus === 'active'
    && !state.suppressedAt
    && state.preferenceStatus === 'subscribed';
}

export function isTransactionalEmailAllowed() {
  // Marketing preference is deliberately not an input. Necessary service
  // communication follows its own purpose and legal/operational contract.
  return true;
}

function firstRecipient(data: Record<string, unknown>) {
  const direct = normalizeCommunicationEmail(data.email);
  if (isValidCommunicationEmail(direct)) return direct;
  const recipients = Array.isArray(data.to) ? data.to : [];
  const candidate = normalizeCommunicationEmail(recipients[0]);
  return isValidCommunicationEmail(candidate) ? candidate : null;
}

export function resendWebhookAction(event: Record<string, unknown>): ResendWebhookAction {
  const type = String(event.type || '');
  const data = event.data && typeof event.data === 'object'
    ? event.data as Record<string, unknown>
    : {};
  const email = firstRecipient(data);

  if (type === 'contact.updated' && data.unsubscribed === true) {
    return { kind: 'unsubscribe', email };
  }
  if (type === 'suppression.added') {
    return {
      kind: 'suppress',
      email,
      reason: String(data.origin || 'provider_suppression'),
    };
  }
  if (type === 'email.bounced') return { kind: 'suppress', email, reason: 'hard_bounce' };
  if (type === 'email.complained') return { kind: 'suppress', email, reason: 'spam_complaint' };
  if (type === 'email.suppressed') return { kind: 'suppress', email, reason: 'provider_suppression' };
  if (['email.delivered', 'email.sent', 'email.delivery_delayed'].includes(type)) {
    return { kind: 'observe', email };
  }

  // Provider-side opt-in, suppression removal, or contact creation is never
  // allowed to reactivate Pickla consent. Only an explicit Pickla action can.
  return { kind: 'ignore', email };
}

function bytesToBase64Url(value: Uint8Array) {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function hmac(message: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}

export async function createOpaqueUnsubscribeToken(subscriberId: string, secret: string) {
  if (!UUID_PATTERN.test(subscriberId) || secret.length < 32) throw new Error('Invalid unsubscribe token input');
  const encodedId = bytesToBase64Url(new TextEncoder().encode(subscriberId));
  const message = `v1.${encodedId}`;
  const signature = bytesToBase64Url(await hmac(message, secret));
  return `${message}.${signature}`;
}

export async function verifyOpaqueUnsubscribeToken(token: string, secret: string) {
  try {
    if (secret.length < 32) return null;
    const [version, encodedId, encodedSignature, extra] = String(token || '').split('.');
    if (version !== 'v1' || !encodedId || !encodedSignature || extra) return null;
    const message = `${version}.${encodedId}`;
    const supplied = base64UrlToBytes(encodedSignature);
    const expected = await hmac(message, secret);
    if (!constantTimeEqual(supplied, expected)) return null;
    const subscriberId = new TextDecoder().decode(base64UrlToBytes(encodedId));
    return UUID_PATTERN.test(subscriberId) ? subscriberId : null;
  } catch {
    return null;
  }
}
