import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check, ScanLine, UserCheck, Sparkles } from "lucide-react";
import { DateTime } from "luxon";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { AxCard, AxChip, AxEmpty, AxSectionLabel, AX_TYPE } from "@/components/admin/shell/axPrimitives";
import { ax } from "@/components/admin/shell/axTheme";

const checkinLabels: Record<string, string> = {
  booking_code: "Bokning",
  booking: "Bokning",
  membership: "Medlem",
  membership_access: "Medlem",
  day_access: "Dagstillgång",
  session_ticket: "Aktivitet",
  day_pass: "Dagspass",
  manual: "Manuell",
  open_play: "Open Play",
};

interface TodayCheckin {
  id: string;
  player_name: string | null;
  entry_type: string;
  checked_in_at: string;
  entitlement_id: string | null;
}

interface Props {
  venueId: string | undefined;
  onScan: () => void;
}

export default function DeskArrivals({ venueId, onScan }: Props) {
  const queryClient = useQueryClient();
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  const { data: checkins = [], isLoading } = useQuery<TodayCheckin[]>({
    queryKey: ["desk-checkins-today", venueId],
    queryFn: () => apiGet("api-checkins", "today", { venueId: venueId! }),
    enabled: !!venueId,
    refetchInterval: 15000,
  });

  useEffect(() => {
    if (!venueId) return;
    const channel = supabase
      .channel(`desk-arrivals-${venueId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "venue_checkins", filter: `venue_id=eq.${venueId}` },
        (payload) => {
          const id = String((payload.new as any)?.id || "");
          if (id) {
            setNewIds((c) => new Set([...c, id]));
            window.setTimeout(() => {
              setNewIds((c) => {
                const next = new Set(c);
                next.delete(id);
                return next;
              });
            }, 14_000);
          }
          queryClient.invalidateQueries({ queryKey: ["desk-checkins-today", venueId] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, venueId]);

  const list = (checkins as TodayCheckin[]) || [];
  const newCount = list.filter((c) => newIds.has(c.id)).length;

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className={AX_TYPE.micro} style={{ color: ax("muted") }}>Arrivals</p>
          <h2 className={`${AX_TYPE.display} text-3xl md:text-4xl`} style={{ color: "white" }}>
            Live ankomster
          </h2>
          <p className={AX_TYPE.meta} style={{ color: ax("muted") }}>
            {list.length} incheckade idag{newCount > 0 ? ` · ${newCount} nya` : ""}
          </p>
        </div>
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={onScan}
          className="flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-black uppercase tracking-wider"
          style={{
            background: `linear-gradient(135deg, ${ax("lime")}, ${ax("electric")})`,
            color: ax("ink"),
            boxShadow: `0 10px 28px -14px ${ax("lime", 0.6)}`,
          }}
        >
          <ScanLine className="w-4 h-4" />
          Skanna
        </motion.button>
      </div>

      <AxSectionLabel icon={Sparkles} accent={ax("lime")}>Senaste in</AxSectionLabel>

      {isLoading ? (
        <div className="grid gap-2 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-2xl animate-pulse" style={{ background: ax("borderSoft") }} />
          ))}
        </div>
      ) : list.length === 0 ? (
        <AxEmpty
          icon={UserCheck}
          title="Inga ankomster än"
          hint="När någon checkar in via QR, kod eller manuellt syns det här direkt."
          tint={ax("electric")}
        />
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {list.map((c) => {
            const label = checkinLabels[c.entry_type] || c.entry_type;
            const name = c.player_name || (c.entry_type === "booking_code" ? "Bokningskod" : "Gäst");
            const isNew = newIds.has(c.id);
            const at = DateTime.fromISO(c.checked_in_at, { zone: "utc" })
              .setZone("Europe/Stockholm")
              .toFormat("HH:mm");
            return (
              <motion.div
                key={c.id}
                layout
                initial={isNew ? { scale: 0.96, opacity: 0 } : false}
                animate={{ scale: 1, opacity: 1 }}
              >
                <AxCard glow={isNew ? ax("lime", 0.7) : undefined} pad="card">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                      style={{
                        background: `linear-gradient(135deg, ${ax("lime", 0.25)}, ${ax("electric", 0.15)})`,
                        border: `1px solid ${ax("lime", 0.4)}`,
                      }}
                    >
                      <Check className="w-5 h-5" style={{ color: ax("lime") }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-base font-bold truncate" style={{ color: "white" }}>{name}</p>
                        {isNew && <AxChip tone="lime">Ny</AxChip>}
                      </div>
                      <p className={`${AX_TYPE.meta} font-mono`} style={{ color: ax("muted") }}>
                        {label} · {at}
                      </p>
                    </div>
                  </div>
                </AxCard>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
