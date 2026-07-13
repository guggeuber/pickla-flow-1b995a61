// Investor Access MVP — public + admin endpoints
import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import { auditMutation, requireSuperAdmin } from '../_shared/authorization.ts';

const TOKEN_TTL_DAYS = 30;
const SETTINGS_COLUMNS = [
  'id',
  'organization_id',
  'round_name',
  'round_label',
  'company_name',
  'company_org_number',
  'headline',
  'subheadline',
  'public_thesis',
  'memo_intro',
  'round_size_sek',
  'valuation_sek',
  'share_price_sek',
  'shares_offered',
  'total_existing_shares',
  'minimum_shares',
  'minimum_investment_sek',
  'deadline_date',
  'allocation_date',
  'use_of_funds',
  'traction_metrics',
  'risks',
  'team',
  'memo_sections',
  'page_content',
  'is_active',
  'created_at',
  'updated_at',
].join(',');

const ASSET_COLUMNS = 'id,organization_id,asset_type,title,description,storage_path,public_url,sort_order,is_active,created_at,updated_at';

const DEFAULT_SETTINGS = {
  round_name: 'Pickla Solna 2026',
  round_label: 'Seed · 2026',
  company_name: 'Pickla Solna AB',
  company_org_number: '556977-4481',
  headline: 'The operating system for social sports communities.',
  subheadline: 'Pickla is building the operating layer for community-first racket sports, darts, events, F&B and AI-assisted venue operations.',
  public_thesis: 'Pickla is building the operating system for social sports communities. Today that means Pickleball, Stockholm Dart Arena, events, F&B and community in one live venue. Tomorrow it expands through hosts, ambassadors, affiliates, playable resources and venues running on Pickla OS.',
  memo_intro: 'This memo is shared privately with approved investors. It covers the company, round terms, traction, risks, use of funds and the operating system behind Pickla.',
  round_size_sek: 1250000,
  valuation_sek: 5000000,
  share_price_sek: 10000,
  shares_offered: 125,
  total_existing_shares: 500,
  minimum_shares: 5,
  minimum_investment_sek: 50000,
  deadline_date: '2026-07-01',
  allocation_date: '2026-07-03',
  use_of_funds: [
    { label: 'Product and Pickla OS', value: 'Admin OS, Desk OS, Operations Truth, Customer 360, Revenue Ledger, Self Check-in and Event OS.' },
    { label: 'Venue growth', value: 'Stockholm Dart Arena, events, F&B and community programming.' },
    { label: 'Network model', value: 'Hosts, ambassadors, affiliates and partner venues.' },
  ],
  traction_metrics: [
    { label: 'Live venue', value: 'Pickleball, Stockholm Dart Arena, events and F&B under one roof.' },
    { label: 'Pickla OS', value: 'Admin OS, Desk OS, Customer 360, Operations Truth, Revenue Ledger, Self Check-in, Zettle/POS visibility and Event OS.' },
    { label: 'Expansion surface', value: 'Hosts, ambassadors, affiliates, playable resources and AI-assisted operations.' },
  ],
  risks: [
    { label: 'Execution', value: 'Scaling venue operations and software in parallel requires discipline.' },
    { label: 'Category timing', value: 'Social sports demand is strong but formats can shift quickly.' },
    { label: 'Venue economics', value: 'Events, F&B, memberships and utilization must keep improving.' },
  ],
  team: [
    { name: 'Gunnar Svalander', role: 'Founder / operator', bio: 'Runs the venue, customer relationships and Pickla OS direction.' },
  ],
  memo_sections: [
    { kicker: '01 · Vision', title: 'The operating system for social sports', body: 'Pickla is building the software and operating model for the next generation of social sports communities.' },
    { kicker: '02 · Today', title: 'Pickla Arena and Stockholm Dart Arena', body: 'The live venue combines pickleball, Stockholm Dart Arena, events, F&B and community into one operating system.' },
    { kicker: '03 · Product', title: 'Pickla OS', body: 'Admin OS, Desk OS, Customer 360, Operations Truth, Revenue Ledger, Self Check-in, Zettle/POS revenue visibility and Event OS are already visible in the product.' },
    { kicker: '04 · Future', title: 'Hosts, ambassadors, affiliates and venues', body: 'The future architecture is resource-first and AI-assisted, designed for distributed hosts, ambassadors, affiliates and venue partners.' },
    { kicker: '05 · Offer', title: 'Round terms', body: 'Pickla Solna AB offers up to 125 shares at 10,000 SEK per share, with a maximum round size of 1,250,000 SEK.' },
  ],
  page_content: {},
  is_active: true,
};

