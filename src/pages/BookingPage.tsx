import { useState, useMemo, useEffect } from "react";
import { useSearchParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, Loader2, CheckCircle2, Clock, MapPin } from "lucide-react";
import { toast } from "sonner";
import { format, addDays } from "date-fns";
import { sv } from "date-fns/locale";
import picklaLogo from "@/assets/pickla-logo.svg";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const BASE_URL = `https://${PROJECT_ID}.supabase.co/functions/v1`;

const FONT_GROTESK = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

function generateDates(count = 14) {
  const dates: Date[] = [];
  const today = new Date();
  for (let i = 0; i < count; i++) dates.push(addDays(today, i));
  return dates;
}

function generateTimeSlots(openTime?: string, closeTime?: string) {
  const start = openTime ? parseInt(openTime.slice(0, 2)) : 7;
  const end = closeTime ? parseInt(closeTime.slice(0, 2)) : 22;
  const slots: string[] = [];
  for (let h = start; h < end; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
  }
  return slots;
}

function addHour(time: string): string {
  const h = parseInt(time.slice(0, 2)) + 1;
  return `${String(h).padStart(2, "0")}:00`;
}

interface CourtData {
  id: string;
  name: string;
  court_number: number;
  court_type: string | null;
  hourly_rate: number | null;
}

