export type EventLandingConfig = {
  slug: string; // route slug e.g. "eventlokaler"
  path: string; // route path with leading /
  canonical: string;
  seoTitle: string;
  seoDesc: string;
  heroKicker: string;
  heroH1: React.ReactNode | string[]; // array = lines
  heroLead: string;
  primaryKeyword: string;
  inquiryEventType: string; // sent to api-event-public
  inquirySource: string; // tag in notes
  faq: { q: string; a: string }[];
  navLabel: string; // for submenu
};

export const SUBMENU: { label: string; to: string }[] = [
  { label: "Företagsevent", to: "/foretagsevent-stockholm" },
  { label: "Kickoff", to: "/kickoff-stockholm" },
  { label: "AW", to: "/aw-stockholm" },
  { label: "Konferens", to: "/konferens-stockholm" },
  { label: "Teambuilding", to: "/teambuilding-stockholm" },
  { label: "Eventlokaler", to: "/eventlokaler" },
  { label: "Hotell", to: "/hotell" },
];

const BASE = "https://www.playpickla.com";

const COMMON_FAQ_TAIL = [
  { q: "Kan vi få mat och dryck?", a: "Ja. Vi har allt från finger food och pizza till buffé och sittande middag, samt full bar med öl, vin och cocktails." },
  { q: "Hur långt i förväg bör vi boka?", a: "Vi rekommenderar 3–6 veckor för att säkra tid och upplägg, särskilt under hög säsong (sep–maj)." },
  { q: "Finns det hotell nära?", a: "Ja, flera hotell ligger inom gångavstånd i Solna Business Park. Se /hotell för rekommendationer." },
];

