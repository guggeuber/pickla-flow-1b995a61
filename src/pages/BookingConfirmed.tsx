import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { apiGet } from "@/lib/api";
import picklaLogo from "@/assets/pickla-logo.svg";

const FONT_GROTESK = "'Space Grotesk', sans-serif";
const FONT_MONO    = "'Space Mono', monospace";
const TIMEOUT_MS   = 30_000;

export default function BookingConfirmed() {
  const [searchParams] = useSearchParams();
  const session  = searchParams.get("session") ?? "";
  const type     = searchParams.get("type") ?? "";
  const navigate = useNavigate();
  const [timedOut, setTimedOut] = useState(false);

  const isDayPass = type === "day_pass";

  // Day pass: show success immediately, redirect to /hub after 3 s
  useEffect(() => {
    if (!isDayPass) return;
    const id = setTimeout(() => navigate("/hub", { replace: true }), 3000);
    return () => clearTimeout(id);
  }, [isDayPass, navigate]);

  // Poll until the webhook has created the booking (typically < 2 s)
  const { data } = useQuery({
    queryKey:       ["booking-by-session", session],
    enabled:        !!session && !timedOut && !isDayPass,
    queryFn:        () => apiGet("api-bookings", "by-session", { session }),
    staleTime:      0,
    refetchInterval: (query) => {
      const d = query.state.data as any;
      return d && !d.pending ? false : 2000;
    },
  });

  // Redirect as soon as the booking_ref is available
  useEffect(() => {
    if ((data as any)?.booking_ref) {
      navigate(`/b/${(data as any).booking_ref}`, { replace: true });
    }
  }, [data, navigate]);

  // Fallback: give up after TIMEOUT_MS and show a static message
  useEffect(() => {
    if (!session || isDayPass) return;
    const id = setTimeout(() => setTimedOut(true), TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [session, isDayPass]);

  // Day pass success screen — no session required
  if (isDayPass) {
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
            ditt dagspass är aktivt — välkommen in!
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
