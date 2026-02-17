import { motion, AnimatePresence } from "framer-motion";
import { Search, Phone, Star, Calendar, CreditCard, ChevronRight, UserPlus, Edit3, MessageSquarePlus, Check, ArrowLeft, Zap, TrendingUp } from "lucide-react";
import { useState } from "react";

interface Customer {
  id: number;
  name: string;
  phone: string;
  tier: "VIP" | "Play" | "Drop-in";
  spend: string;
  spendNum: number;
  visits: number;
  lastVisit: string;
  tags: string[];
  avatar: string;
  notes: { text: string; date: string }[];
  upsellHint?: string;
}

const initialCustomers: Customer[] = [
  { id: 4, name: "David Park", phone: "555-0333", tier: "VIP", spend: "61 200 kr", spendNum: 61200, visits: 89, lastVisit: "Idag", tags: ["VIP", "Tournament"], avatar: "DP", notes: [], upsellHint: "Platinum upgrade → +200 kr/mo" },
  { id: 1, name: "Sarah Mitchell", phone: "555-0142", tier: "VIP", spend: "42 800 kr", spendNum: 42800, visits: 47, lastVisit: "Igår", tags: ["VIP", "Corporate"], avatar: "SM", notes: [{ text: "Föredrar bana 5", date: "12 feb" }, { text: "Födelsedag nästa vecka", date: "15 feb" }], upsellHint: "Corporate 10-pack → 15% discount" },
  { id: 5, name: "Lisa Chen", phone: "555-0411", tier: "Play", spend: "23 400 kr", spendNum: 23400, visits: 31, lastVisit: "3 dagar sen", tags: ["Corporate"], avatar: "LC", notes: [{ text: "Intresserad av företagspaket", date: "8 feb" }], upsellHint: "Plays 2x/week → Suggest Play+" },
  { id: 2, name: "Jake Thompson", phone: "555-0198", tier: "Play", spend: "18 500 kr", spendNum: 18500, visits: 23, lastVisit: "2 dagar sen", tags: ["First timer"], avatar: "JT", notes: [] },
  { id: 3, name: "Emma Wilson", phone: "555-0267", tier: "Drop-in", spend: "6 200 kr", spendNum: 6200, visits: 8, lastVisit: "Idag", tags: [], avatar: "EW", notes: [{ text: "Ringde om gruppbokningar", date: "10 feb" }], upsellHint: "First timer → membership conversion" },
];

const tierConfig: Record<string, { bg: string; text: string; dot: string }> = {
  VIP: { bg: "bg-badge-vip/15", text: "text-badge-vip", dot: "bg-badge-vip" },
  Play: { bg: "bg-primary/15", text: "text-primary", dot: "bg-primary" },
  "Drop-in": { bg: "bg-muted", text: "text-muted-foreground", dot: "bg-muted-foreground" },
};

const tagColors: Record<string, string> = {
  VIP: "bg-badge-vip/15 text-badge-vip",
  Corporate: "bg-primary/15 text-primary",
  "First timer": "bg-sell/15 text-sell",
  Tournament: "bg-court-active/15 text-court-active",
};

