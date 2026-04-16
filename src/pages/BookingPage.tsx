import { useState, useMemo, useEffect } from "react";
import { useSearchParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, Loader2, CheckCircle2, MapPin, Building2, Zap, Target, Shuffle } from "lucide-react";
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

// Brand colors
const RED = "#CC2936";
const DARK_BLUE = "#1a1f3a";
const CREAM = "#faf8f5";
const NEAR_BLACK = "#1a1a1a";
const TEXT_MUTED = "rgba(26,26,26,0.5)";

const SPORTS = [
  { key: "pickleball", label: "Pickleball", emoji: "🏓" },
  { key: "dart", label: "Dart", emoji: "🎯" },
  { key: "padel", label: "Padel", emoji: "🎾" },
] as const;

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
  sport_type: string | null;
  hourly_rate: number | null;
}

// Analyze booking history to find most common day+time
function findBookingPattern(bookings: any[]) {
  if (!bookings?.length) return null;
  const freq: Record<string, { count: number; weekday: number; hour: number; dayName: string }> = {};
  bookings.forEach((b) => {
    const dt = DateTime.fromISO(b.start_time, { zone: "Europe/Stockholm" });
    const key = `${dt.weekday}-${dt.hour}`;
    if (!freq[key]) {
      freq[key] = {
        count: 0,
        weekday: dt.weekday,
        hour: dt.hour,
        dayName: dt.setLocale("sv").toFormat("EEEE"),
      };
    }
    freq[key].count++;
  });
  const sorted = Object.values(freq).sort((a, b) => b.count - a.count);
  return sorted[0]?.count >= 2 ? sorted[0] : null;
}

