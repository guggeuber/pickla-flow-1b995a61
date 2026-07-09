import { AnimatePresence, motion } from "framer-motion";
import { CalendarClock, CheckCircle2, Copy, CreditCard, FileText, Loader2, Mail, MapPin, Phone, ReceiptText, UserPlus, UserRound, X } from "lucide-react";
import { DateTime } from "luxon";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { addManualBookingParticipant, checkInDeskBooking, deskBookingCheckinEligibility } from "@/lib/deskOps";
import { shareOrCopy } from "@/lib/share";
import Customer360Drawer from "@/components/customers/Customer360Drawer";

export type OperationsCourt = {
  id?: string | null;
  name?: string | null;
  court_number?: number | null;
  sport_type?: string | null;
};

export type OperationsBookingDetail = {
  id?: string;
  source_id?: string;
  source_ids?: string[];
  venue_id?: string | null;
  customer_id?: string | null;
  user_id?: string | null;
  customer_user_id?: string | null;
  booking_group_key?: string;
  booking_refs?: string[];
  booking_ref?: string | null;
  title?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  courts?: OperationsCourt[];
  court_name?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  time?: string | null;
  amount_sek?: number | null;
  total_price?: number | null;
  payment_status?: string | null;
  payment_method?: string | null;
  receipt_number?: string | null;
  booking_receipt_id?: string | null;
  checked_in?: boolean | null;
  checked_in_at?: string | null;
  checked_in_count?: number | null;
  notes?: string | null;
  status?: string | null;
  access_code?: string | null;
  stripe_session_id?: string | null;
  participants?: any[];
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseNotes(notes?: string | null) {
  const parts = String(notes || "").split(" | ").map((part) => part.trim());
  return {
    name: parts[0] || null,
    phone: parts[1] || null,
    email: parts[2] || null,
  };
}

function safeDisplayName(value: unknown) {
  const text = String(value || "").trim();
  if (!text || UUID_PATTERN.test(text)) return "";
  return text;
}

function guestBookingLabel(row: any) {
  const code = safeDisplayName(row?.access_code) || safeDisplayName(row?.booking_ref);
  return code ? `Gästbokning ${code}` : "Gästbokning";
}

function bookingGroupKey(row: any) {
  if (row.stripe_session_id) return `stripe:${row.stripe_session_id}`;
  if (row.access_code) return `code:${row.access_code}`;
  const fallback = safeDisplayName(row.notes) || safeDisplayName(row.booked_by) || safeDisplayName(row.customer_name);
  if (fallback && row.start_time && row.end_time) return `fallback:${row.start_time}:${row.end_time}:${fallback}`;
  return `booking:${row.id}`;
}

export function buildOperationsBookingDetailFromRows(rows: any[]): OperationsBookingDetail | null {
  const bookingRows = rows.filter((row) => row && row.kind !== "activity_registration");
  if (!bookingRows.length) return null;
  const first = bookingRows[0];
  const note = parseNotes(first.notes);
  const receipt = first.receipt || null;
  const courts = bookingRows.map((row) => ({
    id: row.venue_court_id,
    name: row.venue_courts?.name || row.court_name || row.venue_court_id,
    court_number: row.venue_courts?.court_number || null,
    sport_type: row.venue_courts?.sport_type || null,
  }));
  const amount = bookingRows.reduce((sum, row) => sum + Number(row.total_price || 0), 0);
  const checkedRows = bookingRows.filter((row) => row.checked_in);
  const customerName =
    safeDisplayName(receipt?.customer_name) ||
    safeDisplayName(first.customer_contact?.name) ||
    safeDisplayName(note.name) ||
    safeDisplayName(first.customer_name) ||
    safeDisplayName(first.booked_by) ||
    guestBookingLabel(first);

  return {
    id: `booking-${bookingGroupKey(first)}`,
    source_id: first.id,
    source_ids: bookingRows.map((row) => row.id).filter(Boolean),
    venue_id: first.venue_id || null,
    customer_id: first.customer_id || receipt?.customer_id || null,
    user_id: first.user_id || null,
    customer_user_id: first.customer_user_id || first.user_id || null,
    booking_group_key: bookingGroupKey(first),
    booking_refs: bookingRows.map((row) => row.booking_ref).filter(Boolean),
    booking_ref: first.booking_ref || null,
    title: `${customerName} · ${courts.map((court) => court.name).filter(Boolean).join(", ")}`,
    customer_name: customerName,
    customer_phone: receipt?.customer_phone || first.customer_contact?.phone || note.phone || null,
    customer_email: receipt?.customer_email || first.customer_contact?.email || note.email || null,
    courts,
    court_name: courts.map((court) => court.name).filter(Boolean).join(", "),
    start_time: first.start_time,
    end_time: first.end_time,
    starts_at: first.start_time,
    ends_at: first.end_time,
    amount_sek: amount,
    total_price: amount,
    payment_status: first.payment_status || (amount <= 0 ? "free" : first.stripe_session_id ? "paid" : "unknown"),
    payment_method: first.payment_method || (first.stripe_session_id ? "Stripe" : null),
    receipt_number: first.receipt_number || receipt?.receipt_number || null,
    booking_receipt_id: receipt?.id || null,
    checked_in: checkedRows.length > 0,
    checked_in_at: checkedRows[0]?.checked_in_at || null,
    checked_in_count: checkedRows.length,
    notes: first.notes || null,
    status: bookingRows.every((row) => row.status === first.status) ? first.status : "mixed",
    access_code: first.access_code || null,
    stripe_session_id: first.stripe_session_id || null,
    participants: Array.isArray(first.participants) ? first.participants : [],
  };
}

export function bookingRowsForGroup(rows: any[], selected: any) {
  if (!selected) return [];
  const key = bookingGroupKey(selected);
  return rows.filter((row) => row && row.kind !== "activity_registration" && bookingGroupKey(row) === key);
}

function formatTimeRange(booking: OperationsBookingDetail) {
  const startIso = booking.starts_at || booking.start_time;
  const endIso = booking.ends_at || booking.end_time;
  if (startIso) {
    const start = DateTime.fromISO(startIso, { zone: "utc" }).setZone("Europe/Stockholm");
    const end = endIso ? DateTime.fromISO(endIso, { zone: "utc" }).setZone("Europe/Stockholm") : null;
    if (start.isValid) {
      return `${start.toFormat("ccc d LLL HH:mm")}${end?.isValid ? `-${end.toFormat("HH:mm")}` : ""}`;
    }
  }
  return booking.end_time ? `${booking.time || ""}-${booking.end_time}` : booking.time || "Tid saknas";
}

function formatCheckedInAt(value?: string | null) {
  if (!value) return null;
  const dt = DateTime.fromISO(value, { zone: "utc" }).setZone("Europe/Stockholm");
  return dt.isValid ? dt.toFormat("HH:mm") : null;
}

function paymentLabel(status?: string | null) {
  if (status === "paid") return "Betald";
  if (status === "free") return "Gratis";
  if (status === "pending") return "Väntar";
  if (status === "refunded") return "Återbetald";
  return "Okänd";
}

function statusTone(status?: string | null) {
  if (status === "paid" || status === "free") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/25";
  if (status === "pending") return "bg-amber-500/15 text-amber-300 border-amber-500/25";
  return "bg-neutral-500/15 text-neutral-300 border-neutral-500/25";
}

function Field({ icon: Icon, label, value }: { icon: typeof UserRound; label: string; value?: string | number | null }) {
  if (value == null || value === "") return null;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-1.5 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

export function OperationsBookingDrawer({
  open,
  onClose,
  booking,
}: {
  open: boolean;
  onClose: () => void;
  booking: OperationsBookingDetail | null;
}) {
  const [customerTarget, setCustomerTarget] = useState<{ customerId?: string | null; userId?: string | null } | null>(null);
  const [localCheckedInAt, setLocalCheckedInAt] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const queryClient = useQueryClient();
  const effectiveCheckedIn = Boolean(booking?.checked_in || localCheckedInAt);
  const checkedAt = formatCheckedInAt(localCheckedInAt || booking?.checked_in_at);
  const amount = Number(booking?.amount_sek ?? booking?.total_price ?? 0);
  const courts = booking?.courts?.length ? booking.courts : booking?.court_name ? [{ name: booking.court_name }] : [];
  const bookingCustomerUserId = booking?.customer_user_id || booking?.user_id || null;
  const bookingCustomerId = booking?.customer_id || null;
  const canOpenCustomer = Boolean(booking?.venue_id && (bookingCustomerId || bookingCustomerUserId));
  const canCheckIn = !effectiveCheckedIn && deskBookingCheckinEligibility(booking).ok;
  const participants = Array.isArray(booking?.participants) ? booking.participants : [];

  useEffect(() => {
    setLocalCheckedInAt(null);
    setManualOpen(false);
    setManualName("");
    setManualPhone("");
    setManualEmail("");
  }, [booking?.id]);

  const checkInMutation = useMutation({
    mutationFn: async () => {
      if (!booking?.venue_id || !booking.source_ids?.length) throw new Error("Bokningsdata saknas");
      return checkInDeskBooking(booking);
    },
    onSuccess: () => {
      const nowIso = DateTime.now().toUTC().toISO();
      setLocalCheckedInAt(nowIso);
      toast.success("Kunden är incheckad");
      if (booking?.venue_id) {
        queryClient.invalidateQueries({ queryKey: ["today-bookings", booking.venue_id] });
        queryClient.invalidateQueries({ queryKey: ["desk-checkins-today", booking.venue_id] });
        queryClient.invalidateQueries({ queryKey: ["admin-calendar"] });
        queryClient.invalidateQueries({ queryKey: ["admin-todays-plan"] });
      }
    },
    onError: (error: any) => {
      toast.error(error?.message || "Kunde inte checka in kunden");
    },
  });

  const manualParticipantMutation = useMutation({
    mutationFn: async () => {
      if (!booking) throw new Error("Bokningsdata saknas");
      const displayName = manualName.trim();
      if (!displayName) throw new Error("Skriv spelarens namn");
      return addManualBookingParticipant(booking, {
        displayName,
        phone: manualPhone.trim(),
        email: manualEmail.trim(),
      });
    },
    onSuccess: () => {
      toast.success("Spelaren är tillagd");
      setManualName("");
      setManualPhone("");
      setManualEmail("");
      setManualOpen(false);
      if (booking?.venue_id) {
        queryClient.invalidateQueries({ queryKey: ["today-bookings", booking.venue_id] });
        queryClient.invalidateQueries({ queryKey: ["admin-calendar"] });
        queryClient.invalidateQueries({ queryKey: ["admin-todays-plan"] });
      }
    },
    onError: (error: any) => toast.error(error?.message || "Kunde inte lägga till spelaren"),
  });

  return (
    <>
      <AnimatePresence>
        {open && booking && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-md"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 280 }}
              className="fixed inset-x-0 bottom-0 z-[91] max-h-[92vh] overflow-y-auto rounded-t-3xl border border-white/10 bg-[#111626] px-5 pb-6 pt-4 shadow-2xl"
            >
            <div className="sticky top-0 z-10 -mx-5 mb-3 flex items-center justify-between bg-[#111626] px-5 pb-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/40">Operations Truth</p>
                <h3 className="mt-1 text-xl font-black text-white">Bokningsdetaljer</h3>
              </div>
              <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${statusTone(booking.payment_status)}`}>
                    {paymentLabel(booking.payment_status)}
                  </span>
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${effectiveCheckedIn ? "border-emerald-500/25 bg-emerald-500/15 text-emerald-300" : "border-amber-500/25 bg-amber-500/15 text-amber-300"}`}>
                    {effectiveCheckedIn ? `Incheckad${checkedAt ? ` ${checkedAt}` : ""}` : "Ej incheckad"}
                  </span>
                </div>
                {canOpenCustomer ? (
                  <button
                    type="button"
                    onClick={() => setCustomerTarget({ customerId: bookingCustomerId, userId: bookingCustomerUserId })}
                    className="mt-3 text-left text-2xl font-black leading-tight text-white underline-offset-4 hover:underline"
                  >
                    {booking.customer_name || "Okänd kund"}
                  </button>
                ) : (
                  <h4 className="mt-3 text-2xl font-black leading-tight text-white">
                    {booking.customer_name || "Okänd kund"}
                  </h4>
                )}
                <p className="mt-1 text-sm font-semibold text-white/55">{formatTimeRange(booking)}</p>
                {canCheckIn && (
                  <button
                    type="button"
                    onClick={() => checkInMutation.mutate()}
                    disabled={checkInMutation.isPending}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-4 py-3 text-sm font-black text-neutral-950 disabled:opacity-60"
                  >
                    {checkInMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Checka in kund
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Field icon={UserRound} label="Kund" value={booking.customer_name || "Okänd"} />
                <Field icon={CalendarClock} label="Tid" value={formatTimeRange(booking)} />
                <Field icon={Phone} label="Telefon" value={booking.customer_phone} />
                <Field icon={Mail} label="E-post" value={booking.customer_email} />
                <Field icon={MapPin} label="Bana" value={courts.map((court) => court.name).filter(Boolean).join(", ")} />
                <Field icon={CreditCard} label="Belopp" value={`${Math.round(amount).toLocaleString("sv-SE")} kr`} />
                <Field icon={ReceiptText} label="Kvitto" value={booking.receipt_number} />
                <Field icon={CheckCircle2} label="Check-in" value={effectiveCheckedIn ? `Ja${checkedAt ? `, ${checkedAt}` : ""}` : "Nej"} />
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">
                    <UserRound className="h-3.5 w-3.5" />
                    Play Rights
                  </div>
                  <button
                    type="button"
                    onClick={() => setManualOpen((current) => !current)}
                    className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs font-black text-white"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    Lägg till spelare manuellt
                  </button>
                </div>
                {manualOpen ? (
                  <div className="mt-3 rounded-2xl border border-white/10 bg-black/15 p-3">
                    <p className="text-xs font-semibold text-white/55">
                      Namnet blir en väntande Play Right. Kundprofil skapas först när spelaren identifierar sig.
                    </p>
                    <div className="mt-3 grid gap-2 md:grid-cols-3">
                      <input
                        value={manualName}
                        onChange={(event) => setManualName(event.target.value)}
                        placeholder="Namn"
                        className="h-10 rounded-xl border border-white bg-white px-3 text-sm font-bold text-neutral-950 caret-neutral-950 outline-none placeholder:text-neutral-400"
                      />
                      <input
                        value={manualPhone}
                        onChange={(event) => setManualPhone(event.target.value)}
                        placeholder="Telefon valfritt"
                        className="h-10 rounded-xl border border-white bg-white px-3 text-sm font-bold text-neutral-950 caret-neutral-950 outline-none placeholder:text-neutral-400"
                      />
                      <input
                        value={manualEmail}
                        onChange={(event) => setManualEmail(event.target.value)}
                        placeholder="E-post valfritt"
                        className="h-10 rounded-xl border border-white bg-white px-3 text-sm font-bold text-neutral-950 caret-neutral-950 outline-none placeholder:text-neutral-400"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => manualParticipantMutation.mutate()}
                      disabled={manualParticipantMutation.isPending || !manualName.trim()}
                      className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-4 py-3 text-sm font-black text-neutral-950 disabled:opacity-60"
                    >
                      {manualParticipantMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                      Lägg till
                    </button>
                  </div>
                ) : null}
                {participants.length ? (
                  <div className="mt-3 space-y-2">
                    {participants.map((participant) => {
                      const claimed = Boolean(participant.customer_id || participant.user_id);
                      const paid = participant.payment_status === "paid";
                      const free = participant.payment_status === "free";
                      const checkedIn = Boolean(participant.checked_in || participant.checked_in_at);
                      const metadata = participant.metadata && typeof participant.metadata === "object" ? participant.metadata : {};
                      const manualPlaceholder = !claimed && metadata.source === "manual_placeholder";
                      const claimUrl = participant.invite_token ? `${window.location.origin}/booking/invite/${encodeURIComponent(participant.invite_token)}` : "";
                      return (
                        <div key={participant.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-black text-white">{participant.display_name || "Medspelare"}</p>
                              {(participant.phone || participant.email) && (
                                <p className="mt-0.5 text-xs font-semibold text-white/45">
                                  {[participant.phone, participant.email].filter(Boolean).join(" · ")}
                                </p>
                              )}
                            </div>
                            {!claimed && claimUrl ? (
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await shareOrCopy({ copyText: claimUrl });
                                    toast.success("Claim-länk kopierad");
                                  } catch {
                                    toast.error("Kunde inte kopiera länken");
                                  }
                                }}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-2.5 py-1.5 text-[11px] font-black text-white"
                              >
                                <Copy className="h-3.5 w-3.5" />
                                Kopiera länk
                              </button>
                            ) : null}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-black uppercase tracking-wider">
                            <span className={`rounded-full border px-2.5 py-1 ${claimed ? "border-emerald-500/25 bg-emerald-500/15 text-emerald-300" : "border-amber-500/25 bg-amber-500/15 text-amber-300"}`}>
                              {claimed ? "Claimad" : "Behöver identitet"}
                            </span>
                            <span className={`rounded-full border px-2.5 py-1 ${checkedIn ? "border-emerald-500/25 bg-emerald-500/15 text-emerald-300" : "border-amber-500/25 bg-amber-500/15 text-amber-300"}`}>
                              {checkedIn ? "Incheckad" : "Ej inne"}
                            </span>
                            <span className={`rounded-full border px-2.5 py-1 ${paid || free ? "border-emerald-500/25 bg-emerald-500/15 text-emerald-300" : "border-amber-500/25 bg-amber-500/15 text-amber-300"}`}>
                              {manualPlaceholder ? "Pris efter identitet" : paid ? "Betald" : free ? "Ingår" : "Obetald"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-3 text-sm font-semibold text-white/45">Inga personliga Play Rights är kopplade än.</p>
                )}
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">
                  <FileText className="h-3.5 w-3.5" />
                  Notes / references
                </div>
                <div className="mt-2 space-y-1 text-xs text-white/65">
                  {booking.booking_refs?.length ? <p>Refs: {booking.booking_refs.join(", ")}</p> : booking.booking_ref ? <p>Ref: {booking.booking_ref}</p> : null}
                  {booking.access_code ? <p>Accesskod: {booking.access_code}</p> : null}
                  {booking.payment_method ? <p>Betalning: {booking.payment_method}</p> : null}
                  {booking.notes ? <p className="break-words">Notes: {booking.notes}</p> : null}
                </div>
              </div>
            </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      <Customer360Drawer
        open={!!customerTarget}
        venueId={booking?.venue_id}
        customerId={customerTarget?.customerId}
        userId={customerTarget?.userId}
        onClose={() => setCustomerTarget(null)}
      />
    </>
  );
}
