import { motion, AnimatePresence } from "framer-motion";
import { Zap, AlertTriangle, ChevronRight, ShoppingBag, Timer, Gift, Crown, CalendarDays } from "lucide-react";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useVenueForStaff, useVenueCourts } from "@/hooks/useDesk";
import { apiGet, apiPost } from "@/lib/api";
import { toast } from "sonner";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { sv } from "date-fns/locale";

const dayNames = ["Sön", "Mån", "Tis", "Ons", "Tor", "Fre", "Lör"];
const monthNames = ["Jan", "Feb", "Mar", "Apr", "Maj", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"];
const ALL_TIME_SLOTS = ["07:00", "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00", "22:00"];
const timeSlots = ["Nu", "07:00", "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"];

const upsells = [
  { title: "Förläng till 90 min", sub: "+120 kr — 68% accepterar", icon: Timer, tag: "Populär" },
  { title: "Dryckespaket", sub: "+89 kr — 2 drycker + snack", icon: ShoppingBag, tag: "Bästsäljare" },
  { title: "First-timer pass", sub: "990 kr/mån — visa besparingar", icon: Gift, tag: "Konvertera" },
  { title: "VIP Upgrade", sub: "Bana 5 — premium upplevelse", icon: Crown, tag: "Premium" },
];

function generateQuickDates() {
  const dates: Date[] = [];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    dates.push(d);
  }
  return dates;
}

interface PricingRule {
  id: string;
  name: string;
  type: string;
  price: number;
  days_of_week: number[] | null;
  time_from: string | null;
  time_to: string | null;
  is_active: boolean | null;
}