export const EVENT_LANDING_PAGES: EventLandingConfig[] = [
  {
    slug: "eventlokaler",
    path: "/eventlokaler",
    canonical: `${BASE}/eventlokaler`,
    seoTitle: "Eventlokal Stockholm | Företagsevent, Kickoff & Teambuilding | Pickla",
    seoDesc: "Boka företagsevent, kickoff, AW eller teambuilding hos Pickla i Solna. 2000 kvm social sportarena med pickleball, dart, mat och bar.",
    heroKicker: "eventlokal · stockholm · solna",
    heroH1: ["Stockholms mest", "sociala eventarena"],
    heroLead: "2 000 kvm aktiviteter, mat, dryck och upplevelser under ett tak. Perfekt för företag, kickoffer, AWs och större grupper.",
    primaryKeyword: "eventlokal stockholm",
    inquiryEventType: "company",
    inquirySource: "/eventlokaler",
    navLabel: "Eventlokaler",
    faq: [
      { q: "Hur många personer kan ni ta emot?", a: "Vi tar emot grupper från 10 upp till 150+ gäster. För exklusiva bokningar av hela arenan rekommenderar vi 60+." },
      { q: "Kan vi boka exklusivt?", a: "Ja, hela arenan kan bokas privat för större event." },
      ...COMMON_FAQ_TAIL,
    ],
  },
  {
    slug: "foretagsevent-stockholm",
    path: "/foretagsevent-stockholm",
    canonical: `${BASE}/foretagsevent-stockholm`,
    seoTitle: "Företagsevent Stockholm | Aktivitet, Mat & Bar | Pickla Arena",
    seoDesc: "Företagsevent i Stockholm med pickleball, dart, mat och bar. 2 000 kvm i Solna för 10–150+ gäster. Få offert inom en arbetsdag.",
    heroKicker: "företagsevent · stockholm",
    heroH1: ["Företagsevent i", "Stockholm som fastnar"],
    heroLead: "Samla teamet, kunder eller hela kontoret. Aktivitet, mat och bar i en arena där alla är med från första minuten.",
    primaryKeyword: "företagsevent stockholm",
    inquiryEventType: "company",
    inquirySource: "/foretagsevent-stockholm",
    navLabel: "Företagsevent",
    faq: [
      { q: "Vad ingår i ett företagsevent?", a: "Aktivitet (pickleball/dart), eventvärd, utrustning och valbar mat och dryck. Vi anpassar upplägget efter er grupp och budget." },
      { q: "Hur stora grupper passar?", a: "Från 10 personer upp till 150+. För hela arenan exklusivt rekommenderar vi 60+ gäster." },
      { q: "Kan ni hjälpa till med upplägg?", a: "Ja. Vi planerar tider, turnering, mat och flöde åt er — ni behöver bara dyka upp." },
      ...COMMON_FAQ_TAIL,
    ],
  },
  {
    slug: "kickoff-stockholm",
    path: "/kickoff-stockholm",
    canonical: `${BASE}/kickoff-stockholm`,
    seoTitle: "Kickoff Stockholm | Aktivitet, Mat & Bar | Pickla Arena Solna",
    seoDesc: "Kickoff i Stockholm med pickleball, dart, mat och DJ-vibe. Allt på samma ställe i Solna. Boka offert inom en arbetsdag.",
    heroKicker: "kickoff · stockholm",
    heroH1: ["Kickoff i Stockholm", "som faktiskt kickar"],
    heroLead: "Starta säsongen med energi. Pickleball, dart, mat, bar och musik — i en arena byggd för att samla teamet.",
    primaryKeyword: "kickoff stockholm",
    inquiryEventType: "kickoff",
    inquirySource: "/kickoff-stockholm",
    navLabel: "Kickoff",
    faq: [
      { q: "Vad gör en kickoff hos Pickla unik?", a: "Aktivitet alla kan vara med på direkt, utan inlärningskurva. Det skapar en helt annan stämning än ett konferensrum." },
      { q: "Kan vi kombinera möte och kickoff?", a: "Ja. Möte och lunch på dagen, aktivitet och AW på eftermiddagen är vårt vanligaste upplägg." },
      { q: "Finns DJ och musik?", a: "Ja, vi kan ordna DJ, ljus och eventproduktion vid förfrågan." },
      ...COMMON_FAQ_TAIL,
    ],
  },
  {
    slug: "aw-stockholm",
    path: "/aw-stockholm",
    canonical: `${BASE}/aw-stockholm`,
    seoTitle: "AW Stockholm | After Work med Aktivitet | Pickla Arena",
    seoDesc: "AW i Stockholm med pickleball, dart, bar och mat. Boka företags-AW i Solna för 10–150+ personer. Få offert inom en arbetsdag.",
    heroKicker: "after work · stockholm",
    heroH1: ["AW i Stockholm", "med faktisk vibe"],
    heroLead: "Dart, pickleball, bar och mat — efter jobbet. En AW som folk faktiskt dyker upp på, och stannar kvar på.",
    primaryKeyword: "aw stockholm",
    inquiryEventType: "aw",
    inquirySource: "/aw-stockholm",
    navLabel: "AW",
    faq: [
      { q: "Hur funkar en AW hos Pickla?", a: "Ni får banor/tavlor reserverade, bar och valbar mat. Lägg till turnering eller eventvärd om ni vill ha mer struktur." },
      { q: "Minsta antal personer för AW?", a: "Från 10 personer. För större grupper bokar vi separata zoner eller hela arenan." },
      { q: "Vilka tider passar?", a: "Vardagar från kl 16. Vi sätter upp er enligt önskemål — kort 1,5h AW eller hela kvällen." },
      ...COMMON_FAQ_TAIL,
    ],
  },
  {
    slug: "konferens-stockholm",
    path: "/konferens-stockholm",
    canonical: `${BASE}/konferens-stockholm`,
    seoTitle: "Konferens Stockholm med Aktivitet | Möte + Pickleball | Pickla",
    seoDesc: "Konferens i Stockholm med aktivitet på samma plats. Möte, lunch och pickleball/dart i Solna. Få offert inom en arbetsdag.",
    heroKicker: "konferens · aktivitet · stockholm",
    heroH1: ["Konferens med", "aktivitet på samma plats"],
    heroLead: "Möte och lunch på dagen, pickleball, dart och AW på eftermiddagen. Allt i samma flöde — utan transport mellan platser.",
    primaryKeyword: "konferens stockholm aktivitet",
    inquiryEventType: "conference",
    inquirySource: "/konferens-stockholm",
    navLabel: "Konferens",
    faq: [
      { q: "Har ni konferensytor?", a: "Ja. Vi har ytor för presentation, workshop och lunch i anslutning till arenan." },
      { q: "Kan ni ordna mat hela dagen?", a: "Ja — frukost, fika, lunch, middag och bar. Vi sätter upp dagen efter ert schema." },
      { q: "Hur stora grupper passar för konferens?", a: "10–80 personer fungerar bäst. Större grupper löser vi i flera zoner." },
      ...COMMON_FAQ_TAIL,
    ],
  },
  {
    slug: "teambuilding-stockholm",
    path: "/teambuilding-stockholm",
    canonical: `${BASE}/teambuilding-stockholm`,
    seoTitle: "Teambuilding Stockholm | Aktivitet alla kan | Pickla Arena",
    seoDesc: "Teambuilding i Stockholm där alla är med — pickleball och dart. Solna, 10–150+ personer. Få offert inom en arbetsdag.",
    heroKicker: "teambuilding · stockholm",
    heroH1: ["Teambuilding där", "alla faktiskt är med"],
    heroLead: "Pickleball och dart har ingen inlärningskurva. Alla i teamet är med från första minuten — oavsett ålder eller bakgrund.",
    primaryKeyword: "teambuilding stockholm",
    inquiryEventType: "teambuilding",
    inquirySource: "/teambuilding-stockholm",
    navLabel: "Teambuilding",
    faq: [
      { q: "Funkar det för otränade grupper?", a: "Ja — det är hela poängen. Våra eventvärdar gör så att alla kommer igång på 5 minuter." },
      { q: "Kan ni göra turnering?", a: "Ja. Pickleball- eller dartturnering med lag, poängtavla och prisutdelning är vårt mest bokade upplägg." },
      { q: "Hur långt brukar en teambuilding vara?", a: "1,5–3 timmar är vanligast. Lägg till mat och bar för en hel kväll." },
      ...COMMON_FAQ_TAIL,
    ],
  },
];

export function getEventLandingConfig(slug: string): EventLandingConfig | undefined {
  return EVENT_LANDING_PAGES.find((p) => p.slug === slug);
}
