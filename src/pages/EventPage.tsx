import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { CalendarDays, MapPin, Users, Trophy, ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-6">
        <p className="text-muted-foreground">Eventet hittades inte</p>
        <Link to="/links" className="text-primary underline text-sm">← Tillbaka</Link>
      </div>
    );
  }

  const eventColor = event.primary_color || "hsl(24, 85%, 52%)";
  const startDate = event.start_date ? new Date(event.start_date) : null;
  const endDate = event.end_date ? new Date(event.end_date) : null;
  const venue = event.venues;

  const formatMap: Record<string, string> = {
    round_robin: "Round Robin",
    knockout: "Knockout",
    mini_cup_2h: "Mini Cup 2h",
    team_vs_team: "Lag vs Lag",
    amerikano: "Americano",
    ladder: "Ladder",
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <div
        className="relative w-full pt-12 pb-8 px-6"
        style={{
          background: event.background_url
            ? `linear-gradient(to bottom, rgba(0,0,0,0.5), hsl(var(--background))), url(${event.background_url}) center/cover`
            : `linear-gradient(135deg, ${eventColor}22, hsl(var(--background)))`,
        }}
      >
        <Link
          to="/links"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Tillbaka
        </Link>

        {event.logo_url && (
          <img
            src={event.logo_url}
            alt=""
            className="w-16 h-16 rounded-xl object-cover mb-4 border border-white/10"
          />
        )}

        <h1
          className="text-2xl font-bold tracking-tight"
          style={{ fontFamily: "'Space Grotesk', sans-serif" }}
        >
          {event.display_name || event.name}
        </h1>

        <div className="flex flex-wrap gap-3 mt-3">
          {startDate && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarDays className="w-3.5 h-3.5" />
              {format(startDate, "d MMM yyyy", { locale: sv })}
              {endDate && ` – ${format(endDate, "d MMM", { locale: sv })}`}
            </span>
          )}
          {venue && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="w-3.5 h-3.5" />
              {venue.name}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="w-3.5 h-3.5" />
            {event.player_count} anmälda
          </span>
        </div>
      </div>

      {/* Details */}
      <div className="px-6 py-6 space-y-6">
        {/* Format & info chips */}
        <div className="flex flex-wrap gap-2">
          <span
            className="px-3 py-1 rounded-full text-xs font-medium"
            style={{ background: `${eventColor}22`, color: eventColor }}
          >
            <Trophy className="w-3 h-3 inline mr-1" />
            {formatMap[event.format] || event.format}
          </span>
          {event.scoring_type && (
            <span className="px-3 py-1 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
              {event.scoring_type}
            </span>
          )}
          {event.status && (
            <span className="px-3 py-1 rounded-full text-xs font-medium bg-secondary text-secondary-foreground capitalize">
              {event.status}
            </span>
          )}
        </div>

        {event.player_info_general && (
          <div className="bg-card rounded-xl p-4 border border-border">
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {event.player_info_general}
            </p>
          </div>
        )}

        {/* Registration form */}
        <div className="bg-card rounded-xl p-5 border border-border">
          <h2
            className="text-lg font-semibold mb-4"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            Anmäl dig
          </h2>

          {registered ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <CheckCircle2 className="w-10 h-10 text-primary" />
              <p className="text-foreground font-medium">Du är anmäld!</p>
              <p className="text-sm text-muted-foreground">
                Vi ses på {event.display_name || event.name} 🏓
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <Input
                placeholder="Ditt namn *"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={100}
                className="bg-secondary border-border"
              />
              <Input
                type="email"
                placeholder="E-post (valfritt)"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={255}
                className="bg-secondary border-border"
              />
              <Button
                type="submit"
                className="w-full"
                disabled={!name.trim() || registerMutation.isPending}
              >
                {registerMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : null}
                Anmäl mig
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
