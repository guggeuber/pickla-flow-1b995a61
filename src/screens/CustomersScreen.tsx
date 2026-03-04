import { motion, AnimatePresence } from "framer-motion";
import { Search, Phone, Calendar, ChevronRight, UserPlus, Edit3, Check, ArrowLeft, Crown, X, UserCheck, Loader2 } from "lucide-react";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { useVenueForStaff } from "@/hooks/useDesk";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

type PlayerProfile = Tables<"player_profiles">;

const tierFromRating = (rating: number | null): "VIP" | "Play" | "Drop-in" => {
  if (!rating) return "Drop-in";
  if (rating >= 1500) return "VIP";
  if (rating >= 1100) return "Play";
  return "Drop-in";
};

const tierConfig: Record<string, { bg: string; text: string; dot: string }> = {
  VIP: { bg: "bg-badge-vip/15", text: "text-badge-vip", dot: "bg-badge-vip" },
  Play: { bg: "bg-primary/15", text: "text-primary", dot: "bg-primary" },
  "Drop-in": { bg: "bg-muted", text: "text-muted-foreground", dot: "bg-muted-foreground" },
};

// ═══ Inline check-in helper ═══
async function performCheckin(venueId: string, profile: any, entryType = "manual", entitlementId: string | null = null) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Inte inloggad");

  const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const res = await fetch(
    `https://${PROJECT_ID}.supabase.co/functions/v1/api-checkins/checkin`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        venue_id: venueId,
        target_user_id: profile.auth_user_id,
        entry_type: entryType,
        entitlement_id: entitlementId,
        player_name: profile.display_name,
      }),
    }
  );
  if (!res.ok) throw new Error("Incheckning misslyckades");
  return res.json();
}

