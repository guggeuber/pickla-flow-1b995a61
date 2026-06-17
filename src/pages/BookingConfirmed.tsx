import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { apiGet } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import picklaLogo from "@/assets/pickla-logo.svg";

const FONT_GROTESK = "'Space Grotesk', sans-serif";
const FONT_MONO    = "'Space Mono', monospace";
const TIMEOUT_MS   = 30_000;
const safeLocalPath = (path: string | null | undefined) =>
  path && path.startsWith("/") && !path.startsWith("//") ? path : "";

type BookingBySessionResponse = {
  pending?: boolean;
  booking_ref?: string;
  registration_id?: string;
  activity_session_id?: string;
  session_date?: string;
  venue_slug?: string;
  type?: "booking" | "session_ticket";
};

export default function BookingConfirmed() {
  const [searchParams] = useSearchParams();
  const session  = searchParams.get("session") ?? "";
  const type     = searchParams.get("type") ?? "";
  const storedCheckinReturn =
    typeof window !== "undefined" ? safeLocalPath(sessionStorage.getItem("pickla_checkin_return")) : "";
  const next     = safeLocalPath(searchParams.get("next")) || storedCheckinReturn || "/my";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  const [timedOut, setTimedOut] = useState(false);

  const isDayPass = type === "day_pass";
  const isSessionTicket = type === "session_ticket";
  const isInstantAccess = isDayPass;

  useEffect(() => {
    if (!isDayPass && !isSessionTicket) return;
    queryClient.invalidateQueries({ queryKey: ["access-snapshot"] });
    queryClient.invalidateQueries({ queryKey: ["program-session-entry"] });
    queryClient.invalidateQueries({ queryKey: ["program-session-registrations"] });
  }, [isDayPass, isSessionTicket, queryClient]);

  // Standalone day passes are active immediately; paid activity tickets wait for the webhook below.
  useEffect(() => {
    if (!isInstantAccess) return;
    const id = setTimeout(() => {
      if (storedCheckinReturn && next === storedCheckinReturn) {
        sessionStorage.removeItem("pickla_checkin_return");
      }
      navigate(next, { replace: true });
    }, 1800);
    return () => clearTimeout(id);
  }, [isInstantAccess, navigate, next, storedCheckinReturn]);

  // Poll until the webhook has created the booking (typically < 2 s)
  const { data } = useQuery<BookingBySessionResponse>({
    queryKey:       ["booking-by-session", session],
    enabled:        !!session && !timedOut && !isInstantAccess,
    queryFn:        () => apiGet("api-bookings", "by-session", { session }),
    staleTime:      0,
    refetchInterval: (query) => {
      const d = query.state.data;
      return d && !d.pending ? false : 2000;
    },
  });

  // Redirect as soon as the webhook has created the booking.
  useEffect(() => {
    const bookingRef = data?.booking_ref;
    const venueSlug = data?.venue_slug;
    if (isSessionTicket && data && !data.pending && !authLoading) {
      const params = new URLSearchParams();
      if (data.registration_id) params.set("registration", data.registration_id);
      if (venueSlug) params.set("v", venueSlug);
      const myPath = params.toString() ? `/my?${params.toString()}` : "/my";
      if (storedCheckinReturn) {
        sessionStorage.removeItem("pickla_checkin_return");
        navigate(storedCheckinReturn, { replace: true });
        return;
      }
      navigate(user ? myPath : next, { replace: true });
      return;
    }
    if (bookingRef && !authLoading) {
      const venueParam = venueSlug ? `&v=${encodeURIComponent(venueSlug)}` : "";
      navigate(user ? `/my?booking=${encodeURIComponent(bookingRef)}${venueParam}` : `/b/${encodeURIComponent(bookingRef)}`, { replace: true });
    }
  }, [authLoading, data, isSessionTicket, navigate, next, storedCheckinReturn, user]);

  // Fallback: give up after TIMEOUT_MS and show a static message
  useEffect(() => {
    if (!session || isInstantAccess) return;
    const id = setTimeout(() => setTimedOut(true), TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [session, isInstantAccess]);

  // Access success screen — no polling required.
  if (isInstantAccess) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-6 px-5 text-center">
        <img src={picklaLogo} alt="Pickla" className="h-8 w-auto opacity-20 mb-2" />
        <CheckCircle2 className="w-16 h-16 text-emerald-500" />
        <div>
          <h1
            className="text-[26px] font-bold text-neutral-900 tracking-tight"
            style={{ fontFamily: FONT_GROTESK }}
          >
            betalning genomförd!
          </h1>
          <p className="text-neutral-400 text-[12px] mt-2" style={{ fontFamily: FONT_MONO }}>
            {isSessionTicket ? "din plats är bokad — vi öppnar aktiviteten" : "ditt dagspass är aktivt — välkommen in!"}
          </p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-neutral-400 text-[13px]" style={{ fontFamily: FONT_MONO }}>
          ogiltig bekräftelseslänk
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-6 px-5 text-center">
      <img src={picklaLogo} alt="Pickla" className="h-8 w-auto opacity-20 mb-2" />

      <CheckCircle2 className="w-16 h-16 text-emerald-500" />

      <div>
        <h1
          className="text-[26px] font-bold text-neutral-900 tracking-tight"
          style={{ fontFamily: FONT_GROTESK }}
        >
          betalning genomförd!
        </h1>
        <p
          className="text-neutral-400 text-[12px] mt-2"
          style={{ fontFamily: FONT_MONO }}
        >
          {timedOut
            ? "din bokning bekräftas inom kort — kolla din e-post"
            : "bekräftar bokning…"}
        </p>
      </div>

      {!timedOut && (
        <Loader2 className="w-5 h-5 animate-spin text-neutral-300" />
      )}
    </div>
  );
}
