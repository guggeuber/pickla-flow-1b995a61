import { useState, useMemo, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, CheckCircle2, Building2, Check, CircleDot, Target } from "lucide-react";
import { toast } from "sonner";
import { format, addDays } from "date-fns";
import { sv } from "date-fns/locale";
import { DateTime } from "luxon";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { apiGet, apiPost } from "@/lib/api";
import { PicklaTopBar } from "@/components/PicklaTopBar";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { preserveIntendedRoute } from "@/lib/entryResolver";
import weekendVibes from "@/assets/pickla-weekend-vibes.jpg";

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const BASE_URL = `https://${PROJECT_ID}.supabase.co/functions/v1`;

const FONT_GROTESK = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

type SportFilter = "pickleball" | "dart";
type TimePeriod = "MORGON" | "LUNCH" | "EFTERMIDDAG" | "KVÄLL";
const PERIOD_OPTIONS: TimePeriod[] = ["MORGON", "LUNCH", "EFTERMIDDAG", "KVÄLL"];

function getStockholmTodayDate() {
  return DateTime.now().setZone("Europe/Stockholm").startOf("day").toJSDate();
}

function generateDates(startDate: Date, count = 7) {
  const dates: Date[] = [];
  for (let i = 0; i < count; i++) dates.push(addDays(startDate, i));
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

function formatPeriodLabel(period: TimePeriod) {
  if (period === "EFTERMIDDAG") return "Eftermiddag";
  return period.charAt(0) + period.slice(1).toLowerCase();
}

function phoneDigitCount(value: string) {
  return value.replace(/\D/g, "").length;
}

function isValidPhone(value: string) {
  const digits = phoneDigitCount(value);
  return digits >= 7 && digits <= 15;
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
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

interface DayAvailability {
  openingHours: {
    open_time: string | null;
    close_time: string | null;
    is_closed: boolean | null;
  } | null;
  bookings: ExistingBooking[];
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

interface MemberPassesData {
  court_hours?: {
    allowed?: number;
    used?: number;
    remaining?: number;
    period_start?: string;
    period_end?: string;
  } | null;
  membership?: {
    tier?: {
      name?: string | null;
    } | null;
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

export default function BookingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const slug = searchParams.get("v") || "pickla-arena-sthlm";
  const navigate = useNavigate();
  const { user } = useAuth();
  const requestedSport: SportFilter = searchParams.get("sport") === "dart" ? "dart" : "pickleball";

  const [availabilityStartDate, setAvailabilityStartDate] = useState(() => getStockholmTodayDate());
  const [selectedDate, setSelectedDate] = useState(() => getStockholmTodayDate());
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [selectedDuration, setSelectedDuration] = useState(60);
  const [selectedCourts, setSelectedCourts] = useState<string[]>([]);
  const [sportFilter, setSportFilter] = useState<SportFilter>(requestedSport);
  const [showCourtList, setShowCourtList] = useState(false);
  const [showTimeList, setShowTimeList] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<TimePeriod>("EFTERMIDDAG");
  const [name, setName] = useState(searchParams.get("name") || "");
  const [phone, setPhone] = useState(searchParams.get("phone") || "");
  const [email, setEmail] = useState(searchParams.get("email") || "");
  const [editingContact, setEditingContact] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [savedProfilePhone, setSavedProfilePhone] = useState("");
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
        const fallbackEmail = user.email || "";

        if (fallbackName) setName((current) => current || fallbackName);
        if (fallbackPhone) setPhone((current) => current || fallbackPhone);
        if (fallbackEmail) setEmail((current) => current || fallbackEmail);
        setSavedProfilePhone(fallbackPhone.trim());
      } finally {
        setProfileLoaded(true);
      }
    };
    prefillFromProfile();
  }, [user, profileLoaded]);

  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const todayStr = DateTime.now().setZone("Europe/Stockholm").toISODate()!;
  const availabilityStartStr = format(availabilityStartDate, "yyyy-MM-dd");
  const durationHours = selectedDuration / 60;
  const selectedEndTime = selectedTime ? addMinutesToTime(selectedTime, selectedDuration) : null;

  // Guard: if selectedDate is somehow in the past, snap to today
  useEffect(() => {
    const todayStart = DateTime.now().setZone("Europe/Stockholm").startOf("day");
    const selStart = DateTime.fromJSDate(selectedDate).setZone("Europe/Stockholm").startOf("day");
    if (selStart < todayStart) {
      const todayDate = todayStart.toJSDate();
      setAvailabilityStartDate(todayDate);
      setSelectedDate(todayDate);
      setSelectedTime(null);
      setSelectedCourts([]);
    }
  }, []);

  useEffect(() => {
    setSportFilter(requestedSport);
    setSelectedCourts([]);
    setShowCourtList(false);
  }, [requestedSport]);

  const dates = useMemo(() => generateDates(availabilityStartDate, 7), [availabilityStartDate]);

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

  // Fetch courts + a week of availability so date changes feel instant.
  const { data, isLoading } = useQuery({
    queryKey: ["public-courts-week", slug, availabilityStartStr],
    staleTime: 10000,
    queryFn: async () => {
      const res = await fetch(
        `${BASE_URL}/api-bookings/public-courts?slug=${slug}&date=${availabilityStartStr}&days=7`
      );
      if (!res.ok) throw new Error("Kunde inte hämta banor");
      return res.json();
    },
  });

  const courts = useMemo<CourtData[]>(() => data?.courts || [], [data?.courts]);
  const dayAvailability = (data?.availabilityByDate?.[dateStr] || {
    openingHours: data?.openingHours || null,
    bookings: data?.bookings || [],
  }) as DayAvailability;
  const openingHours = dayAvailability.openingHours;
  const existingBookings = useMemo<ExistingBooking[]>(
    () => dayAvailability.bookings || [],
    [dayAvailability.bookings]
  );
  const venueName = data?.venue?.name || "";
  const pricingRules = useMemo<PricingRule[]>(() => data?.pricingRules || [], [data?.pricingRules]);

  const { data: membership } = useQuery({
    queryKey: ["booking-membership", user?.id, data?.venue?.id],
    enabled: !!user?.id && !!data?.venue?.id,
    staleTime: 30000,
    queryFn: () => apiGet("api-memberships", "user", { userId: user!.id, venueId: data!.venue.id }),
  });

  const { data: memberPasses } = useQuery<MemberPassesData>({
    queryKey: ["booking-member-passes", user?.id, data?.venue?.id],
    enabled: !!user?.id && !!data?.venue?.id,
    staleTime: 10000,
    queryFn: () => apiGet("api-day-passes", "my-passes", { venueId: data!.venue.id }),
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

  // Keep the main card on a real available recommendation as availability data changes.
  useEffect(() => {
    const periodSlots = filteredTimeSlots.filter((slot) => getTimePeriod(slot) === selectedPeriod);
    const candidateSlots = periodSlots.length ? periodSlots : filteredTimeSlots;

    if (candidateSlots.length === 0) {
      setSelectedTime(null);
      setSelectedCourts([]);
      return;
    }

    const selectedHasAvailableCourt = selectedTime && getFirstAvailableCourtForSlot(selectedTime);
    const selectedStillInScope = selectedTime && candidateSlots.includes(selectedTime);
    if (selectedHasAvailableCourt && selectedStillInScope) return;

    const nextSlot = candidateSlots.find((slot) => getFirstAvailableCourtForSlot(slot)) || candidateSlots[0];
    const match = getFirstAvailableCourtForSlot(nextSlot);
    setSelectedTime(nextSlot);
    setSelectedCourts(match ? [match.court.id] : []);
  }, [dateStr, selectedPeriod, selectedDuration, sportFilter, filteredTimeSlots, existingBookings, sportCourts]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const firstAvailableCourt = availableSportCourts[0] || null;
  const recommendedCourt = selectedCourtObjects[0] || firstAvailableCourt;
  const selectedCourtSummary =
    selectedCourtObjects.length === 0
      ? `Ingen ledig ${sportCourtLabel}`
      : selectedCourtObjects.length <= 2
      ? selectedCourtObjects.map((court) => court.name).join(", ")
      : `${selectedCourtObjects.length} ${sportCourtPluralLabel}`;

  useEffect(() => {
    if (!selectedTime || !firstAvailableCourt || selectedCourts.length > 0) return;
    setSelectedCourts([firstAvailableCourt.id]);
  }, [selectedTime, firstAvailableCourt, selectedCourts.length]);

  useEffect(() => {
    if (!selectedTime || selectedCourts.length === 0) return;
    const validSelected = selectedCourts.filter((id) =>
      courtAvailability[id] !== false && sportCourts.some((court) => court.id === id)
    );
    if (validSelected.length === selectedCourts.length) return;
    setSelectedCourts(validSelected.length ? validSelected : firstAvailableCourt ? [firstAvailableCourt.id] : []);
  }, [selectedTime, selectedCourts, courtAvailability, sportCourts, firstAvailableCourt]);

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

  const selectDateRange = (date: Date) => {
    const nextDate = DateTime.fromJSDate(date).setZone("Europe/Stockholm").startOf("day").toJSDate();
    setAvailabilityStartDate(nextDate);
    setSelectedDate(nextDate);
    setSelectedTime(null);
    setSelectedCourts([]);
    setShowDatePicker(false);
  };

  const baseTotalPrice = useMemo(() => {
    return selectedCourts.reduce((sum, id) => {
      const court = courts.find((c) => c.id === id);
      return sum + (court ? Math.round(getCourtPrice(court) * durationHours) : 0);
    }, 0);
  }, [selectedCourts, courts, pricingRules, selectedTime, selectedDate, durationHours]);

  const requestedIncludedCourtHours = selectedCourts.length * durationHours;
  const remainingIncludedCourtHours = Number(memberPasses?.court_hours?.remaining ?? 0);
  const includedCourtHoursApplied =
    sportFilter === "pickleball"
      ? Math.min(remainingIncludedCourtHours, requestedIncludedCourtHours)
      : 0;
  const paidCourtHours = Math.max(0, requestedIncludedCourtHours - includedCourtHoursApplied);
  const hasAnyIncludedCourtHours = includedCourtHoursApplied > 0;
  const hasFullyIncludedCourtHours =
    requestedIncludedCourtHours > 0 && includedCourtHoursApplied >= requestedIncludedCourtHours;
  const hasPartiallyIncludedCourtHours =
    hasAnyIncludedCourtHours && !hasFullyIncludedCourtHours;

  const memberCourtLineItems = useMemo(() => {
    return selectedCourts
      .map((id) => {
        const court = courts.find((c) => c.id === id);
        if (!court) return null;
        return {
          hourlyPrice: getMemberCourtPrice(court),
          hours: durationHours,
        };
      })
      .filter(Boolean) as { hourlyPrice: number; hours: number }[];
  }, [selectedCourts, courts, pricingRules, selectedTime, selectedDate, courtPricing, durationHours]);

  const memberTotalBeforeIncludedHours = useMemo(() => {
    return memberCourtLineItems.reduce((sum, item) => sum + Math.round(item.hourlyPrice * item.hours), 0);
  }, [memberCourtLineItems]);

  const includedCourtHoursValue = useMemo(() => {
    let hoursToApply = includedCourtHoursApplied;
    if (hoursToApply <= 0) return 0;

    // Use included hours against the most expensive member-priced court hours first.
    // Usually all selected courts have the same price, but this keeps mixed-court bookings fair.
    const sorted = [...memberCourtLineItems].sort((a, b) => b.hourlyPrice - a.hourlyPrice);
    return sorted.reduce((sum, item) => {
      if (hoursToApply <= 0) return sum;
      const applied = Math.min(hoursToApply, item.hours);
      hoursToApply -= applied;
      return sum + Math.round(applied * item.hourlyPrice);
    }, 0);
  }, [memberCourtLineItems, includedCourtHoursApplied]);

  const totalPrice = Math.max(0, memberTotalBeforeIncludedHours - includedCourtHoursValue);

  const hasMemberCourtPrice = totalPrice < baseTotalPrice;
  const membershipTierName = memberPasses?.membership?.tier?.name || "medlemskap";

  const bookingName = name.trim() || user?.email?.split("@")[0] || "";
  const bookingPhone = phone.trim();
  const bookingEmail = email.trim() || user?.email || "";
  const needsPhoneForDirectBooking = true;
  const needsEmailForBooking = !user || baseTotalPrice === 0;
  const phoneIsReady = !needsPhoneForDirectBooking || isValidPhone(bookingPhone);
  const emailIsReady = !needsEmailForBooking || isValidEmail(bookingEmail);
  const contactFormIsReady = Boolean(bookingName && phoneIsReady && emailIsReady);
  const contactNeedsProfileSave = Boolean(
    user &&
    profileLoaded &&
    contactFormIsReady &&
    bookingPhone &&
    bookingPhone !== savedProfilePhone.trim()
  );
  const hasContactDetails = Boolean(
    user &&
    bookingName &&
    phoneIsReady &&
    emailIsReady &&
    !contactNeedsProfileSave
  );
  const showProfileLoading = selectedCourts.length > 0 && !!user && !profileLoaded;
  const showAuthPrompt = selectedCourts.length > 0 && !user;
  const showContactFields = selectedCourts.length > 0 && !showProfileLoading && !!user && (!hasContactDetails || editingContact || contactNeedsProfileSave);
  const showContactSummary = selectedCourts.length > 0 && !showProfileLoading && !!user && hasContactDetails && !editingContact;
  const isToday = dateStr === todayStr;
  const selectedDateLabel = isToday
    ? "Idag"
    : DateTime.fromJSDate(selectedDate).setZone("Europe/Stockholm").hasSame(
        DateTime.now().setZone("Europe/Stockholm").plus({ days: 1 }),
        "day"
      )
      ? "Imorgon"
      : format(selectedDate, "EEEE", { locale: sv });
  const canSubmitBooking = Boolean(user && hasContactDetails && selectedTime && selectedEndTime && selectedCourts.length);
  const bookingButtonLabel = !user
    ? "Logga in för att boka"
    : !contactFormIsReady
      ? "Fyll i uppgifter"
      : contactNeedsProfileSave
        ? "Spara telefonnummer först"
        : hasFullyIncludedCourtHours && !useCorporate
          ? "Boka med fri timme"
          : `Boka ${useCorporate ? 0 : totalPrice} kr`;
  const isViewingTodayRange = availabilityStartStr === todayStr;
  const todayLuxon = DateTime.now().setZone("Europe/Stockholm").startOf("day");
  const nextWeekDate = todayLuxon.plus({ days: 7 }).toJSDate();
  const twoWeeksDate = todayLuxon.plus({ days: 14 }).toJSDate();
  const daysUntilSaturday = ((6 - todayLuxon.weekday + 7) % 7) || 7;
  const nextWeekendDate = todayLuxon.plus({ days: daysUntilSaturday }).toJSDate();

  const bookingMode: BookingMode = useCorporate || baseTotalPrice === 0 ? "direct" : "stripe";

  const goToAuth = () => {
    preserveIntendedRoute(window.location.pathname + window.location.search);
    navigate("/auth");
  };

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
        email: bookingEmail,
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
        customer_email: bookingEmail,
        user_id:        user?.id || "",
      },
    });

    if (result.free) return { type: "free", redirect: result.redirect };
    return { type: "stripe", url: result.url };
  };

  const saveContactMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Du behöver vara inloggad");
      if (!contactFormIsReady) throw new Error("Fyll i namn och telefonnummer först");

      const { error } = await supabase
        .from("player_profiles")
        .upsert(
          {
            auth_user_id: user.id,
            display_name: bookingName,
            phone: bookingPhone,
          },
          { onConflict: "auth_user_id" }
        );

      if (error) throw error;
      return bookingPhone;
    },
    onSuccess: (savedPhone) => {
      setSavedProfilePhone(savedPhone);
      setEditingContact(false);
      toast.success("Telefonnummer sparat");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Kunde inte spara telefonnummer");
    },
  });

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
        navigate(`/b/${encodeURIComponent(firstRef)}`);
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
    if (!user) {
      goToAuth();
      return;
    }
    if (contactNeedsProfileSave) {
      toast.error("Spara telefonnumret först");
      return;
    }
    if (!hasContactDetails || !selectedTime || !selectedEndTime || !selectedCourts.length) return;
    bookMutation.mutate();
  };

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
                setEmail("");
              }
            }}
            className="mt-4 text-[12px] text-neutral-500 underline underline-offset-4"
            style={{ fontFamily: FONT_MONO }}
          >
            boka igen
          </button>
        </div>
      ) : (
        <form onSubmit={handleBook} className="mx-auto max-w-md px-6 pt-[calc(env(safe-area-inset-top,0px)+118px)] py-4 pb-16 space-y-8">
          <PicklaTopBar
            slug={slug}
            venueName={venueName.replace("Pickla Arena ", "Pickla ") || "Pickla Stockholm"}
            background="#f7f4ee"
          />
          <section>
            <h1 className="text-[40px] leading-none tracking-[-0.04em] text-neutral-950" style={{ fontFamily: FONT_MONO }}>
              Boka aktivitet
            </h1>
            <div className="mt-7 grid grid-cols-3 gap-3">
              {([
                { value: "pickleball", label: "Boka\nPickleball", meta: `${sportCounts.pickleball} banor`, image: null, icon: <CircleDot className="h-8 w-8" /> },
                { value: "dart", label: "Boka darts", meta: `${sportCounts.dart} bord`, image: null, icon: <Target className="h-8 w-8" /> },
                { value: "event", label: "Planera event", meta: "grupper", image: weekendVibes, icon: null },
              ] as const).map((option) => {
                const active = option.value !== "event" && sportFilter === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => option.value === "event" ? navigate(`/book/group?v=${slug}`) : switchSport(option.value)}
                    className="relative h-36 overflow-hidden rounded-md border text-left shadow-sm transition-transform active:scale-[0.98]"
                    style={{ background: "#f4f0ee", borderColor: active ? "#32ef87" : "rgba(17,17,17,0.07)" }}
                  >
                    {option.image ? (
                      <img src={option.image} alt="" className="absolute inset-0 h-full w-full object-cover" />
                    ) : (
                      <div className="absolute left-3 top-4 grid h-14 w-14 place-items-center rounded-2xl bg-white/70 text-neutral-950">
                        {option.icon}
                      </div>
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

          <section className="space-y-4">
            <div className="-mx-6 overflow-x-auto px-6 pb-1" style={{ scrollbarWidth: "none" }}>
              <div className="flex gap-2">
              {dates.slice(0, 7).map((date, index) => {
                const isSelected = date.toDateString() === selectedDate.toDateString();
                const dateKey = format(date, "yyyy-MM-dd");
                const label = dateKey === todayStr
                  ? "Idag"
                  : dateKey === DateTime.now().setZone("Europe/Stockholm").plus({ days: 1 }).toISODate()
                  ? "Imorgon"
                  : format(date, "EEE", { locale: sv });
                return (
                  <button
                    key={date.toISOString()}
                    type="button"
                    onClick={() => {
                      setSelectedDate(date);
                      setSelectedCourts([]);
                    }}
                    className="min-w-[92px] rounded-2xl border px-3 py-3 text-left transition-transform active:scale-[0.98]"
                    style={{
                      background: isSelected ? "#111" : "#fff",
                      borderColor: isSelected ? "#111" : "rgba(17,17,17,0.08)",
                      color: isSelected ? "#fff" : "#111",
                    }}
                  >
                    <p className="text-[10px] font-bold uppercase tracking-wide opacity-60" style={{ fontFamily: FONT_MONO }}>{label}</p>
                    <p className="mt-1 text-[20px] leading-none" style={{ fontFamily: FONT_MONO }}>
                      {format(date, "d/M")}
                    </p>
                  </button>
                );
              })}
                <button
                  type="button"
                  onClick={() => setShowDatePicker(true)}
                  className="min-w-[116px] rounded-2xl border border-dashed border-neutral-300 bg-white px-3 py-3 text-left text-neutral-950 transition-transform active:scale-[0.98]"
                >
                  <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-400" style={{ fontFamily: FONT_MONO }}>
                    Mer
                  </p>
                  <p className="mt-1 text-[16px] leading-none" style={{ fontFamily: FONT_MONO }}>
                    Välj datum
                  </p>
                </button>
              </div>
            </div>

            {!isViewingTodayRange && (
              <button
                type="button"
                onClick={() => selectDateRange(getStockholmTodayDate())}
                className="rounded-full bg-white px-4 py-2 text-[11px] text-neutral-500 shadow-sm"
                style={{ fontFamily: FONT_MONO }}
              >
                Till idag
              </button>
            )}

            <div className="min-h-[520px] rounded-[32px] border border-neutral-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
                    {selectedDateLabel}
                  </p>
                  <h2 className="mt-4 text-[72px] leading-none tracking-[-0.06em] text-neutral-950" style={{ fontFamily: FONT_MONO }}>
                    {format(selectedDate, "d/M")}
                  </h2>
                </div>
                <div className="rounded-full border border-neutral-200 px-3 py-2 text-[11px] text-neutral-500" style={{ fontFamily: FONT_MONO }}>
                  {sportTitle}
                </div>
              </div>

              <div className="mt-12">
                <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
                  När på dagen?
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {PERIOD_OPTIONS.map((period) => {
                    const hasSlots = filteredTimeSlots.some((slot) => getTimePeriod(slot) === period);
                    return (
                      <button
                        key={period}
                        type="button"
                        disabled={!hasSlots || isClosed}
                        onClick={() => {
                          setSelectedPeriod(period);
                          setSelectedCourts([]);
                        }}
                        className={`rounded-2xl px-4 py-4 text-left text-[13px] transition-all active:scale-[0.98] disabled:opacity-30 ${
                          selectedPeriod === period ? "bg-[#32ef87] text-neutral-950" : "bg-neutral-100 text-neutral-500"
                        }`}
                        style={{ fontFamily: FONT_MONO }}
                      >
                        {formatPeriodLabel(period)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {isClosed && (
                <p className="mt-8 text-[13px] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
                  stängt denna dag
                </p>
              )}

              {!isClosed && (
                <>
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
                        className={`rounded-2xl px-5 py-3 text-[11px] transition-all active:scale-[0.98] ${
                          selectedDuration === duration ? "bg-neutral-950 text-white" : "bg-neutral-100 text-neutral-500"
                        }`}
                        style={{ fontFamily: FONT_MONO }}
                      >
                        {duration} min
                      </button>
                    ))}
                  </div>

                  <div className="mt-9">
                    <p className="mb-4 text-[14px] text-neutral-700" style={{ fontFamily: FONT_MONO }}>
                      Första lediga tid och {sportCourtLabel}:
                    </p>

                    <div className="space-y-5">
                      <div className="grid grid-cols-[1fr_auto] items-center gap-4">
                        <p className="text-[25px] leading-none text-neutral-950" style={{ fontFamily: FONT_MONO }}>
                          {selectedTime && selectedEndTime
                            ? `${selectedTime.replace(":", ".")} – ${selectedEndTime.replace(":", ".")}`
                            : "Ingen tid"}
                        </p>
                        <button
                          type="button"
                          onClick={() => setShowTimeList(true)}
                          className="rounded-full bg-neutral-950 px-6 py-2.5 text-[11px] text-white disabled:opacity-35"
                          disabled={filteredTimeSlots.length === 0}
                          style={{ fontFamily: FONT_MONO }}
                        >
                          Ändra
                        </button>
                      </div>

                      <div className="grid grid-cols-[1fr_auto] items-center gap-4">
                        <p className="truncate text-[25px] leading-none text-neutral-950" style={{ fontFamily: FONT_MONO }}>
                          {selectedCourtSummary}
                        </p>
                        <button
                          type="button"
                          onClick={() => setShowCourtList(true)}
                          className="rounded-full bg-neutral-950 px-6 py-2.5 text-[11px] text-white disabled:opacity-35"
                          disabled={availableSportCourts.length === 0}
                          style={{ fontFamily: FONT_MONO }}
                        >
                          Ändra
                        </button>
                      </div>
                    </div>
                  </div>

                  {showContactSummary && (
                    <button
                      type="button"
                      onClick={() => setEditingContact(true)}
                      className="mt-6 w-full text-left text-[10px] text-neutral-400"
                      style={{ fontFamily: FONT_MONO }}
                    >
                      bokas som {bookingName} · ändra
                    </button>
                  )}

                  {showProfileLoading && (
                    <div
                      className="mt-7 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-4 text-[11px] text-neutral-400"
                      style={{ fontFamily: FONT_MONO }}
                    >
                      hämtar dina uppgifter...
                    </div>
                  )}

                  {showAuthPrompt && (
                    <div className="mt-7 rounded-[24px] border border-neutral-200 bg-neutral-50 p-4">
                      <p className="text-[12px] font-bold uppercase tracking-widest text-neutral-400" style={{ fontFamily: FONT_MONO }}>
                        konto
                      </p>
                      <p className="mt-2 text-[13px] leading-relaxed text-neutral-600" style={{ fontFamily: FONT_MONO }}>
                        Logga in eller skapa konto för att boka. Då sparas bokningen, kvittot och telefonnumret rätt.
                      </p>
                      <button
                        type="button"
                        onClick={goToAuth}
                        className="mt-4 w-full rounded-2xl bg-neutral-950 px-4 py-3 text-[13px] text-white"
                        style={{ fontFamily: FONT_MONO }}
                      >
                        Logga in / skapa konto
                      </button>
                    </div>
                  )}

                  {showContactFields && (
                    <div className="mt-7 rounded-[24px] border border-neutral-200 bg-neutral-50 p-4">
                      <h2
                        className="mb-3 text-[10px] font-bold uppercase tracking-widest text-neutral-400"
                        style={{ fontFamily: FONT_MONO }}
                      >
                        {user ? "komplettera profil" : "dina uppgifter"}
                      </h2>
                      <div className="grid gap-2">
                        <input
                          placeholder="ditt namn"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          required
                          maxLength={100}
                          className="min-w-0 rounded-xl border border-neutral-200 bg-white px-3 py-3 text-[16px] text-[#111] placeholder:text-black/25 transition-colors focus:border-black/40 focus:outline-none"
                          style={{ fontFamily: FONT_MONO }}
                        />
                        <input
                          type="tel"
                          inputMode="tel"
                          placeholder="telefon"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value.replace(/[^\d+\s-]/g, ""))}
                          required={needsPhoneForDirectBooking}
                          maxLength={20}
                          className="min-w-0 rounded-xl border border-neutral-200 bg-white px-3 py-3 text-[16px] text-[#111] placeholder:text-black/25 transition-colors focus:border-black/40 focus:outline-none"
                          style={{ fontFamily: FONT_MONO }}
                        />
                        {needsPhoneForDirectBooking && bookingPhone && !phoneIsReady && (
                          <p className="px-1 text-[10px] text-red-500" style={{ fontFamily: FONT_MONO }}>
                            skriv hela telefonnumret
                          </p>
                        )}
                        <input
                          type="email"
                          placeholder="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          required={needsEmailForBooking}
                          maxLength={200}
                          className="min-w-0 rounded-xl border border-neutral-200 bg-white px-3 py-3 text-[16px] text-[#111] placeholder:text-black/25 transition-colors focus:border-black/40 focus:outline-none"
                          style={{ fontFamily: FONT_MONO }}
                        />
                        {needsEmailForBooking && bookingEmail && !emailIsReady && (
                          <p className="px-1 text-[10px] text-red-500" style={{ fontFamily: FONT_MONO }}>
                            skriv en giltig email
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => saveContactMutation.mutate()}
                        disabled={!contactFormIsReady || saveContactMutation.isPending}
                        className="mt-4 w-full rounded-2xl bg-neutral-950 px-4 py-3 text-[13px] text-white transition-transform active:scale-[0.98] disabled:opacity-35"
                        style={{ fontFamily: FONT_MONO }}
                      >
                        {saveContactMutation.isPending ? (
                          <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                        ) : (
                          "Spara telefonnummer"
                        )}
                      </button>
                      <p className="mt-3 text-[10px] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
                        spara först, sedan kan du boka och numret finns kvar på din profil
                      </p>
                    </div>
                  )}

                  {!useCorporate && hasFullyIncludedCourtHours ? (
                    <p className="mt-5 text-right text-[11px] text-emerald-600" style={{ fontFamily: FONT_MONO }}>
                      Ingår i {membershipTierName} · {remainingIncludedCourtHours}h fria timmar kvar
                    </p>
                  ) : !useCorporate && hasPartiallyIncludedCourtHours ? (
                    <p className="mt-5 text-right text-[11px] text-emerald-600" style={{ fontFamily: FONT_MONO }}>
                      {includedCourtHoursApplied}h ingår · {paidCourtHours}h medlemspris · ord. {baseTotalPrice} kr
                    </p>
                  ) : (
                    !useCorporate &&
                    hasMemberCourtPrice && (
                      <p className="mt-5 text-right text-[11px] text-emerald-600" style={{ fontFamily: FONT_MONO }}>
                        medlemspris · ord. {baseTotalPrice} kr
                      </p>
                    )
                  )}

                  <button
                    type="submit"
                    disabled={!canSubmitBooking || bookMutation.isPending}
                    className="mt-7 w-full rounded-[24px] bg-neutral-950 px-6 py-4 text-[20px] text-white transition-transform active:scale-[0.98] disabled:opacity-35"
                    style={{ fontFamily: FONT_MONO }}
                  >
                    {bookMutation.isPending ? (
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    ) : (
                      bookingButtonLabel
                    )}
                  </button>
                </>
              )}
            </div>
          </section>

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
                  {hasFullyIncludedCourtHours
                    ? `betala med fri timme · ${remainingIncludedCourtHours}h kvar`
                    : hasPartiallyIncludedCourtHours
                      ? `betala i kassan · ${includedCourtHoursApplied}h ingår · ${totalPrice} kr`
                      : `betala i kassan · ${hasMemberCourtPrice ? `${totalPrice} kr` : `${baseTotalPrice} kr`}`}
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

        </form>
      )}

      <Drawer open={showDatePicker} onOpenChange={setShowDatePicker}>
        <DrawerContent className="rounded-t-[28px] border-0 bg-[#f7f4ee] px-4 pb-[calc(env(safe-area-inset-bottom,0px)+18px)]">
          <DrawerHeader className="px-1 pb-3 pt-4 text-left">
            <DrawerTitle className="text-[22px] font-black text-neutral-950" style={{ fontFamily: FONT_GROTESK }}>
              Välj datum
            </DrawerTitle>
            <p className="text-[12px] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
              Vi hämtar 7 dagar från valt datum.
            </p>
          </DrawerHeader>

          <div className="grid gap-3 pb-2">
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Nästa vecka", date: nextWeekDate },
                { label: "Om 2 veckor", date: twoWeeksDate },
                { label: "Nästa helg", date: nextWeekendDate },
              ].map((option) => (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => selectDateRange(option.date)}
                  className="rounded-2xl bg-white px-3 py-4 text-left shadow-sm active:scale-[0.98]"
                  style={{ fontFamily: FONT_MONO }}
                >
                  <p className="text-[11px] font-bold text-neutral-950">{option.label}</p>
                  <p className="mt-1 text-[18px] leading-none text-neutral-950">
                    {format(option.date, "d/M")}
                  </p>
                </button>
              ))}
            </div>

            <label className="mt-2 grid gap-2 text-[11px] font-bold uppercase tracking-widest text-neutral-400" style={{ fontFamily: FONT_MONO }}>
              Exakt datum
              <input
                type="date"
                min={todayStr}
                value={dateStr}
                onChange={(event) => {
                  const value = event.target.value;
                  if (!value) return;
                  selectDateRange(DateTime.fromISO(value, { zone: "Europe/Stockholm" }).toJSDate());
                }}
                className="h-14 rounded-2xl border border-neutral-200 bg-white px-4 text-[16px] text-neutral-950 outline-none focus:border-neutral-950"
                style={{ fontFamily: FONT_MONO }}
              />
            </label>
          </div>
        </DrawerContent>
      </Drawer>

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
              Välj {sportCourtPluralLabel}
            </DrawerTitle>
            <p className="text-[12px] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
              {availableSportCourts.length} lediga · {selectedCourts.length} valda · {selectedTime}-{selectedEndTime}
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
                      setSelectedCourts((current) => {
                        if (current.includes(court.id)) {
                          return current.length === 1 ? current : current.filter((id) => id !== court.id);
                        }
                        return [...current, court.id];
                      });
                    }}
                    className={`rounded-2xl border px-4 py-3 text-left transition-all active:scale-[0.99] ${
                      selected
                        ? "border-neutral-950 bg-neutral-950 text-[#fffaf0]"
                        : "border-neutral-200 bg-white text-neutral-950"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border ${
                          selected ? "border-[#32ef87] bg-[#32ef87] text-neutral-950" : "border-neutral-200 bg-white text-transparent"
                        }`}>
                          <Check className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0">
                        <p className="text-[15px] font-bold" style={{ fontFamily: FONT_GROTESK }}>{court.name}</p>
                        <p className={`mt-0.5 text-[11px] ${selected ? "text-white/55" : "text-neutral-400"}`} style={{ fontFamily: FONT_MONO }}>
                          {selectedTime}-{selectedEndTime} · {selectedDuration} min
                        </p>
                        </div>
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
              <button
                type="button"
                onClick={() => setShowCourtList(false)}
                className="sticky bottom-0 mt-3 w-full rounded-2xl bg-neutral-950 px-5 py-4 text-[13px] font-bold uppercase tracking-wider text-white shadow-[0_-12px_30px_rgba(247,244,238,0.95)] disabled:opacity-35"
                disabled={selectedCourts.length === 0}
                style={{ fontFamily: FONT_MONO }}
              >
                Klar · {selectedCourts.length} {selectedCourts.length === 1 ? sportCourtLabel : sportCourtPluralLabel}
              </button>
            </div>
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
}
