import type { ReactNode } from "react";
import { formatSek } from "@/lib/activityPricing";

type PriceLineProps = {
  amountSek: number | string | null | undefined;
  contextLine?: ReactNode;
  size?: "sm" | "md" | "lg";
};

export function PriceLine({ amountSek, contextLine, size = "md" }: PriceLineProps) {
  const label = typeof amountSek === "number" ? formatSek(amountSek) : amountSek || "";
  const sizeClass = size === "lg" ? "text-[32px]" : size === "sm" ? "text-[18px]" : "text-[24px]";

  return (
    <div className="min-w-0">
      <p className={`${sizeClass} font-black leading-none tracking-[-0.03em] text-neutral-950`} style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
        {label}
      </p>
      {contextLine ? (
        <div className="mt-1 text-[13px] font-semibold leading-snug text-neutral-500">
          {contextLine}
        </div>
      ) : null}
    </div>
  );
}
