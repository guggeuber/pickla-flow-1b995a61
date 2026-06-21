import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

export function useAdminCheck() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["admin-check", session?.user.id, session?.access_token],
    enabled: !!session?.access_token,
    queryFn: () => apiGet("api-admin", "check"),
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
}

export function useAdminVenues() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["admin-venues", session?.user.id, session?.access_token],
    enabled: !!session?.access_token,
    queryFn: () => apiGet("api-admin", "venues"),
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function useAdminStats(venueId: string | undefined) {
  return useQuery({
    queryKey: ["admin-stats", venueId],
    enabled: !!venueId,
    queryFn: () => apiGet("api-admin", "stats", { venueId: venueId! }),
    refetchInterval: 30000, // refresh every 30s
  });
}

export function useAdminVenue(venueId: string | undefined) {
  return useQuery({
    queryKey: ["admin-venue", venueId],
    enabled: !!venueId,
    queryFn: () => apiGet("api-admin", "venue", { venueId: venueId! }),
  });
}

export function useAdminStaff(venueId: string | undefined) {
  return useQuery({
    queryKey: ["admin-staff", venueId],
    enabled: !!venueId,
    queryFn: () => apiGet("api-admin", "staff", { venueId: venueId! }),
  });
}

export function useAdminCourts(venueId: string | undefined) {
  return useQuery({
    queryKey: ["admin-courts", venueId],
    enabled: !!venueId,
    queryFn: () => apiGet("api-admin", "courts", { venueId: venueId! }),
  });
}

export function useAdminHours(venueId: string | undefined) {
  return useQuery({
    queryKey: ["admin-hours", venueId],
    enabled: !!venueId,
    queryFn: () => apiGet("api-admin", "hours", { venueId: venueId! }),
  });
}

export function useAdminPricing(venueId: string | undefined) {
  return useQuery({
    queryKey: ["admin-pricing", venueId],
    enabled: !!venueId,
    queryFn: () => apiGet("api-admin", "pricing", { venueId: venueId! }),
  });
}

export function useAdminLinks(venueId: string | undefined) {
  return useQuery({
    queryKey: ["admin-links", venueId],
    enabled: !!venueId,
    queryFn: () => apiGet("api-admin", "links", { venueId: venueId! }),
  });
}

export function useAdminHistory(venueId: string | undefined) {
  return useQuery({
    queryKey: ["admin-history", venueId],
    enabled: !!venueId,
    queryFn: () => apiGet<{ date: string; revenue: number; bookings: number; passes: number }[]>("api-admin", "history", { venueId: venueId! }),
    refetchInterval: 60000,
  });
}

export type AdminLedgerEntry = {
  id: string;
  source_type: string;
  source_label: string;
  source_id: string;
  accounting_date: string;
  occurred_at: string;
  customer_id?: string | null;
  customer_name?: string | null;
  amount_inc_vat_minor: number;
  vat_amount_minor: number;
  amount_sek: number;
  vat_sek: number;
  payment_status: string;
  payment_method?: string | null;
  stripe_session_id?: string | null;
  receipt_number?: string | null;
  booking_receipt_id?: string | null;
  receipt?: {
    id: string;
    customer_id?: string | null;
    user_id?: string | null;
    receipt_number: string;
    customer_name?: string | null;
    customer_email?: string | null;
    customer_phone?: string | null;
    product_description?: string | null;
    purchase_type?: string | null;
    total_inc_vat_sek?: number | null;
    vat_amount_sek?: number | null;
    vat_rate?: number | null;
    payment_method?: string | null;
    payment_status?: string | null;
    stripe_session_id?: string | null;
    stripe_payment_intent_id?: string | null;
    issued_at?: string | null;
  } | null;
  metadata?: Record<string, unknown>;
};

export type AdminLedgerPeriodSummary = {
  ledger: {
    total_minor: number;
    vat_minor: number;
    count: number;
    channels?: {
      pickla_minor: number;
      pickla_count: number;
      zettle_minor: number;
      zettle_count: number;
      total_minor: number;
    };
  };
  receipts: { total_minor: number; count: number };
  delta_minor: number;
};

export type AdminRevenueLedger = {
  date: string;
  entries: AdminLedgerEntry[];
  by_type: Array<{ source_type: string; label: string; count: number; total_minor: number; total_sek: number }>;
  selected: AdminLedgerPeriodSummary;
  summary: {
    today: AdminLedgerPeriodSummary;
    yesterday: AdminLedgerPeriodSummary;
    month: AdminLedgerPeriodSummary;
  };
};

export function useAdminRevenueLedger(venueId: string | undefined, date: string | undefined) {
  return useQuery({
    queryKey: ["admin-revenue-ledger", venueId, date],
    enabled: !!venueId && !!date,
    queryFn: () => apiGet<AdminRevenueLedger>("api-admin", "revenue-ledger", { venueId: venueId!, date: date! }),
    refetchInterval: 60000,
  });
}

