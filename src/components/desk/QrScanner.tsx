import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Camera, UserCheck, Loader2, AlertCircle, Crown, Ticket, Calendar, Check } from "lucide-react";
import { Html5Qrcode } from "html5-qrcode";
import { apiPost } from "@/lib/api";
import { toast } from "sonner";

interface Entitlement {
  type: string;
  id: string;
  label: string;
  color?: string;
}

interface ScanResult {
  profile_id: string;
  user_id: string;
  display_name: string;
  phone: string | null;
  avatar_url: string | null;
  entitlements: Entitlement[];
  already_checked_in: boolean;
}

interface QrScannerProps {
  venueId: string;
  onClose: () => void;
  onCheckedIn?: () => void;
}

const entitlementIcon = (type: string) => {
  switch (type) {
    case "membership": return Crown;
    case "day_pass": return Ticket;
    case "booking": return Calendar;
    default: return Check;
  }
};

const entitlementPriority: Record<string, number> = {
  membership: 1,
  day_pass: 2,
  booking: 3,
};

const QrScanner = ({ venueId, onClose, onCheckedIn }: QrScannerProps) => {
  const [phase, setPhase] = useState<"scanning" | "found" | "done">("scanning");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const processedRef = useRef(false);

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        const state = scannerRef.current.getState();
        if (state === 2) { // SCANNING
          await scannerRef.current.stop();
        }
      } catch {
        // ignore
      }
      scannerRef.current = null;
    }
  }, []);

  const handleQrDetected = useCallback(async (decodedText: string) => {
    if (processedRef.current) return;
    processedRef.current = true;

    try {
      let userId: string;
      try {
        const parsed = JSON.parse(decodedText);
        if (parsed.type === "pickla_user" && parsed.uid) {
          userId = parsed.uid;
        } else {
          throw new Error("Invalid QR");
        }
      } catch {
        // Fallback: treat as raw user ID (UUID format)
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(decodedText)) {
          userId = decodedText;
        } else {
          setError("Ogiltig QR-kod");
          processedRef.current = false;
          return;
        }
      }

      await stopScanner();
      setLoading(true);
      setError(null);

      // Validate against venue
      const result = await apiPost("api-checkins", "validate-by-uid", {
        venue_id: venueId,
        user_id: userId,
      });

      if (!result || !result.user_id) {
        setError("Användaren hittades inte");
        setLoading(false);
        processedRef.current = false;
        return;
      }

      setScanResult(result);
      setPhase("found");
      setLoading(false);
    } catch (err: any) {
      setError(err.message || "Något gick fel");
      setLoading(false);
      processedRef.current = false;
    }
  }, [venueId, stopScanner]);

  useEffect(() => {
    if (phase !== "scanning") return;

    const readerId = "qr-reader-element";
    let mounted = true;

    const startScanner = async () => {
      await new Promise((r) => setTimeout(r, 300)); // Wait for DOM
      if (!mounted) return;

      const scanner = new Html5Qrcode(readerId);
      scannerRef.current = scanner;

      try {
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText) => handleQrDetected(decodedText),
          () => {} // ignore errors during scanning
        );
      } catch (err) {
        if (mounted) {
          setError("Kunde inte starta kameran. Kontrollera att du gett kamerabehörighet.");
        }
      }
    };

    startScanner();

    return () => {
      mounted = false;
      stopScanner();
    };
  }, [phase, handleQrDetected, stopScanner]);

  const handleCheckin = async (entryType: string, entitlementId: string | null) => {
    if (!scanResult) return;
    setLoading(true);
    try {
      await apiPost("api-checkins", "checkin", {
        venue_id: venueId,
        target_user_id: scanResult.user_id,
        entry_type: entryType,
        entitlement_id: entitlementId,
        player_name: scanResult.display_name,
      });
      setPhase("done");
      toast.success(`${scanResult.display_name} incheckad! ✅`);
      onCheckedIn?.();
    } catch (err: any) {
      toast.error(err.message || "Incheckning misslyckades");
    }
    setLoading(false);
  };

  const handleAutoCheckin = async () => {
    if (!scanResult) return;

    if (scanResult.already_checked_in) {
      toast.info(`${scanResult.display_name} är redan incheckad`);
      setPhase("done");
      return;
    }

    // Pick best entitlement by priority
    const sorted = [...scanResult.entitlements].sort(
      (a, b) => (entitlementPriority[a.type] || 99) - (entitlementPriority[b.type] || 99)
    );

    if (sorted.length > 0) {
      const best = sorted[0];
      await handleCheckin(best.type, best.id);
    } else {
      await handleCheckin("manual", null);
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="fixed bottom-0 left-0 right-0 z-50 max-w-md mx-auto rounded-t-3xl overflow-hidden"
        style={{ background: "hsl(var(--background))", borderTop: "1px solid hsl(var(--border))" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 pb-2">
          <div className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-display font-bold">
              {phase === "scanning" ? "Skanna QR" : phase === "found" ? "Hittad!" : "Klar!"}
            </h2>
          </div>
          <motion.button whileTap={{ scale: 0.9 }} onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "hsl(var(--surface-3))" }}>
            <X className="w-4 h-4" />
          </motion.button>
        </div>

        {/* Content */}
        <div className="px-4 pb-8">
          {phase === "scanning" && (
            <div className="space-y-3">
              <div
                id="qr-reader-element"
                className="rounded-2xl overflow-hidden bg-black"
                style={{ minHeight: 280 }}
              />
              {loading && (
                <div className="flex items-center justify-center gap-2 py-3">
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">Söker...</span>
                </div>
              )}
              {error && (
                <div className="flex items-center gap-2 bg-destructive/10 text-destructive rounded-xl p-3">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <p className="text-xs">{error}</p>
                </div>
              )}
            </div>
          )}

          {phase === "found" && scanResult && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
              {/* User card */}
              <div className="glass-card rounded-2xl p-4 flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center text-primary font-display font-bold text-lg">
                  {(scanResult.display_name || "?").charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-base font-display font-bold truncate">{scanResult.display_name}</p>
                  {scanResult.phone && <p className="text-xs text-muted-foreground">{scanResult.phone}</p>}
                </div>
                {scanResult.already_checked_in && (
                  <span className="status-chip bg-court-free/15 text-court-free text-[10px] font-bold">Redan inne</span>
                )}
              </div>

              {/* Entitlements */}
              {scanResult.entitlements.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Giltiga pass</p>
                  {[...scanResult.entitlements]
                    .sort((a, b) => (entitlementPriority[a.type] || 99) - (entitlementPriority[b.type] || 99))
                    .map((ent, i) => {
                      const Icon = entitlementIcon(ent.type);
                      return (
                        <div key={i} className="glass-card rounded-xl p-3 flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: ent.color ? `${ent.color}20` : "hsl(var(--primary) / 0.1)" }}>
                            <Icon className="w-4 h-4" style={{ color: ent.color || "hsl(var(--primary))" }} />
                          </div>
                          <span className="text-sm font-semibold flex-1">{ent.label}</span>
                          {i === 0 && <span className="text-[9px] px-2 py-0.5 rounded-full bg-primary/15 text-primary font-bold">Bästa match</span>}
                        </div>
                      );
                    })}
                </div>
              ) : (
                <div className="bg-badge-unpaid/10 rounded-xl p-3 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-badge-unpaid shrink-0" />
                  <p className="text-xs text-muted-foreground">Inget aktivt pass — checkas in manuellt</p>
                </div>
              )}

              {/* Action button */}
              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={handleAutoCheckin}
                disabled={loading}
                className="w-full bg-court-free text-white rounded-2xl py-4 font-bold text-sm flex items-center justify-center gap-2.5 shadow-lg shadow-court-free/25 disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <UserCheck className="w-5 h-5" />}
                {scanResult.already_checked_in ? "Redan incheckad" : "Checka in"}
              </motion.button>
            </motion.div>
          )}

          {phase === "done" && (
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center py-8 gap-3">
              <div className="w-16 h-16 rounded-full bg-court-free/15 flex items-center justify-center">
                <Check className="w-8 h-8 text-court-free" />
              </div>
              <p className="text-lg font-display font-bold">{scanResult?.display_name}</p>
              <p className="text-sm text-muted-foreground">Incheckad ✅</p>
              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={() => {
                  processedRef.current = false;
                  setScanResult(null);
                  setError(null);
                  setPhase("scanning");
                }}
                className="mt-4 bg-primary text-primary-foreground rounded-xl px-6 py-3 text-sm font-semibold"
              >
                Skanna nästa
              </motion.button>
            </motion.div>
          )}
        </div>
      </motion.div>
    </>
  );
};

export default QrScanner;
