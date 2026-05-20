import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { CalendarCheck, ExternalLink, LogIn, Play, Trophy } from "lucide-react";
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
  currentBooking?: { start_time: string; end_time: string } | null;
  nextBooking?: { start_time: string; end_time: string } | null;
}

function fmtTime(iso?: string | null) {
  if (!iso) return "";
  return DateTime.fromISO(iso, { zone: "utc" }).setZone("Europe/Stockholm").toFormat("HH:mm");
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
    if (links.length > 0) return links;
    if (data?.resource?.sport_type === "dart") {
      return [{ label: "Nakka", url: "https://n01darts.com/n01/web/n01.html" }];
    }
    return [];
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
    ? `/display/resource/${resource.id}?v=${venue?.slug || "pickla-arena-sthlm"}`
    : `/display/openplay?v=${venue?.slug || "pickla-arena-sthlm"}`;
  const active = Boolean(data.currentBooking);
  const nextText = data.currentBooking
    ? `Nu ${fmtTime(data.currentBooking.start_time)}-${fmtTime(data.currentBooking.end_time)}`
    : data.nextBooking
      ? `Nästa ${fmtTime(data.nextBooking.start_time)}`
      : "Ingen mer bokning idag";

  return (
    <main className="min-h-screen bg-[#faf8f5] text-neutral-950">
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-8 py-8">
        <header className="flex items-center justify-between gap-6">
          <img src={picklaLogo} alt="Pickla" className="h-10 w-auto" />
          <div className="flex items-center gap-2 font-mono text-sm">
            <span className={`h-2.5 w-2.5 rounded-full ${active ? "bg-emerald-400" : "bg-pink-400"}`} />
            <span>{venue?.name || "Pickla"}</span>
          </div>
        </header>

        <section className="grid flex-1 place-items-center py-10">
          <div className="w-full">
            <div className="mb-8">
              <p className="mb-3 font-mono text-xs uppercase tracking-[0.24em] text-neutral-400">Paddle Home</p>
              <h1 className="font-display text-7xl font-black leading-none tracking-tight sm:text-8xl">
                {resource?.name || data.device.name}
              </h1>
              <p className="mt-4 max-w-2xl font-mono text-2xl text-neutral-500">{nextText}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <motion.div whileTap={{ scale: 0.97 }} className="sm:col-span-2">
                <Link
                  to={checkinUrl}
                  className="flex min-h-48 flex-col justify-between rounded-[2rem] bg-neutral-950 p-7 text-white shadow-xl shadow-neutral-950/10"
                >
                  <LogIn className="h-9 w-9 text-emerald-300" />
                  <div>
                    <p className="font-display text-4xl font-black">Checka in</p>
                    <p className="mt-2 font-mono text-sm text-white/55">Slå koden från bokningen</p>
                  </div>
                </Link>
              </motion.div>

              <motion.a
                whileTap={{ scale: 0.97 }}
                href="/today"
                className="flex min-h-48 flex-col justify-between rounded-[2rem] border border-black/10 bg-white p-7 shadow-sm"
              >
                <CalendarCheck className="h-8 w-8 text-pink-500" />
                <div>
                  <p className="font-display text-3xl font-black">Idag</p>
                  <p className="mt-2 font-mono text-sm text-neutral-500">Vad händer på Pickla</p>
                </div>
              </motion.a>

              {defaultLinks.map((link) => (
                <motion.a
                  key={`${link.label}-${link.url}`}
                  whileTap={{ scale: 0.97 }}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-36 flex-col justify-between rounded-[1.5rem] border border-black/10 bg-white p-6 shadow-sm"
                >
                  <ExternalLink className="h-6 w-6 text-neutral-500" />
                  <div>
                    <p className="font-display text-2xl font-black">{link.label}</p>
                    <p className="mt-1 font-mono text-xs text-neutral-500">Öppna verktyg</p>
                  </div>
                </motion.a>
              ))}

              <motion.a
                whileTap={{ scale: 0.97 }}
                href="/book"
                className="flex min-h-36 flex-col justify-between rounded-[1.5rem] border border-black/10 bg-white p-6 shadow-sm"
              >
                <Play className="h-6 w-6 text-emerald-500" />
                <div>
                  <p className="font-display text-2xl font-black">Boka mer</p>
                  <p className="mt-1 font-mono text-xs text-neutral-500">Nästa aktivitet</p>
                </div>
              </motion.a>

              <motion.a
                whileTap={{ scale: 0.97 }}
                href="/events"
                className="flex min-h-36 flex-col justify-between rounded-[1.5rem] border border-black/10 bg-white p-6 shadow-sm"
              >
                <Trophy className="h-6 w-6 text-pink-500" />
                <div>
                  <p className="font-display text-2xl font-black">Events</p>
                  <p className="mt-1 font-mono text-xs text-neutral-500">Träning & turnering</p>
                </div>
              </motion.a>
            </div>
          </div>
        </section>

        <footer className="font-mono text-xs uppercase tracking-[0.18em] text-neutral-400">
          {data.device.name} · {resource?.sport_type || "venue"} · kiosk mode
        </footer>
      </div>
    </main>
  );
}
