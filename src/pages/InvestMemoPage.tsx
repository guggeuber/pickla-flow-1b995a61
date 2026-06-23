import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { toast } from "sonner";
import { Loader2 } from "lucide-react";

type Lead = {
  name: string | null;
  email: string;
  submitted_interest_at: string | null;
  requested_shares: number | null;
};

type MemoLoadState =
  | { kind: "idle" | "loading" }
  | { kind: "access_denied"; message: string }
  | { kind: "network_error"; message: string }
  | { kind: "invalid_response"; message: string };

const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const PROJECT_ID = String(import.meta.env.VITE_SUPABASE_PROJECT_ID || "").trim();
const FUNCTIONS_BASE_URL = SUPABASE_URL || (PROJECT_ID ? `https://${PROJECT_ID}.supabase.co` : "");

function investorFunctionUrl(endpoint: "memo" | "interest") {
  if (!FUNCTIONS_BASE_URL) throw new Error("Investor API is not configured.");
  return `${FUNCTIONS_BASE_URL}/functions/v1/api-investor/${endpoint}`;
}

function isLead(value: unknown): value is Lead {
  const lead = value as Partial<Lead> | null;
  return Boolean(
    lead &&
    typeof lead === "object" &&
    typeof lead.email === "string" &&
    (lead.name === null || typeof lead.name === "string") &&
    (lead.submitted_interest_at === null || typeof lead.submitted_interest_at === "string") &&
    (lead.requested_shares === null || typeof lead.requested_shares === "number")
  );
}

async function fetchMemo(token: string, signal: AbortSignal): Promise<Lead> {
  const url = new URL(investorFunctionUrl("memo"));
  url.searchParams.set("token", token);

  const res = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
    signal,
    headers: {
      Accept: "application/json",
    },
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message = typeof json?.error === "string" ? json.error : `Access denied (${res.status})`;
    throw Object.assign(new Error(message), { status: res.status, expected: res.status === 401 || res.status === 403 || res.status === 410 });
  }

  if (json?.ok !== true || !isLead(json.lead)) {
    throw Object.assign(new Error("Unexpected memo response shape."), { response: json, invalidShape: true });
  }

  return json.lead;
}

async function submitMemoInterest(body: Record<string, unknown>) {
  const res = await fetch(investorFunctionUrl("interest"), {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : `API error ${res.status}`);
  }
  return json;
}

