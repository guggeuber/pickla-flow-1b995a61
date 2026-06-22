import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { toast } from "sonner";
import { Loader2, Copy, Check, X, RefreshCw } from "lucide-react";

type Lead = {
  id: string;
  email: string;
  name: string | null;
  status: "pending" | "approved" | "rejected" | "opened" | "interested";
  approved_at: string | null;
  rejected_at: string | null;
  opened_at: string | null;
  submitted_interest_at: string | null;
  requested_shares: number | null;
  token_expires_at: string | null;
  message: string | null;
  created_at: string;
};

const statusStyles: Record<Lead["status"], string> = {
  pending: "bg-neutral-800 text-neutral-300",
  approved: "bg-blue-900/40 text-blue-300 border border-blue-800",
  opened: "bg-amber-900/40 text-amber-300 border border-amber-800",
  interested: "bg-emerald-900/40 text-emerald-300 border border-emerald-800",
  rejected: "bg-red-900/30 text-red-300 border border-red-900",
};

export default function AdminInvestorPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [issuedLinks, setIssuedLinks] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await apiGet<{ leads: Lead[] }>("api-investor", "leads");
      setLeads(res.leads);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function approve(id: string) {
    setBusyId(id);
    try {
      const res = await apiPost<{ token: string }>("api-investor", "approve", { id });
      const link = `${window.location.origin}/invest/memo/${res.token}`;
      setIssuedLinks((m) => ({ ...m, [id]: link }));
      toast.success("Approved — link generated");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    if (!confirm("Reject this request?")) return;
    setBusyId(id);
    try {
      await apiPost("api-investor", "reject", { id });
      toast.success("Rejected");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke access for this investor? The link will stop working.")) return;
    setBusyId(id);
    try {
      await apiPost("api-investor", "revoke", { id });
      toast.success("Access revoked");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  function copy(id: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-medium tracking-tight">Investor leads</h1>
            <p className="text-sm text-neutral-500 mt-1">Access requests from /invest. Approve to generate a one-link memo URL.</p>
          </div>
          <button onClick={load} className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-neutral-800 hover:bg-neutral-900 text-sm">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-5 h-5 animate-spin text-neutral-500" /></div>
        ) : leads.length === 0 ? (
          <div className="border border-neutral-900 rounded-xl p-16 text-center text-neutral-500 text-sm">
            No investor requests yet.
          </div>
        ) : (
          <div className="space-y-3">
            {leads.map((l) => {
              const issued = issuedLinks[l.id];
              return (
                <div key={l.id} className="rounded-xl border border-neutral-900 bg-neutral-950 p-5">
                  <div className="flex flex-wrap items-start gap-4 justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="font-medium">{l.name || l.email}</div>
                        <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded ${statusStyles[l.status]}`}>{l.status}</span>
                      </div>
                      <div className="text-xs text-neutral-500 mt-1">{l.email} · received {new Date(l.created_at).toLocaleString()}</div>
                      {l.message && <div className="mt-3 text-sm text-neutral-400 border-l-2 border-neutral-800 pl-3 italic">{l.message}</div>}
                      <div className="mt-3 text-xs text-neutral-600 flex flex-wrap gap-x-4 gap-y-1">
                        {l.opened_at && <span>Opened {new Date(l.opened_at).toLocaleString()}</span>}
                        {l.submitted_interest_at && <span>Interest {new Date(l.submitted_interest_at).toLocaleString()}</span>}
                        {l.requested_shares != null && <span>{l.requested_shares.toLocaleString()} shares requested</span>}
                        {l.token_expires_at && <span>Token expires {new Date(l.token_expires_at).toLocaleDateString()}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {l.status === "pending" && (
                        <>
                          <button disabled={busyId === l.id} onClick={() => approve(l.id)} className="h-9 px-3 rounded-md bg-white text-black text-sm font-medium hover:bg-neutral-200 disabled:opacity-50">Approve</button>
                          <button disabled={busyId === l.id} onClick={() => reject(l.id)} className="h-9 px-3 rounded-md border border-neutral-800 text-sm hover:bg-neutral-900 inline-flex items-center gap-1"><X className="w-4 h-4" /> Reject</button>
                        </>
                      )}
                      {(l.status === "approved" || l.status === "opened" || l.status === "interested") && (
                        <button disabled={busyId === l.id} onClick={() => revoke(l.id)} className="h-9 px-3 rounded-md border border-red-900 text-red-300 text-sm hover:bg-red-950">Revoke</button>
                      )}
                    </div>
                  </div>

                  {issued && (
                    <div className="mt-4 p-3 rounded-lg bg-blue-950/30 border border-blue-900">
                      <div className="text-xs text-blue-300 mb-2">One-time access link (shown once — copy now)</div>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-xs bg-black/40 px-3 py-2 rounded overflow-auto whitespace-nowrap">{issued}</code>
                        <button onClick={() => copy(l.id, issued)} className="h-9 px-3 rounded-md bg-white text-black text-sm font-medium inline-flex items-center gap-1">
                          {copied === l.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                          {copied === l.id ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
