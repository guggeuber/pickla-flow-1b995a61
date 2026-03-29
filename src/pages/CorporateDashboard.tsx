import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Building2, Users, Clock, Copy, ArrowLeft, Calendar, ShoppingCart, Plus, Settings2 } from "lucide-react";
import { toast } from "sonner";

const DAYS = ["Sön", "Mån", "Tis", "Ons", "Tor", "Fre", "Lör"];

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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) { navigate("/auth"); return null; }
  if (!data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <p className="text-muted-foreground">Kunde inte ladda företagsdata</p>
      </div>
    );
  }

  const { account, members, packages, recent_bookings, orders } = data;
  const activePackage = packages?.find((p: any) => p.status === "active");
  const remainingHours = activePackage ? activePackage.total_hours - activePackage.used_hours : 0;
  const usagePercent = activePackage ? Math.round((activePackage.used_hours / activePackage.total_hours) * 100) : 0;
  const inviteUrl = `${window.location.origin}/corp/join?token=${account?.invite_token}`;

  const statusLabel: Record<string, string> = {
    pending: "Väntar",
    invoiced: "Fakturerad",
    paid: "Betald",
    fulfilled: "Levererad",
    cancelled: "Avbruten",
  };

  const statusColor: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    invoiced: "bg-blue-100 text-blue-800",
    paid: "bg-green-100 text-green-800",
    fulfilled: "bg-emerald-100 text-emerald-800",
    cancelled: "bg-red-100 text-red-800",
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/my")} className="text-muted-foreground">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold font-['Space_Grotesk']">{account?.company_name}</h1>
        </div>
      </div>

      <div className="p-4 space-y-4 max-w-lg mx-auto pb-24">
        {/* Hours Bank */}
        {activePackage && (
          <Card className="border-0 shadow-md bg-gradient-to-br from-foreground to-foreground/90 text-background">
            <CardContent className="pt-6 pb-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-primary" />
                  <span className="text-sm opacity-70">Timbank</span>
                </div>
                <Badge variant="outline" className="text-primary border-primary/30">
                  {activePackage.package_type === "hybrid" ? "Hybrid" : "Timmar"}
                </Badge>
              </div>
              <div className="text-center">
                <div className="text-5xl font-black font-['Space_Grotesk']">
                  {remainingHours}
                  <span className="text-lg opacity-40 ml-1">h kvar</span>
                </div>
                <p className="opacity-40 text-sm mt-1">av {activePackage.total_hours}h totalt</p>
              </div>
              <div className="w-full bg-muted/20 rounded-full h-2">
                <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${Math.min(usagePercent, 100)}%` }} />
              </div>
              <div className="flex justify-between text-xs opacity-40">
                <span>{activePackage.used_hours}h använt</span>
                <span>{usagePercent}%</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Order Button */}
        <Dialog open={showOrderModal} onOpenChange={setShowOrderModal}>
          <DialogTrigger asChild>
            <Button className="w-full gap-2 h-12" size="lg">
              <ShoppingCart className="w-4 h-4" />
              Ny beställning
            </Button>
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

        {/* Orders */}
        {orders && orders.length > 0 && (
          <Card className="border shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <ShoppingCart className="w-4 h-4" /> Beställningar ({orders.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {orders.map((o: any) => (
                <div key={o.id} className="p-3 rounded-xl bg-muted/30 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-bold">{o.order_number}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor[o.status] || "bg-muted"}`}>
                      {statusLabel[o.status] || o.status}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {o.order_type === "hours" ? `${o.total_hours}h timbank` : `Bokningsserie · ${o.corporate_order_items?.length || 0} tillfällen`}
                    {o.total_price > 0 && ` · ${o.total_price} ${o.currency || "SEK"}`}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(o.created_at).toLocaleDateString("sv-SE")}
                    {o.notes && ` · ${o.notes}`}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Invite Link */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Users className="w-4 h-4" /> Bjud in kollegor
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <input readOnly value={inviteUrl} className="flex-1 text-xs bg-muted border rounded-lg px-3 py-2 text-muted-foreground truncate" />
              <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(inviteUrl); toast.success("Kopierad!"); }}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Members with limit management */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Medlemmar ({members?.length || 0})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {members?.map((m: any) => (
              <div key={m.id} className="flex items-center justify-between py-2 border-b last:border-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-medium">
                    {(m.profile?.display_name || "?")[0]?.toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{m.profile?.display_name || "Okänd"}</p>
                    <p className="text-xs text-muted-foreground">
                      {m.monthly_hour_limit ? `Max ${m.monthly_hour_limit}h/mån` : ""}
                      {m.monthly_hour_limit && m.monthly_cost_limit ? " · " : ""}
                      {m.monthly_cost_limit ? `Max ${m.monthly_cost_limit} kr/mån` : ""}
                      {!m.monthly_hour_limit && !m.monthly_cost_limit ? "Ingen gräns" : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant={m.role === "admin" ? "default" : "secondary"} className="text-xs">
                    {m.role === "admin" ? "Admin" : "Medlem"}
                  </Badge>
                  {m.role !== "admin" && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                      setShowLimitModal(m);
                      setLimitForm({
                        monthly_hour_limit: m.monthly_hour_limit?.toString() || "",
                        monthly_cost_limit: m.monthly_cost_limit?.toString() || "",
                      });
                    }}>
                      <Settings2 className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

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
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Calendar className="w-4 h-4" /> Senaste bokningar
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recent_bookings?.length > 0 ? (
              <div className="space-y-2">
                {recent_bookings.map((b: any) => (
                  <div key={b.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div>
                      <p className="text-sm font-medium">{b.venue_courts?.name || "Bana"}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(b.start_time).toLocaleDateString("sv-SE")}{" "}
                        {new Date(b.start_time).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}–
                        {new Date(b.end_time).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    <Badge variant={b.status === "confirmed" ? "default" : "secondary"} className="text-xs">
                      {b.status === "confirmed" ? "Bekräftad" : b.status}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">Inga bokningar ännu</p>
            )}
          </CardContent>
        </Card>

        <Button
          onClick={() => navigate(`/book?v=${account?.venues?.name?.toLowerCase()}`)}
          variant="outline"
          className="w-full h-12"
        >
          Boka bana
        </Button>
      </div>
    </div>
  );
}
