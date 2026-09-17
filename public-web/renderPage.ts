import type { AcquisitionFacts, OpeningHour, PublicCourtPrice } from "./acquisitionData";
import {
  PUBLIC_WEB_ORIGIN,
  renderRouteTemplate,
  type PublicWebLink,
  type PublicWebRoute,
} from "./registry";

const DAYS = [
  { index: 0, label: "Söndag", schema: "Sunday" },
  { index: 1, label: "Måndag", schema: "Monday" },
  { index: 2, label: "Tisdag", schema: "Tuesday" },
  { index: 3, label: "Onsdag", schema: "Wednesday" },
  { index: 4, label: "Torsdag", schema: "Thursday" },
  { index: 5, label: "Fredag", schema: "Friday" },
  { index: 6, label: "Lördag", schema: "Saturday" },
] as const;

const DISPLAY_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function escapeHtml(value: string | number) {
  return String(value)
    .split("&").join("&amp;")
    .split("<").join("&lt;")
    .split(">").join("&gt;")
    .split('"').join("&quot;")
    .split("'").join("&#039;");
}

function safeJson(value: unknown) {
  return JSON.stringify(value).split("<").join("\\u003c");
}

function displayTime(value: string | null) {
  return value ? value.replace(":", ".") : "";
}

function dayLabel(day: number) {
  return DAYS.find((candidate) => candidate.index === day)?.label ?? "";
}

function priceDayLabel(days: number[]) {
  const sorted = [...days].sort((a, b) => a - b).join(",");
  if (sorted === "1,2,3,4,5") return "Vardagar";
  if (sorted === "0,6") return "Helg";
  return [...days].sort((a, b) => DISPLAY_DAY_ORDER.indexOf(a) - DISPLAY_DAY_ORDER.indexOf(b)).map(dayLabel).join(", ");
}

function renderPriceRow(price: PublicCourtPrice) {
  const times = price.timeFrom && price.timeTo
    ? `${displayTime(price.timeFrom)}–${displayTime(price.timeTo)}`
    : "Hela dagen";
  return `<li class="price-row">
    <span><strong>${escapeHtml(priceDayLabel(price.daysOfWeek))}</strong><small>${escapeHtml(times)}</small></span>
    <span class="price-value">${escapeHtml(price.priceSek)} kr<small>per bana och timme</small></span>
  </li>`;
}

function renderOpeningHour(hour: OpeningHour) {
  return `<li><span>${escapeHtml(dayLabel(hour.dayOfWeek))}</span><strong>${hour.isClosed ? "Stängt" : `${escapeHtml(displayTime(hour.openTime))}–${escapeHtml(displayTime(hour.closeTime))}`}</strong></li>`;
}

function link(link: PublicWebLink, className: string, cta: string) {
  return `<a class="${className}" href="${escapeHtml(link.href)}" data-acquisition-cta="${escapeHtml(cta)}">${escapeHtml(link.label)}<span aria-hidden="true">→</span></a>`;
}

function structuredData(route: PublicWebRoute, facts: AcquisitionFacts) {
  const openingHoursSpecification = facts.openingHours
    .filter((hour) => !hour.isClosed && hour.openTime && hour.closeTime)
    .map((hour) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: `https://schema.org/${DAYS.find((day) => day.index === hour.dayOfWeek)?.schema}`,
      opens: hour.openTime,
      closes: hour.closeTime,
    }));

  return {
    "@context": "https://schema.org",
    "@type": ["SportsActivityLocation", "LocalBusiness"],
    "@id": `${route.canonical}#venue`,
    name: facts.venue.name,
    url: route.canonical,
    image: `${PUBLIC_WEB_ORIGIN}/og-pickla.jpg`,
    address: {
      "@type": "PostalAddress",
      streetAddress: facts.venue.streetAddress,
      postalCode: facts.venue.postalCode,
      addressLocality: facts.venue.city,
      addressCountry: facts.venue.country,
    },
    openingHoursSpecification,
    sport: "Pickleball",
  };
}

