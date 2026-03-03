import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { CalendarDays, MapPin, Users, ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

function usePublicEvent(id?: string) {
  return useQuery({
    queryKey: ["public-event", id],
    enabled: !!id,
    queryFn: () => apiGet("api-event-public", "detail", { id: id! }),
  });
}

export default function EventPage() {
  const { id } = useParams<{ id: string }>();
  const { data: event, isLoading, error } = usePublicEvent(id);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [registered, setRegistered] = useState(false);

  const registerMutation = useMutation({
    mutationFn: (vars: { eventId: string; name: string; email: string }) =>
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
    if (!name.trim() || !id) return;
    registerMutation.mutate({ eventId: id, name: name.trim(), email: email.trim() });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-4 px-6">
        <p className="text-neutral-400" style={{ fontFamily: "'Space Mono', monospace" }}>
          eventet hittades inte
        </p>
        <Link to="/links" className="text-neutral-500 underline text-xs" style={{ fontFamily: "'Space Mono', monospace" }}>
          ← tillbaka
        </Link>
      </div>
    );
  }

  const startDate = event.start_date ? new Date(event.start_date) : null;
  const endDate = event.end_date ? new Date(event.end_date) : null;
  const venue = event.venues;

  const formatMap: Record<string, string> = {
    round_robin: "round robin",
    knockout: "knockout",
    mini_cup_2h: "mini cup 2h",
    team_vs_team: "lag vs lag",
    amerikano: "americano",
    ladder: "ladder",
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Top bar */}
      <div className="px-5 pt-12 pb-4">
        <Link
          to="/links"
          className="inline-flex items-center gap-1.5 text-xs text-neutral-400 active:opacity-60 transition-opacity"
          style={{ fontFamily: "'Space Mono', monospace" }}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          tillbaka
        </Link>
      </div>

      {/* Event header */}
      <div className="px-5 pb-6">
        {event.logo_url && (
          <img
            src={event.logo_url}
            alt=""
            className="w-14 h-14 rounded-2xl object-cover mb-5"
          />
        )}

        <h1
          className="text-[28px] font-bold text-neutral-900 tracking-tight leading-tight"
          style={{ fontFamily: "'Space Grotesk', sans-serif" }}
        >
          {(event.display_name || event.name).toLowerCase()}
        </h1>

        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
          {startDate && (
            <span
              className="inline-flex items-center gap-1.5 text-[11px] text-neutral-400"
              style={{ fontFamily: "'Space Mono', monospace" }}
            >
              <CalendarDays className="w-3 h-3" />
              {format(startDate, "d MMM yyyy", { locale: sv })}
              {endDate && ` – ${format(endDate, "d MMM", { locale: sv })}`}
            </span>
          )}
          {venue && (
            <span
              className="inline-flex items-center gap-1.5 text-[11px] text-neutral-400"
              style={{ fontFamily: "'Space Mono', monospace" }}
            >
              <MapPin className="w-3 h-3" />
              {venue.name}
            </span>
          )}
          <span
            className="inline-flex items-center gap-1.5 text-[11px] text-neutral-400"
            style={{ fontFamily: "'Space Mono', monospace" }}
          >
            <Users className="w-3 h-3" />
            {event.player_count} anmälda
          </span>
        </div>

        {/* Format tag */}
        <div className="mt-4">
          <span
            className="inline-block px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider text-neutral-500 bg-neutral-100"
            style={{ fontFamily: "'Space Mono', monospace" }}
          >
            {formatMap[event.format] || event.format}
          </span>
        </div>
      </div>

      {/* Divider */}
      <div className="h-px bg-neutral-100 mx-5" />

      {/* Info */}
      {event.player_info_general && (
        <div className="px-5 py-5">
          <p
            className="text-[13px] text-neutral-500 leading-relaxed whitespace-pre-wrap"
            style={{ fontFamily: "'Space Mono', monospace" }}
          >
            {event.player_info_general}
          </p>
        </div>
      )}

      {/* Registration */}
      <div className="px-5 py-6">
        {registered ? (
          <div className="flex flex-col items-center gap-4 py-10">
            <CheckCircle2 className="w-12 h-12 text-emerald-500" />
            <p
              className="text-neutral-900 font-bold text-lg"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              du är anmäld!
            </p>
            <p
              className="text-[12px] text-neutral-400"
              style={{ fontFamily: "'Space Mono', monospace" }}
            >
              vi ses på {(event.display_name || event.name).toLowerCase()} 🏓
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              placeholder="ditt namn"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
              className="w-full px-4 py-3.5 rounded-2xl bg-neutral-50 border border-neutral-200 text-neutral-900 text-[14px] placeholder:text-neutral-300 focus:outline-none focus:border-neutral-400 transition-colors"
              style={{ fontFamily: "'Space Mono', monospace" }}
            />
            <input
              type="email"
              placeholder="e-post (valfritt)"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={255}
              className="w-full px-4 py-3.5 rounded-2xl bg-neutral-50 border border-neutral-200 text-neutral-900 text-[14px] placeholder:text-neutral-300 focus:outline-none focus:border-neutral-400 transition-colors"
              style={{ fontFamily: "'Space Mono', monospace" }}
            />
            <button
              type="submit"
              disabled={!name.trim() || registerMutation.isPending}
              className="w-full py-3.5 rounded-2xl bg-neutral-900 text-white text-[13px] font-bold uppercase tracking-wider active:scale-[0.98] transition-transform disabled:opacity-40"
              style={{ fontFamily: "'Space Mono', monospace" }}
            >
              {registerMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mx-auto" />
              ) : (
                "anmäl mig"
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
