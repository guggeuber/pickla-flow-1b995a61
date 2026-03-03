import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiPost } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Loader2, Calendar, Clock, MapPin } from "lucide-react";
import { format, addDays, addMinutes, parseISO } from "date-fns";
import { sv } from "date-fns/locale";

interface Props {
  open: boolean;
  onClose: () => void;
  crewId: string;
}

export function CreateSessionModal({ open, onClose, crewId }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const [title, setTitle] = useState("Träning");
  const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [duration, setDuration] = useState<60 | 90>(60);
  const [venueId, setVenueId] = useState<string>("");
  const [courtId, setCourtId] = useState<string>("");
  const [maxParticipants, setMaxParticipants] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  // Generate next 14 dates
  const dates = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 14 }, (_, i) => {
      const d = addDays(today, i);
      return format(d, "yyyy-MM-dd");
    });
  }, []);

  // Time slots from 06:00 to 22:00
  const timeSlots = useMemo(() => {
    const slots: string[] = [];
    for (let h = 6; h <= 21; h++) {
      slots.push(`${String(h).padStart(2, "0")}:00`);
      slots.push(`${String(h).padStart(2, "0")}:30`);
    }
    return slots;
  }, []);

  // Fetch venues
  const { data: venues } = useQuery({
    queryKey: ["venues-list"],
    queryFn: async () => {
      const { data } = await supabase.from("venues").select("id, name").eq("is_public", true).order("name");
      return data || [];
    },
  });

  // Fetch courts for selected venue
  const { data: courts } = useQuery({
    queryKey: ["venue-courts", venueId],
    enabled: !!venueId,
    queryFn: async () => {
      const { data } = await supabase
        .from("venue_courts")
        .select("id, name, court_number, hourly_rate")
        .eq("venue_id", venueId)
        .eq("is_available", true)
        .order("court_number");
      return data || [];
    },
  });

  // Auto-select first venue
  if (venues?.length && !venueId) {
    setVenueId(venues[0].id);
  }

  const handleSubmit = async () => {
    if (!user || !selectedTime || !venueId || !courtId) {
      toast.error("Fyll i alla obligatoriska fält");
      return;
    }

    setSubmitting(true);
    try {
      const startTime = `${selectedDate}T${selectedTime}:00`;
      const endTime = format(addMinutes(parseISO(startTime), duration), "yyyy-MM-dd'T'HH:mm:ss");

      // 1. Create real booking via api-bookings
      const court = courts?.find((c) => c.id === courtId);
      const hourlyRate = court?.hourly_rate || 0;
      const totalPrice = hourlyRate * (duration / 60);

      const booking = await apiPost("api-bookings", "create", {
        venueId,
        venueCourtId: courtId,
        startTime,
        endTime,
        totalPrice,
        bookedBy: title,
        notes: `Crew-träning`,
      });

      // 2. Create crew_session linked to booking
      const { error: sessionErr } = await supabase.from("crew_sessions" as any).insert({
        crew_id: crewId,
        title,
        session_date: selectedDate,
        start_time: startTime,
        end_time: endTime,
        venue_id: venueId,
        venue_court_id: courtId,
        booking_id: booking.id,
        max_participants: maxParticipants ? parseInt(maxParticipants) : null,
        status: "booked",
        created_by: user.id,
      });

      if (sessionErr) throw sessionErr;

      toast.success("Träning bokad! 🎾");
      qc.invalidateQueries({ queryKey: ["crew-sessions", crewId] });
      onClose();
      resetForm();
    } catch (err: any) {
      toast.error(err.message || "Kunde inte boka");
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setTitle("Träning");
    setSelectedTime("");
    setMaxParticipants("");
    setDuration(60);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle
            className="text-lg font-bold"
            style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#3E3D39" }}
          >
            Ny träning
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 mt-2">
          {/* Title */}
          <div>
            <Label className="text-xs font-semibold" style={{ color: "rgba(62,61,57,0.6)" }}>
              Titel
            </Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="T.ex. Tisdagsträning"
              className="mt-1"
            />
          </div>

          {/* Date picker */}
          <div>
            <Label className="text-xs font-semibold flex items-center gap-1.5" style={{ color: "rgba(62,61,57,0.6)" }}>
              <Calendar className="w-3.5 h-3.5" /> Datum
            </Label>
            <div className="flex gap-1.5 overflow-x-auto mt-1.5 pb-1 -mx-1 px-1">
              {dates.map((d) => {
                const dateObj = parseISO(d);
                const isSelected = d === selectedDate;
                return (
                  <button
                    key={d}
                    onClick={() => setSelectedDate(d)}
                    className="shrink-0 rounded-xl px-3 py-2 text-center transition-all"
                    style={{
                      background: isSelected ? "#E86C24" : "rgba(62,61,57,0.04)",
                      color: isSelected ? "#fff" : "#3E3D39",
                      border: isSelected ? "none" : "1px solid rgba(62,61,57,0.08)",
                      minWidth: 56,
                    }}
                  >
                    <span className="text-[10px] uppercase block" style={{ opacity: isSelected ? 0.8 : 0.4 }}>
                      {format(dateObj, "EEE", { locale: sv })}
                    </span>
                    <span className="text-sm font-bold block">{format(dateObj, "d")}</span>
                    <span className="text-[10px] block" style={{ opacity: isSelected ? 0.8 : 0.4 }}>
                      {format(dateObj, "MMM", { locale: sv })}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Time picker */}
          <div>
            <Label className="text-xs font-semibold flex items-center gap-1.5" style={{ color: "rgba(62,61,57,0.6)" }}>
              <Clock className="w-3.5 h-3.5" /> Tid
            </Label>
            <div className="grid grid-cols-4 gap-1.5 mt-1.5 max-h-32 overflow-y-auto">
              {timeSlots.map((t) => (
                <button
                  key={t}
                  onClick={() => setSelectedTime(t)}
                  className="rounded-lg py-1.5 text-xs font-medium transition-all"
                  style={{
                    background: t === selectedTime ? "#E86C24" : "rgba(62,61,57,0.04)",
                    color: t === selectedTime ? "#fff" : "#3E3D39",
                    border: t === selectedTime ? "none" : "1px solid rgba(62,61,57,0.06)",
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Duration */}
          <div>
            <Label className="text-xs font-semibold" style={{ color: "rgba(62,61,57,0.6)" }}>
              Längd
            </Label>
            <div className="flex gap-2 mt-1.5">
              {([60, 90] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDuration(d)}
                  className="flex-1 rounded-xl py-2.5 text-sm font-semibold transition-all"
                  style={{
                    background: d === duration ? "#E86C24" : "rgba(62,61,57,0.04)",
                    color: d === duration ? "#fff" : "#3E3D39",
                    border: d === duration ? "none" : "1px solid rgba(62,61,57,0.08)",
                  }}
                >
                  {d} min
                </button>
              ))}
            </div>
          </div>

          {/* Venue */}
          <div>
            <Label className="text-xs font-semibold flex items-center gap-1.5" style={{ color: "rgba(62,61,57,0.6)" }}>
              <MapPin className="w-3.5 h-3.5" /> Venue
            </Label>
            <select
              value={venueId}
              onChange={(e) => {
                setVenueId(e.target.value);
                setCourtId("");
              }}
              className="w-full mt-1.5 rounded-xl border px-3 py-2.5 text-sm"
              style={{ borderColor: "rgba(62,61,57,0.12)", color: "#3E3D39" }}
            >
              <option value="">Välj venue</option>
              {venues?.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>

          {/* Court */}
          {venueId && (
            <div>
              <Label className="text-xs font-semibold" style={{ color: "rgba(62,61,57,0.6)" }}>
                Bana
              </Label>
              <div className="flex gap-1.5 flex-wrap mt-1.5">
                {courts?.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setCourtId(c.id)}
                    className="rounded-xl px-4 py-2 text-sm font-medium transition-all"
                    style={{
                      background: c.id === courtId ? "#E86C24" : "rgba(62,61,57,0.04)",
                      color: c.id === courtId ? "#fff" : "#3E3D39",
                      border: c.id === courtId ? "none" : "1px solid rgba(62,61,57,0.08)",
                    }}
                  >
                    {c.name}
                  </button>
                ))}
                {courts?.length === 0 && (
                  <p className="text-xs" style={{ color: "rgba(62,61,57,0.4)" }}>
                    Inga banor tillgängliga
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Max participants */}
          <div>
            <Label className="text-xs font-semibold" style={{ color: "rgba(62,61,57,0.6)" }}>
              Max deltagare (valfritt)
            </Label>
            <Input
              type="number"
              value={maxParticipants}
              onChange={(e) => setMaxParticipants(e.target.value)}
              placeholder="Obegränsat"
              className="mt-1"
              min={2}
            />
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={submitting || !selectedTime || !courtId}
            className="w-full rounded-xl py-3 text-sm font-bold transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: "#E86C24", color: "#fff" }}
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {submitting ? "Bokar..." : "Boka träning"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
