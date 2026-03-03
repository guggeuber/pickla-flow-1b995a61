import { useState } from "react";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { CalendarDays, MapPin, Users, ArrowLeft, CheckCircle2, Loader2, MessageCircle, ChevronRight, Share2 } from "lucide-react";
import { toast } from "sonner";

const FONT_GROTESK = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

// WhatsApp fallback groups (used if no category config exists)
const WHATSAPP_GROUPS: Record<string, { label: string; url: string }> = {
  open_play: { label: "Pickla Open", url: "" },
  social: { label: "Fredagsklubben", url: "" },
  training: { label: "Träningsgruppen", url: "" },
  tournament: { label: "Turneringar", url: "" },
};

function usePublicEvent(id?: string, slug?: string) {
  return useQuery({
    queryKey: ["public-event", id || slug],
    enabled: !!(id || slug),
    queryFn: () => {
      const params: Record<string, string> = {};
      if (slug) params.slug = slug;
      else if (id) params.id = id;
      return apiGet("api-event-public", "detail", params);
    },
  });
}

function useOtherEvents(venueId?: string, excludeId?: string) {
  return useQuery({
    queryKey: ["public-events", venueId, excludeId],
    enabled: !!venueId,
    queryFn: () =>
      apiGet("api-event-public", "list", {
        venueId: venueId!,
        ...(excludeId ? { excludeId } : {}),
      }),
  });
}

const FORMAT_LABELS: Record<string, string> = {
  round_robin: "round robin",
  knockout: "knockout",
  mini_cup_2h: "mini cup 2h",
  team_vs_team: "lag vs lag",
  amerikano: "americano",
  ladder: "ladder",
};

const CATEGORY_LABELS: Record<string, string> = {
  open_play: "open play",
  training: "träning",
  social: "social",
  tournament: "turnering",
};

