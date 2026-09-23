import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, GripVertical, ImagePlus, Loader2, Star, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { apiPatch, apiPostForm } from "@/lib/api";
import type { ProductMedia } from "@/lib/adminCommerce";
import { ax } from "@/components/admin/shell/axTheme";

const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PRODUCT_IMAGES = 10;

export type PendingProductImage = {
  id: string;
  file: File;
  preview: string;
  altText: string;
};

type DraftProps = {
  images: PendingProductImage[];
  onChange: (images: PendingProductImage[]) => void;
  productName: string;
};

type PersistedProps = {
  venueId: string;
  productId: string;
  productName: string;
  media: ProductMedia[];
  optionValues?: Array<{ id: string; label: string; swatch: string | null }>;
  onChanged: () => Promise<void>;
};

type ProductMediaPayload = {
  media: ProductMedia[];
  image_url: string | null;
};

const THUMBNAIL_BUTTON = "grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-black/35 text-white disabled:opacity-35";

function validateFiles(files: File[], currentCount: number) {
  if (currentCount + files.length > MAX_PRODUCT_IMAGES) throw new Error(`Högst ${MAX_PRODUCT_IMAGES} bilder per produkt.`);
  for (const file of files) {
    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) throw new Error("Använd JPEG, PNG, WebP eller AVIF.");
    if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) throw new Error("Varje bild får vara högst 8 MB.");
  }
}

