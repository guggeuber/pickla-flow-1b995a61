import { LucideIcon } from "lucide-react";
import { ax, AX_GRID_BG } from "./axTheme";

interface BulletItem {
  title: string;
  desc: string;
}

interface Props {
  icon: LucideIcon;
  title: string;
  tagline: string;
  bullets: BulletItem[];
  phase: string;
}

/**
 * Placeholder surface for Admin OS phases that are designed but not yet
 * implemented. Communicates intent + scope so Codex can pick it up.
 */
export default function AdminSoon({ icon: Icon, title, tagline, bullets, phase }: Props) {
  return (
    <div className="space-y-4">
      <div
        className="relative rounded-3xl p-5 overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${ax("surface")}, ${ax("magenta", 0.12)})`,
          border: `1px solid ${ax("border")}`,
        }}
      >
        <div className="absolute inset-0 opacity-30 pointer-events-none" style={AX_GRID_BG} />
        <div
          className="absolute -bottom-12 -right-12 w-40 h-40 rounded-full opacity-30 pointer-events-none"
          style={{ background: `radial-gradient(circle, ${ax("electric", 0.7)}, transparent 70%)` }}
        />
        <div className="relative flex items-start gap-3">
          <div
            className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
            style={{
              background: `linear-gradient(135deg, ${ax("electric")}, ${ax("magenta")})`,
              boxShadow: `0 8px 24px -10px ${ax("electric", 0.7)}, inset 0 1px 0 hsl(0 0% 100% / 0.2)`,
            }}
          >
            <Icon className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-display font-black" style={{ color: "white" }}>{title}</h2>
              <span
                className="text-[9px] font-mono font-bold uppercase tracking-[0.2em] px-2 py-0.5 rounded-md"
                style={{
                  background: ax("electric", 0.18),
                  color: ax("electricSoft"),
                  border: `1px solid ${ax("electric", 0.4)}`,
                }}
              >
                {phase}
              </span>
            </div>
            <p className="text-xs mt-1" style={{ color: ax("muted") }}>{tagline}</p>
          </div>
        </div>
      </div>

      <ul className="space-y-2">
        {bullets.map((b, i) => {
          const tints = [ax("electric"), ax("lime"), ax("magenta"), ax("sun")];
          const c = tints[i % tints.length];
          return (
            <li
              key={b.title}
              className="relative rounded-2xl p-3.5 overflow-hidden"
              style={{
                background: ax("surfaceHi"),
                border: `1px solid ${ax("borderSoft")}`,
              }}
            >
              <div
                className="absolute left-0 top-0 bottom-0 w-[3px]"
                style={{ background: c, opacity: 0.85 }}
              />
              <p className="text-sm font-bold pl-1.5" style={{ color: "white" }}>{b.title}</p>
              <p className="text-xs mt-0.5 pl-1.5 leading-relaxed" style={{ color: ax("muted") }}>{b.desc}</p>
            </li>
          );
        })}
      </ul>

      <p className="text-center text-[10px] font-mono uppercase tracking-[0.2em] px-4" style={{ color: ax("muted") }}>
        ⚡ designkoncept · inga backend-ändringar · moduler nås under <span style={{ color: "white" }}>settings</span>
      </p>
    </div>
  );
}