// ═══ CREATE CUSTOMER MODAL ═══
const CreateCustomerModal = ({ venueId, onClose, onCreated }: { venueId: string; onClose: () => void; onCreated: () => void }) => {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) { toast.error("Namn krävs"); return; }
    setCreating(true);
    try {
      await apiPost("api-customers", "create", {
        display_name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        venue_id: venueId,
      });
      toast.success("Kund skapad! ✅");
      onCreated();
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Kunde inte skapa kund");
    } finally {
      setCreating(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 flex items-end justify-center"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 200 }}
        animate={{ y: 0 }}
        exit={{ y: 200 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-t-3xl p-5 space-y-4"
        style={{ background: "hsl(var(--background))" }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-display font-bold">Ny kund</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-muted-foreground" /></button>
        </div>
        <div className="space-y-3">
          <input type="text" placeholder="Namn *" value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-secondary rounded-xl py-3 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" autoFocus />
          <input type="tel" placeholder="Telefon" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full bg-secondary rounded-xl py-3 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          <input type="email" placeholder="E-post" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-secondary rounded-xl py-3 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <motion.button whileTap={{ scale: 0.96 }} onClick={handleCreate} disabled={creating || !name.trim()} className="w-full bg-primary text-primary-foreground rounded-2xl py-4 font-semibold text-sm disabled:opacity-40 flex items-center justify-center gap-2">
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
          Skapa kund
        </motion.button>
        <div className="h-6" />
      </motion.div>
    </motion.div>
  );
};

const CustomersScreen = () => {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [showMembershipModal, setShowMembershipModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [checkingInId, setCheckingInId] = useState<string | null>(null);
  const [checkedInIds, setCheckedInIds] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const { data: staffVenue } = useVenueForStaff();
  const venueId = staffVenue?.venue_id;

  const { data: profiles, isLoading } = useQuery({
    queryKey: ["player-profiles"],
    queryFn: () => apiGet("api-customers", "list", { limit: "100" }),
  });

  const updateProfile = useMutation({
    mutationFn: (updates: { id: string; display_name: string; phone: string }) =>
      apiPatch("api-customers", "update", updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["player-profiles"] });
      setEditing(false);
    },
  });

  const filtered = (profiles || []).filter(
    (p: any) =>
      (p.display_name || "").toLowerCase().includes(search.toLowerCase()) ||
      (p.phone || "").includes(search)
  );

  const selected = profiles?.find((p: any) => p.id === selectedId);

  const { data: membershipTiers } = useQuery({
    queryKey: ["membership-tiers", venueId],
    enabled: !!venueId,
    queryFn: () => apiGet("api-memberships", "tiers", { venueId: venueId! }),
  });

  const { data: currentMembership } = useQuery({
    queryKey: ["customer-membership", selected?.auth_user_id, venueId],
    enabled: !!selected?.auth_user_id && !!venueId,
    queryFn: () => apiGet("api-memberships", "user", { userId: selected!.auth_user_id, venueId: venueId! }),
  });

  const assignMembership = useMutation({
    mutationFn: (tierId: string) =>
      apiPost("api-memberships", "assign", {
        venueId,
        customerUserId: selected!.auth_user_id,
        tierId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-membership"] });
      setShowMembershipModal(false);
      toast.success("Medlemskap tilldelat!");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const cancelMembership = useMutation({
    mutationFn: (membershipId: string) =>
      apiPatch("api-memberships", "update", { membershipId, status: "cancelled" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-membership"] });
      toast.success("Medlemskap avslutat");
    },
  });

  // One-tap check-in handler for any profile
  const handleQuickCheckin = async (profile: any, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!venueId || checkingInId === profile.id) return;
    setCheckingInId(profile.id);
    try {
      await performCheckin(venueId, profile);
      toast.success(`${profile.display_name} incheckad! ✅`);
      setCheckedInIds((prev) => new Set(prev).add(profile.id));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCheckingInId(null);
    }
  };

  // ═══ CUSTOMER DETAIL VIEW ═══
  if (selected) {
    const tier = tierFromRating(selected.pickla_rating);
    const t = tierConfig[tier];
    const initials = (selected.display_name || "?")
      .split(" ")
      .map((w: string) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

    const startEdit = () => {
      setEditName(selected.display_name || "");
      setEditPhone(selected.phone || "");
      setEditing(true);
    };
    const saveEdit = () => {
      updateProfile.mutate({
        id: selected.id,
        display_name: editName,
        phone: editPhone,
      });
    };

    const memberTier = currentMembership?.membership_tiers;
    const isCheckedIn = checkedInIds.has(selected.id);

    return (
      <div className="pb-24 px-4 pt-2 space-y-4">
        <motion.button whileTap={{ scale: 0.9 }} onClick={() => { setSelectedId(null); setEditing(false); }} className="tap-target flex items-center gap-1 text-primary font-semibold text-sm">
          <ArrowLeft className="w-4 h-4" /> Tillbaka
        </motion.button>

        {/* ═══ BIG CHECK-IN BUTTON ═══ */}
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={() => !isCheckedIn && handleQuickCheckin(selected)}
          disabled={isCheckedIn || checkingInId === selected.id}
          className={`w-full rounded-2xl py-4 font-bold text-sm flex items-center justify-center gap-2.5 transition-all ${
            isCheckedIn
              ? "bg-court-free/15 text-court-free"
              : "bg-court-free text-white shadow-lg shadow-court-free/25"
          }`}
        >
          {checkingInId === selected.id ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <UserCheck className="w-5 h-5" />
          )}
          {isCheckedIn ? "✅ Incheckad" : "Checka in"}
        </motion.button>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card rounded-3xl p-5 space-y-4">
          <div className="flex items-start gap-4">
            <div className={`w-14 h-14 rounded-2xl ${t.bg} ${t.text} flex items-center justify-center text-lg font-display font-bold flex-shrink-0`}>
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              {editing ? (
                <div className="space-y-2">
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full bg-secondary rounded-xl py-2 px-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/30" autoFocus />
                  <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="Telefon" className="w-full bg-secondary rounded-xl py-2 px-3 text-sm text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
              ) : (
                <>
                  <h1 className="text-lg font-display font-bold truncate">{selected.display_name || "Unnamed"}</h1>
                  {selected.phone && <p className="text-sm text-muted-foreground flex items-center gap-1.5"><Phone className="w-3 h-3" />{selected.phone}</p>}
                </>
              )}
              <div className="flex items-center gap-2 mt-2">
                <span className={`status-chip ${t.bg} ${t.text}`}>{tier}</span>
                <span className="text-[10px] text-muted-foreground">Rating: {selected.pickla_rating}</span>
                {memberTier && (
                  <span className="status-chip text-white text-[10px] font-bold flex items-center gap-1" style={{ background: memberTier.color }}>
                    <Crown className="w-3 h-3" />
                    {memberTier.name}
                  </span>
                )}
              </div>
            </div>
          </div>
          <motion.button whileTap={{ scale: 0.95 }} onClick={() => editing ? saveEdit() : startEdit()} className={`w-full rounded-2xl py-3 font-semibold text-sm flex items-center justify-center gap-2 ${editing ? "bg-court-free text-white" : "bg-secondary text-foreground"}`}>
            {editing ? <Check className="w-4 h-4" /> : <Edit3 className="w-4 h-4" />}
            {editing ? "Spara" : "Redigera kund"}
          </motion.button>
        </motion.div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Matcher", value: String(selected.total_matches || 0) },
            { label: "Vinster", value: String(selected.total_wins || 0) },
            { label: "Rating", value: String(selected.pickla_rating || 0) },
          ].map((s) => (
            <div key={s.label} className="stat-card text-center">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{s.label}</p>
              <p className="text-base font-display font-bold">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Membership Card */}
        {memberTier ? (
          <div className="glass-card rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Crown className="w-4 h-4" style={{ color: memberTier.color }} />
                <p className="text-sm font-bold">{memberTier.name}</p>
              </div>
              <span className="text-[10px] text-muted-foreground">
                {memberTier.discount_percent > 0 && `${memberTier.discount_percent}% rabatt`}
              </span>
            </div>
            <div className="flex gap-2">
              <motion.button whileTap={{ scale: 0.95 }} onClick={() => setShowMembershipModal(true)} className="flex-1 bg-primary/10 text-primary rounded-xl py-2 text-xs font-semibold">
                Byt nivå
              </motion.button>
              <motion.button whileTap={{ scale: 0.95 }} onClick={() => currentMembership?.id && cancelMembership.mutate(currentMembership.id)} className="flex-1 bg-destructive/10 text-destructive rounded-xl py-2 text-xs font-semibold">
                Avsluta
              </motion.button>
            </div>
          </div>
        ) : null}

        {selected.bio && (
          <div className="glass-card rounded-2xl p-4">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1">Bio</p>
            <p className="text-sm">{selected.bio}</p>
          </div>
        )}

        {/* CTA Actions */}
        <div className="space-y-2">
          <motion.button whileTap={{ scale: 0.97 }} onClick={() => setShowMembershipModal(true)} className="w-full sell-block rounded-2xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Crown className="w-5 h-5 text-sell" />
              <div className="text-left">
                <span className="text-sm font-bold">{memberTier ? "Ändra medlemskap" : "Sälj medlemskap"}</span>
                <p className="text-[10px] text-muted-foreground">{memberTier ? `Nuvarande: ${memberTier.name}` : "Tilldela medlemskapsnivå"}</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-sell" />
          </motion.button>
          <motion.button whileTap={{ scale: 0.97 }} onClick={() => toast.info("Boka åt kund — kommer snart!")} className="w-full glass-card rounded-2xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3"><Calendar className="w-4 h-4 text-primary" /><span className="text-sm font-semibold">Boka åt kund</span></div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </motion.button>
        </div>

        {/* Membership assignment modal */}
        <AnimatePresence>
          {showMembershipModal && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/50 flex items-end justify-center" onClick={() => setShowMembershipModal(false)}>
              <motion.div initial={{ y: 200 }} animate={{ y: 0 }} exit={{ y: 200 }} onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-t-3xl p-5 space-y-4" style={{ background: "hsl(var(--background))" }}>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-display font-bold">Välj medlemskapsnivå</h2>
                  <button onClick={() => setShowMembershipModal(false)}><X className="w-5 h-5 text-muted-foreground" /></button>
                </div>
                <div className="space-y-2">
                  {(membershipTiers || []).filter((t: any) => t.is_active).map((mt: any) => (
                    <motion.button key={mt.id} whileTap={{ scale: 0.97 }} onClick={() => assignMembership.mutate(mt.id)} disabled={assignMembership.isPending} className={`w-full glass-card rounded-2xl p-4 flex items-center gap-3 text-left transition-all ${memberTier?.id === mt.id ? "ring-2 ring-primary" : ""}`}>
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${mt.color}20` }}>
                        <Crown className="w-5 h-5" style={{ color: mt.color }} />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-bold">{mt.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {mt.discount_percent > 0 && `${mt.discount_percent}% rabatt`}
                          {mt.discount_percent > 0 && mt.monthly_price > 0 && " · "}
                          {mt.monthly_price > 0 && `${mt.monthly_price} kr/mån`}
                        </p>
                      </div>
                      {memberTier?.id === mt.id && <span className="text-[10px] px-2 py-1 rounded-full bg-primary/15 text-primary font-bold">Aktiv</span>}
                    </motion.button>
                  ))}
                  {(!membershipTiers || membershipTiers.filter((t: any) => t.is_active).length === 0) && (
                    <p className="text-sm text-muted-foreground text-center py-4">Inga medlemskapsnivåer skapade.</p>
                  )}
                </div>
                <div className="h-6" />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ═══ CUSTOMER LIST VIEW ═══
  return (
    <div className="pb-24 px-4 pt-2 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold tracking-tight">Kunder</h1>
        <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowCreateModal(true)} className="tap-target rounded-xl bg-primary text-primary-foreground w-9 h-9 flex items-center justify-center">
          <UserPlus className="w-4 h-4" />
        </motion.button>
      </div>

      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input type="text" placeholder="Namn, telefon..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full bg-secondary rounded-xl py-3 pl-10 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground text-center py-8">Laddar kunder...</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 space-y-3">
          <p className="text-sm text-muted-foreground">Inga kunder hittades</p>
          <motion.button whileTap={{ scale: 0.95 }} onClick={() => setShowCreateModal(true)} className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-xl px-4 py-2.5 text-sm font-semibold">
            <UserPlus className="w-4 h-4" />
            Skapa ny kund
          </motion.button>
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((profile: any, i: number) => {
            const tier = tierFromRating(profile.pickla_rating);
            const t = tierConfig[tier];
            const isCheckedIn = checkedInIds.has(profile.id);
            const initials = (profile.display_name || "?")
              .split(" ")
              .map((w: string) => w[0])
              .join("")
              .slice(0, 2)
              .toUpperCase();

            return (
              <motion.div
                key={profile.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="w-full glass-card rounded-2xl p-3.5 flex items-center gap-3"
              >
                {/* Tap name area to go to detail */}
                <button onClick={() => setSelectedId(profile.id)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                  <div className={`w-10 h-10 rounded-xl ${t.bg} ${t.text} flex items-center justify-center text-sm font-display font-bold flex-shrink-0`}>{initials}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold truncate">{profile.display_name || "Unnamed"}</p>
                      <span className={`w-1.5 h-1.5 rounded-full ${t.dot} flex-shrink-0`} />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {profile.total_matches || 0} matcher · Rating {profile.pickla_rating || 0}
                    </p>
                  </div>
                </button>

                {/* One-tap check-in button */}
                <motion.button
                  whileTap={{ scale: 0.85 }}
                  onClick={(e) => !isCheckedIn && handleQuickCheckin(profile, e)}
                  disabled={isCheckedIn || checkingInId === profile.id}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all ${
                    isCheckedIn
                      ? "bg-court-free/15 text-court-free"
                      : "bg-court-free text-white shadow-md shadow-court-free/20"
                  }`}
                >
                  {checkingInId === profile.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : isCheckedIn ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <UserCheck className="w-4 h-4" />
                  )}
                </motion.button>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Create customer modal */}
      <AnimatePresence>
        {showCreateModal && venueId && (
          <CreateCustomerModal
            venueId={venueId}
            onClose={() => setShowCreateModal(false)}
            onCreated={() => queryClient.invalidateQueries({ queryKey: ["player-profiles"] })}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default CustomersScreen;