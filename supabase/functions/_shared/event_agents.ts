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
    pitch: 'Ett tryggt första eventpaket för företag som vill testa Pickla med tydlig struktur och högt tempo.',
    pricePerPerson: 295,
    range: '295 kr/person',
    includes: ['75 min aktivitet', 'Coach', 'Bana', 'Rack och bollar', 'Lagtävling', 'Score och upplägg'],
    agenda: ['Välkomstintro', 'Regler och lagindelning', 'Coachad aktivitet', 'Final och prisutdelning'],
  },
  aw_social: {
    key: 'aw_social',
    title: 'AW Social Games',
    subtitle: 'Pickleball + dart + pizza + dryck',
    pitch: 'Vårt mest sociala upplägg för AW, teamdagar och kundkvällar där spel och häng får lika mycket plats.',
    pricePerPerson: 595,
    range: '495-695 kr/person',
    includes: ['Pickleball', 'Dart', 'Pizza', 'Dryck', 'Social turnering', 'Värdskap'],
    agenda: ['Ankomst och dryck', 'Pickleball intro', 'Dart challenge', 'Pizza/AW', 'Finalmoment'],
  },
  conference: {
    key: 'conference',
    title: 'Konferens + aktivitet',
    subtitle: 'Möte, lunch och social sport',
    pitch: 'För grupper som vill kombinera fokus, mat och rörelse i ett sammanhållet dagsupplägg.',
    pricePerPerson: 845,
    range: '695-995 kr/person',
    includes: ['Mötesyta', 'Lunch', 'Pickleball eller dart', 'Coach/värd', 'Utrustning', 'Enkelt körschema'],
    agenda: ['Morgonmöte', 'Lunch', 'Aktivitetsblock', 'Samling och nästa steg'],
  },
  league: {
    key: 'league',
    title: 'Företagsliga',
    subtitle: 'Återkommande liga under 6 veckor',
    pitch: 'Ett återkommande koncept för företag som vill skapa energi, intern stolthet och återkommande träffar.',
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

function cleanList(value: unknown, fallback: string[] = []) {
  if (Array.isArray(value)) {
    const rows = value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 24);
    return rows.length ? rows : fallback;
  }
  if (typeof value === 'string') {
    const rows = value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).slice(0, 24);
    return rows.length ? rows : fallback;
  }
  return fallback;
}

function cleanText(value: unknown, fallback: string) {
  const text = String(value || '').trim();
  return text || fallback;
}

