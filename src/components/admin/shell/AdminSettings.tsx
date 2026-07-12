import { motion } from "framer-motion";
import {
  Ban,
  Building2,
  Camera,
  CalendarCheck,
  ChevronRight,
  Clock,
  Crown,
  FileText,
  LayoutGrid,
  Link2,
  LucideIcon,
  MessageSquare,
  Package,
  ReceiptText,
  ShieldAlert,
  TabletSmartphone,
  Tag,
  Trophy,
  Users,
  Wrench,
} from "lucide-react";
import { ax } from "./axTheme";

interface SettingsItem {
  id: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  tint: string;
  superAdmin?: boolean;
}

interface SettingsGroup {
  title: string;
  emoji: string;
  items: SettingsItem[];
}

const groups: SettingsGroup[] = [
  {
    title: "Venue",
    emoji: "🏟️",
    items: [
      { id: "venue", label: "Venue", desc: "Profil, kontakt, group booking", icon: Building2, tint: ax("electric", 0.7) },
      { id: "hours", label: "Öppettider", desc: "Veckoschema", icon: Clock, tint: ax("electric", 0.7) },
      { id: "operations", label: "Drift", desc: "Avvikelser & stängt", icon: ShieldAlert, tint: ax("sun", 0.7) },
      { id: "links", label: "Länkar", desc: "Linkhub", icon: Link2, tint: ax("magenta", 0.7) },
      { id: "stories", label: "Stories", desc: "Community-stories", icon: Camera, tint: ax("magenta", 0.7) },
    ],
  },
  {
    title: "Inventory",
    emoji: "🧱",
    items: [
      { id: "courts", label: "Banor", desc: "Resurser & sporter", icon: LayoutGrid, tint: ax("lime", 0.7) },
      { id: "devices", label: "Paddor", desc: "Kiosk-tablets & QR", icon: TabletSmartphone, tint: ax("electric", 0.7) },
      { id: "resourceBlocks", label: "Blockeringar", desc: "Holds & avstängda tider", icon: Ban, tint: ax("danger", 0.7) },
    ],
  },
  {
    title: "Catalog",
    emoji: "💸",
    items: [
      { id: "products", label: "Produkter", desc: "Utbud & försäljning", icon: Package, tint: ax("magenta", 0.7) },
      { id: "pricing", label: "Priser", desc: "Dynamiska regler", icon: Tag, tint: ax("lime", 0.7) },
      { id: "memberships", label: "Medlemskap", desc: "Nivåer & rabatter", icon: Crown, tint: ax("sun", 0.7) },
      { id: "schedule", label: "Schema", desc: "Program & pass", icon: CalendarCheck, tint: ax("electric", 0.7) },
      { id: "revenueLedger", label: "Revenue Ledger", desc: "Daglig sälj-sanning", icon: ReceiptText, tint: ax("electric", 0.7) },
      { id: "financialMaintenance", label: "Maintenance", desc: "Stripe invoice repair", icon: Wrench, tint: ax("danger", 0.7), superAdmin: true },
    ],
  },
  {
    title: "Events",
    emoji: "🎉",
    items: [
      { id: "events", label: "Events", desc: "Planning & publika", icon: Trophy, tint: ax("magenta", 0.7) },
      { id: "eventLeads", label: "Event Leads", desc: "Agent OS & offerter", icon: MessageSquare, tint: ax("sun", 0.7) },
      { id: "eventProducts", label: "Event Products", desc: "Paket & resurser", icon: Package, tint: ax("lime", 0.7) },
      { id: "templates", label: "Event-mallar", desc: "Franchise (HQ)", icon: FileText, tint: ax("electric", 0.7), superAdmin: true },
    ],
  },
  {
    title: "People",
    emoji: "🧑‍🤝‍🧑",
    items: [
      { id: "staff", label: "Personal", desc: "Roller & access", icon: Users, tint: ax("electric", 0.7) },
      { id: "corporate", label: "Företag", desc: "B2B-konton", icon: Building2, tint: ax("lime", 0.7) },
      { id: "channels", label: "Chat channels", desc: "Forum & community", icon: MessageSquare, tint: ax("magenta", 0.7) },
    ],
  },
];

interface Props {
  onOpen: (id: string) => void;
  isSuperAdmin: boolean;
}

export default function AdminSettings({ onOpen, isSuperAdmin }: Props) {
  return (
    <div className="space-y-5">
      <div
        className="rounded-2xl p-4"
        style={{
          background: `linear-gradient(135deg, ${ax("surfaceHi")}, ${ax("electric", 0.08)})`,
          border: `1px solid ${ax("border")}`,
        }}
      >
        <p className="text-sm font-bold" style={{ color: "white" }}>⚙️ Maskinrummet</p>
        <p className="text-xs mt-1 leading-relaxed" style={{ color: ax("muted") }}>
          Alla gamla moduler bor här. När <span style={{ color: ax("electricSoft") }}>Calendar</span>,{" "}
          <span style={{ color: ax("lime") }}>Pipeline</span>, <span style={{ color: ax("sun") }}>Capacity</span>,{" "}
          <span style={{ color: ax("magenta") }}>People</span> & Catalog är byggda flyttar de upp i navigationen.
        </p>
      </div>

      {groups.map((g) => {
        const visible = g.items.filter((i) => !i.superAdmin || isSuperAdmin);
        if (visible.length === 0) return null;
        return (
          <section key={g.title} className="space-y-2">
            <div className="flex items-center gap-1.5 px-1">
              <span className="text-sm">{g.emoji}</span>
              <p className="text-[10px] font-mono font-bold uppercase tracking-[0.22em]" style={{ color: ax("muted") }}>
                {g.title}
              </p>
              <div className="flex-1 h-px" style={{ background: `linear-gradient(90deg, ${ax("border")}, transparent)` }} />
            </div>
            <div
              className="rounded-2xl overflow-hidden"
              style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}` }}
            >
              {visible.map((item, idx) => (
                <motion.button
                  key={item.id}
                  whileTap={{ scale: 0.98 }}
                  whileHover={{ x: 2 }}
                  onClick={() => onOpen(item.id)}
                  className="w-full flex items-center gap-3 px-3.5 py-3 text-left"
                  style={{ borderTop: idx > 0 ? `1px solid ${ax("borderSoft")}` : "none" }}
                >
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{
                      background: `linear-gradient(135deg, ${item.tint}, hsl(0 0% 0% / 0.3))`,
                      boxShadow: `inset 0 1px 0 hsl(0 0% 100% / 0.15)`,
                    }}
                  >
                    <item.icon className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold" style={{ color: "white" }}>{item.label}</p>
                    <p className="text-[11px] truncate" style={{ color: ax("muted") }}>{item.desc}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 shrink-0" style={{ color: ax("muted") }} />
                </motion.button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
