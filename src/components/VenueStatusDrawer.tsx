import { DateTime } from "luxon";
import { MapPin, X } from "lucide-react";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { operationTitle, operationDescription } from "@/lib/venueStatus";

const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";
const GREEN = "#32ef87";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  venue: any | undefined;
  status: any | undefined;
};

export function VenueStatusDrawer({ open, onOpenChange, venue, status }: Props) {
  const now = DateTime.now().setZone("Europe/Stockholm");
  const address = [venue?.address || "Svetsarvägen 22", venue?.city || "Solna"].filter(Boolean).join(", ");

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="rounded-t-[28px] border-0 bg-white px-6 pb-[calc(env(safe-area-inset-bottom,0px)+22px)] pt-5">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-7 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[28px] font-black text-neutral-950" style={{ fontFamily: FONT_HEADING }}>
                {venue?.name?.replace("Pickla Arena ", "Pickla ") || "Pickla Solna"}
              </h2>
              <p className="mt-4 text-[13px] font-bold text-neutral-950" style={{ fontFamily: FONT_HEADING }}>
                {status?.label || "Öppettider laddas"}
              </p>
              <p className="mt-1 text-[13px] text-neutral-700" style={{ fontFamily: FONT_MONO }}>
                {address}
              </p>
            </div>
            <button type="button" onClick={() => onOpenChange(false)} className="rounded-full p-2 text-neutral-950">
              <X className="h-5 w-5" />
            </button>
          </div>

          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-neutral-950 px-4 py-2 text-[13px] font-bold text-neutral-950"
            style={{ fontFamily: FONT_HEADING }}
          >
            <MapPin className="h-4 w-4" />
            Vägbeskrivning
          </a>

          <div className="mt-9">
            <h3 className="text-[16px] font-black text-neutral-950" style={{ fontFamily: FONT_HEADING }}>
              Öppettider
            </h3>
            <div className="mt-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
                    {status?.todayLabel || `Today, ${now.setLocale("sv").toFormat("d LLLL")}`}
                  </p>
                  <p className="mt-2 text-[13px] font-bold text-neutral-950" style={{ fontFamily: FONT_HEADING }}>
                    Normal öppettid: {status?.normalHoursLabel || "Laddar"}
                  </p>
                  {status?.activeOperationOverride && (
                    <p className="mt-1 text-[13px] font-bold text-red-700" style={{ fontFamily: FONT_HEADING }}>
                      {operationTitle(status.activeOperationOverride)}: {operationDescription(status.activeOperationOverride, status.todayOpeningHours, now)}
                    </p>
                  )}
                </div>
                <span
                  className="mt-1 h-3 w-3 shrink-0 rounded-full"
                  style={{
                    background: status?.venueStatusTone === "exception"
                      ? "#f97316"
                      : status?.open
                        ? GREEN
                        : "#ef4444",
                  }}
                />
              </div>
              <p className="mt-3 rounded-xl bg-white px-3 py-2 text-[13px] font-black text-neutral-950" style={{ fontFamily: FONT_HEADING }}>
                Aktuell status: {status?.currentStatusLabel || status?.label || "Laddar"}
              </p>
            </div>
            <div className="mt-3 space-y-1">
              {(status?.scheduleRows || []).map((row: any) => (
                <div
                  key={row.key}
                  className={`rounded-xl px-2 py-1 text-[13px] text-neutral-950 ${row.isToday ? "bg-neutral-100 font-bold" : ""}`}
                  style={{ fontFamily: FONT_MONO }}
                >
                  <div className="flex justify-between gap-8">
                    <span>{row.dayLabel}</span>
                    <span>{row.fullyClosed ? `Stängt · ${row.primaryTitle}` : row.normalLabel}</span>
                  </div>
                  {!row.fullyClosed && row.overrides?.map((override: any) => (
                    <p key={override.id} className="mt-1 text-right text-[11px] font-bold text-red-700">
                      {override.title}: {override.description}
                    </p>
                  ))}
                </div>
              ))}
            </div>
            {status?.upcomingOverrideRows?.length > 0 && (
              <div className="mt-6">
                <h4 className="text-[13px] font-black text-neutral-950" style={{ fontFamily: FONT_HEADING }}>
                  Kommande avvikelser
                </h4>
                <div className="mt-2 space-y-2">
                  {status.upcomingOverrideRows.map((override: any) => (
                    <div key={override.id} className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3">
                      <span
                        aria-hidden
                        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-[18px] shadow-sm"
                      >
                        {override.icon}
                      </span>
                      <div className="grid h-11 w-14 shrink-0 place-items-center rounded-lg bg-white text-center leading-none" style={{ fontFamily: FONT_MONO }}>
                        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-400">
                          {override.dayBadge?.split(" ")[1] || ""}
                        </span>
                        <span className="text-[16px] font-black text-neutral-950">
                          {override.dayBadge?.split(" ")[0] || ""}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-black text-neutral-950" style={{ fontFamily: FONT_HEADING }}>
                          {override.title}
                        </p>
                        <p className="mt-0.5 text-[11px] font-bold text-red-700" style={{ fontFamily: FONT_HEADING }}>
                          {override.fullDayLabel}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
