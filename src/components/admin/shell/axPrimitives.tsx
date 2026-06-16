import { motion } from "framer-motion";
import { LucideIcon } from "lucide-react";
import { ax } from "./axTheme";

/**
 * Shared Admin OS shell primitives.
 *
 * One source of truth for typography, spacing, radius, padding and chips
 * used across AdminToday / AdminTopNav / future shell surfaces.
 *
 * Mobile-first. iPhone 13 base. Premium, sharp, playful.
 *
 * Naming convention: Ax* (Admin eXperience).
 */

/* ───────────── Tokens ───────────── */

export const AX_RADIUS = {
  card: "rounded-2xl",
  hero: "rounded-3xl",
  chip: "rounded-md",
  pill: "rounded-xl",
} as const;

export const AX_PAD = {
  card: "p-4",
  hero: "p-5",
  row: "px-3.5 py-3",
} as const;

export const AX_TYPE = {
  display: "font-display font-black tracking-tight",
  bodyBold: "text-sm font-bold",
  body: "text-sm",
  meta: "text-[11px]",
  micro: "text-[10px] font-mono font-bold uppercase tracking-[0.22em]",
  microSoft: "text-[9px] font-mono uppercase tracking-[0.22em]",
} as const;

/* ───────────── Section label ───────────── */

export function AxSectionLabel({
  icon: Icon,
  accent,
  children,
  trailing,
}: {
  icon: LucideIcon;
  accent?: string;
  children: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 px-1">
      <Icon className="w-3 h-3" style={{ color: accent ?? ax("muted") }} />
      <p className={AX_TYPE.micro} style={{ color: ax("muted") }}>
        {children}
      </p>
      <div
        className="flex-1 h-px"
        style={{ background: `linear-gradient(90deg, ${ax("border")}, transparent)` }}
      />
      {trailing}
    </div>
  );
}

/* ───────────── Chip ───────────── */

export function AxChip({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "lime" | "electric" | "magenta" | "sun" | "danger";
  children: React.ReactNode;
}) {
  const map = {
    neutral: { fg: ax("muted"), bg: ax("borderSoft"), bd: ax("border") },
    lime: { fg: ax("lime"), bg: ax("lime", 0.15), bd: ax("lime", 0.35) },
    electric: { fg: ax("electricSoft"), bg: ax("electric", 0.16), bd: ax("electric", 0.4) },
    magenta: { fg: ax("magenta"), bg: ax("magenta", 0.15), bd: ax("magenta", 0.35) },
    sun: { fg: ax("sun"), bg: ax("sun", 0.15), bd: ax("sun", 0.35) },
    danger: { fg: ax("danger"), bg: ax("danger", 0.15), bd: ax("danger", 0.35) },
  }[tone];
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-mono font-bold uppercase tracking-[0.18em]"
      style={{ color: map.fg, background: map.bg, border: `1px solid ${map.bd}` }}
    >
      {children}
    </span>
  );
}

/* ───────────── Card ───────────── */

export function AxCard({
  children,
  onClick,
  glow,
  className = "",
  pad = "card",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  glow?: string;
  className?: string;
  pad?: keyof typeof AX_PAD;
}) {
  const baseStyle = {
    background: ax("surfaceHi"),
    border: `1px solid ${glow ?? ax("borderSoft")}`,
    boxShadow: glow ? `0 10px 28px -18px ${glow}` : "none",
  };
  const cls = `relative w-full text-left overflow-hidden ${AX_RADIUS.card} ${AX_PAD[pad]} ${className}`;
  if (onClick) {
    return (
      <motion.button
        whileTap={{ scale: 0.985 }}
        onClick={onClick}
        className={cls}
        style={baseStyle}
      >
        {children}
      </motion.button>
    );
  }
  return (
    <div className={cls} style={baseStyle}>
      {children}
    </div>
  );
}

/* ───────────── Empty state ───────────── */

export function AxEmpty({
  icon: Icon,
  title,
  hint,
  tint,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  tint?: string;
}) {
  const c = tint ?? ax("electric");
  return (
    <AxCard>
      <div className="flex items-center gap-3 py-0.5">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: `linear-gradient(135deg, ${c}, hsl(0 0% 0% / 0.35))`,
            boxShadow: `inset 0 1px 0 hsl(0 0% 100% / 0.15)`,
          }}
        >
          <Icon className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className={AX_TYPE.bodyBold} style={{ color: "white" }}>
            {title}
          </p>
          <p className={`${AX_TYPE.meta} leading-relaxed`} style={{ color: ax("muted") }}>
            {hint}
          </p>
        </div>
      </div>
    </AxCard>
  );
}

/* ───────────── Skeleton ───────────── */

export function AxSkeleton({
  className = "",
  width,
  height,
}: {
  className?: string;
  width?: number | string;
  height?: number | string;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-md ${className}`}
      style={{
        width,
        height,
        background: ax("borderSoft"),
      }}
    >
      <div
        className="absolute inset-0 -translate-x-full animate-[axShimmer_1.6s_ease-in-out_infinite]"
        style={{
          background: `linear-gradient(90deg, transparent, ${ax("border")}, transparent)`,
        }}
      />
      <style>{`@keyframes axShimmer { to { transform: translateX(100%); } }`}</style>
    </div>
  );
}

export function AxMetricSkeleton() {
  return (
    <div className="space-y-2">
      <AxSkeleton width={56} height={8} />
      <AxSkeleton width={72} height={26} />
      <AxSkeleton width={84} height={10} />
    </div>
  );
}
