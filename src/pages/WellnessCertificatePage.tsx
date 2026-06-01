import { useEffect, useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { Download, Loader2, Printer, Save } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import picklaLogo from "@/assets/pickla-logo.svg";

const FONT_GROTESK = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

type WellnessItem = {
  id: string;
  type: string;
  date: string;
  label: string;
  reference: string;
  amount: number;
};

export default function WellnessCertificatePage() {
  const { user, loading } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const year = Number(searchParams.get("year") || DateTime.now().setZone("Europe/Stockholm").year);
  const [personalIdentityNumber, setPersonalIdentityNumber] = useState("");
  const [employerNote, setEmployerNote] = useState("");
  const years = useMemo(() => {
    const current = DateTime.now().setZone("Europe/Stockholm").year;
    return [current, current - 1, current - 2];
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["wellness-certificate", year],
    enabled: !!user,
    queryFn: () => apiGet("api-bookings", "wellness", { year: String(year) }),
  });

  useEffect(() => {
    if (!data?.customer) return;
    setPersonalIdentityNumber(data.customer.personal_identity_number || "");
    setEmployerNote(data.customer.employer_note || "");
  }, [data?.customer?.personal_identity_number, data?.customer?.employer_note]);

  const saveWellnessProfile = useMutation({
    mutationFn: () => apiPost("api-bookings", "wellness-profile", {
      personal_identity_number: personalIdentityNumber,
      employer_note: employerNote,
    }),
    onSuccess: async () => {
      toast.success("Friskvårdsuppgifter sparade");
      await queryClient.invalidateQueries({ queryKey: ["wellness-certificate"] });
    },
    onError: (error: any) => toast.error(error?.message || "Kunde inte spara"),
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-neutral-300" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth?redirect=/wellness" replace />;

  const items: WellnessItem[] = data?.items || [];
  const money = (amount: number) => `${Number(amount || 0).toLocaleString("sv-SE", { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 })} kr`;
  const printPdf = () => {
    toast.info("Välj Spara som PDF i utskriftsdialogen.");
    window.print();
  };

  return (
    <div className="min-h-[100dvh] bg-[#f7f4ee] px-5 py-6 text-neutral-950 print:bg-white">
      <div className="mx-auto max-w-2xl">
        <div className="mb-5 flex items-center justify-between gap-3 print:hidden">
          <img src={picklaLogo} alt="Pickla" className="h-8 w-auto" />
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-full bg-neutral-950 px-4 py-3 text-sm font-bold text-white"
            style={{ fontFamily: FONT_GROTESK }}
          >
            <Printer className="h-4 w-4" />
            Skriv ut
          </button>
          <button
            onClick={printPdf}
            className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-3 text-sm font-bold text-neutral-950 ring-1 ring-black/10"
            style={{ fontFamily: FONT_GROTESK }}
          >
            <Download className="h-4 w-4" />
            PDF
          </button>
        </div>

        <div className="mb-5 flex gap-2 overflow-x-auto print:hidden">
          {years.map((y) => (
            <button
              key={y}
              onClick={() => setSearchParams({ year: String(y) })}
              className="rounded-full px-4 py-2 text-sm font-bold"
              style={{ background: y === year ? "#111" : "#fff", color: y === year ? "#fff" : "#111", fontFamily: FONT_MONO }}
            >
              {y}
            </button>
          ))}
        </div>

        <main className="rounded-[28px] bg-white p-6 shadow-sm ring-1 ring-black/5 print:rounded-none print:shadow-none print:ring-0">
          <header className="flex items-start justify-between gap-4 border-b border-neutral-200 pb-6">
            <div>
              <p className="text-[10px] uppercase tracking-[0.28em] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
                friskvårdsintyg
              </p>
              <h1 className="mt-2 text-[34px] font-bold leading-none" style={{ fontFamily: FONT_GROTESK }}>
                Pickla {data?.year || year}
              </h1>
              <p className="mt-2 text-sm text-neutral-500" style={{ fontFamily: FONT_MONO }}>
                Utfärdat {data?.issued_at ? DateTime.fromISO(data.issued_at).setZone("Europe/Stockholm").toFormat("d MMM yyyy") : ""}
              </p>
            </div>
            <img src={picklaLogo} alt="Pickla" className="h-7 w-auto" />
          </header>

          {isLoading ? (
            <div className="py-16 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-neutral-300" />
            </div>
          ) : (
            <>
              <section className="grid gap-2 border-b border-neutral-200 py-6 text-sm" style={{ fontFamily: FONT_MONO }}>
                <div className="flex justify-between gap-4">
                  <span className="text-neutral-400">Kund</span>
                  <span className="text-right">{data?.customer?.name || user.email}</span>
                </div>
                {data?.customer?.personal_identity_number && (
                  <div className="flex justify-between gap-4">
                    <span className="text-neutral-400">Personnummer</span>
                    <span>{data.customer.personal_identity_number}</span>
                  </div>
                )}
                {data?.customer?.phone && (
                  <div className="flex justify-between gap-4">
                    <span className="text-neutral-400">Telefon</span>
                    <span>{data.customer.phone}</span>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <span className="text-neutral-400">Period</span>
                  <span>{data?.year || year}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-neutral-400">Typ</span>
                  <span>Motion och friskvård</span>
                </div>
                {data?.customer?.employer_note && (
                  <div className="flex justify-between gap-4">
                    <span className="text-neutral-400">Notering</span>
                    <span className="text-right">{data.customer.employer_note}</span>
                  </div>
                )}
              </section>

              <section className="border-b border-neutral-200 py-6 print:hidden">
                <p className="text-sm font-bold" style={{ fontFamily: FONT_GROTESK }}>Friskvårdsuppgifter</p>
                <p className="mt-1 text-xs leading-relaxed text-neutral-500" style={{ fontFamily: FONT_MONO }}>
                  Personnummer sparas bara för friskvårdsunderlag och visas inte publikt.
                </p>
                <div className="mt-4 grid gap-3">
                  <label className="grid gap-1 text-xs font-bold text-neutral-500" style={{ fontFamily: FONT_MONO }}>
                    Personnummer
                    <input
                      value={personalIdentityNumber}
                      onChange={(event) => setPersonalIdentityNumber(event.target.value)}
                      placeholder="ÅÅÅÅMMDD-XXXX"
                      className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-950 outline-none focus:border-neutral-950"
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-bold text-neutral-500" style={{ fontFamily: FONT_MONO }}>
                    Arbetsgivarnotering
                    <input
                      value={employerNote}
                      onChange={(event) => setEmployerNote(event.target.value)}
                      placeholder="Valfritt, t.ex. Benify/Epassi"
                      className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-950 outline-none focus:border-neutral-950"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => saveWellnessProfile.mutate()}
                    disabled={saveWellnessProfile.isPending}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-neutral-950 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
                    style={{ fontFamily: FONT_GROTESK }}
                  >
                    {saveWellnessProfile.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Spara friskvårdsuppgifter
                  </button>
                </div>
              </section>

              <section className="py-6">
                <div className="grid gap-3">
                  {items.length === 0 ? (
                    <p className="py-8 text-center text-sm text-neutral-400" style={{ fontFamily: FONT_MONO }}>
                      Inga betalda friskvårdsköp hittades för året.
                    </p>
                  ) : items.map((item) => (
                    <div key={`${item.type}-${item.id}`} className="grid grid-cols-[86px_1fr_auto] gap-3 border-b border-neutral-100 pb-3 text-sm last:border-0">
                      <span className="text-neutral-400" style={{ fontFamily: FONT_MONO }}>{item.date}</span>
                      <div>
                        <p className="font-bold" style={{ fontFamily: FONT_GROTESK }}>{item.type}</p>
                        <p className="text-xs text-neutral-500" style={{ fontFamily: FONT_MONO }}>{item.label}</p>
                        <p className="text-[10px] text-neutral-400" style={{ fontFamily: FONT_MONO }}>Ref {item.reference}</p>
                      </div>
                      <span className="font-bold" style={{ fontFamily: FONT_MONO }}>{money(item.amount)}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl bg-[#f7f4ee] p-5 print:bg-neutral-50">
                <div className="flex justify-between text-lg font-bold" style={{ fontFamily: FONT_GROTESK }}>
                  <span>Totalt inkl. moms</span>
                  <span>{money(data?.total_inc_vat || 0)}</span>
                </div>
                <div className="mt-3 grid gap-2 text-sm text-neutral-500" style={{ fontFamily: FONT_MONO }}>
                  <div className="flex justify-between">
                    <span>Varav moms ({data?.vat_rate || 6}%)</span>
                    <span>{money(data?.vat_amount || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Belopp exkl. moms</span>
                    <span>{money(data?.total_ex_vat || 0)}</span>
                  </div>
                </div>
              </section>

              <footer className="mt-6 border-t border-neutral-200 pt-5 text-[11px] leading-relaxed text-neutral-500" style={{ fontFamily: FONT_MONO }}>
                <p className="font-bold text-neutral-700">Pickla Solna AB · Organisationsnummer 5569774481</p>
                <p>Godkänd för F-skatt</p>
                <p>Besöksadress: Pickla Solna Business Park, Svetsarvägen 22, 171 41 Solna</p>
                <p>Postadress: Sjöstadskajen 1, 178 51 Ekerö</p>
                <p>Kontakt: solna@picklaparks.com · 08-83 33 63</p>
              </footer>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
