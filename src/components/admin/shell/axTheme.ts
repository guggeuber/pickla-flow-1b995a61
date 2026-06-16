/**
 * Admin OS scoped palette.
 *
 * Deliberately NOT the staff/desk orange. The admin shell is the
 * "mission control" surface — high-precision, playful, electric.
 *
 * - electric: primary action / focus, electric blue
 * - lime:     positive / live / nominal
 * - magenta:  highlight / playful accent / events
 * - amberish: attention (not orange-brown, more sun-yellow)
 * - danger:   destructive
 *
 * All values are raw HSL channels so we can do `hsl(var())`-style
 * composition inline without touching global tokens.
 */
export const AX = {
  electric: "217 100% 62%",
  electricSoft: "217 100% 72%",
  lime: "150 80% 52%",
  magenta: "320 90% 64%",
  sun: "48 100% 60%",
  danger: "0 84% 60%",
  ink: "220 25% 8%",
  surface: "220 20% 11%",
  surfaceHi: "220 18% 14%",
  border: "220 15% 22%",
  borderSoft: "220 15% 18%",
  muted: "220 10% 60%",
} as const;

export const ax = (token: keyof typeof AX, alpha?: number) =>
  alpha === undefined ? `hsl(${AX[token]})` : `hsl(${AX[token]} / ${alpha})`;

/** Tiny CSS for the scanline / grid background used on hero panels. */
export const AX_GRID_BG = {
  backgroundImage: `
    linear-gradient(${ax("electric", 0.05)} 1px, transparent 1px),
    linear-gradient(90deg, ${ax("electric", 0.05)} 1px, transparent 1px)
  `,
  backgroundSize: "24px 24px, 24px 24px",
} as const;
