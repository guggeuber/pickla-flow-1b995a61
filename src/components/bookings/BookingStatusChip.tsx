import type { BookingHistoryStatus } from "@/lib/bookingHistory";

const statusStyles: Record<BookingHistoryStatus, { label: string; className: string }> = {
  upcoming: {
    label: "Upcoming",
    className: "bg-blue-50 text-blue-700",
  },
  completed: {
    label: "Completed",
    className: "bg-neutral-100 text-neutral-600",
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-red-50 text-red-700",
  },
};

export function BookingStatusChip({ status }: { status: BookingHistoryStatus }) {
  const config = statusStyles[status];
  return (
    <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${config.className}`}>
      {config.label}
    </span>
  );
}
