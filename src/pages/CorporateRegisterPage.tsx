import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { apiGet, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Building2, CheckCircle2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

export default function CorporateRegisterPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [venues, setVenues] = useState<any[]>([]);
  const [loadingVenues, setLoadingVenues] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<any>(null);
  const [form, setForm] = useState({
    company_name: "",
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    venue_id: "",
  });

  useEffect(() => {
    apiGet("api-corporate", "venues")
      .then(setVenues)
      .catch(() => {})
      .finally(() => setLoadingVenues(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.company_name.trim() || !form.venue_id) {
      toast.error("Fyll i företagsnamn och välj anläggning");
      return;
    }

    if (!user) {
      const redirect = `/corp/register`;
      navigate(`/auth?redirect=${encodeURIComponent(redirect)}`);
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiPost("api-corporate", "register", form);
      setSuccess(res);
      toast.success("Ansökan skickad!");
    } catch (e: any) {
      toast.error(e.message || "Kunde inte registrera");
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading || loadingVenues) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="w-full max-w-md border-0 shadow-lg">
        <CardHeader className="text-center space-y-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/")}
            className="absolute left-4 top-4 text-muted-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>

          <div className="w-16 h-16 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center">
            <Building2 className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold font-['Space_Grotesk']">
            Företagskonto
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Registrera ditt företag för att boka banor med timbank
          </p>
        </CardHeader>

        {success ? (
          <CardContent className="text-center space-y-4 pb-8">
            <CheckCircle2 className="w-12 h-12 mx-auto text-green-500" />
            <p className="font-medium text-foreground">Kontot är skapat!</p>
            <p className="text-sm text-muted-foreground">
              Ordernummer: <span className="font-mono font-bold">{success.invite_token?.slice(0, 8).toUpperCase()}</span>
            </p>
            <Button onClick={() => navigate("/corp/dashboard?id=" + success.account_id)} className="w-full">
              Gå till din företagsportal
            </Button>
          </CardContent>
        ) : (
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Select value={form.venue_id} onValueChange={(v) => setForm({ ...form, venue_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Välj anläggning" />
                  </SelectTrigger>
                  <SelectContent>
                    {venues.map((v: any) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name} {v.city ? `· ${v.city}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                placeholder="Företagsnamn *"
                value={form.company_name}
                onChange={(e) => setForm({ ...form, company_name: e.target.value })}
                required
              />
              <Input
                placeholder="Kontaktperson"
                value={form.contact_name}
                onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
              />
              <Input
                placeholder="E-post"
                type="email"
                value={form.contact_email}
                onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
              />
              <Input
                placeholder="Telefon"
                value={form.contact_phone}
                onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
              />
              <Button type="submit" disabled={submitting} className="w-full h-12 text-base">
                {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : user ? "Registrera företag" : "Logga in & registrera"}
              </Button>
            </form>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
