import { motion, AnimatePresence } from "framer-motion";
import { Clock, Users, ChevronRight, ChevronLeft, Zap, AlertTriangle, CalendarDays } from "lucide-react";
import { useState, useRef, useEffect } from "react";

// Generate next 14 days for horizontal date picker
function generateDates() {
  const dates: Date[] = [];
  const today = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    dates.push(d);
  }
  return dates;
}

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const timeSlots = ["Now", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00"];
const durations = ["30 min", "60 min", "90 min"];

const courts = [
  { id: 1, name: "Court 1", available: true, price: 40 },
  { id: 2, name: "Court 2", available: false, price: 40 },
  { id: 3, name: "Court 3", available: false, price: 40 },
  { id: 4, name: "Court 4", available: true, price: 40, recommended: true },
  { id: 5, name: "Court 5", available: false, price: 60, vip: true },
  { id: 6, name: "Court 6", available: true, price: 40 },
];

const recentCustomers = [
  { name: "Walk-in Guest", new: true },
  { name: "Sarah Mitchell", avatar: "SM" },
  { name: "Jake Thompson", avatar: "JT" },
  { name: "Emma Wilson", avatar: "EW" },
];

const BookScreen = () => {
  const [step, setStep] = useState(0);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedTime, setSelectedTime] = useState("Now");
  const [selectedDuration, setSelectedDuration] = useState("60 min");
  const [selectedCourt, setSelectedCourt] = useState<number | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const dateScrollRef = useRef<HTMLDivElement>(null);
  const dates = generateDates();

  const selectedCourtData = courts.find(c => c.id === selectedCourt);
  const isPeak = selectedTime === "17:00" || selectedTime === "18:00" || selectedTime === "19:00";
  const isToday = selectedDate.toDateString() === new Date().toDateString();

  const handleConfirm = () => {
    setConfirmed(true);
    setTimeout(() => {
      setConfirmed(false);
      setStep(0);
      setSelectedCourt(null);
      setSelectedCustomer(null);
    }, 2000);
  };

  if (confirmed) {
    return (
      <div className="pb-24 px-4 pt-2 flex flex-col items-center justify-center min-h-[60vh]">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          className="w-24 h-24 rounded-full bg-court-free flex items-center justify-center mb-5"
        >
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-white text-4xl"
          >
            ✓
          </motion.span>
        </motion.div>
        <motion.h2
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="text-2xl font-display font-bold"
        >
          Booked!
        </motion.h2>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="text-sm text-muted-foreground mt-1"
        >
          {selectedCourtData?.name} · {selectedTime} · {selectedDuration}
        </motion.p>
      </div>
    );
  }

  return (
    <div className="pb-24 px-4 pt-2 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold tracking-tight">Book</h1>
        <div className="flex items-center gap-1.5 bg-accent rounded-full px-3 py-1">
          <Zap className="w-3 h-3 text-primary" />
          <span className="text-xs font-semibold text-primary">Quick Book</span>
        </div>
      </div>

      {/* Progress */}
      <div className="flex gap-1.5">
        {[0, 1, 2].map(s => (
          <div key={s} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${s <= step ? 'bg-primary' : 'bg-border'}`} />
        ))}
      </div>

      <AnimatePresence mode="wait">
        {step === 0 && (
          <motion.div key="step0" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
            
            {/* Horizontal Date Picker — Apple style */}
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Date</h2>
              <div 
                ref={dateScrollRef}
                className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' }}
              >
                {dates.map((date, i) => {
                  const isSelected = date.toDateString() === selectedDate.toDateString();
                  const isTodayDate = date.toDateString() === new Date().toDateString();
                  return (
                    <motion.button
                      key={i}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => setSelectedDate(date)}
                      className={`flex-shrink-0 snap-center w-[60px] py-3 rounded-2xl flex flex-col items-center gap-0.5 transition-all duration-200 ${
                        isSelected
                          ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/25 scale-105'
                          : 'bg-secondary text-secondary-foreground'
                      }`}
                    >
                      <span className={`text-[10px] font-medium uppercase ${isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                        {isTodayDate ? "Today" : dayNames[date.getDay()]}
                      </span>
                      <span className="text-xl font-display font-bold">{date.getDate()}</span>
                      <span className={`text-[9px] font-medium ${isSelected ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
                        {monthNames[date.getMonth()]}
                      </span>
                    </motion.button>
                  );
                })}
              </div>
            </div>

            {/* Time — horizontal scroll */}
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Time</h2>
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
                {(isToday ? timeSlots : timeSlots.filter(t => t !== "Now")).map(time => (
                  <motion.button
                    key={time}
                    whileTap={{ scale: 0.92 }}
                    onClick={() => setSelectedTime(time)}
                    className={`flex-shrink-0 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                      selectedTime === time ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
                    }`}
                  >
                    {time}
                    {isPeak && (time === "17:00" || time === "18:00" || time === "19:00") && <span className="ml-1 text-[10px]">⚡</span>}
                  </motion.button>
                ))}
              </div>
            </div>

            {/* Duration */}
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Duration</h2>
              <div className="flex gap-2">
                {durations.map(dur => (
                  <motion.button
                    key={dur}
                    whileTap={{ scale: 0.92 }}
                    onClick={() => setSelectedDuration(dur)}
                    className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-colors ${
                      selectedDuration === dur ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
                    }`}
                  >
                    {dur}
                  </motion.button>
                ))}
              </div>
            </div>

            {/* Court */}
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Court</h2>
              <div className="grid grid-cols-3 gap-2.5">
                {courts.map(court => (
                  <motion.button
                    key={court.id}
                    whileTap={court.available ? { scale: 0.92 } : undefined}
                    onClick={() => court.available && setSelectedCourt(court.id)}
                    disabled={!court.available}
                    className={`court-cell relative ${
                      !court.available
                        ? 'opacity-30 bg-muted border border-border cursor-not-allowed'
                        : selectedCourt === court.id
                        ? 'bg-primary/15 border-2 border-primary text-primary'
                        : 'court-free'
                    }`}
                  >
                    {court.recommended && court.available && (
                      <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-primary text-primary-foreground rounded-full text-[9px] flex items-center justify-center font-bold">★</span>
                    )}
                    <span className="text-[11px] font-semibold">{court.name}</span>
                    <span className="text-xs font-bold">${court.price}</span>
                    {isPeak && court.available && <span className="text-[9px] text-badge-unpaid font-semibold">Peak</span>}
                  </motion.button>
                ))}
              </div>
            </div>

            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={() => selectedCourt && setStep(1)}
              disabled={!selectedCourt}
              className="w-full bg-primary text-primary-foreground rounded-2xl py-4 font-semibold text-sm disabled:opacity-40 transition-opacity"
            >
              Continue
            </motion.button>
          </motion.div>
        )}

        {step === 1 && (
          <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-5">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Customer</h2>
            <div className="space-y-2">
              {recentCustomers.map((c, i) => (
                <motion.button
                  key={c.name}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => { setSelectedCustomer(c.name); setStep(2); }}
                  className={`w-full glass-card rounded-2xl p-3.5 flex items-center gap-3 ${selectedCustomer === c.name ? 'ring-2 ring-primary' : ''}`}
                >
                  <div className="w-10 h-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center text-sm font-display font-bold">
                    {c.new ? "+" : c.avatar}
                  </div>
                  <span className="text-sm font-semibold flex-1 text-left">{c.name}</span>
                  {c.new && <span className="status-chip bg-accent text-accent-foreground text-[10px]">Quick create</span>}
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </motion.button>
              ))}
            </div>
            <button onClick={() => setStep(0)} className="text-sm text-primary font-medium tap-target">← Back</button>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-5">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Confirm</h2>
            
            <div className="glass-card rounded-2xl p-5 space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Date</span>
                <span className="text-sm font-semibold">
                  {isToday ? "Today" : selectedDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Time</span>
                <span className="text-sm font-semibold">{selectedTime} · {selectedDuration}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Court</span>
                <span className="text-sm font-semibold">{selectedCourtData?.name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Customer</span>
                <span className="text-sm font-semibold">{selectedCustomer}</span>
              </div>
              <div className="border-t border-border pt-3 flex justify-between items-center">
                <span className="text-sm font-semibold">Total</span>
                <span className="text-xl font-display font-bold text-primary">
                  ${selectedCourtData ? selectedCourtData.price * (selectedDuration === "30 min" ? 0.5 : selectedDuration === "90 min" ? 1.5 : 1) : 0}
                </span>
              </div>
              {isPeak && (
                <div className="flex items-center gap-2 bg-badge-unpaid/10 rounded-xl p-2.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-badge-unpaid" />
                  <span className="text-xs text-badge-unpaid font-medium">Peak pricing applied</span>
                </div>
              )}
            </div>

            {/* Upsell block in confirm step */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="sell-block rounded-2xl p-4 flex items-center gap-3"
            >
              <span className="text-2xl">🥤</span>
              <div className="flex-1">
                <p className="text-sm font-bold">Add drinks package?</p>
                <p className="text-[11px] text-muted-foreground">2 drinks + snack — $12</p>
              </div>
              <motion.button
                whileTap={{ scale: 0.9 }}
                className="bg-sell text-sell-foreground rounded-xl px-3 py-2 text-xs font-bold"
              >
                Add
              </motion.button>
            </motion.div>

            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={handleConfirm}
              className="w-full bg-primary text-primary-foreground rounded-2xl py-4 font-semibold text-sm animate-glow"
            >
              Confirm & Charge
            </motion.button>
            <button onClick={() => setStep(1)} className="text-sm text-primary font-medium tap-target">← Back</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default BookScreen;
