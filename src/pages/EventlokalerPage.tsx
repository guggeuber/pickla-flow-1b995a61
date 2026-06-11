import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, ArrowRight, MapPin, Users, Beer, Trophy, Calendar, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import picklaLogo from "@/assets/pickla-logo.svg";
import heroPhoto from "@/assets/pickla-hero-photo.jpg";
import weekendVibes from "@/assets/pickla-weekend-vibes.jpg";

const FONT_GROTESK = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";
const SLUG = "pickla-arena-sthlm";
const CANONICAL = "https://www.playpickla.com/eventlokaler";

const SEO_TITLE = "Eventlokal Stockholm | Företagsevent, Kickoff & Teambuilding | Pickla";
const SEO_DESC = "Boka företagsevent, kickoff, AW eller teambuilding hos Pickla i Solna. 2000 kvm social sportarena med pickleball, dart, mat och bar.";

function useSeo() {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = SEO_TITLE;

    const tags: HTMLElement[] = [];
    const upsertMeta = (sel: string, attrs: Record<string, string>) => {
      let el = document.head.querySelector<HTMLElement>(sel);
      const created = !el;
      if (!el) {
        el = document.createElement("meta");
        document.head.appendChild(el);
      }
      Object.entries(attrs).forEach(([k, v]) => el!.setAttribute(k, v));
      if (created) tags.push(el!);
      return el!;
    };
    const upsertLink = (rel: string, href: string) => {
      let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
      const created = !el;
      if (!el) {
        el = document.createElement("link");
        el.rel = rel;
        document.head.appendChild(el);
      }
      el.href = href;
      if (created) tags.push(el);
      return el;
    };

    upsertMeta('meta[name="description"]', { name: "description", content: SEO_DESC });
    upsertMeta('meta[property="og:title"]', { property: "og:title", content: SEO_TITLE });
    upsertMeta('meta[property="og:description"]', { property: "og:description", content: SEO_DESC });
    upsertMeta('meta[property="og:url"]', { property: "og:url", content: CANONICAL });
    upsertMeta('meta[property="og:type"]', { property: "og:type", content: "website" });
    upsertMeta('meta[property="og:image"]', { property: "og:image", content: "https://www.playpickla.com/pwa-512x512.png" });
    upsertMeta('meta[name="twitter:card"]', { name: "twitter:card", content: "summary_large_image" });
    upsertMeta('meta[name="twitter:title"]', { name: "twitter:title", content: SEO_TITLE });
    upsertMeta('meta[name="twitter:description"]', { name: "twitter:description", content: SEO_DESC });
    upsertLink("canonical", CANONICAL);

    const ld = document.createElement("script");
    ld.type = "application/ld+json";
    ld.text = JSON.stringify([
      {
        "@context": "https://schema.org",
        "@type": "LocalBusiness",
        name: "Pickla Arena Stockholm",
        image: "https://www.playpickla.com/pwa-512x512.png",
        url: CANONICAL,
        telephone: "+46-8-000-0000",
        address: {
          "@type": "PostalAddress",
          streetAddress: "Solna Business Park",
          addressLocality: "Solna",
          postalCode: "171 54",
          addressCountry: "SE",
        },
        priceRange: "349-599 SEK/person",
        areaServed: "Stockholm",
      },
      {
        "@context": "https://schema.org",
        "@type": "EventVenue",
        name: "Pickla Arena Stockholm",
        description: SEO_DESC,
        url: CANONICAL,
        maximumAttendeeCapacity: 150,
        address: {
          "@type": "PostalAddress",
          addressLocality: "Solna",
          addressCountry: "SE",
        },
      },
    ]);
    document.head.appendChild(ld);

    return () => {
      document.title = prevTitle;
      tags.forEach((t) => t.remove());
      ld.remove();
    };
  }, []);
}

const HERO_STATS = [
  { value: "2 000", label: "kvm arena" },
  { value: "150+", label: "gäster" },
  { value: "8", label: "pickleballbanor" },
  { value: "19", label: "dartmatcher" },
];

const WHY = [
  { icon: Trophy, title: "Aktiviteter som engagerar", text: "Pickleball och dart får människor att mötas på riktigt — utan inlärningskurva." },
  { icon: Beer, title: "Mat & dryck", text: "Mat, snacks, kaffe, öl, vin och en social atmosfär från första minuten." },
  { icon: Sparkles, title: "Enkel planering", text: "Vi hjälper till med upplägg, turneringar och fullständig eventproduktion." },
  { icon: MapPin, title: "Perfekt läge", text: "Solna Business Park, 8 minuter från city med pendel, tunnelbana och buss." },
];

