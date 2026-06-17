import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowRight, CheckCircle2, Loader2, Ticket, UserCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api";

const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

type SelfCheckinResponse = {
  checked_in?: boolean;
  already_checked_in?: boolean;
  allowed?: boolean;
  venue?: {
    id: string;
    name?: string | null;
    slug?: string | null;
  };
  checkin?: {
    id: string;
    entry_type: string;
    checked_in_at: string;
  };
  access?: {
    best?: {
      type: string;
      label?: string | null;
    } | null;
  };
  purchase_options?: Array<{
    type: string;
    label: string;
    href: string;
    price_sek?: number;
  }>;
};

function entryLabel(type?: string | null) {
  if (type === "booking") return "Bokning";
  if (type === "session_ticket") return "Aktivitet";
  if (type === "membership" || type === "membership_access") return "Medlemskap";
  if (type === "day_access" || type === "day_pass") return "Dagstillgång";
  return type || "Access";
}

export default function SelfCheckinPage() {
  const { venueSlug = "" } = useParams();
  const navigate = useNavigate();
  const [result, setResult] = useState<SelfCheckinResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (!venueSlug || attemptedRef.current) return;
    attemptedRef.current = true;

    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await apiPost<SelfCheckinResponse>("api-checkins", "self", {
          venueSlug,
        });
        setResult(response);
        if (response.checked_in) {
          toast.success(response.already_checked_in ? "Du är redan incheckad" : "Du är incheckad");
        }
      } catch (err: any) {
        setError(err.message || "Kunde inte checka in");
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [venueSlug]);

  const returnPath = `/checkin/${venueSlug}`;
  const goPurchase = (href: string) => {
    sessionStorage.setItem("pickla_checkin_return", returnPath);
    const [path, query = ""] = href.split("?");
    const params = new URLSearchParams(query);
    if (!params.has("returnTo")) params.set("returnTo", returnPath);
    navigate(`${path}?${params.toString()}`);
  };

  const venueName = result?.venue?.name || "Pickla";
  const best = result?.access?.best;

  return (
    <main className="min-h-[100dvh] bg-white px-5 py-[calc(env(safe-area-inset-top,0px)+32px)] text-neutral-950">
      <div className="mx-auto flex min-h-[calc(100dvh-64px)] w-full max-w-sm flex-col justify-center">
        <div className="mb-8">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
            Venue check-in
          </p>
          <h1 className="mt-2 text-[36px] font-black leading-none tracking-tight" style={{ fontFamily: FONT_HEADING }}>
            {venueName}
          </h1>
        </div>

        {loading && (
          <div className="rounded-[28px] border border-black/10 bg-neutral-50 p-6 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-neutral-300" />
            <p className="mt-4 text-sm font-bold text-neutral-500">Kollar din access...</p>
          </div>
        )}

        {!loading && error && (
          <div className="rounded-[28px] border border-red-100 bg-red-50 p-6 text-center">
            <XCircle className="mx-auto h-10 w-10 text-red-500" />
            <h2 className="mt-4 text-xl font-black" style={{ fontFamily: FONT_HEADING }}>Något gick fel</h2>
            <p className="mt-2 text-sm text-neutral-500">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-5 w-full rounded-2xl bg-neutral-950 py-3 text-sm font-black text-white"
            >
              Försök igen
            </button>
          </div>
        )}

        {!loading && result?.checked_in && (
          <div className="rounded-[28px] border border-emerald-100 bg-emerald-50 p-6">
            <CheckCircle2 className="h-12 w-12 text-emerald-500" />
            <h2 className="mt-5 text-[30px] font-black leading-none" style={{ fontFamily: FONT_HEADING }}>
              {result.already_checked_in ? "Redan inne" : "Du är inne"}
            </h2>
            <p className="mt-3 text-sm font-semibold text-neutral-600">
              {entryLabel(result.checkin?.entry_type || best?.type)}
              {best?.label ? ` · ${best.label}` : ""}
            </p>
            <p className="mt-1 text-xs text-neutral-400">Desk har fått signalen.</p>
            <button
              onClick={() => navigate(`/today?v=${encodeURIComponent(result.venue?.slug || venueSlug)}`)}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-neutral-950 py-3 text-sm font-black text-white"
            >
              Till Pickla idag <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {!loading && result && !result.checked_in && (
          <div className="rounded-[28px] border border-black/10 bg-neutral-50 p-6">
            <Ticket className="h-10 w-10 text-neutral-900" />
            <h2 className="mt-5 text-[28px] font-black leading-none" style={{ fontFamily: FONT_HEADING }}>
              Ingen aktiv access
            </h2>
            <p className="mt-3 text-sm text-neutral-500">
              Köp access online först, kom sedan tillbaka hit så checkar vi in dig direkt.
            </p>
            <div className="mt-5 space-y-2">
              {(result.purchase_options || []).map((option) => (
                <button
                  key={`${option.type}-${option.href}`}
                  onClick={() => goPurchase(option.href)}
                  className="flex w-full items-center justify-between rounded-2xl bg-white px-4 py-3 text-left text-sm font-black"
                >
                  <span>{option.label}</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              ))}
            </div>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-black/10 py-3 text-sm font-black"
            >
              <UserCheck className="h-4 w-4" />
              Jag har access nu
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
