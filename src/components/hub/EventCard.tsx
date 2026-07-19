import { useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, CalendarClock, Check, ChevronDown, Loader2, MessageCircle, Ticket } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { apiPost } from "@/lib/api";
import { DateTime } from "luxon";
import { useNavigate } from "react-router-dom";
import { apiGet } from "@/lib/api";
import { toast } from "sonner";
import {
  activityPriceLabels,
  formatSek,
  hasActiveMembership,
  mergeBackendActivityPricing,
} from "@/lib/activityPricing";
import { fetchActivitySessionOverrides, isPublicActivityOverrideHidden, occurrenceOverrideKey } from "@/lib/activitySessionOverrides";
import { MemberStrip } from "@/components/ui/MemberStrip";
import { PriceLine } from "@/components/ui/PriceLine";
import { PeopleRow, ScarcityBadge } from "@/components/ui/PeopleRow";

const FONT_HEADING = "'Space Grotesk', sans-serif";
const HUB_RED = "#CC2936";
const HUB_NAVY = "#1a1f3a";

type EventPlayer = {
  display_name: string;
  avatar_url: string | null;
};

type EventParticipantsResponse = {
  count: number;
  participants: EventPlayer[];
  current_user_registered: boolean;
};

interface EventCardProps {
  eventId: string;
  venueId: string;
  venueSlug?: string;
  isDropIn?: boolean;
  roomId?: string;
  publicActivityPreview?: any;
}

function parseProgramChatResourceId(resourceId: string) {
  const match = resourceId.match(/^activity_session:([^:]+):([^:]+)$/);
  if (!match) return null;
  return { sessionId: match[1], occurrenceDate: match[2] === "next" ? null : match[2] };
}

