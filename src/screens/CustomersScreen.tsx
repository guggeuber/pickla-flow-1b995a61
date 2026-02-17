import { motion } from "framer-motion";
import { Search, Phone, Star, Calendar, CreditCard, ChevronRight, UserPlus } from "lucide-react";
import { useState } from "react";

const customers = [
  { id: 1, name: "Sarah Mitchell", phone: "555-0142", tier: "VIP", spend: "$4,280", visits: 47, lastPlayed: "Yesterday", favTime: "6 PM", tags: ["VIP", "Corporate"], avatar: "SM" },
  { id: 2, name: "Jake Thompson", phone: "555-0198", tier: "Play", spend: "$1,850", visits: 23, lastPlayed: "2 days ago", favTime: "10 AM", tags: ["Beginner"], avatar: "JT" },
  { id: 3, name: "Emma Wilson", phone: "555-0267", tier: "Drop-in", spend: "$620", visits: 8, lastPlayed: "Today", favTime: "2 PM", tags: [], avatar: "EW" },
  { id: 4, name: "David Park", phone: "555-0333", tier: "VIP", spend: "$6,120", visits: 89, lastPlayed: "Today", favTime: "7 AM", tags: ["VIP", "Tournament"], avatar: "DP" },
  { id: 5, name: "Lisa Chen", phone: "555-0411", tier: "Play", spend: "$2,340", visits: 31, lastPlayed: "3 days ago", favTime: "12 PM", tags: ["Corporate"], avatar: "LC" },
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

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.phone.includes(search) ||
    c.tags.some(t => t.toLowerCase().includes(search.toLowerCase()))
  );

  const selectedCustomer = customers.find(c => c.id === selected);

  if (selectedCustomer) {
    return (
      <div className="pb-24 px-4 pt-2 space-y-5">
        <button onClick={() => setSelected(null)} className="text-sm text-primary font-medium tap-target">
          ← Back
        </button>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center space-y-3">
          <div className="w-20 h-20 rounded-full bg-primary/15 text-primary flex items-center justify-center text-2xl font-display font-bold mx-auto">
            {selectedCustomer.avatar}
          </div>
          <div>
            <h1 className="text-xl font-display font-bold">{selectedCustomer.name}</h1>
            <p className="text-sm text-muted-foreground">{selectedCustomer.phone}</p>
          </div>
          <span className={`status-chip ${tierColors[selectedCustomer.tier]}`}>{selectedCustomer.tier}</span>
        </motion.div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Lifetime", value: selectedCustomer.spend },
            { label: "Visits", value: String(selectedCustomer.visits) },
            { label: "Fav Time", value: selectedCustomer.favTime },
          ].map(s => (
            <div key={s.label} className="stat-card text-center">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-lg font-display font-bold">{s.value}</p>
            </div>
          ))}
        </div>

        {selectedCustomer.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {selectedCustomer.tags.map(tag => (
              <span key={tag} className={`status-chip ${tagColors[tag] || 'bg-muted text-muted-foreground'}`}>{tag}</span>
            ))}
          </div>
        )}

        <div className="space-y-2">
          {[
            { label: "Book for customer", icon: Calendar },
            { label: "Sell membership", icon: Star },
            { label: "Add credit", icon: CreditCard },
          ].map(action => (
            <motion.button
              key={action.label}
              whileTap={{ scale: 0.97 }}
              className="w-full glass-card rounded-2xl p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <action.icon className="w-4.5 h-4.5 text-primary" />
                <span className="text-sm font-semibold">{action.label}</span>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </motion.button>
          ))}
        </div>

        <motion.button
          whileTap={{ scale: 0.96 }}
          className="w-full bg-primary text-primary-foreground rounded-2xl py-4 font-semibold text-sm"
        >
          Check In
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
            <div className="w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-display font-bold flex-shrink-0">
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
