# Architecture Foundation Phase 1

Status: canonical implementation plan  
Scope: architecture foundation only  
Last updated: 2026-06-20

This document reconciles three inputs:

1. Claude CTO review: identified architectural blockers.
2. Codex Foundation Phase 1 audit: mapped current schema/functions/RLS risks.
3. `pickla-target-erd-central-membership.md`: target ERD for central membership ownership and franchise scaling.

This is the source of truth for future implementation sessions. Do not implement from older chat context if it conflicts with this document.

## Decision Summary

Pickla will move toward a brand-owned operating model:

```text
organization
  -> franchisee
      -> venue

organization
  -> customer
      -> membership
          -> entitlement_grant
              -> entitlement_usage at venue
```

The key decision:

**Membership is ultimately owned by `organization`, not by `venue`.**

Phase 1 will create the foundation for that model, but it will not cut checkout, booking, check-in, Stripe, or membership entitlement runtime over to the new model yet.

## Current Blockers

The current codebase has these architectural blockers:

- Memberships are venue-scoped:
  - `membership_tiers.venue_id`
  - `memberships.venue_id`
  - `membership_entitlements.tier_id`
  - `membership_usage.venue_id`
- `venues` is the top tenant root. There is no organization/franchise layer.
- There is no canonical customer master below `auth.users`.
- `player_profiles` is globally readable through RLS.
- Service-role functions have scattered authorization checks.
- There is no universal `audit_log`.
- `events` mixes public/play/scoring events with private sales/event-ops records.
- Ledger has no line-item or reversal model. This is acknowledged but explicitly out of Phase 1.

## Target Entity Model

### Organization

Definition: the brand/HQ owner of identity, central membership plans, global policy, and platform-level reporting.

Table: `organizations`

Key fields:

- `id`
- `name`
- `slug`
- `legal_name`
- `org_number`
- `default_currency`
- `default_country`
- `settings`
- `status`
- `created_at`
- `updated_at`

Responsibilities:

- Owns customers.
- Owns central membership plans.
- Owns brand-level entitlements policy.
- Owns franchisee relationships.
- Provides HQ authorization scope.

### Franchisee

Definition: operator legal entity under an organization. A franchisee owns one or more venues operationally and financially.

Table: `franchisees`

Key fields:

- `id`
- `organization_id`
- `legal_name`
- `org_number`
- `stripe_account_id` nullable for now
- `payout_currency`
- `vat_rate`
- `revenue_share_pct`
- `status`
- `metadata`
- `created_at`
- `updated_at`

Responsibilities:

- Groups venues by operator.
- Future Stripe Connect connected-account owner.
- Future settlement and revenue-share scope.

Phase 1 must create this entity even though Stripe Connect is not touched yet.

### Venue

Definition: physical operating location.

Current table: `venues`

New parent fields:

- `organization_id`
- `franchisee_id`

Responsibilities:

- Owns local operations: courts, bookings, check-ins, opening hours, activities, drift, resource blocks.
- Consumes central membership entitlements once later phases cut over.
- Attributes revenue and entitlement usage to the physical location.

### Customer

Definition: canonical human/commercial identity under an organization. It is not the same thing as `auth.users`.

Table: `customers`

Key fields:

- `id`
- `organization_id`
- `auth_user_id` nullable, unique when present
- `display_name`
- `first_name`
- `last_name`
- `primary_email`
- `primary_phone`
- `email_normalized`
- `phone_e164`
- `marketing_consent`
- `consent_at`
- `merged_into_id`
- `status`
- `metadata`
- `created_at`
- `updated_at`

Responsibilities:

- Customer 360 reads this as the primary identity.
- Allows walk-ins, Zettle-only buyers, imported contacts, and auth users to converge.
- Supports future merge/dedupe.

Supporting table: `customer_identities`

Purpose: external and alternate identity links.

Examples:

- `provider = 'auth'`, `provider_id = auth.users.id`
- `provider = 'stripe'`, `provider_id = cus_...`
- `provider = 'email'`
- `provider = 'phone'`
- `provider = 'zettle'` later, only when safely matched

Supporting table: `customer_venue_profiles`

Purpose: venue-private customer context.

Fields:

- `customer_id`
- `venue_id`
- `is_home_venue`
- `first_seen_at`
- `last_seen_at`
- `visit_count`
- `private_notes`
- `tags`
- `metadata`

