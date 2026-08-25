import { useQuery } from "@tanstack/react-query";
import { fetchMyLeagues } from "@/lib/league";

export function useMyLeagues(enabled = true) {
  return useQuery({ queryKey: ["my-leagues"], queryFn: fetchMyLeagues, enabled, staleTime: 15_000 });
}
