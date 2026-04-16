import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Calendar, Ticket, LogOut, Loader2, Check, Pencil, Save, Phone, Gift, Copy, Send, Trash2, ShoppingBag, Building2, ChevronRight, Wallet, Clock, QrCode, Zap, CreditCard } from "lucide-react";
import QrCodeCard from "@/components/my/QrCodeCard";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import picklaLogo from "@/assets/pickla-logo.svg";
import { DateTime } from "luxon";

const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

// Brand colors
const RED = "#CC2936";
const DARK_BLUE = "#1a1f3a";
const CREAM = "#faf8f5";
const NEAR_BLACK = "#1a1a1a";
const TEXT_SECONDARY = "#6B7280";
const TEXT_MUTED = "rgba(26,26,26,0.45)";
const CARD_BG = "#FFFFFF";
const CARD_BORDER = "rgba(0,0,0,0.06)";
const GREEN = "#22C55E";

function usePlayerProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["player-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_profiles")
        .select("*")
        .eq("auth_user_id", user!.id)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

function useMyBookings() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-bookings", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("*, venue_courts(name)")
        .eq("user_id", user!.id)
        .order("start_time", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });
}

function useMyPasses() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-passes", user?.id],
    enabled: !!user,
    staleTime: 10000,
    queryFn: () => apiGet("api-day-passes", "my-passes"),
  });
}

function useActiveMembership() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-membership", user?.id],
    enabled: !!user,
    staleTime: 30000,
    queryFn: async () => {
      const { data } = await supabase
        .from("memberships")
        .select("id, tier_id, status, starts_at, expires_at, membership_tiers(name, color, description)")
        .eq("user_id", user!.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      return data;
    },
  });
}

function useCorporateMemberships() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-corporate", user?.id],
    enabled: !!user,
    staleTime: 30000,
    queryFn: () => apiGet("api-corporate", "my"),
  });
}

// Smart suggestion from booking history
function useBookingPattern() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["booking-history", user?.id],
    enabled: !!user,
    staleTime: 60000,
    queryFn: async () => {
      const { data } = await supabase
        .from("bookings")
        .select("start_time")
        .eq("user_id", user!.id)
        .order("start_time", { ascending: false })
        .limit(20);
      return data || [];
    },
  });

  return useMemo(() => {
    if (!data?.length) return null;
    const freq: Record<string, { count: number; weekday: number; hour: number; dayName: string }> = {};
    data.forEach((b: any) => {
      const dt = DateTime.fromISO(b.start_time, { zone: "Europe/Stockholm" });
      const key = `${dt.weekday}-${dt.hour}`;
      if (!freq[key]) {
        freq[key] = { count: 0, weekday: dt.weekday, hour: dt.hour, dayName: dt.setLocale("sv").toFormat("EEEE") };
      }
      freq[key].count++;
    });
    const sorted = Object.values(freq).sort((a, b) => b.count - a.count);
    return sorted[0]?.count >= 2 ? sorted[0] : null;
  }, [data]);
}

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06 } } };
const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } };

