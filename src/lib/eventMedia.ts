export const NAMED_EVENT_IMAGE_BUCKET = "event-logos";
export const MAX_NAMED_EVENT_IMAGES = 3;
const ALLOWED_TYPES = new Map([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"]]);

export type NamedEventImageOwner = "activity-formats" | "activity-series";

export function namedEventImagePath(url: string) {
  const marker = `/storage/v1/object/public/${NAMED_EVENT_IMAGE_BUCKET}/`;
  const path = decodeURIComponent(String(url || "").split(marker)[1]?.split("?")[0] || "");
  return path.startsWith("activity-formats/") || path.startsWith("activity-series/") ? path : null;
}

export function nextNamedEventImageSlot(urls: string[]) {
  const occupied = new Set(urls.map(namedEventImagePath).filter(Boolean).map((path) => Number(path!.split("/").at(-1)?.split(".")[0])));
  return [1, 2, 3].find((slot) => !occupied.has(slot)) || null;
}

export function inheritedEventImages(series?: { image_urls?: string[] | null; activity_formats?: { image_urls?: string[] | null } | null } | null) {
  const seriesImages = Array.isArray(series?.image_urls) ? series!.image_urls!.filter(Boolean) : [];
  if (seriesImages.length) return seriesImages.slice(0, MAX_NAMED_EVENT_IMAGES);
  return Array.isArray(series?.activity_formats?.image_urls)
    ? series.activity_formats.image_urls.filter(Boolean).slice(0, MAX_NAMED_EVENT_IMAGES)
    : [];
}

export async function uploadNamedEventImage({ owner, ownerId, slot, file }: { owner: NamedEventImageOwner; ownerId: string; slot: number; file: File }) {
  const { supabase } = await import("@/integrations/supabase/client");
  const extension = ALLOWED_TYPES.get(file.type);
  if (!extension) throw new Error("Använd JPG, PNG eller WebP.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Bilden får vara högst 5 MB.");
  if (!Number.isInteger(slot) || slot < 1 || slot > MAX_NAMED_EVENT_IMAGES) throw new Error("Ogiltig bildplats.");
  const bitmap = await createImageBitmap(file);
  const ratio = bitmap.width / bitmap.height;
  bitmap.close();
  if (Math.abs(ratio - (16 / 9)) > 0.02) throw new Error("Bilden behöver vara i formatet 16:9.");

  const folder = `${owner}/${ownerId}`;
  const { data: existing } = await supabase.storage.from(NAMED_EVENT_IMAGE_BUCKET).list(folder, { limit: 20 });
  const oldPaths = (existing || []).filter((object) => object.name.startsWith(`${slot}.`)).map((object) => `${folder}/${object.name}`);
  if (oldPaths.length) await supabase.storage.from(NAMED_EVENT_IMAGE_BUCKET).remove(oldPaths);
  const path = `${folder}/${slot}.${extension}`;
  const { error } = await supabase.storage.from(NAMED_EVENT_IMAGE_BUCKET).upload(path, file, { upsert: true, contentType: file.type, cacheControl: "3600" });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from(NAMED_EVENT_IMAGE_BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

export async function removeNamedEventImage(url: string) {
  const path = namedEventImagePath(url);
  if (!path) throw new Error("Bilden ligger inte i Picklas eventbibliotek.");
  const { supabase } = await import("@/integrations/supabase/client");
  const { error } = await supabase.storage.from(NAMED_EVENT_IMAGE_BUCKET).remove([path]);
  if (error) throw new Error(error.message);
}
