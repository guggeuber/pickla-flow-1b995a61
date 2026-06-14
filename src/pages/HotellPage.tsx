import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, MapPin, Building2, Users, Trophy, Briefcase, Dumbbell, Heart, Navigation } from "lucide-react";
import picklaLogo from "@/assets/pickla-logo.svg";
import { HOTELS, trackHotelClick, withUtm } from "@/config/hotels";

const FONT_GROTESK = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";
const CANONICAL = "https://www.playpickla.com/hotell";

const SEO_TITLE = "Hotell nära Pickla Solna | Boende för event, turneringar och spelare";
const SEO_DESC = "Boka hotell nära Pickla i Solna. Hotellalternativ för spelare, turneringar, företagsevent och gäster.";

const FOR_WHO = [
  { icon: Trophy, label: "Turneringar" },
  { icon: Briefcase, label: "Företagsevent" },
  { icon: Dumbbell, label: "Träningsläger" },
  { icon: Users, label: "Besökande spelare" },
  { icon: Heart, label: "Familj och vänner" },
];


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
    ld.text = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: SEO_TITLE,
      description: SEO_DESC,
      url: CANONICAL,
      mainEntity: {
        "@type": "ItemList",
        itemListElement: HOTELS.map((h, i) => ({
          "@type": "ListItem",
          position: i + 1,
          item: {
            "@type": "LodgingBusiness",
            name: h.name,
            description: h.description,
            url: h.link,
          },
        })),
      },
    });
    document.head.appendChild(ld);
    tags.push(ld);

    return () => {
      document.title = prevTitle;
      tags.forEach((t) => t.remove());
    };
  }, []);
}

