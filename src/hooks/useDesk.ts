import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { apiGet } from "@/lib/api";
import { DateTime } from "luxon";

function todayStockholm() {
  return DateTime.now().setZone("Europe/Stockholm").toISODate()!;
}

export function useVenueForStaff() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["staff-venue", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const me = await apiGet("api-auth", "me");
      // Return first venue in the same shape as before
      const v = me.venues?.[0];
      if (!v) return null;
      return {
        venue_id: v.venue_id,
        role: v.role,
        venues: v.venues,
      };
    },
  });
}

export function useVenueCourts(venueId: string | undefined) {
  return useQuery({
    queryKey: ["venue-courts", venueId],
    enabled: !!venueId,
    queryFn: () => apiGet("api-bookings", "courts", { venueId: venueId! }),
  });
}

export function useTodayBookings(venueId: string | undefined, date?: string) {
  return useQuery({
    queryKey: ["today-bookings", venueId, date || "today"],
    enabled: !!venueId,
    refetchInterval: !date || date === todayStockholm() ? 30000 : false,
    queryFn: () => {
      return apiGet("api-bookings", "venue", { venueId: venueId!, date: date || todayStockholm() });
    },
  });
}

export function useTodayRevenue(venueId: string | undefined) {
  return useQuery({
    queryKey: ["today-revenue", venueId],
    enabled: !!venueId,
    refetchInterval: 60000,
    queryFn: () => {
      const today = todayStockholm();
      return apiGet("api-bookings", "revenue", { venueId: venueId!, date: today });
    },
  });
}
