import { useState, useMemo, useEffect } from "react";
import { useSearchParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, Loader2, CheckCircle2, MapPin, Building2 } from "lucide-react";
import { toast } from "sonner";
import { format, addDays } from "date-fns";
import { sv } from "date-fns/locale";
import { DateTime } from "luxon";
import picklaLogo from "@/assets/pickla-logo.svg";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { apiGet, apiPost } from "@/lib/api";
import { PlayerNav } from "@/components/PlayerNav";

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const BASE_URL = `https://${PROJECT_ID}.supabase.co/functions/v1`;

const FONT_GROTESK = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

type SportFilter = "pickleball" | "dart";

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

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function addMinutesToTime(time: string, minutesToAdd: number): string {
  const totalMinutes = timeToMinutes(time) + minutesToAdd;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

interface CourtData {
  id: string;
  name: string;
  court_number: number;
  court_type: string | null;
  sport_type?: string | null;
  hourly_rate: number | null;
}

interface ExistingBooking {
  court_id: string;
  start: string;
  end: string;
}

interface PricingRule {
  type: string;
  days_of_week?: number[] | null;
  sport_type?: string | null;
  court_type?: string | null;
  time_from?: string | null;
  time_to?: string | null;
  price: number;
}

interface TierPricing {
  product_type: string;
  fixed_price?: number | string | null;
  discount_percent?: number | string | null;
}

interface CorporatePackage {
  id: string;
  status: string;
  total_hours: number;
  used_hours: number;
  corporate_account_id: string;
  company_name?: string;
}

interface CorporateMembership {
  corporate_accounts?: {
    id: string;
    company_name?: string | null;
  } | null;
}

export default function BookingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const slug = searchParams.get("v") || "pickla-arena-sthlm";
  const navigate = useNavigate();
  const { user } = useAuth();
  const requestedSport: SportFilter = searchParams.get("sport") === "dart" ? "dart" : "pickleball";

  const [selectedDate, setSelectedDate] = useState(() =>
    DateTime.now().setZone("Europe/Stockholm").startOf("day").toJSDate()
  );
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [selectedDuration, setSelectedDuration] = useState(60);
  const [selectedCourts, setSelectedCourts] = useState<string[]>([]);
  const [sportFilter, setSportFilter] = useState<SportFilter>(requestedSport);
  const [showCourtList, setShowCourtList] = useState(false);
  const [name, setName] = useState(searchParams.get("name") || "");
  const [phone, setPhone] = useState(searchParams.get("phone") || "");
  const [editingContact, setEditingContact] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [useCorporate, setUseCorporate] = useState(false);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);

  // Auto-fill name/phone from player profile when logged in
  useEffect(() => {
    if (!user || profileLoaded) return;
    const prefillFromProfile = async () => {
      try {
        const { data } = await supabase
          .from("player_profiles")
          .select("display_name, phone")
          .eq("auth_user_id", user.id)
          .maybeSingle();

        const meta = user.user_metadata || {};
        const fallbackName =
          data?.display_name ||
          meta.display_name ||
          meta.full_name ||
          meta.name ||
          user.email?.split("@")[0] ||
          "";
        const fallbackPhone = data?.phone || meta.phone || user.phone || "";

        if (fallbackName) setName((current) => current || fallbackName);
        if (fallbackPhone) setPhone((current) => current || fallbackPhone);
      } finally {
        setProfileLoaded(true);
      }
    };
    prefillFromProfile();
  }, [user, profileLoaded]);

  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const todayStr = DateTime.now().setZone("Europe/Stockholm").toISODate()!;
  const durationHours = selectedDuration / 60;
  const selectedEndTime = selectedTime ? addMinutesToTime(selectedTime, selectedDuration) : null;

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

  useEffect(() => {
    setSportFilter(requestedSport);
    setSelectedCourts([]);
    setShowCourtList(false);
  }, [requestedSport]);

  const dates = useMemo(() => generateDates(), []);

  // Fetch corporate packages for logged-in user
  const { data: corpData } = useQuery({
    queryKey: ["my-corporate-booking", user?.id],
    enabled: !!user,
    staleTime: 30000,
    queryFn: () => apiGet("api-corporate", "my"),
  });

  const activePackages = useMemo(() => {
    const packages = (corpData?.packages || []) as CorporatePackage[];
    const memberships = (corpData?.memberships || []) as CorporateMembership[];
    if (!packages.length) return [];

    return packages.filter((p) => p.status === 'active' && p.total_hours - p.used_hours > 0).map((p) => {
      const membership = memberships.find((m) => m.corporate_accounts?.id === p.corporate_account_id);
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

  const courts = useMemo<CourtData[]>(() => data?.courts || [], [data?.courts]);
  const openingHours = data?.openingHours;
  const existingBookings = useMemo<ExistingBooking[]>(() => data?.bookings || [], [data?.bookings]);
  const venueName = data?.venue?.name || "";
  const pricingRules = useMemo<PricingRule[]>(() => data?.pricingRules || [], [data?.pricingRules]);

  const { data: membership } = useQuery({
    queryKey: ["booking-membership", user?.id, data?.venue?.id],
    enabled: !!user?.id && !!data?.venue?.id,
    staleTime: 30000,
    queryFn: () => apiGet("api-memberships", "user", { userId: user!.id, venueId: data!.venue.id }),
  });

  // Resolve price for a court based on pricing rules, selected day + time
  const getCourtPrice = (court: CourtData): number => {
    if (!selectedTime) return court.hourly_rate || 0;
    const dayOfWeek = selectedDate.getDay();
    const matchingRule = pricingRules.find((r) => {
      if (r.type !== "hourly") return false;
      const daysMatch = !r.days_of_week || r.days_of_week.length === 0 || r.days_of_week.includes(dayOfWeek);
      const sportMatches = !r.sport_type || r.sport_type === (court.sport_type || "pickleball");
      const courtTypeMatches = !r.court_type || r.court_type === court.court_type;
      const timeFrom = (r.time_from || "00:00").slice(0, 5);
      const timeTo = (r.time_to || "23:59").slice(0, 5);
      return sportMatches && courtTypeMatches && daysMatch && selectedTime >= timeFrom && selectedTime < timeTo;
    });
    return matchingRule ? matchingRule.price : (court.hourly_rate || 0);
  };

  const courtPricing = ((membership?.tier_pricing || []) as TierPricing[]).find((p) => p.product_type === "court_hourly");

  const getMemberCourtPrice = (court: CourtData): number => {
    const basePrice = getCourtPrice(court);
    const sportType = court.sport_type || "pickleball";
    if (sportType !== "pickleball" || !courtPricing) return basePrice;

    if (courtPricing.fixed_price != null) {
      return Math.round(Number(courtPricing.fixed_price));
    }

    if (courtPricing.discount_percent) {
      return Math.round(basePrice * (1 - Number(courtPricing.discount_percent) / 100));
    }

    return basePrice;
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
    const closeTime = openingHours?.close_time ? openingHours.close_time.slice(0, 5) : null;
    const durationFits = (slot: string) =>
      !closeTime || timeToMinutes(slot) + selectedDuration <= timeToMinutes(closeTime);

    const slotsWithinHours = timeSlots.filter(durationFits);
    if (dateStr !== todayStr) return slotsWithinHours;

    const now = DateTime.now().setZone("Europe/Stockholm");
    return slotsWithinHours.filter((slot) => {
      const slotStart = DateTime.fromISO(`${dateStr}T${slot}:00`, { zone: "Europe/Stockholm" });
      return slotStart > now;
    });
  }, [timeSlots, dateStr, todayStr, selectedDuration, openingHours?.close_time]);

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
    const endISO = DateTime.fromISO(`${dateStr}T${addMinutesToTime(selectedTime, selectedDuration)}:00`, { zone: "Europe/Stockholm" }).toUTC().toISO()!;
    const startMs = new Date(startISO).getTime();
    const endMs = new Date(endISO).getTime();

    const avail: Record<string, boolean> = {};
    courts.forEach((c) => {
      const isBooked = existingBookings.some(
        (b) =>
          b.court_id === c.id &&
          new Date(b.start).getTime() < endMs &&
          new Date(b.end).getTime() > startMs
      );
      avail[c.id] = !isBooked;
    });
    return avail;
  }, [courts, existingBookings, selectedTime, selectedDuration, dateStr]);

  const sportCourts = useMemo(
    () => courts.filter((court) => (court.sport_type || "pickleball") === sportFilter),
    [courts, sportFilter]
  );

  const availableSportCourts = useMemo(
    () => sportCourts.filter((court) => courtAvailability[court.id] !== false),
    [sportCourts, courtAvailability]
  );

  const selectedCourtObjects = useMemo(
    () => selectedCourts.map((id) => courts.find((court) => court.id === id)).filter(Boolean) as CourtData[],
    [selectedCourts, courts]
  );

  const sportCounts = useMemo(
    () => ({
      pickleball: courts.filter((court) => (court.sport_type || "pickleball") === "pickleball").length,
      dart: courts.filter((court) => court.sport_type === "dart").length,
    }),
    [courts]
  );

  const sportCourtLabel = sportFilter === "dart" ? "dartbord" : "bana";
  const sportCourtPluralLabel = sportFilter === "dart" ? "dartbord" : "banor";
  const sportTitle = sportFilter === "dart" ? "boka dart" : "boka pickleball";
  const sportSectionLabel = sportFilter === "dart" ? "välj dartbord" : "välj bana";
  const firstAvailableCourt = availableSportCourts[0] || null;
  const hasContactDetails = Boolean(name.trim() && phone.trim());
  const showProfileLoading = selectedCourts.length > 0 && !!user && !profileLoaded;
  const showContactFields = selectedCourts.length > 0 && !showProfileLoading && (!user || !hasContactDetails || editingContact);
  const showContactSummary = selectedCourts.length > 0 && !showProfileLoading && !!user && hasContactDetails && !editingContact;

  const switchSport = (sport: SportFilter) => {
    if (sport === sportFilter) return;
    setSportFilter(sport);
    setSelectedCourts([]);
    setShowCourtList(false);

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("v", slug);
    if (sport === "dart") {
      nextParams.set("sport", "dart");
    } else {
      nextParams.delete("sport");
    }
    setSearchParams(nextParams, { replace: true });
  };

  const selectFirstAvailableCourt = () => {
    if (firstAvailableCourt) {
      setSelectedCourts([firstAvailableCourt.id]);
      setShowCourtList(false);
    }
  };

  const toggleCourt = (courtId: string) => {
    setSelectedCourts((prev) =>
      prev.includes(courtId)
        ? prev.filter((id) => id !== courtId)
        : [...prev, courtId]
    );
  };

  const baseTotalPrice = useMemo(() => {
    return selectedCourts.reduce((sum, id) => {
      const court = courts.find((c) => c.id === id);
      return sum + (court ? Math.round(getCourtPrice(court) * durationHours) : 0);
    }, 0);
  }, [selectedCourts, courts, pricingRules, selectedTime, selectedDate, durationHours]);

  const totalPrice = useMemo(() => {
    return selectedCourts.reduce((sum, id) => {
      const court = courts.find((c) => c.id === id);
      return sum + (court ? Math.round(getMemberCourtPrice(court) * durationHours) : 0);
    }, 0);
  }, [selectedCourts, courts, pricingRules, selectedTime, selectedDate, courtPricing, durationHours]);

  const hasMemberCourtPrice = totalPrice < baseTotalPrice;
  const selectedCourtNames = selectedCourtObjects.map((court) => court.name).join(", ");
  const hasSelectedTrip = selectedCourts.length > 0 && !!selectedTime && !!selectedEndTime;

  const bookMutation = useMutation({
    mutationFn: async () => {
      const isFree = useCorporate || baseTotalPrice === 0;

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
            endTime: selectedEndTime,
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
        amount_sek:   baseTotalPrice,
        venue_id:     venueId,
        metadata: {
          slug,
          court_ids:      JSON.stringify(selectedCourts),
          date:           dateStr,
          start_time:     selectedTime!,
          end_time:       selectedEndTime!,
          duration_hours: String(durationHours),
          name:           name.trim(),
          phone:          phone.trim(),
          user_id:        user?.id || "",
        },
      });
      // Free entitlement booking — no Stripe needed
      if (result.free) return { type: "free" as const, redirect: result.redirect };
      return { type: "stripe" as const, url: result.url };
    },
    onSuccess: (result) => {
      if (result.type === "stripe") {
        window.location.href = result.url;
        return;
      }
      if (result.type === "free") {
        toast.success("Bokad via ditt medlemskap!");
        navigate("/hub");
        return;
      }
      const firstRef = result.bookings?.[0]?.booking_ref;
      if (firstRef) {
        navigate("/hub");
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
    if (!name.trim() || !phone.trim() || !selectedTime || !selectedEndTime || !selectedCourts.length) return;
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
          {sportTitle}
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
            {selectedCourts.length} {selectedCourts.length === 1 ? sportCourtLabel : sportCourtPluralLabel} ·{" "}
            {format(selectedDate, "d MMM", { locale: sv })} · {selectedTime}–{selectedEndTime}
          </p>
          <button
            onClick={() => {
              setConfirmed(false);
              setSelectedCourts([]);
              setSelectedTime(null);
              if (!user) {
                setName("");
                setPhone("");
              }
            }}
            className="mt-4 text-[12px] text-neutral-500 underline underline-offset-4"
            style={{ fontFamily: FONT_MONO }}
          >
            boka igen
          </button>
        </div>
      ) : (
        <form onSubmit={handleBook} className="px-4 py-4 pb-36 space-y-4">
          {/* Sport picker */}
          <div>
            <h2
              className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-2"
              style={{ fontFamily: FONT_MONO }}
            >
              aktivitet
            </h2>
            <div className="grid grid-cols-2 gap-1.5">
              {([
                { value: "pickleball", label: "Pickleball", meta: `${sportCounts.pickleball} banor` },
                { value: "dart", label: "Dart", meta: `${sportCounts.dart} bord` },
              ] as const).map((option) => {
                const active = sportFilter === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => switchSport(option.value)}
                    className={`rounded-2xl px-3 py-3 text-left transition-all ${
                      active
                        ? "bg-neutral-900 text-white shadow-sm"
                        : "bg-neutral-50 text-neutral-500 active:scale-[0.98]"
                    }`}
                  >
                    <span
                      className="block text-[13px] font-bold leading-tight"
                      style={{ fontFamily: FONT_GROTESK }}
                    >
                      {option.label}
                    </span>
                    <span
                      className={`block text-[10px] mt-0.5 ${active ? "text-white/55" : "text-neutral-400"}`}
                      style={{ fontFamily: FONT_MONO }}
                    >
                      {option.meta}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

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

          {/* Duration picker */}
          {!isClosed && filteredTimeSlots.length > 0 && (
            <div>
              <h2
                className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-2"
                style={{ fontFamily: FONT_MONO }}
              >
                längd
              </h2>
              <div className="grid grid-cols-3 gap-1.5">
                {[60, 90, 120].map((duration) => {
                  const selected = selectedDuration === duration;
	                  return (
	                    <button
	                      key={duration}
	                      type="button"
	                      onClick={() => {
	                        setSelectedDuration(duration);
	                        setSelectedCourts([]);
	                        setShowCourtList(false);
	                      }}
                      className={`py-2.5 rounded-xl text-[12px] font-bold transition-colors ${
                        selected
                          ? "bg-neutral-900 text-white"
                          : "bg-neutral-50 text-neutral-500"
                      }`}
                      style={{ fontFamily: FONT_MONO }}
                    >
                      {duration} min
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Court selection */}
          {selectedTime && !isClosed && (
            <div className="space-y-2">
              <h2
                className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest"
                style={{ fontFamily: FONT_MONO }}
              >
                välj alternativ
              </h2>

              {firstAvailableCourt && selectedEndTime && (
                <button
                  type="button"
                  onClick={selectFirstAvailableCourt}
                  className={`w-full rounded-3xl p-4 text-left border transition-all active:scale-[0.99] ${
                    selectedCourts.length === 1 && selectedCourts[0] === firstAvailableCourt.id
                      ? "bg-neutral-900 text-white border-neutral-900"
                      : "bg-white text-neutral-900 border-neutral-200 shadow-[0_10px_30px_rgba(15,23,42,0.06)]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p
                        className="text-[16px] font-bold leading-tight"
                        style={{ fontFamily: FONT_GROTESK }}
                      >
                        Första bästa {sportCourtLabel}
                      </p>
                      <p
                        className="text-[12px] text-current opacity-55 mt-1 truncate"
                        style={{ fontFamily: FONT_MONO }}
                      >
                        {firstAvailableCourt.name} · {selectedTime}-{selectedEndTime} · {selectedDuration} min
                      </p>
                    </div>
                    <span
                      className="text-[16px] font-bold whitespace-nowrap"
                      style={{ fontFamily: FONT_GROTESK }}
                    >
                      {Math.round(getMemberCourtPrice(firstAvailableCourt) * durationHours)} kr
                    </span>
                  </div>
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowCourtList((value) => !value)}
                className={`w-full rounded-3xl p-4 text-left border transition-all active:scale-[0.99] ${
                  showCourtList || selectedCourts.length > 1
                    ? "bg-neutral-900 text-white border-neutral-900"
                    : "bg-white text-neutral-900 border-neutral-200"
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p
                      className="text-[16px] font-bold leading-tight"
                      style={{ fontFamily: FONT_GROTESK }}
                    >
                      Välj {sportCourtLabel} själv
                    </p>
                    <p
                      className="text-[12px] text-current opacity-55 mt-1 truncate"
                      style={{ fontFamily: FONT_MONO }}
                    >
                      {selectedCourtObjects.length > 0 ? selectedCourtNames : `${availableSportCourts.length} lediga`}
                    </p>
                  </div>
                  <span className="text-[20px] leading-none">›</span>
                </div>
              </button>

              {showCourtList && (
                sportCourts.length === 0 ? (
                  <p
                    className="text-[13px] text-neutral-400 text-center py-4"
                    style={{ fontFamily: FONT_MONO }}
                  >
                    inga {sportCourtLabel} upplagda
                  </p>
                ) : (
                  <div className={sportFilter === "dart" ? "grid grid-cols-3 gap-1.5" : "grid grid-cols-2 gap-1.5"}>
                    {sportCourts.map((court) => {
                      const available = courtAvailability[court.id] !== false;
                      const selected = selectedCourts.includes(court.id);
                      const basePrice = getCourtPrice(court);
                      const memberPrice = getMemberCourtPrice(court);
                      const hasDiscount = memberPrice < basePrice;
                      return (
                        <button
                          key={court.id}
                          type="button"
                          disabled={!available}
                          onClick={() => available && toggleCourt(court.id)}
                          className={`relative min-h-[58px] px-3 py-2.5 rounded-xl text-left transition-all ${
                            !available
                              ? "opacity-40 bg-neutral-50 cursor-not-allowed"
                              : selected
                              ? "bg-neutral-900 text-white shadow-sm"
                              : "bg-neutral-50 text-neutral-700 active:scale-[0.98]"
                          }`}
                        >
                          <p
                            className="text-[11px] font-bold leading-tight"
                            style={{ fontFamily: FONT_GROTESK }}
                          >
                            {court.name}
                          </p>
                          <div
                            className={`text-[10px] mt-1 flex items-center gap-1 ${
                              selected ? "text-white/60" : "text-neutral-400"
                            }`}
                            style={{ fontFamily: FONT_MONO }}
                          >
                            {hasDiscount && (
                              <span className="line-through opacity-60">{basePrice} kr/h</span>
                            )}
                            <span className={hasDiscount ? (selected ? "text-emerald-200" : "text-emerald-600") : undefined}>
                              {memberPrice} kr/h
                            </span>
                          </div>
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
                )
              )}
            </div>
          )}

          {/* Contact info */}
          {showProfileLoading && (
            <div>
              <div className="h-px bg-neutral-100 mb-3" />
              <div
                className="rounded-2xl bg-neutral-50 border border-neutral-100 px-3 py-3 text-[11px] text-neutral-400"
                style={{ fontFamily: FONT_MONO }}
              >
                hämtar dina uppgifter...
              </div>
            </div>
          )}

          {showContactFields && (
            <div>
              <div className="h-px bg-neutral-100 mb-4" />
              <h2
                className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-2"
                style={{ fontFamily: FONT_MONO }}
              >
                {user ? "komplettera profil" : "dina uppgifter"}
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
              {user && (
                <p
                  className="text-[10px] text-neutral-400 mt-2"
                  style={{ fontFamily: FONT_MONO }}
                >
                  vi använder detta på bokningen och kvittot
                </p>
              )}
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
                  betala i kassan · {hasMemberCourtPrice ? `${totalPrice} kr` : `${baseTotalPrice} kr`}
                </button>
                {activePackages.map((pkg) => {
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
	            <div className="fixed left-0 right-0 bottom-[64px] z-30 px-4 pb-[env(safe-area-inset-bottom,0px)]">
	              <div className="mx-auto max-w-md rounded-[28px] bg-white/95 p-3 shadow-[0_-12px_40px_rgba(15,23,42,0.12)] backdrop-blur">
	                <div className="flex items-center justify-between text-[12px] mb-3" style={{ fontFamily: FONT_MONO }}>
	                  <span className="text-neutral-400">
	                    {format(selectedDate, "d MMM", { locale: sv })} · {selectedTime}–{selectedEndTime} · {selectedCourtNames}
	                  </span>
	                  <span className="font-bold text-neutral-900" style={{ fontFamily: FONT_GROTESK }}>
	                    {useCorporate ? "0 kr" : `${totalPrice} kr`}
	                  </span>
	                </div>
	                {!useCorporate && hasMemberCourtPrice && (
	                  <p className="text-[11px] text-emerald-600 -mt-2 mb-3 text-right" style={{ fontFamily: FONT_MONO }}>
	                    medlemspris · ord. {baseTotalPrice} kr
	                  </p>
	                )}
	                {showContactSummary && (
	                  <button
	                    type="button"
	                    onClick={() => setEditingContact(true)}
	                    className="w-full text-left text-[10px] text-neutral-400 mb-2"
	                    style={{ fontFamily: FONT_MONO }}
	                  >
	                    bokas som {name} · ändra
	                  </button>
	                )}

	                <button
	                  type="submit"
	                  disabled={bookMutation.isPending}
	                  className="w-full py-3 rounded-xl bg-neutral-900 text-white text-[13px] font-bold uppercase tracking-wider active:scale-[0.98] transition-transform disabled:opacity-40"
	                  style={{ fontFamily: FONT_MONO }}
	                >
	                  {bookMutation.isPending ? (
	                    <Loader2 className="w-4 h-4 animate-spin mx-auto" />
	                  ) : (
	                    "fortsätt"
	                  )}
	                </button>
	              </div>
	            </div>
	          )}
        </form>
      )}
      <PlayerNav />
    </div>
  );
}
