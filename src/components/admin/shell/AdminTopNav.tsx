import { motion } from "framer-motion";
import { LucideIcon } from "lucide-react";

export type AdminSurfaceId =
  | "today"
  | "calendar"
  | "pipeline"
  | "capacity"
  | "people"
  | "catalog"
  | "settings";

export interface AdminSurfaceDef {
  id: AdminSurfaceId;
  label: string;
  icon: LucideIcon;
  hint: string;
}

interface Props {
  surfaces: AdminSurfaceDef[];
  active: AdminSurfaceId;
  onChange: (id: AdminSurfaceId) => void;
}

export default function AdminTopNav({ surfaces, active, onChange }: Props) {
  return (
    <nav
      className="-mx-4 px-4 overflow-x-auto scrollbar-none"
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      <ul className="flex gap-1.5 min-w-max pb-1">
        {surfaces.map((s) => {
          const isActive = s.id === active;
          return (
            <li key={s.id}>
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => onChange(s.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-[hsl(var(--surface-1))] text-muted-foreground hover:text-foreground"
                }`}
              >
                <s.icon className="w-3.5 h-3.5" />
                <span>{s.label}</span>
              </motion.button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
