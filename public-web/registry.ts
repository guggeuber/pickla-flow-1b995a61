export const PUBLIC_WEB_ORIGIN = "https://playpickla.com";
export const PUBLIC_WEB_API_ORIGIN = "https://ptnvhbniiiapzbyofctg.supabase.co/functions/v1";

export type PublicWebIndexability = "index,follow" | "noindex,follow" | "noindex,nofollow";

export type PublicWebLink = {
  label: string;
  href: string;
};

export type PublicWebRoute = {
  id: string;
  pathname: `/${string}`;
  outputFile: `${string}/index.html`;
  canonical: `https://playpickla.com/${string}`;
  titleTemplate: string;
  descriptionTemplate: string;
  h1Template: string;
  indexability: PublicWebIndexability;
  includeInSitemap: boolean;
  venueSlug: string;
  expectedCity: string;
  attributionSource: string;
  links: {
    booking: PublicWebLink;
    openPlay: PublicWebLink;
    courses: PublicWebLink;
    prices: PublicWebLink;
    membership: PublicWebLink;
    groups: PublicWebLink;
  };
  compatibility: {
    /**
     * Temporary public projection used only while api-bookings/public-venue
     * deployments without postal_code may still be live. The acquisition
     * loader accepts it only when venue slug, street and city all match.
     */
    corporateVenueSlug: string;
  };
};

export const PUBLIC_WEB_ROUTES = [
  {
    id: "pickleball-stockholm",
    pathname: "/pickleball-stockholm",
    outputFile: "pickleball-stockholm/index.html",
    canonical: `${PUBLIC_WEB_ORIGIN}/pickleball-stockholm`,
    titleTemplate: "Pickleball i Stockholm – {courtCount} inomhusbanor i Solna | Pickla",
    descriptionTemplate: "Spela pickleball på {courtCount} inomhusbanor i Solna Business Park. Se priser, Open Play, nybörjarkurser, öppettider och boka direkt hos Pickla.",
    h1Template: "Spela pickleball i Stockholm – {courtCount} inomhusbanor i Solna",
    indexability: "index,follow",
    includeInSitemap: true,
    venueSlug: "pickla-arena-sthlm",
    expectedCity: "Solna",
    attributionSource: "public-web:pickleball-stockholm",
    links: {
      booking: {
        label: "Se lediga tider",
        href: "/book?v=pickla-arena-sthlm&ref=public-web-pickleball-stockholm",
      },
      openPlay: {
        label: "Kom själv – se Open Play",
        href: "/openplay?v=pickla-arena-sthlm&ref=public-web-pickleball-stockholm",
      },
      courses: {
        label: "Se kurser för nybörjare",
        href: "/courses?v=pickla-arena-sthlm&ref=public-web-pickleball-stockholm",
      },
      prices: {
        label: "Se alla priser",
        href: "/prices?v=pickla-arena-sthlm&ref=public-web-pickleball-stockholm",
      },
      membership: {
        label: "Se medlemskap",
        href: "/membership?v=pickla-arena-sthlm&ref=public-web-pickleball-stockholm",
      },
      groups: {
        label: "Boka för grupp eller företag",
        href: "/book/group?v=pickla-arena-sthlm&ref=public-web-pickleball-stockholm",
      },
    },
    compatibility: {
      corporateVenueSlug: "ericsson",
    },
  },
] as const satisfies readonly PublicWebRoute[];

export const PUBLIC_WEB_STATIC_CANONICALS = [
  `${PUBLIC_WEB_ORIGIN}/join`,
] as const;

export function renderRouteTemplate(template: string, facts: { courtCount: number }) {
  return template.split("{courtCount}").join(String(facts.courtCount));
}

export function renderPublicWebSitemap(routes: readonly PublicWebRoute[] = PUBLIC_WEB_ROUTES) {
  const locations = [
    ...routes
    .filter((route) => route.includeInSitemap && route.indexability === "index,follow")
    .map((route) => route.canonical),
    ...PUBLIC_WEB_STATIC_CANONICALS,
  ]
    .map((canonical) => `  <url><loc>${canonical}</loc></url>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locations}\n</urlset>\n`;
}
