import AdminCommerceWorkspace from "@/components/admin/commerce/AdminCommerceWorkspace";

/**
 * Compatibility entry point for the historical Admin Products module.
 * The canonical experience now lives inside Admin OS Commerce; old deep links
 * intentionally land on the same surface instead of a second product admin.
 */
export default function AdminProducts({ venueId }: { venueId: string }) {
  return <AdminCommerceWorkspace venueId={venueId} initialSection="products" />;
}
