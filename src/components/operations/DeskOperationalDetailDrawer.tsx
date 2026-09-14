import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiPatch } from "@/lib/api";
import { checkInActivityRegistration } from "@/lib/deskOps";
import {
  parseDeskOperationalDetailTarget,
  type DeskActivityOccurrenceDetailTarget,
} from "@/lib/deskOperationalDetail";
import { AdminBookingDetailDrawer } from "@/components/operations/AdminBookingDetailDrawer";
import { ActivityRow } from "@/components/desk/shell/DeskToday";
import Customer360Drawer from "@/components/customers/Customer360Drawer";

export function DeskOperationalDetailDrawer({
  open,
  venueId,
  target,
  sourceItem,
  onClose,
}: {
  open: boolean;
  venueId?: string | null;
  target: unknown;
  sourceItem?: Record<string, unknown> | null;
  onClose: () => void;
}) {
  if (!open) return null;
  const parsed = parseDeskOperationalDetailTarget(target);
  if (!parsed.ok) return <InvalidDeskDetailTarget error={parsed.error} onClose={onClose} />;
  if (!venueId) return <InvalidDeskDetailTarget error="Venue saknas för detaljvyn" onClose={onClose} />;

  if (parsed.target.kind === "booking") {
    return (
      <AdminBookingDetailDrawer
        open
        venueId={venueId}
        bookingId={parsed.target.booking_id}
        onClose={onClose}
      />
    );
  }

  return (
    <ActivityOccurrenceDetailDrawer
      venueId={venueId}
      target={parsed.target}
      sourceItem={sourceItem}
      onClose={onClose}
    />
  );
}

function ActivityOccurrenceDetailDrawer({
  venueId,
  target,
  sourceItem,
  onClose,
}: {
  venueId: string;
  target: DeskActivityOccurrenceDetailTarget;
  sourceItem?: Record<string, unknown> | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [customerTarget, setCustomerTarget] = useState<{ customerId?: string | null; userId?: string | null } | null>(null);
  const checkinMutation = useMutation({
    mutationFn: (participant: unknown) => checkInActivityRegistration(participant),
    onSuccess: () => {
      toast.success("Biljetten är incheckad");
      queryClient.invalidateQueries({ queryKey: ["desk-activity-participants", venueId, target.activity_session_id, target.occurrence_date] });
      queryClient.invalidateQueries({ queryKey: ["today-bookings", venueId] });
      queryClient.invalidateQueries({ queryKey: ["desk-checkins-today", venueId] });
      queryClient.invalidateQueries({ queryKey: ["customer-360"] });
    },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : "Kunde inte checka in biljetten"),
  });
  const collectMutation = useMutation({
    mutationFn: (line: { id?: string; line_id?: string }) => apiPatch("api-commerce", "fulfillment", {
      venue_id: venueId,
      line_id: line.line_id || line.id,
      status: "collected",
    }),
    onSuccess: () => {
      toast.success("Uthämtningen är klar");
      queryClient.invalidateQueries({ queryKey: ["commerce-fulfillment", venueId] });
      queryClient.invalidateQueries({ queryKey: ["commerce-my-orders"] });
    },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : "Kunde inte markera uthämtad"),
  });
  const activity = {
    ...(sourceItem || {}),
    activity_session_id: target.activity_session_id,
    session_date: target.occurrence_date,
    key: `${target.activity_session_id}:${target.occurrence_date}`,
  };

  return (
    <>
      <AnimatePresence>
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-md"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Aktivitetstillfälle"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 280 }}
            className="fixed inset-x-0 bottom-0 z-[91] max-h-[92vh] overflow-y-auto rounded-t-3xl border border-white/10 bg-[#111626] px-5 pb-6 pt-4 shadow-2xl"
          >
            <div className="sticky top-0 z-10 -mx-5 mb-3 flex items-center justify-between bg-[#111626] px-5 pb-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/40">Operations Truth</p>
                <h3 className="mt-1 text-xl font-black text-white">Aktivitetstillfälle</h3>
              </div>
              <button type="button" onClick={onClose} aria-label="Stäng" className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <ActivityRow
              venueId={venueId}
              activity={activity}
              expanded
              onToggle={() => undefined}
              onCheckIn={(participant) => checkinMutation.mutate(participant)}
              checkingId={(checkinMutation.variables as { session_registration_id?: string; registration_id?: string } | undefined)?.session_registration_id || (checkinMutation.variables as { registration_id?: string } | undefined)?.registration_id || null}
              checking={checkinMutation.isPending}
              onOpenCustomer={(participant) => setCustomerTarget({ customerId: participant.customer_id || null, userId: participant.user_id || null })}
              onCollect={(line) => collectMutation.mutate(line)}
              collectingId={(collectMutation.variables as { id?: string; line_id?: string } | undefined)?.line_id || (collectMutation.variables as { id?: string } | undefined)?.id || null}
              collecting={collectMutation.isPending}
            />
          </motion.div>
        </>
      </AnimatePresence>
      <Customer360Drawer
        open={!!customerTarget}
        onClose={() => setCustomerTarget(null)}
        venueId={venueId}
        customerId={customerTarget?.customerId || undefined}
        userId={customerTarget?.userId || undefined}
      />
    </>
  );
}

function InvalidDeskDetailTarget({ error, onClose }: { error: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 px-5 backdrop-blur-md" role="alertdialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-3xl border border-red-400/20 bg-[#111626] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/40">Detalj blockerad</p>
              <p className="mt-1 text-sm font-black text-white">{error}</p>
              <p className="mt-2 text-xs font-semibold text-white/50">Ingen detaljkälla anropades.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Stäng" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
