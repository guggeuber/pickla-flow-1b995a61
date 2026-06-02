import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, Clock, Copy, Eye, FileText, Loader2, Mail, Send, Trophy, XCircle } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPatch, apiPost } from "@/lib/api";

const STATUS_LABELS: Record<string, string> = {
  new_event_lead: "Ny lead",
  offer_generated: "Offert skapad",
  pdf_ready: "PDF klar",
  mail_draft_ready: "Mailutkast",
  offer_sent: "Offert skickad",
  customer_replied: "Kund svarade",
  needs_reply: "Behöver svar",
  contacted: "Kontaktad",
  ready_to_book: "Redo att boka",
  booking_confirmed: "Bokning bekräftad",
  won: "Vunnen",
  lost: "Förlorad",
};

const TIMELINE_LABELS: Record<string, string> = {
  lead_created: "Lead created",
  offer_generated: "Offer generated",
  pdf_ready: "PDF ready",
  offer_sent: "Offer sent",
  followup_scheduled: "Follow-up scheduled",
  customer_reply_received: "Customer replied",
  ready_to_book: "Ready to book",
  booking_confirmed: "Booking confirmed",
  deposit_link_sent: "Deposit link sent",
  won: "Won",
  lost: "Lost",
};

const OFFER_PACKAGES: Record<string, {
  title: string;
  subtitle: string;
  pricePerPerson: number;
  included: string[];
  agenda: string[];
}> = {
  standard: {
    title: "Företagsevent Standard",
    subtitle: "75 min aktivitet med coach och lagspel",
    pricePerPerson: 295,
    included: ["75 min aktivitet", "Coach", "Bana", "Rack och bollar", "Lagtävling", "Score och upplägg"],
    agenda: ["Välkomstintro", "Regler och lagindelning", "Coachad aktivitet", "Final och prisutdelning"],
  },
  aw_social: {
    title: "AW Social Games",
    subtitle: "Pickleball + dart + pizza + dryck",
    pricePerPerson: 595,
    included: ["Pickleball", "Dart", "Pizza", "Dryck", "Social turnering", "Värdskap"],
    agenda: ["Ankomst och dryck", "Pickleball intro", "Dart challenge", "Pizza/AW", "Finalmoment"],
  },
  conference: {
    title: "Konferens + aktivitet",
    subtitle: "Möte, lunch och social sport",
    pricePerPerson: 845,
    included: ["Mötesyta", "Lunch", "Pickleball eller dart", "Coach/värd", "Utrustning", "Enkelt körschema"],
    agenda: ["Morgonmöte", "Lunch", "Aktivitetsblock", "Samling och nästa steg"],
  },
  league: {
    title: "Företagsliga",
    subtitle: "Återkommande liga under 6 veckor",
    pricePerPerson: 0,
    included: ["6 veckor", "Spelschema", "Tabell", "Finalkväll", "Kommunikation", "Pris till vinnare"],
    agenda: ["Kickoff", "Veckomatcher", "Tabelluppdatering", "Final och AW"],
  },
};

function latestOffer(lead: any) {
  const offers = Array.isArray(lead.event_offers) ? lead.event_offers : [];
  return offers.sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0] || null;
}

function formatSek(value?: number | null) {
  return `${Number(value || 0).toLocaleString("sv-SE")} kr`;
}

function formatEventDate(value?: string | null) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || raw || "Saknas";
}

function formatEventTime(value?: string | null) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : raw || "Saknas";
}

