import { SessionTimeStatus } from "@/components/session/SessionTimeStatus";
import type { SessionPresentation } from "@/lib/sessionPresentation";

type SessionHeaderProps = {
  presentation: SessionPresentation;
};

export function SessionHeader({ presentation }: SessionHeaderProps) {
  const hostName = presentation.host?.displayName || presentation.host?.firstName;
  const hostLabel = Number(presentation.host?.count || 0) > 1 ? "Värdar" : "Värd";
  const hostAvatars = presentation.host?.avatars?.length
    ? presentation.host.avatars
    : presentation.host
      ? [{
          id: null,
          displayName: hostName,
          avatarUrl: presentation.host.avatarUrl,
        }]
      : [];

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-1.5 text-[11px] font-black uppercase tracking-[0.28em] text-neutral-400">
            {presentation.typeLabel}
          </div>
          <h1 className="text-[30px] font-black leading-[0.98] tracking-[-0.02em] text-neutral-950">
            {presentation.title}
          </h1>
          <div className="mt-2.5">
            <SessionTimeStatus presentation={presentation} variant="drawer" />
          </div>
        </div>
      </div>

      {hostName ? (
        <div className="flex min-w-0 items-center gap-2.5 text-[14px] font-bold text-neutral-800">
          <span className="flex shrink-0 -space-x-2" aria-hidden="true">
            {hostAvatars.slice(0, 3).map((host, index) => {
              const label = String(host.displayName || hostName || "Värd");
              const initials = label.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
              return (
                <span key={host.id || `${label}:${index}`} className="grid h-8 w-8 place-items-center overflow-hidden rounded-full border-2 border-white bg-neutral-950 text-[9px] font-black text-white">
                  {host.avatarUrl ? <img src={host.avatarUrl} alt="" className="h-full w-full object-cover" /> : initials}
                </span>
              );
            })}
          </span>
          <span>{hostLabel}: {hostName}</span>
        </div>
      ) : null}

      {presentation.pace ? (
        <div className="text-[13px] font-semibold text-neutral-500">{presentation.pace}</div>
      ) : null}
    </div>
  );
}
