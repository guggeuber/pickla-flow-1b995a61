import { useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AlertTriangle, CalendarDays, Edit3, Loader2, Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { formatSek } from "@/lib/activityPricing";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";

const DAYS = [
  { key: 1, label: "Mån" },
  { key: 2, label: "Tis" },
  { key: 3, label: "Ons" },
  { key: 4, label: "Tor" },
  { key: 5, label: "Fre" },
  { key: 6, label: "Lör" },
  { key: 0, label: "Sön" },
];

const SESSION_TYPES = [
  { key: "open_play", label: "Open Play" },
  { key: "group_training", label: "Gruppträning" },
  { key: "pickla_open", label: "Pickla Open" },
  { key: "club_night", label: "Klubbkväll" },
  { key: "event", label: "Event" },
];

type SoldAs = "activity_ticket" | "day_pass" | "included_only";

interface MembershipTier {
  id: string;
  name: string;
  is_active: boolean;
}

interface TierPricing {
  tier_id: string;
  product_type: string;
  fixed_price: number | null;
  discount_percent: number | null;
}

type HostOption = {
  id?: string;
  customer_id?: string | null;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  identity_title?: string | null;
  email?: string | null;
  phone?: string | null;
};

type VenueCourtOption = {
  id: string;
  name: string;
  court_number?: number | null;
  sport_type?: string | null;
  is_available?: boolean | null;
};

const SOLD_AS_OPTIONS: { key: SoldAs; label: string; helper: string }[] = [
  {
    key: "activity_ticket",
    label: "Aktivitetsbiljett",
    helper: "Ett pass. Skapar inte heldagstillgång.",
  },
  {
    key: "day_pass",
    label: "Dagsmedlemskap",
    helper: "Säljer heldagstillgång för datumet.",
  },
  {
    key: "included_only",
    label: "Ingår endast",
    helper: "Ingen separat checkout. Kräver medlemskap/entitlement.",
  },
];

const SERIES_TYPES = [
  { key: "program", label: "Program" },
  { key: "club_night", label: "Klubbkväll" },
  { key: "training", label: "Träning" },
  { key: "competition", label: "Tävling" },
  { key: "course", label: "Kurs/serie" },
];

const inputStyle = {
  background: "hsl(var(--surface-2))",
  border: "1px solid hsl(var(--border))",
};

const baseInputClass = "rounded-xl px-3 py-2.5 text-xs outline-none";

const sortDays = (days: number[]) => {
  const order = [1, 2, 3, 4, 5, 6, 0];
  return [...days].sort((a, b) => order.indexOf(a) - order.indexOf(b));
};

const productKeyForActivityTicket = (sessionType: string) => {
  if (sessionType === "group_training") return "group_training";
  return "open_play_slot";
};

const hostOptionId = (host: HostOption) => host.customer_id || host.id || "";
const hostOptionName = (host: HostOption) =>
  host.display_name ||
  host.full_name ||
  [host.first_name, host.last_name].filter(Boolean).join(" ") ||
  host.identity_title ||
  host.email ||
  "Kund";

const courtLabel = (court: VenueCourtOption) => court.name || `Bana ${court.court_number || ""}`.trim() || "Bana";

const selectedCourtNames = (courtIds: string[] | null | undefined, courts: VenueCourtOption[]) => {
  const ids = Array.isArray(courtIds) ? courtIds : [];
  if (!ids.length) return "Inga banor reserverade";
  const courtById = new Map(courts.map((court) => [court.id, court]));
  return ids.map((id) => {
    const court = courtById.get(id);
    return court ? courtLabel(court) : "Bana";
  }).join(", ");
};

const soldAsFromSession = (session: any): SoldAs => {
  if (!session?.product_key) return "included_only";
  if (session.product_key === "day_access") return "day_pass";
  return "activity_ticket";
};

const soldAsFromProduct = (product: any, productKey?: string | null): SoldAs => {
  if (!productKey) return "included_only";
  if (productKey === "day_access" || product?.product_kind === "day_access") return "day_pass";
  return "activity_ticket";
};

const isOpenPlayLike = (sessionType: string) => ["open_play", "club_night", "pickla_open"].includes(sessionType);

const numericPrice = (value: number | string | null | undefined, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100) / 100) : fallback;
};

const optionalPrice = (value: number | string | null | undefined) => {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100) / 100) : null;
};

const sessionMetadata = (session: any) => {
  if (!session?.metadata || typeof session.metadata !== "object" || Array.isArray(session.metadata)) return {};
  return session.metadata;
};

const sessionOnlinePrice = (session: any) => {
  const metadata = sessionMetadata(session);
  return numericPrice(metadata.online_price_sek ?? session?.price_sek ?? 0);
};

const sessionDeskPrice = (session: any) => {
  const metadata = sessionMetadata(session);
  const online = sessionOnlinePrice(session);
  return numericPrice(metadata.desk_price_sek ?? online, online);
};

const sessionEarlyBirdPriceSek = (session: any) => {
  const metadata = sessionMetadata(session);
  const minor = Number(session?.early_bird_price_minor ?? metadata.early_bird_price_minor ?? 0);
  return minor > 0 ? numericPrice(minor / 100) : "";
};

const sessionEarlyBirdSlots = (session: any) => {
  const metadata = sessionMetadata(session);
  return session?.early_bird_slots ?? metadata.early_bird_slots ?? "";
};

const sessionScarcityMode = (session: any) => {
  const metadata = sessionMetadata(session);
  const mode = String(session?.scarcity_mode ?? metadata.scarcity_mode ?? "none");
  return mode === "early_bird" || mode === "capacity" ? mode : "none";
};

const priceSekToMinor = (value: number | string | null | undefined) => {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : null;
};

const positiveSlots = (value: number | string | null | undefined) => {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
};

const buildPricingMetadata = ({
  existingMetadata = {},
  onlinePrice,
  deskPrice,
  corporatePrice,
  promoPrice,
}: {
  existingMetadata?: Record<string, any>;
  onlinePrice: number;
  deskPrice: number;
  corporatePrice?: number | string | null;
  promoPrice?: number | string | null;
}) => {
  const metadata: Record<string, any> = {
    ...existingMetadata,
    online_price_sek: onlinePrice,
    desk_price_sek: deskPrice,
    pricing_channel_mode: deskPrice > onlinePrice ? "online_discount" : "standard",
  };
  const corporate = optionalPrice(corporatePrice);
  const promo = optionalPrice(promoPrice);
  if (corporate == null) delete metadata.corporate_price_sek;
  else metadata.corporate_price_sek = corporate;
  if (promo == null) delete metadata.promo_price_sek;
  else metadata.promo_price_sek = promo;
  return metadata;
};

const sessionScopeLabel = (session: any) => {
  if (session?.activity_series?.name) return "Kopplat till serie";
  if (session?.session_date) return "Enskilt pass";
  return "Återkommande schema";
};

const accessSummary = (includedInDayPass: boolean, includedInUnlimited: boolean) => {
  const parts = [];
  if (includedInDayPass) parts.push("Dagspass");
  if (includedInUnlimited) parts.push("Unlimited/Play+");
  return parts.length ? parts.join(" + ") : "Ingen inkluderad access";
};

const buildSessionConfig = ({
  soldAs,
  sessionType,
  includedInDayPass,
  includedInUnlimited,
}: {
  soldAs: SoldAs;
  sessionType: string;
  includedInDayPass: boolean;
  includedInUnlimited: boolean;
}) => {
  const productKey = soldAs === "day_pass"
    ? "day_access"
    : soldAs === "included_only"
    ? null
    : productKeyForActivityTicket(sessionType);

  return {
    product_key: productKey,
    access_policy: {
      allows_day_access: soldAs === "day_pass" ? true : includedInDayPass,
      includes_day_access: soldAs === "day_pass",
      member_benefit_key: includedInUnlimited ? "open_play_unlimited" : null,
      sold_as: soldAs,
    },
  };
};

