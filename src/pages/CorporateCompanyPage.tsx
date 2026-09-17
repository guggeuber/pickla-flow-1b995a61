import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, Check, ExternalLink, Loader2, MapPin, Sparkles } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { PicklaTopBar } from "@/components/PicklaTopBar";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/api";
import {
  buildCorporatePublicMedia,
  buildCorporateSchedulePresentation,
  corporateMapsUrl,
  CorporatePublicPageContent,
  CorporatePublicSession,
  formatCorporateAddress,
  formatCorporateDate,
} from "@/lib/corporatePublicPage";
import communityImage from "@/assets/pickla-weekend-vibes.jpg";

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
  sessions: CorporatePublicSession[];
};

type PublicCorporateCompany = {
  company: { company_name: string; slug: string; public_intro: string | null };
  venue: { name: string; slug: string; address: string | null; city: string | null; postal_code: string | null; country: string; latitude: number | null; longitude: number | null };
  content?: CorporatePublicPageContent;
  series: CorporateSeries[];
};

function includedLabel(value: string) {
  const normalized = value.trim().toLocaleLowerCase();
  if (normalized === "rack" || normalized === "racket") return "Rackets";
  if (normalized === "bollar" || normalized === "ball") return "Balls";
  return value;
}

function fallbackContent(companyName: string, intro?: string | null): CorporatePublicPageContent {
  return {
    hero_headline: `${companyName} × Pickla`,
    short_intro: intro || "Your weekly pickleball hour — easy to join, social from the first rally.",
    hero_image_url: null,
    gallery_image_urls: [],
    pickleball_heading: "NEW TO PICKLEBALL? PERFECT.",
    pickleball_body: "Pickleball is a mix of tennis, badminton and table tennis. It is social, easy to start and takes about five minutes to learn. The sport has become huge in the United States and is growing rapidly across Asia.",
    pickla_heading: "WELCOME TO PICKLA",
    pickla_body: "Pickla is one of Europe’s leading dedicated pickleball communities, with eight indoor courts in Solna Business Park. Pickla combines sport, community and social experiences — whether you’re playing for the first time or already hooked.",
    practical_information: "Come as you are. Rackets and balls are ready at the venue. Indoor shoes and comfortable sportswear are recommended.",
    help_contact_text: null,
  };
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
  const schedule = useMemo(() => buildCorporateSchedulePresentation(sessions), [sessions]);
  const courtNames = useMemo(() => [...new Set(sessions.flatMap((session) => session.courts.map((court) => court.name)))], [sessions]);
  const includedItems = useMemo(() => [...new Set(data?.series.flatMap((series) => series.included_items).map(includedLabel) || [])], [data]);

  if (isLoading) return <div className="grid min-h-[100dvh] place-items-center bg-[#fffaf7]"><Loader2 className="h-6 w-6 animate-spin text-[#ed3f8f]" /></div>;
  if (isError || !data) return <div className="grid min-h-[100dvh] place-items-center bg-[#fffaf7] px-6 text-center text-neutral-950"><div><h1 className="text-3xl font-black">This company page is not available</h1><p className="mt-3 text-sm text-neutral-500">Check the link or return to Pickla.</p><Button asChild className="mt-6 rounded-full bg-neutral-950 text-white hover:bg-neutral-800"><Link to="/">Go to Pickla</Link></Button></div></div>;

  const content = data.content || fallbackContent(data.company.company_name, data.company.public_intro);
  const address = formatCorporateAddress(data.venue);
  const mapUrl = corporateMapsUrl(data.venue);
  const { heroImage, introImage, galleryImages } = buildCorporatePublicMedia(
    content.hero_image_url,
    content.gallery_image_urls,
    communityImage,
  );
  const upcoming = [...sessions].sort((a, b) => `${a.session_date} ${a.start_time}`.localeCompare(`${b.session_date} ${b.start_time}`)).slice(0, 8);

  return <div className="min-h-[100dvh] overflow-x-hidden bg-[#fffaf7] text-neutral-950">
    <PicklaTopBar slug={data.venue.slug} background="#fffaf7" />
    <main className="pb-16 pt-[calc(env(safe-area-inset-top,0px)+78px)] sm:pb-24 sm:pt-[calc(env(safe-area-inset-top,0px)+94px)]">
      <section className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6 sm:py-8">
        <div className="relative overflow-hidden rounded-[30px] bg-[#111a35] text-white shadow-[0_28px_80px_rgba(17,26,53,0.18)] sm:rounded-[42px]">
          <div aria-hidden className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-[#ed3f8f]/25 blur-3xl" />
          <div className="relative grid lg:grid-cols-[1.05fr_0.95fr]">
            <div className="flex flex-col justify-center px-6 py-8 sm:px-10 sm:py-12 lg:px-14 lg:py-16">
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-[#ff8fbe]">Your Pickla sessions</p>
              <h1 className="mt-4 max-w-2xl text-[42px] font-black leading-[0.95] tracking-[-0.055em] sm:text-6xl lg:text-7xl">{content.hero_headline}</h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-white/75 sm:text-lg">{content.short_intro}</p>
              <div className="mt-8 border-l-2 border-[#ed3f8f] pl-5">
                <p className="text-xl font-black sm:text-2xl">Pickleball every {schedule.weekdayLabel}</p>
                <p className="mt-1 text-2xl font-black text-[#ff9bc5] sm:text-3xl">{schedule.timeLabel}</p>
                <p className="mt-2 text-sm font-semibold text-white/70">{schedule.dateRangeLabel}</p>
              </div>
              {includedItems.length > 0 && <p className="mt-7 flex items-center gap-2 text-sm font-bold text-white"><Check className="h-4 w-4 text-[#ff8fbe]" />{includedItems.join(" and ")} included.</p>}
            </div>
            <div className="relative min-h-[280px] sm:min-h-[380px] lg:min-h-[600px]">
              <img data-testid="corporate-hero-image" src={heroImage} alt={`Pickleball at ${data.venue.name}`} className="absolute inset-0 h-full w-full object-cover" sizes="(max-width: 1023px) 100vw, 48vw" />
              <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[#111a35]/60 via-transparent to-transparent lg:bg-gradient-to-r lg:from-[#111a35]/20 lg:to-transparent" />
            </div>
          </div>
        </div>
      </section>

      <section aria-label="When, where and what is included" className="mx-auto w-full max-w-5xl px-5 py-10 sm:py-14">
        <div className="grid divide-y divide-black/10 border-y border-black/10 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="py-6 sm:px-7"><CalendarDays className="h-5 w-5 text-[#ed3f8f]" /><p className="mt-4 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-500">When</p><p className="mt-2 text-lg font-black">{schedule.weekdayLabel}</p><p className="text-sm text-neutral-600">{schedule.timeLabel}<br />{schedule.dateRangeLabel}</p></div>
          <div className="py-6 sm:px-7"><MapPin className="h-5 w-5 text-[#ed3f8f]" /><p className="mt-4 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-500">Where</p><p className="mt-2 text-lg font-black">{data.venue.name}</p>{address && <p className="text-sm leading-relaxed text-neutral-600">{address}</p>}<a href={mapUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm font-black text-[#b62068] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ed3f8f]">Open in maps <ExternalLink className="h-3.5 w-3.5" /></a></div>
          <div className="py-6 sm:px-7"><Check className="h-5 w-5 text-[#ed3f8f]" /><p className="mt-4 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-500">Included</p>{includedItems.length ? includedItems.map((item) => <p key={item} className="mt-2 text-lg font-black">{item}</p>) : <p className="mt-2 text-sm text-neutral-600">See the practical information below.</p>}{courtNames.length > 0 && <p className="mt-3 text-sm text-neutral-500">Your court: {courtNames.join(", ")}</p>}</div>
        </div>
      </section>

      <section className={`mx-auto grid w-full max-w-5xl gap-8 px-5 py-10 sm:items-center sm:py-16 ${introImage ? "sm:grid-cols-[0.9fr_1.1fr]" : ""}`}>
        <div><p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#147a45]">Start here</p><h2 className="mt-3 text-3xl font-black tracking-[-0.035em] sm:text-5xl">{content.pickleball_heading}</h2><p className="mt-5 whitespace-pre-line text-base leading-7 text-neutral-600">{content.pickleball_body}</p></div>
        {introImage && <div className="overflow-hidden rounded-[30px] bg-[#f2e9e5]"><img data-testid="corporate-intro-image" src={introImage} alt="A social game of pickleball" className="aspect-[4/3] w-full object-cover" loading="lazy" sizes="(max-width: 639px) 100vw, 55vw" /></div>}
      </section>

      <section className="bg-[#f2ece8] py-14 sm:py-20">
        <div className={`mx-auto grid w-full max-w-5xl gap-8 px-5 sm:items-center ${galleryImages.length ? "sm:grid-cols-[1.1fr_0.9fr]" : ""}`}>
          {galleryImages.length > 0 && <div data-testid="corporate-gallery" className="grid grid-cols-1 gap-5 sm:order-2 sm:grid-cols-2 sm:gap-3">
            {galleryImages.slice(0, 4).map((image, index) => <img key={image} data-corporate-gallery-image src={image} alt={`Pickla community ${index + 1}`} className={`${galleryImages.length === 1 ? "sm:col-span-2" : ""} aspect-[4/3] w-full rounded-[22px] object-cover`} loading="lazy" sizes="(max-width: 639px) calc(100vw - 2.5rem), 24vw" />)}
          </div>}
          <div data-testid="corporate-gallery-copy" className={galleryImages.length ? "sm:order-1" : ""}><p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#b62068]">The Pickla feeling</p><h2 className="mt-3 text-3xl font-black tracking-[-0.035em] sm:text-5xl">{content.pickla_heading}</h2><p className="mt-5 whitespace-pre-line text-base leading-7 text-neutral-600">{content.pickla_body}</p></div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-5 py-14 sm:py-20">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#ed3f8f]">Plan ahead</p><h2 className="mt-2 text-3xl font-black tracking-[-0.035em] sm:text-5xl">Upcoming dates</h2></div><p className="max-w-md text-sm leading-6 text-neutral-500">The dates below come directly from the live Pickla schedule.{schedule.hasExceptions ? " Some sessions have adjusted times; each row shows the current time." : ""}</p></div>
        <ol className="mt-8 divide-y divide-black/10 border-y border-black/10">{upcoming.map((session) => {
          const sessionTime = `${session.start_time.slice(0, 5)}–${session.end_time.slice(0, 5)}`;
          return <li key={`${session.id}:${session.session_date}`} className="grid gap-1 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-8"><p className="font-black">{formatCorporateDate(session.session_date)}</p><p className={`text-sm ${sessionTime !== schedule.primaryTime ? "font-black text-[#b62068]" : "text-neutral-600"}`}>{sessionTime}</p><p className="text-sm text-neutral-500">{session.courts.map((court) => court.name).join(", ")}</p></li>;
        })}</ol>
      </section>

      <section className="mx-auto grid w-full max-w-5xl gap-5 px-5 py-6 sm:grid-cols-2 sm:py-10">
        <div className="rounded-[28px] bg-white p-6 ring-1 ring-black/10 sm:p-8"><Sparkles className="h-5 w-5 text-[#ed3f8f]" /><p className="mt-4 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-500">Good to know</p><p className="mt-3 whitespace-pre-line text-sm leading-6 text-neutral-700">{content.practical_information}</p></div>
        <div className="rounded-[28px] bg-[#111a35] p-6 text-white sm:p-8"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#ff8fbe]">How to participate</p>{data.series.map((series) => <div key={series.id} className="mt-3 border-t border-white/15 pt-4 first:border-0 first:pt-0">{series.participation.message && <p className="text-sm leading-6 text-white/75">{series.participation.message}</p>}{series.participation.cta && <a href={series.participation.cta.url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-[#ed3f8f] px-5 text-sm font-black text-white transition-colors hover:bg-[#d72f7d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#111a35] active:bg-[#bd2468]">{series.participation.cta.label}<ExternalLink className="ml-2 h-4 w-4" /></a>}</div>)}{content.help_contact_text && <p className="mt-5 border-t border-white/15 pt-4 text-sm leading-6 text-white/75">{content.help_contact_text}</p>}</div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-5 py-10"><div className="flex flex-col gap-6 rounded-[30px] border border-black/10 bg-white p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8"><div><p className="flex items-center gap-2 text-base font-black"><MapPin className="h-4 w-4 text-[#ed3f8f]" />{data.venue.name}</p>{address && <p className="mt-2 text-sm text-neutral-500">{address}</p>}</div><Link to={`/today?v=${encodeURIComponent(data.venue.slug)}`} className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#111a35] px-6 text-sm font-black text-white transition-colors hover:bg-[#202b50] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ed3f8f] focus-visible:ring-offset-2 active:bg-[#0b1124] active:text-white">Discover more at Pickla <ArrowRight className="ml-2 h-4 w-4 text-current" /></Link></div></section>
    </main>
  </div>;
}
