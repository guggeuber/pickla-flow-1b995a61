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

const soldAsFromSession = (session: any): SoldAs => {
  if (!session?.product_key) return "included_only";
  if (session.product_key === "day_access") return "day_pass";
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

const draftWarnings = (draft: {
  name?: string;
  session_type?: string;
  sold_as?: SoldAs;
  product_key?: string | null;
  included_in_day_pass?: boolean;
  price_sek?: number | string | null;
  capacity?: number | string | null;
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
  const [soldAs, setSoldAs] = useState<SoldAs>("activity_ticket");
  const [includedInDayPass, setIncludedInDayPass] = useState(true);
  const [includedInUnlimited, setIncludedInUnlimited] = useState(true);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("12:00");
  const [price, setPrice] = useState("");
  const [deskPrice, setDeskPrice] = useState("");
  const [corporatePrice, setCorporatePrice] = useState("");
  const [promoPrice, setPromoPrice] = useState("");
  const [capacity, setCapacity] = useState("");

  const [editingSeriesId, setEditingSeriesId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [seriesDrafts, setSeriesDrafts] = useState<Record<string, any>>({});
  const [sessionDrafts, setSessionDrafts] = useState<Record<string, any>>({});

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
    const config = buildSessionConfig({
      soldAs,
      sessionType,
      includedInDayPass,
      includedInUnlimited,
    });
    const onlinePrice = numericPrice(price);
    const desk = numericPrice(deskPrice || onlinePrice, onlinePrice);
    const warnings = draftWarnings({
      name: sessionName,
      session_type: sessionType,
      sold_as: soldAs,
      product_key: config.product_key,
      included_in_day_pass: includedInDayPass,
      price_sek: onlinePrice,
      capacity,
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
      price_sek: onlinePrice,
      capacity: capacity ? Math.round(Number(capacity)) : null,
      access_policy: config.access_policy,
      metadata: buildPricingMetadata({
        onlinePrice,
        deskPrice: desk,
        corporatePrice,
        promoPrice,
      }),
      is_active: true,
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
        capacity: session.capacity ?? "",
        is_active: Boolean(session.is_active),
        publish_status: session.publish_status || "published",
      },
    }));
  };

  const saveSession = (session: any) => {
    const draft = sessionDrafts[session.id];
    if (!draft?.name?.trim() || !draft?.recurrence_days?.length) {
      toast.error("Passet behöver namn och minst en veckodag");
      return;
    }
    const config = buildSessionConfig({
      soldAs: draft.sold_as || "activity_ticket",
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
    }, {
      onSuccess: () => setEditingSessionId(null),
    });
  };

  const createConfig = buildSessionConfig({ soldAs, sessionType, includedInDayPass, includedInUnlimited });
  const createWarnings = draftWarnings({
    name: sessionName,
    session_type: sessionType,
    sold_as: soldAs,
    product_key: createConfig.product_key,
    included_in_day_pass: includedInDayPass,
    price_sek: numericPrice(price),
    capacity,
    publish_status: "published",
    is_active: true,
  });
  const createPreview = pricingPreview({
    onlinePrice: numericPrice(price),
    deskPrice: numericPrice(deskPrice || price, numericPrice(price)),
    corporatePrice: optionalPrice(corporatePrice),
    promoPrice: optionalPrice(promoPrice),
    soldAs,
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
        <div className="grid gap-2 sm:grid-cols-3">
          {SOLD_AS_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => {
                setSoldAs(option.key);
                if (option.key === "activity_ticket") setIncludedInDayPass(true);
                if (option.key === "day_pass") setIncludedInDayPass(true);
              }}
              className={`rounded-xl border px-3 py-2 text-left ${soldAs === option.key ? "border-primary bg-primary/10 text-foreground" : "border-border bg-muted/40 text-muted-foreground"}`}
            >
              <span className="block text-xs font-bold">{option.label}</span>
              <span className="mt-0.5 block text-[10px] leading-snug">{option.helper}</span>
            </button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground">
            Ingår i dagsmedlemskap
            <input
              type="checkbox"
              checked={includedInDayPass}
              disabled={soldAs === "day_pass"}
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
          const activeDraftSoldAs = (draft.sold_as || soldAsFromSession(session)) as SoldAs;
          const activeDraftIncludedInDayPass = Boolean(draft.included_in_day_pass ?? session.access_policy?.allows_day_access);
          const activeDraftIncludedInUnlimited = Boolean(draft.included_in_unlimited ?? (session.access_policy?.member_benefit_key === "open_play_unlimited"));
          const activeDraftConfig = buildSessionConfig({
            soldAs: activeDraftSoldAs,
            sessionType: draft.session_type || session.session_type || "open_play",
            includedInDayPass: activeDraftIncludedInDayPass,
            includedInUnlimited: activeDraftIncludedInUnlimited,
          });
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
                    {SOLD_AS_OPTIONS.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setSessionDrafts((current) => ({
                          ...current,
                          [session.id]: {
                            ...draft,
                            sold_as: option.key,
                            included_in_day_pass: option.key === "day_pass" ? true : draft.included_in_day_pass,
                          },
                        }))}
                        className={`rounded-xl border px-3 py-2 text-left ${activeDraftSoldAs === option.key ? "border-primary bg-primary/10 text-foreground" : "border-border bg-muted/40 text-muted-foreground"}`}
                      >
                        <span className="block text-xs font-bold">{option.label}</span>
                        <span className="mt-0.5 block text-[10px] leading-snug">{option.helper}</span>
                      </button>
                    ))}
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
                        <span className="block text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Kapacitet</span>
                        <span className="mt-1 block font-bold text-foreground">{session.capacity ? `${session.capacity} platser` : "Saknas"}</span>
                      </div>
                      <div className="rounded-xl bg-muted/40 px-3 py-2">
                        <span className="block text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Access</span>
                        <span className="mt-1 block font-bold text-foreground">{includedLabel}</span>
                      </div>
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