async function sha256Hex(input: string) {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function isSuperAdmin(req: Request) {
  const { userId, error } = await getAuthenticatedClient(req);
  if (error || !userId) return { ok: false as const, userId: null };
  const admin = getServiceClient();
  try {
    await requireSuperAdmin(admin, userId);
    return { ok: true as const, userId };
  } catch (_) {
    return { ok: false as const, userId };
  }
}

function arrayOrDefault(value: unknown, fallback: unknown[]) {
  return Array.isArray(value) ? value : fallback;
}

function normalizeSettings(row: Record<string, unknown> | null | undefined) {
  return {
    ...DEFAULT_SETTINGS,
    ...(row || {}),
    use_of_funds: arrayOrDefault(row?.use_of_funds, DEFAULT_SETTINGS.use_of_funds),
    traction_metrics: arrayOrDefault(row?.traction_metrics, DEFAULT_SETTINGS.traction_metrics),
    risks: arrayOrDefault(row?.risks, DEFAULT_SETTINGS.risks),
    team: arrayOrDefault(row?.team, DEFAULT_SETTINGS.team),
    memo_sections: arrayOrDefault(row?.memo_sections, DEFAULT_SETTINGS.memo_sections),
    page_content: row?.page_content && typeof row.page_content === 'object' && !Array.isArray(row.page_content)
      ? row.page_content
      : DEFAULT_SETTINGS.page_content,
  };
}

function publicSettings(settings: Record<string, unknown>) {
  return {
    id: settings.id,
    organization_id: settings.organization_id,
    round_name: settings.round_name,
    round_label: settings.round_label,
    company_name: settings.company_name,
    company_org_number: settings.company_org_number,
    headline: settings.headline,
    subheadline: settings.subheadline,
    public_thesis: settings.public_thesis,
    traction_metrics: settings.traction_metrics,
    team: settings.team,
    page_content: settings.page_content,
    is_active: settings.is_active,
  };
}

async function loadInvestorSettings(admin: ReturnType<typeof getServiceClient>) {
  const { data, error } = await admin
    .from('investor_settings')
    .select(SETTINGS_COLUMNS)
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('investor_settings unavailable, using defaults', error.message);
    return normalizeSettings(null);
  }
  return normalizeSettings(data as Record<string, unknown> | null);
}

async function loadInvestorAssets(admin: ReturnType<typeof getServiceClient>, activeOnly = true) {
  let query = admin
    .from('investor_assets')
    .select(ASSET_COLUMNS)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });
  if (activeOnly) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) {
    console.warn('investor_assets unavailable, using empty list', error.message);
    return [];
  }
  return data || [];
}

function parseNumber(value: unknown) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function parseDate(value: unknown) {
  const str = value == null ? '' : String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(str) ? str : null;
}

function sanitizeArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function sanitizeObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function settingsPayload(body: Record<string, unknown>) {
  return {
    organization_id: body.organization_id ? String(body.organization_id) : null,
    round_name: body.round_name ? String(body.round_name).slice(0, 200) : null,
    round_label: body.round_label ? String(body.round_label).slice(0, 120) : null,
    company_name: body.company_name ? String(body.company_name).slice(0, 200) : null,
    company_org_number: body.company_org_number ? String(body.company_org_number).slice(0, 80) : null,
    headline: body.headline ? String(body.headline).slice(0, 500) : null,
    subheadline: body.subheadline ? String(body.subheadline).slice(0, 1000) : null,
    public_thesis: body.public_thesis ? String(body.public_thesis).slice(0, 4000) : null,
    memo_intro: body.memo_intro ? String(body.memo_intro).slice(0, 4000) : null,
    round_size_sek: parseNumber(body.round_size_sek),
    valuation_sek: parseNumber(body.valuation_sek),
    share_price_sek: parseNumber(body.share_price_sek),
    shares_offered: parseNumber(body.shares_offered),
    total_existing_shares: parseNumber(body.total_existing_shares),
    minimum_shares: parseNumber(body.minimum_shares),
    minimum_investment_sek: parseNumber(body.minimum_investment_sek),
    deadline_date: parseDate(body.deadline_date),
    allocation_date: parseDate(body.allocation_date),
    use_of_funds: sanitizeArray(body.use_of_funds),
    traction_metrics: sanitizeArray(body.traction_metrics),
    risks: sanitizeArray(body.risks),
    team: sanitizeArray(body.team),
    memo_sections: sanitizeArray(body.memo_sections),
    page_content: sanitizeObject(body.page_content),
    is_active: body.is_active !== false,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);
  const path = url.pathname.split('/').pop() || '';
  const admin = getServiceClient();

  try {
    // PUBLIC: active investor content for /invest. This intentionally omits
    // private round economics and memo-only sections.
    if (path === 'settings' && req.method === 'GET') {
      const settings = await loadInvestorSettings(admin);
      const assets = (await loadInvestorAssets(admin, true))
        .filter((asset: Record<string, unknown>) => asset.asset_type !== 'deck');
      return jsonResponse({ ok: true, settings: publicSettings(settings), assets });
    }

    // PUBLIC: request investor access
    if (path === 'request' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const email = String(body.email || '').trim().toLowerCase();
      const name = body.name ? String(body.name).trim().slice(0, 120) : null;
      const message = body.message ? String(body.message).trim().slice(0, 1000) : null;
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 255) {
        return errorResponse('Invalid email');
      }

      // Dedupe: if existing pending/approved/etc, keep it
      const { data: existing } = await admin
        .from('investor_leads')
        .select('id,status')
        .eq('email', email)
        .maybeSingle();

      if (existing) {
        return jsonResponse({ ok: true, status: existing.status });
      }

      const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
      const ua = req.headers.get('user-agent') || null;

      const { error } = await admin.from('investor_leads').insert({
        email,
        name,
        message,
        status: 'pending',
        metadata: { ip, user_agent: ua, source: 'invest_page' },
      });
      if (error) return errorResponse(error.message, 500);
      return jsonResponse({ ok: true, status: 'pending' });
    }

    // PUBLIC: open memo with token
    if (path === 'memo' && req.method === 'GET') {
      const token = url.searchParams.get('token') || '';
      if (!token || token.length < 32) return errorResponse('Invalid token', 401);
      const hash = await sha256Hex(token);
      const { data: lead } = await admin
        .from('investor_leads')
        .select('id,name,email,status,token_expires_at,opened_at,submitted_interest_at,requested_shares')
        .eq('access_token_hash', hash)
        .maybeSingle();

      if (!lead) return errorResponse('Invalid or revoked token', 401);
      if (!['approved', 'opened', 'interested'].includes(lead.status)) {
        return errorResponse('Access revoked', 403);
      }
      if (lead.token_expires_at && new Date(lead.token_expires_at) < new Date()) {
        return errorResponse('Token expired', 410);
      }

      // Mark opened (first time only)
      if (!lead.opened_at) {
        await admin.from('investor_leads').update({
          opened_at: new Date().toISOString(),
          status: lead.status === 'approved' ? 'opened' : lead.status,
        }).eq('id', lead.id);
      }

      return jsonResponse({
        ok: true,
        lead: {
          name: lead.name,
          email: lead.email,
          submitted_interest_at: lead.submitted_interest_at,
          requested_shares: lead.requested_shares,
        },
        settings: await loadInvestorSettings(admin),
        assets: await loadInvestorAssets(admin, true),
      });
    }

    // PUBLIC: submit interest (requires token)
    if (path === 'interest' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const token = String(body.token || '');
      const shares = body.requested_shares != null ? Math.max(0, Math.min(1_000_000, Number(body.requested_shares) || 0)) : null;
      const note = body.note ? String(body.note).trim().slice(0, 2000) : null;
      if (!token || token.length < 32) return errorResponse('Invalid token', 401);

      const hash = await sha256Hex(token);
      const { data: lead } = await admin
        .from('investor_leads')
        .select('id,status,token_expires_at,metadata')
        .eq('access_token_hash', hash)
        .maybeSingle();
      if (!lead) return errorResponse('Invalid token', 401);
      if (!['approved', 'opened', 'interested'].includes(lead.status)) return errorResponse('Access revoked', 403);
      if (lead.token_expires_at && new Date(lead.token_expires_at) < new Date()) return errorResponse('Token expired', 410);

      const metadata = { ...(lead.metadata || {}), interest_note: note };
      const { error } = await admin.from('investor_leads').update({
        status: 'interested',
        submitted_interest_at: new Date().toISOString(),
        requested_shares: shares,
        metadata,
      }).eq('id', lead.id);
      if (error) return errorResponse(error.message, 500);
      return jsonResponse({ ok: true });
    }

    // ADMIN endpoints below — require super_admin
    const adminCheck = await isSuperAdmin(req);
    if (!adminCheck.ok) return errorResponse('Forbidden', 403);

    if (path === 'admin-settings' && req.method === 'GET') {
      const settings = await loadInvestorSettings(admin);
      const assets = await loadInvestorAssets(admin, false);
      return jsonResponse({ ok: true, settings, assets });
    }

    if (path === 'save-settings' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const payload = settingsPayload(body as Record<string, unknown>);
      const id = body.id ? String(body.id) : null;

      const { data: before } = id
        ? await admin.from('investor_settings').select(SETTINGS_COLUMNS).eq('id', id).maybeSingle()
        : { data: null };

      let result;
      if (id) {
        result = await admin
          .from('investor_settings')
          .update(payload)
          .eq('id', id)
          .select(SETTINGS_COLUMNS)
          .maybeSingle();
      } else {
        result = await admin
          .from('investor_settings')
          .insert(payload)
          .select(SETTINGS_COLUMNS)
          .maybeSingle();
      }
      if (result.error) return errorResponse(result.error.message, 500);

      try {
        await auditMutation(admin, {
          req,
          userId: adminCheck.userId!,
          action: id ? 'investor.settings.update' : 'investor.settings.create',
          entityTable: 'investor_settings',
          entityId: result.data?.id || id,
          organizationId: payload.organization_id,
          before: before as Record<string, unknown> | null,
          after: result.data as Record<string, unknown> | null,
        });
      } catch (_) {}

      return jsonResponse({ ok: true, settings: normalizeSettings(result.data as Record<string, unknown> | null) });
    }

    if (path === 'save-asset' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const assetType = String(body.asset_type || 'other');
      if (!['logo', 'hero', 'venue_photo', 'dart_photo', 'product_screenshot', 'deck', 'other'].includes(assetType)) {
        return errorResponse('Invalid asset_type');
      }
      const storagePath = String(body.storage_path || '').trim();
      const publicUrl = body.public_url ? String(body.public_url).trim() : null;
      if (!storagePath) return errorResponse('Missing storage_path');
      const payload = {
        organization_id: body.organization_id ? String(body.organization_id) : null,
        asset_type: assetType,
        title: String(body.title || assetType).trim().slice(0, 200),
        description: body.description ? String(body.description).trim().slice(0, 1000) : null,
        storage_path: storagePath,
        public_url: publicUrl,
        sort_order: parseNumber(body.sort_order) || 0,
        is_active: body.is_active !== false,
      };
      const id = body.id ? String(body.id) : null;
      const { data: before } = id
        ? await admin.from('investor_assets').select(ASSET_COLUMNS).eq('id', id).maybeSingle()
        : { data: null };
      const result = id
        ? await admin.from('investor_assets').update(payload).eq('id', id).select(ASSET_COLUMNS).maybeSingle()
        : await admin.from('investor_assets').insert(payload).select(ASSET_COLUMNS).maybeSingle();
      if (result.error) return errorResponse(result.error.message, 500);
      try {
        await auditMutation(admin, {
          req,
          userId: adminCheck.userId!,
          action: id ? 'investor.asset.update' : 'investor.asset.create',
          entityTable: 'investor_assets',
          entityId: result.data?.id || id,
          organizationId: payload.organization_id,
          before: before as Record<string, unknown> | null,
          after: result.data as Record<string, unknown> | null,
        });
      } catch (_) {}
      return jsonResponse({ ok: true, asset: result.data });
    }

    if (path === 'leads' && req.method === 'GET') {
      const { data, error } = await admin
        .from('investor_leads')
        .select('id,email,name,status,approved_at,rejected_at,opened_at,submitted_interest_at,requested_shares,token_expires_at,message,created_at,updated_at')
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) return errorResponse(error.message, 500);
      return jsonResponse({ leads: data || [] });
    }

    if (path === 'approve' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const id = String(body.id || '');
      if (!id) return errorResponse('Missing id');
      const token = randomToken();
      const hash = await sha256Hex(token);
      const expires = new Date(Date.now() + TOKEN_TTL_DAYS * 86400_000).toISOString();
      const { data, error } = await admin.from('investor_leads').update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        access_token_hash: hash,
        token_expires_at: expires,
        opened_at: null,
      }).eq('id', id).select('email,name').maybeSingle();
      if (error) return errorResponse(error.message, 500);

      // Best-effort audit log if table exists
      try {
        await admin.from('audit_log').insert({
          actor_user_id: adminCheck.userId,
          actor_type: 'user',
          action: 'investor.approve',
          entity_table: 'investor_leads',
          entity_id: id,
          metadata: { ttl_days: TOKEN_TTL_DAYS },
        });
      } catch (_) { /* ignore if table doesn't exist */ }

      return jsonResponse({ ok: true, token, expires_at: expires, email: data?.email, name: data?.name });
    }

    if (path === 'reject' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const id = String(body.id || '');
      if (!id) return errorResponse('Missing id');
      const { error } = await admin.from('investor_leads').update({
        status: 'rejected',
        rejected_at: new Date().toISOString(),
        access_token_hash: null,
        token_expires_at: null,
      }).eq('id', id);
      if (error) return errorResponse(error.message, 500);
      try {
        await admin.from('audit_log').insert({
          actor_user_id: adminCheck.userId,
          actor_type: 'user',
          action: 'investor.reject',
          entity_table: 'investor_leads',
          entity_id: id,
        });
      } catch (_) {}
      return jsonResponse({ ok: true });
    }

    if (path === 'revoke' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const id = String(body.id || '');
      if (!id) return errorResponse('Missing id');
      const { error } = await admin.from('investor_leads').update({
        access_token_hash: null,
        token_expires_at: null,
        status: 'rejected',
      }).eq('id', id);
      if (error) return errorResponse(error.message, 500);
      return jsonResponse({ ok: true });
    }

    return errorResponse('Not found', 404);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
