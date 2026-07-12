import { Check } from "lucide-react";
import type { ReactNode } from "react";

import { MemberStrip } from "@/components/ui/MemberStrip";
import { PriceLine } from "@/components/ui/PriceLine";
import type { SessionPresentation } from "@/lib/sessionPresentation";
import { cn } from "@/lib/utils";

type SessionPriceBlockProps = {
  presentation: Pick<SessionPresentation, "pricing" | "entitlementLabel">;
  variant?: "row" | "drawer";
  contextLine?: ReactNode;
  muted?: boolean;
};

function includedPlanName(label?: string | null) {
  if (!label) return "medlemskap";
  return label.replace(/^Ingår\s+i\s+/i, "").replace(/^Ingår\s+·\s*/i, "").trim() || label;
}

export function SessionPriceBlock({ presentation, variant = "row", contextLine, muted = false }: SessionPriceBlockProps) {
  const pricing = presentation.pricing;

  if (!pricing) return null;

  if (variant === "row") {
    if (pricing.kind === "included") {
      return (
        <div className={cn("text-[13px] font-bold text-emerald-700", muted && "text-black/45")}>
          {pricing.label ?? presentation.entitlementLabel ?? "Ingår"}
        </div>
      );
    }

    return (
      <div className={cn("text-[13px] font-bold text-black/70", muted && "text-black/45")}>
        {pricing.kind === "amount" && pricing.amountSek !== null && pricing.amountSek !== undefined
          ? `${pricing.amountSek} kr`
          : pricing.label}
      </div>
    );
  }

  if (pricing.kind === "included") {
    const label = pricing.label ?? presentation.entitlementLabel ?? "Ingår";
    if (/^Ingår i /i.test(label)) {
      return <MemberStrip planName={includedPlanName(label)} amountSek={pricing.amountSek ?? 0} />;
    }

    return (
      <div className="flex items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-emerald-950">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-white">
            <Check className="h-5 w-5" />
          </span>
          <span className="text-[18px] font-bold">{label}</span>
        </div>
        {pricing.amountSek !== null && pricing.amountSek !== undefined ? (
          <span className="text-[24px] font-black">{pricing.amountSek} kr</span>
        ) : null}
      </div>
    );
  }

  if (pricing.kind === "pending") {
    return (
      <div className="rounded-2xl border border-border bg-background px-5 py-4">
        <div className="text-[24px] font-black text-foreground">{pricing.label ?? "Hämtar pris..."}</div>
        {contextLine ?? pricing.contextLabel ? (
          <div className="mt-1 text-[13px] font-semibold text-foreground/60">{contextLine ?? pricing.contextLabel}</div>
        ) : null}
      </div>
    );
  }

  if (pricing.kind === "status") {
    return (
      <div className="rounded-2xl border border-border bg-background px-5 py-4">
        <div className="text-[18px] font-bold text-foreground">{pricing.label}</div>
        {contextLine ?? pricing.contextLabel ? (
          <div className="mt-1 text-[13px] font-semibold text-foreground/60">{contextLine ?? pricing.contextLabel}</div>
        ) : null}
      </div>
    );
  }

  return (
    <PriceLine
      amountSek={pricing.amountSek ?? pricing.label ?? ""}
      contextLine={contextLine ?? pricing.contextLabel}
      size="lg"
    />
  );
}