Venue-private notes must not leak across venues.

### Membership

Definition: central customer subscription/access relationship owned by organization.

Target table: `memberships` will eventually be re-owned, or a new `central_memberships` table will be introduced and then renamed once stable.

Target fields:

- `id`
- `organization_id`
- `customer_id`
- `plan_id`
- `home_venue_id` nullable
- `status`
- `started_at`
- `current_period_end`
- `cancel_at`
- `stripe_subscription_id`
- `stripe_customer_id`
- `created_at`
- `updated_at`

Important Phase 1 decision:

Do not immediately remove `memberships.venue_id`. Add `customer_id`, `organization_id`, and `home_venue_id` in a compatibility step later, then backfill and dual-read. Runtime cutover is Phase 2.

### Membership Plan

Definition: central brand-level plan catalog, replacing venue-owned `membership_tiers` as the target model.

Target table: `membership_plans`

Key fields:

- `id`
- `organization_id`
- `name`
- `description`
- `price_minor`
- `currency`
- `billing_interval`
- `access_scope`: `all_venues`, `home_venue`, `venue_group`
- `is_active`
- `sort_order`
- `metadata`

Supporting table: `membership_plan_venues`

Purpose: declare which venues honor which plan when `access_scope` requires explicit venue selection.

Phase 1 may create this catalog as a shadow model, but public membership checkout must still use the current tables until Phase 2.

### Entitlement

Definition: a grantable access right from a plan or purchase.

Target model has three layers:

1. `plan_entitlements`
   - Defines what a plan grants.
   - Replaces target ownership of current `membership_entitlements`.

2. `entitlement_grants`
   - Runtime access spine.
   - Materialized from membership, day pass, booking, voucher, comp.
   - Booking/check-in will eventually read this as the access source.

3. `entitlement_usage`
   - Records venue-attributed consumption.
   - Replaces target ownership of current `membership_usage`.

Phase 1 creates the foundation and backfill plan. It does not cut booking/check-in over to grants.

### Franchise Ownership

Definition: legal/financial parentage between organization, franchisee, and venue.

Rules:

- Organization owns brand, customers, plan catalog.
- Franchisee owns local operating entity and future connected account.
- Venue belongs to exactly one franchisee and one organization.
- A first-party venue still has a franchisee row, e.g. "Pickla Solna AB".

Do not implement Stripe Connect in Phase 1, but model `franchisees.stripe_account_id` so the future migration has a home.

## Proposed New Tables

Phase 1 creates:

- `organizations`
- `franchisees`
- `organization_members`
- `staff_roles` or, if too large for Phase 1, `organization_members` only plus existing `venue_staff`
- `customers`
- `customer_identities`
- `customer_venue_profiles`
- `audit_log`

Phase 1 may also create shadow target tables if we want central membership shape visible early:

- `membership_plans`
- `membership_plan_venues`
- `plan_entitlements`

Do not create `entitlement_grants` as the runtime source in the first migration unless a feature flag/read-only backfill plan is ready.

## Current Tables Affected

Tenant/authorization:

- `venues`
- `venue_staff`
- `user_roles`

Customer:

- `player_profiles`
- `auth.users`
- `booking_receipts`
- `ledger_entries`
- `bookings`
- `session_registrations`
- `day_passes`
- `memberships`
- `venue_checkins`

Membership/access:

- `membership_tiers`
- `membership_tier_pricing`
- `membership_entitlements`
- `membership_usage`
- `memberships`
- `access_entitlements`
- `access_vouchers`
- `day_passes`

Events:

- `events`
- `event_leads`
- `event_offers`
- `event_lead_activities`
- `event_resource_allocations`
- `event_resource_blocks`
- `event_courts`
- `score_sessions`
- `score_matches`
- `chat_rooms`

Finance:

- `ledger_entries`
- `booking_receipts`
- `zettle_connections`
- `zettle_purchases`
- `customer_transactions`

## Shared Authorization

Create a shared Edge Function module:

```text
supabase/functions/_shared/authorization.ts
```

Responsibilities:

