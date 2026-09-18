import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const fromRoot = (...parts) => path.join(root, ...parts);

function fail(message) {
  throw new Error(`[public-web] ${message}`);
}

function expectIncludes(source, expected, label) {
  if (!source.includes(expected)) fail(`${label} is missing: ${expected}`);
}

function expectExcludes(source, value, label) {
  if (source.includes(value)) fail(`${label} unexpectedly contains: ${value}`);
}

const [html, joinHtml, sitemap, robots, factsText, vercelText, mailProxy] = await Promise.all([
  readFile(fromRoot("dist/pickleball-stockholm/index.html"), "utf8"),
  readFile(fromRoot("dist/join/index.html"), "utf8"),
  readFile(fromRoot("dist/sitemap.xml"), "utf8"),
  readFile(fromRoot("dist/robots.txt"), "utf8"),
  readFile(fromRoot("dist/public-web/pickleball-stockholm.build-facts.json"), "utf8"),
  readFile(fromRoot("vercel.json"), "utf8"),
  readFile(fromRoot("api/mail.ts"), "utf8"),
]);

const facts = JSON.parse(factsText);
const vercel = JSON.parse(vercelText);
const expectedTitle = `Pickleball i Stockholm – ${facts.indoor_pickleball_court_count} inomhusbanor i Solna | Pickla`;
const expectedDescription = `Spela pickleball på ${facts.indoor_pickleball_court_count} inomhusbanor i Solna Business Park. Se priser, Open Play, nybörjarkurser, öppettider och boka direkt hos Pickla.`;
const expectedH1 = `Spela pickleball i Stockholm – ${facts.indoor_pickleball_court_count} inomhusbanor i Solna`;
const escapedTitle = expectedTitle.replaceAll("&", "&amp;");

expectIncludes(html, `<title>${escapedTitle}</title>`, "title");
expectIncludes(html, `<meta name="description" content="${expectedDescription}">`, "meta description");
expectIncludes(html, '<link rel="canonical" href="https://playpickla.com/pickleball-stockholm">', "canonical");
expectIncludes(html, '<meta name="robots" content="index,follow">', "robots meta");
expectIncludes(html, `<h1>${expectedH1}</h1>`, "H1");
expectIncludes(html, facts.venue.streetAddress, "street address");
expectIncludes(html, facts.venue.postalCode, "postal code");
expectIncludes(html, `${facts.indoor_pickleball_court_count} inomhusbanor`, "court count");
expectIncludes(html, `Från ${facts.starting_court_price_sek} kr`, "canonical starting price");
expectIncludes(facts.provenance.prices, "/api-event-public/public-prices", "pricing provenance");

for (const href of ["/book?", "/openplay?", "/courses?", "/prices?", "/membership?", "/book/group?"]) {
  expectIncludes(html, `<a`, "crawlable links");
  expectIncludes(html, `href="${href}`, `crawlable ${href} link`);
}

const jsonLdMatch = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/);
if (!jsonLdMatch) fail("structured data script is missing");
const jsonLd = JSON.parse(jsonLdMatch[1]);
if (!Array.isArray(jsonLd["@type"]) || !jsonLd["@type"].includes("SportsActivityLocation")) {
  fail("SportsActivityLocation structured data is missing");
}
if (jsonLd.address?.streetAddress !== facts.venue.streetAddress || jsonLd.address?.postalCode !== facts.venue.postalCode) {
  fail("structured data address does not match visible canonical facts");
}
if (!Array.isArray(jsonLd.openingHoursSpecification) || jsonLd.openingHoursSpecification.length < 1) {
  fail("structured data opening hours are missing");
}
if ("telephone" in jsonLd || "aggregateRating" in jsonLd || "geo" in jsonLd) {
  fail("structured data contains an unverified field");
}

for (const forbidden of [
  'id="root"',
  "manifest.webmanifest",
  "registerSW",
  "serviceWorker.register",
  "AuthProvider",
  "QueryClientProvider",
  "stripe",
  "PICKLA_MAIL_PROXY_CREDENTIAL",
  "api.resend.com",
]) expectExcludes(html, forbidden, "static Public Web HTML");
if (/<script\s+[^>]*src=/i.test(html)) fail("Public Web loads an external JavaScript bundle");

