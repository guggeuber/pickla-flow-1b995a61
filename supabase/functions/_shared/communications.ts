export const PICKLA_MAIL_TOPIC = 'news_community';
export const PICKLA_MAIL_TOPIC_LABEL = 'Pickla news & community';
export const PICKLA_MAIL_POLICY_VERSION = 'pickla-mail-v1-doi-2026-09-18';
export const PICKLA_MAIL_PUBLIC_CONSENT_STATEMENT = 'Yes, send me Pickla news & community.';
export const PICKLA_MAIL_PUBLIC_CONSENT_NOTICE =
  'For adults 18+. Communication concerning children is handled by a parent or guardian. You can unsubscribe at any time. See the Pickla privacy policy.';
export const PICKLA_MAIL_ACCOUNT_CONSENT_STATEMENT =
  'Jag väljer att få Pickla news & community via e-post.';
export const PICKLA_MAIL_ACCOUNT_CONSENT_NOTICE =
  'Valet görs med verifierad e-post av en vuxen eller vårdnadshavare och kan återkallas när som helst. Kommunikation om barn hanteras av förälder eller vårdnadshavare.';
export const CONFIRMATION_TOKEN_TTL_SECONDS = 24 * 60 * 60;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{2,32}$/;

export type MarketingStatus = 'pending_confirmation' | 'subscribed' | 'unsubscribed' | 'suppressed';
export type PreferenceStatus = 'pending_confirmation' | 'subscribed' | 'unsubscribed';

export type CanonicalMarketingState = {
  marketingStatus: MarketingStatus;
  suppressedAt?: string | null;
  preferenceStatus?: PreferenceStatus | null;
  confirmedAt?: string | null;
};

export type ResendWebhookAction = {
  kind: 'unsubscribe' | 'suppress' | 'observe' | 'ignore';
  email: string | null;
  reason?: string;
};

type SecretRingEntry = { kid: string; secret: string };

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
  return state.marketingStatus === 'subscribed'
    && !state.suppressedAt
    && state.preferenceStatus === 'subscribed'
    && Boolean(state.confirmedAt);
}

export function isTransactionalEmailAllowed() {
  // Necessary service communication remains independent of marketing state.
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
    return { kind: 'suppress', email, reason: String(data.origin || 'provider_suppression') };
  }
  if (type === 'email.bounced') {
    const bounce = data.bounce && typeof data.bounce === 'object'
      ? data.bounce as Record<string, unknown>
      : {};
    const bounceType = String(bounce.type || '').toLowerCase();
    if (bounceType === 'transient') return { kind: 'observe', email };
    return { kind: 'suppress', email, reason: 'hard_bounce' };
  }
  if (type === 'email.complained') return { kind: 'suppress', email, reason: 'spam_complaint' };
  if (type === 'email.suppressed') return { kind: 'suppress', email, reason: 'provider_suppression' };
  if (['email.delivered', 'email.sent', 'email.delivery_delayed'].includes(type)) {
    return { kind: 'observe', email };
  }

  // Provider opt-in, contact creation, or suppression removal can never
  // reactivate Pickla consent.
  return { kind: 'ignore', email };
}

function parseSecretRing(serialized: string): SecretRingEntry[] {
  const entries = String(serialized || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf(':');
      return { kid: part.slice(0, separator), secret: part.slice(separator + 1) };
    });
  if (!entries.length || entries.length > 4) throw new Error('Secret ring is not configured');
  const kids = new Set<string>();
  for (const entry of entries) {
    if (!KEY_ID_PATTERN.test(entry.kid) || entry.secret.length < 32 || kids.has(entry.kid)) {
      throw new Error('Secret ring is invalid');
    }
    kids.add(entry.kid);
  }
  return entries;
}

export function secretRingIsReady(serialized: string) {
  try {
    parseSecretRing(serialized);
    return true;
  } catch {
    return false;
  }
}

