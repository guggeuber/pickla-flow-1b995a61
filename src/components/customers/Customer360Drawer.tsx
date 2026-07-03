import { AnimatePresence, motion } from "framer-motion";
import { CalendarClock, CheckCircle2, CreditCard, Crown, FileText, Loader2, Mail, Phone, ReceiptText, ShieldCheck, Ticket, UserRound, X } from "lucide-react";
import { DateTime } from "luxon";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";

type Customer360Response = {
  customer: {
    customer_id?: string | null;
    user_id?: string | null;
    profile_id?: string | null;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    created_at?: string | null;
  };
  membership_badge?: { name?: string | null; color?: string | null } | null;
  active_membership?: Record<string, any> | null;
  upcoming_bookings: any[];
  activity_registrations: any[];
  day_passes: any[];
  memberships: any[];
  subscriptions?: any[];
  checkins: any[];
  receipts: any[];
  ledger_entries: any[];
  financial_timeline?: any[];
  safe_actions?: string[];
};

type Props = {
  open: boolean;
  onClose: () => void;
  venueId?: string | null;
  customerId?: string | null;
  userId?: string | null;
  onManageProfile?: () => void;
};

const tz = "Europe/Stockholm";

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const parsed = DateTime.fromISO(value, { zone: "utc" }).setZone(tz);
  return parsed.isValid ? parsed.toFormat("d LLL HH:mm") : value;
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const parsed = DateTime.fromISO(value, { zone: tz });
  return parsed.isValid ? parsed.toFormat("d LLL yyyy") : value;
}

function formatSessionTime(session?: any) {
  if (!session?.start_time) return "";
  return `${String(session.start_time).slice(0, 5)}${session.end_time ? `-${String(session.end_time).slice(0, 5)}` : ""}`;
}

function formatMinor(value?: number | null) {
  return `${Math.round(Number(value || 0) / 100).toLocaleString("sv-SE")} kr`;
}

function formatSek(value?: number | null) {
  return `${Number(value || 0).toLocaleString("sv-SE")} kr`;
}

function formatFinancialAmountMinor(value?: number | null) {
  const sek = Math.round(Number(value || 0) / 100);
  return `${sek.toLocaleString("sv-SE")} kr`;
}

function financialKindLabel(kind?: string | null) {
  const key = String(kind || "");
  if (key === "receipt") return "Kvitto";
  if (key === "ledger_entry") return "Ledger";
  if (key === "membership") return "Medlemskap";
  if (key === "activity_registration") return "Aktivitet";
  if (key === "day_pass") return "Dagspass";
  return key || "Händelse";
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-4 text-center text-xs text-white/45">{text}</p>;
}

function Section({ title, icon: Icon, children }: { title: string; icon: typeof UserRound; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/45">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      {children}
    </section>
  );
}

function Row({ title, meta, aside }: { title: string; meta?: string | null; aside?: string | null }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">{title}</p>
          {meta && <p className="mt-1 text-xs text-white/50">{meta}</p>}
        </div>
        {aside && <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.06] px-2 py-1 text-[10px] font-bold text-white/65">{aside}</span>}
      </div>
    </div>
  );
}

