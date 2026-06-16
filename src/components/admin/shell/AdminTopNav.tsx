import { motion } from "framer-motion";
import { LucideIcon } from "lucide-react";
import { AX, ax } from "./axTheme";

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
                whileTap={{ scale: 0.94 }}
                onClick={() => onChange(s.id)}
                className="relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-colors"
                style={
                  isActive
                    ? {
                        background: `linear-gradient(135deg, ${ax("electric")}, ${ax("magenta")})`,
                        color: "white",
                        boxShadow: `0 6px 20px -8px ${ax("electric", 0.7)}, inset 0 1px 0 hsl(0 0% 100% / 0.25)`,
                      }
                    : {
                        background: ax("surfaceHi"),
                        color: ax("muted"),
                        border: `1px solid ${ax("borderSoft")}`,
                      }
                }
              >
                <s.icon className="w-3.5 h-3.5" />
                <span>{s.label}</span>
                {isActive && (
                  <span
                    className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                    style={{ background: ax("lime"), boxShadow: `0 0 8px ${ax("lime")}` }}
                  />
                )}
              </motion.button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
