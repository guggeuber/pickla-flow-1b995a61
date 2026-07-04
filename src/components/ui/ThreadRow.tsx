type ThreadRowProps = {
  avatarInitials?: string | null;
  avatarUrl?: string | null;
  displayName: string;
  lastMessagePreview?: string | null;
  timestamp?: string | null;
};

export function ThreadRow({
  avatarInitials,
  avatarUrl,
  displayName,
  lastMessagePreview,
  timestamp,
}: ThreadRowProps) {
  const initials = (avatarInitials || displayName.slice(0, 2) || "P").toUpperCase();

  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-[#EAF2FF] text-[#0066FF]">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs font-bold">
            {initials}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-[#111827]">
            {displayName}
          </p>
          {timestamp && (
            <span className="shrink-0 text-[11px] text-[#9CA3AF]">
              {timestamp}
            </span>
          )}
        </div>
        {lastMessagePreview && (
          <p className="mt-0.5 truncate text-xs text-[#9CA3AF]">
            {lastMessagePreview}
          </p>
        )}
      </div>
    </div>
  );
}
