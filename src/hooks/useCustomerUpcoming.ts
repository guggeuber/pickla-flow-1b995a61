import { useMemo } from "react";

import { useMyBookings } from "@/hooks/useMyBookings";
import { useMyCourses } from "@/hooks/useMyCourses";
import { useMySessionRegistrations } from "@/hooks/useMySessionRegistrations";
import { buildCustomerUpcoming } from "@/lib/customerUpcoming";

export function useCustomerUpcoming(venueSlug: string, enabled = true) {
  const bookings = useMyBookings();
  const registrations = useMySessionRegistrations(enabled);
  const courses = useMyCourses(enabled);
  const items = useMemo(() => buildCustomerUpcoming({
    bookings: bookings.data || [],
    registrations: registrations.data || [],
    courses: courses.data?.items || [],
    venueSlug,
  }), [bookings.data, courses.data, registrations.data, venueSlug]);

  return {
    data: items,
    isLoading: bookings.isLoading || registrations.isLoading || courses.isLoading,
    isError: bookings.isError || registrations.isError || courses.isError,
  };
}
