import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { ArrowRight, CalendarDays, Check, ExternalLink, Loader2, MapPin } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { PicklaTopBar } from "@/components/PicklaTopBar";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/api";
import communityImage from "@/assets/pickla-weekend-vibes.jpg";

type CorporateSession = {
  id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  occurrence_index: number | null;
  courts: Array<{ id: string; name: string; sport_type: string }>;
};

type CorporateSeries = {
  id: string;
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  included_items: string[];
  participation: {
    mode: "unconfigured" | "external" | "pickla";
    state: "not_configured" | "external_pending" | "external_ready" | "pickla_pending" | "pickla_ready";
    message: string | null;
    cta: { label: string; url: string } | null;
  };
  sessions: CorporateSession[];
};

type PublicCorporateCompany = {
  company: { company_name: string; slug: string; public_intro: string | null };
  venue: { name: string; slug: string; address: string | null; city: string | null; postal_code: string | null; country: string; latitude: number | null; longitude: number | null };
  series: CorporateSeries[];
};

function scheduleGroups(sessions: CorporateSession[]) {
  const groups = new Map<string, { weekday: string; start: string; end: string; count: number }>();
  for (const session of sessions) {
    const weekday = DateTime.fromISO(session.session_date).setLocale("sv").toFormat("cccc");
    const key = `${weekday}:${session.start_time}:${session.end_time}`;
    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else groups.set(key, { weekday: weekday.charAt(0).toUpperCase() + weekday.slice(1), start: session.start_time.slice(0, 5), end: session.end_time.slice(0, 5), count: 1 });
  }
  return [...groups.values()];
}

