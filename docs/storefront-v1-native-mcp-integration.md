# Storefront V1 native and Pickla MCP integration handoff

This note describes the Storefront V1 contract at the release-candidate boundary. It is an integration map, not a new API or a commitment to expose commerce through MCP.

## Authority and authentication

The reusable backend is the Supabase Edge Function `api-commerce`. Production and Stage functions are configured with `verify_jwt = false` because Pickla validates JWTs inside the function: a supplied `Authorization: Bearer <Supabase access token>` is passed to `getAuthenticatedClient`, which calls Supabase Auth `getUser(token)`. An invalid supplied token fails with `401`; omitting the header is allowed only for explicitly public/guest commerce actions.

Public storefront reads return only active Commerce products and, when presentation records exist, products published for the requested locale. Admin content/media mutations use `api-admin`; they require a valid Supabase user, `super_admin` or active `venue_admin`, a matching venue role, and matching `product_id + venue_id`. Product media is served through `api-commerce/product-media`, not direct public Storage access. The bucket remains private.

Native clients should use the same Supabase access token as the web customer. Never embed service-role, Stripe secret, webhook, recovery, or Admin credentials in an app. Guest cart/receipt tokens are bearer secrets and must be stored in the Keychain, redacted from logs, and never placed in analytics.

## Customer API sequence

Base URL: `https://<supabase-project-ref>.supabase.co/functions/v1`. Send the project anon/publishable key as required by the Supabase client and send the user bearer token when a customer is signed in.

### 1. Catalog and product identity

`GET /api-commerce/catalog?venueId=<venue UUID>&locale=sv-SE`

Authentication is optional. When valid customer authentication is present, the response may contain that customer's canonical membership price. The response is `Cache-Control: private, no-store` and has this shape:

```json
{
  "commerce_available": true,
  "message": null,
  "products": [{
    "id": "canonical access_products.id",
    "venue_id": "home venue UUID",
    "product_key": "stable commerce key",
    "name": "Pickla Classic Tee",
    "base_price_sek": 299,
    "vat_rate": 25,
    "inventory_policy": "tracked",
    "presentation": {
      "locale": "sv-SE",
      "slug": "pickla-classic-tee",
      "short_description": "...",
      "publication_state": "published",
      "low_stock_threshold": 2
    },
    "media": [{
      "id": "canonical product_media.id",
      "url": ".../api-commerce/product-media?id=<media UUID>",
      "alt_text": "...",
      "sort_order": 0,
      "is_cover": true,
      "option_value_id": "canonical product_option_values.id or null"
    }],
    "variants": [{
      "id": "canonical product_variants.id",
      "sku": "canonical SKU",
      "options": [{
        "option_id": "product_options.id",
        "option_code": "color",
        "value_id": "product_option_values.id",
        "value_code": "black",
        "value_label": "Black",
        "swatch": "#111111"
      }],
      "available_to_sell": 2,
      "sold_out": false,
      "pricing": {
        "public_price_minor": 29900,
        "resolved_price_minor": 23920,
        "discount_minor": 5980,
        "pricing_source": "membership_tier_pricing"
      }
    }],
    "listing": {
      "id": "product_venue_listings.id",
      "pickup_location_id": "inventory_locations.id",
      "pickup_location_name": "Pickla Solna",
      "currency": "SEK"
    }
  }],
  "relationships": []
}
```

The route slug is presentation only. Persist and submit canonical `product.id`, `variant.id`, and `listing.pickup_location_id`. Resolve a variant by matching all canonical option/value IDs; do not derive SKU or pricing locally. `available_to_sell` is the customer-facing derived availability. The backend still revalidates inventory at cart and checkout.

`GET /api-commerce/product-media?id=<media UUID>&width=320|480|640|720|960|1280|1600`

This is public only while the media relation, product, and Storefront publication gate are active. It returns binary image bytes with `private, no-store`; direct bucket access is not the contract.

### 2. Canonical cart

Create or resume the standalone cart:

`POST /api-commerce/cart`

```json
{
  "venue_id": "venue UUID",
  "draft_scope": "shop",
  "source": "ios_storefront",
  "idempotency_key": "client generated opaque value, at least 32 characters",
  "guest_name": null,
  "guest_email": null,
  "items": [{
    "product_id": "access_products.id",
    "variant_id": "product_variants.id",
    "pickup_location_id": "inventory_locations.id",
    "quantity": 1
  }]
}
```

The response is `CommerceOrderResponse`: `order` (including canonical order UUID, `status`, optimistic `version`, currency and totals), frozen/resolved `lines`, and a `cart_token` for a guest. Signed-in carts can use the order UUID; guest carts use the opaque cart token. Reuse the same idempotency key rather than creating parallel carts after retries.

Update quantities/removal with `PUT /api-commerce/cart`:

```json
{
  "token": "order UUID for its authenticated owner, or guest cart token",
  "expected_version": 4,
  "items": ["same canonical item shape as POST"]
}
```

