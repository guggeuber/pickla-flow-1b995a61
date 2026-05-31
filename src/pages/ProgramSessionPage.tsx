import { useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiGet } from "@/lib/api";
import picklaLogo from "@/assets/pickla-logo.svg";

const BG = "#fbf7f2";
const TEXT = "#0f172a";
const FONT_HEADING = "'Space Grotesk', sans-serif";
export default function ProgramSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const requestedDate = searchParams.get("date");
  const venueSlug = searchParams.get("v") || "pickla-arena-sthlm";

  const { data, isLoading, error } = useQuery({
    queryKey: ["program-session-entry", sessionId, requestedDate, venueSlug],
    enabled: !!sessionId,
    queryFn: () => apiGet<any>("api-event-public", "activity-preview", {
      sessionId: sessionId!,
      venueSlug,
      ...(requestedDate ? { date: requestedDate } : {}),
    }),
  });

  useEffect(() => {
    if (!error) return;
    toast.error(error instanceof Error ? error.message : "Kunde inte öppna aktiviteten");
    const timer = window.setTimeout(() => navigate(`/today?v=${venueSlug}`, { replace: true }), 1200);
    return () => window.clearTimeout(timer);
  }, [error, navigate, venueSlug]);

  useEffect(() => {
    if (isLoading || !data?.room?.id) return;
    navigate(`/chat/${data.room.id}?v=${venueSlug}`, { replace: true });
  }, [data, isLoading, navigate, venueSlug]);

  return (
    <div
      className="grid min-h-[100dvh] place-items-center px-6 text-center"
      style={{ background: BG, color: TEXT, paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="grid justify-items-center gap-4">
        <img src={picklaLogo} alt="Pickla" className="h-8 w-auto" />
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        <div>
          <p className="text-lg font-black" style={{ fontFamily: FONT_HEADING }}>
            {error ? "Aktiviteten hittades inte" : "Öppnar aktivitetschatten"}
          </p>
          <p className="mt-1 text-sm font-bold text-slate-500">
            {error ? "Vi skickar dig tillbaka till hubben." : "Chatten är platsen för frågor och anmälan."}
          </p>
        </div>
      </div>
    </div>
  );
}
