import { PDFDocument, rgb, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1';

export type EventLeadInput = {
  slug?: string;
  venueId?: string;
  companyName?: string;
  company_name?: string;
  contactName?: string;
  contact_name?: string;
  name?: string;
  email?: string;
  phone?: string;
  participants?: number;
  participants_count?: number;
  preferredDate?: string;
  preferred_date?: string;
  preferredTime?: string;
  preferred_time?: string;
  eventType?: string;
  event_type?: string;
  activities?: string[];
  resources?: string[];
  notes?: string;
  message?: string;
  source?: string;
};

export const EVENT_PACKAGES = {
  standard: {
    key: 'standard',
    title: 'Företagsevent Standard',
    subtitle: '75 min aktivitet med coach och lagspel',
    pricePerPerson: 295,
    range: '295 kr/person',
    includes: ['75 min aktivitet', 'Coach', 'Bana', 'Rack och bollar', 'Lagtävling', 'Score och upplägg'],
    agenda: ['Välkomstintro', 'Regler och lagindelning', 'Coachad aktivitet', 'Final och prisutdelning'],
  },
  aw_social: {
    key: 'aw_social',
    title: 'AW Social Games',
    subtitle: 'Pickleball + dart + pizza + dryck',
    pricePerPerson: 595,
    range: '495-695 kr/person',
    includes: ['Pickleball', 'Dart', 'Pizza', 'Dryck', 'Social turnering', 'Värdskap'],
    agenda: ['Ankomst och dryck', 'Pickleball intro', 'Dart challenge', 'Pizza/AW', 'Finalmoment'],
  },
  conference: {
    key: 'conference',
    title: 'Konferens + aktivitet',
    subtitle: 'Möte, lunch och social sport',
    pricePerPerson: 845,
    range: '695-995 kr/person',
    includes: ['Mötesyta', 'Lunch', 'Pickleball eller dart', 'Coach/värd', 'Utrustning', 'Enkelt körschema'],
    agenda: ['Morgonmöte', 'Lunch', 'Aktivitetsblock', 'Samling och nästa steg'],
  },
  league: {
    key: 'league',
    title: 'Företagsliga',
    subtitle: 'Återkommande liga under 6 veckor',
    pricePerPerson: 0,
    range: 'Pris per lag',
    includes: ['6 veckor', 'Spelschema', 'Tabell', 'Finalkväll', 'Kommunikation', 'Pris till vinnare'],
    agenda: ['Kickoff', 'Veckomatcher', 'Tabelluppdatering', 'Final och AW'],
  },
};

export function sanitizeLeadInput(body: EventLeadInput) {
  const participants = Math.max(1, Math.min(Number(body.participants_count ?? body.participants ?? 1), 500));
  const preferredDate = String(body.preferred_date || body.preferredDate || '').match(/^\d{4}-\d{2}-\d{2}$/)
    ? String(body.preferred_date || body.preferredDate)
    : null;
  const activities = Array.isArray(body.activities) ? body.activities.map((v) => String(v).trim()).filter(Boolean).slice(0, 12) : [];
  const resources = Array.isArray(body.resources) ? body.resources.map((v) => String(v).trim()).filter(Boolean).slice(0, 12) : [];
  return {
    slug: String(body.slug || '').trim(),
    venueId: String(body.venueId || '').trim(),
    companyName: String(body.company_name || body.companyName || '').trim().slice(0, 180) || null,
    contactName: String(body.contact_name || body.contactName || body.name || '').trim().slice(0, 180),
    email: String(body.email || '').trim().slice(0, 255),
    phone: String(body.phone || '').trim().slice(0, 60) || null,
    participants,
    preferredDate,
    preferredTime: String(body.preferred_time || body.preferredTime || '').trim().slice(0, 80) || null,
    eventType: String(body.event_type || body.eventType || 'company').trim().slice(0, 80),
    activities,
    resources,
    message: String(body.message || body.notes || '').trim().slice(0, 1600) || null,
    source: String(body.source || 'group_inquiry').trim().slice(0, 80),
  };
}

export function scoreLead(lead: ReturnType<typeof sanitizeLeadInput>) {
  let score = 35;
  if (lead.companyName) score += 12;
  if (lead.email && lead.phone) score += 10;
  if (lead.preferredDate) score += 12;
  if (lead.participants >= 10) score += 10;
  if (lead.participants >= 25) score += 10;
  if (lead.activities.some((item) => /mat|dryck|pizza|bar/i.test(item))) score += 6;
  if (lead.resources.some((item) => /lounge|restaurang|bar|hela/i.test(item))) score += 6;
  if (/company|företag|team/i.test(lead.eventType)) score += 6;
  return Math.max(1, Math.min(score, 100));
}

export function choosePackage(lead: ReturnType<typeof sanitizeLeadInput>) {
  const text = [...lead.activities, ...lead.resources, lead.message || '', lead.eventType].join(' ').toLowerCase();
  if (/liga|league|serie|återkommande|6 veckor/.test(text)) return EVENT_PACKAGES.league;
  if (/konferens|möte|lunch|workshop/.test(text)) return EVENT_PACKAGES.conference;
  if (/aw|after work|pizza|dryck|bar|dart|mat/.test(text)) return EVENT_PACKAGES.aw_social;
  if (lead.participants >= 30) return EVENT_PACKAGES.aw_social;
  return EVENT_PACKAGES.standard;
}

export function estimateValue(lead: ReturnType<typeof sanitizeLeadInput>, pack = choosePackage(lead)) {
  if (pack.key === 'league') return Math.max(12000, Math.ceil(lead.participants / 4) * 3500);
  return lead.participants * pack.pricePerPerson;
}

export function leadSummary(lead: ReturnType<typeof sanitizeLeadInput>, pack = choosePackage(lead)) {
  return {
    package_key: pack.key,
    package_title: pack.title,
    reasoning: [
      lead.participants >= 25 ? 'Större grupp ger högre eventvärde.' : 'Gruppstorlek passar standardiserat upplägg.',
      lead.preferredDate ? 'Kunden har angett datum.' : 'Datum saknas och bör kvalificeras.',
      lead.activities.length ? `Valda aktiviteter: ${lead.activities.join(', ')}` : 'Aktiviteter behöver kvalificeras.',
    ],
  };
}

export function buildOfferPayload(lead: any, venue: any) {
  const normalized = sanitizeLeadInput({
    venueId: lead.venue_id,
    company_name: lead.company_name,
    contact_name: lead.contact_name,
    email: lead.email,
    phone: lead.phone,
    participants_count: lead.participants_count,
    preferred_date: lead.preferred_date,
    preferred_time: lead.preferred_time,
    event_type: lead.event_type,
    activities: lead.activities || [],
    resources: lead.resources || [],
    message: lead.message,
    source: lead.source,
  });
  const pack = EVENT_PACKAGES[lead.package_type as keyof typeof EVENT_PACKAGES] || choosePackage(normalized);
  const total = estimateValue(normalized, pack);
  const dateLabel = lead.preferred_date || 'Datum enligt överenskommelse';
  return {
    title: `${pack.title} för ${lead.company_name || lead.contact_name}`,
    intro: `Här är ett första upplägg för ett socialt företagsevent hos ${venue?.name || 'Pickla Solna'} med spel, energi och tydligt värdskap.`,
    package: pack,
    customer: {
      company_name: lead.company_name,
      contact_name: lead.contact_name,
      email: lead.email,
      phone: lead.phone,
      participants_count: lead.participants_count,
      preferred_date: dateLabel,
      preferred_time: lead.preferred_time || 'Flexibelt',
    },
    agenda: pack.agenda,
    price_per_person: pack.pricePerPerson,
    total_price: total,
    included: pack.includes,
    food_drink_options: [
      'Pizza, snacks och enklare servering kan läggas till.',
      'Dryckespaket offereras efter gruppstorlek och tid.',
      'Vi kan kombinera pickleball, dart och sociala finalmoment.',
    ],
    practical_info: [
      'Omklädningsrum och dusch finns på plats.',
      'Parkering finns i direkt anslutning till anläggningen.',
      'Vi hjälper till med lagindelning, regler och tempo på plats.',
    ],
    terms: [
      'Offerten är preliminär tills tid och upplägg bekräftats.',
      'Betalning sker enligt överenskommelse. Swish och kort fungerar smidigt hos oss.',
      'Ändring/avbokning enligt överenskommelse baserat på gruppstorlek och datum.',
    ],
    cta: 'Svara på mailet så låser vi datum, upplägg och eventuell mat/dryck.',
    venue: {
      name: venue?.name || 'Pickla Solna',
      email: venue?.email || 'solna@picklaparks.com',
      phone: venue?.phone || '08-83 33 63',
      address: venue?.address || 'Svetsarvägen 22',
    },
  };
}

export function buildOfferHtml(payload: any) {
  const rows = payload.included.map((item: string) => `<li>${escapeHtml(item)}</li>`).join('');
  const agenda = payload.agenda.map((item: string) => `<li>${escapeHtml(item)}</li>`).join('');
  const practical = payload.practical_info.map((item: string) => `<li>${escapeHtml(item)}</li>`).join('');
  const terms = payload.terms.map((item: string) => `<li>${escapeHtml(item)}</li>`).join('');
  return `<!doctype html>
<html lang="sv">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(payload.title)}</title>
  <style>
    @page { size: A4; margin: 0; }
    body { margin: 0; font-family: Inter, Arial, sans-serif; color: #0070ff; background: #fff9ea; }
    .page { width: 210mm; height: 297mm; box-sizing: border-box; padding: 24mm; page-break-after: always; background: linear-gradient(160deg,#fffbe7 0%,#fff9f1 55%,#ffd9f0 100%); border: 8px solid #0070ff; }
    .logo { font-size: 28px; font-weight: 900; text-align: center; margin-bottom: 28mm; }
    h1 { font-size: 34px; line-height: 1; margin: 0 0 10mm; }
    h2 { font-size: 22px; margin: 0 0 8mm; }
    p, li { font-size: 13px; line-height: 1.45; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .hero { height: 190mm; background: #111827; color: white; display:flex; align-items:end; padding: 16mm; font-size: 40px; letter-spacing: .03em; }
    .grid { display:grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
    .box { background: rgba(255,255,255,.68); border: 1px solid rgba(0,112,255,.25); padding: 8mm; }
    .footer { position:absolute; bottom: 16mm; left:24mm; right:24mm; font-size: 10px; }
  </style>
</head>
<body>
  <section class="page">
    <div class="logo">pickla</div>
    <h1>${escapeHtml(payload.title)}</h1>
    <p>${escapeHtml(payload.intro)}</p>
    <div class="box">
      <p><strong>Kund:</strong> ${escapeHtml(payload.customer.company_name || payload.customer.contact_name)}</p>
      <p><strong>Kontakt:</strong> ${escapeHtml(payload.customer.contact_name)} · ${escapeHtml(payload.customer.email)} · ${escapeHtml(payload.customer.phone || '')}</p>
      <p><strong>Datum:</strong> ${escapeHtml(payload.customer.preferred_date)} · ${escapeHtml(payload.customer.preferred_time)}</p>
      <p><strong>Antal:</strong> ${payload.customer.participants_count} personer</p>
    </div>
  </section>
  <section class="page"><div class="hero">SPEL · MAT · DRYCK · MAKLÖST KUL</div></section>
  <section class="page">
    <div class="logo">pickla</div>
    <h2>${escapeHtml(payload.package.title)}</h2>
    <p><strong>${escapeHtml(payload.package.range)}</strong></p>
    <div class="grid">
      <div class="box"><h2>Ingår</h2><ul>${rows}</ul></div>
      <div class="box"><h2>Agenda</h2><ul>${agenda}</ul></div>
    </div>
    <h2>Pris</h2>
    <p>${payload.price_per_person ? `${payload.price_per_person} kr/person` : payload.package.range}</p>
    <p><strong>Totalpris: ${Number(payload.total_price).toLocaleString('sv-SE')} kr</strong></p>
  </section>
  <section class="page">
    <div class="logo">pickla</div>
    <h2>Bra att veta</h2>
    <div class="grid">
      <div class="box"><h2>Praktiskt</h2><ul>${practical}</ul></div>
      <div class="box"><h2>Bokning</h2><ul>${terms}</ul></div>
    </div>
    <h2>Serveringstillstånd</h2>
    <p>Pickla Solna Business Park har serveringstillstånd. Vi serverar mat och dryck på plats.</p>
    <p><strong>${escapeHtml(payload.cta)}</strong></p>
    <div class="footer">Pickla Solna AB · Svetsarvägen 22, 171 41 Solna · Org.nr 556977-4481 · Godkänd för F-skatt</div>
  </section>
</body>
</html>`;
}

export async function buildOfferPdfBytes(payload: any) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const blue = rgb(0, 0.42, 1);
  const dark = rgb(0.05, 0.07, 0.12);
  const cream = rgb(1, 0.98, 0.92);
  const pink = rgb(1, 0.85, 0.95);

  const pageSize: [number, number] = [595.28, 841.89];
  const addPage = () => {
    const page = pdf.addPage(pageSize);
    page.drawRectangle({ x: 0, y: 0, width: pageSize[0], height: pageSize[1], color: cream });
    page.drawRectangle({ x: 0, y: 0, width: pageSize[0], height: 190, color: pink, opacity: 0.45 });
    page.drawRectangle({ x: 18, y: 18, width: pageSize[0] - 36, height: pageSize[1] - 36, borderColor: blue, borderWidth: 2 });
    page.drawText('pickla', { x: 265, y: 760, size: 24, font: bold, color: blue });
    return page;
  };
  const writeLines = (page: any, text: string, x: number, y: number, size = 11, max = 70, f = font) => {
    let yy = y;
    for (const line of wrap(text, max)) {
      page.drawText(pdfSafe(line), { x, y: yy, size, font: f, color: blue });
      yy -= size + 5;
    }
    return yy;
  };

  let page = addPage();
  page.drawText(pdfSafe(payload.title).slice(0, 42), { x: 70, y: 675, size: 30, font: bold, color: blue });
  writeLines(page, payload.intro, 70, 620, 12, 70);
  page.drawText('Kundinfo', { x: 70, y: 500, size: 15, font: bold, color: blue });
  writeLines(page, `${payload.customer.company_name || payload.customer.contact_name}\n${payload.customer.contact_name} · ${payload.customer.email}\nDatum: ${payload.customer.preferred_date} · ${payload.customer.preferred_time}\nAntal: ${payload.customer.participants_count} personer`, 70, 475, 11, 78);
  page.drawText('Bokning', { x: 70, y: 260, size: 15, font: bold, color: blue });
  writeLines(page, `${payload.venue.email} · ${payload.venue.phone}\n${payload.venue.address}`, 70, 235, 11, 78);

  page = pdf.addPage(pageSize);
  page.drawRectangle({ x: 0, y: 0, width: pageSize[0], height: pageSize[1], color: dark });
  page.drawText('PICKLA EVENT', { x: 68, y: 150, size: 44, font: bold, color: rgb(1, 1, 1) });
  page.drawText(pdfSafe('SPEL · MAT · DRYCK'), { x: 72, y: 112, size: 18, font, color: rgb(1, 1, 1) });

  page = addPage();
  page.drawText(pdfSafe(payload.package.title), { x: 70, y: 685, size: 24, font: bold, color: blue });
  page.drawText(pdfSafe(payload.package.range), { x: 70, y: 655, size: 14, font: bold, color: blue });
  page.drawText(pdfSafe('Ingår'), { x: 70, y: 600, size: 15, font: bold, color: blue });
  writeLines(page, payload.included.map((item: string) => `• ${item}`).join('\n'), 70, 575, 11, 65);
  page.drawText('Agenda', { x: 320, y: 600, size: 15, font: bold, color: blue });
  writeLines(page, payload.agenda.map((item: string) => `• ${item}`).join('\n'), 320, 575, 11, 48);
  page.drawText(pdfSafe(`Totalpris: ${Number(payload.total_price).toLocaleString('sv-SE')} kr`), { x: 70, y: 240, size: 20, font: bold, color: blue });

  page = addPage();
  page.drawText('Bra att veta', { x: 70, y: 685, size: 24, font: bold, color: blue });
  page.drawText('Praktiskt', { x: 70, y: 625, size: 15, font: bold, color: blue });
  writeLines(page, payload.practical_info.map((item: string) => `• ${item}`).join('\n'), 70, 600, 11, 75);
  page.drawText('Betalning och villkor', { x: 70, y: 430, size: 15, font: bold, color: blue });
  writeLines(page, payload.terms.map((item: string) => `• ${item}`).join('\n'), 70, 405, 11, 75);
  page.drawText(pdfSafe('Serveringstillstånd'), { x: 70, y: 245, size: 15, font: bold, color: blue });
  writeLines(page, 'Pickla Solna Business Park har serveringstillstånd. Vi serverar mat och dryck på plats. Det är förbjudet att ta med egen alkohol till våra lokaler.', 70, 220, 11, 75);
  page.drawText(pdfSafe('Pickla Solna AB · Org.nr 556977-4481 · Godkänd för F-skatt'), { x: 70, y: 80, size: 9, font, color: blue });

  return await pdf.save();
}

