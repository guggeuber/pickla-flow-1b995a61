import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Loader2, MessageCircle, ReceiptText, Share2, Ticket, XCircle } from "lucide-react";
import { DateTime } from "luxon";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { PicklaTopBar } from "@/components/PicklaTopBar";
import { useAuth } from "@/hooks/useAuth";
import { activityCheckInAvailable } from "@/lib/activityTiming";
import { canonicalAppUrl } from "@/lib/canonicalOrigin";
import { preserveIntendedRoute } from "@/lib/entryResolver";
import {
  COMMERCE_PICKUP_COPY,
  activityCommerceSelectionKey,
  checkInCommerceGuest,
  checkInCommerceRegistration,
  cancelCommerceCheckout,
  clearActivityCommerceSelection,
  claimCommerceOrderAccount,
  commerceRacketPickupQuantity,
  commerceRacketSuccessInstruction,
  confirmCommerceGuestIdentity,
  fetchCommerceOrder,
  formatCommerceMoney,
} from "@/lib/commerce";
import { occurrenceCountLabel, seriesPresentation } from "@/lib/seriesPresentation";
import { shareOrCopy } from "@/lib/share";

function fulfillmentLabel(status: string, cancelled: boolean) {
  if (cancelled || status === "not_collected") return "Ej längre tillgänglig för uthämtning";
  if (status === "collected") return "Uthämtad";
  if (status === "attention") return "Kontakta Pickla";
  return COMMERCE_PICKUP_COPY;
}