const EVENT_TYPES = [
  { title: "Företagsevent", desc: "Hela arenan för ert team eller kunder." },
  { title: "Kickoff", desc: "Starta säsongen med energi, spel och mat." },
  { title: "Teambuilding", desc: "Aktiviteter där alla kan vara med — direkt." },
  { title: "AW", desc: "Bar, dart, pickleball och dj-vibe efter jobbet." },
  { title: "Konferens + aktivitet", desc: "Möte, lunch och aktivitet i samma flöde." },
  { title: "Kundevent", desc: "Imponera på kunderna med en riktig upplevelse." },
  { title: "Födelsedagar", desc: "Större grupp som vill göra något annorlunda." },
  { title: "Svensexa", desc: "Konkurrens, skratt och kallt på fat." },
  { title: "Möhippa", desc: "Aktivt, socialt och lätt att planera." },
];

const VENUE_HIGHLIGHTS = [
  "8 pickleballbanor",
  "Stockholm Dart Arena",
  "Lounge & bar",
  "Eventytor & scen",
  "Konferensytor",
  "Mat & dryck på plats",
];

const PACKAGES = [
  {
    name: "Starter",
    price: "349",
    tag: "Snabbt & enkelt",
    includes: ["Aktivitet", "All utrustning", "Värd på plats"],
  },
  {
    name: "Social",
    price: "449",
    tag: "Mest populär",
    includes: ["Aktivitet", "Mat", "Turnering", "Värd på plats"],
    featured: true,
  },
  {
    name: "Premium",
    price: "599",
    tag: "Hela upplevelsen",
    includes: ["Aktivitet", "Mat", "Dryck", "Egen eventvärd", "Anpassat upplägg"],
  },
];

const FAQ = [
  { q: "Hur många personer kan ni ta emot?", a: "Vi tar emot grupper från 10 upp till 150+ gäster. För exklusiva bokningar av hela arenan rekommenderar vi 60+." },
  { q: "Kan vi få mat?", a: "Ja. Vi har allt från finger food och pizza till buffé och sittande middag." },
  { q: "Kan vi få egen turnering?", a: "Absolut. Vi sätter upp pickleball- eller dartturneringar med våra eventvärdar och prisutdelning." },
  { q: "Kan vi boka exklusivt?", a: "Ja, hela arenan kan bokas privat för större event." },
  { q: "Finns alkoholservering?", a: "Ja, vi har fullständiga rättigheter och en bar mitt i arenan." },
  { q: "Kan vi kombinera konferens och aktivitet?", a: "Ja — möte och lunch på dagen, aktivitet och AW på eftermiddagen är vårt vanligaste upplägg." },
  { q: "Hur långt i förväg bör man boka?", a: "Vi rekommenderar 3–6 veckor för att säkra tid och upplägg, särskilt under hög säsong (sep–maj)." },
];

