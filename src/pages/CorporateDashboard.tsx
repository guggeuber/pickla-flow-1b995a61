import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Building2, Users, Clock, Copy, ArrowLeft, Calendar, ShoppingCart, Plus, Settings2, Percent } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import picklaLogo from "@/assets/pickla-logo.svg";

const FONT_HEADING = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

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

const DAYS = ["Sön", "Mån", "Tis", "Ons", "Tor", "Fre", "Lör"];

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08 } } };
const item = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } };

export default function CorporateDashboard() {
  const [params] = useSearchParams();
  const accountId = params.get("id") || "";
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState<any>(null);
  const [orderForm, setOrderForm] = useState({
    order_type: "hours",
    total_hours: "20",
    total_price: "",
    notes: "",
    slots: [{ day_of_week: "1", start_time: "17:00", end_time: "19:00" }],
    weeks: "12",
  });
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [limitForm, setLimitForm] = useState({ monthly_hour_limit: "", monthly_cost_limit: "" });
  const [savingLimit, setSavingLimit] = useState(false);

  const loadData = () => {
    if (!user || !accountId) return;
    apiGet("api-corporate", "dashboard", { accountId })
      .then(setData)
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadData(); }, [user, accountId]);

  const handleCreateOrder = async () => {
    setSubmittingOrder(true);
    try {
      const payload: any = {
        corporate_account_id: accountId,
        order_type: orderForm.order_type,
        total_hours: parseFloat(orderForm.total_hours) || 0,
        total_price: parseFloat(orderForm.total_price) || 0,
        notes: orderForm.notes || undefined,
      };

      if (orderForm.order_type === "recurring") {
        payload.recurring_config = {
          slots: orderForm.slots.map((s) => ({
            day_of_week: parseInt(s.day_of_week),
            start_time: s.start_time,
            end_time: s.end_time,
          })),
          weeks: parseInt(orderForm.weeks) || 12,
        };
      }

      await apiPost("api-corporate", "orders", payload);
      toast.success("Beställning skapad!");
      setShowOrderModal(false);
      setOrderForm({ order_type: "hours", total_hours: "20", total_price: "", notes: "", slots: [{ day_of_week: "1", start_time: "17:00", end_time: "19:00" }], weeks: "12" });
      loadData();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmittingOrder(false);
    }
  };

  const handleSaveLimit = async () => {
    if (!showLimitModal) return;
    setSavingLimit(true);
    try {
      await apiPatch("api-corporate", "members", {
        member_id: showLimitModal.id,
        monthly_hour_limit: limitForm.monthly_hour_limit ? parseFloat(limitForm.monthly_hour_limit) : null,
        monthly_cost_limit: limitForm.monthly_cost_limit ? parseFloat(limitForm.monthly_cost_limit) : null,
      });
      toast.success("Gränser sparade!");
      setShowLimitModal(null);
      loadData();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingLimit(false);
    }
  };

  const addSlot = () => {
    setOrderForm({
      ...orderForm,
      slots: [...orderForm.slots, { day_of_week: "4", start_time: "19:00", end_time: "20:00" }],
    });
  };

  const removeSlot = (i: number) => {
    setOrderForm({ ...orderForm, slots: orderForm.slots.filter((_, idx) => idx !== i) });
  };

  const updateSlot = (i: number, field: string, val: string) => {
    const updated = [...orderForm.slots];
    (updated[i] as any)[field] = val;
    setOrderForm({ ...orderForm, slots: updated });
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: PAGE_BG }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: BLUE }} />
      </div>
    );
  }

  if (!user) { navigate("/auth"); return null; }
  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: PAGE_BG }}>
        <p style={{ color: TEXT_MUTED }}>Kunde inte ladda företagsdata</p>
      </div>
    );
  }

  const { account, members, packages, recent_bookings, orders } = data;
  const activePackage = packages?.find((p: any) => p.status === "active");
  const remainingHours = activePackage ? activePackage.total_hours - activePackage.used_hours : 0;
  const usagePercent = activePackage ? Math.round((activePackage.used_hours / activePackage.total_hours) * 100) : 0;
  const inviteUrl = `${window.location.origin}/corp/join?token=${account?.invite_token}`;

  const statusLabel: Record<string, string> = {
    pending: "Väntar", invoiced: "Fakturerad", paid: "Betald", fulfilled: "Levererad", cancelled: "Avbruten",
  };
  const statusColor: Record<string, string> = {
    pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
    invoiced: "bg-blue-50 text-blue-700 border-blue-200",
    paid: "bg-green-50 text-green-700 border-green-200",
    fulfilled: "bg-emerald-50 text-emerald-700 border-emerald-200",
    cancelled: "bg-red-50 text-red-700 border-red-200",
  };

  return (
    <div className="min-h-screen" style={{ background: PAGE_BG }}>
      {/* Header */}
      <div className="sticky top-0 z-10 px-4 py-3 flex items-center gap-3" style={{ background: CARD_BG, borderBottom: `1px solid ${CARD_BORDER}` }}>
        <button onClick={() => navigate("/my")} className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: PAGE_BG, border: `1px solid ${CARD_BORDER}` }}>
          <ArrowLeft className="w-4 h-4" style={{ color: TEXT_SECONDARY }} />
        </button>
        <div className="flex items-center gap-2 flex-1">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: BLUE_LIGHT }}>
            <Building2 className="w-4 h-4" style={{ color: BLUE }} />
          </div>
          <div>
            <h1 className="text-base font-bold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>{account?.company_name}</h1>
            {account?.discount_percent > 0 && (
              <p className="text-[10px] flex items-center gap-1" style={{ color: GREEN, fontFamily: FONT_MONO }}>
                <Percent className="w-2.5 h-2.5" />{account.discount_percent}% rabatt
              </p>
            )}
          </div>
        </div>
        <img src={picklaLogo} className="h-7 w-auto" alt="Pickla" />
      </div>

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="p-4 space-y-4 max-w-lg mx-auto pb-24"
      >
        {/* Hours Bank */}
        {activePackage && (
          <motion.div
            variants={item}
            className="rounded-2xl p-5"
            style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}`, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4" style={{ color: BLUE }} />
                <span className="text-sm font-semibold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>Timbank</span>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: BLUE_LIGHT, color: BLUE }}>
                {activePackage.package_type === "hybrid" ? "Hybrid" : "Timmar"}
              </span>
            </div>
            <div className="text-center mb-4">
              <div className="text-5xl font-black" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>
                {remainingHours}
                <span className="text-lg ml-1" style={{ color: TEXT_MUTED }}>h kvar</span>
              </div>
              <p className="text-xs mt-1" style={{ color: TEXT_MUTED }}>av {activePackage.total_hours}h totalt</p>
            </div>
            <div className="w-full rounded-full h-2" style={{ background: `${BLUE}15` }}>
              <div className="h-2 rounded-full transition-all" style={{ width: `${Math.min(usagePercent, 100)}%`, background: BLUE }} />
            </div>
            <div className="flex justify-between text-[11px] mt-1.5" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
              <span>{activePackage.used_hours}h använt</span>
              <span>{usagePercent}%</span>
            </div>
          </motion.div>
        )}

        {/* Order Button */}
        <motion.div variants={item}>
          <Dialog open={showOrderModal} onOpenChange={setShowOrderModal}>
            <DialogTrigger asChild>
              <button
                className="w-full py-3.5 rounded-xl text-white text-xs font-bold uppercase tracking-wider active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
                style={{ background: BLUE, fontFamily: FONT_MONO }}
              >
                <ShoppingCart className="w-4 h-4" /> Ny beställning
              </button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Skapa beställning</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <Select value={orderForm.order_type} onValueChange={(v) => setOrderForm({ ...orderForm, order_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hours">Timbank (klippkort)</SelectItem>
                    <SelectItem value="recurring">Bokningsserie (återkommande)</SelectItem>
                  </SelectContent>
                </Select>

                {orderForm.order_type === "hours" && (
                  <>
                    <Input placeholder="Antal timmar" type="number" value={orderForm.total_hours} onChange={(e) => setOrderForm({ ...orderForm, total_hours: e.target.value })} />
                    <Input placeholder="Totalpris (SEK)" type="number" value={orderForm.total_price} onChange={(e) => setOrderForm({ ...orderForm, total_price: e.target.value })} />
                  </>
                )}

                {orderForm.order_type === "recurring" && (
                  <>
                    <p className="text-sm text-muted-foreground">Lägg till tider:</p>
                    {orderForm.slots.map((slot, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <Select value={slot.day_of_week} onValueChange={(v) => updateSlot(i, "day_of_week", v)}>
                          <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {DAYS.map((d, di) => <SelectItem key={di} value={String(di)}>{d}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Input type="time" value={slot.start_time} onChange={(e) => updateSlot(i, "start_time", e.target.value)} className="w-24" />
                        <span className="text-muted-foreground">–</span>
                        <Input type="time" value={slot.end_time} onChange={(e) => updateSlot(i, "end_time", e.target.value)} className="w-24" />
                        {orderForm.slots.length > 1 && (
                          <Button variant="ghost" size="sm" onClick={() => removeSlot(i)} className="text-destructive px-2">✕</Button>
                        )}
                      </div>
                    ))}
                    <Button variant="outline" size="sm" onClick={addSlot} className="gap-1">
                      <Plus className="w-3 h-3" /> Lägg till tid
                    </Button>
                    <Input placeholder="Antal veckor" type="number" value={orderForm.weeks} onChange={(e) => setOrderForm({ ...orderForm, weeks: e.target.value })} />
                    <Input placeholder="Totalpris (SEK)" type="number" value={orderForm.total_price} onChange={(e) => setOrderForm({ ...orderForm, total_price: e.target.value })} />
                  </>
                )}

                <Input placeholder="Anteckning (valfritt)" value={orderForm.notes} onChange={(e) => setOrderForm({ ...orderForm, notes: e.target.value })} />
                <Button onClick={handleCreateOrder} disabled={submittingOrder} className="w-full">
                  {submittingOrder ? <Loader2 className="w-4 h-4 animate-spin" /> : "Skicka beställning"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </motion.div>

        {/* Orders */}
        {orders && orders.length > 0 && (
          <motion.div variants={item}>
            <div className="flex items-center gap-2 mb-2">
              <ShoppingCart className="w-4 h-4" style={{ color: BLUE }} />
              <span className="text-sm font-semibold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>Beställningar</span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: BLUE_LIGHT, color: BLUE }}>{orders.length}</span>
            </div>
            <div className="space-y-2">
              {orders.map((o: any) => (
                <div key={o.id} className="rounded-xl p-3 space-y-2" style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}` }}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold" style={{ fontFamily: FONT_MONO, color: TEXT_PRIMARY }}>{o.order_number}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${statusColor[o.status] || "bg-muted"}`}>
                      {statusLabel[o.status] || o.status}
                    </span>
                  </div>
                  <p className="text-xs" style={{ color: TEXT_SECONDARY }}>
                    {o.order_type === "hours" ? `${o.total_hours}h timbank` : `Bokningsserie · ${o.corporate_order_items?.length || 0} tillfällen`}
                    {o.total_price > 0 && ` · ${o.total_price} ${o.currency || "SEK"}`}
                  </p>
                  <p className="text-[11px]" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
                    {new Date(o.created_at).toLocaleDateString("sv-SE")}
                    {o.notes && ` · ${o.notes}`}
                  </p>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Invite Link */}
        <motion.div variants={item}>
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4" style={{ color: BLUE }} />
            <span className="text-sm font-semibold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>Bjud in kollegor</span>
          </div>
          <div className="rounded-xl p-3 flex gap-2" style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}` }}>
            <input
              readOnly
              value={inviteUrl}
              className="flex-1 text-xs rounded-lg px-3 py-2 truncate outline-none"
              style={{ background: PAGE_BG, border: `1px solid ${CARD_BORDER}`, color: TEXT_SECONDARY, fontFamily: FONT_MONO }}
            />
            <button
              onClick={() => { navigator.clipboard.writeText(inviteUrl); toast.success("Kopierad!"); }}
              className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: BLUE_LIGHT, border: `1px solid ${BLUE_BORDER}` }}
            >
              <Copy className="w-4 h-4" style={{ color: BLUE }} />
            </button>
          </div>
        </motion.div>

        {/* Members */}
        <motion.div variants={item}>
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4" style={{ color: BLUE }} />
            <span className="text-sm font-semibold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>Medlemmar</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: BLUE_LIGHT, color: BLUE }}>{members?.length || 0}</span>
          </div>
          <div className="rounded-2xl overflow-hidden" style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}` }}>
            {members?.map((m: any, idx: number) => (
              <div
                key={m.id}
                className="flex items-center justify-between px-4 py-3"
                style={{ borderBottom: idx < members.length - 1 ? `1px solid ${CARD_BORDER}` : undefined }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: BLUE_LIGHT, color: BLUE }}>
                    {(m.profile?.display_name || "?")[0]?.toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium" style={{ color: TEXT_PRIMARY }}>{m.profile?.display_name || "Okänd"}</p>
                    <p className="text-[11px]" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
                      {m.monthly_hour_limit ? `Max ${m.monthly_hour_limit}h/mån` : ""}
                      {m.monthly_hour_limit && m.monthly_cost_limit ? " · " : ""}
                      {m.monthly_cost_limit ? `Max ${m.monthly_cost_limit} kr/mån` : ""}
                      {!m.monthly_hour_limit && !m.monthly_cost_limit ? "Ingen gräns" : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full font-bold"
                    style={{
                      background: m.role === "admin" ? BLUE_LIGHT : PAGE_BG,
                      color: m.role === "admin" ? BLUE : TEXT_MUTED,
                      border: `1px solid ${m.role === "admin" ? BLUE_BORDER : CARD_BORDER}`,
                    }}
                  >
                    {m.role === "admin" ? "Admin" : "Medlem"}
                  </span>
                  {m.role !== "admin" && (
                    <button
                      onClick={() => {
                        setShowLimitModal(m);
                        setLimitForm({
                          monthly_hour_limit: m.monthly_hour_limit?.toString() || "",
                          monthly_cost_limit: m.monthly_cost_limit?.toString() || "",
                        });
                      }}
                      className="w-7 h-7 rounded-lg flex items-center justify-center"
                      style={{ background: PAGE_BG, border: `1px solid ${CARD_BORDER}` }}
                    >
                      <Settings2 className="w-3.5 h-3.5" style={{ color: TEXT_MUTED }} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Limit Modal */}
        <Dialog open={!!showLimitModal} onOpenChange={(v) => !v && setShowLimitModal(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Gränser för {showLimitModal?.profile?.display_name || "Medlem"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 pt-2">
              <Input
                placeholder="Max timmar / månad (lämna tomt = ingen gräns)"
                type="number"
                value={limitForm.monthly_hour_limit}
                onChange={(e) => setLimitForm({ ...limitForm, monthly_hour_limit: e.target.value })}
              />
              <Input
                placeholder="Max kostnad / månad (SEK, lämna tomt = ingen gräns)"
                type="number"
                value={limitForm.monthly_cost_limit}
                onChange={(e) => setLimitForm({ ...limitForm, monthly_cost_limit: e.target.value })}
              />
              <Button onClick={handleSaveLimit} disabled={savingLimit} className="w-full">
                {savingLimit ? <Loader2 className="w-4 h-4 animate-spin" /> : "Spara gränser"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Recent Bookings */}
        <motion.div variants={item}>
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="w-4 h-4" style={{ color: BLUE }} />
            <span className="text-sm font-semibold" style={{ fontFamily: FONT_HEADING, color: TEXT_PRIMARY }}>Senaste bokningar</span>
          </div>
          <div className="rounded-2xl overflow-hidden" style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}` }}>
            {recent_bookings?.length > 0 ? (
              recent_bookings.map((b: any, idx: number) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between px-4 py-3"
                  style={{ borderBottom: idx < recent_bookings.length - 1 ? `1px solid ${CARD_BORDER}` : undefined }}
                >
                  <div>
                    <p className="text-sm font-medium" style={{ color: TEXT_PRIMARY }}>{b.venue_courts?.name || "Bana"}</p>
                    <p className="text-[11px]" style={{ fontFamily: FONT_MONO, color: TEXT_MUTED }}>
                      {new Date(b.start_time).toLocaleDateString("sv-SE")}{" "}
                      {new Date(b.start_time).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}–
                      {new Date(b.end_time).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full font-bold"
                    style={{
                      background: b.status === "confirmed" ? GREEN_LIGHT : PAGE_BG,
                      color: b.status === "confirmed" ? GREEN : TEXT_MUTED,
                      border: `1px solid ${b.status === "confirmed" ? GREEN_BORDER : CARD_BORDER}`,
                    }}
                  >
                    {b.status === "confirmed" ? "Bekräftad" : b.status}
                  </span>
                </div>
              ))
            ) : (
              <div className="text-center py-6">
                <p className="text-xs" style={{ color: TEXT_MUTED }}>Inga bokningar ännu</p>
              </div>
            )}
          </div>
        </motion.div>

        {/* Book button */}
        <motion.div variants={item}>
          <button
            onClick={() => navigate(`/book`)}
            className="w-full py-3.5 rounded-xl text-xs font-bold uppercase tracking-wider active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
            style={{ background: CARD_BG, border: `1.5px solid ${CARD_BORDER}`, color: TEXT_PRIMARY, fontFamily: FONT_MONO }}
          >
            <Calendar className="w-4 h-4" style={{ color: BLUE }} /> Boka bana
          </button>
        </motion.div>
      </motion.div>
    </div>
  );
}
