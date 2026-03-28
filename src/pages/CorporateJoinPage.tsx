import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { apiGet, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Building2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export default function CorporateJoinPage() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [info, setInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) { setError("Ogiltig länk"); setLoading(false); return; }
    apiGet("api-corporate", "invite-info", { token })
      .then(setInfo)
      .catch(() => setError("Länken är ogiltig eller har gått ut"))
      .finally(() => setLoading(false));
  }, [token]);

  const handleJoin = async () => {
    if (!user) {
      navigate(`/auth?redirect=/corp/join?token=${token}`);
      return;
    }
    setJoining(true);
    try {
      const res = await apiPost("api-corporate", "join", { token });
      if (res.already_member) {
        toast.info("Du är redan medlem i detta företag");
      } else {
        toast.success(`Välkommen till ${res.company_name}!`);
      }
      setJoined(true);
    } catch (e: any) {
      toast.error(e.message || "Kunde inte gå med");
    } finally {
      setJoining(false);
    }
  };

  if (loading || authLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[hsl(24,85%,52%)]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6">
        <Card className="w-full max-w-md border-0 shadow-lg">
          <CardContent className="pt-8 pb-8 text-center">
            <p className="text-lg text-gray-600">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const venue = info?.venues;

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-6">
      <Card className="w-full max-w-md border-0 shadow-lg">
        <CardContent className="pt-8 pb-8 space-y-6 text-center">
          {venue?.logo_url && (
            <img src={venue.logo_url} alt={venue.name} className="h-12 mx-auto object-contain" />
          )}

          <div className="w-16 h-16 mx-auto rounded-2xl bg-[hsl(24,85%,52%)]/10 flex items-center justify-center">
            <Building2 className="w-8 h-8 text-[hsl(24,85%,52%)]" />
          </div>

          <div>
            <h1 className="text-2xl font-bold text-gray-900 font-['Space_Grotesk']">
              {info?.company_name}
            </h1>
            <p className="text-gray-500 mt-1">
              bjuder in dig att spela på {venue?.name || "anläggningen"}
            </p>
          </div>

          {joined ? (
            <div className="space-y-3">
              <CheckCircle2 className="w-12 h-12 mx-auto text-green-500" />
              <p className="text-green-700 font-medium">Du är nu ansluten!</p>
              <Button
                onClick={() => navigate("/my")}
                className="w-full bg-[hsl(24,85%,52%)] hover:bg-[hsl(24,85%,45%)] text-white"
              >
                Gå till Min sida
              </Button>
            </div>
          ) : (
            <Button
              onClick={handleJoin}
              disabled={joining}
              className="w-full h-14 text-lg bg-[hsl(24,85%,52%)] hover:bg-[hsl(24,85%,45%)] text-white rounded-xl font-['Space_Mono']"
            >
              {joining ? <Loader2 className="w-5 h-5 animate-spin" /> : user ? "Gå med" : "Logga in & gå med"}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