export default function CorporateCompanyPage() {
  const { slug = "" } = useParams();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["public-corporate-company", slug.toLowerCase()],
    enabled: Boolean(slug),
    queryFn: () => apiGet<PublicCorporateCompany>("api-corporate", "public-company", { slug }, {
      auth: "omit",
      expectedStatuses: [404],
      publicRead: { maxRetries: 1 },
    }),
  });
  const sessions = useMemo(() => data?.series.flatMap((series) => series.sessions) || [], [data]);
  const groups = useMemo(() => scheduleGroups(sessions), [sessions]);
  const courtNames = useMemo(() => [...new Set(sessions.flatMap((session) => session.courts.map((court) => court.name)))], [sessions]);
  const includedItems = useMemo(() => [...new Set(data?.series.flatMap((series) => series.included_items) || [])], [data]);

  if (isLoading) return <div className="grid min-h-[100dvh] place-items-center bg-[#fffaf7]"><Loader2 className="h-6 w-6 animate-spin text-[#ed3f8f]" /></div>;
  if (isError || !data) return <div className="grid min-h-[100dvh] place-items-center bg-[#fffaf7] px-6 text-center text-neutral-950"><div><h1 className="text-3xl font-black">Företagssidan finns inte</h1><p className="mt-3 text-sm text-neutral-500">Kontrollera länken eller gå tillbaka till Event & företag.</p><Button asChild className="mt-6 rounded-full bg-neutral-950"><Link to="/event-foretag">Event & företag</Link></Button></div></div>;

  const primarySeries = data.series[0];
  const first = sessions[0];
  const last = sessions[sessions.length - 1];
  const address = [data.venue.address, data.venue.postal_code, data.venue.city].filter(Boolean).join(", ");

  return <div className="min-h-[100dvh] bg-[#fffaf7] text-neutral-950">
    <PicklaTopBar slug={data.venue.slug} background="#fffaf7" />
    <main className="pb-20 pt-[calc(env(safe-area-inset-top,0px)+94px)]">
      <section className="mx-auto w-full max-w-5xl px-5 py-8 sm:py-12">
        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#ed3f8f]">Företag med Pickla</p>
        <h1 className="mt-3 text-[42px] font-black leading-[0.94] tracking-[-0.05em] sm:text-6xl">{data.company.company_name} <span className="text-[#ed3f8f]">×</span> Pickla</h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-neutral-600">{data.company.public_intro || primarySeries.description || `Återkommande pickleball för ${data.company.company_name}, med bana och utrustning på plats.`}</p>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          <div className="rounded-[22px] border border-black/10 bg-white p-4"><CalendarDays className="h-5 w-5 text-[#ed3f8f]" /><p className="mt-3 text-xs font-black uppercase tracking-wider">När</p>{groups.map((group) => <p key={`${group.weekday}-${group.start}`} className="mt-1 text-sm font-bold">{group.weekday}ar {group.start}–{group.end} <span className="font-normal text-neutral-400">× {group.count}</span></p>)}{first && last && <p className="mt-2 text-xs text-neutral-500">{first.session_date}–{last.session_date}</p>}</div>
          <div className="rounded-[22px] border border-black/10 bg-white p-4"><MapPin className="h-5 w-5 text-[#ed3f8f]" /><p className="mt-3 text-xs font-black uppercase tracking-wider">Var</p><p className="mt-1 text-sm font-bold">{data.venue.name}</p>{courtNames.length > 0 && <p className="text-sm text-neutral-500">{courtNames.join(", ")}</p>}</div>
          <div className="rounded-[22px] border border-black/10 bg-white p-4"><Check className="h-5 w-5 text-[#ed3f8f]" /><p className="mt-3 text-xs font-black uppercase tracking-wider">Det här ingår</p>{includedItems.length ? includedItems.map((item) => <p key={item} className="mt-1 text-sm font-bold">{item}</p>) : <p className="mt-1 text-sm text-neutral-500">Se information från företaget.</p>}</div>
        </div>

        <div className="mt-5 grid gap-3">{data.series.map((series) => <div key={series.id} className="rounded-[22px] bg-neutral-950 p-5 text-white sm:flex sm:items-center sm:justify-between sm:gap-6"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#ff86b9]">Så deltar du{data.series.length > 1 ? ` · ${series.name}` : ""}</p>{series.participation.message && <p className="mt-2 text-sm leading-relaxed text-neutral-300">{series.participation.message}</p>}</div>{series.participation.cta && <Button asChild size="lg" className="mt-4 w-full shrink-0 rounded-full bg-[#ed3f8f] font-black text-white hover:bg-[#d72f7d] sm:mt-0 sm:w-auto"><a href={series.participation.cta.url} target="_blank" rel="noopener noreferrer">{series.participation.cta.label}<ExternalLink className="ml-2 h-4 w-4" /></a></Button>}</div>)}</div>
      </section>

      <section className="mx-auto grid w-full max-w-5xl gap-6 px-5 py-10 sm:grid-cols-2 sm:items-center">
        <img src={communityImage} alt="Pickleballspelare hos Pickla" className="aspect-[4/3] w-full rounded-[28px] object-cover" />
        <div><p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#147a45]">Nytt för dig?</p><h2 className="mt-2 text-3xl font-black tracking-tight">Pickleball är lätt att börja med.</h2><p className="mt-4 text-sm leading-relaxed text-neutral-600">Det är en social racketsport med enkla grunder. Du behöver inte ha spelat tidigare – börja lugnt, håll bollen i spel och lär känna spelet tillsammans.</p><ol className="mt-5 grid gap-3 text-sm"><li className="flex gap-3"><span className="font-black text-[#ed3f8f]">1.</span>Serva underifrån och diagonalt.</li><li className="flex gap-3"><span className="font-black text-[#ed3f8f]">2.</span>Låt bollen studsa en gång på varje sida efter serven.</li><li className="flex gap-3"><span className="font-black text-[#ed3f8f]">3.</span>Spela poängen och ha kul – resten kommer snabbt.</li></ol></div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-5 py-8"><div className="rounded-[28px] border border-black/10 bg-white p-6 sm:flex sm:items-center sm:justify-between"><div><p className="flex items-center gap-2 text-sm font-black"><MapPin className="h-4 w-4 text-[#ed3f8f]" />{data.venue.name}</p>{address && <p className="mt-2 text-sm text-neutral-500">{address}</p>}</div><Button asChild variant="outline" className="mt-4 rounded-full sm:mt-0"><Link to={`/today?v=${encodeURIComponent(data.venue.slug)}`}>Upptäck mer på Pickla <ArrowRight className="ml-2 h-4 w-4" /></Link></Button></div></section>
    </main>
  </div>;
}
