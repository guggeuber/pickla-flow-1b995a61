import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, Download, ExternalLink, Loader2, RefreshCw, Search, Wrench } from "lucide-react";
import { toast } from "sonner";
import {
  useAdminFinancialMaintenance,
  type AdminFinancialMaintenanceCustomer,
  type AdminFinancialMaintenanceReport,
} from "@/hooks/useAdmin";
import { Button } from "@/components/ui/button";
import Customer360Drawer from "@/components/customers/Customer360Drawer";

interface Props {
  venueId: string;
}

function formatMinor(value?: number | null) {
  return `${Math.round(Number(value || 0) / 100).toLocaleString("sv-SE")} kr`;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    would_import: "Would import",
    imported: "Imported",
    already_imported: "Synchronized",
    skipped: "Skipped",
    failed: "Failed",
    conflict: "Conflict",
  };
  return labels[status] || status;
}

function statusClass(status: string) {
  if (status === "would_import" || status === "imported") return "border-primary/40 bg-primary/10 text-primary";
  if (status === "already_imported") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-500";
  if (status === "failed" || status === "conflict") return "border-destructive/40 bg-destructive/10 text-destructive";
  return "border-border bg-muted text-muted-foreground";
}

function SummaryNumber({ label, value, tone }: { label: string; value: number; tone?: "danger" | "good" | "primary" }) {
  const toneClass = tone === "danger" ? "text-destructive" : tone === "good" ? "text-emerald-500" : tone === "primary" ? "text-primary" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card/70 p-3">
      <p className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-display font-bold ${toneClass}`}>{Number(value || 0).toLocaleString("sv-SE")}</p>
    </div>
  );
}

function reportInvoiceIds(report: AdminFinancialMaintenanceReport | null) {
  if (report?.executable_invoice_ids?.length) return report.executable_invoice_ids;
  return (report?.customers || [])
    .flatMap((customer) => customer.invoices || [])
    .filter((invoice) => invoice.status === "would_import" && invoice.invoice_id)
    .map((invoice) => invoice.invoice_id);
}

function downloadReport(report: AdminFinancialMaintenanceReport | null) {
  if (!report) return;
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `financial-maintenance-${report.mode}-${new Date().toISOString().slice(0, 19)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function MaintenanceProgress({ mode }: { mode: "dry_run" | "execute" }) {
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <p className="text-sm font-bold text-foreground">{mode === "execute" ? "Importing" : "Scanning"}</p>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-background">
        <div className="h-full w-2/3 animate-pulse rounded-full bg-primary" />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {mode === "execute" ? "Importerar endast invoices från senaste dry-run." : "Hämtar Stripe invoices och kontrollerar lokala kvitton/ledger."}
      </p>
    </div>
  );
}

function CustomerRow({
  customer,
  onOpenCustomer,
}: {
  customer: AdminFinancialMaintenanceCustomer;
  onOpenCustomer: (customer: AdminFinancialMaintenanceCustomer) => void;
}) {
  const failedInvoices = customer.invoices.filter((invoice) => invoice.status === "failed" || invoice.status === "conflict");
  const visibleInvoices = customer.invoices.length ? customer.invoices : [];

  return (
    <div className="rounded-lg border border-border bg-card/70 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-bold text-foreground">{customer.customer_name || "Okänd kund"}</p>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${statusClass(customer.status)}`}>
              {statusLabel(customer.status)}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {customer.tier_name || "Medlemskap"} · {customer.subscription_count} subscription · {customer.invoice_count} invoices
          </p>
          <p className="mt-1 text-[11px] font-mono text-muted-foreground">{customer.reason || "Kontrollerad"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {customer.customer_id && (
            <Button size="sm" variant="outline" onClick={() => onOpenCustomer(customer)}>
              Open Customer 360
            </Button>
          )}
          {customer.stripe_customer_id && (
            <Button size="sm" variant="outline" asChild>
              <a href={`https://dashboard.stripe.com/customers/${customer.stripe_customer_id}`} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 h-3.5 w-3.5" />
                Stripe
              </a>
            </Button>
          )}
          {customer.customer_id && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                navigator.clipboard.writeText(customer.customer_id || "");
                toast.success("Customer ID kopierat");
              }}
            >
              <Copy className="mr-2 h-3.5 w-3.5" />
              Copy ID
            </Button>
          )}
        </div>
      </div>

      {visibleInvoices.length > 0 && (
        <div className="mt-3 space-y-2">
          {visibleInvoices.map((invoice) => (
            <div key={invoice.invoice_id} className="rounded-md border border-border/70 bg-background/50 px-3 py-2">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-xs font-mono text-foreground">{invoice.invoice_id}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {invoice.billing_reason || "invoice"} · {formatMinor(invoice.amount_paid_minor)}
                    {Number(invoice.amount_refunded_minor || 0) > 0 ? ` · refunded ${formatMinor(invoice.amount_refunded_minor)}` : ""}
                  </p>
                </div>
                <span className={`w-fit rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${statusClass(invoice.status)}`}>
                  {statusLabel(invoice.status)}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{invoice.reason || "OK"}</p>
            </div>
          ))}
        </div>
      )}

      {failedInvoices.length > 0 && (
        <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-2">
          <p className="text-xs font-bold text-destructive">Needs repair</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Öppna kund eller Stripe, lös konflikten och kör Dry Run igen.
          </p>
        </div>
      )}
    </div>
  );
}

