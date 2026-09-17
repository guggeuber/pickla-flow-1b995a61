import { DateTime } from "luxon";

export const CORPORATE_PAGE_IMAGE_BUCKET = "event-logos";
export const MAX_CORPORATE_GALLERY_IMAGES = 6;
export const MAX_CORPORATE_IMAGE_BYTES = 5 * 1024 * 1024;
export const CORPORATE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type CorporatePageImageRole = "hero" | "gallery";

export type CorporatePublicPageContent = {
  hero_headline: string;
  short_intro: string;
  hero_image_path?: string | null;
  hero_image_url?: string | null;
  gallery_image_paths?: string[];
  gallery_image_urls?: string[];
  pickleball_heading: string;
  pickleball_body: string;
  pickla_heading: string;
  pickla_body: string;
  practical_information: string;
  help_contact_text: string | null;
  updated_at?: string | null;
};

export type CorporatePublicSession = {
  id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  occurrence_index: number | null;
  courts: Array<{ id: string; name: string; sport_type: string }>;
};

export type CorporateSchedulePresentation = {
  weekdayLabel: string;
  timeLabel: string;
  dateRangeLabel: string;
  primaryTime: string;
  hasExceptions: boolean;
};

export type CorporatePublicMedia = {
  heroImage: string;
  introImage: string | null;
  galleryImages: string[];
};

function corporateImageIdentity(value: string) {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed, "https://pickla.invalid");
    return `${url.origin}${url.pathname}`;
  } catch {
    return trimmed.split(/[?#]/, 1)[0];
  }
}

export function buildCorporatePublicMedia(
  heroImageUrl: string | null | undefined,
  galleryImageUrls: string[] | null | undefined,
  fallbackImage: string,
): CorporatePublicMedia {
  const heroImage = heroImageUrl?.trim() || fallbackImage;
  const seen = new Set([corporateImageIdentity(heroImage)]);
  const galleryImages: string[] = [];

  for (const value of galleryImageUrls || []) {
    const image = value?.trim();
    if (!image) continue;
    const identity = corporateImageIdentity(image);
    if (seen.has(identity)) continue;
    seen.add(identity);
    galleryImages.push(image);
  }

  return {
    heroImage,
    introImage: corporateImageIdentity(heroImage) === corporateImageIdentity(fallbackImage) ? null : fallbackImage,
    galleryImages,
  };
}

function timeRange(session: CorporatePublicSession) {
  return `${session.start_time.slice(0, 5)}–${session.end_time.slice(0, 5)}`;
}

function joinHuman(values: string[]) {
  if (values.length <= 1) return values[0] || "Schedule coming soon";
  return `${values.slice(0, -1).join(", ")} & ${values.at(-1)}`;
}

export function formatCorporateDate(date: string) {
  return DateTime.fromISO(date).setLocale("en").toFormat("d LLLL");
}

export function formatCorporateDateRange(sessions: CorporatePublicSession[]) {
  if (!sessions.length) return "Dates coming soon";
  const sorted = [...sessions].sort((a, b) => a.session_date.localeCompare(b.session_date));
  const first = DateTime.fromISO(sorted[0].session_date).setLocale("en");
  const last = DateTime.fromISO(sorted.at(-1)!.session_date).setLocale("en");
  if (first.year === last.year) return `${first.toFormat("d LLLL")} – ${last.toFormat("d LLLL")}`;
  return `${first.toFormat("d LLLL yyyy")} – ${last.toFormat("d LLLL yyyy")}`;
}

export function buildCorporateSchedulePresentation(sessions: CorporatePublicSession[]): CorporateSchedulePresentation {
  const sorted = [...sessions].sort((a, b) => `${a.session_date} ${a.start_time}`.localeCompare(`${b.session_date} ${b.start_time}`));
  const weekdayNumbers = [...new Set(sorted.map((session) => DateTime.fromISO(session.session_date).weekday))].sort((a, b) => a - b);
  const weekdayLabels = weekdayNumbers.map((weekday) => DateTime.fromObject({ weekYear: 2026, weekNumber: 2, weekday }).setLocale("en").toFormat("cccc") + "s");
  const timeCounts = new Map<string, number>();
  for (const session of sorted) timeCounts.set(timeRange(session), (timeCounts.get(timeRange(session)) || 0) + 1);
  const primaryTime = [...timeCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "Time coming soon";
  return {
    weekdayLabel: joinHuman(weekdayLabels),
    timeLabel: primaryTime,
    dateRangeLabel: formatCorporateDateRange(sorted),
    primaryTime,
    hasExceptions: timeCounts.size > 1,
  };
}

export function formatCorporateAddress(venue: { address?: string | null; postal_code?: string | null; city?: string | null }) {
  const locality = [venue.postal_code, venue.city].filter(Boolean).join(" ");
  return [venue.address, locality].filter(Boolean).join(", ");
}

export function corporateMapsUrl(venue: {
  name: string;
  address?: string | null;
  postal_code?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}) {
  const query = venue.latitude != null && venue.longitude != null
    ? `${venue.latitude},${venue.longitude}`
    : `${venue.name}, ${formatCorporateAddress(venue)}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function validateCorporateImageFile(file: Pick<File, "type" | "size">) {
  if (!CORPORATE_IMAGE_TYPES.has(file.type)) throw new Error("Use a JPG, PNG or WebP image.");
  if (file.size > MAX_CORPORATE_IMAGE_BYTES) throw new Error("The image may be at most 5 MB.");
}

export function corporatePageImagePath(accountId: string, role: CorporatePageImageRole, imageId = crypto.randomUUID()) {
  if (role === "hero") return `corporate-accounts/${accountId}/hero.webp`;
  return `corporate-accounts/${accountId}/gallery-${imageId}.webp`;
}

export function isCorporatePageImagePath(path: string, accountId: string) {
  const escapedAccountId = accountId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^corporate-accounts/${escapedAccountId}/(?:hero|gallery-[0-9a-f-]{36})\\.webp$`).test(path);
}

async function optimizedCorporateImage(file: File, role: CorporatePageImageRole) {
  validateCorporateImageFile(file);
  const bitmap = await createImageBitmap(file);
  const maxDimension = role === "hero" ? 1920 : 1440;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("The image could not be prepared.");
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.84));
  if (!blob) throw new Error("The image could not be prepared.");
  if (blob.size > MAX_CORPORATE_IMAGE_BYTES) throw new Error("The optimized image is still too large.");
  return blob;
}

export async function uploadCorporatePageImage({
  accountId,
  role,
  file,
}: {
  accountId: string;
  role: CorporatePageImageRole;
  file: File;
}) {
  const { supabase } = await import("@/integrations/supabase/client");
  const path = corporatePageImagePath(accountId, role);
  const optimized = await optimizedCorporateImage(file, role);
  const { error } = await supabase.storage.from(CORPORATE_PAGE_IMAGE_BUCKET).upload(path, optimized, {
    upsert: role === "hero",
    contentType: "image/webp",
    cacheControl: "31536000",
  });
  if (error) throw new Error(error.message);
  return path;
}

export async function removeCorporatePageImage(accountId: string, path: string) {
  if (!isCorporatePageImagePath(path, accountId)) throw new Error("The image is outside this company page.");
  const { supabase } = await import("@/integrations/supabase/client");
  const { error } = await supabase.storage.from(CORPORATE_PAGE_IMAGE_BUCKET).remove([path]);
  if (error) throw new Error(error.message);
}

export async function corporatePageImagePublicUrl(path: string) {
  const { supabase } = await import("@/integrations/supabase/client");
  return supabase.storage.from(CORPORATE_PAGE_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}