const buildProductSessionConfig = ({
  product,
  productKey,
  sessionType,
  includedInDayPass,
  includedInUnlimited,
}: {
  product: any;
  productKey: string | null;
  sessionType: string;
  includedInDayPass: boolean;
  includedInUnlimited: boolean;
}) => {
  const soldAs = soldAsFromProduct(product, productKey);
  const config = buildSessionConfig({ soldAs, sessionType, includedInDayPass, includedInUnlimited });
  return {
    soldAs,
    product_key: soldAs === "included_only" ? null : productKey || config.product_key,
    access_policy: {
      ...config.access_policy,
      product_kind: product?.product_kind || null,
      product_name: product?.name || null,
    },
  };
};

const draftWarnings = (draft: {
  name?: string;
  session_type?: string;
  sold_as?: SoldAs;
  product_key?: string | null;
  included_in_day_pass?: boolean;
  price_sek?: number | string | null;
  capacity?: number | string | null;
  court_ids?: string[] | null;
  publish_status?: string;
  is_active?: boolean;
}) => {
  const warnings: { message: string; blocking?: boolean }[] = [];
  const soldAs = draft.sold_as || "activity_ticket";
  const sessionType = draft.session_type || "open_play";
  const price = Number(draft.price_sek || 0);
  const capacity = draft.capacity === "" || draft.capacity == null ? null : Number(draft.capacity);
  const isPublished = (draft.publish_status || "published") === "published" && draft.is_active !== false;

  if (isPublished && soldAs === "activity_ticket" && price <= 0) {
    warnings.push({ message: "Lägg in ett onlinepris innan passet publiceras.", blocking: true });
  }
  if (isPublished && soldAs !== "included_only" && (!capacity || capacity <= 0)) {
    warnings.push({ message: "Lägg in max antal platser innan passet publiceras.", blocking: true });
  }
  if (isPublished && capacity && capacity > 0 && (!draft.court_ids || draft.court_ids.length === 0)) {
    warnings.push({ message: "Välj vilka banor passet reserverar. Annars kan samma banor säljas som privatbokning." });
  }
  if (soldAs === "day_pass" && isOpenPlayLike(sessionType)) {
    warnings.push({ message: "Det här passet säljs som dagsmedlemskap och kan ge heldagstillgång. Är det avsiktligt?" });
  }
  if (soldAs === "activity_ticket" && !draft.included_in_day_pass && isOpenPlayLike(sessionType)) {
    warnings.push({ message: "Passet ingår inte i dagsmedlemskap. Kunder med dagsmedlemskap får inte access." });
  }
  if (draft.product_key && !["open_play_slot", "group_training", "day_access", "event_fee"].includes(draft.product_key)) {
    warnings.push({ message: `Okänd produktnyckel (${draft.product_key}). Kundpriser kan bli fel.`, blocking: true });
  }
  return warnings;
};

const sessionWarnings = (session: any) => draftWarnings({
  name: session.name,
  session_type: session.session_type,
  sold_as: soldAsFromSession(session),
  product_key: session.product_key,
  included_in_day_pass: Boolean(session.access_policy?.allows_day_access),
  price_sek: sessionOnlinePrice(session),
  capacity: session.capacity,
  court_ids: session.court_ids || [],
  publish_status: session.publish_status || "published",
  is_active: session.is_active,
});

const memberPriceForProduct = ({
  productKey,
  basePrice,
  tiers,
  tierPricing,
}: {
  productKey: string | null;
  basePrice: number;
  tiers: MembershipTier[];
  tierPricing: TierPricing[];
}) => {
  if (!productKey) return "Ingen produkt";
  const activeTiers = tiers.filter((tier) => tier.is_active);
  const preferredTier = activeTiers.find((tier) => {
    const name = tier.name.toLowerCase();
    return (name === "play" || name.includes("access")) && !name.includes("+") && !name.includes("plus") && !name.includes("unlimited");
  }) || activeTiers[0];
  if (!preferredTier) return "Sätt i Medlemskap";
  const rule = tierPricing.find((row) => row.tier_id === preferredTier.id && row.product_type === productKey);
  if (!rule) return "Sätt i Medlemskap";
  const effectivePrice = rule.fixed_price != null
    ? Number(rule.fixed_price)
    : Math.max(0, Math.round(basePrice * (1 - Number(rule.discount_percent || 0) / 100)));
  return formatSek(effectivePrice);
};

const pricingPreview = ({
  onlinePrice,
  deskPrice,
  corporatePrice,
  promoPrice,
  soldAs,
  sessionType,
  includedInDayPass,
  includedInUnlimited,
  tiers,
  tierPricing,
}: {
  onlinePrice: number;
  deskPrice?: number;
  corporatePrice?: number | null;
  promoPrice?: number | null;
  soldAs: SoldAs;
  sessionType: string;
  includedInDayPass: boolean;
  includedInUnlimited: boolean;
  tiers: MembershipTier[];
  tierPricing: TierPricing[];
}) => {
  const price = numericPrice(onlinePrice);
  const desk = numericPrice(deskPrice ?? price, price);
  const optionalRows: [string, string][] = [];
  if (corporatePrice != null) optionalRows.push(["Corporate", formatSek(corporatePrice)]);
  if (promoPrice != null) optionalRows.push(["Promo", formatSek(promoPrice)]);

  if (soldAs === "included_only") {
    return [
      ["Online", "Ingen checkout"],
      ["Desk", "Ingen checkout"],
      ["Pickla Access / Play", "Enligt rättighet"],
      ["Unlimited / Play+", includedInUnlimited ? "Ingår" : "Ej inkluderat"],
      ["Dagsmedlemskap", includedInDayPass ? "Ingår idag" : "Ej access"],
      ...optionalRows,
    ];
  }
  if (soldAs === "day_pass") {
    const basePrice = price || 199;
    return [
      ["Online", formatSek(basePrice)],
      ["Desk", formatSek(desk || basePrice)],
      ["Pickla Access / Play", memberPriceForProduct({ productKey: "day_access", basePrice, tiers, tierPricing })],
      ["Unlimited / Play+", "Ej relevant"],
      ["Dagsmedlemskap", "Aktiveras"],
      ...optionalRows,
    ];
  }
  const productKey = productKeyForActivityTicket(sessionType);
  return [
    ["Online", formatSek(price)],
    ["Desk", formatSek(desk)],
    ["Pickla Access / Play", memberPriceForProduct({ productKey, basePrice: price, tiers, tierPricing })],
    ["Unlimited / Play+", includedInUnlimited ? "Ingår" : "Ej inkluderat"],
    ["Dagsmedlemskap", includedInDayPass ? "Ingår idag" : "Ej access"],
    ...optionalRows,
  ];
};

