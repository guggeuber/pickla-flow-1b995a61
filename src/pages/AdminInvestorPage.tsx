import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import {
  InvestorAsset,
  InvestorAssetType,
  InvestorMemoSection,
  InvestorMetric,
  InvestorPerson,
  InvestorSettings,
  investorAssetTypes,
  mergeInvestorSettings,
  moneySek,
} from "@/lib/investorContent";
import { toast } from "sonner";
import { Loader2, Copy, Check, X, RefreshCw, Upload, Save } from "lucide-react";

type Lead = {
  id: string;
  email: string;
  name: string | null;
  status: "pending" | "approved" | "rejected" | "opened" | "interested";
  approved_at: string | null;
  rejected_at: string | null;
  opened_at: string | null;
  submitted_interest_at: string | null;
  requested_shares: number | null;
  token_expires_at: string | null;
  message: string | null;
  created_at: string;
};

type PulseToken = {
  id: string;
  label: string | null;
  venue_id: string | null;
  organization_id: string | null;
  status: "active" | "revoked";
  token_expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
  last_viewed_at?: string | null;
};

type JsonKey = "use_of_funds" | "traction_metrics" | "risks" | "team" | "memo_sections";

const statusStyles: Record<Lead["status"], string> = {
  pending: "bg-neutral-800 text-neutral-300",
  approved: "bg-blue-900/40 text-blue-300 border border-blue-800",
  opened: "bg-amber-900/40 text-amber-300 border border-amber-800",
  interested: "bg-emerald-900/40 text-emerald-300 border border-emerald-800",
  rejected: "bg-red-900/30 text-red-300 border border-red-900",
};

function jsonText(value: unknown) {
  return JSON.stringify(value ?? [], null, 2);
}

