import { useEffect, useState } from "react";

import { apiPost } from "@/lib/api";
import { toast } from "sonner";

const sections = [
  {
    kicker: "Today",
    title: "A category-defining venue",
    body: "Pickla Arena Stockholm runs pickleball, Stockholm Dart Arena, events, F&B and a live community — under one operating system.",
  },
  {
    kicker: "The thesis",
    title: "Social sports is the next category",
    body: "Padel proved demand. Pickleball is accelerating globally. Dart, shuffleboard and hybrid venues are next. The winners will not be a chain — they will be the operating layer beneath them.",
  },
  {
    kicker: "What we are building",
    title: "The operating system for social sports",
    body: "Booking, memberships, events, check-in, community, AI-assisted operations. One stack that scales from a single venue to networks of hosts, ambassadors, affiliates and franchises.",
  },
];

const pillars = [
  ["Pickleball", "Courts, leagues, ladders, open play."],
  ["Stockholm Dart Arena", "19 boards. Scoring, queues, broadcast."],
  ["Events", "Corporate, private, tournaments. Sales OS."],
  ["F&B", "Integrated bar, restaurant, member tabs."],
  ["Community", "Crews, feeds, signals, social proof."],
  ["Hosts & Ambassadors", "Distributed supply, low CAC."],
  ["Affiliates & Venues", "Network effects across cities."],
  ["AI Operations", "Pricing, staffing, retention, ops."],
];

export default function InvestPage() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("dark");
    document.title = "Pickla — Investor access";
    let meta = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    if (!meta) { meta = document.createElement("meta"); meta.name = "robots"; document.head.appendChild(meta); }
    const prev = meta.content;
    meta.content = "noindex, nofollow";
    return () => { meta!.content = prev; };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setSubmitting(true);
    try {
      await apiPost("api-investor", "request", { email, name, message });
      setDone(true);
      toast.success("Request received. We'll be in touch.");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#08090B] text-neutral-100 antialiased selection:bg-neutral-200 selection:text-black">

      <header className="px-6 py-6 flex items-center justify-between max-w-6xl mx-auto">
        <div className="flex items-center gap-2 font-medium tracking-tight">
          <div className="h-7 w-7 rounded-md bg-gradient-to-br from-neutral-100 to-neutral-400" />
          <span>Pickla</span>
        </div>
        <span className="text-xs text-neutral-500 uppercase tracking-widest">Investor preview</span>
      </header>

      <main className="max-w-6xl mx-auto px-6 pb-32">
        {/* Hero */}
        <section className="pt-16 sm:pt-28 pb-24 border-b border-neutral-900">
          <p className="text-xs uppercase tracking-[0.2em] text-neutral-500 mb-6">Series Seed · 2026</p>
          <h1 className="text-4xl sm:text-6xl font-medium tracking-tight leading-[1.05] max-w-3xl">
            The operating system for social sports communities.
          </h1>
          <p className="mt-8 text-lg text-neutral-400 max-w-2xl leading-relaxed">
            Pickla is not a single pickleball venue. We are building the infrastructure that lets the next generation of social sports — pickleball, dart, padel, hybrid — run as a single network.
          </p>

          <div className="mt-12 grid sm:grid-cols-3 gap-px bg-neutral-900 rounded-xl overflow-hidden border border-neutral-900">
            {[
              ["1", "Live venue", "Pickleball + Stockholm Dart Arena + F&B"],
              ["2", "One OS", "Booking, events, memberships, community"],
              ["3", "Network", "Hosts, ambassadors, affiliates, venues"],
            ].map(([n, t, d]) => (
              <div key={n} className="bg-[#0B0C0E] p-6">
                <div className="text-neutral-600 text-xs tracking-widest">0{n}</div>
                <div className="mt-3 font-medium">{t}</div>
                <div className="mt-1 text-sm text-neutral-500">{d}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Narrative sections */}
        <section className="py-24 space-y-24 border-b border-neutral-900">
          {sections.map((s) => (
            <div key={s.title} className="grid sm:grid-cols-12 gap-8">
              <div className="sm:col-span-3 text-xs uppercase tracking-[0.2em] text-neutral-500">{s.kicker}</div>
              <div className="sm:col-span-9 max-w-2xl">
                <h2 className="text-2xl sm:text-3xl font-medium tracking-tight">{s.title}</h2>
                <p className="mt-4 text-neutral-400 leading-relaxed">{s.body}</p>
              </div>
            </div>
          ))}
        </section>

        {/* Pillars */}
        <section className="py-24 border-b border-neutral-900">
          <h2 className="text-2xl sm:text-3xl font-medium tracking-tight max-w-xl">
            One stack. Many surfaces.
          </h2>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-px bg-neutral-900 rounded-xl overflow-hidden border border-neutral-900">
            {pillars.map(([t, d]) => (
              <div key={t} className="bg-[#0B0C0E] p-6">
                <div className="font-medium">{t}</div>
                <div className="mt-2 text-sm text-neutral-500 leading-relaxed">{d}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Request access */}
        <section id="request" className="py-24">
          <div className="max-w-xl">
            <p className="text-xs uppercase tracking-[0.2em] text-neutral-500 mb-4">Investor access</p>
            <h2 className="text-3xl sm:text-4xl font-medium tracking-tight">Request the memo.</h2>
            <p className="mt-4 text-neutral-400">
              The full investor memorandum — vision, traction, team, financials and offer — is shared privately with vetted investors. Leave your email below and we'll get back to you.
            </p>

            {done ? (
              <div className="mt-10 rounded-xl border border-neutral-800 bg-neutral-950 p-6">
                <div className="text-neutral-200 font-medium">Request received.</div>
                <div className="mt-1 text-sm text-neutral-500">We review every request manually. You'll hear from us shortly.</div>
              </div>
            ) : (
              <form onSubmit={submit} className="mt-10 space-y-3">
                <input
                  type="email"
                  required
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-12 px-4 rounded-lg bg-neutral-950 border border-neutral-800 focus:border-neutral-600 outline-none text-[16px]"
                />
                <input
                  type="text"
                  placeholder="Name (optional)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full h-12 px-4 rounded-lg bg-neutral-950 border border-neutral-800 focus:border-neutral-600 outline-none text-[16px]"
                />
                <textarea
                  placeholder="A short note (optional) — fund, ticket size, background"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-3 rounded-lg bg-neutral-950 border border-neutral-800 focus:border-neutral-600 outline-none text-[16px] resize-none"
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="mt-2 inline-flex items-center justify-center h-12 px-6 rounded-lg bg-white text-black font-medium hover:bg-neutral-200 transition disabled:opacity-50"
                >
                  {submitting ? "Sending…" : "Request investor access"}
                </button>
                <p className="text-xs text-neutral-600 pt-2">
                  By submitting you agree to be contacted about Pickla's funding round. No financial details are shared on this page.
                </p>
              </form>
            )}
          </div>
        </section>
      </main>

      <footer className="border-t border-neutral-900 py-10 px-6 text-xs text-neutral-600 text-center">
        © Pickla Solna AB · 556977-4481 · This page contains forward-looking statements and is not an offer of securities.
      </footer>
    </div>
  );
}
