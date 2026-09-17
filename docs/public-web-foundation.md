# Public Web foundation

## Architecture

`/pickleball-stockholm` is a build-generated HTML artifact served by an exact
Vercel rewrite before the legacy SPA fallback. It is not a React Router route
and does not import the Customer application, authentication, React Query,
Stripe, PWA bootstrap, or service-worker registration.

The typed registry in `public-web/registry.ts` owns the pathname, canonical,
metadata templates, indexability, output filename, sitemap inclusion, product
links, and bounded attribution source. Vite's `pickla-public-web` plugin loads
and validates acquisition facts, emits the HTML page and sitemap, and fails the
build when any critical fact is unavailable or invalid.

Canonical build inputs are:

- `api-bookings/public-venue`: venue identity and weekly opening hours
- `api-bookings/public-courts?showAll=true`: active indoor pickleball courts
- `api-event-public/public-prices`: anonymous public price projection

The candidate adds postal code, country, and coordinates to the existing
purpose-built `public-venue` projection. Until that Edge Function revision is
live, the build may read the same venue location from the existing public
Ericsson company projection. The compatibility result is accepted only when
venue slug, street address, and city match the primary venue projection. There
is no hardcoded address or price fallback.

## Indexability doctrine

| Surface | Directive | Enforcement |
| --- | --- | --- |
| Public Web | `index,follow` | raw HTML meta plus `X-Robots-Tag` |
| Operations, auth, claims, receipts, private tokens | `noindex,nofollow` | route-specific `X-Robots-Tag` |
| Transactional/product steps | `noindex,follow` where discovery links remain useful | route-specific `X-Robots-Tag` |

`robots.txt` is only crawl guidance. It has one consistent user-agent group;
authorization and `X-Robots-Tag` remain authoritative for private surfaces.

## Routing and 404 decision

Sprint 1 deliberately preserves the final `/(.*) -> /index.html` rewrite. The
current application has many working deep links, token routes, overlays, and
installed-PWA entry paths. Replacing the fallback without a staging matrix
would create a material regression risk, so unknown SPA URLs may still return
the application shell in this candidate.

The exact safe follow-up is:

1. Generate a machine-readable SPA allowlist from the route inventory below.
2. Add explicit Vercel rewrites for every exact and parameterized SPA route.
3. Exercise anonymous, authenticated, installed Customer, Desk, and Admin deep
   links against the allowlist in stage.
4. Replace only the final catch-all with a static 404 response and assert its
   HTTP status from the deployed preview.
5. Keep the four social-preview rewrites until each product detail route can
   serve one human-and-crawler HTML representation.

The existing route inventory at the Sprint 1 baseline is:

```text
/
/auth
/auth/callback
/auth/reset
/invest
/invest/memo/:token
/pulse/:token
/shop
/course/:seriesId
/seriespel
/seriespel/:seriesId
/courses
/prices
/cart
/commerce/confirmed
/order/:token
/hub/admin/investors
/desk
/desk/booking/:bookingId
/hub
/hub/admin/:modulePath
/hub/admin
/admin/event-leads
/ops
/today
/checkin/:venueSlug
/activity
/my
/stats
/community
/play
/events
/openplay
/p/:sessionId
/program/:sessionId
/event-ops
/event/:id
/event-plan/:venueId
/e/:slug
/book
/book/group
/event-foretag
/foretag/:slug
/eventlokaler
/foretagsevent-stockholm
/kickoff-stockholm
/aw-stockholm
/konferens-stockholm
/teambuilding-stockholm
/kundevent-stockholm
/ledningsgrupp-stockholm
/gruppbokning-stockholm
/fodelsedagskalas-stockholm
/svensexa-stockholm
/mohippa-stockholm
/familjeevent-stockholm
/kompisgang-stockholm
/skolavslutning-stockholm
/jubileum-stockholm
/hotell
/membership
/membership/confirmed
/wellness
/receipt/:ref
/privacy
/terms
/cookies
/b/:ref
/booking/confirmed
/booking/invite/:token
/booking/ticket/:token
/activity/invite/:token
/booking-chat/:bookingRef
/chat/:roomId
/pass/:token
/corp/join
/corp/register
/corp/dashboard
/display/venue
/display/openplay
/display/resource/:courtId
/display/device/:token
/display/broadcast/:scoreSessionId
/score/start
/score/join
/score/match/:matchId
```

The `p`, `program`, and booking-invite routes also have overlay renderings.

## Bot rewrite decision

The broad social-preview user-agent matching remains unchanged for its four
existing product-detail paths. It cannot affect `/pickleball-stockholm`: the
new exact static rewrite is unconditional and is evaluated first, so people and
crawlers receive the same artifact. Removing the older preview split belongs in
the route-by-route migration described above.

## Attribution and privacy

The page stores one session-scoped first-party marker under
`pickla:acquisition`. It contains only the public landing identifier, timestamps,
and the selected CTA. It contains no user identity and creates no network
request. The marker survives same-tab navigation into the Product app. Writing
it into completed booking/order records is intentionally deferred until a
shared conversion contract can be added without changing checkout truth.

## Performance and PWA guardrails

The permanent built-artifact verifier enforces:

- HTML at most 64 KiB
- executable inline JavaScript at most 2 KiB
- inline CSS at most 24 KiB
- eager venue image at most 80 KiB
- zero external JavaScript files
- intrinsic dimensions on every image

The Public Web page has no manifest link and registers no service worker. The
verifier checks the built Customer, Desk, and Admin manifest identities and
start URLs (`/`, `/desk`, `/hub/admin`) on every production build.
