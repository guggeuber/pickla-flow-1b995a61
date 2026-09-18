import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { PicklaTopBar } from "@/components/PicklaTopBar";

const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

type LegalPageKind = "privacy" | "terms" | "cookies";

type LegalSection = {
  title: string;
  body: string[];
};

const UPDATED_AT = "18 september 2026";
const PLATFORM_COMPANY = "Pickla Orbit AB, org.nr 559203-1610";
const SOLNA_OPERATOR = "Pickla Solna AB, org.nr 556977-4481";

const CONTENT: Record<LegalPageKind, { title: string; eyebrow: string; intro: string; sections: LegalSection[] }> = {
  privacy: {
    title: "Integritetspolicy",
    eyebrow: "personuppgifter",
    intro:
      "Pickla samlar in så lite kunddata som möjligt för att kunna hantera bokningar, medlemskap, betalningar och daglig drift.",
    sections: [
      {
        title: "Vem ansvarar för uppgifterna",
        body: [
          `${PLATFORM_COMPANY} tillhandahåller Pickla-plattformen.`,
          `${SOLNA_OPERATOR} ansvarar för den lokala verksamheten på Pickla Solna och hanterar bokningar, medlemskap, desk, support och kundkontakt för den anläggningen.`,
          "För andra anläggningar kan ett annat lokalt Pickla-bolag eller en lokal partner ansvara för den lokala verksamheten. Pickla håller kunddata inom de bolag och leverantörer som behöver uppgifterna för att leverera tjänsten.",
        ],
      },
      {
        title: "Vilka uppgifter vi behandlar",
        body: [
          "Konto: namn, visningsnamn, e-post, telefon när det behövs, användar-id och tekniska kontoidentifierare.",
          "Drift: bokningar, resurser/banor, åtkomstkoder, check-ins, medlemskap, förmånsanvändning, vouchers, sessioner och eventförfrågningar.",
          "Betalning: Stripe-id:n, betalstatus, kvitton och kortmetadata som korttyp, sista fyra siffror och giltighetstid. Fullständiga kortnummer och CVC sparas aldrig hos Pickla.",
          "Kommunikation: bokningschattar, supportanteckningar, eventdialog och e-postlogg när det behövs för att hjälpa kunden.",
          "Pickla Mail: e-postadress, valfritt förnamn, vilken typ av utskick du har valt, när och var valet gjordes samt när du avslutar utskicken. Vi sparar också nödvändig spärrinformation vid exempelvis permanent studs eller spamklagomål.",
        ],
      },
      {
        title: "Varför vi använder uppgifterna",
        body: [
          "Vi använder data för att skapa och hantera bokningar, aktivera medlemsförmåner, ta betalt, skicka kvitton, ge support, driva desk/check-in och hålla hallen fungerande.",
          "Telefon krävs bara i flöden där det är motiverat, till exempel medlemskap, staff-hantering och gruppbokningar.",
          "Redaktionella, community- och andra marknadsföringsmail skickas bara efter ett separat, frivilligt val. Valet påverkar inte nödvändiga boknings-, betalnings-, säkerhets- eller kontomail och kan återkallas när som helst.",
          "Vid publik anmälan skickar vi först ett bekräftelsemail. Adressen blir inte berättigad till marknadsföringsmail förrän bekräftelselänken har använts. Publik anmälan är för vuxna eller vårdnadshavare; kommunikation om barn går via vårdnadshavaren.",
        ],
      },
      {
        title: "System och leverantörer",
        body: [
          "Supabase används för databas, inloggning, edge functions, storage och realtime.",
          "Stripe används för betalningar, abonnemang och sparade betalmetoder.",
          "Vercel används för hosting och deploy av webbappen.",
          "Resend används som personuppgiftsbiträde för transaktionsmail, kunddialog kring eventförfrågningar och — för den som aktivt väljer det — Pickla Mail. Pickla behåller den styrande samtyckes- och spärrinformationen i den egna databasen.",
          "Giphy kan användas när en kund aktivt söker GIF:ar i chatten.",
        ],
      },
      {
        title: "Data vi inte samlar i v1",
        body: [
          "Pickla samlar inte in personnummer, adress, födelsedatum, kön, ID-handlingar, nödkontakt eller känslig hälsodata i soft launch-versionen.",
        ],
      },
      {
        title: "Export, rättelse och radering",
        body: [
          "Du kan be om export, rättelse eller radering av dina kunduppgifter. Vi verifierar först att du kontrollerar kontot eller e-postadressen.",
          "Finansiella records, kvitton och betalningsunderlag kan behöva sparas enligt bokförings- och betalningskrav, men onödiga profil- och supportfält kan minimeras eller anonymiseras.",
          "Kontakta Pickla via den supportkanal du normalt använder eller via personalen på anläggningen.",
          "Du kan avsluta Pickla Mail utan inloggning via länken i varje marknadsföringsmail eller ändra valet på Min sida. En invändning mot direktmarknadsföring gäller omedelbart för sådana utskick.",
        ],
      },
      {
        title: "Pickla Mail och lagring",
        body: [
          "Samtyckeshändelser sparas så att Pickla kan visa när och hur ett val gjordes och respektera en senare återkallelse. Uppgifterna ska inte användas för ett nytt utskicksändamål utan ett nytt relevant val.",
          "En obekräftad publik anmälan är väntande och används inte som tillstånd för marknadsföring. Pickla sparar begäran och bekräftelse separat för att kunna visa vad som faktiskt hände.",
          "En begränsad spärrpost kan behöva behållas efter avregistrering eller leveransproblem för att hindra framtida otillåtna utskick. Exakta gallringsfrister fastställs i Picklas interna dataskyddsrutin.",
          "Pickla Mail v1 synkar endast minsta nödvändiga uppgifter till Resend: e-post, valfritt förnamn och utskicksstatus. Bokningshistorik, betalningsdata och känsliga profiluppgifter synkas inte.",
        ],
      },
    ],
  },
  terms: {
    title: "Villkor",
    eyebrow: "bokning och medlemskap",
    intro:
      "De här villkoren beskriver hur bokning, betalning, medlemskap, gästpass och återbetalningar fungerar hos Pickla.",
    sections: [
      {
        title: "Parter",
        body: [
          `${PLATFORM_COMPANY} tillhandahåller Pickla-plattformen.`,
          `${SOLNA_OPERATOR} ansvarar för den lokala verksamheten på Pickla Solna, om inget annat anges i samband med köp, bokning eller medlemskap.`,
          "När Pickla används för fler anläggningar kan ett annat lokalt Pickla-bolag eller en lokal partner vara avtalspart för den specifika anläggningen medan Pickla Orbit AB tillhandahåller plattformen.",
        ],
      },
      {
        title: "Bokningar",
        body: [
          "En bokning gäller för den tid, resurs och anläggning som visas i bokningsflödet och på bekräftelsen.",
          "Kunden ansvarar för att uppgifterna är korrekta innan betalning eller bekräftelse.",
          "Pickla kan behöva flytta eller stoppa en bokning vid driftstörning, felaktig dubbelbokning eller säkerhetsproblem. Då hjälper vi kunden med ombokning eller relevant korrigering.",
        ],
      },
      {
        title: "Betalning och kvitto",
        body: [
          "Betalningar hanteras via Stripe. Pickla sparar inte fullständiga kortnummer eller CVC.",
          "Kvitto eller kvittounderlag visas i appen när betalningen och bokningen har skapats.",
          "Friskvårdsunderlag baseras på boknings- och kvittodata som finns i Pickla.",
        ],
      },
      {
        title: "Medlemskap",
        body: [
          "Medlemskap aktiveras efter genomförd betalning eller manuell tilldelning av behörig staff.",
          "Förmåner, kvoter, gästpass och rabatter gäller enligt den tier som visas vid köp eller tilldelning.",
          "Om en medlemsförmån används för en bokning kan den räknas mot aktuell vecka eller månad enligt medlemskapets regler.",
        ],
      },
      {
        title: "Gästpass och vouchers",
        body: [
          "Gästpass och vouchers kan ha begränsningar i giltighet, användning och mottagare.",
          "Ett gratis gästpass kan bara användas enligt de regler som visas i flödet och kan spärras om det missbrukas.",
        ],
      },
      {
        title: "Avbokning och återbetalning",
        body: [
          "Avbokning, ombokning och återbetalning hanteras enligt den policy som gäller för aktuell produkt, bokning eller kampanj.",
          "Återbetalningar sker via Stripe när betalningen gjorts där. Bokningar och kvitton raderas inte bara för att en återbetalning sker.",
        ],
      },
      {
        title: "Driftundantag",
        body: [
          "Tekniska fel, stängning, eventproduktion, säkerhetsfrågor eller trasig utrustning kan påverka tillgången till banor och aktiviteter.",
          "Pickla försöker alltid lösa sådana fall med tydlig information, ombokning, kompensation eller återbetalning när det är rimligt.",
        ],
      },
    ],
  },
  cookies: {
    title: "Cookies och lokal lagring",
    eyebrow: "teknik i appen",
    intro:
      "Pickla använder nödvändig lokal lagring för att appen ska fungera. Vi använder ingen marketing-cookie eller tracking-banner i v1.",
    sections: [
      {
        title: "Vem driver tjänsten",
        body: [
          `${PLATFORM_COMPANY} tillhandahåller Pickla-plattformen.`,
          `${SOLNA_OPERATOR} ansvarar för den lokala verksamheten på Pickla Solna.`,
          "Teknisk lagring kan därför användas både för plattformen och för den lokala verksamheten.",
        ],
      },
      {
        title: "Nödvändig lagring",
        body: [
          "Pickla kan använda cookies, local storage och browser storage för inloggning, session, redirect efter login, appinställningar, PWA-funktioner och UI-läge.",
          "Den här lagringen behövs för att kunna logga in, boka, se medlemskap, använda desk/check-in och få appen att bete sig stabilt.",
        ],
      },
      {
        title: "Notiser och PWA",
        body: [
          "Om du aktiverar pushnotiser sparas en teknisk push-prenumeration så att Pickla kan skicka relevanta notiser.",
          "Du kan blockera eller ta bort notiser i webbläsaren eller operativsystemet.",
        ],
      },
      {
        title: "Externa tjänster",
        body: [
          "Supabase, Stripe, Vercel och Resend används för att driva appen, betalning och kommunikation.",
          "Giphy kan kontaktas när du aktivt använder GIF-sök i chatten.",
        ],
      },
      {
        title: "Ingen marketing-cookie i v1",
        body: [
          "Pickla använder inte analytics- eller marketingcookies i soft launch-versionen. Om det införs senare ska informationen uppdateras och samtycke hanteras där det krävs.",
          "En anmälan till Pickla Mail är ett e-postval och inte ett samtycke till cookies eller beteendespårning. Pickla Mail v1 ska lanseras utan öppnings- och klickspårning i Resend.",
        ],
      },
    ],
  },
};