- Resolve authenticated user.
- Check super admin.
- Check organization role.
- Check franchisee role.
- Check venue role.
- Resolve venue ancestry: venue -> franchisee -> organization.
- Provide one canonical set of helpers:
  - `requireUser(req)`
  - `requireSuperAdmin(admin, userId)`
  - `requireOrganizationRole(admin, userId, organizationId, roles)`
  - `requireFranchiseeRole(admin, userId, franchiseeId, roles)`
  - `requireVenueRole(admin, userId, venueId, roles)`
  - `canOperateVenue(admin, userId, venueId)`
  - `getAuthorizedVenueIds(admin, userId)`
  - `assertMutationScope(...)`

Replace scattered checks in this order:

1. `api-admin`
2. `api-customers`
3. `api-memberships`
4. `api-checkins`
5. `event-sales-agent`
6. `event-intake-agent`
7. `event-offer-builder`
8. `event-pdf-generator`
9. `event-followup-agent`
10. `api-day-passes`
11. `api-notifications`
12. `api-bookings` admin mutation paths
13. `api-events`
14. `api-ops`

Important rule:

`api-admin` must not authorize as "admin somewhere". Every venue mutation must authorize the specific target venue.

## Audit Log

Create `audit_log` as append-only.

Fields:

- `id`
- `organization_id`
- `franchisee_id`
- `venue_id`
- `actor_user_id`
- `actor_type`: `user`, `system`, `webhook`, `agent`
- `action`
- `entity_table`
- `entity_id`
- `request_id`
- `before`
- `after`
- `metadata`
- `ip`
- `user_agent`
- `created_at`

Rules:

- Insert only through service role.
- No update/delete.
- Venue admins can read logs for their venue.
- Organization admins can read logs for their organization.
- Super admins can read all.

Phase 1 mutation coverage:

- `api-admin` mutations.
- `api-customers` create/update.
- `api-memberships` assign/update/cancel/tier changes.
- `api-checkins` staff/manual check-in.
- Event lead/offer/schedule/confirm mutations.

Do not attempt full webhook audit parity in the first pass. Add Stripe webhook audit after customer master resolution is stable.

## Player Profiles Security Fix

Current policy:

```sql
CREATE POLICY "Anyone can read player profiles"
ON public.player_profiles
FOR SELECT
USING (true);
```

Target:

- Users can read/update their own `player_profiles`.
- Venue staff can read profiles only for customers connected to their venue.
- Organization staff can read profiles connected to organization venues.
- Super admins can read all.
- Public/community features that need names/avatars should use a safe public profile view with limited fields.

Recommended safe public view:

```text
public_player_profiles
- auth_user_id
- display_name
- avatar_url
- pickla_rating
```

Do not expose phone, structured contact fields, Stripe customer id, wellness fields, or private customer fields publicly.

## Event Table Split Strategy

Decision:

Do not split `events` in Phase 1.

Instead:

1. Add `events.event_domain`:
   - `play`
   - `sales`
   - `mixed`
2. Backfill:
   - linked from `event_leads.event_id` -> `sales`
   - has customer/planning/private fields -> `sales`
   - public tournament/scoring rows -> `play`
   - ambiguous rows -> `mixed`
3. Update new code to filter by `event_domain` where relevant.

Target split:

- `play_events`: public/tournament/community/scoring.
- `sales_events` or `private_events`: B2B/private event operations linked to leads/offers/resources/blocks.

Actual table split is Phase 2 or Phase 3 after read paths have domain filters.

## Migration Order

### Migration 1: Organization And Franchise Spine

Create:

- `organizations`
- `franchisees`
- `organization_members`

Alter:

- `venues.organization_id`
- `venues.franchisee_id`

Backfill:

- Create organization `Pickla`.
- Create first-party franchisee for current operating company.
- Attach every existing venue to that organization/franchisee.
- Backfill `organization_members` from `user_roles.super_admin` and `venue_staff`.

### Migration 2: Authorization SQL Helpers

Create SQL helper functions:

- `is_organization_member(user_id, organization_id)`
- `is_organization_admin(user_id, organization_id)`
- `is_franchisee_member(user_id, franchisee_id)`
- `is_franchisee_admin(user_id, franchisee_id)`
- `can_operate_venue(user_id, venue_id)`

Keep existing helpers:

- `is_super_admin`
- `is_venue_member`
- `is_venue_admin`

Do not break existing RLS.

### Migration 3: Customer Master

Create:

- `customers`
- `customer_identities`
- `customer_venue_profiles`

Alter:

- `player_profiles.customer_id`

Backfill:

