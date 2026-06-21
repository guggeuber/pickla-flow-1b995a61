import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Crown, Loader2, ReceiptText, Search, Ticket, UserRound } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";
import { ax } from "@/components/admin/shell/axTheme";
import { AX_TYPE, AxChip } from "@/components/admin/shell/axPrimitives";
import Customer360Drawer from "@/components/customers/Customer360Drawer";
import { checkInDeskBooking, deskBookingCheckinEligibility } from "@/lib/deskOps";

type Result =
  | { kind: "customer"; id: string; title: string; meta: string; row: any; score: number }
  | { kind: "booking"; id: string; title: string; meta: string; row: any; score: number };

function normalize(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function bookingHaystack(row: any) {
  return [
    row.booking_ref,
    row.access_code,
    row.receipt_number,
    row.booked_by,
    row.customer_name,
    row.customer_phone,
    row.customer_email,
    row.notes,
    row.venue_courts?.name,
  ].filter(Boolean).join(" ").toLowerCase();
}

function customerTitle(row: any) {
  return row.identity_title || row.display_name || row.full_name || row.email || "Kund utan namn";
}

function bookingTime(row: any) {
  const start = DateTime.fromISO(row.start_time, { zone: "utc" }).setZone("Europe/Stockholm");
  return start.isValid ? start.toFormat("HH:mm") : "--:--";
}

export default function DeskCommandBar({
  venueId,
  venueSlug,
  bookings,
  onOpenBooking,
}: {
  venueId?: string;
  venueSlug?: string | null;
  bookings: any[];
  onOpenBooking: (booking: any, rows: any[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<{ customerId?: string | null; userId?: string | null } | null>(null);
  const qc = useQueryClient();
  const q = query.trim();

  const customersQ = useQuery<any[]>({
    queryKey: ["desk-command-customers", venueId, q],
    enabled: !!venueId && q.length >= 2,
    queryFn: () => apiGet("api-customers", "list", { venueId: venueId!, search: q, limit: "8" }),
    staleTime: 15_000,
  });

  const courtRows = useMemo(() => bookings.filter((row) => row.kind !== "activity_registration"), [bookings]);

  const results = useMemo<Result[]>(() => {
    if (q.length < 2) return [];
    const needle = normalize(q);
    const bookingResults: Result[] = courtRows
      .filter((row) => bookingHaystack(row).includes(needle))
      .slice(0, 6)
      .map((row) => ({
        kind: "booking" as const,
        id: row.id,
        title: row.booked_by || row.customer_name || "Bokning",
        meta: `${bookingTime(row)} · ${row.venue_courts?.name || row.court_name || "Bana"}${row.access_code ? ` · kod ${row.access_code}` : ""}${row.receipt_number ? ` · ${row.receipt_number}` : ""}`,
        row,
        score: normalize(row.access_code) === needle || normalize(row.booking_ref) === needle || normalize(row.receipt_number) === needle ? 100 : 40,
      }));

    const customerResults: Result[] = (customersQ.data || []).slice(0, 8).map((row: any) => ({
      kind: "customer" as const,
      id: row.customer_id || row.auth_user_id || row.id,
      title: customerTitle(row),
      meta: [row.email, row.phone, row.active_membership_tier?.name].filter(Boolean).join(" · ") || "Kund",
      row,
      score: normalize(row.phone) === needle || normalize(row.email) === needle ? 90 : 50,
    }));

    return [...bookingResults, ...customerResults].sort((a, b) => b.score - a.score).slice(0, 8);
  }, [courtRows, customersQ.data, q]);

  const best = results[0] || null;
  const clearMatch = results.length === 1 || (best && best.score >= 90);

  const checkinMutation = useMutation({
    mutationFn: async (result: Result) => {
      if (result.kind === "booking") return checkInDeskBooking(result.row);
      if (!result.row.auth_user_id) throw new Error("Kunden saknar inloggningsidentitet för check-in");
      return apiPost("api-checkins", "checkin", {
        venue_id: venueId,
        target_user_id: result.row.auth_user_id,
        entry_type: "auto",
        player_name: customerTitle(result.row),
      });
    },
    onSuccess: () => {
      toast.success("Incheckad");
      qc.invalidateQueries({ queryKey: ["today-bookings", venueId] });
      qc.invalidateQueries({ queryKey: ["desk-checkins-today", venueId] });
    },
    onError: (error: any) => toast.error(error?.message || "Kunde inte checka in"),
  });

  const openResult = (result: Result | null) => {
    if (!result) return;
    if (result.kind === "booking") onOpenBooking(result.row, courtRows);
    if (result.kind === "customer") setSelectedCustomer({ customerId: result.row.customer_id || null, userId: result.row.auth_user_id || null });
  };

  const canCheckInBest = (best?.kind === "customer" && !!best.row.auth_user_id) || (best?.kind === "booking" && deskBookingCheckinEligibility(best.row).ok);

  return (
    <div className="relative">
      <div
        className="rounded-2xl border px-3 py-2"
        style={{ background: ax("surfaceHi"), borderColor: ax("borderSoft") }}
      >
        <div className="flex items-center gap-3">
          <Search className="h-5 w-5 shrink-0" style={{ color: ax("electric") }} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") openResult(best);
            }}
            placeholder="Sök kund, telefon, bokningskod eller kvitto..."
            className="h-10 min-w-0 flex-1 bg-transparent text-sm font-bold text-white outline-none placeholder:text-white/35"
          />
          {customersQ.isFetching && <Loader2 className="h-4 w-4 animate-spin" style={{ color: ax("muted") }} />}
        </div>

        <AnimatePresence>
          {q.length >= 2 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              {results.length === 0 ? (
                <p className={`${AX_TYPE.meta} border-t pt-3`} style={{ borderColor: ax("borderSoft"), color: ax("muted") }}>
                  Ingen träff. Prova namn, telefon, bokningskod eller kvittonummer.
                </p>
              ) : (
                <div className="mt-2 space-y-2 border-t pt-2" style={{ borderColor: ax("borderSoft") }}>
                  {clearMatch && best && (
                    <div className="grid gap-2 sm:grid-cols-4">
                      <button
                        type="button"
                        onClick={() => canCheckInBest && checkinMutation.mutate(best)}
                        disabled={!canCheckInBest || checkinMutation.isPending}
                        className="flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-black disabled:opacity-40"
                        style={{ background: ax("lime"), color: ax("ink") }}
                      >
                        {checkinMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        Checka in
                      </button>
                      <button type="button" onClick={() => openResult(best)} className="flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-black" style={{ background: ax("electric"), color: ax("ink") }}>
                        <UserRound className="h-3.5 w-3.5" />
                        Öppna
                      </button>
                      <button type="button" onClick={() => openResult(best)} className="flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-black" style={{ background: ax("borderSoft"), color: "white" }}>
                        <Crown className="h-3.5 w-3.5" />
                        Medlemskap
                      </button>
                      <a href={`/openplay?v=${encodeURIComponent(venueSlug || "solna")}`} className="flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-black" style={{ background: ax("borderSoft"), color: "white" }}>
                        <Ticket className="h-3.5 w-3.5" />
                        Sälj pass
                      </a>
                    </div>
                  )}

                  {results.map((result) => (
                    <button
                      key={`${result.kind}:${result.id}`}
                      type="button"
                      onClick={() => openResult(result)}
                      className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/5"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: result.kind === "booking" ? ax("electric", 0.16) : ax("lime", 0.14), color: result.kind === "booking" ? ax("electric") : ax("lime") }}>
                        {result.kind === "booking" ? <ReceiptText className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-black text-white">{result.title}</p>
                        <p className="truncate text-[11px]" style={{ color: ax("muted") }}>{result.meta}</p>
                      </div>
                      <AxChip tone={result.kind === "booking" ? "electric" : "lime"}>{result.kind === "booking" ? "Bokning" : "Kund"}</AxChip>
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Customer360Drawer
        open={!!selectedCustomer}
        venueId={venueId}
        customerId={selectedCustomer?.customerId}
        userId={selectedCustomer?.userId}
        onClose={() => setSelectedCustomer(null)}
      />
    </div>
  );
}
