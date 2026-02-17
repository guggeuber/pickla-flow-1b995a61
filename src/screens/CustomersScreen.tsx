import { motion, AnimatePresence } from "framer-motion";
import { Search, Phone, Star, Calendar, CreditCard, ChevronRight, UserPlus, Edit3, MessageSquarePlus, X, Check, ArrowLeft } from "lucide-react";
import { useState } from "react";

interface Customer {
  id: number;
  name: string;
  phone: string;
  tier: string;
  spend: string;
  visits: number;
  lastPlayed: string;
  favTime: string;
  tags: string[];
  avatar: string;
  notes: { text: string; date: string }[];
}

const initialCustomers: Customer[] = [
  { id: 1, name: "Sarah Mitchell", phone: "555-0142", tier: "VIP", spend: "$4,280", visits: 47, lastPlayed: "Yesterday", favTime: "6 PM", tags: ["VIP", "Corporate"], avatar: "SM", notes: [{ text: "Prefers court 5", date: "Feb 12" }, { text: "Birthday next week", date: "Feb 15" }] },
  { id: 2, name: "Jake Thompson", phone: "555-0198", tier: "Play", spend: "$1,850", visits: 23, lastPlayed: "2 days ago", favTime: "10 AM", tags: ["Beginner"], avatar: "JT", notes: [] },
  { id: 3, name: "Emma Wilson", phone: "555-0267", tier: "Drop-in", spend: "$620", visits: 8, lastPlayed: "Today", favTime: "2 PM", tags: [], avatar: "EW", notes: [{ text: "Called about group bookings", date: "Feb 10" }] },
  { id: 4, name: "David Park", phone: "555-0333", tier: "VIP", spend: "$6,120", visits: 89, lastPlayed: "Today", favTime: "7 AM", tags: ["VIP", "Tournament"], avatar: "DP", notes: [] },
  { id: 5, name: "Lisa Chen", phone: "555-0411", tier: "Play", spend: "$2,340", visits: 31, lastPlayed: "3 days ago", favTime: "12 PM", tags: ["Corporate"], avatar: "LC", notes: [{ text: "Interested in corporate package", date: "Feb 8" }] },
];

const tierColors: Record<string, string> = {
  VIP: "bg-badge-vip text-badge-vip-foreground",
  Play: "bg-primary text-primary-foreground",
  "Drop-in": "bg-secondary text-secondary-foreground",
};

