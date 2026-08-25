import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Loader2, Trophy } from "lucide-react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { PicklaTopBar } from "@/components/PicklaTopBar";
import { useAuth } from "@/hooks/useAuth";
import { fetchLeagueHome } from "@/lib/league";

export default function LeagueDiscoveryPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const slug = params.get("v") || "pickla-arena-sthlm";
  const query = useQuery({
    queryKey: ["league-home", slug, user?.id || "guest"],
    queryFn: () => fetchLeagueHome(slug),
    enabled: !authLoading,
    staleTime: 30_000,
  });

  if (authLoading || query.isLoading) {
    return <div className="grid min-h-[100dvh] place-items-center bg-white"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const seriesId = query.data?.item?.series.id;
  if (seriesId) return <Navigate replace to={`/seriespel/${encodeURIComponent(seriesId)}?v=${encodeURIComponent(slug)}`} />;

  return <div className="min-h-[100dvh] bg-[#fffaf7] text-neutral-950">
    <PicklaTopBar slug={slug} />
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col justify-center px-6 py-28 text-center" data-testid="league-discovery-empty">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#fff2f7] text-[#b41663]"><Trophy className="h-7 w-7" /></span>
      <p className="mt-6 text-xs font-black uppercase tracking-[0.18em] text-[#ed3f8f]">Seriespel</p>
      <h1 className="mt-2 text-3xl font-black">Nästa säsong kommer snart</h1>
      <p className="mt-3 text-sm leading-relaxed text-neutral-500">Det finns inget publicerat Seriespel att visa just nu. När anmälan öppnar hittar du säsongen här.</p>
      <button type="button" onClick={() => navigate(`/today?v=${encodeURIComponent(slug)}`)} className="mt-7 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-neutral-950 px-5 text-sm font-black text-white">Se dagens aktiviteter <ArrowRight className="h-4 w-4" /></button>
    </main>
  </div>;
}
