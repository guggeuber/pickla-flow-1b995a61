import { Users } from "lucide-react";
import {
  bookingParticipantStateView,
  bookingParticipantSummaryLabel,
  type BookingParticipantOperationalState,
} from "@/lib/bookingParticipantState";

const FONT_GROTESK = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

export type BookingParticipantSummaryData = {
  booker?: {
    display_name?: string | null;
    first_name?: string | null;
  } | null;
  participants?: Array<{
    id: string;
    display_name?: string | null;
    role?: string | null;
    payment_status?: string | null;
    checked_in_at?: string | null;
    committed?: boolean | null;
    confirmed?: boolean | null;
    has_place?: boolean | null;
    operational_state?: BookingParticipantOperationalState | null;
  }>;
  committed_count?: number;
  confirmed_count?: number;
  reserved_count?: number;
  available_count?: number;
  pending_unreserved_count?: number;
  claimed_count?: number;
  anonymous_others_count?: number;
  capacity?: number;
  remaining_committed_capacity?: number;
  capacity_source?: string;
  capacity_is_authoritative?: boolean;
  capacity_state?: "ok" | "over_capacity_attention";
  capacity_invariant_violation?: boolean;
  over_capacity_count?: number;
};

function initials(name?: string | null) {
  return String(name || "P")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "P";
}

export function BookingParticipantSummary({
  summary,
  compact = false,
  tone = "light",
  viewerIsBooker = false,
}: {
  summary?: BookingParticipantSummaryData | null;
  compact?: boolean;
  tone?: "light" | "dark";
  viewerIsBooker?: boolean;
}) {
  if (!summary) return null;

  const participants = Array.isArray(summary.participants)
    ? summary.participants.filter((participant) => participant.confirmed === true || participant.has_place === true || participant.committed === true || ["paid", "free"].includes(String(participant.payment_status || "").toLowerCase()))
    : [];
  const confirmedCount = Number(summary.confirmed_count ?? summary.committed_count ?? 0);
  const reservedCount = Number(summary.reserved_count || 0);
  const pendingUnreservedCount = Number(summary.pending_unreserved_count || 0);
  const anonymousOthersCount = Number(summary.anonymous_others_count || 0);
  const capacity = Number(summary.capacity || 0);
  const availableCount = Math.max(0, Number(summary.available_count ?? summary.remaining_committed_capacity ?? 0));
  const capacityRequiresAttention = summary.capacity_invariant_violation === true || summary.capacity_state === "over_capacity_attention";
  const muted = tone === "dark" ? "text-white/50" : "text-neutral-500";
  const text = tone === "dark" ? "text-white" : "text-neutral-950";
  const panel = tone === "dark"
    ? "border-white/10 bg-white/[0.03]"
    : "border-neutral-200 bg-[#fbfaf7]";

  return (
    <section className={`rounded-3xl border ${panel} ${compact ? "p-3" : "p-4"}`}>
      <div className="flex items-start gap-3">
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl ${tone === "dark" ? "bg-white/10 text-white" : "bg-white text-neutral-950"}`}>
          <Users className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          {summary.booker?.first_name || viewerIsBooker ? (
            <p className={`text-sm font-black ${text}`} style={{ fontFamily: FONT_GROTESK }}>
              {viewerIsBooker ? "Bokad av dig" : `Bokad av ${summary.booker?.first_name}`}
            </p>
          ) : null}
          {capacity > 0 ? (
            <p className={`mt-1 text-xs font-semibold ${capacityRequiresAttention ? "text-red-600" : muted}`} style={{ fontFamily: FONT_MONO }}>
              {bookingParticipantSummaryLabel({ ...summary, confirmed_count: confirmedCount, reserved_count: reservedCount, available_count: availableCount })}
            </p>
          ) : null}
          {pendingUnreservedCount > 0 && viewerIsBooker ? (
            <p className={`mt-1 text-[11px] font-semibold ${muted}`} style={{ fontFamily: FONT_MONO }}>
              {pendingUnreservedCount} väntar utan reserverad plats
            </p>
          ) : null}
        </div>
      </div>

      {participants.length > 0 ? (
        <div className="mt-4 space-y-2">
          {participants.map((participant) => {
            const state = bookingParticipantStateView(participant);
            return (
              <div key={participant.id} className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-black ${tone === "dark" ? "bg-black text-white" : "bg-neutral-950 text-white"}`}>
                    {initials(participant.display_name)}
                  </div>
                  <p className={`truncate text-sm font-bold ${text}`} style={{ fontFamily: FONT_GROTESK }}>
                    {participant.display_name || "Spelare"}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${state.state === "confirmed_included" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-neutral-200 bg-neutral-950 text-white"}`} style={{ fontFamily: FONT_MONO }}>
                  {state.detail}
                </span>
              </div>
            );
          })}
        </div>
      ) : anonymousOthersCount > 0 ? (
        <p className={`mt-3 text-xs font-semibold ${muted}`} style={{ fontFamily: FONT_MONO }}>
          {anonymousOthersCount} medspelare visas anonymt tills du hämtat din plats.
        </p>
      ) : (
        <p className={`mt-3 text-xs font-semibold ${muted}`} style={{ fontFamily: FONT_MONO }}>
          Inga ytterligare bekräftade platser visas än.
        </p>
      )}
    </section>
  );
}
