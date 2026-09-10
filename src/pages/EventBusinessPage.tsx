import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Building2, CalendarHeart, Loader2, Mail } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { PicklaTopBar } from "@/components/PicklaTopBar";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/api";
import { picklaBusinessContactHref } from "@/lib/corporatePublic";

export default function EventBusinessPage() {
  const [params] = useSearchParams();
  const slug = params.get("v") || "pickla-arena-sthlm";
  const { data, isLoading } = useQuery({
    queryKey: ["public-corporate-companies", slug],
    queryFn: () => apiGet<{ companies: Array<{ company_name: string; slug: string; public_intro: string | null }> }>(
      "api-corporate",
      "public-companies",
      { venueSlug: slug },
      { auth: "omit", publicRead: { maxRetries: 1 } },
    ),
  });
  const companies = data?.companies || [];

  return <div className="min-h-[100dvh] bg-[#fffaf7] text-neutral-950">
    <PicklaTopBar slug={slug} background="#fffaf7" />
    <main className="mx-auto w-full max-w-md px-5 pb-16 pt-[calc(env(safe-area-inset-top,0px)+112px)]">
      <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#ed3f8f]">Event & företag</p>
      <h1 className="mt-2 text-[34px] font-black leading-[0.98] tracking-[-0.04em]">Spela, möts och bygg något tillsammans.</h1>
      <p className="mt-4 text-sm leading-relaxed text-neutral-500">Välj om du vill planera ett enskilt event eller starta en dialog om ett bredare samarbete med Pickla.</p>

      <div className="mt-8 grid gap-4">
        <article className="rounded-[24px] border border-black/10 bg-white p-5">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#fff2f7] text-[#b41663]"><CalendarHeart className="h-5 w-5" /></span>
          <p className="mt-5 text-[10px] font-black uppercase tracking-[0.18em] text-[#ed3f8f]">Planera ett event</p>
          <h2 className="mt-2 text-2xl font-black">Företag, team och privata grupper</h2>
          <p className="mt-3 text-sm leading-relaxed text-neutral-500">Berätta ungefär vad ni vill göra. Picklas befintliga eventförfrågan hjälper er vidare med aktivitet, tider, mat, ytor och offert.</p>
          <Button asChild size="lg" className="mt-5 w-full rounded-full bg-neutral-950 font-black text-white">
            <Link to={`/book/group?v=${encodeURIComponent(slug)}`}>Starta eventförfrågan <ArrowRight className="h-4 w-4" /></Link>
          </Button>
        </article>

        <article className="rounded-[24px] border border-black/10 bg-white p-5">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#effcf4] text-[#147a45]"><Building2 className="h-5 w-5" /></span>
          <p className="mt-5 text-[10px] font-black uppercase tracking-[0.18em] text-[#147a45]">Företag med Pickla</p>
          <h2 className="mt-2 text-2xl font-black">Hitta ert företagsupplägg</h2>
          <p className="mt-3 text-sm leading-relaxed text-neutral-500">Företag med ett aktivt, publikt Pickla-upplägg visas här. Du behöver ingen sökning – välj företaget i listan.</p>
          {isLoading ? <div className="grid min-h-24 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-[#147a45]" /></div> : companies.length > 0 ? <div className="mt-5 grid gap-2">{companies.map((company) => <Link key={company.slug} to={`/foretag/${company.slug}`} className="flex min-h-14 items-center justify-between rounded-2xl border border-black/10 px-4 font-black transition-colors hover:bg-[#effcf4]">{company.company_name}<ArrowRight className="h-4 w-4" /></Link>)}</div> : <p className="mt-5 rounded-2xl bg-neutral-50 p-4 text-sm text-neutral-500">Inga publika företagsupplägg är listade för den här anläggningen ännu.</p>}
          <Button asChild variant="ghost" size="sm" className="mt-4 w-full rounded-full text-neutral-600">
            <a href={picklaBusinessContactHref(slug)}>Prata med Pickla om företagsspel <Mail className="h-4 w-4" /></a>
          </Button>
        </article>
      </div>
    </main>
  </div>;
}