export default function EventPage() {
  const { id, slug } = useParams<{ id: string; slug: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const isSlugRoute = location.pathname.startsWith("/e/");
  const { data: event, isLoading, error } = usePublicEvent(
    isSlugRoute ? undefined : id,
    isSlugRoute ? (slug || id) : undefined
  );
  const { data: otherEvents } = useOtherEvents(event?.venue_id, event?.id);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [level, setLevel] = useState("");
  const [registered, setRegistered] = useState(false);

  const registerMutation = useMutation({
    mutationFn: (vars: { eventId: string; name: string; phone: string; email: string; level: string }) =>
      apiPost("api-event-public", "register", vars),
    onSuccess: () => {
      setRegistered(true);
      toast.success("Du är anmäld! 🎉");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Kunde inte anmäla");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !event?.id) return;
    registerMutation.mutate({
      eventId: event.id,
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim(),
      level,
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-neutral-300" />
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-4 px-6">
        <p className="text-neutral-400" style={{ fontFamily: FONT_MONO }}>
          eventet hittades inte
        </p>
        <Link to="/links" className="text-neutral-500 underline text-xs" style={{ fontFamily: FONT_MONO }}>
          ← tillbaka
        </Link>
      </div>
    );
  }

  const startDate = event.start_date ? new Date(event.start_date) : null;
  const endDate = event.end_date ? new Date(event.end_date) : null;
  const venue = event.venues;
  const fields: string[] = event.registration_fields || ["name", "phone"];
  const catConfig = event.category_config;
  const eventLogo = event.logo_url || catConfig?.logo_url;
  const whatsapp = event.whatsapp_url || catConfig?.whatsapp_url || WHATSAPP_GROUPS[event.category]?.url;
  const whatsappLabel = event.display_name || event.name || catConfig?.display_name || WHATSAPP_GROUPS[event.category]?.label || "WhatsApp-grupp";

  const shareUrl = event.slug
    ? `${window.location.origin}/e/${event.slug}`
    : `${window.location.origin}/event/${event.id}`;

  const handleShare = async () => {
    const shareData = {
      title: event.display_name || event.name,
      url: shareUrl,
    };
    if (navigator.share) {
      try { await navigator.share(shareData); } catch {}
    } else {
      navigator.clipboard.writeText(shareUrl);
      toast.success("Länk kopierad!");
    }
  };

  return (
    <div className="min-h-screen bg-white pb-20">
      {/* Top bar */}
      <div className="px-5 pt-12 pb-3 flex items-center justify-between">
        <Link
          to="/links"
          className="inline-flex items-center gap-1.5 text-[11px] text-neutral-400 active:opacity-60 transition-opacity"
          style={{ fontFamily: FONT_MONO }}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          tillbaka
        </Link>
        <button
          onClick={handleShare}
          className="p-2 -mr-2 text-neutral-400 active:opacity-60 transition-opacity"
        >
          <Share2 className="w-4 h-4" />
        </button>
      </div>

      {/* Event header */}
      <div className="px-5 pb-5">
        {eventLogo && (
          <img src={eventLogo} alt="" className="h-12 max-w-[160px] object-contain mb-5" />
        )}

        <h1 className="text-[28px] font-bold text-neutral-900 tracking-tight leading-tight" style={{ fontFamily: FONT_GROTESK }}>
          {(event.display_name || event.name).toLowerCase()}
        </h1>

        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
          {startDate && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
              <CalendarDays className="w-3 h-3" />
              {format(startDate, "d MMM yyyy", { locale: sv })}
              {endDate && ` – ${format(endDate, "d MMM", { locale: sv })}`}
            </span>
          )}
          {venue && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
              <MapPin className="w-3 h-3" />
              {venue.name}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 text-[11px] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
            <Users className="w-3 h-3" />
            {event.player_count} anmälda
          </span>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-2 mt-4">
          <span className="inline-block px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider text-neutral-500 bg-neutral-100" style={{ fontFamily: FONT_MONO }}>
            {CATEGORY_LABELS[event.category] || event.category}
          </span>
          <span className="inline-block px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider text-neutral-500 bg-neutral-100" style={{ fontFamily: FONT_MONO }}>
            {FORMAT_LABELS[event.format] || event.format}
          </span>
          {event.is_drop_in && (
            <span className="inline-block px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50" style={{ fontFamily: FONT_MONO }}>
              drop-in
            </span>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="h-px bg-neutral-100 mx-5" />

      {/* Description */}
      {event.description && (
        <div className="px-5 py-5">
          <p className="text-[13px] text-neutral-600 leading-relaxed whitespace-pre-wrap" style={{ fontFamily: FONT_GROTESK }}>
            {event.description}
          </p>
        </div>
      )}

      {/* Player info (legacy field) */}
      {event.player_info_general && !event.description && (
        <div className="px-5 py-5">
          <p className="text-[13px] text-neutral-500 leading-relaxed whitespace-pre-wrap" style={{ fontFamily: FONT_MONO }}>
            {event.player_info_general}
          </p>
        </div>
      )}

      {/* WhatsApp CTA */}
      {whatsapp && (
        <>
          <div className="h-px bg-neutral-100 mx-5" />
          <div className="px-5 py-4">
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-[#25D366]/8 active:scale-[0.98] transition-transform"
            >
              <MessageCircle className="w-5 h-5 text-[#25D366]" />
              <div className="flex-1">
                <p className="text-[13px] font-medium text-neutral-900" style={{ fontFamily: FONT_GROTESK }}>
                  Gå med i {whatsappLabel}
                </p>
                <p className="text-[11px] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
                  whatsapp-grupp
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-neutral-300" />
            </a>
          </div>
        </>
      )}

      <div className="h-px bg-neutral-100 mx-5" />

      {/* Registration */}
      <div className="px-5 py-6">
        {event.is_drop_in ? (
          <div className="text-center py-6">
            <p className="text-[15px] font-bold text-neutral-900" style={{ fontFamily: FONT_GROTESK }}>
              drop-in — ingen föranmälan krävs
            </p>
            <p className="text-[12px] text-neutral-400 mt-2" style={{ fontFamily: FONT_MONO }}>
              kom förbi och spela 🏓
            </p>
          </div>
        ) : registered ? (
          <div className="flex flex-col items-center gap-4 py-8">
            <CheckCircle2 className="w-12 h-12 text-emerald-500" />
            <p className="text-neutral-900 font-bold text-lg" style={{ fontFamily: FONT_GROTESK }}>
              du är anmäld!
            </p>
            <p className="text-[12px] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
              vi ses på {(event.display_name || event.name).toLowerCase()} 🏓
            </p>
          </div>
        ) : (
          <>
            <h2 className="text-[17px] font-bold text-neutral-900 mb-4" style={{ fontFamily: FONT_GROTESK }}>
              anmäl dig
            </h2>
            <form onSubmit={handleSubmit} className="space-y-3">
              {fields.includes("name") && (
                <input
                  placeholder="ditt namn"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={100}
                  className="w-full px-4 py-3.5 rounded-2xl bg-neutral-50 border border-neutral-200 text-neutral-900 text-[14px] placeholder:text-neutral-300 focus:outline-none focus:border-neutral-400 transition-colors"
                  style={{ fontFamily: FONT_MONO }}
                />
              )}
              {fields.includes("phone") && (
                <input
                  type="tel"
                  placeholder="telefon"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  maxLength={20}
                  className="w-full px-4 py-3.5 rounded-2xl bg-neutral-50 border border-neutral-200 text-neutral-900 text-[14px] placeholder:text-neutral-300 focus:outline-none focus:border-neutral-400 transition-colors"
                  style={{ fontFamily: FONT_MONO }}
                />
              )}
              {fields.includes("email") && (
                <input
                  type="email"
                  placeholder="e-post (valfritt)"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={255}
                  className="w-full px-4 py-3.5 rounded-2xl bg-neutral-50 border border-neutral-200 text-neutral-900 text-[14px] placeholder:text-neutral-300 focus:outline-none focus:border-neutral-400 transition-colors"
                  style={{ fontFamily: FONT_MONO }}
                />
              )}
              {fields.includes("level") && (
                <div className="flex gap-2">
                  {["nybörjare", "medel", "avancerad"].map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setLevel(l)}
                      className={`flex-1 py-3 rounded-2xl text-[12px] font-bold uppercase tracking-wider transition-colors ${
                        level === l
                          ? "bg-neutral-900 text-white"
                          : "bg-neutral-50 border border-neutral-200 text-neutral-400"
                      }`}
                      style={{ fontFamily: FONT_MONO }}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="submit"
                disabled={!name.trim() || registerMutation.isPending}
                className="w-full py-3.5 rounded-2xl bg-neutral-900 text-white text-[13px] font-bold uppercase tracking-wider active:scale-[0.98] transition-transform disabled:opacity-40"
                style={{ fontFamily: FONT_MONO }}
              >
                {registerMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                ) : (
                  "anmäl mig"
                )}
              </button>
            </form>
          </>
        )}
      </div>

      {/* Other events */}
      {otherEvents && otherEvents.length > 0 && (
        <>
          <div className="h-px bg-neutral-100 mx-5" />
          <div className="px-5 py-6">
            <h2 className="text-[15px] font-bold text-neutral-900 mb-4" style={{ fontFamily: FONT_GROTESK }}>
              fler event
            </h2>
            <div className="space-y-2.5">
              {otherEvents.map((evt: any) => (
                <button
                  key={evt.id}
                  onClick={() => {
                    setRegistered(false);
                    setName("");
                    setPhone("");
                    setEmail("");
                    setLevel("");
                    navigate(evt.slug ? `/e/${evt.slug}` : `/event/${evt.id}`);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-neutral-50 active:bg-neutral-100 transition-colors text-left"
                >
                  {evt.logo_url ? (
                    <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center overflow-hidden">
                      <img src={evt.logo_url} alt="" className="max-w-full max-h-full object-contain" />
                    </div>
                  ) : (
                    <div
                      className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center text-[12px] font-bold text-white"
                      style={{ background: evt.primary_color || "#333", fontFamily: FONT_MONO }}
                    >
                      {(evt.display_name || evt.name || "?")[0].toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-neutral-900 truncate" style={{ fontFamily: FONT_GROTESK }}>
                      {(evt.display_name || evt.name).toLowerCase()}
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
                        {CATEGORY_LABELS[evt.category] || evt.category}
                      </span>
                      {evt.start_date && (
                        <span className="text-[10px] text-neutral-300" style={{ fontFamily: FONT_MONO }}>
                          {format(new Date(evt.start_date), "d/M")}
                        </span>
                      )}
                      {evt.is_drop_in && (
                        <span className="text-[9px] text-emerald-500 font-bold uppercase" style={{ fontFamily: FONT_MONO }}>
                          drop-in
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-neutral-300 flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
