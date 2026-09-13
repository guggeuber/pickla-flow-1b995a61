# Pickla frontend version contract

Status: P1 candidate. The future Customer, Desk and Admin multi-PWA split remains blocked until this contract has been verified in production.

## Identity

Every production build emits one immutable identity in three places:

- the running JavaScript bundle (`__BUILD_SHA__` and `__BUILD_TIME__`),
- the active service worker,
- `/version.json`, served with `Cache-Control: no-store`.

The Git SHA is the comparison key. The UTC timestamp is diagnostic context only. Neither field contains customer data or secrets.

## Modern clients

The frontend checks `/version.json` on bootstrap, `pageshow`, return to visible state, return online and once per hour while open. Checks and `registration.update()` calls are single-flight and rate-limited.

A mismatch is allowed to reload only after the active service worker reports the same SHA as `/version.json`, or when no service worker controls the document. This prevents a reload through an older app-shell worker. The target SHA is written to session storage before reload, allowing at most one convergence reload for that build.

Auth callbacks, payment preparation/finalization, booking and membership forms, claims, sensitive forms, and explicitly marked in-flight transactions defer reload. Route changes, lifecycle checks and release of the critical section retry the pending convergence. Input in an HTML form creates an unsaved-form critical section until submit, reset or route change.

## Legacy clients

On activation, the service worker claims clients and sends a build handshake. Modern clients acknowledge it. A same-origin client that does not acknowledge within the bounded grace period is treated as legacy. If its URL is safe, the worker calls `WindowClient.navigate(client.url)` to perform a real document navigation. This does not depend on old JavaScript understanding a message contract.

Known transaction-sensitive legacy URLs are never navigated blindly. The next real navigation receives current network HTML. Modern clients additionally carry the pending update across SPA route changes.

## Cache contract

- HTML and `sw.js`: no-store or strong revalidation.
- `/version.json`: no-store.
- manifest: revalidate.
- content-hashed `/assets/*`: `public, max-age=31536000, immutable`.
- authenticated and sensitive API responses: never supplied as stale service-worker cache truth.

The service worker must retain `skipWaiting`, `clientsClaim`, cache cleanup, NetworkOnly navigation, and NetworkOnly Supabase Function requests.

`npm run verify:pwa-build` is the artifact-level release gate. It proves that the same identity exists in `version.json`, the main bundle and the worker; that HTML/version metadata are not precached; and that the cache-header contract remains intact.

## Shared future contract

Pickla, Pickla Desk and Pickla Admin must each have a distinct scope and manifest when split, but must share:

1. immutable SHA/timestamp identity,
2. a no-store version endpoint for that surface,
3. the same safe/deferred state machine,
4. legacy-client handshake and navigation fallback,
5. one-reload-per-target-build protection,
6. privacy-safe convergence diagnostics,
7. permanent legacy, lifecycle, offline, auth and payment regression gates.

Do not start the multi-PWA split until production telemetry and physical iOS Home Screen testing prove this P1 convergence release.

## Verification boundary

Automated tests cover modern and pre-contract clients, lifecycle triggers, rate limiting, offline recovery, transaction deferral, safe legacy navigation, reload-loop prevention, cache headers, and final build artifacts. Local Chromium verification covers application rendering plus bootstrap and `pageshow` version checks.

The in-app browser cannot prove the installed iOS Home Screen lifecycle or expose every service-worker inspector surface. Before production release, run the physical iPhone stage smoke in `production-readiness.md`, including a long-resident build-A client converging to build B. Production telemetry must then show successful convergence without reload loops or transaction interruptions.