export function EventCard({ eventId, venueId, venueSlug, isDropIn, roomId, publicActivityPreview }: EventCardProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const programResource = parseProgramChatResourceId(eventId);
  const eventLookupId = programResource?.sessionId || eventId;
  const explicitOccurrenceDate = programResource?.occurrenceDate || null;
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [programExpanded, setProgramExpanded] = useState(false);
  const collapsedGestureRef = useRef({ startY: 0, moved: false, suppressClick: false });
  const [savedCard, setSavedCard] = useState<{ brand: string; last4: string; id: string } | null>(null);

  const { data: event } = useQuery({
    queryKey: ["hub-event-detail", eventLookupId],
    enabled: !programResource,
    staleTime: 60000,
    queryFn: async () => {
      const { data } = await supabase
        .from("events")
        .select("id, name, display_name, description, logo_url, primary_color, start_date, start_time, entry_fee, entry_fee_type, is_drop_in, max_participants, is_public, planning_status, visibility, customer_name, customer_email, customer_phone, expected_participants, partner_notes, resources")
        .eq("id", eventLookupId)
        .maybeSingle();
      return data;
    },
  });

  const { data: programSession } = useQuery({
    queryKey: ["hub-program-session-detail", eventLookupId],
    enabled: !event && !publicActivityPreview?.activity_session,
    staleTime: 60000,
    queryFn: async () => {
      const { data } = await supabase
        .from("activity_sessions")
        .select("id, name, session_type, session_date, recurrence_days, start_time, end_time, capacity, price_sek, product_key, venue_id, access_policy, metadata")
        .eq("id", eventLookupId)
        .maybeSingle();
      return data;
    },
  });
  const effectiveProgramSession = programSession || publicActivityPreview?.activity_session || null;

  const programOccurrenceDate = (() => {
    if (explicitOccurrenceDate) return explicitOccurrenceDate;
    if (!effectiveProgramSession) return null;
    const now = DateTime.now().setZone("Europe/Stockholm");
    if ((effectiveProgramSession as any).occurrence_date) return String((effectiveProgramSession as any).occurrence_date);
    if ((effectiveProgramSession as any).session_date) return String((effectiveProgramSession as any).session_date);
    const days = ((effectiveProgramSession as any).recurrence_days || []) as number[];
    for (let offset = 0; offset < 14; offset++) {
      const date = now.plus({ days: offset });
      if (!days.includes(date.weekday % 7)) continue;
      if (offset === 0 && effectiveProgramSession.end_time) {
        const [hour = 0, minute = 0] = String(effectiveProgramSession.end_time).slice(0, 5).split(":").map(Number);
        if (date.set({ hour, minute, second: 0, millisecond: 0 }) <= now) continue;
      }
      return date.toISODate();
    }
    return now.toISODate();
  })();

  const { data: programOverrideMap = new Map() } = useQuery({
    queryKey: ["hub-event-card-program-override", effectiveProgramSession?.venue_id, eventLookupId, programOccurrenceDate],
    enabled: !!effectiveProgramSession?.venue_id && !!eventLookupId && !!programOccurrenceDate,
    staleTime: 10000,
    queryFn: () => fetchActivitySessionOverrides(effectiveProgramSession!.venue_id, [eventLookupId], programOccurrenceDate!, programOccurrenceDate!),
  });
  const programOverride = programOccurrenceDate
    ? programOverrideMap.get(occurrenceOverrideKey(eventLookupId, programOccurrenceDate))
    : null;

  const { data: programRegistrations = [] } = useQuery({
    queryKey: ["hub-program-session-registrations", eventId, programOccurrenceDate],
    enabled: !!effectiveProgramSession?.id && !!programOccurrenceDate && !publicActivityPreview?.registrations,
    staleTime: 10000,
    queryFn: async () => {
      const { data } = await supabase
        .from("session_registrations")
        .select("id, user_id, status")
        .eq("activity_session_id", eventLookupId)
        .eq("session_date", programOccurrenceDate);
      return (data || []).filter((row: any) => row.status !== "cancelled");
    },
  });

  const { data: programSocialProof } = useQuery({
    queryKey: ["hub-program-social-proof", eventLookupId, programOccurrenceDate, venueSlug],
    enabled: !!effectiveProgramSession?.id && !!programOccurrenceDate && !!venueSlug && !publicActivityPreview?.interests,
    staleTime: 10000,
    queryFn: async () => {
      const result = await apiGet<{ occurrences: Array<{
        activity_session_id: string;
        session_date: string;
        registrations_count: number;
        interested_count: number;
        user_is_interested: boolean;
      }> }>("api-event-public", "activity-social-proof", {
        venueSlug,
        sessionIds: eventLookupId,
        startDate: programOccurrenceDate,
        endDate: programOccurrenceDate,
      });
      return result.occurrences?.[0] || null;
    },
  });

  const { data: membership } = useQuery({
    queryKey: ["hub-program-membership", user?.id, effectiveProgramSession?.venue_id],
    enabled: !!user?.id && !!effectiveProgramSession?.venue_id,
    staleTime: 30000,
    queryFn: () => apiGet("api-memberships", "user", { userId: user!.id, venueId: effectiveProgramSession!.venue_id }),
  });

  const { data: dayAccess } = useQuery({
    queryKey: ["hub-program-day-access", user?.id, effectiveProgramSession?.venue_id, programOccurrenceDate],
    enabled: !!user?.id && !!effectiveProgramSession?.venue_id && !!programOccurrenceDate,
    staleTime: 30000,
    queryFn: async () => {
      const { data } = await supabase
        .from("access_entitlements")
        .select("id")
        .eq("user_id", user!.id)
        .eq("venue_id", effectiveProgramSession!.venue_id)
        .eq("entitlement_type", "day_access")
        .eq("status", "active")
        .eq("valid_date", programOccurrenceDate)
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const { data: participantData } = useQuery<EventParticipantsResponse>({
    queryKey: ["hub-event-participant-list", event?.id, user?.id],
    enabled: !!event?.id,
    staleTime: 30000,
    queryFn: () => apiGet<EventParticipantsResponse>("api-event-public", "event-participants", {
      eventId: event!.id,
    }),
  });
  const players = participantData?.participants || [];

  if (!event && effectiveProgramSession) {
    if (isPublicActivityOverrideHidden(programOverride?.status)) return null;

    const timeStr = [
      effectiveProgramSession.start_time ? String(effectiveProgramSession.start_time).slice(0, 5) : null,
      effectiveProgramSession.end_time ? String(effectiveProgramSession.end_time).slice(0, 5) : null,
    ].filter(Boolean).join("-");
    const sessionType = effectiveProgramSession.session_type === "open_play"
      ? "Open Play"
      : effectiveProgramSession.session_type === "group_training"
        ? "Träning"
        : "Aktivitet";
    const capacity = Number(effectiveProgramSession.capacity || 0);
    const registrationCount = Number(publicActivityPreview?.registrations?.count ?? programRegistrations.length ?? 0);
    const spotsLeft = capacity ? Math.max(capacity - registrationCount, 0) : null;
    const isFull = spotsLeft === 0;
    const backendPricing = publicActivityPreview?.activityTicketPricing || publicActivityPreview?.pricing || null;
    const pricingDebug = backendPricing?.debug || {};
    const pricingMode = String(pricingDebug.pricing_mode || (effectiveProgramSession as any).metadata?.pricing_mode || "standard");
    const onlinePrice = Number(pricingDebug.online_price_sek ?? (effectiveProgramSession as any).metadata?.online_price_sek ?? effectiveProgramSession.price_sek ?? 0);
    const deskPrice = Number(pricingDebug.desk_price_sek ?? (effectiveProgramSession as any).metadata?.desk_price_sek ?? onlinePrice);
    const memberDiscountPercent = Number(pricingDebug.member_discount_percent ?? (effectiveProgramSession as any).metadata?.member_discount_percent ?? 0);
    const specialMemberPrice = pricingMode === "member_discount"
      ? Math.max(0, Math.round(onlinePrice * (1 - memberDiscountPercent / 100) * 100) / 100)
      : onlinePrice;
    const pricing = mergeBackendActivityPricing(activityPriceLabels({
      basePrice: Number(effectiveProgramSession.price_sek || 165),
      productKey: (effectiveProgramSession as any).product_key,
      sessionType: effectiveProgramSession.session_type,
      membership,
      hasDayAccess: !!dayAccess,
    }), backendPricing);
    const userHasMembership = hasActiveMembership(membership);
    const isRegistered = !!user?.id && programRegistrations.some((row: any) => row.user_id === user.id);
    const chatPath = roomId
      ? `/chat/${roomId}${venueSlug ? `?v=${encodeURIComponent(venueSlug)}` : ""}`
      : `/hub${venueSlug ? `?v=${encodeURIComponent(venueSlug)}` : ""}`;
    const membershipName = String(
      backendPricing?.membershipTierName ||
      pricingDebug.membership_tier_name ||
      membership?.membership_tiers?.name ||
      ""
    );
    const customerPrice = Number(backendPricing?.effectivePriceSek ?? backendPricing?.finalAmountSek ?? pricing.finalPrice ?? onlinePrice);
    const includedLabel = backendPricing?.requiresCheckout === false
      ? backendPricing.accessDecision === "day_access_included"
        ? "Ingår idag"
        : `Ingår i ${membershipName || "medlemskap"}`
      : pricing.includedLabel
        ? pricing.includedLabel === "Ingår" && membershipName
          ? `Ingår i ${membershipName}`
          : pricing.includedLabel
        : null;
    const pricingIsIncluded = backendPricing?.requiresCheckout === false || Boolean(includedLabel);
    const displayedPrice = pricingIsIncluded ? customerPrice : customerPrice <= 0 ? 0 : customerPrice;
    const memberContextLine = !userHasMembership && pricingMode === "member_discount" && specialMemberPrice < onlinePrice
      ? <>Medlemmar spelar för {formatSek(specialMemberPrice)} eller fritt</>
      : !userHasMembership && pricingMode === "standard"
        ? <>Medlemmar kan spela billigare eller fritt</>
        : undefined;
    const announceJoin = async () => {
      if (!roomId || !user?.id) return;
      const { data: profile } = await supabase
        .from("player_profiles")
        .select("display_name")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      const name = profile?.display_name || user.email?.split("@")[0] || "En spelare";
      await supabase.from("chat_messages").insert({
        room_id: roomId,
        user_id: user.id,
        message_type: "bot",
        content: `${name} kommer`,
        metadata: {
          channel: "activity_registration",
          activity_session_id: eventLookupId,
          session_date: programOccurrenceDate,
        },
      });
    };
    const handleProgramAction = async () => {
      if (isFull) return;
      if (!user?.id) {
        navigate(`/auth?redirect=${encodeURIComponent(chatPath)}`);
        return;
      }
      if (loading) return;
      setLoading(true);
      try {
        const result = await apiPost("api-bookings", "create-checkout", {
          product_type: "activity_ticket",
          amount_sek: backendPricing?.effectivePriceSek ?? backendPricing?.finalAmountSek ?? effectiveProgramSession.price_sek ?? 0,
          venue_id: effectiveProgramSession.venue_id,
          metadata: {
            date: programOccurrenceDate,
            activity_session_id: eventLookupId,
            chat_room_id: roomId || "",
            session_name: effectiveProgramSession.name,
            session_type: effectiveProgramSession.session_type || "open_play",
            product_key: backendPricing?.productKey || (effectiveProgramSession as any).product_key || "",
            user_id: user.id,
            slug: venueSlug || "",
            redirect_path: chatPath,
            success_path: `/booking/confirmed?type=session_ticket&next=${encodeURIComponent(chatPath)}`,
          },
        });
        if (result.free) {
          await announceJoin();
          toast.success("Du är anmäld");
          navigate(result.redirect || chatPath, { replace: true });
          return;
        }
        if (!result.url) throw new Error("Kunde inte starta betalning");
        window.location.href = result.url;
      } catch (err: any) {
        toast.error(err.message || "Kunde inte starta anmälan");
      } finally {
        setLoading(false);
      }
    };
    const handleCollapsedPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
      collapsedGestureRef.current = { startY: event.clientY, moved: false, suppressClick: false };
    };
    const handleCollapsedPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
      const deltaY = event.clientY - collapsedGestureRef.current.startY;
      if (deltaY < -24) {
        collapsedGestureRef.current.moved = true;
        collapsedGestureRef.current.suppressClick = true;
        setProgramExpanded(true);
      }
    };
    const handleCollapsedActionClick = (event: MouseEvent<HTMLButtonElement>) => {
      if (collapsedGestureRef.current.suppressClick) {
        event.preventDefault();
        collapsedGestureRef.current.suppressClick = false;
        return;
      }
      if (isRegistered) return;
      handleProgramAction();
    };
    const handleExpandedPointerDown = (event: PointerEvent<HTMLDivElement>) => {
      collapsedGestureRef.current = { startY: event.clientY, moved: false, suppressClick: false };
    };
    const handleExpandedPointerMove = (event: PointerEvent<HTMLDivElement>) => {
      const deltaY = event.clientY - collapsedGestureRef.current.startY;
      if (deltaY > 24) {
        collapsedGestureRef.current.moved = true;
        collapsedGestureRef.current.suppressClick = true;
        setProgramExpanded(false);
      }
    };

    if (!programExpanded) {
      return (
        <motion.button
          whileTap={{ scale: isRegistered ? 1 : 0.98 }}
          type="button"
          onPointerDown={handleCollapsedPointerDown}
          onPointerMove={handleCollapsedPointerMove}
          onClick={handleCollapsedActionClick}
          disabled={loading || isRegistered}
          style={{
            width: "100%",
            border: "none",
            borderRadius: "20px 20px 0 0",
            background: isRegistered ? "#dcfce7" : isFull ? "#e2e8f0" : "#12e77a",
            color: isRegistered ? "#15803d" : isFull ? "#334155" : "#020617",
            padding: "8px 16px 15px",
            fontFamily: FONT_HEADING,
            fontSize: 20,
            fontWeight: 950,
            lineHeight: 1,
            textAlign: "center",
            cursor: isRegistered ? "default" : "pointer",
            boxShadow: "0 -4px 18px rgba(17,24,39,0.06)",
            touchAction: "pan-y",
          }}
        >
          <span style={{ display: "grid", justifyItems: "center", gap: 8 }}>
            <span style={{ display: "grid", justifyItems: "center", gap: 3 }}>
              <span style={{ width: 38, height: 3, borderRadius: 999, background: "rgba(2,6,23,0.28)" }} />
              <span style={{ width: 26, height: 3, borderRadius: 999, background: "rgba(2,6,23,0.20)" }} />
            </span>
            <span>
              {loading ? (
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
              <Loader2 style={{ width: 20, height: 20 }} className="animate-spin" />
              Öppnar
                </span>
              ) : isRegistered ? (
                "Anmäld"
              ) : isFull ? (
                "Fullt"
              ) : (
                `${user?.id ? "Anmäl mig" : "Logga in & anmäl"} · ${pricing.checkoutLabel}`
              )}
            </span>
          </span>
        </motion.button>
      );
    }

    return (
      <motion.div
        onClick={() => setProgramExpanded((open) => !open)}
        onPointerDown={handleExpandedPointerDown}
        onPointerMove={handleExpandedPointerMove}
        style={{
          background: "rgba(255,255,255,0.96)",
          border: "1px solid rgba(15,23,42,0.10)",
          borderRadius: "22px 22px 0 0",
          overflow: "hidden",
          boxShadow: "0 -4px 18px rgba(17,24,39,0.08)",
          touchAction: "pan-y",
        }}
      >
        <div style={{ padding: programExpanded ? 14 : 12 }}>
          <div style={{ display: "grid", justifyItems: "center", gap: 3, marginBottom: 10 }}>
            <span style={{ width: 38, height: 3, borderRadius: 999, background: "rgba(15,23,42,0.18)" }} />
            <span style={{ width: 26, height: 3, borderRadius: 999, background: "rgba(15,23,42,0.12)" }} />
          </div>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2, scrollbarWidth: "none" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", borderRadius: 999, background: "#f8fafc", border: "1px solid rgba(15,23,42,0.08)", color: "#334155", padding: "7px 10px", fontSize: 12, fontFamily: "Inter, sans-serif", fontWeight: 850 }}>
              <CalendarClock style={{ width: 14, height: 14 }} />
              {sessionType}{timeStr ? ` · ${timeStr}` : ""}
            </span>
            <ScarcityBadge remaining={spotsLeft} capacity={capacity} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center", marginTop: 10 }}>
            <div>
              <p style={{ margin: 0, color: "#0f172a", fontSize: 14, fontFamily: FONT_HEADING, fontWeight: 950 }}>
                {effectiveProgramSession.name}
              </p>
              <p style={{ margin: "2px 0 0", color: "#64748b", fontSize: 12, fontFamily: "Inter, sans-serif", fontWeight: 700 }}>
                {isRegistered ? "Du är anmäld i chatten" : isFull ? "Chatta om reservplats" : "Säkra platsen direkt i chatten"}
              </p>
              <PeopleRow participantCount={registrationCount} style={{ marginTop: 4 }} />
            </div>
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={(event) => {
                event.stopPropagation();
                if (isRegistered) return;
                handleProgramAction();
              }}
              disabled={loading || isRegistered}
              style={{
                background: isRegistered ? "#dcfce7" : isFull ? "#e2e8f0" : "#111827",
                color: isRegistered ? "#15803d" : isFull ? "#334155" : "#fff",
                border: "none",
                borderRadius: 999,
                padding: "12px 14px",
                fontFamily: FONT_HEADING,
                fontSize: 13,
                fontWeight: 950,
                cursor: isRegistered ? "default" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                whiteSpace: "nowrap",
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? <Loader2 style={{ width: 15, height: 15 }} className="animate-spin" /> : null}
              {isRegistered ? "Anmäld" : isFull ? "Reserv" : `${user?.id ? "Anmäl mig" : "Logga in & anmäl"} · ${pricing.checkoutLabel}`}
              {!loading && !isRegistered ? <ArrowRight style={{ width: 15, height: 15 }} /> : null}
            </motion.button>
          </div>

          {programExpanded && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ marginTop: 12, display: "grid", gap: 8 }}
            >
              <PeopleRow participantCount={registrationCount} />
              <ScarcityBadge remaining={spotsLeft} capacity={capacity} />

              {pricingIsIncluded ? (
                <MemberStrip
                  planName={backendPricing?.accessDecision === "day_access_included" ? "dagspass" : membershipName || "medlemskap"}
                  amountSek={customerPrice}
                />
              ) : (
                <div style={{ border: "1px solid rgba(15,23,42,0.08)", borderRadius: 18, background: "#f8fafc", padding: 12 }}>
                  <PriceLine
                    amountSek={displayedPrice}
                    contextLine={!userHasMembership && memberContextLine ? (
                      <details className="[&:not([open])_.price-details]:hidden" style={{ fontFamily: "Inter, sans-serif" }}>
                        <summary style={{ cursor: "pointer", color: "#334155", textDecoration: "underline", textUnderlineOffset: 2 }}>
                          {memberContextLine} · Se detaljer
                        </summary>
                        <div className="price-details" style={{ display: "grid", gap: 6, marginTop: 10, fontSize: 12, fontWeight: 750, color: "#64748b" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                            <span>Online</span>
                            <span>{formatSek(onlinePrice || Number(pricing.basePrice || 0))}</span>
                          </div>
                          {deskPrice > onlinePrice ? (
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                              <span>På plats</span>
                              <span>{formatSek(deskPrice)}</span>
                            </div>
                          ) : null}
                          {pricingMode === "member_discount" && specialMemberPrice < onlinePrice ? (
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                              <span>Medlem</span>
                              <span>{formatSek(specialMemberPrice)}</span>
                            </div>
                          ) : null}
                          {pricingMode === "standard" ? (
                            <p style={{ margin: 0, color: "#94a3b8" }}>
                              Medlemspris eller inkludering beror på aktivt medlemskap.
                            </p>
                          ) : null}
                        </div>
                      </details>
                    ) : undefined}
                    size="md"
                  />
                </div>
              )}
            </motion.div>
          )}
        </div>
      </motion.div>
    );
  }

  if (!event) return null;

  const isInternalLead = event.is_public === false || event.visibility === "internal" || event.planning_status === "inquiry";
  if (isInternalLead) {
    const resources = Array.isArray(event.resources) ? event.resources.filter(Boolean).join(", ") : "";
    return (
      <motion.div
        style={{
          background: "#fff",
          border: "1px solid rgba(17,24,39,0.08)",
          borderRadius: 14,
          padding: 14,
          marginBottom: 4,
          boxShadow: "0 8px 24px rgba(17,24,39,0.06)",
        }}
      >
        <p style={{ fontFamily: FONT_HEADING, fontSize: 13, fontWeight: 800, color: "#111827", marginBottom: 4 }}>
          Gruppförfrågan
        </p>
        <p style={{ fontFamily: FONT_HEADING, fontSize: 16, fontWeight: 800, color: "#111827", marginBottom: 6 }}>
          {event.display_name || event.name}
        </p>
        <div style={{ display: "grid", gap: 4, fontSize: 12, color: "#6b7280", fontFamily: "Inter, sans-serif" }}>
          {event.customer_name && <span>Kund: {event.customer_name}</span>}
          {event.expected_participants && <span>{event.expected_participants} deltagare</span>}
          {resources && <span>{resources}</span>}
        </div>
        {event.partner_notes && (
          <p style={{ marginTop: 10, whiteSpace: "pre-line", fontSize: 12, color: "#4b5563", lineHeight: 1.45, fontFamily: "Inter, sans-serif" }}>
            {String(event.partner_notes).slice(0, 420)}
          </p>
        )}
      </motion.div>
    );
  }

  const playerCount = participantData?.count ?? players.length;
  const isRegistered = success || Boolean(participantData?.current_user_registered);
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
    } catch {
      // Fall back to the normal event checkout page if wallet lookup fails.
    }

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

          {maxP ? (
            <div style={{ marginBottom: 12 }}>
              <ScarcityBadge
                remaining={spotsLeft}
                capacity={maxP}
                style={{ background: "rgba(255,255,255,0.12)", color: "#fff" }}
              />
            </div>
          ) : null}

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
                    key={`${event.id}-${idx}`}
                    title={player.display_name || "Spelare"}
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
                      (player.display_name || "?").charAt(0).toUpperCase()
                    )}
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", fontFamily: "Inter, sans-serif" }}>
                {playerCount} anmälda
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