export default function HotellPage() {
  useSeo();

  return (
    <div className="min-h-screen bg-[#FFFAF8] text-neutral-900">
      {/* HERO */}
      <section className="mx-auto max-w-4xl px-5 pt-16 pb-10 text-center md:pt-24 md:pb-14">
        <p
          className="mb-4 text-[11px] uppercase tracking-[0.2em] text-neutral-500"
          style={{ fontFamily: FONT_MONO }}
        >
          Boende nära Pickla
        </p>
        <h1
          className="text-[34px] font-bold leading-[1.05] tracking-[-0.02em] md:text-[56px]"
          style={{ fontFamily: FONT_GROTESK }}
        >
          Bo nära Pickla
        </h1>
        <p
          className="mx-auto mt-5 max-w-xl text-[16px] leading-relaxed text-neutral-600 md:text-[18px]"
          style={{ fontFamily: FONT_GROTESK }}
        >
          Vi har samlat hotellalternativ nära Pickla för spelare, gäster, företag och eventdeltagare.
        </p>
      </section>

      {/* HOTEL CARDS */}
      <section className="mx-auto max-w-4xl px-5 pb-16 md:pb-24">
        <div className="grid gap-5 md:grid-cols-2">
          {HOTELS.map((hotel) => (
            <div
              key={hotel.id}
              role="link"
              tabIndex={0}
              onClick={(e) => {
                // Avoid double-tracking when the inner CTAs are clicked.
                if ((e.target as HTMLElement).closest("a")) return;
                trackHotelClick(hotel.id, "hotel_card_click");
                window.open(withUtm(hotel.link, "book", hotel.id), "_blank", "noopener,noreferrer");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  trackHotelClick(hotel.id, "hotel_card_click");
                  window.open(withUtm(hotel.link, "book", hotel.id), "_blank", "noopener,noreferrer");
                }
              }}
              className="flex cursor-pointer flex-col overflow-hidden rounded-[24px] border border-neutral-200 bg-white transition-shadow hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
            >
              <div className="aspect-[16/10] w-full overflow-hidden bg-neutral-100">
                <img src={hotel.image} alt={hotel.name} className="h-full w-full object-cover" loading="lazy" />
              </div>
              <div className="flex flex-1 flex-col p-6">
                <div className="mb-4 flex items-center gap-2 text-[11px] uppercase tracking-[0.15em] text-neutral-500" style={{ fontFamily: FONT_MONO }}>
                  <MapPin className="h-3.5 w-3.5" />
                  {hotel.distance}
                </div>
                <h3
                  className="text-[20px] font-bold leading-tight tracking-[-0.01em]"
                  style={{ fontFamily: FONT_GROTESK }}
                >
                  {hotel.name}
                </h3>
                <p
                  className="mt-3 flex-1 text-[14px] leading-relaxed text-neutral-600"
                  style={{ fontFamily: FONT_GROTESK }}
                >
                  {hotel.description}
                </p>
                <a
                  href={withUtm(hotel.link, "book", hotel.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackHotelClick(hotel.id, "book")}
                  className="mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-neutral-950 px-5 py-3.5 text-[14px] font-bold text-white active:scale-[0.98]"
                  style={{ fontFamily: FONT_GROTESK }}
                >
                  {hotel.cta} <ArrowRight className="h-4 w-4" />
                </a>
                <a
                  href={withUtm(hotel.mapsUrl, "directions", hotel.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackHotelClick(hotel.id, "directions")}
                  className="mt-2 inline-flex items-center justify-center gap-2 rounded-full border border-neutral-200 px-5 py-3 text-[13px] font-semibold text-neutral-700 hover:bg-neutral-50 active:scale-[0.98]"
                  style={{ fontFamily: FONT_GROTESK }}
                >
                  <Navigation className="h-3.5 w-3.5" /> Visa vägbeskrivning
                </a>
              </div>
            </div>
          ))}

        </div>
      </section>

      {/* WHO THIS IS FOR */}
      <section className="mx-auto max-w-4xl px-5 pb-16 md:pb-24">
        <div className="rounded-[28px] border border-neutral-200 bg-[#f7f4ee] p-8 md:p-12">
          <h2
            className="text-[24px] font-bold leading-tight tracking-[-0.01em] md:text-[32px]"
            style={{ fontFamily: FONT_GROTESK }}
          >
            Perfekt för
          </h2>
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
            {FOR_WHO.map((item) => (
              <div
                key={item.label}
                className="flex flex-col items-center gap-3 rounded-2xl bg-white p-5 text-center"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100">
                  <item.icon className="h-5 w-5 text-neutral-700" />
                </div>
                <span
                  className="text-[13px] font-semibold text-neutral-800"
                  style={{ fontFamily: FONT_GROTESK }}
                >
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* GROUP ACCOMMODATION CTA */}
      <section className="mx-auto max-w-4xl px-5 pb-20 text-center md:pb-32">
        <div className="rounded-[28px] bg-neutral-950 px-6 py-12 text-white md:px-12 md:py-16">
          <Building2 className="mx-auto mb-5 h-8 w-8 text-neutral-400" />
          <h2
            className="text-[24px] font-bold leading-tight tracking-[-0.01em] md:text-[32px]"
            style={{ fontFamily: FONT_GROTESK }}
          >
            Behöver du hjälp med gruppbokning?
          </h2>
          <p
            className="mx-auto mt-4 max-w-lg text-[15px] leading-relaxed text-neutral-400"
            style={{ fontFamily: FONT_GROTESK }}
          >
            Planerar du event, turnering eller företagsresa och behöver boende för hela gruppen?
            Kontakta Pickla så hjälper vi till.
          </p>
          <a
            href="mailto:solna@picklaparks.com?subject=Gruppbokning hotell"
            onClick={() => trackHotelClick("group", "group_inquiry")}
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-8 py-4 text-[14px] font-bold text-neutral-950 active:scale-[0.98]"
            style={{ fontFamily: FONT_GROTESK }}
          >
            Kontakta Pickla <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </section>

      {/* FOOTER */}
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
            <Link to="/hotell" className="hover:text-neutral-900">Hotell</Link>
            <Link to="/membership" className="hover:text-neutral-900">Medlemskap</Link>
            <Link to="/privacy" className="hover:text-neutral-900">Integritet</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
