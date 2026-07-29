import { DateTime } from "luxon";

import type { SessionPresentation } from "@/lib/sessionPresentation";

type SessionTimeStatusProps = {
  presentation: Pick<SessionPresentation, "startsAt" | "endsAt" | "timingStatus" | "timingLabel" | "resourceNames">;
  variant?: "row" | "drawer";
};

export function SessionTimeStatus({ presentation, variant = "row" }: SessionTimeStatusProps) {
  const start = DateTime.fromISO(presentation.startsAt).setZone("Europe/Stockholm");
  const end = DateTime.fromISO(presentation.endsAt).setZone("Europe/Stockholm");
  const timeRange = `${start.toFormat("HH:mm")}–${end.toFormat("HH:mm")}`;
  const dateLabel = start.toRelativeCalendar({ locale: "sv" }) || start.toFormat("d MMM");
  const detailLabel = presentation.timingStatus.detailLabel;
  const resourceLabel = presentation.resourceNames.join(", ");
  const compactMeta = `${dateLabel} ${timeRange}${resourceLabel ? ` · ${resourceLabel}` : ""}`;
  const addsNewTimingInformation = presentation.timingStatus.isOngoing
    || /^Startar om /i.test(detailLabel)
    || presentation.timingStatus.isEnded;
  const statusLabel = presentation.timingStatus.isOngoing
    ? `Pågår · ${detailLabel}`
    : presentation.timingStatus.isEnded
      ? "Avslutad"
      : detailLabel;

  if (variant === "drawer") {
    return (
      <div className="space-y-1">
        <div className="text-[14px] font-semibold text-neutral-500">{compactMeta}</div>
        {addsNewTimingInformation && statusLabel ? (
          <div className="text-[14px] font-bold text-neutral-700">{statusLabel}</div>
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
