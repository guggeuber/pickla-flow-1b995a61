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

type PulseResponse = {
  ok: boolean;
  generated_at: string;
  period: { month: string; label: string };
  revenue_freshness?: {
    source: "zettle";
    status: "ok" | "failed" | "never_synced" | string;
    updated_at: string | null;
    last_failure_at?: string | null;
    stale: boolean;
  };
  metrics: PulseMetric[];
  omitted?: Array<{ key: string; label: string; reason: string }>;
};

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthOptions() {
  const now = new Date();
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    return {
      value: monthKey(date),
      label: new Intl.DateTimeFormat("sv-SE", { month: "long", year: "numeric" }).format(date),
    };
  });
}

function formatValue(metric: PulseMetric) {
  if (metric.unit === "kr") {
    return `${new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 }).format(metric.value)} kr`;
  }
  if (metric.unit === "percent") return `${metric.value}%`;
  return new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 }).format(metric.value);
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
  const lastSync = freshness.updated_at ? formatGeneratedAt(freshness.updated_at) : "never";
  if (freshness.stale || freshness.status === "failed" || freshness.status === "never_synced") {
    return (
      <p className="text-xs leading-relaxed text-amber-300/80">
        Revenue may be delayed. Last Zettle sync: {lastSync}
      </p>
    );
  }
  return (
    <p className="text-xs leading-relaxed text-neutral-500">
      Revenue data updated: {lastSync}
    </p>
  );
}

export default function PulsePage() {
  const { token } = useParams<{ token: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const options = useMemo(() => monthOptions(), []);
  const selectedMonth = searchParams.get("month") || options[0]?.value || monthKey(new Date());
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
    apiGet<PulseResponse>("api-pulse", "report", { token, month: selectedMonth })
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
  }, [selectedMonth, token]);

  const changeMonth = (month: string) => {
    setSearchParams(month === options[0]?.value ? {} : { month });
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
            <label className="flex w-full flex-col gap-2 sm:w-64">
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
          </div>
        </section>

        <div className="mb-4 mt-10 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-neutral-500">Live Index</p>
            <RevenueFreshness freshness={data.revenue_freshness} />
          </div>
          <p className="text-xs text-neutral-700">Tal från befintlig verksamhetsdata</p>
        </div>

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
