import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Check, Loader2, LogIn, X } from "lucide-react";
import picklaLogo from "@/assets/pickla-logo.svg";
import { useAuth } from "@/hooks/useAuth";
import { apiPost } from "@/lib/api";

type JoinResult = {
  player?: {
    slot_number: number;
    auth_user_id: string;
    display_name: string;
    avatar_url?: string | null;
  };
};

export default function ScoreJoinPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [state, setState] = useState<"idle" | "joining" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const postedRef = useRef(false);

  const setupId = searchParams.get("setup") || "";
  const deviceToken = searchParams.get("device") || "";
  const slot = searchParams.get("slot") || "";
  const slotNumber = Number(slot);
  const currentPath = useMemo(() => `${window.location.pathname}${window.location.search}`, []);
  const missingParams = !setupId || !deviceToken || !Number.isInteger(slotNumber) || slotNumber < 0 || slotNumber > 7;

  useEffect(() => {
    if (loading || user || missingParams) return;
    navigate(`/auth?redirect=${encodeURIComponent(currentPath)}`, { replace: true });
  }, [currentPath, loading, missingParams, navigate, user]);

  useEffect(() => {
    if (loading || !user || missingParams || postedRef.current) return;
    postedRef.current = true;
    setState("joining");
    apiPost<JoinResult>("api-score", "join-player", {
      device_token: deviceToken,
      setup_id: setupId,
      slot_number: slotNumber,
    })
      .then((result) => {
        setState("done");
        setMessage(result.player?.display_name || "Du är kopplad");
      })
      .catch((error: Error) => {
        postedRef.current = false;
        setState("error");
        setMessage(error.message || "Kunde inte koppla kontot");
      });
  }, [deviceToken, loading, missingParams, setupId, slotNumber, user]);

  if (loading || (!user && !missingParams)) {
    return (
      <Shell>
        <Loader2 className="h-6 w-6 animate-spin text-neutral-300" />
      </Shell>
    );
  }

  if (missingParams) {
    return (
      <Shell>
        <StatusCard
          icon={<X className="h-7 w-7" />}
          title="Länken saknar info"
          body="Gå tillbaka till paddan och visa en ny QR-kod för spelaren."
          tone="error"
        />
      </Shell>
    );
  }

  if (state === "error") {
    return (
      <Shell>
        <StatusCard
          icon={<X className="h-7 w-7" />}
          title="Kunde inte koppla"
          body={message}
          tone="error"
          action={
            <button
              onClick={() => {
                postedRef.current = false;
                setState("idle");
              }}
              className="mt-6 h-14 rounded-full bg-neutral-950 px-8 font-mono text-sm font-bold uppercase tracking-[0.16em] text-white"
            >
              Försök igen
            </button>
          }
        />
      </Shell>
    );
  }

  if (state === "done") {
    return (
      <Shell>
        <StatusCard
          icon={<Check className="h-7 w-7" />}
          title="Kopplad"
          body={`${message} är nu kopplad till spelare ${slotNumber + 1}. Du kan lägga undan mobilen och fortsätta på paddan.`}
          tone="success"
          action={
            <Link
              to="/my"
              className="mt-6 inline-flex h-14 items-center justify-center rounded-full bg-neutral-950 px-8 font-mono text-sm font-bold uppercase tracking-[0.16em] text-white"
            >
              Mitt konto
            </Link>
          }
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <StatusCard
        icon={<LogIn className="h-7 w-7" />}
        title="Kopplar konto"
        body="Vänta en sekund, vi kopplar din Pickla-profil till matchen."
        tone="neutral"
        action={<Loader2 className="mt-6 h-6 w-6 animate-spin text-neutral-300" />}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#faf8f5] px-6 py-8 text-neutral-950">
      <Link to="/" className="inline-flex">
        <img src={picklaLogo} alt="Pickla" className="h-12 w-auto" />
      </Link>
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center">
        {children}
      </div>
    </main>
  );
}

function StatusCard({
  icon,
  title,
  body,
  tone,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  tone: "success" | "error" | "neutral";
  action?: React.ReactNode;
}) {
  const toneClass = tone === "success"
    ? "bg-emerald-100 text-emerald-700"
    : tone === "error"
      ? "bg-red-100 text-red-700"
      : "bg-neutral-100 text-neutral-700";

  return (
    <section className="w-full max-w-sm rounded-[2rem] border border-black/10 bg-white p-7 text-center shadow-sm">
      <div className={`mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full ${toneClass}`}>
        {icon}
      </div>
      <p className="font-mono text-xs uppercase tracking-[0.22em] text-neutral-400">Pickla Score</p>
      <h1 className="mt-2 font-display text-4xl font-black text-neutral-950">{title}</h1>
      <p className="mt-4 font-mono text-sm leading-relaxed text-neutral-500">{body}</p>
      {action}
    </section>
  );
}
