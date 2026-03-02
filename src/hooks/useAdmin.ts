import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPatch } from "@/lib/api";

export function useAdminCheck() {
  return useQuery({
    queryKey: ["admin-check"],
    queryFn: () => apiGet("api-admin", "check"),
    retry: false,
  });
}

export function useAdminVenues() {
  return useQuery({
    queryKey: ["admin-venues"],
    queryFn: () => apiGet("api-admin", "venues"),
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
    mutationFn: (body: { name: string; court_number: number; court_type?: string; hourly_rate?: number }) =>
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
    mutationFn: (body: { name: string; type: string; price: number; description?: string }) =>
      apiPost("api-admin", "pricing", { ...body, venueId }),
    onSuccess: invalidate("pricing"),
  });

  const updatePricing = useMutation({
    mutationFn: (body: { ruleId: string; [key: string]: any }) =>
      apiPatch("api-admin", "pricing", body),
    onSuccess: invalidate("pricing"),
  });

  const addLink = useMutation({
    mutationFn: (body: { title: string; url: string; icon?: string; color?: string; description?: string; member_count?: string; sort_order?: number }) =>
      apiPost("api-admin", "links", { ...body, venueId }),
    onSuccess: invalidate("links"),
  });

  const updateLink = useMutation({
    mutationFn: (body: { linkId: string; [key: string]: any }) =>
      apiPatch("api-admin", "links", body),
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
    addPricing, updatePricing,
    addLink, updateLink,
    updateVenue, createVenue,
  };
}
