import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, CalendarDays, CheckCircle2, Clock, Copy, Eye, FileText, Loader2, Mail, RefreshCw, Send, Trophy, XCircle } from "lucide-react";
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
  agent_recommendation: "Agent recommendation",
  agent_recommendation_created: "Agent recommendation created",
  agent_recommendation_approved: "Agent recommendation approved",
  agent_recommendation_rejected: "Agent recommendation rejected",
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

type OfferTemplate = {
  id?: string;
  template_key: string;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  default_price_per_person?: number | null;
  payload?: {
    included?: string[];
    agenda?: string[];
  } | null;
};

type OfferItem = {
  id: string;
  template_id?: string | null;
  item_type: string;
  title: string;
  description?: string | null;
  included_by_default?: boolean | null;
};

type OfferResource = {
  id: string;
  resource_type: string;
  name: string;
  description?: string | null;
  venue_court_id?: string | null;
  venue_staff_id?: string | null;
};

function fallbackTemplates(): OfferTemplate[] {
  return Object.entries(OFFER_PACKAGES).map(([template_key, pack]) => ({
    template_key,
    title: pack.title,
    subtitle: pack.subtitle,
    default_price_per_person: pack.pricePerPerson,
    payload: {
      included: pack.included,
      agenda: pack.agenda,
    },
  }));
}

function templatePack(template?: OfferTemplate | null) {
  const key = template?.template_key || "standard";
  const fallback = OFFER_PACKAGES[key] || OFFER_PACKAGES.standard;
  return {
    key,
    title: template?.title || fallback.title,
    subtitle: template?.subtitle || fallback.subtitle,
    pricePerPerson: Number(template?.default_price_per_person ?? fallback.pricePerPerson ?? 0),
    included: Array.isArray(template?.payload?.included) && template.payload.included.length
      ? template.payload.included
      : fallback.included,
    agenda: Array.isArray(template?.payload?.agenda) && template.payload.agenda.length
      ? template.payload.agenda
      : fallback.agenda,
  };
}

function groupedByType<T extends { item_type?: string; resource_type?: string }>(rows: T[], key: "item_type" | "resource_type") {
  return rows.reduce<Record<string, T[]>>((acc, row) => {
    const type = String(row[key] || "annat");
    acc[type] = acc[type] || [];
    acc[type].push(row);
    return acc;
  }, {});
}

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

function timeInputValue(value?: string | null) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : "";
}

function eventScheduleFromLead(lead: any) {
  const event = lead?.event || lead?.events || {};
  return {
    event_date: formatEventDate(event.start_date || lead?.preferred_date) === "Saknas" ? "" : formatEventDate(event.start_date || lead?.preferred_date),
    start_time: timeInputValue(event.start_time || lead?.preferred_time),
    end_time: timeInputValue(event.end_time),
  };
}

function eventScheduleFromPreview(preview: any) {
  const event = preview?.event || {};
  const lead = preview?.lead || {};
  const eventDate = formatEventDate(event.start_date || lead.preferred_date);
  return {
    event_date: eventDate === "Saknas" ? "" : eventDate,
    start_time: timeInputValue(event.start_time || lead.preferred_time),
    end_time: timeInputValue(event.end_time),
  };
}

function validateScheduleFields(schedule: { event_date?: string; start_time?: string; end_time?: string }) {
  if (!schedule.event_date) return "Ange eventdatum";
  if (!schedule.start_time) return "Ange starttid";
  if (!schedule.end_time) return "Ange sluttid";
  if (schedule.end_time <= schedule.start_time) return "Sluttid måste vara efter starttid";
  return null;
}

function blockResourceName(block: any) {
  const resource = Array.isArray(block?.event_resource_catalog)
    ? block.event_resource_catalog[0]
    : block?.event_resource_catalog;
  return resource?.name || block?.title || "Resurs";
}

function impactRegistrationCount(impact: any) {
  if (typeof impact?.activities?.registrations_count === "number") return impact.activities.registrations_count;
  return (impact?.activities?.samples || []).reduce((sum: number, row: any) => sum + Number(row.registrations_count || 0), 0);
}

