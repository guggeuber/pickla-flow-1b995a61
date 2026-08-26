import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Loader2, Trophy } from "lucide-react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { PicklaTopBar } from "@/components/PicklaTopBar";
import { fetchLeagueHome } from "@/lib/league";
import { useVerifiedAccount } from "@/hooks/useVerifiedAccount";
import { resolveCustomerVenueContext } from "@/lib/customerVenue";

export default function LeagueDiscoveryPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const verifiedAccount = useVerifiedAccount();
  const slug = resolveCustomerVenueContext(params.get("v")).slug;
  const publicQuery = useQuery({
    queryKey: ["league-home-public", slug],
    queryFn: () => fetchLeagueHome(slug, { auth: "omit" }),
    staleTime: 30_000,
  });
  const personalizedQuery = useQuery({
    queryKey: ["league-home-personalized", slug, verifiedAccount.verifiedUserId],
    queryFn: () => fetchLeagueHome(slug),
    enabled: verifiedAccount.isVerified,
    staleTime: 30_000,
  });
  const home = verifiedAccount.isVerified && personalizedQuery.data
    ? personalizedQuery.data
    : publicQuery.data;

  const seriesId = home?.item?.series.id;
  if (seriesId) return <Navigate replace to={`/seriespel/${encodeURIComponent(seriesId)}?v=${encodeURIComponent(slug)}`} />;

  return <div className="min-h-[100dvh] bg-[#fffaf7] text-neutral-950">
    <PicklaTopBar slug={slug} />
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col justify-center px-6 py-28 text-center" data-testid="league-discovery-empty">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#fff2f7] text-[#b41663]"><Trophy className="h-7 w-7" /></span>
      <p className="mt-6 text-xs font-black uppercase tracking-[0.18em] text-[#ed3f8f]">Seriespel</p>
      {publicQuery.isLoading ? <><h1 className="mt-2 text-3xl font-black">Pickla Seriespel</h1><p className="mt-3 flex items-center justify-center gap-2 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Hämtar nästa säsong…</p></> : <>
      <h1 className="mt-2 text-3xl font-black">Nästa säsong kommer snart</h1>
      <p className="mt-3 text-sm leading-relaxed text-neutral-500">Det finns inget publicerat Seriespel att visa just nu. När anmälan öppnar hittar du säsongen här.</p>
      <button type="button" onClick={() => navigate(`/today?v=${encodeURIComponent(slug)}`)} className="mt-7 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-neutral-950 px-5 text-sm font-black text-white">Se dagens aktiviteter <ArrowRight className="h-4 w-4" /></button>
      </>}
    </main>
  </div>;
}
