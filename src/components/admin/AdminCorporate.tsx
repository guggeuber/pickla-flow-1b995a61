import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { apiPatch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Building2, Copy, Users, Clock, Loader2, ShoppingCart, FileText, CheckCircle2, CreditCard } from "lucide-react";
import { toast } from "sonner";

interface Props { venueId: string }

const statusLabel: Record<string, string> = {
  pending: "Väntar", invoiced: "Fakturerad", paid: "Betald", fulfilled: "Levererad", cancelled: "Avbruten",
};
const statusColor: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800", invoiced: "bg-blue-100 text-blue-800",
  paid: "bg-green-100 text-green-800", fulfilled: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-red-100 text-red-800",
};
const DAYS = ["Sön", "Mån", "Tis", "Ons", "Tor", "Fre", "Lör"];

export default function AdminCorporate({ venueId }: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ company_name: "", contact_name: "", contact_email: "", contact_phone: "", total_hours: "40", discount_percent: "0" });

  const { data: accounts, refetch } = useQuery({
    queryKey: ["admin-corporate", venueId],
    enabled: !!venueId,
    queryFn: async () => {
      const { data } = await supabase
        .from("corporate_accounts")
        .select("*, corporate_packages(*), corporate_members(id)")
        .eq("venue_id", venueId)
        .order("created_at", { ascending: false });
      return data || [];
    },
  });

  const { data: orders, refetch: refetchOrders } = useQuery({
    queryKey: ["admin-corporate-orders", venueId],
    enabled: !!venueId,
    queryFn: async () => {
      const { data } = await supabase
        .from("corporate_orders")
        .select("*, corporate_accounts(company_name), corporate_order_items(id)")
        .eq("venue_id", venueId)
        .order("created_at", { ascending: false });
      return data || [];
    },
  });

  const handleCreate = async () => {
    if (!form.company_name.trim()) { toast.error("Ange företagsnamn"); return; }
    setCreating(true);
    try {
      const { data: account, error } = await supabase
        .from("corporate_accounts")
        .insert({
          venue_id: venueId,
          company_name: form.company_name.trim(),
          contact_name: form.contact_name.trim() || null,
          contact_email: form.contact_email.trim() || null,
          contact_phone: form.contact_phone.trim() || null,
        })
        .select()
        .single();

      if (error) throw error;

      // Set discount if provided
      const discountPct = parseFloat(form.discount_percent) || 0;
      if (discountPct > 0) {
        await supabase.from("corporate_accounts").update({ discount_percent: discountPct }).eq("id", account.id);
      }

      const totalHours = parseFloat(form.total_hours) || 40;
      await supabase.from("corporate_packages").insert({
        corporate_account_id: account.id,
        venue_id: venueId,
        package_type: "hours",
        total_hours: totalHours,
      });

      toast.success(`${form.company_name} skapat!`);
      setShowCreate(false);
      setForm({ company_name: "", contact_name: "", contact_email: "", contact_phone: "", total_hours: "40", discount_percent: "0" });
      refetch();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCreating(false);
    }
  };

  const updateOrderStatus = async (orderId: string, status: string) => {
    try {
      await apiPatch("api-corporate", "orders", { order_id: orderId, status });
      toast.success(`Order ${statusLabel[status] || status}`);
      refetchOrders();
      refetch();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const copyInviteLink = (token: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/corp/join?token=${token}`);
    toast.success("Inbjudningslänk kopierad!");
  };

  return (
    <Tabs defaultValue="accounts" className="space-y-4">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="accounts" className="gap-1"><Building2 className="w-3.5 h-3.5" /> Konton</TabsTrigger>
        <TabsTrigger value="orders" className="gap-1"><ShoppingCart className="w-3.5 h-3.5" /> Ordrar</TabsTrigger>
      </TabsList>

      {/* ACCOUNTS TAB */}
      <TabsContent value="accounts" className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{accounts?.length || 0} företagskonton</p>
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1"><Plus className="w-4 h-4" /> Nytt företag</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Skapa företagskonto</DialogTitle></DialogHeader>
              <div className="space-y-3 pt-2">
                <Input placeholder="Företagsnamn *" value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
                <Input placeholder="Kontaktperson" value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
                <Input placeholder="E-post" type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
                <Input placeholder="Telefon" value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} />
                <Input placeholder="Antal timmar" type="number" value={form.total_hours} onChange={(e) => setForm({ ...form, total_hours: e.target.value })} />
                <Input placeholder="Rabatt % (0 = ingen)" type="number" value={form.discount_percent} onChange={(e) => setForm({ ...form, discount_percent: e.target.value })} />
                <Button onClick={handleCreate} disabled={creating} className="w-full">
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Skapa"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {accounts?.map((acc: any) => {
          const pkg = acc.corporate_packages?.[0];
          const memberCount = acc.corporate_members?.length || 0;
          const remaining = pkg ? pkg.total_hours - pkg.used_hours : 0;
          return (
            <Card key={acc.id} className="glass-card">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-primary" />{acc.company_name}
                  </CardTitle>
                  <Badge variant={acc.is_active ? "default" : "secondary"}>
                    {acc.is_active ? "Aktiv" : "Inaktiv"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Users className="w-3.5 h-3.5" /><span>{memberCount} medlemmar</span>
                  </div>
                  {pkg && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock className="w-3.5 h-3.5" /><span>{remaining}h / {pkg.total_hours}h</span>
                    </div>
                  )}
                </div>
                {acc.contact_email && (
                  <p className="text-xs text-muted-foreground">{acc.contact_name} · {acc.contact_email}</p>
                )}
                <Button size="sm" variant="outline" className="w-full gap-2" onClick={() => copyInviteLink(acc.invite_token)}>
                  <Copy className="w-3.5 h-3.5" />Kopiera inbjudningslänk
                </Button>
              </CardContent>
            </Card>
          );
        })}

        {(!accounts || accounts.length === 0) && (
          <div className="text-center py-12 text-muted-foreground">
            <Building2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Inga företagskonton ännu</p>
          </div>
        )}
      </TabsContent>

      {/* ORDERS TAB */}
      <TabsContent value="orders" className="space-y-4">
        <p className="text-sm text-muted-foreground">{orders?.length || 0} ordrar</p>

        {orders?.map((o: any) => {
          const nextAction = o.status === "pending" ? "invoiced" : o.status === "invoiced" ? "paid" : o.status === "paid" ? "fulfilled" : null;
          const nextLabel = nextAction === "invoiced" ? "Markera fakturerad" : nextAction === "paid" ? "Markera betald" : nextAction === "fulfilled" ? "Leverera & aktivera" : null;
          const NextIcon = nextAction === "invoiced" ? FileText : nextAction === "paid" ? CreditCard : nextAction === "fulfilled" ? CheckCircle2 : null;

          return (
            <Card key={o.id} className="border shadow-sm">
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-mono text-sm font-bold">{o.order_number}</span>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {(o as any).corporate_accounts?.company_name || "Företag"}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor[o.status] || "bg-muted"}`}>
                    {statusLabel[o.status] || o.status}
                  </span>
                </div>

                <div className="text-sm text-muted-foreground">
                  {o.order_type === "hours" ? `${o.total_hours}h timbank` : `Bokningsserie · ${o.corporate_order_items?.length || (o as any).corporate_order_items?.length || 0} tillfällen`}
                  {o.total_price > 0 && ` · ${o.total_price} ${o.currency || "SEK"}`}
                </div>

                <div className="text-xs text-muted-foreground">
                  Skapad: {new Date(o.created_at).toLocaleDateString("sv-SE")}
                  {o.invoiced_at && ` · Fakturerad: ${new Date(o.invoiced_at).toLocaleDateString("sv-SE")}`}
                  {o.paid_at && ` · Betald: ${new Date(o.paid_at).toLocaleDateString("sv-SE")}`}
                  {o.fulfilled_at && ` · Levererad: ${new Date(o.fulfilled_at).toLocaleDateString("sv-SE")}`}
                </div>

                {o.notes && <p className="text-xs text-muted-foreground italic">{o.notes}</p>}

                {nextAction && nextLabel && (
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1 gap-1" onClick={() => updateOrderStatus(o.id, nextAction)}>
                      {NextIcon && <NextIcon className="w-3.5 h-3.5" />}
                      {nextLabel}
                    </Button>
                    {o.status !== "cancelled" && (
                      <Button size="sm" variant="destructive" onClick={() => updateOrderStatus(o.id, "cancelled")}>
                        Avbryt
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        {(!orders || orders.length === 0) && (
          <div className="text-center py-12 text-muted-foreground">
            <ShoppingCart className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Inga ordrar ännu</p>
            <p className="text-xs mt-1">Företag skapar beställningar via sin portal</p>
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}
