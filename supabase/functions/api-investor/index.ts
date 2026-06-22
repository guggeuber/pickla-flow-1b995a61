// Investor Access MVP — public + admin endpoints
import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';

const TOKEN_TTL_DAYS = 30;

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
  const { data } = await admin.from('user_roles').select('id').eq('user_id', userId).eq('role', 'super_admin').maybeSingle();
  return { ok: Boolean(data), userId };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);
  const path = url.pathname.split('/').pop() || '';
  const admin = getServiceClient();

  try {
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
