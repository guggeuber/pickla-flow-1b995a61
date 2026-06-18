import { motion } from "framer-motion";
import { LucideIcon } from "lucide-react";
import { ax } from "@/components/admin/shell/axTheme";

export type DeskSurfaceId = "arrivals" | "today" | "live" | "queue";

export interface DeskSurfaceDef {
  id: DeskSurfaceId;
  label: string;
  icon: LucideIcon;
  hint: string;
  badge?: number;
}

interface Props {
  surfaces: DeskSurfaceDef[];
  active: DeskSurfaceId;
  onChange: (id: DeskSurfaceId) => void;
}

export default function DeskTopNav({ surfaces, active, onChange }: Props) {
  return (
    <nav
      className="-mx-4 px-4 overflow-x-auto scrollbar-none"
      style={{ WebkitOverflowScrolling: "touch" }}
      aria-label="Desk OS surfaces"
    >
      <ul className="flex gap-1.5 min-w-max pb-1">
        {surfaces.map((s) => {
          const isActive = s.id === active;
          return (
            <li key={s.id}>
              <motion.button
                whileTap={{ scale: 0.94 }}
                whileHover={!isActive ? { y: -1 } : undefined}
                onClick={() => onChange(s.id)}
                aria-current={isActive ? "page" : undefined}
                className="relative flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-colors"
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
                <s.icon className="w-4 h-4" />
                <span>{s.label}</span>
                {!!s.badge && (
                  <span
                    className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-black"
                    style={{
                      background: isActive ? "white" : ax("danger"),
                      color: isActive ? ax("ink") : "white",
                    }}
                  >
                    {s.badge}
                  </span>
                )}
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