function moveItem<T>(items: T[], from: number, to: number) {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function AddImagesTarget({ onFiles, disabled = false }: { onFiles: (files: File[]) => void; disabled?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const accept = (files: FileList | null) => {
    if (files?.length) onFiles(Array.from(files));
    if (inputRef.current) inputRef.current.value = "";
  };
  return <div
    className="rounded-2xl border border-dashed p-5 text-center transition-colors"
    style={{ borderColor: ax("electric", 0.55), background: ax("electric", 0.06) }}
    onDragOver={(event) => event.preventDefault()}
    onDrop={(event) => { event.preventDefault(); if (!disabled) accept(event.dataTransfer.files); }}
    data-testid="product-image-dropzone"
  >
    <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple className="sr-only" onChange={(event) => accept(event.target.files)} disabled={disabled} data-testid="product-image-input" />
    <ImagePlus className="mx-auto h-7 w-7" style={{ color: ax("electricSoft") }} />
    <p className="mt-2 text-sm font-black text-white">Lägg till bilder</p>
    <p className="mt-1 text-[11px]" style={{ color: ax("muted") }}>Välj filer, kamera eller dra hit · max 8 MB per bild</p>
    <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-xs font-black disabled:opacity-40" style={{ background: ax("electric"), color: ax("ink") }}>
      <Upload className="h-4 w-4" /> Välj bilder
    </button>
  </div>;
}

export function DraftProductMediaPicker({ images, onChange, productName }: DraftProps) {
  const previewsRef = useRef(new Set<string>());
  useEffect(() => () => previewsRef.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const add = (files: File[]) => {
    try {
      validateFiles(files, images.length);
      const additions = files.map((file, index) => {
        const preview = URL.createObjectURL(file);
        previewsRef.current.add(preview);
        return { id: crypto.randomUUID(), file, preview, altText: `${productName || "Produkt"} ${images.length + index + 1}` };
      });
      onChange([...images, ...additions]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Bilderna kunde inte läggas till");
    }
  };
  const remove = (index: number) => {
    URL.revokeObjectURL(images[index].preview);
    previewsRef.current.delete(images[index].preview);
    onChange(images.filter((_, candidate) => candidate !== index));
  };
  const reorder = (from: number, to: number) => onChange(moveItem(images, from, to));

  return <section className="space-y-3" aria-label="Produktbilder">
    <div><h3 className="text-sm font-black text-white">Bilder</h3><p className="mt-1 text-xs" style={{ color: ax("muted") }}>Första bilden är omslag. Ordningen sparas med produkten.</p></div>
    <AddImagesTarget onFiles={add} disabled={images.length >= MAX_PRODUCT_IMAGES} />
    {images.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="pending-product-media">
      {images.map((image, index) => <article key={image.id} draggable onDragStart={(event) => event.dataTransfer.setData("text/product-media-index", String(index))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); reorder(Number(event.dataTransfer.getData("text/product-media-index")), index); }} className="overflow-hidden rounded-xl border border-white/10 bg-black/20">
        <div className="relative aspect-square"><img src={image.preview} alt={image.altText} className="h-full w-full object-cover" />{index === 0 ? <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/75 px-2 py-1 text-[9px] font-black text-white"><Star className="h-3 w-3 fill-current" /> OMSLAG</span> : null}<GripVertical className="absolute right-2 top-2 h-4 w-4 rounded bg-black/60 text-white" /></div>
        <div className="space-y-2 p-2"><input aria-label={`Alt-text bild ${index + 1}`} value={image.altText} onChange={(event) => onChange(images.map((item, candidate) => candidate === index ? { ...item, altText: event.target.value } : item))} className="w-full rounded-lg border border-white/10 bg-transparent px-2 py-2 text-[10px] text-white" /><div className="flex justify-between"><div className="flex gap-1"><button type="button" aria-label={`Flytta bild ${index + 1} vänster`} disabled={index === 0} onClick={() => reorder(index, index - 1)} className={THUMBNAIL_BUTTON}><ArrowLeft className="h-4 w-4" /></button><button type="button" aria-label={`Flytta bild ${index + 1} höger`} disabled={index === images.length - 1} onClick={() => reorder(index, index + 1)} className={THUMBNAIL_BUTTON}><ArrowRight className="h-4 w-4" /></button></div><div className="flex gap-1">{index > 0 ? <button type="button" onClick={() => reorder(index, 0)} className={THUMBNAIL_BUTTON} aria-label={`Välj bild ${index + 1} som omslag`}><Star className="h-4 w-4" /></button> : null}<button type="button" onClick={() => remove(index)} className={THUMBNAIL_BUTTON} aria-label={`Ta bort bild ${index + 1}`}><Trash2 className="h-4 w-4" /></button></div></div></div>
      </article>)}
    </div> : null}
  </section>;
}

// This upload helper stays beside the draft-picker type so the wizard and the
// persisted editor share one multipart contract.
// eslint-disable-next-line react-refresh/only-export-components
export async function uploadPendingProductMedia(venueId: string, productId: string, images: PendingProductImage[]) {
  if (!images.length) return null;
  const form = new FormData();
  form.set("venueId", venueId);
  form.set("productId", productId);
  images.forEach((image, index) => { form.append("files", image.file); form.set(`alt_${index}`, image.altText); });
  return apiPostForm<{ media: ProductMedia[]; image_url: string | null }>("api-admin", "product-media", form);
}

export function ProductMediaEditor({ venueId, productId, productName, media, optionValues = [], onChanged }: PersistedProps) {
  const [localMedia, setLocalMedia] = useState(media);
  useEffect(() => setLocalMedia(media), [media]);
  const ordered = [...localMedia].sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id));
  const [busy, setBusy] = useState(false);
  const [altDrafts, setAltDrafts] = useState<Record<string, string>>({});
  const [uploadScope, setUploadScope] = useState("");
  const coverId = ordered.find((item) => item.is_cover)?.id || ordered[0]?.id;

  const run = async (work: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      const result = await work();
      if (result && typeof result === "object" && "media" in result && Array.isArray((result as ProductMediaPayload).media)) {
        setLocalMedia((result as ProductMediaPayload).media);
      }
      await onChanged();
      toast.success(success);
    }
    catch (error) { toast.error(error instanceof Error ? error.message : "Bilden kunde inte uppdateras"); }
    finally { setBusy(false); }
  };
  const upload = (files: File[]) => {
    try { validateFiles(files, ordered.length); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Bilderna kunde inte läggas till"); return; }
    const form = new FormData();
    form.set("venueId", venueId); form.set("productId", productId);
    if (uploadScope) form.set("optionValueId", uploadScope);
    files.forEach((file, index) => { form.append("files", file); form.set(`alt_${index}`, `${productName} ${ordered.length + index + 1}`); });
    void run(() => apiPostForm("api-admin", "product-media", form), files.length === 1 ? "Bilden lades till" : `${files.length} bilder lades till`);
  };
  const persistOrder = (next: ProductMedia[], nextCoverId = coverId) => run(() => apiPatch("api-admin", "product-media", { venueId, product_id: productId, action: "reorder", media_ids: next.map((item) => item.id), cover_id: nextCoverId }), "Bildordningen sparades");
  const reorder = (from: number, to: number) => { const next = moveItem(ordered, from, to); if (next !== ordered) void persistOrder(next); };

  return <section className="space-y-3 rounded-2xl p-4" style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}` }} data-testid="product-media-editor">
    <div><h3 className="text-sm font-black text-white">Produktbilder</h3><p className="mt-1 text-xs" style={{ color: ax("muted") }}>Privat lagring, publicerad läsning. Omslaget fortsätter även som produktens bakåtkompatibla bild.</p></div>
    {optionValues.length ? <label className="block text-[11px] font-bold" style={{ color: ax("muted") }}>Nya bilder visar
      <select value={uploadScope} onChange={(event) => setUploadScope(event.target.value)} className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2.5 text-sm text-white" style={{ borderColor: ax("border") }}>
        <option value="">Alla färger</option>
        {optionValues.map((value) => <option key={value.id} value={value.id}>{value.label}</option>)}
      </select>
    </label> : null}
    <AddImagesTarget onFiles={upload} disabled={busy || ordered.length >= MAX_PRODUCT_IMAGES} />
    {busy ? <div className="flex items-center gap-2 text-xs" style={{ color: ax("muted") }}><Loader2 className="h-4 w-4 animate-spin" /> Sparar bilder…</div> : null}
    {ordered.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {ordered.map((item, index) => <article key={item.id} draggable={!busy} onDragStart={(event) => event.dataTransfer.setData("text/product-media-index", String(index))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); reorder(Number(event.dataTransfer.getData("text/product-media-index")), index); }} className="overflow-hidden rounded-xl border border-white/10 bg-black/20" data-testid={`product-media-${item.id}`}>
        <div className="relative aspect-square"><img src={item.url} alt={item.alt_text || productName} className="h-full w-full object-cover" />{item.id === coverId ? <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/75 px-2 py-1 text-[9px] font-black text-white"><Star className="h-3 w-3 fill-current" /> OMSLAG</span> : null}<GripVertical className="absolute right-2 top-2 h-4 w-4 rounded bg-black/60 text-white" /></div>
        <div className="space-y-2 p-2"><input aria-label={`Alt-text bild ${index + 1}`} value={altDrafts[item.id] ?? item.alt_text ?? ""} onChange={(event) => setAltDrafts((current) => ({ ...current, [item.id]: event.target.value }))} onBlur={() => { const value = altDrafts[item.id]; if (value !== undefined && value !== (item.alt_text || "")) void run(() => apiPatch("api-admin", "product-media", { venueId, product_id: productId, action: "alt", media_id: item.id, alt_text: value }), "Alt-text sparades"); }} placeholder="Beskriv bilden" className="w-full rounded-lg border border-white/10 bg-transparent px-2 py-2 text-[10px] text-white" />{optionValues.length ? <select aria-label={`Färgkoppling bild ${index + 1}`} value={item.option_value_id || ""} onChange={(event) => void run(() => apiPatch("api-admin", "product-media", { venueId, product_id: productId, action: "scope", media_id: item.id, option_value_id: event.target.value || null }), "Bildens färgkoppling sparades")} disabled={busy} className="w-full rounded-lg border border-white/10 bg-transparent px-2 py-2 text-[10px] text-white"><option value="">Alla färger</option>{optionValues.map((value) => <option key={value.id} value={value.id}>{value.label}</option>)}</select> : null}<div className="flex justify-between"><div className="flex gap-1"><button type="button" disabled={busy || index === 0} onClick={() => reorder(index, index - 1)} className={THUMBNAIL_BUTTON} aria-label={`Flytta bild ${index + 1} vänster`}><ArrowLeft className="h-4 w-4" /></button><button type="button" disabled={busy || index === ordered.length - 1} onClick={() => reorder(index, index + 1)} className={THUMBNAIL_BUTTON} aria-label={`Flytta bild ${index + 1} höger`}><ArrowRight className="h-4 w-4" /></button></div><div className="flex gap-1">{item.id !== coverId ? <button type="button" disabled={busy} onClick={() => void persistOrder(ordered, item.id)} className={THUMBNAIL_BUTTON} aria-label={`Välj bild ${index + 1} som omslag`}><Star className="h-4 w-4" /></button> : <span className={`${THUMBNAIL_BUTTON} border-emerald-400/40 text-emerald-300`} aria-label="Valt omslag"><Check className="h-4 w-4" /></span>}<button type="button" disabled={busy} onClick={() => void run(() => apiPatch("api-admin", "product-media", { venueId, product_id: productId, action: "archive", media_id: item.id }), "Bilden togs bort från produkten") } className={THUMBNAIL_BUTTON} aria-label={`Ta bort bild ${index + 1}`}><Trash2 className="h-4 w-4" /></button></div></div></div>
      </article>)}
    </div> : <p className="rounded-xl border border-white/10 p-4 text-center text-xs" style={{ color: ax("muted") }}>Ingen produktbild ännu.</p>}
  </section>;
}