const LEGAL_NAV: Array<{ kind: LegalPageKind; label: string; href: string }> = [
  { kind: "privacy", label: "Integritet", href: "/privacy" },
  { kind: "terms", label: "Villkor", href: "/terms" },
  { kind: "cookies", label: "Cookies", href: "/cookies" },
];

export default function LegalPage({ kind }: { kind?: LegalPageKind }) {
  const params = useParams();
  const pageKind = kind || (params.kind as LegalPageKind | undefined);

  if (!pageKind || !(pageKind in CONTENT)) {
    return <Navigate to="/privacy" replace />;
  }

  const content = CONTENT[pageKind];

  return (
    <div className="min-h-[100dvh] bg-[#f8fafc] text-[#111827]">
      <PicklaTopBar slug="pickla-arena-sthlm" showVenue={false} background="#f8fafc" />
      <main className="mx-auto max-w-2xl px-5 pb-16 pt-[calc(env(safe-area-inset-top,0px)+116px)]">
        <Link
          to="/"
          className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-neutral-500 active:scale-[0.98]"
          style={{ fontFamily: FONT_HEADING }}
        >
          <ArrowLeft className="h-4 w-4" />
          Till Pickla
        </Link>

        <section className="rounded-[28px] bg-white p-6 shadow-sm ring-1 ring-black/5">
          <p className="text-[10px] uppercase tracking-[0.24em] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
            {content.eyebrow}
          </p>
          <h1 className="mt-3 text-[38px] font-bold leading-none tracking-tight sm:text-[48px]" style={{ fontFamily: FONT_HEADING }}>
            {content.title}
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-neutral-600" style={{ fontFamily: FONT_HEADING }}>
            {content.intro}
          </p>
          <p className="mt-4 text-[12px] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
            Senast uppdaterad: {UPDATED_AT}
          </p>
        </section>

        <nav className="mt-4 grid grid-cols-3 gap-2" aria-label="Legal navigation">
          {LEGAL_NAV.map((item) => (
            <Link
              key={item.kind}
              to={item.href}
              className="rounded-2xl px-3 py-3 text-center text-[12px] font-bold transition-colors"
              style={{
                background: item.kind === pageKind ? "#111827" : "#ffffff",
                color: item.kind === pageKind ? "#ffffff" : "#6b7280",
                border: item.kind === pageKind ? "1px solid #111827" : "1px solid #e5e7eb",
                fontFamily: FONT_HEADING,
              }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="mt-5 space-y-4">
          {content.sections.map((section) => (
            <section key={section.title} className="rounded-[24px] bg-white p-5 shadow-sm ring-1 ring-black/5">
              <h2 className="text-[20px] font-bold tracking-tight" style={{ fontFamily: FONT_HEADING }}>
                {section.title}
              </h2>
              <div className="mt-3 space-y-3 text-[14px] leading-relaxed text-neutral-600" style={{ fontFamily: FONT_HEADING }}>
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
