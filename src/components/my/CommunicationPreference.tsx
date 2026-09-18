import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { apiGet, apiPost } from "@/lib/api";

type CommunicationPreferenceState = {
  topic: "news_community";
  label: string;
  status: "pending_confirmation" | "subscribed" | "unsubscribed" | "suppressed";
  subscribed: boolean;
  suppressed: boolean;
  confirmation_expires_at: string | null;
};

const QUERY_KEY = ["communication-preference", "news_community"] as const;

export default function CommunicationPreference() {
  const queryClient = useQueryClient();
  const preference = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => apiGet<CommunicationPreferenceState>("api-communications", "preference"),
    staleTime: 30_000,
    retry: false,
  });
  const update = useMutation({
    mutationFn: (subscribed: boolean) => apiPost<CommunicationPreferenceState>(
      "api-communications",
      "preference",
      { subscribed, ...(subscribed ? { audience: "adult_or_parent_guardian" } : {}) },
    ),
    onSuccess: (next) => {
      queryClient.setQueryData(QUERY_KEY, next);
      toast.success(next.subscribed ? "Pickla news & community är aktiverat" : "E-postutskicken är avslutade");
    },
    onError: () => toast.error("Kunde inte uppdatera e-postinställningen"),
  });

  if (preference.isError) {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Mail className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-gray-900">Pickla news &amp; community</p>
            <p className="text-xs text-gray-500">Inställningen kunde inte hämtas.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void preference.refetch()}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-xs font-bold text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Försök igen
        </button>
      </div>
    );
  }

  const state = preference.data;
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <Mail className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-gray-900">Pickla news &amp; community</p>
          <p id="communication-preference-description" className="mt-0.5 text-xs leading-relaxed text-gray-500">
            För vuxna eller vårdnadshavare: nyheter, människor, event och redaktionellt från Pickla. Avsluta när du vill.
          </p>
          {state?.suppressed && (
            <p className="mt-1 text-xs font-semibold text-red-600">
              Adressen är leveransspärrad. Pickla Admin kan se orsaken.
            </p>
          )}
          {state?.status === "pending_confirmation" && (
            <p className="mt-1 text-xs font-semibold text-amber-700">
              Väntar på bekräftelse via e-post. Du kan också aktivera här med ditt verifierade konto.
            </p>
          )}
        </div>
      </div>
      <Switch
        checked={state?.subscribed === true}
        disabled={preference.isLoading || update.isPending || state?.suppressed === true}
        onCheckedChange={(checked) => update.mutate(checked)}
        aria-label="Pickla news & community"
        aria-describedby="communication-preference-description"
        className="data-[state=checked]:bg-blue-600"
      />
    </div>
  );
}