function cleanMoney(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

export function buildOfferPayload(lead: any, venue: any, offerConfig: any = {}) {
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
  const basePack = EVENT_PACKAGES[offerConfig.package_type as keyof typeof EVENT_PACKAGES]
    || EVENT_PACKAGES[offerConfig.packageKey as keyof typeof EVENT_PACKAGES]
    || EVENT_PACKAGES[lead.package_type as keyof typeof EVENT_PACKAGES]
    || choosePackage(normalized);
  const pricePerPerson = cleanMoney(offerConfig.price_per_person ?? offerConfig.pricePerPerson) ?? basePack.pricePerPerson;
  const packageRange = pricePerPerson ? `${pricePerPerson.toLocaleString('sv-SE')} kr/person` : basePack.range;
  const pack = {
    ...basePack,
    title: cleanText(offerConfig.package_title ?? offerConfig.packageTitle, basePack.title),
    subtitle: cleanText(offerConfig.package_subtitle ?? offerConfig.packageSubtitle, basePack.subtitle),
    pitch: cleanText(offerConfig.package_pitch ?? offerConfig.packagePitch, basePack.pitch),
    pricePerPerson,
    range: cleanText(offerConfig.package_range ?? offerConfig.packageRange, packageRange),
    includes: cleanList(offerConfig.included, basePack.includes),
    agenda: cleanList(offerConfig.agenda, basePack.agenda),
  };
  const fallbackTotal = pack.key === 'league'
    ? Math.max(12000, Math.ceil(normalized.participants / 4) * 3500)
    : normalized.participants * pack.pricePerPerson;
  const total = cleanMoney(offerConfig.total_price ?? offerConfig.totalPrice) ?? fallbackTotal;
  const dateLabel = lead.preferred_date || 'Datum enligt överenskommelse';
  return {
    title: cleanText(offerConfig.title, `${pack.title} för ${lead.company_name || lead.contact_name}`),
    intro: cleanText(
      offerConfig.intro,
      `Här är ett första upplägg för ett socialt företagsevent hos ${venue?.name || 'Pickla Solna'} med spel, energi och tydligt värdskap.`,
    ),
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
    agenda: cleanList(offerConfig.agenda, pack.agenda),
    price_per_person: pack.pricePerPerson,
    total_price: total,
    included: cleanList(offerConfig.included, pack.includes),
    food_drink_options: cleanList(offerConfig.food_drink_options ?? offerConfig.foodDrinkOptions, [
      'Pizza, snacks och enklare servering kan läggas till.',
      'Dryckespaket offereras efter gruppstorlek och tid.',
      'Vi kan kombinera pickleball, dart och sociala finalmoment.',
    ]),
    practical_info: cleanList(offerConfig.practical_info ?? offerConfig.practicalInfo, [
      'Omklädningsrum och dusch finns på plats.',
      'Parkering finns i direkt anslutning till anläggningen.',
      'Vi hjälper till med lagindelning, regler och tempo på plats.',
    ]),
    terms: cleanList(offerConfig.terms, [
      'Offerten är preliminär tills tid och upplägg bekräftats.',
      'Betalning sker enligt överenskommelse. Swish och kort fungerar smidigt hos oss.',
      'Ändring/avbokning enligt överenskommelse baserat på gruppstorlek och datum.',
    ]),
    resources: cleanList(offerConfig.resources, normalized.resources),
    cta: cleanText(offerConfig.cta, 'Svara på mailet så låser vi datum, upplägg och eventuell mat/dryck.'),
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
  const resources = (payload.resources || []).map((item: string) => `<li>${escapeHtml(item)}</li>`).join('');
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
  <section class="page">
    <div class="logo">pickla</div>
    <h2>${escapeHtml(payload.package.title)}</h2>
    <p><strong>${escapeHtml(payload.package.range)}</strong></p>
    <div class="grid">
      <div class="box"><h2>Ingår</h2><ul>${rows}</ul></div>
      <div class="box"><h2>Agenda</h2><ul>${agenda}</ul></div>
    </div>
    ${resources ? `<div class="box" style="margin-top:8mm"><h2>Resurser</h2><ul>${resources}</ul></div>` : ''}
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
  const blue = rgb(0, 0.38, 0.95);
  const navy = rgb(0.04, 0.07, 0.16);
  const muted = rgb(0.38, 0.45, 0.56);
  const green = rgb(0.06, 0.62, 0.28);
  const cream = rgb(1, 0.985, 0.94);
  const blush = rgb(1, 0.93, 0.98);
  const pale = rgb(0.96, 0.98, 1);
  const white = rgb(1, 1, 1);
  const line = rgb(0.82, 0.86, 0.91);

  const pageSize: [number, number] = [595.28, 841.89];
  const margin = 54;
  const contentWidth = pageSize[0] - margin * 2;

  const wrapToWidth = (text: unknown, maxWidth: number, size: number, f = font) => {
    const lines: string[] = [];
    for (const raw of pdfSafe(text).split('\n')) {
      if (!raw.trim()) {
        lines.push('');
        continue;
      }
      let lineText = '';
      for (const word of raw.split(/\s+/)) {
        const next = lineText ? `${lineText} ${word}` : word;
        if (f.widthOfTextAtSize(next, size) > maxWidth && lineText) {
          lines.push(lineText);
          lineText = word;
        } else {
          lineText = next;
        }
      }
      if (lineText) lines.push(lineText);
    }
    return lines;
  };

  const drawText = (
    page: any,
    text: unknown,
    x: number,
    y: number,
    options: {
      size?: number;
      width?: number;
      lineHeight?: number;
      maxLines?: number;
      font?: any;
      color?: any;
    } = {},
  ) => {
    const size = options.size || 11;
    const f = options.font || font;
    const color = options.color || navy;
    const lineHeight = options.lineHeight || size + 4;
    const width = options.width || contentWidth;
    let lines = wrapToWidth(text, width, size, f);
    if (options.maxLines && lines.length > options.maxLines) {
      lines = lines.slice(0, options.maxLines);
      const last = lines[lines.length - 1] || '';
      lines[lines.length - 1] = last.length > 3 ? `${last.replace(/\s+\S*$/, '')}...` : '...';
    }
    let yy = y;
    for (const item of lines) {
      if (item) page.drawText(item, { x, y: yy, size, font: f, color });
      yy -= lineHeight;
    }
    return yy;
  };

  const drawLabel = (page: any, text: string, x: number, y: number) => {
    page.drawText(pdfSafe(text).toUpperCase(), { x, y, size: 8.5, font: bold, color: muted, characterSpacing: 1.2 });
  };

  const drawRule = (page: any, y: number) => {
    page.drawLine({ start: { x: margin, y }, end: { x: pageSize[0] - margin, y }, thickness: 0.7, color: line });
  };

  const addPage = (pageNo: number) => {
    const page = pdf.addPage(pageSize);
    page.drawRectangle({ x: 0, y: 0, width: pageSize[0], height: pageSize[1], color: cream });
    page.drawRectangle({ x: 0, y: 0, width: pageSize[0], height: 145, color: blush, opacity: 0.55 });
    page.drawText('pickla', { x: margin, y: 774, size: 29, font: bold, color: navy });
    page.drawText(String(pageNo).padStart(2, '0'), { x: pageSize[0] - margin - 18, y: 781, size: 9, font: bold, color: muted });
    drawRule(page, 752);
    page.drawText(pdfSafe('Pickla Solna AB - Org.nr 556977-4481 - Godkand for F-skatt'), {
      x: margin,
      y: 40,
      size: 8,
      font,
      color: muted,
    });
    return page;
  };

  const drawCard = (page: any, x: number, y: number, w: number, h: number, options: { fill?: any; border?: any } = {}) => {
    page.drawRectangle({
      x,
      y,
      width: w,
      height: h,
      color: options.fill || white,
      opacity: options.fill ? 1 : 0.76,
      borderColor: options.border || line,
      borderWidth: 0.8,
    });
  };

  const drawListCard = (
    page: any,
    title: string,
    items: unknown[],
    x: number,
    y: number,
    w: number,
    h: number,
    options: { cols?: number; maxItems?: number } = {},
  ) => {
    drawCard(page, x, y, w, h, { fill: pale });
    drawLabel(page, title, x + 16, y + h - 26);
    const maxItems = options.maxItems || 8;
    const rows = (Array.isArray(items) ? items : []).map((item) => String(item || '').trim()).filter(Boolean).slice(0, maxItems);
    const list = rows.length ? rows : ['Enligt offert'];
    const colCount = options.cols || 1;
    const colGap = 12;
    const colWidth = (w - 32 - colGap * (colCount - 1)) / colCount;
    const perCol = Math.ceil(list.length / colCount);
    list.forEach((item, index) => {
      const col = Math.floor(index / perCol);
      const row = index % perCol;
      const xx = x + 16 + col * (colWidth + colGap);
      const yy = y + h - 52 - row * 29;
      page.drawText('-', { x: xx, y: yy + 1, size: 10, font: bold, color: blue });
      drawText(page, item, xx + 12, yy, { size: 10, width: colWidth - 12, lineHeight: 12, maxLines: 2, color: navy });
    });
    if (Array.isArray(items) && items.length > maxItems) {
      page.drawText(`+ ${items.length - maxItems} fler`, { x: x + 16, y: y + 14, size: 9, font: bold, color: muted });
    }
  };

  const title = pdfSafe(payload.title || payload.package?.title || 'Pickla Event');
  const customerName = payload.customer?.company_name || payload.customer?.contact_name || 'Kund';
  const price = Number(payload.total_price || 0).toLocaleString('sv-SE');
  const packageTitle = payload.package?.title || 'Eventpaket';

  let page = addPage(1);
  drawLabel(page, 'Eventoffert', margin, 706);
  drawText(page, title, margin, 670, { size: 30, width: contentWidth - 80, lineHeight: 34, maxLines: 3, font: bold });
  drawText(page, payload.intro, margin, 560, { size: 12, width: contentWidth, lineHeight: 18, maxLines: 7 });

  drawCard(page, margin, 330, contentWidth, 150);
  drawLabel(page, 'Kund och förfrågan', margin + 18, 452);
  drawText(page, customerName, margin + 18, 424, { size: 15, width: 220, maxLines: 2, font: bold });
  drawText(page, `${payload.customer?.contact_name || ''}\n${payload.customer?.email || ''}\n${payload.customer?.phone || ''}`, margin + 18, 384, { size: 10, width: 220, lineHeight: 15, maxLines: 4, color: muted });
  drawText(page, `Datum: ${payload.customer?.preferred_date || 'Enligt overenskommelse'}\nTid: ${payload.customer?.preferred_time || 'Flexibelt'}\nAntal: ${payload.customer?.participants_count || '-'} personer`, 330, 424, { size: 11, width: 160, lineHeight: 17, maxLines: 4, font: bold });

  drawCard(page, margin, 208, 245, 78, { fill: navy, border: navy });
  drawLabel(page, 'Paket', margin + 18, 260);
  drawText(page, packageTitle, margin + 18, 238, { size: 14, width: 205, maxLines: 2, font: bold, color: white });
  drawCard(page, 330, 208, 211, 78, { fill: pale, border: line });
  drawLabel(page, 'Totalpris', 348, 260);
  drawText(page, `${price} kr`, 348, 234, { size: 22, width: 170, maxLines: 1, font: bold, color: green });

  drawLabel(page, 'Kontakt', margin, 150);
  drawText(page, `${payload.venue?.email || 'solna@picklaparks.com'} - ${payload.venue?.phone || '08-83 33 63'}\n${payload.venue?.address || 'Svetsarvagen 22'}`, margin, 128, { size: 10, width: contentWidth, lineHeight: 15, maxLines: 2, color: muted });

  page = addPage(2);
  drawLabel(page, 'Paket och innehåll', margin, 706);
  drawText(page, packageTitle, margin, 676, { size: 25, width: contentWidth, lineHeight: 30, maxLines: 2, font: bold });
  drawText(page, payload.package?.range || '', margin, 620, { size: 14, width: contentWidth, maxLines: 1, font: bold, color: blue });

  drawListCard(page, 'Ingår', payload.included || [], margin, 352, 238, 220, { maxItems: 8 });
  drawListCard(page, 'Agenda', payload.agenda || [], 303, 352, 238, 220, { maxItems: 7 });
  drawListCard(page, 'Resurser', payload.resources || [], margin, 190, contentWidth, 120, { cols: 2, maxItems: 8 });
  drawCard(page, margin, 105, contentWidth, 54, { fill: navy, border: navy });
  page.drawText(pdfSafe(`Totalpris: ${price} kr`), { x: margin + 18, y: 124, size: 20, font: bold, color: white });

  page = addPage(3);
  drawLabel(page, 'Praktisk info', margin, 706);
  drawText(page, 'Bra att veta', margin, 674, { size: 25, width: contentWidth, maxLines: 1, font: bold });
  drawListCard(page, 'Praktiskt', payload.practical_info || [], margin, 492, contentWidth, 135, { maxItems: 5 });
  drawListCard(page, 'Mat och dryck', payload.food_drink_options || [], margin, 330, contentWidth, 125, { maxItems: 5 });
  drawListCard(page, 'Betalning och villkor', payload.terms || [], margin, 150, contentWidth, 145, { maxItems: 5 });
  drawText(page, 'Pickla Solna Business Park har serveringstillstand. Vi serverar mat och dryck pa plats. Det ar forbjudet att ta med egen alkohol till vara lokaler.', margin, 110, { size: 9, width: contentWidth, lineHeight: 13, maxLines: 3, color: muted });
  drawText(page, payload.cta, margin, 82, { size: 11, width: contentWidth, maxLines: 2, font: bold, color: navy });

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

export function buildFollowupsFromSentAt(lead: any, offerId: string, sentAt: string) {
  const base = new Date(sentAt);
  const days = [
    ['day_3_followup', 3, 'Följ upp offerten: passar upplägget, datumet och nivån?'],
    ['day_7_new_angle', 7, 'Ny vinkel: lyft AW, social games eller konferenspaket.'],
    ['day_14_last_push', 14, 'Sista push: fråga om de vill låsa datum eller parkera för senare.'],
    ['post_event_thanks', 30, 'Efter event: tackmail och fråga om nästa event.'],
  ];
  return days.map(([type, offset, message]) => ({
    venue_id: lead.venue_id,
    event_lead_id: lead.id,
    event_offer_id: offerId,
    followup_type: type,
    scheduled_at: new Date(base.getTime() + Number(offset) * 24 * 60 * 60 * 1000).toISOString(),
    status: 'scheduled',
    message,
  }));
}

export function leadActivity({
  lead,
  offerId,
  type,
  title,
  body,
  actorUserId,
  metadata = {},
}: {
  lead: any;
  offerId?: string | null;
  type: string;
  title: string;
  body?: string | null;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  return {
    venue_id: lead.venue_id,
    event_lead_id: lead.id,
    event_offer_id: offerId || null,
    activity_type: type,
    title,
    body: body || null,
    actor_user_id: actorUserId || null,
    metadata,
  };
}

export function emailHtmlFromText(text: string) {
  const paragraphs = String(text || '')
    .split(/\n{2,}/)
    .map((part) => `<p>${escapeHtml(part).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return `<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;color:#111827;line-height:1.55">${paragraphs}</body></html>`;
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
