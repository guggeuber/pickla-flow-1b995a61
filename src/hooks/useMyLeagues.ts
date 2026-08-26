import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { fetchMyLeagues } from "@/lib/league";

export function useMyLeagues(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-leagues", user?.id],
    queryFn: fetchMyLeagues,
    enabled: enabled && Boolean(user),
    staleTime: 15_000,
  });
}
