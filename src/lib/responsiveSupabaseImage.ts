export const SUPABASE_IMAGE_WIDTHS = [640, 768, 1200] as const;
export const CARD_ARTWORK_WIDTHS = [640, 768] as const;
export const CARD_ARTWORK_SIZES = "(max-width: 447px) calc(100vw - 40px), 408px";
export const DETAIL_ARTWORK_SIZES = "(max-width: 575px) calc(100vw - 40px), 536px";

const OBJECT_PUBLIC_PATH = "/storage/v1/object/public/";
const RENDER_PUBLIC_PATH = "/storage/v1/render/image/public/";
const TRANSFORM_QUERY_KEYS = new Set(["width", "height", "resize", "quality", "format"]);

function configuredSupabaseOrigin() {
  try {
    return import.meta.env.VITE_SUPABASE_URL
      ? new URL(import.meta.env.VITE_SUPABASE_URL).origin
      : null;
  } catch {
    return null;
  }
}

function supportedPublicStorageUrl(src: string) {
  try {
    const url = new URL(src);
    const supportedHost = url.hostname.endsWith(".supabase.co")
      || url.origin === configuredSupabaseOrigin();
    const publicPath = url.pathname.indexOf(OBJECT_PUBLIC_PATH);
    if (!supportedHost || publicPath < 0 || !url.pathname.slice(publicPath + OBJECT_PUBLIC_PATH.length).includes("/")) {
      return null;
    }
    return { url, publicPath };
  } catch {
    return null;
  }
}

export function supabaseImageTransformUrl(src: string, width: number, quality = 80) {
  const supported = supportedPublicStorageUrl(src);
  if (!supported || !Number.isInteger(width) || width <= 0 || !Number.isInteger(quality) || quality < 20 || quality > 100) {
    return null;
  }

  const transformed = new URL(supported.url.toString());
  const storagePath = transformed.pathname.slice(supported.publicPath + OBJECT_PUBLIC_PATH.length);
  const preservedParams = [...transformed.searchParams.entries()]
    .filter(([key]) => !TRANSFORM_QUERY_KEYS.has(key));

  transformed.pathname = `${transformed.pathname.slice(0, supported.publicPath)}${RENDER_PUBLIC_PATH}${storagePath}`;
  transformed.search = "";
  transformed.searchParams.set("width", String(width));
  transformed.searchParams.set("resize", "contain");
  transformed.searchParams.set("quality", String(quality));
  transformed.searchParams.set("format", "webp");
  preservedParams.forEach(([key, value]) => transformed.searchParams.append(key, value));
  return transformed.toString();
}

export function supabaseImageSrcSet(src: string, widths: readonly number[] = SUPABASE_IMAGE_WIDTHS, quality = 80) {
  const candidates = [...new Set(widths)]
    .filter((width) => Number.isInteger(width) && width > 0)
    .sort((left, right) => left - right)
    .map((width) => {
      const url = supabaseImageTransformUrl(src, width, quality);
      return url ? { width, url } : null;
    })
    .filter((candidate): candidate is { width: number; url: string } => Boolean(candidate));

  return candidates.length ? candidates : null;
}