function CommandButton({ icon: Icon, label, onClick }: { icon: typeof UserRound; label: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm font-black text-white disabled:opacity-45"
      disabled={!onClick}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

export default function Customer360Drawer({ open, onClose, venueId, customerId, userId, onManageProfile }: Props) {
  const queryClient = useQueryClient();
  const customerQ = useQuery<Customer360Response>({
    queryKey: ["customer-360", venueId, customerId, userId],
    enabled: open && !!venueId && (!!customerId || !!userId),
    queryFn: () => apiGet("api-customers", "360", {
      venueId: venueId!,
      ...(customerId ? { customerId } : {}),
      ...(userId ? { userId } : {}),
    }),
    staleTime: 30_000,
  });

  const data = customerQ.data;
  const customer = data?.customer;
  const resolvedUserId = customer?.user_id || userId || null;
  const membershipName = data?.membership_badge?.name || data?.active_membership?.membership_tiers?.name || null;
  const today = DateTime.now().setZone(tz).toISODate();
  const activeCheckin = data?.checkins?.find((row) => row.session_date === today && !row.checked_out_at);
  const todayDayPass = data?.day_passes?.find((row) => row.valid_date === today && row.status === "active");
  const todayRegistration = data?.activity_registrations?.find((row) => row.session_date === today);
  const todayAccess = activeCheckin
    ? `Incheckad via ${activeCheckin.entry_type || "access"}`
    : todayRegistration
      ? `${todayRegistration.activity_sessions?.name || "Aktivitet"} idag`
      : todayDayPass
        ? "Aktivt dagspass idag"
        : membershipName
          ? `${membershipName} aktivt`
          : "Ingen tydlig access idag";
  const checkinMutation = useMutation({
    mutationFn: () => apiPost("api-checkins", "checkin", {
      venue_id: venueId,
      target_user_id: resolvedUserId,
      entry_type: "auto",
      player_name: customer?.name || null,
    }),
    onSuccess: () => {
      toast.success("Kunden är incheckad");
      queryClient.invalidateQueries({ queryKey: ["customer-360", venueId, customerId, userId] });
      queryClient.invalidateQueries({ queryKey: ["desk-checkins-today", venueId] });
      queryClient.invalidateQueries({ queryKey: ["today-bookings", venueId] });
    },
    onError: (error: any) => toast.error(error?.message || "Kunde inte checka in"),
  });

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[120] bg-black/75 backdrop-blur-md"
          />
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed inset-y-0 right-0 z-[121] flex w-full max-w-xl flex-col border-l border-white/10 bg-[#101524] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/40">Customer 360</p>
                <h2 className="mt-1 text-xl font-black text-white">Kundprofil</h2>
              </div>
              <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {customerQ.isLoading ? (
                <div className="flex h-64 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-white/45" />
                </div>
              ) : customerQ.error ? (
                <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-200">
                  Kunde inte ladda kundprofilen.
                </div>
              ) : data && customer ? (
                <div className="space-y-5">
                  <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.06] p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-xl font-black text-white">
                        {(customer.name || customer.email || "?").slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="min-w-0">
                          <h3 className="break-words text-2xl font-black leading-tight text-white">{customer.name || "Kund utan namn"}</h3>
                          {membershipName && (
                            <span
                              className="mt-2 inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-white"
                              style={{ background: data.membership_badge?.color || "hsl(var(--primary))" }}
                            >
                              <Crown className="h-3 w-3" />
                              {membershipName}
                            </span>
                          )}
                        </div>
                        <div className="mt-3 space-y-1 text-sm text-white/55">
                          {customer.email && <p className="flex min-w-0 items-center gap-2 break-all"><Mail className="h-3.5 w-3.5 shrink-0" />{customer.email}</p>}
                          {customer.phone && <p className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 shrink-0" />{customer.phone}</p>}
                          {customer.created_at && <p className="text-xs">Kund sedan {formatDateTime(customer.created_at)}</p>}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Dagens access</p>
                    <div className="mt-2 flex items-start gap-3">
                      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${activeCheckin ? "bg-emerald-400/15 text-emerald-300" : "bg-white/10 text-white/65"}`}>
                        <ShieldCheck className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-lg font-black leading-tight text-white">{todayAccess}</p>
                        <p className="mt-1 text-xs text-white/45">
                          {activeCheckin?.checked_in_at ? `Incheckad ${formatDateTime(activeCheckin.checked_in_at)}` : "Visar bara verifierad data från dagens bokningar, pass, medlemskap och check-ins."}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <CommandButton
                      icon={checkinMutation.isPending ? Loader2 : CheckCircle2}
                      label={activeCheckin ? "Redan inne" : checkinMutation.isPending ? "Checkar in" : "Checka in"}
                      onClick={!activeCheckin && venueId && resolvedUserId ? () => checkinMutation.mutate() : undefined}
                    />
                    <CommandButton icon={UserRound} label="Profil" onClick={onManageProfile} />
                    <CommandButton icon={Crown} label="Medlemskap" onClick={onManageProfile} />
                    <a
                      href="/openplay"
                      className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm font-black text-white"
                    >
                      <Ticket className="h-4 w-4" />
                      Dagspass
                    </a>
                  </div>

                  {data.active_membership && (
                    <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Medlemskap</p>
                          <p className="mt-1 text-xl font-black text-white">{membershipName || "Aktivt medlemskap"}</p>
                          <p className="mt-1 text-xs text-white/50">
                            Status: {data.active_membership.status || "aktiv"}
                            {data.active_membership.starts_at ? ` · Från ${formatDateTime(data.active_membership.starts_at)}` : ""}
                            {data.active_membership.expires_at ? ` · Till ${formatDateTime(data.active_membership.expires_at)}` : ""}
                          </p>
                        </div>
                        <Crown className="h-5 w-5 shrink-0 text-white/60" />
                      </div>
                    </section>
                  )}

                  <Section title="Financial operations" icon={CreditCard}>
                    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
                      <div className="grid gap-2 sm:grid-cols-3">
                        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Lifetime</p>
                          <p className="mt-1 text-lg font-black text-white">
                            {formatFinancialAmountMinor((data.ledger_entries || []).reduce((sum, entry) => sum + Number(entry.amount_inc_vat_minor || 0), 0))}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Kvitton</p>
                          <p className="mt-1 text-lg font-black text-white">{data.receipts.length}</p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Subscriptions</p>
                          <p className="mt-1 text-lg font-black text-white">{data.subscriptions?.length || 0}</p>
                        </div>
                      </div>
                    </div>
                  </Section>

                  <Section title="Subscription Center" icon={Crown}>
                    {data.subscriptions?.length ? data.subscriptions.map((subscription) => (
                      <div key={subscription.membership_id || subscription.stripe_subscription_id || subscription.subscription_name} className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-lg font-black text-white">{subscription.subscription_name || "Medlemskap"}</p>
                            <p className="mt-1 text-xs text-white/50">
                              {subscription.status || "unknown"} · {subscription.billing_interval || "interval saknas"} · {formatSek(subscription.amount_sek)}
                            </p>
                          </div>
                          <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.06] px-2 py-1 text-[10px] font-bold text-white/65">
                            {subscription.cancel_at_period_end ? "Avslutas" : subscription.paused ? "Pausad" : "Aktiv"}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                          <Row title="Period" meta={`${formatDateTime(subscription.current_period_start)} - ${formatDateTime(subscription.current_period_end)}`} />
                          <Row title="Nästa dragning" meta={formatDateTime(subscription.next_billing_date)} />
                          <Row title="Senaste betalning" meta={formatDateTime(subscription.last_successful_payment)} />
                          <Row title="Misslyckad betalning" meta={subscription.last_failed_payment ? formatDateTime(subscription.last_failed_payment) : "Ingen hittad"} />
                          <Row title="Stripe customer" meta={subscription.stripe_customer_id || "Saknas"} />
                          <Row title="Stripe subscription" meta={subscription.stripe_subscription_id || "Saknas lokalt"} />
                          <Row title="Kort" meta={[subscription.card_brand, subscription.card_last4 ? `•••• ${subscription.card_last4}` : null].filter(Boolean).join(" ") || subscription.payment_method || "Saknas"} />
                          <Row title="Lifetime subscription revenue" meta={formatFinancialAmountMinor(subscription.lifetime_subscription_revenue_minor)} />
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <CommandButton icon={ReceiptText} label="View payments" onClick={subscription.payment_history?.length ? () => toast.info("Betalhistoriken visas i kortet") : undefined} />
                          <CommandButton icon={FileText} label="Open receipt" onClick={subscription.payment_history?.[0]?.receipt_number ? () => window.open(`/receipt/${encodeURIComponent(subscription.payment_history[0].receipt_number)}`, "_blank", "noopener,noreferrer") : undefined} />
                          <CommandButton icon={CreditCard} label="Retry payment" onClick={subscription.last_failed_payment ? () => toast.info("Retry payment kräver Stripe-mutation i senare fas") : undefined} />
                          <CommandButton icon={X} label="Cancel" onClick={() => toast.info("Cancel kopplas till befintligt säkert medlemsflöde i senare fas")} />
                        </div>
                        {subscription.payment_history?.length ? (
                          <div className="mt-3 space-y-2">
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Payment history</p>
                            {subscription.payment_history.slice(0, 5).map((payment: any) => (
                              <Row
                                key={payment.receipt_id || payment.stripe_session_id}
                                title={payment.receipt_number || payment.stripe_session_id || "Payment"}
                                meta={`${formatDateTime(payment.occurred_at)} · ${payment.payment_method || "payment"}`}
                                aside={`${formatSek(payment.amount_sek)} · ${payment.payment_status || "ok"}`}
                              />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )) : <Empty text="Inga Stripe-abonnemang eller medlemskapsbetalningar kunde kopplas lokalt ännu." />}
                  </Section>

                  <Section title="Kommande bokningar" icon={CalendarClock}>
                    {data.upcoming_bookings.length ? data.upcoming_bookings.map((booking) => (
                      <Row
                        key={booking.id}
                        title={booking.venue_courts?.name || booking.booking_ref || "Bokning"}
                        meta={`${formatDateTime(booking.start_time)}-${formatDateTime(booking.end_time).split(" ").pop()}${booking.booking_ref ? ` · ${booking.booking_ref}` : ""}`}
                        aside={booking.status || undefined}
                      />
                    )) : <Empty text="Inga kommande banbokningar." />}
                  </Section>

                  <Section title="Aktiviteter" icon={Ticket}>
                    {data.activity_registrations.length ? data.activity_registrations.map((registration) => (
                      <Row
                        key={registration.id}
                        title={registration.activity_sessions?.name || "Aktivitet"}
                        meta={`${formatDate(registration.session_date)} ${formatSessionTime(registration.activity_sessions)}${registration.checked_in_at ? ` · Incheckad ${formatDateTime(registration.checked_in_at)}` : ""}`}
                        aside={registration.checked_in || registration.consumed || registration.status === "checked_in" ? "Använd" : registration.status || undefined}
                      />
                    )) : <Empty text="Inga kommande aktivitetsregistreringar." />}
                  </Section>

                  <Section title="Dagspass" icon={ShieldCheck}>
                    {data.day_passes.length ? data.day_passes.map((pass) => (
                      <Row
                        key={pass.id}
                        title={formatDate(pass.valid_date)}
                        meta={pass.stripe_session_id ? `Session ${pass.stripe_session_id}` : "Dagspass"}
                        aside={pass.status || undefined}
                      />
                    )) : <Empty text="Inga dagspass hittades." />}
                  </Section>

                  <Section title="Medlemskap" icon={Crown}>
                    {data.memberships.length ? data.memberships.map((membership) => (
                      <Row
                        key={membership.id}
                        title={membership.membership_tiers?.name || "Medlemskap"}
                        meta={`${membership.starts_at ? `Från ${formatDateTime(membership.starts_at)}` : ""}${membership.expires_at ? ` · Till ${formatDateTime(membership.expires_at)}` : ""}`}
                        aside={membership.status || undefined}
                      />
                    )) : <Empty text="Inga medlemskap hittades." />}
                  </Section>

                  <Section title="Check-ins" icon={CheckCircle2}>
                    {data.checkins.length ? data.checkins.map((checkin) => (
                      <Row
                        key={checkin.id}
                        title={checkin.player_name || "Check-in"}
                        meta={`${formatDateTime(checkin.checked_in_at)} · ${checkin.entry_type || "check-in"}`}
                        aside={checkin.checked_out_at ? "Utcheckad" : "Inne"}
                      />
                    )) : <Empty text="Inga check-ins hittades." />}
                  </Section>

                  <Section title="Kvitton" icon={ReceiptText}>
                    {data.receipts.length ? data.receipts.map((receipt) => (
                      <Row
                        key={receipt.id}
                        title={receipt.receipt_number || "Kvitto"}
                        meta={`${receipt.product_description || receipt.purchase_type || "Köp"} · ${formatSek(receipt.total_inc_vat_sek ?? receipt.total_inc_vat)}`}
                        aside={receipt.payment_status || undefined}
                      />
                    )) : <Empty text="Inga kvitton hittades." />}
                  </Section>

                  <Section title="Financial timeline" icon={CreditCard}>
                    {data.financial_timeline?.length ? data.financial_timeline.slice(0, 40).map((item) => (
                      <Row
                        key={item.id}
                        title={`${financialKindLabel(item.kind)} · ${item.title || "Finansiell händelse"}`}
                        meta={`${formatDateTime(item.occurred_at)}${item.receipt_number ? ` · ${item.receipt_number}` : ""}${item.stripe_session_id ? ` · ${item.stripe_session_id}` : item.stripe_invoice_id ? ` · ${item.stripe_invoice_id}` : ""}`}
                        aside={formatFinancialAmountMinor(item.amount_minor)}
                      />
                    )) : <Empty text="Ingen finansiell tidslinje kunde byggas från kvitton eller ledger." />}
                  </Section>

                  <Section title="Ledger" icon={CreditCard}>
                    {data.ledger_entries.length ? data.ledger_entries.map((entry) => (
                      <Row
                        key={entry.id}
                        title={entry.source_type || "Ledger entry"}
                        meta={`${formatDateTime(entry.occurred_at || entry.created_at)} · ${entry.receipt_number || entry.stripe_session_id || "utan kvitto"}`}
                        aside={formatMinor(entry.amount_inc_vat_minor)}
                      />
                    )) : <Empty text="Inga ledger-poster kunde kopplas till kunden." />}
                  </Section>

                  <Section title="Noteringar" icon={FileText}>
                    <Empty text="Inga kundnoteringar finns i nuvarande datamodell." />
                  </Section>
                </div>
              ) : null}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
