/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost, ApiRequestError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowDown, ArrowUp, Building2, CheckCircle2, Clock, Copy, Eye, FileText, ImagePlus, Link2, Loader2, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { canonicalAppUrl } from "@/lib/canonicalOrigin";
import {
  corporatePageImagePublicUrl,
  CorporatePublicPageContent,
  MAX_CORPORATE_GALLERY_IMAGES,
  removeCorporatePageImage,
  uploadCorporatePageImage,
} from "@/lib/corporatePublicPage";

interface Props { venueId: string }

type Participation = {
  mode: "unconfigured" | "external" | "pickla";
  state: "not_configured" | "external_pending" | "external_ready" | "pickla_pending" | "pickla_ready";
  message: string | null;
  cta: { label: string; url: string } | null;
};

type CorporateOverview = {
  accounts: any[];
  packages: any[];
  orders: any[];
  series_options: any[];
  linked_series: Array<any & {
    sessions: any[];
    default_court_id: string | null;
    active_session_count: number;
    sessions_using_default_count: number;
    court_exception_count: number;
    participation: Participation;
  }>;
  courts: any[];
};

const statusLabel: Record<string, string> = {
  pending: "Väntar", invoiced: "Fakturerad", paid: "Betald", fulfilled: "Levererad", cancelled: "Avbruten",
};
const participationLabel: Record<Participation["state"], string> = {
  not_configured: "Ingen publik bokning ännu",
  external_pending: "Extern bokning – länk saknas",
  external_ready: "Extern CTA aktiv",
  pickla_pending: "Pickla-bokning – inte öppnad",
  pickla_ready: "Pickla-bokning aktiv",
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Något gick fel";
}