export type AdminZettleStatus = {
  configured: boolean;
  auth_mode: "api_key" | "oauth" | "unconfigured" | string;
  connected: boolean;
  redirect_uri: string;
  required_secrets: string[];
  connection?: {
    id: string;
    venue_id: string;
    status: string;
    organization_uuid?: string | null;
    zettle_user_uuid?: string | null;
    token_expires_at?: string | null;
    scopes?: string[] | null;
    last_import_started_at?: string | null;
    last_import_finished_at?: string | null;
    last_import_from?: string | null;
    last_import_to?: string | null;
    last_import_count?: number | null;
    last_import_error?: string | null;
    updated_at?: string | null;
    created_at?: string | null;
  } | null;
};

export function useAdminZettleStatus(venueId: string | undefined) {
  return useQuery({
    queryKey: ["admin-zettle-status", venueId],
    enabled: !!venueId,
    queryFn: () => apiGet<AdminZettleStatus>("api-admin", "zettle-status", { venueId: venueId! }),
    refetchInterval: 60000,
  });
}

export function useAdminZettleConnect(venueId: string | undefined) {
  return useMutation({
    mutationFn: (returnUrl: string) =>
      apiPost<{ authorization_url: string; redirect_uri: string; expires_at: string }>(
        "api-admin",
        `zettle-connect?venueId=${venueId}`,
        { returnUrl }
      ),
  });
}

export function useAdminZettleImport(venueId: string | undefined, date: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiPost<{ date: string; imported_count: number; ledger_source_type: string }>(
        "api-admin",
        `zettle-import?venueId=${venueId}`,
        { date }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-revenue-ledger", venueId, date] });
      queryClient.invalidateQueries({ queryKey: ["admin-zettle-status", venueId] });
    },
  });
}

export type AdminCalendarItem = {
  id: string;
  source_id: string;
  source_ids?: string[];
  date: string;
  time: string;
  end_time?: string | null;
  title: string;
  kind: "activity" | "event" | "drift" | "block" | string;
  tone: "lime" | "magenta" | "sun" | "danger" | string;
  moduleTarget?: string | null;
  activity_session_id?: string;
  session_type?: string;
  registrations_count?: number;
  override_status?: string | null;
  price_sek?: number;
  online_price_sek?: number;
  desk_price_sek?: number;
  pricing_channel_mode?: string | null;
  capacity?: number | null;
  planning_status?: string | null;
  visibility?: string | null;
  status?: string | null;
  resource_name?: string | null;
  booking_group_key?: string;
  venue_id?: string | null;
  customer_id?: string | null;
  user_id?: string | null;
  customer_user_id?: string | null;
  booking_refs?: string[];
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  courts?: Array<{ id?: string | null; name?: string | null; court_number?: number | null; sport_type?: string | null }>;
  court_name?: string | null;
  amount_sek?: number | null;
  payment_status?: string | null;
  payment_method?: string | null;
  receipt_number?: string | null;
  booking_receipt_id?: string | null;
  checked_in?: boolean | null;
  checked_in_at?: string | null;
  checked_in_count?: number | null;
  notes?: string | null;
  access_code?: string | null;
  stripe_session_id?: string | null;
};

export type AdminCalendarResponse = {
  from: string;
  to: string;
  dates: string[];
  items: AdminCalendarItem[];
};

export function useAdminCalendar(venueId: string | undefined, from: string | undefined, to: string | undefined) {
  return useQuery({
    queryKey: ["admin-calendar", venueId, from, to],
    enabled: !!venueId && !!from && !!to,
    queryFn: () => apiGet<AdminCalendarResponse>("api-admin", "calendar", { venueId: venueId!, from: from!, to: to! }),
    refetchInterval: 60000,
  });
}

export type AdminAttentionItem = {
  id: string;
  kind: "lead" | "drift" | "event" | "block";
  tone: "warn" | "info";
  title: string;
  meta: string;
  href?: string | null;
  moduleTarget?: string | null;
};

export function useAdminAttention(venueId: string | undefined) {
  return useQuery({
    queryKey: ["admin-attention", venueId],
    enabled: !!venueId,
    queryFn: () => apiGet<AdminAttentionItem[]>("api-admin", "attention", { venueId: venueId! }),
    refetchInterval: 60000,
  });
}

export type AdminAgentInboxItem = {
  id: string;
  activity_id: string;
  lead_id: string;
  lead_name: string;
  event_date?: string | null;
  event_time?: string | null;
  summary: string;
  risk: "low" | "medium" | "high" | string;
  capacity_ok: boolean;
  next_action: string;
  affected_registrations: number;
  created_at: string;
  moduleTarget?: string | null;
};

export function useAdminAgentInbox(venueId: string | undefined) {
  return useQuery({
    queryKey: ["admin-agent-inbox", venueId],
    enabled: !!venueId,
    queryFn: () => apiGet<AdminAgentInboxItem[]>("api-admin", "agent-inbox", { venueId: venueId! }),
    refetchInterval: 60000,
  });
}

