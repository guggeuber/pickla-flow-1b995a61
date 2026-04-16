import { useState, useMemo, useEffect } from "react";
import { useSearchParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, Loader2, CheckCircle2, Clock, MapPin, Building2 } from "lucide-react";
import { toast } from "sonner";
import { format, addDays } from "date-fns";
import { sv } from "date-fns/locale";
import { DateTime } from "luxon";
import picklaLogo from "@/assets/pickla-logo.svg";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { apiGet, apiPost } from "@/lib/api";

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const BASE_URL = `https://${PROJECT_ID}.supabase.co/functions/v1`;

const FONT_GROTESK = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

function generateDates(count = 14) {
  const dates: Date[] = [];
  const today = DateTime.now().setZone("Europe/Stockholm").startOf("day").toJSDate();
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

  const [selectedDate, setSelectedDate] = useState(() =>
    DateTime.now().setZone("Europe/Stockholm").startOf("day").toJSDate()
  );
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [selectedCourts, setSelectedCourts] = useState<string[]>([]);
  const [name, setName] = useState(searchParams.get("name") || "");
  const [phone, setPhone] = useState(searchParams.get("phone") || "");
  const [confirmed, setConfirmed] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [useCorporate, setUseCorporate] = useState(false);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);

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
  const todayStr = DateTime.now().setZone("Europe/Stockholm").toISODate()!;

  // Guard: if selectedDate is somehow in the past, snap to today
  useEffect(() => {
    const todayStart = DateTime.now().setZone("Europe/Stockholm").startOf("day");
    const selStart = DateTime.fromJSDate(selectedDate).setZone("Europe/Stockholm").startOf("day");
    if (selStart < todayStart) {
      setSelectedDate(todayStart.toJSDate());
      setSelectedTime(null);
      setSelectedCourts([]);
    }
  }, []);

  const dates = useMemo(() => generateDates(), []);

  // Fetch corporate packages for logged-in user
  const { data: corpData } = useQuery({
    queryKey: ["my-corporate-booking", user?.id],
    enabled: !!user,
    staleTime: 30000,
    queryFn: () => apiGet("api-corporate", "my"),
  });

  const activePackages = useMemo(() => {
    if (!corpData?.packages?.length) return [];
    return corpData.packages.filter((p: any) => p.status === 'active' && p.total_hours - p.used_hours > 0).map((p: any) => {
      const membership = corpData.memberships?.find((m: any) => m.corporate_accounts?.id === p.corporate_account_id);
      return { ...p, company_name: membership?.corporate_accounts?.company_name || 'Företag' };
    });
  }, [corpData]);

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

  // For today: filter out time slots whose start time has already passed
  const filteredTimeSlots = useMemo(() => {
    if (dateStr !== todayStr) return timeSlots;
    const now = DateTime.now().setZone("Europe/Stockholm");
    return timeSlots.filter((slot) => {
      const slotStart = DateTime.fromISO(`${dateStr}T${slot}:00`, { zone: "Europe/Stockholm" });
      return slotStart > now;
    });
  }, [timeSlots, dateStr, todayStr]);

  // When date changes: auto-select first available slot
  useEffect(() => {
    setSelectedTime(filteredTimeSlots[0] ?? null);
    setSelectedCourts([]);
  }, [dateStr]); // eslint-disable-line react-hooks/exhaustive-deps

  // When slots load or the current time advances past the selected slot: re-validate
  useEffect(() => {
    if (filteredTimeSlots.length === 0) {
      setSelectedTime(null);
      setSelectedCourts([]);
      return;
    }
    if (!selectedTime || !filteredTimeSlots.includes(selectedTime)) {
      setSelectedTime(filteredTimeSlots[0]);
    }
  }, [filteredTimeSlots]); // eslint-disable-line react-hooks/exhaustive-deps

  // Check which courts are available for the selected time
  const courtAvailability = useMemo(() => {
    if (!selectedTime) return {};
    const startISO = DateTime.fromISO(`${dateStr}T${selectedTime}:00`, { zone: "Europe/Stockholm" }).toUTC().toISO()!;
    const endISO = DateTime.fromISO(`${dateStr}T${addHour(selectedTime)}:00`, { zone: "Europe/Stockholm" }).toUTC().toISO()!;
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
      const isFree = useCorporate || totalPrice === 0;

      if (isFree) {
        // Corporate / free booking — create immediately without Stripe
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (currentSession?.access_token) {
          headers["Authorization"] = `Bearer ${currentSession.access_token}`;
        }
        const res = await fetch(`${BASE_URL}/api-bookings/public-book`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            slug,
            courtIds: selectedCourts,
            date: dateStr,
            startTime: selectedTime,
            endTime: addHour(selectedTime!),
            name: name.trim(),
            phone: phone.trim(),
            corporatePackageId: useCorporate ? selectedPackageId : undefined,
          }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Bokningen misslyckades");
        }
        const result = await res.json();
        return { type: "direct" as const, bookings: result.bookings };
      }

      // Paid booking — redirect to Stripe Checkout
      const venueId = data?.venue?.id;
      if (!venueId) throw new Error("Venue saknas");

      const result = await apiPost("api-bookings", "create-checkout", {
        product_type: "court_booking",
        amount_sek:   totalPrice,
        venue_id:     venueId,
        metadata: {
          slug,
          court_ids:  JSON.stringify(selectedCourts),
          date:       dateStr,
          start_time: selectedTime!,
          end_time:   addHour(selectedTime!),
          name:       name.trim(),
          phone:      phone.trim(),
          user_id:    user?.id || "",
        },
      });
      return { type: "stripe" as const, url: result.url };
    },
    onSuccess: (result) => {
      if (result.type === "stripe") {
        window.location.href = result.url;
        return;
      }
      const firstRef = result.bookings?.[0]?.booking_ref;
      if (firstRef) {
        navigate(`/b/${firstRef}`);
      } else {
        setConfirmed(true);
        toast.success("Bokad!");
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

  const isToday = dateStr === todayStr;
  const isClosed = openingHours?.is_closed;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-neutral-300" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white pb-16">
      {/* Top bar */}
      <div className="px-4 pt-[env(safe-area-inset-top,12px)] pb-2 flex items-center justify-between">
        <Link
          to={`/?v=${slug}`}
          className="inline-flex items-center gap-1 text-[11px] text-neutral-400 active:opacity-60 transition-opacity"
          style={{ fontFamily: FONT_MONO }}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          tillbaka
        </Link>
        <img src={picklaLogo} alt="Pickla" className="h-5 w-auto opacity-20" />
      </div>

      {/* Header */}
      <div className="px-4 pb-3">
        <h1
          className="text-[22px] font-bold text-neutral-900 tracking-tight leading-tight"
          style={{ fontFamily: FONT_GROTESK }}
        >
          boka bana
        </h1>
        {venueName && (
          <span
            className="inline-flex items-center gap-1 text-[10px] text-neutral-400 mt-1"
            style={{ fontFamily: FONT_MONO }}
          >
            <MapPin className="w-3 h-3" />
            {venueName}
          </span>
        )}
      </div>

      <div className="h-px bg-neutral-100 mx-4" />

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
        <form onSubmit={handleBook} className="px-4 py-4 space-y-4">
          {/* Date picker */}
          <div>
            <h2
              className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-2"
              style={{ fontFamily: FONT_MONO }}
            >
              datum
            </h2>
            <div
              className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1"
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
                    className={`flex-shrink-0 w-[44px] py-1.5 rounded-xl flex flex-col items-center gap-0 transition-all ${
                      isSelected
                        ? "bg-neutral-900 text-white"
                        : "bg-neutral-50 text-neutral-600"
                    }`}
                  >
                    <span
                      className={`text-[8px] font-bold uppercase leading-tight ${
                        isSelected ? "text-white/60" : "text-neutral-400"
                      }`}
                      style={{ fontFamily: FONT_MONO }}
                    >
                      {isTodayDate
                        ? "idag"
                        : format(date, "EEE", { locale: sv }).slice(0, 3)}
                    </span>
                    <span
                      className="text-[16px] font-bold leading-tight"
                      style={{ fontFamily: FONT_GROTESK }}
                    >
                      {date.getDate()}
                    </span>
                    <span
                      className={`text-[7px] font-medium leading-tight ${
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
                className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-2"
                style={{ fontFamily: FONT_MONO }}
              >
                tid
              </h2>
              {filteredTimeSlots.length === 0 ? (
                <p
                  className="text-[13px] text-neutral-400 text-center py-4"
                  style={{ fontFamily: FONT_MONO }}
                >
                  inga fler tider idag
                </p>
              ) : (
                <div className="grid grid-cols-5 gap-1.5">
                  {filteredTimeSlots.map((time) => (
                    <button
                      key={time}
                      type="button"
                      onClick={() => {
                        setSelectedTime(time);
                        setSelectedCourts([]);
                      }}
                      className={`py-2 rounded-xl text-[12px] font-bold transition-colors ${
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
              )}
            </div>
          )}

          {/* Court selection */}
          {selectedTime && !isClosed && (
            <div>
              <h2
                className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-2"
                style={{ fontFamily: FONT_MONO }}
              >
                välj bana{courts.length > 1 ? "or" : ""}
              </h2>
              <div className="grid grid-cols-2 gap-1.5">
                {courts.map((court) => {
                  const available = courtAvailability[court.id] !== false;
                  const selected = selectedCourts.includes(court.id);
                  return (
                    <button
                      key={court.id}
                      type="button"
                      disabled={!available}
                      onClick={() => available && toggleCourt(court.id)}
                      className={`relative py-3 px-3 rounded-xl text-left transition-all ${
                        !available
                          ? "opacity-30 bg-neutral-50 cursor-not-allowed"
                          : selected
                          ? "bg-neutral-900 text-white"
                          : "bg-neutral-50 text-neutral-700 active:scale-[0.98]"
                      }`}
                    >
                      <p
                        className="text-[12px] font-bold"
                        style={{ fontFamily: FONT_GROTESK }}
                      >
                        {court.name}
                      </p>
                      <p
                        className={`text-[10px] mt-0.5 ${
                          selected ? "text-white/60" : "text-neutral-400"
                        }`}
                        style={{ fontFamily: FONT_MONO }}
                      >
                        {getCourtPrice(court)} kr/h
                      </p>
                      {!available && (
                        <span
                          className="text-[8px] text-neutral-400 mt-0.5 block"
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
              <div className="h-px bg-neutral-100 mb-4" />
              <h2
                className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-2"
                style={{ fontFamily: FONT_MONO }}
              >
                dina uppgifter
              </h2>
              <div className="flex gap-2">
                <input
                  placeholder="ditt namn"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={100}
                  className="flex-1 min-w-0 px-3 py-3 rounded-xl bg-neutral-50 border border-neutral-200 text-neutral-900 text-[16px] placeholder:text-neutral-300 focus:outline-none focus:border-neutral-400 transition-colors"
                  style={{ fontFamily: FONT_MONO }}
                />
                <input
                  type="tel"
                  placeholder="telefon"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  maxLength={20}
                  className="flex-1 min-w-0 px-3 py-3 rounded-xl bg-neutral-50 border border-neutral-200 text-neutral-900 text-[16px] placeholder:text-neutral-300 focus:outline-none focus:border-neutral-400 transition-colors"
                  style={{ fontFamily: FONT_MONO }}
                />
              </div>
            </div>
          )}

          {/* Corporate payment option */}
          {selectedCourts.length > 0 && activePackages.length > 0 && (
            <div>
              <div className="h-px bg-neutral-100 mb-6" />
              <h2
                className="text-[11px] font-bold text-neutral-400 uppercase tracking-widest mb-3"
                style={{ fontFamily: FONT_MONO }}
              >
                betalning
              </h2>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => { setUseCorporate(false); setSelectedPackageId(null); }}
                  className={`w-full py-3 px-4 rounded-2xl text-left text-[13px] font-medium transition-all ${
                    !useCorporate
                      ? "bg-neutral-900 text-white"
                      : "bg-neutral-50 text-neutral-600"
                  }`}
                  style={{ fontFamily: FONT_MONO }}
                >
                  betala i kassan · {totalPrice} kr
                </button>
                {activePackages.map((pkg: any) => {
                  const remaining = pkg.total_hours - pkg.used_hours;
                  const isSelected = useCorporate && selectedPackageId === pkg.id;
                  return (
                    <button
                      key={pkg.id}
                      type="button"
                      onClick={() => { setUseCorporate(true); setSelectedPackageId(pkg.id); }}
                      className={`w-full py-3 px-4 rounded-2xl text-left flex items-center gap-3 transition-all ${
                        isSelected
                          ? "bg-neutral-900 text-white"
                          : "bg-neutral-50 text-neutral-600"
                      }`}
                    >
                      <Building2 className={`w-4 h-4 flex-shrink-0 ${isSelected ? "text-orange-400" : "text-neutral-400"}`} />
                      <div className="flex-1">
                        <span className="text-[13px] font-medium" style={{ fontFamily: FONT_MONO }}>
                          {pkg.company_name}
                        </span>
                        <span className={`text-[11px] ml-2 ${isSelected ? "text-white/60" : "text-neutral-400"}`} style={{ fontFamily: FONT_MONO }}>
                          {remaining}h kvar
                        </span>
                      </div>
                      <span className="text-[13px] font-bold" style={{ fontFamily: FONT_GROTESK }}>
                        0 kr
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Summary + Book button */}
          {selectedCourts.length > 0 && name.trim() && phone.trim() && (
            <div>
              <div className="h-px bg-neutral-100 mb-3" />
              <div className="flex items-center justify-between text-[12px] mb-3" style={{ fontFamily: FONT_MONO }}>
                <span className="text-neutral-400">
                  {format(selectedDate, "d MMM", { locale: sv })} · {selectedTime}–{addHour(selectedTime!)} · {selectedCourts.map((id) => courts.find((c) => c.id === id)?.name).join(", ")}
                </span>
                <span className="font-bold text-neutral-900" style={{ fontFamily: FONT_GROTESK }}>
                  {useCorporate ? "0 kr" : `${totalPrice} kr`}
                </span>
              </div>

              <button
                type="submit"
                disabled={bookMutation.isPending}
                className="w-full py-3 rounded-xl bg-neutral-900 text-white text-[13px] font-bold uppercase tracking-wider active:scale-[0.98] transition-transform disabled:opacity-40"
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