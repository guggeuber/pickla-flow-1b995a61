# Pickla frontend release convergence contract

Status: P0 release candidate. Production release requires preview header proof and the physical installed-PWA smoke below.

## Identity and authority

Every deployment generates one identity before the Vite and Vercel Function builds:

- Git SHA (`sha`) identifies the code;
- UTC deployment build time (`built_at`) supplies monotonic ordering;
- Vercel deployment ID (`deployment_id`) identifies the exact immutable deployment;
- Vercel deployment URL and environment are diagnostic context.

The same generated identity is embedded in the JavaScript bundle, the service worker, the diagnostic `version.json` artifact and the dynamic `/api/release` Function.

`/api/release` is the only authoritative current-release source. `version.json` is a static artifact and is never used for convergence. Vercel caches static files for a deployment even when a downstream `Cache-Control: no-store` header is configured, so a static filename cannot be authoritative production truth.

## Dynamic endpoint contract

`GET /api/release?request_id=<one-time-id>` is public, tiny, read-only and contains no customer or authentication data. It echoes the one-time request ID and adds `served_at`. The Function verifies that its generated SHA and deployment ID match Vercel's runtime system variables before answering.

The Function and `vercel.json` set:

- `Cache-Control: private, no-store, no-cache, must-revalidate, max-age=0`;
- `CDN-Cache-Control: private, no-store, max-age=0`;
- `Vercel-CDN-Cache-Control: private, no-store, max-age=0`;
- `Pragma: no-cache` and `Expires: 0`.

The browser additionally uses `cache: no-store`, unique query correlation, and `Cache-Control`/`Pragma` request headers. It rejects a mismatched correlation ID, positive `Age`, `x-vercel-cache: HIT|STALE`, or a response without `no-store`.

## Monotonic comparison

A Git SHA is never compared lexically.

- same SHA: current, no reload;
- different SHA with later `built_at`: proven newer, eligible for convergence;
- different SHA with earlier `built_at`: backward release, reject and report;
- different SHA with equal/invalid time: unknown, fail closed and do not reload.

Promoting an older immutable deployment preserves its older generated build time, so a newer resident client does not converge backward. A timeout, non-2xx response, malformed JSON, missing field, runtime/build mismatch, stale-cache signal or otherwise unknown identity also leaves the running client in place.

## Service worker

The root service worker is shared by Customer, Desk and Admin. `/api/release` has an explicit Workbox `NetworkOnly` route and is absent from the precache. Navigation and Supabase Function requests remain `NetworkOnly`; hashed JS/CSS assets remain immutable.

A service-worker build message describes only that worker. It is never authoritative and never directly creates a stale classification or reload target. It can corroborate an already-proven authoritative target. A controlled document reloads only when the controller reports the same SHA as the newer dynamic endpoint.

`skipWaiting`, `clients.claim`, cache cleanup and bounded legacy-client recovery remain in place. Modern clients acknowledge worker activation before any legacy fallback can navigate them.

## Safe convergence and failures

The client checks on bootstrap, `pageshow`, return to visible state, return online, controller changes and once per hour. Checks and `registration.update()` are single-flight and rate-limited.

Auth callbacks, checkout/payment finalization, booking and membership forms, claims, sensitive forms, unsaved Desk/Admin inputs and explicit critical sections defer an otherwise valid newer-release reload. Session storage permits at most one reload per authoritative target.

Endpoint failures clear unproven pending state and never reload. A successful post-reload same-release check records convergence success.

## Telemetry

Privacy-safe release telemetry includes loaded SHA/build/deployment, authoritative SHA/build/deployment, controller SHA, comparison or failure kind, request correlation ID, trigger, PWA surface and reload count. Dedicated events distinguish stale detection, backward rejection, convergence attempt, convergence success/failure and lookup failure. No user identifier is introduced.

## Verification

`npm run verify:pwa-build` proves shared artifact identity, endpoint headers, explicit service-worker `NetworkOnly` handling, absence of HTML/version metadata from precache, three PWA manifests and immutable hashed assets.

Automated tests cover A→B, B→B, B rejecting stale A, A/B/C, timeout, 500, malformed/missing identity, repeated stale responses, warm resume, Customer/Desk/Admin surfaces, no reload loop, telemetry, non-lexical SHA semantics and the production `a8b7ce9`→historical-SHA regression.

Before production release:

1. Deploy the immutable candidate to isolated preview/stage.
2. Repeatedly query `/api/release` and verify `Cache-Control`, absence/zero `Age`, `x-vercel-cache` never `HIT|STALE`, no reusable ETag/304 behavior, exact candidate SHA/deployment ID and echoed unique request IDs.
3. Sample available PoPs through independent probes; record only the regions actually observed.
4. Run physical installed Customer, Desk and Admin PWA A→candidate and warm-resume smoke tests.
5. After an approved production release, repeat the header/PoP check on `playpickla.com` and monitor convergence telemetry for backward rejection and loops.
