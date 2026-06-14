// Pickla hotel partners — lightweight config.
// Edit this file to add/remove hotels or update booking links and copy.

export interface Hotel {
  id: string;
  name: string;
  distance: string;
  description: string;
  cta: string;
  /** External booking link (opens in new tab). */
  link: string;
  /** Image served from /public. */
  image: string;
  /** Google Maps directions link. */
  mapsUrl: string;
}

export const HOTELS: Hotel[] = [
  {
    id: "aiden",
    name: "Best Western Aiden",
    distance: "200 m från Pickla",
    description:
      "Smidigt hotellalternativ precis intill Pickla. Perfekt för spelare, eventgäster och grupper som vill bo så nära anläggningen som möjligt.",
    cta: "Boka med Pickla-erbjudande",
    link: "https://app.mews.com/distributor/18223665-65c5-4869-8570-b24a00909368?mewsVoucherCode=Pickla",
    image: "/hotel-aiden.webp",
    mapsUrl:
      "https://www.google.com/maps/dir/?api=1&destination=Best+Western+Aiden+Hotel+Stockholm+Solna",
  },
  {
    id: "solna",
    name: "Best Western Solna Business Park",
    distance: "500 m från Pickla",
    description:
      "Bekvämt boende i Solna Business Park, nära Pickla och bra kommunikationer. Passar både företag, turneringsgäster och längre vistelser.",
    cta: "Boka med Pickla-erbjudande",
    link: "https://app.mews.com/distributor/d5a26fba-22de-4004-b4ab-b24a0091ac46?mewsVoucherCode=PICKLA%20AB",
    image: "/hotel-solna.jpg",
    mapsUrl:
      "https://www.google.com/maps/dir/?api=1&destination=Best+Western+Plus+Hotel+Solna+Business+Park",
  },
];

export type HotelAction =
  | "book"
  | "directions"
  | "group_inquiry"
  | "hotel_card_click";

/** Debug mode: enabled in dev or when ?debug=hotels is in the URL or localStorage flag is set. */
function isDebug(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    if (typeof window === "undefined") return false;
    if (new URLSearchParams(window.location.search).get("debug") === "hotels") return true;
    if (window.localStorage?.getItem("pickla_debug_hotels") === "1") return true;
  } catch {
    /* noop */
  }
  return false;
}

/** Append UTM params to an outbound link without clobbering existing ones. */
export function withUtm(
  url: string,
  action: Extract<HotelAction, "book" | "directions">,
  hotelId: string,
): string {
  try {
    const u = new URL(url);
    const params: Record<string, string> = {
      utm_source: "playpickla",
      utm_medium: action === "book" ? "hotel_card" : "hotel_directions",
      utm_campaign: "hotell_page",
      utm_content: hotelId,
    };
    for (const [k, v] of Object.entries(params)) {
      if (!u.searchParams.has(k)) u.searchParams.set(k, v);
    }
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Lightweight click tracker for hotel CTAs.
 * Sends to Vercel Analytics + gtag when present, logs in debug mode.
 */
export function trackHotelClick(
  hotelId: string,
  action: HotelAction,
  source: string = "hotell_page",
) {
  const payload = { hotel_id: hotelId, action, source };
  try {
    const w = window as any;
    if (typeof w.va === "function") w.va("event", { name: "hotel_click", data: payload });
    if (typeof w.gtag === "function") w.gtag("event", "hotel_click", payload);
    if (isDebug()) {
      // eslint-disable-next-line no-console
      console.log("[hotel_click]", payload);
    }
  } catch {
    // analytics failures must never break the click
  }
}
