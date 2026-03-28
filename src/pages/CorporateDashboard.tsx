import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { apiGet } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Building2, Users, Clock, Copy, ArrowLeft, Calendar } from "lucide-react";
import { toast } from "sonner";

export default function CorporateDashboard() {
  const [params] = useSearchParams();
  const accountId = params.get("id") || "";
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !accountId) return;
    apiGet("api-corporate", "dashboard", { accountId })
      .then(setData)
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [user, accountId]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[hsl(24,85%,52%)]" />
      </div>
    );
  }

  if (!user) {
    navigate("/auth");
    return null;
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6">
        <p className="text-gray-500">Kunde inte ladda företagsdata</p>
      </div>
    );
  }

  const { account, members, packages, recent_bookings } = data;
  const activePackage = packages?.find((p: any) => p.status === "active");
  const remainingHours = activePackage ? activePackage.total_hours - activePackage.used_hours : 0;
  const usagePercent = activePackage ? Math.round((activePackage.used_hours / activePackage.total_hours) * 100) : 0;

  const inviteUrl = `${window.location.origin}/corp/join?token=${account?.invite_token}`;

  const copyInviteLink = () => {
    navigator.clipboard.writeText(inviteUrl);
    toast.success("Inbjudningslänk kopierad!");
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/my")} className="text-gray-600">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-[hsl(24,85%,52%)]" />
          <h1 className="text-lg font-bold text-gray-900 font-['Space_Grotesk']">
            {account?.company_name}
          </h1>
        </div>
      </div>

      <div className="p-4 space-y-4 max-w-lg mx-auto pb-24">
        {/* Hours Bank */}
        {activePackage && (
          <Card className="border-0 shadow-md bg-gradient-to-br from-gray-900 to-gray-800 text-white">
            <CardContent className="pt-6 pb-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-[hsl(24,85%,52%)]" />
                  <span className="text-sm text-gray-300">Timbank</span>
                </div>
                <Badge variant="outline" className="text-[hsl(24,85%,52%)] border-[hsl(24,85%,52%)]/30">
                  {activePackage.package_type === 'hybrid' ? 'Hybrid' : 'Timmar'}
                </Badge>
              </div>

              <div className="text-center">
                <div className="text-5xl font-black font-['Space_Grotesk']">
                  {remainingHours}
                  <span className="text-lg text-gray-400 ml-1">h kvar</span>
                </div>
                <p className="text-gray-400 text-sm mt-1">
                  av {activePackage.total_hours}h totalt
                </p>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className="bg-[hsl(24,85%,52%)] h-2 rounded-full transition-all"
                  style={{ width: `${Math.min(usagePercent, 100)}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-gray-400">
                <span>{activePackage.used_hours}h använt</span>
                <span>{usagePercent}%</span>
              </div>

              {activePackage.valid_to && (
                <p className="text-xs text-gray-500 text-center">
                  Giltigt t.o.m. {new Date(activePackage.valid_to).toLocaleDateString('sv-SE')}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Invite Link */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
              <Users className="w-4 h-4" /> Bjud in kollegor
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <input
                readOnly
                value={inviteUrl}
                className="flex-1 text-xs bg-gray-50 border rounded-lg px-3 py-2 text-gray-600 truncate"
              />
              <Button size="sm" variant="outline" onClick={copyInviteLink}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Members */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">
              Medlemmar ({members?.length || 0})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {members?.map((m: any) => (
              <div key={m.id} className="flex items-center justify-between py-2 border-b last:border-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm font-medium text-gray-600">
                    {(m.profile?.display_name || "?")[0]?.toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {m.profile?.display_name || "Okänd"}
                    </p>
                    <p className="text-xs text-gray-400">{m.profile?.phone || ""}</p>
                  </div>
                </div>
                <Badge variant={m.role === "admin" ? "default" : "secondary"} className="text-xs">
                  {m.role === "admin" ? "Admin" : "Medlem"}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Recent Bookings */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
              <Calendar className="w-4 h-4" /> Senaste bokningar
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recent_bookings?.length > 0 ? (
              <div className="space-y-2">
                {recent_bookings.map((b: any) => (
                  <div key={b.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {b.venue_courts?.name || "Bana"}
                      </p>
                      <p className="text-xs text-gray-400">
                        {new Date(b.start_time).toLocaleDateString('sv-SE')}{" "}
                        {new Date(b.start_time).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}–
                        {new Date(b.end_time).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <Badge variant={b.status === 'confirmed' ? 'default' : 'secondary'} className="text-xs">
                      {b.status === 'confirmed' ? 'Bekräftad' : b.status}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-4">Inga bokningar ännu</p>
            )}
          </CardContent>
        </Card>

        {/* Book Button */}
        <Button
          onClick={() => navigate(`/book?v=${account?.venues?.name?.toLowerCase()}`)}
          className="w-full h-14 text-lg bg-[hsl(24,85%,52%)] hover:bg-[hsl(24,85%,45%)] text-white rounded-xl font-['Space_Mono']"
        >
          Boka bana
        </Button>
      </div>
    </div>
  );
}
