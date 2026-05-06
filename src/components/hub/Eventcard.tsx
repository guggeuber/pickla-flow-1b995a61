import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { apiPost } from "@/lib/api";
import { DateTime } from "luxon";
import { useNavigate } from "react-router-dom";

const FONT_HEADING = "'Space Grotesk', sans-serif";
const HUB_RED = "#CC2936";
const HUB_NAVY = "#1a1f3a";

interface EventCardProps {
  eventId: string;
  venueId: string;
  isDropIn?: boolean;
}

export function EventCard({ eventId, venueId, isDropIn }: EventCardProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [savedCard, setSavedCard] = useState<{ brand: string; last4: string; id: string } | null>(null);

  const { data: event } = useQuery({
    queryKey: ["hub-event-detail", eventId],
    staleTime: 60000,
    queryFn: async () => {
      const { data } = await supabase
        .from("events")
        .select("id, name, display_name, description, logo_url, primary_color, start_date, start_time, entry_fee, entry_fee_type, is_drop_in, max_participants")
        .eq("id", eventId)
        .single();
      return data;
    },
  });

  const { data: playerCount = 0 } = useQuery({
    queryKey: ["hub-event-players", eventId],
    staleTime: 30000,
    queryFn: async () => {
      const { count } = await supabase
        .from("players")
        .select("id", { count: "exact", head: true })
        .eq("event_id", eventId);
      return count ?? 0;
    },
  });

  if (!event) return null;

  const isFree = !event.entry_fee || event.entry_fee === 0 || event.entry_fee_type === "free";
  const price = event.entry_fee ?? 0;
  const maxP = event.max_participants;
  const spotsLeft = maxP ? Math.max(0, maxP - playerCount) : null;
  const isFull = maxP ? spotsLeft === 0 : false;
  const dropIn = isDropIn || event.is_drop_in;

  const dateStr = event.start_date
    ? DateTime.fromISO(event.start_date).toFormat("d MMM", { locale: "sv" })
    : "";
  const timeStr = event.start_time ? event.start_time.slice(0, 5) : "";

  const handleCTA = async () => {
    if (!user) { navigate("/auth?redirect=/hub"); return; }
    if (dropIn) { navigate("/openplay"); return; }

    setLoading(true);
    // Check for saved cards
    try {
      const res = await apiPost("api-stripe", "payment-methods", {});
      const cards = res?.paymentMethods ?? [];
      if (cards.length > 0) {
        setSavedCard(cards[0]);
        setShowConfirm(true);
        setLoading(false);
        return;
      }
    } catch {}

    // No saved card — go to Stripe checkout
    try {
      const res = await apiPost("api-bookings", "create-checkout", {
        type: "event",
        event_id: eventId,
        venue_id: venueId,
        user_id: user.id,
        success_path: "/hub",
      });
      if (res?.url) window.location.href = res.url;
    } catch {}
    setLoading(false);
  };

  const handleConfirmPay = async () => {
    if (!savedCard || !user) return;
    setLoading(true);
    setShowConfirm(false);
    try {
      await apiPost("api-stripe", "charge-saved-card", {
        payment_method_id: savedCard.id,
        amount_sek: price,
        event_id: eventId,
        user_id: user.id,
      });
      setSuccess(true);
    } catch {
      navigate("/openplay");
    }
    setLoading(false);
  };

  const ctaLabel = dropIn
    ? `Drop-in · ${isFree ? "Gratis" : `${price} kr`}`
    : isFull
    ? "Fullbokad"
    : isFree
    ? "Anmäl dig — Gratis"
    : `Köp plats — ${price} kr`;

  return (
    <>
      <motion.div
        style={{
          background: HUB_NAVY,
          borderRadius: 14,
          overflow: "hidden",
          marginBottom: 4,
        }}
      >
        {/* Logo / header */}
        {event.logo_url ? (
          <img
            src={event.logo_url}
            alt={event.display_name || event.name}
            style={{ width: "100%", height: 100, objectFit: "cover", display: "block" }}
          />
        ) : (
          <div style={{
            width: "100%", height: 60,
            background: event.primary_color || "#2d3a8c",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <span style={{ fontSize: 32 }}>🏆</span>
          </div>
        )}

        <div style={{ padding: "12px 14px 14px" }}>
          <p style={{ fontFamily: FONT_HEADING, fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 2 }}>
            {event.display_name || event.name}
          </p>
          {(dateStr || timeStr) && (
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", fontFamily: "Inter, sans-serif", marginBottom: 6 }}>
              {dateStr}{timeStr ? ` · ${timeStr}` : ""}
            </p>
          )}
          {event.description && (
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", fontFamily: "Inter, sans-serif", marginBottom: 10, lineHeight: 1.4 }}>
              {event.description.slice(0, 100)}{event.description.length > 100 ? "…" : ""}
            </p>
          )}

          {/* Spots bar */}
          {maxP && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", gap: 3, marginBottom: 5 }}>
                {Array.from({ length: Math.min(maxP, 20) }).map((_, i) => (
                  <div key={i} style={{
                    flex: 1, height: 5, borderRadius: 3,
                    background: i < Math.min(playerCount, maxP) ? HUB_RED : "rgba(255,255,255,0.15)",
                  }} />
                ))}
              </div>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", fontFamily: "Inter, sans-serif" }}>
                {isFull
                  ? <span style={{ color: HUB_RED }}>Fullbokad</span>
                  : <><span style={{ color: "#fff", fontWeight: 700 }}>{spotsLeft}</span> av {maxP} platser kvar</>
                }
              </p>
            </div>
          )}

          {/* CTA */}
          {success ? (
            <div style={{ background: "rgba(34,197,94,0.15)", borderRadius: 10, padding: "10px 0", textAlign: "center" }}>
              <p style={{ fontFamily: FONT_HEADING, fontSize: 13, fontWeight: 700, color: "#22c55e" }}>Du är anmäld! 🎉</p>
            </div>
          ) : (
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={handleCTA}
              disabled={loading || isFull}
              style={{
                width: "100%",
                background: isFull ? "rgba(255,255,255,0.1)" : HUB_RED,
                color: isFull ? "rgba(255,255,255,0.35)" : "#fff",
                border: "none", borderRadius: 10, padding: "11px 0",
                fontFamily: FONT_HEADING, fontSize: 13, fontWeight: 700,
                cursor: isFull ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              {loading
                ? <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} />
                : ctaLabel}
            </motion.button>
          )}
        </div>
      </motion.div>

      {/* Confirm saved card sheet */}
      {showConfirm && savedCard && (
        <div
          onClick={() => setShowConfirm(false)}
          style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-end" }}
        >
          <motion.div
            onClick={e => e.stopPropagation()}
            initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
            style={{ background: "#fff", borderRadius: "20px 20px 0 0", padding: "20px 16px 32px", width: "100%" }}
          >
            <p style={{ fontFamily: FONT_HEADING, fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Bekräfta betalning</p>
            <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 20 }}>
              Betala {price} kr med {savedCard.brand} •••• {savedCard.last4}
            </p>
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={handleConfirmPay}
              style={{ width: "100%", background: HUB_RED, color: "#fff", border: "none", borderRadius: 12, padding: "13px 0", fontFamily: FONT_HEADING, fontSize: 14, fontWeight: 700, cursor: "pointer", marginBottom: 10 }}
            >
              Betala {price} kr
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => setShowConfirm(false)}
              style={{ width: "100%", background: "none", border: "none", color: "#6b7280", fontFamily: FONT_HEADING, fontSize: 13, cursor: "pointer" }}
            >
              Avbryt
            </motion.button>
          </motion.div>
        </div>
      )}
    </>
  );
}