export default function BookingPage() {
  const [searchParams] = useSearchParams();
  const slug = searchParams.get("v") || "pickla-arena-sthlm";
  const navigate = useNavigate();
  const { user } = useAuth();

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [selectedCourts, setSelectedCourts] = useState<string[]>([]);
  const [name, setName] = useState(searchParams.get("name") || "");
  const [phone, setPhone] = useState(searchParams.get("phone") || "");
  const [confirmed, setConfirmed] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);

  // Auto-fill name/phone from player profile when logged in
  useEffect(() => {
    if (!user || profileLoaded) return;
    const prefillFromProfile = async () => {
      const { data } = await supabase
        .from("player_profiles")
        .select("display_name, phone")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      if (data) {
        if (data.display_name && !name) setName(data.display_name);
        if (data.phone && !phone) setPhone(data.phone);
      } else {
        // Fallback to user metadata
        const meta = user.user_metadata;
        if (meta?.display_name && !name) setName(meta.display_name);
      }
      setProfileLoaded(true);
    };
    prefillFromProfile();
  }, [user, profileLoaded]);

  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const dates = useMemo(() => generateDates(), []);

  // Fetch courts + availability
  const { data, isLoading } = useQuery({
    queryKey: ["public-courts", slug, dateStr],
    queryFn: async () => {
      const res = await fetch(
        `${BASE_URL}/api-bookings/public-courts?slug=${slug}&date=${dateStr}`
      );
      if (!res.ok) throw new Error("Kunde inte hämta banor");
      return res.json();
    },
  });

  const courts: CourtData[] = data?.courts || [];
  const openingHours = data?.openingHours;
  const existingBookings = data?.bookings || [];
  const venueName = data?.venue?.name || "";
  const pricingRules: any[] = data?.pricingRules || [];

  // Resolve price for a court based on pricing rules, selected day + time
  const getCourtPrice = (court: CourtData): number => {
    if (!selectedTime) return court.hourly_rate || 0;
    const dayOfWeek = selectedDate.getDay();
    const matchingRule = pricingRules.find((r: any) => {
      if (r.type !== "hourly") return false;
      const daysMatch = !r.days_of_week || r.days_of_week.length === 0 || r.days_of_week.includes(dayOfWeek);
      const timeFrom = (r.time_from || "00:00").slice(0, 5);
      const timeTo = (r.time_to || "23:59").slice(0, 5);
      return daysMatch && selectedTime >= timeFrom && selectedTime < timeTo;
    });
    return matchingRule ? matchingRule.price : (court.hourly_rate || 0);
  };

  const timeSlots = useMemo(
    () =>
      generateTimeSlots(
        openingHours?.is_closed ? undefined : openingHours?.open_time,
        openingHours?.is_closed ? undefined : openingHours?.close_time
      ),
    [openingHours]
  );

  // Check which courts are available for the selected time
  const courtAvailability = useMemo(() => {
    if (!selectedTime) return {};
    const startISO = `${dateStr}T${selectedTime}:00.000Z`;
    const endISO = `${dateStr}T${addHour(selectedTime)}:00.000Z`;
    const startMs = new Date(startISO).getTime();
    const endMs = new Date(endISO).getTime();

    const avail: Record<string, boolean> = {};
    courts.forEach((c) => {
      const isBooked = existingBookings.some(
        (b: any) =>
          b.court_id === c.id &&
          new Date(b.start).getTime() < endMs &&
          new Date(b.end).getTime() > startMs
      );
      avail[c.id] = !isBooked;
    });
    return avail;
  }, [courts, existingBookings, selectedTime, dateStr]);

  const toggleCourt = (courtId: string) => {
    setSelectedCourts((prev) =>
      prev.includes(courtId)
        ? prev.filter((id) => id !== courtId)
        : [...prev, courtId]
    );
  };

  const totalPrice = useMemo(() => {
    return selectedCourts.reduce((sum, id) => {
      const court = courts.find((c) => c.id === id);
      return sum + (court ? getCourtPrice(court) : 0);
    }, 0);
  }, [selectedCourts, courts, pricingRules, selectedTime, selectedDate]);

  const bookMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE_URL}/api-bookings/public-book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          courtIds: selectedCourts,
          date: dateStr,
          startTime: selectedTime,
          endTime: addHour(selectedTime!),
          name: name.trim(),
          phone: phone.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Bokningen misslyckades");
      }
      return res.json();
    },
    onSuccess: (data) => {
      const firstRef = data?.bookings?.[0]?.booking_ref;
      if (firstRef) {
        navigate(`/b/${firstRef}`);
      } else {
        setConfirmed(true);
        toast.success("Bokad! 🎾");
      }
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const handleBook = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim() || !selectedTime || !selectedCourts.length) return;
    bookMutation.mutate();
  };

  const isToday = selectedDate.toDateString() === new Date().toDateString();
  const isClosed = openingHours?.is_closed;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-neutral-300" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white pb-20">
      {/* Top bar */}
      <div className="px-5 pt-12 pb-3 flex items-center justify-between">
        <Link
          to={`/?v=${slug}`}
          className="inline-flex items-center gap-1.5 text-[11px] text-neutral-400 active:opacity-60 transition-opacity"
          style={{ fontFamily: FONT_MONO }}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          tillbaka
        </Link>
        <img src={picklaLogo} alt="Pickla" className="h-6 w-auto opacity-20" />
      </div>

      {/* Header */}
      <div className="px-5 pb-5">
        <h1
          className="text-[28px] font-bold text-neutral-900 tracking-tight leading-tight"
          style={{ fontFamily: FONT_GROTESK }}
        >
          boka bana
        </h1>
        {venueName && (
          <span
            className="inline-flex items-center gap-1.5 text-[11px] text-neutral-400 mt-2"
            style={{ fontFamily: FONT_MONO }}
          >
            <MapPin className="w-3 h-3" />
            {venueName}
          </span>
        )}
      </div>

      <div className="h-px bg-neutral-100 mx-5" />

      {confirmed ? (
        <div className="flex flex-col items-center gap-4 py-16 px-5">
          <CheckCircle2 className="w-12 h-12 text-emerald-500" />
          <p
            className="text-neutral-900 font-bold text-lg"
            style={{ fontFamily: FONT_GROTESK }}
          >
            bokad!
          </p>
          <p
            className="text-[12px] text-neutral-400 text-center"
            style={{ fontFamily: FONT_MONO }}
          >
            {selectedCourts.length} {selectedCourts.length === 1 ? "bana" : "banor"} ·{" "}
            {format(selectedDate, "d MMM", { locale: sv })} · {selectedTime}
          </p>
          <button
            onClick={() => {
              setConfirmed(false);
              setSelectedCourts([]);
              setSelectedTime(null);
              setName("");
              setPhone("");
            }}
            className="mt-4 text-[12px] text-neutral-500 underline underline-offset-4"
            style={{ fontFamily: FONT_MONO }}
          >
            boka igen
          </button>
        </div>
      ) : (
        <form onSubmit={handleBook} className="px-5 py-6 space-y-6">
          {/* Date picker */}
          <div>
            <h2
              className="text-[11px] font-bold text-neutral-400 uppercase tracking-widest mb-3"
              style={{ fontFamily: FONT_MONO }}
            >
              datum
            </h2>
            <div
              className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1"
              style={{ scrollbarWidth: "none" }}
            >
              {dates.map((date, i) => {
                const isSelected =
                  date.toDateString() === selectedDate.toDateString();
                const isTodayDate =
                  date.toDateString() === new Date().toDateString();
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setSelectedDate(date);
                      setSelectedCourts([]);
                    }}
                    className={`flex-shrink-0 w-[52px] py-2.5 rounded-2xl flex flex-col items-center gap-0.5 transition-all ${
                      isSelected
                        ? "bg-neutral-900 text-white"
                        : "bg-neutral-50 text-neutral-600"
                    }`}
                  >
                    <span
                      className={`text-[9px] font-bold uppercase ${
                        isSelected ? "text-white/60" : "text-neutral-400"
                      }`}
                      style={{ fontFamily: FONT_MONO }}
                    >
                      {isTodayDate
                        ? "idag"
                        : format(date, "EEE", { locale: sv }).slice(0, 3)}
                    </span>
                    <span
                      className="text-xl font-bold"
                      style={{ fontFamily: FONT_GROTESK }}
                    >
                      {date.getDate()}
                    </span>
                    <span
                      className={`text-[8px] font-medium ${
                        isSelected ? "text-white/50" : "text-neutral-300"
                      }`}
                      style={{ fontFamily: FONT_MONO }}
                    >
                      {format(date, "MMM", { locale: sv })}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Closed notice */}
          {isClosed && (
            <div className="text-center py-6">
              <p
                className="text-[13px] text-neutral-400"
                style={{ fontFamily: FONT_MONO }}
              >
                stängt denna dag
              </p>
            </div>
          )}

          {/* Time picker */}
          {!isClosed && (
            <div>
              <h2
                className="text-[11px] font-bold text-neutral-400 uppercase tracking-widest mb-3"
                style={{ fontFamily: FONT_MONO }}
              >
                tid
              </h2>
              <div
                className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1"
                style={{ scrollbarWidth: "none" }}
              >
                {timeSlots.map((time) => (
                  <button
                    key={time}
                    type="button"
                    onClick={() => {
                      setSelectedTime(time);
                      setSelectedCourts([]);
                    }}
                    className={`flex-shrink-0 px-3.5 py-2.5 rounded-xl text-[13px] font-bold transition-colors ${
                      selectedTime === time
                        ? "bg-neutral-900 text-white"
                        : "bg-neutral-50 text-neutral-500"
                    }`}
                    style={{ fontFamily: FONT_MONO }}
                  >
                    {time}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Court selection */}
          {selectedTime && !isClosed && (
            <div>
              <h2
                className="text-[11px] font-bold text-neutral-400 uppercase tracking-widest mb-3"
                style={{ fontFamily: FONT_MONO }}
              >
                välj bana{courts.length > 1 ? "or" : ""}
              </h2>
              <div className="grid grid-cols-2 gap-2">
                {courts.map((court) => {
                  const available = courtAvailability[court.id] !== false;
                  const selected = selectedCourts.includes(court.id);
                  return (
                    <button
                      key={court.id}
                      type="button"
                      disabled={!available}
                      onClick={() => available && toggleCourt(court.id)}
                      className={`relative py-4 px-3 rounded-2xl text-left transition-all ${
                        !available
                          ? "opacity-30 bg-neutral-50 cursor-not-allowed"
                          : selected
                          ? "bg-neutral-900 text-white"
                          : "bg-neutral-50 text-neutral-700 active:scale-[0.98]"
                      }`}
                    >
                      <p
                        className="text-[13px] font-bold"
                        style={{ fontFamily: FONT_GROTESK }}
                      >
                        {court.name}
                      </p>
                      <p
                        className={`text-[11px] mt-0.5 ${
                          selected ? "text-white/60" : "text-neutral-400"
                        }`}
                        style={{ fontFamily: FONT_MONO }}
                      >
                        {getCourtPrice(court)} kr/h
                      </p>
                      {!available && (
                        <span
                          className="text-[9px] text-neutral-400 mt-1 block"
                          style={{ fontFamily: FONT_MONO }}
                        >
                          bokad
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {selectedCourts.length > 0 && (
                <p
                  className="text-[11px] text-neutral-400 mt-2 text-right"
                  style={{ fontFamily: FONT_MONO }}
                >
                  {selectedCourts.length}{" "}
                  {selectedCourts.length === 1 ? "bana" : "banor"} · {totalPrice}{" "}
                  kr
                </p>
              )}
            </div>
          )}

          {/* Contact info */}
          {selectedCourts.length > 0 && (
            <div>
              <div className="h-px bg-neutral-100 mb-6" />
              <h2
                className="text-[11px] font-bold text-neutral-400 uppercase tracking-widest mb-3"
                style={{ fontFamily: FONT_MONO }}
              >
                dina uppgifter
              </h2>
              <div className="space-y-3">
                <input
                  placeholder="ditt namn"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={100}
                  className="w-full px-4 py-3.5 rounded-2xl bg-neutral-50 border border-neutral-200 text-neutral-900 text-[14px] placeholder:text-neutral-300 focus:outline-none focus:border-neutral-400 transition-colors"
                  style={{ fontFamily: FONT_MONO }}
                />
                <input
                  type="tel"
                  placeholder="telefon"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  maxLength={20}
                  className="w-full px-4 py-3.5 rounded-2xl bg-neutral-50 border border-neutral-200 text-neutral-900 text-[14px] placeholder:text-neutral-300 focus:outline-none focus:border-neutral-400 transition-colors"
                  style={{ fontFamily: FONT_MONO }}
                />
              </div>
            </div>
          )}

          {/* Summary + Book button */}
          {selectedCourts.length > 0 && name.trim() && phone.trim() && (
            <div>
              <div className="h-px bg-neutral-100 mb-4" />
              <div className="space-y-2 mb-4">
                <div className="flex justify-between text-[13px]">
                  <span className="text-neutral-400" style={{ fontFamily: FONT_MONO }}>
                    datum
                  </span>
                  <span className="font-medium text-neutral-900" style={{ fontFamily: FONT_GROTESK }}>
                    {format(selectedDate, "d MMM yyyy", { locale: sv })}
                  </span>
                </div>
                <div className="flex justify-between text-[13px]">
                  <span className="text-neutral-400" style={{ fontFamily: FONT_MONO }}>
                    tid
                  </span>
                  <span className="font-medium text-neutral-900" style={{ fontFamily: FONT_GROTESK }}>
                    {selectedTime} – {addHour(selectedTime!)}
                  </span>
                </div>
                <div className="flex justify-between text-[13px]">
                  <span className="text-neutral-400" style={{ fontFamily: FONT_MONO }}>
                    {selectedCourts.length === 1 ? "bana" : "banor"}
                  </span>
                  <span className="font-medium text-neutral-900" style={{ fontFamily: FONT_GROTESK }}>
                    {selectedCourts
                      .map((id) => courts.find((c) => c.id === id)?.name)
                      .join(", ")}
                  </span>
                </div>
                <div className="flex justify-between text-[15px] pt-2 border-t border-neutral-100">
                  <span className="font-bold text-neutral-900" style={{ fontFamily: FONT_GROTESK }}>
                    totalt
                  </span>
                  <span className="font-bold text-neutral-900" style={{ fontFamily: FONT_GROTESK }}>
                    {totalPrice} kr
                  </span>
                </div>
              </div>

              <button
                type="submit"
                disabled={bookMutation.isPending}
                className="w-full py-3.5 rounded-2xl bg-neutral-900 text-white text-[13px] font-bold uppercase tracking-wider active:scale-[0.98] transition-transform disabled:opacity-40"
                style={{ fontFamily: FONT_MONO }}
              >
                {bookMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                ) : (
                  "boka"
                )}
              </button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}