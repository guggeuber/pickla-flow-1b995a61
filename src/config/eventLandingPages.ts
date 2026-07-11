export type EventLandingCategory = "corporate" | "private";

import { CANONICAL_PRODUCTION_ORIGIN } from "@/lib/canonicalOrigin";

export type EventLandingConfig = {
  slug: string; // route slug e.g. "eventlokaler"
  path: string; // route path with leading /
  canonical: string;
  seoTitle: string;
  seoDesc: string;
  /** Optional OG/Twitter overrides (fallback to seoTitle/seoDesc). */
  ogTitle?: string;
  ogDesc?: string;
  heroKicker: string;
  heroH1: React.ReactNode | string[]; // array = lines
  heroLead: string;
  primaryKeyword: string;
  inquiryEventType: string; // sent to api-event-public
  inquirySource: string; // tag in notes
  inquiryCategory: EventLandingCategory; // lead segmentation for Event Agent OS
  faq: { q: string; a: string }[];
  navLabel: string; // for submenu
  category: EventLandingCategory; // menu grouping
};


export const SUBMENU_GROUPS: { label: string; items: { label: string; to: string }[] }[] = [
  {
    label: "Företagsevent",
    items: [
      { label: "Företagsevent", to: "/foretagsevent-stockholm" },
      { label: "Kickoff", to: "/kickoff-stockholm" },
      { label: "AW", to: "/aw-stockholm" },
      { label: "Konferens", to: "/konferens-stockholm" },
      { label: "Teambuilding", to: "/teambuilding-stockholm" },
      { label: "Kundevent", to: "/kundevent-stockholm" },
      { label: "Ledningsgrupp", to: "/ledningsgrupp-stockholm" },
    ],
  },
  {
    label: "Privata Event",
    items: [
      { label: "Gruppbokning", to: "/gruppbokning-stockholm" },
      { label: "Födelsedagskalas", to: "/fodelsedagskalas-stockholm" },
      { label: "Svensexa", to: "/svensexa-stockholm" },
      { label: "Möhippa", to: "/mohippa-stockholm" },
      { label: "Familjeevent", to: "/familjeevent-stockholm" },
      { label: "Kompisgäng", to: "/kompisgang-stockholm" },
      { label: "Skolavslutning", to: "/skolavslutning-stockholm" },
      { label: "Jubileum", to: "/jubileum-stockholm" },
    ],
  },
  {
    label: "Mer",
    items: [
      { label: "Eventlokaler", to: "/eventlokaler" },
      { label: "Hotell", to: "/hotell" },
    ],
  },
];

// Flat list used for footer + mobile pill row (back-compat)
export const SUBMENU: { label: string; to: string }[] = SUBMENU_GROUPS.flatMap((g) => g.items);

const BASE = CANONICAL_PRODUCTION_ORIGIN;

const COMMON_FAQ_TAIL = [
  { q: "Kan vi få mat och dryck?", a: "Ja. Vi har allt från finger food och pizza till buffé och sittande middag, samt full bar med öl, vin och cocktails." },
  { q: "Hur långt i förväg bör vi boka?", a: "Vi rekommenderar 3–6 veckor för att säkra tid och upplägg, särskilt under hög säsong (sep–maj)." },
  { q: "Finns det hotell nära?", a: "Ja, flera hotell ligger inom gångavstånd i Solna Business Park. Se /hotell för rekommendationer." },
];

const PRIVATE_FAQ_TAIL = [
  { q: "Kan vi få mat och dryck?", a: "Ja — pizza, buffé, finger food eller sittande middag. Bar med öl, vin, cocktails och alkoholfritt. Vi anpassar efter ålder och tillfälle." },
  { q: "Hur långt i förväg bör vi boka?", a: "2–4 veckor i förväg räcker oftast. Helger fylls fortast — boka tidigare för fre/lör kvällar." },
  { q: "Finns det parkering och kommunikationer?", a: "Ja. Garage på plats och 8 minuter från city med pendel, tunnelbana och buss till Solna Business Park." },
];

