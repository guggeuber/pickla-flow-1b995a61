import { LucideIcon } from "lucide-react";

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
        className="rounded-2xl p-5 space-y-3 border"
        style={{
          background: "hsl(var(--surface-1))",
          borderColor: "hsl(var(--border))",
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "hsl(var(--primary) / 0.12)" }}
          >
            <Icon className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-display font-bold">{title}</h2>
              <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                {phase}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{tagline}</p>
          </div>
        </div>
      </div>

      <ul className="space-y-2">
        {bullets.map((b) => (
          <li
            key={b.title}
            className="rounded-2xl p-3.5 border"
            style={{
              background: "hsl(var(--surface-1))",
              borderColor: "hsl(var(--border))",
            }}
          >
            <p className="text-sm font-bold text-foreground">{b.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{b.desc}</p>
          </li>
        ))}
      </ul>

      <p className="text-[10px] text-muted-foreground/70 text-center px-4 leading-relaxed">
        Designkoncept. Inga backend-ändringar. Befintliga moduler nås under{" "}
        <span className="font-semibold text-foreground/70">Settings</span> tills surfacen är byggd.
      </p>
    </div>
  );
}