for (const expected of [
  'data-pickla-mail-signup',
  'STAY IN THE PICKLA LOOP',
  "Events, community, new things we're building and the occasional story worth reading.",
  'Yes, send me Pickla news &amp; community.',
  'JOIN PICKLA',
  'Check your inbox to confirm.',
  'fetch("/mail/subscribe"',
  'href="/privacy"',
  'For adults 18+',
]) expectIncludes(html, expected, "Pickla Mail public signup");
if (/name="consent"[^>]*\bchecked\b/i.test(html)) fail("Pickla Mail consent must be unchecked");
if (html.indexOf('data-pickla-mail-signup') < html.indexOf('class="final-cta"')
  || html.indexOf('data-pickla-mail-signup') > html.indexOf('<footer>')) {
  fail("Pickla Mail signup must follow acquisition content and precede the footer");
}

const imageTags = html.match(/<img\b[^>]*>/g) || [];
if (!imageTags.length || imageTags.some((tag) => !/\bwidth="\d+"/.test(tag) || !/\bheight="\d+"/.test(tag))) {
  fail("every Public Web image must have intrinsic dimensions");
}

expectIncludes(sitemap, "https://playpickla.com/pickleball-stockholm", "sitemap route");
expectIncludes(sitemap, "https://playpickla.com/join", "sitemap join route");
expectExcludes(sitemap, "https://www.playpickla.com", "sitemap");
expectExcludes(sitemap, "<lastmod>", "sitemap");
for (const privatePath of ["/my", "/checkout", "/orders", "/receipts", "/claims", "/invites", "/desk", "/hub/admin", "/ops"]) {
  expectExcludes(sitemap, `<loc>https://playpickla.com${privatePath}`, "sitemap");
}

if ((robots.match(/^User-agent:/gm) || []).length !== 1) fail("robots.txt must have one consistent user-agent group");
expectExcludes(robots, "User-agent: Googlebot", "robots.txt");
expectIncludes(robots, "Sitemap: https://playpickla.com/sitemap.xml", "robots sitemap declaration");

const publicHeader = vercel.headers.find((entry) => entry.source === "/pickleball-stockholm");
if (!publicHeader?.headers?.some((header) => header.key === "X-Robots-Tag" && header.value === "index, follow")) {
  fail("Public Web index header is missing");
}
const joinHeader = vercel.headers.find((entry) => entry.source === "/join");
if (!joinHeader?.headers?.some((header) => header.key === "X-Robots-Tag" && header.value === "index, follow")) {
  fail("/join index header is missing");
}
const genericDocumentHeader = vercel.headers.find((entry) => entry.source.includes("[^/]+$"));
if (!genericDocumentHeader?.source.includes("pickleball-stockholm$") || !genericDocumentHeader.source.includes("join$")) {
  fail("generic SPA no-store header must exclude both cacheable Public Web routes");
}
const privateHeaderSources = new Set(
  vercel.headers
    .filter((entry) => entry.headers?.some((header) => header.key === "X-Robots-Tag" && header.value === "noindex, nofollow"))
    .map((entry) => entry.source),
);
for (const source of ["/my", "/hub/(.*)", "/desk/(.*)", "/ops/(.*)", "/auth/(.*)", "/receipt/(.*)"]) {
  if (!privateHeaderSources.has(source)) fail(`private noindex header is missing for ${source}`);
}
const publicRewriteIndex = vercel.rewrites.findIndex((entry) => entry.source === "/pickleball-stockholm" && entry.destination === "/pickleball-stockholm/index.html");
const joinRewriteIndex = vercel.rewrites.findIndex((entry) => entry.source === "/join" && entry.destination === "/join/index.html");
const fallbackIndex = vercel.rewrites.findIndex((entry) => entry.source === "/(.*)" && entry.destination === "/index.html");
if (publicRewriteIndex < 0 || joinRewriteIndex < 0 || fallbackIndex < 0
  || publicRewriteIndex > fallbackIndex || joinRewriteIndex > fallbackIndex) {
  fail("Public Web routes must be served before the preserved SPA fallback");
}
if (vercel.rewrites[publicRewriteIndex].has) fail("Public Web rewrite must not vary by crawler");
if (vercel.rewrites[joinRewriteIndex].has) fail("/join rewrite must not vary by crawler");
const mailProxyRewrite = vercel.rewrites.find((entry) => entry.source === "/mail/:action" && entry.destination === "/api/mail?action=:action");
if (!mailProxyRewrite) fail("same-origin Pickla Mail proxy rewrite is missing");
for (const expected of ["PICKLA_MAIL_PROXY_CREDENTIAL", "x-pickla-mail-proxy", "x-pickla-client-network", "MAX_SUBSCRIBE_BODY_BYTES"]) {
  expectIncludes(mailProxy, expected, "Pickla Mail proxy");
}

