import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import {
  InvestorAsset,
  InvestorAssetType,
  InvestorContentCard,
  InvestorMemoSection,
  InvestorMetric,
  InvestorPageContent,
  InvestorPerson,
  InvestorSettings,
  investorAssetTypes,
  mergeInvestorSettings,
  moneySek,
} from "@/lib/investorContent";
import { toast } from "sonner";
import { Loader2, Copy, Check, X, RefreshCw, Upload, Save, Plus, Trash2 } from "lucide-react";
import { canonicalAppUrl } from "@/lib/canonicalOrigin";
import { copyWithFallback } from "@/lib/share";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

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
  metadata?: {
    source?: string | null;
    internal_note?: string | null;
  } | null;
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

type JsonKey = "use_of_funds" | "traction_metrics" | "risks" | "team" | "preview_highlights" | "preview_pillars";

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
    preview_highlights: "[]",
    preview_pillars: "[]",
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
  const [privateMemoOpen, setPrivateMemoOpen] = useState(false);
  const [privateMemoForm, setPrivateMemoForm] = useState({ name: "", email: "", internalNote: "" });
  const [privateMemoResult, setPrivateMemoResult] = useState<{ leadId: string; url: string } | null>(null);

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
        preview_highlights: jsonText(nextSettings.page_content.preview_highlights),
        preview_pillars: jsonText(nextSettings.page_content.preview_pillars),
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

  function patchPageContent(patch: Partial<InvestorPageContent>) {
    setSettings((current) => ({
      ...current,
      page_content: { ...current.page_content, ...patch },
    }));
  }

  function patchMemoSection(index: number, patch: Partial<InvestorMemoSection>) {
    setSettings((current) => ({
      ...current,
      memo_sections: current.memo_sections.map((section, sectionIndex) => (
        sectionIndex === index ? { ...section, ...patch } : section
      )),
    }));
  }

  function addMemoSection() {
    setSettings((current) => ({
      ...current,
      memo_sections: [
        ...current.memo_sections,
        { kicker: `${String(current.memo_sections.length + 1).padStart(2, "0")} · Section`, title: "New section", body: "" },
      ],
    }));
  }

  function removeMemoSection(index: number) {
    setSettings((current) => ({
      ...current,
      memo_sections: current.memo_sections.filter((_, sectionIndex) => sectionIndex !== index),
    }));
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
        page_content: {
          ...settings.page_content,
          preview_highlights: parseJsonArray<InvestorContentCard>("Preview highlights", jsonFields.preview_highlights),
          preview_pillars: parseJsonArray<InvestorContentCard>("Preview pillars", jsonFields.preview_pillars),
        },
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

  function patchAsset(id: string, patch: Partial<InvestorAsset>) {
    setAssets((current) => current.map((asset) => asset.id === id ? { ...asset, ...patch } : asset));
  }

  async function saveAsset(asset: InvestorAsset) {
    setBusyId(`asset-${asset.id}`);
    try {
      await apiPost("api-investor", "save-asset", asset as unknown as Record<string, unknown>);
      toast.success("Asset details saved");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function approve(id: string) {
    setBusyId(id);
    try {
      const res = await apiPost<{ token: string }>("api-investor", "approve", { id });
      const link = canonicalAppUrl(`/invest/memo/${res.token}`);
      setIssuedLinks((m) => ({ ...m, [id]: link }));
      toast.success("Approved — link generated");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function createPrivateMemo() {
    const name = privateMemoForm.name.trim();
    if (!name) {
      toast.error("Name is required");
      return;
    }

    setBusyId("private-memo-create");
    try {
      const res = await apiPost<{ memo_url: string; lead: Lead }>("api-investor", "create-private-memo", {
        name,
        email: privateMemoForm.email.trim() || null,
        internal_note: privateMemoForm.internalNote.trim() || null,
      });
      setLeads((current) => [res.lead, ...current.filter((lead) => lead.id !== res.lead.id)]);
      setIssuedLinks((current) => ({ ...current, [res.lead.id]: res.memo_url }));
      setPrivateMemoResult({ leadId: res.lead.id, url: res.memo_url });
      toast.success("Private memo created");
    } catch (error) {
      toast.error((error as Error).message);
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
      const link = canonicalAppUrl(`/pulse/${res.pulse_token.id}`);
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

  async function copyPrivateMemoLink(id: string, text: string) {
    try {
      await copyWithFallback(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
      toast.success("Link copied");
    } catch (error) {
      toast.error((error as Error).message || "Could not copy link");
    }
  }

  function changePrivateMemoOpen(open: boolean) {
    setPrivateMemoOpen(open);
    if (!open) {
      setPrivateMemoForm({ name: "", email: "", internalNote: "" });
      setPrivateMemoResult(null);
    }
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-medium tracking-tight">Investors</h1>
            <p className="text-sm text-neutral-500 mt-1">Manage access requests and investor page content.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPrivateMemoOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-md bg-white px-3 text-sm font-medium text-black hover:bg-neutral-200">
              <Plus className="h-4 w-4" /> Private memo
            </button>
            <button onClick={load} className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-neutral-800 hover:bg-neutral-900 text-sm">
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
          </div>
        </div>

        <Dialog open={privateMemoOpen} onOpenChange={changePrivateMemoOpen}>
          <DialogContent className="border-neutral-800 bg-neutral-950 text-neutral-100 sm:max-w-md">
            {privateMemoResult ? (
              <div className="space-y-5">
                <DialogHeader>
                  <DialogTitle>Private memo created</DialogTitle>
                  <DialogDescription>No email was sent. Share this private link directly with the recipient.</DialogDescription>
                </DialogHeader>
                <code className="block overflow-x-auto whitespace-nowrap rounded-md border border-neutral-800 bg-black/40 px-3 py-3 text-xs text-neutral-300">{privateMemoResult.url}</code>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button type="button" onClick={() => copyPrivateMemoLink(privateMemoResult.leadId, privateMemoResult.url)} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-white px-4 text-sm font-medium text-black hover:bg-neutral-200">
                    {copied === privateMemoResult.leadId ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copied === privateMemoResult.leadId ? "Link copied" : "Copy link"}
                  </button>
                  <a href={privateMemoResult.url} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-center rounded-md border border-neutral-700 px-4 text-sm font-medium hover:bg-neutral-900">Open memo</a>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <DialogHeader>
                  <DialogTitle>Create private memo</DialogTitle>
                  <DialogDescription>Create a personalized, revocable investor link. Nothing is emailed automatically.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <label className="block space-y-1.5" htmlFor="private-memo-name">
                    <span className="text-sm font-medium">Name *</span>
                    <Input id="private-memo-name" autoFocus value={privateMemoForm.name} onChange={(event) => setPrivateMemoForm((current) => ({ ...current, name: event.target.value }))} className="border-neutral-800 bg-neutral-900" />
                  </label>
                  <label className="block space-y-1.5" htmlFor="private-memo-email">
                    <span className="text-sm font-medium">Email <span className="font-normal text-neutral-500">(optional)</span></span>
                    <Input id="private-memo-email" type="email" value={privateMemoForm.email} onChange={(event) => setPrivateMemoForm((current) => ({ ...current, email: event.target.value }))} className="border-neutral-800 bg-neutral-900" />
                  </label>
                  <label className="block space-y-1.5" htmlFor="private-memo-note">
                    <span className="text-sm font-medium">Internal note <span className="font-normal text-neutral-500">(optional)</span></span>
                    <Textarea id="private-memo-note" value={privateMemoForm.internalNote} onChange={(event) => setPrivateMemoForm((current) => ({ ...current, internalNote: event.target.value }))} className="border-neutral-800 bg-neutral-900" />
                  </label>
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => changePrivateMemoOpen(false)} className="h-10 rounded-md border border-neutral-800 px-4 text-sm hover:bg-neutral-900">Cancel</button>
                  <button type="button" onClick={createPrivateMemo} disabled={busyId === "private-memo-create" || !privateMemoForm.name.trim()} className="inline-flex h-10 items-center gap-2 rounded-md bg-white px-4 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50">
                    {busyId === "private-memo-create" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Create memo
                  </button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

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
              <p className="mt-1 text-sm text-neutral-500">Hero and thesis copy used by the public preview and private memo.</p>
              <div className="mt-6 space-y-4">
                <TextArea label="Headline" value={settings.headline || ""} onChange={(v) => patchSettings({ headline: v })} rows={2} />
                <TextArea label="Subheadline" value={settings.subheadline || ""} onChange={(v) => patchSettings({ subheadline: v })} rows={3} />
                <TextArea label="Public thesis" value={settings.public_thesis || ""} onChange={(v) => patchSettings({ public_thesis: v })} rows={5} />
                <TextArea label="Private memo intro" value={settings.memo_intro || ""} onChange={(v) => patchSettings({ memo_intro: v })} rows={4} />
              </div>
            </section>

            <section className="rounded-xl border border-neutral-900 bg-neutral-950 p-5">
              <h2 className="text-lg font-medium">Public preview copy</h2>
              <p className="mt-1 text-sm text-neutral-500">Section labels and supporting copy around the hero and public thesis.</p>
              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                <TextField label="Preview badge" value={settings.page_content.preview_badge} onChange={(v) => patchPageContent({ preview_badge: v })} />
                <TextField label="Thesis eyebrow" value={settings.page_content.preview_thesis_eyebrow} onChange={(v) => patchPageContent({ preview_thesis_eyebrow: v })} />
                <TextField label="Visual evidence heading" value={settings.page_content.preview_visual_heading} onChange={(v) => patchPageContent({ preview_visual_heading: v })} />
                <TextField label="Product stack heading" value={settings.page_content.preview_stack_heading} onChange={(v) => patchPageContent({ preview_stack_heading: v })} />
                <TextField label="Access eyebrow" value={settings.page_content.preview_access_eyebrow} onChange={(v) => patchPageContent({ preview_access_eyebrow: v })} />
                <TextField label="Access title" value={settings.page_content.preview_access_title} onChange={(v) => patchPageContent({ preview_access_title: v })} />
                <div className="lg:col-span-2">
                  <TextArea label="Access body" value={settings.page_content.preview_access_body} onChange={(v) => patchPageContent({ preview_access_body: v })} rows={3} />
                </div>
                <JsonArea label="Preview highlights" value={jsonFields.preview_highlights} onChange={(v) => setJsonFields((s) => ({ ...s, preview_highlights: v }))} rows={10} />
                <JsonArea label="Product pillars" value={jsonFields.preview_pillars} onChange={(v) => setJsonFields((s) => ({ ...s, preview_pillars: v }))} rows={10} />
              </div>
            </section>

            <section className="rounded-xl border border-neutral-900 bg-neutral-950 p-5">
              <h2 className="text-lg font-medium">Visual evidence labels</h2>
              <p className="mt-1 text-sm text-neutral-500">Headings for the venue, dart and product images. Image captions are edited in Assets below.</p>
              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                <TextField label="Memo eyebrow" value={settings.page_content.memo_visual_eyebrow} onChange={(v) => patchPageContent({ memo_visual_eyebrow: v })} />
                <TextField label="Memo visual title" value={settings.page_content.memo_visual_title} onChange={(v) => patchPageContent({ memo_visual_title: v })} />
                <VisualLabelFields
                  name="Venue"
                  label={settings.page_content.visual_venue_label}
                  title={settings.page_content.visual_venue_title}
                  body={settings.page_content.visual_venue_body}
                  onChange={patchPageContent}
                  keys={{ label: "visual_venue_label", title: "visual_venue_title", body: "visual_venue_body" }}
                />
                <VisualLabelFields
                  name="Dart"
                  label={settings.page_content.visual_dart_label}
                  title={settings.page_content.visual_dart_title}
                  body={settings.page_content.visual_dart_body}
                  onChange={patchPageContent}
                  keys={{ label: "visual_dart_label", title: "visual_dart_title", body: "visual_dart_body" }}
                />
                <VisualLabelFields
                  name="Product"
                  label={settings.page_content.visual_product_label}
                  title={settings.page_content.visual_product_title}
                  body={settings.page_content.visual_product_body}
                  onChange={patchPageContent}
                  keys={{ label: "visual_product_label", title: "visual_product_title", body: "visual_product_body" }}
                />
              </div>
            </section>

            <section className="rounded-xl border border-neutral-900 bg-neutral-950 p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-medium">Memo sections</h2>
                  <p className="mt-1 text-sm text-neutral-500">Eyebrow, title and body render in this order in the private memo.</p>
                </div>
                <button type="button" onClick={addMemoSection} className="inline-flex h-9 items-center gap-2 rounded-md border border-neutral-800 px-3 text-sm hover:bg-neutral-900">
                  <Plus className="h-4 w-4" /> Add section
                </button>
              </div>
              <div className="mt-6 space-y-4">
                {settings.memo_sections.map((section, index) => (
                  <div key={index} className="rounded-xl border border-neutral-900 bg-[#0B0C0E] p-4">
                    <div className="grid gap-4 lg:grid-cols-2">
                      <TextField label={`Section ${index + 1} eyebrow`} value={section.kicker || ""} onChange={(v) => patchMemoSection(index, { kicker: v })} />
                      <TextField label={`Section ${index + 1} title`} value={section.title} onChange={(v) => patchMemoSection(index, { title: v })} />
                      <div className="lg:col-span-2">
                        <TextArea label={`Section ${index + 1} body`} value={section.body} onChange={(v) => patchMemoSection(index, { body: v })} rows={4} />
                      </div>
                    </div>
                    <button type="button" onClick={() => removeMemoSection(index)} className="mt-3 inline-flex h-8 items-center gap-2 rounded-md border border-red-950 px-3 text-xs text-red-300 hover:bg-red-950/30">
                      <Trash2 className="h-3.5 w-3.5" /> Remove
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-neutral-900 bg-neutral-950 p-5">
              <h2 className="text-lg font-medium">Memo section labels</h2>
              <p className="mt-1 text-sm text-neutral-500">Headings around the offer, evidence lists, team and interest card.</p>
              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                <TextField label="Deck eyebrow" value={settings.page_content.memo_deck_eyebrow} onChange={(v) => patchPageContent({ memo_deck_eyebrow: v })} />
                <TextField label="Deck title" value={settings.page_content.memo_deck_title} onChange={(v) => patchPageContent({ memo_deck_title: v })} />
                <TextField label="Offer eyebrow" value={settings.page_content.memo_offer_eyebrow} onChange={(v) => patchPageContent({ memo_offer_eyebrow: v })} />
                <TextField label="Round size label" value={settings.page_content.memo_round_size_label} onChange={(v) => patchPageContent({ memo_round_size_label: v })} />
                <TextField label="Valuation label" value={settings.page_content.memo_valuation_label} onChange={(v) => patchPageContent({ memo_valuation_label: v })} />
                <TextField label="Share price label" value={settings.page_content.memo_share_price_label} onChange={(v) => patchPageContent({ memo_share_price_label: v })} />
                <TextField label="Shares offered label" value={settings.page_content.memo_shares_offered_label} onChange={(v) => patchPageContent({ memo_shares_offered_label: v })} />
                <TextField label="Existing shares label" value={settings.page_content.memo_existing_shares_label} onChange={(v) => patchPageContent({ memo_existing_shares_label: v })} />
                <TextField label="Minimum label" value={settings.page_content.memo_minimum_label} onChange={(v) => patchPageContent({ memo_minimum_label: v })} />
                <TextField label="Deadline label" value={settings.page_content.memo_deadline_label} onChange={(v) => patchPageContent({ memo_deadline_label: v })} />
                <TextField label="Allocation label" value={settings.page_content.memo_allocation_label} onChange={(v) => patchPageContent({ memo_allocation_label: v })} />
                <TextField label="Use of funds eyebrow" value={settings.page_content.memo_use_of_funds_eyebrow} onChange={(v) => patchPageContent({ memo_use_of_funds_eyebrow: v })} />
                <TextField label="Use of funds title" value={settings.page_content.memo_use_of_funds_title} onChange={(v) => patchPageContent({ memo_use_of_funds_title: v })} />
                <TextField label="Traction eyebrow" value={settings.page_content.memo_traction_eyebrow} onChange={(v) => patchPageContent({ memo_traction_eyebrow: v })} />
                <TextField label="Traction title" value={settings.page_content.memo_traction_title} onChange={(v) => patchPageContent({ memo_traction_title: v })} />
                <TextField label="Risks eyebrow" value={settings.page_content.memo_risks_eyebrow} onChange={(v) => patchPageContent({ memo_risks_eyebrow: v })} />
                <TextField label="Risks title" value={settings.page_content.memo_risks_title} onChange={(v) => patchPageContent({ memo_risks_title: v })} />
                <TextField label="Team eyebrow" value={settings.page_content.memo_team_eyebrow} onChange={(v) => patchPageContent({ memo_team_eyebrow: v })} />
                <TextField label="Team title" value={settings.page_content.memo_team_title} onChange={(v) => patchPageContent({ memo_team_title: v })} />
                <TextField label="Interest eyebrow" value={settings.page_content.memo_interest_eyebrow} onChange={(v) => patchPageContent({ memo_interest_eyebrow: v })} />
                <TextField label="Interest title" value={settings.page_content.memo_interest_title} onChange={(v) => patchPageContent({ memo_interest_title: v })} />
                <div className="lg:col-span-2">
                  <TextArea label="Interest body" value={settings.page_content.memo_interest_body} onChange={(v) => patchPageContent({ memo_interest_body: v })} rows={3} />
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-neutral-900 bg-neutral-950 p-5">
              <h2 className="text-lg font-medium">Supporting structured content</h2>
              <p className="mt-1 text-sm text-neutral-500">JSON arrays for repeated evidence and team cards.</p>
              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                <JsonArea label="Use of funds" value={jsonFields.use_of_funds} onChange={(v) => setJsonFields((s) => ({ ...s, use_of_funds: v }))} />
                <JsonArea label="Traction metrics" value={jsonFields.traction_metrics} onChange={(v) => setJsonFields((s) => ({ ...s, traction_metrics: v }))} />
                <JsonArea label="Risks" value={jsonFields.risks} onChange={(v) => setJsonFields((s) => ({ ...s, risks: v }))} />
                <JsonArea label="Team" value={jsonFields.team} onChange={(v) => setJsonFields((s) => ({ ...s, team: v }))} />
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
                        <div className="mt-2 truncate text-xs text-neutral-600">{asset.storage_path}</div>
                      </div>
                      <button onClick={() => toggleAsset(asset)} className="h-8 rounded-md border border-neutral-800 px-3 text-xs hover:bg-neutral-900">
                        {asset.is_active ? "Active" : "Inactive"}
                      </button>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-[150px_1fr_100px]">
                      <label className="block">
                        <span className="text-xs text-neutral-500">Asset type</span>
                        <select
                          value={asset.asset_type}
                          onChange={(e) => patchAsset(asset.id, { asset_type: e.target.value as InvestorAssetType })}
                          className="mt-1 h-10 w-full rounded-lg border border-neutral-800 bg-[#0B0C0E] px-3 text-sm outline-none focus:border-neutral-600"
                        >
                          {investorAssetTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                        </select>
                      </label>
                      <TextField label="Caption title" value={asset.title} onChange={(v) => patchAsset(asset.id, { title: v })} />
                      <NumberField label="Sort order" value={asset.sort_order} onChange={(v) => patchAsset(asset.id, { sort_order: v || 0 })} />
                      <div className="sm:col-span-3">
                        <TextArea label="Caption description" value={asset.description || ""} onChange={(v) => patchAsset(asset.id, { description: v || null })} rows={2} />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => saveAsset(asset)}
                      disabled={busyId === `asset-${asset.id}`}
                      className="mt-3 inline-flex h-8 items-center gap-2 rounded-md border border-neutral-800 px-3 text-xs hover:bg-neutral-900 disabled:opacity-50"
                    >
                      {busyId === `asset-${asset.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      Save caption
                    </button>
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
        const isPrivate = lead.metadata?.source === "private_invite";
        const isRevoked = isPrivate && lead.status === "rejected" && !!lead.approved_at && !lead.rejected_at;
        return (
          <div key={lead.id} className="rounded-xl border border-neutral-900 bg-neutral-950 p-5">
            <div className="flex flex-wrap items-start gap-4 justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="font-medium">{lead.name || lead.email}</div>
                  {isPrivate && <span className="rounded border border-violet-800 bg-violet-950/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-violet-300">Private</span>}
                  <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded ${statusStyles[lead.status]}`}>{isRevoked ? "revoked" : lead.status}</span>
                </div>
                <div className="text-xs text-neutral-500 mt-1">
                  {isPrivate
                    ? <>{lead.email ? `${lead.email} · ` : ""}created {new Date(lead.created_at).toLocaleString()}</>
                    : <>{lead.email} · received {new Date(lead.created_at).toLocaleString()}</>}
                </div>
                {lead.message && <div className="mt-3 text-sm text-neutral-400 border-l-2 border-neutral-800 pl-3 italic">{lead.message}</div>}
                {isPrivate && lead.metadata?.internal_note && <div className="mt-3 border-l-2 border-neutral-800 pl-3 text-sm text-neutral-400">{lead.metadata.internal_note}</div>}
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
              const link = canonicalAppUrl(`/pulse/${token.id}`);
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

type PageContentTextKey = {
  [Key in keyof InvestorPageContent]: InvestorPageContent[Key] extends string ? Key : never;
}[keyof InvestorPageContent];

function VisualLabelFields({
  name,
  label,
  title,
  body,
  onChange,
  keys,
}: {
  name: string;
  label: string;
  title: string;
  body: string;
  onChange: (patch: Partial<InvestorPageContent>) => void;
  keys: { label: PageContentTextKey; title: PageContentTextKey; body: PageContentTextKey };
}) {
  return (
    <div className="rounded-xl border border-neutral-900 bg-[#0B0C0E] p-4 lg:col-span-2">
      <div className="text-xs font-medium text-neutral-300">{name}</div>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <TextField label={`${name} eyebrow`} value={label} onChange={(value) => onChange({ [keys.label]: value })} />
        <TextField label={`${name} title`} value={title} onChange={(value) => onChange({ [keys.title]: value })} />
        <div className="lg:col-span-2">
          <TextArea label={`${name} body`} value={body} onChange={(value) => onChange({ [keys.body]: value })} rows={3} />
        </div>
      </div>
    </div>
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
