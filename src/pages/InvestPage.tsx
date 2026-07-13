import { useEffect, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import picklaLogo from "@/assets/pickla-logo.svg";
import { assetByType, assetsByType, InvestorAsset, InvestorPageContent, InvestorSettings } from "@/lib/investorContent";
import { toast } from "sonner";

type InvestorPublicSettings = Pick<
  InvestorSettings,
  | "round_name"
  | "round_label"
  | "company_name"
  | "company_org_number"
  | "headline"
  | "subheadline"
  | "public_thesis"
  | "traction_metrics"
  | "page_content"
>;

type InvestorPageLoadState =
  | { kind: "loading" }
  | { kind: "ready"; settings: InvestorPublicSettings; assets: InvestorAsset[] }
  | { kind: "error" };

const publicSettingKeys = [
  "round_name",
  "round_label",
  "company_name",
  "company_org_number",
  "headline",
  "subheadline",
  "public_thesis",
] as const;

const publicContentStringKeys: Array<keyof InvestorPageContent> = [
  "preview_badge",
  "preview_thesis_eyebrow",
  "preview_visual_heading",
  "preview_stack_heading",
  "preview_access_eyebrow",
  "preview_access_title",
  "preview_access_body",
  "visual_venue_label",
  "visual_venue_title",
  "visual_venue_body",
  "visual_dart_label",
  "visual_dart_title",
  "visual_dart_body",
  "visual_product_label",
  "visual_product_title",
  "visual_product_body",
];

const investorAssetTypeValues = new Set([
  "logo",
  "hero",
  "venue_photo",
  "dart_photo",
  "product_screenshot",
  "deck",
  "other",
]);

function isContentCard(value: unknown) {
  const card = value as { label?: unknown; title?: unknown; body?: unknown } | null;
  return Boolean(
    card &&
    typeof card === "object" &&
    typeof card.label === "string" &&
    typeof card.title === "string" &&
    typeof card.body === "string"
  );
}

function isMetric(value: unknown) {
  const metric = value as { label?: unknown; value?: unknown } | null;
  return Boolean(
    metric &&
    typeof metric === "object" &&
    typeof metric.label === "string" &&
    typeof metric.value === "string"
  );
}

function readPublicSettings(value: unknown): InvestorPublicSettings {
  const settings = value as Partial<InvestorPublicSettings> | null;
  if (!settings || typeof settings !== "object") throw new Error("Missing investor settings");
  if (publicSettingKeys.some((key) => typeof settings[key] !== "string")) {
    throw new Error("Incomplete investor settings");
  }
  if (!Array.isArray(settings.traction_metrics) || !settings.traction_metrics.every(isMetric)) {
    throw new Error("Invalid investor traction content");
  }

  const content = settings.page_content as Partial<InvestorPageContent> | null;
  if (!content || typeof content !== "object") throw new Error("Missing investor page content");
  if (publicContentStringKeys.some((key) => typeof content[key] !== "string")) {
    throw new Error("Incomplete investor page content");
  }
  if (!Array.isArray(content.preview_highlights) || !content.preview_highlights.every(isContentCard)) {
    throw new Error("Invalid investor preview highlights");
  }
  if (!Array.isArray(content.preview_pillars) || !content.preview_pillars.every(isContentCard)) {
    throw new Error("Invalid investor preview pillars");
  }

  return settings as InvestorPublicSettings;
}

function readInvestorAssets(value: unknown): InvestorAsset[] {
  if (!Array.isArray(value)) throw new Error("Missing investor assets");
  const valid = value.every((item) => {
    const asset = item as Partial<InvestorAsset> | null;
    return Boolean(
      asset &&
      typeof asset === "object" &&
      typeof asset.id === "string" &&
      typeof asset.asset_type === "string" &&
      investorAssetTypeValues.has(asset.asset_type) &&
      typeof asset.title === "string" &&
      typeof asset.storage_path === "string" &&
      (asset.public_url === null || typeof asset.public_url === "string") &&
      typeof asset.sort_order === "number" &&
      typeof asset.is_active === "boolean"
    );
  });
  if (!valid) throw new Error("Invalid investor assets");
  return value as InvestorAsset[];
}

export default function InvestPage() {
  const [loadState, setLoadState] = useState<InvestorPageLoadState>({ kind: "loading" });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("dark");
    document.title = "Pickla — Investor access";
    let meta = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    if (!meta) { meta = document.createElement("meta"); meta.name = "robots"; document.head.appendChild(meta); }
    const prev = meta.content;
    meta.content = "noindex, nofollow";
    return () => { meta!.content = prev; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadState({ kind: "loading" });
    apiGet<{ settings?: unknown; assets?: unknown }>("api-investor", "settings")
      .then((res) => {
        if (cancelled) return;
        setLoadState({
          kind: "ready",
          settings: readPublicSettings(res.settings),
          assets: readInvestorAssets(res.assets),
        });
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("Investor settings failed", err);
        setLoadState({ kind: "error" });
      });
    return () => { cancelled = true; };
  }, [loadAttempt]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setSubmitting(true);
    try {
      await apiPost("api-investor", "request", { email, name, message });
      setDone(true);
      toast.success("Request received. We'll be in touch.");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loadState.kind === "loading") return <InvestorPageSkeleton />;
  if (loadState.kind === "error") {
    return <InvestorPageError onRetry={() => setLoadAttempt((attempt) => attempt + 1)} />;
  }

  const { settings, assets } = loadState;

  const logo = assetByType(assets, "logo")?.public_url || picklaLogo;
  const hero = assetByType(assets, "hero") || assetByType(assets, "venue_photo");
  const content = settings.page_content;
  const visualAssets = [
    {
      label: content.visual_venue_label,
      title: content.visual_venue_title,
      body: content.visual_venue_body,
      assets: assetsByType(assets, "venue_photo"),
    },
    {
      label: content.visual_dart_label,
      title: content.visual_dart_title,
      body: content.visual_dart_body,
      assets: assetsByType(assets, "dart_photo"),
    },
    {
      label: content.visual_product_label,
      title: content.visual_product_title,
      body: content.visual_product_body,
      assets: assetsByType(assets, "product_screenshot"),
    },
  ].filter((section) => section.assets.length > 0);

  return (
    <div className="min-h-screen bg-[#08090B] text-neutral-100 antialiased selection:bg-neutral-200 selection:text-black">

      <header className="px-6 py-6 flex items-center justify-between max-w-6xl mx-auto">
        <div className="flex h-8 w-[120px] items-center font-medium tracking-tight">
          <img src={logo} alt={settings.company_name || "Pickla"} className="h-8 w-auto max-w-[120px]" />
        </div>
        <span className="text-xs text-neutral-500 uppercase tracking-widest">{content.preview_badge}</span>
      </header>

      <main className="max-w-6xl mx-auto px-6 pb-32">
        {/* Hero */}
        <section className="pt-16 sm:pt-28 pb-24 border-b border-neutral-900">
          <div className="grid gap-10 lg:grid-cols-[1fr_360px] lg:items-end">
            <div className="min-h-[380px] sm:min-h-[360px] lg:min-h-[300px]">
              <p className="text-xs uppercase tracking-[0.2em] text-neutral-500 mb-6">{settings.round_label}</p>
              <h1 className="text-4xl sm:text-6xl font-medium tracking-tight leading-[1.05] max-w-3xl">
                {settings.headline}
              </h1>
              <p className="mt-8 text-lg text-neutral-400 max-w-2xl leading-relaxed">
                {settings.subheadline}
              </p>
            </div>
            <InvestorHeroImage hero={hero} />
          </div>

          <div className="mt-12 grid sm:grid-cols-3 gap-px bg-neutral-900 rounded-xl overflow-hidden border border-neutral-900">
            {content.preview_highlights.map((item) => (
              <div key={`${item.label}-${item.title}`} className="bg-[#0B0C0E] p-6">
                <div className="text-neutral-600 text-xs tracking-widest">{item.label}</div>
                <div className="mt-3 font-medium">{item.title}</div>
                <div className="mt-1 text-sm text-neutral-500">{item.body}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Narrative sections */}
        <section className="py-24 space-y-24 border-b border-neutral-900">
          <div className="grid sm:grid-cols-12 gap-8">
            <div className="sm:col-span-3 text-xs uppercase tracking-[0.2em] text-neutral-500">{content.preview_thesis_eyebrow}</div>
            <div className="sm:col-span-9 max-w-2xl">
              <h2 className="text-2xl sm:text-3xl font-medium tracking-tight">{settings.round_name}</h2>
              <p className="mt-4 text-neutral-400 leading-relaxed">{settings.public_thesis}</p>
            </div>
          </div>
          {settings.traction_metrics.map((metric) => (
            <div key={metric.label} className="grid sm:grid-cols-12 gap-8">
              <div className="sm:col-span-3 text-xs uppercase tracking-[0.2em] text-neutral-500">{metric.label}</div>
              <div className="sm:col-span-9 max-w-2xl">
                <p className="text-neutral-400 leading-relaxed">{metric.value}</p>
              </div>
            </div>
          ))}
        </section>

        {visualAssets.length > 0 && (
          <section className="py-24 border-b border-neutral-900">
            <h2 className="text-2xl sm:text-3xl font-medium tracking-tight max-w-xl">
              {content.preview_visual_heading}
            </h2>
            <div className="mt-12 space-y-12">
              {visualAssets.map((section) => (
                <div key={section.label} className="grid gap-6 lg:grid-cols-[280px_1fr] lg:items-start">
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-neutral-500">{section.label}</div>
                    <h3 className="mt-3 text-xl font-medium tracking-tight">{section.title}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-neutral-500">{section.body}</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {section.assets.map((asset) => (
                      <figure key={asset.id} className="overflow-hidden rounded-2xl border border-neutral-900 bg-[#0B0C0E]">
                        {asset.public_url && (
                          <img src={asset.public_url} alt={asset.title} className="aspect-[4/3] w-full object-cover" />
                        )}
                        <figcaption className="p-4">
                          <div className="text-sm font-medium">{asset.title}</div>
                          {asset.description && <div className="mt-1 text-xs leading-relaxed text-neutral-500">{asset.description}</div>}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Pillars */}
        <section className="py-24 border-b border-neutral-900">
          <h2 className="text-2xl sm:text-3xl font-medium tracking-tight max-w-xl">
            {content.preview_stack_heading}
          </h2>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-px bg-neutral-900 rounded-xl overflow-hidden border border-neutral-900">
            {content.preview_pillars.map((item) => (
              <div key={`${item.label}-${item.title}`} className="bg-[#0B0C0E] p-6">
                <div className="font-medium">{item.title}</div>
                <div className="mt-2 text-sm text-neutral-500 leading-relaxed">{item.body}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Request access */}
        <section id="request" className="py-24">
          <div className="max-w-xl">
            <p className="text-xs uppercase tracking-[0.2em] text-neutral-500 mb-4">{content.preview_access_eyebrow}</p>
            <h2 className="text-3xl sm:text-4xl font-medium tracking-tight">{content.preview_access_title}</h2>
            <p className="mt-4 text-neutral-400">
              {content.preview_access_body}
            </p>

            {done ? (
              <div className="mt-10 rounded-xl border border-neutral-800 bg-neutral-950 p-6">
                <div className="text-neutral-200 font-medium">Request received.</div>
                <div className="mt-1 text-sm text-neutral-500">We review every request manually. You'll hear from us shortly.</div>
              </div>
            ) : (
              <form onSubmit={submit} className="mt-10 space-y-3">
                <input
                  type="email"
                  required
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-12 px-4 rounded-lg bg-neutral-950 border border-neutral-800 focus:border-neutral-600 outline-none text-[16px]"
                />
                <input
                  type="text"
                  placeholder="Name (optional)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full h-12 px-4 rounded-lg bg-neutral-950 border border-neutral-800 focus:border-neutral-600 outline-none text-[16px]"
                />
                <textarea
                  placeholder="A short note (optional) — fund, ticket size, background"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-3 rounded-lg bg-neutral-950 border border-neutral-800 focus:border-neutral-600 outline-none text-[16px] resize-none"
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="mt-2 inline-flex items-center justify-center h-12 px-6 rounded-lg bg-white text-black font-medium hover:bg-neutral-200 transition disabled:opacity-50"
                >
                  {submitting ? "Sending…" : "Request investor access"}
                </button>
                <p className="text-xs text-neutral-600 pt-2">
                  By submitting you agree to be contacted about Pickla's funding round. No financial details are shared on this page.
                </p>
              </form>
            )}
          </div>
        </section>
      </main>

      <footer className="border-t border-neutral-900 py-10 px-6 text-xs text-neutral-600 text-center">
        © {settings.company_name} · {settings.company_org_number} · This page contains forward-looking statements and is not an offer of securities.
      </footer>
    </div>
  );
}

function InvestorHeroImage({ hero }: { hero: InvestorAsset | null }) {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
  }, [hero?.public_url]);

  if (!hero?.public_url) {
    return (
      <div
        data-testid="investor-hero-image"
        className="aspect-[4/3] w-full rounded-2xl border border-neutral-900 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.16),transparent_34%),linear-gradient(135deg,#111318,#050607)]"
      />
    );
  }

  return (
    <div data-testid="investor-hero-image" className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-neutral-900 bg-neutral-950">
      {!loaded && <div data-testid="investor-hero-image-skeleton" className="absolute inset-0 animate-pulse bg-neutral-900" />}
      <img
        src={hero.public_url}
        alt={hero.title}
        loading="eager"
        decoding="async"
        onLoad={() => setLoaded(true)}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}

function InvestorPageSkeleton() {
  return (
    <div data-testid="investor-page-skeleton" role="status" aria-label="Loading investor content" className="min-h-screen bg-[#08090B] text-neutral-100 antialiased">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex h-8 w-[120px] items-center">
          <img src={picklaLogo} alt="Pickla" className="h-8 w-auto max-w-[120px]" />
        </div>
        <div aria-hidden="true" className="h-3 w-24 animate-pulse rounded bg-neutral-900" />
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-32">
        <section className="border-b border-neutral-900 pb-24 pt-16 sm:pt-28">
          <div className="grid gap-10 lg:grid-cols-[1fr_360px] lg:items-end">
            <div aria-hidden="true" className="min-h-[380px] sm:min-h-[360px] lg:min-h-[300px]">
              <div className="h-3 w-28 animate-pulse rounded bg-neutral-900" />
              <div className="mt-6 h-24 max-w-3xl animate-pulse rounded-xl bg-neutral-900 sm:h-36" />
              <div className="mt-8 h-20 max-w-2xl animate-pulse rounded-xl bg-neutral-900" />
            </div>
            <div aria-hidden="true" className="aspect-[4/3] w-full animate-pulse rounded-2xl border border-neutral-900 bg-neutral-900" />
          </div>

          <div aria-hidden="true" className="mt-12 grid overflow-hidden rounded-xl border border-neutral-900 bg-neutral-900 sm:grid-cols-3 sm:gap-px">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-32 animate-pulse bg-[#0B0C0E] p-6">
                <div className="h-3 w-8 rounded bg-neutral-900" />
                <div className="mt-4 h-4 w-28 rounded bg-neutral-900" />
                <div className="mt-3 h-3 w-full rounded bg-neutral-900" />
              </div>
            ))}
          </div>
        </section>

        <section aria-hidden="true" className="grid gap-8 border-b border-neutral-900 py-24 sm:grid-cols-12">
          <div className="h-3 w-24 animate-pulse rounded bg-neutral-900 sm:col-span-3" />
          <div className="space-y-4 sm:col-span-9">
            <div className="h-8 max-w-md animate-pulse rounded bg-neutral-900" />
            <div className="h-28 max-w-2xl animate-pulse rounded-xl bg-neutral-900" />
          </div>
        </section>
      </main>
    </div>
  );
}

function InvestorPageError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="min-h-screen bg-[#08090B] text-neutral-100 antialiased">
      <header className="mx-auto flex max-w-6xl items-center px-6 py-6">
        <div className="flex h-8 w-[120px] items-center">
          <img src={picklaLogo} alt="Pickla" className="h-8 w-auto max-w-[120px]" />
        </div>
      </header>
      <main className="mx-auto flex min-h-[60vh] max-w-6xl items-center px-6 pb-32">
        <div className="max-w-md">
          <h1 className="text-2xl font-medium tracking-tight">Investor content unavailable</h1>
          <p className="mt-3 text-sm leading-relaxed text-neutral-500">The current investor page could not be loaded. No cached or fallback copy is being shown.</p>
          <button type="button" onClick={onRetry} className="mt-6 h-10 rounded-lg border border-neutral-800 px-4 text-sm font-medium hover:bg-neutral-900">
            Retry
          </button>
        </div>
      </main>
    </div>
  );
}
