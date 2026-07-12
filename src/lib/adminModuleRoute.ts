const ADMIN_MODULE_PATHS = {
  venue: "venue",
  staff: "staff",
  courts: "courts",
  devices: "devices",
  hours: "hours",
  pricing: "pricing",
  products: "products",
  schedule: "schedule",
  links: "links",
  stories: "stories",
  events: "events",
  eventLeads: "event-leads",
  eventProducts: "event-products",
  resourceBlocks: "resource-blocks",
  operations: "operations",
  revenueLedger: "revenue-ledger",
  financialMaintenance: "financial-maintenance",
  memberships: "memberships",
  templates: "templates",
  corporate: "corporate",
  channels: "channels",
} as const;

export type AdminModuleId = keyof typeof ADMIN_MODULE_PATHS;

const MODULE_BY_PATH = Object.fromEntries(
  Object.entries(ADMIN_MODULE_PATHS).map(([id, path]) => [path, id]),
) as Record<string, AdminModuleId>;

export function adminModuleHref(id: string) {
  const path = ADMIN_MODULE_PATHS[id as AdminModuleId];
  return path ? `/hub/admin/${path}` : "/hub/admin";
}

export function adminModuleIdFromPath(path: string | undefined) {
  return path ? MODULE_BY_PATH[path] || null : null;
}
