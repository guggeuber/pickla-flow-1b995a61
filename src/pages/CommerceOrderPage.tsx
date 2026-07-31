import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Loader2, ReceiptText, Ticket, XCircle } from "lucide-react";
import { DateTime } from "luxon";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { activityCheckInAvailable } from "@/lib/activityTiming";
import { preserveIntendedRoute } from "@/lib/entryResolver";
import {
  checkInCommerceGuest,
  claimCommerceOrderAccount,
  commerceRacketPickupQuantity,
  commerceRacketSuccessInstruction,
  confirmCommerceGuestIdentity,
  fetchCommerceOrder,
  formatCommerceMoney,
} from "@/lib/commerce";

function fulfillmentLabel(status: string, cancelled: boolean) {
  if (cancelled || status === "not_collected") return "Ej längre tillgänglig för uthämtning";
  if (status === "collected") return "Uthämtad";
  if (status === "attention") return "Kontakta Pickla";
  return "Hämtas ut i desken";
}

export default function CommerceOrderPage() {
  const [params] = useSearchParams();
  const routeParams = useParams<{ token?: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const token = routeParams.token || params.get("token") || "";
  const query = useQuery({ queryKey: ["commerce-order", token, user?.id || "guest"], queryFn: () => fetchCommerceOrder(token), enabled: token.length >= 32 && !authLoading, refetchInterval: (state) => state.state.data?.order.status === "checkout_pending" ? 1200 : false });
  const confirmIdentity = useMutation({
    mutationFn: () => confirmCommerceGuestIdentity(token, displayName.trim()),
    onSuccess: async () => { toast.success("Din biljett är klar"); await query.refetch(); },
    onError: (error: Error) => toast.error(error.message || "Kunde inte spara namnet"),
  });
  const claimAccount = useMutation({
    mutationFn: () => claimCommerceOrderAccount(token),
    onSuccess: async () => { toast.success("Köpet är kopplat till ditt konto"); await query.refetch(); },
    onError: (error: Error) => toast.error(error.message || "Kunde inte koppla köpet"),
  });
  const checkIn = useMutation({
    mutationFn: () => checkInCommerceGuest(token),
    onSuccess: async () => { toast.success("Du är incheckad"); await query.refetch(); },
    onError: (error: Error) => toast.error(error.message || "Kunde inte checka in"),
  });
  const activity = query.data?.activity_access;
  const checkInAvailable = useMemo(() => activity ? activityCheckInAvailable({
    sessionDate: activity.session_date,
    startTime: activity.start_time,
    endTime: activity.end_time,
  }) : false, [activity]);
  const activityDate = activity
    ? DateTime.fromISO(activity.session_date, { zone: "Europe/Stockholm" }).setLocale("sv").toFormat("cccc d MMM")
    : "";
  const startAuth = () => {
    const currentPath = `${window.location.pathname}${window.location.search}`;
    preserveIntendedRoute(currentPath);
    navigate(`/auth?redirect=${encodeURIComponent(currentPath)}`);
  };
  if (query.isLoading || authLoading) return <div className="grid min-h-[100dvh] place-items-center bg-white"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!query.data) return <div className="grid min-h-[100dvh] place-items-center bg-white px-6 text-center">Ordern kunde inte öppnas.</div>;
  const { order, lines, receipt } = query.data;
  const hasParticipation = Boolean(activity);
  const isCancelled = order.status === "cancelled" || activity?.registration_status === "cancelled";
  const checkedIn = activity?.registration_status === "checked_in";
  const cancellationPending = Boolean(order.cancellation_pending);
  const requiresGuestClaim = order.requires_guest_claim === true;
  const managementRegistrationId = activity?.registration_id
    || lines.find((line) => line.commerce_kind === "participation")?.session_registration_id
    || null;
  const managementPath = managementRegistrationId
    ? `/my?registration=${encodeURIComponent(managementRegistrationId)}${activity?.venue_slug ? `&v=${encodeURIComponent(activity.venue_slug)}` : ""}`
    : null;
  const canManageBooking = Boolean(user && order.account_claimed && managementPath);
  const participantConfirmed = !hasParticipation || ["confirmed", "checked_in", "no_show"].includes(String(activity?.registration_status || ""));
  const purchaseConfirmed = order.status === "paid" && participantConfirmed;
  const waiting = order.status === "checkout_pending";
  const needsReview = order.status === "attention" || (order.status === "paid" && !participantConfirmed);
  const racketQuantity = purchaseConfirmed && !cancellationPending
    ? commerceRacketPickupQuantity(lines, { confirmed: true })
    : 0;
  const racketInstruction = commerceRacketSuccessInstruction(racketQuantity);
  const receiptNumber = String((receipt as { receipt_number?: string } | null)?.receipt_number || "");
  const purchaseReference = receiptNumber || order.id.slice(0, 8).toUpperCase();
  const heading = waiting
    ? "Vi bekräftar ditt köp"
    : isCancelled
      ? "Köpet är avbokat"
      : purchaseConfirmed && hasParticipation
        ? "Platsen är din"
        : purchaseConfirmed
          ? "Köpet är klart"
          : order.status === "draft"
            ? "Köpet är inte betalt"
            : "Vi kontrollerar ditt köp";
  const supportingCopy = waiting
    ? "Det tar vanligtvis bara några sekunder."
    : purchaseConfirmed && hasParticipation
      ? `Du är anmäld till ${activity?.name}.`
      : purchaseConfirmed
        ? "Spara den här sidan för kvitto och orderinformation."
        : needsReview
          ? "Vi behöver kontrollera köpet innan plats eller uthämtning kan bekräftas."
          : isCancelled
            ? "Platsen och eventuella uthämtningsprodukter är återkallade."
            : "Gå tillbaka till ordersammanfattningen för att slutföra betalningen.";
  return (
    <div className="min-h-[100dvh] bg-white px-4 pb-12 pt-[calc(env(safe-area-inset-top,0px)+36px)] text-slate-950">
      <main className="mx-auto max-w-lg">
        <div className="mb-9 text-center">{waiting ? <Loader2 className="mx-auto h-7 w-7 animate-spin text-slate-600" /> : purchaseConfirmed ? <Check data-testid="commerce-success-check" className="mx-auto h-8 w-8 stroke-[1.75] text-slate-950" /> : <XCircle className="mx-auto h-7 w-7 text-slate-600" />}<h1 className="mt-5 text-3xl font-black">{heading}</h1><p className="mt-2 text-sm text-slate-500">{supportingCopy}</p></div>
        {purchaseConfirmed && activity ? (
          <section className="mb-6 px-1">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Din aktivitet</p>
            <h2 className="mt-1 text-xl font-black">{activity.name}</h2>
            <p className="mt-3 text-sm font-semibold">{activityDate} · {String(activity.start_time || "").slice(0, 5)}–{String(activity.end_time || "").slice(0, 5)}</p>
            {activity.venue_name ? <p className="mt-1 text-sm text-slate-500">{activity.venue_name}</p> : null}
            {order.customer_name ? <p className="mt-3 text-sm"><span className="text-slate-500">Spelare</span> · <strong>{order.customer_name}</strong></p> : null}
            <p className="mt-1 text-xs text-slate-500">Referens {purchaseReference}</p>
          </section>
        ) : null}
        {racketInstruction ? <section className="mb-6 border-t border-black/10 px-1 pt-5"><h2 className="font-black">Hyrrack</h2><p className="mt-1 text-sm font-medium leading-relaxed text-slate-700">{racketInstruction.summary} {racketInstruction.pickup}</p></section> : null}
        {purchaseConfirmed && hasParticipation && requiresGuestClaim && !isCancelled ? (
          <section className="mb-6 border-y border-black/10 py-5">
            <div><h2 className="font-black">Vem ska spela?</h2><p className="text-sm text-slate-500">Namnet visas på din biljett.</p></div>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="För- och efternamn" className="mt-4 h-12 w-full rounded-xl border border-black/15 px-3 text-base outline-none focus:border-slate-950 focus:ring-1 focus:ring-slate-950" />
            <button type="button" onClick={() => confirmIdentity.mutate()} disabled={!displayName.trim() || confirmIdentity.isPending} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 font-black text-white disabled:opacity-40">{confirmIdentity.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Bekräfta namn och visa biljett</button>
          </section>
        ) : null}
        {purchaseConfirmed && hasParticipation && !requiresGuestClaim ? (
          <section id="ticket" className="mb-6 border-y border-black/10 py-5 text-slate-950">
            <div className="flex items-start gap-3"><Ticket data-testid="commerce-ticket-icon" className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" /><div><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Din biljett</p><h2 className="mt-0.5 text-xl font-black">{activity?.name}</h2></div></div>
            <p className="mt-3 text-sm font-semibold">{activityDate} · {String(activity?.start_time || "").slice(0, 5)}–{String(activity?.end_time || "").slice(0, 5)}</p>
            <button type="button" onClick={() => checkIn.mutate()} disabled={checkedIn || !checkInAvailable || checkIn.isPending || isCancelled} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 font-black text-white disabled:opacity-40">{checkIn.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{checkedIn ? "Incheckad" : "Checka in"}</button>
            {canManageBooking ? <Link to={managementPath!} className="mt-3 flex h-11 items-center justify-center rounded-xl border border-black/15 bg-white text-sm font-black text-slate-950">Visa bokning</Link> : null}
            {user && order.account_claimed && activity?.venue_slug ? <Link to={`/p/${activity.activity_session_id}?date=${activity.session_date}&v=${encodeURIComponent(activity.venue_slug)}&ticket=1`} className="mt-2 flex h-10 items-center justify-center text-sm font-bold text-slate-600 underline decoration-black/20 underline-offset-4">Öppna aktivitet och chatt</Link> : null}
            {!order.account_claimed ? user ? (
              <button type="button" onClick={() => claimAccount.mutate()} disabled={claimAccount.isPending} className="mt-3 h-11 w-full rounded-xl border border-black/15 bg-white text-sm font-black text-slate-950 disabled:opacity-40">Koppla köpet till mitt konto</button>
            ) : (
              <div className="mt-3">
                <button type="button" onClick={startAuth} className="h-11 w-full rounded-xl border border-black/15 bg-white text-sm font-black text-slate-950">Spara bokningen</button>
                <p className="mt-2 text-center text-xs leading-relaxed text-slate-500">Skapa konto och få biljett, kvitto och bokningshistorik på Min sida.</p>
              </div>
            ) : null}
          </section>
        ) : null}
        <section className="divide-y divide-black/10 border-y border-black/10">
          {lines.map((line) => {
            const lineName = activity && line.commerce_kind === "participation" ? "Personlig plats" : line.product_name;
            return <div key={line.id} className="flex items-center justify-between gap-3 py-4"><div><p className="font-bold">{lineName}{line.quantity > 1 ? ` · ${line.quantity} st` : ""}</p><p className="text-xs text-slate-500">{line.fulfillment_type === "desk_pickup" ? fulfillmentLabel(line.fulfillment_status, isCancelled) : "Din plats"}</p></div><p className="font-black">{formatCommerceMoney(line.line_total_inc_vat_minor || line.unit_price_minor * line.quantity)}</p></div>;
          })}
        </section>
        <section className="py-5"><div className="flex items-center justify-between"><span className="text-sm text-slate-500">Totalt</span><strong className="text-xl">{formatCommerceMoney(order.total_inc_vat_minor)}</strong></div>{receiptNumber ? <p className="mt-3 flex items-center gap-2 text-xs text-slate-500"><ReceiptText className="h-4 w-4" /> Kvitto {receiptNumber}</p> : null}</section>
        <div className="mt-6 grid gap-2">{user && !canManageBooking ? <Link to="/my" className="flex h-12 items-center justify-center rounded-2xl bg-slate-950 font-bold text-white">Till Min sida</Link> : null}<Link to="/shop" className="flex h-12 items-center justify-center rounded-2xl border border-black/10 bg-white font-bold">Fortsätt handla</Link></div>
      </main>
    </div>
  );
}