const expectedManifests = [
  ["manifest.webmanifest", "/", "/", "Pickla"],
  ["manifest-desk.webmanifest", "/desk", "/desk", "Pickla Desk"],
  ["manifest-admin.webmanifest", "/hub/admin", "/hub/admin", "Pickla Admin"],
];
for (const [file, id, startUrl, name] of expectedManifests) {
  const manifest = JSON.parse(await readFile(fromRoot("dist", file), "utf8"));
  if (manifest.id !== id || manifest.start_url !== startUrl || manifest.name !== name) {
    fail(`${file} identity or startup behavior changed`);
  }
}

for (const expected of [
  "<title>Join Pickla — News, events and community</title>",
  '<meta name="robots" content="index,follow">',
  '<link rel="canonical" href="https://playpickla.com/join">',
  "STAY IN<br>THE PICKLA<br>LOOP",
  "Events. People. Things we're building.",
  "Yes, send me Pickla news &amp; community.",
  "JOIN PICKLA",
  'fetch("/mail/subscribe"',
  'source:"public_web_root"',
  'href="/privacy"',
]) expectIncludes(joinHtml, expected, "/join static HTML");
if (/name="consent"[^>]*\bchecked\b/i.test(joinHtml)) fail("/join consent must be unchecked");
if (/<script\s+[^>]*src=/i.test(joinHtml)) fail("/join loads an external JavaScript bundle");
for (const forbidden of [
  'id="root"',
  "manifest.webmanifest",
  "registerSW",
  "serviceWorker.register",
  "AuthProvider",
  "QueryClientProvider",
  "api.resend.com",
  "RESEND_API_KEY",
  "googletagmanager",
  "analytics",
]) expectExcludes(joinHtml, forbidden, "/join static Public Web HTML");

const executableScripts = [...html.matchAll(/<script(?! type="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/g)]
  .reduce((total, match) => total + Buffer.byteLength(match[1]), 0);
const inlineCss = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
  .reduce((total, match) => total + Buffer.byteLength(match[1]), 0);
const htmlBytes = Buffer.byteLength(html);
const venuePhotoBytes = (await stat(fromRoot("dist/public-web/pickla-venue.jpg"))).size;
const eagerResourceUrls = [...html.matchAll(/<(?:img|link)\b[^>]*(?:src|href)="([^"]+)"/g)]
  .map((match) => match[1])
  .filter((value) => !value.startsWith("https://playpickla.com/") && !value.startsWith("#"));
const initialRequestCount = 1 + new Set(eagerResourceUrls).size;
const budgets = {
  html: { actual: htmlBytes, maximum: 64 * 1024 },
  executable_js: { actual: executableScripts, maximum: 2 * 1024 },
  inline_css: { actual: inlineCss, maximum: 24 * 1024 },
  eager_venue_image: { actual: venuePhotoBytes, maximum: 80 * 1024 },
};
for (const [name, budget] of Object.entries(budgets)) {
  if (budget.actual > budget.maximum) fail(`${name} budget exceeded (${budget.actual} > ${budget.maximum})`);
}

const joinExecutableScripts = [...joinHtml.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)]
  .reduce((total, match) => total + Buffer.byteLength(match[1]), 0);
const joinInlineCss = [...joinHtml.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
  .reduce((total, match) => total + Buffer.byteLength(match[1]), 0);
const joinResourceUrls = [...joinHtml.matchAll(/<(?:img|link)\b[^>]*(?:src|href)="([^"]+)"/g)]
  .map((match) => match[1])
  .filter((value) => !value.startsWith("https://playpickla.com/") && !value.startsWith("#"));
const joinBudgets = {
  html: { actual: Buffer.byteLength(joinHtml), maximum: 24 * 1024 },
  executable_js: { actual: joinExecutableScripts, maximum: 2 * 1024 },
  inline_css: { actual: joinInlineCss, maximum: 12 * 1024 },
};
for (const [name, budget] of Object.entries(joinBudgets)) {
  if (budget.actual > budget.maximum) fail(`/join ${name} budget exceeded (${budget.actual} > ${budget.maximum})`);
}

console.log(JSON.stringify({
  ok: true,
  route: facts.route,
  venue: `${facts.venue.streetAddress}, ${facts.venue.postalCode} ${facts.venue.city}`,
  indoor_pickleball_courts: facts.indoor_pickleball_court_count,
  starting_court_price_sek: facts.starting_court_price_sek,
  budgets,
  external_javascript_files: 0,
  initial_request_count: initialRequestCount,
  join: {
    route: "/join",
    budgets: joinBudgets,
    external_javascript_files: 0,
    initial_request_count: 1 + new Set(joinResourceUrls).size,
  },
  pwa_start_urls: expectedManifests.map(([file, , startUrl]) => ({ file, start_url: startUrl })),
}, null, 2));
