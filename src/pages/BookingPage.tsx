import { useState, useMemo, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, CheckCircle2, Building2 } from "lucide-react";
import { toast } from "sonner";
import { format, addDays } from "date-fns";
import { sv } from "date-fns/locale";
import { DateTime } from "luxon";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { apiGet, apiPost } from "@/lib/api";
import { PlayerNav } from "@/components/PlayerNav";
import { getBookingChatResourceId } from "@/lib/bookingGroups";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import picklaLogo from "@/assets/pickla-logo.svg";
import weekendVibes from "@/assets/pickla-weekend-vibes.jpg";

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const BASE_URL = `https://${PROJECT_ID}.supabase.co/functions/v1`;

const FONT_GROTESK = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

type SportFilter = "pickleball" | "dart";
type TimePeriod = "MORGON" | "LUNCH" | "EFTERMIDDAG" | "KVÄLL";

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

function getTimePeriod(time: string): TimePeriod {
  const hour = Number(time.slice(0, 2));
  if (hour < 12) return "MORGON";
  if (hour < 15) return "LUNCH";
  if (hour < 20) return "EFTERMIDDAG";
  return "KVÄLL";
}

function formatDuration(minutes: number) {
  if (minutes === 60) return "1 tim";
  if (minutes === 90) return "1.5 tim";
  if (minutes === 120) return "2 tim";
  return `${minutes} min`;
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

type BookingMode = "direct" | "stripe";

type DirectBookingRow = {
  id?: string;
  booking_ref?: string;
  stripe_session_id?: string | null;
  start_time?: string;
  end_time?: string;
  notes?: string | null;
  access_code?: string | null;
};

type BookingMutationResult =
  | { type: "direct"; bookings: DirectBookingRow[] }
  | { type: "free"; redirect?: string }
  | { type: "stripe"; url: string };

function bookingChatPath(bookingRef: string, slug: string) {
  return `/booking-chat/${bookingRef}?v=${encodeURIComponent(slug)}`;
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
  const [showTimeList, setShowTimeList] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<TimePeriod>("EFTERMIDDAG");
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

  const groupedTimeSlots = useMemo(() => {
    const groups: Record<string, string[]> = {};
    filteredTimeSlots.forEach((slot) => {
      const period = getTimePeriod(slot);
      groups[period] = [...(groups[period] || []), slot];
    });
    return ["MORGON", "LUNCH", "EFTERMIDDAG", "KVÄLL"]
      .map((label) => ({ label, slots: groups[label] || [] }))
      .filter((group) => group.slots.length > 0);
  }, [filteredTimeSlots]);

  // When date changes: auto-select first available slot
  useEffect(() => {
    const periodSlots = filteredTimeSlots.filter((slot) => getTimePeriod(slot) === selectedPeriod);
    setSelectedTime(periodSlots[0] ?? filteredTimeSlots[0] ?? null);
    setSelectedCourts([]);
  }, [dateStr, selectedPeriod]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const getFirstAvailableCourtForSlot = (slot: string) => {
    const startISO = DateTime.fromISO(`${dateStr}T${slot}:00`, { zone: "Europe/Stockholm" }).toUTC().toISO()!;
    const endTime = addMinutesToTime(slot, selectedDuration);
    const endISO = DateTime.fromISO(`${dateStr}T${endTime}:00`, { zone: "Europe/Stockholm" }).toUTC().toISO()!;
    const startMs = new Date(startISO).getTime();
    const endMs = new Date(endISO).getTime();
    const court = sportCourts.find((c) => !existingBookings.some(
      (b) => b.court_id === c.id && new Date(b.start).getTime() < endMs && new Date(b.end).getTime() > startMs
    ));
    return court ? { court, endTime } : null;
  };

  const recommendations = useMemo(() => {
    if (!sportCourts.length) return [];
    return filteredTimeSlots
      .filter((slot) => getTimePeriod(slot) === selectedPeriod)
      .map((slot) => {
        const match = getFirstAvailableCourtForSlot(slot);
        return match ? { time: slot, endTime: match.endTime, court: match.court, price: Math.round(getMemberCourtPrice(match.court) * durationHours) } : null;
      })
      .filter(Boolean)
      .slice(0, 4) as Array<{ time: string; endTime: string; court: CourtData; price: number }>;
  }, [filteredTimeSlots, selectedPeriod, sportCourts, existingBookings, dateStr, selectedDuration, durationHours, courtPricing, pricingRules]);

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
  const heroTitle = sportFilter === "dart" ? "när vill du kasta?" : "när vill du spela?";
  const anyResourceLabel = sportFilter === "dart" ? "Any dartboard" : "Any court";
  const firstAvailableCourt = availableSportCourts[0] || null;
  const recommendedCourt = selectedCourtObjects[0] || firstAvailableCourt;

  useEffect(() => {
    if (!selectedTime || !firstAvailableCourt || selectedCourts.length > 0) return;
    setSelectedCourts([firstAvailableCourt.id]);
  }, [selectedTime, firstAvailableCourt?.id, selectedCourts.length]);

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

  const pickRecommendation = (recommendation: { time: string; court: CourtData }) => {
    setSelectedTime(recommendation.time);
    setSelectedCourts([recommendation.court.id]);
    setShowTimeList(false);
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
  const bookingName = name.trim() || user?.email?.split("@")[0] || "";
  const bookingPhone = phone.trim();
  const needsPhoneForDirectBooking = !user || useCorporate || baseTotalPrice === 0;
  const hasContactDetails = Boolean(bookingName && (!needsPhoneForDirectBooking || bookingPhone));
  const showProfileLoading = selectedCourts.length > 0 && !!user && !profileLoaded;
  const showContactFields = selectedCourts.length > 0 && !showProfileLoading && (!user || !hasContactDetails || editingContact);
  const showContactSummary = selectedCourts.length > 0 && !showProfileLoading && !!user && Boolean(bookingName) && !editingContact;

  const bookingMode: BookingMode = useCorporate || baseTotalPrice === 0 ? "direct" : "stripe";

  const createDirectBooking = async (): Promise<BookingMutationResult> => {
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
    return { type: "direct", bookings: result.bookings || [] };
  };

  const createStripeOrEntitlementBooking = async (): Promise<BookingMutationResult> => {
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
        name:           bookingName,
        phone:          bookingPhone,
        user_id:        user?.id || "",
      },
    });

    if (result.free) return { type: "free", redirect: result.redirect };
    return { type: "stripe", url: result.url };
  };

  const bookMutation = useMutation({
    mutationFn: async () => {
      return bookingMode === "direct"
        ? createDirectBooking()
        : createStripeOrEntitlementBooking();
    },
    onSuccess: (result) => {
      if (result.type === "stripe") {
        window.location.href = result.url;
        return;
      }
      if (result.type === "free") {
        toast.success("Bokad via ditt medlemskap!");
        navigate(result.redirect || "/activity");
        return;
      }
      const firstBooking = result.bookings?.[0];
      const firstRef = firstBooking?.booking_ref;
      if (firstRef) {
        const chatKey = getBookingChatResourceId(firstBooking) || firstRef;
        navigate(user ? bookingChatPath(encodeURIComponent(chatKey), slug) : `/b/${firstRef}`);
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
    if (!hasContactDetails || !selectedTime || !selectedEndTime || !selectedCourts.length) return;
    bookMutation.mutate();
  };

  const isToday = dateStr === todayStr;
  const isClosed = openingHours?.is_closed;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f7f4ee] flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-neutral-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f4ee] pb-16 text-[#111]">
      {confirmed ? (
        <div className="flex flex-col items-center gap-4 py-16 px-5 text-neutral-950">
          <CheckCircle2 className="w-12 h-12 text-emerald-500" />
          <p
            className="text-neutral-950 font-bold text-lg"
            style={{ fontFamily: FONT_GROTESK }}
          >
            bokad!
          </p>
          <p
            className="text-[12px] text-neutral-500 text-center"
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
        <form onSubmit={handleBook} className="mx-auto max-w-md px-6 pt-[calc(env(safe-area-inset-top,0px)+34px)] py-4 pb-40 space-y-8">
          <header className="flex items-center justify-between">
            <img src={picklaLogo} alt="Pickla" className="h-8 w-auto" />
            <div className="flex items-center gap-1.5 text-[13px]" style={{ fontFamily: FONT_MONO }}>
              <span className="h-2.5 w-2.5 rounded-full bg-[#32ef87]" />
              <span>{venueName.replace("Pickla Arena ", "Pickla ") || "Pickla Solna"}</span>
            </div>
          </header>

          <section>
            <h1 className="text-[40px] leading-none tracking-[-0.04em] text-neutral-950" style={{ fontFamily: FONT_MONO }}>
              Boka aktivitet
            </h1>
            <div className="mt-7 grid grid-cols-3 gap-3">
              {([
                { value: "pickleball", label: "Boka\nPickleball", meta: `${sportCounts.pickleball} banor`, image: null },
                { value: "dart", label: "Boka darts", meta: `${sportCounts.dart} bord`, image: null },
                { value: "event", label: "Boka event", meta: "program", image: weekendVibes },
              ] as const).map((option) => {
                const active = option.value !== "event" && sportFilter === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => option.value === "event" ? navigate(`/events?v=${slug}`) : switchSport(option.value)}
                    className="relative h-36 overflow-hidden rounded-md border text-left shadow-sm transition-transform active:scale-[0.98]"
                    style={{ background: "#f4f0ee", borderColor: active ? "#32ef87" : "rgba(17,17,17,0.07)" }}
                  >
                    {option.image ? (
                      <img src={option.image} alt="" className="absolute inset-0 h-full w-full object-cover" />
                    ) : (
                      <div className="absolute inset-x-4 top-5 h-16 rounded-full bg-white/55" />
                    )}
                    {option.image && <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent" />}
                    <span
                      className="absolute bottom-4 left-2.5 right-2.5 whitespace-pre-line text-[15px] leading-[0.95]"
                      style={{ color: option.image ? "#fff" : "#111", fontFamily: FONT_GROTESK }}
                    >
                      {option.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="-mx-6 overflow-x-auto px-6 pb-2" style={{ scrollbarWidth: "none" }}>
            <div className="flex gap-3">
              {dates.slice(0, 7).map((date, index) => {
                const isSelected = date.toDateString() === selectedDate.toDateString();
                const label = index === 0 ? "Idag" : index === 1 ? "Imorgon" : format(date, "EEE", { locale: sv });
                return (
                  <button
                    key={date.toISOString()}
                    type="button"
                    onClick={() => {
                      setSelectedDate(date);
                      setSelectedCourts([]);
                    }}
                    className="min-h-[236px] w-[260px] flex-shrink-0 rounded-lg border p-5 text-left transition-transform active:scale-[0.99]"
                    style={{
                      background: isSelected ? "#fff" : "#bdbdbd",
                      borderColor: isSelected ? "rgba(17,17,17,0.12)" : "transparent",
                      color: isSelected ? "#111" : "#fff",
                    }}
                  >
                    <div className="flex h-full flex-col justify-between">
                      <div>
                        <p className="text-center text-[40px] leading-none" style={{ fontFamily: FONT_MONO }}>
                          {format(date, "d/M")}
                        </p>
                        {!isSelected && (
                          <p className="mt-14 text-[12px] font-bold" style={{ fontFamily: FONT_MONO }}>{label}</p>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {(["LUNCH", "EFTERMIDDAG", "KVÄLL"] as TimePeriod[]).map((period) => (
                          <span
                            key={period}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedDate(date);
                              setSelectedPeriod(period);
                              setSelectedCourts([]);
                            }}
                            className="rounded-md px-2 py-2 text-center text-[11px]"
                            style={{
                              background: isSelected && selectedPeriod === period ? "#f2f2f2" : "rgba(255,255,255,0.72)",
                              color: isSelected ? "#555" : "#777",
                              fontFamily: FONT_MONO,
                            }}
                          >
                            {period === "EFTERMIDDAG" ? "Eftermiddag" : period.charAt(0) + period.slice(1).toLowerCase()}
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {isClosed ? (
            <div className="rounded-[28px] border border-neutral-200 bg-white p-8 text-center text-[13px] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
              stängt denna dag
            </div>
          ) : (
            <section className="rounded-[22px] border border-neutral-950 bg-white p-7 text-neutral-950">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <p className="text-[28px] leading-none" style={{ fontFamily: FONT_MONO }}>{formatDuration(selectedDuration)}</p>
                  <p className="mt-3 text-[24px] leading-tight" style={{ fontFamily: FONT_MONO }}>
                    {recommendedCourt?.name || anyResourceLabel}
                  </p>
                  <p className="mt-1 text-[12px] text-neutral-500" style={{ fontFamily: FONT_MONO }}>
                    första lediga {sportCourtLabel}
                  </p>
                </div>
                <div className="grid gap-2 text-right text-[12px]" style={{ fontFamily: FONT_MONO }}>
                  <button type="button" onClick={() => setShowTimeList(true)} className="underline underline-offset-4 text-indigo-500">
                    fler alternativ
                  </button>
                  <button type="button" onClick={() => setShowCourtList(true)} className="underline underline-offset-4 text-indigo-500">
                    välj banor
                  </button>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                {recommendations.slice(0, 2).length > 0 ? (
                  recommendations.slice(0, 2).map((recommendation) => {
                    const selected = selectedTime === recommendation.time && selectedCourts.includes(recommendation.court.id);
                    return (
                      <button
                        key={`${recommendation.time}-${recommendation.court.id}`}
                        type="button"
                        onClick={() => pickRecommendation(recommendation)}
                        className="grid w-full grid-cols-[1fr_auto] items-center gap-3 text-left"
                        style={{ fontFamily: FONT_MONO }}
                      >
                        <span className={`text-[25px] leading-none ${selected ? "underline decoration-[#32ef87] decoration-2 underline-offset-4" : ""}`}>
                          {recommendation.time.replace(":", ".")} – {recommendation.endTime.replace(":", ".")}
                        </span>
                        <span className="text-[25px] leading-none">{recommendation.price}kr</span>
                      </button>
                    );
                  })
                ) : (
                  <p className="text-[16px] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
                    Inga lediga tider i {selectedPeriod.toLowerCase()}.
                  </p>
                )}
              </div>

              <div className="mt-6 flex gap-2">
                {[60, 90, 120].map((duration) => (
                  <button
                    key={duration}
                    type="button"
                    onClick={() => {
                      setSelectedDuration(duration);
                      setSelectedCourts([]);
                      setShowCourtList(false);
                    }}
                    className={`rounded-md px-3 py-2 text-[11px] ${selectedDuration === duration ? "bg-neutral-950 text-white" : "bg-neutral-100 text-neutral-500"}`}
                    style={{ fontFamily: FONT_MONO }}
                  >
                    {duration} min
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Contact info */}
          {showProfileLoading && (
            <div>
	              <div className="h-px bg-neutral-200 mb-3" />
	              <div
	                className="rounded-2xl bg-white border border-neutral-200 px-3 py-3 text-[11px] text-neutral-400"
                style={{ fontFamily: FONT_MONO }}
              >
                hämtar dina uppgifter...
              </div>
            </div>
          )}

          {showContactFields && (
            <div>
	              <div className="h-px bg-neutral-200 mb-4" />
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
	                  className="flex-1 min-w-0 px-3 py-3 rounded-xl bg-white border border-neutral-200 text-[#111] text-[16px] placeholder:text-black/25 focus:outline-none focus:border-black/40 transition-colors"
                  style={{ fontFamily: FONT_MONO }}
                />
                <input
                  type="tel"
	                  placeholder="telefon"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  maxLength={20}
	                  className="flex-1 min-w-0 px-3 py-3 rounded-xl bg-white border border-neutral-200 text-[#111] text-[16px] placeholder:text-black/25 focus:outline-none focus:border-black/40 transition-colors"
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
              <div className="h-px bg-neutral-200 mb-6" />
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
	                      ? "bg-neutral-950 text-[#fffaf0]"
	                      : "bg-white text-[#111] border border-neutral-200"
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
	                          ? "bg-neutral-950 text-[#fffaf0]"
	                          : "bg-white text-[#111] border border-neutral-200"
                      }`}
                    >
	                      <Building2 className={`w-4 h-4 flex-shrink-0 ${isSelected ? "text-white/60" : "text-black/35"}`} />
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
		          {selectedCourts.length > 0 && hasContactDetails && (
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
		                    bokas som {bookingName} · ändra
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
      <Drawer open={showTimeList} onOpenChange={setShowTimeList}>
        <DrawerContent className="max-h-[82vh] rounded-t-[28px] border-0 bg-[#f7f4ee] px-4 pb-[calc(env(safe-area-inset-bottom,0px)+18px)]">
          <DrawerHeader className="px-1 pb-3 pt-4 text-left">
            <DrawerTitle className="text-[22px] font-black text-neutral-950" style={{ fontFamily: FONT_GROTESK }}>
              Fler tider
            </DrawerTitle>
            <p className="text-[12px] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
              {format(selectedDate, "d MMM", { locale: sv })} · {formatDuration(selectedDuration)}
            </p>
          </DrawerHeader>
          <div className="space-y-4 overflow-y-auto pb-2">
            {groupedTimeSlots.map((group) => (
              <div key={group.label}>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-neutral-400" style={{ fontFamily: FONT_MONO }}>
                  {group.label}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {group.slots.map((time) => {
                    const match = getFirstAvailableCourtForSlot(time);
                    const selected = selectedTime === time;
                    return (
                      <button
                        key={time}
                        type="button"
                        disabled={!match}
                        onClick={() => {
                          setSelectedTime(time);
                          setSelectedCourts(match ? [match.court.id] : []);
                          setShowTimeList(false);
                        }}
                        className={`rounded-2xl border px-3 py-3 text-left transition-all active:scale-[0.99] disabled:opacity-35 ${
                          selected
                            ? "border-neutral-950 bg-neutral-950 text-[#fffaf0]"
                            : "border-neutral-200 bg-white text-neutral-950"
                        }`}
                      >
                        <p className="text-[14px] font-bold" style={{ fontFamily: FONT_MONO }}>{time}</p>
                        <p className={`mt-1 text-[10px] ${selected ? "text-white/55" : "text-neutral-400"}`} style={{ fontFamily: FONT_MONO }}>
                          {match ? `${Math.round(getMemberCourtPrice(match.court) * durationHours)} kr` : "fullt"}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </DrawerContent>
      </Drawer>

      <Drawer open={showCourtList} onOpenChange={setShowCourtList}>
        <DrawerContent className="max-h-[82vh] rounded-t-[28px] border-0 bg-[#f7f4ee] px-4 pb-[calc(env(safe-area-inset-bottom,0px)+18px)]">
          <DrawerHeader className="px-1 pb-3 pt-4 text-left">
            <DrawerTitle className="text-[22px] font-black text-neutral-950" style={{ fontFamily: FONT_GROTESK }}>
              Välj exakt {sportCourtLabel}
            </DrawerTitle>
            <p className="text-[12px] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
              {availableSportCourts.length} lediga · {selectedTime}-{selectedEndTime}
            </p>
          </DrawerHeader>
          {availableSportCourts.length === 0 ? (
            <p className="px-1 py-8 text-center text-[13px] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
              inga lediga {sportCourtLabel}
            </p>
          ) : (
            <div className="grid gap-2 overflow-y-auto pb-2">
              {availableSportCourts.map((court) => {
                const selected = selectedCourts.includes(court.id);
                const basePrice = getCourtPrice(court);
                const memberPrice = getMemberCourtPrice(court);
                const hasDiscount = memberPrice < basePrice;
                return (
                  <button
                    key={court.id}
                    type="button"
                    onClick={() => {
                      setSelectedCourts([court.id]);
                      setShowCourtList(false);
                    }}
                    className={`rounded-2xl border px-4 py-3 text-left transition-all active:scale-[0.99] ${
                      selected
                        ? "border-neutral-950 bg-neutral-950 text-[#fffaf0]"
                        : "border-neutral-200 bg-white text-neutral-950"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-[15px] font-bold" style={{ fontFamily: FONT_GROTESK }}>{court.name}</p>
                        <p className={`mt-0.5 text-[11px] ${selected ? "text-white/55" : "text-neutral-400"}`} style={{ fontFamily: FONT_MONO }}>
                          {selectedTime}-{selectedEndTime} · {selectedDuration} min
                        </p>
                      </div>
                      <div className="text-right text-[12px]" style={{ fontFamily: FONT_MONO }}>
                        {hasDiscount && <p className="line-through opacity-50">{basePrice} kr/h</p>}
                        <p className={hasDiscount ? (selected ? "text-emerald-200" : "text-emerald-600") : undefined}>
                          {memberPrice} kr/h
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </DrawerContent>
      </Drawer>

      <PlayerNav />
    </div>
  );
}