const BookScreen = () => {
  const { user } = useAuth();
  const { data: staffVenue } = useVenueForStaff();
  const venueId = staffVenue?.venue_id;
  const { data: venueCourts } = useVenueCourts(venueId);
  const queryClient = useQueryClient();

  const [step, setStep] = useState(0);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedTime, setSelectedTime] = useState("Nu");
  const [selectedDuration, setSelectedDuration] = useState("60 min");
  const [selectedCourt, setSelectedCourt] = useState<string | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);
  const [selectedCustomerAuthId, setSelectedCustomerAuthId] = useState<string | null>(null);
  const [addedUpsells, setAddedUpsells] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);

  const quickDates = generateQuickDates();
  const isToday = selectedDate.toDateString() === new Date().toDateString();

  // Fetch opening hours
  const { data: openingHours } = useQuery({
    queryKey: ["opening-hours", venueId],
    enabled: !!venueId,
    queryFn: () => apiGet("api-bookings", "hours", { venueId: venueId! }),
  });

  // Filter time slots based on opening hours for selected day
  const timeSlots = useMemo(() => {
    const dayOfWeek = selectedDate.getDay();
    const hours = (openingHours || []).find((h: any) => h.day_of_week === dayOfWeek);
    if (!hours || hours.is_closed) return [];

    const openTime = hours.open_time?.slice(0, 5) || "00:00";
    const closeTime = hours.close_time?.slice(0, 5) || "23:59";

    const filtered = ALL_TIME_SLOTS.filter((t) => t >= openTime && t < closeTime);
    return isToday ? ["Nu", ...filtered] : filtered;
  }, [selectedDate, openingHours, isToday]);

  // Fetch pricing rules
  const { data: pricingRules } = useQuery<PricingRule[]>({
    queryKey: ["pricing-rules", venueId],
    enabled: !!venueId,
    queryFn: () => apiGet("api-bookings", "pricing", { venueId: venueId! }),
  });

  // Get price for a given time based on pricing rules
  const getPrice = (time: string): number => {
    if (!pricingRules?.length) return 350; // fallback
    const t = time === "Nu" ? `${new Date().getHours().toString().padStart(2, "0")}:00` : time;
    const dayOfWeek = selectedDate.getDay();

    const matchingRule = pricingRules.find((r) => {
      if (!r.is_active || r.type !== "hourly") return false;
      const daysMatch = !r.days_of_week?.length || r.days_of_week.includes(dayOfWeek);
      const timeMatch = (!r.time_from || t >= r.time_from) && (!r.time_to || t < r.time_to);
      return daysMatch && timeMatch;
    });

    return matchingRule?.price ?? 350;
  };

  // Fetch membership for selected customer
  const { data: customerMembership } = useQuery({
    queryKey: ["customer-membership", selectedCustomerAuthId, venueId],
    enabled: !!selectedCustomerAuthId && !!venueId,
    queryFn: () => apiGet("api-memberships", "user", { userId: selectedCustomerAuthId!, venueId: venueId! }),
  });

  const membershipDiscount = customerMembership?.membership_tiers?.discount_percent || 0;

  const currentPrice = getPrice(selectedTime);
  const isPeak = currentPrice > 300; // Dynamic peak detection based on price

  // Fetch recent customers
  const { data: recentProfiles } = useQuery({
    queryKey: ["recent-customers"],
    queryFn: () => apiGet("api-customers", "recent", { limit: "10" }),
  });

  // Fetch existing bookings for the selected date
  const { data: dateBookings } = useQuery({
    queryKey: ["date-bookings", venueId, selectedDate.toDateString(), selectedTime],
    enabled: !!venueId,
    queryFn: () => apiGet("api-bookings", "venue", {
      venueId: venueId!,
      date: selectedDate.toISOString().split("T")[0],
    }),
  });

  // Calculate court availability
  const courtsWithAvailability = useMemo(() => {
    if (!venueCourts) return [];
    const bookingTime = (() => {
      if (selectedTime === "Nu") return new Date();
      const [h, m] = selectedTime.split(":").map(Number);
      const d = new Date(selectedDate);
      d.setHours(h, m, 0, 0);
      return d;
    })();
    const durationMs = selectedDuration === "30 min" ? 30 * 60000 : selectedDuration === "90 min" ? 90 * 60000 : 60 * 60000;
    const endTime = new Date(bookingTime.getTime() + durationMs);

    return venueCourts.map((court: any) => {
      const isBooked = (dateBookings || []).some((b: any) => {
        if (b.venue_court_id !== court.id) return false;
        const bs = new Date(b.start_time).getTime();
        const be = new Date(b.end_time).getTime();
        return bookingTime.getTime() < be && endTime.getTime() > bs;
      });
      return { ...court, available: !isBooked };
    });
  }, [venueCourts, dateBookings, selectedDate, selectedTime, selectedDuration]);

  const selectedCourtData = courtsWithAvailability.find((c: any) => c.id === selectedCourt);

  const durationMultiplier = selectedDuration === "30 min" ? 0.5 : selectedDuration === "90 min" ? 1.5 : 1;
  const baseTotal = Math.round(currentPrice * durationMultiplier);
  const discountAmount = membershipDiscount > 0 ? Math.round(baseTotal * membershipDiscount / 100) : 0;
  const totalPrice = baseTotal - discountAmount;

  const createBooking = useMutation({
    mutationFn: async () => {
      if (!venueId || !selectedCourt || !user) throw new Error("Missing data");

      const bookingTime = (() => {
        if (selectedTime === "Nu") return new Date();
        const [h, m] = selectedTime.split(":").map(Number);
        const d = new Date(selectedDate);
        d.setHours(h, m, 0, 0);
        return d;
      })();
      const durationMs = selectedDuration === "30 min" ? 30 * 60000 : selectedDuration === "90 min" ? 90 * 60000 : 60 * 60000;
      const endTime = new Date(bookingTime.getTime() + durationMs);

      await apiPost("api-bookings", "create", {
        venueId,
        venueCourtId: selectedCourt,
        startTime: bookingTime.toISOString(),
        endTime: endTime.toISOString(),
        totalPrice,
        bookedBy: selectedCustomer || "Walk-in",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["today-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["today-revenue"] });
      queryClient.invalidateQueries({ queryKey: ["date-bookings"] });
      setConfirmed(true);
      setTimeout(() => {
        setConfirmed(false);
        setStep(0);
        setSelectedCourt(null);
        setSelectedCustomer(null);
        setSelectedCustomerAuthId(null);
        setAddedUpsells([]);
      }, 2000);
    },
    onError: (err) => {
      toast.error("Bokning misslyckades: " + (err as Error).message);
    },
  });

  const toggleUpsell = (title: string) => {
    setAddedUpsells((prev) => (prev.includes(title) ? prev.filter((u) => u !== title) : [...prev, title]));
  };

  if (confirmed) {
    return (
      <div className="pb-24 px-4 pt-2 flex flex-col items-center justify-center min-h-[60vh]">
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 20 }} className="w-20 h-20 rounded-full bg-court-free flex items-center justify-center mb-4">
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="text-white text-3xl">✓</motion.span>
        </motion.div>
        <motion.h2 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="text-2xl font-display font-bold">Bokad!</motion.h2>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="text-sm text-muted-foreground mt-1">{selectedCourtData?.name} · {selectedTime} · {selectedDuration}</motion.p>
      </div>
    );
  }

  return (
    <div className="pb-24 px-4 pt-2 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold tracking-tight">Book</h1>
        <div className="flex items-center gap-1.5 bg-primary/10 rounded-full px-3 py-1">
          <Zap className="w-3 h-3 text-primary" />
          <span className="text-[10px] font-bold text-primary uppercase tracking-wider">Quick Book</span>
        </div>
      </div>

      {/* Progress */}
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((s) => (
          <div key={s} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${s <= step ? "bg-primary" : "bg-border"}`} />
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* Step 1: Time */}
        {step === 0 && (
          <motion.div key="s0" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Datum</h2>
                <Popover open={showCalendar} onOpenChange={setShowCalendar}>
                  <PopoverTrigger asChild>
                    <motion.button whileTap={{ scale: 0.9 }} className="flex items-center gap-1 text-primary text-xs font-semibold">
                      <CalendarDays className="w-3.5 h-3.5" />
                      <span>Fler datum</span>
                    </motion.button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={(date) => {
                        if (date) {
                          setSelectedDate(date);
                          setShowCalendar(false);
                        }
                      }}
                      disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory" style={{ scrollbarWidth: "none" }}>
                {quickDates.map((date, i) => {
                  const isSelected = date.toDateString() === selectedDate.toDateString();
                  const isTodayDate = date.toDateString() === new Date().toDateString();
                  return (
                    <motion.button key={i} whileTap={{ scale: 0.9 }} onClick={() => setSelectedDate(date)} className={`flex-shrink-0 snap-center w-[56px] py-2.5 rounded-2xl flex flex-col items-center gap-0.5 transition-all ${isSelected ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25" : "text-secondary-foreground"}`} style={!isSelected ? { background: "hsl(var(--surface-1))" } : undefined}>
                      <span className={`text-[9px] font-bold uppercase ${isSelected ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{isTodayDate ? "Idag" : dayNames[date.getDay()]}</span>
                      <span className="text-xl font-display font-bold">{date.getDate()}</span>
                      <span className={`text-[8px] font-medium ${isSelected ? "text-primary-foreground/60" : "text-muted-foreground"}`}>{monthNames[date.getMonth()]}</span>
                    </motion.button>
                  );
                })}
                {/* Show selected date if it's beyond quick dates */}
                {!quickDates.some(d => d.toDateString() === selectedDate.toDateString()) && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex-shrink-0 snap-center w-[56px] py-2.5 rounded-2xl flex flex-col items-center gap-0.5 bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                  >
                    <span className="text-[9px] font-bold uppercase text-primary-foreground/70">{dayNames[selectedDate.getDay()]}</span>
                    <span className="text-xl font-display font-bold">{selectedDate.getDate()}</span>
                    <span className="text-[8px] font-medium text-primary-foreground/60">{monthNames[selectedDate.getMonth()]}</span>
                  </motion.button>
                )}
              </div>
            </div>
            <div>
              <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Tid</h2>
              <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
                {(isToday ? timeSlots : timeSlots.filter((t) => t !== "Nu")).map((time) => {
                  const timePrice = getPrice(time);
                  const isTimePeak = timePrice > 300;
                  return (
                    <motion.button key={time} whileTap={{ scale: 0.92 }} onClick={() => setSelectedTime(time)} className={`flex-shrink-0 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-colors relative ${selectedTime === time ? "bg-primary text-primary-foreground" : "text-secondary-foreground"}`} style={selectedTime !== time ? { background: "hsl(var(--surface-1))" } : undefined}>
                      {time}
                      {isTimePeak && <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-court-active flex items-center justify-center text-[7px] text-white font-bold">⚡</span>}
                    </motion.button>
                  );
                })}
              </div>
            </div>
            <div>
              <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Längd</h2>
              <div className="flex gap-2">
                {["30 min", "60 min", "90 min"].map((dur) => (
                  <motion.button key={dur} whileTap={{ scale: 0.92 }} onClick={() => setSelectedDuration(dur)} className={`flex-1 py-3 rounded-xl text-sm font-semibold ${selectedDuration === dur ? "bg-primary text-primary-foreground" : "text-secondary-foreground"}`} style={selectedDuration !== dur ? { background: "hsl(var(--surface-1))" } : undefined}>
                    {dur}
                  </motion.button>
                ))}
              </div>
            </div>
            {/* Price preview */}
            <div className="flex items-center justify-between px-1">
              <span className="text-xs text-muted-foreground">Pris per timme</span>
              <span className="text-sm font-display font-bold text-primary">{currentPrice} kr/h</span>
            </div>
            <motion.button whileTap={{ scale: 0.96 }} onClick={() => setStep(1)} className="w-full bg-primary text-primary-foreground rounded-2xl py-4 font-semibold text-sm">Välj bana →</motion.button>
          </motion.div>
        )}

        {/* Step 2: Courts */}
        {step === 1 && (
          <motion.div key="s1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
            <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Välj bana</h2>
            {courtsWithAvailability.length > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {courtsWithAvailability.map((court: any) => (
                  <motion.button key={court.id} whileTap={court.available ? { scale: 0.92 } : undefined} onClick={() => court.available && setSelectedCourt(court.id)} disabled={!court.available} className={`court-cell min-h-[80px] relative ${!court.available ? "opacity-25 bg-muted border border-border cursor-not-allowed" : selectedCourt === court.id ? "bg-primary/15 border-2 border-primary text-primary" : "court-free"}`}>
                    <span className="text-[10px] font-bold">{court.name}</span>
                    <span className="text-base font-display font-bold">{totalPrice} kr</span>
                    {isPeak && court.available && <span className="text-[9px] text-court-active font-bold">Peak ⚡</span>}
                  </motion.button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">Inga banor konfigurerade</p>
            )}
            <div className="flex gap-2">
              <button onClick={() => setStep(0)} className="text-sm text-primary font-medium tap-target">← Tillbaka</button>
              <motion.button whileTap={{ scale: 0.96 }} onClick={() => selectedCourt && setStep(2)} disabled={!selectedCourt} className="flex-1 bg-primary text-primary-foreground rounded-2xl py-4 font-semibold text-sm disabled:opacity-40">Välj kund →</motion.button>
            </div>
          </motion.div>
        )}

        {/* Step 3: Customer */}
        {step === 2 && (
          <motion.div key="s2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
            <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Kund</h2>
            <div className="space-y-1.5">
              <motion.button whileTap={{ scale: 0.97 }} onClick={() => { setSelectedCustomer("Walk-in Gäst"); setSelectedCustomerAuthId(null); setStep(3); }} className="w-full glass-card rounded-2xl p-3.5 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center text-sm font-display font-bold">+</div>
                <div className="flex-1 text-left"><span className="text-sm font-semibold">Walk-in Gäst</span></div>
                <span className="status-chip bg-accent text-accent-foreground text-[9px]">Ny</span>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </motion.button>
              {(recentProfiles || []).map((p: any, i: number) => {
                const initials = (p.display_name || "?").split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
                return (
                  <motion.button key={p.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} whileTap={{ scale: 0.97 }} onClick={() => { setSelectedCustomer(p.display_name || "Gäst"); setSelectedCustomerAuthId(p.auth_user_id || null); setStep(3); }} className="w-full glass-card rounded-2xl p-3.5 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center text-sm font-display font-bold">{initials}</div>
                    <div className="flex-1 text-left"><span className="text-sm font-semibold">{p.display_name || "Unnamed"}</span></div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </motion.button>
                );
              })}
            </div>
            <button onClick={() => setStep(1)} className="text-sm text-primary font-medium tap-target">← Tillbaka</button>
          </motion.div>
        )}

        {/* Step 4: Confirm */}
        {step === 3 && (
          <motion.div key="s3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
            <div className="glass-card rounded-2xl p-4 space-y-3">
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Datum</span><span className="font-semibold">{isToday ? "Idag" : format(selectedDate, "EEE d MMM", { locale: sv })}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Tid</span><span className="font-semibold">{selectedTime} · {selectedDuration}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Bana</span><span className="font-semibold">{selectedCourtData?.name}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Kund</span><span className="font-semibold">{selectedCustomer}</span></div>
              {membershipDiscount > 0 && customerMembership?.membership_tiers && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Crown className="w-3 h-3" style={{ color: customerMembership.membership_tiers.color }} />
                    {customerMembership.membership_tiers.name}
                  </span>
                  <span className="font-semibold text-court-free">−{discountAmount} kr ({membershipDiscount}%)</span>
                </div>
              )}
              <div className="border-t border-border pt-3 flex justify-between items-center">
                <span className="text-sm font-semibold">Total</span>
                <div className="flex items-center gap-2">
                  {discountAmount > 0 && <span className="text-sm text-muted-foreground line-through">{baseTotal} kr</span>}
                  <span className="text-xl font-display font-bold text-primary">{totalPrice} kr</span>
                </div>
              </div>
              {isPeak && (
                <div className="flex items-center gap-2 bg-court-active/10 rounded-xl p-2.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-court-active" />
                  <span className="text-xs text-court-active font-medium">Peak-tid · {currentPrice} kr/h</span>
                </div>
              )}
            </div>

            <div>
              <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Lägg till</h2>
              <div className="space-y-1.5">
                {upsells.map((up, i) => {
                  const added = addedUpsells.includes(up.title);
                  return (
                    <motion.button key={up.title} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} whileTap={{ scale: 0.97 }} onClick={() => toggleUpsell(up.title)} className={`w-full rounded-2xl p-3.5 flex items-center gap-3 text-left transition-all ${added ? "bg-primary/10 border border-primary/30" : "sell-block"}`}>
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${added ? "bg-primary text-primary-foreground" : "bg-sell/15 text-sell"}`}>
                        <up.icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold">{up.title}</p>
                        <p className="text-[11px] text-muted-foreground">{up.sub}</p>
                      </div>
                      <span className={`text-[9px] px-2 py-1 rounded-full font-bold ${added ? "bg-primary text-primary-foreground" : "bg-sell/15 text-sell"}`}>{added ? "✓" : up.tag}</span>
                    </motion.button>
                  );
                })}
              </div>
            </div>

            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={() => createBooking.mutate()}
              disabled={createBooking.isPending}
              className="w-full bg-primary text-primary-foreground rounded-2xl py-4 font-semibold text-sm animate-glow disabled:opacity-50"
            >
              {createBooking.isPending ? "Bokar..." : "Bekräfta & Debitera"}
            </motion.button>
            <button onClick={() => setStep(2)} className="text-sm text-primary font-medium tap-target">← Tillbaka</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default BookScreen;