export function proxyCredentialIsAuthorized(credential: string | null, serializedSecrets: string) {
  if (!credential) return false;
  try {
    const separator = credential.indexOf(':');
    if (separator < 1) return false;
    const kid = credential.slice(0, separator);
    const supplied = new TextEncoder().encode(credential.slice(separator + 1));
    const entry = parseSecretRing(serializedSecrets).find((candidate) => candidate.kid === kid);
    return Boolean(entry) && constantTimeEqual(supplied, new TextEncoder().encode(entry!.secret));
  } catch {
    return false;
  }
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

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hmacScopeHash(value: string, secret: string) {
  if (secret.length < 32) throw new Error('Rate-limit secret is not configured');
  const digest = await hmac(value, secret);
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hmacScopeHashes(value: string, serializedSecrets: string) {
  return Promise.all(parseSecretRing(serializedSecrets).map((entry) => hmacScopeHash(value, entry.secret)));
}

export async function createOpaqueConfirmationToken(
  serializedSecrets: string,
  options: { nowSeconds?: number; ttlSeconds?: number; nonce?: Uint8Array } = {},
) {
  const [active] = parseSecretRing(serializedSecrets);
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ttlSeconds = options.ttlSeconds ?? CONFIRMATION_TOKEN_TTL_SECONDS;
  if (ttlSeconds < 300 || ttlSeconds > CONFIRMATION_TOKEN_TTL_SECONDS) {
    throw new Error('Invalid confirmation expiry');
  }
  const nonce = options.nonce || crypto.getRandomValues(new Uint8Array(32));
  if (nonce.length < 24) throw new Error('Invalid confirmation nonce');
  const expiresAtSeconds = nowSeconds + ttlSeconds;
  const message = `c1.${active.kid}.${expiresAtSeconds}.${bytesToBase64Url(nonce)}`;
  const signature = bytesToBase64Url(await hmac(message, active.secret));
  return {
    token: `${message}.${signature}`,
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
  };
}

export async function verifyOpaqueConfirmationToken(
  token: string,
  serializedSecrets: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  try {
    const entries = parseSecretRing(serializedSecrets);
    const [version, kid, expiresRaw, nonce, encodedSignature, extra] = String(token || '').split('.');
    if (version !== 'c1' || !kid || !expiresRaw || !nonce || !encodedSignature || extra) return null;
    const entry = entries.find((candidate) => candidate.kid === kid);
    const expiresAtSeconds = Number(expiresRaw);
    if (!entry || !Number.isSafeInteger(expiresAtSeconds) || expiresAtSeconds < nowSeconds) return null;
    const message = `${version}.${kid}.${expiresRaw}.${nonce}`;
    const expected = await hmac(message, entry.secret);
    const supplied = base64UrlToBytes(encodedSignature);
    if (!constantTimeEqual(supplied, expected)) return null;
    return { expiresAt: new Date(expiresAtSeconds * 1000).toISOString(), kid };
  } catch {
    return null;
  }
}

async function unsubscribeAesKey(secret: string) {
  const material = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`pickla-mail-unsubscribe:${secret}`),
  );
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function createOpaqueUnsubscribeToken(
  subscriberId: string,
  serializedSecrets: string,
  ivOverride?: Uint8Array,
) {
  if (!UUID_PATTERN.test(subscriberId)) throw new Error('Invalid unsubscribe token input');
  const [active] = parseSecretRing(serializedSecrets);
  const iv = new Uint8Array(ivOverride || crypto.getRandomValues(new Uint8Array(12)));
  if (iv.length !== 12) throw new Error('Invalid unsubscribe IV');
  const versionAndKid = `u1.${active.kid}`;
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(versionAndKid) },
    await unsubscribeAesKey(active.secret),
    new TextEncoder().encode(subscriberId),
  );
  return `${versionAndKid}.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(encrypted))}`;
}

export async function verifyOpaqueUnsubscribeToken(token: string, serializedSecrets: string) {
  try {
    const entries = parseSecretRing(serializedSecrets);
    const [version, kid, encodedIv, ciphertext, extra] = String(token || '').split('.');
    if (version !== 'u1' || !kid || !encodedIv || !ciphertext || extra) return null;
    const entry = entries.find((candidate) => candidate.kid === kid);
    if (!entry) return null;
    const iv = new Uint8Array(base64UrlToBytes(encodedIv));
    if (iv.length !== 12) return null;
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`${version}.${kid}`) },
      await unsubscribeAesKey(entry.secret),
      base64UrlToBytes(ciphertext),
    );
    const subscriberId = new TextDecoder().decode(decrypted);
    return UUID_PATTERN.test(subscriberId) ? subscriberId : null;
  } catch {
    return null;
  }
}

export function publicSendModeAllows(email: string, mode: string, canaryEmails: string) {
  if (mode === 'live') return true;
  if (mode !== 'canary') return false;
  const allowed = new Set(canaryEmails.split(',').map(normalizeCommunicationEmail).filter(isValidCommunicationEmail));
  return allowed.has(normalizeCommunicationEmail(email));
}

function escapeHtml(value: string) {
  return value
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#039;');
}

export function renderPicklaConfirmationEmail(confirmUrl: string) {
  const safeUrl = escapeHtml(confirmUrl);
  const subject = "One more click. Then you're in.";
  return {
    subject,
    text: `PICKLA\n\nOne more click.\nThen you're in.\n\nConfirm you want to hear from Pickla.\n\nYES, I'M IN → ${confirmUrl}\n\nIf this wasn't you, ignore this email.\nThe link expires after 24 hours.`,
    html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>${subject}</title>
    <style>@media only screen and (max-width:620px){.pickla-pad{padding:42px 24px!important}.pickla-title{font-size:42px!important}}</style>
  </head>
  <body style="margin:0;padding:0;background:#fffaf7;color:#071126;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#fffaf7" style="width:100%;border-collapse:collapse;background:#fffaf7">
      <tr>
        <td align="center" style="padding:0 12px">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;border-collapse:collapse">
            <tr><td style="height:12px;background:#32efa0;font-size:0;line-height:0">&nbsp;</td></tr>
            <tr>
              <td class="pickla-pad" style="padding:68px 52px 72px">
                <p style="margin:0 0 54px;color:#b62068;font-size:12px;line-height:16px;font-weight:700;letter-spacing:2.4px;text-transform:uppercase">PICKLA</p>
                <h1 class="pickla-title" style="margin:0;color:#071126;font-size:52px;line-height:54px;font-weight:800;letter-spacing:-2.4px">One more click.<br>Then you're in.</h1>
                <p style="margin:30px 0 34px;color:#071126;font-size:18px;line-height:29px">Confirm you want to hear from Pickla.</p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate">
                  <tr>
                    <td bgcolor="#f43278" style="background:#f43278">
                      <a href="${safeUrl}" style="display:inline-block;padding:18px 24px;color:#071126;font-size:14px;line-height:18px;font-weight:800;letter-spacing:.7px;text-decoration:none">YES, I'M IN&nbsp;&nbsp;→</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:54px 0 0;color:#566176;font-size:12px;line-height:20px">If this wasn't you, ignore this email.<br>The link expires after 24 hours.</p>
              </td>
            </tr>
            <tr><td style="height:1px;background:#d5d8de;font-size:0;line-height:0">&nbsp;</td></tr>
            <tr><td style="padding:22px 0 36px;color:#566176;font-size:11px;line-height:18px">Pickla · Play, meet and belong.</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  };
}