export default function CommerceOrderPage() {
  const [params] = useSearchParams();
  const routeParams = useParams<{ token?: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const token = routeParams.token || params.get("token") || "";
  const checkoutSessionId = params.get("session") || "";
  const venueSlug = params.get("v") || "pickla-arena-sthlm";
  const query = useQuery({
    queryKey: ["commerce-order", token, user?.id || "guest", checkoutSessionId || "no-checkout-return"],
    queryFn: () => fetchCommerceOrder(token, {}, checkoutSessionId),
    enabled: token.length >= 32 && !authLoading,
    refetchInterval: (state) => state.state.data?.order.status === "checkout_pending"
      && state.state.data?.checkout_verification_eligible === true ? 1200 : false,
  });
  const reopenCheckout = useMutation({
    mutationFn: () => cancelCommerceCheckout(token),
    onSuccess: (response) => {
      if (response.checkout_verification_eligible && response.checkout_session_id) {
        navigate(`/commerce/confirmed?token=${encodeURIComponent(token)}&v=${encodeURIComponent(venueSlug)}&session=${encodeURIComponent(response.checkout_session_id)}`, { replace: true });
        return;
      }
      if (["paid", "attention"].includes(response.order.status)) {
        void query.refetch();
        return;
      }
      navigate(`/cart?token=${encodeURIComponent(token)}&v=${encodeURIComponent(venueSlug)}&checkout=cancelled`, { replace: true });
    },
    onError: (error: Error) => toast.error(error.message || "Kunde inte öppna köpet igen"),
  });
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
    mutationFn: () => {
      const registrationId = query.data?.activity_access?.registration_id;
      const venueId = query.data?.order.venue_id;
      return user && query.data?.order.account_claimed && registrationId && venueId
        ? checkInCommerceRegistration(venueId, registrationId)
        : checkInCommerceGuest(token);
    },
    onSuccess: async () => { toast.success("Du är incheckad"); await query.refetch(); },
    onError: (error: Error) => toast.error(error.message || "Kunde inte checka in"),
  });
  const activity = query.data?.activity_access;
  const course = query.data?.course_access;
  const league = query.data?.league_access;
  useEffect(() => {
    if (query.data?.order.status !== "paid" || !activity?.activity_session_id || !activity.session_date) return;
    clearActivityCommerceSelection(activityCommerceSelectionKey(activity.activity_session_id, activity.session_date));
  }, [activity?.activity_session_id, activity?.session_date, query.data?.order.status]);
  const coursePresentation = seriesPresentation(course?.presentation_type);
  const courseOccurrenceSummary = course
    ? coursePresentation.hideSingleOccurrenceCount && Number(course.total_sessions) === 1
      ? `${DateTime.fromISO(course.start_date).setLocale("sv").toFormat("d MMMM")} · ${String(course.start_time).slice(0, 5)}–${String(course.end_time).slice(0, 5)}`
      : `${occurrenceCountLabel(Number(course.total_sessions))} · start ${DateTime.fromISO(course.start_date).setLocale("sv").toFormat("d MMMM")}`
    : "";
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
  if (query.isLoading || authLoading) return <div className="min-h-[100dvh] bg-white"><PicklaTopBar slug={venueSlug} background="#ffffff" /><div className="grid min-h-[100dvh] place-items-center pt-20"><Loader2 className="h-6 w-6 animate-spin" /></div></div>;
  if (!query.data) return <div className="min-h-[100dvh] bg-white"><PicklaTopBar slug={venueSlug} background="#ffffff" /><div className="grid min-h-[100dvh] place-items-center px-6 pt-20 text-center">Ordern kunde inte öppnas.</div></div>;
  const { order, lines, receipt } = query.data;
  const dayPassLine = lines.find((line) => line.product_key === "day_access" || line.resolver_snapshot?.purchase_kind === "day_pass");
  const isDayPassPurchase = Boolean(dayPassLine);
  const hasParticipation = Boolean(activity || course || league);
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
  const participantConfirmed = league
    ? league.status === "active"
    : course
      ? Boolean(course.commitment_id)
    : !hasParticipation || ["confirmed", "checked_in", "no_show"].includes(String(activity?.registration_status || ""));
  const purchaseConfirmed = order.status === "paid" && participantConfirmed;
  const waiting = order.status === "checkout_pending" && query.data.checkout_verification_eligible === true;
  const interruptedCheckout = order.status === "checkout_pending" && !waiting;
  const needsReview = order.status === "attention" || (order.status === "paid" && !participantConfirmed);
  const racketQuantity = purchaseConfirmed && !cancellationPending
    ? commerceRacketPickupQuantity(lines, { confirmed: true })
    : 0;
  const racketInstruction = commerceRacketSuccessInstruction(racketQuantity);
  const receiptNumber = String((receipt as { receipt_number?: string } | null)?.receipt_number || "");
  const purchaseReference = receiptNumber || order.id.slice(0, 8).toUpperCase();
  const activityPath = activity?.venue_slug
    ? `/p/${activity.activity_session_id}?date=${activity.session_date}&v=${encodeURIComponent(activity.venue_slug)}&ticket=1`
    : null;
  const resolvedVenueSlug = activity?.venue_slug || course?.venue_slug || league?.venue_slug || venueSlug;
  const shareActivity = async () => {
    if (!activity || !activityPath) return;
    const shareUrl = `${window.location.origin}${activityPath.replace(/&ticket=1$/, "")}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: activity.name, url: shareUrl });
        return;
      }
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Länk kopierad");
    } catch (error: unknown) {
      if (!(error instanceof Error) || error.name !== "AbortError") toast.error("Kunde inte dela länken");
    }
  };
  const heading = waiting
    ? "Vi bekräftar ditt köp"
    : interruptedCheckout
      ? "Betalningen avbröts"
    : isCancelled
      ? "Köpet är avbokat"
      : purchaseConfirmed && league
        ? "Laget är anmält"
      : purchaseConfirmed && hasParticipation
        ? "Platsen är din"
        : purchaseConfirmed
          ? "Köpet är klart"
          : order.status === "draft"
            ? "Köpet är inte betalt"
            : "Vi kontrollerar ditt köp";
  const supportingCopy = waiting
    ? "Det tar vanligtvis bara några sekunder."
    : interruptedCheckout
      ? "Din plats är inte bokad."
    : purchaseConfirmed && isDayPassPurchase
      ? `Du har heldagstillgång och en plats på ${activity?.name}.`
    : purchaseConfirmed && hasParticipation
        ? league ? `Laget ${league.team_name} är anmält.` : course ? `Du har en plats på ${course.name}.` : `Du är anmäld till ${activity?.name}.`
      : purchaseConfirmed
        ? "Spara den här sidan för kvitto och orderinformation."
        : needsReview
          ? "Vi behöver kontrollera köpet innan plats eller uthämtning kan bekräftas."
          : isCancelled
            ? "Platsen och eventuella uthämtningsprodukter är återkallade."
            : "Gå tillbaka till ordersammanfattningen för att slutföra betalningen.";
  return (
    <div className="min-h-[100dvh] bg-white px-4 pb-12 pt-[calc(env(safe-area-inset-top,0px)+104px)] text-slate-950">
      <PicklaTopBar slug={resolvedVenueSlug} background="#ffffff" />
      <main className="relative mx-auto max-w-lg">
        {purchaseConfirmed && activity ? (
          <div className="absolute right-0 top-0 flex items-center gap-1" data-testid="commerce-success-actions">
            {user && order.account_claimed && activityPath ? (
              <Link to={activityPath} aria-label="Chatt" className="grid h-11 w-11 place-items-center rounded-full text-neutral-500 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950">
                <MessageCircle className="h-5 w-5" />
              </Link>
            ) : (
              <button type="button" disabled aria-label="Chatt" className="grid h-11 w-11 place-items-center rounded-full text-neutral-500 opacity-35">
                <MessageCircle className="h-5 w-5" />
              </button>
            )}
            <button type="button" onClick={shareActivity} aria-label="Dela" className="grid h-11 w-11 place-items-center rounded-full text-neutral-500 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950">
              <Share2 className="h-5 w-5" />
            </button>
          </div>
        ) : null}
        {purchaseConfirmed && course ? (
          <section className="mb-6 px-1">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{coursePresentation.type === "course" ? "Din kurs" : coursePresentation.label}</p>
            <h2 className="mt-1 text-xl font-black">{course.name}</h2>
            <p className="mt-3 text-sm font-semibold">{courseOccurrenceSummary}</p>
            {course.participant_name ? <p className="mt-1 text-sm text-slate-500">Deltagare: {course.participant_name}</p> : null}
            {course.venue_name ? <p className="mt-1 text-sm text-slate-500">{course.venue_name}</p> : null}
            <p className="mt-1 text-xs text-slate-500">Referens {purchaseReference}</p>
          </section>
        ) : null}
        {purchaseConfirmed && league ? (
          <section className="mb-6 px-1" data-testid="league-purchase-confirmation">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#ed3f8f]">Laget är anmält</p>
            <h2 className="mt-1 text-2xl font-black">{league.team_name}</h2>
            <p className="mt-2 text-lg font-bold">{league.series_name}</p>
            <div className="mt-4 grid gap-1 text-sm">
              {league.members.map((member) => <p key={member.role}><span className="text-slate-500">{member.role === "captain" ? "Lagkapten" : "Spelare 2"}</span> · <strong>{member.name}</strong></p>)}
              <p className="mt-2 font-semibold">5 torsdagar · {String(league.start_time).slice(0, 5)}–{String(league.end_time).slice(0, 5)}</p>
              <p className="text-slate-500">Första kvällen · {DateTime.fromISO(league.start_date).setLocale("sv").toFormat("d MMMM")}</p>
            </div>
            {!league.fixtures_published_at && league.fixture_publication_deadline ? <p className="mt-4 rounded-2xl bg-[#fff2f7] p-4 text-sm font-bold">Spelschemat publiceras senast {DateTime.fromISO(league.fixture_publication_deadline).setLocale("sv").toFormat("d MMMM")}.</p> : null}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Link to={`/seriespel/${league.activity_series_id}?v=${encodeURIComponent(resolvedVenueSlug)}`} className="flex h-12 items-center justify-center rounded-2xl bg-slate-950 px-3 text-center text-sm font-black text-white">Visa Seriespel</Link>
              <button type="button" onClick={() => void (async () => {
                const url = canonicalAppUrl(`/seriespel/${league.activity_series_id}?v=${encodeURIComponent(resolvedVenueSlug)}`);
                const result = await shareOrCopy({ title: league.series_name, text: "Anmäl ett lag till Pickla Seriespel", url, copyText: url });
                if (result === "copied") toast.success("Länk kopierad");
              })()} className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-black/15 text-sm font-black"><Share2 className="h-4 w-4" /> Dela Seriespel</button>
            </div>
            <p className="mt-3 text-xs text-slate-500">Referens {purchaseReference}</p>
          </section>
        ) : null}
        <div className="mb-9 px-12 text-center">{waiting ? <Loader2 className="mx-auto h-7 w-7 animate-spin text-slate-600" /> : purchaseConfirmed ? <Check data-testid="commerce-success-check" className="mx-auto h-8 w-8 stroke-[1.75] text-slate-950" /> : <XCircle className="mx-auto h-7 w-7 text-slate-600" />}<h1 className="mt-5 text-3xl font-black">{heading}</h1><p className="mt-2 text-sm text-slate-500">{supportingCopy}</p></div>
        {interruptedCheckout ? <section className="mb-6 grid gap-3 border-y border-black/10 py-5">
          <button type="button" onClick={() => reopenCheckout.mutate()} disabled={reopenCheckout.isPending} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-slate-950 font-black text-white disabled:opacity-40">{reopenCheckout.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Försök igen</button>
        </section> : null}
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
        {purchaseConfirmed && activity && requiresGuestClaim && !isCancelled ? (
          <section className="mb-6 border-y border-black/10 py-5">
            <div><h2 className="font-black">Vem ska spela?</h2><p className="text-sm text-slate-500">Namnet visas på din biljett.</p></div>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="För- och efternamn" className="mt-4 h-12 w-full rounded-xl border border-black/15 px-3 text-base outline-none focus:border-slate-950 focus:ring-1 focus:ring-slate-950" />
            <button type="button" onClick={() => confirmIdentity.mutate()} disabled={!displayName.trim() || confirmIdentity.isPending} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 font-black text-white disabled:opacity-40">{confirmIdentity.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Bekräfta namn och visa biljett</button>
          </section>
        ) : null}
        {purchaseConfirmed && activity && !requiresGuestClaim ? (
          <section id="ticket" className="mb-6 border-y border-black/10 py-5 text-slate-950">
            <div className="flex items-start gap-3"><Ticket data-testid="commerce-ticket-icon" className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" /><div><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{isDayPassPurchase ? "Ditt heldagspass" : "Din biljett"}</p><h2 className="mt-0.5 text-xl font-black">{activity?.name}</h2></div></div>
            <p className="mt-3 text-sm font-semibold">{activityDate} · {String(activity?.start_time || "").slice(0, 5)}–{String(activity?.end_time || "").slice(0, 5)}</p>
            <button type="button" onClick={() => checkIn.mutate()} disabled={checkedIn || !checkInAvailable || checkIn.isPending || isCancelled} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 font-black text-white disabled:opacity-40">{checkIn.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{checkedIn ? "Incheckad" : "Checka in"}</button>
            {canManageBooking ? <Link to={managementPath!} className="mt-3 flex h-11 items-center justify-center rounded-xl border border-black/15 bg-white text-sm font-black text-slate-950">Visa bokning</Link> : null}
            {user && order.account_claimed && activityPath ? <Link to={activityPath} className="mt-2 flex h-10 items-center justify-center text-sm font-bold text-slate-600 underline decoration-black/20 underline-offset-4">Öppna aktivitet och chatt</Link> : null}
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
        {purchaseConfirmed && course ? (
          <section className="mb-6 border-y border-black/10 py-5">
            <p className="text-sm leading-relaxed text-slate-600">Din kursplats gäller hela serien. Kommande tillfälle och deltagaruppgifter finns på Min sida.</p>
            {user && order.account_claimed ? <Link to={`/my?v=${encodeURIComponent(resolvedVenueSlug)}#courses`} className="mt-4 flex h-12 items-center justify-center rounded-2xl bg-slate-950 font-black text-white">Visa min kurs</Link> : user ? <button type="button" onClick={() => claimAccount.mutate()} disabled={claimAccount.isPending} className="mt-4 h-12 w-full rounded-2xl bg-slate-950 font-black text-white disabled:opacity-40">Koppla kursköpet till mitt konto</button> : <button type="button" onClick={startAuth} className="mt-4 h-12 w-full rounded-2xl bg-slate-950 font-black text-white">Spara kursen</button>}
          </section>
        ) : null}
        {purchaseConfirmed && league ? (
          <section className="mb-6 border-y border-black/10 py-5">
            <p className="text-sm leading-relaxed text-slate-600">Lagplatsen gäller hela Season 01. Ditt lag och kommande matcher visas som ett Seriespel på Min sida.</p>
            <Link to={`/my?v=${encodeURIComponent(resolvedVenueSlug)}#leagues`} className="mt-4 flex h-12 items-center justify-center rounded-2xl bg-slate-950 font-black text-white">Visa mitt lag</Link>
          </section>
        ) : null}
        {!(purchaseConfirmed && hasParticipation) ? <section className="divide-y divide-black/10 border-y border-black/10">
          {lines.map((line) => {
            const isDayPassLine = line.product_key === "day_access" || line.resolver_snapshot?.purchase_kind === "day_pass";
            const lineName = isDayPassLine ? line.product_name : activity && line.commerce_kind === "participation" ? "Personlig plats" : line.product_name;
            return <div key={line.id} className="flex items-center justify-between gap-3 py-4"><div><p className="font-bold">{lineName}{line.quantity > 1 ? ` · ${line.quantity} st` : ""}</p><p className="text-xs text-slate-500">{line.fulfillment_type === "desk_pickup" ? fulfillmentLabel(line.fulfillment_status, isCancelled) : isDayPassLine ? "Gäller hela dagen" : "Din plats"}</p></div><p className="font-black">{formatCommerceMoney(line.line_total_inc_vat_minor || line.unit_price_minor * line.quantity)}</p></div>;
          })}
        </section> : null}
        {!(purchaseConfirmed && hasParticipation) ? <section className="py-5"><div className="flex items-center justify-between"><span className="text-sm text-slate-500">Totalt</span><strong className="text-xl">{formatCommerceMoney(order.total_inc_vat_minor)}</strong></div>{receiptNumber ? <p className="mt-3 flex items-center gap-2 text-xs text-slate-500"><ReceiptText className="h-4 w-4" /> Kvitto {receiptNumber}</p> : null}</section> : null}
        {!(purchaseConfirmed && hasParticipation) ? <div className="mt-6 grid gap-2">{user && !canManageBooking ? <Link to="/my" className="flex h-12 items-center justify-center rounded-2xl bg-slate-950 font-bold text-white">Till Min sida</Link> : null}<Link to={`/shop?v=${encodeURIComponent(resolvedVenueSlug)}`} className="flex h-12 items-center justify-center rounded-2xl border border-black/10 bg-white font-bold">Fortsätt handla</Link></div> : null}
      </main>
    </div>
  );
}