export type AdminTodaysPlanItem = {
  id: string;
  source_id?: string;
  source_ids?: string[];
  time: string;
  end_time?: string | null;
  title: string;
  kind: string;
  tone: "electric" | "lime" | "magenta" | "sun" | "danger";
  href?: string | null;
  moduleTarget?: string | null;
  booking_group_key?: string;
  venue_id?: string | null;
  customer_id?: string | null;
  user_id?: string | null;
  customer_user_id?: string | null;
  booking_refs?: string[];
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  courts?: Array<{ id?: string | null; name?: string | null; court_number?: number | null; sport_type?: string | null }>;
  court_name?: string | null;
  amount_sek?: number | null;
  payment_status?: string | null;
  payment_method?: string | null;
  receipt_number?: string | null;
  booking_receipt_id?: string | null;
  checked_in?: boolean | null;
  checked_in_at?: string | null;
  checked_in_count?: number | null;
  notes?: string | null;
  access_code?: string | null;
  stripe_session_id?: string | null;
};

export function useAdminTodaysPlan(venueId: string | undefined, date: string | undefined) {
  return useQuery({
    queryKey: ["admin-todays-plan", venueId, date],
    enabled: !!venueId && !!date,
    queryFn: () => apiGet<AdminTodaysPlanItem[]>("api-admin", "todays-plan", { venueId: venueId!, date: date! }),
    refetchInterval: 60000,
  });
}

export function useAdminMutation(venueId: string | undefined) {
  const qc = useQueryClient();

  const invalidate = (key: string) => () => {
    qc.invalidateQueries({ queryKey: [`admin-${key}`, venueId] });
    qc.invalidateQueries({ queryKey: ["admin-stats", venueId] });
  };

  const addStaff = useMutation({
    mutationFn: (body: { email: string; role: string }) =>
      apiPost("api-admin", "staff", { ...body, venueId }),
    onSuccess: invalidate("staff"),
  });

  const updateStaff = useMutation({
    mutationFn: (body: { staffId: string; role?: string; isActive?: boolean }) =>
      apiPatch("api-admin", "staff", body),
    onSuccess: invalidate("staff"),
  });

  const addCourt = useMutation({
    mutationFn: (body: { name: string; court_number: number; court_type?: string; sport_type?: string; hourly_rate?: number }) =>
      apiPost("api-admin", "courts", { ...body, venueId }),
    onSuccess: invalidate("courts"),
  });

  const updateCourt = useMutation({
    mutationFn: (body: { courtId: string; [key: string]: any }) =>
      apiPatch("api-admin", "courts", body),
    onSuccess: invalidate("courts"),
  });

  const saveHours = useMutation({
    mutationFn: (body: { dayOfWeek: number; openTime: string; closeTime: string; isClosed?: boolean }) =>
      apiPost("api-admin", "hours", { ...body, venueId }),
    onSuccess: invalidate("hours"),
  });

  const addPricing = useMutation({
    mutationFn: (body: { name: string; type: string; price: number; description?: string; days_of_week?: number[]; time_from?: string; time_to?: string }) =>
      apiPost("api-admin", "pricing", { ...body, venueId }),
    onSuccess: invalidate("pricing"),
  });

  const updatePricing = useMutation({
    mutationFn: (body: { ruleId: string; [key: string]: any }) =>
      apiPatch("api-admin", "pricing", body),
    onSuccess: invalidate("pricing"),
  });

  const deletePricing = useMutation({
    mutationFn: (ruleId: string) =>
      apiDelete("api-admin", `pricing?ruleId=${ruleId}`),
    onSuccess: invalidate("pricing"),
  });

  const addLink = useMutation({
    mutationFn: (body: { title: string; url: string; icon?: string; color?: string; description?: string; member_count?: string; image_url?: string; sort_order?: number }) =>
      apiPost("api-admin", venueId ? `links?venueId=${venueId}` : "links", { ...body, venueId }),
    onSuccess: invalidate("links"),
  });

  const updateLink = useMutation({
    mutationFn: (body: { linkId: string; [key: string]: any }) =>
      apiPatch("api-admin", venueId ? `links?venueId=${venueId}` : "links", body),
    onSuccess: invalidate("links"),
  });

  const deleteLink = useMutation({
    mutationFn: (linkId: string) =>
      apiDelete("api-admin", venueId ? `links?venueId=${venueId}` : "links", { linkId }),
    onSuccess: invalidate("links"),
  });

  const reorderLinks = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      await Promise.all(orderedIds.map((id, i) =>
        apiPatch("api-admin", venueId ? `links?venueId=${venueId}` : "links", { linkId: id, sort_order: i })
      ));
    },
    onSuccess: invalidate("links"),
  });

  const updateVenue = useMutation({
    mutationFn: (body: Record<string, any>) =>
      apiPatch("api-admin", "venue", body),
    onSuccess: invalidate("venue"),
  });

  const createVenue = useMutation({
    mutationFn: (body: { name: string; slug: string; city?: string; address?: string }) =>
      apiPost("api-admin", "venues", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-venues"] });
    },
  });

  return {
    addStaff, updateStaff,
    addCourt, updateCourt,
    saveHours,
    addPricing, updatePricing, deletePricing,
    addLink, updateLink, deleteLink, reorderLinks,
    updateVenue, createVenue,
  };
}
