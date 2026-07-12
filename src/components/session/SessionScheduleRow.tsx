import { DateTime } from "luxon";

import { SessionPeopleRow } from "@/components/session/SessionPeopleRow";
import { SessionPriceBlock } from "@/components/session/SessionPriceBlock";
import { SessionTimeStatus } from "@/components/session/SessionTimeStatus";
import type { SessionPresentation } from "@/lib/sessionPresentation";
import { cn } from "@/lib/utils";

type SessionScheduleRowProps = {
  presentation: SessionPresentation;
  onClick?: () => void;
  disabled?: boolean;
  emphasis?: "today" | "future";
  className?: string;
};

export function SessionScheduleRow({
  presentation,
  onClick,
  disabled = false,
  emphasis = "today",
  className,
}: SessionScheduleRowProps) {
  const start = DateTime.fromISO(presentation.startsAt).setZone("Europe/Stockholm");

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "group w-full border text-left text-[#111111] transition active:scale-[0.99]",
        "border-[rgba(17,17,17,0.08)] bg-[#f4f0ee] px-4 py-4 hover:bg-[#eee8e3] disabled:opacity-60",
        emphasis === "future" && "bg-[#f7f3f0]",
        className,
      )}
    >
      <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-3">
        <div className="pt-1 font-mono text-[18px] font-bold text-black/75">
          {start.toFormat("HH:mm")}
        </div>
        <div className="min-w-0 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.22em] text-black/35">
                {presentation.typeLabel}
              </div>
              <div className="truncate text-[16px] font-bold text-black">{presentation.title}</div>
            </div>
            <SessionPriceBlock presentation={presentation} variant="row" muted={emphasis === "future"} />
          </div>

          <SessionTimeStatus presentation={presentation} />

          <SessionPeopleRow presentation={presentation} variant="row" />

          {presentation.pace ? (
            <div className="text-[12px] font-semibold text-black/45">{presentation.pace}</div>
          ) : null}
        </div>
      </div>
    </button>
  );
}
