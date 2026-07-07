import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Loader2, TrendingDown, TrendingUp } from "lucide-react";
import picklaLogo from "@/assets/pickla-logo.svg";
import { apiGet } from "@/lib/api";

type PulseMetric = {
  key: string;
  label: string;
  value: number;
  unit: "count" | "kr" | "percent";
  trend_pct: number | null;
  period: string;
  footnote: string;
};

type PulseRangeMode = "month" | "ytd" | "6m" | "12m";

type PulseSeriesPoint = {
  month: string;
  label: string;
  revenue_sek: number;
  visits: number;
  new_customers: number;
};

type PulseRevenueSource = {
  key: string;
  label: string;
  value: number;
  share_pct: number;
};

type PulseResponse = {
  ok: boolean;
  generated_at: string;
  period: {
    month: string;
    label: string;
    mode?: PulseRangeMode;
    mode_label?: string;
    start_date?: string;
    end_date?: string;
  };
  revenue_freshness?: {
    source: "zettle";
    status: "ok" | "failed" | "never_synced" | string;
    last_successful_sync_at: string | null;
    last_failure_at?: string | null;
    message?: string | null;
  };
  metrics: PulseMetric[];
  summary?: {
    revenue_sek: number;
    visits: number;
    new_customers: number;
    total_customers: number;
    active_memberships: number;
    membership_share: number;
  };
  series?: {
    monthly: PulseSeriesPoint[];
  };
  revenue_sources?: PulseRevenueSource[];
  omitted?: Array<{ key: string; label: string; reason: string }>;
};

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthOptions() {
  const now = new Date();
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    return {
      value: monthKey(date),
      label: new Intl.DateTimeFormat("sv-SE", { month: "long", year: "numeric" }).format(date),
    };
  });
}

const rangeOptions: Array<{ value: PulseRangeMode; label: string }> = [
  { value: "month", label: "Månad" },
  { value: "ytd", label: "YTD" },
  { value: "6m", label: "6 mån" },
  { value: "12m", label: "12 mån" },
];

function formatValue(metric: PulseMetric) {
  if (metric.unit === "kr") {
    return `${new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 }).format(metric.value)} kr`;
  }
  if (metric.unit === "percent") return `${metric.value}%`;
  return new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 }).format(metric.value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 }).format(value);
}

function formatSek(value: number) {
  return `${formatNumber(value)} kr`;
}

function formatGeneratedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const formatted = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/Stockholm",
    timeZoneName: "short",
  }).format(date);
  return /GMT[+-]/.test(formatted) ? `${formatted.replace(/\sGMT[+-]\d+$/, "")} Stockholm time` : formatted;
}