export default function AdminFinancialMaintenance({ venueId }: Props) {
  const maintenance = useAdminFinancialMaintenance(venueId);
  const [latestDryRun, setLatestDryRun] = useState<AdminFinancialMaintenanceReport | null>(null);
  const [latestReport, setLatestReport] = useState<AdminFinancialMaintenanceReport | null>(null);
  const [runningMode, setRunningMode] = useState<"dry_run" | "execute" | null>(null);
  const [customer360Target, setCustomer360Target] = useState<{ customerId?: string | null; userId?: string | null } | null>(null);

  const executableInvoiceIds = useMemo(() => reportInvoiceIds(latestDryRun), [latestDryRun]);
  const report = latestReport || latestDryRun;
  const summary = report?.summary;

  const run = async (mode: "dry_run" | "execute") => {
    setRunningMode(mode);
    try {
      const result = await maintenance.mutateAsync({
        mode,
        invoice_ids: mode === "execute" ? executableInvoiceIds : undefined,
        report_hash: mode === "execute" ? latestDryRun?.report_hash || null : undefined,
      });
      setLatestReport(result);
      if (mode === "dry_run") setLatestDryRun(result);
      toast.success(mode === "execute" ? "Maintenance execute klar" : "Dry run klar");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Financial maintenance failed");
    } finally {
      setRunningMode(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card/70 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-primary" />
              <h2 className="font-display text-lg font-bold">Financial Maintenance</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Intern super-admin-yta för Stripe subscription receipts och ledger-reparation.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => run("dry_run")} disabled={maintenance.isPending}>
              {runningMode === "dry_run" ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-2 h-3.5 w-3.5" />}
              Dry Run
            </Button>
            <Button onClick={() => run("execute")} disabled={maintenance.isPending || executableInvoiceIds.length === 0 || !latestDryRun?.report_hash}>
              {runningMode === "execute" ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
              Execute {executableInvoiceIds.length > 0 ? `(${executableInvoiceIds.length})` : ""}
            </Button>
          </div>
        </div>
      </div>

      {runningMode && <MaintenanceProgress mode={runningMode} />}

      <div className="grid gap-2 sm:grid-cols-4">
        <SummaryNumber label="Customers" value={summary?.customers_scanned || 0} />
        <SummaryNumber label="Invoices" value={summary?.invoices_found || 0} />
        <SummaryNumber label="Would import" value={summary?.would_import || 0} tone="primary" />
        <SummaryNumber label="Conflicts" value={(summary?.conflicts || 0) + (summary?.failed || 0)} tone="danger" />
      </div>

      {report && (
        <div className="rounded-lg border border-border bg-card/70 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-bold text-foreground">Summary</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Mode: {report.mode === "execute" ? "Execute" : "Dry Run"} · subscriptions {summary?.subscriptions_found || 0}
              </p>
              {report.expires_at && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Execute token expires: {new Date(report.expires_at).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}
                </p>
              )}
            </div>
            <Button size="sm" variant="outline" onClick={() => downloadReport(report)}>
              <Download className="mr-2 h-3.5 w-3.5" />
              Download report
            </Button>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-5">
            <SummaryNumber label="Imported" value={summary?.imported || 0} tone="good" />
            <SummaryNumber label="Skipped" value={summary?.skipped || 0} />
            <SummaryNumber label="Failed" value={summary?.failed || 0} tone="danger" />
            <SummaryNumber label="Synced" value={summary?.synchronized || summary?.already_imported || 0} tone="good" />
            <SummaryNumber label="Missing ledger" value={summary?.missing_ledger || 0} tone="primary" />
          </div>
        </div>
      )}

      {!report ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <CheckCircle2 className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-3 text-sm font-bold text-foreground">Kör Dry Run först</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Dry Run muterar inget. Execute aktiveras först när det finns invoices som skulle importeras.
          </p>
        </div>
      ) : !report.customers.length ? (
        <div className="rounded-lg border border-border bg-card/70 p-8 text-center">
          <CheckCircle2 className="mx-auto h-6 w-6 text-emerald-500" />
          <p className="mt-3 text-sm font-bold text-foreground">Inga kunder att scanna</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-primary" />
            <p className="text-sm font-bold text-foreground">Conflict report</p>
          </div>
          {report.customers.map((customer) => (
            <CustomerRow
              key={`${customer.customer_id || customer.user_id || customer.stripe_customer_id || customer.customer_name}-${customer.membership_id || "membership"}`}
              customer={customer}
              onOpenCustomer={(row) => setCustomer360Target({ customerId: row.customer_id || null, userId: row.user_id || null })}
            />
          ))}
        </div>
      )}

      <Customer360Drawer
        open={!!customer360Target}
        onClose={() => setCustomer360Target(null)}
        customerId={customer360Target?.customerId || null}
        userId={customer360Target?.userId || null}
        venueId={venueId}
      />
    </div>
  );
}
