import { ArrowRight, Building2, CalendarHeart, Mail } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { PicklaTopBar } from "@/components/PicklaTopBar";
import { Button } from "@/components/ui/button";

const B2B_EMAIL = "hello@picklaparks.com";

export function picklaBusinessContactHref(slug: string) {
  const subject = encodeURIComponent("Företag med Pickla");
  const body = encodeURIComponent(`Hej Pickla,\n\nVi vill prata om ett bredare eller återkommande företagsupplägg.\n\nAnläggning: ${slug}\n`);
  return `mailto:${B2B_EMAIL}?subject=${subject}&body=${body}`;
}

export default function EventBusinessPage() {
  const [params] = useSearchParams();
  const slug = params.get("v") || "pickla-arena-sthlm";

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
          <h2 className="mt-2 text-2xl font-black">Återkommande spel eller bredare samarbete</h2>
          <p className="mt-3 text-sm leading-relaxed text-neutral-500">För kontraktstider, återkommande aktiviteter, företagsaccess, wellbeing eller partnerskap tar vi först en personlig dialog.</p>
          <Button asChild variant="outline" size="lg" className="mt-5 w-full rounded-full border-neutral-300 font-black text-neutral-950">
            <a href={picklaBusinessContactHref(slug)}>Kontakta Pickla <Mail className="h-4 w-4" /></a>
          </Button>
          <p className="mt-3 text-xs leading-relaxed text-neutral-400">Detta öppnar e-post till Pickla. Det skapar ingen beställning, bokning eller företagsprodukt.</p>
        </article>
      </div>
    </main>
  </div>;
}
