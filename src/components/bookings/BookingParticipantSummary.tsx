import { Users } from "lucide-react";

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
  }>;
  committed_count?: number;
  claimed_count?: number;
  anonymous_others_count?: number;
  capacity?: number;
  remaining_committed_capacity?: number;
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

function statusLabel(status?: string | null) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "free") return "Ingår";
  if (normalized === "paid") return "Betald";
  return "Väntar på betalning";
}

function statusStyle(status?: string | null) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "free") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (normalized === "paid") return "border-neutral-200 bg-neutral-950 text-white";
  return "border-amber-200 bg-amber-50 text-amber-700";
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

  const participants = Array.isArray(summary.participants) ? summary.participants : [];
  const committedCount = Number(summary.committed_count || 0);
  const anonymousOthersCount = Number(summary.anonymous_others_count || 0);
  const capacity = Number(summary.capacity || 0);
  const remaining = Math.max(0, Number(summary.remaining_committed_capacity ?? capacity - committedCount));
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
            <p className={`mt-1 text-xs font-semibold ${muted}`} style={{ fontFamily: FONT_MONO }}>
              {committedCount} av {capacity} spelare klara · {remaining} platser kvar
            </p>
          ) : null}
        </div>
      </div>

      {participants.length > 0 ? (
        <div className="mt-4 space-y-2">
          {participants.map((participant) => (
            <div key={participant.id} className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-black ${tone === "dark" ? "bg-black text-white" : "bg-neutral-950 text-white"}`}>
                  {initials(participant.display_name)}
                </div>
                <p className={`truncate text-sm font-bold ${text}`} style={{ fontFamily: FONT_GROTESK }}>
                  {participant.display_name || "Spelare"}
                </p>
              </div>
              <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${statusStyle(participant.payment_status)}`} style={{ fontFamily: FONT_MONO }}>
                {statusLabel(participant.payment_status)}
              </span>
            </div>
          ))}
        </div>
      ) : anonymousOthersCount > 0 ? (
        <p className={`mt-3 text-xs font-semibold ${muted}`} style={{ fontFamily: FONT_MONO }}>
          {anonymousOthersCount} medspelare visas anonymt tills du hämtat din plats.
        </p>
      ) : (
        <p className={`mt-3 text-xs font-semibold ${muted}`} style={{ fontFamily: FONT_MONO }}>
          Inga medspelare har hämtat sin plats än.
        </p>
      )}
    </section>
  );
}
