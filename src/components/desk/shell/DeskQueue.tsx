import { useMemo } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, CreditCard, Ban, HandHelping } from "lucide-react";
import { useTodayBookings } from "@/hooks/useDesk";
import { AxCard, AxChip, AxEmpty, AxSectionLabel, AX_TYPE } from "@/components/admin/shell/axPrimitives";
import { ax } from "@/components/admin/shell/axTheme";

interface Props {
  venueId: string | undefined;
  onOpenBooking: (booking: any, rows: any[]) => void;
}

export default function DeskQueue({ venueId, onOpenBooking }: Props) {
  const { data: bookings } = useTodayBookings(venueId);

  const courtRows = useMemo(
    () => ((bookings as any[] | undefined) || []).filter((b: any) => b.kind !== "activity_registration"),
    [bookings]
  );

  const pendingPayment = useMemo(
    () =>
      courtRows.filter(
        (b: any) => (b.payment_status || "").toLowerCase() === "pending"
      ),
    [courtRows]
  );

  const cancelledToday = useMemo(
    () => courtRows.filter((b: any) => b.status === "cancelled").slice(0, 8),
    [courtRows]
  );

  const totalIssues = pendingPayment.length + cancelledToday.length;

  return (
    <div className="space-y-4">
      <div>
        <p className={AX_TYPE.micro} style={{ color: ax("muted") }}>Queue · Exceptions</p>
        <h2 className={`${AX_TYPE.display} text-3xl md:text-4xl`} style={{ color: "white" }}>
          Hantera undantag
        </h2>
        <p className={AX_TYPE.meta} style={{ color: ax("muted") }}>
          {totalIssues === 0
            ? "Allt rullar utan friktion."
            : `${totalIssues} ärende${totalIssues === 1 ? "" : "n"} att kolla på.`}
        </p>
      </div>

      <AxSectionLabel icon={CreditCard} accent={ax("sun")}>Betalning väntar</AxSectionLabel>
      {pendingPayment.length === 0 ? (
        <AxEmpty
          icon={CreditCard}
          title="Inga väntande betalningar"
          hint="Stripe-väntande bokningar för idag visas här när de uppstår."
          tint={ax("sun")}
        />
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {pendingPayment.map((b: any) => (
            <motion.button
              key={b.id}
              whileTap={{ scale: 0.985 }}
              onClick={() => onOpenBooking(b, courtRows)}
              className="text-left"
            >
              <AxCard glow={ax("sun", 0.5)}>
                <div className="flex items-center gap-3">
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                    style={{
                      background: `linear-gradient(135deg, ${ax("sun", 0.3)}, hsl(0 0% 0% / 0.3))`,
                      border: `1px solid ${ax("sun", 0.5)}`,
                    }}
                  >
                    <CreditCard className="w-5 h-5" style={{ color: ax("sun") }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate" style={{ color: "white" }}>
                      {b.booked_by || "Gäst"}
                    </p>
                    <p className={`${AX_TYPE.meta}`} style={{ color: ax("muted") }}>
                      {b.venue_courts?.name || "—"}
                      {b.booking_ref ? ` · ${b.booking_ref}` : ""}
                    </p>
                  </div>
                  <AxChip tone="sun">Väntar</AxChip>
                </div>
              </AxCard>
            </motion.button>
          ))}
        </div>
      )}

      <AxSectionLabel icon={Ban} accent={ax("danger")}>Avbokade idag</AxSectionLabel>
      {cancelledToday.length === 0 ? (
        <AxEmpty
          icon={Ban}
          title="Inga avbokningar"
          hint="Avbokade bokningar för dagen visas här."
          tint={ax("danger")}
        />
      ) : (
        <div className="space-y-1.5">
          {cancelledToday.map((b: any) => (
            <AxCard key={b.id} pad="row">
              <div className="flex items-center gap-3">
                <Ban className="w-4 h-4" style={{ color: ax("danger") }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: "white" }}>
                    {b.booked_by || "Gäst"}
                  </p>
                  <p className={`${AX_TYPE.meta}`} style={{ color: ax("muted") }}>
                    {b.venue_courts?.name || "—"} ·{" "}
                    {new Date(b.start_time).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                <AxChip tone="danger">Avbokad</AxChip>
              </div>
            </AxCard>
          ))}
        </div>
      )}

      <AxSectionLabel icon={HandHelping} accent={ax("electric")}>
        Manuell hjälp
      </AxSectionLabel>
      <AxEmpty
        icon={AlertTriangle}
        title="Inga ärenden flaggade"
        hint="När staff flaggar att en gäst behöver manuell hjälp visas det här."
        tint={ax("electric")}
      />
    </div>
  );
}