export default function InvestMemoPage() {
  const { token } = useParams<{ token: string }>();
  const [loadState, setLoadState] = useState<MemoLoadState>({ kind: "loading" });
  const [lead, setLead] = useState<Lead | null>(null);
  const [shares, setShares] = useState<string>("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("dark");
    document.title = "Pickla Investor Memorandum";
    let meta = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    const created = !meta;
    if (!meta) { meta = document.createElement("meta"); meta.name = "robots"; document.head.appendChild(meta); }
    const prev = meta.content;
    meta.content = "noindex, nofollow, noarchive";

    if (!token) {
      setLoadState({ kind: "access_denied", message: "Missing access token." });
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      if (!cancelled) {
        controller.abort();
        setLoadState({ kind: "network_error", message: "Request timed out. Please try again." });
      }
    }, 15000);

    (async () => {
      setLoadState({ kind: "loading" });
      setLead(null);
      try {
        const nextLead = await fetchMemo(token, controller.signal);
        if (cancelled) return;
        setLead(nextLead);
        setLoadState({ kind: "idle" });
        if (nextLead.requested_shares) setShares(String(nextLead.requested_shares));
      } catch (e) {
        if (cancelled) return;
        const err = e as Error & { status?: number; expected?: boolean; invalidShape?: boolean; response?: unknown; name?: string };
        if (err.name === "AbortError") {
          setLoadState({ kind: "network_error", message: "Request timed out. Please try again." });
        } else if (err.invalidShape) {
          console.error("Unexpected investor memo response shape", err.response);
          setLoadState({ kind: "invalid_response", message: "The memo API returned an unexpected response. Please contact Pickla for a fresh link." });
        } else if (err.expected || err.status === 401 || err.status === 403 || err.status === 410) {
          setLoadState({ kind: "access_denied", message: err.message || "This link is invalid, expired, or has been revoked." });
        } else {
          console.error("Investor memo failed unexpectedly", err);
          setLoadState({ kind: "network_error", message: err.message || "Failed to load memo. Please try again." });
        }
      } finally {
        if (!cancelled) {
          window.clearTimeout(timeoutId);
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeoutId);
      if (created && meta?.parentNode) meta.parentNode.removeChild(meta);
      else if (meta) meta.content = prev;
    };
  }, [token]);

  async function submitInterest(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { token, note };
      if (shares) body.requested_shares = Number(shares);
      await submitMemoInterest(body);
      toast.success("Interest registered. Thank you.");
      setLead((l) => l ? { ...l, submitted_interest_at: new Date().toISOString(), requested_shares: shares ? Number(shares) : null } : l);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loadState.kind === "loading") {
    return (
      <div className="min-h-screen bg-[#08090B] flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (loadState.kind !== "idle" || !lead) {
    const isAccessDenied = loadState.kind === "access_denied";
    return (
      <div className="min-h-screen bg-[#08090B] text-neutral-100 flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-medium tracking-tight">{isAccessDenied ? "Access denied" : "Memo unavailable"}</h1>
          <p className="mt-3 text-neutral-500 text-sm">
            {loadState.message || "This link is invalid, expired, or has been revoked."}
          </p>
          {!isAccessDenied && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 inline-flex h-10 items-center justify-center rounded-lg border border-neutral-800 px-4 text-sm font-medium text-neutral-200 hover:bg-neutral-900"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  const submitted = !!lead.submitted_interest_at;

  return (
    <div className="min-h-screen bg-[#08090B] text-neutral-100 antialiased">



      <header className="px-6 py-6 max-w-3xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2 font-medium tracking-tight">
          <div className="h-7 w-7 rounded-md bg-gradient-to-br from-neutral-100 to-neutral-400" />
          <span>Pickla</span>
        </div>
        <span className="text-[10px] uppercase tracking-[0.2em] text-neutral-600">Confidential · {lead.email}</span>
      </header>

      <main className="max-w-3xl mx-auto px-6 pb-32">
        <section className="pt-12 pb-16 border-b border-neutral-900">
          <p className="text-xs uppercase tracking-[0.2em] text-neutral-500 mb-4">Investor memorandum</p>
          <h1 className="text-4xl sm:text-5xl font-medium tracking-tight leading-tight">
            {lead.name ? `${lead.name},` : "Welcome."} this is the case for Pickla.
          </h1>
          <p className="mt-6 text-neutral-400 leading-relaxed">
            This memo is shared privately. It is not an offer of securities, and it may not be redistributed without written consent from Pickla Solna AB.
          </p>
        </section>

        <Section kicker="01 · Vision" title="The operating system for social sports">
          Padel scaled because it was easier to play than tennis. Pickleball is now doing the same — faster, cheaper, more social. The next decade will produce a new category of hybrid social sports venues. The winning company will not own all of them. It will run beneath them.
        </Section>

        <Section kicker="02 · Today" title="A live, profitable surface">
          Pickla Arena Stockholm in Solna runs pickleball, Stockholm Dart Arena (19 boards), events, F&B and a community hub. Real venue. Real customers. Real data. The OS is being hardened on our own floor before it scales to others.
        </Section>

        <Section kicker="03 · Product" title="One stack, many surfaces">
          Booking, memberships, events, check-in (QR + self-serve), live operations, community feed, crews, ladders, AI-assisted operations and partner/affiliate flows. Built mobile-first, iPad-native at the desk, designed for non-technical operators.
        </Section>

        <Section kicker="04 · Traction" title="What's working">
          Active venue, repeat membership cohort, recurring open play and group sessions, event sales pipeline, and a Hub used by both staff and players daily. Detailed traction figures shared on request — never on a public page.
        </Section>

        <Section kicker="05 · Team" title="Operators, not tourists">
          The founding team runs the venue, ships the software, sells events, and answers customer DMs. Hospitality, sports, software, growth. Details and references available on request.
        </Section>

        <Section kicker="06 · Future" title="Hosts, ambassadors, affiliates, venues">
          The model expands from owned venues to a network: independent hosts running sessions, ambassadors driving community, affiliates booking corporate events, and partner venues running on the Pickla OS — with AI in the operations loop.
        </Section>

        <Section kicker="07 · Risk" title="What could go wrong">
          Category competition, venue economics, hiring, AI infrastructure dependence, regulatory shifts on payments/F&B, and execution risk on multi-venue scaling. We treat these openly with investors and address each in diligence.
        </Section>

        <Section kicker="08 · Offer" title="Details shared in diligence">
          Round size, valuation, instrument, lead status, runway and use of funds are discussed under NDA. Reach out via the form below to start a conversation.
        </Section>

        <section id="interest" className="mt-20 rounded-2xl border border-neutral-800 bg-neutral-950 p-8">
          <p className="text-xs uppercase tracking-[0.2em] text-neutral-500 mb-3">Register interest</p>
          <h3 className="text-2xl font-medium tracking-tight">Want to go deeper?</h3>
          <p className="mt-3 text-sm text-neutral-500">
            Register non-binding interest. We'll follow up with the full data room, financials and offer details.
          </p>

          {submitted ? (
            <div className="mt-6 rounded-lg border border-neutral-800 bg-[#0B0C0E] p-4">
              <div className="text-sm text-neutral-200">Interest registered{lead.requested_shares ? ` · ${lead.requested_shares.toLocaleString()} shares` : ""}.</div>
              <div className="mt-1 text-xs text-neutral-500">We'll be in touch within a few business days.</div>
            </div>
          ) : (
            <form onSubmit={submitInterest} className="mt-6 space-y-3">
              <div>
                <label className="text-xs text-neutral-500">Indicative number of shares (optional)</label>
                <input
                  type="number"
                  min={0}
                  value={shares}
                  onChange={(e) => setShares(e.target.value)}
                  placeholder="e.g. 1000"
                  className="mt-1 w-full h-12 px-4 rounded-lg bg-[#0B0C0E] border border-neutral-800 focus:border-neutral-600 outline-none text-[16px]"
                />
              </div>
              <div>
                <label className="text-xs text-neutral-500">Note (optional)</label>
                <textarea
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Fund, ticket size, timing"
                  className="mt-1 w-full px-4 py-3 rounded-lg bg-[#0B0C0E] border border-neutral-800 focus:border-neutral-600 outline-none text-[16px] resize-none"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center justify-center h-12 px-6 rounded-lg bg-white text-black font-medium hover:bg-neutral-200 transition disabled:opacity-50"
              >
                {submitting ? "Sending…" : "Register interest"}
              </button>
            </form>
          )}
        </section>
      </main>

      <footer className="border-t border-neutral-900 py-10 px-6 text-xs text-neutral-600 text-center">
        Confidential · Pickla Solna AB · 556977-4481 · Do not redistribute.
      </footer>
    </div>
  );
}

function Section({ kicker, title, children }: { kicker: string; title: string; children: React.ReactNode }) {
  return (
    <section className="py-12 border-b border-neutral-900">
      <div className="text-xs uppercase tracking-[0.2em] text-neutral-500 mb-3">{kicker}</div>
      <h2 className="text-2xl sm:text-3xl font-medium tracking-tight">{title}</h2>
      <p className="mt-4 text-neutral-400 leading-relaxed">{children}</p>
    </section>
  );
}
