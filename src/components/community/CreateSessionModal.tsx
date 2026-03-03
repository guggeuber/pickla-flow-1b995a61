import { useState, useMemo, useEffect } from "react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiPost } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Loader2, Calendar, Clock, MapPin, Users } from "lucide-react";
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
  const [courtIds, setCourtIds] = useState<string[]>([]);
  const [maxParticipants, setMaxParticipants] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const dates = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 14 }, (_, i) => {
      const d = addDays(today, i);
      return format(d, "yyyy-MM-dd");
    });
  }, []);

  const timeSlots = useMemo(() => {
    const slots: string[] = [];
    for (let h = 6; h <= 21; h++) {
      slots.push(`${String(h).padStart(2, "0")}:00`);
      slots.push(`${String(h).padStart(2, "0")}:30`);
    }
    return slots;
  }, []);

  const { data: venues } = useQuery({
    queryKey: ["venues-list"],
    queryFn: async () => {
      const { data } = await supabase.from("venues").select("id, name").eq("is_public", true).order("name");
      return data || [];
    },
  });

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

  // Auto-select first venue via effect (avoids render-loop setState)
  useEffect(() => {
    if (venues?.length && !venueId) setVenueId(venues[0].id);
  }, [venues, venueId]);

  const handleSubmit = async () => {
    if (!user || !selectedTime || !venueId || courtIds.length === 0) {
      toast.error("Fyll i alla obligatoriska fält");
      return;
    }

    setSubmitting(true);
    try {
      const startTime = `${selectedDate}T${selectedTime}:00`;
      const endTime = format(addMinutes(parseISO(startTime), duration), "yyyy-MM-dd'T'HH:mm:ss");

      // Create one booking per selected court
      const bookingIds: string[] = [];
      for (const cId of courtIds) {
        const court = courts?.find((c) => c.id === cId);
        const hourlyRate = court?.hourly_rate || 0;
        const totalPrice = hourlyRate * (duration / 60);

        const booking = await apiPost("api-bookings", "create", {
          venueId,
          venueCourtId: cId,
          startTime,
          endTime,
          totalPrice,
          notes: `Crew-träning: ${title}`,
        });
        bookingIds.push(booking.id);
      }

      // Create one crew_session per booking/court
      const sessionInserts = courtIds.map((cId, i) => ({
        crew_id: crewId,
        title: courtIds.length > 1 ? `${title} (${courts?.find(c => c.id === cId)?.name || `Bana ${i+1}`})` : title,
        session_date: selectedDate,
        start_time: startTime,
        end_time: endTime,
        venue_id: venueId,
        venue_court_id: cId,
        booking_id: bookingIds[i],
        max_participants: maxParticipants ? parseInt(maxParticipants) : null,
        status: "booked",
        created_by: user.id,
      }));

      const { error: sessionErr } = await supabase.from("crew_sessions" as any).insert(sessionInserts);
      if (sessionErr) throw sessionErr;

      toast.success(`${courtIds.length > 1 ? `${courtIds.length} banor bokade` : "Träning bokad"}! 🎾`);
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
    setCourtIds([]);
  };

  const canSubmit = !!selectedTime && courtIds.length > 0 && !!venueId;

  return (
    <Drawer open={open} onOpenChange={(v) => !v && onClose()}>
      <DrawerContent className="max-h-[92vh] flex flex-col">
        {/* Drag handle is built-in from vaul */}
        <DrawerHeader className="pb-2 px-5">
          <DrawerTitle
            className="text-lg font-bold text-left"
            style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#3E3D39" }}
          >
            Ny träning
          </DrawerTitle>
        </DrawerHeader>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 pb-4">
          <div className="flex flex-col gap-5">
            {/* Title */}
            <div>
              <Label className="text-xs font-semibold mb-1.5 block" style={{ color: "rgba(62,61,57,0.6)" }}>
                Titel
              </Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="T.ex. Tisdagsträning"
                className="h-12 rounded-xl text-base"
              />
            </div>

            {/* Date picker – horizontal scroll */}
            <div>
              <Label className="text-xs font-semibold mb-1.5 flex items-center gap-1.5" style={{ color: "rgba(62,61,57,0.6)" }}>
                <Calendar className="w-3.5 h-3.5" /> Datum
              </Label>
              <div className="flex gap-2 overflow-x-auto pb-2 -mx-5 px-5 snap-x snap-mandatory scrollbar-none">
                {dates.map((d) => {
                  const dateObj = parseISO(d);
                  const isSelected = d === selectedDate;
                  return (
                    <button
                      key={d}
                      onClick={() => setSelectedDate(d)}
                      className="shrink-0 rounded-2xl text-center transition-all active:scale-95 snap-start"
                      style={{
                        background: isSelected ? "#E86C24" : "rgba(62,61,57,0.04)",
                        color: isSelected ? "#fff" : "#3E3D39",
                        border: isSelected ? "2px solid #E86C24" : "1.5px solid rgba(62,61,57,0.08)",
                        width: 64,
                        padding: "10px 0",
                      }}
                    >
                      <span className="text-[10px] uppercase font-semibold block" style={{ opacity: isSelected ? 0.9 : 0.4 }}>
                        {format(dateObj, "EEE", { locale: sv })}
                      </span>
                      <span className="text-lg font-black block leading-tight">{format(dateObj, "d")}</span>
                      <span className="text-[10px] font-medium block" style={{ opacity: isSelected ? 0.85 : 0.4 }}>
                        {format(dateObj, "MMM", { locale: sv })}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Time picker – 5 cols, larger tap targets */}
            <div>
              <Label className="text-xs font-semibold mb-1.5 flex items-center gap-1.5" style={{ color: "rgba(62,61,57,0.6)" }}>
                <Clock className="w-3.5 h-3.5" /> Tid
              </Label>
              <div className="grid grid-cols-5 gap-1.5 max-h-40 overflow-y-auto rounded-xl p-1">
                {timeSlots.map((t) => {
                  const isSelected = t === selectedTime;
                  return (
                    <button
                      key={t}
                      onClick={() => setSelectedTime(t)}
                      className="rounded-xl py-2.5 text-sm font-semibold transition-all active:scale-95"
                      style={{
                        background: isSelected ? "#E86C24" : "rgba(62,61,57,0.04)",
                        color: isSelected ? "#fff" : "#3E3D39",
                        border: isSelected ? "2px solid #E86C24" : "1px solid rgba(62,61,57,0.06)",
                        minHeight: 44,
                      }}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Duration – pill toggle */}
            <div>
              <Label className="text-xs font-semibold mb-1.5 block" style={{ color: "rgba(62,61,57,0.6)" }}>
                Längd
              </Label>
              <div
                className="flex gap-0 rounded-2xl overflow-hidden"
                style={{ border: "1.5px solid rgba(62,61,57,0.1)" }}
              >
                {([60, 90] as const).map((d) => {
                  const isSelected = d === duration;
                  return (
                    <button
                      key={d}
                      onClick={() => setDuration(d)}
                      className="flex-1 py-3.5 text-sm font-bold transition-all active:scale-[0.97]"
                      style={{
                        background: isSelected ? "#E86C24" : "transparent",
                        color: isSelected ? "#fff" : "rgba(62,61,57,0.5)",
                        minHeight: 48,
                      }}
                    >
                      {d} min
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Venue */}
            <div>
              <Label className="text-xs font-semibold mb-1.5 flex items-center gap-1.5" style={{ color: "rgba(62,61,57,0.6)" }}>
                <MapPin className="w-3.5 h-3.5" /> Venue
              </Label>
              <select
                value={venueId}
                onChange={(e) => {
                  setVenueId(e.target.value);
                  setCourtIds([]);
                }}
                className="w-full rounded-2xl border px-4 py-3.5 text-base appearance-none bg-white"
                style={{
                  borderColor: "rgba(62,61,57,0.12)",
                  color: "#3E3D39",
                  minHeight: 48,
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%233E3D39' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 16px center",
                }}
              >
                <option value="">Välj venue</option>
                {venues?.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Court – large tappable cards */}
            {venueId && (
              <div>
                <Label className="text-xs font-semibold mb-1.5 block" style={{ color: "rgba(62,61,57,0.6)" }}>
                  Banor {courtIds.length > 0 && <span style={{ color: "#E86C24" }}>({courtIds.length} valda)</span>}
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  {courts?.map((c) => {
                    const isSelected = courtIds.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        onClick={() => {
                          setCourtIds((prev) =>
                            prev.includes(c.id) ? prev.filter((id) => id !== c.id) : [...prev, c.id]
                          );
                        }}
                        className="rounded-2xl p-3.5 text-left transition-all active:scale-95"
                        style={{
                          background: isSelected ? "#E86C24" : "rgba(62,61,57,0.04)",
                          color: isSelected ? "#fff" : "#3E3D39",
                          border: isSelected ? "2px solid #E86C24" : "1.5px solid rgba(62,61,57,0.08)",
                          minHeight: 56,
                        }}
                      >
                        <span className="text-sm font-bold block">{c.name}</span>
                        {c.hourly_rate ? (
                          <span className="text-[11px] mt-0.5 block" style={{ opacity: isSelected ? 0.85 : 0.4 }}>
                            {c.hourly_rate} kr/h
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                  {courts?.length === 0 && (
                    <p className="text-xs col-span-2 py-3 text-center" style={{ color: "rgba(62,61,57,0.4)" }}>
                      Inga banor tillgängliga
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Max participants */}
            <div>
              <Label className="text-xs font-semibold mb-1.5 flex items-center gap-1.5" style={{ color: "rgba(62,61,57,0.6)" }}>
                <Users className="w-3.5 h-3.5" /> Max deltagare (valfritt)
              </Label>
              <Input
                type="number"
                value={maxParticipants}
                onChange={(e) => setMaxParticipants(e.target.value)}
                placeholder="Obegränsat"
                className="h-12 rounded-xl text-base"
                min={2}
              />
            </div>

            {/* Spacer for sticky button */}
            <div className="h-20" />
          </div>
        </div>

        {/* Sticky submit button at bottom */}
        <div
          className="sticky bottom-0 px-5 pb-6 pt-3"
          style={{
            background: "linear-gradient(to top, hsl(var(--background)) 70%, transparent)",
          }}
        >
          <button
            onClick={handleSubmit}
            disabled={submitting || !canSubmit}
            className="w-full rounded-2xl py-4 text-base font-bold transition-all active:scale-[0.97] flex items-center justify-center gap-2.5 disabled:opacity-40"
            style={{
              background: canSubmit ? "#E86C24" : "rgba(62,61,57,0.15)",
              color: canSubmit ? "#fff" : "rgba(62,61,57,0.4)",
              minHeight: 56,
              boxShadow: canSubmit ? "0 8px 24px rgba(232,108,36,0.3)" : "none",
            }}
          >
            {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
            {submitting ? "Bokar..." : "Boka träning 🎾"}
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
