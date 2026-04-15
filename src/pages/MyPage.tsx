import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Calendar, Ticket, LogOut, Loader2, Check, Pencil, Save, Phone, Gift, Copy, Send, Trash2, ShoppingBag, Building2, ChevronRight } from "lucide-react";
import QrCodeCard from "@/components/my/QrCodeCard";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import picklaLogo from "@/assets/pickla-logo.svg";

const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

// Brand colors for player-facing light theme
const BLUE = "#0066FF";
const BLUE_LIGHT = "rgba(0,102,255,0.08)";
const BLUE_BORDER = "rgba(0,102,255,0.15)";
const GREEN = "#22C55E";
const GREEN_LIGHT = "rgba(34,197,94,0.08)";
const GREEN_BORDER = "rgba(34,197,94,0.15)";
const TEXT_PRIMARY = "#111827";
const TEXT_SECONDARY = "#6B7280";
const TEXT_MUTED = "#9CA3AF";
const CARD_BG = "#FFFFFF";
const CARD_BORDER = "#E5E7EB";
const PAGE_BG = "#F8FAFC";

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
        .limit(10);
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

function CorporateSection() {
  const { data } = useCorporateMemberships();
  const navigate = useNavigate();

  if (!data?.memberships?.length) return null;

  return (
    <motion.div variants={item}>
      <div className="flex items-center gap-2 mb-2">
        <Building2 className="w-4 h-4" style={{ color: BLUE }} />
        <span className="text-sm font-semibold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>Företag</span>
      </div>
      <div className="flex flex-col gap-2">
        {data.memberships.map((m: any) => {
          const account = m.corporate_accounts;
          const pkg = data.packages?.find((p: any) => p.corporate_account_id === account?.id);
          const remaining = pkg ? pkg.total_hours - pkg.used_hours : null;

          return (
            <button
              key={m.id}
              onClick={() => {
                if (m.role === 'admin') {
                  navigate(`/corp/dashboard?id=${account?.id}`);
                }
              }}
              className="rounded-xl p-3 flex items-center justify-between text-left active:scale-[0.98] transition-transform"
              style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}` }}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: BLUE_LIGHT }}>
                  <Building2 className="w-4 h-4" style={{ color: BLUE }} />
                </div>
                <div>
                  <p className="text-sm font-medium" style={{ color: TEXT_PRIMARY }}>{account?.company_name || "Företag"}</p>
                  <p className="text-[11px]" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
                    {m.role === 'admin' ? 'Admin' : 'Medlem'}
                    {remaining !== null && ` · ${remaining}h kvar`}
                  </p>
                </div>
              </div>
              {m.role === 'admin' && <ChevronRight className="w-4 h-4" style={{ color: TEXT_MUTED }} />}
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08 } } };
const item = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } };

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
      className="rounded-2xl p-5"
      style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}`, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center"
          style={{ background: BLUE_LIGHT }}
        >
          <span className="text-lg font-bold" style={{ color: BLUE }}>
            {displayName.charAt(0).toUpperCase()}
          </span>
        </div>
        <div className="flex-1">
          {editing ? (
            <div className="flex flex-col gap-2">
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="text-sm rounded-lg px-3 py-1.5 outline-none"
                placeholder="Namn"
                style={{ fontFamily: FONT_HEADING, background: PAGE_BG, border: `1px solid ${CARD_BORDER}`, color: TEXT_PRIMARY }}
              />
              <div className="flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 shrink-0" style={{ color: TEXT_MUTED }} />
                <input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="text-sm rounded-lg px-3 py-1.5 outline-none flex-1"
                  placeholder="Telefonnummer"
                  style={{ fontFamily: FONT_MONO, background: PAGE_BG, border: `1px solid ${CARD_BORDER}`, color: TEXT_PRIMARY }}
                />
              </div>
            </div>
          ) : (
            <div>
              <p className="font-semibold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>{displayName}</p>
              <p className="text-xs" style={{ color: TEXT_MUTED }}>{user.email}</p>
              {profile?.phone && (
                <p className="text-xs mt-0.5" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>{profile.phone}</p>
              )}
            </div>
          )}
        </div>
        {editing ? (
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={handleSave}
            disabled={saving}
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: BLUE_LIGHT }}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: TEXT_MUTED }} /> : <Save className="w-4 h-4" style={{ color: BLUE }} />}
          </motion.button>
        ) : (
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => { setEditName(displayName); setEditPhone(profile?.phone || ""); setEditing(true); }}
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: PAGE_BG, border: `1px solid ${CARD_BORDER}` }}
          >
            <Pencil className="w-4 h-4" style={{ color: TEXT_MUTED }} />
          </motion.button>
        )}
      </div>
      {profile && !editing && (
        <div className="flex gap-4 mt-4 pt-3" style={{ borderTop: `1px solid ${CARD_BORDER}` }}>
          <div className="text-center flex-1">
            <p className="text-lg font-bold" style={{ color: TEXT_PRIMARY }}>{profile.total_matches || 0}</p>
            <p className="text-[10px] uppercase tracking-wide" style={{ color: TEXT_MUTED }}>Matcher</p>
          </div>
          <div className="text-center flex-1">
            <p className="text-lg font-bold" style={{ color: TEXT_PRIMARY }}>{profile.total_wins || 0}</p>
            <p className="text-[10px] uppercase tracking-wide" style={{ color: TEXT_MUTED }}>Vinster</p>
          </div>
          <div className="text-center flex-1">
            <p className="text-lg font-bold" style={{ color: BLUE }}>{profile.pickla_rating || 1000}</p>
            <p className="text-[10px] uppercase tracking-wide" style={{ color: TEXT_MUTED }}>Rating</p>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function DayPassSection() {
  const { data, isLoading } = useMyPasses();
  const queryClient = useQueryClient();
  const [buying, setBuying] = useState(false);
  const [sharingPassId, setSharingPassId] = useState<string | null>(null);
  const [shareEmail, setShareEmail] = useState("");
  const [sharing, setSharing] = useState(false);
  const [justCreatedToken, setJustCreatedToken] = useState<string | null>(null);

  const passes = data?.passes || [];
  const allowance = data?.allowance || { has_membership: false, passes_allowed: 0, passes_remaining: 0 };

  const activePasses = passes.filter((p: any) => p.status === 'active' && !p.share);
  const sharedPasses = passes.filter((p: any) => p.share?.status === 'pending');

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
      const result = await apiPost("api-day-passes", "share", {
        day_pass_id: dayPassId,
        recipient_email: shareEmail.trim(),
      });
      setJustCreatedToken(result.token);
      setShareEmail("");
      setSharingPassId(null);
      queryClient.invalidateQueries({ queryKey: ["my-passes"] });
      toast.success("Pass delat! Kopiera länken och skicka till din vän.");
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

  if (isLoading) {
    return (
      <motion.div variants={item} className="flex justify-center py-4">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: TEXT_MUTED }} />
      </motion.div>
    );
  }

  return (
    <motion.div variants={item}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Ticket className="w-4 h-4" style={{ color: BLUE }} />
          <span className="text-sm font-semibold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>Mina dagspass</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: BLUE_LIGHT, color: BLUE }}>
            {activePasses.length}
          </span>
        </div>
      </div>

      {/* Member allowance info */}
      {allowance.has_membership && allowance.passes_allowed > 0 && (
        <div className="rounded-xl px-3 py-2 mb-3 flex items-center gap-2" style={{ background: GREEN_LIGHT, border: `1px solid ${GREEN_BORDER}` }}>
          <Gift className="w-3.5 h-3.5 shrink-0" style={{ color: GREEN }} />
          <p className="text-[11px]" style={{ fontFamily: FONT_MONO, color: TEXT_SECONDARY }}>
            <span className="font-bold" style={{ color: TEXT_PRIMARY }}>{allowance.passes_remaining}</span> av {allowance.passes_allowed} gratispass kvar denna månad
          </p>
        </div>
      )}

      {/* Buy button */}
      <button
        onClick={handleBuy}
        disabled={buying}
        className="w-full py-3 rounded-xl text-white text-xs font-bold uppercase tracking-wider active:scale-[0.98] transition-transform flex items-center justify-center gap-2 mb-3 disabled:opacity-40"
        style={{ background: BLUE, fontFamily: FONT_MONO }}
      >
        {buying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><ShoppingBag className="w-3.5 h-3.5" /> Köp dagspass</>}
      </button>

      {/* Just created share link */}
      <AnimatePresence>
        {justCreatedToken && (
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="rounded-xl p-3 flex items-center gap-2 mb-3"
            style={{ background: GREEN_LIGHT, border: `1px solid ${GREEN_BORDER}` }}
          >
            <Check className="w-3.5 h-3.5 shrink-0" style={{ color: GREEN }} />
            <p className="text-xs flex-1 truncate" style={{ fontFamily: FONT_MONO, color: TEXT_SECONDARY }}>{buildLink(justCreatedToken)}</p>
            <button onClick={() => copyLink(buildLink(justCreatedToken))} className="shrink-0">
              <Copy className="w-4 h-4" style={{ color: GREEN }} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active passes */}
      {activePasses.length === 0 && sharedPasses.length === 0 ? (
        <div className="rounded-2xl p-4 text-center" style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}` }}>
          <p className="text-xs" style={{ color: TEXT_MUTED }}>Inga aktiva dagspass</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {activePasses.map((p: any) => (
            <div key={p.id}>
              <div className="rounded-xl p-3 flex items-center justify-between" style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}` }}>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium" style={{ color: TEXT_PRIMARY }}>Dagspass</p>
                    {p.is_free && (
                      <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold" style={{ background: GREEN_LIGHT, color: GREEN }}>GRATIS</span>
                    )}
                  </div>
                  <p className="text-xs" style={{ color: TEXT_MUTED }}>
                    {new Date(p.valid_date).toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" })}
                  </p>
                </div>
                {!p.is_free && <span className="text-xs font-bold mr-2" style={{ color: TEXT_SECONDARY }}>{p.price} SEK</span>}
                <button
                  onClick={() => { setSharingPassId(sharingPassId === p.id ? null : p.id); setShareEmail(""); setJustCreatedToken(null); }}
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: sharingPassId === p.id ? BLUE_LIGHT : PAGE_BG, border: `1px solid ${sharingPassId === p.id ? BLUE_BORDER : CARD_BORDER}` }}
                >
                  <Send className="w-3.5 h-3.5" style={{ color: sharingPassId === p.id ? BLUE : TEXT_MUTED }} />
                </button>
              </div>

              {/* Share form inline */}
              <AnimatePresence>
                {sharingPassId === p.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="pt-2 flex gap-2">
                      <input
                        type="email"
                        placeholder="Vännens e-post"
                        value={shareEmail}
                        onChange={(e) => setShareEmail(e.target.value)}
                        className="flex-1 px-3 py-2.5 rounded-xl text-xs outline-none"
                        style={{ fontFamily: FONT_MONO, background: PAGE_BG, border: `1px solid ${CARD_BORDER}`, color: TEXT_PRIMARY }}
                      />
                      <button
                        onClick={() => handleShare(p.id)}
                        disabled={sharing}
                        className="px-4 py-2.5 rounded-xl text-white text-xs font-bold active:scale-[0.98] transition-transform disabled:opacity-40"
                        style={{ background: BLUE, fontFamily: FONT_MONO }}
                      >
                        {sharing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Dela"}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}

          {/* Shared (pending) passes */}
          {sharedPasses.length > 0 && (
            <div className="pt-1">
              <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>Delade pass</p>
              {sharedPasses.map((p: any) => (
                <div key={p.id} className="rounded-xl p-3 flex items-center gap-2 mb-1.5" style={{ background: BLUE_LIGHT, border: `1px solid ${BLUE_BORDER}` }}>
                  <Send className="w-3 h-3 shrink-0" style={{ color: BLUE }} />
                  <span className="text-xs truncate flex-1" style={{ fontFamily: FONT_MONO, color: TEXT_SECONDARY }}>
                    {p.share?.recipient_email || "Delat pass"}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-bold shrink-0" style={{ background: BLUE_LIGHT, color: BLUE }}>
                    Väntande
                  </span>
                  {p.share?.token && (
                    <button
                      onClick={() => copyLink(buildLink(p.share.token))}
                      className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: PAGE_BG, border: `1px solid ${CARD_BORDER}` }}
                    >
                      <Copy className="w-3 h-3" style={{ color: TEXT_MUTED }} />
                    </button>
                  )}
                  {p.share && (
                    <button
                      onClick={() => handleRevoke(p.share.id)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}
                    >
                      <Trash2 className="w-3 h-3 text-red-400" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
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
  const { data: bookings } = useMyBookings();
  const { data: activeMembership } = useActiveMembership();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: PAGE_BG }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: BLUE }} />
      </div>
    );
  }

  if (!user) return <Navigate to={`/auth?redirect=/my&v=${venueSlug}`} replace />;

  const displayName = profile?.display_name || user.email?.split("@")[0] || "Spelare";
  const activeBookings = bookings?.filter((b) => b.status === "confirmed" || b.status === "pending") || [];
  const membershipTier = (activeMembership as any)?.membership_tiers;

  return (
    <div className="min-h-screen" style={{ background: PAGE_BG }}>
      {/* ═══ STICKY TOP: Logo ═══ */}
      <header
        className="fixed top-0 left-0 right-0 z-40 px-5 pt-[env(safe-area-inset-top,12px)] pb-3 flex items-end justify-between"
        style={{
          background: "linear-gradient(to bottom, rgba(248,250,252,0.95) 0%, rgba(248,250,252,0.7) 50%, transparent 100%)",
        }}
      >
        <div className="pt-2">
          <img
            src={picklaLogo}
            alt="Pickla"
            className="h-7 w-auto"
          />
        </div>
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={async () => {
            await signOut();
            navigate(`/?v=${venueSlug}`);
          }}
          className="w-9 h-9 rounded-xl flex items-center justify-center mb-1"
          style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}
        >
          <LogOut className="w-4 h-4" style={{ color: TEXT_MUTED }} />
        </motion.button>
      </header>

      {/* ═══ MAIN CONTENT ═══ */}
      <main className="pt-24 px-5 pb-28">
        <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col gap-4 max-w-md mx-auto">
          {/* Greeting */}
          <motion.p variants={item} className="text-lg font-bold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>
            Hej {displayName} 👋
          </motion.p>

          {/* Quick action pills */}
          <motion.div variants={item} className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
            {[
              { label: "+ Boka bana", to: "/book" },
              { label: "Köp dagspass", to: "/membership" },
              { label: "Aktiviteter", to: "/community" },
            ].map((a) => (
              <button
                key={a.label}
                onClick={() => navigate(a.to)}
                className="shrink-0 px-4 py-2 rounded-full text-[12px] font-bold whitespace-nowrap active:scale-95 transition-transform"
                style={{ background: "#1a1f3a", color: "#fff", fontFamily: FONT_MONO }}
              >
                {a.label}
              </button>
            ))}
          </motion.div>

          {/* Profile card with edit */}
          <ProfileCard profile={profile} user={user} displayName={displayName} />

          {/* Membership */}
          {activeMembership ? (
            <motion.div
              variants={item}
              className="rounded-2xl p-5"
              style={{
                background: membershipTier?.color
                  ? `${membershipTier.color}10`
                  : GREEN_LIGHT,
                border: `1.5px solid ${membershipTier?.color ? membershipTier.color + "30" : GREEN_BORDER}`,
              }}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: `${membershipTier?.color || GREEN}20` }}>
                  <Check className="w-5 h-5" style={{ color: membershipTier?.color || GREEN }} />
                </div>
                <div>
                  <p className="text-sm font-bold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>
                    {membershipTier?.name || "Medlem"}
                  </p>
                  <p className="text-[11px]" style={{ fontFamily: FONT_MONO, color: TEXT_SECONDARY }}>
                    {membershipTier?.description || "Aktivt medlemskap"}
                  </p>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.button
              variants={item}
              onClick={() => navigate("/play")}
              className="rounded-2xl p-4 text-left active:scale-[0.98] transition-transform"
              style={{
                background: BLUE_LIGHT,
                border: `1.5px solid ${BLUE_BORDER}`,
              }}
            >
              <p className="text-sm font-bold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>
                Bli medlem
              </p>
              <p className="text-[11px]" style={{ fontFamily: FONT_MONO, color: TEXT_SECONDARY }}>
                Se medlemskap och priser →
              </p>
            </motion.button>
          )}

          {/* Active bookings */}
          <motion.div variants={item}>
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-4 h-4" style={{ color: BLUE }} />
              <span className="text-sm font-semibold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>Mina bokningar</span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: BLUE_LIGHT, color: BLUE }}>{activeBookings.length}</span>
            </div>
            {activeBookings.length === 0 ? (
              <div className="rounded-2xl p-4 text-center" style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}` }}>
                <p className="text-xs" style={{ color: TEXT_MUTED }}>Inga aktiva bokningar</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {activeBookings.slice(0, 5).map((b) => (
                  <div key={b.id} className="rounded-xl p-3 flex items-center justify-between" style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}` }}>
                    <div>
                      <p className="text-sm font-medium" style={{ color: TEXT_PRIMARY }}>{(b as any).venue_courts?.name || "Bana"}</p>
                      <p className="text-xs" style={{ color: TEXT_MUTED }}>
                        {new Date(b.start_time).toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" })}
                        {" "}
                        {new Date(b.start_time).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}–{new Date(b.end_time).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: b.status === "confirmed" ? GREEN_LIGHT : BLUE_LIGHT, color: b.status === "confirmed" ? GREEN : BLUE }}>
                      {b.status === "confirmed" ? "Bekräftad" : "Väntande"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </motion.div>

          {/* Corporate memberships */}
          <CorporateSection />

          {/* QR Code for check-in */}
          <QrCodeCard userId={user.id} displayName={displayName} />

          {/* Unified day pass section */}
          <DayPassSection />
        </motion.div>
      </main>

      {/* ═══ FIXED BOTTOM NAV ═══ */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-between px-6 pb-8 pt-12"
        style={{
          background: "linear-gradient(to top, rgba(248,250,252,0.97) 0%, rgba(248,250,252,0.8) 40%, rgba(248,250,252,0.3) 70%, transparent 100%)",
        }}
      >
        <a
          href="https://chat.whatsapp.com/HL1XcYaNFSuE56q7MqCpdw"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[13px] font-bold underline underline-offset-4 active:opacity-60 transition-opacity"
          style={{ fontFamily: FONT_MONO, color: TEXT_PRIMARY, textDecorationColor: CARD_BORDER }}
        >
          chat
        </a>
        <button
          onClick={() => navigate("/play")}
          className="text-[13px] font-bold underline underline-offset-4 active:opacity-60 transition-opacity"
          style={{ fontFamily: FONT_MONO, color: TEXT_PRIMARY, textDecorationColor: CARD_BORDER }}
        >
          play
        </button>
        <span
          className="text-[13px] font-bold underline underline-offset-4"
          style={{ fontFamily: FONT_MONO, color: BLUE, textDecorationColor: BLUE }}
        >
          me
        </span>
      </nav>
    </div>
  );
};

export default MyPage;
