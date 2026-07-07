import { corsHeaders, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import { requireSuperAdmin } from '../_shared/authorization.ts';

type Metric = {
  key: string;
  label: string;
  value: number;
  unit: 'count' | 'kr' | 'percent';
  trend_pct: number | null;
  period: string;
  footnote: string;
};

type RangeMode = 'month' | 'ytd' | '6m' | '12m';

type PeriodWindow = {
  mode: RangeMode;
  label: string;
  start: Date;
  end: Date;
  effectiveEnd: Date;
  previousStart: Date;
  previousEnd: Date;
  previousEffectiveEnd: Date;
};

type PulseSeriesPoint = {
  month: string;
  label: string;
  revenue_sek: number;
  visits: number;
  new_customers: number;
};

type RevenueSource = {
  key: string;
  label: string;
  value: number;
  share_pct: number;
};

type PulseToken = {
  id: string;
  organization_id: string | null;
  venue_id: string | null;
  label: string | null;
  token_expires_at: string | null;
};

const TOKEN_TTL_DAYS = 30;
const CACHE_SECONDS = 900;
const PAGE_SIZE = 1000;
const DAY_MS = 86_400_000;
const SERIES_MONTHS_FOR_MONTH_VIEW = 6;

function privateJsonResponse(data: unknown, status = 200, cacheSeconds = 0) {
  const headers: Record<string, string> = {
    ...corsHeaders,
    'Content-Type': 'application/json',
  };
  if (cacheSeconds > 0) {
    headers['Cache-Control'] = `private, max-age=${cacheSeconds}`;
  }
  return new Response(JSON.stringify(data), { status, headers });
}

async function sha256Hex(input: string) {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function iso(date: Date) {
  return date.toISOString();
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addMonthsUtc(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function addDaysUtc(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

function addYearsUtc(date: Date, years: number) {
  return new Date(Date.UTC(date.getUTCFullYear() + years, date.getUTCMonth(), date.getUTCDate()));
}

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(date: Date) {
  return new Intl.DateTimeFormat('sv-SE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function rangeLabel(mode: RangeMode, start: Date, endExclusive: Date) {
  if (mode === 'month') return monthLabel(start);
  if (mode === 'ytd') return `YTD ${start.getUTCFullYear()}`;
  const endMonth = addMonthsUtc(endExclusive, -1);
  return `${monthLabel(start)} – ${monthLabel(endMonth)}`;
}

function resolveMonth(monthParam: string | null) {
  const now = new Date();
  const current = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const min = addMonthsUtc(current, -11);
  if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) return current;
  const [year, month] = monthParam.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, 1));
  if (Number.isNaN(parsed.getTime())) return current;
  if (parsed < min) return min;
  if (parsed > current) return current;
  return parsed;
}

function resolveRangeMode(modeParam: string | null): RangeMode {
  if (modeParam === 'ytd' || modeParam === '6m' || modeParam === '12m') return modeParam;
  return 'month';
}

function equivalentPreviousEffectiveEnd(start: Date, effectiveEnd: Date, previousStart: Date, previousEnd: Date) {
  const elapsed = effectiveEnd.getTime() - start.getTime();
  const candidate = new Date(previousStart.getTime() + elapsed);
  return candidate > previousEnd ? previousEnd : candidate;
}

function resolvePeriod(monthStart: Date, mode: RangeMode): PeriodWindow {
  const now = new Date();
  const end = addMonthsUtc(monthStart, 1);
  const effectiveEnd = end > now ? now : end;

  if (mode === 'ytd') {
    const start = new Date(Date.UTC(monthStart.getUTCFullYear(), 0, 1));
    const previousStart = addYearsUtc(start, -1);
    const previousEnd = addYearsUtc(end, -1);
    const previousEffectiveEnd = addYearsUtc(effectiveEnd, -1);
    return {
      mode,
      label: rangeLabel(mode, start, end),
      start,
      end,
      effectiveEnd,
      previousStart,
      previousEnd,
      previousEffectiveEnd,
    };
  }

  if (mode === '6m' || mode === '12m') {
    const months = mode === '6m' ? 6 : 12;
    const start = addMonthsUtc(monthStart, -(months - 1));
    const previousEnd = start;
    const previousStart = addMonthsUtc(start, -months);
    return {
      mode,
      label: rangeLabel(mode, start, end),
      start,
      end,
      effectiveEnd,
      previousStart,
      previousEnd,
      previousEffectiveEnd: equivalentPreviousEffectiveEnd(start, effectiveEnd, previousStart, previousEnd),
    };
  }

  const previousStart = addMonthsUtc(monthStart, -1);
  const previousEnd = monthStart;

  return {
    mode,
    label: rangeLabel(mode, monthStart, end),
    start: monthStart,
    end,
    effectiveEnd,
    previousStart,
    previousEnd,
    previousEffectiveEnd: equivalentPreviousEffectiveEnd(monthStart, effectiveEnd, previousStart, previousEnd),
  };
}

function pctTrend(current: number, previous: number) {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function percent(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

function daysBetween(start: Date, end: Date) {
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));
}

function weeklyAverage(count: number, start: Date, end: Date) {
  return Math.round(count / (daysBetween(start, end) / 7));
}

function accountingEndDateExclusive(effectiveEnd: Date, plannedEnd: Date) {
  if (effectiveEnd.getTime() === plannedEnd.getTime()) return dateOnly(plannedEnd);
  return dateOnly(addDaysUtc(new Date(Date.UTC(effectiveEnd.getUTCFullYear(), effectiveEnd.getUTCMonth(), effectiveEnd.getUTCDate())), 1));
}

function displayEndDate(period: PeriodWindow) {
  if (period.effectiveEnd.getTime() === period.end.getTime()) return dateOnly(addDaysUtc(period.end, -1));
  return dateOnly(period.effectiveEnd);
}

function sourceLabel(sourceType: string) {
  const labels: Record<string, string> = {
    zettle: 'Zettle / POS',
    court_booking: 'Court booking',
    booking: 'Court booking',
    activity_registration: 'Activities',
    activity: 'Activities',
    day_pass: 'Day passes',
    membership: 'Memberships',
    membership_invoice: 'Membership invoices',
  };
  return labels[sourceType] || sourceType.replace(/_/g, ' ');
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

function scoped(query: any, token: PulseToken) {
  return token.venue_id ? query.eq('venue_id', token.venue_id) : query;
}

function orgScoped(query: any, token: PulseToken) {
  return token.organization_id ? query.eq('organization_id', token.organization_id) : query;
}

async function exactCount(admin: any, table: string, token: PulseToken, apply: (query: any) => any) {
  let query = admin.from(table).select('id', { count: 'exact', head: true });
  query = scoped(query, token);
  query = apply(query);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count || 0;
}

async function exactCustomerCount(admin: any, token: PulseToken, apply: (query: any) => any) {
  const table = token.venue_id ? 'customer_venue_profiles' : 'customers';
  let query = admin.from(table).select('id', { count: 'exact', head: true });
  if (token.venue_id) query = query.eq('venue_id', token.venue_id);
  else query = orgScoped(query, token).eq('status', 'active');
  query = apply(query);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count || 0;
}

async function fetchAll(admin: any, table: string, select: string, apply: (query: any) => any) {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    let query = admin.from(table).select(select).range(from, to);
    query = apply(query);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function resolveToken(admin: any, token: string): Promise<PulseToken | null> {
  if (!token || token.length < 32) return null;
  const hash = await sha256Hex(token);
  let query = admin
    .from('pulse_tokens')
    .select('id, organization_id, venue_id, label, token_expires_at, status')
    .eq('access_token_hash', hash);

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
    query = admin
      .from('pulse_tokens')
      .select('id, organization_id, venue_id, label, token_expires_at, status')
      .or(`access_token_hash.eq.${hash},id.eq.${token}`);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status !== 'active') return null;
  if (data.token_expires_at && new Date(data.token_expires_at) < new Date()) return null;
  return data;
}

function returnRate(rows: Array<{ customer_id: string | null; user_id: string | null; checked_in_at: string }>, start: Date, end: Date) {
  const byPerson = new Map<string, Date[]>();
  for (const row of rows) {
    const key = row.customer_id ? `customer:${row.customer_id}` : row.user_id ? `user:${row.user_id}` : null;
    if (!key) continue;
    const checkedInAt = new Date(row.checked_in_at);
    if (Number.isNaN(checkedInAt.getTime())) continue;
    byPerson.set(key, [...(byPerson.get(key) || []), checkedInAt]);
  }

  let firstTimers = 0;
  let returned = 0;
  for (const visits of byPerson.values()) {
    visits.sort((a, b) => a.getTime() - b.getTime());
    const first = visits[0];
    if (!first || first < start || first >= end) continue;
    firstTimers += 1;
    const cutoff = new Date(first.getTime() + 30 * DAY_MS);
    if (visits.some((visit) => visit > first && visit <= cutoff)) returned += 1;
  }

  return { firstTimers, returned, rate: percent(returned, firstTimers) };
}

function monthStartsBetween(start: Date, endExclusive: Date) {
  const months: Date[] = [];
  for (let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)); cursor < endExclusive; cursor = addMonthsUtc(cursor, 1)) {
    months.push(cursor);
  }
  return months;
}

function bucketMonth(value: string) {
  if (/^\d{4}-\d{2}/.test(value)) return value.slice(0, 7);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return monthKey(date);
}

function sumLedgerSek(rows: Array<{ amount_inc_vat_minor: number | string | null }>) {
  return Math.round(rows.reduce((sum, row) => sum + Number(row.amount_inc_vat_minor || 0), 0) / 100);
}

function revenueSources(rows: Array<{ source_type?: string | null; amount_inc_vat_minor: number | string | null }>) {
  const totalMinor = rows.reduce((sum, row) => sum + Number(row.amount_inc_vat_minor || 0), 0);
  const bySource = new Map<string, number>();
  for (const row of rows) {
    const key = row.source_type || 'unknown';
    bySource.set(key, (bySource.get(key) || 0) + Number(row.amount_inc_vat_minor || 0));
  }
  return Array.from(bySource.entries())
    .map(([key, minor]) => ({
      key,
      label: sourceLabel(key),
      value: Math.round(minor / 100),
      share_pct: totalMinor ? Math.round((minor / totalMinor) * 100) : 0,
    }))
    .sort((a, b) => b.value - a.value);
}

function buildMonthlySeries(params: {
  months: Date[];
  ledgerRows: Array<{ accounting_date: string; amount_inc_vat_minor: number | string | null }>;
  checkinRows: Array<{ checked_in_at: string }>;
  customerRows: Array<{ created_at?: string | null; first_seen_at?: string | null }>;
}): PulseSeriesPoint[] {
  const initial = new Map(params.months.map((month) => [monthKey(month), {
    month: monthKey(month),
    label: new Intl.DateTimeFormat('sv-SE', { month: 'short', timeZone: 'UTC' }).format(month),
    revenue_sek: 0,
    visits: 0,
    new_customers: 0,
  }]));

  for (const row of params.ledgerRows) {
    const key = bucketMonth(row.accounting_date);
    const point = initial.get(key);
    if (point) point.revenue_sek += Math.round(Number(row.amount_inc_vat_minor || 0) / 100);
  }

  for (const row of params.checkinRows) {
    const key = bucketMonth(row.checked_in_at);
    const point = initial.get(key);
    if (point) point.visits += 1;
  }

  for (const row of params.customerRows) {
    const key = bucketMonth(row.first_seen_at || row.created_at || '');
    const point = initial.get(key);
    if (point) point.new_customers += 1;
  }

  return Array.from(initial.values());
}

async function buildMetrics(admin: any, token: PulseToken, monthStart: Date, mode: RangeMode) {
  const now = new Date();
  const period = resolvePeriod(monthStart, mode);
  const seriesStart = mode === 'month' ? addMonthsUtc(monthStart, -(SERIES_MONTHS_FOR_MONTH_VIEW - 1)) : period.start;
  const seriesEnd = period.end;
  const seriesEffectiveEnd = seriesEnd > now ? now : seriesEnd;
  const periodAccountingEnd = accountingEndDateExclusive(period.effectiveEnd, period.end);
  const previousAccountingEnd = accountingEndDateExclusive(period.previousEffectiveEnd, period.previousEnd);
  const seriesAccountingEnd = accountingEndDateExclusive(seriesEffectiveEnd, seriesEnd);
  const returnWindowStart = new Date(now.getTime() - 90 * DAY_MS);
  const previousReturnWindowStart = new Date(now.getTime() - 180 * DAY_MS);
  const previousReturnWindowEnd = returnWindowStart;

  const customerCreatedColumn = token.venue_id ? 'first_seen_at' : 'created_at';
  const customerSeriesSelect = token.venue_id ? 'first_seen_at,venue_id' : 'created_at,organization_id,status';

  const [
    visitsCurrent,
    visitsPrevious,
    customersCurrent,
    customersPrevious,
    totalCustomers,
    ledgerCurrentRows,
    ledgerPreviousRows,
    ledgerSeriesRows,
    checkinRows,
    checkinSeriesRows,
    customerSeriesRows,
  ] = await Promise.all([
    exactCount(admin, 'venue_checkins', token, (query) => query.gte('checked_in_at', iso(period.start)).lt('checked_in_at', iso(period.effectiveEnd))),
    exactCount(admin, 'venue_checkins', token, (query) => query.gte('checked_in_at', iso(period.previousStart)).lt('checked_in_at', iso(period.previousEffectiveEnd))),
    exactCustomerCount(admin, token, (query) => query.gte(customerCreatedColumn, iso(period.start)).lt(customerCreatedColumn, iso(period.effectiveEnd))),
    exactCustomerCount(admin, token, (query) => query.gte(customerCreatedColumn, iso(period.previousStart)).lt(customerCreatedColumn, iso(period.previousEffectiveEnd))),
    exactCustomerCount(admin, token, (query) => query),
    fetchAll(admin, 'ledger_entries', 'amount_inc_vat_minor,payment_status,accounting_date,venue_id,source_type', (query) =>
      scoped(query.gte('accounting_date', dateOnly(period.start)).lt('accounting_date', periodAccountingEnd).eq('payment_status', 'paid'), token)
    ),
    fetchAll(admin, 'ledger_entries', 'amount_inc_vat_minor,payment_status,accounting_date,venue_id,source_type', (query) =>
      scoped(query.gte('accounting_date', dateOnly(period.previousStart)).lt('accounting_date', previousAccountingEnd).eq('payment_status', 'paid'), token)
    ),
    fetchAll(admin, 'ledger_entries', 'amount_inc_vat_minor,accounting_date,venue_id', (query) =>
      scoped(query.gte('accounting_date', dateOnly(seriesStart)).lt('accounting_date', seriesAccountingEnd).eq('payment_status', 'paid'), token)
    ),
    fetchAll(admin, 'venue_checkins', 'customer_id,user_id,checked_in_at,venue_id', (query) =>
      scoped(query.lt('checked_in_at', iso(now)).order('checked_in_at', { ascending: true }), token)
    ),
    fetchAll(admin, 'venue_checkins', 'checked_in_at,venue_id', (query) =>
      scoped(query.gte('checked_in_at', iso(seriesStart)).lt('checked_in_at', iso(seriesEffectiveEnd)), token)
    ),
    fetchAll(admin, token.venue_id ? 'customer_venue_profiles' : 'customers', customerSeriesSelect, (query) => {
      if (token.venue_id) {
        return query.eq('venue_id', token.venue_id).gte('first_seen_at', iso(seriesStart)).lt('first_seen_at', iso(seriesEffectiveEnd));
      }
      return orgScoped(query.eq('status', 'active').gte('created_at', iso(seriesStart)).lt('created_at', iso(seriesEffectiveEnd)), token);
    }),
  ]);

  const currentWeeklyAvg = weeklyAverage(visitsCurrent, period.start, period.effectiveEnd);
  const previousWeeklyAvg = weeklyAverage(visitsPrevious, period.previousStart, period.previousEffectiveEnd);
  const currentRevenueSek = sumLedgerSek(ledgerCurrentRows);
  const previousRevenueSek = sumLedgerSek(ledgerPreviousRows);
  const currentReturn = returnRate(checkinRows, returnWindowStart, now);
  const previousReturn = returnRate(checkinRows, previousReturnWindowStart, previousReturnWindowEnd);
  const activeMemberships = await exactCount(admin, 'memberships', token, (query) =>
    query
      .eq('status', 'active')
      .lte('starts_at', dateOnly(now))
      .or(`expires_at.is.null,expires_at.gte.${dateOnly(now)}`)
  );
  const membershipShare = percent(activeMemberships, totalCustomers);
  const series = buildMonthlySeries({
    months: monthStartsBetween(seriesStart, seriesEnd),
    ledgerRows: ledgerSeriesRows,
    checkinRows: checkinSeriesRows,
    customerRows: customerSeriesRows,
  });

  const metrics: Metric[] = [
    {
      key: 'period_revenue',
      label: 'Omsättning',
      value: currentRevenueSek,
      unit: 'kr',
      trend_pct: pctTrend(currentRevenueSek, previousRevenueSek),
      period: period.label,
      footnote: 'Betalda intäktsrader i Revenue Ledger. Reversals finns inte i ledger v1.',
    },
    {
      key: 'period_visits',
      label: 'Besök',
      value: visitsCurrent,
      unit: 'count',
      trend_pct: pctTrend(visitsCurrent, visitsPrevious),
      period: period.label,
      footnote: 'Incheckningar under vald period.',
    },
    {
      key: 'weekly_visits',
      label: 'Besök per vecka',
      value: currentWeeklyAvg,
      unit: 'count',
      trend_pct: pctTrend(currentWeeklyAvg, previousWeeklyAvg),
      period: period.label,
      footnote: `${visitsCurrent} incheckningar motsvarar ${currentWeeklyAvg} per vecka under perioden.`,
    },
    {
      key: 'new_customers',
      label: 'Nya kunder',
      value: customersCurrent,
      unit: 'count',
      trend_pct: pctTrend(customersCurrent, customersPrevious),
      period: period.label,
      footnote: token.venue_id
        ? 'Nya kunder kopplade till anläggningen under perioden.'
        : 'Nya Customer Master-profiler skapade under perioden.',
    },
    {
      key: 'total_customers',
      label: 'Totala kunder',
      value: totalCustomers,
      unit: 'count',
      trend_pct: null,
      period: 'just nu',
      footnote: token.venue_id
        ? 'Kunder med Customer Venue Profile för anläggningen.'
        : 'Aktiva Customer Master-profiler i organisationen.',
    },
    {
      key: 'return_rate_90d',
      label: 'Återkomstgrad',
      value: currentReturn.rate,
      unit: 'percent',
      trend_pct: pctTrend(currentReturn.rate, previousReturn.rate),
      period: 'förstagångsbesök senaste 90 dagarna',
      footnote: currentReturn.firstTimers
        ? `${currentReturn.returned} av ${currentReturn.firstTimers} identifierade förstagångsbesökare kom tillbaka inom 30 dagar.`
        : 'Inte tillräckligt med identifierade förstagångsbesök ännu.',
    },
    {
      key: 'active_memberships',
      label: 'Aktiva medlemskap',
      value: activeMemberships,
      unit: 'count',
      trend_pct: null,
      period: 'just nu',
      footnote: 'Aktiva medlemskap kan räknas exakt; historisk 30-dagarsförändring kräver medlemskapshistorik.',
    },
    {
      key: 'membership_share',
      label: 'Medlemsandel',
      value: membershipShare,
      unit: 'percent',
      trend_pct: null,
      period: 'just nu',
      footnote: totalCustomers
        ? `${activeMemberships} av ${totalCustomers} kunder har aktivt medlemskap.`
        : 'Kräver kunder innan medlemsandel kan visas.',
    },
  ];

  return {
    period,
    metrics,
    series,
    revenue_sources: revenueSources(ledgerCurrentRows),
    summary: {
      revenue_sek: currentRevenueSek,
      visits: visitsCurrent,
      new_customers: customersCurrent,
      total_customers: totalCustomers,
      active_memberships: activeMemberships,
      membership_share: membershipShare,
    },
  };
}

async function revenueFreshness(admin: any, token: PulseToken) {
  let query = admin
    .from('operations_integration_health')
    .select('venue_id,status,last_successful_sync_at,last_failed_sync_at,message,updated_at')
    .eq('integration_key', 'zettle');
  if (token.venue_id) query = query.eq('venue_id', token.venue_id);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = data || [];
  const successRows = rows.filter((row: any) => row.last_successful_sync_at);
  const failureRows = rows.filter((row: any) => row.status === 'FAILED' || row.last_failed_sync_at);
  const latestSuccess = successRows
    .map((row: any) => new Date(row.last_successful_sync_at))
    .filter((date: Date) => !Number.isNaN(date.getTime()))
    .sort((a: Date, b: Date) => b.getTime() - a.getTime())[0] || null;
  const latestFailure = failureRows
    .map((row: any) => new Date(row.last_failed_sync_at || row.updated_at))
    .filter((date: Date) => !Number.isNaN(date.getTime()))
    .sort((a: Date, b: Date) => b.getTime() - a.getTime())[0] || null;
  const failed = latestFailure && (!latestSuccess || latestFailure >= latestSuccess);

  return {
    source: 'zettle',
    status: rows.length === 0 ? 'never_synced' : failed ? 'failed' : latestSuccess ? 'ok' : 'never_synced',
    last_successful_sync_at: latestSuccess ? latestSuccess.toISOString() : null,
    last_failure_at: latestFailure ? latestFailure.toISOString() : null,
    message: failed ? rows.find((row: any) => row.status === 'FAILED')?.message || null : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.split('/').pop() || '';
  const admin = getServiceClient();

  try {
    if (path === 'report' && req.method === 'GET') {
      const tokenValue = url.searchParams.get('token') || '';
      const token = await resolveToken(admin, tokenValue);
      if (!token) return errorResponse('Not found', 404);

      const monthStart = resolveMonth(url.searchParams.get('month'));
      const mode = resolveRangeMode(url.searchParams.get('range') || url.searchParams.get('mode'));
      const report = await buildMetrics(admin, token, monthStart, mode);
      const zettleFreshness = await revenueFreshness(admin, token);
      await admin.from('pulse_tokens').update({ last_viewed_at: new Date().toISOString() }).eq('id', token.id);
      return privateJsonResponse({
        ok: true,
        generated_at: new Date().toISOString(),
        period: {
          month: monthKey(monthStart),
          label: monthLabel(monthStart),
          mode: report.period.mode,
          mode_label: report.period.label,
          start_date: dateOnly(report.period.start),
          end_date: displayEndDate(report.period),
        },
        scope: {
          venue_id: token.venue_id,
          organization_id: token.organization_id,
          label: token.label,
        },
        revenue_freshness: zettleFreshness,
        metrics: report.metrics,
        summary: report.summary,
        series: {
          monthly: report.series,
        },
        revenue_sources: report.revenue_sources,
        omitted: [
          {
            key: 'event_revenue',
            label: 'Eventintäkt',
            reason: 'Kräver konsekvent event revenue-kategori i ledger/receipts innan talet kan visas ärligt.',
          },
        ],
      }, 200, CACHE_SECONDS);
    }

    const adminCheck = await isSuperAdmin(req);
    if (!adminCheck.ok) return errorResponse('Forbidden', 403);

    if (path === 'create-token' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const token = randomToken();
      const hash = await sha256Hex(token);
      const expiresAt = body.expires_at
        ? new Date(String(body.expires_at)).toISOString()
        : new Date(Date.now() + TOKEN_TTL_DAYS * DAY_MS).toISOString();
      const insert = {
        label: body.label ? String(body.label).slice(0, 160) : 'Pulse report',
        venue_id: body.venue_id || null,
        organization_id: body.organization_id || null,
        access_token_hash: hash,
        token_expires_at: expiresAt,
        created_by: adminCheck.userId,
        metadata: { source: 'api-pulse' },
      };
      const { data, error } = await admin
        .from('pulse_tokens')
        .insert(insert)
        .select('id,label,venue_id,organization_id,status,token_expires_at,created_at,revoked_at,last_viewed_at')
        .single();
      if (error) return errorResponse(error.message, 500);
      try {
        await admin.from('audit_log').insert({
          actor_user_id: adminCheck.userId,
          actor_type: 'user',
          action: 'pulse.token.create',
          entity_table: 'pulse_tokens',
          entity_id: data.id,
          venue_id: data.venue_id,
          organization_id: data.organization_id,
          metadata: { expires_at: expiresAt },
        });
      } catch (_) {}
      return privateJsonResponse({ ok: true, token, pulse_token: data });
    }

    if (path === 'revoke-token' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const id = String(body.id || '');
      if (!id) return errorResponse('Missing id');
      const { data, error } = await admin
        .from('pulse_tokens')
        .update({
          status: 'revoked',
          revoked_at: new Date().toISOString(),
          revoked_by: adminCheck.userId,
        })
        .eq('id', id)
        .select('id,venue_id,organization_id')
        .maybeSingle();
      if (error) return errorResponse(error.message, 500);
      if (!data) return errorResponse('Not found', 404);
      try {
        await admin.from('audit_log').insert({
          actor_user_id: adminCheck.userId,
          actor_type: 'user',
          action: 'pulse.token.revoke',
          entity_table: 'pulse_tokens',
          entity_id: data.id,
          venue_id: data.venue_id,
          organization_id: data.organization_id,
        });
      } catch (_) {}
      return privateJsonResponse({ ok: true });
    }

    if (path === 'tokens' && req.method === 'GET') {
      const { data, error } = await admin
        .from('pulse_tokens')
        .select('id,label,venue_id,organization_id,status,token_expires_at,created_at,revoked_at,last_viewed_at')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) return errorResponse(error.message, 500);
      return privateJsonResponse({ ok: true, tokens: data || [] });
    }

    return errorResponse('Not found', 404);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
