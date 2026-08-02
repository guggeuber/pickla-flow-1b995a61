import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, CalendarDays, Check, Loader2, MessageCircle, Minus, Plus, Share2, ShoppingBag, Ticket, UserCheck } from "lucide-react";
import { DateTime } from "luxon";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAccessSnapshot } from "@/hooks/useAccessSnapshot";
import { fetchActivitySessionOverrides, isPublicActivityOverrideHidden, occurrenceOverrideKey } from "@/lib/activitySessionOverrides";
import picklaLogo from "@/assets/pickla-logo.svg";
import { SessionActions, SessionDrawerShell, SessionPeopleRow, SessionPriceBlock } from "@/components/session";
import { formatSek } from "@/lib/activityPricing";
import { getPublicProfileMap, type PublicProfile } from "@/lib/publicProfiles";
import { activityCheckInAvailable, useActivityNow } from "@/lib/activityTiming";
import { canonicalAppUrl } from "@/lib/canonicalOrigin";
import { activitySessionToPresentation } from "@/lib/sessionPresentation";
import {
  activityCommerceDraftScope,
  activityCommerceSelectionKey,
  commerceProductMaxQuantity,
  commerceJourneyId,
  createCommerceCart,
  fetchCommerceCatalog,
  formatCommerceMoney,
  readActivityCommerceSelection,
  resumeCommerceActivityDraft,
  trackCommerceFunnelEvent,
  writeActivityCommerceSelection,
  type CommerceCartItemInput,
} from "@/lib/commerce";
import { purchaseErrorMessage, withPurchaseSessionRecovery } from "@/lib/purchaseSessionRecovery";
import { activitySessionOccurrenceInterval } from "@/lib/activitySessionTime";

const BG = "#fbf7f2";
const TEXT = "#020617";
const MUTED = "#64748b";
const BORDER = "rgba(15,23,42,0.10)";
const MENU_BORDER = "rgba(17,17,17,0.12)";
const FONT_HEADING = "'Space Grotesk', sans-serif";
const PLAYING_HOST_ROLE = "playing_host";
const LEGACY_HOST_COMP = "host_comp";

function safeLocalPath(path: string) {
  return path.startsWith("/") && !path.startsWith("//") ? path : "/today";
}

function isPlayingHostReason(value: unknown) {
  return value === PLAYING_HOST_ROLE || value === LEGACY_HOST_COMP;
}

function publicProgramPath(sessionId: string, date: string | null | undefined, venueSlug: string) {
  const params = new URLSearchParams({
    ...(date ? { date } : {}),
    v: venueSlug,
  });
  return `/p/${encodeURIComponent(sessionId)}${params.toString() ? `?${params.toString()}` : ""}`;
}

function ticketProgramPath(sessionId: string, date: string | null | undefined, venueSlug: string) {
  const path = publicProgramPath(sessionId, date, venueSlug);
  return `${path}${path.includes("?") ? "&" : "?"}ticket=1`;
}

function sessionTypeLabel(type?: string | null) {
  if (type === "open_play") return "Open Play";
  if (type === "group_training") return "Träning";
  return type || "Aktivitet";
}

function hostFirstName(host: any) {
  return String(host?.first_name || host?.display_name || "Värd").trim().split(/\s+/)[0] || "Värd";
}

function hostDisplayName(host: any) {
  return String(host?.display_name || [host?.first_name, host?.last_name].filter(Boolean).join(" ") || hostFirstName(host)).trim();
}