const AdminSchedule = ({ venueId }: { venueId: string }) => {
  const qc = useQueryClient();
  const [seriesName, setSeriesName] = useState("");
  const [seriesType, setSeriesType] = useState("program");
  const [seriesProduct, setSeriesProduct] = useState("");

  const [sessionName, setSessionName] = useState("");
  const [sessionType, setSessionType] = useState("open_play");
  const [seriesId, setSeriesId] = useState("");
  const [sessionProductKey, setSessionProductKey] = useState("open_play_slot");
  const [includedInDayPass, setIncludedInDayPass] = useState(true);
  const [includedInUnlimited, setIncludedInUnlimited] = useState(true);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("12:00");
  const [price, setPrice] = useState("");
  const [deskPrice, setDeskPrice] = useState("");
  const [corporatePrice, setCorporatePrice] = useState("");
  const [promoPrice, setPromoPrice] = useState("");
  const [scarcityMode, setScarcityMode] = useState("none");
  const [earlyBirdPrice, setEarlyBirdPrice] = useState("");
  const [earlyBirdSlots, setEarlyBirdSlots] = useState("");
  const [capacity, setCapacity] = useState("");
  const [sessionCourtIds, setSessionCourtIds] = useState<string[]>([]);

  const [editingSeriesId, setEditingSeriesId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [seriesDrafts, setSeriesDrafts] = useState<Record<string, any>>({});
  const [sessionDrafts, setSessionDrafts] = useState<Record<string, any>>({});
  const [hostSearch, setHostSearch] = useState("");

  const { data: products = [] } = useQuery<any[]>({
    queryKey: ["admin-access-products", venueId],
    queryFn: () => apiGet("api-admin", "products", { venueId }),
  });
  const { data: membershipTiers = [] } = useQuery<MembershipTier[]>({
    queryKey: ["membership-tiers", venueId],
    enabled: !!venueId,
    queryFn: () => apiGet("api-memberships", "tiers", { venueId, includeHidden: "true" }),
  });
  const tierPricingQueries = useQueries({
    queries: membershipTiers.map((tier) => ({
      queryKey: ["tier-pricing", tier.id],
      queryFn: () => apiGet<TierPricing[]>("api-memberships", "tier-pricing", { tierId: tier.id }),
      enabled: !!tier.id,
    })),
  });
  const allTierPricing = tierPricingQueries.flatMap((query) => query.data || []);

  const { data: series = [], isLoading: seriesLoading } = useQuery<any[]>({
    queryKey: ["admin-activity-series", venueId],
    queryFn: () => apiGet("api-admin", "activity-series", { venueId }),
  });

  const { data: sessions = [], isLoading: sessionsLoading } = useQuery<any[]>({
    queryKey: ["admin-activity-sessions", venueId],
    queryFn: () => apiGet("api-admin", "activity-sessions", { venueId }),
  });

  const { data: venueCourts = [] } = useQuery<VenueCourtOption[]>({
    queryKey: ["admin-venue-courts", venueId],
    enabled: !!venueId,
    queryFn: () => apiGet("api-admin", "courts", { venueId }),
  });

  const pickleballCourts = useMemo(
    () => venueCourts.filter((court) => !court.sport_type || court.sport_type === "pickleball"),
    [venueCourts]
  );

  const normalizedHostSearch = hostSearch.trim();
  const { data: hostSearchResults = [] } = useQuery<HostOption[]>({
    queryKey: ["admin-schedule-host-search", venueId, normalizedHostSearch],
    enabled: !!venueId && !!editingSessionId && normalizedHostSearch.length >= 2,
    queryFn: () => apiGet("api-customers", "list", { venueId, search: normalizedHostSearch, limit: "8" }),
  });

  const productMap = useMemo(() => {
    const map: Record<string, any> = {};
    products.forEach((product) => { map[product.product_key] = product; });
    return map;
  }, [products]);

  const createSeries = useMutation({
    mutationFn: (body: any) => apiPost("api-admin", "activity-series", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-activity-series", venueId] });
      toast.success("Program skapat");
      setSeriesName("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateSeries = useMutation({
    mutationFn: (body: any) => apiPatch("api-admin", "activity-series", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-activity-series", venueId] });
      qc.invalidateQueries({ queryKey: ["admin-activity-sessions", venueId] });
      toast.success("Program uppdaterat");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteSeries = useMutation({
    mutationFn: (seriesId: string) => apiDelete("api-admin", "activity-series", { venueId, seriesId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-activity-series", venueId] });
      qc.invalidateQueries({ queryKey: ["admin-activity-sessions", venueId] });
      toast.success("Program borttaget");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const createSession = useMutation({
    mutationFn: (body: any) => apiPost("api-admin", "activity-sessions", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-activity-sessions", venueId] });
      toast.success("Schema-pass skapat");
      setSessionName("");
      setPrice("");
      setDeskPrice("");
      setCorporatePrice("");
      setPromoPrice("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateSession = useMutation({
    mutationFn: (body: any) => apiPatch("api-admin", "activity-sessions", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-activity-sessions", venueId] });
      toast.success("Pass uppdaterat");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteSession = useMutation({
    mutationFn: (sessionId: string) => apiDelete("api-admin", "activity-sessions", { venueId, sessionId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-activity-sessions", venueId] });
      toast.success("Pass borttaget");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleDay = (day: number) => {
    setDays((current) => current.includes(day) ? current.filter((d) => d !== day) : sortDays([...current, day]));
  };

  const toggleDraftDay = (sessionId: string, day: number) => {
    setSessionDrafts((current) => {
      const draft = current[sessionId] || {};
      const currentDays = draft.recurrence_days || [];
      const nextDays = currentDays.includes(day)
        ? currentDays.filter((d: number) => d !== day)
        : sortDays([...currentDays, day]);
      return { ...current, [sessionId]: { ...draft, recurrence_days: nextDays } };
    });
  };

  const toggleSessionCourt = (courtId: string) => {
    setSessionCourtIds((current) => (
      current.includes(courtId)
        ? current.filter((id) => id !== courtId)
        : [...current, courtId]
    ));
  };

  const toggleDraftCourt = (sessionId: string, courtId: string) => {
    setSessionDrafts((current) => {
      const draft = current[sessionId] || {};
      const currentIds = Array.isArray(draft.court_ids) ? draft.court_ids : [];
      const nextIds = currentIds.includes(courtId)
        ? currentIds.filter((id: string) => id !== courtId)
        : [...currentIds, courtId];
      return { ...current, [sessionId]: { ...draft, court_ids: nextIds } };
    });
  };

  const handleCreateSeries = () => {
    if (!seriesName.trim()) {
      toast.error("Namn krävs");
      return;
    }
    createSeries.mutate({
      venueId,
      name: seriesName.trim(),
      series_type: seriesType,
      product_key: seriesProduct || null,
      status: "active",
    });
  };

  const handleCreateSession = () => {
    if (!sessionName.trim() || !days.length) {
      toast.error("Namn och minst en veckodag krävs");
      return;
    }
    const selectedProductKey = sessionProductKey || productKeyForActivityTicket(sessionType);
    const selectedProduct = productMap[selectedProductKey] || null;
    const config = buildProductSessionConfig({
      product: selectedProduct,
      productKey: selectedProductKey,
      sessionType,
      includedInDayPass,
      includedInUnlimited,
    });
    const effectiveSoldAs = config.soldAs;
    const productBasePrice = numericPrice(selectedProduct?.base_price_sek ?? 0);
    const effectiveInputPrice = price === "" ? productBasePrice : numericPrice(price);
    const desk = numericPrice(deskPrice || effectiveInputPrice, effectiveInputPrice);
    const warnings = draftWarnings({
      name: sessionName,
      session_type: sessionType,
      sold_as: effectiveSoldAs,
      product_key: config.product_key,
      included_in_day_pass: includedInDayPass,
      price_sek: effectiveInputPrice,
      capacity,
      court_ids: sessionCourtIds,
      publish_status: "published",
      is_active: true,
    });
    const blocker = warnings.find((warning) => warning.blocking);
    if (blocker) {
      toast.error(blocker.message);
      return;
    }
    createSession.mutate({
      venueId,
      name: sessionName.trim(),
      session_type: sessionType,
      series_id: seriesId || null,
      product_key: config.product_key,
      recurrence_days: days,
      start_time: startTime,
      end_time: endTime,
      price_sek: effectiveInputPrice,
      capacity: capacity ? Math.round(Number(capacity)) : null,
      court_ids: sessionCourtIds,
      access_policy: config.access_policy,
      metadata: buildPricingMetadata({
        onlinePrice: effectiveInputPrice,
        deskPrice: desk,
        corporatePrice,
        promoPrice,
      }),
      scarcity_mode: scarcityMode,
      early_bird_price_minor: scarcityMode === "early_bird" ? priceSekToMinor(earlyBirdPrice) : null,
      early_bird_slots: scarcityMode === "early_bird" ? positiveSlots(earlyBirdSlots) : null,
      is_active: true,
    }, {
      onSuccess: () => {
        setSessionCourtIds([]);
        setScarcityMode("none");
        setEarlyBirdPrice("");
        setEarlyBirdSlots("");
      },
    });
  };

  const dayLabel = (session: any) => {
    const recurrenceDays = session.recurrence_days || session.day_of_week || [];
    return recurrenceDays
      .map((day: number) => DAYS.find((d) => d.key === day)?.label)
      .filter(Boolean)
      .join(", ");
  };

  const startEditSeries = (item: any) => {
    setEditingSeriesId(item.id);
    setSeriesDrafts((current) => ({
      ...current,
      [item.id]: {
        name: item.name || "",
        series_type: item.series_type || "program",
        product_key: item.product_key || "",
        status: item.status || "active",
      },
    }));
  };

  const saveSeries = (item: any) => {
    const draft = seriesDrafts[item.id];
    if (!draft?.name?.trim()) {
      toast.error("Programmet behöver ett namn");
      return;
    }
    updateSeries.mutate({
      seriesId: item.id,
      name: draft.name.trim(),
      series_type: draft.series_type || "program",
      product_key: draft.product_key || null,
      status: draft.status || "active",
    }, {
      onSuccess: () => setEditingSeriesId(null),
    });
  };

  const startEditSession = (session: any) => {
    const metadata = sessionMetadata(session);
    const online = sessionOnlinePrice(session);
    const desk = sessionDeskPrice(session);
    setEditingSessionId(session.id);
    setSessionDrafts((current) => ({
      ...current,
      [session.id]: {
        name: session.name || "",
        session_type: session.session_type || "open_play",
        series_id: session.series_id || "",
        product_key: session.product_key || "",
        sold_as: soldAsFromSession(session),
        included_in_day_pass: Boolean(session.access_policy?.allows_day_access),
        included_in_unlimited: session.access_policy?.member_benefit_key === "open_play_unlimited",
        recurrence_days: session.recurrence_days || [],
        start_time: String(session.start_time || "10:00").slice(0, 5),
        end_time: String(session.end_time || "12:00").slice(0, 5),
        price_sek: online,
        online_price_sek: online,
        desk_price_sek: desk,
        corporate_price_sek: metadata.corporate_price_sek ?? "",
        promo_price_sek: metadata.promo_price_sek ?? "",
        scarcity_mode: sessionScarcityMode(session),
        early_bird_price_sek: sessionEarlyBirdPriceSek(session),
        early_bird_slots: sessionEarlyBirdSlots(session),
        capacity: session.capacity ?? "",
        court_ids: session.court_ids || [],
        is_active: Boolean(session.is_active),
        publish_status: session.publish_status || "published",
        hosts: session.hosts || [],
        host_customer_ids: session.host_customer_ids || (session.hosts || []).map((host: any) => host.customer_id).filter(Boolean),
      },
    }));
    setHostSearch("");
  };

  const saveSession = (session: any) => {
    const draft = sessionDrafts[session.id];
    if (!draft?.name?.trim() || !draft?.recurrence_days?.length) {
      toast.error("Passet behöver namn och minst en veckodag");
      return;
    }
    const draftProductKey = draft.product_key || productKeyForActivityTicket(draft.session_type || "open_play");
    const draftProduct = productMap[draftProductKey] || null;
    const config = buildProductSessionConfig({
      product: draftProduct,
      productKey: draftProductKey,
      sessionType: draft.session_type || "open_play",
      includedInDayPass: Boolean(draft.included_in_day_pass),
      includedInUnlimited: Boolean(draft.included_in_unlimited),
    });
    const onlinePrice = numericPrice(draft.online_price_sek ?? draft.price_sek ?? 0);
    const desk = numericPrice(draft.desk_price_sek || onlinePrice, onlinePrice);
    const warnings = draftWarnings({
      ...draft,
      price_sek: onlinePrice,
      product_key: config.product_key,
      included_in_day_pass: Boolean(draft.included_in_day_pass),
    });
    const blocker = warnings.find((warning) => warning.blocking);
    if (blocker) {
      toast.error(blocker.message);
      return;
    }
    updateSession.mutate({
      sessionId: session.id,
      name: draft.name.trim(),
      session_type: draft.session_type || "open_play",
      series_id: draft.series_id || null,
      product_key: config.product_key,
      recurrence_days: draft.recurrence_days,
      start_time: draft.start_time,
      end_time: draft.end_time,
      price_sek: onlinePrice,
      capacity: draft.capacity === "" || draft.capacity == null ? null : Math.max(0, Math.round(Number(draft.capacity))),
      court_ids: Array.isArray(draft.court_ids) ? draft.court_ids : [],
      is_active: Boolean(draft.is_active),
      publish_status: draft.publish_status || "published",
      access_policy: config.access_policy,
      metadata: buildPricingMetadata({
        existingMetadata: sessionMetadata(session),
        onlinePrice,
        deskPrice: desk,
        corporatePrice: draft.corporate_price_sek,
        promoPrice: draft.promo_price_sek,
      }),
      scarcity_mode: draft.scarcity_mode || "none",
      early_bird_price_minor: draft.scarcity_mode === "early_bird" ? priceSekToMinor(draft.early_bird_price_sek) : null,
      early_bird_slots: draft.scarcity_mode === "early_bird" ? positiveSlots(draft.early_bird_slots) : null,
      host_customer_ids: Array.isArray(draft.host_customer_ids) ? draft.host_customer_ids : [],
    }, {
      onSuccess: () => setEditingSessionId(null),
    });
  };

  const createProductKey = sessionProductKey || productKeyForActivityTicket(sessionType);
  const createProduct = productMap[createProductKey] || null;
  const createConfig = buildProductSessionConfig({
    product: createProduct,
    productKey: createProductKey,
    sessionType,
    includedInDayPass,
    includedInUnlimited,
  });
  const createOnlinePrice = price === "" ? numericPrice(createProduct?.base_price_sek ?? 0) : numericPrice(price);
  const createWarnings = draftWarnings({
    name: sessionName,
    session_type: sessionType,
    sold_as: createConfig.soldAs,
    product_key: createConfig.product_key,
    included_in_day_pass: includedInDayPass,
    price_sek: createOnlinePrice,
    capacity,
    court_ids: sessionCourtIds,
    publish_status: "published",
    is_active: true,
  });
  const createPreview = pricingPreview({
    onlinePrice: createOnlinePrice,
    deskPrice: numericPrice(deskPrice || createOnlinePrice, createOnlinePrice),
    corporatePrice: optionalPrice(corporatePrice),
    promoPrice: optionalPrice(promoPrice),
    soldAs: createConfig.soldAs,
    sessionType,
    includedInDayPass,
    includedInUnlimited,
    tiers: membershipTiers,
    tierPricing: allTierPricing,
  });

  if (seriesLoading || sessionsLoading) return <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto mt-8" />;

  return (
    <div className="space-y-4">
      <div className="glass-card rounded-2xl p-4 space-y-2">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Schema bygger på två nivåer</p>
        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <div className="rounded-xl bg-muted/50 p-3">
            <span className="font-bold text-foreground">Program / serie</span> är gruppen, till exempel Fredagsklubben eller Vårkurs.
          </div>
          <div className="rounded-xl bg-muted/50 p-3">
            <span className="font-bold text-foreground">Schema-pass</span> är tiden, priset och kapaciteten som kunder kan boka.
          </div>
        </div>
      </div>

      <div className="glass-card rounded-2xl p-4 space-y-3">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Nytt program / serie</p>
        <input
          value={seriesName}
          onChange={(e) => setSeriesName(e.target.value)}
          placeholder="Fredagsklubben, Pickla Open, Vårkurs Nybörjare..."
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
          style={inputStyle}
        />
        <div className="grid grid-cols-2 gap-2">
          <select value={seriesType} onChange={(e) => setSeriesType(e.target.value)} className={baseInputClass} style={inputStyle}>
            {SERIES_TYPES.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
          <select value={seriesProduct} onChange={(e) => setSeriesProduct(e.target.value)} className={baseInputClass} style={inputStyle}>
            <option value="">Ingen standardprodukt</option>
            {products.map((product) => <option key={product.id} value={product.product_key}>{product.name}</option>)}
          </select>
        </div>
        <button onClick={handleCreateSeries} disabled={createSeries.isPending} className="w-full rounded-xl bg-primary py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50 flex items-center justify-center gap-2">
          {createSeries.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Skapa program
        </button>
      </div>

      {series.length > 0 && (
        <div className="space-y-2">
          <p className="px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">Program / serier</p>
          {series.map((item) => {
            const draft = seriesDrafts[item.id] || {};
            const isEditing = editingSeriesId === item.id;
            return (
              <motion.div key={item.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="glass-card rounded-2xl p-4">
                {isEditing ? (
                  <div className="space-y-3">
                    <input value={draft.name || ""} onChange={(e) => setSeriesDrafts((current) => ({ ...current, [item.id]: { ...draft, name: e.target.value } }))} className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={inputStyle} />
                    <div className="grid grid-cols-3 gap-2">
                      <select value={draft.series_type || "program"} onChange={(e) => setSeriesDrafts((current) => ({ ...current, [item.id]: { ...draft, series_type: e.target.value } }))} className={baseInputClass} style={inputStyle}>
                        {SERIES_TYPES.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                      </select>
                      <select value={draft.product_key || ""} onChange={(e) => setSeriesDrafts((current) => ({ ...current, [item.id]: { ...draft, product_key: e.target.value } }))} className={baseInputClass} style={inputStyle}>
                        <option value="">Ingen produkt</option>
                        {products.map((product) => <option key={product.id} value={product.product_key}>{product.name}</option>)}
                      </select>
                      <select value={draft.status || "active"} onChange={(e) => setSeriesDrafts((current) => ({ ...current, [item.id]: { ...draft, status: e.target.value } }))} className={baseInputClass} style={inputStyle}>
                        <option value="active">Aktiv</option>
                        <option value="draft">Utkast</option>
                        <option value="archived">Arkiv</option>
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => saveSeries(item)} disabled={updateSeries.isPending} className="flex-1 rounded-xl bg-primary py-2.5 text-xs font-bold text-primary-foreground flex items-center justify-center gap-2 disabled:opacity-50">
                        <Save className="h-3.5 w-3.5" /> Spara
                      </button>
                      <button onClick={() => setEditingSeriesId(null)} className="rounded-xl bg-muted px-3 py-2.5 text-xs font-bold">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold">{item.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {SERIES_TYPES.find((type) => type.key === item.series_type)?.label || item.series_type}
                        {item.product_key ? ` · ${productMap[item.product_key]?.name || item.product_key}` : ""}
                      </p>
                    </div>
                    <button onClick={() => startEditSeries(item)} className="rounded-full bg-muted px-2.5 py-1.5 text-[10px] font-bold text-muted-foreground flex items-center gap-1">
                      <Edit3 className="h-3 w-3" /> Redigera
                    </button>
                    <button onClick={() => { if (confirm("Ta bort programmet? Pass kopplade till serien kan påverkas.")) deleteSeries.mutate(item.id); }} className="text-muted-foreground/50 hover:text-destructive">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      <div className="glass-card rounded-2xl p-4 space-y-3">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Nytt schema-pass</p>
        <input
          value={sessionName}
          onChange={(e) => setSessionName(e.target.value)}
          placeholder="Open Play Kväll, Fredagsklubben, Gruppträning..."
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
          style={inputStyle}
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            value={sessionType}
            onChange={(e) => {
              const nextType = e.target.value;
              setSessionType(nextType);
              setIncludedInUnlimited(isOpenPlayLike(nextType));
              setSessionProductKey(productKeyForActivityTicket(nextType));
            }}
            className={baseInputClass}
            style={inputStyle}
          >
            {SESSION_TYPES.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
          <select value={seriesId} onChange={(e) => setSeriesId(e.target.value)} className={baseInputClass} style={inputStyle}>
            <option value="">Enskilt pass</option>
            {series.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <div className="rounded-xl bg-muted/40 p-3 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Vad säljer vi?</p>
          <select
            value={createProductKey}
            onChange={(e) => setSessionProductKey(e.target.value)}
            className="w-full rounded-xl px-3 py-2.5 text-xs outline-none"
            style={inputStyle}
          >
            {products.map((product) => (
              <option key={product.id} value={product.product_key}>{product.name}</option>
            ))}
          </select>
          <div className="grid gap-2 text-[11px] sm:grid-cols-3">
            <div className="rounded-lg bg-background/60 px-2 py-1.5">
              <span className="block text-muted-foreground">Produkt</span>
              <span className="font-bold">{createProduct?.name || createProductKey}</span>
            </div>
            <div className="rounded-lg bg-background/60 px-2 py-1.5">
              <span className="block text-muted-foreground">Biljettyp</span>
              <span className="font-bold">{SOLD_AS_OPTIONS.find((option) => option.key === createConfig.soldAs)?.label}</span>
            </div>
            <div className="rounded-lg bg-background/60 px-2 py-1.5">
              <span className="block text-muted-foreground">Baspris</span>
              <span className="font-bold">{formatSek(numericPrice(createProduct?.base_price_sek ?? 0))}</span>
            </div>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground">
            Ingår i dagsmedlemskap
            <input
              type="checkbox"
              checked={includedInDayPass}
              disabled={createConfig.soldAs === "day_pass"}
              onChange={(e) => setIncludedInDayPass(e.target.checked)}
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground">
            Ingår i Unlimited / Play+
            <input
              type="checkbox"
              checked={includedInUnlimited}
              onChange={(e) => setIncludedInUnlimited(e.target.checked)}
            />
          </label>
        </div>
        <div className="rounded-xl bg-muted/40 p-3 space-y-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Pris & kanalpriser</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Onlinepriset används på playpickla.com. Deskpriset används i kassan på plats.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Onlinepris
              <input type="number" placeholder="99" value={price} onChange={(e) => setPrice(e.target.value)} className={baseInputClass + " w-full"} style={inputStyle} />
            </label>
            <label className="space-y-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Deskpris
              <input type="number" placeholder="129" value={deskPrice} onChange={(e) => setDeskPrice(e.target.value)} className={baseInputClass + " w-full"} style={inputStyle} />
            </label>
            <label className="space-y-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Corporate
              <input type="number" placeholder="Valfritt" value={corporatePrice} onChange={(e) => setCorporatePrice(e.target.value)} className={baseInputClass + " w-full"} style={inputStyle} />
            </label>
            <label className="space-y-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Promo
              <input type="number" placeholder="Valfritt" value={promoPrice} onChange={(e) => setPromoPrice(e.target.value)} className={baseInputClass + " w-full"} style={inputStyle} />
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="space-y-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Tryckläge
              <select value={scarcityMode} onChange={(e) => setScarcityMode(e.target.value)} className={baseInputClass + " w-full"} style={inputStyle}>
                <option value="none">Av</option>
                <option value="early_bird">Tidigt pris</option>
                <option value="capacity">Kapacitet</option>
              </select>
            </label>
            <label className="space-y-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Tidigt pris
              <input type="number" placeholder="129" value={earlyBirdPrice} onChange={(e) => setEarlyBirdPrice(e.target.value)} disabled={scarcityMode !== "early_bird"} className={baseInputClass + " w-full disabled:opacity-50"} style={inputStyle} />
            </label>
            <label className="space-y-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Tidiga platser
              <input type="number" placeholder="4" value={earlyBirdSlots} onChange={(e) => setEarlyBirdSlots(e.target.value)} disabled={scarcityMode !== "early_bird"} className={baseInputClass + " w-full disabled:opacity-50"} style={inputStyle} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-1.5 text-[11px]">
            {createPreview.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-2 rounded-lg bg-background/60 px-2 py-1.5">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-bold text-foreground">{value}</span>
              </div>
            ))}
          </div>
        </div>
        {createWarnings.length > 0 && (
          <div className="space-y-1">
            {createWarnings.map((warning) => (
              <div key={warning.message} className={`flex items-start gap-2 rounded-xl px-3 py-2 text-[11px] ${warning.blocking ? "bg-destructive/10 text-destructive" : "bg-badge-vip/10 text-badge-vip"}`}>
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{warning.message}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((day) => (
            <button
              key={day.key}
              onClick={() => toggleDay(day.key)}
              className={`rounded-full px-3 py-1.5 text-xs font-bold ${days.includes(day.key) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
            >
              {day.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-4 gap-2">
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={baseInputClass} style={inputStyle} />
          <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={baseInputClass} style={inputStyle} />
          <input type="number" placeholder="Max antal platser" value={capacity} onChange={(e) => setCapacity(e.target.value)} className="col-span-2 rounded-xl px-3 py-2.5 text-xs outline-none" style={inputStyle} />
        </div>
        <div className="rounded-xl bg-muted/40 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Banor som reserveras</p>
            <span className="text-[10px] font-semibold text-muted-foreground">{sessionCourtIds.length} valda</span>
          </div>
          {pickleballCourts.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {pickleballCourts.map((court) => {
                const selected = sessionCourtIds.includes(court.id);
                return (
                  <button
                    key={court.id}
                    type="button"
                    onClick={() => toggleSessionCourt(court.id)}
                    className={`rounded-full px-3 py-1.5 text-[11px] font-bold ${selected ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground"}`}
                  >
                    {courtLabel(court)}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">Inga banor hittades för venue.</p>
          )}
          <p className="text-[11px] text-muted-foreground">Valda banor blockeras för privatbokning under passets tid.</p>
        </div>
        <button onClick={handleCreateSession} disabled={createSession.isPending} className="w-full rounded-xl bg-court-free py-2.5 text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2">
          {createSession.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Lägg i schema
        </button>
      </div>

      <div className="space-y-2">
        <p className="px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">Schema-pass</p>
        {sessions.map((session) => {
          const product = session.product_key ? productMap[session.product_key] : null;
          const isEditing = editingSessionId === session.id;
          const draft = sessionDrafts[session.id] || {};
          const activeDraftProductKey = draft.product_key || session.product_key || productKeyForActivityTicket(draft.session_type || session.session_type || "open_play");
          const activeDraftProduct = productMap[activeDraftProductKey] || product;
          const activeDraftIncludedInDayPass = Boolean(draft.included_in_day_pass ?? session.access_policy?.allows_day_access);
          const activeDraftIncludedInUnlimited = Boolean(draft.included_in_unlimited ?? (session.access_policy?.member_benefit_key === "open_play_unlimited"));
          const activeDraftConfig = buildProductSessionConfig({
            product: activeDraftProduct,
            productKey: activeDraftProductKey,
            sessionType: draft.session_type || session.session_type || "open_play",
            includedInDayPass: activeDraftIncludedInDayPass,
            includedInUnlimited: activeDraftIncludedInUnlimited,
          });
          const activeDraftSoldAs = activeDraftConfig.soldAs;
          const activeWarnings = isEditing
            ? draftWarnings({
                ...draft,
                sold_as: activeDraftSoldAs,
                product_key: activeDraftConfig.product_key,
                included_in_day_pass: activeDraftIncludedInDayPass,
              })
            : sessionWarnings(session);
          const activePreview = pricingPreview({
            onlinePrice: numericPrice(isEditing ? draft.online_price_sek ?? draft.price_sek ?? sessionOnlinePrice(session) : sessionOnlinePrice(session)),
            deskPrice: numericPrice(isEditing ? draft.desk_price_sek ?? sessionDeskPrice(session) : sessionDeskPrice(session)),
            corporatePrice: optionalPrice(isEditing ? draft.corporate_price_sek : sessionMetadata(session).corporate_price_sek),
            promoPrice: optionalPrice(isEditing ? draft.promo_price_sek : sessionMetadata(session).promo_price_sek),
            soldAs: activeDraftSoldAs,
            sessionType: draft.session_type || session.session_type || "open_play",
            includedInDayPass: activeDraftIncludedInDayPass,
            includedInUnlimited: activeDraftIncludedInUnlimited,
            tiers: membershipTiers,
            tierPricing: allTierPricing,
          });
          const online = sessionOnlinePrice(session);
          const desk = sessionDeskPrice(session);
          const savedScarcityMode = sessionScarcityMode(session);
          const savedEarlyBirdPrice = sessionEarlyBirdPriceSek(session);
          const savedEarlyBirdSlots = sessionEarlyBirdSlots(session);
          const memberAccess = memberPriceForProduct({
            productKey: activeDraftConfig.product_key,
            basePrice: online,
            tiers: membershipTiers,
            tierPricing: allTierPricing,
          });
          const includedLabel = accessSummary(activeDraftIncludedInDayPass, activeDraftIncludedInUnlimited);
          return (
            <motion.div key={session.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="glass-card rounded-2xl p-4">
              {isEditing ? (
                <div className="space-y-3">
                  <input value={draft.name || ""} onChange={(e) => setSessionDrafts((current) => ({ ...current, [session.id]: { ...draft, name: e.target.value } }))} className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={inputStyle} />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={draft.session_type || "open_play"}
                      onChange={(e) => {
                        const nextType = e.target.value;
                        setSessionDrafts((current) => ({
                          ...current,
                          [session.id]: {
                            ...draft,
                            session_type: nextType,
                            included_in_unlimited: isOpenPlayLike(nextType),
                          },
                        }));
                      }}
                      className={baseInputClass}
                      style={inputStyle}
                    >
                      {SESSION_TYPES.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                    </select>
                    <select value={draft.series_id || ""} onChange={(e) => setSessionDrafts((current) => ({ ...current, [session.id]: { ...draft, series_id: e.target.value } }))} className={baseInputClass} style={inputStyle}>
                      <option value="">Enskilt pass</option>
                      {series.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="sm:col-span-3 rounded-xl bg-muted/40 p-3 space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Vad säljer vi?</p>
                      <select
                        value={activeDraftProductKey || ""}
                        onChange={(e) => {
                          const nextProduct = productMap[e.target.value];
                          const nextSoldAs = soldAsFromProduct(nextProduct, e.target.value);
                          setSessionDrafts((current) => ({
                            ...current,
                            [session.id]: {
                              ...draft,
                              product_key: e.target.value,
                              sold_as: nextSoldAs,
                              included_in_day_pass: nextSoldAs === "day_pass" ? true : draft.included_in_day_pass,
                            },
                          }));
                        }}
                        className="w-full rounded-xl px-3 py-2.5 text-xs outline-none"
                        style={inputStyle}
                      >
                        {products.map((productOption) => (
                          <option key={productOption.id} value={productOption.product_key}>{productOption.name}</option>
                        ))}
                      </select>
                      <div className="grid gap-2 text-[11px] sm:grid-cols-3">
                        <div className="rounded-lg bg-background/60 px-2 py-1.5">
                          <span className="block text-muted-foreground">Produkt</span>
                          <span className="font-bold">{activeDraftProduct?.name || activeDraftProductKey}</span>
                        </div>
                        <div className="rounded-lg bg-background/60 px-2 py-1.5">
                          <span className="block text-muted-foreground">Biljettyp</span>
                          <span className="font-bold">{SOLD_AS_OPTIONS.find((option) => option.key === activeDraftSoldAs)?.label}</span>
                        </div>
                        <div className="rounded-lg bg-background/60 px-2 py-1.5">
                          <span className="block text-muted-foreground">Produktens baspris</span>
                          <span className="font-bold">{formatSek(numericPrice(activeDraftProduct?.base_price_sek ?? 0))}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-xl bg-muted/40 p-3 space-y-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Värdar</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">Tilldelade värdar syns på passet och betalar 0 kr när de anmäler sig till just detta pass.</p>
                    </div>
                    {(draft.hosts || []).length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {(draft.hosts || []).map((host: HostOption) => {
                          const id = hostOptionId(host);
                          return (
                            <button
                              key={id}
                              type="button"
                              onClick={() => setSessionDrafts((current) => ({
                                ...current,
                                [session.id]: {
                                  ...draft,
                                  hosts: (draft.hosts || []).filter((item: HostOption) => hostOptionId(item) !== id),
                                  host_customer_ids: (draft.host_customer_ids || []).filter((customerId: string) => customerId !== id),
                                },
                              }))}
                              className="inline-flex items-center gap-1 rounded-full bg-background px-2.5 py-1.5 text-[11px] font-bold text-foreground"
                            >
                              {hostOptionName(host)}
                              <X className="h-3 w-3 text-muted-foreground" />
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                    <input
                      value={hostSearch}
                      onChange={(e) => setHostSearch(e.target.value)}
                      placeholder="Sök kund med namn, e-post eller telefon"
                      className="w-full rounded-xl px-3 py-2.5 text-xs outline-none"
                      style={inputStyle}
                    />
                    {normalizedHostSearch.length >= 2 && hostSearchResults.length > 0 ? (
                      <div className="grid gap-1">
                        {hostSearchResults
                          .filter((host) => !((draft.host_customer_ids || []) as string[]).includes(hostOptionId(host)))
                          .slice(0, 5)
                          .map((host) => {
                            const id = hostOptionId(host);
                            return (
                              <button
                                key={id}
                                type="button"
                                onClick={() => {
                                  if (!id) return;
                                  setSessionDrafts((current) => ({
                                    ...current,
                                    [session.id]: {
                                      ...draft,
                                      hosts: [...(draft.hosts || []), { ...host, customer_id: id }],
                                      host_customer_ids: [...(draft.host_customer_ids || []), id],
                                    },
                                  }));
                                  setHostSearch("");
                                }}
                                className="flex items-center justify-between gap-3 rounded-xl bg-background/70 px-3 py-2 text-left text-xs"
                              >
                                <span className="font-bold text-foreground">{hostOptionName(host)}</span>
                                <span className="truncate text-muted-foreground">{host.email || host.phone || "Kund"}</span>
                              </button>
                            );
                          })}
                      </div>
                    ) : null}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground">
                      Ingår i dagsmedlemskap
                      <input
                        type="checkbox"
                        checked={activeDraftIncludedInDayPass}
                        disabled={activeDraftSoldAs === "day_pass"}
                        onChange={(e) => setSessionDrafts((current) => ({ ...current, [session.id]: { ...draft, included_in_day_pass: e.target.checked } }))}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground">
                      Ingår i Unlimited / Play+
                      <input
                        type="checkbox"
                        checked={activeDraftIncludedInUnlimited}
                        onChange={(e) => setSessionDrafts((current) => ({ ...current, [session.id]: { ...draft, included_in_unlimited: e.target.checked } }))}
                      />
                    </label>
                  </div>
                  <div className="rounded-xl bg-muted/40 p-3 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Pris & kanalpriser</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">Online/base styr webben. Desk visas i kassan på plats.</p>
                      </div>
                      <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary">Redigerar pass</span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      <label className="space-y-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Onlinepris
                        <input type="number" value={draft.online_price_sek ?? draft.price_sek ?? ""} onChange={(e) => setSessionDrafts((current) => ({ ...current, [session.id]: { ...draft, online_price_sek: e.target.value, price_sek: e.target.value } }))} className={baseInputClass + " w-full"} style={inputStyle} />
                      </label>
                      <label className="space-y-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Deskpris
                        <input type="number" value={draft.desk_price_sek ?? ""} onChange={(e) => setSessionDrafts((current) => ({ ...current, [session.id]: { ...draft, desk_price_sek: e.target.value } }))} className={baseInputClass + " w-full"} style={inputStyle} />
                      </label>
                      <label className="space-y-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Corporate
                        <input type="number" placeholder="Valfritt" value={draft.corporate_price_sek ?? ""} onChange={(e) => setSessionDrafts((current) => ({ ...current, [session.id]: { ...draft, corporate_price_sek: e.target.value } }))} className={baseInputClass + " w-full"} style={inputStyle} />
                      </label>
                      <label className="space-y-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Promo
                        <input type="number" placeholder="Valfritt" value={draft.promo_price_sek ?? ""} onChange={(e) => setSessionDrafts((current) => ({ ...current, [session.id]: { ...draft, promo_price_sek: e.target.value } }))} className={baseInputClass + " w-full"} style={inputStyle} />
                      </label>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <label className="space-y-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Tryckläge
                        <select value={draft.scarcity_mode || "none"} onChange={(e) => setSessionDrafts((current) => ({ ...current, [session.id]: { ...draft, scarcity_mode: e.target.value } }))} className={baseInputClass + " w-full"} style={inputStyle}>
                          <option value="none">Av</option>
                          <option value="early_bird">Tidigt pris</option>
                          <option value="capacity">Kapacitet</option>
                        </select>
                      </label>
                      <label className="space-y-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Tidigt pris
                        <input type="number" placeholder="129" value={draft.early_bird_price_sek ?? ""} onChange={(e) => setSessionDrafts((current) => ({ ...current, [session.id]: { ...draft, early_bird_price_sek: e.target.value } }))} disabled={(draft.scarcity_mode || "none") !== "early_bird"} className={baseInputClass + " w-full disabled:opacity-50"} style={inputStyle} />
                      </label>
                      <label className="space-y-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Tidiga platser
                        <input type="number" placeholder="4" value={draft.early_bird_slots ?? ""} onChange={(e) => setSessionDrafts((current) => ({ ...current, [session.id]: { ...draft, early_bird_slots: e.target.value } }))} disabled={(draft.scarcity_mode || "none") !== "early_bird"} className={baseInputClass + " w-full disabled:opacity-50"} style={inputStyle} />
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                      {activePreview.map(([label, value]) => (
                        <div key={label} className="flex items-center justify-between gap-2 rounded-lg bg-background/60 px-2 py-1.5">
                          <span className="text-muted-foreground">{label}</span>
                          <span className="font-bold text-foreground">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {activeWarnings.length > 0 && (
                    <div className="space-y-1">
                      {activeWarnings.map((warning) => (
                        <div key={warning.message} className={`flex items-start gap-2 rounded-xl px-3 py-2 text-[11px] ${warning.blocking ? "bg-destructive/10 text-destructive" : "bg-badge-vip/10 text-badge-vip"}`}>
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>{warning.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {DAYS.map((day) => (
                      <button
                        key={day.key}
                        onClick={() => toggleDraftDay(session.id, day.key)}
                        className={`rounded-full px-3 py-1.5 text-xs font-bold ${(draft.recurrence_days || []).includes(day.key) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                      >
                        {day.label}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <input type="time" value={draft.start_time || ""} onChange={(e) => setSessionDrafts((current) => ({ ...current, [session.id]: { ...draft, start_time: e.target.value } }))} className={baseInputClass} style={inputStyle} />
                    <input type="time" value={draft.end_time || ""} onChange={(e) => setSessionDrafts((current) => ({ ...current, [session.id]: { ...draft, end_time: e.target.value } }))} className={baseInputClass} style={inputStyle} />
                    <input type="number" placeholder="Max antal platser" value={draft.capacity ?? ""} onChange={(e) => setSessionDrafts((current) => ({ ...current, [session.id]: { ...draft, capacity: e.target.value } }))} className="col-span-2 rounded-xl px-3 py-2.5 text-xs outline-none" style={inputStyle} />
                  </div>
                  <div className="rounded-xl bg-muted/40 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Banor som reserveras</p>
                      <span className="text-[10px] font-semibold text-muted-foreground">{(draft.court_ids || []).length} valda</span>
                    </div>
                    {pickleballCourts.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {pickleballCourts.map((court) => {
                          const selected = (draft.court_ids || []).includes(court.id);
                          return (
                            <button
                              key={court.id}
                              type="button"
                              onClick={() => toggleDraftCourt(session.id, court.id)}
                              className={`rounded-full px-3 py-1.5 text-[11px] font-bold ${selected ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground"}`}
                            >
                              {courtLabel(court)}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">Inga banor hittades för venue.</p>
                    )}
                    <p className="text-[11px] text-muted-foreground">Valda banor blockeras för privatbokning under passets tid.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <select value={draft.is_active ? "true" : "false"} onChange={(e) => setSessionDrafts((current) => ({ ...current, [session.id]: { ...draft, is_active: e.target.value === "true" } }))} className={baseInputClass} style={inputStyle}>
                      <option value="true">Aktiv</option>
                      <option value="false">Avstängd</option>
                    </select>
                    <select value={draft.publish_status || "published"} onChange={(e) => setSessionDrafts((current) => ({ ...current, [session.id]: { ...draft, publish_status: e.target.value } }))} className={baseInputClass} style={inputStyle}>
                      <option value="published">Publicerad</option>
                      <option value="draft">Utkast</option>
                      <option value="hidden">Dold</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => saveSession(session)} disabled={updateSession.isPending} className="flex-1 rounded-xl bg-primary py-2.5 text-xs font-bold text-primary-foreground flex items-center justify-center gap-2 disabled:opacity-50">
                      <Save className="h-3.5 w-3.5" /> Spara
                    </button>
                    <button onClick={() => setEditingSessionId(null)} className="rounded-xl bg-muted px-3 py-2.5 text-xs font-bold">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
                    <CalendarDays className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold">{session.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {dayLabel(session)} · {String(session.start_time).slice(0, 5)}-{String(session.end_time).slice(0, 5)}
                        </p>
                        {(session.hosts || []).length > 0 ? (
                          <p className="mt-1 text-[11px] font-semibold text-muted-foreground">
                            Playing hosts: {(session.hosts || []).map((host: HostOption) => hostOptionName(host)).join(", ")}
                          </p>
                        ) : null}
                      </div>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${session.is_active ? "bg-badge-paid/15 text-badge-paid" : "bg-destructive/15 text-destructive"}`}>
                        {session.is_active ? "Aktiv" : "Avstängd"} · {session.publish_status === "published" ? "Publicerad" : session.publish_status || "Utkast"}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
                      <div className="rounded-xl bg-muted/40 px-3 py-2">
                        <span className="block text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Program</span>
                        <span className="mt-1 block font-bold text-foreground">{session.activity_series?.name || sessionScopeLabel(session)}</span>
                      </div>
                      <div className="rounded-xl bg-muted/40 px-3 py-2">
                        <span className="block text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Biljett</span>
                        <span className="mt-1 block font-bold text-foreground">{SOLD_AS_OPTIONS.find((option) => option.key === activeDraftSoldAs)?.label}</span>
                      </div>
                      <div className="rounded-xl bg-muted/40 px-3 py-2">
                        <span className="block text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Players</span>
                        <span className="mt-1 block font-bold text-foreground">{session.capacity ? `${session.today_players_count ?? 0}/${session.capacity}` : "Saknas"}</span>
                        {(session.today_playing_hosts_registered_count ?? 0) > 0 ? (
                          <span className="mt-0.5 block text-[10px] font-semibold text-muted-foreground">
                            {session.today_playing_hosts_registered_count} playing host{session.today_playing_hosts_registered_count === 1 ? "" : "s"} registered
                          </span>
                        ) : null}
                      </div>
                      <div className="rounded-xl bg-muted/40 px-3 py-2">
                        <span className="block text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Access</span>
                        <span className="mt-1 block font-bold text-foreground">{includedLabel}</span>
                      </div>
                    </div>
                    <div className="mt-2 rounded-xl bg-muted/40 px-3 py-2 text-[11px]">
                      <span className="block text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Reserverar banor</span>
                      <span className={`mt-1 block font-bold ${session.court_ids?.length ? "text-foreground" : "text-badge-vip"}`}>
                        {selectedCourtNames(session.court_ids, venueCourts)}
                      </span>
                    </div>
                    <div className="mt-2 grid gap-2 text-[11px] sm:grid-cols-3">
                      <div className="rounded-xl bg-court-free/10 px-3 py-2 text-court-free">
                        <span className="block text-[9px] font-bold uppercase tracking-widest">Online</span>
                        <span className="mt-1 block font-black">{formatSek(online)}</span>
                      </div>
                      <div className="rounded-xl bg-primary/10 px-3 py-2 text-primary">
                        <span className="block text-[9px] font-bold uppercase tracking-widest">Desk</span>
                        <span className="mt-1 block font-black">{formatSek(desk)}</span>
                      </div>
                      <div className="rounded-xl bg-muted/40 px-3 py-2">
                        <span className="block text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Medlem</span>
                        <span className="mt-1 block font-bold text-foreground">{activeDraftIncludedInUnlimited ? "Play+ ingår" : memberAccess}</span>
                      </div>
                    </div>
                    {savedScarcityMode !== "none" ? (
                      <div className="mt-2 rounded-xl bg-badge-vip/10 px-3 py-2 text-[11px] text-badge-vip">
                        <span className="block text-[9px] font-bold uppercase tracking-widest">Tryckläge</span>
                        <span className="mt-1 block font-bold">
                          {savedScarcityMode === "early_bird"
                            ? `Tidigt pris ${savedEarlyBirdPrice ? formatSek(Number(savedEarlyBirdPrice)) : ""} · ${savedEarlyBirdSlots || 0} platser`
                            : "Kapacitet visas när passet börjar fyllas"}
                        </span>
                      </div>
                    ) : null}
                    {product && <p className="mt-2 text-[10px] text-muted-foreground">Produkt: {product.name}</p>}
                    {activeWarnings.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {activeWarnings.map((warning) => (
                          <div key={warning.message} className={`flex items-start gap-1.5 rounded-lg px-2 py-1.5 text-[10px] ${warning.blocking ? "bg-destructive/10 text-destructive" : "bg-badge-vip/10 text-badge-vip"}`}>
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                            <span>{warning.message}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 items-end">
                    <button onClick={() => startEditSession(session)} className="rounded-full bg-muted px-2.5 py-1.5 text-[10px] font-bold text-muted-foreground flex items-center gap-1">
                      <Edit3 className="h-3 w-3" /> Redigera
                    </button>
                    <button
                      onClick={() => updateSession.mutate({ sessionId: session.id, is_active: !session.is_active })}
                      className={`text-[10px] px-2 py-1 rounded-full font-semibold ${session.is_active ? "bg-badge-paid/15 text-badge-paid" : "bg-destructive/15 text-destructive"}`}
                    >
                      {session.is_active ? "Aktiv" : "Av"}
                    </button>
                    <button onClick={() => { if (confirm("Ta bort passet?")) deleteSession.mutate(session.id); }} className="text-muted-foreground/50 hover:text-destructive">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

export default AdminSchedule;
