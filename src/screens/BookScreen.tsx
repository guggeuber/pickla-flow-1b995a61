import { motion, AnimatePresence } from "framer-motion";
import { Zap, AlertTriangle, ChevronRight, ShoppingBag, Timer, Gift, Crown } from "lucide-react";
import { useState, useRef } from "react";

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

const dayNames = ["Sön", "Mån", "Tis", "Ons", "Tor", "Fre", "Lör"];
const monthNames = ["Jan", "Feb", "Mar", "Apr", "Maj", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"];
const timeSlots = ["Nu", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00"];

const courts = [
  { id: 1, name: "Bana 1", available: true, price: 350 },
  { id: 2, name: "Bana 2", available: false, price: 350 },
  { id: 3, name: "Bana 3", available: false, price: 350 },
  { id: 4, name: "Bana 4", available: true, price: 350, recommended: true },
  { id: 5, name: "Bana 5", available: false, price: 500, vip: true },
  { id: 6, name: "Bana 6", available: true, price: 350 },
];

const recentCustomers = [
  { name: "Walk-in Gäst", new: true },
  { name: "Sarah Mitchell", avatar: "SM", credits: "2 500 kr" },
  { name: "Jake Thompson", avatar: "JT" },
  { name: "Emma Wilson", avatar: "EW", credits: "800 kr" },
];

const upsells = [
  { title: "Förläng till 90 min", sub: "+120 kr — 68% accepterar", icon: Timer, tag: "Populär" },
  { title: "Dryckespaket", sub: "+89 kr — 2 drycker + snack", icon: ShoppingBag, tag: "Bästsäljare" },
  { title: "First-timer pass", sub: "990 kr/mån — visa besparingar", icon: Gift, tag: "Konvertera" },
  { title: "VIP Upgrade", sub: "Bana 5 — premium upplevelse", icon: Crown, tag: "Premium" },
];

const BookScreen = () => {
  const [step, setStep] = useState(0);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedTime, setSelectedTime] = useState("Nu");
  const [selectedDuration, setSelectedDuration] = useState("60 min");
  const [selectedCourt, setSelectedCourt] = useState<number | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);
  const [addedUpsells, setAddedUpsells] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const dates = generateDates();

  const selectedCourtData = courts.find(c => c.id === selectedCourt);
  const isPeak = ["17:00", "18:00", "19:00"].includes(selectedTime);
  const isToday = selectedDate.toDateString() === new Date().toDateString();

  const handleConfirm = () => {
    setConfirmed(true);
    setTimeout(() => { setConfirmed(false); setStep(0); setSelectedCourt(null); setSelectedCustomer(null); setAddedUpsells([]); }, 2000);
  };

  const toggleUpsell = (title: string) => {
    setAddedUpsells(prev => prev.includes(title) ? prev.filter(u => u !== title) : [...prev, title]);
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

      {/* Progress — 4 steps */}
      <div className="flex gap-1">
        {[0, 1, 2, 3].map(s => (
          <div key={s} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${s <= step ? 'bg-primary' : 'bg-border'}`} />
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* Step 1: Time */}
        {step === 0 && (
          <motion.div key="s0" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
            {/* Date Scroller */}
            <div>
              <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Datum</h2>
              <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory" style={{ scrollbarWidth: 'none' }}>
                {dates.map((date, i) => {
                  const isSelected = date.toDateString() === selectedDate.toDateString();
                  const isTodayDate = date.toDateString() === new Date().toDateString();
                  return (
                    <motion.button key={i} whileTap={{ scale: 0.9 }} onClick={() => setSelectedDate(date)} className={`flex-shrink-0 snap-center w-[56px] py-2.5 rounded-2xl flex flex-col items-center gap-0.5 transition-all ${isSelected ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/25' : 'text-secondary-foreground'}`} style={!isSelected ? { background: 'hsl(var(--surface-1))' } : undefined}>
                      <span className={`text-[9px] font-bold uppercase ${isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{isTodayDate ? "Idag" : dayNames[date.getDay()]}</span>
                      <span className="text-xl font-display font-bold">{date.getDate()}</span>
                      <span className={`text-[8px] font-medium ${isSelected ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>{monthNames[date.getMonth()]}</span>
                    </motion.button>
                  );
                })}
              </div>
            </div>

            {/* Time Chips */}
            <div>
              <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Tid</h2>
              <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
                {(isToday ? timeSlots : timeSlots.filter(t => t !== "Nu")).map(time => {
                  const isTimePeak = ["17:00", "18:00", "19:00"].includes(time);
                  return (
                    <motion.button key={time} whileTap={{ scale: 0.92 }} onClick={() => setSelectedTime(time)} className={`flex-shrink-0 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-colors relative ${selectedTime === time ? 'bg-primary text-primary-foreground' : 'text-secondary-foreground'}`} style={selectedTime !== time ? { background: 'hsl(var(--surface-1))' } : undefined}>
                      {time}
                      {isTimePeak && <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-court-active flex items-center justify-center text-[7px] text-white font-bold">⚡</span>}
                    </motion.button>
                  );
                })}
              </div>
            </div>

            {/* Duration */}
            <div>
              <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Längd</h2>
              <div className="flex gap-2">
                {["30 min", "60 min", "90 min"].map(dur => (
                  <motion.button key={dur} whileTap={{ scale: 0.92 }} onClick={() => setSelectedDuration(dur)} className={`flex-1 py-3 rounded-xl text-sm font-semibold ${selectedDuration === dur ? 'bg-primary text-primary-foreground' : 'text-secondary-foreground'}`} style={selectedDuration !== dur ? { background: 'hsl(var(--surface-1))' } : undefined}>
                    {dur}
                  </motion.button>
                ))}
              </div>
            </div>

            <motion.button whileTap={{ scale: 0.96 }} onClick={() => setStep(1)} className="w-full bg-primary text-primary-foreground rounded-2xl py-4 font-semibold text-sm">
              Välj bana →
            </motion.button>
          </motion.div>
        )}

        {/* Step 2: Courts */}
        {step === 1 && (
          <motion.div key="s1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
            <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Välj bana</h2>
            <div className="grid grid-cols-3 gap-2">
              {courts.map(court => (
                <motion.button key={court.id} whileTap={court.available ? { scale: 0.92 } : undefined} onClick={() => court.available && setSelectedCourt(court.id)} disabled={!court.available} className={`court-cell min-h-[80px] relative ${!court.available ? 'opacity-25 bg-muted border border-border cursor-not-allowed' : selectedCourt === court.id ? 'bg-primary/15 border-2 border-primary text-primary' : court.vip ? 'court-vip' : 'court-free'}`}>
                  {court.recommended && court.available && <span className="absolute -top-1.5 -right-1.5 px-1.5 py-0.5 bg-sell text-sell-foreground rounded-full text-[8px] font-bold">Bäst</span>}
                  {court.vip && <span className="absolute -top-1.5 -right-1.5 px-1.5 py-0.5 bg-badge-vip text-white rounded-full text-[8px] font-bold">VIP</span>}
                  <span className="text-[10px] font-bold">{court.name}</span>
                  <span className="text-base font-display font-bold">{court.price} kr</span>
                  {isPeak && court.available && <span className="text-[9px] text-court-active font-bold">Peak ⚡</span>}
                </motion.button>
              ))}
            </div>
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
              {recentCustomers.map((c, i) => (
                <motion.button key={c.name} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} whileTap={{ scale: 0.97 }} onClick={() => { setSelectedCustomer(c.name); setStep(3); }} className="w-full glass-card rounded-2xl p-3.5 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center text-sm font-display font-bold">{c.new ? "+" : c.avatar}</div>
                  <div className="flex-1 text-left">
                    <span className="text-sm font-semibold">{c.name}</span>
                    {c.credits && <p className="text-[10px] text-court-free font-medium">{c.credits} kredit</p>}
                  </div>
                  {c.new && <span className="status-chip bg-accent text-accent-foreground text-[9px]">Ny</span>}
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </motion.button>
              ))}
            </div>
            <button onClick={() => setStep(1)} className="text-sm text-primary font-medium tap-target">← Tillbaka</button>
          </motion.div>
        )}

        {/* Step 4: Upsell + Confirm */}
        {step === 3 && (
          <motion.div key="s3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
            {/* Summary */}
            <div className="glass-card rounded-2xl p-4 space-y-3">
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Datum</span><span className="font-semibold">{isToday ? "Idag" : selectedDate.toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" })}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Tid</span><span className="font-semibold">{selectedTime} · {selectedDuration}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Bana</span><span className="font-semibold">{selectedCourtData?.name}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Kund</span><span className="font-semibold">{selectedCustomer}</span></div>
              <div className="border-t border-border pt-3 flex justify-between items-center">
                <span className="text-sm font-semibold">Total</span>
                <span className="text-xl font-display font-bold text-primary">{selectedCourtData ? selectedCourtData.price * (selectedDuration === "30 min" ? 0.5 : selectedDuration === "90 min" ? 1.5 : 1) : 0} kr</span>
              </div>
              {isPeak && (
                <div className="flex items-center gap-2 bg-court-active/10 rounded-xl p-2.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-court-active" />
                  <span className="text-xs text-court-active font-medium">Peak-pris tillagt</span>
                </div>
              )}
            </div>

            {/* Upsell Layer — DoorDash add-on psychology */}
            <div>
              <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Lägg till</h2>
              <div className="space-y-1.5">
                {upsells.map((up, i) => {
                  const added = addedUpsells.includes(up.title);
                  return (
                    <motion.button key={up.title} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} whileTap={{ scale: 0.97 }} onClick={() => toggleUpsell(up.title)} className={`w-full rounded-2xl p-3.5 flex items-center gap-3 text-left transition-all ${added ? 'bg-primary/10 border border-primary/30' : 'sell-block'}`}>
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${added ? 'bg-primary text-primary-foreground' : 'bg-sell/15 text-sell'}`}>
                        <up.icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold">{up.title}</p>
                        <p className="text-[11px] text-muted-foreground">{up.sub}</p>
                      </div>
                      <span className={`text-[9px] px-2 py-1 rounded-full font-bold ${added ? 'bg-primary text-primary-foreground' : 'bg-sell/15 text-sell'}`}>{added ? "✓" : up.tag}</span>
                    </motion.button>
                  );
                })}
              </div>
            </div>

            <motion.button whileTap={{ scale: 0.96 }} onClick={handleConfirm} className="w-full bg-primary text-primary-foreground rounded-2xl py-4 font-semibold text-sm animate-glow">
              Bekräfta & Debitera
            </motion.button>
            <button onClick={() => setStep(2)} className="text-sm text-primary font-medium tap-target">← Tillbaka</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default BookScreen;