function cleanReplyPreview(value?: string | null) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (trimmed.startsWith(">")) return false;
      if (/^(on|på)\s.+(wrote|skrev):?$/i.test(trimmed)) return false;
      if (/^från:\s|^from:\s|^skickat:\s|^sent:\s|^till:\s|^to:\s|^ämne:\s|^subject:\s/i.test(trimmed)) return false;
      return true;
    })
    .join("\n")
    .replace(/\s*(On|På)\s.+?(wrote|skrev):[\s\S]*$/i, "")
    .replace(/\s*>[\s\S]*$/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function guessOfferPackage(lead: any) {
  const text = [
    lead.event_type,
    lead.message,
    ...(Array.isArray(lead.activities) ? lead.activities : []),
    ...(Array.isArray(lead.resources) ? lead.resources : []),
  ].join(" ").toLowerCase();
  if (/liga|league|serie|återkommande|6 veckor/.test(text)) return "league";
  if (/konferens|möte|lunch|workshop/.test(text)) return "conference";
  if (/aw|after work|pizza|dryck|bar|dart|mat|bubbel/.test(text)) return "aw_social";
  if (Number(lead.participants_count || 0) >= 30) return "aw_social";
  return lead.package_type && OFFER_PACKAGES[lead.package_type] ? lead.package_type : "standard";
}

function createOfferBuilderState(lead: any) {
  const packageType = guessOfferPackage(lead);
  const pack = OFFER_PACKAGES[packageType] || OFFER_PACKAGES.standard;
  const participants = Number(lead.participants_count || 1);
  const total = packageType === "league"
    ? Math.max(12000, Math.ceil(participants / 4) * 3500)
    : participants * pack.pricePerPerson;
  const resources = [
    ...(Array.isArray(lead.activities) ? lead.activities : []),
    ...(Array.isArray(lead.resources) ? lead.resources : []),
  ].filter(Boolean);
  return {
    lead,
    package_type: packageType,
    title: `${pack.title} för ${lead.company_name || lead.contact_name}`,
    intro: `Förslag baserat på er förfrågan: ${participants} personer hos Pickla med ${pack.subtitle.toLowerCase()}.`,
    price_per_person: pack.pricePerPerson,
    total_price: total,
    included: pack.included.join("\n"),
    agenda: pack.agenda.join("\n"),
    resources: resources.length ? resources.join("\n") : "Pickleball\nDart\nMat & dryck",
    food_drink_options: "Pizza, snacks och enklare servering kan läggas till.\nDryckespaket offereras efter gruppstorlek och tid.",
    practical_info: "Omklädningsrum och dusch finns på plats.\nParkering finns i direkt anslutning till anläggningen.\nVi hjälper till med lagindelning, regler och tempo på plats.",
    terms: "Offerten är preliminär tills tid och upplägg bekräftats.\nHandpenning krävs för att låsa bokningen.\nÄndring/avbokning enligt överenskommelse baserat på gruppstorlek och datum.",
    cta: "Svara på mailet så låser vi datum, upplägg och eventuell mat/dryck.",
  };
}

export default function AdminEventLeads({ venueId }: { venueId: string }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<any | null>(null);
  const [sendPreview, setSendPreview] = useState<any | null>(null);
  const [bookingPreview, setBookingPreview] = useState<any | null>(null);
  const [offerBuilder, setOfferBuilder] = useState<any | null>(null);
  const [depositAmount, setDepositAmount] = useState("");
  const { data: leads = [], isLoading } = useQuery<any[]>({
    queryKey: ["event-agent-leads", venueId],
    queryFn: () => apiGet("event-intake-agent", "leads", { venueId }),
  });

  const leadGroups = useMemo(() => {
    const active = leads.filter((lead) => !["won", "lost"].includes(lead.status));
    const closed = leads.filter((lead) => ["won", "lost"].includes(lead.status));
    return { active, closed };
  }, [leads]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["event-agent-leads", venueId] });

  const generateOffer = useMutation({
    mutationFn: ({ leadId, offerConfig }: { leadId: string; offerConfig?: any }) =>
      apiPost<any>("event-sales-agent", "generate-offer", { leadId, offerConfig }),
    onSuccess: async (result) => {
      toast.success("Offert skapad");
      setOfferBuilder(null);
      const offerId = result?.offer?.id;
      if (offerId) {
        await apiPost("event-sales-agent", "generate-pdf", { offerId }).catch((error) => toast.error(error.message));
      }
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const generateDraft = useMutation({
    mutationFn: (offerId: string) => apiPost<any>("event-sales-agent", "draft", { offerId }),
    onSuccess: (result) => {
      setDraft(result?.offer || result?.sales || result);
      toast.success("Mailutkast klart");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const previewSend = useMutation({
    mutationFn: (offerId: string) => apiGet<any>("event-sales-agent", "preview-send", { offerId }),
    onSuccess: (result) => setSendPreview(result),
    onError: (error: Error) => toast.error(error.message),
  });

  const sendOffer = useMutation({
    mutationFn: (offerId: string) => apiPost<any>("event-sales-agent", "send-offer", { offerId }),
    onSuccess: () => {
      toast.success("Offert skickad");
      setSendPreview(null);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const previewBooking = useMutation({
    mutationFn: ({ leadId, offerId }: { leadId: string; offerId?: string }) =>
      apiGet<any>("event-sales-agent", "booking-preview", { leadId, ...(offerId ? { offerId } : {}) }),
    onSuccess: (result) => {
      setBookingPreview(result);
      setDepositAmount(String(result?.default_deposit_amount || ""));
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const confirmBooking = useMutation({
    mutationFn: () => apiPost<any>("event-sales-agent", "confirm-booking", {
      leadId: bookingPreview?.lead?.id,
      offerId: bookingPreview?.offer?.id,
      depositAmountSek: Number(depositAmount || bookingPreview?.default_deposit_amount || 0),
    }),
    onSuccess: () => {
      toast.success("Bokning bekräftad och handpenning skickad");
      setBookingPreview(null);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const updateLead = useMutation({
    mutationFn: ({ leadId, status }: { leadId: string; status: string }) => apiPatch("event-intake-agent", "lead", { leadId, status }),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });

  const openPdf = async (offerId: string) => {
    const result = await apiGet<any>("event-sales-agent", "signed-url", { offerId });
    if (result?.signed_url) window.open(result.signed_url, "_blank", "noopener,noreferrer");
  };

  const copyDraft = async () => {
    const text = [`Subject: ${draft.email_subject || ""}`, "", draft.email_body || "", "", `SMS: ${draft.sms_text || ""}`].join("\n");
    await navigator.clipboard.writeText(text);
    toast.success("Utkast kopierat");
  };

  const formatDateTime = (value?: string | null) => {
    if (!value) return "";
    return new Date(value).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
  };

  const updateOfferBuilderPackage = (packageType: string) => {
    if (!offerBuilder) return;
    const pack = OFFER_PACKAGES[packageType] || OFFER_PACKAGES.standard;
    const participants = Number(offerBuilder.lead?.participants_count || 1);
    const total = packageType === "league"
      ? Math.max(12000, Math.ceil(participants / 4) * 3500)
      : participants * pack.pricePerPerson;
    setOfferBuilder({
      ...offerBuilder,
      package_type: packageType,
      title: `${pack.title} för ${offerBuilder.lead?.company_name || offerBuilder.lead?.contact_name}`,
      price_per_person: pack.pricePerPerson,
      total_price: total,
      included: pack.included.join("\n"),
      agenda: pack.agenda.join("\n"),
    });
  };

  const submitOfferBuilder = () => {
    if (!offerBuilder?.lead?.id) return;
    generateOffer.mutate({
      leadId: offerBuilder.lead.id,
      offerConfig: {
        package_type: offerBuilder.package_type,
        title: offerBuilder.title,
        intro: offerBuilder.intro,
        price_per_person: Number(offerBuilder.price_per_person || 0),
        total_price: Number(offerBuilder.total_price || 0),
        included: String(offerBuilder.included || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        agenda: String(offerBuilder.agenda || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        resources: String(offerBuilder.resources || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        food_drink_options: String(offerBuilder.food_drink_options || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        practical_info: String(offerBuilder.practical_info || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        terms: String(offerBuilder.terms || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        cta: offerBuilder.cta,
      },
    });
  };

  if (isLoading) {
    return <Loader2 className="mx-auto mt-8 h-5 w-5 animate-spin text-primary" />;
  }

  const renderLead = (lead: any) => {
    const offer = latestOffer(lead);
    const timeline = [
      ...(Array.isArray(lead.event_lead_activities) ? lead.event_lead_activities : []),
      ...(Array.isArray(lead.event_followups) ? lead.event_followups.map((f: any) => ({
        id: `followup-${f.id}`,
        activity_type: "followup_scheduled",
        title: "Follow-up scheduled",
        body: f.message,
        created_at: f.created_at || f.scheduled_at,
        metadata: { scheduled_at: f.scheduled_at, followup_type: f.followup_type, status: f.status },
      })) : []),
    ]
      .sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    const latestReply = timeline.find((item: any) => item.activity_type === "customer_reply_received");
    const eventUrl = lead.event_id ? `/hub/admin?event=${lead.event_id}` : null;
    const offerIsSent = offer?.status === "sent" || offer?.sent_at;
    const offerIsConfirmed = offer?.status === "booking_confirmed";
    return (
      <div key={lead.id} className="glass-card rounded-2xl p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
            <Trophy className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-bold text-foreground">{lead.company_name || lead.contact_name}</p>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">{lead.lead_score}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {lead.contact_name} · {lead.participants_count} pers · {lead.preferred_date || "datum flexibelt"}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {STATUS_LABELS[lead.status] || lead.status} · {lead.package_type || "paket ej valt"} · est. {formatSek(lead.estimated_value)}
            </p>
            {offer?.sent_at && (
              <p className="mt-1 text-[10px] font-semibold text-court-free">Skickad {formatDateTime(offer.sent_at)}</p>
            )}
            {latestReply && (
              <p className="mt-1 whitespace-pre-wrap rounded-lg bg-court-free/10 px-2 py-1 text-[10px] font-semibold leading-relaxed text-court-free">
                Kund svarade: {cleanReplyPreview(latestReply.body) || latestReply.subject || "Kunden svarade på mail."}
              </p>
            )}
          </div>
        </div>

        {lead.message && (
          <p className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">{lead.message}</p>
        )}

        <div className="rounded-xl border border-border bg-background/70 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Offert</p>
              <p className="text-xs text-muted-foreground">
                {offer
                  ? `${offer.title || "Offert"} · ${STATUS_LABELS[offer.status] || offer.status || "draft"}`
                  : "Ingen offert skapad ännu"}
              </p>
            </div>
            {offer?.total_price != null && <p className="text-sm font-bold text-foreground">{formatSek(offer.total_price)}</p>}
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              onClick={() => setOfferBuilder(createOfferBuilderState(lead))}
              disabled={generateOffer.isPending}
              className="rounded-xl bg-muted px-3 py-3 text-xs font-bold text-foreground disabled:opacity-50"
            >
              {generateOffer.isPending ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : <FileText className="mr-1 inline h-3.5 w-3.5" />}
              {offer ? "Skapa ny offert" : "Skapa offert"}
            </button>
            <button
              onClick={() => offer?.id ? previewSend.mutate(offer.id) : toast.info("Skapa offert först")}
              disabled={!offer?.id || offerIsSent || offerIsConfirmed || previewSend.isPending}
              className="rounded-xl bg-primary px-3 py-3 text-xs font-bold text-primary-foreground disabled:opacity-50"
            >
              {previewSend.isPending ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1 inline h-3.5 w-3.5" />}
              {offerIsSent ? "Offert skickad" : "Skicka offert"}
            </button>
            <button
              onClick={() => offer?.id ? generateDraft.mutate(offer.id) : toast.info("Skapa offert först")}
              disabled={!offer?.id}
              className="rounded-xl bg-muted px-3 py-2.5 text-xs font-bold text-foreground disabled:opacity-50"
            >
              <Mail className="mr-1 inline h-3.5 w-3.5" />
              Visa mailutkast
            </button>
            <button
              onClick={() => offer?.id ? openPdf(offer.id) : toast.info("PDF skapas efter offert")}
              disabled={!offer?.id}
              className="rounded-xl bg-muted px-3 py-2.5 text-xs font-bold text-foreground disabled:opacity-50"
            >
              <FileText className="mr-1 inline h-3.5 w-3.5" />
              Öppna PDF
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-background/70 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Closure</p>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              onClick={() => updateLead.mutate({ leadId: lead.id, status: "ready_to_book" })}
              disabled={lead.status === "booking_confirmed"}
              className="rounded-xl bg-court-free/15 px-3 py-2.5 text-xs font-bold text-court-free disabled:opacity-50"
            >
              <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
              Ready to book
            </button>
            <button
              onClick={() => offer?.id ? previewBooking.mutate({ leadId: lead.id, offerId: offer.id }) : toast.info("Skapa offert först")}
              disabled={previewBooking.isPending || lead.status === "booking_confirmed"}
              className="rounded-xl bg-primary px-3 py-2.5 text-xs font-bold text-primary-foreground disabled:opacity-50"
            >
              {previewBooking.isPending ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : <CalendarDays className="mr-1 inline h-3.5 w-3.5" />}
              Confirm Booking
            </button>
            <button
              onClick={() => {
                if (!lead.email) return toast.info("Leadet saknar email");
                window.location.href = `mailto:${lead.email}`;
              }}
              className="rounded-xl bg-muted px-3 py-2.5 text-xs font-bold text-foreground"
            >
              <Mail className="mr-1 inline h-3.5 w-3.5" />
              Svara
            </button>
            <button
              onClick={() => updateLead.mutate({ leadId: lead.id, status: "lost" })}
              className="rounded-xl bg-destructive/15 px-3 py-2.5 text-xs font-bold text-destructive"
            >
              <XCircle className="mr-1 inline h-3.5 w-3.5" />
              Mark Lost
            </button>
            <button
              onClick={() => eventUrl ? toast.info("Öppna Events och leta upp leadets event i pipeline") : toast.info("Leadet saknar internt event")}
              className="rounded-xl bg-muted px-3 py-2.5 text-xs font-bold text-foreground sm:col-span-2"
            >
              <CalendarDays className="mr-1 inline h-3.5 w-3.5" />
              Open Event
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-muted/25 p-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Timeline & kundsvar</p>
          {timeline.length > 0 ? (
            <div className="space-y-2">
              {timeline.map((item: any) => (
                <div key={item.id} className="flex gap-2 text-xs">
                  <div className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-background">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">{TIMELINE_LABELS[item.activity_type] || item.title || item.activity_type}</p>
                    {item.body && (
                      <p className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-muted-foreground">
                        {cleanReplyPreview(item.body) || item.body}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground">
                      {formatDateTime(item.metadata?.scheduled_at || item.created_at)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Inga timeline-händelser ännu. Skapa offert eller invänta kundsvar så fylls den här.</p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="glass-card rounded-2xl p-4">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Pickla Event Agent OS</p>
        <h2 className="mt-1 text-lg font-bold text-foreground">Event leads & offerter</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Intake, offert, PDF och mailutkast. Inget skickas automatiskt utan manuell approve.
        </p>
      </div>

      {leadGroups.active.length === 0 ? (
        <div className="rounded-2xl border border-border p-6 text-center text-sm text-muted-foreground">Inga aktiva eventleads ännu</div>
      ) : (
        <div className="space-y-3">{leadGroups.active.map(renderLead)}</div>
      )}

      {leadGroups.closed.length > 0 && (
        <div className="space-y-2 opacity-75">
          <p className="px-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Stängda</p>
          {leadGroups.closed.map(renderLead)}
        </div>
      )}

      {offerBuilder && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/55 px-4 py-8">
          <div className="mx-auto max-w-3xl rounded-2xl bg-background p-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Offer builder</p>
                <h3 className="font-bold">Bygg offert</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  AI/default föreslår startpaket. Justera upplägg, resurser och pris innan PDF/mail skapas.
                </p>
              </div>
              <button onClick={() => setOfferBuilder(null)}><XCircle className="h-5 w-5" /></button>
            </div>

            <div className="mt-4 rounded-xl border border-border bg-muted/25 p-3 text-xs">
              <p><span className="font-bold">Kund:</span> {offerBuilder.lead?.company_name || offerBuilder.lead?.contact_name}</p>
              <p className="mt-1">
                <span className="font-bold">Input:</span>{" "}
                {offerBuilder.lead?.participants_count || "?"} pers · {offerBuilder.lead?.preferred_date || "datum flexibelt"} · {offerBuilder.lead?.message || "ingen notering"}
              </p>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
              {Object.entries(OFFER_PACKAGES).map(([key, pack]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => updateOfferBuilderPackage(key)}
                  className={`rounded-xl border px-3 py-3 text-left text-xs transition ${
                    offerBuilder.package_type === key
                      ? "border-court-free bg-court-free/10 text-court-free"
                      : "border-border bg-muted/40 text-foreground"
                  }`}
                >
                  <span className="block font-bold">{pack.title}</span>
                  <span className="mt-1 block text-[10px] text-muted-foreground">{pack.subtitle}</span>
                </button>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="text-xs font-bold text-muted-foreground">
                Titel
                <input
                  value={offerBuilder.title}
                  onChange={(event) => setOfferBuilder({ ...offerBuilder, title: event.target.value })}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-3 text-sm font-semibold text-foreground"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-bold text-muted-foreground">
                  Pris/person
                  <input
                    value={offerBuilder.price_per_person}
                    onChange={(event) => setOfferBuilder({ ...offerBuilder, price_per_person: event.target.value })}
                    inputMode="numeric"
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-3 text-sm font-semibold text-foreground"
                  />
                </label>
                <label className="text-xs font-bold text-muted-foreground">
                  Totalpris
                  <input
                    value={offerBuilder.total_price}
                    onChange={(event) => setOfferBuilder({ ...offerBuilder, total_price: event.target.value })}
                    inputMode="numeric"
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-3 text-sm font-semibold text-foreground"
                  />
                </label>
              </div>
              <label className="md:col-span-2 text-xs font-bold text-muted-foreground">
                Intro
                <textarea
                  value={offerBuilder.intro}
                  onChange={(event) => setOfferBuilder({ ...offerBuilder, intro: event.target.value })}
                  rows={2}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-3 text-sm text-foreground"
                />
              </label>
              <label className="text-xs font-bold text-muted-foreground">
                Ingår
                <textarea
                  value={offerBuilder.included}
                  onChange={(event) => setOfferBuilder({ ...offerBuilder, included: event.target.value })}
                  rows={7}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-3 text-sm text-foreground"
                />
              </label>
              <label className="text-xs font-bold text-muted-foreground">
                Agenda
                <textarea
                  value={offerBuilder.agenda}
                  onChange={(event) => setOfferBuilder({ ...offerBuilder, agenda: event.target.value })}
                  rows={7}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-3 text-sm text-foreground"
                />
              </label>
              <label className="text-xs font-bold text-muted-foreground">
                Resurser/innehåll
                <textarea
                  value={offerBuilder.resources}
                  onChange={(event) => setOfferBuilder({ ...offerBuilder, resources: event.target.value })}
                  rows={5}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-3 text-sm text-foreground"
                />
              </label>
              <label className="text-xs font-bold text-muted-foreground">
                Mat/dryck
                <textarea
                  value={offerBuilder.food_drink_options}
                  onChange={(event) => setOfferBuilder({ ...offerBuilder, food_drink_options: event.target.value })}
                  rows={5}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-3 text-sm text-foreground"
                />
              </label>
              <label className="text-xs font-bold text-muted-foreground">
                Praktiskt
                <textarea
                  value={offerBuilder.practical_info}
                  onChange={(event) => setOfferBuilder({ ...offerBuilder, practical_info: event.target.value })}
                  rows={5}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-3 text-sm text-foreground"
                />
              </label>
              <label className="text-xs font-bold text-muted-foreground">
                Villkor
                <textarea
                  value={offerBuilder.terms}
                  onChange={(event) => setOfferBuilder({ ...offerBuilder, terms: event.target.value })}
                  rows={5}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-3 text-sm text-foreground"
                />
              </label>
              <label className="md:col-span-2 text-xs font-bold text-muted-foreground">
                CTA
                <input
                  value={offerBuilder.cta}
                  onChange={(event) => setOfferBuilder({ ...offerBuilder, cta: event.target.value })}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-3 text-sm text-foreground"
                />
              </label>
            </div>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button
                onClick={() => setOfferBuilder(null)}
                className="flex-1 rounded-xl bg-muted px-3 py-3 text-sm font-bold text-foreground"
              >
                Avbryt
              </button>
              <button
                onClick={submitOfferBuilder}
                disabled={generateOffer.isPending}
                className="flex-1 rounded-xl bg-primary px-3 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
              >
                {generateOffer.isPending ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : <FileText className="mr-2 inline h-4 w-4" />}
                Skapa offert + PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {draft && (
        <div className="fixed inset-0 z-50 bg-black/50 px-4 py-8">
          <div className="mx-auto max-w-lg rounded-2xl bg-background p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-bold">Mailutkast</h3>
              <button onClick={() => setDraft(null)}><XCircle className="h-5 w-5" /></button>
            </div>
            <p className="mt-3 text-xs font-bold text-muted-foreground">Subject</p>
            <p className="text-sm">{draft.email_subject}</p>
            <p className="mt-3 text-xs font-bold text-muted-foreground">Email</p>
            <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-muted p-3 text-xs">{draft.email_body}</pre>
            <p className="mt-3 text-xs font-bold text-muted-foreground">SMS/WhatsApp</p>
            <p className="rounded-xl bg-muted p-3 text-xs">{draft.sms_text}</p>
            <button onClick={copyDraft} className="mt-4 w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground">
              <Copy className="mr-2 inline h-4 w-4" />
              Kopiera utkast
            </button>
          </div>
        </div>
      )}

      {sendPreview && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/55 px-4 py-8">
          <div className="mx-auto max-w-xl rounded-2xl bg-background p-4 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Approve first</p>
                <h3 className="font-bold">Skicka offert</h3>
              </div>
              <button onClick={() => setSendPreview(null)}><XCircle className="h-5 w-5" /></button>
            </div>

            <div className="mt-4 rounded-xl border border-border bg-muted/25 p-3 text-xs">
              <p><span className="font-bold">Till:</span> {sendPreview.to}</p>
              <p className="mt-1"><span className="font-bold">Subject:</span> {sendPreview.subject}</p>
            </div>

            <p className="mt-4 text-xs font-bold text-muted-foreground">Email preview</p>
            <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-muted p-3 text-xs">{sendPreview.email_body}</pre>

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => sendPreview.signed_url && window.open(sendPreview.signed_url, "_blank", "noopener,noreferrer")}
                className="flex-1 rounded-xl bg-muted px-3 py-3 text-sm font-bold text-foreground"
              >
                <Eye className="mr-2 inline h-4 w-4" />
                Förhandsvisa PDF
              </button>
              <button
                onClick={() => sendOffer.mutate(sendPreview.offer.id)}
                disabled={sendOffer.isPending}
                className="flex-1 rounded-xl bg-primary px-3 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
              >
                {sendOffer.isPending ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : <Send className="mr-2 inline h-4 w-4" />}
                Godkänn & skicka
              </button>
            </div>

            <p className="mt-3 text-[11px] text-muted-foreground">
              Inget skickas förrän du klickar på Godkänn & skicka. PDF bifogas som bilaga.
            </p>
          </div>
        </div>
      )}

      {bookingPreview && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/55 px-4 py-8">
          <div className="mx-auto max-w-xl rounded-2xl bg-background p-4 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Approve first</p>
                <h3 className="font-bold">Confirm Booking</h3>
              </div>
              <button onClick={() => setBookingPreview(null)}><XCircle className="h-5 w-5" /></button>
            </div>

            <div className="mt-4 rounded-xl border border-border bg-muted/25 p-3 text-xs">
              <p><span className="font-bold">Kund:</span> {bookingPreview.lead?.company_name || bookingPreview.lead?.contact_name}</p>
              <p className="mt-1"><span className="font-bold">Event:</span> {bookingPreview.offer?.title}</p>
              <p className="mt-1">
                <span className="font-bold">Datum/tid:</span>{" "}
                {formatEventDate(bookingPreview.event?.start_date || bookingPreview.lead?.preferred_date)}
                {" · "}
                {formatEventTime(bookingPreview.event?.start_time || bookingPreview.lead?.preferred_time)}
                {bookingPreview.event?.end_time ? `-${formatEventTime(bookingPreview.event.end_time)}` : ""}
              </p>
              <p className="mt-1"><span className="font-bold">Totalpris:</span> {formatSek(bookingPreview.offer?.total_price || bookingPreview.lead?.estimated_value)}</p>
            </div>

            <div className={`mt-3 rounded-xl border p-3 text-xs ${bookingPreview.resource_check?.ok ? "border-court-free/30 bg-court-free/10" : "border-destructive/30 bg-destructive/10"}`}>
              <p className="font-bold">
                {bookingPreview.resource_check?.ok
                  ? bookingPreview.resource_check?.courtIds?.length === 0
                    ? "Ingen automatisk bankontroll"
                    : "Banor ser lediga ut"
                  : "Resurskontroll stoppar bokning"}
              </p>
              {bookingPreview.resource_check?.reason && <p className="mt-1 text-muted-foreground">{bookingPreview.resource_check.reason}</p>}
              {bookingPreview.resource_check?.ok && bookingPreview.resource_check?.courtIds?.length === 0 && (
                <p className="mt-1 text-muted-foreground">
                  Inga banor är kopplade för automatisk konfliktkontroll. Eventresurser som mat, dryck och lounge är planeringsinfo och blockerar inte bekräftelsen.
                </p>
              )}
              {bookingPreview.resource_check?.conflicts?.length > 0 && (
                <div className="mt-2 space-y-1">
                  {bookingPreview.resource_check.conflicts.map((conflict: any) => (
                    <p key={`${conflict.type}-${conflict.id}`} className="text-muted-foreground">
                      {conflict.type}: {conflict.label} · {conflict.court}
                    </p>
                  ))}
                </div>
              )}
            </div>

            <label className="mt-4 block text-xs font-bold text-muted-foreground">Handpenning</label>
            <input
              value={depositAmount}
              onChange={(event) => setDepositAmount(event.target.value)}
              inputMode="numeric"
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-3 text-sm font-bold text-foreground"
              placeholder="Handpenning i kr"
            />

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setBookingPreview(null)}
                className="flex-1 rounded-xl bg-muted px-3 py-3 text-sm font-bold text-foreground"
              >
                Avbryt
              </button>
              <button
                onClick={() => confirmBooking.mutate()}
                disabled={confirmBooking.isPending || !bookingPreview.resource_check?.ok || !Number(depositAmount)}
                className="flex-1 rounded-xl bg-primary px-3 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
              >
                {confirmBooking.isPending ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 inline h-4 w-4" />}
                Bekräfta & skicka
              </button>
            </div>

            <p className="mt-3 text-[11px] text-muted-foreground">
              Detta sätter eventet till booked, skickar bokningsbekräftelse och skapar Stripe-länk för handpenning.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