- One customer per `player_profiles.auth_user_id`.
- Link `player_profiles.customer_id`.
- Add auth identity for each linked auth user.
- Add email identity from `auth.users.email` where available.
- Add phone identity from `player_profiles.phone` where available.
- Add Stripe identity from `player_profiles.stripe_customer_id` where available.

Do not fuzzy-match Zettle.

### Migration 4: Customer References On Operational Tables

Add nullable `customer_id` to:

- `bookings`
- `session_registrations`
- `day_passes`
- `memberships`
- `booking_receipts`
- `ledger_entries`
- `venue_checkins`

Backfill by `user_id -> customers.auth_user_id`.

Do not make these columns `NOT NULL` in Phase 1.

### Migration 5: Audit Log

Create `audit_log`.

Add RLS:

- service role insert
- no update/delete
- scoped staff read

### Migration 6: Player Profile RLS Lockdown

Create safe public profile view if required.

Then:

- Drop public `player_profiles` select policy.
- Add own/staff/org/super-admin policies.

This should happen after app paths that rely on broad profile reads are identified and moved to safe views or service-backed endpoints.

### Migration 7: Event Domain

Alter:

- `events.event_domain`

Backfill:

- `sales`, `play`, `mixed`.

Add index:

- `(venue_id, event_domain, start_date)`

Do not split table.

### Migration 8: Membership Target Shadow Model

Create target catalog tables if Phase 1 has budget:

- `membership_plans`
- `membership_plan_venues`
- `plan_entitlements`

Backfill from:

- `membership_tiers`
- `membership_entitlements`

Do not use as runtime source yet.

## Backfill Strategy

### Organization/Franchisee

- Create one organization for Pickla.
- Create one first-party franchisee for existing Solna/current operator.
- Attach all venues to both.
- Preserve existing `venue_staff`.
- Add `organization_members` for super admins.

### Customers

Deterministic order:

1. `player_profiles.auth_user_id`
2. `auth.users.email`
3. `player_profiles.phone`
4. `player_profiles.stripe_customer_id`
5. receipt denormalized fields only as metadata if no auth-backed profile exists

No aggressive merge by phone/email in the first migration. Duplicates are safer than bad merges.

### Customer Venue Profiles

Create a row when a customer has any venue-linked record:

- booking
- activity registration
- day pass
- membership
- check-in
- receipt

Set:

- `first_seen_at = min(created_at/issued_at/checked_in_at)`
- `last_seen_at = max(...)`
- `visit_count` from check-ins where available

### Membership Shadow Catalog

Backfill one `membership_plan` per current `membership_tiers` row initially, even though this duplicates venue-local plans at org level.

Set:

- `organization_id` from tier venue organization.
- `access_scope = 'home_venue'` for migrated venue-local plans.
- `membership_plan_venues` includes the old `venue_id`.

This avoids accidentally turning Solna memberships into all-venue memberships.

### Event Domain

Backfill:

- `sales` if `events.id` appears in `event_leads.event_id`.
- `sales` if `customer_email`, `customer_name`, `expected_participants`, `internal_notes`, or private planning fields are set.
- `play` if public/scoring/tournament fields dominate and no sales linkage exists.
- `mixed` if unclear.

## Rollout Plan

### Phase 1: Foundation

Implement:

- Organization/franchisee spine.
- Customer master and identities.
- Customer references on key operational records.
- Shared authorization module.
- Audit log.
- `player_profiles` public read lockdown.
- `events.event_domain`.
- Optional central membership shadow catalog.

Runtime behavior should remain the same:

- Existing booking works.
- Existing check-in works.
- Existing membership checkout works.
- Existing Stripe webhook works.
- Existing ledger writes work.
- Existing Event OS works.

### Phase 2: Runtime Cutovers

Implement:

- Customer 360 reads from `customers` as primary.
- New writes populate `customer_id` everywhere.
- Membership UI reads central `membership_plans`.
- Membership assignment creates central `membership` model.
- Add `entitlement_grants` and `entitlement_usage`.
- Dual-run current access resolver and grant resolver.
- Event reads filter by `event_domain`.
- Start reducing direct dependence on `auth.users` for customer workflows.

### Phase 3: Franchise And Accounting Scale

Implement:

