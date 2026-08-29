import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Loader2 } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PicklaTopBar } from "@/components/PicklaTopBar";
import { apiGet } from "@/lib/api";
import { fetchCommerceCatalog, formatCommerceMoney } from "@/lib/commerce";
import { fetchCoursePricingCatalog } from "@/lib/courses";
import { useVenueWithHours } from "@/lib/venueStatus";
import { customerCourtPriceLabel, customerFacingDescription } from "@/lib/customerPricing";

type MembershipTier = { id: string; name: string; description?: string | null; monthly_price?: number | null };
type PricingRule = { id: string; name: string; type: string; price: number; days_of_week?: number[] | null; time_from?: string | null; time_to?: string | null };
type FirstVisitOffers = { is_first_time: boolean; has_configured_offer: boolean; items: Array<{ route: string }> };

function PriceRow({ title, description, price, action }: { title: string; description?: string | null; price?: string | null; action?: () => void }) {
  return <button type="button" onClick={action} disabled={!action} className="flex w-full items-start justify-between gap-4 border-b border-black/10 py-4 text-left disabled:cursor-default"><span className="min-w-0"><span className="block text-[15px] font-black">{title}</span>{description ? <span className="mt-1 block text-[13px] leading-relaxed text-neutral-500">{description}</span> : null}</span><span className="flex shrink-0 items-center gap-2 text-sm font-black">{price}{action ? <ArrowRight className="h-4 w-4 text-neutral-400" /> : null}</span></button>;
}

export default function PricesMembershipPage() {
  const [params] = useSearchParams(); const navigate = useNavigate();
  const slug = params.get("v") || "pickla-arena-sthlm";
  const venue = useVenueWithHours(slug); const venueId = venue.data?.id as string | undefined;
  const memberships = useQuery({ queryKey: ["price-memberships", venueId], enabled: !!venueId, queryFn: () => apiGet<MembershipTier[]>("api-memberships", "tiers", { venueId: venueId! }) });
  const pricing = useQuery({ queryKey: ["price-courts", venueId], enabled: !!venueId, queryFn: () => apiGet<PricingRule[]>("api-bookings", "pricing", { venueId: venueId! }) });
  const commerce = useQuery({ queryKey: ["price-commerce", venueId], enabled: !!venueId, queryFn: () => fetchCommerceCatalog(venueId!) });
  const courses = useQuery({ queryKey: ["price-courses", slug], queryFn: () => fetchCoursePricingCatalog(slug) });
  const firstVisit = useQuery({ queryKey: ["price-first-visit", slug], queryFn: () => apiGet<FirstVisitOffers>("api-event-public", "first-visit-offers", { v: slug }) });
  const loading = venue.isLoading || memberships.isLoading || pricing.isLoading || commerce.isLoading || courses.isLoading;
  const products = commerce.data?.products || [];
  const dayPasses = products.filter((product) => product.product_key === "day_access" || product.product_kind === "day_access");
  const punchCards = products.filter((product) => product.product_kind === "punch_card" || product.category === "punch_card");
  const hourly = (pricing.data || []).filter((rule) => rule.type === "hourly").sort((a, b) => {
    const weekendA = (a.days_of_week || []).length > 0 && (a.days_of_week || []).every((day) => day === 0 || day === 6);
    const weekendB = (b.days_of_week || []).length > 0 && (b.days_of_week || []).every((day) => day === 0 || day === 6);
    if (weekendA !== weekendB) return weekendA ? 1 : -1;
    return String(a.time_from || "00:00").localeCompare(String(b.time_from || "00:00"));
  });
  const courseItems = courses.data?.items || [];
  const introRoute = firstVisit.data?.items?.[0]?.route || `/today?v=${encodeURIComponent(slug)}`;
  return <div className="min-h-dvh bg-[#fffaf7] text-neutral-950"><PicklaTopBar slug={slug} background="#fffaf7" /><main className="mx-auto max-w-md px-5 pb-16 pt-[calc(env(safe-area-inset-top,0px)+104px)]"><p className="text-[11px] font-black uppercase tracking-[0.2em] text-neutral-400">Priser & medlemskap</p><h1 className="mt-2 text-[34px] font-black leading-none tracking-[-0.04em]">Spela på ditt sätt.</h1>
    {loading ? <Loader2 className="mx-auto mt-12 h-6 w-6 animate-spin" /> : <div className="mt-8 space-y-8">
      {firstVisit.data?.is_first_time && (firstVisit.data.items.length > 0 || !firstVisit.data.has_configured_offer) ? <section><PriceRow title={firstVisit.data.items.length ? "Första gången? Spela för 99 kr." : "Första gången? 165 kr, racket ingår — kom på Open Play ikväll."} description={firstVisit.data.items.length ? "Racket finns att låna." : null} action={() => navigate(introRoute)} /></section> : null}
      <section><h2 className="text-lg font-black">Dagspass</h2>{dayPasses.map((product) => <PriceRow key={product.id} title={product.name} description="Spela Open Play hela dagen." price={formatCommerceMoney(product.base_price_sek * 100)} action={() => navigate(`/today?v=${encodeURIComponent(slug)}`)} />)}</section>
      <section><h2 className="text-lg font-black">Medlemskap</h2>{(memberships.data || []).map((tier) => <PriceRow key={tier.id} title={tier.name} description={customerFacingDescription(tier.description, "Medlemsförmåner och priser visas innan köp.")} price={tier.monthly_price != null ? `${tier.monthly_price} kr/mån` : null} action={() => navigate(`/membership?v=${encodeURIComponent(slug)}`)} />)}</section>
      <section><h2 className="text-lg font-black">Banpriser</h2>{hourly.map((rule) => <PriceRow key={rule.id} title={customerCourtPriceLabel(rule)} description={rule.time_from && rule.time_to ? `${String(rule.time_from).slice(0, 5)}–${String(rule.time_to).slice(0, 5)}` : "Pris per bana och timme."} price={`${rule.price} kr/tim`} action={() => navigate(`/book?v=${encodeURIComponent(slug)}`)} />)}</section>
      {courseItems.length ? <section><h2 className="text-lg font-black">Kurser</h2>{courseItems.map((course) => <PriceRow key={course.id} title={course.name} description={course.format?.description} price={formatCommerceMoney(course.product.base_price_sek * 100)} action={() => navigate(`/course/${course.id}?v=${encodeURIComponent(slug)}`)} />)}</section> : null}
      {punchCards.length ? <section><h2 className="text-lg font-black">Klippkort</h2>{punchCards.map((product) => <PriceRow key={product.id} title={product.name} description={customerFacingDescription(product.description, "Flera speltillfällen i ett köp.")} price={formatCommerceMoney(product.base_price_sek * 100)} action={() => navigate(`/shop?v=${encodeURIComponent(slug)}`)} />)}</section> : null}
    </div>}
  </main></div>;
}
