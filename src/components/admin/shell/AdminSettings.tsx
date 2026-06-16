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
  ShieldAlert,
  TabletSmartphone,
  Tag,
  Trophy,
  Users,
} from "lucide-react";

interface SettingsItem {
  id: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  superAdmin?: boolean;
}

interface SettingsGroup {
  title: string;
  items: SettingsItem[];
}

const groups: SettingsGroup[] = [
  {
    title: "Venue",
    items: [
      { id: "venue", label: "Venue", desc: "Profil, kontakt, group booking", icon: Building2 },
      { id: "hours", label: "Öppettider", desc: "Veckoschema", icon: Clock },
      { id: "operations", label: "Drift", desc: "Avvikelser & stängt", icon: ShieldAlert },
      { id: "links", label: "Länkar", desc: "Linkhub", icon: Link2 },
      { id: "stories", label: "Stories", desc: "Community-stories", icon: Camera },
    ],
  },
  {
    title: "Inventory",
    items: [
      { id: "courts", label: "Banor", desc: "Resurser & sporter", icon: LayoutGrid },
      { id: "devices", label: "Paddor", desc: "Kiosk-tablets & QR", icon: TabletSmartphone },
      { id: "resourceBlocks", label: "Blockeringar", desc: "Holds & avstängda tider", icon: Ban },
    ],
  },
  {
    title: "Catalog",
    items: [
      { id: "products", label: "Produkter", desc: "Access & biljetter", icon: Package },
      { id: "pricing", label: "Priser", desc: "Dynamiska regler", icon: Tag },
      { id: "memberships", label: "Medlemskap", desc: "Nivåer & rabatter", icon: Crown },
      { id: "schedule", label: "Schema", desc: "Program & pass", icon: CalendarCheck },
    ],
  },
  {
    title: "Events",
    items: [
      { id: "events", label: "Events", desc: "Planning & publika", icon: Trophy },
      { id: "eventLeads", label: "Event Leads", desc: "Agent OS & offerter", icon: MessageSquare },
      { id: "eventProducts", label: "Event Products", desc: "Paket & resurser", icon: Package },
      { id: "templates", label: "Event-mallar", desc: "Franchise (HQ)", icon: FileText, superAdmin: true },
    ],
  },
  {
    title: "People",
    items: [
      { id: "staff", label: "Personal", desc: "Roller & access", icon: Users },
      { id: "corporate", label: "Företag", desc: "B2B-konton", icon: Building2 },
      { id: "channels", label: "Chat channels", desc: "Forum & community", icon: MessageSquare },
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
        className="rounded-2xl p-4 border"
        style={{ background: "hsl(var(--surface-1))", borderColor: "hsl(var(--border))" }}
      >
        <p className="text-sm font-bold text-foreground">System­inställningar</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
          Alla moduler från gamla admin finns kvar här. När Calendar, Pipeline, Capacity, People och Catalog är
          byggda flyttas dessa upp till respektive surface.
        </p>
      </div>

      {groups.map((g) => {
        const visible = g.items.filter((i) => !i.superAdmin || isSuperAdmin);
        if (visible.length === 0) return null;
        return (
          <section key={g.title} className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1">{g.title}</p>
            <div
              className="rounded-2xl border overflow-hidden"
              style={{ background: "hsl(var(--surface-1))", borderColor: "hsl(var(--border))" }}
            >
              {visible.map((item, idx) => (
                <motion.button
                  key={item.id}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => onOpen(item.id)}
                  className={`w-full flex items-center gap-3 px-3.5 py-3 text-left ${
                    idx > 0 ? "border-t" : ""
                  }`}
                  style={{ borderColor: "hsl(var(--border) / 0.6)" }}
                >
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: "hsl(var(--primary) / 0.1)" }}
                  >
                    <item.icon className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-foreground">{item.label}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{item.desc}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                </motion.button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
