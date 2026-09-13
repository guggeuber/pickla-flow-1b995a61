# Pickla multi-surface PWA

Pickla exposes three independently installable application identities from the
same `playpickla.com` origin. They share one frontend, one root-scoped service
worker and one frontend-version-convergence contract.

| Surface | Manifest | Stable id | Start URL | Scope | Theme |
| --- | --- | --- | --- | --- | --- |
| Customer | `/manifest.webmanifest` | `/` | `/` | `/` | `#F8FAFC` |
| Desk | `/manifest-desk.webmanifest` | `/desk` | `/desk` | `/` | `#111A35` |
| Admin | `/manifest-admin.webmanifest` | `/hub/admin` | `/hub/admin` | `/` | `#3D7EFF` |

## Architecture decision

The manifest `id`, not the service worker, is the durable installed-app
identity. Distinct same-origin ids give Customer, Desk and Admin separate
installation identities.
All manifests deliberately use scope `/`: existing authentication, checkout,
confirmation, booking detail and staff links cross route families, so narrower
scopes would expose browser chrome or break the standalone return path.

A single `/sw.js` remains registered for scope `/`. It owns one cache namespace,
one Git-SHA build identity, one `/version.json` check and one legacy-client
recovery protocol. Separate workers would overlap, compete for navigation and
make convergence state surface-dependent without creating stronger auth.

The HTML build injects a synchronous public-metadata bootstrap before the app
module. It selects the route-owned manifest, Apple touch icon, installed name
and theme. In a browser tab it follows the current route so the correct surface
is offered for installation. In standalone mode it retains the launched
surface for shared auth/payment/deep-link routes. PWA identity is never used for
authorization; existing client and server role checks remain authoritative.

Same-origin PWAs share storage, permissions and browser install heuristics. The
root Customer scope necessarily overlaps Desk and Admin because the required
Customer start URL is `/`. Modern manifest identity is structurally distinct,
but no desktop artifact test can guarantee that every iOS/Chromium release will
offer or retain three icons. The physical coexistence smoke below is therefore
a release gate, not a claim made by this implementation candidate.

## Cache and privacy contract

HTML, `sw.js` and `/version.json` remain freshness-safe. The three manifests are
public metadata with revalidation, and hashed application assets remain
immutable. Supabase Edge Function requests and navigations remain `NetworkOnly`.
No customer, payment, booking, admin, staff or operational payload is stored as
offline business truth.

## Two-minute physical iPhone smoke

Safari/iOS installation behavior cannot be completely proven by desktop
automation. On a physical iPhone running a supported iOS version:

1. In Safari open `https://playpickla.com/`, use Share → Add to Home Screen, and
   confirm the name **Pickla** and the off-white icon.
2. Open `https://playpickla.com/desk`, repeat Add to Home Screen, and confirm
   **Pickla Desk** with the navy icon. Verify the first Pickla icon remains.
3. Open `https://playpickla.com/hub/admin`, repeat, and confirm **Pickla Admin**
   with the blue icon. Verify all three icons remain.
4. Launch each icon once. Customer must start at `/`, Desk at `/desk`, and Admin
   at `/hub/admin`. Desk/Admin must restore an authorized session or show the
   normal login/denial state; installation must never grant access.
5. Leave one app on a form with an unsaved edit while a newer build is released:
   it must defer reload. Navigate to a safe view and verify it converges once,
   without a reload loop. Repeat a normal safe launch for the other two apps.

Chromium uses the manifest `id` as the stable identity. iOS platform behavior
and three-icon coexistence still require the physical smoke above before a
production release claim.
