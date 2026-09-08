import { Loader2, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import {
  OperationsBookingDrawer,
  type OperationsBookingDetail,
} from "@/components/operations/OperationsBookingDrawer";

export function AdminBookingDetailDrawer({
  open,
  venueId,
  bookingId,
  onClose,
  readOnly = false,
}: {
  open: boolean;
  venueId?: string | null;
  bookingId?: string | null;
  onClose: () => void;
  readOnly?: boolean;
}) {
  if (!open || !venueId || !bookingId) return null;
  return (
    <LoadedAdminBookingDetailDrawer
      venueId={venueId}
      bookingId={bookingId}
      onClose={onClose}
      readOnly={readOnly}
    />
  );
}

function LoadedAdminBookingDetailDrawer({
  venueId,
  bookingId,
  onClose,
  readOnly,
}: {
  venueId: string;
  bookingId: string;
  onClose: () => void;
  readOnly: boolean;
}) {
  const detailQuery = useQuery({
    queryKey: ["admin-booking-detail", venueId, bookingId],
    queryFn: () => apiGet<OperationsBookingDetail>("api-admin", "booking-detail", {
      venueId,
      bookingId,
    }),
    staleTime: 15_000,
  });

  if (!detailQuery.data) {
    return (
      <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 px-5 backdrop-blur-md" role="dialog" aria-modal="true">
        <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#111626] p-5 shadow-2xl">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/40">Operations Truth</p>
              <p className="mt-1 text-sm font-black text-white">
                {detailQuery.isError ? "Bokningsdetaljer kunde inte läsas" : "Laddar bokningsdetaljer"}
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="Stäng" className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
          {detailQuery.isError ? (
            <p className="mt-3 text-xs font-semibold text-red-300">
              {detailQuery.error instanceof Error ? detailQuery.error.message : "Försök igen."}
            </p>
          ) : (
            <Loader2 className="mt-4 h-5 w-5 animate-spin text-blue-300" />
          )}
        </div>
      </div>
    );
  }

  return (
    <OperationsBookingDrawer
      open
      booking={detailQuery.data || null}
      onClose={onClose}
      readOnly={readOnly}
    />
  );
}
