export type PwaSurfaceId = "customer" | "desk" | "admin";

export type PwaSurfaceDefinition = {
  id: string;
  name: string;
  shortName: string;
  startUrl: string;
  scope: string;
  manifestHref: string;
  iconHref: string;
  appleTouchIconHref: string;
  themeColor: string;
  routePrefixes: readonly string[];
};

export const PWA_SURFACE_STORAGE_KEY = "pickla:pwa-surface";

/**
 * Stable install identities. Never derive these ids from a build, venue or user.
 * All three scopes intentionally cover the origin because auth, checkout and
 * operational deep links cross route families inside the same SPA.
 */
export const PWA_SURFACES: Record<PwaSurfaceId, PwaSurfaceDefinition> = {
  customer: {
    id: "/",
    name: "Pickla",
    shortName: "Pickla",
    startUrl: "/",
    scope: "/",
    manifestHref: "/manifest.webmanifest",
    iconHref: "/pwa-customer-192x192.png",
    appleTouchIconHref: "/apple-touch-icon-customer-180x180.png",
    themeColor: "#F8FAFC",
    routePrefixes: [],
  },
  desk: {
    id: "/desk",
    name: "Pickla Desk",
    shortName: "Desk",
    startUrl: "/desk",
    scope: "/",
    manifestHref: "/manifest-desk.webmanifest",
    iconHref: "/pwa-desk-192x192.png",
    appleTouchIconHref: "/apple-touch-icon-desk-180x180.png",
    themeColor: "#111A35",
    routePrefixes: ["/desk"],
  },
  admin: {
    id: "/hub/admin",
    name: "Pickla Admin",
    shortName: "Admin",
    startUrl: "/hub/admin",
    scope: "/",
    manifestHref: "/manifest-admin.webmanifest",
    iconHref: "/pwa-admin-192x192.png",
    appleTouchIconHref: "/apple-touch-icon-admin-180x180.png",
    themeColor: "#3D7EFF",
    routePrefixes: ["/hub/admin", "/admin", "/ops", "/event-ops"],
  },
};

const SURFACE_ORDER: readonly PwaSurfaceId[] = ["desk", "admin"];
const SHARED_SURFACE_ROUTE_PREFIXES = [
  "/auth",
  "/booking/confirmed",
  "/membership/confirmed",
  "/commerce/confirmed",
] as const;

function routeMatchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function resolvePwaSurface(pathname: string): PwaSurfaceId {
  const normalizedPath = pathname || "/";
  return SURFACE_ORDER.find((surfaceId) =>
    PWA_SURFACES[surfaceId].routePrefixes.some((prefix) => routeMatchesPrefix(normalizedPath, prefix)),
  ) ?? "customer";
}

export function isSharedPwaSurfaceRoute(pathname: string) {
  return SHARED_SURFACE_ROUTE_PREFIXES.some((prefix) => routeMatchesPrefix(pathname, prefix));
}

export function selectPwaSurface(input: {
  pathname: string;
  standalone: boolean;
  storedSurface?: string | null;
}): PwaSurfaceId {
  const routedSurface = resolvePwaSurface(input.pathname);
  const storedSurface = input.storedSurface && input.storedSurface in PWA_SURFACES
    ? input.storedSurface as PwaSurfaceId
    : null;
  if (input.standalone && storedSurface) return storedSurface;
  if (isSharedPwaSurfaceRoute(input.pathname) && storedSurface) return storedSurface;
  return routedSurface;
}

function setLink(id: string, rel: string, href: string) {
  let link = document.getElementById(id) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.id = id;
    link.rel = rel;
    document.head.appendChild(link);
  }
  link.href = href;
  if (rel === "icon") link.type = "image/png";
}

function setMeta(id: string, name: string, content: string) {
  let meta = document.getElementById(id) as HTMLMetaElement | null;
  if (!meta) {
    meta = document.createElement("meta");
    meta.id = id;
    meta.name = name;
    document.head.appendChild(meta);
  }
  meta.content = content;
}

function isStandaloneDisplay() {
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches === true
    || navigatorWithStandalone.standalone === true;
}