function Trend({ value }: { value: number | null }) {
  if (value == null) {
    return <span className="text-xs uppercase tracking-[0.2em] text-neutral-600">Ingen trend</span>;
  }
  const positive = value >= 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-medium ${positive ? "text-emerald-300" : "text-rose-300"}`}>
      <Icon className="h-4 w-4" />
      {positive ? "+" : ""}
      {value.toLocaleString("sv-SE", { maximumFractionDigits: 1 })}%
    </span>
  );
}

function RevenueFreshness({ freshness }: { freshness?: PulseResponse["revenue_freshness"] }) {
  if (!freshness) return null;
  const lastSuccessfulSync = freshness.last_successful_sync_at ? formatGeneratedAt(freshness.last_successful_sync_at) : "never";
  const sourceLabel = `Zettle ${String(freshness.status || "never_synced").toUpperCase()}`;
  if (freshness.status === "failed" || freshness.status === "never_synced") {
    return (
      <div className="mt-2 space-y-1 text-xs leading-relaxed text-amber-300/80">
        <p>Revenue may be delayed</p>
        <p>Last successful sync: {lastSuccessfulSync}</p>
        <p className="text-neutral-600">Source {sourceLabel}</p>
      </div>
    );
  }
  return (
    <div className="mt-2 space-y-1 text-xs leading-relaxed text-neutral-500">
      <p>Revenue</p>
      <p>Updated {lastSuccessfulSync}</p>
      <p>Source {sourceLabel}</p>
    </div>
  );
}

function SummaryStrip({ data, periodLabel }: { data?: PulseResponse["summary"]; periodLabel: string }) {
  if (!data) return null;
  const items = [
    { label: "Omsättning", value: formatSek(data.revenue_sek), note: periodLabel },
    { label: "Besök", value: formatNumber(data.visits), note: periodLabel },
    { label: "Totala kunder", value: formatNumber(data.total_customers), note: "just nu" },
    { label: "Aktiva medlemmar", value: formatNumber(data.active_memberships), note: `${data.membership_share}% medlemsandel` },
  ];
  return (
    <section className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-neutral-900 bg-neutral-900 sm:grid-cols-4">
      {items.map((item) => (
        <article key={item.label} className="bg-[#0B0C0E] p-5">
          <p className="text-[10px] uppercase tracking-[0.22em] text-neutral-600">{item.label}</p>
          <p className="mt-3 text-3xl font-medium tracking-tight text-neutral-100 sm:text-4xl">{item.value}</p>
          <p className="mt-2 text-xs text-neutral-600">{item.note}</p>
        </article>
      ))}
    </section>
  );
}

function MiniBarChart({
  title,
  data,
  valueKey,
  format,
}: {
  title: string;
  data: PulseSeriesPoint[];
  valueKey: keyof Pick<PulseSeriesPoint, "revenue_sek" | "visits" | "new_customers">;
  format: (value: number) => string;
}) {
  const max = Math.max(...data.map((point) => Number(point[valueKey]) || 0), 1);
  return (
    <article className="rounded-2xl border border-neutral-900 bg-[#0B0C0E] p-6">
      <p className="text-xs uppercase tracking-[0.22em] text-neutral-600">{title}</p>
      <div className="mt-6 flex h-40 items-end gap-2">
        {data.map((point) => {
          const value = Number(point[valueKey]) || 0;
          const height = Math.max(4, Math.round((value / max) * 100));
          return (
            <div key={`${title}-${point.month}`} className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <div className="flex h-28 w-full items-end rounded-full bg-neutral-900">
                <div
                  className="w-full rounded-full bg-neutral-200/90"
                  style={{ height: `${height}%` }}
                  aria-label={`${point.label}: ${format(value)}`}
                />
              </div>
              <span className="text-[10px] uppercase text-neutral-600">{point.label}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-neutral-900 pt-4 text-sm text-neutral-500">
        <span>Senaste perioder</span>
        <span className="text-neutral-300">{format(data[data.length - 1]?.[valueKey] ? Number(data[data.length - 1][valueKey]) : 0)}</span>
      </div>
    </article>
  );
}

function RevenueSources({ sources }: { sources?: PulseRevenueSource[] }) {
  if (!sources?.length) return null;
  return (
    <article className="rounded-2xl border border-neutral-900 bg-[#0B0C0E] p-6">
      <p className="text-xs uppercase tracking-[0.22em] text-neutral-600">Intäktskällor</p>
      <div className="mt-5 space-y-4">
        {sources.map((source) => (
          <div key={source.key}>
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-neutral-300">{source.label}</span>
              <span className="text-neutral-500">{formatSek(source.value)}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-900">
              <div className="h-full rounded-full bg-neutral-200/80" style={{ width: `${Math.max(2, source.share_pct)}%` }} />
            </div>
            <p className="mt-1 text-xs text-neutral-700">{source.share_pct}% av vald period</p>
          </div>
        ))}
      </div>
    </article>
  );
}

export default function PulsePage() {
  const { token } = useParams<{ token: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const options = useMemo(() => monthOptions(), []);
  const selectedMonth = searchParams.get("month") || options[0]?.value || monthKey(new Date());
  const requestedRange = searchParams.get("range") as PulseRangeMode | null;
  const selectedRange = rangeOptions.some((option) => option.value === requestedRange) ? requestedRange! : "month";
  const [data, setData] = useState<PulseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.documentElement.classList.add("dark");
    document.title = "Pickla · Pulse";
    let meta = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    const created = !meta;
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "robots";
      document.head.appendChild(meta);
    }
    const prev = meta.content;
    meta.content = "noindex, nofollow, noarchive";
    return () => {
      if (created && meta?.parentNode) meta.parentNode.removeChild(meta);
      else if (meta) meta.content = prev;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setError("Pulse-länken saknas.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    apiGet<PulseResponse>("api-pulse", "report", { token, month: selectedMonth, range: selectedRange })
      .then((response) => {
        if (cancelled) return;
        if (!response?.ok || !Array.isArray(response.metrics)) {
          throw new Error("Pulse-svaret hade oväntad form.");
        }
        setData(response);
      })
      .catch((err) => {
        if (cancelled) return;
        setData(null);
        setError((err as Error).message || "Pulse kunde inte laddas.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedMonth, selectedRange, token]);

  const changeMonth = (month: string) => {
    const next = new URLSearchParams(searchParams);
    if (month === options[0]?.value) next.delete("month");
    else next.set("month", month);
    setSearchParams(next);
  };

  const changeRange = (range: PulseRangeMode) => {
    const next = new URLSearchParams(searchParams);
    if (range === "month") next.delete("range");
    else next.set("range", range);
    setSearchParams(next);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#08090B] flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-neutral-500" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#08090B] text-neutral-100 flex items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <h1 className="text-2xl font-medium tracking-tight">Pulse unavailable</h1>
          <p className="mt-3 text-sm leading-relaxed text-neutral-500">
            Länken är ogiltig, återkallad eller har gått ut.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#08090B] text-neutral-100 antialiased selection:bg-neutral-200 selection:text-black">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <img src={picklaLogo} alt="Pickla" className="h-8 w-auto max-w-[120px]" />
        <span className="text-xs uppercase tracking-[0.24em] text-neutral-600">Pulse</span>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-20">
        <section className="border-b border-neutral-900 pb-10 pt-10 sm:pt-20">
          <div className="flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-neutral-500">PICKLA PULSE</p>
              <h1 className="mt-5 text-5xl font-medium tracking-tight sm:text-7xl">Pickla by Numbers</h1>
              <div className="mt-6">
                <p className="text-xs uppercase tracking-[0.22em] text-neutral-600">Generated</p>
                <p className="mt-2 text-base text-neutral-300">{formatGeneratedAt(data.generated_at)}</p>
              </div>
            </div>
            <div className="flex w-full flex-col gap-4 sm:w-[28rem]">
              <label className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-[0.2em] text-neutral-600">Period</span>
                <select
                  value={selectedMonth}
                  onChange={(event) => changeMonth(event.target.value)}
                  className="h-12 rounded-xl border border-neutral-800 bg-[#0B0C0E] px-4 text-sm font-medium text-neutral-200 outline-none focus:border-neutral-600"
                >
                  {options.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-4 gap-2 rounded-2xl border border-neutral-900 bg-[#0B0C0E] p-1">
                {rangeOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => changeRange(option.value)}
                    className={`h-10 rounded-xl text-xs font-medium transition ${
                      selectedRange === option.value ? "bg-neutral-100 text-black" : "text-neutral-500 hover:text-neutral-200"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <div className="mb-4 mt-10 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-neutral-500">Live Index</p>
            <RevenueFreshness freshness={data.revenue_freshness} />
          </div>
          <p className="text-xs text-neutral-700">Tal från befintlig verksamhetsdata</p>
        </div>

        <SummaryStrip data={data.summary} periodLabel={data.period.mode_label || data.period.label} />

        <section className="grid gap-px overflow-hidden rounded-2xl border border-neutral-900 bg-neutral-900 sm:grid-cols-2">
          {data.metrics.map((metric) => (
            <article key={metric.key} className="bg-[#0B0C0E] p-7 sm:p-9">
              <div className="text-xs uppercase tracking-[0.22em] text-neutral-600">{metric.label}</div>
              <div className="mt-5 break-words text-5xl font-medium tracking-tight text-neutral-50 sm:text-7xl">
                {formatValue(metric)}
              </div>
              <div className="mt-5 flex items-center justify-between gap-4 border-t border-neutral-900 pt-4">
                <span className="text-sm text-neutral-500">{metric.period}</span>
                <Trend value={metric.trend_pct} />
              </div>
              <p className="mt-5 text-sm leading-relaxed text-neutral-500">{metric.footnote}</p>
            </article>
          ))}
        </section>

        {!!data.series?.monthly?.length && (
          <section className="mt-10 grid gap-4 lg:grid-cols-3">
            <MiniBarChart title="Omsättning över tid" data={data.series.monthly} valueKey="revenue_sek" format={formatSek} />
            <MiniBarChart title="Besök över tid" data={data.series.monthly} valueKey="visits" format={formatNumber} />
            <MiniBarChart title="Nya kunder över tid" data={data.series.monthly} valueKey="new_customers" format={formatNumber} />
          </section>
        )}

        <section className="mt-4 grid gap-4 lg:grid-cols-2">
          <RevenueSources sources={data.revenue_sources} />
          <article className="rounded-2xl border border-neutral-900 bg-[#0B0C0E] p-6">
            <p className="text-xs uppercase tracking-[0.22em] text-neutral-600">Vad talet betyder</p>
            <div className="mt-5 space-y-3 text-sm leading-relaxed text-neutral-500">
              <p>Omsättning kommer från Revenue Ledger och följer samma finansiella sanning som Admin.</p>
              <p>Besök är incheckningar. Återkomstgrad räknas bara på identifierade kunder, inte anonyma drop-ins.</p>
              <p>Medlemskap är en aktuell snapshot tills medlemskapshistorik finns som egen tidsserie.</p>
            </div>
          </article>
        </section>

        {!!data.omitted?.length && (
          <section className="mt-10 rounded-2xl border border-neutral-900 bg-[#0B0C0E] p-6">
            <p className="text-xs uppercase tracking-[0.22em] text-neutral-600">Inte visat i v1</p>
            <div className="mt-4 space-y-3">
              {data.omitted.map((item) => (
                <p key={item.key} className="text-sm leading-relaxed text-neutral-500">
                  <span className="font-medium text-neutral-300">{item.label}:</span> {item.reason}
                </p>
              ))}
            </div>
          </section>
        )}

        <footer className="mt-12 pb-4 text-xs uppercase tracking-[0.2em] text-neutral-700">
          Generated {formatGeneratedAt(data.generated_at)} · Pickla OS
        </footer>
      </main>
    </div>
  );
}