export default function EventlokalerPage() {
  useSeo();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    company: "",
    name: "",
    email: "",
    phone: "",
    participants: 25,
    date: "",
    budget: "",
    message: "",
  });
  const [sent, setSent] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [selectedPackageSlug, setSelectedPackageSlug] = useState<string | null>(null);

  // Load active event packages from admin DB (with fallback to hardcoded PACKAGES)
  const packagesQuery = useQuery({
    queryKey: ["eventlokaler-packages"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("event_products")
        .select("id, name, slug, short_description, category, price_from_sek, price_unit, included_items, is_featured, sort_order")
        .eq("type", "package")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return (data || []) as Array<{
        id: string; name: string; slug: string | null; short_description: string | null;
        category: string | null; price_from_sek: number | null; price_unit: string | null;
        included_items: string[] | null; is_featured: boolean; sort_order: number;
      }>;
    },
    staleTime: 60_000,
  });

  const displayPackages = useMemo(() => {
    const rows = packagesQuery.data || [];
    if (rows.length === 0) {
      return PACKAGES.map((p) => ({
        id: null as string | null,
        slug: p.name.toLowerCase(),
        name: p.name,
        tag: p.tag,
        price: p.price,
        includes: p.includes,
        featured: !!(p as any).featured,
      }));
    }
    return rows.map((p) => ({
      id: p.id,
      slug: p.slug || p.name.toLowerCase(),
      name: p.name,
      tag: p.category || (p.is_featured ? "Mest populär" : ""),
      price: p.price_from_sek != null ? String(Math.round(p.price_from_sek)) : "",
      includes: (p.included_items || []).slice(0, 6),
      featured: p.is_featured,
    }));
  }, [packagesQuery.data]);

  const inquiry = useMutation({
    mutationFn: () => apiPost("api-event-public", "group-inquiry", {
      slug: SLUG,
      eventType: "company",
      participants: Number(form.participants) || 1,
      preferredDate: form.date || null,
      preferredTime: "afternoon",
      activities: ["Pickleball", "Dart"],
      resources: [],
      name: `${form.name}${form.company ? ` (${form.company})` : ""}`.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      notes: [
        form.budget ? `Budget: ${form.budget}` : "",
        form.message,
        selectedPackageSlug ? `Valt paket: ${selectedPackageSlug}${selectedPackageId ? ` (${selectedPackageId})` : ""}` : "",
        "[Källa: /eventlokaler]",
      ].filter(Boolean).join("\n"),
    }),
    onSuccess: () => {
      setSent(true);
      toast.success("Förfrågan skickad!");
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const canSubmit = useMemo(() =>
    form.name.trim().length > 1 &&
    form.email.includes("@") &&
    form.phone.trim().length > 4 &&
    Number(form.participants) > 0,
  [form]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit || inquiry.isPending) return;
    inquiry.mutate();
  };

  const scrollToForm = (pkg?: { id: string | null; slug: string; name: string }) => {
    if (pkg) {
      setSelectedPackageId(pkg.id);
      setSelectedPackageSlug(pkg.slug);
    }
    document.getElementById("lead-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (sent) {
    return (
      <div className="min-h-[100dvh] bg-[#f7f4ee] text-[#111]">
        <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center px-6 text-center">
          <img src={picklaLogo} alt="Pickla" className="mb-7 h-8 w-auto" />
          <CheckCircle2 className="h-14 w-14 text-[#32ef87]" />
          <h1 className="mt-5 text-[34px] font-bold leading-none" style={{ fontFamily: FONT_GROTESK }}>
            Tack — vi hörs!
          </h1>
          <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-neutral-500" style={{ fontFamily: FONT_MONO }}>
            Vårt event-team återkommer inom en arbetsdag med upplägg, tider och offert.
          </p>
          <button
            onClick={() => navigate("/")}
            className="mt-8 w-full rounded-full bg-neutral-950 py-4 text-[13px] font-bold text-white active:scale-[0.98]"
            style={{ fontFamily: FONT_GROTESK }}
          >
            Tillbaka till Pickla
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#f7f4ee] text-[#111]" style={{ fontFamily: FONT_GROTESK }}>
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-black/5 bg-[#f7f4ee]/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link to="/" aria-label="Pickla hem">
            <img src={picklaLogo} alt="Pickla" className="h-7 w-auto" />
          </Link>
          <button
            onClick={scrollToForm}
            className="rounded-full bg-neutral-950 px-5 py-2.5 text-[13px] font-bold text-white active:scale-[0.97]"
          >
            Få offert
          </button>
        </div>
      </header>

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-6xl px-5 pt-10 pb-12 md:pt-20 md:pb-24">
          <p className="text-[11px] uppercase tracking-[0.3em] text-neutral-500" style={{ fontFamily: FONT_MONO }}>
            eventlokal · stockholm · solna
          </p>
          <h1 className="mt-4 text-[44px] leading-[1.02] tracking-[-0.03em] md:text-[88px]">
            Stockholms mest<br />sociala eventarena
          </h1>
          <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-neutral-600 md:text-[20px]" style={{ fontFamily: FONT_MONO }}>
            2 000 kvm aktiviteter, mat, dryck och upplevelser under ett tak. Perfekt för företag, kickoffer, AWs och större grupper.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={scrollToForm}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-neutral-950 px-7 py-4 text-[15px] font-bold text-white active:scale-[0.98]"
            >
              Få offert <ArrowRight className="h-4 w-4" />
            </button>
            <a
              href="mailto:event@playpickla.com?subject=Boka%20visning"
              className="inline-flex items-center justify-center rounded-full border border-neutral-900 px-7 py-4 text-[15px] font-bold text-neutral-900 active:scale-[0.98]"
            >
              Boka visning
            </a>
          </div>

          <div className="mt-12 overflow-hidden rounded-[32px] bg-neutral-950">
            <div className="relative h-[260px] md:h-[520px]">
              <img src={heroPhoto} alt="Pickla Arena Stockholm — pickleball, dart och eventyta i Solna" className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
            </div>
            <div className="grid grid-cols-2 gap-px bg-white/10 md:grid-cols-4">
              {HERO_STATS.map((s) => (
                <div key={s.label} className="bg-neutral-950 p-5 text-white md:p-7">
                  <p className="text-[26px] leading-none tracking-tight md:text-[40px]">{s.value}</p>
                  <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-white/55" style={{ fontFamily: FONT_MONO }}>
                    {s.label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* WHY */}
      <section className="mx-auto max-w-6xl px-5 py-14 md:py-24">
        <p className="text-[11px] uppercase tracking-[0.3em] text-neutral-500" style={{ fontFamily: FONT_MONO }}>
          varför pickla
        </p>
        <h2 className="mt-3 text-[34px] leading-[1.05] tracking-[-0.02em] md:text-[56px]">
          Mer än en eventlokal
        </h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {WHY.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-[24px] bg-white p-6 ring-1 ring-black/5">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-950 text-white">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-5 text-[18px] font-bold leading-snug">{title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-neutral-600" style={{ fontFamily: FONT_MONO }}>
                {text}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* EVENT TYPES */}
      <section className="mx-auto max-w-6xl px-5 py-14 md:py-24">
        <div className="flex items-end justify-between gap-6">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-neutral-500" style={{ fontFamily: FONT_MONO }}>
              event vi gör bäst
            </p>
            <h2 className="mt-3 text-[34px] leading-[1.05] tracking-[-0.02em] md:text-[56px]">
              För varje typ av grupp
            </h2>
          </div>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {EVENT_TYPES.map((t) => (
            <button
              key={t.title}
              onClick={scrollToForm}
              className="group relative overflow-hidden rounded-[24px] bg-neutral-950 p-6 text-left text-white transition-transform active:scale-[0.98]"
            >
              <div className="absolute inset-0 opacity-30 transition-opacity group-hover:opacity-50">
                <img src={weekendVibes} alt="" className="h-full w-full object-cover" />
              </div>
              <div className="relative">
                <h3 className="text-[22px] leading-tight">{t.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-white/70" style={{ fontFamily: FONT_MONO }}>
                  {t.desc}
                </p>
                <span className="mt-6 inline-flex items-center gap-1 text-[12px] uppercase tracking-[0.2em] text-white/80" style={{ fontFamily: FONT_MONO }}>
                  Få offert <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* VENUE */}
      <section className="bg-neutral-950 text-white">
        <div className="mx-auto max-w-6xl px-5 py-16 md:py-28">
          <p className="text-[11px] uppercase tracking-[0.3em] text-white/50" style={{ fontFamily: FONT_MONO }}>
            arenan
          </p>
          <h2 className="mt-3 max-w-3xl text-[34px] leading-[1.05] tracking-[-0.02em] md:text-[64px]">
            2 000 kvm upplevelser under ett tak
          </h2>

          <div className="mt-10 overflow-hidden rounded-[28px]">
            <img src={heroPhoto} alt="Pickla Arena interiör — pickleballbanor, dartområde, bar och lounge" className="h-[260px] w-full object-cover md:h-[460px]" />
          </div>

          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {VENUE_HIGHLIGHTS.map((h) => (
              <div key={h} className="flex items-center gap-3 rounded-2xl bg-white/5 px-5 py-4 ring-1 ring-white/10">
                <div className="h-2 w-2 rounded-full bg-[#32ef87]" />
                <span className="text-[15px]">{h}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PACKAGES */}
      <section className="mx-auto max-w-6xl px-5 py-14 md:py-24">
        <p className="text-[11px] uppercase tracking-[0.3em] text-neutral-500" style={{ fontFamily: FONT_MONO }}>
          paket
        </p>
        <h2 className="mt-3 text-[34px] leading-[1.05] tracking-[-0.02em] md:text-[56px]">
          Från enkelt till hela upplevelsen
        </h2>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-neutral-600" style={{ fontFamily: FONT_MONO }}>
          Alla paket skräddarsys efter er grupp. Priserna nedan är riktpris per person.
        </p>

        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {displayPackages.map((p) => (
            <div
              key={p.slug || p.name}
              className={`rounded-[28px] p-7 ring-1 transition-transform ${
                p.featured
                  ? "bg-neutral-950 text-white ring-neutral-950"
                  : "bg-white text-neutral-900 ring-black/5"
              } ${selectedPackageSlug === p.slug ? "outline outline-2 outline-[#32ef87]" : ""}`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-[24px]">{p.name}</h3>
                {p.tag && (
                  <span
                    className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.2em] ${
                      p.featured ? "bg-[#32ef87] text-neutral-950" : "bg-neutral-100 text-neutral-600"
                    }`}
                    style={{ fontFamily: FONT_MONO }}
                  >
                    {p.tag}
                  </span>
                )}
              </div>
              {p.price && (
                <div className="mt-6 flex items-baseline gap-2">
                  <span className={`text-[12px] uppercase ${p.featured ? "text-white/60" : "text-neutral-500"}`} style={{ fontFamily: FONT_MONO }}>
                    från
                  </span>
                  <span className="text-[44px] leading-none tracking-tight">{p.price}</span>
                  <span className={`text-[14px] ${p.featured ? "text-white/60" : "text-neutral-500"}`} style={{ fontFamily: FONT_MONO }}>
                    kr/pers
                  </span>
                </div>
              )}
              <ul className="mt-7 space-y-3">
                {p.includes.map((i) => (
                  <li key={i} className="flex items-center gap-3 text-[14px]">
                    <CheckCircle2 className={`h-4 w-4 ${p.featured ? "text-[#32ef87]" : "text-neutral-900"}`} />
                    {i}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => scrollToForm({ id: p.id, slug: p.slug, name: p.name })}
                className={`mt-8 w-full rounded-full py-3.5 text-[14px] font-bold active:scale-[0.98] ${
                  p.featured ? "bg-[#32ef87] text-neutral-950" : "bg-neutral-950 text-white"
                }`}
              >
                Få offert
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* SOCIAL PROOF */}
      <section className="mx-auto max-w-6xl px-5 py-14 md:py-20">
        <div className="rounded-[28px] bg-white p-8 ring-1 ring-black/5 md:p-12">
          <p className="text-[11px] uppercase tracking-[0.3em] text-neutral-500" style={{ fontFamily: FONT_MONO }}>
            de har redan varit här
          </p>
          <blockquote className="mt-6 text-[24px] leading-snug tracking-[-0.01em] md:text-[36px]">
            "Bästa kickoffen på flera år. Personalen pratar fortfarande om kvällen — alla var med, alla skrattade."
          </blockquote>
          <p className="mt-6 text-[13px] text-neutral-500" style={{ fontFamily: FONT_MONO }}>
            — HR-chef, techbolag i Stockholm
          </p>
          <div className="mt-10 grid grid-cols-2 gap-6 sm:grid-cols-4 lg:grid-cols-6">
            {["Northvolt", "Klarna", "Spotify", "iZettle", "King", "Tink"].map((logo) => (
              <div key={logo} className="flex h-12 items-center justify-center rounded-xl bg-neutral-50 text-[13px] font-semibold tracking-wider text-neutral-400">
                {logo}
              </div>
            ))}
          </div>
          <p className="mt-4 text-[11px] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
            * Exempel på företag i målgruppen — kontakta oss för referenser.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-5 py-14 md:py-24">
        <p className="text-[11px] uppercase tracking-[0.3em] text-neutral-500" style={{ fontFamily: FONT_MONO }}>
          vanliga frågor
        </p>
        <h2 className="mt-3 text-[34px] leading-[1.05] tracking-[-0.02em] md:text-[48px]">
          Svar på det vanligaste
        </h2>
        <div className="mt-10 divide-y divide-black/10">
          {FAQ.map((item, i) => {
            const open = openFaq === i;
            return (
              <div key={item.q} className="py-2">
                <button
                  onClick={() => setOpenFaq(open ? null : i)}
                  className="flex w-full items-center justify-between py-5 text-left"
                >
                  <span className="text-[17px] font-bold pr-6">{item.q}</span>
                  <span className="text-2xl text-neutral-400">{open ? "−" : "+"}</span>
                </button>
                {open && (
                  <p className="pb-6 pr-8 text-[15px] leading-relaxed text-neutral-600" style={{ fontFamily: FONT_MONO }}>
                    {item.a}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* LEAD FORM */}
      <section id="lead-form" className="bg-neutral-950 py-14 text-white md:py-24">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-white/50" style={{ fontFamily: FONT_MONO }}>
              få offert
            </p>
            <h2 className="mt-3 text-[34px] leading-[1.05] tracking-[-0.02em] md:text-[56px]">
              Berätta om ert event
            </h2>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/70" style={{ fontFamily: FONT_MONO }}>
              Skicka in en kort förfrågan så återkommer vi inom en arbetsdag med tider, upplägg och offert.
            </p>
            <div className="mt-8 space-y-4">
              {[
                { icon: Users, text: "Grupper 10–150+ personer" },
                { icon: Calendar, text: "Svar inom en arbetsdag" },
                { icon: MapPin, text: "Solna Business Park, Stockholm" },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-3 text-[14px] text-white/80">
                  <Icon className="h-4 w-4 text-[#32ef87]" /> {text}
                </div>
              ))}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="rounded-[28px] bg-white p-6 text-neutral-900 ring-1 ring-white/10 md:p-8">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Företag" value={form.company} onChange={(v) => setForm({ ...form, company: v })} />
              <Input label="Namn" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
              <Input label="Email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} required />
              <Input label="Telefon" type="tel" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} required />
              <Input label="Antal personer" type="number" value={String(form.participants)} onChange={(v) => setForm({ ...form, participants: Number(v) || 0 })} required />
              <Input label="Datum" type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
              <div className="sm:col-span-2">
                <Label>Budget</Label>
                <select
                  value={form.budget}
                  onChange={(e) => setForm({ ...form, budget: e.target.value })}
                  className="h-14 w-full rounded-2xl border border-neutral-200 bg-[#f7f4ee] px-4 text-[16px] outline-none"
                >
                  <option value="">Välj budget (valfritt)</option>
                  <option>Under 10 000 kr</option>
                  <option>10 000 – 25 000 kr</option>
                  <option>25 000 – 50 000 kr</option>
                  <option>50 000 – 100 000 kr</option>
                  <option>Över 100 000 kr</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <Label>Meddelande</Label>
                <textarea
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  rows={4}
                  placeholder="Berätta kort om eventet — antal, vibe, mat, ev. önskemål"
                  className="w-full resize-none rounded-2xl border border-neutral-200 bg-[#f7f4ee] px-4 py-4 text-[16px] outline-none"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={!canSubmit || inquiry.isPending}
              className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-neutral-950 text-[15px] font-bold text-white disabled:opacity-40 active:scale-[0.98]"
            >
              {inquiry.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <>Få offert <ArrowRight className="h-4 w-4" /></>}
            </button>
            <p className="mt-3 text-center text-[11px] text-neutral-500" style={{ fontFamily: FONT_MONO }}>
              Genom att skicka godkänner du vår <Link to="/privacy" className="underline">integritetspolicy</Link>.
            </p>
          </form>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="mx-auto max-w-4xl px-5 py-20 text-center md:py-32">
        <h2 className="text-[34px] leading-[1.05] tracking-[-0.02em] md:text-[64px]">
          Redo att skapa ett event<br />folk faktiskt kommer ihåg?
        </h2>
        <button
          onClick={scrollToForm}
          className="mt-10 inline-flex items-center gap-2 rounded-full bg-neutral-950 px-9 py-5 text-[16px] font-bold text-white active:scale-[0.98]"
        >
          Få offert <ArrowRight className="h-4 w-4" />
        </button>
      </section>

      {/* Footer */}
      <footer className="border-t border-black/10 bg-[#f7f4ee] py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-5 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <img src={picklaLogo} alt="Pickla" className="h-6 w-auto" />
            <span className="text-[12px] text-neutral-500" style={{ fontFamily: FONT_MONO }}>
              Pickla Arena Stockholm · Solna
            </span>
          </div>
          <div className="flex flex-wrap gap-5 text-[13px] text-neutral-600" style={{ fontFamily: FONT_MONO }}>
            <Link to="/eventlokaler" className="hover:text-neutral-900">Eventlokaler</Link>
            <Link to="/book/group" className="hover:text-neutral-900">Gruppbokning</Link>
            <Link to="/membership" className="hover:text-neutral-900">Medlemskap</Link>
            <Link to="/privacy" className="hover:text-neutral-900">Integritet</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-[11px] uppercase tracking-[0.2em] text-neutral-500" style={{ fontFamily: FONT_MONO }}>
      {children}
    </label>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <Label>{label}{required && " *"}</Label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="h-14 w-full rounded-2xl border border-neutral-200 bg-[#f7f4ee] px-4 text-[16px] outline-none focus:border-neutral-900"
        style={{ fontFamily: FONT_GROTESK }}
      />
    </div>
  );
}
