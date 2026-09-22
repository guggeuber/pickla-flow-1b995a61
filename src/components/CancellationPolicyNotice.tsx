import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { fetchPublicCancellationPolicy } from "@/lib/cancellationPolicy";

type Props = {
  venueId?: string | null;
  family?: string | null;
  productId?: string | null;
  seriesId?: string | null;
  eventId?: string | null;
  locale?: "sv" | "en";
  className?: string;
  required?: boolean;
};

export default function CancellationPolicyNotice({
  venueId,
  family,
  productId,
  seriesId,
  eventId,
  locale = "sv",
  className = "",
  required = true,
}: Props) {
  const query = useQuery({
    queryKey: ["public-cancellation-policy", venueId, family, productId, seriesId, eventId],
    enabled: Boolean(venueId && family),
    staleTime: 60_000,
    queryFn: () => fetchPublicCancellationPolicy({
      venueId: venueId!,
      family: family!,
      productId,
      seriesId,
      eventId,
    }),
    retry: false,
  });

  if (!venueId || !family || query.isLoading) return null;
  if (query.isError || !query.data) {
    if (!required) return null;
    return (
      <div className={`flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900 ${className}`} role="status">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Försäljningen saknar ett publicerat avbokningsvillkor och kan inte slutföras.</span>
      </div>
    );
  }
  const copy = locale === "en" ? query.data.copy_en : query.data.copy_sv;
  return (
    <div className={`flex items-start gap-3 rounded-2xl border border-black/10 bg-slate-50 p-3 text-slate-900 ${className}`} data-testid="cancellation-policy-notice">
      <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-[#b41663]" />
      <div>
        <p className="text-xs font-black">{copy.title}</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-600">{copy.summary}</p>
      </div>
    </div>
  );
}
