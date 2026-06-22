import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { apiGet, apiPost } from "@/lib/api";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

type Lead = {
  name: string | null;
  email: string;
  submitted_interest_at: string | null;
  requested_shares: number | null;
};

export default function InvestMemoPage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lead, setLead] = useState<Lead | null>(null);
  const [shares, setShares] = useState<string>("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("dark");
    document.title = "Pickla Investor Memorandum";
    let meta = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    if (!meta) { meta = document.createElement("meta"); meta.name = "robots"; document.head.appendChild(meta); }
    const prev = meta.content;
    meta.content = "noindex, nofollow, noarchive";
    return () => { meta!.content = prev; };
    if (!token) return;
    (async () => {
      try {
        const res = await apiGet<{ lead: Lead }>("api-investor", "memo", { token });
        setLead(res.lead);
        if (res.lead.requested_shares) setShares(String(res.lead.requested_shares));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  async function submitInterest(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { token, note };
      if (shares) body.requested_shares = Number(shares);
      await apiPost("api-investor", "interest", body);
      toast.success("Interest registered. Thank you.");
      setLead((l) => l ? { ...l, submitted_interest_at: new Date().toISOString(), requested_shares: shares ? Number(shares) : null } : l);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#08090B] flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (error || !lead) {
    return (
      <div className="min-h-screen bg-[#08090B] text-neutral-100 flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-medium tracking-tight">Access denied</h1>
          <p className="mt-3 text-neutral-500 text-sm">{error || "This link is invalid, expired, or has been revoked."}</p>
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