function pdfSafe(value: unknown) {
  return String(value ?? '')
    .replace(/[åÅ]/g, 'a')
    .replace(/[äÄ]/g, 'a')
    .replace(/[öÖ]/g, 'o')
    .replace(/[éÉ]/g, 'e')
    .replace(/[·•]/g, '-')
    .replace(/[–—]/g, '-');
}

export function buildSalesDraft(payload: any) {
  const subject = `Offert: ${payload.package.title} hos Pickla`;
  const emailBody = [
    `Hej ${payload.customer.contact_name || ''},`,
    '',
    `Tack för er förfrågan. Jag har satt ihop ett första upplägg för ${payload.customer.participants_count} personer hos Pickla.`,
    '',
    `Förslag: ${payload.package.title}`,
    `Pris: ${payload.package.range}`,
    `Preliminärt totalpris: ${Number(payload.total_price).toLocaleString('sv-SE')} kr`,
    '',
    payload.cta,
    '',
    'Hälsningar,',
    'Pickla Event',
  ].join('\n');
  const smsText = `Hej ${payload.customer.contact_name || ''}! Vi har tagit fram ett första eventförslag från Pickla: ${payload.package.title}. Jag skickar offert på mail.`;
  return { subject, emailBody, smsText };
}

export function buildFollowups(lead: any, offerId?: string | null) {
  const now = new Date();
  const days = [
    ['day_1_not_sent', 1, 'Skicka offerten om den inte redan är skickad.'],
    ['day_3_followup', 3, 'Följ upp: passar upplägget och datumet?'],
    ['day_7_new_angle', 7, 'Ny vinkel: lyft AW, social games eller konferenspaket.'],
    ['day_14_last_push', 14, 'Sista push: fråga om de vill låsa datum eller parkera för senare.'],
    ['post_event_thanks', 30, 'Efter event: tackmail och fråga om nästa event.'],
  ];
  return days.map(([type, offset, message]) => ({
    venue_id: lead.venue_id,
    event_lead_id: lead.id,
    event_offer_id: offerId || null,
    followup_type: type,
    scheduled_at: new Date(now.getTime() + Number(offset) * 24 * 60 * 60 * 1000).toISOString(),
    status: 'scheduled',
    message,
  }));
}

export async function assertVenueAdmin(admin: any, userId: string, venueId: string) {
  const { data: role } = await admin.from('user_roles').select('role').eq('user_id', userId).eq('role', 'super_admin').maybeSingle();
  if (role) return true;
  const { data: staff } = await admin.from('venue_staff').select('id').eq('user_id', userId).eq('venue_id', venueId).eq('is_active', true).maybeSingle();
  return !!staff;
}

export function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function wrap(text: string, max: number) {
  const lines: string[] = [];
  for (const raw of String(text || '').split('\n')) {
    let line = '';
    for (const word of raw.split(/\s+/)) {
      if (!word) continue;
      if ((line + ' ' + word).trim().length > max) {
        if (line) lines.push(line);
        line = word;
      } else {
        line = (line + ' ' + word).trim();
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}
