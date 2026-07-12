import { MapPin, UserRound } from "lucide-react";

import { SessionTimeStatus } from "@/components/session/SessionTimeStatus";
import type { SessionPresentation } from "@/lib/sessionPresentation";

type SessionHeaderProps = {
  presentation: SessionPresentation;
};

export function SessionHeader({ presentation }: SessionHeaderProps) {
  const hostName = presentation.host?.displayName || presentation.host?.firstName;
  const hostLabel = Number(presentation.host?.count || 0) > 1 ? "Värdar" : "Värd";

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 text-[12px] font-black uppercase tracking-[0.32em] text-neutral-400">
            {presentation.typeLabel}
          </div>
          <h1 className="text-[34px] font-black leading-[0.98] tracking-[-0.02em] text-neutral-950">
            {presentation.title}
          </h1>
          <div className="mt-3">
            <SessionTimeStatus presentation={presentation} variant="drawer" />
          </div>
        </div>
      </div>

      {hostName ? (
        <div className="flex items-center gap-3 text-[15px] font-bold text-neutral-800">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-950 text-white">
            <UserRound className="h-5 w-5" />
          </span>
          <span>{hostLabel}: {hostName}</span>
        </div>
      ) : null}

      {presentation.resourceNames.length > 0 ? (
        <div className="flex items-center gap-2 text-[15px] font-bold text-neutral-600">
          <MapPin className="h-4 w-4" />
          <span>{presentation.resourceNames.join(", ")}</span>
        </div>
      ) : null}

      {presentation.pace ? (
        <div className="text-[13px] font-semibold text-neutral-500">{presentation.pace}</div>
      ) : null}
    </div>
  );
}
