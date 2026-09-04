import { UserCheck } from "lucide-react";

type SocialVisibilityControlProps = {
  visible: boolean;
  pending?: boolean;
  onChange: (visible: boolean) => void;
};

export function SocialVisibilityControl({ visible, pending = false, onChange }: SocialVisibilityControlProps) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <UserCheck className="h-4 w-4 text-slate-400" />
        <span className="text-sm font-semibold text-slate-900" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Integritet</span>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Visa mig på pass jag deltar i</p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              Andra som är anmälda till samma pass kan se ditt förnamn, efternamnsinitial och din profilbild.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={visible}
            aria-label="Visa mig på pass jag deltar i"
            disabled={pending}
            onClick={() => onChange(!visible)}
            className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${visible ? "bg-slate-950" : "bg-slate-300"}`}
          >
            <span className={`absolute left-0 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${visible ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>
      </div>
    </section>
  );
}
