import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const PRODUCTION_PROJECT_REF = 'ptnvhbniiiapzbyofctg';
const DEFAULT_MANIFEST = 'docs/database/event-logo-reconciliation.json';
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TABLES = new Set(['events', 'event_templates']);
const ALLOWED_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
const EXPECTED_RECORDS = new Map([
  ['events:71a4ed74-ff8d-4fac-bf2f-15606c8ce456', {
    sourceUrl: 'https://cqnjpudmsreubgviqptg.supabase.co/storage/v1/object/public/event-logos/templates/b669a0ab-0fa7-4005-9db3-0b4b1f23b130/logo.svg?t=1776343588543',
    targetPath: '71a4ed74-ff8d-4fac-bf2f-15606c8ce456/logo.svg',
  }],
  ['events:9e8a09cc-70e7-4429-ae6a-addb5d06d404', {
    sourceUrl: 'https://cqnjpudmsreubgviqptg.supabase.co/storage/v1/object/public/event-logos/templates/82197c90-dc30-480b-9bce-b630ce4f22e0/logo.svg?t=1776343332276',
    targetPath: '9e8a09cc-70e7-4429-ae6a-addb5d06d404/logo.svg',
  }],
  ['event_templates:82197c90-dc30-480b-9bce-b630ce4f22e0', {
    sourceUrl: 'https://cqnjpudmsreubgviqptg.supabase.co/storage/v1/object/public/event-logos/templates/82197c90-dc30-480b-9bce-b630ce4f22e0/logo.svg?t=1776343332276',
    targetPath: 'templates/82197c90-dc30-480b-9bce-b630ce4f22e0/logo.svg',
  }],
  ['event_templates:b669a0ab-0fa7-4005-9db3-0b4b1f23b130', {
    sourceUrl: 'https://cqnjpudmsreubgviqptg.supabase.co/storage/v1/object/public/event-logos/templates/b669a0ab-0fa7-4005-9db3-0b4b1f23b130/logo.svg?t=1776343588543',
    targetPath: 'templates/b669a0ab-0fa7-4005-9db3-0b4b1f23b130/logo.svg',
  }],
]);

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function has(name) {
  return process.argv.includes(name);
}

function targetRef(url) {
  const host = new URL(url).hostname;
  if (host === '127.0.0.1' || host === 'localhost') return 'local';
  return host.split('.')[0];
}