function AccountEditor({ account, onSaved }: { account: any; onSaved: () => void }) {
  const [draft, setDraft] = useState({
    company_name: account.company_name || "",
    slug: account.slug || "",
    public_intro: account.public_intro || "",
    public_visibility: account.public_visibility || "private",
    contact_name: account.contact_name || "",
    contact_email: account.contact_email || "",
    contact_phone: account.contact_phone || "",
    discount_percent: String(account.discount_percent || 0),
    is_active: account.is_active === true,
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await apiPatch("api-corporate", "admin-accounts", { account_id: account.id, ...draft });
      toast.success("Företaget uppdaterades");
      onSaved();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return <div className="grid gap-3 border-t border-border pt-3">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-xs font-semibold">Företagsnamn<Input value={draft.company_name} onChange={(event) => setDraft({ ...draft, company_name: event.target.value })} /></label>
      <label className="grid gap-1 text-xs font-semibold">Slug<Input placeholder="foretagsnamn" value={draft.slug} onChange={(event) => setDraft({ ...draft, slug: event.target.value })} /></label>
      <label className="grid gap-1 text-xs font-semibold">Synlighet
        <Select value={draft.public_visibility} onValueChange={(value) => setDraft({ ...draft, public_visibility: value })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="private">Privat</SelectItem><SelectItem value="unlisted">Olistad (direktlänk)</SelectItem><SelectItem value="listed">Listad</SelectItem></SelectContent>
        </Select>
      </label>
      <label className="flex items-center gap-2 self-end rounded-md border border-border px-3 py-2 text-xs font-semibold">
        <input type="checkbox" checked={draft.is_active} onChange={(event) => setDraft({ ...draft, is_active: event.target.checked })} /> Aktivt konto
      </label>
    </div>
    <label className="grid gap-1 text-xs font-semibold">Publik introduktion<Textarea maxLength={1200} value={draft.public_intro} onChange={(event) => setDraft({ ...draft, public_intro: event.target.value })} /></label>
    <div className="grid gap-3 sm:grid-cols-4">
      <Input aria-label="Kontaktperson" placeholder="Kontaktperson" value={draft.contact_name} onChange={(event) => setDraft({ ...draft, contact_name: event.target.value })} />
      <Input aria-label="Kontaktens e-post" type="email" placeholder="E-post" value={draft.contact_email} onChange={(event) => setDraft({ ...draft, contact_email: event.target.value })} />
      <Input aria-label="Kontaktens telefon" placeholder="Telefon" value={draft.contact_phone} onChange={(event) => setDraft({ ...draft, contact_phone: event.target.value })} />
      <Input aria-label="Företagsrabatt i procent" type="number" min="0" max="100" placeholder="Rabatt %" value={draft.discount_percent} onChange={(event) => setDraft({ ...draft, discount_percent: event.target.value })} />
    </div>
    <Button size="sm" onClick={save} disabled={saving} className="justify-self-end">{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Spara företag</Button>
  </div>;
}

type CorporatePageDraft = {
  hero_headline: string;
  short_intro: string;
  hero_image_path: string | null;
  gallery_image_paths: string[];
  pickleball_heading: string;
  pickleball_body: string;
  pickla_heading: string;
  pickla_body: string;
  practical_information: string;
  help_contact_text: string;
};

function pageDraft(account: any): CorporatePageDraft {
  const page = account.public_page || {};
  return {
    hero_headline: page.hero_headline || `${account.company_name} × Pickla`,
    short_intro: page.short_intro || "",
    hero_image_path: page.hero_image_path || null,
    gallery_image_paths: Array.isArray(page.gallery_image_paths) ? page.gallery_image_paths : [],
    pickleball_heading: page.pickleball_heading || "",
    pickleball_body: page.pickleball_body || "",
    pickla_heading: page.pickla_heading || "",
    pickla_body: page.pickla_body || "",
    practical_information: page.practical_information || "",
    help_contact_text: page.help_contact_text || "",
  };
}

export function CorporatePublicPageEditor({ account, onSaved }: { account: any; onSaved: () => void }) {
  const [draft, setDraft] = useState<CorporatePageDraft>(() => pageDraft(account));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"hero" | "gallery" | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});

  useEffect(() => { setDraft(pageDraft(account)); }, [account]);
  useEffect(() => {
    let cancelled = false;
    const paths = [draft.hero_image_path, ...draft.gallery_image_paths].filter((path): path is string => Boolean(path));
    Promise.all(paths.map(async (path) => [path, await corporatePageImagePublicUrl(path)] as const))
      .then((entries) => { if (!cancelled) setImageUrls(Object.fromEntries(entries)); })
      .catch(() => { if (!cancelled) setImageUrls({}); });
    return () => { cancelled = true; };
  }, [draft.hero_image_path, draft.gallery_image_paths]);

  const persist = async (next: CorporatePageDraft, successMessage: string) => {
    setSaving(true);
    try {
      const saved = await apiPatch<CorporatePublicPageContent>("api-corporate", "admin-page-content", {
        account_id: account.id,
        ...next,
      });
      setDraft({
        hero_headline: saved.hero_headline,
        short_intro: saved.short_intro,
        hero_image_path: saved.hero_image_path || null,
        gallery_image_paths: saved.gallery_image_paths || [],
        pickleball_heading: saved.pickleball_heading,
        pickleball_body: saved.pickleball_body,
        pickla_heading: saved.pickla_heading,
        pickla_body: saved.pickla_body,
        practical_information: saved.practical_information,
        help_contact_text: saved.help_contact_text || "",
      });
      toast.success(successMessage);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const saveText = async () => {
    try { await persist(draft, "Den publika sidan sparades"); }
    catch (error) { toast.error(errorMessage(error)); }
  };

  const uploadImage = async (role: "hero" | "gallery", file?: File) => {
    if (!file) return;
    if (role === "gallery" && draft.gallery_image_paths.length >= MAX_CORPORATE_GALLERY_IMAGES) {
      toast.error(`Max ${MAX_CORPORATE_GALLERY_IMAGES} galleribilder`);
      return;
    }
    setUploading(role);
    let uploadedPath: string | null = null;
    try {
      uploadedPath = await uploadCorporatePageImage({ accountId: account.id, role, file });
      const next = role === "hero"
        ? { ...draft, hero_image_path: uploadedPath }
        : { ...draft, gallery_image_paths: [...draft.gallery_image_paths, uploadedPath] };
      await persist(next, role === "hero" ? "Hero-bilden uppdaterades" : "Bilden lades till");
    } catch (error) {
      if (uploadedPath && role === "gallery") await removeCorporatePageImage(account.id, uploadedPath).catch(() => undefined);
      toast.error(errorMessage(error));
    } finally {
      setUploading(null);
    }
  };

  const removeImage = async (path: string, role: "hero" | "gallery") => {
    const next = role === "hero"
      ? { ...draft, hero_image_path: null }
      : { ...draft, gallery_image_paths: draft.gallery_image_paths.filter((item) => item !== path), hero_image_path: draft.hero_image_path === path ? null : draft.hero_image_path };
    try {
      await persist(next, "Bilden togs bort");
      const remainsReferenced = next.hero_image_path === path || next.gallery_image_paths.includes(path);
      if (!remainsReferenced) await removeCorporatePageImage(account.id, path);
    } catch (error) { toast.error(errorMessage(error)); }
  };

  const moveGalleryImage = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= draft.gallery_image_paths.length) return;
    const reordered = [...draft.gallery_image_paths];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    try { await persist({ ...draft, gallery_image_paths: reordered }, "Bildordningen uppdaterades"); }
    catch (error) { toast.error(errorMessage(error)); }
  };

  const setGalleryImageAsHero = async (path: string) => {
    try { await persist({ ...draft, hero_image_path: path }, "Hero-bilden valdes"); }
    catch (error) { toast.error(errorMessage(error)); }
  };

  const previewEnabled = Boolean(account.slug) && ["unlisted", "listed"].includes(account.public_visibility);
  const previewHref = account.slug ? canonicalAppUrl(`/foretag/${encodeURIComponent(account.slug)}`) : "#";

  return <details className="rounded-xl border border-border bg-muted/20 p-4">
    <summary className="cursor-pointer text-sm font-bold">Publik företagssida</summary>
    <div className="mt-4 grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background p-3">
        <div><p className="text-sm font-bold">Innehåll för medarbetare</p><p className="text-xs text-muted-foreground">Schema, venue, bana och deltagande hämtas alltid från live-data.</p></div>
        <Button asChild={previewEnabled} type="button" size="sm" variant="outline" disabled={!previewEnabled}>
          {previewEnabled ? <a href={previewHref} target="_blank" rel="noopener noreferrer"><Eye className="mr-2 h-4 w-4" />Förhandsvisa publik sida</a> : <span><Eye className="mr-2 h-4 w-4" />Förhandsvisa publik sida</span>}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-semibold">Hero-rubrik<Input maxLength={160} value={draft.hero_headline} onChange={(event) => setDraft({ ...draft, hero_headline: event.target.value })} /></label>
        <label className="grid gap-1 text-xs font-semibold sm:col-span-2">Kort introduktion<Textarea maxLength={600} value={draft.short_intro} onChange={(event) => setDraft({ ...draft, short_intro: event.target.value })} /></label>
        <label className="grid gap-1 text-xs font-semibold">Pickleball-rubrik<Input maxLength={160} value={draft.pickleball_heading} onChange={(event) => setDraft({ ...draft, pickleball_heading: event.target.value })} /></label>
        <label className="grid gap-1 text-xs font-semibold sm:col-span-2">Om pickleball<Textarea maxLength={1600} rows={4} value={draft.pickleball_body} onChange={(event) => setDraft({ ...draft, pickleball_body: event.target.value })} /></label>
        <label className="grid gap-1 text-xs font-semibold">Pickla-rubrik<Input maxLength={160} value={draft.pickla_heading} onChange={(event) => setDraft({ ...draft, pickla_heading: event.target.value })} /></label>
        <label className="grid gap-1 text-xs font-semibold sm:col-span-2">Om Pickla<Textarea maxLength={1600} rows={4} value={draft.pickla_body} onChange={(event) => setDraft({ ...draft, pickla_body: event.target.value })} /></label>
        <label className="grid gap-1 text-xs font-semibold sm:col-span-2">Praktisk information<Textarea maxLength={1600} rows={4} value={draft.practical_information} onChange={(event) => setDraft({ ...draft, practical_information: event.target.value })} /></label>
        <label className="grid gap-1 text-xs font-semibold sm:col-span-2">Hjälp/kontakt (valfri)<Textarea maxLength={1200} rows={3} value={draft.help_contact_text} onChange={(event) => setDraft({ ...draft, help_contact_text: event.target.value })} /></label>
      </div>

      <section className="grid gap-3 rounded-lg border border-border bg-background p-3">
        <div><p className="text-sm font-bold">Hero-bild</p><p className="text-xs text-muted-foreground">JPG, PNG eller WebP · max 5 MB. Bilden skalas ned och sparas som WebP.</p></div>
        {draft.hero_image_path && <div className="flex items-center gap-3"><img src={imageUrls[draft.hero_image_path]} alt="Vald hero" className="h-20 w-28 rounded-lg bg-muted object-cover" /><Button type="button" size="sm" variant="outline" onClick={() => removeImage(draft.hero_image_path!, "hero")} disabled={saving}><Trash2 className="mr-2 h-4 w-4" />Ta bort</Button></div>}
        <label className="inline-flex w-fit cursor-pointer items-center rounded-md border border-border px-3 py-2 text-xs font-bold"><ImagePlus className="mr-2 h-4 w-4" />{uploading === "hero" ? "Laddar upp…" : draft.hero_image_path ? "Byt hero-bild" : "Ladda upp hero-bild"}<input aria-label="Ladda upp hero-bild" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={Boolean(uploading) || saving} onChange={(event) => { void uploadImage("hero", event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
      </section>

      <section className="grid gap-3 rounded-lg border border-border bg-background p-3">
        <div><p className="text-sm font-bold">Galleri</p><p className="text-xs text-muted-foreground">Upp till {MAX_CORPORATE_GALLERY_IMAGES} bilder. Ordningen används på den publika sidan.</p></div>
        <ul className="grid gap-2 sm:grid-cols-2">{draft.gallery_image_paths.map((path, index) => <li key={path} className="grid grid-cols-[5rem_1fr] gap-3 rounded-lg border border-border p-2"><img src={imageUrls[path]} alt={`Galleribild ${index + 1}`} className="h-20 w-20 rounded-md bg-muted object-cover" /><div className="flex flex-wrap content-center gap-1"><Button type="button" size="sm" variant="outline" onClick={() => setGalleryImageAsHero(path)} disabled={saving || draft.hero_image_path === path}>Välj som hero</Button><Button type="button" size="icon" variant="outline" aria-label={`Flytta bild ${index + 1} upp`} onClick={() => moveGalleryImage(index, -1)} disabled={saving || index === 0}><ArrowUp className="h-4 w-4" /></Button><Button type="button" size="icon" variant="outline" aria-label={`Flytta bild ${index + 1} ned`} onClick={() => moveGalleryImage(index, 1)} disabled={saving || index === draft.gallery_image_paths.length - 1}><ArrowDown className="h-4 w-4" /></Button><Button type="button" size="icon" variant="outline" aria-label={`Ta bort bild ${index + 1}`} onClick={() => removeImage(path, "gallery")} disabled={saving}><Trash2 className="h-4 w-4" /></Button></div></li>)}</ul>
        <label className={`inline-flex w-fit items-center rounded-md border border-border px-3 py-2 text-xs font-bold ${draft.gallery_image_paths.length >= MAX_CORPORATE_GALLERY_IMAGES ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}><ImagePlus className="mr-2 h-4 w-4" />{uploading === "gallery" ? "Laddar upp…" : "Lägg till galleribild"}<input aria-label="Lägg till galleribild" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={Boolean(uploading) || saving || draft.gallery_image_paths.length >= MAX_CORPORATE_GALLERY_IMAGES} onChange={(event) => { void uploadImage("gallery", event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
      </section>

      <Button type="button" onClick={saveText} disabled={saving || Boolean(uploading)} className="justify-self-end">{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Spara publik sida</Button>
    </div>
  </details>;
}

function SessionCourtRow({ session, seriesDefaultCourtId, courts, onSaved }: { session: any; seriesDefaultCourtId: string | null; courts: any[]; onSaved: () => void }) {
  const currentCourtId = session.court_ids?.length === 1 ? session.court_ids[0] : "";
  const [courtId, setCourtId] = useState(currentCourtId);
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const isException = !seriesDefaultCourtId || currentCourtId !== seriesDefaultCourtId;

  useEffect(() => { setCourtId(currentCourtId); setPreview(null); }, [currentCourtId]);

  const run = async (action: "preview" | "apply") => {
    if (!courtId) return;
    setBusy(true);
    try {
      const response = await apiPost<{ result: any }>("api-corporate", "admin-session-court", { session_id: session.id, court_id: courtId, action });
      setPreview(response.result);
      if (action === "apply") { toast.success("Tillfällets bana uppdaterades"); onSaved(); }
    } catch (error) {
      const result = error instanceof ApiRequestError ? error.data?.result : null;
      if (result) setPreview(result);
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return <li className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_12rem_auto] sm:items-center">
    <div><p className="text-sm font-semibold">{session.session_date} · {session.start_time.slice(0, 5)}–{session.end_time.slice(0, 5)}</p><p className="text-xs text-muted-foreground">Tillfälle {session.series_occurrence_index || "–"} {isException ? "· Banundantag" : "· Seriens standardbana"}</p></div>
    <Select value={courtId} onValueChange={(value) => { setCourtId(value); setPreview(null); }}><SelectTrigger><SelectValue placeholder="Välj bana" /></SelectTrigger><SelectContent>{courts.filter((court) => court.is_available).map((court) => <SelectItem key={court.id} value={court.id}>{court.name}</SelectItem>)}</SelectContent></Select>
    <div className="flex gap-2"><Button size="sm" variant="outline" disabled={!courtId || busy} onClick={() => run("preview")}>Kontrollera</Button><Button size="sm" disabled={!preview?.is_available || busy || courtId === currentCourtId} onClick={() => run("apply")}>Ändra detta tillfälle</Button></div>
    {preview && !preview.is_available && <p className="text-xs text-destructive sm:col-span-3">Konflikt: {(preview.conflicts || []).map((conflict: any) => `${conflict.title} (${conflict.source_type})`).join(", ")}</p>}
  </li>;
}

function CorporateSeriesPanel({ series, order, account, courts, onSaved }: { series: CorporateOverview["linked_series"][number]; order: any; account: any; courts: any[]; onSaved: () => void }) {
  const [mode, setMode] = useState(series.participation_management_mode || "unconfigured");
  const [externalUrl, setExternalUrl] = useState(series.external_booking_url || "");
  const [externalLabel, setExternalLabel] = useState(series.external_booking_label || "");
  const [courtId, setCourtId] = useState(series.default_court_id || "");
  const [preview, setPreview] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMode(series.participation_management_mode || "unconfigured");
    setExternalUrl(series.external_booking_url || "");
    setExternalLabel(series.external_booking_label || "");
    setCourtId(series.default_court_id || "");
    setPreview(null);
  }, [series.id, series.participation_management_mode, series.external_booking_url, series.external_booking_label, series.default_court_id]);

  const saveParticipation = async () => {
    setBusy(true);
    try {
      await apiPatch("api-corporate", "admin-series", {
        series_id: series.id,
        participation_management_mode: mode,
        external_booking_url: externalUrl,
        external_booking_label: externalLabel,
      });
      toast.success("Deltagarhanteringen uppdaterades");
      onSaved();
    } catch (error) { toast.error(errorMessage(error)); } finally { setBusy(false); }
  };

  const runAll = async (action: "preview" | "apply") => {
    if (!courtId) return;
    setBusy(true);
    try {
      const response = await apiPost<{ result: any }>("api-corporate", "admin-series-court", { series_id: series.id, court_id: courtId, action });
      const rows = action === "preview" ? response.result : response.result?.preview;
      setPreview(Array.isArray(rows) ? rows : []);
      if (action === "apply") { toast.success(`Banan tilldelades ${response.result.session_count} tillfällen`); onSaved(); }
    } catch (error) {
      const result = error instanceof ApiRequestError ? error.data?.result as any : null;
      if (result?.preview) setPreview(result.preview);
      toast.error(errorMessage(error));
    } finally { setBusy(false); }
  };

  const conflicts = (preview || []).filter((row) => row.is_available === false);

  return <Card className="border-primary/20">
    <CardHeader className="pb-3"><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="text-base">{series.name}</CardTitle><Badge variant="outline">{account?.company_name || "Företag"} · {order?.order_number || "Order"}</Badge></div></CardHeader>
    <CardContent className="grid gap-5">
      <section className="grid gap-3 rounded-xl bg-muted/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold">Deltagarhantering</h3><Badge>{participationLabel[series.participation.state]}</Badge></div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-xs font-semibold">Läge<Select value={mode} onValueChange={setMode}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unconfigured">Inte konfigurerat</SelectItem><SelectItem value="external">Extern bokning</SelectItem><SelectItem value="pickla">Bokning via Pickla</SelectItem></SelectContent></Select></label>
          <label className="grid gap-1 text-xs font-semibold">Extern HTTPS-länk<Input type="url" placeholder="https://…" value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} /></label>
          <label className="grid gap-1 text-xs font-semibold">CTA-text (valfri)<Input maxLength={80} placeholder="Gå till bokning" value={externalLabel} onChange={(event) => setExternalLabel(event.target.value)} /></label>
        </div>
        <p className="text-xs text-muted-foreground">{series.participation.cta ? `Publik CTA: ${series.participation.cta.label}` : series.participation.message}</p>
        <div className="flex justify-end gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setExternalUrl("")}>Rensa länk</Button><Button type="button" size="sm" onClick={saveParticipation} disabled={busy}>Spara deltagarhantering</Button></div>
      </section>

      <section className="grid gap-3 rounded-xl bg-muted/40 p-4">
        <div><h3 className="text-sm font-bold">Standardbana för hela serien</h3><p className="text-xs text-muted-foreground">{series.sessions_using_default_count}/{series.active_session_count} använder standardbanan · {series.court_exception_count} undantag</p></div>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <Select value={courtId} onValueChange={(value) => { setCourtId(value); setPreview(null); }}><SelectTrigger><SelectValue placeholder="Välj exakt en bana" /></SelectTrigger><SelectContent>{courts.filter((court) => court.is_available).map((court) => <SelectItem key={court.id} value={court.id}>{court.name}</SelectItem>)}</SelectContent></Select>
          <Button variant="outline" disabled={!courtId || busy} onClick={() => runAll("preview")}>Kontrollera alla</Button>
          <Button disabled={!courtId || busy || !preview || conflicts.length > 0} onClick={() => runAll("apply")}>Tillämpa på alla tillfällen</Button>
        </div>
        {preview && <p className={`text-xs ${conflicts.length ? "text-destructive" : "text-emerald-700"}`}>{conflicts.length ? `${conflicts.length} konflikt(er): ${conflicts.map((row) => row.session_date).join(", ")}. Inga ändringar har gjorts.` : `${preview.length} tillfällen är lediga. Du kan nu tillämpa banan på alla.`}</p>}
      </section>

      <details><summary className="cursor-pointer text-sm font-bold">Enskilda tillfällen och banundantag</summary><ul className="mt-3 grid gap-2">{series.sessions.filter((session: any) => session.is_active).map((session: any) => <SessionCourtRow key={session.id} session={session} seriesDefaultCourtId={series.default_court_id} courts={courts} onSaved={onSaved} />)}</ul></details>
    </CardContent>
  </Card>;
}

export default function AdminCorporate({ venueId }: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [showOrder, setShowOrder] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ company_name: "", slug: "", public_intro: "", contact_name: "", contact_email: "", contact_phone: "", discount_percent: "0", public_visibility: "private" });
  const [orderForm, setOrderForm] = useState({ corporate_account_id: "", order_type: "recurring", purchaser_name: "", total_hours: "0", total_price: "0", price_includes_vat: true, included_items: "", notes: "" });
  const [linkOrderId, setLinkOrderId] = useState("");
  const [linkSeriesId, setLinkSeriesId] = useState("");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-corporate-overview", venueId],
    enabled: Boolean(venueId),
    queryFn: () => apiGet<CorporateOverview>("api-corporate", "admin-overview", { venueId }),
  });
  const overview = data || { accounts: [], packages: [], orders: [], series_options: [], linked_series: [], courts: [] };
  const accountById = useMemo(() => new Map(overview.accounts.map((account) => [account.id, account])), [overview.accounts]);
  const orderById = useMemo(() => new Map(overview.orders.map((order) => [order.id, order])), [overview.orders]);

  const createAccount = async () => {
    if (!form.company_name.trim()) { toast.error("Ange företagsnamn"); return; }
    setCreating(true);
    try {
      await apiPost("api-corporate", "admin-accounts", { venue_id: venueId, ...form });
      toast.success(`${form.company_name} skapades utan automatisk timbank`);
      setShowCreate(false);
      setForm({ company_name: "", slug: "", public_intro: "", contact_name: "", contact_email: "", contact_phone: "", discount_percent: "0", public_visibility: "private" });
      refetch();
    } catch (error) { toast.error(errorMessage(error)); } finally { setCreating(false); }
  };

  const createOrder = async () => {
    if (!orderForm.corporate_account_id) { toast.error("Välj företag"); return; }
    setCreating(true);
    try {
      await apiPost("api-corporate", "admin-orders", {
        ...orderForm,
        total_hours: Number(orderForm.total_hours || 0),
        total_price: Number(orderForm.total_price || 0),
        included_items: orderForm.included_items.split("\n").map((item) => item.trim()).filter(Boolean),
      });
      toast.success("Order skapad"); setShowOrder(false); refetch();
    } catch (error) { toast.error(errorMessage(error)); } finally { setCreating(false); }
  };

  const updateOrderStatus = async (orderId: string, status: string) => {
    try { await apiPatch("api-corporate", "orders", { order_id: orderId, status }); toast.success(`Order ${statusLabel[status] || status}`); refetch(); }
    catch (error) { toast.error(errorMessage(error)); }
  };

  const linkSeries = async () => {
    if (!linkOrderId || !linkSeriesId) return;
    try { await apiPatch("api-corporate", "admin-series", { series_id: linkSeriesId, corporate_order_id: linkOrderId }); toast.success("Serien länkades till ordern"); setLinkSeriesId(""); refetch(); }
    catch (error) { toast.error(errorMessage(error)); }
  };

  if (isLoading) return <div className="grid min-h-48 place-items-center"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  return <Tabs defaultValue="accounts" className="space-y-4">
    <TabsList className="grid w-full grid-cols-2"><TabsTrigger value="accounts" className="gap-1"><Building2 className="h-3.5 w-3.5" /> Konton & serier</TabsTrigger><TabsTrigger value="orders" className="gap-1"><ShoppingCart className="h-3.5 w-3.5" /> Ordrar & timbank</TabsTrigger></TabsList>

    <TabsContent value="accounts" className="space-y-4">
      <div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">{overview.accounts.length} företagskonton</p><Dialog open={showCreate} onOpenChange={setShowCreate}><DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-4 w-4" /> Nytt företag</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Skapa företagskonto</DialogTitle></DialogHeader><div className="grid gap-3"><Input placeholder="Företagsnamn *" value={form.company_name} onChange={(event) => setForm({ ...form, company_name: event.target.value })} /><Input placeholder="Slug" value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} /><Textarea placeholder="Publik introduktion" value={form.public_intro} onChange={(event) => setForm({ ...form, public_intro: event.target.value })} /><Select value={form.public_visibility} onValueChange={(value) => setForm({ ...form, public_visibility: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="private">Privat</SelectItem><SelectItem value="unlisted">Olistad</SelectItem><SelectItem value="listed">Listad</SelectItem></SelectContent></Select><Input placeholder="Kontaktperson" value={form.contact_name} onChange={(event) => setForm({ ...form, contact_name: event.target.value })} /><Input type="email" placeholder="E-post" value={form.contact_email} onChange={(event) => setForm({ ...form, contact_email: event.target.value })} /><Input placeholder="Telefon" value={form.contact_phone} onChange={(event) => setForm({ ...form, contact_phone: event.target.value })} /><Input type="number" min="0" max="100" placeholder="Rabatt %" value={form.discount_percent} onChange={(event) => setForm({ ...form, discount_percent: event.target.value })} /><p className="text-xs text-muted-foreground">Ingen timbank skapas automatiskt. Skapa en timorder separat om produkten ska användas.</p><Button onClick={createAccount} disabled={creating}>{creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Skapa"}</Button></div></DialogContent></Dialog></div>

      {overview.accounts.map((account) => { const packages = overview.packages.filter((pkg) => pkg.corporate_account_id === account.id); return <Card key={account.id}><CardHeader className="pb-2"><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4" />{account.company_name}</CardTitle><div className="flex gap-2"><Badge variant={account.is_active ? "default" : "secondary"}>{account.is_active ? "Aktiv" : "Inaktiv"}</Badge><Badge variant="outline">{account.public_visibility || "private"}</Badge></div></div></CardHeader><CardContent className="grid gap-3">{packages.map((pkg) => <p key={pkg.id} className="flex items-center gap-2 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" />Timbank: {Number(pkg.total_hours) - Number(pkg.used_hours)}h / {pkg.total_hours}h</p>)}<Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(canonicalAppUrl(`/corp/join?token=${account.invite_token}`)); toast.success("Inbjudningslänk kopierad"); }}><Copy className="mr-2 h-3.5 w-3.5" />Kopiera medlemsinbjudan</Button><AccountEditor account={account} onSaved={refetch} /><CorporatePublicPageEditor account={account} onSaved={refetch} /></CardContent></Card>; })}

      <Card><CardHeader><CardTitle className="text-base">Länka en befintlig Series till en företagsorder</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"><Select value={linkOrderId} onValueChange={setLinkOrderId}><SelectTrigger><SelectValue placeholder="Välj order" /></SelectTrigger><SelectContent>{overview.orders.filter((order) => order.order_type === "recurring" && order.status !== "cancelled").map((order) => <SelectItem key={order.id} value={order.id}>{accountById.get(order.corporate_account_id)?.company_name} · {order.order_number}</SelectItem>)}</SelectContent></Select><Select value={linkSeriesId} onValueChange={setLinkSeriesId}><SelectTrigger><SelectValue placeholder="Välj olänkad Series" /></SelectTrigger><SelectContent>{overview.series_options.filter((series) => !series.corporate_order_id && series.linkable_for_corporate_phase_1).map((series) => <SelectItem key={series.id} value={series.id}>{series.name}</SelectItem>)}</SelectContent></Select><Button onClick={linkSeries} disabled={!linkOrderId || !linkSeriesId}><Link2 className="mr-2 h-4 w-4" />Länka</Button></CardContent></Card>

      <div className="grid gap-4">{overview.linked_series.map((series) => { const order = orderById.get(series.corporate_order_id); return <CorporateSeriesPanel key={series.id} series={series} order={order} account={accountById.get(order?.corporate_account_id)} courts={overview.courts} onSaved={refetch} />; })}</div>
    </TabsContent>

    <TabsContent value="orders" className="space-y-4">
      <div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">{overview.orders.length} ordrar</p><Dialog open={showOrder} onOpenChange={setShowOrder}><DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-4 w-4" /> Ny order</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Skapa företagsorder</DialogTitle></DialogHeader><div className="grid gap-3"><Select value={orderForm.corporate_account_id} onValueChange={(value) => setOrderForm({ ...orderForm, corporate_account_id: value })}><SelectTrigger><SelectValue placeholder="Företag" /></SelectTrigger><SelectContent>{overview.accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.company_name}</SelectItem>)}</SelectContent></Select><Select value={orderForm.order_type} onValueChange={(value) => setOrderForm({ ...orderForm, order_type: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="recurring">Återkommande kapacitet</SelectItem><SelectItem value="hours">Timbank</SelectItem></SelectContent></Select><Input placeholder="Köpare/betalare" value={orderForm.purchaser_name} onChange={(event) => setOrderForm({ ...orderForm, purchaser_name: event.target.value })} /><Input type="number" placeholder="Avtalssumma SEK" value={orderForm.total_price} onChange={(event) => setOrderForm({ ...orderForm, total_price: event.target.value })} />{orderForm.order_type === "hours" && <Input type="number" placeholder="Antal timmar" value={orderForm.total_hours} onChange={(event) => setOrderForm({ ...orderForm, total_hours: event.target.value })} />}<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={orderForm.price_includes_vat} onChange={(event) => setOrderForm({ ...orderForm, price_includes_vat: event.target.checked })} /> Priset inkluderar moms</label><Textarea placeholder={"Inkluderat, en rad per sak\nRack\nBollar"} value={orderForm.included_items} onChange={(event) => setOrderForm({ ...orderForm, included_items: event.target.value })} /><Textarea placeholder="Intern ordernotering" value={orderForm.notes} onChange={(event) => setOrderForm({ ...orderForm, notes: event.target.value })} /><Button onClick={createOrder} disabled={creating}>Skapa order</Button></div></DialogContent></Dialog></div>
      {overview.orders.map((order) => { const next = order.status === "pending" ? "invoiced" : order.status === "invoiced" ? "paid" : order.status === "paid" ? "fulfilled" : null; return <Card key={order.id}><CardContent className="grid gap-3 pt-4"><div className="flex items-center justify-between"><div><p className="font-mono text-sm font-bold">{order.order_number}</p><p className="text-xs text-muted-foreground">{accountById.get(order.corporate_account_id)?.company_name}</p></div><Badge>{statusLabel[order.status] || order.status}</Badge></div><p className="text-sm text-muted-foreground">{order.order_type === "hours" ? `${order.total_hours}h timbank` : "Återkommande kapacitet"} · {order.total_price} SEK {order.price_includes_vat === true ? "inkl. moms" : ""}</p>{order.purchaser_name && <p className="text-xs">Köpare: {order.purchaser_name}</p>}{order.included_items?.length > 0 && <p className="text-xs">Ingår: {order.included_items.join(", ")}</p>}{next && <Button size="sm" onClick={() => updateOrderStatus(order.id, next)}>{next === "invoiced" ? <FileText className="mr-2 h-4 w-4" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}{next === "invoiced" ? "Markera fakturerad" : next === "paid" ? "Markera betald" : "Leverera"}</Button>}</CardContent></Card>; })}
    </TabsContent>
  </Tabs>;
}