- Stripe Connect.
- Franchisee settlement.
- Ledger lines and reversal model.
- Central membership revenue attribution.
- Full grant-based booking/check-in access.
- Split `events` into play/private tables if domain filters are stable.
- Deprecate old venue-owned membership tables or convert them into compatibility views.

## What Must Not Be Touched Yet

Phase 1 must not:

- Implement Stripe Connect.
- Change payment checkout behavior.
- Change Stripe webhook payment finalization semantics.
- Rebuild ledger lines/reversals.
- Cut booking/check-in over to entitlement grants.
- Remove existing `memberships.venue_id`.
- Remove existing `membership_tiers`.
- Delete or split `events`.
- Rewrite booking availability.
- Rewrite self check-in.
- Auto-merge uncertain customers.
- Auto-match Zettle transactions to customers.
- Change public booking or public schedule behavior except where required for profile security.

## Edge Function Rollout Order

1. Add `_shared/authorization.ts`.
2. Update `api-admin` first.
3. Update `api-customers`.
4. Update `api-memberships`.
5. Update `api-checkins`.
6. Update event functions.
7. Update `api-bookings` admin mutation paths.
8. Update `api-stripe-webhook` to create/resolve `customer_id` for new writes.
9. Update `api-day-passes`.
10. Update `api-notifications`.
11. Update `api-ops`.

Each updated mutation should write `audit_log`.

## Risks

### RLS Breakage

Locking down `player_profiles` can break public/community UI that currently relies on broad profile reads.

Mitigation:

- Add safe public view.
- Move sensitive reads behind Edge Functions.
- Test Hub/community/score/check-in/customer search before policy cutover.

### Bad Customer Merges

Phone/email matching can merge unrelated people.

Mitigation:

- Only deterministic auth-backed linking in Phase 1.
- Use `customer_identities` for candidates.
- Build admin-assisted merge later.

### Hidden Cross-Venue Assumptions

`api-admin` currently allows broad admin access after proving admin somewhere.

Mitigation:

- Roll out shared authorization endpoint by endpoint.
- Log denied attempts.
- Keep venue switcher tests explicit.

### Membership Runtime Drift

Creating central plan tables while current runtime uses venue tables can create split-brain.

Mitigation:

- Treat central membership catalog as shadow/read-only until Phase 2.
- Do not expose editing in UI until runtime cutover is planned.

### Event Domain Ambiguity

Some `events` rows are mixed.

Mitigation:

- Use `mixed` domain.
- Do not split table in Phase 1.
- Add filters only where the domain is unambiguous.

### Audit Noise

Audit log can become noisy and inconsistent.

Mitigation:

- Standardize `action` names.
- Log only mutations.
- Include `request_id`, actor, entity, before/after when practical.

### Migration Ordering

Adding RLS before backfill can lock staff out.

Mitigation:

- Backfill first.
- Add policies permissively with old helpers.
- Tighten after function changes deploy.

## Acceptance Criteria

Phase 1 is complete when:

1. Every venue belongs to an organization and franchisee.
2. Existing staff can still access the same venues as before.
3. Shared authorization helpers exist and are used by `api-admin`, `api-customers`, `api-memberships`, and `api-checkins`.
4. Customer master exists and is backfilled from `player_profiles`.
5. Key operational tables have nullable `customer_id` and are backfilled where deterministic.
6. Customer 360 can resolve a customer through `customer_id` or compatibility fallback.
7. `player_profiles` is no longer globally readable with sensitive fields.
8. Safe public profile access exists where public UI needs display name/avatar/rating.
9. `audit_log` exists, is append-only, and records Phase 1-covered mutations.
10. `events.event_domain` exists and is backfilled.
11. Current booking, check-in, membership, Stripe webhook, ledger, Event OS, Desk OS, and Admin OS flows still work.
12. No Stripe Connect, ledger reversal, entitlement-grant cutover, or event table split has been introduced.

## Implementation Notes For Future Codex Sessions

- Start with migrations and backfills, then authorization module, then function-by-function rollout.
- Keep changes small and deployable.
- Do not combine customer master rollout with membership runtime inversion.
- Do not combine audit log rollout with ledger redesign.
- Use feature-compatible columns and nullable references first.
- Prefer compatibility reads during migration:
  - new `customer_id` when present
  - fallback to `user_id`/`auth_user_id`
- Run `npm run build` and `git diff --check` after implementation changes.
- Never commit `supabase/.temp/*`.
