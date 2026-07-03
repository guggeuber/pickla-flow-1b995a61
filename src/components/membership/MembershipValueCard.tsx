import { ArrowRight, Check, Sparkles } from "lucide-react";
import { formatSek } from "@/lib/activityPricing";

type MembershipOfferRow = {
  label: string;
  priceLabel: string;
  savingLabel?: string | null;
  helper?: string | null;
  actionLabel?: string | null;
  onClick?: () => void;
};

type MembershipValueCardProps = {
  ordinaryPriceSek: number;
  onlinePriceSek: number;
  deskPriceSek: number;
  customerPriceSek: number;
  pricingPending?: boolean;
  includedLabel?: string | null;
  membershipName?: string | null;
  isLoggedIn?: boolean;
  hasActiveMembership?: boolean;
  offerRows?: MembershipOfferRow[];
  compact?: boolean;
};

const FONT_HEADING = "'Space Grotesk', sans-serif";

function safePrice(value: number | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function MembershipValueCard({
  ordinaryPriceSek,
  onlinePriceSek,
  deskPriceSek,
  customerPriceSek,
  pricingPending = false,
  includedLabel,
  membershipName,
  isLoggedIn = false,
  hasActiveMembership = false,
  offerRows = [],
  compact = false,
}: MembershipValueCardProps) {
  const ordinary = safePrice(ordinaryPriceSek || onlinePriceSek);
  const online = safePrice(onlinePriceSek || ordinary);
  const desk = safePrice(deskPriceSek || online);
  const customerPrice = safePrice(customerPriceSek);
  const includedText = includedLabel || (hasActiveMembership && customerPrice <= 0 ? `Ingår i ${membershipName || "medlemskap"}` : null);
  const customerPaysLabel = pricingPending
    ? "Hämtar pris..."
    : includedText
      ? includedText
      : formatSek(customerPrice);
  const saving = pricingPending ? 0 : Math.max(0, Math.round((ordinary - (includedText ? 0 : customerPrice)) * 100) / 100);
  const onlineSaving = Math.max(0, Math.round((desk - online) * 100) / 100);
  const visibleOffers = offerRows.filter(Boolean);

  return (
    <div
      className="min-w-0 rounded-[22px] bg-white"
      style={{
        border: "1px solid rgba(15,23,42,0.10)",
        boxShadow: "0 12px 34px rgba(15,23,42,0.08)",
        padding: compact ? 12 : 14,
      }}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
            Dagens värde
          </p>
          <p className="mt-1 truncate text-[13px] font-semibold text-slate-500">
            Ordinarie pris {formatSek(ordinary)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-600">
            {includedText ? "Ingår" : isLoggedIn ? "Du betalar" : "Online"}
          </p>
          <p
            className="mt-1 max-w-[160px] truncate text-[26px] font-black leading-none text-slate-950"
            style={{ fontFamily: FONT_HEADING }}
            title={customerPaysLabel}
          >
            {customerPaysLabel}
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2.5">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">Playpickla.com</p>
          <p className="text-[17px] font-black text-slate-950" style={{ fontFamily: FONT_HEADING }}>{formatSek(online)}</p>
        </div>
        <span className="h-8 w-px bg-slate-200" />
        <div className="text-right">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Drop-in</p>
          <p className="text-[17px] font-black text-slate-600" style={{ fontFamily: FONT_HEADING }}>{formatSek(desk)}</p>
        </div>
      </div>

      {onlineSaving > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-[12px] font-bold text-emerald-700">
          <Check className="h-3.5 w-3.5" />
          Spara {formatSek(onlineSaving)} genom att boka online.
        </p>
      )}

      {!pricingPending && (isLoggedIn || saving > 0 || includedText) && (
        <div className="mt-3 rounded-2xl bg-emerald-50 px-3 py-2.5">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">
            Du sparar idag
          </p>
          <p className="text-[24px] font-black leading-none text-emerald-700" style={{ fontFamily: FONT_HEADING }}>
            {formatSek(saving)}
          </p>
          {membershipName && (
            <p className="mt-1 text-[11px] font-semibold text-emerald-800">
              {includedText ? `Tack vare ${membershipName}.` : `Med ${membershipName}.`}
            </p>
          )}
        </div>
      )}

      {visibleOffers.length > 0 && (
        <div className="mt-3 grid gap-2">
          {visibleOffers.map((row) => {
            const clickable = Boolean(row.onClick);
            return (
              <button
                key={`${row.label}:${row.priceLabel}`}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  row.onClick?.();
                }}
                disabled={!clickable}
                className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl px-3 py-2.5 text-left disabled:cursor-default"
                style={{
                  border: "1px solid rgba(22,163,74,0.16)",
                  background: "#f0fdf4",
                }}
              >
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
                    <span className="truncate text-[13px] font-black text-slate-950" style={{ fontFamily: FONT_HEADING }}>
                      {row.label}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] font-semibold text-emerald-800">
                    {row.savingLabel || row.helper || "Bli medlem och spara varje gång."}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-[13px] font-black text-emerald-700" style={{ fontFamily: FONT_HEADING }}>
                  {row.priceLabel}
                  {clickable && <ArrowRight className="h-3.5 w-3.5" />}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
