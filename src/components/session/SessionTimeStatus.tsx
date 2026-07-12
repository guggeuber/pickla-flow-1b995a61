import { DateTime } from "luxon";

import type { SessionPresentation } from "@/lib/sessionPresentation";

type SessionTimeStatusProps = {
  presentation: Pick<SessionPresentation, "startsAt" | "endsAt" | "timingStatus" | "timingLabel">;
  variant?: "row" | "drawer";
};

export function SessionTimeStatus({ presentation, variant = "row" }: SessionTimeStatusProps) {
  const start = DateTime.fromISO(presentation.startsAt).setZone("Europe/Stockholm");
  const end = DateTime.fromISO(presentation.endsAt).setZone("Europe/Stockholm");
  const timeRange = `${start.toFormat("HH:mm")}–${end.toFormat("HH:mm")}`;
  const dateLabel = start.toRelativeCalendar({ locale: "sv" }) || start.toFormat("d MMM");
  const detailLabel = presentation.timingStatus.detailLabel;
  const shouldShowDetail = Boolean(detailLabel && detailLabel !== timeRange && detailLabel !== presentation.timingStatus.rangeLabel);

  if (variant === "drawer") {
    return (
      <div className="space-y-1">
        <div className="text-[15px] font-semibold text-neutral-500">{dateLabel} · {timeRange}</div>
        {shouldShowDetail ? (
          <div className="text-[15px] font-bold text-neutral-600">{detailLabel}</div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="text-[13px] font-semibold text-black/50">
      {presentation.timingStatus.stateLabel}
      {presentation.timingStatus.detailLabel ? ` · ${presentation.timingStatus.detailLabel}` : ""}
    </div>
  );
}
