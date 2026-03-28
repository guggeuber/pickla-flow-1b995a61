import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Building2, Copy, Users, Clock, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props { venueId: string }

export default function AdminCorporate({ venueId }: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ company_name: "", contact_name: "", contact_email: "", contact_phone: "", total_hours: "40" });

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

  const handleCreate = async () => {
    if (!form.company_name.trim()) { toast.error("Ange företagsnamn"); return; }
    setCreating(true);
    try {
      // Create account
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

      // Create default package
      const totalHours = parseFloat(form.total_hours) || 40;
      await supabase.from("corporate_packages").insert({
        corporate_account_id: account.id,
        venue_id: venueId,
        package_type: "hours",
        total_hours: totalHours,
      });

      toast.success(`${form.company_name} skapat!`);
      setShowCreate(false);
      setForm({ company_name: "", contact_name: "", contact_email: "", contact_phone: "", total_hours: "40" });
      refetch();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCreating(false);
    }
  };

  const copyInviteLink = (token: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/corp/join?token=${token}`);
    toast.success("Inbjudningslänk kopierad!");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{accounts?.length || 0} företagskonton</p>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1">
              <Plus className="w-4 h-4" /> Nytt företag
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Skapa företagskonto</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 pt-2">
              <Input placeholder="Företagsnamn *" value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
              <Input placeholder="Kontaktperson" value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
              <Input placeholder="E-post" type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
              <Input placeholder="Telefon" value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} />
              <Input placeholder="Antal timmar" type="number" value={form.total_hours} onChange={(e) => setForm({ ...form, total_hours: e.target.value })} />
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
                  <Building2 className="w-4 h-4 text-primary" />
                  {acc.company_name}
                </CardTitle>
                <Badge variant={acc.is_active ? "default" : "secondary"}>
                  {acc.is_active ? "Aktiv" : "Inaktiv"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Users className="w-3.5 h-3.5" />
                  <span>{memberCount} medlemmar</span>
                </div>
                {pkg && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{remaining}h / {pkg.total_hours}h</span>
                  </div>
                )}
              </div>

              {acc.contact_email && (
                <p className="text-xs text-muted-foreground">{acc.contact_name} · {acc.contact_email}</p>
              )}

              <Button
                size="sm"
                variant="outline"
                className="w-full gap-2"
                onClick={() => copyInviteLink(acc.invite_token)}
              >
                <Copy className="w-3.5 h-3.5" />
                Kopiera inbjudningslänk
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
    </div>
  );
}
