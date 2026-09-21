import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Boxes, CalendarClock, CheckCircle2, CreditCard, FileText, Loader2, PackageCheck, ReceiptText, UserRound, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { useRef } from "react";
import { Link } from "react-router-dom";
import { fetchStaffCommerceOrder, formatCommerceMoney } from "@/lib/commerce";

type CustomerTarget = {
  customerId?: string | null;
  userId?: string | null;
  commerceOrderId?: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  venueId?: string | null;
  orderId?: string | null;
  onOpenCustomer?: (target: CustomerTarget) => void;
};

const timezone = "Europe/Stockholm";

function formatDateTime(value?: string | null) {
  if (!value) return "–";
  const parsed = DateTime.fromISO(value, { zone: "utc" }).setZone(timezone).setLocale("sv");
  return parsed.isValid ? parsed.toFormat("d MMM yyyy HH:mm") : value;
}

function identityLabel(state?: string | null) {
  if (state === "account") return "Verifierat konto";
  if (state === "customer") return "Kund utan konto";
  return "Gästidentitet från ordern";
}

function statusLabel(value?: string | null) {
  const labels: Record<string, string> = {
    paid: "Betald",
    pending: "Väntar",
    succeeded: "Genomförd",
    attention: "Kräver åtgärd",
    pending_pickup: "Ej fullt utlämnad",
    collected: "Utlämnad",
    not_collected: "Ej utlämnad",
    preparing: "Förbereds",
    failed: "Misslyckad",
  };
  return labels[String(value || "")] || String(value || "–");
}

function sourceLabel(sourceType?: string | null) {
  if (sourceType === "catalog") return "Butik";
  if (sourceType === "activity_addon") return "Aktivitetstillägg";
  return sourceType || "Okänd";
}

function SectionTitle({ icon: Icon, children }: { icon: typeof FileText; children: string }) {
  return (
    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/45">
      <Icon className="h-3.5 w-3.5" />
      {children}
    </div>
  );
}

