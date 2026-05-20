import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Clock3, XCircle } from "lucide-react";
import { DateTime } from "luxon";
import { apiGet, apiPost } from "@/lib/api";

type Phase = "idle" | "loading" | "success" | "error" | "wrong";

interface CourtResource {
  id: string;
  name: string;
  court_number: number;
  sport_type: string | null;
  is_available?: boolean;
}

interface BookingSlot {
  court_id: string;
  start: string;
  end: string;
}

interface ResultInfo {
  title: string;
  subtitle: string;
  details?: string;
  time?: string;
}

function useRealtimeClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function fmtTime(isoUtc: string): string {
  return DateTime.fromISO(isoUtc, { zone: "utc" })
    .setZone("Europe/Stockholm")
    .toFormat("HH:mm");
}

function formatResourceList(resources: Array<{ name?: string; court_number?: number }>) {
  return resources
    .map((resource) => resource.name || `Bana ${resource.court_number ?? ""}`.trim())
    .filter(Boolean)
    .join(", ");
}

function DigitBox({
  value,
  isFocused,
  inputRef,
  onInput,
  onKeyDown,
  onPaste,
  disabled,
}: {
  value: string;
  isFocused: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  onInput: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  disabled: boolean;
}) {
  return (
    <div
      className={`relative flex h-24 w-20 items-center justify-center rounded-2xl border-2 transition-all duration-150
        ${isFocused ? "border-emerald-300 bg-slate-800" : value ? "border-slate-500 bg-slate-800" : "border-slate-700 bg-slate-900"}`}
    >
      <span className="select-none font-mono text-5xl font-bold text-white">
        {value || (isFocused ? <span className="animate-pulse text-emerald-300">_</span> : "")}
      </span>
      <input
        ref={inputRef}
        type="tel"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onInput(e.target.value.replace(/\D/g, "").slice(-1))}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        autoComplete="off"
      />
    </div>
  );
}