function latestAgentRecommendation(timeline: any[]) {
  return timeline.find((item) => item.activity_type === "agent_recommendation") || null;
}

function agentActionLabel(action?: string | null) {
  const labels: Record<string, string> = {
    approve_offer: "Godkänn offert",
    create_offer: "Skapa offert",
    review_activity_capacity: "Granska aktivitetspåverkan",
    resolve_conflicts: "Lös kapacitetskonflikt",
    set_schedule: "Sätt datum och tid",
    review: "Granska",
  };
  return labels[String(action || "review")] || String(action || "review").replace(/_/g, " ");
}

function agentRiskClass(risk?: string | null) {
  if (risk === "high") return "border-destructive/35 bg-destructive/10 text-destructive";
  if (risk === "medium") return "border-yellow-500/35 bg-yellow-500/10 text-yellow-200";
  return "border-court-free/35 bg-court-free/10 text-court-free";
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

function guessOfferPackage(lead: any, templates: OfferTemplate[] = fallbackTemplates()) {
  const text = [
    lead.event_type,
    lead.message,
    ...(Array.isArray(lead.activities) ? lead.activities : []),
    ...(Array.isArray(lead.resources) ? lead.resources : []),
  ].join(" ").toLowerCase();
  const available = new Set(templates.map((template) => template.template_key));
  const pick = (key: string) => available.has(key) ? key : templates[0]?.template_key || "standard";
  if (/liga|league|serie|återkommande|6 veckor/.test(text)) return pick("league");
  if (/konferens|möte|lunch|workshop/.test(text)) return pick("conference");
  if (/aw|after work|pizza|dryck|bar|dart|mat|bubbel/.test(text)) return pick("aw_social");
  if (Number(lead.participants_count || 0) >= 30) return pick("aw_social");
  return lead.package_type && available.has(lead.package_type) ? lead.package_type : pick("standard");
}

function createOfferBuilderState(lead: any, catalog?: any) {
  const templates = Array.isArray(catalog?.templates) && catalog.templates.length ? catalog.templates as OfferTemplate[] : fallbackTemplates();
  const items = Array.isArray(catalog?.items) ? catalog.items as OfferItem[] : [];
  const resources = Array.isArray(catalog?.resources) ? catalog.resources as OfferResource[] : [];
  const schedule = eventScheduleFromLead(lead);
  const packageType = guessOfferPackage(lead, templates);
  const selectedTemplate = templates.find((template) => template.template_key === packageType) || templates[0];
  const pack = templatePack(selectedTemplate);
  const participants = Number(lead.participants_count || 1);
  const total = packageType === "league"
    ? Math.max(12000, Math.ceil(participants / 4) * 3500)
    : participants * pack.pricePerPerson;
  const leadResources = [
    ...(Array.isArray(lead.activities) ? lead.activities : []),
    ...(Array.isArray(lead.resources) ? lead.resources : []),
  ].filter(Boolean);
  const defaultItemIds = items
    .filter((item) => item.included_by_default && (!item.template_id || item.template_id === selectedTemplate?.id))
    .map((item) => item.id);
  const lowerText = [...leadResources, lead.message || "", pack.title, pack.subtitle].join(" ").toLowerCase();
  const defaultResourceIds = resources
    .filter((resource) => {
      if (resource.resource_type === "court") return /pickle|bana|spel|aktivitet/.test(lowerText) && ["Bana 1 Center Court", "Bana 2"].includes(resource.name);
      if (resource.resource_type === "staff") return /coach|värd|event|instruktör|spel/.test(lowerText) && ["Coach", "Eventvärd"].includes(resource.name);
      if (resource.resource_type === "food_drink") return /mat|dryck|pizza|aw|bubbel|servering/.test(lowerText);
      if (resource.resource_type === "space") return /lounge|restaurang|bar|konferens|möte|aw/.test(lowerText);
      return false;
    })
    .map((resource) => resource.id)
    .slice(0, 8);
  return {
    lead,
    template_id: selectedTemplate?.id || null,
    package_type: packageType,
    title: `${pack.title} för ${lead.company_name || lead.contact_name}`,
    intro: `Förslag baserat på er förfrågan: ${participants} personer hos Pickla med ${pack.subtitle.toLowerCase()}.`,
    price_per_person: pack.pricePerPerson,
    total_price: total,
    included: pack.included.join("\n"),
    agenda: pack.agenda.join("\n"),
    resources: leadResources.length ? leadResources.join("\n") : "Pickleball\nDart\nMat & dryck",
    selected_item_ids: defaultItemIds,
    selected_resource_ids: defaultResourceIds,
    food_drink_options: "Pizza, snacks och enklare servering kan läggas till.\nDryckespaket offereras efter gruppstorlek och tid.",
    practical_info: "Omklädningsrum och dusch finns på plats.\nParkering finns i direkt anslutning till anläggningen.\nVi hjälper till med lagindelning, regler och tempo på plats.",
    terms: "Offerten är preliminär tills tid och upplägg bekräftats.\nHandpenning krävs för att låsa bokningen.\nÄndring/avbokning enligt överenskommelse baserat på gruppstorlek och datum.",
    cta: "Svara på mailet så låser vi datum, upplägg och eventuell mat/dryck.",
    event_date: schedule.event_date,
    start_time: schedule.start_time,
    end_time: schedule.end_time,
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
  const { data: offerCatalog } = useQuery<any>({
    queryKey: ["event-offer-catalog", venueId],
    queryFn: () => apiGet("event-sales-agent", "offer-catalog", { venueId }),
    staleTime: 60_000,
  });

  const leadGroups = useMemo(() => {
    const active = leads.filter((lead) => !["won", "lost"].includes(lead.status));
    const closed = leads.filter((lead) => ["won", "lost"].includes(lead.status));
    return { active, closed };
  }, [leads]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["event-agent-leads", venueId] });
    qc.invalidateQueries({ queryKey: ["admin-agent-inbox", venueId] });
  };

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
      setBookingPreview({ ...result, schedule_edit: eventScheduleFromPreview(result) });
      setDepositAmount(String(result?.default_deposit_amount || ""));
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const confirmBooking = useMutation({
    mutationFn: async () => {
      const schedule = bookingPreview?.schedule_edit || {};
      const scheduleError = validateScheduleFields(schedule);
      if (scheduleError) throw new Error(scheduleError);
      await apiPatch("event-sales-agent", "schedule", {
        leadId: bookingPreview?.lead?.id,
        eventDate: schedule.event_date,
        startTime: schedule.start_time,
        endTime: schedule.end_time,
      });
      return apiPost<any>("event-sales-agent", "confirm-booking", {
        leadId: bookingPreview?.lead?.id,
        offerId: bookingPreview?.offer?.id,
        depositAmountSek: Number(depositAmount || bookingPreview?.default_deposit_amount || 0),
      });
    },
    onSuccess: (result) => {
      toast.success("Bokning bekräftad och handpenning skickad");
      setBookingPreview((current: any) => current ? { ...current, confirmation: result } : result);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const updateSchedule = useMutation({
    mutationFn: ({ leadId, eventDate, startTime, endTime }: { leadId: string; eventDate: string; startTime: string; endTime: string }) =>
      apiPatch<any>("event-sales-agent", "schedule", { leadId, eventDate, startTime, endTime }),
    onSuccess: () => {
      toast.success("Schema sparat");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const updateLead = useMutation({
    mutationFn: ({ leadId, status }: { leadId: string; status: string }) => apiPatch("event-intake-agent", "lead", { leadId, status }),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });

  const agentRecommendation = useMutation({
    mutationFn: ({ leadId, action, recommendationActivityId }: { leadId: string; action: "approve" | "reject" | "reanalyze"; recommendationActivityId?: string }) =>
      apiPost("event-sales-agent", "agent-recommendation", { leadId, action, recommendationActivityId }),
    onSuccess: (_result, variables) => {
      toast.success(
        variables.action === "approve"
          ? "Agentförslag godkänt"
          : variables.action === "reject"
            ? "Agentförslag avvisat"
            : "Agenten har analyserat igen",
      );
      refresh();
    },
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

  const saveBookingPreviewSchedule = async () => {
    if (!bookingPreview?.lead?.id) return;
    const schedule = bookingPreview.schedule_edit || {};
    const scheduleError = validateScheduleFields(schedule);
    if (scheduleError) {
      toast.error(scheduleError);
      return;
    }
    await updateSchedule.mutateAsync({
      leadId: bookingPreview.lead.id,
      eventDate: schedule.event_date,
      startTime: schedule.start_time,
      endTime: schedule.end_time,
    });
    const refreshed = await apiGet<any>("event-sales-agent", "booking-preview", {
      leadId: bookingPreview.lead.id,
      ...(bookingPreview.offer?.id ? { offerId: bookingPreview.offer.id } : {}),
    });
    setBookingPreview({ ...refreshed, schedule_edit: eventScheduleFromPreview(refreshed) });
  };

  const formatDateTime = (value?: string | null) => {
    if (!value) return "";
    return new Date(value).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
  };

  const updateOfferBuilderPackage = (packageType: string) => {
    if (!offerBuilder) return;
    const templates = Array.isArray(offerCatalog?.templates) && offerCatalog.templates.length ? offerCatalog.templates as OfferTemplate[] : fallbackTemplates();
    const items = Array.isArray(offerCatalog?.items) ? offerCatalog.items as OfferItem[] : [];
    const selectedTemplate = templates.find((template) => template.template_key === packageType) || templates[0];
    const pack = templatePack(selectedTemplate);
    const participants = Number(offerBuilder.lead?.participants_count || 1);
    const total = packageType === "league"
      ? Math.max(12000, Math.ceil(participants / 4) * 3500)
      : participants * pack.pricePerPerson;
    const defaultItemIds = items
      .filter((item) => item.included_by_default && (!item.template_id || item.template_id === selectedTemplate?.id))
      .map((item) => item.id);
    setOfferBuilder({
      ...offerBuilder,
      template_id: selectedTemplate?.id || null,
      package_type: packageType,
      title: `${pack.title} för ${offerBuilder.lead?.company_name || offerBuilder.lead?.contact_name}`,
      price_per_person: pack.pricePerPerson,
      total_price: total,
      included: pack.included.join("\n"),
      agenda: pack.agenda.join("\n"),
      selected_item_ids: defaultItemIds,
    });
  };

  const submitOfferBuilder = async () => {
    if (!offerBuilder?.lead?.id) return;
    const schedule = {
      event_date: String(offerBuilder.event_date || ""),
      start_time: String(offerBuilder.start_time || ""),
      end_time: String(offerBuilder.end_time || ""),
    };
    const scheduleError = validateScheduleFields(schedule);
    if (scheduleError) {
      toast.error(scheduleError);
      return;
    }
    const catalogItems = Array.isArray(offerCatalog?.items) ? offerCatalog.items as OfferItem[] : [];
    const catalogResources = Array.isArray(offerCatalog?.resources) ? offerCatalog.resources as OfferResource[] : [];
    const selectedItemTitles = catalogItems
      .filter((item) => Array.isArray(offerBuilder.selected_item_ids) && offerBuilder.selected_item_ids.includes(item.id))
      .map((item) => item.title);
    const selectedResourceNames = catalogResources
      .filter((resource) => Array.isArray(offerBuilder.selected_resource_ids) && offerBuilder.selected_resource_ids.includes(resource.id))
      .map((resource) => resource.name);
    const included = [
      ...String(offerBuilder.included || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      ...selectedItemTitles,
    ].filter((item, index, all) => all.indexOf(item) === index);
    const resources = [
      ...String(offerBuilder.resources || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      ...selectedResourceNames,
    ].filter((item, index, all) => all.indexOf(item) === index);
    await updateSchedule.mutateAsync({
      leadId: offerBuilder.lead.id,
      eventDate: schedule.event_date,
      startTime: schedule.start_time,
      endTime: schedule.end_time,
    });
    generateOffer.mutate({
      leadId: offerBuilder.lead.id,
      offerConfig: {
        package_type: offerBuilder.package_type,
        template_id: offerBuilder.template_id,
        selected_item_ids: Array.isArray(offerBuilder.selected_item_ids) ? offerBuilder.selected_item_ids : [],
        selected_resource_ids: Array.isArray(offerBuilder.selected_resource_ids) ? offerBuilder.selected_resource_ids : [],
        title: offerBuilder.title,
        intro: offerBuilder.intro,
        price_per_person: Number(offerBuilder.price_per_person || 0),
        total_price: Number(offerBuilder.total_price || 0),
        included,
        agenda: String(offerBuilder.agenda || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        resources,
        food_drink_options: String(offerBuilder.food_drink_options || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        practical_info: String(offerBuilder.practical_info || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        terms: String(offerBuilder.terms || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        cta: offerBuilder.cta,
        event_date: schedule.event_date,
        event_start_time: schedule.start_time,
        event_end_time: schedule.end_time,
      },
    });
  };

  if (isLoading) {
    return <Loader2 className="mx-auto mt-8 h-5 w-5 animate-spin text-primary" />;
  }

  const catalogTemplates = Array.isArray(offerCatalog?.templates) && offerCatalog.templates.length
    ? offerCatalog.templates as OfferTemplate[]
    : fallbackTemplates();
  const catalogItems = Array.isArray(offerCatalog?.items) ? offerCatalog.items as OfferItem[] : [];
  const catalogResources = Array.isArray(offerCatalog?.resources) ? offerCatalog.resources as OfferResource[] : [];
  const itemGroups = groupedByType(catalogItems, "item_type");
  const resourceGroups = groupedByType(catalogResources, "resource_type");

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
    const agent = latestAgentRecommendation(timeline);
    const agentMeta = agent?.metadata || {};
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

        <div className={`rounded-xl border p-3 ${agentRiskClass(agentMeta.risk)}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest opacity-80">Agent Recommendation</p>
              <h3 className="mt-1 text-sm font-black text-foreground">{lead.company_name || lead.contact_name}</h3>
            </div>
            <Bot className="h-5 w-5 shrink-0" />
          </div>

          {agent ? (
            <div className="mt-3 space-y-3 text-xs">
              <div>
                <p className="font-bold text-foreground">Recommended</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {agentMeta.recommended_package?.title && (
                    <span className="rounded-full bg-background/80 px-2 py-1 font-semibold text-foreground">
                      {agentMeta.recommended_package.title}
                    </span>
                  )}
                  {(agentMeta.recommended_resources || []).slice(0, 6).map((resource: any) => (
                    <span key={resource.resource_catalog_id || resource.name} className="rounded-full bg-background/80 px-2 py-1 font-semibold text-foreground">
                      {resource.name}
                    </span>
                  ))}
                  {!(agentMeta.recommended_resources || []).length && (
                    <span className="text-muted-foreground">Resurser behöver väljas</span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="rounded-lg bg-background/75 p-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Capacity</p>
                  <p className="mt-1 font-black text-foreground">{agentMeta.capacity_ok ? "OK" : "Conflict"}</p>
                </div>
                <div className="rounded-lg bg-background/75 p-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Risk</p>
                  <p className="mt-1 font-black text-foreground">{agentMeta.risk || "low"}</p>
                </div>
                <div className="rounded-lg bg-background/75 p-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Next</p>
                  <p className="mt-1 font-black text-foreground">{agentActionLabel(agentMeta.next_action)}</p>
                </div>
              </div>

              {(agentMeta.affected_activities || []).length > 0 && (
                <div>
                  <p className="font-bold text-foreground">Affected</p>
                  <div className="mt-1 space-y-1">
                    {(agentMeta.affected_activities || []).slice(0, 4).map((activity: any) => (
                      <p key={`${activity.activity_session_id}-${activity.session_date}`} className="text-muted-foreground">
                        {activity.name} · {activity.session_date} {activity.start_time}-{activity.end_time} · {activity.registrations_count || 0} anmälda
                      </p>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="font-bold text-foreground">Recommendation</p>
                <p className="mt-1 text-muted-foreground">{agentMeta.summary || agent.body}</p>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => agentRecommendation.mutate({ leadId: lead.id, action: "approve", recommendationActivityId: agent.id })}
                  disabled={agentRecommendation.isPending}
                  className="rounded-xl bg-court-free/15 px-3 py-2.5 text-xs font-bold text-court-free disabled:opacity-50"
                >
                  <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => agentRecommendation.mutate({ leadId: lead.id, action: "reject", recommendationActivityId: agent.id })}
                  disabled={agentRecommendation.isPending}
                  className="rounded-xl bg-destructive/15 px-3 py-2.5 text-xs font-bold text-destructive disabled:opacity-50"
                >
                  <XCircle className="mr-1 inline h-3.5 w-3.5" />
                  Reject
                </button>
                <button
                  type="button"
                  onClick={() => agentRecommendation.mutate({ leadId: lead.id, action: "reanalyze" })}
                  disabled={agentRecommendation.isPending}
                  className="rounded-xl bg-background px-3 py-2.5 text-xs font-bold text-foreground disabled:opacity-50"
                >
                  {agentRecommendation.isPending ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 inline h-3.5 w-3.5" />}
                  Re-analyze
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 space-y-3 text-xs">
              <p className="text-muted-foreground">Ingen agentrekommendation finns ännu för leadet.</p>
              <button
                type="button"
                onClick={() => agentRecommendation.mutate({ leadId: lead.id, action: "reanalyze" })}
                disabled={agentRecommendation.isPending}
                className="w-full rounded-xl bg-background px-3 py-2.5 text-xs font-bold text-foreground disabled:opacity-50"
              >
                {agentRecommendation.isPending ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 inline h-3.5 w-3.5" />}
                Re-analyze
              </button>
            </div>
          )}
        </div>

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
              onClick={() => setOfferBuilder(createOfferBuilderState(lead, offerCatalog))}
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

            <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Schema</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Kund önskade: {offerBuilder.lead?.preferred_date || "datum flexibelt"} · {formatEventTime(offerBuilder.lead?.preferred_time)}
              </p>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <label className="text-xs font-bold text-muted-foreground">
                  Event date
                  <input
                    type="date"
                    value={offerBuilder.event_date || ""}
                    onChange={(event) => setOfferBuilder({ ...offerBuilder, event_date: event.target.value })}
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-3 text-sm font-semibold text-foreground"
                  />
                </label>
                <label className="text-xs font-bold text-muted-foreground">
                  Start time
                  <input
                    type="time"
                    value={offerBuilder.start_time || ""}
                    onChange={(event) => setOfferBuilder({ ...offerBuilder, start_time: event.target.value })}
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-3 text-sm font-semibold text-foreground"
                  />
                </label>
                <label className="text-xs font-bold text-muted-foreground">
                  End time
                  <input
                    type="time"
                    value={offerBuilder.end_time || ""}
                    onChange={(event) => setOfferBuilder({ ...offerBuilder, end_time: event.target.value })}
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-3 text-sm font-semibold text-foreground"
                  />
                </label>
              </div>
              <p className="mt-2 text-[11px] font-semibold text-foreground">
                Operativt schema: {offerBuilder.event_date || "datum saknas"} · {offerBuilder.start_time || "--:--"}-{offerBuilder.end_time || "--:--"}
              </p>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
              {catalogTemplates.map((template) => {
                const pack = templatePack(template);
                return (
                <button
                  key={template.id || template.template_key}
                  type="button"
                  onClick={() => updateOfferBuilderPackage(template.template_key)}
                  className={`rounded-xl border px-3 py-3 text-left text-xs transition ${
                    offerBuilder.package_type === template.template_key
                      ? "border-court-free bg-court-free/10 text-court-free"
                      : "border-border bg-muted/40 text-foreground"
                  }`}
                >
                  <span className="block font-bold">{pack.title}</span>
                  <span className="mt-1 block text-[10px] text-muted-foreground">{pack.subtitle}</span>
                </button>
              )})}
            </div>

            {catalogItems.length > 0 && (
              <div className="mt-4 rounded-xl border border-border bg-muted/20 p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Innehåll och tillval</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Det du markerar här följer med i offerten. Personal kan fortfarande skriva över texten nedan.
                </p>
                <div className="mt-3 space-y-3">
                  {Object.entries(itemGroups).map(([type, rows]) => (
                    <div key={type}>
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{type.replace("_", " ")}</p>
                      <div className="flex flex-wrap gap-2">
                        {rows.map((item) => {
                          const selected = Array.isArray(offerBuilder.selected_item_ids) && offerBuilder.selected_item_ids.includes(item.id);
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => {
                                const current = Array.isArray(offerBuilder.selected_item_ids) ? offerBuilder.selected_item_ids : [];
                                setOfferBuilder({
                                  ...offerBuilder,
                                  selected_item_ids: selected ? current.filter((id: string) => id !== item.id) : [...current, item.id],
                                });
                              }}
                              className={`rounded-full border px-3 py-2 text-[11px] font-semibold transition ${
                                selected ? "border-court-free bg-court-free/10 text-court-free" : "border-border bg-background text-foreground"
                              }`}
                            >
                              {selected ? "✓ " : ""}{item.title}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {catalogResources.length > 0 && (
              <div className="mt-4 rounded-xl border border-border bg-muted/20 p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Riktiga resurser</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Banor skrivs till eventet och används av resurskontrollen. Personal/ytor blir planeringsresurser.
                </p>
                <div className="mt-3 space-y-3">
                  {Object.entries(resourceGroups).map(([type, rows]) => (
                    <div key={type}>
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{type.replace("_", " ")}</p>
                      <div className="flex flex-wrap gap-2">
                        {rows.map((resource) => {
                          const selected = Array.isArray(offerBuilder.selected_resource_ids) && offerBuilder.selected_resource_ids.includes(resource.id);
                          return (
                            <button
                              key={resource.id}
                              type="button"
                              onClick={() => {
                                const current = Array.isArray(offerBuilder.selected_resource_ids) ? offerBuilder.selected_resource_ids : [];
                                setOfferBuilder({
                                  ...offerBuilder,
                                  selected_resource_ids: selected ? current.filter((id: string) => id !== resource.id) : [...current, resource.id],
                                });
                              }}
                              className={`rounded-full border px-3 py-2 text-[11px] font-semibold transition ${
                                selected ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-foreground"
                              }`}
                            >
                              {selected ? "✓ " : ""}{resource.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                disabled={generateOffer.isPending || updateSchedule.isPending}
                className="flex-1 rounded-xl bg-primary px-3 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
              >
                {generateOffer.isPending || updateSchedule.isPending ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : <FileText className="mr-2 inline h-4 w-4" />}
                {updateSchedule.isPending ? "Sparar schema" : "Skapa offert + PDF"}
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

            <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs">
              <p className="font-bold text-foreground">Event Schedule</p>
              <p className="mt-1 text-muted-foreground">
                Kund önskade: {bookingPreview.lead?.preferred_date || "datum flexibelt"} · {formatEventTime(bookingPreview.lead?.preferred_time)}
              </p>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <label className="text-[11px] font-bold text-muted-foreground">
                  Event date
                  <input
                    type="date"
                    value={bookingPreview.schedule_edit?.event_date || ""}
                    onChange={(event) => setBookingPreview((current: any) => ({
                      ...current,
                      schedule_edit: { ...(current?.schedule_edit || {}), event_date: event.target.value },
                    }))}
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-3 text-sm font-semibold text-foreground"
                  />
                </label>
                <label className="text-[11px] font-bold text-muted-foreground">
                  Start time
                  <input
                    type="time"
                    value={bookingPreview.schedule_edit?.start_time || ""}
                    onChange={(event) => setBookingPreview((current: any) => ({
                      ...current,
                      schedule_edit: { ...(current?.schedule_edit || {}), start_time: event.target.value },
                    }))}
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-3 text-sm font-semibold text-foreground"
                  />
                </label>
                <label className="text-[11px] font-bold text-muted-foreground">
                  End time
                  <input
                    type="time"
                    value={bookingPreview.schedule_edit?.end_time || ""}
                    onChange={(event) => setBookingPreview((current: any) => ({
                      ...current,
                      schedule_edit: { ...(current?.schedule_edit || {}), end_time: event.target.value },
                    }))}
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-3 text-sm font-semibold text-foreground"
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[11px] font-semibold text-foreground">
                  Operativt: {bookingPreview.schedule_edit?.event_date || "datum saknas"} · {bookingPreview.schedule_edit?.start_time || "--:--"}-{bookingPreview.schedule_edit?.end_time || "--:--"}
                </p>
                <button
                  type="button"
                  onClick={saveBookingPreviewSchedule}
                  disabled={updateSchedule.isPending || bookingPreview.confirmation}
                  className="rounded-xl bg-primary px-3 py-2 text-[11px] font-bold text-primary-foreground disabled:opacity-50"
                >
                  {updateSchedule.isPending ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : null}
                  Spara & kör om kontroll
                </button>
              </div>
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

            {bookingPreview.confirmation && (
              <div className="mt-3 space-y-3 rounded-xl border border-primary/25 bg-primary/5 p-3 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-foreground">Capacity Impact</p>
                    <p className="mt-1 text-muted-foreground">
                      {bookingPreview.confirmation.capacity_plan?.blocks?.length || 0} blockar aktiva ·{" "}
                      {bookingPreview.confirmation.capacity_plan?.created_count || 0} skapade ·{" "}
                      {bookingPreview.confirmation.capacity_plan?.updated_count || 0} uppdaterade
                    </p>
                  </div>
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                </div>

                <div>
                  <p className="font-bold text-foreground">Resources Selected</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(bookingPreview.confirmation.capacity_plan?.resources || []).map((resource: any) => (
                      <span key={resource.resource_catalog_id} className="rounded-full bg-background px-2 py-1 text-[11px] font-semibold text-foreground">
                        {resource.name}
                      </span>
                    ))}
                    {!(bookingPreview.confirmation.capacity_plan?.resources || []).length && (
                      <span className="text-muted-foreground">Inga operativa banresurser valda</span>
                    )}
                  </div>
                </div>

                <div>
                  <p className="font-bold text-foreground">Blocks Created</p>
                  <div className="mt-1 space-y-1">
                    {(bookingPreview.confirmation.capacity_plan?.blocks || []).map((block: any) => (
                      <p key={block.id} className="text-muted-foreground">
                        {blockResourceName(block)} · {formatDateTime(block.starts_at)}-{formatDateTime(block.ends_at)}
                      </p>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-background p-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Activities</p>
                    <p className="mt-1 text-lg font-black">{bookingPreview.confirmation.impact?.activities?.count || 0}</p>
                  </div>
                  <div className="rounded-lg bg-background p-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Registrations</p>
                    <p className="mt-1 text-lg font-black">{impactRegistrationCount(bookingPreview.confirmation.impact)}</p>
                  </div>
                  <div className="rounded-lg bg-background p-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Bookings</p>
                    <p className="mt-1 text-lg font-black">{bookingPreview.confirmation.impact?.bookings?.count || 0}</p>
                  </div>
                </div>

                {(bookingPreview.confirmation.impact?.activities?.samples || []).length > 0 && (
                  <div>
                    <p className="font-bold text-foreground">Affected Activities</p>
                    <div className="mt-1 space-y-1">
                      {bookingPreview.confirmation.impact.activities.samples.map((activity: any) => (
                        <p key={`${activity.activity_session_id}-${activity.session_date}`} className="text-muted-foreground">
                          {activity.name} · {activity.session_date} {activity.start_time}-{activity.end_time} ·{" "}
                          {activity.registrations_count || 0} anmälda
                          {activity.override_status ? ` · ${activity.override_status}` : " · beslut krävs"}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {(bookingPreview.confirmation.impact?.bookings?.samples || []).length > 0 && (
                  <div>
                    <p className="font-bold text-foreground">Affected Bookings</p>
                    <div className="mt-1 space-y-1">
                      {bookingPreview.confirmation.impact.bookings.samples.map((booking: any) => (
                        <p key={booking.id} className="text-muted-foreground">
                          {booking.booking_ref || booking.id} · {formatDateTime(booking.start_time)}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

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
                disabled={!!bookingPreview.confirmation || confirmBooking.isPending || !bookingPreview.resource_check?.ok || !Number(depositAmount)}
                className="flex-1 rounded-xl bg-primary px-3 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
              >
                {confirmBooking.isPending ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 inline h-4 w-4" />}
                {bookingPreview.confirmation ? "Bekräftad" : "Bekräfta & skicka"}
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
