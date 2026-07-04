import { Check } from "lucide-react";
import { formatSek } from "@/lib/activityPricing";

type MemberStripProps = {
  planName?: string | null;
  amountSek?: number | null;
};

export function MemberStrip({ planName, amountSek = 0 }: MemberStripProps) {
  const label = planName ? `Ingår i ${planName}` : "Ingår i medlemskap";

  return (
    <div className="flex min-w-0 items-center justify-between gap-4 rounded-[22px] bg-emerald-50 px-4 py-3 text-emerald-900" style={{ border: "1px solid rgba(16,185,129,0.22)" }}>
      <span className="inline-flex min-w-0 items-center gap-2 text-[15px] font-black" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-600 text-white">
          <Check className="h-4 w-4" />
        </span>
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 text-[22px] font-black leading-none" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
        {formatSek(Number(amountSek || 0))}
      </span>
    </div>
  );
}