function readStoredSurface() {
  try {
    return window.sessionStorage.getItem(PWA_SURFACE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeSurface(surfaceId: PwaSurfaceId) {
  try {
    window.sessionStorage.setItem(PWA_SURFACE_STORAGE_KEY, surfaceId);
  } catch {
    // Public app identity remains route-derived when storage is unavailable.
  }
}

export function syncPwaSurfaceMetadata(pathname: string) {
  if (typeof document === "undefined" || typeof window === "undefined") return "customer" as const;
  const surfaceId = selectPwaSurface({
    pathname,
    standalone: isStandaloneDisplay(),
    storedSurface: readStoredSurface(),
  });
  const surface = PWA_SURFACES[surfaceId];
  storeSurface(surfaceId);
  setLink("pickla-manifest", "manifest", surface.manifestHref);
  setLink("pickla-apple-touch-icon", "apple-touch-icon", surface.appleTouchIconHref);
  setLink("pickla-app-icon", "icon", surface.iconHref);
  setMeta("pickla-theme-color", "theme-color", surface.themeColor);
  setMeta("pickla-apple-title", "apple-mobile-web-app-title", surface.name);
  setMeta("pickla-application-name", "application-name", surface.name);
  document.documentElement.dataset.pwaSurface = surfaceId;
  return surfaceId;
}

/**
 * Runs before the application module so Chromium and iOS see the correct
 * manifest, icon and installed name on the first document parse.
 */
export function renderPwaSurfaceBootstrap() {
  const surfaces = JSON.stringify(PWA_SURFACES);
  const storageKey = JSON.stringify(PWA_SURFACE_STORAGE_KEY);
  return `(function(){var surfaces=${surfaces};var key=${storageKey};var order=["desk","admin"],shared=["/auth","/booking/confirmed","/membership/confirmed","/commerce/confirmed"];function matches(path,prefix){return path===prefix||path.indexOf(prefix+"/")===0}function resolve(path){for(var i=0;i<order.length;i++){var id=order[i],prefixes=surfaces[id].routePrefixes;for(var j=0;j<prefixes.length;j++){if(matches(path,prefixes[j]))return id}}return "customer"}function isShared(path){for(var i=0;i<shared.length;i++)if(matches(path,shared[i]))return true;return false}function standalone(){return(window.matchMedia&&window.matchMedia("(display-mode: standalone)").matches)||navigator.standalone===true}function stored(){try{return sessionStorage.getItem(key)}catch(e){return null}}function setLink(id,rel,href){var node=document.getElementById(id);if(!node){node=document.createElement("link");node.id=id;node.rel=rel;document.head.appendChild(node)}node.href=href;if(rel==="icon")node.type="image/png"}function setMeta(id,name,content){var node=document.getElementById(id);if(!node){node=document.createElement("meta");node.id=id;node.name=name;document.head.appendChild(node)}node.content=content}function select(path){var routed=resolve(path),saved=stored();return(standalone()||isShared(path))&&saved&&surfaces[saved]?saved:routed}function sync(path){var id=select(path||location.pathname),surface=surfaces[id];try{sessionStorage.setItem(key,id)}catch(e){}setLink("pickla-manifest","manifest",surface.manifestHref);setLink("pickla-apple-touch-icon","apple-touch-icon",surface.appleTouchIconHref);setLink("pickla-app-icon","icon",surface.iconHref);setMeta("pickla-theme-color","theme-color",surface.themeColor);setMeta("pickla-apple-title","apple-mobile-web-app-title",surface.name);setMeta("pickla-application-name","application-name",surface.name);document.documentElement.dataset.pwaSurface=id;window.__PICKLA_PWA_SURFACE__.current=id;return id}window.__PICKLA_PWA_SURFACE__={current:"customer",resolve:resolve,sync:sync};sync(location.pathname)})();`;
}

declare global {
  interface Window {
    __PICKLA_PWA_SURFACE__?: {
      current: PwaSurfaceId;
      resolve(pathname: string): PwaSurfaceId;
      sync(pathname: string): PwaSurfaceId;
    };
  }
}