function encodeObjectPath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function responseJson(response, label) {
  const text = await response.text();
  if (!response.ok) throw new Error(`${label} failed (${response.status}): ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function loadAsset(record, assetDir) {
  if (assetDir) {
    return new Uint8Array(await readFile(resolve(assetDir, record.fixture_file)));
  }
  const response = await fetch(record.source_url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Legacy asset unavailable for ${record.table}/${record.id}: ${response.status}`);
  const sourceType = response.headers.get('content-type')?.split(';')[0]?.trim();
  if (sourceType && sourceType !== record.content_type) {
    throw new Error(`Unexpected source MIME for ${record.table}/${record.id}: ${sourceType}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function main() {
  const manifestPath = option('--manifest') || DEFAULT_MANIFEST;
  const manifest = JSON.parse(await readFile(resolve(manifestPath), 'utf8'));
  if (manifest.version !== 1 || manifest.bucket !== 'event-logos' || manifest.records?.length !== 4) {
    throw new Error('Only the reviewed four-record event-logo manifest version 1 is accepted');
  }

  const ids = new Set();
  for (const record of manifest.records) {
    const key = `${record.table}:${record.id}`;
    const expected = EXPECTED_RECORDS.get(key);
    if (!ALLOWED_TABLES.has(record.table) || !expected || ids.has(key)) throw new Error(`Invalid or duplicate manifest record: ${key}`);
    if (record.source_url !== expected.sourceUrl || record.target_path !== expected.targetPath) {
      throw new Error(`Manifest values differ from the compiled allow-list: ${key}`);
    }
    if (!ALLOWED_CONTENT_TYPES.has(record.content_type)) throw new Error(`Unsupported MIME: ${record.content_type}`);
    ids.add(key);
  }
  if (ids.size !== EXPECTED_RECORDS.size) throw new Error('The exact compiled four-record allow-list is required');

  const apply = has('--apply');
  const assetDir = option('--asset-dir');
  const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const actorUserId = option('--actor-user-id');
  const actualTarget = targetRef(supabaseUrl);
  const expectedTarget = option('--expect-target');

  if (!expectedTarget || expectedTarget !== actualTarget) {
    throw new Error(`Target acknowledgement mismatch: expected ${expectedTarget || '<missing>'}, actual ${actualTarget}`);
  }
  if (actualTarget === PRODUCTION_PROJECT_REF) {
    if (!has('--allow-production') || process.env.CONFIRM_PRODUCTION_EVENT_LOGO_RECONCILIATION !== PRODUCTION_PROJECT_REF) {
      throw new Error('Production reconciliation requires both explicit production confirmations');
    }
  }
  if (apply && (!serviceKey || !actorUserId)) {
    throw new Error('--apply requires SUPABASE_SERVICE_ROLE_KEY and --actor-user-id');
  }

  const prepared = [];
  for (const record of manifest.records) {
    const bytes = await loadAsset(record, assetDir);
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
      throw new Error(`Invalid asset size for ${record.table}/${record.id}: ${bytes.byteLength}`);
    }
    prepared.push({ record, bytes, sha256: createHash('sha256').update(bytes).digest('hex') });
  }

  if (!apply) {
    for (const item of prepared) {
      console.log(`DRY-RUN ${item.record.table}/${item.record.id} -> ${item.record.target_path} sha256=${item.sha256}`);
    }
    return;
  }

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  for (const item of prepared) {
    const { record, bytes, sha256 } = item;
    const publicUrl = `${supabaseUrl}/storage/v1/object/public/event-logos/${encodeObjectPath(record.target_path)}`;
    const query = new URLSearchParams({ select: 'id,logo_url', id: `eq.${record.id}` });
    const currentRows = await responseJson(await fetch(`${supabaseUrl}/rest/v1/${record.table}?${query}`, { headers }), 'record lookup');
    if (currentRows?.length !== 1) throw new Error(`Expected one ${record.table}/${record.id} row`);

    const requestId = `event-logo-reconcile-v1:${record.table}:${record.id}`;
    const auditQuery = new URLSearchParams({ select: 'id', request_id: `eq.${requestId}`, limit: '1' });
    const existingAudit = await responseJson(await fetch(`${supabaseUrl}/rest/v1/audit_log?${auditQuery}`, { headers }), 'audit lookup');

    if (currentRows[0].logo_url === publicUrl) {
      if (!existingAudit?.length) throw new Error(`Canonical row lacks immutable audit evidence: ${record.table}/${record.id}`);
      console.log(`SKIP ${record.table}/${record.id} already reconciled`);
      continue;
    }
    if (currentRows[0].logo_url !== record.source_url) {
      throw new Error(`Source URL changed for ${record.table}/${record.id}; refusing overwrite`);
    }

    const uploadResponse = await fetch(
      `${supabaseUrl}/storage/v1/object/event-logos/${encodeObjectPath(record.target_path)}`,
      {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': record.content_type,
          'x-upsert': 'true',
          'cache-control': '3600',
        },
        body: bytes,
      },
    );
    await responseJson(uploadResponse, 'object upload');

    const updateQuery = new URLSearchParams({ id: `eq.${record.id}`, logo_url: `eq.${record.source_url}` });
    const updated = await responseJson(await fetch(`${supabaseUrl}/rest/v1/${record.table}?${updateQuery}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({ logo_url: publicUrl }),
    }), 'record update');
    if (updated?.length !== 1) throw new Error(`Optimistic update failed for ${record.table}/${record.id}`);

    if (!existingAudit?.length) {
      await responseJson(await fetch(`${supabaseUrl}/rest/v1/audit_log`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          venue_id: record.venue_id,
          actor_user_id: actorUserId,
          actor_type: 'user',
          action: 'platform.event_logo.reconciled',
          entity_table: record.table,
          entity_id: record.id,
          request_id: requestId,
          before: { logo_url: record.source_url },
          after: { logo_url: publicUrl },
          metadata: {
            bucket: 'event-logos',
            old_url: record.source_url,
            new_path: record.target_path,
            new_url: publicUrl,
            sha256,
            manifest_version: manifest.version,
          },
        }),
      }), 'audit insert');
    }
    console.log(`UPDATED ${record.table}/${record.id} -> ${record.target_path}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
