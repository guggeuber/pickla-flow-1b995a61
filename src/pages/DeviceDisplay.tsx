import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { apiGet } from "@/lib/api";
import picklaLogo from "@/assets/pickla-logo.svg";

interface DeviceData {
  device: {
    id: string;
    name: string;
    device_token: string;
    mode: string;
    external_links?: Array<{ label: string; url: string }>;
    instructions?: string | null;
    venue_court_id?: string | null;
  };
  venue?: { id: string; name: string; slug: string };
  resource?: { id: string; name: string; court_number: number; sport_type: string | null } | null;
  currentBooking?: {
    start_time: string;
    end_time: string;
    checked_in?: boolean;
    player_name?: string | null;
  } | null;
  nextBooking?: { start_time: string; end_time: string } | null;
}

function fmtTime(iso?: string | null) {
  if (!iso) return "";
  return DateTime.fromISO(iso, { zone: "utc" }).setZone("Europe/Stockholm").toFormat("HH:mm");
}

function isDartDevice(data?: DeviceData) {
  const text = [
    data?.resource?.sport_type,
    data?.resource?.name,
    data?.device.name,
  ].filter(Boolean).join(" ").toLowerCase();
  return text.includes("dart") || text.includes("tavla");
}

export default function DeviceDisplay() {
  const { token = "" } = useParams();
  const { data, isLoading, isError } = useQuery<DeviceData>({
    queryKey: ["display-device", token],
    enabled: !!token,
    queryFn: () => apiGet("api-bookings", "display-device", { token }),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const defaultLinks = useMemo(() => {
    const links = data?.device.external_links || [];
    const hasNakka = links.some((link) => link.url.includes("n01darts.com"));
    if (isDartDevice(data) && !hasNakka) {
      return [{ label: "Nakka", url: "https://n01darts.com/n01/web/n01.html" }, ...links];
    }
    return links;
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#faf8f5]">
        <p className="font-mono text-sm text-neutral-400">laddar padda...</p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#faf8f5] px-6 text-center">
        <p className="font-mono text-sm text-neutral-500">Paddan hittades inte eller är avstängd.</p>
      </div>
    );
  }

  const resource = data.resource;
  const venue = data.venue;
  const checkinUrl = resource
    ? `/display/resource/${resource.id}?v=${venue?.slug || "pickla-arena-sthlm"}&device=${token}`
    : `/display/openplay?v=${venue?.slug || "pickla-arena-sthlm"}`;
  const active = Boolean(data.currentBooking);
  const checkedIn = Boolean(data.currentBooking?.checked_in);
  const nextText = data.currentBooking
    ? checkedIn
      ? `Incheckad ${fmtTime(data.currentBooking.start_time)}-${fmtTime(data.currentBooking.end_time)}`
      : `Nu ${fmtTime(data.currentBooking.start_time)}-${fmtTime(data.currentBooking.end_time)}`
    : data.nextBooking
      ? `Nästa ${fmtTime(data.nextBooking.start_time)}`
      : "Ingen mer bokning idag";

  return (
    <main className="min-h-screen bg-[#faf8f5] text-neutral-950">
      <div className="mx-auto w-full max-w-3xl px-6 py-6">
        <header className="mb-12 flex items-center justify-between gap-6">
          <img src={picklaLogo} alt="Pickla" className="h-10 w-auto" />
          <div className="flex items-center gap-2 font-mono text-sm">
            <span className={`h-2.5 w-2.5 rounded-full ${checkedIn ? "bg-emerald-400" : active ? "bg-red-400" : "bg-pink-400"}`} />
            <span>{venue?.name || "Pickla"}</span>
          </div>
        </header>

        <section className="pb-10">
          <div className="mb-8">
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.24em] text-neutral-400">Paddle Home</p>
            <h1 className="font-display text-6xl font-black leading-none sm:text-7xl">
              {resource?.name || data.device.name}
            </h1>
            <p className="mt-4 max-w-2xl font-mono text-2xl text-neutral-500">{nextText}</p>
            {checkedIn && data.currentBooking?.player_name && (
              <p className="mt-2 font-mono text-base text-emerald-600">
                {data.currentBooking.player_name} är inne
              </p>
            )}
          </div>

          <div className="space-y-4">
            {checkedIn ? (
              <div className="block rounded-[2rem] bg-emerald-300 p-7 text-neutral-950">
                <p className="font-display text-4xl font-black">Redan incheckad</p>
                <p className="mt-2 font-mono text-sm text-neutral-700">
                  {data.currentBooking?.player_name
                    ? `${data.currentBooking.player_name} är inne`
                    : "Resursen är upptagen just nu"}
                </p>
              </div>
            ) : (
              <div>
                <Link
                  to={checkinUrl}
                  className="block rounded-[2rem] bg-neutral-950 p-7 text-white"
                >
                  <p className="font-display text-4xl font-black">Checka in</p>
                  <p className="mt-2 font-mono text-sm text-white/55">Slå koden från bokningen</p>
                </Link>
              </div>
            )}

            {defaultLinks.map((link) => (
              <a
                key={`${link.label}-${link.url}`}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-[2rem] border border-black/10 bg-white p-7"
              >
                <p className="font-display text-3xl font-black">{link.label}</p>
                <p className="mt-1 font-mono text-xs text-neutral-500">Öppna verktyg</p>
              </a>
            ))}

            <a href="/today" className="block rounded-[2rem] border border-black/10 bg-white p-7">
              <p className="font-display text-3xl font-black">Idag</p>
              <p className="mt-2 font-mono text-sm text-neutral-500">Vad händer på Pickla</p>
            </a>

            <a href="/book" className="block rounded-[1.5rem] border border-black/10 bg-white p-6">
              <p className="font-display text-2xl font-black">Boka mer</p>
              <p className="mt-1 font-mono text-xs text-neutral-500">Nästa aktivitet</p>
            </a>

            <a href="/events" className="block rounded-[1.5rem] border border-black/10 bg-white p-6">
              <p className="font-display text-2xl font-black">Events</p>
              <p className="mt-1 font-mono text-xs text-neutral-500">Träning & turnering</p>
            </a>
          </div>
        </section>

        <footer className="pb-4 font-mono text-xs uppercase tracking-[0.18em] text-neutral-400">
          {data.device.name} · {resource?.sport_type || "venue"} · kiosk mode
        </footer>
      </div>
    </main>
  );
}