const CustomersScreen = () => {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [customers, setCustomers] = useState<Customer[]>(initialCustomers);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [newNote, setNewNote] = useState("");
  const [showNoteInput, setShowNoteInput] = useState(false);

  const filtered = customers
    .filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search) || c.tags.some(t => t.toLowerCase().includes(search.toLowerCase())))
    .sort((a, b) => b.spendNum - a.spendNum);

  const selectedCustomer = customers.find(c => c.id === selected);

  const startEdit = (c: Customer) => { setEditName(c.name); setEditPhone(c.phone); setEditing(true); };
  const saveEdit = () => {
    if (!selected) return;
    setCustomers(prev => prev.map(c => c.id === selected ? { ...c, name: editName, phone: editPhone } : c));
    setEditing(false);
  };
  const addNote = () => {
    if (!selected || !newNote.trim()) return;
    const today = new Date().toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
    setCustomers(prev => prev.map(c => c.id === selected ? { ...c, notes: [{ text: newNote.trim(), date: today }, ...c.notes] } : c));
    setNewNote("");
    setShowNoteInput(false);
  };

  if (selectedCustomer) {
    const tier = tierConfig[selectedCustomer.tier];
    return (
      <div className="pb-24 px-4 pt-2 space-y-4">
        <motion.button whileTap={{ scale: 0.9 }} onClick={() => { setSelected(null); setEditing(false); setShowNoteInput(false); }} className="tap-target flex items-center gap-1 text-primary font-semibold text-sm">
          <ArrowLeft className="w-4 h-4" /> Back
        </motion.button>

        {/* Profile */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card rounded-3xl p-5 space-y-4">
          <div className="flex items-start gap-4">
            <div className={`w-14 h-14 rounded-2xl ${tier.bg} ${tier.text} flex items-center justify-center text-lg font-display font-bold flex-shrink-0`}>
              {selectedCustomer.avatar}
            </div>
            <div className="flex-1 min-w-0">
              {editing ? (
                <div className="space-y-2">
                  <input value={editName} onChange={e => setEditName(e.target.value)} className="w-full bg-secondary rounded-xl py-2 px-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/30" autoFocus />
                  <input value={editPhone} onChange={e => setEditPhone(e.target.value)} className="w-full bg-secondary rounded-xl py-2 px-3 text-sm text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
              ) : (
                <>
                  <h1 className="text-lg font-display font-bold truncate">{selectedCustomer.name}</h1>
                  <p className="text-sm text-muted-foreground flex items-center gap-1.5"><Phone className="w-3 h-3" />{selectedCustomer.phone}</p>
                </>
              )}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className={`status-chip ${tier.bg} ${tier.text}`}>{selectedCustomer.tier}</span>
                {selectedCustomer.tags.filter(t => t !== selectedCustomer.tier).map(tag => (
                  <span key={tag} className={`status-chip ${tagColors[tag] || 'bg-muted text-muted-foreground'}`}>{tag}</span>
                ))}
              </div>
            </div>
          </div>
          <motion.button whileTap={{ scale: 0.95 }} onClick={() => editing ? saveEdit() : startEdit(selectedCustomer)} className={`w-full rounded-2xl py-3 font-semibold text-sm flex items-center justify-center gap-2 ${editing ? 'bg-court-free text-white' : 'bg-secondary text-foreground'}`}>
            {editing ? <Check className="w-4 h-4" /> : <Edit3 className="w-4 h-4" />}
            {editing ? "Spara" : "Redigera kund"}
          </motion.button>
        </motion.div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Livstid", value: selectedCustomer.spend },
            { label: "Besök", value: String(selectedCustomer.visits) },
            { label: "Senast", value: selectedCustomer.lastVisit },
          ].map(s => (
            <div key={s.label} className="stat-card text-center">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{s.label}</p>
              <p className="text-base font-display font-bold">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Upsell Prompt — auto-triggered */}
        {selectedCustomer.upsellHint && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="sell-block rounded-2xl p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-sell/15 flex items-center justify-center">
              <Zap className="w-4 h-4 text-sell" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-sell">Upsell möjlighet</p>
              <p className="text-sm font-medium">{selectedCustomer.upsellHint}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-sell" />
          </motion.div>
        )}

        {/* Notes */}
        <div className="glass-card rounded-3xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5"><MessageSquarePlus className="w-3 h-3 text-primary" />Noter</h2>
            <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowNoteInput(!showNoteInput)} className={`rounded-xl px-3 py-1.5 text-xs font-semibold ${showNoteInput ? 'bg-destructive/15 text-destructive' : 'bg-primary text-primary-foreground'}`}>
              {showNoteInput ? "Avbryt" : "+ Ny not"}
            </motion.button>
          </div>
          <AnimatePresence>
            {showNoteInput && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                <div className="flex gap-2">
                  <input value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Ringde om... / Vill ha..." className="flex-1 bg-secondary rounded-xl py-2.5 px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" onKeyDown={e => e.key === "Enter" && addNote()} autoFocus />
                  <motion.button whileTap={{ scale: 0.9 }} onClick={addNote} className="tap-target rounded-xl bg-primary text-primary-foreground w-10 h-10 flex items-center justify-center"><Check className="w-4 h-4" /></motion.button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {selectedCustomer.notes.length > 0 ? (
            <div className="space-y-1.5">
              {selectedCustomer.notes.map((note, i) => (
                <div key={i} className="bg-secondary/60 rounded-xl px-3 py-2.5">
                  <p className="text-sm">{note.text}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{note.date}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic text-center py-2">Inga noter än</p>
          )}
        </div>

        {/* CTA Actions — large blocks */}
        <div className="space-y-2">
          <motion.button whileTap={{ scale: 0.97 }} className="w-full sell-block rounded-2xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3"><Star className="w-5 h-5 text-sell" /><div className="text-left"><span className="text-sm font-bold">Sälj medlemskap</span><p className="text-[10px] text-muted-foreground">Uppgradera till Play eller VIP</p></div></div>
            <ChevronRight className="w-4 h-4 text-sell" />
          </motion.button>
          {[
            { label: "Boka åt kund", icon: Calendar },
            { label: "Lägg till kredit", icon: CreditCard },
          ].map(action => (
            <motion.button key={action.label} whileTap={{ scale: 0.97 }} className="w-full glass-card rounded-2xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3"><action.icon className="w-4 h-4 text-primary" /><span className="text-sm font-semibold">{action.label}</span></div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </motion.button>
          ))}
        </div>

        <motion.button whileTap={{ scale: 0.96 }} className="w-full bg-primary text-primary-foreground rounded-2xl py-4 font-semibold text-sm animate-glow">
          ✓ Check In
        </motion.button>
      </div>
    );
  }

  return (
    <div className="pb-24 px-4 pt-2 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold tracking-tight">Customers</h1>
        <motion.button whileTap={{ scale: 0.9 }} className="tap-target rounded-xl bg-primary text-primary-foreground w-9 h-9 flex items-center justify-center"><UserPlus className="w-4 h-4" /></motion.button>
      </div>

      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input type="text" placeholder="Namn, telefon, tagg..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full bg-secondary rounded-xl py-3 pl-10 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
      </div>

      <div className="space-y-1.5">
        {filtered.map((customer, i) => {
          const t = tierConfig[customer.tier];
          return (
            <motion.button key={customer.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} whileTap={{ scale: 0.97 }} onClick={() => setSelected(customer.id)} className="w-full glass-card rounded-2xl p-3.5 flex items-center gap-3 text-left">
              <div className={`w-10 h-10 rounded-xl ${t.bg} ${t.text} flex items-center justify-center text-sm font-display font-bold flex-shrink-0`}>{customer.avatar}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold truncate">{customer.name}</p>
                  <span className={`w-1.5 h-1.5 rounded-full ${t.dot} flex-shrink-0`} />
                </div>
                <p className="text-[11px] text-muted-foreground">{customer.visits} besök · {customer.lastVisit}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-xs font-display font-bold text-primary">{customer.spend}</span>
                {customer.tags.slice(0, 1).map(tag => (
                  <span key={tag} className={`text-[9px] px-1.5 py-0.5 rounded-full ${tagColors[tag] || 'bg-muted text-muted-foreground'}`}>{tag}</span>
                ))}
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
};

export default CustomersScreen;