function hostsLabel(hosts: any[]) {
  const names = hosts.map(hostDisplayName).filter(Boolean);
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} och ${names[1]}`;
  if (names.length > 2) return `${names[0]}, ${names[1]} och ${names.length - 2} till`;
  return "";
}

function formatCourtRange(courts: Array<{ name?: string | null; court_number?: number | null }>) {
  const ordered = [...courts].sort((a, b) => {
    const aNumber = Number(a.court_number || 0);
    const bNumber = Number(b.court_number || 0);
    if (aNumber && bNumber) return aNumber - bNumber;
    return String(a.name || "").localeCompare(String(b.name || ""), "sv");
  });
  const numbers = ordered
    .map((court) => Number(court.court_number || 0))
    .filter((number) => Number.isFinite(number) && number > 0);
  if (numbers.length === ordered.length && numbers.length > 0) {
    const contiguous = numbers.every((number, index) => index === 0 || number === numbers[index - 1] + 1);
    if (numbers.length === 1) return `Bana ${numbers[0]}`;
    if (contiguous) return `Bana ${numbers[0]}–${numbers[numbers.length - 1]}`;
    return `Bana ${numbers.join(", ")}`;
  }
  return ordered.map((court) => court.name || "Bana").join(", ");
}

function clampCommerceSelection(
  quantities: Record<string, number>,
  products: Array<{ id: string; max_quantity?: number; resolver_rules?: Record<string, unknown> | null }>,
) {
  const productById = new Map(products.map((product) => [product.id, product]));
  return Object.fromEntries(Object.entries(quantities).flatMap(([productId, value]) => {
    const product = productById.get(productId);
    if (!product) return [];
    const quantity = Math.max(0, Math.min(commerceProductMaxQuantity(product), Math.floor(Number(value) || 0)));
    return quantity > 0 ? [[productId, quantity]] : [];
  }));
}

export default function ProgramSessionPage({ overlayOnly = false }: { overlayOnly?: boolean }) {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const purchaseInFlight = useRef(false);
  const [interestLoading, setInterestLoading] = useState(false);
  const [queueLoading, setQueueLoading] = useState(false);
  const [commerceQuantities, setCommerceQuantities] = useState<Record<string, number>>({});
  const [commercePurchaseKind, setCommercePurchaseKind] = useState<"activity_ticket" | "day_pass">("activity_ticket");
  const [commerceDraftHydrated, setCommerceDraftHydrated] = useState(false);
  const hydratedCommerceScopeRef = useRef("");
  const commerceSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commerceSaveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const commerceDraftDirtyRef = useRef(false);
  const commerceOpenedEventRef = useRef("");
  const latestCommerceQuantitiesRef = useRef<Record<string, number>>({});
  const [optimisticInterest, setOptimisticInterest] = useState<{ count: number; mine: boolean } | null>(null);
  const requestedDate = searchParams.get("date");
  const ticketMode = searchParams.get("ticket") === "1";
  const venueSlug = searchParams.get("v") || "pickla-arena-sthlm";
  const programPath = sessionId ? publicProgramPath(sessionId, requestedDate, venueSlug) : "/today";
  const ticketPath = sessionId ? ticketProgramPath(sessionId, requestedDate, venueSlug) : "/today";
  const todayPath = `/today?v=${encodeURIComponent(venueSlug)}`;
  const routeState = location.state as { activitySession?: any } | null;
  const optimisticSession = routeState?.activitySession || null;

  const { data: directSession, isLoading: sessionLoading } = useQuery({
    queryKey: ["program-session-direct", sessionId],
    enabled: !!sessionId,
    staleTime: 60000,
    queryFn: async () => {
      const { data: row, error: sessionError } = await supabase
        .from("activity_sessions")
        .select("id, name, session_type, session_date, recurrence_days, start_time, end_time, capacity, price_sek, product_key, venue_id, court_ids, access_policy, metadata, early_bird_price_minor, early_bird_slots, scarcity_mode")
        .eq("id", sessionId!)
        .maybeSingle();
      if (sessionError) throw sessionError;
      return row;
    },
  });

  const earlyVenueId = directSession?.venue_id || optimisticSession?.venue_id || null;
  const earlyOccurrenceDate = requestedDate || directSession?.session_date || optimisticSession?.session_date || null;
  const accessSnapshot = useAccessSnapshot({ venueId: earlyVenueId, sessionDate: earlyOccurrenceDate });
  const waitForAccessSnapshot = !!user?.id && !!earlyVenueId && accessSnapshot.isLoading;

  const { data, isLoading: previewLoading, error } = useQuery({
    queryKey: [
      "program-session-entry",
      user?.id || "anon",
      sessionId,
      earlyOccurrenceDate || requestedDate || "date-pending",
      venueSlug,
      accessSnapshot.version,
    ],
    enabled: !!sessionId && !authLoading && !waitForAccessSnapshot,
    staleTime: user?.id ? 0 : 15000,
    queryFn: () => apiGet<any>("api-event-public", "activity-preview", {
      sessionId: sessionId!,
      venueSlug,
      ...(requestedDate ? { date: requestedDate } : {}),
    }),
  });

  const session = useMemo(() => {
    const baseSession = directSession || optimisticSession || null;
    const previewSession = data?.activity_session || null;
    if (!previewSession) return baseSession;
    if (!baseSession) return previewSession;

    return {
      ...baseSession,
      ...previewSession,
      court_ids: Array.isArray(previewSession.court_ids)
        ? previewSession.court_ids
        : Array.isArray(baseSession.court_ids)
          ? baseSession.court_ids
          : [],
      access_policy: previewSession.access_policy ?? baseSession.access_policy,
      metadata: {
        ...(baseSession.metadata || {}),
        ...(previewSession.metadata || {}),
      },
    };
  }, [data?.activity_session, directSession, optimisticSession]);
  const room = data?.room;
  const occurrenceDate = data?.occurrence_date || requestedDate || session?.session_date || null;
  const venueId = session?.venue_id || data?.venue?.id;
  const commerceCatalog = useQuery({
    queryKey: ["commerce-catalog", venueId],
    queryFn: () => fetchCommerceCatalog(venueId!),
    enabled: !!venueId,
    staleTime: 60000,
  });
  const configuredSessionProductKey = String(session?.product_key || "");
  const sessionProductKey = configuredSessionProductKey === "day_access"
    ? session?.session_type === "open_play" ? "open_play_slot" : "session_ticket"
    : configuredSessionProductKey || (session?.session_type === "open_play" ? "open_play_slot" : "session_ticket");
  const commerceParticipationProduct = commerceCatalog.data?.products.find((product) => product.commerce_kind === "participation" && product.product_key === sessionProductKey);
  const commerceDayPassProduct = commerceCatalog.data?.products.find((product) => (
    product.commerce_kind === "participation"
    && (product.product_key === "day_access" || product.product_kind === "day_access")
    && Number(product.base_price_sek || 0) > 0
    && session?.session_type === "open_play"
    && session?.access_policy?.allows_day_access !== false
  ));
  const offeredRentalIds = useMemo(() => new Set(
    (commerceCatalog.data?.relationships || [])
      .filter((relationship) => relationship.source_product_id === commerceParticipationProduct?.id)
      .map((relationship) => relationship.target_product_id),
  ), [commerceCatalog.data?.relationships, commerceParticipationProduct?.id]);
  const commerceExtras = useMemo(() => (
    (commerceCatalog.data?.products || []).filter((product) => (
      product.commerce_kind !== "participation"
      && product.activity_addon_enabled
      && offeredRentalIds.has(product.id)
    ))
  ), [commerceCatalog.data?.products, offeredRentalIds]);
  const commercePilotEnabled = Boolean(commerceParticipationProduct);
  useEffect(() => {
    if (!commercePilotEnabled || !venueId || !sessionId) return;
    const eventKey = `${venueId}:${sessionId}:${occurrenceDate || ""}`;
    if (commerceOpenedEventRef.current === eventKey) return;
    commerceOpenedEventRef.current = eventKey;
    void trackCommerceFunnelEvent({
      eventName: "activity_sheet_opened",
      venueId,
      activitySessionId: sessionId,
    });
  }, [commercePilotEnabled, occurrenceDate, sessionId, venueId]);
  const commerceDraftScope = sessionId && occurrenceDate
    ? activityCommerceDraftScope(sessionId, occurrenceDate)
    : "";
  const commerceSelectionKey = sessionId && occurrenceDate
    ? activityCommerceSelectionKey(sessionId, occurrenceDate)
    : "";
  const commerceDraft = useQuery({
    queryKey: ["commerce-activity-draft", venueId, commerceDraftScope, user?.id],
    enabled: commercePilotEnabled
      && !authLoading
      && !!user?.id
      && !!venueId
      && !!commerceDraftScope,
    retry: false,
    queryFn: () => withPurchaseSessionRecovery(() => (
      resumeCommerceActivityDraft(venueId!, commerceDraftScope)
    )),
  });
  useEffect(() => {
    if (!commerceSelectionKey || !commerceDraftScope) return;
    if (hydratedCommerceScopeRef.current === commerceDraftScope) return;
    if (user?.id && !commerceDraft.isFetched) return;

    const persistedSelection = readActivityCommerceSelection(commerceSelectionKey);
    const persistedPurchaseKind = window.sessionStorage.getItem(`${commerceSelectionKey}:purchase-kind`);
    const draftParticipationProductId = commerceDraft.data?.lines.find((line) => line.commerce_kind === "participation")?.product_id;
    const nextPurchaseKind = commerceDayPassProduct?.id && (
      draftParticipationProductId === commerceDayPassProduct.id
      || (!commerceDraft.data && persistedPurchaseKind === "day_pass")
    ) ? "day_pass" : "activity_ticket";
    const serverSelection = Object.fromEntries((commerceDraft.data?.lines || []).flatMap((line) => (
      line.commerce_kind !== "participation" && line.product_id && Number(line.quantity || 0) > 0
        ? [[line.product_id, Number(line.quantity)]]
        : []
    )));
    const nextSelection = clampCommerceSelection(
      commerceDraft.data ? serverSelection : persistedSelection,
      commerceExtras,
    );
    hydratedCommerceScopeRef.current = commerceDraftScope;
    latestCommerceQuantitiesRef.current = nextSelection;
    setCommerceQuantities(nextSelection);
    setCommercePurchaseKind(nextPurchaseKind);
    writeActivityCommerceSelection(commerceSelectionKey, nextSelection);
    setCommerceDraftHydrated(true);
  }, [commerceDayPassProduct?.id, commerceDraft.data, commerceDraft.isFetched, commerceDraftScope, commerceExtras, commerceSelectionKey, user?.id]);
  const sessionCourtIds = useMemo(() => (
    Array.isArray(session?.court_ids) ? session.court_ids.filter(Boolean) : []
  ), [session?.court_ids]);
  const { data: reservedCourts = [] } = useQuery({
    queryKey: ["program-session-reserved-courts", venueId, sessionCourtIds],
    enabled: !!venueId && sessionCourtIds.length > 0,
    staleTime: 60000,
    queryFn: async () => {
      const { data: rows, error: courtsError } = await supabase
        .from("venue_courts")
        .select("id, name, court_number")
        .eq("venue_id", venueId!)
        .in("id", sessionCourtIds);
      if (courtsError) throw courtsError;
      const courtById = new Map((rows || []).map((court: any) => [court.id, court]));
      return sessionCourtIds.map((id: string) => courtById.get(id)).filter(Boolean);
    },
  });
  const reservedCourtLabel = reservedCourts.length > 0 ? formatCourtRange(reservedCourts as any[]) : "";
  const { data: occurrenceOverrideMap = new Map() } = useQuery({
    queryKey: ["program-session-override", venueId, sessionId, occurrenceDate],
    enabled: !!venueId && !!sessionId && !!occurrenceDate,
    staleTime: 10000,
    queryFn: () => fetchActivitySessionOverrides(venueId!, [sessionId!], occurrenceDate!, occurrenceDate!),
  });
  const occurrenceOverride = sessionId && occurrenceDate
    ? occurrenceOverrideMap.get(occurrenceOverrideKey(sessionId, occurrenceDate))
    : null;
  const occurrenceHidden = isPublicActivityOverrideHidden(occurrenceOverride?.status) || Boolean(error && !data?.activity_session);
  const accessSnapshotForResolvedSession = useAccessSnapshot({ venueId, sessionDate: occurrenceDate });
  const isLoading = (sessionLoading && (previewLoading || waitForAccessSnapshot))
    || (!!venueId && commerceCatalog.isLoading);

  const { data: registrations = [], refetch: refetchRegistrations } = useQuery({
    queryKey: ["program-session-registrations", sessionId, occurrenceDate, user?.id],
    enabled: !!sessionId && !!occurrenceDate,
    staleTime: 10000,
    queryFn: async () => {
      const { data: rows } = await supabase
        .from("session_registrations")
        .select("id, user_id, customer_id, status, source_type, source_id, metadata")
        .eq("activity_session_id", sessionId!)
        .eq("session_date", occurrenceDate);
      return (rows || []).filter((row: any) => row.status !== "cancelled");
    },
  });

  const sessionHosts = useMemo(() => {
    return Array.isArray(session?.hosts) ? session.hosts : [];
  }, [session?.hosts]);
  const hostOrderByCustomerId = useMemo(() => {
    return new Map(sessionHosts.map((host: any, index: number) => [host.customer_id, Number(host.sort_order ?? index)]));
  }, [sessionHosts]);
  const hostCustomerIds = useMemo(() => new Set(sessionHosts.map((host: any) => host.customer_id).filter(Boolean)), [sessionHosts]);
  const nonHostRegistrations = useMemo(
    () => registrations.filter((row: any) => !row.customer_id || !hostCustomerIds.has(row.customer_id)),
    [hostCustomerIds, registrations],
  );
  const participantUserIds = useMemo(() => {
    const orderedRegistrations = [...nonHostRegistrations].sort((a: any, b: any) => {
      const aHost = a.customer_id ? hostOrderByCustomerId.get(a.customer_id) : undefined;
      const bHost = b.customer_id ? hostOrderByCustomerId.get(b.customer_id) : undefined;
      if (aHost != null && bHost != null) return Number(aHost) - Number(bHost);
      if (aHost != null) return -1;
      if (bHost != null) return 1;
      return 0;
    });
    const ids = orderedRegistrations
      .map((row: any) => row.user_id)
      .filter(Boolean);
    return [...new Set(ids)].slice(0, 3);
  }, [hostOrderByCustomerId, nonHostRegistrations]);

  const { data: participantProfiles = [] } = useQuery({
    queryKey: ["program-session-participant-profiles", participantUserIds],
    enabled: participantUserIds.length > 0,
    staleTime: 30000,
    queryFn: async () => {
      const map = await getPublicProfileMap(participantUserIds);
      return participantUserIds
        .map((id) => map.get(id))
        .filter(Boolean) as PublicProfile[];
    },
  });

  const capacity = Number(session?.capacity || 0);
  const registrationCount = Math.max(Number(data?.registrations?.count ?? 0), registrations.length);
  const spotsLeft = capacity ? Math.max(capacity - registrationCount, 0) : null;
  const isFull = spotsLeft === 0;
  const currentRegistration = user?.id ? registrations.find((row: any) => row.user_id === user.id) : null;
  const { data: participationItems = [] } = useQuery({
    queryKey: ["commerce-participation-items", currentRegistration?.id],
    enabled: !!currentRegistration?.id && !!user?.id,
    queryFn: async () => {
      const result = await apiGet<{ items: Array<{ id: string; product_name: string; quantity: number; fulfillment_status: string }> }>("api-commerce", "participation-items", { registrationId: currentRegistration.id });
      return result.items || [];
    },
  });
  const isRegistered = !!currentRegistration;
  const currentRegistrationMetadata = currentRegistration?.metadata && typeof currentRegistration.metadata === "object" ? currentRegistration.metadata : {};
  const userIsPlayingHost = Boolean(
    currentRegistration && (
      isPlayingHostReason(currentRegistration.source_type) ||
      isPlayingHostReason(currentRegistrationMetadata.role) ||
      isPlayingHostReason(currentRegistrationMetadata.entitlement_type) ||
      isPlayingHostReason(currentRegistrationMetadata.pricing_reason) ||
      isPlayingHostReason(currentRegistrationMetadata.compensation_type) ||
      (currentRegistration.customer_id && hostCustomerIds.has(currentRegistration.customer_id))
    )
  );
  const [localCheckedIn, setLocalCheckedIn] = useState(false);
  const [checkinLoading, setCheckinLoading] = useState(false);
  const isCheckedIn = localCheckedIn || currentRegistration?.status === "checked_in";
  const userIsInterested = optimisticInterest?.mine ?? Boolean(data?.interests?.user_is_interested);
  const backendPricing = data?.activityTicketPricing || data?.pricing || null;
  const dayPassPricing = data?.dayPassPricing || null;
  const selectedPricing = commercePurchaseKind === "day_pass" ? dayPassPricing : backendPricing;
  const pricingDebug = backendPricing?.debug || {};
  const pricingScarcity = (pricingDebug.scarcity || data?.scarcity || {}) as any;
  const earlyBird = (pricingScarcity.early_bird || {}) as any;
  const earlyBirdActive = Boolean(earlyBird.active) && Number(earlyBird.remaining || 0) > 0 && Number(earlyBird.price_sek || 0) > 0;
  const earlyBirdLine = commercePurchaseKind === "activity_ticket" && earlyBirdActive
    ? `Tidigt pris ${formatSek(Number(earlyBird.price_sek || 0))} — ${Number(earlyBird.remaining || 0)} kvar just nu`
    : null;
  const capacityScarcityLine = !earlyBirdLine && pricingScarcity.mode === "capacity" && pricingScarcity.capacity_active
    ? `${Number(pricingScarcity.registrations_count || registrationCount || 0)} anmälda · ${Number(pricingScarcity.capacity_remaining || spotsLeft || 0)} platser kvar`
    : null;
  const pricingMode = String(pricingDebug.pricing_mode || session?.metadata?.pricing_mode || "standard");
  const onlinePrice = Number(pricingDebug.online_price_sek ?? session?.metadata?.online_price_sek ?? backendPricing?.baseAmountSek ?? session?.price_sek ?? 0);
  const deskPrice = Number(pricingDebug.desk_price_sek ?? session?.metadata?.desk_price_sek ?? onlinePrice);
  const memberDiscountPercent = Number(pricingDebug.member_discount_percent ?? session?.metadata?.member_discount_percent ?? 0);
  const specialMemberPrice = pricingMode === "member_discount"
    ? Math.max(0, Math.round(onlinePrice * (1 - memberDiscountPercent / 100) * 100) / 100)
    : onlinePrice;
  const pricingPending = !!user?.id && (
    waitForAccessSnapshot ||
    accessSnapshotForResolvedSession.isLoading ||
    previewLoading ||
    !selectedPricing
  );
  const basePrice = Number(selectedPricing?.baseAmountSek ?? (
    commercePurchaseKind === "day_pass" ? commerceDayPassProduct?.base_price_sek : session?.price_sek
  ) ?? 0);
  const effectivePrice = Number(selectedPricing?.effectivePriceSek ?? selectedPricing?.finalAmountSek ?? basePrice);
  const displayedPrice = pricingPending ? "Hämtar pris..." : effectivePrice <= 0 ? 0 : effectivePrice;
  const checkoutLabel = pricingPending
    ? "Hämtar ditt pris..."
    : selectedPricing?.checkoutLabel || formatSek(effectivePrice);
  const pricingIsIncluded = !pricingPending && selectedPricing?.requiresCheckout === false;
  const userHasMembership = Boolean(accessSnapshotForResolvedSession.data?.hasActiveMembership);
  const membershipName = String(
    selectedPricing?.membershipTierName ||
    pricingDebug.membership_tier_name ||
    accessSnapshotForResolvedSession.data?.membershipTierName ||
    ""
  );
  const includedLabel = pricingIsIncluded
    ? isPlayingHostReason(selectedPricing?.pricingReason) || isPlayingHostReason(selectedPricing?.entitlementType)
      ? "Ingår — du är värd"
      : selectedPricing?.accessDecision === "day_access_included"
      ? "Ingår idag"
      : `Ingår i ${membershipName || "medlemskap"}`
    : null;
  const memberContextLine = !userHasMembership && pricingMode === "member_discount" && specialMemberPrice < onlinePrice
    ? <>Medlemmar spelar för {formatSek(specialMemberPrice)} eller fritt</>
    : !userHasMembership && pricingMode === "standard"
      ? <>Medlemmar kan spela billigare eller fritt</>
      : undefined;
  const savedTodaySek = !pricingPending && pricingIsIncluded && basePrice > effectivePrice
    ? Math.round((basePrice - effectivePrice) * 100) / 100
    : 0;
  const commerceExtrasQuantity = commercePurchaseKind === "activity_ticket" ? commerceExtras.reduce((sum, product) => (
    sum + Number(commerceQuantities[product.id] || 0)
  ), 0) : 0;
  const commerceExtrasTotalMinor = commercePurchaseKind === "activity_ticket" ? commerceExtras.reduce((sum, product) => (
    sum + Number(commerceQuantities[product.id] || 0) * Math.round(Number(product.base_price_sek || 0) * 100)
  ), 0) : 0;
  const commerceTotalMinor = Math.max(0, Math.round(effectivePrice * 100)) + commerceExtrasTotalMinor;
  const commerceItemCount = 1 + commerceExtrasQuantity;
  const commerceSavingsMinor = Math.max(0, Math.round((basePrice - effectivePrice) * 100));
  const now = useActivityNow();
  const occurrenceInterval = occurrenceDate && session?.start_time && session?.end_time
    ? activitySessionOccurrenceInterval(occurrenceDate, session.start_time, session.end_time)
    : null;
  const checkinWindow = occurrenceInterval
    ? { opens: occurrenceInterval.start.minus({ minutes: 30 }), closes: occurrenceInterval.end }
    : null;
  const canCheckInNow = Boolean(
    isRegistered &&
    !isCheckedIn &&
    activityCheckInAvailable({
      sessionDate: occurrenceDate,
      startTime: session?.start_time,
      endTime: session?.end_time,
      now,
    })
  );
  const checkinOpensLabel = checkinWindow?.opens?.isValid ? checkinWindow.opens.toFormat("HH:mm") : null;
  const ctaLabel = authLoading
    ? "Hämtar..."
    : isRegistered
    ? isCheckedIn
      ? "✓ Incheckad"
      : canCheckInNow
        ? userIsPlayingHost ? "Checka in som värd" : "Checka in"
        : "Biljett klar"
    : isFull
      ? userIsInterested ? "I kö ✓" : "Ställ mig i kö"
      : pricingPending
        ? "Hämtar ditt pris..."
        : commercePilotEnabled
          ? `Fortsätt · ${formatCommerceMoney(commerceTotalMinor)}`
          : `${user?.id ? (pricingIsIncluded ? "Boka plats" : "Betala och boka plats") : "Logga in och boka plats"} · ${checkoutLabel}`;
  const purchaseMode = !isRegistered && !isFull;

  const buildActivityCartItems = useCallback((quantities: Record<string, number>): CommerceCartItemInput[] => {
    const selectedProduct = commercePurchaseKind === "day_pass" ? commerceDayPassProduct : commerceParticipationProduct;
    if (!selectedProduct || !sessionId || !occurrenceDate) return [];
    const safeQuantities = clampCommerceSelection(quantities, commerceExtras);
    return [
      {
        product_id: selectedProduct.id,
        quantity: 1,
        activity_session_id: sessionId,
        session_date: occurrenceDate,
      },
      ...(commercePurchaseKind === "activity_ticket" ? commerceExtras.flatMap((product) => {
        const quantity = Number(safeQuantities[product.id] || 0);
        return quantity > 0 ? [{
          product_id: product.id,
          quantity,
          parent_product_id: selectedProduct.id,
        }] : [];
      }) : []),
    ];
  }, [commerceDayPassProduct, commerceExtras, commerceParticipationProduct, commercePurchaseKind, occurrenceDate, sessionId]);

  const persistActivityDraft = useCallback((quantities: Record<string, number>) => {
    if (!user?.id || !session?.venue_id || !commerceDraftScope) {
      return Promise.reject(new Error("Logga in för att spara köpet"));
    }
    return withPurchaseSessionRecovery(() => createCommerceCart({
      venueId: session.venue_id,
      source: "activity_drawer",
      draftScope: commerceDraftScope,
      items: buildActivityCartItems(quantities),
    }));
  }, [buildActivityCartItems, commerceDraftScope, session?.venue_id, user?.id]);

  const enqueueActivityDraftSave = useCallback((quantities: Record<string, number>) => {
    const save = () => persistActivityDraft(quantities);
    const queued = commerceSaveQueueRef.current.then(save, save);
    commerceSaveQueueRef.current = queued.catch(() => undefined);
    return queued;
  }, [persistActivityDraft]);

  const flushActivityDraft = useCallback(async () => {
    if (commerceSaveTimerRef.current) {
      clearTimeout(commerceSaveTimerRef.current);
      commerceSaveTimerRef.current = null;
    }
    if (commerceDraftDirtyRef.current && user?.id) {
      commerceDraftDirtyRef.current = false;
      await enqueueActivityDraftSave({ ...latestCommerceQuantitiesRef.current });
    } else {
      await commerceSaveQueueRef.current;
    }
  }, [enqueueActivityDraftSave, user?.id]);

  useEffect(() => {
    if (
      !commerceDraftHydrated
      || !commerceDraftDirtyRef.current
      || !user?.id
      || !commercePilotEnabled
      || !commerceDraftScope
    ) return;
    if (commerceSaveTimerRef.current) clearTimeout(commerceSaveTimerRef.current);
    const snapshot = { ...commerceQuantities };
    commerceSaveTimerRef.current = setTimeout(() => {
      commerceSaveTimerRef.current = null;
      commerceDraftDirtyRef.current = false;
      void enqueueActivityDraftSave(snapshot).catch(() => {
        commerceDraftDirtyRef.current = true;
      });
    }, 300);
    return () => {
      if (commerceSaveTimerRef.current) {
        clearTimeout(commerceSaveTimerRef.current);
        commerceSaveTimerRef.current = null;
      }
    };
  }, [commerceDraftHydrated, commerceDraftScope, commercePilotEnabled, commercePurchaseKind, commerceQuantities, enqueueActivityDraftSave, user?.id]);

  const sessionPresentation = session
    ? activitySessionToPresentation({
        id: session.id,
        typeLabel: sessionTypeLabel(session.session_type),
        title: session.name,
        sessionDate: occurrenceDate || DateTime.now().setZone("Europe/Stockholm").toISODate()!,
        startTime: String(session.start_time || "").slice(0, 5),
        endTime: String(session.end_time || "").slice(0, 5),
        resourceNames: reservedCourtLabel ? [reservedCourtLabel] : [],
        host: sessionHosts.length
          ? {
              firstName: hostFirstName(sessionHosts[0]),
              displayName: hostsLabel(sessionHosts),
              avatarUrl: sessionHosts[0]?.avatar_url ?? null,
              count: sessionHosts.length,
              avatars: sessionHosts.map((host) => ({
                id: host.customer_id || null,
                displayName: hostDisplayName(host),
                avatarUrl: host.avatar_url || null,
              })),
            }
          : null,
        people: participantProfiles,
        committedCount: registrationCount,
        capacity,
        placesLeft: spotsLeft,
        pricing: pricingIsIncluded
          ? { kind: "included", label: includedLabel, amountSek: effectivePrice }
          : pricingPending
            ? { kind: "pending", label: "Hämtar pris...", contextLabel: "Vi kontrollerar medlemskap och dagsaccess." }
            : { kind: "amount", amountSek: displayedPrice },
        entitlementLabel: includedLabel,
        primaryAction: { key: "primary", label: ctaLabel },
        secondaryActions: [],
        route: publicProgramPath(session.id, occurrenceDate, venueSlug),
        now,
      })
    : null;

  const priceContextLine = !userHasMembership && memberContextLine ? (
    <details className="[&:not([open])_.price-details]:hidden">
      <summary className="cursor-pointer select-none list-none text-neutral-700 underline underline-offset-2">
        {memberContextLine} · Se detaljer
      </summary>
      <div className="price-details mt-3 grid gap-1.5 text-[12px] font-semibold text-neutral-500">
        <div className="flex justify-between gap-3">
          <span>Online</span>
          <span>{formatSek(onlinePrice || basePrice)}</span>
        </div>
        {deskPrice > onlinePrice ? (
          <div className="flex justify-between gap-3">
            <span>På plats</span>
            <span>{formatSek(deskPrice)}</span>
          </div>
        ) : null}
        {pricingMode === "member_discount" && specialMemberPrice < onlinePrice ? (
          <div className="flex justify-between gap-3">
            <span>Medlem</span>
            <span>{formatSek(specialMemberPrice)}</span>
          </div>
        ) : null}
        {pricingMode === "standard" ? (
          <p className="pt-1 text-neutral-400">
            Medlemspris eller inkludering beror på aktivt medlemskap.
          </p>
        ) : null}
      </div>
    </details>
  ) : undefined;

  const timeLabel = useMemo(() => {
    if (!session) return "";
    const start = session.start_time ? String(session.start_time).slice(0, 5) : "";
    const end = session.end_time ? String(session.end_time).slice(0, 5) : "";
    return [start, end].filter(Boolean).join("–");
  }, [session]);

  const dateLabel = occurrenceDate
    ? DateTime.fromISO(occurrenceDate, { zone: "Europe/Stockholm" }).toRelativeCalendar({ locale: "sv" }) || occurrenceDate
    : "";

  const openChat = () => {
    if (!room?.id) {
      toast.info("Chatten laddar strax");
      return;
    }
    navigate(`/chat/${room.id}?v=${encodeURIComponent(venueSlug)}`);
  };

  const announceJoin = async () => {
    if (!room?.id || !user?.id) return;
    const { data: profile } = await supabase
      .from("player_profiles")
      .select("display_name")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    const name = profile?.display_name || user.email?.split("@")[0] || "En spelare";
    await supabase.from("chat_messages").insert({
      room_id: room.id,
      user_id: user.id,
      message_type: "bot",
      content: `${name} kommer`,
      metadata: {
        channel: "activity_registration",
        activity_session_id: sessionId,
        session_date: occurrenceDate,
      },
    });
  };

  const changeCommerceQuantity = (productId: string, delta: number) => {
    setCommerceQuantities((current) => {
      const product = commerceExtras.find((candidate) => candidate.id === productId);
      const maximum = product ? commerceProductMaxQuantity(product) : 1;
      const nextQuantity = Math.max(0, Math.min(maximum, Number(current[productId] || 0) + delta));
      const next = { ...current };
      if (nextQuantity > 0) next[productId] = nextQuantity;
      else delete next[productId];
      latestCommerceQuantitiesRef.current = next;
      commerceDraftDirtyRef.current = true;
      if (commerceSelectionKey) writeActivityCommerceSelection(commerceSelectionKey, next);
      return next;
    });
  };

  const selectCommercePurchaseKind = (kind: "activity_ticket" | "day_pass") => {
    if (kind === "day_pass" && !commerceDayPassProduct) return;
    setCommercePurchaseKind(kind);
    commerceDraftDirtyRef.current = true;
    if (commerceSelectionKey) window.sessionStorage.setItem(`${commerceSelectionKey}:purchase-kind`, kind);
  };

  const startSignup = async () => {
    if (authLoading || purchaseInFlight.current) return;
    if (isFull) {
      await toggleInterest("primary");
      return;
    }
    if (occurrenceHidden) {
      toast.error("Aktiviteten är inte tillgänglig för anmälan");
      return;
    }
    if (isRegistered || !session || !occurrenceDate) return;
    if (!selectedPricing || pricingPending) {
      toast.info("Hämtar ditt pris...");
      return;
    }
    if (loading) return;
    purchaseInFlight.current = true;
    setLoading(true);
    try {
      if (commercePilotEnabled && commerceParticipationProduct) {
        if (!user?.id) {
          void trackCommerceFunnelEvent({
            eventName: "logged_out_cta_clicked",
            venueId: session.venue_id,
            activitySessionId: sessionId!,
          });
        }
        if (user?.id) await flushActivityDraft();
        const cartInput = {
          venueId: session.venue_id,
          source: "activity_drawer",
          ...(user?.id ? { draftScope: commerceDraftScope } : {}),
          items: buildActivityCartItems(latestCommerceQuantitiesRef.current),
          journeyId: commerceJourneyId(),
        };
        const cart = user?.id
          ? await withPurchaseSessionRecovery(() => createCommerceCart(cartInput))
          : await createCommerceCart(cartInput, { auth: "omit" });
        if (!cart.cart_token) throw new Error("Varukorgen kunde inte skapas");
        navigate(`/cart?token=${encodeURIComponent(cart.cart_token)}`);
        return;
      }
      if (!user?.id) {
        navigate(`/auth?redirect=${encodeURIComponent(safeLocalPath(programPath))}`);
        return;
      }
      const result = await withPurchaseSessionRecovery(() => apiPost("api-bookings", "create-checkout", {
        product_type: "activity_ticket",
        amount_sek: backendPricing.effectivePriceSek ?? backendPricing.finalAmountSek ?? 0,
        venue_id: session.venue_id,
          metadata: {
            date: occurrenceDate,
            activity_session_id: sessionId,
            chat_room_id: room?.id || "",
            session_name: session.name,
            session_type: session.session_type || "open_play",
            product_key: backendPricing?.productKey || session.product_key || "",
            preview_effective_amount_sek: String(backendPricing.effectivePriceSek ?? backendPricing.finalAmountSek ?? ""),
            pricing_reason: backendPricing.pricingReason || "",
            user_id: user.id,
            slug: venueSlug,
          redirect_path: safeLocalPath(ticketPath),
          success_path: `/booking/confirmed?type=session_ticket&next=${encodeURIComponent(safeLocalPath(ticketPath))}`,
        },
      }));
      if (result.free) {
        await announceJoin();
        queryClient.invalidateQueries({ queryKey: ["access-snapshot"] });
        queryClient.invalidateQueries({ queryKey: ["program-session-entry"] });
        queryClient.invalidateQueries({ queryKey: ["program-session-registrations"] });
        await refetchRegistrations();
        toast.success("Biljetten är klar");
        navigate(safeLocalPath(ticketPath), { replace: true });
        return;
      }
      if (!result.url) throw new Error("Kunde inte starta betalning");
      window.location.href = result.url;
    } catch (err: unknown) {
      toast.error(purchaseErrorMessage(err, "Kunde inte starta anmälan"));
    } finally {
      purchaseInFlight.current = false;
      setLoading(false);
    }
  };

  const checkInTicket = async () => {
    if (!venueId || !currentRegistration?.id || !canCheckInNow || checkinLoading) return;
    setCheckinLoading(true);
    try {
      await apiPost("api-checkins", "self", {
        venue_id: venueId,
        venue_slug: venueSlug,
        entry_type: "session_ticket",
        entitlement_id: currentRegistration.id,
      });
      setLocalCheckedIn(true);
      await refetchRegistrations();
      queryClient.invalidateQueries({ queryKey: ["access-snapshot"] });
      toast.success("Du är incheckad");
    } catch (err: any) {
      toast.error(err.message || "Kunde inte checka in");
    } finally {
      setCheckinLoading(false);
    }
  };

  const toggleInterest = async (source: "secondary" | "primary" = "secondary") => {
    if (!session || !occurrenceDate) return;
    if (!user?.id) {
      navigate(`/auth?redirect=${encodeURIComponent(safeLocalPath(programPath))}`);
      return;
    }
    if (interestLoading || queueLoading) return;
    if (source === "primary") setQueueLoading(true);
    else setInterestLoading(true);
    try {
      const result = await apiPost<any>("api-event-public", "activity-interest", {
        sessionId,
        date: occurrenceDate,
        venueSlug,
      });
      setOptimisticInterest({
        count: Number(result.interested_count || 0),
        mine: Boolean(result.user_is_interested),
      });
      toast.success(result.user_is_interested ? "Du är markerad som intresserad" : "Intresse borttaget");
      queryClient.invalidateQueries({ queryKey: ["program-session-entry"] });
    } catch (err: any) {
      toast.error(err.message || "Kunde inte uppdatera intresse");
    } finally {
      if (source === "primary") setQueueLoading(false);
      else setInterestLoading(false);
    }
  };

  const shareActivity = async () => {
    if (!session || !occurrenceDate) return;
    const sharePath = publicProgramPath(session.id, occurrenceDate, venueSlug);
    const shareUrl = canonicalAppUrl(sharePath);
    const shareDate = DateTime.fromISO(occurrenceDate, { zone: "Europe/Stockholm" })
      .setLocale("sv")
      .toFormat("ccc d MMM");
    const shareText = `${session.name} · ${shareDate} ${timeLabel}\nBoka plats på Pickla`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: session.name,
          text: shareText,
          url: shareUrl,
        });
        return;
      }
      await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
      toast.success("Länk kopierad");
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
        toast.success("Länk kopierad");
      } catch {
        toast.error("Kunde inte dela länken");
      }
    }
  };

  const closeDrawer = (open: boolean) => {
    if (!open) {
      const close = () => {
        if (overlayOnly) navigate(-1);
        else navigate(todayPath);
      };
      if (commerceDraftDirtyRef.current && user?.id) {
        void flushActivityDraft().catch(() => undefined).finally(close);
      } else {
        close();
      }
    }
  };

  return (
    <div
      className={overlayOnly ? "contents" : "min-h-[100dvh] px-5 pb-8 pt-[calc(env(safe-area-inset-top,0px)+22px)]"}
      style={{ background: BG, color: TEXT }}
    >
      {!overlayOnly && (
      <>
      <div className="mx-auto flex max-w-md items-center justify-between">
        <button
          type="button"
          onClick={() => navigate(todayPath)}
          className="grid h-14 w-14 place-items-center rounded-full bg-white shadow-sm"
          style={{ border: `1px solid ${BORDER}` }}
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <img src={picklaLogo} alt="Pickla" className="h-8 w-auto" />
        <button
          type="button"
          onClick={openChat}
          disabled={!room?.id}
          className="grid h-14 w-14 place-items-center rounded-full bg-white shadow-sm disabled:opacity-40"
          style={{ border: `1px solid ${BORDER}` }}
        >
          <MessageCircle className="h-6 w-6" />
        </button>
      </div>

      <main className="mx-auto mt-12 max-w-md">
        {isLoading || (!session && !error && !occurrenceHidden) ? (
          <div className="grid justify-items-center gap-4 rounded-[28px] bg-white p-10 text-center shadow-sm" style={{ border: `1px solid ${BORDER}` }}>
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            <p className="text-lg font-black" style={{ fontFamily: FONT_HEADING }}>Hämtar aktiviteten</p>
          </div>
        ) : occurrenceHidden || (error && !session) ? (
          <div className="grid gap-4 rounded-[28px] bg-white p-7 text-center shadow-sm" style={{ border: `1px solid ${BORDER}` }}>
            <p className="text-xl font-black" style={{ fontFamily: FONT_HEADING }}>Aktiviteten hittades inte</p>
            <p className="text-sm font-bold" style={{ color: MUTED }}>Gå tillbaka till Pickla Idag och välj ett annat pass.</p>
            <button type="button" onClick={() => navigate(todayPath)} className="rounded-full bg-slate-950 px-5 py-3 text-sm font-black text-white">
              Till Pickla Idag
            </button>
          </div>
        ) : (
          <section className="pb-48">
            <p className="mb-4 text-[13px] font-black uppercase tracking-[0.24em]" style={{ color: MUTED }}>
              {sessionTypeLabel(session.session_type)}
            </p>
            <h1 className="text-[58px] font-black leading-[0.92] tracking-tight sm:text-[64px]" style={{ fontFamily: FONT_HEADING }}>
              {session.name}
            </h1>
            <div className="mt-8 flex items-center gap-3 text-[20px] font-black">
              <CalendarDays className="h-6 w-6" />
              <span>{dateLabel} · {timeLabel}</span>
            </div>
            <button
              type="button"
              onClick={openChat}
              className="mt-10 flex w-full items-center gap-3 rounded-2xl bg-white/70 p-3 text-left shadow-sm disabled:opacity-50"
              disabled={!room?.id}
              style={{ border: `1px solid ${BORDER}` }}
            >
              <span className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: "#eef2ff" }}>
                <MessageCircle className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold" style={{ fontFamily: FONT_HEADING }}>Öppna chatt</span>
                <span className="block truncate text-xs font-medium" style={{ color: MUTED }}>
                  Frågor och sena platser
                </span>
              </span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </section>
        )}
      </main>
      </>
      )}

      {session && !occurrenceHidden && sessionPresentation && !commerceCatalog.isLoading && (
        <SessionDrawerShell
          open
          onOpenChange={closeDrawer}
          presentation={sessionPresentation}
          footer={
            <div className="space-y-2">
              <SessionActions
                primary={{
                  key: "primary",
                  label: ctaLabel,
                  onClick: isRegistered ? checkInTicket : startSignup,
                  disabled: authLoading || loading || queueLoading || checkinLoading || pricingPending || (isRegistered && !canCheckInNow),
                  icon: loading || queueLoading || checkinLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : isRegistered ? (
                    isCheckedIn ? <UserCheck className="h-5 w-5" /> : <Check className="h-5 w-5" />
                  ) : null,
                }}
                secondary={isRegistered ? [{
                    key: "chat",
                    label: "Chatt",
                    onClick: openChat,
                    disabled: !room?.id,
                    icon: previewLoading && !room?.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />,
                  }] : []}
              />
              {!isRegistered ? (
                <div className="grid grid-cols-2 gap-2 pt-1" aria-label="Aktivitetsalternativ">
                  <button type="button" onClick={openChat} disabled={!room?.id} className="flex h-10 items-center justify-center gap-2 rounded-xl text-[13px] font-semibold text-neutral-500 disabled:opacity-40">
                    {previewLoading && !room?.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
                    Chatt
                  </button>
                  <button type="button" onClick={shareActivity} className="flex h-10 items-center justify-center gap-2 rounded-xl text-[13px] font-semibold text-neutral-500">
                    <Share2 className="h-4 w-4" />
                    Dela
                  </button>
                </div>
              ) : null}
              {!isRegistered && !user?.id && commercePilotEnabled ? (
                <button
                  type="button"
                  onClick={() => navigate(`/auth?redirect=${encodeURIComponent(safeLocalPath(programPath))}`)}
                  className="w-full py-1 text-center text-[12px] font-semibold text-neutral-500 underline underline-offset-2"
                >
                  Medlem? Logga in för ditt pris
                </button>
              ) : null}
              {isRegistered ? (
                <button
                  type="button"
                  onClick={shareActivity}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-100 px-4 text-[14px] font-semibold text-slate-950"
                  style={{ fontFamily: FONT_HEADING }}
                >
                  <Share2 className="h-4 w-4" />
                  Bjud in en vän
                </button>
              ) : null}
            </div>
          }
        >
          <SessionPeopleRow presentation={sessionPresentation} variant="drawer" showInvitation={!purchaseMode} />

          {isRegistered ? (
            <div className="rounded-[22px] border border-black/10 bg-white px-4 py-3">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-slate-950 text-white">
                  {isCheckedIn ? <UserCheck className="h-5 w-5" /> : <Ticket className="h-5 w-5" />}
                </span>
                <div className="min-w-0">
                  <p className="text-[15px] font-black text-slate-950" style={{ fontFamily: FONT_HEADING }}>
                    {isCheckedIn ? "Du är incheckad" : "Din biljett är klar"}
                  </p>
                  <p className="mt-1 text-[12px] font-semibold text-slate-500">
                    {isCheckedIn
                      ? "Du är redo att spela."
                      : canCheckInNow
                        ? "Nästa steg: checka in när du kommer."
                        : checkinOpensLabel
                          ? `Nästa steg: check-in öppnar ${checkinOpensLabel}.`
                          : "Nästa steg: check-in öppnar innan passet."}
                  </p>
                </div>
              </div>
            </div>
          ) : ticketMode ? (
            <div className="rounded-[22px] bg-[#f8fafc] px-4 py-3" style={{ border: `1px solid ${MENU_BORDER}` }}>
              <p className="text-[13px] font-semibold text-neutral-600">
                Logga in så visar vi din biljett här direkt efter bokning.
              </p>
            </div>
          ) : null}

          {isRegistered && participationItems.length > 0 ? (
            <div className="rounded-[22px] border border-black/10 bg-white px-4 py-3">
              {participationItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 py-1 text-[13px] font-bold text-slate-950">
                  <span>{item.product_name} {item.quantity > 1 ? `· ${item.quantity} st` : ""} ✓</span>
                  <span className="text-[11px] text-slate-500">{item.fulfillment_status === "collected" ? "Uthämtad" : "Hämtas ut i desken"}</span>
                </div>
              ))}
            </div>
          ) : null}

          {!isRegistered && !pricingPending && (earlyBirdLine || capacityScarcityLine) ? (
            <p className="px-2 py-1 text-center text-[13px] font-black text-slate-700" style={{ fontFamily: FONT_HEADING }}>
              {earlyBirdLine || capacityScarcityLine}
            </p>
          ) : null}

          {!isRegistered && commercePilotEnabled && commerceDayPassProduct && dayPassPricing ? (
            <section data-testid="commerce-purchase-options" className="border-y border-black/10 py-1">
              <button
                type="button"
                data-testid="commerce-option-activity-ticket"
                aria-pressed={commercePurchaseKind === "activity_ticket"}
                onClick={() => selectCommercePurchaseKind("activity_ticket")}
                className="flex w-full items-start justify-between gap-4 border-b border-black/10 py-4 text-left"
              >
                <span>
                  <span className="block text-[14px] font-black text-slate-950">Personlig plats</span>
                  <span className="mt-1 block text-[12px] font-semibold text-slate-500">Gäller det här passet.</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-[14px] font-black">
                  {backendPricing?.checkoutLabel || formatSek(Number(backendPricing?.finalAmountSek || 0))}
                  <span className={`grid h-5 w-5 place-items-center rounded-full border ${commercePurchaseKind === "activity_ticket" ? "border-slate-950 bg-slate-950 text-white" : "border-black/20 text-transparent"}`}><Check className="h-3 w-3" /></span>
                </span>
              </button>
              <button
                type="button"
                data-testid="commerce-option-day-pass"
                aria-pressed={commercePurchaseKind === "day_pass"}
                onClick={() => selectCommercePurchaseKind("day_pass")}
                className="flex w-full items-start justify-between gap-4 py-4 text-left"
              >
                <span>
                  <span className="block text-[14px] font-black text-slate-950">Spela hela dagen</span>
                  <span className="mt-1 block text-[12px] font-semibold text-slate-500">{commerceDayPassProduct.name} · Gäller inkluderade Open Play-pass på Pickla denna dag.</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-[14px] font-black">
                  {dayPassPricing.checkoutLabel || formatSek(Number(dayPassPricing.finalAmountSek || commerceDayPassProduct.base_price_sek || 0))}
                  <span className={`grid h-5 w-5 place-items-center rounded-full border ${commercePurchaseKind === "day_pass" ? "border-slate-950 bg-slate-950 text-white" : "border-black/20 text-transparent"}`}><Check className="h-3 w-3" /></span>
                </span>
              </button>
            </section>
          ) : null}

          <SessionPriceBlock presentation={sessionPresentation} variant="drawer" contextLine={commercePurchaseKind === "activity_ticket" ? priceContextLine : undefined} neutral={commercePilotEnabled} />

          {!isRegistered && commercePurchaseKind === "activity_ticket" && commercePilotEnabled && commerceCatalog.isSuccess && commerceExtras.length > 0 ? (
            <section data-testid="commerce-addons" className="rounded-[22px] bg-[#f8fafc] px-4 py-4" style={{ border: `1px solid ${MENU_BORDER}` }}>
              <div className="mb-3 flex items-center gap-2"><ShoppingBag className="h-4 w-4 shrink-0" /><h3 className="text-[13px] font-black">Lägg till i samma köp</h3></div>
              <div className="grid gap-3">
                {commerceExtras.map((product) => {
                  const quantity = Number(commerceQuantities[product.id] || 0);
                  const maximum = commerceProductMaxQuantity(product);
                  return (
                    <article key={product.id} className="rounded-2xl bg-white px-3 py-3 text-[13px]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="break-words font-black">{product.name}</h4>
                          <p className="mt-0.5 text-[11px] font-semibold text-neutral-500">Hämtas ut i desken</p>
                        </div>
                        <p className="shrink-0 font-black">{formatCommerceMoney(product.base_price_sek * 100)}</p>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <span className="text-[11px] font-semibold text-neutral-500">Antal</span>
                        <div className="flex shrink-0 items-center gap-2" aria-label={`Antal ${product.name}`}>
                          <button type="button" onClick={() => changeCommerceQuantity(product.id, -1)} disabled={quantity === 0} className="grid h-9 w-9 place-items-center rounded-full border border-black/10 bg-white disabled:opacity-35" aria-label={`Minska ${product.name}`}><Minus className="h-4 w-4" /></button>
                          <span className="w-6 text-center text-[15px] font-black tabular-nums" aria-live="polite">{quantity}</span>
                          <button type="button" onClick={() => changeCommerceQuantity(product.id, 1)} disabled={quantity >= maximum} className="grid h-9 w-9 place-items-center rounded-full bg-slate-950 text-white disabled:opacity-35" aria-label={`Öka ${product.name}`}><Plus className="h-4 w-4" /></button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          {!isRegistered && commercePilotEnabled && !pricingPending ? (
            <section data-testid="commerce-live-total" className="rounded-[22px] bg-white px-4 py-4" style={{ border: `1px solid ${MENU_BORDER}` }} aria-live="polite">
              <div className="flex items-end justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-neutral-500">Totalt · {commerceItemCount} {commerceItemCount === 1 ? "artikel" : "artiklar"}</p>
                  {commerceSavingsMinor > 0 ? <p className="mt-1 text-[12px] font-bold text-slate-700">Du sparar {formatCommerceMoney(commerceSavingsMinor)}</p> : null}
                </div>
                <p className="shrink-0 text-[26px] font-black tracking-tight">{formatCommerceMoney(commerceTotalMinor)}</p>
              </div>
              {pricingIsIncluded ? <p className="mt-2 text-[12px] font-bold text-slate-700">Aktiviteten {includedLabel?.toLowerCase() || "ingår i medlemskap"}</p> : null}
            </section>
          ) : null}

          {isRegistered && savedTodaySek > 0 ? (
          <div className="rounded-[22px] bg-[#f8fafc] px-4 py-3" style={{ border: `1px solid ${MENU_BORDER}` }}>
            <p className="text-[12px] font-semibold text-neutral-500">
              Du sparade {formatSek(savedTodaySek)} idag.
            </p>
          </div>
          ) : null}
        </SessionDrawerShell>
      )}
    </div>
  );
}
