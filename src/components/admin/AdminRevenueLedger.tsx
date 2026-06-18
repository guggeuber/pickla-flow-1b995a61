import { useMemo, useState } from "react";
import { DateTime } from "luxon";
import { ExternalLink, FileText, Loader2, ReceiptText, RefreshCw, Store } from "lucide-react";
import {
  useAdminRevenueLedger,
  useAdminZettleConnect,
  useAdminZettleImport,
  useAdminZettleStatus,
  type AdminLedgerPeriodSummary,
} from "@/hooks/useAdmin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Props {
  venueId: string;
}

function stockholmToday() {
  return DateTime.now().setZone("Europe/Stockholm").toISODate()!;
}

function formatSekFromMinor(value: number | undefined | null) {
  return `${Math.round(Number(value || 0) / 100).toLocaleString("sv-SE")} kr`;
}

function formatTime(value: string) {
  const parsed = DateTime.fromISO(value, { zone: "utc" }).setZone("Europe/Stockholm");
  return parsed.isValid ? parsed.toFormat("HH:mm") : "-";
}

function formatDate(value: string) {
  const parsed = DateTime.fromISO(value, { zone: "Europe/Stockholm" });
  return parsed.isValid ? parsed.toFormat("d LLL yyyy") : value;
}

function SummaryTile({ label, summary }: { label: string; summary?: AdminLedgerPeriodSummary }) {
  const delta = Number(summary?.delta_minor || 0);
  const pickla = Number(summary?.ledger.channels?.pickla_minor ?? summary?.ledger.total_minor ?? 0);
  const zettle = Number(summary?.ledger.channels?.zettle_minor ?? 0);
  return (
    <div className="rounded-lg border border-border bg-card/70 p-3">
      <p className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-display font-bold text-foreground">
        {formatSekFromMinor(summary?.ledger.total_minor)}
      </p>
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{summary?.ledger.count || 0} poster</span>
        <span>Kvitton {formatSekFromMinor(summary?.receipts.total_minor)}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1 text-[11px]">
        <span className="rounded bg-background/50 px-2 py-1 text-muted-foreground">Pickla {formatSekFromMinor(pickla)}</span>
        <span className="rounded bg-background/50 px-2 py-1 text-muted-foreground">Zettle {formatSekFromMinor(zettle)}</span>
      </div>
      <p className={`mt-1 text-[11px] ${delta === 0 ? "text-emerald-500" : "text-destructive"}`}>
        Diff {formatSekFromMinor(delta)}
      </p>
    </div>
  );
}