function ProfileCard({ profile, user, displayName }: { profile: any; user: any; displayName: string }) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(displayName);
  const [editPhone, setEditPhone] = useState(profile?.phone || "");
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("player_profiles")
      .update({ display_name: editName.trim(), phone: editPhone.trim() })
      .eq("auth_user_id", user.id);
    setSaving(false);
    if (error) {
      toast.error("Kunde inte spara");
    } else {
      toast.success("Uppgifter sparade");
      queryClient.invalidateQueries({ queryKey: ["player-profile"] });
      setEditing(false);
    }
  };

  return (
    <motion.div
      variants={item}
      className="rounded-2xl p-4"
      style={{ background: CARD_BG, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}
    >
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: `${RED}12` }}>
          <span className="text-lg font-bold" style={{ color: RED }}>{displayName.charAt(0).toUpperCase()}</span>
        </div>
        <div className="flex-1">
          {editing ? (
            <div className="flex flex-col gap-2">
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="text-sm rounded-lg px-3 py-1.5 outline-none"
                placeholder="Namn"
                style={{ fontFamily: FONT_HEADING, background: CREAM, border: `1px solid ${CARD_BORDER}`, color: NEAR_BLACK }}
              />
              <div className="flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 shrink-0" style={{ color: TEXT_MUTED }} />
                <input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="text-sm rounded-lg px-3 py-1.5 outline-none flex-1"
                  placeholder="Telefonnummer"
                  style={{ fontFamily: FONT_MONO, background: CREAM, border: `1px solid ${CARD_BORDER}`, color: NEAR_BLACK }}
                />
              </div>
            </div>
          ) : (
            <div>
              <p className="font-semibold text-[15px]" style={{ fontFamily: FONT_HEADING, color: NEAR_BLACK }}>{displayName}</p>
              <p className="text-[11px]" style={{ color: TEXT_MUTED }}>{user.email}</p>
            </div>
          )}
        </div>
        {editing ? (
          <button onClick={handleSave} disabled={saving} className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${RED}10` }}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: TEXT_MUTED }} /> : <Save className="w-4 h-4" style={{ color: RED }} />}
          </button>
        ) : (
          <button
            onClick={() => { setEditName(displayName); setEditPhone(profile?.phone || ""); setEditing(true); }}
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: CREAM }}
          >
            <Pencil className="w-3.5 h-3.5" style={{ color: TEXT_MUTED }} />
          </button>
        )}
      </div>
    </motion.div>
  );
}

function WalletSection() {
  const { data: membership } = useActiveMembership();
  const { data: passes, isLoading: passesLoading } = useMyPasses();
  const { data: corpData } = useCorporateMemberships();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [buying, setBuying] = useState(false);
  const [sharingPassId, setSharingPassId] = useState<string | null>(null);
  const [shareEmail, setShareEmail] = useState("");
  const [sharing, setSharing] = useState(false);
  const [justCreatedToken, setJustCreatedToken] = useState<string | null>(null);

  const membershipTier = (membership as any)?.membership_tiers;
  const activePasses = (passes?.passes || []).filter((p: any) => p.status === "active" && !p.share);
  const sharedPasses = (passes?.passes || []).filter((p: any) => p.share?.status === "pending");
  const allowance = passes?.allowance || { has_membership: false, passes_allowed: 0, passes_remaining: 0 };
  const corpMemberships = corpData?.memberships || [];

  const buildLink = (token: string) => `${window.location.origin}/pass/${token}`;

  const handleBuy = async () => {
    setBuying(true);
    try {
      const result = await apiPost("api-day-passes", "buy", {});
      queryClient.invalidateQueries({ queryKey: ["my-passes"] });
      toast.success(`Dagspass köpt (${result.price} SEK) – betalas i disk`);
    } catch (err: any) {
      toast.error(err.message || "Kunde inte köpa dagspass");
    }
    setBuying(false);
  };

  const handleShare = async (dayPassId: string) => {
    if (!shareEmail.trim()) { toast.error("Ange e-postadress"); return; }
    setSharing(true);
    try {
      const result = await apiPost("api-day-passes", "share", { day_pass_id: dayPassId, recipient_email: shareEmail.trim() });
      setJustCreatedToken(result.token);
      setShareEmail("");
      setSharingPassId(null);
      queryClient.invalidateQueries({ queryKey: ["my-passes"] });
      toast.success("Pass delat!");
    } catch (err: any) {
      toast.error(err.message || "Kunde inte dela pass");
    }
    setSharing(false);
  };

  const handleRevoke = async (shareId: string) => {
    try {
      await apiDelete("api-day-passes", "revoke-share", { id: shareId });
      queryClient.invalidateQueries({ queryKey: ["my-passes"] });
      toast.success("Delning borttagen");
    } catch (err: any) {
      toast.error(err.message || "Kunde inte ta bort delningen");
    }
  };

  const copyLink = (link: string) => {
    navigator.clipboard.writeText(link);
    toast.success("Länk kopierad!");
  };

  return (
    <motion.div variants={item}>
      <div className="flex items-center gap-2 mb-3">
        <Wallet className="w-4 h-4" style={{ color: RED }} />
        <span className="text-[13px] font-bold" style={{ fontFamily: FONT_HEADING, color: NEAR_BLACK }}>Wallet</span>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: CARD_BG, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
        {/* Membership */}
        <div className="p-4" style={{ borderBottom: `1px solid ${CARD_BORDER}` }}>
          {membership ? (
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `${membershipTier?.color || GREEN}15` }}>
                <Check className="w-4 h-4" style={{ color: membershipTier?.color || GREEN }} />
              </div>
              <div className="flex-1">
                <p className="text-[13px] font-bold" style={{ fontFamily: FONT_HEADING, color: NEAR_BLACK }}>
                  {membershipTier?.name || "Medlem"}
                </p>
                <p className="text-[10px]" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>Aktivt medlemskap</p>
              </div>
            </div>
          ) : (
            <button
              onClick={() => navigate("/membership")}
              className="w-full flex items-center gap-3 text-left active:opacity-80 transition-opacity"
            >
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `${RED}10` }}>
                <CreditCard className="w-4 h-4" style={{ color: RED }} />
              </div>
              <div className="flex-1">
                <p className="text-[13px] font-bold" style={{ fontFamily: FONT_HEADING, color: NEAR_BLACK }}>Bli medlem</p>
                <p className="text-[10px]" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>Se medlemskap och priser →</p>
              </div>
            </button>
          )}
        </div>

        {/* Day passes */}
        <div className="p-4" style={{ borderBottom: `1px solid ${CARD_BORDER}` }}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Ticket className="w-3.5 h-3.5" style={{ color: RED }} />
              <span className="text-[12px] font-bold" style={{ fontFamily: FONT_HEADING, color: NEAR_BLACK }}>Dagspass</span>
              {activePasses.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold" style={{ background: `${GREEN}15`, color: GREEN }}>
                  {activePasses.length}
                </span>
              )}
            </div>
            <button
              onClick={handleBuy}
              disabled={buying}
              className="px-3 py-1 rounded-full text-[10px] font-bold active:scale-95 transition-transform"
              style={{ background: DARK_BLUE, color: "#fff", fontFamily: FONT_MONO }}
            >
              {buying ? "..." : "+ Köp"}
            </button>
          </div>

          {allowance.has_membership && allowance.passes_allowed > 0 && (
            <div className="rounded-lg px-2.5 py-1.5 mb-2 flex items-center gap-1.5" style={{ background: `${GREEN}08` }}>
              <Gift className="w-3 h-3" style={{ color: GREEN }} />
              <p className="text-[10px]" style={{ fontFamily: FONT_MONO, color: TEXT_SECONDARY }}>
                <b style={{ color: NEAR_BLACK }}>{allowance.passes_remaining}</b> av {allowance.passes_allowed} gratispass kvar
              </p>
            </div>
          )}

          {/* Just created share link */}
          <AnimatePresence>
            {justCreatedToken && (
              <motion.div
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="rounded-lg p-2.5 flex items-center gap-2 mb-2"
                style={{ background: `${GREEN}08`, border: `1px solid ${GREEN}20` }}
              >
                <Check className="w-3 h-3 shrink-0" style={{ color: GREEN }} />
                <p className="text-[10px] flex-1 truncate" style={{ fontFamily: FONT_MONO, color: TEXT_SECONDARY }}>{buildLink(justCreatedToken)}</p>
                <button onClick={() => copyLink(buildLink(justCreatedToken))} className="shrink-0">
                  <Copy className="w-3.5 h-3.5" style={{ color: GREEN }} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {activePasses.length === 0 && sharedPasses.length === 0 ? (
            <p className="text-[11px] text-center py-1" style={{ color: TEXT_MUTED }}>Inga aktiva dagspass</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {activePasses.map((p: any) => (
                <div key={p.id}>
                  <div className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2 flex-1">
                      <span className="text-[12px] font-medium" style={{ color: NEAR_BLACK }}>Dagspass</span>
                      {p.is_free && <span className="px-1 py-0.5 rounded text-[8px] font-bold" style={{ background: `${GREEN}12`, color: GREEN }}>GRATIS</span>}
                      <span className="text-[10px]" style={{ color: TEXT_MUTED }}>
                        {new Date(p.valid_date).toLocaleDateString("sv-SE", { day: "numeric", month: "short" })}
                      </span>
                    </div>
                    <button
                      onClick={() => { setSharingPassId(sharingPassId === p.id ? null : p.id); setShareEmail(""); setJustCreatedToken(null); }}
                      className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: sharingPassId === p.id ? `${RED}10` : CREAM }}
                    >
                      <Send className="w-3 h-3" style={{ color: sharingPassId === p.id ? RED : TEXT_MUTED }} />
                    </button>
                  </div>
                  <AnimatePresence>
                    {sharingPassId === p.id && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                        <div className="pt-1 pb-2 flex gap-2">
                          <input
                            type="email"
                            placeholder="Vännens e-post"
                            value={shareEmail}
                            onChange={(e) => setShareEmail(e.target.value)}
                            className="flex-1 px-3 py-2 rounded-lg text-[11px] outline-none"
                            style={{ fontFamily: FONT_MONO, background: CREAM, border: `1px solid ${CARD_BORDER}`, color: NEAR_BLACK }}
                          />
                          <button
                            onClick={() => handleShare(p.id)}
                            disabled={sharing}
                            className="px-3 py-2 rounded-lg text-[11px] font-bold active:scale-95 transition-transform disabled:opacity-40"
                            style={{ background: RED, color: "#fff", fontFamily: FONT_MONO }}
                          >
                            {sharing ? "..." : "Dela"}
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
              {sharedPasses.map((p: any) => (
                <div key={p.id} className="flex items-center gap-2 py-1.5">
                  <Send className="w-3 h-3 shrink-0" style={{ color: RED }} />
                  <span className="text-[11px] truncate flex-1" style={{ fontFamily: FONT_MONO, color: TEXT_SECONDARY }}>
                    {p.share?.recipient_email || "Delat pass"}
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[8px] font-bold" style={{ background: `${RED}10`, color: RED }}>Väntande</span>
                  {p.share?.token && (
                    <button onClick={() => copyLink(buildLink(p.share.token))} className="w-6 h-6 rounded flex items-center justify-center" style={{ background: CREAM }}>
                      <Copy className="w-3 h-3" style={{ color: TEXT_MUTED }} />
                    </button>
                  )}
                  {p.share && (
                    <button onClick={() => handleRevoke(p.share.id)} className="w-6 h-6 rounded flex items-center justify-center" style={{ background: "rgba(239,68,68,0.06)" }}>
                      <Trash2 className="w-3 h-3 text-red-400" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Corporate */}
        {corpMemberships.length > 0 && (
          <div className="p-4">
            {corpMemberships.map((m: any) => {
              const account = m.corporate_accounts;
              const pkg = corpData?.packages?.find((p: any) => p.corporate_account_id === account?.id);
              const remaining = pkg ? pkg.total_hours - pkg.used_hours : null;
              return (
                <button
                  key={m.id}
                  onClick={() => m.role === "admin" && navigate(`/corp/dashboard?id=${account?.id}`)}
                  className="w-full flex items-center gap-3 text-left active:opacity-80 transition-opacity"
                >
                  <Building2 className="w-4 h-4" style={{ color: DARK_BLUE }} />
                  <div className="flex-1">
                    <p className="text-[12px] font-medium" style={{ color: NEAR_BLACK }}>{account?.company_name || "Företag"}</p>
                    <p className="text-[10px]" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
                      {m.role === "admin" ? "Admin" : "Medlem"}{remaining !== null && ` · ${remaining}h kvar`}
                    </p>
                  </div>
                  {m.role === "admin" && <ChevronRight className="w-3.5 h-3.5" style={{ color: TEXT_MUTED }} />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function ActivitiesSection() {
  const { data: bookings } = useMyBookings();
  const [tab, setTab] = useState<"upcoming" | "history">("upcoming");

  const now = new Date();
  const upcoming = (bookings || []).filter(
    (b) => (b.status === "confirmed" || b.status === "pending") && new Date(b.end_time) > now
  );
  const history = (bookings || []).filter(
    (b) => new Date(b.end_time) <= now || b.status === "cancelled"
  );

  const items = tab === "upcoming" ? upcoming : history;

  return (
    <motion.div variants={item}>
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="w-4 h-4" style={{ color: RED }} />
        <span className="text-[13px] font-bold" style={{ fontFamily: FONT_HEADING, color: NEAR_BLACK }}>Aktiviteter</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-3 p-0.5 rounded-xl" style={{ background: "rgba(0,0,0,0.04)" }}>
        {(["upcoming", "history"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 py-2 rounded-lg text-[11px] font-bold transition-all"
            style={{
              background: tab === t ? CARD_BG : "transparent",
              color: tab === t ? NEAR_BLACK : TEXT_MUTED,
              fontFamily: FONT_MONO,
              boxShadow: tab === t ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
            }}
          >
            {t === "upcoming" ? `Kommande (${upcoming.length})` : `Historik (${history.length})`}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl p-5 text-center" style={{ background: CARD_BG, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
          <p className="text-[12px]" style={{ color: TEXT_MUTED }}>
            {tab === "upcoming" ? "Inga kommande bokningar" : "Ingen historik ännu"}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.slice(0, 8).map((b) => {
            const dt = DateTime.fromISO(b.start_time, { zone: "Europe/Stockholm" });
            const endDt = DateTime.fromISO(b.end_time, { zone: "Europe/Stockholm" });
            const isToday = dt.hasSame(DateTime.now().setZone("Europe/Stockholm"), "day");
            return (
              <div
                key={b.id}
                className="rounded-xl p-3 flex items-center gap-3"
                style={{ background: CARD_BG, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-medium" style={{ color: NEAR_BLACK }}>
                      {(b as any).venue_courts?.name || "Bana"}
                    </p>
                    {isToday && tab === "upcoming" && (
                      <span className="px-1.5 py-0.5 rounded text-[8px] font-bold" style={{ background: `${GREEN}15`, color: GREEN }}>IDAG</span>
                    )}
                  </div>
                  <p className="text-[11px]" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
                    {dt.setLocale("sv").toFormat("ccc d LLL")} · {dt.toFormat("HH:mm")}–{endDt.toFormat("HH:mm")}
                  </p>
                </div>
                {tab === "upcoming" && b.access_code && (
                  <div className="text-center">
                    <p className="text-[16px] font-bold tracking-wider" style={{ fontFamily: FONT_MONO, color: RED }}>
                      {b.access_code}
                    </p>
                    <p className="text-[8px] uppercase" style={{ color: TEXT_MUTED }}>kod</p>
                  </div>
                )}
                {tab === "history" && (
                  <span className="text-[11px]" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
                    {b.total_price ? `${b.total_price} kr` : "—"}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

const MyPage = () => {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const venueSlug = searchParams.get("v") || "pickla-arena-sthlm";

  const { data: profile } = usePlayerProfile();
  const pattern = useBookingPattern();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: CREAM }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: RED }} />
      </div>
    );
  }

  if (!user) return <Navigate to={`/auth?redirect=/my&v=${venueSlug}`} replace />;

  const displayName = profile?.display_name || user.email?.split("@")[0] || "Spelare";

  return (
    <div className="min-h-screen" style={{ background: CREAM }}>
      {/* ═══ STICKY TOP ═══ */}
      <header
        className="fixed top-0 left-0 right-0 z-40 px-5 pt-[env(safe-area-inset-top,12px)] pb-3 flex items-end justify-between"
        style={{ background: `linear-gradient(to bottom, ${CREAM}f2 0%, ${CREAM}b3 50%, transparent 100%)` }}
      >
        <div className="pt-2">
          <img src={picklaLogo} alt="Pickla" className="h-7 w-auto" />
        </div>
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={async () => { await signOut(); navigate(`/?v=${venueSlug}`); }}
          className="w-8 h-8 rounded-lg flex items-center justify-center mb-1"
          style={{ background: CARD_BG, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
        >
          <LogOut className="w-3.5 h-3.5" style={{ color: TEXT_MUTED }} />
        </motion.button>
      </header>

      {/* ═══ MAIN CONTENT ═══ */}
      <main className="pt-24 px-5 pb-28">
        <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col gap-4 max-w-md mx-auto">
          {/* Smart greeting + suggestion */}
          <motion.div variants={item}>
            <p className="text-[20px] font-bold" style={{ fontFamily: FONT_HEADING, color: NEAR_BLACK }}>
              Hej {displayName.split(" ")[0]} 👋
            </p>
            {pattern && (
              <button
                onClick={() => navigate("/book")}
                className="mt-2 w-full rounded-2xl p-3 flex items-center gap-3 text-left active:scale-[0.98] transition-transform"
                style={{ background: `${RED}08`, border: `1.5px solid ${RED}18` }}
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${RED}12` }}>
                  <Zap className="w-4 h-4" style={{ color: RED }} />
                </div>
                <div className="flex-1">
                  <p className="text-[12px] font-bold" style={{ fontFamily: FONT_GROTESK, color: NEAR_BLACK }}>
                    Din vanliga {pattern.dayName} {String(pattern.hour).padStart(2, "0")}:00 är ledig
                  </p>
                  <p className="text-[10px]" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>Tryck för att boka</p>
                </div>
              </button>
            )}
          </motion.div>

          {/* Quick actions */}
          <motion.div variants={item} className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
            {[
              { label: "+ Boka bana", to: "/book" },
              { label: "Köp dagspass", to: "/membership" },
              { label: "Aktiviteter", to: "/community" },
            ].map((a) => (
              <button
                key={a.label}
                onClick={() => navigate(a.to)}
                className="shrink-0 px-4 py-2 rounded-full text-[11px] font-bold whitespace-nowrap active:scale-95 transition-transform"
                style={{ background: DARK_BLUE, color: "#fff", fontFamily: FONT_MONO }}
              >
                {a.label}
              </button>
            ))}
          </motion.div>

          {/* Profile card */}
          <ProfileCard profile={profile} user={user} displayName={displayName} />

          {/* Wallet */}
          <WalletSection />

          {/* Activities */}
          <ActivitiesSection />

          {/* QR Code */}
          <QrCodeCard userId={user.id} displayName={displayName} />
        </motion.div>
      </main>

      {/* ═══ FIXED BOTTOM NAV ═══ */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-between px-6 pb-8 pt-12"
        style={{ background: `linear-gradient(to top, ${CREAM}f8 0%, ${CREAM}cc 40%, ${CREAM}4d 70%, transparent 100%)` }}
      >
        <a
          href="https://chat.whatsapp.com/HL1XcYaNFSuE56q7MqCpdw"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[13px] font-bold underline underline-offset-4 active:opacity-60 transition-opacity"
          style={{ fontFamily: FONT_MONO, color: NEAR_BLACK, textDecorationColor: CARD_BORDER }}
        >
          chat
        </a>
        <button
          onClick={() => navigate("/play")}
          className="text-[13px] font-bold underline underline-offset-4 active:opacity-60 transition-opacity"
          style={{ fontFamily: FONT_MONO, color: NEAR_BLACK, textDecorationColor: CARD_BORDER }}
        >
          play
        </button>
        <span className="text-[13px] font-bold underline underline-offset-4" style={{ fontFamily: FONT_MONO, color: RED, textDecorationColor: RED }}>
          me
        </span>
      </nav>
    </div>
  );
};

export default MyPage;