function attributionScript(route: PublicWebRoute) {
  const payload = safeJson({
    source: route.attributionSource,
    landing: route.pathname,
  });
  return `<script>(function(){var key="pickla:acquisition";var base=${payload};try{var saved=sessionStorage.getItem(key);var current=saved?JSON.parse(saved):{};sessionStorage.setItem(key,JSON.stringify(Object.assign({},current,base,{landed_at:current.landed_at||new Date().toISOString()})));document.querySelectorAll("[data-acquisition-cta]").forEach(function(link){link.addEventListener("click",function(){var value=JSON.parse(sessionStorage.getItem(key)||"{}");value.cta=link.getAttribute("data-acquisition-cta");value.clicked_at=new Date().toISOString();sessionStorage.setItem(key,JSON.stringify(value))})})}catch(error){}})();</script>`;
}

export function renderPublicWebPage({
  route,
  facts,
  assets,
}: {
  route: PublicWebRoute;
  facts: AcquisitionFacts;
  assets: { logo: string; venuePhoto: string };
}) {
  const templateFacts = { courtCount: facts.indoorPickleballCourtCount };
  const title = renderRouteTemplate(route.titleTemplate, templateFacts);
  const description = renderRouteTemplate(route.descriptionTemplate, templateFacts);
  const h1 = renderRouteTemplate(route.h1Template, templateFacts);
  const displayHours = DISPLAY_DAY_ORDER.map((day) => facts.openingHours.find((hour) => hour.dayOfWeek === day))
    .filter((hour): hour is OpeningHour => Boolean(hour));
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${facts.venue.streetAddress}, ${facts.venue.postalCode} ${facts.venue.city}`)}`;
  const fullAddress = `${facts.venue.streetAddress}, ${facts.venue.postalCode} ${facts.venue.city}`;
  const allDaysOpen = facts.openingHours.every((hour) => !hour.isClosed);
  const openDaysCount = facts.openingHours.filter((hour) => !hour.isClosed).length;
  const firstVisitFact = facts.firstVisit.available && facts.firstVisit.priceSek
    ? `<div class="fact"><span>Open Play</span><strong>Från ${escapeHtml(facts.firstVisit.priceSek)} kr</strong></div>`
    : "";

  return `<!doctype html>
<html lang="sv">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <meta name="robots" content="${escapeHtml(route.indexability)}">
    <link rel="canonical" href="${escapeHtml(route.canonical)}">
    <meta name="theme-color" content="#071126">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Pickla">
    <meta property="og:locale" content="sv_SE">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:url" content="${escapeHtml(route.canonical)}">
    <meta property="og:image" content="${PUBLIC_WEB_ORIGIN}/og-pickla.jpg">
    <meta property="og:image:width" content="1536">
    <meta property="og:image:height" content="1024">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(title)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    <meta name="twitter:image" content="${PUBLIC_WEB_ORIGIN}/og-pickla.jpg">
    <link rel="icon" href="/favicon.ico">
    <script type="application/ld+json">${safeJson(structuredData(route, facts))}</script>
    <style>
      :root{color-scheme:light;--ink:#071126;--ink-2:#101d38;--paper:#fffaf7;--white:#fff;--pink:#f43278;--pink-soft:#ffd8e7;--mint:#32efa0;--line:rgba(7,17,38,.13);--muted:#566176;--radius:28px;--shadow:0 24px 70px rgba(7,17,38,.14)}
      *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}a{color:inherit}.skip{position:absolute;left:-999px;top:8px;background:var(--white);padding:12px 18px;z-index:99}.skip:focus{left:8px}.wrap{width:min(1180px,calc(100% - 40px));margin-inline:auto}.eyebrow{margin:0 0 16px;font-size:12px;font-weight:850;letter-spacing:.16em;text-transform:uppercase}.eyebrow.pink{color:var(--pink)}.eyebrow.mint{color:var(--mint)}h1,h2,h3,p{margin-top:0}h1,h2,h3{letter-spacing:-.04em}h1{max-width:900px;margin-bottom:24px;font-size:clamp(44px,7vw,88px);line-height:.95;font-weight:900}h2{font-size:clamp(34px,5vw,64px);line-height:1;margin-bottom:22px}h3{font-size:24px;line-height:1.05}p{line-height:1.65}.site-header{position:absolute;z-index:5;top:0;left:0;width:100%;color:var(--white)}.nav{display:flex;align-items:center;justify-content:space-between;padding:24px 0}.logo{display:block;width:126px;height:auto;filter:brightness(0) invert(1)}.nav-links{display:flex;align-items:center;gap:24px;font-size:14px;font-weight:750}.nav-links a{text-decoration:none}.nav-links .nav-cta{padding:12px 18px;border:1px solid rgba(255,255,255,.5);border-radius:999px}.hero{position:relative;overflow:hidden;min-height:760px;padding:148px 0 72px;background:var(--ink);color:var(--white)}.hero:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 88% 20%,rgba(244,50,120,.36),transparent 28%),radial-gradient(circle at 16% 100%,rgba(50,239,160,.18),transparent 30%)}.hero-grid{position:relative;display:grid;grid-template-columns:minmax(0,1.25fr) minmax(340px,.75fr);gap:70px;align-items:end}.lead{max-width:700px;margin-bottom:32px;font-size:clamp(18px,2vw,23px);color:#dbe3f1}.actions{display:flex;flex-wrap:wrap;gap:12px}.button{display:inline-flex;align-items:center;justify-content:space-between;gap:24px;min-height:58px;padding:0 22px;border-radius:999px;text-decoration:none;font-size:15px;font-weight:850;transition:transform .2s,background .2s}.button:hover{transform:translateY(-2px)}.button-primary{background:var(--pink);color:var(--white)}.button-secondary{border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.07);color:var(--white)}.hero-card{position:relative;overflow:hidden;border:1px solid rgba(255,255,255,.16);border-radius:var(--radius);background:rgba(255,255,255,.08);box-shadow:var(--shadow);backdrop-filter:blur(14px)}.hero-card img{display:block;width:100%;height:auto;aspect-ratio:472/378;object-fit:cover}.hero-card-copy{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:20px}.hero-card-copy strong{display:block;font-size:18px}.hero-card-copy span{display:block;margin-top:4px;font-size:13px;color:#bdc8da}.court-mark{display:grid;width:50px;height:50px;place-items:center;border-radius:16px;background:var(--mint);color:var(--ink);font-weight:950}.facts-bar{position:relative;display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));margin-top:58px;border-block:1px solid rgba(255,255,255,.16)}.fact{padding:22px 18px;border-right:1px solid rgba(255,255,255,.16)}.fact:first-child{padding-left:0}.fact:last-child{border-right:0}.fact span,.fact strong{display:block}.fact span{margin-bottom:7px;color:#aab7cd;font-size:12px;text-transform:uppercase;letter-spacing:.09em}.fact strong{font-size:18px}.section{padding:104px 0}.intro-grid{display:grid;grid-template-columns:.85fr 1.15fr;gap:90px}.intro-copy{max-width:620px;font-size:20px;color:var(--muted)}.path-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:52px}.path-card{display:flex;min-height:340px;flex-direction:column;padding:30px;border:1px solid var(--line);border-radius:var(--radius);background:var(--white);text-decoration:none;box-shadow:0 8px 30px rgba(7,17,38,.05);transition:transform .2s,box-shadow .2s}.path-card:hover{transform:translateY(-4px);box-shadow:var(--shadow)}.path-number{display:grid;width:48px;height:48px;place-items:center;border-radius:15px;background:var(--pink-soft);font-weight:900}.path-card:nth-child(2) .path-number{background:#d9fff0}.path-card:nth-child(3) .path-number{background:#dde8ff}.path-card h3{margin:52px 0 14px}.path-card p{color:var(--muted)}.path-link{margin-top:auto;font-size:14px;font-weight:850}.dark{background:var(--ink);color:var(--white)}.price-layout{display:grid;grid-template-columns:.8fr 1.2fr;gap:80px;align-items:start}.price-intro{position:sticky;top:32px}.price-intro p{max-width:480px;color:#bdc8da;font-size:18px}.price-list{margin:0;padding:0;list-style:none;border-top:1px solid rgba(255,255,255,.18)}.price-row{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:21px 0;border-bottom:1px solid rgba(255,255,255,.18)}.price-row span,.price-row strong,.price-row small{display:block}.price-row small{margin-top:5px;color:#aebbd0;font-size:12px}.price-value{text-align:right;font-size:20px;font-weight:900}.text-link{display:inline-flex;gap:14px;margin-top:28px;color:var(--white);font-weight:850;text-underline-offset:5px}.place-grid{display:grid;grid-template-columns:1fr 1fr;gap:64px;align-items:start}.address-card{padding:36px;border-radius:var(--radius);background:var(--pink);color:var(--white)}.address-card h3{font-size:34px}.address-card address{font-style:normal;font-size:19px;line-height:1.6}.address-card a{display:inline-flex;margin-top:24px;font-weight:850;text-underline-offset:5px}.hours{margin:0;padding:0;list-style:none;border-top:1px solid var(--line)}.hours li{display:flex;justify-content:space-between;padding:14px 0;border-bottom:1px solid var(--line)}.hours strong{font-variant-numeric:tabular-nums}.why{background:#eaf0ff}.why-grid{display:grid;grid-template-columns:1fr 1fr;gap:80px}.check-list{display:grid;gap:14px;margin:0;padding:0;list-style:none}.check-list li{position:relative;padding:20px 22px 20px 54px;border-radius:20px;background:rgba(255,255,255,.72);font-weight:760}.check-list li:before{content:"✓";position:absolute;left:20px;color:var(--pink);font-weight:950}.faq-grid{display:grid;grid-template-columns:.7fr 1.3fr;gap:80px}.faq-list{border-top:1px solid var(--line)}details{border-bottom:1px solid var(--line)}summary{position:relative;cursor:pointer;padding:22px 46px 22px 0;font-size:18px;font-weight:850;list-style:none}summary::-webkit-details-marker{display:none}summary:after{content:"+";position:absolute;right:8px;font-size:24px;font-weight:500}details[open] summary:after{content:"−"}.answer{max-width:680px;padding:0 44px 24px 0;color:var(--muted)}.answer a{font-weight:800;text-underline-offset:4px}.final-cta{padding:86px 0;background:var(--pink);color:var(--white)}.final-grid{display:flex;align-items:end;justify-content:space-between;gap:50px}.final-grid h2{max-width:760px;margin-bottom:0}.final-grid .button{flex:none;background:var(--white);color:var(--ink)}footer{padding:50px 0;background:var(--ink);color:#c0cbdd}.footer-grid{display:flex;align-items:flex-start;justify-content:space-between;gap:40px}.footer-brand p{margin:14px 0 0;font-size:14px}.footer-links{display:flex;flex-wrap:wrap;gap:20px;font-size:13px}.footer-links a{text-underline-offset:4px}.source-note{margin-top:40px;padding-top:20px;border-top:1px solid rgba(255,255,255,.12);font-size:11px;color:#7f8da5}@media(max-width:900px){.nav-links a:not(.nav-cta){display:none}.hero{min-height:0}.hero-grid,.intro-grid,.price-layout,.place-grid,.why-grid,.faq-grid{grid-template-columns:1fr}.hero-grid{gap:46px}.hero-card{max-width:560px}.facts-bar{grid-template-columns:repeat(2,1fr)}.fact:nth-child(even){border-right:0}.fact{border-bottom:1px solid rgba(255,255,255,.16)}.fact:last-child{border-bottom:0}.path-grid{grid-template-columns:1fr}.path-card{min-height:270px}.path-card h3{margin-top:34px}.price-intro{position:static}.final-grid{align-items:flex-start;flex-direction:column}.footer-grid{flex-direction:column}}@media(max-width:560px){.wrap{width:min(100% - 28px,1180px)}.nav{padding-top:18px}.logo{width:108px}.nav-links .nav-cta{padding:10px 14px}.hero{padding-top:118px}.actions{flex-direction:column}.button{width:100%}.facts-bar{margin-top:42px}.fact{padding:18px 12px}.fact strong{font-size:15px}.section{padding:76px 0}.path-card{padding:24px}.address-card{padding:28px}.final-cta{padding:70px 0}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.button,.path-card{transition:none}}
    </style>
  </head>
  <body>
    <a class="skip" href="#main">Hoppa till innehållet</a>
    <header class="site-header">
      <div class="wrap nav">
        <a href="${escapeHtml(route.pathname)}" aria-label="Pickla – pickleball i Stockholm"><img class="logo" src="${escapeHtml(assets.logo)}" width="345" height="103" alt="Pickla"></a>
        <nav class="nav-links" aria-label="Huvudnavigering">
          <a href="#spela">Så spelar du</a>
          <a href="#priser">Priser</a>
          <a href="#hitta-hit">Hitta hit</a>
          <a class="nav-cta" href="${escapeHtml(route.links.booking.href)}" data-acquisition-cta="header-booking">Boka bana</a>
        </nav>
      </div>
    </header>
    <main id="main">
      <section class="hero">
        <div class="wrap">
          <div class="hero-grid">
            <div>
              <p class="eyebrow mint">Pickla · Solna Business Park</p>
              <h1>${escapeHtml(h1)}</h1>
              <p class="lead">Boka en egen bana, kom själv på Open Play eller börja med en kurs. Pickla ligger i Solna Business Park med direktbokning online.</p>
              <div class="actions">
                ${link(route.links.booking, "button button-primary", "hero-booking")}
                ${link(route.links.openPlay, "button button-secondary", "hero-open-play")}
              </div>
            </div>
            <aside class="hero-card" aria-label="Pickla i Solna">
              <img src="${escapeHtml(assets.venuePhoto)}" width="472" height="378" alt="En besökare i receptionen på Pickla i Solna" fetchpriority="high">
              <div class="hero-card-copy"><span><strong>Pickla</strong>${escapeHtml(facts.venue.streetAddress)} · ${escapeHtml(facts.venue.city)}</span><b class="court-mark" aria-label="${escapeHtml(facts.indoorPickleballCourtCount)} banor">${escapeHtml(facts.indoorPickleballCourtCount)}</b></div>
            </aside>
          </div>
          <div class="facts-bar" aria-label="Snabbfakta">
            <div class="fact"><span>Anläggning</span><strong>${escapeHtml(facts.indoorPickleballCourtCount)} inomhusbanor</strong></div>
            <div class="fact"><span>Banpris</span><strong>Från ${escapeHtml(facts.startingCourtPriceSek)} kr/timme</strong></div>
            ${firstVisitFact}
            <div class="fact"><span>Veckotider</span><strong>${allDaysOpen ? "Öppet alla dagar" : `${escapeHtml(openDaysCount)} öppna dagar`}</strong></div>
            <div class="fact"><span>Adress</span><strong>${escapeHtml(facts.venue.streetAddress)}</strong></div>
          </div>
        </div>
      </section>

      <section class="section" id="spela">
        <div class="wrap">
          <div class="intro-grid">
            <div><p class="eyebrow pink">Tre sätt att komma igång</p><h2>Välj hur du vill spela.</h2></div>
            <p class="intro-copy">Du behöver inte börja på ett visst sätt. Samla ditt eget gäng, kom till en social speltid eller lär dig grunderna i en kurs.</p>
          </div>
          <div class="path-grid">
            <a class="path-card" href="${escapeHtml(route.links.booking.href)}" data-acquisition-cta="path-booking"><span class="path-number">01</span><h3>Boka egen bana</h3><p>Välj dag, tid och bana i Picklas ordinarie bokningsflöde.</p><span class="path-link">Se lediga tider →</span></a>
            <a class="path-card" href="${escapeHtml(route.links.openPlay.href)}" data-acquisition-cta="path-open-play"><span class="path-number">02</span><h3>Kom själv på Open Play</h3><p>Se publicerade Open Play-tillfällen och hitta en tid som passar.</p><span class="path-link">Se Open Play →</span></a>
            <a class="path-card" href="${escapeHtml(route.links.courses.href)}" data-acquisition-cta="path-courses"><span class="path-number">03</span><h3>Börja med en kurs</h3><p>Upptäck aktuella nybörjarkurser och program med publicerade platser.</p><span class="path-link">Se kurser →</span></a>
          </div>
        </div>
      </section>

      <section class="section dark" id="priser">
        <div class="wrap price-layout">
          <div class="price-intro"><p class="eyebrow mint">Publika banpriser</p><h2>Spela från ${escapeHtml(facts.startingCourtPriceSek)} kr per bana och timme.</h2><p>Priset beror på dag och tid. Eventuella medlemsförmåner eller personliga priser visas först i den ordinarie bokningen.</p>${link(route.links.prices, "text-link", "prices-all")}</div>
          <ul class="price-list" aria-label="Banpriser">${facts.courtPrices.map(renderPriceRow).join("")}</ul>
        </div>
      </section>

      <section class="section" id="hitta-hit">
        <div class="wrap place-grid">
          <div class="address-card"><p class="eyebrow">Hitta till Pickla</p><h3>${escapeHtml(facts.venue.name)}</h3><address>${escapeHtml(facts.venue.streetAddress)}<br>${escapeHtml(facts.venue.postalCode)} ${escapeHtml(facts.venue.city)}<br>Solna Business Park</address><a href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener noreferrer">Öppna i Google Maps →</a></div>
          <div><p class="eyebrow pink">Öppettider</p><h2>${allDaysOpen ? "Öppet för spel hela veckan." : "Se veckans öppettider."}</h2><ul class="hours" aria-label="Öppettider">${displayHours.map(renderOpeningHour).join("")}</ul></div>
        </div>
      </section>

      <section class="section why">
        <div class="wrap why-grid">
          <div><p class="eyebrow pink">Varför Pickla?</p><h2>En tydlig väg från första slaget till nästa match.</h2></div>
          <ul class="check-list"><li>${escapeHtml(facts.indoorPickleballCourtCount)} bokningsbara pickleballbanor inomhus</li><li>Egen bana, Open Play och kurser i samma anläggning</li><li>Direktbokning online med aktuella tider och pris före köp</li><li>På ${escapeHtml(facts.venue.streetAddress)} i Solna Business Park</li></ul>
        </div>
      </section>

      <section class="section" id="fragor">
        <div class="wrap faq-grid">
          <div><p class="eyebrow pink">Vanliga frågor</p><h2>Det viktigaste före ditt besök.</h2></div>
          <div class="faq-list">
            <details><summary>Hur många pickleballbanor finns hos Pickla i Solna?</summary><div class="answer"><p>Pickla har ${escapeHtml(facts.indoorPickleballCourtCount)} aktiva inomhusbanor för pickleball.</p></div></details>
            <details><summary>Vad kostar det att boka en bana?</summary><div class="answer"><p>De publika banpriserna börjar på ${escapeHtml(facts.startingCourtPriceSek)} kr per bana och timme. Priset varierar med dag och tid och visas alltid i bokningen innan köp.</p></div></details>
            <details><summary>Kan jag komma utan en egen spelpartner?</summary><div class="answer"><p>Ja. På sidan för Open Play ser du aktuella tillfällen där du kan anmäla dig själv.</p></div></details>
            <details><summary>Finns det något för nybörjare?</summary><div class="answer"><p>Ja. <a href="${escapeHtml(route.links.courses.href)}" data-acquisition-cta="faq-courses">Se aktuella kurser och nybörjarprogram</a> med publicerade datum och priser.</p></div></details>
            <details><summary>Var ligger Pickla?</summary><div class="answer"><p>Pickla ligger på ${escapeHtml(fullAddress)}, i Solna Business Park.</p></div></details>
          </div>
        </div>
      </section>

      <section class="final-cta">
        <div class="wrap final-grid"><h2>Redo att spela pickleball i Stockholm?</h2>${link(route.links.booking, "button", "footer-booking")}</div>
      </section>
    </main>
    <footer>
      <div class="wrap">
        <div class="footer-grid"><div class="footer-brand"><img class="logo" src="${escapeHtml(assets.logo)}" width="345" height="103" alt="Pickla"><p>Pickleball i Solna Business Park.</p></div><nav class="footer-links" aria-label="Sidfot"><a href="${escapeHtml(route.links.membership.href)}" data-acquisition-cta="footer-membership">Medlemskap</a><a href="${escapeHtml(route.links.groups.href)}" data-acquisition-cta="footer-groups">Grupp &amp; företag</a><a href="/privacy">Integritet</a><a href="/terms">Villkor</a><a href="/cookies">Cookies</a></nav></div>
        <p class="source-note">Banor, publika priser och öppettider hämtas från Picklas kanoniska publika data vid bygge.</p>
      </div>
    </footer>
    ${attributionScript(route)}
  </body>
</html>\n`;
}
