import { useState, type ImgHTMLAttributes, type SyntheticEvent } from "react";
import { SUPABASE_IMAGE_WIDTHS, supabaseImageSrcSet } from "@/lib/responsiveSupabaseImage";

type ResponsiveSupabaseImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet" | "sizes" | "loading" | "fetchPriority" | "width" | "height"> & {
  src: string;
  alt: string;
  sizes: string;
  width: number;
  height: number;
  widths?: readonly number[];
  quality?: number;
  priority?: boolean;
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
};

export function ResponsiveSupabaseImage({
  src,
  alt,
  sizes,
  width,
  height,
  widths = SUPABASE_IMAGE_WIDTHS,
  quality = 80,
  priority = false,
  loading,
  fetchPriority,
  onError,
  ...imageProps
}: ResponsiveSupabaseImageProps) {
  const [failedTransformSource, setFailedTransformSource] = useState<string | null>(null);
  const candidates = supabaseImageSrcSet(src, widths, quality);
  const useOriginal = !candidates || failedTransformSource === src;
  const fallbackCandidate = candidates?.at(-1)?.url;
  const resolvedSrc = useOriginal ? src : fallbackCandidate || src;
  const resolvedSrcSet = useOriginal
    ? undefined
    : candidates.map((candidate) => `${candidate.url} ${candidate.width}w`).join(", ");
  const fetchPriorityAttribute = {
    fetchpriority: fetchPriority || (priority ? "high" : "auto"),
  };

  const handleError = (event: SyntheticEvent<HTMLImageElement>) => {
    if (!useOriginal) {
      setFailedTransformSource(src);
      return;
    }
    onError?.(event);
  };

  return (
    <img
      {...imageProps}
      src={resolvedSrc}
      srcSet={resolvedSrcSet}
      sizes={resolvedSrcSet ? sizes : undefined}
      alt={alt}
      width={width}
      height={height}
      loading={loading || (priority ? "eager" : "lazy")}
      {...fetchPriorityAttribute}
      decoding="async"
      onError={handleError}
    />
  );
}