An empty `items` array is valid for a standalone shop draft. `409 stale_cart_version` means reload canonical cart state, rebase the user's intended change, then retry with the new version. Never substitute a different variant.

Before presenting checkout totals, call `POST /api-commerce/resolve` with `{ "token": "..." }`. It returns canonical line prices and `checkout_ready`. All price, VAT, membership, listing, seller, location, and inventory decisions are recomputed server-side.

### 3. Checkout

`POST /api-commerce/checkout`

```json
{
  "token": "order UUID or guest token",
  "expected_version": 4,
  "guest_email": "required for guest receipt/pickup",
  "guest_name": "optional display name",
  "journey_id": "privacy-safe opaque client journey id",
  "success_path": "/commerce/confirmed?token=<encoded token>",
  "cancel_path": "/cart?token=<encoded token>"
}
```

The normal paid response contains `{ "url", "order_id", "version", "attempt_id" }`; open the Stripe-hosted `url` using the platform browser/authentication session. A `202` with `recovery_pending` is not failure and must not trigger a second checkout identity. A zero-value eligible order returns `{ "free": true, "redirect": "..." }`. Checkout creates canonical durable attempts and inventory reservations; the native app must not implement either.

After the return, query `GET /api-commerce/order?token=<reference>&session=<Stripe Checkout Session ID>`. The response contains order/line/receipt state and `checkout_verification_eligible`. Continue polling conservatively while provider reconciliation is pending. Navigating to the cancel URL does not mean payment failed; use `POST /api-commerce/cancel-checkout` with `{ "token": "..." }` so the server can verify/expire the provider session safely.

Order status is also available to an authenticated customer through `GET /api-commerce/my-orders`. Guest receipt/order access requires the opaque receipt/cart token. The server enforces ownership; another authenticated user receives `403`.

### 4. Pickup

Pickup is a staff operation, not a customer mutation. Desk/Admin calls:

- `GET /api-commerce/fulfillment?venueId=<UUID>&status=pending_pickup`
- `PATCH /api-commerce/fulfillment` with `{ "venue_id", "line_id", "status": "collected", "quantity", "idempotency_key" }`

These require a validated Supabase bearer token and active `venue_admin` or `desk_staff` for that venue. The server checks the order line belongs to the same venue and executes the canonical idempotent pickup command. Native customer UI may display the returned order/line status, but must not infer handover from payment.

## Admin presentation/media contracts

These are staff-only and are not required by a customer app:

- `PUT /api-admin/product-presentation`: JSON containing `venueId`, `product_id`, locale, slug, editorial fields, SEO, size guide, low-stock threshold, and publication state.
- `POST /api-admin/product-media`: multipart form with `venueId`, `productId`, optional canonical `optionValueId`, and one or more `files`.
- `PATCH /api-admin/product-media`: JSON action `reorder`, `archive`, `alt`, or `scope`, always including `venueId` and `product_id`; color scope uses canonical `option_value_id`.

`api-admin` authenticates the JWT server-side, requires an Admin role plus matching active venue-admin membership, scopes the product by `product_id + venue_id`, and writes an audit entry. Cross-product media scope is rejected by the database trigger as well as the API's product scoping.

## What is reusable versus React-only

Reusable backend capabilities:

- publication-gated localized presentation and private media delivery;
- canonical product/options/value/variant/SKU/listing/location identities;
- customer-aware server pricing and VAT;
- derived availability with checkout revalidation;
- guest and authenticated canonical carts with optimistic versions;
- R2A Stripe checkout, recovery, receipt/order status, inventory reservation/allocation, refund truth, and quantity-aware Desk pickup.

React-only today:

- `/shop/products/:slug` routing and URL color state;
- swipe/fullscreen gallery, color swatches, size controls, sticky mobile CTA;
- cart drawer/local UI orchestration, React Query cache and browser local/session storage;
- document title/Open Graph DOM updates and frontend telemetry timing.

A SwiftUI/UIKit app must reproduce those presentation interactions while consuming the same Edge contracts. There is no native deep-link/universal-link contract, typed Swift SDK, push update for order reconciliation, or first-party native Stripe handoff wrapper in V1; these are explicit integration gaps.

## Pickla MCP boundary

The concurrent Pickla MCP V1 work currently defines only read-only operational tools (`pickla_get_daily_brief`, `pickla_list_schedule`, `pickla_list_corporate_bookings`, and `pickla_list_operational_exceptions`). It authenticates an MCP bearer actor, checks explicit scopes and venue authorization, uses service-role reads behind that boundary, validates strict schemas, rate-limits, and audits each call.

It does **not** expose Storefront catalog, cart, checkout, order, or pickup tools. Do not let an MCP host call service-role Commerce tables directly and do not reuse a browser guest token as an MCP credential. A future MCP adapter can reuse the public catalog projection for read-only product discovery and customer-owned order status only after scopes, actor/customer binding, token custody, tool schemas, confirmation boundaries, and payment/physical-effect safety are designed. Mutating cart, checkout, refund, or pickup tools remain gaps and require separate threat modeling and approval.