export default function CommerceOrderDetailDrawer({ open, onClose, venueId, orderId, onOpenCustomer }: Props) {
  const receiptRef = useRef<HTMLElement | null>(null);
  const detailQ = useQuery({
    queryKey: ["staff-commerce-order", venueId, orderId],
    enabled: open && !!venueId && !!orderId,
    queryFn: () => fetchStaffCommerceOrder(venueId!, orderId!),
    staleTime: 10_000,
  });
  const detail = detailQ.data;
  const order = detail?.order;
  const customer = detail?.customer;
  const hasAttention = order?.status === "attention" || Boolean(order?.refund_status && ["preparing", "pending", "attention"].includes(order.refund_status));

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[130] bg-black/75 backdrop-blur-md"
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed inset-y-0 right-0 z-[131] flex w-full max-w-2xl flex-col border-l border-white/10 bg-[#101524] shadow-2xl"
            aria-label="Orderdetalj"
          >
            <header className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/40">Order</p>
                <h2 className="mt-1 break-words text-xl font-black text-white">{order?.order_reference || "Laddar order"}</h2>
                {order ? <p className="mt-1 text-xs text-white/50">{statusLabel(order.payment_status)} · {formatDateTime(order.created_at)}</p> : null}
              </div>
              <button type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 text-white" aria-label="Stäng order">
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
              {detailQ.isLoading ? (
                <div className="grid h-64 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-white/45" /></div>
              ) : detailQ.error ? (
                <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-200">Kunde inte ladda ordern.</div>
              ) : detail && order && customer ? (
                <div className="space-y-6">
                  {hasAttention ? (
                    <div className="flex items-start gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-amber-100">
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                      <div><p className="font-black">Operativ spärr</p><p className="mt-1 text-xs opacity-80">Ordern eller återbetalningen kräver avstämning innan utlämning.</p></div>
                    </div>
                  ) : null}

                  <section className="space-y-2">
                    <SectionTitle icon={UserRound}>Kund</SectionTitle>
                    <button
                      type="button"
                      onClick={() => onOpenCustomer?.({
                        customerId: customer.customer_id,
                        userId: customer.user_id,
                        commerceOrderId: order.id,
                      })}
                      className="w-full rounded-2xl border border-white/10 bg-white/[0.05] p-4 text-left disabled:cursor-default"
                      disabled={!onOpenCustomer}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-lg font-black text-white">{customer.name}</p>
                          {customer.email ? <p className="mt-1 break-all text-xs text-white/55">{customer.email}</p> : null}
                          {customer.canonical_name && customer.canonical_name !== customer.name ? (
                            <p className="mt-1 text-xs text-white/45">Kanoniskt kundnamn: {customer.canonical_name}</p>
                          ) : null}
                        </div>
                        <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.06] px-2 py-1 text-[10px] font-bold text-white/65">{identityLabel(customer.identity_state)}</span>
                      </div>
                    </button>
                  </section>

                  <section className="space-y-2">
                    <SectionTitle icon={CreditCard}>Betalning</SectionTitle>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3"><p className="text-[10px] uppercase tracking-wider text-white/40">Total</p><p className="mt-1 text-lg font-black text-white">{formatCommerceMoney(order.total_inc_vat_minor, order.currency)}</p></div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3"><p className="text-[10px] uppercase tracking-wider text-white/40">Moms</p><p className="mt-1 text-lg font-black text-white">{formatCommerceMoney(order.vat_amount_minor, order.currency)}</p></div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3"><p className="text-[10px] uppercase tracking-wider text-white/40">Skapad</p><p className="mt-1 text-sm font-bold text-white">{formatDateTime(order.created_at)}</p></div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3"><p className="text-[10px] uppercase tracking-wider text-white/40">Betald</p><p className="mt-1 text-sm font-bold text-white">{formatDateTime(order.paid_at)}</p></div>
                    </div>
                    <p className="text-xs text-white/50">{statusLabel(order.payment_status)}{order.payment_method ? ` · ${order.payment_method}` : ""}{order.refund_status ? ` · Återbetalning: ${statusLabel(order.refund_status)}` : ""}</p>
                  </section>

                  <section className="space-y-2">
                    <SectionTitle icon={Boxes}>Orderrader</SectionTitle>
                    {detail.lines.map((line) => {
                      const variant = [line.variant_snapshot?.title, line.sku ? `SKU ${line.sku}` : null].filter(Boolean).join(" · ");
                      return (
                        <article key={line.id} className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-black text-white">{line.product_name}</p>
                              {variant ? <p className="mt-1 text-xs text-white/50">{variant}</p> : null}
                              <p className="mt-1 text-xs text-white/50">{line.quantity} × {formatCommerceMoney(line.unit_price_minor, order.currency)}</p>
                            </div>
                            {line.product_id ? (
                              <Link to={`/hub/admin/products?productId=${encodeURIComponent(line.product_id)}`} className="shrink-0 text-xs font-bold text-sky-300 hover:underline">Produkt</Link>
                            ) : null}
                          </div>
                          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                            <div className="rounded-xl bg-white/[0.05] p-2"><p className="text-[10px] text-white/40">Beställt</p><p className="font-black text-white">{line.quantity}</p></div>
                            <div className="rounded-xl bg-white/[0.05] p-2"><p className="text-[10px] text-white/40">Utlämnat</p><p className="font-black text-white">{line.issued_quantity}</p></div>
                            <div className="rounded-xl bg-white/[0.05] p-2"><p className="text-[10px] text-white/40">Återstår</p><p className="font-black text-white">{line.remaining_quantity}</p></div>
                          </div>
                          <p className="mt-3 text-xs text-white/50">{statusLabel(line.fulfillment_status)} · Källa: {line.activity?.name || sourceLabel(line.source_type)}{line.session_date ? ` · ${line.session_date}` : ""}</p>
                          {line.pickup_block_reason ? <p className="mt-1 text-xs font-bold text-amber-200">Utlämning blockerad: {statusLabel(line.pickup_block_reason)}</p> : null}
                        </article>
                      );
                    })}
                  </section>

                  <section ref={receiptRef} className="space-y-2">
                    <SectionTitle icon={ReceiptText}>Kvitto</SectionTitle>
                    {detail.receipt ? (
                      <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
                        <p className="font-black text-white">{detail.receipt.receipt_number}</p>
                        <p className="mt-1 text-xs text-white/50">{detail.receipt.product_description || "Orderkvitto"} · {statusLabel(detail.receipt.payment_status)}</p>
                        <p className="mt-1 text-xs text-white/50">Utfärdat {formatDateTime(detail.receipt.issued_at)}</p>
                      </div>
                    ) : <p className="rounded-2xl border border-white/10 p-4 text-xs text-white/45">Kvitto saknas.</p>}
                  </section>

                  <section className="space-y-2">
                    <SectionTitle icon={PackageCheck}>Utlämning och historik</SectionTitle>
                    {detail.history.length ? detail.history.map((event) => (
                      <div key={event.id} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                        {event.type === "pickup" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" /> : <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-white/45" />}
                        <div><p className="text-sm font-bold text-white">{event.label}</p><p className="mt-0.5 text-xs text-white/45">{formatDateTime(event.occurred_at)}</p></div>
                      </div>
                    )) : <p className="rounded-2xl border border-white/10 p-4 text-xs text-white/45">Ingen operativ historik finns ännu.</p>}
                  </section>
                </div>
              ) : null}
            </div>

            {detail?.receipt ? (
              <footer className="border-t border-white/10 bg-[#101524] px-5 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-3">
                <button type="button" onClick={() => receiptRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white/10 text-sm font-black text-white">
                  <ReceiptText className="h-4 w-4" /> Visa kvitto {detail.receipt.receipt_number}
                </button>
              </footer>
            ) : null}
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
