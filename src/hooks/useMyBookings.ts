import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/hooks/useAuth";
import { apiGet } from "@/lib/api";

export const MY_BOOKINGS_QUERY_KEY = "my-bookings";

export function useMyBookings() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [MY_BOOKINGS_QUERY_KEY, user?.id],
    enabled: !!user,
    queryFn: async () => {
      const response = await apiGet<{ items: Record<string, unknown>[] }>("api-bookings", "my-bookings");
      return response.items || [];
    },
  });
}
