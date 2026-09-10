export const CORPORATE_PARTICIPATION_MODES = ['unconfigured', 'external', 'pickla'] as const;

export type CorporateParticipationMode = typeof CORPORATE_PARTICIPATION_MODES[number];
export type CorporateParticipationState =
  | 'not_configured'
  | 'external_pending'
  | 'external_ready'
  | 'pickla_pending'
  | 'pickla_ready';

export type CorporateParticipationProjection = {
  mode: CorporateParticipationMode;
  state: CorporateParticipationState;
  message: string | null;
  cta: { label: string; url: string } | null;
};

export function normalizeCorporateSlug(value: unknown): string | null {
  const slug = String(value ?? '').trim().toLowerCase();
  if (!slug) return null;
  if (slug.length > 120 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error('Slug must contain lowercase letters, numbers and single hyphens only');
  }
  return slug;
}

export function normalizeExternalBookingUrl(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (raw.length > 2048) throw new Error('External booking URL is too long');

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('External booking URL must be a valid HTTPS URL');
  }

  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error('External booking URL must be HTTPS and cannot contain credentials');
  }
  return parsed.toString();
}

export function normalizeExternalBookingLabel(value: unknown): string | null {
  const label = String(value ?? '').trim();
  if (!label) return null;
  if (label.length > 80) throw new Error('CTA label may contain at most 80 characters');
  return label;
}

export function normalizePublicIntro(value: unknown): string | null {
  const intro = String(value ?? '').trim();
  if (!intro) return null;
  if (intro.length > 1200) throw new Error('Public intro may contain at most 1200 characters');
  return intro;
}

export function normalizeIncludedItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const items = value.map((item) => String(item ?? '').trim()).filter(Boolean);
  if (items.length > 20) throw new Error('An order may contain at most 20 included items');
  return [...new Set(items)];
}

export function canResolvePublicCorporateAccount(account: {
  is_active?: unknown;
  public_visibility?: unknown;
  slug?: unknown;
}) {
  return account.is_active === true
    && ['listed', 'unlisted'].includes(String(account.public_visibility || ''))
    && Boolean(String(account.slug || '').trim());
}

export function canListPublicCorporateAccount(account: {
  is_active?: unknown;
  public_visibility?: unknown;
  slug?: unknown;
}) {
  return canResolvePublicCorporateAccount(account) && account.public_visibility === 'listed';
}

function externalManagerName(companyName: unknown, purchaserName: unknown) {
  const company = String(companyName ?? '').trim();
  const purchaser = String(purchaserName ?? '').trim();
  if (company && purchaser && company.toLocaleLowerCase() !== purchaser.toLocaleLowerCase()) {
    return `${company}/${purchaser}`;
  }
  return company || purchaser || 'företaget';
}

export function deriveCorporateParticipation(input: {
  participation_management_mode?: unknown;
  external_booking_url?: unknown;
  external_booking_label?: unknown;
  company_name?: unknown;
  purchaser_name?: unknown;
}): CorporateParticipationProjection {
  const requestedMode = String(input.participation_management_mode ?? 'unconfigured');
  const mode: CorporateParticipationMode = CORPORATE_PARTICIPATION_MODES.includes(requestedMode as CorporateParticipationMode)
    ? requestedMode as CorporateParticipationMode
    : 'unconfigured';

  if (mode === 'unconfigured') {
    return { mode, state: 'not_configured', message: 'Bokningsinformation kommer snart.', cta: null };
  }

  if (mode === 'pickla') {
    return { mode, state: 'pickla_pending', message: 'Bokning via Pickla öppnar senare.', cta: null };
  }

  let url: string | null = null;
  try {
    url = normalizeExternalBookingUrl(input.external_booking_url);
  } catch {
    url = null;
  }
  if (!url) {
    const manager = externalManagerName(input.company_name, input.purchaser_name);
    return {
      mode,
      state: 'external_pending',
      message: `Deltagandet hanteras av ${manager}. Mer bokningsinformation kommer snart.`,
      cta: null,
    };
  }

  return {
    mode,
    state: 'external_ready',
    message: null,
    cta: {
      label: normalizeExternalBookingLabel(input.external_booking_label) || 'Gå till bokning',
      url,
    },
  };
}
