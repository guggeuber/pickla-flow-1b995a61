import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Check, Circle, ExternalLink, Loader2, Store } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { apiPut } from "@/lib/api";
import type {
  AdminCommerceProduct,
  ProductPresentation,
  TrackedProductDetail,
} from "@/lib/adminCommerce";
import { ax } from "@/components/admin/shell/axTheme";

type Locale = "sv-SE" | "en-SE";
type Draft = {
  locale: Locale;
  slug: string;
  shortDescription: string;
  longDescription: string;
  material: string;
  fit: string;
  care: string;
  returnsPolicy: string;
  sizeGuideBody: string;
  sizeGuideTable: string;
  seoTitle: string;
  seoDescription: string;
  publicationState: "draft" | "published" | "archived";
  lowStockThreshold: string;
};

const INPUT = "w-full rounded-xl border bg-transparent px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-blue-400";
const PANEL = { background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}` };

function slugify(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
}

function tableText(presentation?: ProductPresentation | null) {
  const columns = presentation?.size_guide?.columns || [];
  const rows = presentation?.size_guide?.rows || [];
  return [
    columns.join(" | "),
    ...rows.map((row) => [row.label || "", ...(row.values || [])].join(" | ")),
  ].filter((line) => line.replace(/[|\s]/g, "")).join("\n");
}

function draftFrom(product: AdminCommerceProduct, locale: Locale): Draft {
  const presentation = product.presentations?.find((item) => item.locale === locale) || null;
  return {
    locale,
    slug: presentation?.slug || slugify(product.name),
    shortDescription: presentation?.short_description || "",
    longDescription: presentation?.long_description || "",
    material: presentation?.material || "",
    fit: presentation?.fit || "",
    care: presentation?.care || "",
    returnsPolicy: presentation?.returns_policy || "",
    sizeGuideBody: presentation?.size_guide?.body || "",
    sizeGuideTable: tableText(presentation),
    seoTitle: presentation?.seo_title || "",
    seoDescription: presentation?.seo_description || "",
    publicationState: presentation?.publication_state || "draft",
    lowStockThreshold: String(presentation?.low_stock_threshold ?? 3),
  };
}

function parseSizeGuide(body: string, table: string) {
  const lines = table.split("\n").map((line) => line.split("|").map((cell) => cell.trim())).filter((line) => line.some(Boolean));
  const [columns = [], ...rows] = lines;
  return {
    body: body.trim(),
    columns,
    rows: rows.map(([label = "", ...values]) => ({ label, values })),
  };
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="block"><span className="text-[11px] font-black uppercase tracking-[0.12em]" style={{ color: ax("muted") }}>{label}</span>{children}{hint ? <span className="mt-1 block text-[10px]" style={{ color: ax("muted") }}>{hint}</span> : null}</label>;
}

export default function StorefrontPresentationEditor({
  venueId,
  product,
  detail,
  onChanged,
}: {
  venueId: string;
  product: AdminCommerceProduct;
  detail?: TrackedProductDetail;
  onChanged: () => Promise<void>;
}) {
  const [locale, setLocale] = useState<Locale>("sv-SE");
  const [drafts, setDrafts] = useState<Record<Locale, Draft>>({
    "sv-SE": draftFrom(product, "sv-SE"),
    "en-SE": draftFrom(product, "en-SE"),
  });
  const [saving, setSaving] = useState(false);
  useEffect(() => setDrafts({ "sv-SE": draftFrom(product, "sv-SE"), "en-SE": draftFrom(product, "en-SE") }), [product]);
  const draft = drafts[locale];
  const update = (changes: Partial<Draft>) => setDrafts((current) => ({ ...current, [locale]: { ...current[locale], ...changes } }));

  const colorOption = detail?.options.find((option) => option.code === "color");
  const activeVariants = useMemo(
    () => detail?.variants.filter((variant) => variant.status === "active") || [],
    [detail?.variants],
  );
  const activeMedia = useMemo(() => product.media || [], [product.media]);
  const readiness = useMemo(() => [
    { label: "Produktinformation", ok: Boolean(product.name && (draft.shortDescription || product.description)) },
    { label: "Pris / moms", ok: Number(product.base_price_sek) > 0 && Number(product.vat_rate) >= 0 },
    { label: "Varianter", ok: product.inventory_policy !== "tracked" || activeVariants.length > 0 },
    { label: "SKU", ok: product.inventory_policy !== "tracked" || activeVariants.every((variant) => Boolean(variant.sku)) },
    { label: "Media", ok: activeMedia.length > 0 },
    { label: "Färgmedia", ok: !colorOption || colorOption.product_option_values.every((value) => activeMedia.some((media) => media.option_value_id === value.id)) },
    { label: "Lager", ok: product.inventory_policy !== "tracked" || activeVariants.every((variant) => Boolean(variant.inventory)) },
    { label: "Pickup-listning", ok: product.inventory_policy !== "tracked" || Boolean(detail?.listing?.default_inventory_location_id) },
    { label: "Storefront-innehåll", ok: Boolean(draft.slug && draft.shortDescription && draft.longDescription) },
    { label: "Publicering", ok: draft.publicationState === "published" },
  ], [activeMedia, activeVariants, colorOption, detail?.listing?.default_inventory_location_id, draft, product]);
  const completeCount = readiness.filter((item) => item.ok).length;

  const save = async () => {
    setSaving(true);
    try {
      await apiPut("api-admin", "product-presentation", {
        venueId,
        product_id: product.id,
        locale,
        slug: draft.slug,
        short_description: draft.shortDescription,
        long_description: draft.longDescription,
        material: draft.material,
        fit: draft.fit,
        care: draft.care,
        returns_policy: draft.returnsPolicy,
        size_guide: parseSizeGuide(draft.sizeGuideBody, draft.sizeGuideTable),
        seo_title: draft.seoTitle,
        seo_description: draft.seoDescription,
        publication_state: draft.publicationState,
        low_stock_threshold: Number(draft.lowStockThreshold || 3),
      });
      await onChanged();
      toast.success("Storefront-presentationen sparades");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Presentation kunde inte sparas");
    } finally {
      setSaving(false);
    }
  };

  return <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_330px]" data-testid="storefront-presentation-editor">
    <div className="space-y-4 rounded-2xl p-4" style={PANEL}>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: ax("magenta") }}>Storefront</p><h3 className="mt-1 text-base font-black text-white">Det kunden ser</h3><p className="mt-1 max-w-xl text-xs leading-relaxed" style={{ color: ax("muted") }}>Presentation och sökväg här. Pris, moms, variant och lager fortsätter komma från Commerce.</p></div><div className="flex rounded-xl p-1" style={{ background: ax("surface") }}>{(["sv-SE", "en-SE"] as Locale[]).map((item) => <button key={item} type="button" onClick={() => setLocale(item)} className="rounded-lg px-3 py-2 text-[10px] font-black" style={{ background: locale === item ? ax("electric") : "transparent", color: locale === item ? ax("ink") : ax("muted") }}>{item === "sv-SE" ? "SV" : "EN"}</button>)}</div></div>

      <div className="grid gap-3 sm:grid-cols-2"><Field label="Produktslug" hint="Stabil kundadress. Produkt-ID är fortfarande intern identitet."><input value={draft.slug} onChange={(event) => update({ slug: slugify(event.target.value) })} className={INPUT} style={{ borderColor: ax("border") }} /></Field><Field label="Publicering"><select value={draft.publicationState} onChange={(event) => update({ publicationState: event.target.value as Draft["publicationState"] })} className={INPUT} style={{ borderColor: ax("border") }}><option value="draft">Utkast</option><option value="published">Publicerad</option><option value="archived">Arkiverad</option></select></Field></div>
      <Field label="Kort beskrivning"><textarea rows={2} value={draft.shortDescription} onChange={(event) => update({ shortDescription: event.target.value })} className={INPUT} style={{ borderColor: ax("border") }} placeholder="En tydlig rad under produktnamnet" /></Field>
      <Field label="Om produkten"><textarea rows={5} value={draft.longDescription} onChange={(event) => update({ longDescription: event.target.value })} className={INPUT} style={{ borderColor: ax("border") }} /></Field>
      <div className="grid gap-3 sm:grid-cols-3"><Field label="Material"><textarea rows={4} value={draft.material} onChange={(event) => update({ material: event.target.value })} className={INPUT} style={{ borderColor: ax("border") }} /></Field><Field label="Passform"><textarea rows={4} value={draft.fit} onChange={(event) => update({ fit: event.target.value })} className={INPUT} style={{ borderColor: ax("border") }} /></Field><Field label="Skötsel"><textarea rows={4} value={draft.care} onChange={(event) => update({ care: event.target.value })} className={INPUT} style={{ borderColor: ax("border") }} /></Field></div>
      <Field label="Retur / återbetalning"><textarea rows={3} value={draft.returnsPolicy} onChange={(event) => update({ returnsPolicy: event.target.value })} className={INPUT} style={{ borderColor: ax("border") }} placeholder="Produktens kundinformation. Finansiell och fysisk sanning hanteras fortsatt separat i Commerce." /></Field>
      <div className="rounded-xl p-3" style={{ background: ax("surface") }}><h4 className="text-xs font-black text-white">Storleksguide</h4><div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="Introduktion"><textarea rows={4} value={draft.sizeGuideBody} onChange={(event) => update({ sizeGuideBody: event.target.value })} className={INPUT} style={{ borderColor: ax("border") }} /></Field><Field label="Tabell" hint="En rad per storlek, separera kolumner med |"><textarea rows={4} value={draft.sizeGuideTable} onChange={(event) => update({ sizeGuideTable: event.target.value })} className={`${INPUT} font-mono text-xs`} style={{ borderColor: ax("border") }} placeholder={"Storlek | Bröst | Längd\nS | 92 cm | 68 cm"} /></Field></div></div>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="SEO-titel"><input value={draft.seoTitle} onChange={(event) => update({ seoTitle: event.target.value })} className={INPUT} style={{ borderColor: ax("border") }} /></Field><Field label="Låg lagernivå" hint="Visningshint, ändrar aldrig lagersanning."><input type="number" min="0" max="100" value={draft.lowStockThreshold} onChange={(event) => update({ lowStockThreshold: event.target.value })} className={INPUT} style={{ borderColor: ax("border") }} /></Field></div>
      <Field label="SEO-beskrivning"><textarea rows={2} value={draft.seoDescription} onChange={(event) => update({ seoDescription: event.target.value })} className={INPUT} style={{ borderColor: ax("border") }} /></Field>
      <div className="sticky bottom-2 z-10 flex justify-end rounded-xl p-2 backdrop-blur-xl" style={{ background: ax("surface", 0.92), border: `1px solid ${ax("border")}` }}><button type="button" onClick={save} disabled={saving || !draft.slug} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-5 text-xs font-black disabled:opacity-40" style={{ background: ax("electric"), color: ax("ink") }}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Spara Storefront</button></div>
    </div>

    <aside className="space-y-3"><section className="rounded-2xl p-4" style={PANEL}><div className="flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.14em]" style={{ color: ax("muted") }}>Readiness</p><h3 className="mt-1 text-sm font-black text-white">{completeCount}/{readiness.length} klara</h3></div><Store className="h-5 w-5" style={{ color: ax("electricSoft") }} /></div><div className="mt-4 space-y-2">{readiness.map((item) => <div key={item.label} className="flex items-center gap-2 text-xs" style={{ color: item.ok ? ax("lime") : ax("muted") }}>{item.ok ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}<span className={item.ok ? "text-white" : ""}>{item.label}</span></div>)}</div><p className="mt-4 text-[10px] leading-relaxed" style={{ color: ax("muted") }}>Checklistan förklarar vad som saknas men ändrar aldrig Commerce-livscykel, pris eller lager.</p></section>{product.store_path && draft.publicationState === "published" ? <Link to={product.store_path} className="flex min-h-11 items-center justify-center gap-2 rounded-xl text-xs font-black" style={{ background: ax("electric", 0.14), border: `1px solid ${ax("electric", 0.45)}`, color: "white" }}>Förhandsvisa produktsida <ExternalLink className="h-3.5 w-3.5" /></Link> : null}</aside>
  </section>;
}
