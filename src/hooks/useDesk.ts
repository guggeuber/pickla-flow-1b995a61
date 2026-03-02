import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function useVenueForStaff() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["staff-venue", user?.id],
    enabled: !!user,
    queryFn: async () => {
      // First check venue_staff for the user
      const { data: staffEntry, error } = await supabase
        .from("venue_staff")
        .select("venue_id, role, venues(id, name, slug, primary_color, logo_url)")
        .eq("user_id", user!.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return staffEntry;
    },
  });
}

export function useVenueCourts(venueId: string | undefined) {
  return useQuery({
    queryKey: ["venue-courts", venueId],
    enabled: !!venueId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("venue_courts")
        .select("*")
        .eq("venue_id", venueId!)
        .order("court_number");
      if (error) throw error;
      return data;
    },
  });
}

export function useTodayBookings(venueId: string | undefined) {
  return useQuery({
    queryKey: ["today-bookings", venueId],
    enabled: !!venueId,
    refetchInterval: 30000, // refresh every 30s
    queryFn: async () => {
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
      const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();

      const { data, error } = await supabase
        .from("bookings")
        .select("*, venue_courts(name, court_number)")
        .eq("venue_id", venueId!)
        .gte("start_time", startOfDay)
        .lt("start_time", endOfDay)
        .order("start_time");

      if (error) throw error;
      return data;
    },
  });
}

export function useTodayRevenue(venueId: string | undefined) {
  return useQuery({
    queryKey: ["today-revenue", venueId],
    enabled: !!venueId,
    refetchInterval: 60000,
    queryFn: async () => {
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();

      const { data: bookings } = await supabase
        .from("bookings")
        .select("total_price")
        .eq("venue_id", venueId!)
        .gte("start_time", startOfDay)
        .in("status", ["confirmed", "completed"]);

      const { data: dayPasses } = await supabase
        .from("day_passes")
        .select("price")
        .eq("venue_id", venueId!)
        .eq("valid_date", today.toISOString().split("T")[0])
        .eq("status", "active");

      const bookingRevenue = bookings?.reduce((sum, b) => sum + (b.total_price || 0), 0) || 0;
      const passRevenue = dayPasses?.reduce((sum, p) => sum + (p.price || 0), 0) || 0;

      return {
        total: bookingRevenue + passRevenue,
        bookings: bookingRevenue,
        dayPasses: passRevenue,
        bookingCount: bookings?.length || 0,
        passCount: dayPasses?.length || 0,
      };
    },
  });
}