const tagColors: Record<string, string> = {
  VIP: "bg-badge-vip/15 text-badge-vip",
  Corporate: "bg-primary/15 text-primary",
  Beginner: "bg-badge-unpaid/15 text-badge-unpaid",
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

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.phone.includes(search) ||
    c.tags.some(t => t.toLowerCase().includes(search.toLowerCase()))
  );

  const selectedCustomer = customers.find(c => c.id === selected);

  const startEdit = (customer: Customer) => {
    setEditName(customer.name);
    setEditPhone(customer.phone);
    setEditing(true);
  };

  const saveEdit = () => {
    if (!selected) return;
    setCustomers(prev => prev.map(c =>
      c.id === selected ? { ...c, name: editName, phone: editPhone } : c
    ));
    setEditing(false);
  };

  const addNote = () => {
    if (!selected || !newNote.trim()) return;
    const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
    setCustomers(prev => prev.map(c =>
      c.id === selected ? { ...c, notes: [{ text: newNote.trim(), date: today }, ...c.notes] } : c
    ));
    setNewNote("");
    setShowNoteInput(false);
  };

  if (selectedCustomer) {
    return (
      <div className="pb-24 px-4 pt-2 space-y-5">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => { setSelected(null); setEditing(false); setShowNoteInput(false); }}
            className="tap-target flex items-center gap-1 text-primary font-semibold text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </motion.button>
        </div>

        {/* Profile card */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card rounded-3xl p-5 space-y-4">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-2xl bg-primary/15 text-primary flex items-center justify-center text-xl font-display font-bold flex-shrink-0">
              {selectedCustomer.avatar}
            </div>
            <div className="flex-1 min-w-0">
              {editing ? (
                <div className="space-y-2">
                  <input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    className="w-full bg-secondary rounded-xl py-2 px-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/30"
                    autoFocus
                  />
                  <input
                    value={editPhone}
                    onChange={e => setEditPhone(e.target.value)}
                    className="w-full bg-secondary rounded-xl py-2 px-3 text-sm text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              ) : (
                <>
                  <h1 className="text-lg font-display font-bold truncate">{selectedCustomer.name}</h1>
                  <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <Phone className="w-3 h-3" />
                    {selectedCustomer.phone}
                  </p>
                </>
              )}
              <div className="flex items-center gap-2 mt-2">
                <span className={`status-chip ${tierColors[selectedCustomer.tier]}`}>{selectedCustomer.tier}</span>
                {selectedCustomer.tags.filter(t => t !== selectedCustomer.tier).map(tag => (
                  <span key={tag} className={`status-chip ${tagColors[tag] || 'bg-muted text-muted-foreground'}`}>{tag}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Big fat edit / save button */}
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => editing ? saveEdit() : startEdit(selectedCustomer)}
            className={`w-full rounded-2xl py-3.5 font-semibold text-sm flex items-center justify-center gap-2 transition-colors ${
              editing
                ? 'bg-court-free text-white'
                : 'bg-secondary text-foreground'
            }`}
          >
            {editing ? <Check className="w-4 h-4" /> : <Edit3 className="w-4 h-4" />}
            {editing ? "Save Changes" : "Edit Customer"}
          </motion.button>
        </motion.div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Lifetime", value: selectedCustomer.spend },
            { label: "Visits", value: String(selectedCustomer.visits) },
            { label: "Fav Time", value: selectedCustomer.favTime },
          ].map(s => (
            <div key={s.label} className="stat-card text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</p>
              <p className="text-lg font-display font-bold">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Notes — always visible, prominent add */}
        <div className="glass-card rounded-3xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <MessageSquarePlus className="w-3.5 h-3.5 text-primary" />
              Notes
            </h2>
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => setShowNoteInput(!showNoteInput)}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                showNoteInput ? 'bg-destructive/10 text-destructive' : 'bg-primary text-primary-foreground'
              }`}
            >
              {showNoteInput ? "Cancel" : "+ Add Note"}
            </motion.button>
          </div>

          <AnimatePresence>
            {showNoteInput && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                <div className="flex gap-2">
                  <input
                    value={newNote}
                    onChange={e => setNewNote(e.target.value)}
                    placeholder="Called about... / Vill ha..."
                    className="flex-1 bg-secondary rounded-xl py-2.5 px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    onKeyDown={e => e.key === "Enter" && addNote()}
                    autoFocus
                  />
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={addNote}
                    className="tap-target rounded-xl bg-primary text-primary-foreground w-10 h-10 flex items-center justify-center"
                  >
                    <Check className="w-4 h-4" />
                  </motion.button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {selectedCustomer.notes.length > 0 ? (
            <div className="space-y-2">
              {selectedCustomer.notes.map((note, i) => (
                <div key={i} className="bg-secondary/60 rounded-xl px-3 py-2.5 flex items-start gap-2">
                  <div className="flex-1">
                    <p className="text-sm">{note.text}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">{note.date}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic text-center py-2">Inga noter än — tryck "+ Add Note"</p>
          )}
        </div>

        {/* Quick Actions — SELL focused */}
        <div className="space-y-2">
          <motion.button
            whileTap={{ scale: 0.97 }}
            className="w-full sell-block rounded-2xl p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <Star className="w-5 h-5 text-sell" />
              <div className="text-left">
                <span className="text-sm font-bold">Sell Membership</span>
                <p className="text-[10px] text-muted-foreground">Upgrade to Play or VIP</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-sell" />
          </motion.button>
          {[
            { label: "Book for customer", icon: Calendar },
            { label: "Add credit", icon: CreditCard },
          ].map(action => (
            <motion.button
              key={action.label}
              whileTap={{ scale: 0.97 }}
              className="w-full glass-card rounded-2xl p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <action.icon className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold">{action.label}</span>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </motion.button>
          ))}
        </div>

        <motion.button
          whileTap={{ scale: 0.96 }}
          className="w-full bg-primary text-primary-foreground rounded-2xl py-4 font-semibold text-sm animate-glow"
        >
          ✓ Check In
        </motion.button>
      </div>
    );
  }

  return (
    <div className="pb-24 px-4 pt-2 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold tracking-tight">Customers</h1>
        <motion.button whileTap={{ scale: 0.9 }} className="tap-target rounded-xl bg-primary text-primary-foreground w-9 h-9 flex items-center justify-center">
          <UserPlus className="w-4 h-4" />
        </motion.button>
      </div>

      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Name, phone, tag..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-secondary rounded-xl py-3 pl-10 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-shadow"
        />
      </div>

      <div className="space-y-2">
        {filtered.map((customer, i) => (
          <motion.button
            key={customer.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setSelected(customer.id)}
            className="w-full glass-card rounded-2xl p-3.5 flex items-center gap-3 text-left"
          >
            <div className="w-11 h-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center text-sm font-display font-bold flex-shrink-0">
              {customer.avatar}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{customer.name}</p>
              <p className="text-xs text-muted-foreground">{customer.visits} visits · {customer.lastPlayed}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className={`status-chip text-[10px] ${tierColors[customer.tier]}`}>{customer.tier}</span>
              <span className="text-xs font-semibold text-primary">{customer.spend}</span>
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
};

export default CustomersScreen;
