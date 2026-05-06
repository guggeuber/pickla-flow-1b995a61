import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { apiPost } from "@/lib/api";
import { DateTime } from "luxon";
import { useNavigate } from "react-router-dom";
import { apiGet } from "@/lib/api";

const FONT_HEADING = "'Space Grotesk', sans-serif";
const HUB_RED = "#CC2936";
const HUB_NAVY = "#1a1f3a";

type EventPlayer = {
  id: string;
  name: string | null;
  auth_user_id: string | null;
  avatar_url?: string | null;
};

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

  const { data: players = [] } = useQuery<EventPlayer[]>({
    queryKey: ["hub-event-player-list", eventId],
    staleTime: 30000,
    queryFn: async () => {
      const { data: playerRows } = await supabase
        .from("players")
        .select("id, name, auth_user_id")
        .eq("event_id", eventId)
        .order("created_at", { ascending: true });

      const authIds = (playerRows || []).map((p) => p.auth_user_id).filter(Boolean) as string[];
      if (authIds.length === 0) return playerRows || [];

      const { data: profiles } = await supabase
        .from("player_profiles")
        .select("auth_user_id, avatar_url")
        .in("auth_user_id", authIds);

      const avatarByUser = new Map((profiles || []).map((profile) => [profile.auth_user_id, profile.avatar_url]));
      return (playerRows || []).map((player) => ({
        ...player,
        avatar_url: player.auth_user_id ? avatarByUser.get(player.auth_user_id) : null,
      }));
    },
  });

  if (!event) return null;

  const playerCount = players.length;
  const isRegistered = success || (!!user && players.some((player) => player.auth_user_id === user.id));
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
    if (isRegistered) return;

    setLoading(true);
    // Check for saved cards
    try {
      const res = await apiGet("api-stripe", "payment-methods");
      const cards = res?.paymentMethods ?? [];
      if (cards.length > 0) {
        setSavedCard(cards[0]);
        setShowConfirm(true);
        setLoading(false);
        return;
      }
    } catch {}

    // No saved card — go to Stripe checkout
    navigate(`/event/${eventId}`, { state: { from: "hub" } });
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
      navigate(`/event/${eventId}`, { state: { from: "hub" } });
    }
    setLoading(false);
  };

  const ctaLabel = isRegistered
    ? "Du är anmäld ✓"
    : dropIn
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
       {event.logo_url ? (
  <div style={{ padding: "16px 14px 0", display: "flex", justifyContent: "center" }}>
    <img
      src={event.logo_url}
      alt={event.display_name || event.name}
      style={{ height: 60, width: "auto", maxWidth: "60%", objectFit: "contain", borderRadius: 8 }}
    />
  </div>
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

          <motion.button
            whileTap={isRegistered ? undefined : { scale: 0.97 }}
            onClick={handleCTA}
            disabled={loading || isFull || isRegistered}
            style={{
              width: "100%",
              background: isRegistered ? "rgba(34,197,94,0.15)" : isFull ? "rgba(255,255,255,0.1)" : HUB_RED,
              color: isRegistered ? "#22c55e" : isFull ? "rgba(255,255,255,0.35)" : "#fff",
              border: "none", borderRadius: 10, padding: "11px 0",
              fontFamily: FONT_HEADING, fontSize: 13, fontWeight: 700,
              cursor: isRegistered || isFull ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}
          >
            {loading
              ? <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} />
              : isRegistered
              ? <><Check style={{ width: 14, height: 14 }} />{ctaLabel}</>
              : ctaLabel}
          </motion.button>

          {players.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
              <div style={{ display: "flex", paddingLeft: 4 }}>
                {players.slice(0, 5).map((player, idx) => (
                  <div
                    key={player.id}
                    title={player.name || "Spelare"}
                    style={{
                      width: 24,
                      height: 24,
                      marginLeft: idx === 0 ? 0 : -7,
                      borderRadius: "999px",
                      border: `2px solid ${HUB_NAVY}`,
                      overflow: "hidden",
                      background: "rgba(255,255,255,0.16)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                      fontFamily: FONT_HEADING,
                      fontSize: 10,
                      fontWeight: 800,
                    }}
                  >
                    {player.avatar_url ? (
                      <img src={player.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      (player.name || "?").charAt(0).toUpperCase()
                    )}
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", fontFamily: "Inter, sans-serif" }}>
                {players.length} anmälda
              </p>
            </div>
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