export default function AdminRevenueLedger({ venueId }: Props) {
  const [date, setDate] = useState(stockholmToday());
  const ledgerQ = useAdminRevenueLedger(venueId, date);
  const zettleQ = useAdminZettleStatus(venueId);
  const zettleConnect = useAdminZettleConnect(venueId);
  const zettleImport = useAdminZettleImport(venueId, date);
  const data = ledgerQ.data;

  const selectedTotal = data?.selected?.ledger.total_minor || 0;
  const selectedReceiptTotal = data?.selected?.receipts.total_minor || 0;
  const selectedPickla = data?.selected?.ledger.channels?.pickla_minor ?? selectedTotal;
  const selectedZettle = data?.selected?.ledger.channels?.zettle_minor ?? 0;

  const receiptDelta = selectedPickla - selectedReceiptTotal;
  const sourceRows = useMemo(() => data?.by_type || [], [data?.by_type]);

  const handleConnectZettle = async () => {
    const result = await zettleConnect.mutateAsync(window.location.href);
    window.location.assign(result.authorization_url);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card/70 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ReceiptText className="h-4 w-4 text-primary" />
              <h2 className="font-display text-lg font-bold">Revenue Ledger</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Daglig försäljning från Pickla och Zettle. Append-only, read-only.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="h-9 w-[150px]"
            />
            <Button variant="outline" size="sm" onClick={() => setDate(stockholmToday())}>
              Idag
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card/70 p-3">
          <p className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-muted-foreground">Pickla</p>
          <p className="mt-1 text-xl font-display font-bold text-foreground">{formatSekFromMinor(selectedPickla)}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Webb, medlemskap och bokningar</p>
        </div>
        <div className="rounded-lg border border-border bg-card/70 p-3">
          <p className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-muted-foreground">Zettle</p>
          <p className="mt-1 text-xl font-display font-bold text-foreground">{formatSekFromMinor(selectedZettle)}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Importerade POS-köp</p>
        </div>
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
          <p className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-muted-foreground">Total</p>
          <p className="mt-1 text-xl font-display font-bold text-foreground">{formatSekFromMinor(selectedTotal)}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Pickla + Zettle</p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card/70 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Store className="h-4 w-4 text-primary" />
              <p className="text-sm font-bold text-foreground">Zettle</p>
              {zettleQ.data?.connected ? (
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-500">
                  Connected
                </span>
              ) : (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                  Not connected
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Importerar purchases för vald dag till ledgern som <span className="font-mono">source_type=zettle</span>.
            </p>
            {zettleQ.data?.auth_mode === "api_key" && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                API key-läge är aktivt. OAuth connect behövs inte.
              </p>
            )}
            {zettleQ.data?.connection?.last_import_finished_at && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Senast importerat: {formatTime(zettleQ.data.connection.last_import_finished_at)} · {zettleQ.data.connection.last_import_count || 0} köp
              </p>
            )}
            {zettleQ.data?.connection?.last_import_error && (
              <p className="mt-1 text-[11px] text-destructive">{zettleQ.data.connection.last_import_error}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!zettleQ.data?.configured && (
              <span className="text-xs text-destructive">Saknar Zettle secrets</span>
            )}
            {!zettleQ.data?.connected ? (
              <Button
                size="sm"
                onClick={handleConnectZettle}
                disabled={!zettleQ.data?.configured || zettleConnect.isPending}
              >
                {zettleConnect.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="mr-2 h-3.5 w-3.5" />}
                Connect Zettle
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => zettleImport.mutate()}
                disabled={zettleImport.isPending}
              >
                {zettleImport.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
                Importera vald dag
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <SummaryTile label="Today" summary={data?.summary.today} />
        <SummaryTile label="Yesterday" summary={data?.summary.yesterday} />
        <SummaryTile label="This month" summary={data?.summary.month} />
      </div>

      <div className="rounded-lg border border-border bg-card/70 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-muted-foreground">
              {formatDate(date)}
            </p>
            <p className="mt-1 text-2xl font-display font-bold text-foreground">
              {formatSekFromMinor(selectedTotal)}
            </p>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <p>{data?.entries.length || 0} ledger entries</p>
            <p className={receiptDelta === 0 ? "text-emerald-500" : "text-destructive"}>
              Kvitto diff {formatSekFromMinor(receiptDelta)}
            </p>
          </div>
        </div>

        {sourceRows.length > 0 && (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {sourceRows.map((row) => (
              <div key={row.source_type} className="rounded-md border border-border/70 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">{row.label}</p>
                  <p className="text-sm font-bold text-foreground">{formatSekFromMinor(row.total_minor)}</p>
                </div>
                <p className="text-[11px] text-muted-foreground">{row.count} poster</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card/70">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-sm font-bold text-foreground">Ledger entries</p>
            <p className="text-[11px] text-muted-foreground">Source, customer, amount and receipt evidence.</p>
          </div>
          {ledgerQ.isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {ledgerQ.isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data?.entries.length ? (
          <div className="px-4 py-10 text-center">
            <FileText className="mx-auto h-5 w-5 text-muted-foreground" />
            <p className="mt-2 text-sm font-semibold text-foreground">Inga ledger-poster</p>
            <p className="mt-1 text-xs text-muted-foreground">När Stripe-betalningar går igenom visas de här.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {data.entries.map((entry) => (
              <div key={entry.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[70px_1fr_auto_auto] sm:items-center">
                <div className="text-xs font-mono text-muted-foreground">{formatTime(entry.occurred_at)}</div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{entry.source_label}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {entry.customer_name || "Okänd kund"} · {entry.payment_method || "Stripe"}
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-sm font-bold text-foreground">{formatSekFromMinor(entry.amount_inc_vat_minor)}</p>
                  <p className="text-[11px] text-muted-foreground">Moms {formatSekFromMinor(entry.vat_amount_minor)}</p>
                </div>
                <div className="sm:text-right">
                  {entry.receipt_number ? (
                    <details className="group">
                      <summary className="cursor-pointer list-none text-xs font-semibold text-primary hover:underline">
                        {entry.receipt_number}
                      </summary>
                      <div className="mt-2 rounded-md border border-border/70 bg-background/60 p-2 text-left text-[11px] text-muted-foreground sm:w-56">
                        <p className="font-semibold text-foreground">{entry.receipt?.product_description || entry.source_label}</p>
                        <p>{entry.receipt?.customer_email || "Ingen e-post"}</p>
                        <p>{entry.receipt?.payment_method || entry.payment_method || "Stripe"} · {entry.receipt?.payment_status || entry.payment_status}</p>
                        {entry.receipt?.stripe_payment_intent_id && <p className="truncate">PI {entry.receipt.stripe_payment_intent_id}</p>}
                        {entry.stripe_session_id && <p className="truncate">Session {entry.stripe_session_id}</p>}
                      </div>
                    </details>
                  ) : (
                    <span className="text-xs text-muted-foreground">Kvitto saknas</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
