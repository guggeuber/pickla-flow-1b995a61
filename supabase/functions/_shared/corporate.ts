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

export type CorporatePublicPageContentInput = {
  hero_headline?: unknown;
  short_intro?: unknown;
  hero_image_path?: unknown;
  gallery_image_paths?: unknown;
  pickleball_heading?: unknown;
  pickleball_body?: unknown;
  pickla_heading?: unknown;
  pickla_body?: unknown;
  practical_information?: unknown;
  help_contact_text?: unknown;
};

export type CorporatePublicPageContent = {
  hero_headline: string | null;
  short_intro: string | null;
  hero_image_path: string | null;
  gallery_image_paths: string[];
  pickleball_heading: string | null;
  pickleball_body: string | null;
  pickla_heading: string | null;
  pickla_body: string | null;
  practical_information: string | null;
  help_contact_text: string | null;
};

const CORPORATE_PAGE_IMAGE_PATH = /^corporate-accounts\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/(hero|gallery-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.webp$/;

function normalizeCorporatePageText(value: unknown, maxLength: number, label: string) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (text.length > maxLength) throw new Error(`${label} may contain at most ${maxLength} characters`);
  return text;
}

export function normalizeCorporatePageImagePath(value: unknown, accountId: string) {
  const path = String(value ?? '').trim();
  if (!path) return null;
  const match = path.match(CORPORATE_PAGE_IMAGE_PATH);
  if (!match || match[1] !== accountId.toLowerCase()) {
    throw new Error('Corporate page image must use the approved account-owned storage path');
  }
  return path;
}

export function normalizeCorporatePageGallery(value: unknown, accountId: string) {
  if (!Array.isArray(value)) return [];
  if (value.length > 6) throw new Error('A corporate page may contain at most 6 gallery images');
  return [...new Set(value.map((path) => normalizeCorporatePageImagePath(path, accountId)).filter((path): path is string => Boolean(path)))];
}

export function normalizeCorporatePublicPageContent(input: CorporatePublicPageContentInput, accountId: string): CorporatePublicPageContent {
  return {
    hero_headline: normalizeCorporatePageText(input.hero_headline, 160, 'Hero headline'),
    short_intro: normalizeCorporatePageText(input.short_intro, 600, 'Short intro'),
    hero_image_path: normalizeCorporatePageImagePath(input.hero_image_path, accountId),
    gallery_image_paths: normalizeCorporatePageGallery(input.gallery_image_paths, accountId),
    pickleball_heading: normalizeCorporatePageText(input.pickleball_heading, 160, 'Pickleball heading'),
    pickleball_body: normalizeCorporatePageText(input.pickleball_body, 1600, 'Pickleball body'),
    pickla_heading: normalizeCorporatePageText(input.pickla_heading, 160, 'Pickla heading'),
    pickla_body: normalizeCorporatePageText(input.pickla_body, 1600, 'Pickla body'),
    practical_information: normalizeCorporatePageText(input.practical_information, 1600, 'Practical information'),
    help_contact_text: normalizeCorporatePageText(input.help_contact_text, 1200, 'Help/contact text'),
  };
}

export function defaultCorporatePublicPageContent(companyName: unknown): Omit<CorporatePublicPageContent, 'hero_image_path' | 'gallery_image_paths'> {
  const company = String(companyName ?? '').trim() || 'Your company';
  return {
    hero_headline: `${company} × Pickla`,
    short_intro: 'Your weekly pickleball hour — easy to join, social from the first rally.',
    pickleball_heading: 'NEW TO PICKLEBALL? PERFECT.',
    pickleball_body: 'Pickleball is a mix of tennis, badminton and table tennis. It is social, easy to start and takes about five minutes to learn. The sport has become huge in the United States and is growing rapidly across Asia.',
    pickla_heading: 'WELCOME TO PICKLA',
    pickla_body: "Pickla is one of Europe’s leading dedicated pickleball communities, with eight indoor courts in Solna Business Park. Pickla combines sport, community and social experiences — whether you’re playing for the first time or already hooked.",
    practical_information: 'Come as you are. Rackets and balls are ready at the venue. Indoor shoes and comfortable sportswear are recommended.',
    help_contact_text: null,
  };
}

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
