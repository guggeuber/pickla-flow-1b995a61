import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Loader2 } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PicklaTopBar } from "@/components/PicklaTopBar";
import { formatCommerceMoney } from "@/lib/commerce";
import { customerCourtPriceLabel, customerFacingDescription } from "@/lib/customerPricing";
import { fetchPricesFirstVisitEligibility, fetchPublicPrices } from "@/lib/publicPrices";
import { useVerifiedAccount } from "@/hooks/useVerifiedAccount";

function PriceRow({ title, description, price, action }: { title: string; description?: string | null; price?: string | null; action?: () => void }) {
  return <button type="button" onClick={action} disabled={!action} className="flex w-full items-start justify-between gap-4 border-b border-black/10 py-4 text-left disabled:cursor-default"><span className="min-w-0"><span className="block text-[15px] font-black">{title}</span>{description ? <span className="mt-1 block text-[13px] leading-relaxed text-neutral-500">{description}</span> : null}</span><span className="flex shrink-0 items-center gap-2 text-sm font-black">{price}{action ? <ArrowRight className="h-4 w-4 text-neutral-400" /> : null}</span></button>;
}

export default function PricesMembershipPage() {
  const [params] = useSearchParams(); const navigate = useNavigate();
  const slug = params.get("v") || "pickla-arena-sthlm";
  const verifiedAccount = useVerifiedAccount();
  const prices = useQuery({ queryKey: ["public-prices", slug], queryFn: () => fetchPublicPrices(slug) });
  const firstVisitEligibility = useQuery({
    queryKey: ["prices-first-visit-eligibility", verifiedAccount.verifiedUserId],
    enabled: verifiedAccount.isVerified && prices.data?.first_visit.available === true,
    queryFn: fetchPricesFirstVisitEligibility,
  });
  const loading = prices.isLoading;
  const dayPasses = prices.data?.day_passes || [];
  const punchCards = prices.data?.punch_cards || [];
  const hourly = [...(prices.data?.court_pricing || [])].sort((a, b) => {
    const weekendA = (a.days_of_week || []).length > 0 && (a.days_of_week || []).every((day) => day === 0 || day === 6);
    const weekendB = (b.days_of_week || []).length > 0 && (b.days_of_week || []).every((day) => day === 0 || day === 6);
    if (weekendA !== weekendB) return weekendA ? 1 : -1;
    return String(a.time_from || "00:00").localeCompare(String(b.time_from || "00:00"));
  });
  const courseItems = prices.data?.courses || [];
  const publicFirstVisit = prices.data?.first_visit;
  const anonymousAccount = verifiedAccount.state === "anonymous" || verifiedAccount.state === "terminal_failure";
  const showFirstVisit = publicFirstVisit?.available === true && (
    anonymousAccount || (verifiedAccount.isVerified && firstVisitEligibility.data?.eligible === true)
  );
  const introRoute = publicFirstVisit?.route || `/today?v=${encodeURIComponent(slug)}`;
  return <div className="min-h-dvh bg-[#fffaf7] text-neutral-950"><PicklaTopBar slug={slug} background="#fffaf7" /><main className="mx-auto max-w-md px-5 pb-16 pt-[calc(env(safe-area-inset-top,0px)+104px)]"><p className="text-[11px] font-black uppercase tracking-[0.2em] text-neutral-400">Priser & medlemskap</p><h1 className="mt-2 text-[34px] font-black leading-none tracking-[-0.04em]">Spela på ditt sätt.</h1>
    {loading ? <Loader2 className="mx-auto mt-12 h-6 w-6 animate-spin" /> : <div className="mt-8 space-y-8">
      {showFirstVisit && publicFirstVisit?.title ? <section><PriceRow title={publicFirstVisit.title} description={publicFirstVisit.description} action={() => navigate(introRoute)} /></section> : null}
      <section><h2 className="text-lg font-black">Dagspass</h2>{dayPasses.map((product) => <PriceRow key={product.id} title={product.name} description={product.description} price={formatCommerceMoney(product.base_price_sek * 100)} action={() => navigate(`/today?v=${encodeURIComponent(slug)}`)} />)}</section>
      <section><h2 className="text-lg font-black">Medlemskap</h2>{(prices.data?.memberships || []).map((tier) => <PriceRow key={tier.id} title={tier.name} description={customerFacingDescription(tier.description, "Medlemsförmåner och priser visas innan köp.")} price={tier.monthly_price != null ? `${tier.monthly_price} kr/mån` : null} action={() => navigate(`/membership?v=${encodeURIComponent(slug)}`)} />)}</section>
      <section><h2 className="text-lg font-black">Banpriser</h2>{hourly.map((rule) => <PriceRow key={rule.id} title={customerCourtPriceLabel(rule)} description={rule.time_from && rule.time_to ? `${String(rule.time_from).slice(0, 5)}–${String(rule.time_to).slice(0, 5)}` : "Pris per bana och timme."} price={`${rule.price} kr/tim`} action={() => navigate(`/book?v=${encodeURIComponent(slug)}`)} />)}</section>
      {courseItems.length ? <section><h2 className="text-lg font-black">Kurser</h2>{courseItems.map((course) => <PriceRow key={course.id} title={course.name} description={course.description} price={formatCommerceMoney(course.base_price_sek * 100)} action={() => navigate(`/course/${course.id}?v=${encodeURIComponent(slug)}`)} />)}</section> : null}
      {punchCards.length ? <section><h2 className="text-lg font-black">Klippkort</h2>{punchCards.map((product) => <PriceRow key={product.id} title={product.name} description={customerFacingDescription(product.description, "Flera speltillfällen i ett köp.")} price={formatCommerceMoney(product.base_price_sek * 100)} action={() => navigate(`/shop?v=${encodeURIComponent(slug)}`)} />)}</section> : null}
    </div>}
  </main></div>;
}