export const EVENT_LANDING_PAGES: EventLandingConfig[] = [
  // ============ EVENTLOKALER (umbrella) ============
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
    inquiryCategory: "corporate",
    navLabel: "Eventlokaler",
    category: "corporate",
    faq: [
      { q: "Hur många personer kan ni ta emot?", a: "Vi tar emot grupper från 10 upp till 150+ gäster. För exklusiva bokningar av hela arenan rekommenderar vi 60+." },
      { q: "Kan vi boka exklusivt?", a: "Ja, hela arenan kan bokas privat för större event." },
      ...COMMON_FAQ_TAIL,
    ],
  },

  // ============ CORPORATE ============
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
    inquiryCategory: "corporate",
    navLabel: "Företagsevent",
    category: "corporate",
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
    inquiryCategory: "corporate",
    navLabel: "Kickoff",
    category: "corporate",
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
    inquiryCategory: "corporate",
    navLabel: "AW",
    category: "corporate",
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
    inquiryCategory: "corporate",
    navLabel: "Konferens",
    category: "corporate",
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
    inquiryCategory: "corporate",
    navLabel: "Teambuilding",
    category: "corporate",
    faq: [
      { q: "Funkar det för otränade grupper?", a: "Ja — det är hela poängen. Våra eventvärdar gör så att alla kommer igång på 5 minuter." },
      { q: "Kan ni göra turnering?", a: "Ja. Pickleball- eller dartturnering med lag, poängtavla och prisutdelning är vårt mest bokade upplägg." },
      { q: "Hur långt brukar en teambuilding vara?", a: "1,5–3 timmar är vanligast. Lägg till mat och bar för en hel kväll." },
      ...COMMON_FAQ_TAIL,
    ],
  },
  {
    slug: "kundevent-stockholm",
    path: "/kundevent-stockholm",
    canonical: `${BASE}/kundevent-stockholm`,
    seoTitle: "Kundevent Stockholm | Bjud in kunderna | Pickla Arena",
    seoDesc: "Kundevent i Stockholm med aktivitet, mat och bar. Pickleball och dart skapar samtal som inte uppstår på vanliga mingel.",
    heroKicker: "kundevent · stockholm",
    heroH1: ["Kundevent som", "kunder kommer ihåg"],
    heroLead: "Bjud in nyckelkunder till en aktivitet de inte fått tidigare. Pickleball, dart, mat och bar — i en miljö där relationer byggs.",
    primaryKeyword: "kundevent stockholm",
    inquiryEventType: "client_event",
    inquirySource: "/kundevent-stockholm",
    inquiryCategory: "corporate",
    navLabel: "Kundevent",
    category: "corporate",
    faq: [
      { q: "Hur funkar ett kundevent hos Pickla?", a: "Ni får en reserverad zon, eventvärd, aktivitet, mat och bar. Vi sköter logistiken så ni kan fokusera på kunderna." },
      { q: "Kan vi få bordsservering och bar?", a: "Ja. Vi kan ordna både dedikerad bar och bordsservering vid mat." },
      { q: "Kan vi bjuda in 50+ kunder?", a: "Absolut. Vi gör allt från intima kundevent på 15 personer till 150+ gäster." },
      ...COMMON_FAQ_TAIL,
    ],
  },
  {
    slug: "ledningsgrupp-stockholm",
    path: "/ledningsgrupp-stockholm",
    canonical: `${BASE}/ledningsgrupp-stockholm`,
    seoTitle: "Ledningsgruppmöte Stockholm | Möte + Aktivitet | Pickla",
    seoDesc: "Ledningsgrupp i Stockholm: möte, lunch och aktivitet på samma plats. Pickla Arena i Solna — fokus på dagen, energi på kvällen.",
    heroKicker: "ledningsgrupp · stockholm",
    heroH1: ["Ledningsgruppmöte", "med rätt energi"],
    heroLead: "Strategiskt möte på dagen, pickleball, dart och middag på kvällen. Hela ledningsgruppen får både fokus och avslappning på samma ställe.",
    primaryKeyword: "ledningsgruppmöte stockholm",
    inquiryEventType: "leadership",
    inquirySource: "/ledningsgrupp-stockholm",
    inquiryCategory: "corporate",
    navLabel: "Ledningsgrupp",
    category: "corporate",
    faq: [
      { q: "Har ni avskild yta för möten?", a: "Ja. Vi har privata mötesytor med projektor, whiteboard och plats för 6–20 personer." },
      { q: "Kan ni boka exklusivt för ledningsgruppen?", a: "Ja, hela banor/dartområden eller hela arenan kan reserveras privat." },
      { q: "Kan vi få middag på plats efter mötet?", a: "Ja, sittande middag, dryckespaket och eventvärd ordnas på plats." },
      ...COMMON_FAQ_TAIL,
    ],
  },

  // ============ PRIVATE ============
  {
    slug: "gruppbokning-stockholm",
    path: "/gruppbokning-stockholm",
    canonical: `${BASE}/gruppbokning-stockholm`,
    seoTitle: "Gruppbokning Stockholm | Pickleball, Dart, Mat & Bar | Pickla",
    seoDesc: "Gruppbokning i Stockholm med pickleball, dart, mat och bar. Perfekt för kompisgäng, familj eller privat fest. Få offert direkt.",
    heroKicker: "gruppbokning · stockholm",
    heroH1: ["Gruppbokning för", "alla tillfällen"],
    heroLead: "Samla gänget — pickleball, dart, mat och bar under ett tak. Vi sätter upp er privat med eget område, värd och anpassad meny.",
    primaryKeyword: "gruppbokning stockholm",
    inquiryEventType: "group",
    inquirySource: "/gruppbokning-stockholm",
    inquiryCategory: "private",
    navLabel: "Gruppbokning",
    category: "private",
    faq: [
      { q: "Hur många kan vara med i en gruppbokning?", a: "Från 8 personer upp till 150+. Vi anpassar zoner och aktiviteter efter storlek." },
      { q: "Behöver vi kunna spela pickleball eller dart?", a: "Nej. Båda är supersnabba att lära sig — alla är med från första minuten, oavsett ålder eller erfarenhet." },
      { q: "Kan ni ordna mat och bar?", a: "Ja. Pizza, finger food, buffé eller sittande middag — och full bar." },
      ...PRIVATE_FAQ_TAIL,
    ],
  },
  {
    slug: "fodelsedagskalas-stockholm",
    path: "/fodelsedagskalas-stockholm",
    canonical: `${BASE}/fodelsedagskalas-stockholm`,
    seoTitle: "Födelsedagskalas Stockholm | Pickleball, Dart, Mat & Tårta | Pickla",
    seoDesc: "Fira födelsedagen i Stockholm med pickleball, dart, mat och bar. Privat zon, eventvärd och tårta — för barn, tonåringar och vuxna.",
    heroKicker: "födelsedagskalas · stockholm",
    heroH1: ["Födelsedagskalas", "med riktig vibe"],
    heroLead: "Fira tillsammans med pickleball, dart, mat och kul. Vi sätter upp en privat zon och tar hand om allt — från turnering till tårta.",
    primaryKeyword: "födelsedagskalas stockholm",
    inquiryEventType: "birthday",
    inquirySource: "/fodelsedagskalas-stockholm",
    inquiryCategory: "private",
    navLabel: "Födelsedagskalas",
    category: "private",
    faq: [
      { q: "Vilka åldrar passar?", a: "Allt från 8-åringar till 80-åringar. Vi anpassar tempo, regler och mat efter åldersgruppen." },
      { q: "Kan ni ordna tårta?", a: "Ja. Säg till vid bokning så fixar vi tårta, ljus och en liten ceremoni." },
      { q: "Hur länge brukar ett kalas vara?", a: "2–3 timmar är vanligast. Lägg till mat och bar för en längre kväll." },
      ...PRIVATE_FAQ_TAIL,
    ],
  },
  {
    slug: "svensexa-stockholm",
    path: "/svensexa-stockholm",
    canonical: `${BASE}/svensexa-stockholm`,
    seoTitle: "Svensexa Stockholm | Pickleball, Dart, Mat & Bar | Pickla Arena",
    seoDesc: "Svensexa i Stockholm med tävlingar, mat, dryck och privat zon. Pickleball, dart och bar i Solna. Få offert inom en arbetsdag.",
    heroKicker: "svensexa · stockholm",
    heroH1: ["Svensexa med", "riktig tävlingsanda"],
    heroLead: "Tävlingsmoment, mat, dryck och en privat zon för gänget. Pickleball, dart och bar — vi sätter upp en svensexa som faktiskt blir snackad om.",
    primaryKeyword: "svensexa stockholm",
    inquiryEventType: "bachelor",
    inquirySource: "/svensexa-stockholm",
    inquiryCategory: "private",
    navLabel: "Svensexa",
    category: "private",
    faq: [
      { q: "Kan vi få en privat zon?", a: "Ja. Vi reserverar banor, dartområde och bar bara för er grupp." },
      { q: "Kan ni ordna utmaningar eller turnering?", a: "Ja. Vi sätter upp en turnering med poäng, lag och pris — perfekt för svensexan." },
      { q: "Vilka tider funkar?", a: "Vi är öppna både dag och kväll, alla dagar i veckan. Fredag/lördag kväll bokas tidigt." },
      ...PRIVATE_FAQ_TAIL,
    ],
  },
  {
    slug: "mohippa-stockholm",
    path: "/mohippa-stockholm",
    canonical: `${BASE}/mohippa-stockholm`,
    seoTitle: "Möhippa Stockholm | Social Aktivitet, Mat & Bubbel | Pickla",
    seoDesc: "Möhippa i Stockholm med pickleball, dart, mat och bubbel. Social, aktiv och minnesvärd. Privat zon för gänget — boka offert.",
    heroKicker: "möhippa · stockholm",
    heroH1: ["Möhippa som blir", "ihågkommen"],
    heroLead: "Social, aktiv och rolig — pickleball, dart, mat och bubbel i en privat zon. Vi sätter upp en möhippa där alla är med.",
    primaryKeyword: "möhippa stockholm",
    inquiryEventType: "bachelorette",
    inquirySource: "/mohippa-stockholm",
    inquiryCategory: "private",
    navLabel: "Möhippa",
    category: "private",
    faq: [
      { q: "Vad ingår i en möhippa hos Pickla?", a: "Aktivitet (pickleball/dart), eventvärd, valbar mat och bar — bubbel, cocktails eller alkoholfritt." },
      { q: "Kan vi få privat zon?", a: "Ja. Egna banor, eget dartområde och egen bar reserveras för gänget." },
      { q: "Hur många kan vara med?", a: "Från 6 personer upp till 40+. Större möhippor löser vi också." },
      ...PRIVATE_FAQ_TAIL,
    ],
  },
  {
    slug: "familjeevent-stockholm",
    path: "/familjeevent-stockholm",
    canonical: `${BASE}/familjeevent-stockholm`,
    seoTitle: "Familjeaktivitet Stockholm | Pickleball, Dart & Mat | Pickla Arena",
    seoDesc: "Familjeaktivitet i Stockholm för alla åldrar. Pickleball, dart, mat och bar — perfekt för helger, släktträffar eller högtider.",
    heroKicker: "familjeevent · stockholm",
    heroH1: ["Familjeevent där", "alla åldrar är med"],
    heroLead: "Pickleball och dart passar 8-åringar lika bra som farmor. Mat, bar och privat zon för familjen — en aktivitet alla minns.",
    primaryKeyword: "familjeaktivitet stockholm",
    inquiryEventType: "family",
    inquirySource: "/familjeevent-stockholm",
    inquiryCategory: "private",
    navLabel: "Familjeevent",
    category: "private",
    faq: [
      { q: "Funkar det för barn?", a: "Ja. Pickleball är säkert och enkelt för barn från ca 7 år. Dart från ca 10 år med vuxen." },
      { q: "Kan ni anpassa för äldre släktingar?", a: "Absolut. Banorna kan göras lugnare och dart funkar för alla åldrar — vi anpassar tempo och regler." },
      { q: "Finns barnvänlig mat?", a: "Ja. Pizza, korv, kyckling och vegetariska alternativ. Vi anpassar menyn efter gruppen." },
      ...PRIVATE_FAQ_TAIL,
    ],
  },
  {
    slug: "kompisgang-stockholm",
    path: "/kompisgang-stockholm",
    canonical: `${BASE}/kompisgang-stockholm`,
    seoTitle: "Aktivitet för kompisgäng Stockholm | Pickleball, Dart, Bar | Pickla",
    seoDesc: "Samla kompisgänget i Stockholm. Pickleball, dart, mat och bar i Solna. Perfekt för återträffar och sociala kvällar.",
    heroKicker: "kompisgäng · stockholm",
    heroH1: ["Kompisgäng-kväll", "i Stockholm"],
    heroLead: "Återträff, lördagshäng eller bara en kväll med kompisarna. Pickleball, dart, mat och bar — i en miljö där alla kommer igång direkt.",
    primaryKeyword: "gruppaktivitet stockholm",
    inquiryEventType: "friends",
    inquirySource: "/kompisgang-stockholm",
    inquiryCategory: "private",
    navLabel: "Kompisgäng",
    category: "private",
    faq: [
      { q: "Hur stort gäng funkar?", a: "Från 6 personer och uppåt. Vi sätter upp lag, turnering eller bara fri lek beroende på gänget." },
      { q: "Behöver vi boka mat?", a: "Nej, men de flesta lägger till mat och bar för en hel kväll. Vi tipsar om bra upplägg." },
      { q: "Kan vi boka spontant?", a: "Vid lediga tider, ja. Helger bör bokas några veckor i förväg." },
      ...PRIVATE_FAQ_TAIL,
    ],
  },
  {
    slug: "skolavslutning-stockholm",
    path: "/skolavslutning-stockholm",
    canonical: `${BASE}/skolavslutning-stockholm`,
    seoTitle: "Skolavslutning Stockholm | Aktivitet & Mat | Pickla Arena",
    seoDesc: "Fira skolavslutningen i Stockholm med pickleball, dart, mat och kul. Privat zon för klassen — boka offert inom en arbetsdag.",
    heroKicker: "skolavslutning · stockholm",
    heroH1: ["Skolavslutning", "med kul aktivitet"],
    heroLead: "Avsluta terminen med energi. Pickleball, dart, mat och spel i en privat zon — perfekt för klassen, laget eller hela årskursen.",
    primaryKeyword: "skolavslutning stockholm",
    inquiryEventType: "graduation",
    inquirySource: "/skolavslutning-stockholm",
    inquiryCategory: "private",
    navLabel: "Skolavslutning",
    category: "private",
    faq: [
      { q: "Vilka åldrar passar?", a: "Allt från mellanstadiet till gymnasiet och studentavslutningar. Vi anpassar tempo, regler och mat." },
      { q: "Kan vi få privat zon för klassen?", a: "Ja. Vi reserverar egna banor, dart och eventyta så klassen är för sig själv." },
      { q: "Finns det mat som passar barn/ungdomar?", a: "Ja — pizza, korv, kyckling och vegetariskt. Drycker enligt önskemål." },
      ...PRIVATE_FAQ_TAIL,
    ],
  },
  {
    slug: "jubileum-stockholm",
    path: "/jubileum-stockholm",
    canonical: `${BASE}/jubileum-stockholm`,
    seoTitle: "Jubileum Stockholm | Fira med Aktivitet, Mat & Bar | Pickla Arena",
    seoDesc: "Fira jubileum i Stockholm med pickleball, dart, mat och bar. Privat zon, eventvärd och anpassat upplägg. Få offert direkt.",
    heroKicker: "jubileum · stockholm",
    heroH1: ["Jubileum med", "minnesvärd vibe"],
    heroLead: "Fira milstolpar med vänner, familj eller kollegor. Pickleball, dart, mat och bar — i en privat zon med eventvärd och anpassat upplägg.",
    primaryKeyword: "jubileum stockholm",
    inquiryEventType: "anniversary",
    inquirySource: "/jubileum-stockholm",
    inquiryCategory: "private",
    navLabel: "Jubileum",
    category: "private",
    faq: [
      { q: "Passar jubileum för både privat och företag?", a: "Ja. Vi gör allt från 50-årsfester och bröllopsdagar till företagsjubileer och föreningsfester." },
      { q: "Kan vi få tal, scen eller DJ?", a: "Ja. Vi kan ordna mikrofon, scen, ljud och DJ vid behov." },
      { q: "Kan vi boka hela arenan?", a: "Absolut — för större jubileer (60+ gäster) rekommenderar vi exklusiv bokning." },
      ...PRIVATE_FAQ_TAIL,
    ],
  },
];

export function getEventLandingConfig(slug: string): EventLandingConfig | undefined {
  return EVENT_LANDING_PAGES.find((p) => p.slug === slug);
}
