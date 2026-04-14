import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, XCircle } from "lucide-react";
import { DateTime } from "luxon";
import { apiGet, apiPost } from "@/lib/api";

// ─── Types ───────────────────────────────────────────────────────────────────

type Phase = "idle" | "loading" | "success" | "error";

interface SuccessInfo {
  name: string;
  court: string;
  time: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function useRealtimeClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function isCourtOccupied(
  courtId: string,
  bookings: Array<{ court_id: string; start: string; end: string }>,
  nowMs: number,
): boolean {
  return bookings.some(
    (b) =>
      b.court_id === courtId &&
      new Date(b.start).getTime() <= nowMs &&
      new Date(b.end).getTime() > nowMs,
  );
}

function fmtTime(isoUtc: string): string {
  return DateTime.fromISO(isoUtc, { zone: "utc" })
    .setZone("Europe/Stockholm")
    .toFormat("HH:mm");
}

// ─── Court Status Strip ───────────────────────────────────────────────────────

function CourtStrip({
  courts,
}: {
  courts: Array<{ id: string; name: string; court_number: number; occupied: boolean }>;
}) {
  return (
    <div className="flex gap-3 justify-center flex-wrap">
      {courts.map((c) => (
        <div key={c.id} className="flex items-center gap-2 px-4 py-2 rounded-full bg-slate-800/60">
          <span
            className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
              c.occupied ? "bg-red-500" : "bg-emerald-400"
            }`}
          />
          <span className="text-slate-300 font-mono text-sm font-bold tracking-wide">
            {c.name}
          </span>
          <span
            className={`text-xs font-mono font-bold ${
              c.occupied ? "text-red-400" : "text-emerald-400"
            }`}
          >
            {c.occupied ? "FULL" : "LEDIG"}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Digit Input ─────────────────────────────────────────────────────────────

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
      className={`relative w-20 h-24 rounded-2xl border-2 transition-all duration-150 flex items-center justify-center
        ${isFocused ? "border-blue-400 bg-slate-800" : value ? "border-slate-500 bg-slate-800" : "border-slate-700 bg-slate-900"}`}
    >
      <span className="text-white font-mono font-bold text-5xl select-none">
        {value || (isFocused ? <span className="animate-pulse text-blue-400">_</span> : "")}
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
        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
        autoComplete="off"
      />
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OpenPlayDisplay() {
  const [searchParams] = useSearchParams();
  const slug = searchParams.get("v") ?? "";
  const now = useRealtimeClock();
  const today = DateTime.now().setZone("Europe/Stockholm").toISODate()!;

  // ── Venue ──────────────────────────────────────────────────────────────────
  const { data: venueData } = useQuery({
    queryKey: ["openplay-venue", slug],
    enabled: !!slug,
    queryFn: () => apiGet("api-bookings", "public-venue", { slug }),
    staleTime: 60_000,
  });
  const venue = venueData?.venue as { id: string; name: string } | undefined;
  const venueId = venue?.id;

  // ── Courts (open play pickleball courts 5-8, refresh every 30s) ───────────
  const { data: courtsData } = useQuery({
    queryKey: ["openplay-courts", slug, today],
    enabled: !!slug,
    queryFn: () =>
      apiGet("api-bookings", "public-courts", { slug, date: today, showAll: "true" }),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const openPlayCourts = useMemo(() => {
    if (!courtsData?.courts) return [];
    const rawBookings: Array<{ court_id: string; start: string; end: string }> =
      courtsData.bookings ?? [];
    const nowMs = now.getTime();

    return (courtsData.courts as Array<{
      id: string;
      name: string;
      court_number: number;
      sport_type: string | null;
    }>)
      .filter(
        (c) =>
          c.sport_type === "pickleball" &&
          c.court_number >= 5 &&
          c.court_number <= 8,
      )
      .map((c) => ({
        id: c.id,
        name: c.name,
        court_number: c.court_number,
        occupied: isCourtOccupied(c.id, rawBookings, nowMs),
      }))
      .sort((a, b) => a.court_number - b.court_number);
  }, [courtsData, now]);

  // ── Input state ────────────────────────────────────────────────────────────
  const [digits, setDigits] = useState(["", "", "", ""]);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [successInfo, setSuccessInfo] = useState<SuccessInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState("Ogiltig kod");

  const ref0 = useRef<HTMLInputElement>(null);
  const ref1 = useRef<HTMLInputElement>(null);
  const ref2 = useRef<HTMLInputElement>(null);
  const ref3 = useRef<HTMLInputElement>(null);
  const inputRefs = [ref0, ref1, ref2, ref3];

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Reset ──────────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    setDigits(["", "", "", ""]);
    setPhase("idle");
    setSuccessInfo(null);
    setFocusedIndex(0);
    // Small delay so focus feels natural after an animation
    setTimeout(() => ref0.current?.focus(), 50);
  }, []);

  // ── Idle timeout ───────────────────────────────────────────────────────────
  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(reset, 60_000);
  }, [reset]);

  // Start idle timer on mount and focus first input
  useEffect(() => {
    ref0.current?.focus();
    resetIdleTimer();
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
    };
  }, [resetIdleTimer]);

  // ── Submit ─────────────────────────────────────────────────────────────────
  const submit = useCallback(
    async (code: string) => {
      if (!venueId || phase === "loading") return;
      setPhase("loading");

      try {
        const result = await apiPost("api-checkins", "code", {
          venue_id: venueId,
          access_code: code,
        });

        const court = result.booking?.court;
        const courtName =
          court?.name ?? `Bana ${court?.court_number ?? ""}`;
        const startT = result.booking?.start_time ? fmtTime(result.booking.start_time) : "";
        const endT   = result.booking?.end_time   ? fmtTime(result.booking.end_time)   : "";
        const name   = result.booking?.customer_name || "";

        setSuccessInfo({
          name,
          court: courtName,
          time: startT && endT ? `${startT}–${endT}` : "",
        });
        setPhase("success");

        if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
        phaseTimerRef.current = setTimeout(reset, 5_000);
      } catch (err: any) {
        setErrorMsg(
          err?.message?.includes("utgången")
            ? "Koden har gått ut"
            : "Ogiltig kod",
        );
        setPhase("error");

        if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
        phaseTimerRef.current = setTimeout(reset, 3_000);
      }
    },
    [venueId, phase, reset],
  );

  // ── Input handlers ─────────────────────────────────────────────────────────
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
        // All 4 filled — auto-submit
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
      pasted.split("").forEach((d, i) => { next[i] = d; });
      setDigits(next);
      const nextFocus = Math.min(pasted.length, 3);
      inputRefs[nextFocus].current?.focus();
      setFocusedIndex(nextFocus);
      if (pasted.length === 4) submit(pasted);
    },
    [inputRefs, resetIdleTimer, submit],
  );

  // ── No slug ────────────────────────────────────────────────────────────────
  if (!slug) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <p className="text-slate-500 font-mono text-sm">
          Lägg till <code className="text-blue-400">?v=venue-slug</code> i URL:en
        </p>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="h-screen bg-slate-950 text-white flex flex-col items-center justify-between overflow-hidden select-none px-6 py-8">

      {/* ── Top: venue name + court status ────────────────────────────────── */}
      <div className="flex flex-col items-center gap-4 w-full">
        <p className="font-mono text-slate-500 text-sm tracking-widest uppercase">
          {venue?.name ?? slug}
        </p>
        {openPlayCourts.length > 0 && (
          <CourtStrip courts={openPlayCourts} />
        )}
      </div>

      {/* ── Center: code input or result ──────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center w-full">
        <AnimatePresence mode="wait">

          {/* SUCCESS */}
          {phase === "success" && successInfo && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col items-center gap-5 text-center"
            >
              <CheckCircle2 className="w-20 h-20 text-emerald-400" />
              <div>
                <p className="text-4xl font-bold font-display text-white leading-tight">
                  {successInfo.name ? `Välkommen, ${successInfo.name}!` : "Välkommen!"}
                </p>
                <p className="text-5xl font-black font-display text-emerald-400 mt-2 leading-tight">
                  {successInfo.court}
                </p>
                {successInfo.time && (
                  <p className="text-2xl font-mono text-slate-400 mt-2">
                    {successInfo.time}
                  </p>
                )}
              </div>
            </motion.div>
          )}

          {/* ERROR */}
          {phase === "error" && (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, x: [0, -14, 14, -10, 10, -6, 6, 0] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.45 }}
              className="flex flex-col items-center gap-5 text-center"
            >
              <XCircle className="w-20 h-20 text-red-400" />
              <p className="text-4xl font-bold font-display text-red-400">
                {errorMsg}
              </p>
              <p className="text-slate-500 font-mono text-base">
                försök igen
              </p>
            </motion.div>
          )}

          {/* IDLE / LOADING */}
          {(phase === "idle" || phase === "loading") && (
            <motion.div
              key="input"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-8 w-full"
            >
              {/* Instruction */}
              <div className="text-center">
                <p className="text-3xl font-bold text-white tracking-tight font-display">
                  Ange din incheckningskod
                </p>
                <p className="text-slate-500 font-mono text-base mt-2">
                  koden finns i din bokningsbekräftelse
                </p>
              </div>

              {/* 4-digit boxes */}
              <motion.div
                className="flex gap-4"
                animate={phase === "loading" ? { opacity: 0.5 } : { opacity: 1 }}
              >
                {digits.map((d, i) => (
                  <DigitBox
                    key={i}
                    value={d}
                    isFocused={focusedIndex === i && phase === "idle"}
                    inputRef={inputRefs[i]}
                    onInput={(v) => handleInput(i, v)}
                    onKeyDown={(e) => handleKeyDown(i, e)}
                    onPaste={handlePaste}
                    disabled={phase === "loading"}
                  />
                ))}
              </motion.div>

              {phase === "loading" && (
                <p className="font-mono text-slate-500 text-sm animate-pulse">
                  kontrollerar kod…
                </p>
              )}
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      {/* ── Bottom: Open Play info ─────────────────────────────────────────── */}
      <div className="text-center">
        <p className="font-mono text-slate-600 text-xs tracking-wider uppercase">
          Open Play · Bana 5–8
        </p>
      </div>
    </div>
  );
}