export default function ResourceCheckinDisplay() {
  const { courtId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const slug = searchParams.get("v") ?? "";
  const now = useRealtimeClock();
  const today = DateTime.now().setZone("Europe/Stockholm").toISODate()!;

  const { data: venueData } = useQuery({
    queryKey: ["resource-display-venue", slug],
    enabled: !!slug,
    queryFn: () => apiGet("api-bookings", "public-venue", { slug }),
    staleTime: 60_000,
  });
  const venue = venueData?.venue as { id: string; name: string } | undefined;
  const venueId = venue?.id;

  const { data: courtsData } = useQuery({
    queryKey: ["resource-display-courts", slug, today],
    enabled: !!slug,
    queryFn: () => apiGet("api-bookings", "public-courts", { slug, date: today, showAll: "true" }),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const resource = useMemo(() => {
    const courts = (courtsData?.courts || []) as CourtResource[];
    return courts.find((court) => court.id === courtId) || null;
  }, [courtsData, courtId]);

  const currentAndNext = useMemo(() => {
    const bookings = ((courtsData?.bookings || []) as BookingSlot[])
      .filter((booking) => booking.court_id === courtId)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    const nowMs = now.getTime();
    const current = bookings.find(
      (booking) => new Date(booking.start).getTime() <= nowMs && new Date(booking.end).getTime() > nowMs,
    );
    const next = bookings.find((booking) => new Date(booking.start).getTime() > nowMs);
    return { current, next };
  }, [courtsData, courtId, now]);

  const [digits, setDigits] = useState(["", "", "", ""]);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [resultInfo, setResultInfo] = useState<ResultInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState("Ogiltig kod");

  const ref0 = useRef<HTMLInputElement>(null);
  const ref1 = useRef<HTMLInputElement>(null);
  const ref2 = useRef<HTMLInputElement>(null);
  const ref3 = useRef<HTMLInputElement>(null);
  const inputRefs = useMemo(() => [ref0, ref1, ref2, ref3], []);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    setDigits(["", "", "", ""]);
    setPhase("idle");
    setResultInfo(null);
    setFocusedIndex(0);
    setTimeout(() => ref0.current?.focus(), 50);
  }, []);

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(reset, 60_000);
  }, [reset]);

  useEffect(() => {
    ref0.current?.focus();
    resetIdleTimer();
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
    };
  }, [resetIdleTimer]);

  const submit = useCallback(
    async (code: string) => {
      if (!venueId || !courtId || phase === "loading") return;
      setPhase("loading");

      try {
        const result = await apiPost("api-checkins", "code", {
          venue_id: venueId,
          access_code: code,
          resource_id: courtId,
        });

        if (result.wrong_resource) {
          const expected = formatResourceList(result.expected_resources || result.booking?.courts || []);
          const startT = result.booking?.start_time ? fmtTime(result.booking.start_time) : "";
          const endT = result.booking?.end_time ? fmtTime(result.booking.end_time) : "";
          setResultInfo({
            title: "Fel station",
            subtitle: expected ? `Din bokning gäller ${expected}` : "Din bokning gäller en annan resurs",
            time: startT && endT ? `${startT}–${endT}` : undefined,
          });
          setPhase("wrong");
          if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
          phaseTimerRef.current = setTimeout(reset, 7_000);
          return;
        }

        const courts = (result.booking?.courts || [])
          .filter(Boolean)
          .sort((a: any, b: any) => Number(a.court_number || 0) - Number(b.court_number || 0));
        const courtDetails = formatResourceList(courts);
        const courtLabel = courts.length > 1 ? `${courts.length} resurser` : courtDetails || resource?.name || "Bokning";
        const startT = result.booking?.start_time ? fmtTime(result.booking.start_time) : "";
        const endT = result.booking?.end_time ? fmtTime(result.booking.end_time) : "";

        setResultInfo({
          title: result.already_checked_in ? "Redan incheckad" : "Välkommen!",
          subtitle: courtLabel,
          details: courts.length > 1 ? courtDetails : undefined,
          time: startT && endT ? `${startT}–${endT}` : undefined,
        });
        setPhase("success");
        if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
        phaseTimerRef.current = setTimeout(reset, 5_000);
      } catch (err: any) {
        setErrorMsg(err?.message?.includes("utgången") ? "Koden har gått ut" : err?.message || "Ogiltig kod");
        setPhase("error");
        if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
        phaseTimerRef.current = setTimeout(reset, 3_000);
      }
    },
    [venueId, courtId, phase, resource?.name, reset],
  );

  const handleInput = useCallback(
    (index: number, digit: string) => {
      if (!digit || phase === "loading" || phase === "success") return;
      resetIdleTimer();
      const next = [...digits];
      next[index] = digit;
      setDigits(next);
      if (index < 3) {
        inputRefs[index + 1].current?.focus();
        setFocusedIndex(index + 1);
      } else {
        inputRefs[index].current?.blur();
        submit(next.join(""));
      }
    },
    [digits, phase, inputRefs, resetIdleTimer, submit],
  );

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (phase === "loading" || phase === "success") return;
      if (e.key === "Backspace") {
        resetIdleTimer();
        e.preventDefault();
        const next = [...digits];
        if (next[index]) {
          next[index] = "";
          setDigits(next);
        } else if (index > 0) {
          next[index - 1] = "";
          setDigits(next);
          inputRefs[index - 1].current?.focus();
          setFocusedIndex(index - 1);
        }
      }
    },
    [digits, phase, inputRefs, resetIdleTimer],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 4);
      if (!pasted) return;
      resetIdleTimer();
      const next = ["", "", "", ""];
      pasted.split("").forEach((digit, index) => { next[index] = digit; });
      setDigits(next);
      const nextFocus = Math.min(pasted.length, 3);
      inputRefs[nextFocus].current?.focus();
      setFocusedIndex(nextFocus);
      if (pasted.length === 4) submit(pasted);
    },
    [inputRefs, resetIdleTimer, submit],
  );

  if (!slug || !courtId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-center">
        <p className="font-mono text-sm text-slate-500">Saknar venue eller resource i URL:en.</p>
      </div>
    );
  }

  const occupied = Boolean(currentAndNext.current);

  return (
    <div className="flex h-screen select-none flex-col items-center justify-between overflow-hidden bg-slate-950 px-6 py-8 text-white">
      <div className="flex w-full flex-col items-center gap-5 text-center">
        <p className="font-mono text-sm uppercase tracking-widest text-slate-500">
          {venue?.name ?? slug}
        </p>
        <div className="rounded-[2rem] border border-slate-800 bg-slate-900/80 px-8 py-6 shadow-2xl shadow-black/30">
          <div className="mb-3 flex items-center justify-center gap-2">
            <span className={`h-3 w-3 rounded-full ${occupied ? "bg-red-400" : "bg-emerald-300"}`} />
            <span className="font-mono text-xs font-bold uppercase tracking-widest text-slate-400">
              {occupied ? "Aktiv just nu" : "Redo för incheckning"}
            </span>
          </div>
          <h1 className="font-display text-6xl font-black leading-none tracking-tight">
            {resource?.name ?? "Resource"}
          </h1>
          <div className="mt-4 flex items-center justify-center gap-2 font-mono text-sm text-slate-400">
            <Clock3 className="h-4 w-4" />
            {currentAndNext.current
              ? `${fmtTime(currentAndNext.current.start)}–${fmtTime(currentAndNext.current.end)}`
              : currentAndNext.next
                ? `Nästa ${fmtTime(currentAndNext.next.start)}`
                : "Ingen mer bokning idag"}
          </div>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center w-full">
        <AnimatePresence mode="wait">
          {phase === "success" && resultInfo && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              className="flex flex-col items-center gap-5 text-center"
            >
              <CheckCircle2 className="h-20 w-20 text-emerald-300" />
              <div>
                <p className="font-display text-5xl font-black leading-tight text-white">{resultInfo.title}</p>
                <p className="mt-2 font-display text-5xl font-black leading-tight text-emerald-300">{resultInfo.subtitle}</p>
                {resultInfo.details && <p className="mt-2 font-mono text-xl text-slate-400">{resultInfo.details}</p>}
                {resultInfo.time && <p className="mt-3 font-mono text-2xl text-slate-400">{resultInfo.time}</p>}
              </div>
            </motion.div>
          )}

          {phase === "wrong" && resultInfo && (
            <motion.div
              key="wrong"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex max-w-3xl flex-col items-center gap-5 text-center"
            >
              <XCircle className="h-20 w-20 text-amber-300" />
              <div>
                <p className="font-display text-5xl font-black text-amber-300">{resultInfo.title}</p>
                <p className="mt-3 font-display text-4xl font-bold leading-tight text-white">{resultInfo.subtitle}</p>
                {resultInfo.time && <p className="mt-4 font-mono text-2xl text-slate-400">{resultInfo.time}</p>}
              </div>
            </motion.div>
          )}

          {phase === "error" && (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, x: [0, -14, 14, -10, 10, -6, 6, 0] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.45 }}
              className="flex flex-col items-center gap-5 text-center"
            >
              <XCircle className="h-20 w-20 text-red-400" />
              <p className="font-display text-4xl font-bold text-red-400">{errorMsg}</p>
              <p className="font-mono text-base text-slate-500">försök igen</p>
            </motion.div>
          )}

          {(phase === "idle" || phase === "loading") && (
            <motion.div
              key="input"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex w-full flex-col items-center gap-8"
            >
              <div className="text-center">
                <p className="font-display text-3xl font-bold tracking-tight text-white">Ange din incheckningskod</p>
                <p className="mt-2 font-mono text-base text-slate-500">koden finns i din bokningsbekräftelse</p>
              </div>
              <motion.div className="flex gap-4" animate={phase === "loading" ? { opacity: 0.5 } : { opacity: 1 }}>
                {digits.map((digit, index) => (
                  <DigitBox
                    key={index}
                    value={digit}
                    isFocused={focusedIndex === index && phase === "idle"}
                    inputRef={inputRefs[index]}
                    onInput={(value) => handleInput(index, value)}
                    onKeyDown={(event) => handleKeyDown(index, event)}
                    onPaste={handlePaste}
                    disabled={phase === "loading"}
                  />
                ))}
              </motion.div>
              {phase === "loading" && <p className="animate-pulse font-mono text-sm text-slate-500">kontrollerar kod…</p>}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <p className="text-center font-mono text-xs uppercase tracking-wider text-slate-600">
        Resource station · {resource?.sport_type || "pickla"}
      </p>
    </div>
  );
}
