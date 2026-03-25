import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CalendarIcon, ChevronLeft, ChevronRight, X, Loader2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, addDays, subDays } from "date-fns";
import { sv } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { apiGet } from "@/lib/api";

interface BookingsSectionProps {
  venueId: string | undefined;
}

export function BookingsSection({ venueId }: BookingsSectionProps) {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const queryClient = useQueryClient();
  const dateStr = format(selectedDate, "yyyy-MM-dd");

  const { data: bookings, isLoading } = useQuery({
    queryKey: ["desk-bookings", venueId, dateStr],
    enabled: !!venueId,
    refetchInterval: 30000,
    queryFn: () => apiGet("api-bookings", "venue", { venueId: venueId!, date: dateStr }),
  });

  const sortedBookings = useMemo(() => {
    if (!bookings) return [];
    return [...bookings].sort((a: any, b: any) =>
      new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    );
  }, [bookings]);

  const statusColors: Record<string, string> = {
    confirmed: "bg-court-free/15 text-court-free",
    pending: "bg-court-soon/15 text-court-soon",
    completed: "bg-primary/15 text-primary",
    cancelled: "bg-destructive/15 text-destructive",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Bokningar</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSelectedDate((d) => subDays(d, 1))}
            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-secondary transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5 text-muted-foreground" />
          </button>

          <Popover>
            <PopoverTrigger asChild>
              <button className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold hover:bg-secondary transition-colors">
                <CalendarIcon className="w-3 h-3 text-muted-foreground" />
                {format(selectedDate, "d MMM", { locale: sv })}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(d) => d && setSelectedDate(d)}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>

          <button
            onClick={() => setSelectedDate((d) => addDays(d, 1))}
            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-secondary transition-colors"
          >
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          </button>

          <button
            onClick={() => setSelectedDate(new Date())}
            className="text-[10px] font-bold text-primary px-2 py-0.5 rounded-md hover:bg-primary/10 transition-colors"
          >
            Idag
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : sortedBookings.length > 0 ? (
        <div className="space-y-1.5">
          {sortedBookings.map((booking: any) => {
            const start = new Date(booking.start_time);
            const end = new Date(booking.end_time);
            const courtName = (booking.venue_courts as any)?.name || "–";
            const customer = booking.booked_by || booking.notes || "Gäst";

            return (
              <motion.div
                key={booking.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                className="glass-card rounded-2xl p-3 flex items-center gap-3"
              >
                <div className="text-center min-w-[55px]">
                  <p className="text-sm font-display font-bold text-primary">
                    {format(start, "HH:mm")}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {format(end, "HH:mm")}
                  </p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{customer}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {courtName}
                    {booking.booking_ref && ` · ${booking.booking_ref}`}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {booking.total_price != null && (
                    <span className="text-[11px] font-semibold text-muted-foreground">
                      {Math.round(booking.total_price)} kr
                    </span>
                  )}
                  <span className={`status-chip text-[9px] ${statusColors[booking.status] || "bg-secondary text-secondary-foreground"}`}>
                    {booking.status === "confirmed" ? "Betald" : booking.status === "pending" ? "Väntande" : booking.status === "cancelled" ? "Avbokad" : booking.status}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-4">
          Inga bokningar {format(selectedDate, "d MMMM", { locale: sv })}
        </p>
      )}
    </div>
  );
}