function parseJsonArray<T>(label: string, value: string): T[] {
  const parsed = JSON.parse(value || "[]");
  if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array`);
  return parsed as T[];
}

function cleanFileName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
}

export default function AdminInvestorPage() {
  const [tab, setTab] = useState<"leads" | "pulse" | "content">("leads");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [pulseTokens, setPulseTokens] = useState<PulseToken[]>([]);
  const [settings, setSettings] = useState<InvestorSettings>(() => mergeInvestorSettings());
  const [assets, setAssets] = useState<InvestorAsset[]>([]);
  const [jsonFields, setJsonFields] = useState<Record<JsonKey, string>>({
    use_of_funds: "[]",
    traction_metrics: "[]",
    risks: "[]",
    team: "[]",
    memo_sections: "[]",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [issuedLinks, setIssuedLinks] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [pulseLabel, setPulseLabel] = useState("Partner Pulse");
  const [issuedPulseLink, setIssuedPulseLink] = useState<string | null>(null);
  const [assetType, setAssetType] = useState<InvestorAssetType>("hero");
  const [assetTitle, setAssetTitle] = useState("");
  const [assetDescription, setAssetDescription] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [leadRes, contentRes] = await Promise.all([
        apiGet<{ leads: Lead[] }>("api-investor", "leads"),
        apiGet<{ settings: InvestorSettings; assets: InvestorAsset[] }>("api-investor", "admin-settings"),
      ]);
      setLeads(leadRes.leads);
      apiGet<{ tokens: PulseToken[] }>("api-pulse", "tokens")
        .then((res) => setPulseTokens(res.tokens || []))
        .catch((error) => toast.error((error as Error).message));
      const nextSettings = mergeInvestorSettings(contentRes.settings);
      setSettings(nextSettings);
      setAssets(contentRes.assets || []);
      setJsonFields({
        use_of_funds: jsonText(nextSettings.use_of_funds),
        traction_metrics: jsonText(nextSettings.traction_metrics),
        risks: jsonText(nextSettings.risks),
        team: jsonText(nextSettings.team),
        memo_sections: jsonText(nextSettings.memo_sections),
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function patchSettings(patch: Partial<InvestorSettings>) {
    setSettings((current) => ({ ...current, ...patch }));
  }

  async function saveSettings() {
    setSaving(true);
    try {
      const payload = {
        ...settings,
        use_of_funds: parseJsonArray<InvestorMetric>("Use of funds", jsonFields.use_of_funds),
        traction_metrics: parseJsonArray<InvestorMetric>("Traction metrics", jsonFields.traction_metrics),
        risks: parseJsonArray<InvestorMetric>("Risks", jsonFields.risks),
        team: parseJsonArray<InvestorPerson>("Team", jsonFields.team),
        memo_sections: parseJsonArray<InvestorMemoSection>("Memo sections", jsonFields.memo_sections),
        is_active: true,
      };
      const res = await apiPost<{ settings: InvestorSettings }>("api-investor", "save-settings", payload as unknown as Record<string, unknown>);
      const nextSettings = mergeInvestorSettings(res.settings);
      setSettings(nextSettings);
      toast.success("Investor content saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function uploadAsset(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const path = `investor/${Date.now()}-${cleanFileName(file.name)}`;
      const { error: uploadError } = await supabase.storage.from("investor-assets").upload(path, file, {
        upsert: true,
        contentType: file.type || undefined,
      });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from("investor-assets").getPublicUrl(path);
      const title = assetTitle.trim() || file.name.replace(/\.[^.]+$/, "");
      await apiPost("api-investor", "save-asset", {
        organization_id: settings.organization_id || null,
        asset_type: assetType,
        title,
        description: assetDescription.trim() || null,
        storage_path: path,
        public_url: data.publicUrl,
        sort_order: assets.length,
        is_active: true,
      });
      setAssetTitle("");
      setAssetDescription("");
      toast.success("Investor asset uploaded");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function toggleAsset(asset: InvestorAsset) {
    try {
      await apiPost("api-investor", "save-asset", {
        ...asset,
        is_active: !asset.is_active,
      } as unknown as Record<string, unknown>);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function approve(id: string) {
    setBusyId(id);
    try {
      const res = await apiPost<{ token: string }>("api-investor", "approve", { id });
      const link = `${window.location.origin}/invest/memo/${res.token}`;
      setIssuedLinks((m) => ({ ...m, [id]: link }));
      toast.success("Approved — link generated");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    if (!confirm("Reject this request?")) return;
    setBusyId(id);
    try {
      await apiPost("api-investor", "reject", { id });
      toast.success("Rejected");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke access for this investor? The link will stop working.")) return;
    setBusyId(id);
    try {
      await apiPost("api-investor", "revoke", { id });
      toast.success("Access revoked");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function createPulseLink() {
    setBusyId("pulse-create");
    try {
      const res = await apiPost<{ token: string; pulse_token: PulseToken }>("api-pulse", "create-token", {
        label: pulseLabel.trim() || "Pulse report",
      });
      const link = `${window.location.origin}/pulse/${res.pulse_token.id}`;
      setIssuedPulseLink(link);
      setPulseTokens((current) => [res.pulse_token, ...current]);
      toast.success("Pulse link created");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function revokePulseLink(id: string) {
    if (!confirm("Revoke this Pulse link? The report link will stop working.")) return;
    setBusyId(id);
    try {
      await apiPost("api-pulse", "revoke-token", { id });
      toast.success("Pulse link revoked");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  function copy(id: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-medium tracking-tight">Investors</h1>
            <p className="text-sm text-neutral-500 mt-1">Manage access requests and investor page content.</p>
          </div>
          <button onClick={load} className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-neutral-800 hover:bg-neutral-900 text-sm">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>

        <div className="mb-6 inline-flex rounded-lg border border-neutral-800 bg-neutral-950 p-1">
          {[
            ["leads", "Leads"],
            ["pulse", "Pulse links"],
            ["content", "Content & assets"],
          ].map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value as "leads" | "pulse" | "content")}
              className={`h-9 rounded-md px-4 text-sm ${tab === value ? "bg-white text-black" : "text-neutral-400 hover:text-neutral-100"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-5 h-5 animate-spin text-neutral-500" /></div>
        ) : tab === "leads" ? (
          <LeadsList
            leads={leads}
            issuedLinks={issuedLinks}
            copied={copied}
            busyId={busyId}
            onApprove={approve}
            onReject={reject}
            onRevoke={revoke}
            onCopy={copy}
          />
        ) : tab === "pulse" ? (
          <PulseLinksPanel
            tokens={pulseTokens}
            label={pulseLabel}
            issuedLink={issuedPulseLink}
            copied={copied}
            busyId={busyId}
            onLabelChange={setPulseLabel}
            onCreate={createPulseLink}
            onRevoke={revokePulseLink}
            onCopy={copy}
          />
        ) : (
          <div className="space-y-6">
            <section className="rounded-xl border border-neutral-900 bg-neutral-950 p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-medium">Round and company</h2>
                  <p className="mt-1 text-sm text-neutral-500">These values drive /invest and private memo pages.</p>
                </div>
                <button
                  onClick={saveSettings}
                  disabled={saving}
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-white px-3 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save
                </button>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <TextField label="Round name" value={settings.round_name || ""} onChange={(v) => patchSettings({ round_name: v })} />
                <TextField label="Round label" value={settings.round_label || ""} onChange={(v) => patchSettings({ round_label: v })} />
                <TextField label="Company name" value={settings.company_name || ""} onChange={(v) => patchSettings({ company_name: v })} />
                <TextField label="Org number" value={settings.company_org_number || ""} onChange={(v) => patchSettings({ company_org_number: v })} />
                <NumberField label="Round size SEK" value={settings.round_size_sek} onChange={(v) => patchSettings({ round_size_sek: v })} hint={moneySek(settings.round_size_sek)} />
                <NumberField label="Valuation SEK" value={settings.valuation_sek} onChange={(v) => patchSettings({ valuation_sek: v })} hint={moneySek(settings.valuation_sek)} />
                <NumberField label="Share price SEK" value={settings.share_price_sek} onChange={(v) => patchSettings({ share_price_sek: v })} hint={moneySek(settings.share_price_sek)} />
                <NumberField label="Shares offered" value={settings.shares_offered} onChange={(v) => patchSettings({ shares_offered: v })} />
                <NumberField label="Existing shares" value={settings.total_existing_shares} onChange={(v) => patchSettings({ total_existing_shares: v })} />
                <NumberField label="Minimum shares" value={settings.minimum_shares} onChange={(v) => patchSettings({ minimum_shares: v })} />
                <NumberField label="Minimum investment SEK" value={settings.minimum_investment_sek} onChange={(v) => patchSettings({ minimum_investment_sek: v })} hint={moneySek(settings.minimum_investment_sek)} />
                <TextField label="Deadline" type="date" value={settings.deadline_date || ""} onChange={(v) => patchSettings({ deadline_date: v })} />
                <TextField label="Allocation date" type="date" value={settings.allocation_date || ""} onChange={(v) => patchSettings({ allocation_date: v })} />
              </div>
            </section>

            <section className="rounded-xl border border-neutral-900 bg-neutral-950 p-5">
              <h2 className="text-lg font-medium">Narrative</h2>
              <div className="mt-6 space-y-4">
                <TextArea label="Headline" value={settings.headline || ""} onChange={(v) => patchSettings({ headline: v })} rows={2} />
                <TextArea label="Subheadline" value={settings.subheadline || ""} onChange={(v) => patchSettings({ subheadline: v })} rows={3} />
                <TextArea label="Public thesis" value={settings.public_thesis || ""} onChange={(v) => patchSettings({ public_thesis: v })} rows={5} />
                <TextArea label="Private memo intro" value={settings.memo_intro || ""} onChange={(v) => patchSettings({ memo_intro: v })} rows={4} />
              </div>
            </section>

            <section className="rounded-xl border border-neutral-900 bg-neutral-950 p-5">
              <h2 className="text-lg font-medium">Structured memo content</h2>
              <p className="mt-1 text-sm text-neutral-500">Small JSON arrays. Keep objects as label/value, name/role/bio, or kicker/title/body.</p>
              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                <JsonArea label="Use of funds" value={jsonFields.use_of_funds} onChange={(v) => setJsonFields((s) => ({ ...s, use_of_funds: v }))} />
                <JsonArea label="Traction metrics" value={jsonFields.traction_metrics} onChange={(v) => setJsonFields((s) => ({ ...s, traction_metrics: v }))} />
                <JsonArea label="Risks" value={jsonFields.risks} onChange={(v) => setJsonFields((s) => ({ ...s, risks: v }))} />
                <JsonArea label="Team" value={jsonFields.team} onChange={(v) => setJsonFields((s) => ({ ...s, team: v }))} />
                <div className="lg:col-span-2">
                  <JsonArea label="Memo sections" value={jsonFields.memo_sections} onChange={(v) => setJsonFields((s) => ({ ...s, memo_sections: v }))} rows={14} />
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-neutral-900 bg-neutral-950 p-5">
              <h2 className="text-lg font-medium">Assets</h2>
              <p className="mt-1 text-sm text-neutral-500">Upload/select logo, hero, venue, dart, product screenshots and deck files.</p>
              <div className="mt-6 grid gap-3 md:grid-cols-[160px_1fr_1fr_auto]">
                <select value={assetType} onChange={(e) => setAssetType(e.target.value as InvestorAssetType)} className="h-10 rounded-lg border border-neutral-800 bg-[#0B0C0E] px-3 text-sm">
                  {investorAssetTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
                <input value={assetTitle} onChange={(e) => setAssetTitle(e.target.value)} placeholder="Title" className="h-10 rounded-lg border border-neutral-800 bg-[#0B0C0E] px-3 text-sm" />
                <input value={assetDescription} onChange={(e) => setAssetDescription(e.target.value)} placeholder="Description" className="h-10 rounded-lg border border-neutral-800 bg-[#0B0C0E] px-3 text-sm" />
                <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-white px-4 text-sm font-medium text-black hover:bg-neutral-200">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Upload
                  <input type="file" accept="image/*,.pdf" className="hidden" disabled={uploading} onChange={(e) => uploadAsset(e.target.files?.[0])} />
                </label>
              </div>
              <div className="mt-6 grid gap-3 md:grid-cols-2">
                {assets.map((asset) => (
                  <div key={asset.id} className="rounded-xl border border-neutral-900 bg-[#0B0C0E] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-[0.16em] text-neutral-600">{asset.asset_type}</div>
                        <div className="mt-1 font-medium">{asset.title}</div>
                        {asset.description && <div className="mt-1 text-sm text-neutral-500">{asset.description}</div>}
                        <div className="mt-2 truncate text-xs text-neutral-600">{asset.storage_path}</div>
                      </div>
                      <button onClick={() => toggleAsset(asset)} className="h-8 rounded-md border border-neutral-800 px-3 text-xs hover:bg-neutral-900">
                        {asset.is_active ? "Active" : "Inactive"}
                      </button>
                    </div>
                    {asset.public_url && asset.asset_type !== "deck" && (
                      <img src={asset.public_url} alt={asset.title} className="mt-4 aspect-video w-full rounded-lg object-cover" />
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function LeadsList(props: {
  leads: Lead[];
  issuedLinks: Record<string, string>;
  copied: string | null;
  busyId: string | null;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onRevoke: (id: string) => void;
  onCopy: (id: string, text: string) => void;
}) {
  if (props.leads.length === 0) {
    return (
      <div className="border border-neutral-900 rounded-xl p-16 text-center text-neutral-500 text-sm">
        No investor requests yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {props.leads.map((lead) => {
        const issued = props.issuedLinks[lead.id];
        return (
          <div key={lead.id} className="rounded-xl border border-neutral-900 bg-neutral-950 p-5">
            <div className="flex flex-wrap items-start gap-4 justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="font-medium">{lead.name || lead.email}</div>
                  <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded ${statusStyles[lead.status]}`}>{lead.status}</span>
                </div>
                <div className="text-xs text-neutral-500 mt-1">{lead.email} · received {new Date(lead.created_at).toLocaleString()}</div>
                {lead.message && <div className="mt-3 text-sm text-neutral-400 border-l-2 border-neutral-800 pl-3 italic">{lead.message}</div>}
                <div className="mt-3 text-xs text-neutral-600 flex flex-wrap gap-x-4 gap-y-1">
                  {lead.opened_at && <span>Opened {new Date(lead.opened_at).toLocaleString()}</span>}
                  {lead.submitted_interest_at && <span>Interest {new Date(lead.submitted_interest_at).toLocaleString()}</span>}
                  {lead.requested_shares != null && <span>{lead.requested_shares.toLocaleString()} shares requested</span>}
                  {lead.token_expires_at && <span>Token expires {new Date(lead.token_expires_at).toLocaleDateString()}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {lead.status === "pending" && (
                  <>
                    <button disabled={props.busyId === lead.id} onClick={() => props.onApprove(lead.id)} className="h-9 px-3 rounded-md bg-white text-black text-sm font-medium hover:bg-neutral-200 disabled:opacity-50">Approve</button>
                    <button disabled={props.busyId === lead.id} onClick={() => props.onReject(lead.id)} className="h-9 px-3 rounded-md border border-neutral-800 text-sm hover:bg-neutral-900 inline-flex items-center gap-1"><X className="w-4 h-4" /> Reject</button>
                  </>
                )}
                {(lead.status === "approved" || lead.status === "opened" || lead.status === "interested") && (
                  <button disabled={props.busyId === lead.id} onClick={() => props.onRevoke(lead.id)} className="h-9 px-3 rounded-md border border-red-900 text-red-300 text-sm hover:bg-red-950">Revoke</button>
                )}
              </div>
            </div>

            {issued && (
              <div className="mt-4 p-3 rounded-lg bg-blue-950/30 border border-blue-900">
                <div className="text-xs text-blue-300 mb-2">One-time access link (shown once — copy now)</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-black/40 px-3 py-2 rounded overflow-auto whitespace-nowrap">{issued}</code>
                  <button onClick={() => props.onCopy(lead.id, issued)} className="h-9 px-3 rounded-md bg-white text-black text-sm font-medium inline-flex items-center gap-1">
                    {props.copied === lead.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {props.copied === lead.id ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PulseLinksPanel(props: {
  tokens: PulseToken[];
  label: string;
  issuedLink: string | null;
  copied: string | null;
  busyId: string | null;
  onLabelChange: (value: string) => void;
  onCreate: () => void;
  onRevoke: (id: string) => void;
  onCopy: (id: string, text: string) => void;
}) {
  const activeTokens = props.tokens.filter((token) => token.status === "active");

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-neutral-900 bg-neutral-950 p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-lg font-medium">Create Pulse Link</h2>
            <p className="mt-1 text-sm text-neutral-500">
              Creates a private `/pulse/:token` report link. The token is shown once.
            </p>
          </div>
          <div className="flex w-full flex-col gap-3 md:w-auto md:min-w-[420px] md:flex-row">
            <label className="flex-1">
              <span className="text-xs text-neutral-500">Label</span>
              <input
                value={props.label}
                onChange={(event) => props.onLabelChange(event.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-neutral-800 bg-[#0B0C0E] px-3 text-sm outline-none focus:border-neutral-600"
                placeholder="Partner Pulse"
              />
            </label>
            <button
              onClick={props.onCreate}
              disabled={props.busyId === "pulse-create"}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-white px-4 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50 md:mt-5"
            >
              {props.busyId === "pulse-create" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create Pulse Link
            </button>
          </div>
        </div>

        {props.issuedLink && (
          <div className="mt-5 rounded-lg border border-blue-900 bg-blue-950/30 p-3">
            <div className="mb-2 text-xs text-blue-300">One-time Pulse link (copy now)</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-auto whitespace-nowrap rounded bg-black/40 px-3 py-2 text-xs">{props.issuedLink}</code>
              <button
                onClick={() => props.onCopy("pulse-issued", props.issuedLink!)}
                className="inline-flex h-9 items-center gap-1 rounded-md bg-white px-3 text-sm font-medium text-black"
              >
                {props.copied === "pulse-issued" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {props.copied === "pulse-issued" ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-neutral-900 bg-neutral-950 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium">Active Pulse Links</h2>
            <p className="mt-1 text-sm text-neutral-500">Copy or revoke private operational report links.</p>
          </div>
          <span className="rounded-full border border-neutral-800 px-3 py-1 text-xs text-neutral-500">
            {activeTokens.length} active
          </span>
        </div>

        {props.tokens.length === 0 ? (
          <div className="mt-6 rounded-xl border border-neutral-900 p-12 text-center text-sm text-neutral-500">
            No Pulse links yet.
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {props.tokens.map((token) => {
              const active = token.status === "active";
              const link = `${window.location.origin}/pulse/${token.id}`;
              return (
                <div key={token.id} className="rounded-xl border border-neutral-900 bg-[#0B0C0E] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="font-medium">{token.label || "Pulse report"}</div>
                        <span className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wider ${active ? "border border-emerald-800 bg-emerald-900/30 text-emerald-300" : "border border-red-900 bg-red-950/30 text-red-300"}`}>
                          {token.status}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
                        <span>Created {new Date(token.created_at).toLocaleString()}</span>
                        <span>Last viewed {token.last_viewed_at ? new Date(token.last_viewed_at).toLocaleString() : "—"}</span>
                        {token.token_expires_at && <span>Expires {new Date(token.token_expires_at).toLocaleDateString()}</span>}
                        {token.revoked_at && <span>Revoked {new Date(token.revoked_at).toLocaleString()}</span>}
                      </div>
                      <div className="mt-3 text-xs text-neutral-700">
                        Token id: <span className="font-mono">{token.id}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => props.onCopy(`pulse-${token.id}`, link)}
                        className="inline-flex h-9 items-center gap-1 rounded-md border border-neutral-800 px-3 text-sm hover:bg-neutral-900"
                      >
                        {props.copied === `pulse-${token.id}` ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        Copy
                      </button>
                      {active && (
                        <button
                          disabled={props.busyId === token.id}
                          onClick={() => props.onRevoke(token.id)}
                          className="h-9 rounded-md border border-red-900 px-3 text-sm text-red-300 hover:bg-red-950 disabled:opacity-50"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function TextField({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="text-xs text-neutral-500">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-neutral-800 bg-[#0B0C0E] px-3 text-sm outline-none focus:border-neutral-600" />
    </label>
  );
}

function NumberField({ label, value, onChange, hint }: { label: string; value: number | null | undefined; onChange: (value: number | null) => void; hint?: string }) {
  return (
    <label className="block">
      <span className="text-xs text-neutral-500">{label}</span>
      <input
        type="number"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="mt-1 h-10 w-full rounded-lg border border-neutral-800 bg-[#0B0C0E] px-3 text-sm outline-none focus:border-neutral-600"
      />
      {hint && <span className="mt-1 block text-[10px] text-neutral-600">{hint}</span>}
    </label>
  );
}

function TextArea({ label, value, onChange, rows = 4 }: { label: string; value: string; onChange: (value: string) => void; rows?: number }) {
  return (
    <label className="block">
      <span className="text-xs text-neutral-500">{label}</span>
      <textarea value={value} rows={rows} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-800 bg-[#0B0C0E] px-3 py-2 text-sm outline-none focus:border-neutral-600" />
    </label>
  );
}

function JsonArea({ label, value, onChange, rows = 8 }: { label: string; value: string; onChange: (value: string) => void; rows?: number }) {
  return (
    <label className="block">
      <span className="text-xs text-neutral-500">{label}</span>
      <textarea value={value} rows={rows} spellCheck={false} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-800 bg-[#050607] px-3 py-2 font-mono text-xs leading-relaxed text-neutral-300 outline-none focus:border-neutral-600" />
    </label>
  );
}