export default function BookingPage() {
  const [searchParams] = useSearchParams();
  const slug = searchParams.get("v") || "pickla-arena-sthlm";
  const navigate = useNavigate();
  const { user } = useAuth();

  const [selectedSport, setSelectedSport] = useState<string>(() => {
    return localStorage.getItem("pickla_preferred_sport") || "pickleball";
  });
  const [selectedDate, setSelectedDate] = useState(() =>
    DateTime.now().setZone("Europe/Stockholm").startOf("day").toJSDate()
  );
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [selectedCourts, setSelectedCourts] = useState<string[]>([]);
  const [anyCourt, setAnyCourt] = useState(false);
  const [name, setName] = useState(searchParams.get("name") || "");
  const [phone, setPhone] = useState(searchParams.get("phone") || "");
  const [confirmed, setConfirmed] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [useCorporate, setUseCorporate] = useState(false);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [showContactForm, setShowContactForm] = useState(false);

  // Remember sport preference
  useEffect(() => {
    localStorage.setItem("pickla_preferred_sport", selectedSport);
  }, [selectedSport]);

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
        const meta = user.user_metadata;
        if (meta?.display_name && !name) setName(meta.display_name);
      }
      setProfileLoaded(true);
    };
    prefillFromProfile();
  }, [user, profileLoaded]);

  const hasProfile = profileLoaded && !!name.trim() && !!phone.trim();

  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const todayStr = DateTime.now().setZone("Europe/Stockholm").toISODate()!;

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

  // Fetch booking history for smart suggestions
  const { data: bookingHistory } = useQuery({
    queryKey: ["booking-history", user?.id],
    enabled: !!user,
    staleTime: 60000,
    queryFn: async () => {
      const { data } = await supabase
        .from("bookings")
        .select("start_time, venue_court_id")
        .eq("user_id", user!.id)
        .order("start_time", { ascending: false })
        .limit(20);
      return data || [];
    },
  });

  const pattern = useMemo(() => findBookingPattern(bookingHistory || []), [bookingHistory]);

  // Fetch corporate packages for logged-in user
  const { data: corpData } = useQuery({
    queryKey: ["my-corporate-booking", user?.id],
    enabled: !!user,
    staleTime: 30000,
    queryFn: () => apiGet("api-corporate", "my"),
  });

  const activePackages = useMemo(() => {
    if (!corpData?.packages?.length) return [];
    return corpData.packages
      .filter((p: any) => p.status === "active" && p.total_hours - p.used_hours > 0)
      .map((p: any) => {
        const membership = corpData.memberships?.find(
          (m: any) => m.corporate_accounts?.id === p.corporate_account_id
        );
        return { ...p, company_name: membership?.corporate_accounts?.company_name || "Företag" };
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

  const allCourts: CourtData[] = data?.courts || [];
  const openingHours = data?.openingHours;
  const existingBookings = data?.bookings || [];
  const venueName = data?.venue?.name || "";
  const pricingRules: any[] = data?.pricingRules || [];

  // Filter courts by selected sport
  const courts = useMemo(
    () => allCourts.filter((c) => c.sport_type === selectedSport),
    [allCourts, selectedSport]
  );

  // Count available sports
  const availableSports = useMemo(() => {
    const types = new Set(allCourts.map((c) => c.sport_type));
    return SPORTS.filter((s) => types.has(s.key));
  }, [allCourts]);

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

  const filteredTimeSlots = useMemo(() => {
    if (dateStr !== todayStr) return timeSlots;
    const now = DateTime.now().setZone("Europe/Stockholm");
    return timeSlots.filter((slot) => {
      const slotStart = DateTime.fromISO(`${dateStr}T${slot}:00`, { zone: "Europe/Stockholm" });
      return slotStart > now;
    });
  }, [timeSlots, dateStr, todayStr]);

  useEffect(() => {
    setSelectedTime(filteredTimeSlots[0] ?? null);
    setSelectedCourts([]);
    setAnyCourt(false);
  }, [dateStr]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const courtAvailability = useMemo(() => {
    if (!selectedTime) return {};
    const startISO = DateTime.fromISO(`${dateStr}T${selectedTime}:00`, { zone: "Europe/Stockholm" }).toUTC().toISO()!;
    const endISO = DateTime.fromISO(`${dateStr}T${addHour(selectedTime)}:00`, { zone: "Europe/Stockholm" }).toUTC().toISO()!;
    const startMs = new Date(startISO).getTime();
    const endMs = new Date(endISO).getTime();

    const avail: Record<string, boolean> = {};
    allCourts.forEach((c) => {
      const isBooked = existingBookings.some(
        (b: any) =>
          b.court_id === c.id &&
          new Date(b.start).getTime() < endMs &&
          new Date(b.end).getTime() > startMs
      );
      avail[c.id] = !isBooked;
    });
    return avail;
  }, [allCourts, existingBookings, selectedTime, dateStr]);

  // Auto-select court when "any court" is toggled
  useEffect(() => {
    if (!anyCourt || !selectedTime) return;
    const availableCourt = courts.find((c) => courtAvailability[c.id] !== false);
    if (availableCourt) {
      setSelectedCourts([availableCourt.id]);
    } else {
      setSelectedCourts([]);
      toast.error("Inga lediga banor just nu");
    }
  }, [anyCourt, courts, courtAvailability, selectedTime]);

  const toggleCourt = (courtId: string) => {
    setAnyCourt(false);
    setSelectedCourts((prev) =>
      prev.includes(courtId)
        ? prev.filter((id) => id !== courtId)
        : [...prev, courtId]
    );
  };

  const totalPrice = useMemo(() => {
    return selectedCourts.reduce((sum, id) => {
      const court = allCourts.find((c) => c.id === id);
      return sum + (court ? getCourtPrice(court) : 0);
    }, 0);
  }, [selectedCourts, allCourts, pricingRules, selectedTime, selectedDate]);

  // Effective name/phone for booking
  const bookingName = name.trim();
  const bookingPhone = phone.trim();
  const canBook = bookingName && bookingPhone && selectedTime && selectedCourts.length > 0;

  const bookMutation = useMutation({
    mutationFn: async () => {
      const isFree = useCorporate || totalPrice === 0;

      if (isFree) {
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
            name: bookingName,
            phone: bookingPhone,
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

      const venueId = data?.venue?.id;
      if (!venueId) throw new Error("Venue saknas");

      const result = await apiPost("api-bookings", "create-checkout", {
        product_type: "court_booking",
        amount_sek: totalPrice,
        venue_id: venueId,
        metadata: {
          slug,
          court_ids: JSON.stringify(selectedCourts),
          date: dateStr,
          start_time: selectedTime!,
          end_time: addHour(selectedTime!),
          name: bookingName,
          phone: bookingPhone,
          user_id: user?.id || "",
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
    if (!canBook) return;
    bookMutation.mutate();
  };

  // Smart suggestion: apply pattern
  const handleApplyPattern = () => {
    if (!pattern) return;
    // Find the next occurrence of that weekday
    const today = DateTime.now().setZone("Europe/Stockholm");
    for (let i = 0; i < 14; i++) {
      const d = today.plus({ days: i });
      if (d.weekday === pattern.weekday) {
        setSelectedDate(d.toJSDate());
        const timeStr = `${String(pattern.hour).padStart(2, "0")}:00`;
        setTimeout(() => setSelectedTime(timeStr), 100);
        setAnyCourt(true);
        break;
      }
    }
  };

  const isClosed = openingHours?.is_closed;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: CREAM }}>
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: TEXT_MUTED }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24" style={{ background: CREAM }}>
      {/* Top bar */}
      <div className="px-4 pt-[env(safe-area-inset-top,12px)] pb-2 flex items-center justify-between">
        <Link
          to={`/?v=${slug}`}
          className="inline-flex items-center gap-1 text-[11px] active:opacity-60 transition-opacity"
          style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          tillbaka
        </Link>
        <img src={picklaLogo} alt="Pickla" className="h-5 w-auto opacity-20" />
      </div>

      {/* Header */}
      <div className="px-4 pb-3">
        <h1
          className="text-[26px] font-bold tracking-tight leading-tight"
          style={{ fontFamily: FONT_GROTESK, color: NEAR_BLACK }}
        >
          boka bana
        </h1>
        {venueName && (
          <span
            className="inline-flex items-center gap-1 text-[10px] mt-1"
            style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}
          >
            <MapPin className="w-3 h-3" />
            {venueName}
          </span>
        )}
      </div>

      {confirmed ? (
        <div className="flex flex-col items-center gap-4 py-16 px-5">
          <CheckCircle2 className="w-12 h-12" style={{ color: "#22C55E" }} />
          <p className="font-bold text-lg" style={{ fontFamily: FONT_GROTESK, color: NEAR_BLACK }}>bokad!</p>
          <p className="text-[12px] text-center" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
            {selectedCourts.length} {selectedCourts.length === 1 ? "bana" : "banor"} ·{" "}
            {format(selectedDate, "d MMM", { locale: sv })} · {selectedTime}
          </p>
          <button
            onClick={() => {
              setConfirmed(false);
              setSelectedCourts([]);
              setSelectedTime(null);
              setAnyCourt(false);
            }}
            className="mt-4 text-[12px] underline underline-offset-4"
            style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}
          >
            boka igen
          </button>
        </div>
      ) : (
        <form onSubmit={handleBook} className="px-4 py-2 space-y-4">
          {/* ─── Sport selector ─── */}
          {availableSports.length > 1 && (
            <div className="flex gap-2">
              {availableSports.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => {
                    setSelectedSport(s.key);
                    setSelectedCourts([]);
                    setAnyCourt(false);
                  }}
                  className="flex-1 py-3 rounded-2xl text-center transition-all active:scale-[0.97]"
                  style={{
                    background: selectedSport === s.key ? DARK_BLUE : "#fff",
                    color: selectedSport === s.key ? "#fff" : NEAR_BLACK,
                    fontFamily: FONT_GROTESK,
                    fontWeight: 700,
                    fontSize: "14px",
                    boxShadow: selectedSport === s.key ? "none" : "0 1px 3px rgba(0,0,0,0.06)",
                  }}
                >
                  <span className="text-lg block mb-0.5">{s.emoji}</span>
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {/* ─── Smart suggestion ─── */}
          {pattern && user && (
            <button
              type="button"
              onClick={handleApplyPattern}
              className="w-full rounded-2xl p-3.5 flex items-center gap-3 text-left active:scale-[0.98] transition-transform"
              style={{
                background: `${RED}10`,
                border: `1.5px solid ${RED}25`,
              }}
            >
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `${RED}15` }}>
                <Zap className="w-4 h-4" style={{ color: RED }} />
              </div>
              <div className="flex-1">
                <p className="text-[13px] font-bold" style={{ fontFamily: FONT_GROTESK, color: NEAR_BLACK }}>
                  Boka igen?
                </p>
                <p className="text-[11px]" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
                  Du brukar boka {pattern.dayName}ar {String(pattern.hour).padStart(2, "0")}:00
                </p>
              </div>
              <span className="text-[11px] font-bold" style={{ fontFamily: FONT_MONO, color: RED }}>
                Boka →
              </span>
            </button>
          )}

          {/* ─── Date picker ─── */}
          <div>
            <h2
              className="text-[10px] font-bold uppercase tracking-widest mb-2"
              style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}
            >
              datum
            </h2>
            <div
              className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1"
              style={{ scrollbarWidth: "none" }}
            >
              {dates.map((date, i) => {
                const isSelected = date.toDateString() === selectedDate.toDateString();
                const isTodayDate = date.toDateString() === new Date().toDateString();
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setSelectedDate(date);
                      setSelectedCourts([]);
                      setAnyCourt(false);
                    }}
                    className="flex-shrink-0 w-[44px] py-1.5 rounded-xl flex flex-col items-center gap-0 transition-all"
                    style={{
                      background: isSelected ? RED : "#fff",
                      color: isSelected ? "#fff" : NEAR_BLACK,
                      boxShadow: isSelected ? "none" : "0 1px 2px rgba(0,0,0,0.04)",
                    }}
                  >
                    <span
                      className="text-[8px] font-bold uppercase leading-tight"
                      style={{
                        fontFamily: FONT_MONO,
                        opacity: isSelected ? 0.7 : 0.4,
                      }}
                    >
                      {isTodayDate ? "idag" : format(date, "EEE", { locale: sv }).slice(0, 3)}
                    </span>
                    <span className="text-[16px] font-bold leading-tight" style={{ fontFamily: FONT_GROTESK }}>
                      {date.getDate()}
                    </span>
                    <span className="text-[7px] font-medium leading-tight" style={{ fontFamily: FONT_MONO, opacity: isSelected ? 0.6 : 0.3 }}>
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
              <p className="text-[13px]" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>stängt denna dag</p>
            </div>
          )}

          {/* ─── Time picker ─── */}
          {!isClosed && (
            <div>
              <h2 className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
                tid
              </h2>
              {filteredTimeSlots.length === 0 ? (
                <p className="text-[13px] text-center py-4" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
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
                        if (anyCourt) setAnyCourt(false);
                      }}
                      className="py-2 rounded-xl text-[12px] font-bold transition-colors"
                      style={{
                        background: selectedTime === time ? RED : "#fff",
                        color: selectedTime === time ? "#fff" : NEAR_BLACK,
                        fontFamily: FONT_MONO,
                        boxShadow: selectedTime === time ? "none" : "0 1px 2px rgba(0,0,0,0.04)",
                      }}
                    >
                      {time}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ─── Court selection ─── */}
          {selectedTime && !isClosed && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-[10px] font-bold uppercase tracking-widest" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
                  välj bana
                </h2>
                {/* Any court toggle */}
                <button
                  type="button"
                  onClick={() => {
                    setAnyCourt(!anyCourt);
                    if (!anyCourt) setSelectedCourts([]);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold transition-all active:scale-95"
                  style={{
                    background: anyCourt ? `${RED}15` : "#fff",
                    color: anyCourt ? RED : TEXT_MUTED,
                    fontFamily: FONT_MONO,
                    border: `1px solid ${anyCourt ? RED + "30" : "rgba(0,0,0,0.08)"}`,
                  }}
                >
                  <Shuffle className="w-3 h-3" />
                  spelar ingen roll
                </button>
              </div>

              {!anyCourt && (
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
                        className="relative py-3 px-3 rounded-xl text-left transition-all active:scale-[0.98]"
                        style={{
                          background: !available ? "rgba(0,0,0,0.03)" : selected ? RED : "#fff",
                          color: !available ? TEXT_MUTED : selected ? "#fff" : NEAR_BLACK,
                          opacity: !available ? 0.4 : 1,
                          cursor: !available ? "not-allowed" : "pointer",
                          boxShadow: selected ? "none" : "0 1px 2px rgba(0,0,0,0.04)",
                        }}
                      >
                        <div className="flex items-center gap-2">
                          {available && !selected && (
                            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                          )}
                          <p className="text-[12px] font-bold" style={{ fontFamily: FONT_GROTESK }}>
                            {court.name}
                          </p>
                        </div>
                        <p className="text-[10px] mt-0.5" style={{ fontFamily: FONT_MONO, opacity: 0.6 }}>
                          {getCourtPrice(court)} kr/h
                        </p>
                        {!available && (
                          <span className="text-[8px] mt-0.5 block" style={{ fontFamily: FONT_MONO }}>
                            bokad
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {anyCourt && selectedCourts.length > 0 && (
                <div className="rounded-xl p-3 flex items-center gap-2" style={{ background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
                  <Target className="w-4 h-4" style={{ color: RED }} />
                  <span className="text-[12px] font-medium" style={{ fontFamily: FONT_MONO, color: NEAR_BLACK }}>
                    {allCourts.find((c) => c.id === selectedCourts[0])?.name} · {totalPrice} kr
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ─── Contact info: only show for anonymous or if edit requested ─── */}
          {selectedCourts.length > 0 && (
            <>
              {user && hasProfile && !showContactForm ? (
                <div className="flex items-center justify-between rounded-xl p-3" style={{ background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
                  <div>
                    <p className="text-[12px] font-medium" style={{ fontFamily: FONT_MONO, color: NEAR_BLACK }}>
                      Bokar som: {name}
                    </p>
                    <p className="text-[10px]" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>{phone}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowContactForm(true)}
                    className="text-[10px] underline"
                    style={{ fontFamily: FONT_MONO, color: RED }}
                  >
                    ändra
                  </button>
                </div>
              ) : (
                <div>
                  <div className="h-px mb-4" style={{ background: "rgba(0,0,0,0.06)" }} />
                  <h2 className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
                    dina uppgifter
                  </h2>
                  <div className="flex gap-2">
                    <input
                      placeholder="ditt namn"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      maxLength={100}
                      className="flex-1 min-w-0 px-3 py-3 rounded-xl text-[16px] placeholder:opacity-30 focus:outline-none transition-colors"
                      style={{ fontFamily: FONT_MONO, background: "#fff", border: "1px solid rgba(0,0,0,0.08)", color: NEAR_BLACK }}
                    />
                    <input
                      type="tel"
                      placeholder="telefon"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      required
                      maxLength={20}
                      className="flex-1 min-w-0 px-3 py-3 rounded-xl text-[16px] placeholder:opacity-30 focus:outline-none transition-colors"
                      style={{ fontFamily: FONT_MONO, background: "#fff", border: "1px solid rgba(0,0,0,0.08)", color: NEAR_BLACK }}
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {/* ─── Corporate payment option ─── */}
          {selectedCourts.length > 0 && activePackages.length > 0 && (
            <div>
              <div className="h-px mb-4" style={{ background: "rgba(0,0,0,0.06)" }} />
              <h2 className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
                betalning
              </h2>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => { setUseCorporate(false); setSelectedPackageId(null); }}
                  className="w-full py-3 px-4 rounded-2xl text-left text-[13px] font-medium transition-all"
                  style={{
                    background: !useCorporate ? DARK_BLUE : "#fff",
                    color: !useCorporate ? "#fff" : NEAR_BLACK,
                    fontFamily: FONT_MONO,
                    boxShadow: !useCorporate ? "none" : "0 1px 2px rgba(0,0,0,0.04)",
                  }}
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
                      className="w-full py-3 px-4 rounded-2xl text-left flex items-center gap-3 transition-all"
                      style={{
                        background: isSelected ? DARK_BLUE : "#fff",
                        color: isSelected ? "#fff" : NEAR_BLACK,
                        boxShadow: isSelected ? "none" : "0 1px 2px rgba(0,0,0,0.04)",
                      }}
                    >
                      <Building2 className="w-4 h-4 flex-shrink-0" style={{ opacity: 0.5 }} />
                      <div className="flex-1">
                        <span className="text-[13px] font-medium" style={{ fontFamily: FONT_MONO }}>
                          {pkg.company_name}
                        </span>
                        <span className="text-[11px] ml-2" style={{ fontFamily: FONT_MONO, opacity: 0.5 }}>
                          {remaining}h kvar
                        </span>
                      </div>
                      <span className="text-[13px] font-bold" style={{ fontFamily: FONT_GROTESK }}>0 kr</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </form>
      )}

      {/* ─── Sticky bottom CTA ─── */}
      {!confirmed && canBook && (
        <div
          className="fixed bottom-0 left-0 right-0 z-50 px-4 pb-[calc(env(safe-area-inset-bottom,8px)+8px)] pt-3"
          style={{
            background: "linear-gradient(to top, rgba(250,248,245,0.98) 0%, rgba(250,248,245,0.9) 60%, transparent 100%)",
          }}
        >
          <button
            onClick={() => bookMutation.mutate()}
            disabled={bookMutation.isPending}
            className="w-full py-4 rounded-2xl text-[14px] font-bold uppercase tracking-wider active:scale-[0.98] transition-transform disabled:opacity-40 flex items-center justify-center gap-3"
            style={{
              background: RED,
              color: "#fff",
              fontFamily: FONT_MONO,
            }}
          >
            {bookMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <span>
                  {selectedCourts.length} {selectedCourts.length === 1 ? "bana" : "banor"} · {useCorporate ? "0" : totalPrice} kr
                </span>
                <span style={{ opacity: 0.7 }}>·</span>
                <span>BOKA</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
