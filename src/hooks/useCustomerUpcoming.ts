import { useMemo } from "react";

import { useMyBookings } from "@/hooks/useMyBookings";
import { useMyCourses } from "@/hooks/useMyCourses";
import { useMySessionRegistrations } from "@/hooks/useMySessionRegistrations";
import { useMyLeagues } from "@/hooks/useMyLeagues";
import { buildCustomerUpcoming } from "@/lib/customerUpcoming";

export function useCustomerUpcoming(venueSlug: string, enabled = true) {
  const bookings = useMyBookings(enabled);
  const registrations = useMySessionRegistrations(enabled);
  const courses = useMyCourses(enabled);
  const leagues = useMyLeagues(enabled);
  const items = useMemo(() => buildCustomerUpcoming({
    bookings: bookings.data || [],
    registrations: registrations.data || [],
    courses: courses.data?.items || [],
    leagues: leagues.data?.items || [],
    venueSlug,
  }), [bookings.data, courses.data, leagues.data, registrations.data, venueSlug]);

  return {
    data: items,
    isLoading: bookings.isLoading || registrations.isLoading || courses.isLoading || leagues.isLoading,
    isError: bookings.isError || registrations.isError || courses.isError || leagues.isError,
  };
}
