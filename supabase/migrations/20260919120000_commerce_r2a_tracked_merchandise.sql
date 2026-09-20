-- Pickla Commerce R2A: tracked physical merchandise.
-- Additive only: access_products, commerce_orders, commerce_order_lines,
-- finalize_commerce_payment, receipt truth, and ledger truth remain canonical.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS tracked_merch_sales_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.access_products
  ADD COLUMN IF NOT EXISTS catalog_owner_organization_id UUID REFERENCES public.organizations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS inventory_policy TEXT NOT NULL DEFAULT 'stockless';

ALTER TABLE public.access_products
  ADD CONSTRAINT access_products_inventory_policy_check
  CHECK (inventory_policy IN ('stockless', 'tracked')),
  ADD CONSTRAINT access_products_tracked_merch_shape_check
  CHECK (
    inventory_policy = 'stockless'
    OR (
      catalog_owner_organization_id IS NOT NULL
      AND commerce_kind = 'merchandise'
      AND fulfillment_type = 'desk_pickup'
      AND fulfillment_presentation = 'desk_pickup'
      AND standalone_enabled = true
      AND activity_addon_enabled = false
    )
  );

COMMENT ON COLUMN public.access_products.inventory_policy IS
  'Explicit physical stock policy. Historical and non-stock products remain stockless; R2A merchandise uses tracked.';
COMMENT ON COLUMN public.access_products.catalog_owner_organization_id IS
  'Stable catalog/SKU owner for new tracked merchandise. Deliberately not backfilled from historical product rows.';

CREATE TABLE public.product_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.access_products(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  is_required BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, code),
  UNIQUE (id, product_id),
  CHECK (code = lower(code) AND code ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  CHECK (length(btrim(label)) BETWEEN 1 AND 120)
);

CREATE TABLE public.product_option_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  option_id UUID NOT NULL REFERENCES public.product_options(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  swatch TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (option_id, code),
  UNIQUE (id, option_id),
  CHECK (code = lower(code) AND code ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  CHECK (length(btrim(label)) BETWEEN 1 AND 120)
);

CREATE TABLE public.product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.access_products(id) ON DELETE RESTRICT,
  catalog_owner_organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  sku TEXT NOT NULL,
  title TEXT,
  price_override_minor INTEGER CHECK (price_override_minor IS NULL OR price_override_minor >= 0),
  image_url TEXT,
  option_signature TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  identity_locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, product_id),
  UNIQUE (product_id, option_signature),
  CHECK (length(btrim(sku)) BETWEEN 1 AND 120),
  CHECK (option_signature ~ '^[0-9a-f-]{36}(,[0-9a-f-]{36})*$')
);

CREATE UNIQUE INDEX product_variants_owner_normalized_sku_uq
  ON public.product_variants (catalog_owner_organization_id, lower(btrim(sku)));

CREATE TABLE public.product_variant_option_values (
  variant_id UUID NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  option_id UUID NOT NULL,
  option_value_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (variant_id, option_id),
  UNIQUE (variant_id, option_value_id),
  FOREIGN KEY (option_value_id, option_id)
    REFERENCES public.product_option_values(id, option_id) ON DELETE RESTRICT
);

CREATE TABLE public.inventory_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE RESTRICT,
  inventory_owner_franchisee_id UUID NOT NULL REFERENCES public.franchisees(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  is_default_retail BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (venue_id, code),
  UNIQUE (id, venue_id),
  CHECK (code = lower(code) AND code ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  CHECK (length(btrim(name)) BETWEEN 1 AND 160)
);

CREATE UNIQUE INDEX inventory_locations_one_default_retail_uq
  ON public.inventory_locations (venue_id)
  WHERE is_default_retail AND status = 'active';

CREATE TABLE public.product_venue_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.access_products(id) ON DELETE RESTRICT,
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE RESTRICT,
  seller_franchisee_id UUID NOT NULL REFERENCES public.franchisees(id) ON DELETE RESTRICT,
  default_inventory_location_id UUID NOT NULL,
  currency TEXT NOT NULL DEFAULT 'SEK' CHECK (currency = upper(currency)),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  tracked_sales_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, venue_id),
  FOREIGN KEY (default_inventory_location_id, venue_id)
    REFERENCES public.inventory_locations(id, venue_id) ON DELETE RESTRICT
);

CREATE TABLE public.inventory_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  location_id UUID NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  on_hand INTEGER NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  allocated INTEGER NOT NULL DEFAULT 0 CHECK (allocated >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  incident_blocked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (variant_id, location_id)
);

COMMENT ON TABLE public.inventory_levels IS
  'Mutable R2A balance projection. available_to_sell is always on_hand - reserved - allocated and may be negative during a shortage incident.';

CREATE TABLE public.inventory_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command_type TEXT NOT NULL CHECK (command_type IN ('receive', 'correct', 'incident_resolve')),
  idempotency_key TEXT NOT NULL,
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE RESTRICT,
  seller_franchisee_id UUID NOT NULL REFERENCES public.franchisees(id) ON DELETE RESTRICT,
  variant_id UUID NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  location_id UUID NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  request JSONB NOT NULL DEFAULT '{}'::JSONB,
  result JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seller_franchisee_id, idempotency_key)
);

CREATE TABLE public.inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  location_id UUID NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  movement_type TEXT NOT NULL CHECK (movement_type IN (
    'receive', 'correction', 'reserve', 'reservation_release', 'payment_commit',
    'pickup', 'allocation_cancel', 'return_sellable'
  )),
  on_hand_delta INTEGER NOT NULL DEFAULT 0,
  reserved_delta INTEGER NOT NULL DEFAULT 0,
  allocated_delta INTEGER NOT NULL DEFAULT 0,
  source_effect_key TEXT NOT NULL UNIQUE,
  source_entity_type TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  command_id UUID REFERENCES public.inventory_commands(id) ON DELETE RESTRICT,
  order_id UUID REFERENCES public.commerce_orders(id) ON DELETE RESTRICT,
  order_line_id UUID REFERENCES public.commerce_order_lines(id) ON DELETE RESTRICT,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  system_principal TEXT,
  reason TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (on_hand_delta <> 0 OR reserved_delta <> 0 OR allocated_delta <> 0),
  CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  CHECK (actor_user_id IS NOT NULL OR system_principal IS NOT NULL)
);

CREATE TABLE public.inventory_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_level_id UUID NOT NULL REFERENCES public.inventory_levels(id) ON DELETE RESTRICT,
  ops_incident_id UUID NOT NULL REFERENCES public.ops_incidents(id) ON DELETE RESTRICT,
  incident_type TEXT NOT NULL CHECK (incident_type IN ('physical_shortage', 'reconciliation_mismatch', 'paid_without_reservation')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  blocking BOOLEAN NOT NULL DEFAULT true,
  deficit_quantity INTEGER NOT NULL CHECK (deficit_quantity > 0),
  resolution_evidence JSONB NOT NULL DEFAULT '{}'::JSONB,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX inventory_incidents_one_open_type_uq
  ON public.inventory_incidents (inventory_level_id, incident_type)
  WHERE status = 'open';

ALTER TABLE public.commerce_orders
  ADD COLUMN IF NOT EXISTS seller_franchisee_id UUID REFERENCES public.franchisees(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS pickup_location_id UUID REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS checkout_attempt_id UUID,
  ADD COLUMN IF NOT EXISTS seller_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB;

ALTER TABLE public.commerce_order_lines
  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS sku TEXT,
  ADD COLUMN IF NOT EXISTS inventory_policy TEXT NOT NULL DEFAULT 'stockless',
  ADD COLUMN IF NOT EXISTS pickup_location_id UUID REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS variant_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS collected_quantity INTEGER NOT NULL DEFAULT 0 CHECK (collected_quantity >= 0),
  ADD COLUMN IF NOT EXISTS cancelled_quantity INTEGER NOT NULL DEFAULT 0 CHECK (cancelled_quantity >= 0),
  ADD CONSTRAINT commerce_order_lines_inventory_policy_check CHECK (inventory_policy IN ('stockless', 'tracked')),
  ADD CONSTRAINT commerce_order_lines_quantity_outcomes_check CHECK (collected_quantity + cancelled_quantity <= quantity),
  ADD CONSTRAINT commerce_order_lines_tracked_identity_check CHECK (
    inventory_policy = 'stockless'
    OR (variant_id IS NOT NULL AND sku IS NOT NULL AND pickup_location_id IS NOT NULL
      AND commerce_kind = 'merchandise' AND fulfillment_type = 'desk_pickup')
  );

-- Preserve one canonical sale ledger entry per order while allowing independently
-- idempotent refund entries to reference the same canonical order explicitly.
DROP INDEX IF EXISTS public.idx_ledger_entries_commerce_order;
CREATE UNIQUE INDEX idx_ledger_entries_commerce_order
  ON public.ledger_entries (commerce_order_id)
  WHERE commerce_order_id IS NOT NULL AND source_type = 'commerce_order';
CREATE INDEX idx_ledger_entries_commerce_order_all
  ON public.ledger_entries (commerce_order_id, occurred_at)
  WHERE commerce_order_id IS NOT NULL;

CREATE TABLE public.commerce_checkout_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commerce_order_id UUID NOT NULL REFERENCES public.commerce_orders(id) ON DELETE RESTRICT,
  checked_order_version INTEGER NOT NULL CHECK (checked_order_version > 0),
  frozen_order_version INTEGER NOT NULL CHECK (frozen_order_version > checked_order_version),
  seller_franchisee_id UUID NOT NULL REFERENCES public.franchisees(id) ON DELETE RESTRICT,
  pickup_location_id UUID NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  currency TEXT NOT NULL CHECK (currency = upper(currency)),
  total_inc_vat_minor INTEGER NOT NULL CHECK (total_inc_vat_minor > 0),
  total_vat_minor INTEGER NOT NULL CHECK (total_vat_minor >= 0),
  provider TEXT NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
  provider_environment TEXT NOT NULL CHECK (provider_environment IN ('test', 'live')),
  provider_account_key TEXT NOT NULL,
  provider_idempotency_key TEXT NOT NULL,
  provider_session_id TEXT,
  provider_payment_intent_id TEXT,
  provider_request JSONB NOT NULL,
  provider_response JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN (
    'prepared', 'provider_creation_unresolved', 'open', 'payment_processing',
    'payment_committed', 'closed_unpaid', 'attention'
  )),
  expires_at TIMESTAMPTZ NOT NULL,
  recovery_after TIMESTAMPTZ NOT NULL,
  recovery_lease_token UUID,
  recovery_lease_expires_at TIMESTAMPTZ,
  recovery_attempts INTEGER NOT NULL DEFAULT 0 CHECK (recovery_attempts >= 0),
  last_reconciled_at TIMESTAMPTZ,
  last_error TEXT,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_environment, provider_account_key, provider_idempotency_key),
  UNIQUE (provider_environment, provider_account_key, provider_session_id),
  UNIQUE (provider_environment, provider_account_key, provider_payment_intent_id),
  CHECK (expires_at >= created_at + interval '30 minutes'),
  CHECK (expires_at <= created_at + interval '24 hours')
);

CREATE UNIQUE INDEX commerce_checkout_attempts_one_unresolved_order_uq
  ON public.commerce_checkout_attempts (commerce_order_id)
  WHERE status IN ('prepared', 'provider_creation_unresolved', 'open', 'payment_processing', 'attention');

CREATE INDEX commerce_checkout_attempts_recovery_idx
  ON public.commerce_checkout_attempts (recovery_after, created_at)
  WHERE status IN ('prepared', 'provider_creation_unresolved', 'open', 'payment_processing', 'attention');

ALTER TABLE public.commerce_orders
  ADD CONSTRAINT commerce_orders_checkout_attempt_fk
  FOREIGN KEY (checkout_attempt_id) REFERENCES public.commerce_checkout_attempts(id) ON DELETE RESTRICT;

CREATE TABLE public.commerce_checkout_attempt_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_attempt_id UUID NOT NULL REFERENCES public.commerce_checkout_attempts(id) ON DELETE RESTRICT,
  commerce_order_line_id UUID NOT NULL REFERENCES public.commerce_order_lines(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES public.access_products(id) ON DELETE RESTRICT,
  variant_id UUID REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  pickup_location_id UUID REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  discount_minor INTEGER NOT NULL CHECK (discount_minor >= 0),
  total_inc_vat_minor INTEGER NOT NULL CHECK (total_inc_vat_minor >= 0),
  vat_rate NUMERIC(5,2) NOT NULL CHECK (vat_rate BETWEEN 0 AND 100),
  vat_amount_minor INTEGER NOT NULL CHECK (vat_amount_minor >= 0),
  inventory_policy TEXT NOT NULL CHECK (inventory_policy IN ('stockless', 'tracked')),
  product_snapshot JSONB NOT NULL,
  variant_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (checkout_attempt_id, commerce_order_line_id)
);

CREATE TABLE public.inventory_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_attempt_id UUID NOT NULL REFERENCES public.commerce_checkout_attempts(id) ON DELETE RESTRICT,
  variant_id UUID NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  location_id UUID NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'committed', 'released')),
  release_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  UNIQUE (checkout_attempt_id, variant_id, location_id)
);

CREATE INDEX inventory_reservations_active_level_idx
  ON public.inventory_reservations (location_id, variant_id)
  WHERE status = 'active';

CREATE TABLE public.inventory_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_attempt_id UUID NOT NULL REFERENCES public.commerce_checkout_attempts(id) ON DELETE RESTRICT,
  reservation_id UUID NOT NULL REFERENCES public.inventory_reservations(id) ON DELETE RESTRICT,
  commerce_order_id UUID NOT NULL REFERENCES public.commerce_orders(id) ON DELETE RESTRICT,
  commerce_order_line_id UUID NOT NULL REFERENCES public.commerce_order_lines(id) ON DELETE RESTRICT,
  variant_id UUID NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  location_id UUID NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  collected_quantity INTEGER NOT NULL DEFAULT 0 CHECK (collected_quantity >= 0),
  cancelled_quantity INTEGER NOT NULL DEFAULT 0 CHECK (cancelled_quantity >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'partially_collected', 'collected', 'cancelled', 'attention')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (checkout_attempt_id, commerce_order_line_id),
  CHECK (collected_quantity + cancelled_quantity <= quantity)
);

CREATE INDEX inventory_allocations_open_pickup_idx
  ON public.inventory_allocations (location_id, created_at)
  WHERE status IN ('active', 'partially_collected', 'attention');

CREATE TABLE public.commerce_pickup_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL,
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE RESTRICT,
  order_line_id UUID NOT NULL REFERENCES public.commerce_order_lines(id) ON DELETE RESTRICT,
  allocation_id UUID NOT NULL REFERENCES public.inventory_allocations(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  actor_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  result JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (venue_id, idempotency_key)
);

CREATE TABLE public.commerce_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commerce_order_id UUID NOT NULL REFERENCES public.commerce_orders(id) ON DELETE RESTRICT,
  seller_franchisee_id UUID REFERENCES public.franchisees(id) ON DELETE RESTRICT,
  pickup_location_id UUID REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  refund_type TEXT NOT NULL CHECK (refund_type IN ('quantity', 'goodwill', 'external_unallocated')),
  status TEXT NOT NULL DEFAULT 'preparing' CHECK (status IN ('preparing', 'pending', 'succeeded', 'failed', 'attention')),
  amount_inc_vat_minor INTEGER NOT NULL CHECK (amount_inc_vat_minor > 0),
  vat_amount_minor INTEGER NOT NULL CHECK (vat_amount_minor >= 0),
  unallocated_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (unallocated_amount_minor >= 0),
  currency TEXT NOT NULL CHECK (currency = upper(currency)),
  provider_environment TEXT NOT NULL CHECK (provider_environment IN ('test', 'live')),
  provider_account_key TEXT NOT NULL,
  provider_idempotency_key TEXT NOT NULL,
  provider_request JSONB NOT NULL,
  provider_refund_id TEXT,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  provider_response JSONB NOT NULL DEFAULT '{}'::JSONB,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  recovery_after TIMESTAMPTZ NOT NULL DEFAULT now(),
  recovery_lease_token UUID,
  recovery_lease_expires_at TIMESTAMPTZ,
  recovery_attempts INTEGER NOT NULL DEFAULT 0 CHECK (recovery_attempts >= 0),
  UNIQUE (commerce_order_id, idempotency_key),
  UNIQUE (provider_environment, provider_account_key, provider_idempotency_key),
  UNIQUE (provider_environment, provider_account_key, provider_refund_id),
  CHECK (unallocated_amount_minor <= amount_inc_vat_minor),
  CHECK (length(btrim(reason)) BETWEEN 1 AND 500)
);

CREATE INDEX commerce_refunds_recovery_idx ON public.commerce_refunds (recovery_after, created_at)
  WHERE status IN ('preparing', 'pending', 'attention');

CREATE TABLE public.commerce_refund_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id UUID NOT NULL REFERENCES public.commerce_refunds(id) ON DELETE RESTRICT,
  commerce_order_line_id UUID NOT NULL REFERENCES public.commerce_order_lines(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  amount_inc_vat_minor INTEGER NOT NULL CHECK (amount_inc_vat_minor > 0),
  vat_amount_minor INTEGER NOT NULL CHECK (vat_amount_minor >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (refund_id, commerce_order_line_id)
);

CREATE TABLE public.commerce_physical_dispositions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL,
  commerce_order_id UUID NOT NULL REFERENCES public.commerce_orders(id) ON DELETE RESTRICT,
  commerce_order_line_id UUID NOT NULL REFERENCES public.commerce_order_lines(id) ON DELETE RESTRICT,
  allocation_id UUID NOT NULL REFERENCES public.inventory_allocations(id) ON DELETE RESTRICT,
  refund_id UUID REFERENCES public.commerce_refunds(id) ON DELETE RESTRICT,
  variant_id UUID NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  location_id UUID NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  outcome TEXT NOT NULL CHECK (outcome IN ('return_sellable', 'return_damaged', 'uncollected_present', 'uncollected_missing')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  actor_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (location_id, idempotency_key),
  CHECK (length(btrim(reason)) BETWEEN 1 AND 500)
);

CREATE INDEX commerce_physical_dispositions_line_idx
  ON public.commerce_physical_dispositions (commerce_order_line_id, outcome);

CREATE OR REPLACE FUNCTION public.commerce_r2a_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER product_options_touch BEFORE UPDATE ON public.product_options
  FOR EACH ROW EXECUTE FUNCTION public.commerce_r2a_touch_updated_at();
CREATE TRIGGER product_option_values_touch BEFORE UPDATE ON public.product_option_values
  FOR EACH ROW EXECUTE FUNCTION public.commerce_r2a_touch_updated_at();
CREATE TRIGGER product_variants_touch BEFORE UPDATE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.commerce_r2a_touch_updated_at();
CREATE TRIGGER inventory_locations_touch BEFORE UPDATE ON public.inventory_locations
  FOR EACH ROW EXECUTE FUNCTION public.commerce_r2a_touch_updated_at();
CREATE TRIGGER product_venue_listings_touch BEFORE UPDATE ON public.product_venue_listings
  FOR EACH ROW EXECUTE FUNCTION public.commerce_r2a_touch_updated_at();
CREATE TRIGGER inventory_levels_touch BEFORE UPDATE ON public.inventory_levels
  FOR EACH ROW EXECUTE FUNCTION public.commerce_r2a_touch_updated_at();
CREATE TRIGGER commerce_checkout_attempts_touch BEFORE UPDATE ON public.commerce_checkout_attempts
  FOR EACH ROW EXECUTE FUNCTION public.commerce_r2a_touch_updated_at();
CREATE TRIGGER inventory_allocations_touch BEFORE UPDATE ON public.inventory_allocations
  FOR EACH ROW EXECUTE FUNCTION public.commerce_r2a_touch_updated_at();
CREATE TRIGGER commerce_refunds_touch BEFORE UPDATE ON public.commerce_refunds
  FOR EACH ROW EXECUTE FUNCTION public.commerce_r2a_touch_updated_at();

CREATE OR REPLACE FUNCTION public.commerce_r2a_reject_immutable_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER inventory_movements_immutable
  BEFORE UPDATE OR DELETE ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.commerce_r2a_reject_immutable_mutation();
CREATE TRIGGER commerce_physical_dispositions_immutable
  BEFORE UPDATE OR DELETE ON public.commerce_physical_dispositions
  FOR EACH ROW EXECUTE FUNCTION public.commerce_r2a_reject_immutable_mutation();

CREATE OR REPLACE FUNCTION public.commerce_r2a_guard_product_tracking_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.inventory_policy IS DISTINCT FROM OLD.inventory_policy AND EXISTS (
    SELECT 1 FROM public.product_variants WHERE product_id = OLD.id
    UNION ALL
    SELECT 1 FROM public.product_venue_listings WHERE product_id = OLD.id
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'inventory_policy_has_catalog_or_inventory_configuration';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.inventory_policy IS DISTINCT FROM OLD.inventory_policy AND EXISTS (
    SELECT 1
    FROM public.commerce_order_lines l
    JOIN public.commerce_orders o ON o.id = l.commerce_order_id
    WHERE l.product_id = OLD.id
      AND o.status IN ('checkout_pending', 'paid', 'attention')
  ) THEN
    RAISE EXCEPTION 'inventory_policy_has_open_obligations';
  END IF;
  IF NEW.inventory_policy = 'tracked' AND NEW.activity_addon_enabled THEN
    RAISE EXCEPTION 'tracked_activity_addon_unsupported';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER access_products_r2a_tracking_guard
  BEFORE INSERT OR UPDATE OF inventory_policy, commerce_kind, fulfillment_type,
    fulfillment_presentation, standalone_enabled, activity_addon_enabled
  ON public.access_products
  FOR EACH ROW EXECUTE FUNCTION public.commerce_r2a_guard_product_tracking_change();

CREATE OR REPLACE FUNCTION public.commerce_r2a_guard_order_line_tracking()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_policy TEXT; v_variant_product UUID;
BEGIN
  SELECT inventory_policy INTO v_policy FROM public.access_products WHERE id = NEW.product_id;
  IF v_policy = 'tracked' THEN
    IF NEW.inventory_policy <> 'tracked' OR NEW.variant_id IS NULL OR NEW.pickup_location_id IS NULL
      OR NEW.parent_line_id IS NOT NULL OR NEW.activity_session_id IS NOT NULL
      OR NEW.source_type = 'activity_addon' THEN
      RAISE EXCEPTION 'tracked_activity_addon_or_identity_invalid';
    END IF;
    SELECT product_id INTO v_variant_product FROM public.product_variants WHERE id = NEW.variant_id;
    IF v_variant_product IS DISTINCT FROM NEW.product_id THEN RAISE EXCEPTION 'variant_product_mismatch'; END IF;
  ELSIF NEW.inventory_policy = 'tracked' THEN
    RAISE EXCEPTION 'stockless_product_cannot_use_tracked_line';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER commerce_order_lines_r2a_tracking_guard
  BEFORE INSERT OR UPDATE OF product_id, inventory_policy, variant_id, pickup_location_id,
    parent_line_id, activity_session_id, source_type
  ON public.commerce_order_lines
  FOR EACH ROW EXECUTE FUNCTION public.commerce_r2a_guard_order_line_tracking();

CREATE OR REPLACE FUNCTION public.commerce_r2a_guard_variant_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.commerce_order_lines WHERE variant_id = OLD.id
    UNION ALL
    SELECT 1 FROM public.inventory_movements WHERE variant_id = OLD.id
    LIMIT 1
  ) AND (
    NEW.product_id IS DISTINCT FROM OLD.product_id
    OR lower(btrim(NEW.sku)) IS DISTINCT FROM lower(btrim(OLD.sku))
    OR NEW.catalog_owner_organization_id IS DISTINCT FROM OLD.catalog_owner_organization_id
    OR NEW.option_signature IS DISTINCT FROM OLD.option_signature
  ) THEN
    RAISE EXCEPTION 'used_variant_identity_is_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER product_variants_identity_guard
  BEFORE UPDATE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.commerce_r2a_guard_variant_identity();

CREATE OR REPLACE FUNCTION public.commerce_r2a_assert_staff(p_actor_user_id UUID, p_venue_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_actor_user_id IS NULL OR NOT (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_actor_user_id AND role = 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.venue_staff
      WHERE user_id = p_actor_user_id AND venue_id = p_venue_id
        AND role IN ('venue_admin', 'desk_staff') AND is_active = true
    )
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_r2a_upsert_variant(
  p_product_id UUID,
  p_variant_id UUID,
  p_sku TEXT,
  p_title TEXT,
  p_price_override_minor INTEGER,
  p_image_url TEXT,
  p_status TEXT,
  p_option_value_ids UUID[],
  p_actor_user_id UUID
) RETURNS public.product_variants
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_product public.access_products%ROWTYPE;
  v_signature TEXT;
  v_required_count INTEGER;
  v_selected_count INTEGER;
  v_variant public.product_variants%ROWTYPE;
BEGIN
  SELECT * INTO v_product FROM public.access_products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'product_not_found'; END IF;
  PERFORM public.commerce_r2a_assert_staff(p_actor_user_id, v_product.venue_id);
  IF v_product.inventory_policy <> 'tracked' OR v_product.catalog_owner_organization_id IS NULL THEN
    RAISE EXCEPTION 'product_is_not_tracked';
  END IF;
  IF p_status NOT IN ('active', 'archived') THEN RAISE EXCEPTION 'invalid_variant_status'; END IF;
  IF p_price_override_minor IS NOT NULL AND p_price_override_minor < 0 THEN RAISE EXCEPTION 'invalid_variant_price'; END IF;

  SELECT count(*) INTO v_required_count
  FROM public.product_options WHERE product_id = p_product_id AND is_required AND status = 'active';

  SELECT count(DISTINCT o.id), string_agg(v.id::TEXT, ',' ORDER BY v.id::TEXT)
    INTO v_selected_count, v_signature
  FROM unnest(COALESCE(p_option_value_ids, ARRAY[]::UUID[])) selected(id)
  JOIN public.product_option_values v ON v.id = selected.id AND v.status = 'active'
  JOIN public.product_options o ON o.id = v.option_id AND o.product_id = p_product_id AND o.status = 'active';

  IF v_required_count = 0 OR v_selected_count IS DISTINCT FROM v_required_count
    OR cardinality(COALESCE(p_option_value_ids, ARRAY[]::UUID[])) <> v_required_count THEN
    RAISE EXCEPTION 'variant_requires_exactly_one_value_per_required_option';
  END IF;

  IF p_variant_id IS NULL THEN
    INSERT INTO public.product_variants (
      product_id, catalog_owner_organization_id, sku, title, price_override_minor,
      image_url, option_signature, status
    ) VALUES (
      p_product_id, v_product.catalog_owner_organization_id, btrim(p_sku), NULLIF(btrim(p_title), ''),
      p_price_override_minor, NULLIF(btrim(p_image_url), ''), v_signature, p_status
    ) RETURNING * INTO v_variant;
  ELSE
    SELECT * INTO v_variant FROM public.product_variants WHERE id = p_variant_id FOR UPDATE;
    IF NOT FOUND OR v_variant.product_id <> p_product_id THEN RAISE EXCEPTION 'variant_not_found'; END IF;
    UPDATE public.product_variants SET
      sku = btrim(p_sku), title = NULLIF(btrim(p_title), ''),
      price_override_minor = p_price_override_minor, image_url = NULLIF(btrim(p_image_url), ''),
      option_signature = v_signature, status = p_status
    WHERE id = p_variant_id RETURNING * INTO v_variant;
    DELETE FROM public.product_variant_option_values WHERE variant_id = p_variant_id;
  END IF;

  INSERT INTO public.product_variant_option_values (variant_id, option_id, option_value_id)
  SELECT v_variant.id, v.option_id, v.id
  FROM unnest(p_option_value_ids) selected(id)
  JOIN public.product_option_values v ON v.id = selected.id
  ORDER BY v.option_id;

  INSERT INTO public.audit_log (
    organization_id, venue_id, actor_user_id, actor_type, action,
    entity_table, entity_id, request_id, before, after, metadata
  ) VALUES (
    v_product.catalog_owner_organization_id, v_product.venue_id, p_actor_user_id, 'user',
    CASE WHEN p_variant_id IS NULL THEN 'commerce.variant.created' ELSE 'commerce.variant.updated' END,
    'product_variants', v_variant.id::TEXT, gen_random_uuid()::TEXT,
    NULL, to_jsonb(v_variant), jsonb_build_object('option_value_ids', p_option_value_ids)
  );
  RETURN v_variant;
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_r2a_receive_inventory(
  p_variant_id UUID,
  p_location_id UUID,
  p_quantity INTEGER,
  p_reason TEXT,
  p_reference TEXT,
  p_idempotency_key TEXT,
  p_actor_user_id UUID
) RETURNS TABLE(on_hand INTEGER, reserved INTEGER, allocated INTEGER, available_to_sell INTEGER, version INTEGER, replayed BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_location public.inventory_locations%ROWTYPE;
  v_variant public.product_variants%ROWTYPE;
  v_command public.inventory_commands%ROWTYPE;
  v_level public.inventory_levels%ROWTYPE;
  v_request JSONB;
BEGIN
  IF p_quantity <= 0 THEN RAISE EXCEPTION 'receive_quantity_must_be_positive'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL OR NULLIF(btrim(p_reference), '') IS NULL THEN
    RAISE EXCEPTION 'receive_reason_and_reference_required';
  END IF;
  SELECT * INTO v_location FROM public.inventory_locations WHERE id = p_location_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'inventory_location_not_available'; END IF;
  PERFORM public.commerce_r2a_assert_staff(p_actor_user_id, v_location.venue_id);
  SELECT * INTO v_variant FROM public.product_variants WHERE id = p_variant_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'variant_not_available'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.franchisees f
    WHERE f.id = v_location.inventory_owner_franchisee_id
      AND f.organization_id = v_variant.catalog_owner_organization_id
  ) THEN RAISE EXCEPTION 'inventory_owner_catalog_mismatch'; END IF;

  v_request := jsonb_build_object('quantity', p_quantity, 'reason', btrim(p_reason), 'reference', btrim(p_reference));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_location.inventory_owner_franchisee_id::TEXT || ':' || p_idempotency_key, 0
  ));
  SELECT * INTO v_command FROM public.inventory_commands
  WHERE seller_franchisee_id = v_location.inventory_owner_franchisee_id
    AND idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_command.command_type <> 'receive' OR v_command.variant_id <> p_variant_id
      OR v_command.location_id <> p_location_id OR v_command.request <> v_request
      OR v_command.actor_user_id <> p_actor_user_id THEN
      RAISE EXCEPTION 'idempotency_key_reused_with_different_request';
    END IF;
    RETURN QUERY SELECT
      (v_command.result->>'on_hand')::INTEGER, (v_command.result->>'reserved')::INTEGER,
      (v_command.result->>'allocated')::INTEGER, (v_command.result->>'available_to_sell')::INTEGER,
      (v_command.result->>'version')::INTEGER, true;
    RETURN;
  END IF;

  INSERT INTO public.inventory_commands (
    command_type, idempotency_key, venue_id, seller_franchisee_id, variant_id,
    location_id, actor_user_id, request
  ) VALUES (
    'receive', p_idempotency_key, v_location.venue_id, v_location.inventory_owner_franchisee_id,
    p_variant_id, p_location_id, p_actor_user_id, v_request
  ) RETURNING * INTO v_command;

  INSERT INTO public.inventory_levels (variant_id, location_id)
  VALUES (p_variant_id, p_location_id)
  ON CONFLICT (variant_id, location_id) DO NOTHING;
  SELECT * INTO v_level FROM public.inventory_levels
  WHERE variant_id = p_variant_id AND location_id = p_location_id FOR UPDATE;
  UPDATE public.inventory_levels SET on_hand = inventory_levels.on_hand + p_quantity, version = inventory_levels.version + 1
  WHERE id = v_level.id RETURNING * INTO v_level;
  INSERT INTO public.inventory_movements (
    variant_id, location_id, movement_type, on_hand_delta, source_effect_key,
    source_entity_type, source_entity_id, command_id, actor_user_id, reason, metadata
  ) VALUES (
    p_variant_id, p_location_id, 'receive', p_quantity, 'inventory-command:' || v_command.id,
    'inventory_command', v_command.id::TEXT, v_command.id, p_actor_user_id, btrim(p_reason),
    jsonb_build_object('reference', btrim(p_reference))
  );
  UPDATE public.inventory_commands SET result = jsonb_build_object(
    'on_hand', v_level.on_hand, 'reserved', v_level.reserved, 'allocated', v_level.allocated,
    'available_to_sell', v_level.on_hand - v_level.reserved - v_level.allocated, 'version', v_level.version
  ) WHERE id = v_command.id RETURNING * INTO v_command;
  INSERT INTO public.audit_log (
    organization_id, venue_id, actor_user_id, actor_type, action, entity_table,
    entity_id, request_id, before, after, metadata
  ) VALUES (
    v_variant.catalog_owner_organization_id, v_location.venue_id, p_actor_user_id, 'user',
    'commerce.inventory.received', 'inventory_levels', v_level.id::TEXT, p_idempotency_key,
    jsonb_build_object('on_hand', v_level.on_hand - p_quantity), to_jsonb(v_level), v_request
  );
  RETURN QUERY SELECT v_level.on_hand, v_level.reserved, v_level.allocated,
    v_level.on_hand - v_level.reserved - v_level.allocated, v_level.version, false;
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_r2a_correct_inventory(
  p_variant_id UUID,
  p_location_id UUID,
  p_physical_on_hand INTEGER,
  p_expected_version INTEGER,
  p_allow_shortage BOOLEAN,
  p_reason TEXT,
  p_idempotency_key TEXT,
  p_actor_user_id UUID
) RETURNS TABLE(on_hand INTEGER, reserved INTEGER, allocated INTEGER, available_to_sell INTEGER, version INTEGER, incident_id UUID, replayed BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_location public.inventory_locations%ROWTYPE;
  v_variant public.product_variants%ROWTYPE;
  v_command public.inventory_commands%ROWTYPE;
  v_level public.inventory_levels%ROWTYPE;
  v_delta INTEGER;
  v_deficit INTEGER;
  v_ops_id UUID;
  v_incident_id UUID;
  v_request JSONB;
BEGIN
  IF p_physical_on_hand < 0 THEN RAISE EXCEPTION 'physical_on_hand_cannot_be_negative'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'correction_reason_required'; END IF;
  SELECT * INTO v_location FROM public.inventory_locations WHERE id = p_location_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'inventory_location_not_found'; END IF;
  PERFORM public.commerce_r2a_assert_staff(p_actor_user_id, v_location.venue_id);
  SELECT * INTO v_variant FROM public.product_variants WHERE id = p_variant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'variant_not_found'; END IF;
  v_request := jsonb_build_object('physical_on_hand', p_physical_on_hand, 'expected_version', p_expected_version,
    'allow_shortage', p_allow_shortage, 'reason', btrim(p_reason));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_location.inventory_owner_franchisee_id::TEXT || ':' || p_idempotency_key, 0
  ));
  SELECT * INTO v_command FROM public.inventory_commands
  WHERE seller_franchisee_id = v_location.inventory_owner_franchisee_id AND idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_command.command_type <> 'correct' OR v_command.variant_id <> p_variant_id
      OR v_command.location_id <> p_location_id OR v_command.request <> v_request
      OR v_command.actor_user_id <> p_actor_user_id THEN
      RAISE EXCEPTION 'idempotency_key_reused_with_different_request';
    END IF;
    RETURN QUERY SELECT
      (v_command.result->>'on_hand')::INTEGER, (v_command.result->>'reserved')::INTEGER,
      (v_command.result->>'allocated')::INTEGER, (v_command.result->>'available_to_sell')::INTEGER,
      (v_command.result->>'version')::INTEGER, NULLIF(v_command.result->>'incident_id', '')::UUID, true;
    RETURN;
  END IF;
  SELECT * INTO v_level FROM public.inventory_levels
  WHERE variant_id = p_variant_id AND location_id = p_location_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'inventory_not_configured'; END IF;
  IF v_level.version <> p_expected_version THEN RAISE EXCEPTION 'stale_inventory_version'; END IF;
  v_deficit := GREATEST(v_level.reserved + v_level.allocated - p_physical_on_hand, 0);
  IF v_deficit > 0 AND NOT p_allow_shortage THEN RAISE EXCEPTION 'correction_would_create_shortage'; END IF;
  v_delta := p_physical_on_hand - v_level.on_hand;
  IF v_delta = 0 THEN RAISE EXCEPTION 'correction_has_no_effect'; END IF;

  INSERT INTO public.inventory_commands (
    command_type, idempotency_key, venue_id, seller_franchisee_id, variant_id,
    location_id, actor_user_id, request
  ) VALUES (
    'correct', p_idempotency_key, v_location.venue_id, v_location.inventory_owner_franchisee_id,
    p_variant_id, p_location_id, p_actor_user_id, v_request
  ) RETURNING * INTO v_command;
  UPDATE public.inventory_levels SET
    on_hand = p_physical_on_hand, version = inventory_levels.version + 1,
    incident_blocked = (v_deficit > 0)
  WHERE id = v_level.id RETURNING * INTO v_level;
  INSERT INTO public.inventory_movements (
    variant_id, location_id, movement_type, on_hand_delta, source_effect_key,
    source_entity_type, source_entity_id, command_id, actor_user_id, reason, metadata
  ) VALUES (
    p_variant_id, p_location_id, 'correction', v_delta, 'inventory-command:' || v_command.id,
    'inventory_command', v_command.id::TEXT, v_command.id, p_actor_user_id, btrim(p_reason),
    jsonb_build_object('physical_count', p_physical_on_hand, 'expected_version', p_expected_version, 'deficit', v_deficit)
  );
  IF v_deficit > 0 THEN
    INSERT INTO public.ops_incidents (
      venue_id, severity, title, status, affected_route, affected_ids, impact,
      containment, metadata, created_by, updated_by
    ) VALUES (
      v_location.venue_id, 'P1', 'Blockerande lagersaldo för ' || v_variant.sku, 'open',
      '/admin', v_level.id::TEXT, 'Tillgängligt saldo är negativt med ' || v_deficit || ' enheter.',
      'Nya reservationer och vanlig uthämtning är blockerade tills fysisk avstämning är klar.',
      jsonb_build_object('inventory_level_id', v_level.id, 'variant_id', p_variant_id, 'location_id', p_location_id, 'deficit', v_deficit),
      p_actor_user_id, p_actor_user_id
    ) RETURNING id INTO v_ops_id;
    INSERT INTO public.inventory_incidents (
      inventory_level_id, ops_incident_id, incident_type, deficit_quantity
    ) VALUES (v_level.id, v_ops_id, 'physical_shortage', v_deficit)
    RETURNING id INTO v_incident_id;
  END IF;
  UPDATE public.inventory_commands SET result = jsonb_build_object(
    'on_hand', v_level.on_hand, 'reserved', v_level.reserved, 'allocated', v_level.allocated,
    'available_to_sell', v_level.on_hand - v_level.reserved - v_level.allocated,
    'version', v_level.version, 'incident_id', v_incident_id
  ) WHERE id = v_command.id RETURNING * INTO v_command;
  INSERT INTO public.audit_log (
    organization_id, venue_id, actor_user_id, actor_type, action, entity_table,
    entity_id, request_id, before, after, metadata
  ) VALUES (
    v_variant.catalog_owner_organization_id, v_location.venue_id, p_actor_user_id, 'user',
    'commerce.inventory.corrected', 'inventory_levels', v_level.id::TEXT, p_idempotency_key,
    jsonb_build_object('on_hand', v_level.on_hand - v_delta, 'version', p_expected_version), to_jsonb(v_level), v_request
  );
  RETURN QUERY SELECT v_level.on_hand, v_level.reserved, v_level.allocated,
    v_level.on_hand - v_level.reserved - v_level.allocated, v_level.version, v_incident_id, false;
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_r2a_resolve_inventory_incident(
  p_incident_id UUID,
  p_evidence JSONB,
  p_idempotency_key TEXT,
  p_actor_user_id UUID
) RETURNS public.inventory_incidents
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_incident public.inventory_incidents%ROWTYPE;
  v_level public.inventory_levels%ROWTYPE;
  v_location public.inventory_locations%ROWTYPE;
  v_movement_on_hand INTEGER;
  v_movement_reserved INTEGER;
  v_movement_allocated INTEGER;
BEGIN
  SELECT * INTO v_incident FROM public.inventory_incidents WHERE id = p_incident_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'inventory_incident_not_found'; END IF;
  SELECT * INTO v_level FROM public.inventory_levels WHERE id = v_incident.inventory_level_id FOR UPDATE;
  SELECT * INTO v_location FROM public.inventory_locations WHERE id = v_level.location_id;
  PERFORM public.commerce_r2a_assert_staff(p_actor_user_id, v_location.venue_id);
  IF v_incident.status = 'resolved' THEN RETURN v_incident; END IF;
  IF v_level.on_hand - v_level.reserved - v_level.allocated < 0 THEN
    RAISE EXCEPTION 'inventory_incident_deficit_remains';
  END IF;
  SELECT
    COALESCE(sum(on_hand_delta), 0)::INTEGER,
    COALESCE(sum(reserved_delta), 0)::INTEGER,
    COALESCE(sum(allocated_delta), 0)::INTEGER
  INTO v_movement_on_hand, v_movement_reserved, v_movement_allocated
  FROM public.inventory_movements
  WHERE variant_id = v_level.variant_id AND location_id = v_level.location_id;
  IF v_level.on_hand <> v_movement_on_hand
    OR v_level.reserved <> v_movement_reserved
    OR v_level.allocated <> v_movement_allocated THEN
    RAISE EXCEPTION 'inventory_reconciliation_mismatch_remains';
  END IF;
  UPDATE public.inventory_incidents SET status = 'resolved', blocking = false,
    resolved_at = now(), resolution_evidence = COALESCE(p_evidence, '{}'::JSONB)
  WHERE id = p_incident_id RETURNING * INTO v_incident;
  UPDATE public.inventory_levels SET incident_blocked = false WHERE id = v_level.id;
  UPDATE public.ops_incidents SET status = 'resolved', resolved_at = now(), updated_by = p_actor_user_id,
    verification = COALESCE(p_evidence, '{}'::JSONB)::TEXT
  WHERE id = v_incident.ops_incident_id;
  INSERT INTO public.audit_log (
    venue_id, actor_user_id, actor_type, action, entity_table, entity_id,
    request_id, before, after, metadata
  ) VALUES (
    v_location.venue_id, p_actor_user_id, 'user', 'commerce.inventory.incident_resolved',
    'inventory_incidents', p_incident_id::TEXT, p_idempotency_key,
    jsonb_build_object('status', 'open'), to_jsonb(v_incident), COALESCE(p_evidence, '{}'::JSONB)
  );
  RETURN v_incident;
END;
$$;

-- Extend cart replacement without changing the function signature used by deployed clients.
CREATE OR REPLACE FUNCTION public.replace_commerce_cart_lines(
  p_order_id UUID,
  p_expected_version INTEGER,
  p_lines JSONB,
  p_guest_name TEXT DEFAULT NULL,
  p_guest_email TEXT DEFAULT NULL,
  p_guest_phone TEXT DEFAULT NULL
) RETURNS TABLE(order_id UUID, version INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_order public.commerce_orders%ROWTYPE;
  v_item JSONB;
  v_is_empty BOOLEAN;
BEGIN
  SELECT * INTO v_order FROM public.commerce_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'commerce_order_not_found'; END IF;
  IF v_order.status <> 'draft' THEN RAISE EXCEPTION 'commerce_order_not_draft'; END IF;
  IF v_order.version <> p_expected_version THEN RAISE EXCEPTION 'stale_cart_version'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.commerce_checkout_attempts
    WHERE commerce_order_id = p_order_id
      AND status IN ('prepared', 'provider_creation_unresolved', 'open', 'payment_processing', 'attention')
  ) THEN RAISE EXCEPTION 'commerce_order_has_unresolved_checkout_attempt'; END IF;
  IF jsonb_typeof(p_lines) <> 'array' THEN RAISE EXCEPTION 'commerce_order_lines_invalid'; END IF;
  v_is_empty := jsonb_array_length(p_lines) = 0;
  IF v_is_empty AND v_order.draft_scope IS DISTINCT FROM 'shop' THEN RAISE EXCEPTION 'commerce_order_empty'; END IF;

  DELETE FROM public.commerce_order_lines WHERE commerce_order_id = p_order_id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    INSERT INTO public.commerce_order_lines (
      id, commerce_order_id, product_id, product_key, product_name, commerce_kind,
      quantity, unit_price_minor, discount_minor, line_total_inc_vat_minor,
      vat_rate, vat_amount_minor, line_total_ex_vat_minor, source_type, source_id,
      fulfillment_type, fulfillment_status, activity_session_id, session_date,
      beneficiary_customer_id, beneficiary_user_id, parent_line_id,
      product_snapshot, metadata, sort_order, variant_id, sku, inventory_policy,
      pickup_location_id, variant_snapshot
    ) VALUES (
      (v_item->>'id')::UUID, p_order_id, (v_item->>'product_id')::UUID,
      v_item->>'product_key', v_item->>'product_name', v_item->>'commerce_kind',
      GREATEST(COALESCE((v_item->>'quantity')::INTEGER, 1), 1), 0, 0, 0,
      COALESCE((v_item->>'vat_rate')::NUMERIC, 0), 0, 0,
      v_item->>'source_type', NULLIF(v_item->>'source_id', ''),
      v_item->>'fulfillment_type', 'not_required',
      NULLIF(v_item->>'activity_session_id', '')::UUID,
      NULLIF(v_item->>'session_date', '')::DATE,
      NULLIF(v_item->>'beneficiary_customer_id', '')::UUID,
      NULLIF(v_item->>'beneficiary_user_id', '')::UUID,
      NULLIF(v_item->>'parent_line_id', '')::UUID,
      COALESCE(v_item->'product_snapshot', '{}'::JSONB),
      COALESCE(v_item->'metadata', '{}'::JSONB),
      COALESCE((v_item->>'sort_order')::INTEGER, 0),
      NULLIF(v_item->>'variant_id', '')::UUID,
      NULLIF(v_item->>'sku', ''),
      COALESCE(NULLIF(v_item->>'inventory_policy', ''), 'stockless'),
      NULLIF(v_item->>'pickup_location_id', '')::UUID,
      COALESCE(v_item->'variant_snapshot', '{}'::JSONB)
    );
  END LOOP;
  UPDATE public.commerce_orders SET
    version = commerce_orders.version + 1,
    guest_name = COALESCE(NULLIF(btrim(p_guest_name), ''), guest_name),
    guest_email = COALESCE(NULLIF(lower(btrim(p_guest_email)), ''), guest_email),
    guest_phone = COALESCE(NULLIF(btrim(p_guest_phone), ''), guest_phone),
    subtotal_minor = CASE WHEN v_is_empty THEN 0 ELSE subtotal_minor END,
    discount_minor = CASE WHEN v_is_empty THEN 0 ELSE discount_minor END,
    total_inc_vat_minor = CASE WHEN v_is_empty THEN 0 ELSE total_inc_vat_minor END,
    total_ex_vat_minor = CASE WHEN v_is_empty THEN 0 ELSE total_ex_vat_minor END,
    vat_amount_minor = CASE WHEN v_is_empty THEN 0 ELSE vat_amount_minor END,
    seller_franchisee_id = CASE WHEN v_is_empty THEN NULL ELSE seller_franchisee_id END,
    pickup_location_id = CASE WHEN v_is_empty THEN NULL ELSE pickup_location_id END
  WHERE id = p_order_id RETURNING id, commerce_orders.version INTO order_id, version;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_r2a_prepare_checkout(
  p_attempt_id UUID,
  p_order_id UUID,
  p_expected_version INTEGER,
  p_lines JSONB,
  p_seller_franchisee_id UUID,
  p_pickup_location_id UUID,
  p_provider_environment TEXT,
  p_provider_account_key TEXT,
  p_provider_idempotency_key TEXT,
  p_provider_request JSONB,
  p_expires_at TIMESTAMPTZ
) RETURNS TABLE(
  attempt_id UUID, order_id UUID, version INTEGER, total_inc_vat_minor INTEGER,
  currency TEXT, status TEXT, provider_idempotency_key TEXT,
  provider_request JSONB, provider_session_id TEXT, replayed BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_order public.commerce_orders%ROWTYPE;
  v_frozen RECORD;
  v_attempt public.commerce_checkout_attempts%ROWTYPE;
  v_tracked_count INTEGER;
  v_demand RECORD;
  v_level public.inventory_levels%ROWTYPE;
  v_reservation_id UUID;
  v_seller public.franchisees%ROWTYPE;
  v_location public.inventory_locations%ROWTYPE;
  v_line_input JSONB;
BEGIN
  SELECT * INTO v_order FROM public.commerce_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'commerce_order_not_found'; END IF;
  SELECT * INTO v_attempt FROM public.commerce_checkout_attempts attempt
  WHERE attempt.commerce_order_id = p_order_id
    AND attempt.status IN ('prepared', 'provider_creation_unresolved', 'open', 'payment_processing', 'attention')
  FOR UPDATE;
  IF FOUND THEN
    IF v_attempt.checked_order_version <> p_expected_version THEN RAISE EXCEPTION 'stale_cart_version'; END IF;
    RETURN QUERY SELECT v_attempt.id, p_order_id, v_attempt.frozen_order_version,
      v_attempt.total_inc_vat_minor, v_attempt.currency, v_attempt.status,
      v_attempt.provider_idempotency_key, v_attempt.provider_request,
      v_attempt.provider_session_id, true;
    RETURN;
  END IF;
  IF v_order.status <> 'draft' OR v_order.version <> p_expected_version THEN RAISE EXCEPTION 'stale_cart_version'; END IF;
  IF p_provider_environment NOT IN ('test', 'live') THEN RAISE EXCEPTION 'invalid_provider_environment'; END IF;
  IF p_expires_at < now() + interval '30 minutes' OR p_expires_at > now() + interval '24 hours' THEN
    RAISE EXCEPTION 'invalid_checkout_expiry';
  END IF;
  SELECT * INTO v_seller FROM public.franchisees seller
  WHERE seller.id = p_seller_franchisee_id AND seller.status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'seller_not_available'; END IF;
  SELECT * INTO v_location FROM public.inventory_locations location
  WHERE location.id = p_pickup_location_id AND location.status = 'active' FOR SHARE;
  IF NOT FOUND OR v_location.inventory_owner_franchisee_id <> p_seller_franchisee_id
    OR v_location.venue_id <> v_order.venue_id THEN RAISE EXCEPTION 'pickup_location_seller_mismatch'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venues WHERE id = v_order.venue_id AND tracked_merch_sales_enabled) THEN
    RAISE EXCEPTION 'tracked_merch_sales_disabled';
  END IF;

  SELECT count(*) INTO v_tracked_count FROM public.commerce_order_lines
  WHERE commerce_order_id = p_order_id AND inventory_policy = 'tracked';
  IF v_tracked_count = 0 THEN RAISE EXCEPTION 'tracked_checkout_has_no_tracked_lines'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.commerce_order_lines
    WHERE commerce_order_id = p_order_id AND inventory_policy = 'tracked'
      AND (parent_line_id IS NOT NULL OR source_type = 'activity_addon' OR activity_session_id IS NOT NULL)
  ) THEN RAISE EXCEPTION 'tracked_activity_addon_unsupported'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.commerce_order_lines l
    JOIN public.access_products p ON p.id = l.product_id
    JOIN public.product_variants v ON v.id = l.variant_id AND v.product_id = p.id
    LEFT JOIN public.product_venue_listings listing
      ON listing.product_id = p.id AND listing.venue_id = v_order.venue_id
    WHERE l.commerce_order_id = p_order_id AND l.inventory_policy = 'tracked'
      AND (
        p.inventory_policy <> 'tracked' OR p.activity_addon_enabled OR NOT p.standalone_enabled
        OR p.commerce_kind <> 'merchandise' OR p.fulfillment_type <> 'desk_pickup'
        OR v.status <> 'active' OR l.pickup_location_id <> p_pickup_location_id
        OR listing.id IS NULL OR listing.status <> 'active' OR NOT listing.tracked_sales_enabled
        OR listing.seller_franchisee_id <> p_seller_franchisee_id
        OR listing.default_inventory_location_id <> p_pickup_location_id
        OR listing.currency <> v_order.currency
      )
  ) THEN RAISE EXCEPTION 'tracked_listing_variant_or_location_invalid'; END IF;

  FOR v_line_input IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    UPDATE public.commerce_order_lines SET
      variant_id = NULLIF(v_line_input->>'variant_id', '')::UUID,
      sku = NULLIF(v_line_input->>'sku', ''),
      inventory_policy = COALESCE(NULLIF(v_line_input->>'inventory_policy', ''), 'stockless'),
      pickup_location_id = NULLIF(v_line_input->>'pickup_location_id', '')::UUID,
      variant_snapshot = COALESCE(v_line_input->'variant_snapshot', '{}'::JSONB)
    WHERE id = (v_line_input->>'id')::UUID AND commerce_order_id = p_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'commerce_order_line_not_found'; END IF;
  END LOOP;
  SELECT * INTO v_frozen FROM public.freeze_commerce_order(p_order_id, p_expected_version, p_lines);
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lines) line
    WHERE COALESCE(line->>'inventory_policy', 'stockless') = 'tracked'
      AND COALESCE((line->>'unit_price_minor')::INTEGER, 0) <= 0
  ) THEN
    RAISE EXCEPTION 'free_tracked_checkout_unsupported';
  END IF;
  IF v_frozen.total_inc_vat_minor <= 0 THEN RAISE EXCEPTION 'tracked_checkout_must_be_payable'; END IF;
  INSERT INTO public.commerce_checkout_attempts (
    id, commerce_order_id, checked_order_version, frozen_order_version,
    seller_franchisee_id, pickup_location_id, currency, total_inc_vat_minor, total_vat_minor,
    provider_environment, provider_account_key, provider_idempotency_key, provider_request,
    expires_at, recovery_after
  ) VALUES (
    p_attempt_id, p_order_id, p_expected_version, v_frozen.version, p_seller_franchisee_id,
    p_pickup_location_id, v_frozen.currency, v_frozen.total_inc_vat_minor,
    (SELECT vat_amount_minor FROM public.commerce_orders WHERE id = p_order_id),
    p_provider_environment, p_provider_account_key, p_provider_idempotency_key,
    p_provider_request, p_expires_at, now() + interval '2 minutes'
  ) RETURNING * INTO v_attempt;

  INSERT INTO public.commerce_checkout_attempt_lines (
    checkout_attempt_id, commerce_order_line_id, product_id, variant_id, pickup_location_id,
    quantity, unit_price_minor, discount_minor, total_inc_vat_minor, vat_rate,
    vat_amount_minor, inventory_policy, product_snapshot, variant_snapshot
  )
  SELECT v_attempt.id, line.id, line.product_id, line.variant_id, line.pickup_location_id,
    line.quantity, line.unit_price_minor, line.discount_minor, line.line_total_inc_vat_minor, line.vat_rate,
    line.vat_amount_minor, line.inventory_policy, line.product_snapshot, line.variant_snapshot
  FROM public.commerce_order_lines line
  WHERE line.commerce_order_id = p_order_id ORDER BY line.id;

  FOR v_demand IN
    SELECT line.variant_id, line.pickup_location_id AS location_id, sum(line.quantity)::INTEGER AS quantity
    FROM public.commerce_order_lines line
    WHERE line.commerce_order_id = p_order_id AND line.inventory_policy = 'tracked'
    GROUP BY line.variant_id, line.pickup_location_id ORDER BY line.pickup_location_id, line.variant_id
  LOOP
    SELECT * INTO v_level FROM public.inventory_levels
    WHERE variant_id = v_demand.variant_id AND location_id = v_demand.location_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'inventory_not_configured'; END IF;
    IF v_level.incident_blocked THEN RAISE EXCEPTION 'inventory_incident_blocked'; END IF;
    IF v_level.on_hand - v_level.reserved - v_level.allocated < v_demand.quantity THEN
      RAISE EXCEPTION 'sold_out';
    END IF;
    INSERT INTO public.inventory_reservations (
      checkout_attempt_id, variant_id, location_id, quantity
    ) VALUES (v_attempt.id, v_demand.variant_id, v_demand.location_id, v_demand.quantity)
    RETURNING id INTO v_reservation_id;
    UPDATE public.inventory_levels SET reserved = inventory_levels.reserved + v_demand.quantity,
      version = inventory_levels.version + 1
    WHERE id = v_level.id;
    INSERT INTO public.inventory_movements (
      variant_id, location_id, movement_type, reserved_delta, source_effect_key,
      source_entity_type, source_entity_id, order_id, system_principal, reason,
      metadata
    ) VALUES (
      v_demand.variant_id, v_demand.location_id, 'reserve', v_demand.quantity,
      'reservation:create:' || v_reservation_id, 'inventory_reservation', v_reservation_id::TEXT,
      p_order_id, 'commerce_checkout', 'Checkout reservation',
      jsonb_build_object('checkout_attempt_id', v_attempt.id)
    );
  END LOOP;

  UPDATE public.commerce_orders SET
    seller_franchisee_id = p_seller_franchisee_id,
    pickup_location_id = p_pickup_location_id,
    checkout_attempt_id = v_attempt.id,
    seller_snapshot = jsonb_build_object(
      'franchisee_id', v_seller.id, 'legal_name', v_seller.legal_name,
      'org_number', v_seller.org_number, 'currency', v_seller.payout_currency,
      'stripe_account_id', v_seller.stripe_account_id
    )
  WHERE id = p_order_id;
  RETURN QUERY SELECT v_attempt.id, p_order_id, v_frozen.version,
    v_frozen.total_inc_vat_minor, v_frozen.currency, v_attempt.status,
    v_attempt.provider_idempotency_key, v_attempt.provider_request,
    v_attempt.provider_session_id, false;
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_r2a_attach_checkout_session(
  p_attempt_id UUID,
  p_provider_session_id TEXT,
  p_provider_response JSONB
) RETURNS public.commerce_checkout_attempts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_attempt public.commerce_checkout_attempts%ROWTYPE;
BEGIN
  SELECT * INTO v_attempt FROM public.commerce_checkout_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'checkout_attempt_not_found'; END IF;
  IF v_attempt.status IN ('payment_committed', 'closed_unpaid') THEN RETURN v_attempt; END IF;
  IF v_attempt.provider_session_id IS NOT NULL AND v_attempt.provider_session_id <> p_provider_session_id THEN
    RAISE EXCEPTION 'checkout_attempt_session_mismatch';
  END IF;
  UPDATE public.commerce_checkout_attempts SET
    provider_session_id = p_provider_session_id,
    provider_response = COALESCE(p_provider_response, '{}'::JSONB),
    status = 'open', last_error = NULL, last_reconciled_at = now(), recovery_after = now() + interval '5 minutes'
  WHERE id = p_attempt_id RETURNING * INTO v_attempt;
  UPDATE public.commerce_orders SET stripe_session_id = p_provider_session_id
  WHERE id = v_attempt.commerce_order_id
    AND status IN ('checkout_pending', 'paid', 'attention')
    AND (stripe_session_id IS NULL OR stripe_session_id = p_provider_session_id);
  RETURN v_attempt;
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_r2a_mark_provider_unresolved(
  p_attempt_id UUID,
  p_error TEXT
) RETURNS public.commerce_checkout_attempts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_attempt public.commerce_checkout_attempts%ROWTYPE;
BEGIN
  UPDATE public.commerce_checkout_attempts SET
    status = CASE WHEN status = 'prepared' THEN 'provider_creation_unresolved' ELSE status END,
    last_error = left(p_error, 1000), recovery_after = now() + interval '1 minute'
  WHERE id = p_attempt_id
    AND status IN ('prepared', 'provider_creation_unresolved', 'open', 'payment_processing', 'attention')
  RETURNING * INTO v_attempt;
  IF NOT FOUND THEN
    SELECT * INTO v_attempt FROM public.commerce_checkout_attempts WHERE id = p_attempt_id;
  END IF;
  RETURN v_attempt;
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_r2a_close_unpaid_attempt(
  p_attempt_id UUID,
  p_provider_session_id TEXT,
  p_provider_status TEXT,
  p_reason TEXT
) RETURNS public.commerce_checkout_attempts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_attempt public.commerce_checkout_attempts%ROWTYPE;
  v_reservation public.inventory_reservations%ROWTYPE;
  v_level public.inventory_levels%ROWTYPE;
BEGIN
  IF p_provider_status NOT IN ('expired', 'canceled', 'creation_failed') THEN
    RAISE EXCEPTION 'provider_state_not_authoritative_unpaid';
  END IF;
  SELECT * INTO v_attempt FROM public.commerce_checkout_attempts WHERE id = p_attempt_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'checkout_attempt_not_found'; END IF;
  PERFORM 1 FROM public.commerce_orders WHERE id = v_attempt.commerce_order_id FOR UPDATE;
  SELECT * INTO v_attempt FROM public.commerce_checkout_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF v_attempt.status = 'payment_committed' THEN RAISE EXCEPTION 'paid_attempt_cannot_close_unpaid'; END IF;
  IF v_attempt.status = 'closed_unpaid' THEN RETURN v_attempt; END IF;
  IF p_provider_status <> 'creation_failed' AND (
    v_attempt.provider_session_id IS NULL OR v_attempt.provider_session_id <> p_provider_session_id
  ) THEN RAISE EXCEPTION 'checkout_attempt_session_mismatch'; END IF;
  IF p_provider_status = 'creation_failed' AND v_attempt.provider_session_id IS NOT NULL THEN
    RAISE EXCEPTION 'creation_failure_not_conclusive';
  END IF;
  FOR v_reservation IN SELECT * FROM public.inventory_reservations
    WHERE checkout_attempt_id = p_attempt_id AND status = 'active'
    ORDER BY location_id, variant_id FOR UPDATE
  LOOP
    SELECT * INTO v_level FROM public.inventory_levels
    WHERE variant_id = v_reservation.variant_id AND location_id = v_reservation.location_id FOR UPDATE;
    IF NOT FOUND OR v_level.reserved < v_reservation.quantity THEN RAISE EXCEPTION 'reservation_balance_mismatch'; END IF;
    UPDATE public.inventory_levels SET reserved = reserved - v_reservation.quantity, version = version + 1
    WHERE id = v_level.id;
    UPDATE public.inventory_reservations SET status = 'released', released_at = now(), release_reason = p_reason
    WHERE id = v_reservation.id;
    INSERT INTO public.inventory_movements (
      variant_id, location_id, movement_type, reserved_delta, source_effect_key,
      source_entity_type, source_entity_id, order_id, system_principal, reason, metadata
    ) VALUES (
      v_reservation.variant_id, v_reservation.location_id, 'reservation_release', -v_reservation.quantity,
      'reservation:release:' || v_reservation.id, 'inventory_reservation', v_reservation.id::TEXT,
      v_attempt.commerce_order_id, 'commerce_recovery', p_reason,
      jsonb_build_object('checkout_attempt_id', p_attempt_id, 'provider_status', p_provider_status)
    );
  END LOOP;
  UPDATE public.commerce_checkout_attempts SET status = 'closed_unpaid', closed_at = now(),
    last_reconciled_at = now(), last_error = NULL
  WHERE id = p_attempt_id RETURNING * INTO v_attempt;
  -- Preserve the closed attempt's canonical order and immutable lines. The client
  -- will create a fresh draft cart instead of reusing this order, so a rare late
  -- paid event can be reconciled against the exact purchase truth it paid for.
  UPDATE public.commerce_orders SET status = 'cancelled',
    metadata = metadata || jsonb_build_object(
      'unpaid_checkout_closed_at', now(),
      'unpaid_checkout_close_reason', p_reason,
      'unpaid_checkout_provider_status', p_provider_status
    )
  WHERE id = v_attempt.commerce_order_id AND status = 'checkout_pending';
  RETURN v_attempt;
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_r2a_claim_recovery_attempts(
  p_limit INTEGER,
  p_lease_seconds INTEGER,
  p_lease_token UUID
) RETURNS SETOF public.commerce_checkout_attempts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT id FROM public.commerce_checkout_attempts
    WHERE status IN ('prepared', 'provider_creation_unresolved', 'open', 'payment_processing', 'attention')
      AND recovery_after <= now()
      AND (recovery_lease_expires_at IS NULL OR recovery_lease_expires_at <= now())
    ORDER BY recovery_after, created_at
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  )
  UPDATE public.commerce_checkout_attempts attempt SET
    recovery_lease_token = p_lease_token,
    recovery_lease_expires_at = now() + make_interval(secs => LEAST(GREATEST(p_lease_seconds, 15), 300)),
    recovery_attempts = attempt.recovery_attempts + 1
  FROM candidates WHERE attempt.id = candidates.id RETURNING attempt.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_r2a_finish_recovery_lease(
  p_attempt_id UUID,
  p_lease_token UUID,
  p_error TEXT,
  p_retry_after_seconds INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.commerce_checkout_attempts SET
    recovery_lease_token = NULL, recovery_lease_expires_at = NULL,
    last_reconciled_at = now(), last_error = NULLIF(left(p_error, 1000), ''),
    recovery_after = now() + make_interval(secs => LEAST(GREATEST(p_retry_after_seconds, 30), 86400))
  WHERE id = p_attempt_id AND recovery_lease_token = p_lease_token;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_r2a_claim_recovery_refunds(
  p_limit INTEGER,
  p_lease_seconds INTEGER,
  p_lease_token UUID
) RETURNS SETOF public.commerce_refunds
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT id FROM public.commerce_refunds
    WHERE status IN ('preparing', 'pending', 'attention')
      AND recovery_after <= now()
      AND (recovery_lease_expires_at IS NULL OR recovery_lease_expires_at <= now())
    ORDER BY recovery_after, created_at FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  )
  UPDATE public.commerce_refunds refund SET
    recovery_lease_token = p_lease_token,
    recovery_lease_expires_at = now() + make_interval(secs => LEAST(GREATEST(p_lease_seconds, 15), 300)),
    recovery_attempts = refund.recovery_attempts + 1
  FROM candidates WHERE refund.id = candidates.id RETURNING refund.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_r2a_finish_refund_recovery_lease(
  p_refund_id UUID,
  p_lease_token UUID,
  p_error TEXT,
  p_retry_after_seconds INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.commerce_refunds SET
    recovery_lease_token = NULL, recovery_lease_expires_at = NULL,
    last_error = NULLIF(left(p_error, 1000), ''),
    recovery_after = now() + make_interval(secs => LEAST(GREATEST(p_retry_after_seconds, 30), 86400))
  WHERE id = p_refund_id AND recovery_lease_token = p_lease_token;
  RETURN FOUND;
END;
$$;

-- The canonical payment finalizer now also commits tracked reservations.
CREATE OR REPLACE FUNCTION public.finalize_commerce_payment(
  p_order_id UUID,
  p_order_version INTEGER,
  p_stripe_session_id TEXT,
  p_payment_intent_id TEXT,
  p_customer_id UUID,
  p_user_id UUID,
  p_customer_name TEXT,
  p_customer_email TEXT,
  p_customer_phone TEXT,
  p_payment_method TEXT
) RETURNS TABLE(order_id UUID, receipt_id UUID, ledger_entry_id UUID, already_finalized BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_order public.commerce_orders%ROWTYPE;
  v_attempt public.commerce_checkout_attempts%ROWTYPE;
  v_reservation public.inventory_reservations%ROWTYPE;
  v_level public.inventory_levels%ROWTYPE;
  v_attempt_line public.commerce_checkout_attempt_lines%ROWTYPE;
  v_receipt_id UUID;
  v_ledger_id UUID;
  v_receipt_number TEXT;
  v_rate_count INTEGER;
  v_single_rate NUMERIC(5,2);
  v_vat_breakdown JSONB;
  v_inventory_attention BOOLEAN := false;
  v_ops_id UUID;
BEGIN
  SELECT * INTO v_order FROM public.commerce_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'commerce_order_not_found'; END IF;
  IF v_order.version <> p_order_version THEN RAISE EXCEPTION 'commerce_order_version_mismatch'; END IF;
  IF v_order.status IN ('paid', 'attention') AND v_order.booking_receipt_id IS NOT NULL THEN
    IF v_order.stripe_session_id IS DISTINCT FROM p_stripe_session_id
      OR v_order.stripe_payment_intent_id IS DISTINCT FROM p_payment_intent_id THEN
      RAISE EXCEPTION 'commerce_order_payment_identity_mismatch';
    END IF;
    RETURN QUERY SELECT v_order.id, v_order.booking_receipt_id, v_order.ledger_entry_id, true;
    RETURN;
  END IF;
  IF v_order.status NOT IN ('checkout_pending', 'cancelled')
    OR (v_order.status = 'cancelled' AND v_order.checkout_attempt_id IS NULL) THEN
    RAISE EXCEPTION 'commerce_order_not_payable';
  END IF;

  IF v_order.checkout_attempt_id IS NULL THEN
    IF v_order.stripe_session_id IS DISTINCT FROM p_stripe_session_id THEN
      RAISE EXCEPTION 'commerce_order_stripe_session_mismatch';
    END IF;
  ELSE
    SELECT * INTO v_attempt FROM public.commerce_checkout_attempts
    WHERE id = v_order.checkout_attempt_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'checkout_attempt_not_found'; END IF;
    IF v_order.status = 'cancelled' AND v_attempt.status <> 'closed_unpaid' THEN
      RAISE EXCEPTION 'commerce_order_not_payable';
    END IF;
    IF v_attempt.provider_session_id IS NOT NULL AND v_attempt.provider_session_id <> p_stripe_session_id THEN
      RAISE EXCEPTION 'checkout_attempt_session_mismatch';
    END IF;
    IF v_attempt.total_inc_vat_minor <> v_order.total_inc_vat_minor
      OR v_attempt.currency <> v_order.currency THEN RAISE EXCEPTION 'checkout_attempt_total_mismatch'; END IF;
    -- A verified payment may race authoritative unpaid closure. Reacquire every
    -- released reservation only when the whole immutable attempt can be honored.
    -- Validation happens before mutation and the enclosing transaction provides
    -- all-or-nothing rollback. If reacquisition is impossible, the normal loop
    -- below records paid financial truth plus explicit allocation incidents.
    IF v_attempt.status = 'closed_unpaid' THEN
      PERFORM 1
      FROM public.inventory_levels level
      JOIN public.inventory_reservations reservation
        ON reservation.variant_id = level.variant_id AND reservation.location_id = level.location_id
      WHERE reservation.checkout_attempt_id = v_attempt.id AND reservation.status = 'released'
      ORDER BY level.location_id, level.variant_id
      FOR UPDATE OF level;
      v_inventory_attention := EXISTS (
        SELECT 1
        FROM public.inventory_reservations reservation
        LEFT JOIN public.inventory_levels level
          ON level.variant_id = reservation.variant_id AND level.location_id = reservation.location_id
        WHERE reservation.checkout_attempt_id = v_attempt.id
          AND reservation.status = 'released'
          AND (
            level.id IS NULL OR level.incident_blocked
            OR level.on_hand - level.reserved - level.allocated < reservation.quantity
          )
      );
      IF NOT v_inventory_attention THEN
        FOR v_reservation IN SELECT * FROM public.inventory_reservations
          WHERE checkout_attempt_id = v_attempt.id AND status = 'released'
          ORDER BY location_id, variant_id FOR UPDATE
        LOOP
          UPDATE public.inventory_levels SET
            reserved = reserved + v_reservation.quantity,
            version = version + 1
          WHERE variant_id = v_reservation.variant_id AND location_id = v_reservation.location_id;
          UPDATE public.inventory_reservations SET
            status = 'active', released_at = NULL, release_reason = NULL
          WHERE id = v_reservation.id;
          INSERT INTO public.inventory_movements (
            variant_id, location_id, movement_type, reserved_delta, source_effect_key,
            source_entity_type, source_entity_id, order_id, system_principal, reason, metadata
          ) VALUES (
            v_reservation.variant_id, v_reservation.location_id, 'reserve', v_reservation.quantity,
            'reservation:late-reacquire:' || v_reservation.id,
            'inventory_reservation', v_reservation.id::TEXT, p_order_id,
            'stripe_webhook', 'Late paid Session reacquired released reservation',
            jsonb_build_object('checkout_attempt_id', v_attempt.id, 'payment_intent_id', p_payment_intent_id)
          ) ON CONFLICT (source_effect_key) DO NOTHING;
        END LOOP;
        UPDATE public.commerce_orders SET status = 'checkout_pending' WHERE id = p_order_id;
      END IF;
    END IF;
    UPDATE public.commerce_checkout_attempts SET
      provider_session_id = COALESCE(provider_session_id, p_stripe_session_id),
      provider_payment_intent_id = p_payment_intent_id,
      status = 'payment_processing', last_reconciled_at = now(), last_error = NULL
    WHERE id = v_attempt.id RETURNING * INTO v_attempt;
    UPDATE public.commerce_orders SET stripe_session_id = COALESCE(stripe_session_id, p_stripe_session_id)
    WHERE id = p_order_id;

    FOR v_reservation IN SELECT * FROM public.inventory_reservations
      WHERE checkout_attempt_id = v_attempt.id ORDER BY location_id, variant_id FOR UPDATE
    LOOP
      SELECT * INTO v_level FROM public.inventory_levels
      WHERE variant_id = v_reservation.variant_id AND location_id = v_reservation.location_id FOR UPDATE;
      IF v_reservation.status = 'committed' THEN CONTINUE; END IF;
      IF v_reservation.status <> 'active' OR NOT FOUND OR v_level.reserved < v_reservation.quantity THEN
        v_inventory_attention := true;
        IF FOUND THEN
          UPDATE public.inventory_levels SET incident_blocked = true WHERE id = v_level.id;
          INSERT INTO public.ops_incidents (
            venue_id, severity, title, status, affected_route, affected_ids, impact,
            containment, metadata
          ) SELECT l.venue_id, 'P0', 'Betald order saknar giltig lagerreservation', 'open',
            '/admin', p_order_id::TEXT, 'Betalning är genomförd men lagret kunde inte allokeras.',
            'Blockera ny försäljning och stäm av order/reservation innan utlämning.',
            jsonb_build_object('order_id', p_order_id, 'attempt_id', v_attempt.id, 'reservation_id', v_reservation.id)
          FROM public.inventory_locations l WHERE l.id = v_reservation.location_id RETURNING id INTO v_ops_id;
          INSERT INTO public.inventory_incidents (
            inventory_level_id, ops_incident_id, incident_type, deficit_quantity
          ) VALUES (v_level.id, v_ops_id, 'paid_without_reservation', v_reservation.quantity)
          ON CONFLICT DO NOTHING;
        END IF;
        CONTINUE;
      END IF;
      UPDATE public.inventory_levels SET reserved = reserved - v_reservation.quantity,
        allocated = allocated + v_reservation.quantity, version = version + 1
      WHERE id = v_level.id;
      UPDATE public.inventory_reservations SET status = 'committed', committed_at = now()
      WHERE id = v_reservation.id;
      INSERT INTO public.inventory_movements (
        variant_id, location_id, movement_type, reserved_delta, allocated_delta,
        source_effect_key, source_entity_type, source_entity_id, order_id,
        system_principal, reason, metadata
      ) VALUES (
        v_reservation.variant_id, v_reservation.location_id, 'payment_commit',
        -v_reservation.quantity, v_reservation.quantity,
        'reservation:commit:' || v_reservation.id, 'inventory_reservation', v_reservation.id::TEXT,
        p_order_id, 'stripe_webhook', 'Stripe payment committed',
        jsonb_build_object('checkout_attempt_id', v_attempt.id, 'payment_intent_id', p_payment_intent_id)
      ) ON CONFLICT (source_effect_key) DO NOTHING;
    END LOOP;
    FOR v_attempt_line IN SELECT * FROM public.commerce_checkout_attempt_lines
      WHERE checkout_attempt_id = v_attempt.id AND inventory_policy = 'tracked'
      ORDER BY commerce_order_line_id FOR UPDATE
    LOOP
      INSERT INTO public.inventory_allocations (
        checkout_attempt_id, reservation_id, commerce_order_id, commerce_order_line_id,
        variant_id, location_id, quantity
      ) SELECT v_attempt.id, r.id, p_order_id, v_attempt_line.commerce_order_line_id,
        v_attempt_line.variant_id, v_attempt_line.pickup_location_id, v_attempt_line.quantity
      FROM public.inventory_reservations r
      WHERE r.checkout_attempt_id = v_attempt.id
        AND r.variant_id = v_attempt_line.variant_id
        AND r.location_id = v_attempt_line.pickup_location_id
        AND r.status = 'committed'
      ON CONFLICT (checkout_attempt_id, commerce_order_line_id) DO NOTHING;
      UPDATE public.product_variants SET identity_locked_at = COALESCE(identity_locked_at, now())
      WHERE id = v_attempt_line.variant_id;
    END LOOP;
    -- A paid tracked line must always have a committed allocation. This catches
    -- missing/corrupt reservation rows as well as released or under-sized ones.
    FOR v_attempt_line IN
      SELECT line.* FROM public.commerce_checkout_attempt_lines line
      WHERE line.checkout_attempt_id = v_attempt.id
        AND line.inventory_policy = 'tracked'
        AND NOT EXISTS (
          SELECT 1 FROM public.inventory_allocations allocation
          WHERE allocation.checkout_attempt_id = v_attempt.id
            AND allocation.commerce_order_line_id = line.commerce_order_line_id
            AND allocation.quantity = line.quantity
        )
      ORDER BY line.commerce_order_line_id
    LOOP
      v_inventory_attention := true;
      SELECT * INTO v_level FROM public.inventory_levels
      WHERE variant_id = v_attempt_line.variant_id
        AND location_id = v_attempt_line.pickup_location_id FOR UPDATE;
      IF FOUND THEN
        UPDATE public.inventory_levels SET incident_blocked = true WHERE id = v_level.id;
        IF NOT EXISTS (
          SELECT 1 FROM public.inventory_incidents
          WHERE inventory_level_id = v_level.id
            AND incident_type = 'paid_without_reservation' AND status = 'open'
        ) THEN
          INSERT INTO public.ops_incidents (
            venue_id, severity, title, status, affected_route, affected_ids, impact,
            containment, metadata
          ) VALUES (
            v_order.venue_id, 'P0', 'Betald order saknar lagerallokering', 'open',
            '/admin', p_order_id::TEXT,
            'Betalning är genomförd men orderraden har ingen fullständig lagerallokering.',
            'Blockera ny försäljning och stäm av betalning, reservation och fysisk vara före utlämning.',
            jsonb_build_object(
              'order_id', p_order_id, 'attempt_id', v_attempt.id,
              'commerce_order_line_id', v_attempt_line.commerce_order_line_id,
              'variant_id', v_attempt_line.variant_id,
              'location_id', v_attempt_line.pickup_location_id
            )
          ) RETURNING id INTO v_ops_id;
          INSERT INTO public.inventory_incidents (
            inventory_level_id, ops_incident_id, incident_type, deficit_quantity
          ) VALUES (
            v_level.id, v_ops_id, 'paid_without_reservation', v_attempt_line.quantity
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  SELECT count(DISTINCT vat_rate), max(vat_rate) INTO v_rate_count, v_single_rate
  FROM public.commerce_order_lines WHERE commerce_order_id = p_order_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'vat_rate', vat_rate, 'amount_inc_vat_minor', amount_inc_vat_minor,
    'vat_amount_minor', vat_amount_minor
  ) ORDER BY vat_rate), '[]'::JSONB) INTO v_vat_breakdown
  FROM (
    SELECT vat_rate, sum(line_total_inc_vat_minor)::INTEGER AS amount_inc_vat_minor,
      sum(vat_amount_minor)::INTEGER AS vat_amount_minor
    FROM public.commerce_order_lines WHERE commerce_order_id = p_order_id GROUP BY vat_rate
  ) rates;
  INSERT INTO public.booking_receipts (
    venue_id, user_id, customer_id, customer_name, customer_email, customer_phone,
    stripe_session_id, stripe_payment_intent_id, commerce_order_id,
    purchase_type, product_description, payment_method, payment_provider, payment_status,
    total_inc_vat, total_ex_vat, vat_amount, total_inc_vat_sek, total_ex_vat_sek,
    vat_amount_sek, vat_rate, currency, metadata
  ) VALUES (
    v_order.venue_id, p_user_id, p_customer_id, p_customer_name, p_customer_email, p_customer_phone,
    p_stripe_session_id, p_payment_intent_id, p_order_id,
    'commerce_order', 'Pickla-köp', p_payment_method, 'stripe', 'paid',
    round(v_order.total_inc_vat_minor / 100.0), round(v_order.total_ex_vat_minor / 100.0),
    round(v_order.vat_amount_minor / 100.0), v_order.total_inc_vat_minor / 100.0,
    v_order.total_ex_vat_minor / 100.0, v_order.vat_amount_minor / 100.0,
    CASE WHEN v_rate_count = 1 THEN v_single_rate ELSE NULL END,
    v_order.currency, jsonb_build_object(
      'product_type', 'commerce_order', 'commerce_order_id', p_order_id,
      'vat_breakdown', v_vat_breakdown, 'seller_snapshot', v_order.seller_snapshot,
      'pickup_location_id', v_order.pickup_location_id
    )
  ) ON CONFLICT (commerce_order_id) WHERE commerce_order_id IS NOT NULL DO UPDATE
    SET commerce_order_id = EXCLUDED.commerce_order_id
  RETURNING id, receipt_number INTO v_receipt_id, v_receipt_number;
  INSERT INTO public.commerce_receipt_lines (
    booking_receipt_id, commerce_order_id, commerce_order_line_id, product_id,
    product_key, product_name, commerce_kind, quantity, unit_price_minor,
    discount_minor, total_inc_vat_minor, vat_rate, vat_amount_minor,
    total_ex_vat_minor, fulfillment_type, metadata, sort_order
  ) SELECT v_receipt_id, p_order_id, l.id, l.product_id, l.product_key, l.product_name,
    l.commerce_kind, l.quantity, l.unit_price_minor, l.discount_minor,
    l.line_total_inc_vat_minor, l.vat_rate, l.vat_amount_minor,
    l.line_total_ex_vat_minor, l.fulfillment_type,
    jsonb_build_object(
      'source_type', l.source_type, 'source_id', l.source_id,
      'activity_session_id', l.activity_session_id, 'session_date', l.session_date,
      'variant_id', l.variant_id, 'sku', l.sku, 'variant_snapshot', l.variant_snapshot,
      'pickup_location_id', l.pickup_location_id
    ), l.sort_order
  FROM public.commerce_order_lines l WHERE l.commerce_order_id = p_order_id
  ON CONFLICT (commerce_order_line_id) DO NOTHING;
  INSERT INTO public.ledger_entries (
    venue_id, customer_id, source_type, source_id, accounting_date, occurred_at,
    customer_name, amount_inc_vat_minor, vat_amount_minor, payment_status,
    payment_method, stripe_session_id, receipt_number, booking_receipt_id,
    commerce_order_id, metadata
  ) VALUES (
    v_order.venue_id, p_customer_id, 'commerce_order', p_order_id::TEXT,
    (now() AT TIME ZONE 'Europe/Stockholm')::DATE, now(), p_customer_name,
    v_order.total_inc_vat_minor, v_order.vat_amount_minor, 'paid', p_payment_method,
    p_stripe_session_id, v_receipt_number, v_receipt_id, p_order_id,
    jsonb_build_object('commerce_order_id', p_order_id, 'vat_breakdown', v_vat_breakdown,
      'seller_snapshot', v_order.seller_snapshot)
  ) ON CONFLICT (commerce_order_id)
    WHERE commerce_order_id IS NOT NULL AND source_type = 'commerce_order' DO UPDATE
    SET commerce_order_id = EXCLUDED.commerce_order_id
  RETURNING id INTO v_ledger_id;
  UPDATE public.commerce_orders SET
    status = CASE WHEN v_inventory_attention THEN 'attention' ELSE 'paid' END,
    customer_id = p_customer_id, user_id = COALESCE(p_user_id, user_id),
    guest_name = COALESCE(p_customer_name, guest_name),
    guest_email = COALESCE(lower(p_customer_email), guest_email),
    guest_phone = COALESCE(p_customer_phone, guest_phone),
    stripe_session_id = p_stripe_session_id, stripe_payment_intent_id = p_payment_intent_id,
    booking_receipt_id = v_receipt_id, ledger_entry_id = v_ledger_id, paid_at = now(),
    metadata = CASE WHEN v_inventory_attention
      THEN metadata || jsonb_build_object('attention_reason', 'paid_inventory_allocation_failed')
      ELSE metadata END
  WHERE id = p_order_id;
  IF v_order.checkout_attempt_id IS NOT NULL THEN
    UPDATE public.commerce_checkout_attempts SET
      status = CASE WHEN v_inventory_attention THEN 'attention' ELSE 'payment_committed' END,
      provider_session_id = p_stripe_session_id,
      provider_payment_intent_id = p_payment_intent_id,
      last_reconciled_at = now(), last_error = CASE WHEN v_inventory_attention THEN 'inventory_allocation_failed' ELSE NULL END
    WHERE id = v_order.checkout_attempt_id;
  END IF;
  RETURN QUERY SELECT p_order_id, v_receipt_id, v_ledger_id, false;
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_r2a_collect_pickup(
  p_order_line_id UUID,
  p_quantity INTEGER,
  p_venue_id UUID,
  p_idempotency_key TEXT,
  p_actor_user_id UUID
) RETURNS TABLE(collected_quantity INTEGER, remaining_quantity INTEGER, fulfillment_status TEXT, replayed BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_line public.commerce_order_lines%ROWTYPE;
  v_order public.commerce_orders%ROWTYPE;
  v_allocation public.inventory_allocations%ROWTYPE;
  v_level public.inventory_levels%ROWTYPE;
  v_command public.commerce_pickup_commands%ROWTYPE;
  v_remaining INTEGER;
  v_succeeded_refund_quantity INTEGER;
BEGIN
  IF p_quantity <= 0 THEN RAISE EXCEPTION 'pickup_quantity_must_be_positive'; END IF;
  PERFORM public.commerce_r2a_assert_staff(p_actor_user_id, p_venue_id);
  SELECT * INTO v_line FROM public.commerce_order_lines WHERE id = p_order_line_id;
  IF NOT FOUND OR v_line.inventory_policy <> 'tracked' THEN RAISE EXCEPTION 'tracked_pickup_line_not_found'; END IF;
  SELECT * INTO v_order FROM public.commerce_orders WHERE id = v_line.commerce_order_id FOR UPDATE;
  SELECT * INTO v_line FROM public.commerce_order_lines WHERE id = p_order_line_id FOR UPDATE;
  IF v_order.venue_id <> p_venue_id OR v_order.status NOT IN ('paid', 'attention') THEN RAISE EXCEPTION 'pickup_not_authorized'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_venue_id::TEXT || ':' || p_idempotency_key, 0));
  SELECT * INTO v_command FROM public.commerce_pickup_commands
  WHERE venue_id = p_venue_id AND idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_command.order_line_id <> p_order_line_id OR v_command.quantity <> p_quantity
      OR v_command.actor_user_id <> p_actor_user_id THEN
      RAISE EXCEPTION 'idempotency_key_reused_with_different_request';
    END IF;
    RETURN QUERY SELECT (v_command.result->>'collected_quantity')::INTEGER,
      (v_command.result->>'remaining_quantity')::INTEGER,
      v_command.result->>'fulfillment_status', true;
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.commerce_refund_lines rl
    JOIN public.commerce_refunds r ON r.id = rl.refund_id
    WHERE rl.commerce_order_line_id = p_order_line_id AND r.status IN ('preparing', 'pending', 'attention')
  ) THEN RAISE EXCEPTION 'pickup_blocked_by_pending_refund'; END IF;
  SELECT * INTO v_allocation FROM public.inventory_allocations
  WHERE commerce_order_line_id = p_order_line_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'inventory_allocation_not_found'; END IF;
  SELECT COALESCE(sum(rl.quantity), 0)::INTEGER INTO v_succeeded_refund_quantity
  FROM public.commerce_refund_lines rl
  JOIN public.commerce_refunds r ON r.id = rl.refund_id
  WHERE rl.commerce_order_line_id = p_order_line_id AND r.status = 'succeeded';
  v_remaining := v_allocation.quantity - v_allocation.collected_quantity - v_allocation.cancelled_quantity
    - GREATEST(v_succeeded_refund_quantity - v_allocation.collected_quantity, 0);
  IF p_quantity > v_remaining THEN RAISE EXCEPTION 'pickup_quantity_conflicts_with_allocation_or_refund'; END IF;
  SELECT * INTO v_level FROM public.inventory_levels
  WHERE variant_id = v_allocation.variant_id AND location_id = v_allocation.location_id FOR UPDATE;
  IF NOT FOUND OR v_level.incident_blocked THEN RAISE EXCEPTION 'inventory_incident_blocked'; END IF;
  IF v_level.on_hand < p_quantity OR v_level.allocated < p_quantity THEN RAISE EXCEPTION 'pickup_balance_mismatch'; END IF;
  INSERT INTO public.commerce_pickup_commands (
    idempotency_key, venue_id, order_line_id, allocation_id, quantity, actor_user_id
  ) VALUES (p_idempotency_key, p_venue_id, p_order_line_id, v_allocation.id, p_quantity, p_actor_user_id)
  RETURNING * INTO v_command;
  UPDATE public.inventory_levels SET on_hand = on_hand - p_quantity,
    allocated = allocated - p_quantity, version = version + 1 WHERE id = v_level.id;
  UPDATE public.inventory_allocations SET
    collected_quantity = inventory_allocations.collected_quantity + p_quantity,
    status = CASE
      WHEN inventory_allocations.collected_quantity + p_quantity
        + inventory_allocations.cancelled_quantity = inventory_allocations.quantity THEN 'collected'
      ELSE 'partially_collected' END
  WHERE id = v_allocation.id RETURNING * INTO v_allocation;
  UPDATE public.commerce_order_lines SET
    collected_quantity = commerce_order_lines.collected_quantity + p_quantity,
    fulfillment_status = CASE
      WHEN commerce_order_lines.collected_quantity + p_quantity
        + commerce_order_lines.cancelled_quantity = commerce_order_lines.quantity
        THEN 'collected' ELSE 'pending_pickup' END,
    fulfilled_at = CASE
      WHEN commerce_order_lines.collected_quantity + p_quantity
        + commerce_order_lines.cancelled_quantity = commerce_order_lines.quantity
        THEN now() ELSE NULL END,
    fulfilled_by = p_actor_user_id
  WHERE id = p_order_line_id RETURNING * INTO v_line;
  INSERT INTO public.inventory_movements (
    variant_id, location_id, movement_type, on_hand_delta, allocated_delta,
    source_effect_key, source_entity_type, source_entity_id, order_id, order_line_id,
    actor_user_id, reason, metadata
  ) VALUES (
    v_allocation.variant_id, v_allocation.location_id, 'pickup', -p_quantity, -p_quantity,
    'pickup:' || v_command.id, 'commerce_pickup_command', v_command.id::TEXT,
    v_order.id, p_order_line_id, p_actor_user_id, 'Customer pickup',
    jsonb_build_object('allocation_id', v_allocation.id)
  );
  v_remaining := v_allocation.quantity - v_allocation.collected_quantity - v_allocation.cancelled_quantity;
  UPDATE public.commerce_pickup_commands SET result = jsonb_build_object(
    'collected_quantity', v_allocation.collected_quantity,
    'remaining_quantity', v_remaining, 'fulfillment_status', v_line.fulfillment_status
  ) WHERE id = v_command.id;
  INSERT INTO public.audit_log (
    organization_id, venue_id, actor_user_id, actor_type, action,
    entity_table, entity_id, request_id, before, after, metadata
  ) VALUES (
    v_order.organization_id, p_venue_id, p_actor_user_id, 'user', 'commerce.fulfillment.quantity_collected',
    'commerce_order_lines', p_order_line_id::TEXT, p_idempotency_key,
    jsonb_build_object('collected_quantity', v_line.collected_quantity - p_quantity), to_jsonb(v_line),
    jsonb_build_object('quantity', p_quantity, 'allocation_id', v_allocation.id)
  );
  RETURN QUERY SELECT v_allocation.collected_quantity, v_remaining, v_line.fulfillment_status, false;
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_r2a_prepare_refund(
  p_order_id UUID,
  p_line_quantities JSONB,
  p_goodwill_amount_minor INTEGER,
  p_reason TEXT,
  p_provider_environment TEXT,
  p_provider_account_key TEXT,
  p_idempotency_key TEXT,
  p_actor_user_id UUID
) RETURNS public.commerce_refunds
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_order public.commerce_orders%ROWTYPE;
  v_refund public.commerce_refunds%ROWTYPE;
  v_item JSONB;
  v_line public.commerce_order_lines%ROWTYPE;
  v_quantity INTEGER;
  v_already_quantity INTEGER;
  v_line_amount INTEGER;
  v_line_vat INTEGER;
  v_total INTEGER := 0;
  v_vat INTEGER := 0;
  v_existing_total INTEGER;
  v_refund_type TEXT;
  v_refund_id UUID := gen_random_uuid();
BEGIN
  SELECT * INTO v_order FROM public.commerce_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.status NOT IN ('paid', 'attention', 'cancelled') THEN RAISE EXCEPTION 'order_not_refundable'; END IF;
  PERFORM public.commerce_r2a_assert_staff(p_actor_user_id, v_order.venue_id);
  SELECT * INTO v_refund FROM public.commerce_refunds
  WHERE commerce_order_id = p_order_id AND idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_refund.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_refund.reason <> btrim(COALESCE(p_reason, '')) THEN
      RAISE EXCEPTION 'idempotency_key_reused_with_different_request';
    END IF;
    IF p_goodwill_amount_minor IS NOT NULL THEN
      IF v_refund.refund_type <> 'goodwill' OR v_refund.amount_inc_vat_minor <> p_goodwill_amount_minor
        OR p_line_quantities IS NOT NULL THEN
        RAISE EXCEPTION 'idempotency_key_reused_with_different_request';
      END IF;
    ELSIF v_refund.refund_type <> 'quantity' OR jsonb_typeof(p_line_quantities) <> 'array'
      OR jsonb_array_length(p_line_quantities) <> (
        SELECT count(*) FROM public.commerce_refund_lines WHERE refund_id = v_refund.id
      ) OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_line_quantities) item
        WHERE NOT EXISTS (
          SELECT 1 FROM public.commerce_refund_lines line
          WHERE line.refund_id = v_refund.id
            AND line.commerce_order_line_id = (item->>'line_id')::UUID
            AND line.quantity = (item->>'quantity')::INTEGER
        )
      ) THEN
      RAISE EXCEPTION 'idempotency_key_reused_with_different_request';
    END IF;
    RETURN v_refund;
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'refund_reason_required'; END IF;
  SELECT COALESCE(sum(amount_inc_vat_minor), 0)::INTEGER INTO v_existing_total
  FROM public.commerce_refunds WHERE commerce_order_id = p_order_id AND status IN ('preparing', 'pending', 'succeeded');

  IF p_goodwill_amount_minor IS NOT NULL THEN
    IF p_goodwill_amount_minor <= 0 OR p_line_quantities IS NOT NULL THEN RAISE EXCEPTION 'invalid_goodwill_refund'; END IF;
    v_total := p_goodwill_amount_minor;
    v_vat := 0;
    v_refund_type := 'goodwill';
  ELSE
    IF jsonb_typeof(p_line_quantities) <> 'array' OR jsonb_array_length(p_line_quantities) = 0 THEN
      RAISE EXCEPTION 'refund_line_quantities_required';
    END IF;
    v_refund_type := 'quantity';
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_line_quantities)
    LOOP
      SELECT * INTO v_line FROM public.commerce_order_lines
      WHERE id = (v_item->>'line_id')::UUID AND commerce_order_id = p_order_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'refund_order_line_not_found'; END IF;
      v_quantity := COALESCE((v_item->>'quantity')::INTEGER, 0);
      IF v_quantity <= 0 THEN RAISE EXCEPTION 'refund_quantity_must_be_positive'; END IF;
      SELECT COALESCE(sum(rl.quantity), 0)::INTEGER INTO v_already_quantity
      FROM public.commerce_refund_lines rl JOIN public.commerce_refunds r ON r.id = rl.refund_id
      WHERE rl.commerce_order_line_id = v_line.id AND r.status IN ('preparing', 'pending', 'succeeded');
      IF v_already_quantity + v_quantity > v_line.quantity THEN RAISE EXCEPTION 'refund_quantity_exceeds_purchased_quantity'; END IF;
      v_line_amount := round(v_line.line_total_inc_vat_minor * (v_already_quantity + v_quantity)::NUMERIC / v_line.quantity)
        - round(v_line.line_total_inc_vat_minor * v_already_quantity::NUMERIC / v_line.quantity);
      v_line_vat := round(v_line.vat_amount_minor * (v_already_quantity + v_quantity)::NUMERIC / v_line.quantity)
        - round(v_line.vat_amount_minor * v_already_quantity::NUMERIC / v_line.quantity);
      v_total := v_total + v_line_amount;
      v_vat := v_vat + v_line_vat;
    END LOOP;
  END IF;
  IF v_total <= 0 OR v_existing_total + v_total > v_order.total_inc_vat_minor THEN
    RAISE EXCEPTION 'refund_amount_exceeds_order';
  END IF;
  INSERT INTO public.commerce_refunds (
    id, commerce_order_id, seller_franchisee_id, pickup_location_id, idempotency_key,
    refund_type, amount_inc_vat_minor, vat_amount_minor, currency,
    provider_environment, provider_account_key, provider_idempotency_key, provider_request,
    actor_user_id, reason
  ) VALUES (
    v_refund_id, p_order_id, v_order.seller_franchisee_id, v_order.pickup_location_id, p_idempotency_key,
    v_refund_type, v_total, v_vat, v_order.currency,
    p_provider_environment, p_provider_account_key, 'commerce-r2a-refund-' || v_refund_id,
    jsonb_build_object(
      'payment_intent', v_order.stripe_payment_intent_id,
      'amount', v_total,
      'reason', 'requested_by_customer',
      'metadata', jsonb_build_object('commerce_order_id', p_order_id, 'commerce_refund_id', v_refund_id)
    ),
    p_actor_user_id, btrim(p_reason)
  ) RETURNING * INTO v_refund;
  IF v_refund_type = 'quantity' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_line_quantities)
    LOOP
      SELECT * INTO v_line FROM public.commerce_order_lines
      WHERE id = (v_item->>'line_id')::UUID AND commerce_order_id = p_order_id;
      v_quantity := (v_item->>'quantity')::INTEGER;
      SELECT COALESCE(sum(rl.quantity), 0)::INTEGER INTO v_already_quantity
      FROM public.commerce_refund_lines rl JOIN public.commerce_refunds r ON r.id = rl.refund_id
      WHERE rl.commerce_order_line_id = v_line.id AND r.id <> v_refund.id
        AND r.status IN ('preparing', 'pending', 'succeeded');
      v_line_amount := round(v_line.line_total_inc_vat_minor * (v_already_quantity + v_quantity)::NUMERIC / v_line.quantity)
        - round(v_line.line_total_inc_vat_minor * v_already_quantity::NUMERIC / v_line.quantity);
      v_line_vat := round(v_line.vat_amount_minor * (v_already_quantity + v_quantity)::NUMERIC / v_line.quantity)
        - round(v_line.vat_amount_minor * v_already_quantity::NUMERIC / v_line.quantity);
      INSERT INTO public.commerce_refund_lines (
        refund_id, commerce_order_line_id, quantity, amount_inc_vat_minor, vat_amount_minor
      ) VALUES (v_refund.id, v_line.id, v_quantity, v_line_amount, v_line_vat);
    END LOOP;
  END IF;
  INSERT INTO public.audit_log (
    organization_id, venue_id, actor_user_id, actor_type, action,
    entity_table, entity_id, request_id, before, after, metadata
  ) VALUES (
    v_order.organization_id, v_order.venue_id, p_actor_user_id, 'user', 'commerce.refund.prepared',
    'commerce_refunds', v_refund.id::TEXT, p_idempotency_key, NULL, to_jsonb(v_refund),
    jsonb_build_object('line_quantities', p_line_quantities)
  );
  RETURN v_refund;
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_r2a_reconcile_refund(
  p_refund_id UUID,
  p_provider_refund_id TEXT,
  p_provider_status TEXT,
  p_provider_response JSONB,
  p_error TEXT DEFAULT NULL
) RETURNS public.commerce_refunds
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_refund public.commerce_refunds%ROWTYPE;
  v_order public.commerce_orders%ROWTYPE;
  v_receipt_number TEXT;
BEGIN
  SELECT * INTO v_refund FROM public.commerce_refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_not_found'; END IF;
  IF v_refund.status = 'succeeded' THEN RETURN v_refund; END IF;
  IF p_provider_status NOT IN ('pending', 'succeeded', 'failed') THEN RAISE EXCEPTION 'invalid_refund_status'; END IF;
  SELECT * INTO v_order FROM public.commerce_orders WHERE id = v_refund.commerce_order_id FOR UPDATE;
  UPDATE public.commerce_refunds SET
    provider_refund_id = COALESCE(provider_refund_id, p_provider_refund_id),
    status = p_provider_status, provider_response = COALESCE(p_provider_response, '{}'::JSONB),
    last_error = NULLIF(left(p_error, 1000), ''),
    completed_at = CASE WHEN p_provider_status = 'succeeded' THEN now() ELSE completed_at END
  WHERE id = p_refund_id RETURNING * INTO v_refund;
  IF p_provider_status = 'succeeded' THEN
    SELECT receipt_number INTO v_receipt_number FROM public.booking_receipts WHERE id = v_order.booking_receipt_id;
    INSERT INTO public.ledger_entries (
      venue_id, customer_id, source_type, source_id, accounting_date, occurred_at,
      customer_name, amount_inc_vat_minor, vat_amount_minor, payment_status,
      payment_method, receipt_number, booking_receipt_id, commerce_order_id, metadata
    ) VALUES (
      v_order.venue_id, v_order.customer_id, 'commerce_refund', v_refund.id::TEXT,
      (now() AT TIME ZONE 'Europe/Stockholm')::DATE, now(), v_order.guest_name,
      v_refund.amount_inc_vat_minor, v_refund.vat_amount_minor, 'refunded', 'stripe',
      v_receipt_number, v_order.booking_receipt_id, v_order.id,
      jsonb_build_object('commerce_refund_id', v_refund.id, 'stripe_refund_id', p_provider_refund_id,
        'refund_type', v_refund.refund_type, 'unallocated_amount_minor', v_refund.unallocated_amount_minor)
    ) ON CONFLICT (source_type, source_id) DO NOTHING;
    IF (
      SELECT COALESCE(sum(amount_inc_vat_minor), 0) FROM public.commerce_refunds
      WHERE commerce_order_id = v_order.id AND status = 'succeeded'
    ) >= v_order.total_inc_vat_minor THEN
      UPDATE public.booking_receipts SET payment_status = 'refunded', updated_at = now()
      WHERE id = v_order.booking_receipt_id;
      UPDATE public.commerce_orders SET status = 'cancelled',
        metadata = metadata || jsonb_build_object('fully_refunded_at', now())
      WHERE id = v_order.id;
    END IF;
  END IF;
  RETURN v_refund;
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_r2a_record_external_refund(
  p_order_id UUID,
  p_provider_refund_id TEXT,
  p_amount_inc_vat_minor INTEGER,
  p_provider_environment TEXT,
  p_provider_account_key TEXT,
  p_provider_response JSONB
) RETURNS public.commerce_refunds
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_order public.commerce_orders%ROWTYPE; v_refund public.commerce_refunds%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.commerce_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'commerce_order_not_found'; END IF;
  SELECT * INTO v_refund FROM public.commerce_refunds
  WHERE provider_environment = p_provider_environment AND provider_account_key = p_provider_account_key
    AND provider_refund_id = p_provider_refund_id FOR UPDATE;
  IF FOUND THEN RETURN v_refund; END IF;
  INSERT INTO public.commerce_refunds (
    commerce_order_id, seller_franchisee_id, pickup_location_id, idempotency_key,
    refund_type, status, amount_inc_vat_minor, vat_amount_minor, unallocated_amount_minor,
    currency, provider_environment, provider_account_key, provider_idempotency_key,
    provider_request, provider_refund_id,
    reason, provider_response, completed_at
  ) VALUES (
    p_order_id, v_order.seller_franchisee_id, v_order.pickup_location_id,
    'external:' || p_provider_refund_id, 'external_unallocated', 'preparing',
    p_amount_inc_vat_minor, 0, p_amount_inc_vat_minor, v_order.currency,
    p_provider_environment, p_provider_account_key, 'external:' || p_provider_refund_id,
    '{}'::JSONB, p_provider_refund_id,
    'External Stripe refund awaiting line allocation', COALESCE(p_provider_response, '{}'::JSONB), now()
  ) RETURNING * INTO v_refund;
  PERFORM public.commerce_r2a_reconcile_refund(v_refund.id, p_provider_refund_id, 'succeeded', p_provider_response, NULL);
  UPDATE public.commerce_orders SET status = 'attention',
    metadata = metadata || jsonb_build_object('attention_reason', 'external_refund_unallocated', 'commerce_refund_id', v_refund.id)
  WHERE id = p_order_id AND status = 'paid';
  RETURN v_refund;
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_r2a_record_disposition(
  p_order_line_id UUID,
  p_quantity INTEGER,
  p_outcome TEXT,
  p_refund_id UUID,
  p_reason TEXT,
  p_idempotency_key TEXT,
  p_actor_user_id UUID
) RETURNS public.commerce_physical_dispositions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_line public.commerce_order_lines%ROWTYPE;
  v_order public.commerce_orders%ROWTYPE;
  v_allocation public.inventory_allocations%ROWTYPE;
  v_level public.inventory_levels%ROWTYPE;
  v_disposition public.commerce_physical_dispositions%ROWTYPE;
  v_prior_returned INTEGER;
  v_refund_line_quantity INTEGER;
  v_prior_refund_disposed INTEGER;
  v_ops_id UUID;
  v_deficit INTEGER;
BEGIN
  IF p_quantity <= 0 OR p_outcome NOT IN ('return_sellable', 'return_damaged', 'uncollected_present', 'uncollected_missing') THEN
    RAISE EXCEPTION 'invalid_physical_disposition';
  END IF;
  SELECT * INTO v_line FROM public.commerce_order_lines WHERE id = p_order_line_id;
  IF NOT FOUND OR v_line.inventory_policy <> 'tracked' THEN RAISE EXCEPTION 'tracked_order_line_not_found'; END IF;
  SELECT * INTO v_order FROM public.commerce_orders WHERE id = v_line.commerce_order_id FOR UPDATE;
  SELECT * INTO v_line FROM public.commerce_order_lines WHERE id = p_order_line_id FOR UPDATE;
  PERFORM public.commerce_r2a_assert_staff(p_actor_user_id, v_order.venue_id);
  SELECT * INTO v_allocation FROM public.inventory_allocations
  WHERE commerce_order_line_id = p_order_line_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'inventory_allocation_not_found'; END IF;
  SELECT * INTO v_disposition FROM public.commerce_physical_dispositions
  WHERE location_id = v_allocation.location_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_disposition.actor_user_id <> p_actor_user_id
      OR v_disposition.commerce_order_line_id <> p_order_line_id
      OR v_disposition.quantity <> p_quantity
      OR v_disposition.outcome <> p_outcome
      OR v_disposition.refund_id IS DISTINCT FROM p_refund_id THEN
      RAISE EXCEPTION 'idempotency_key_reused_with_different_request';
    END IF;
    RETURN v_disposition;
  END IF;
  SELECT COALESCE(sum(quantity), 0)::INTEGER INTO v_prior_returned
  FROM public.commerce_physical_dispositions
  WHERE commerce_order_line_id = p_order_line_id
    AND outcome IN ('return_sellable', 'return_damaged');
  IF p_outcome IN ('return_sellable', 'return_damaged')
    AND v_prior_returned + p_quantity > v_allocation.collected_quantity THEN
    RAISE EXCEPTION 'return_quantity_exceeds_collected_quantity';
  END IF;
  IF p_outcome IN ('uncollected_present', 'uncollected_missing') THEN
    IF v_allocation.cancelled_quantity + v_allocation.collected_quantity + p_quantity > v_allocation.quantity THEN
      RAISE EXCEPTION 'disposition_quantity_exceeds_allocation';
    END IF;
    SELECT rl.quantity INTO v_refund_line_quantity
    FROM public.commerce_refund_lines rl JOIN public.commerce_refunds r ON r.id = rl.refund_id
    WHERE r.id = p_refund_id AND r.status = 'succeeded'
      AND rl.commerce_order_line_id = p_order_line_id;
    IF v_refund_line_quantity IS NULL THEN
      RAISE EXCEPTION 'uncollected_cancellation_requires_succeeded_refund';
    END IF;
    SELECT COALESCE(sum(quantity), 0)::INTEGER INTO v_prior_refund_disposed
    FROM public.commerce_physical_dispositions
    WHERE refund_id = p_refund_id AND commerce_order_line_id = p_order_line_id
      AND outcome IN ('uncollected_present', 'uncollected_missing');
    IF v_prior_refund_disposed + p_quantity > v_refund_line_quantity THEN
      RAISE EXCEPTION 'uncollected_disposition_exceeds_refunded_quantity';
    END IF;
  END IF;
  SELECT * INTO v_level FROM public.inventory_levels
  WHERE variant_id = v_allocation.variant_id AND location_id = v_allocation.location_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'inventory_not_configured'; END IF;
  INSERT INTO public.commerce_physical_dispositions (
    idempotency_key, commerce_order_id, commerce_order_line_id, allocation_id,
    refund_id, variant_id, location_id, outcome, quantity, actor_user_id, reason
  ) VALUES (
    p_idempotency_key, v_order.id, p_order_line_id, v_allocation.id, p_refund_id,
    v_allocation.variant_id, v_allocation.location_id, p_outcome, p_quantity,
    p_actor_user_id, btrim(p_reason)
  ) RETURNING * INTO v_disposition;
  IF p_outcome = 'return_sellable' THEN
    UPDATE public.inventory_levels SET on_hand = on_hand + p_quantity, version = version + 1 WHERE id = v_level.id;
    INSERT INTO public.inventory_movements (
      variant_id, location_id, movement_type, on_hand_delta, source_effect_key,
      source_entity_type, source_entity_id, order_id, order_line_id, actor_user_id, reason
    ) VALUES (
      v_allocation.variant_id, v_allocation.location_id, 'return_sellable', p_quantity,
      'disposition:' || v_disposition.id, 'commerce_physical_disposition', v_disposition.id::TEXT,
      v_order.id, p_order_line_id, p_actor_user_id, btrim(p_reason)
    );
  ELSIF p_outcome IN ('uncollected_present', 'uncollected_missing') THEN
    IF v_level.allocated < p_quantity THEN RAISE EXCEPTION 'allocation_balance_mismatch'; END IF;
    IF p_outcome = 'uncollected_missing' AND v_level.on_hand < p_quantity THEN
      RAISE EXCEPTION 'physical_shortage_requires_inventory_correction';
    END IF;
    UPDATE public.inventory_levels SET
      allocated = allocated - p_quantity,
      on_hand = CASE WHEN p_outcome = 'uncollected_missing' THEN on_hand - p_quantity ELSE on_hand END,
      version = version + 1,
      incident_blocked = CASE WHEN p_outcome = 'uncollected_missing' THEN true ELSE incident_blocked END
    WHERE id = v_level.id;
    UPDATE public.inventory_allocations SET
      cancelled_quantity = cancelled_quantity + p_quantity,
      status = CASE WHEN collected_quantity + cancelled_quantity + p_quantity = quantity THEN 'cancelled' ELSE status END
    WHERE id = v_allocation.id;
    UPDATE public.commerce_order_lines SET cancelled_quantity = cancelled_quantity + p_quantity,
      fulfillment_status = CASE WHEN collected_quantity + cancelled_quantity + p_quantity = quantity THEN 'not_collected' ELSE fulfillment_status END
    WHERE id = p_order_line_id;
    INSERT INTO public.inventory_movements (
      variant_id, location_id, movement_type, on_hand_delta, allocated_delta,
      source_effect_key, source_entity_type, source_entity_id, order_id, order_line_id,
      actor_user_id, reason, metadata
    ) VALUES (
      v_allocation.variant_id, v_allocation.location_id, 'allocation_cancel',
      CASE WHEN p_outcome = 'uncollected_missing' THEN -p_quantity ELSE 0 END,
      -p_quantity, 'disposition:' || v_disposition.id,
      'commerce_physical_disposition', v_disposition.id::TEXT, v_order.id,
      p_order_line_id, p_actor_user_id, btrim(p_reason), jsonb_build_object('outcome', p_outcome)
    );
    IF p_outcome = 'uncollected_missing' THEN
      v_deficit := GREATEST(v_level.reserved + v_level.allocated - p_quantity - (v_level.on_hand - p_quantity), 1);
      INSERT INTO public.ops_incidents (
        venue_id, severity, title, status, affected_route, affected_ids, impact,
        containment, metadata, created_by, updated_by
      ) VALUES (
        v_order.venue_id, 'P1', 'Saknad allokerad vara', 'open', '/admin', v_level.id::TEXT,
        'En betald men ej utlämnad vara saknas fysiskt.',
        'Lagernivån är blockerad tills fysisk avstämning och kundåtagande är lösta.',
        jsonb_build_object('inventory_level_id', v_level.id, 'order_id', v_order.id, 'disposition_id', v_disposition.id),
        p_actor_user_id, p_actor_user_id
      ) RETURNING id INTO v_ops_id;
      INSERT INTO public.inventory_incidents (
        inventory_level_id, ops_incident_id, incident_type, deficit_quantity
      ) VALUES (v_level.id, v_ops_id, 'physical_shortage', v_deficit)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  INSERT INTO public.audit_log (
    organization_id, venue_id, actor_user_id, actor_type, action,
    entity_table, entity_id, request_id, before, after, metadata
  ) VALUES (
    v_order.organization_id, v_order.venue_id, p_actor_user_id, 'user',
    'commerce.physical_disposition.recorded', 'commerce_physical_dispositions',
    v_disposition.id::TEXT, p_idempotency_key, NULL, to_jsonb(v_disposition), '{}'::JSONB
  );
  RETURN v_disposition;
END;
$$;

CREATE OR REPLACE VIEW public.commerce_inventory_positions
WITH (security_invoker = true) AS
SELECT
  level.id AS inventory_level_id,
  level.variant_id,
  level.location_id,
  level.on_hand,
  level.reserved,
  level.allocated,
  level.on_hand - level.reserved - level.allocated AS available_to_sell,
  level.version,
  level.incident_blocked,
  COALESCE(movement.on_hand_delta, 0) AS ledger_on_hand,
  COALESCE(movement.reserved_delta, 0) AS ledger_reserved,
  COALESCE(movement.allocated_delta, 0) AS ledger_allocated,
  COALESCE(reservations.quantity, 0) AS active_reservation_quantity,
  COALESCE(allocations.quantity, 0) AS open_allocation_quantity,
  level.on_hand = COALESCE(movement.on_hand_delta, 0)
    AND level.reserved = COALESCE(movement.reserved_delta, 0)
    AND level.allocated = COALESCE(movement.allocated_delta, 0)
    AND level.reserved = COALESCE(reservations.quantity, 0)
    AND level.allocated = COALESCE(allocations.quantity, 0) AS reconciled
FROM public.inventory_levels level
LEFT JOIN (
  SELECT variant_id, location_id,
    sum(on_hand_delta)::INTEGER AS on_hand_delta,
    sum(reserved_delta)::INTEGER AS reserved_delta,
    sum(allocated_delta)::INTEGER AS allocated_delta
  FROM public.inventory_movements GROUP BY variant_id, location_id
) movement USING (variant_id, location_id)
LEFT JOIN (
  SELECT variant_id, location_id, sum(quantity)::INTEGER AS quantity
  FROM public.inventory_reservations WHERE status = 'active' GROUP BY variant_id, location_id
) reservations USING (variant_id, location_id)
LEFT JOIN (
  SELECT variant_id, location_id,
    sum(quantity - collected_quantity - cancelled_quantity)::INTEGER AS quantity
  FROM public.inventory_allocations
  WHERE status IN ('active', 'partially_collected', 'attention')
  GROUP BY variant_id, location_id
) allocations USING (variant_id, location_id);

CREATE OR REPLACE VIEW public.commerce_r2a_drain_status
WITH (security_invoker = true) AS
SELECT
  (SELECT count(*) FROM public.commerce_checkout_attempts
    WHERE status IN ('prepared', 'provider_creation_unresolved', 'open', 'payment_processing', 'attention')) AS unresolved_attempts,
  (SELECT COALESCE(sum(quantity), 0) FROM public.inventory_reservations WHERE status = 'active') AS reserved_units,
  (SELECT COALESCE(sum(quantity - collected_quantity - cancelled_quantity), 0)
    FROM public.inventory_allocations WHERE status IN ('active', 'partially_collected', 'attention')) AS allocated_units,
  (SELECT count(*) FROM public.commerce_refunds WHERE status IN ('preparing', 'pending', 'attention')) AS unresolved_refunds,
  (SELECT count(*) FROM public.inventory_incidents WHERE status = 'open') AS open_inventory_incidents,
  (SELECT count(*) FROM public.commerce_order_lines
    WHERE inventory_policy = 'tracked' AND fulfillment_status IN ('pending_pickup', 'attention')) AS pickup_obligations;

REVOKE ALL ON public.commerce_inventory_positions, public.commerce_r2a_drain_status FROM anon, authenticated;
GRANT SELECT ON public.commerce_inventory_positions, public.commerce_r2a_drain_status TO service_role;

CREATE OR REPLACE FUNCTION public.commerce_r2a_scan_inventory_reconciliation()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_position RECORD; v_location public.inventory_locations%ROWTYPE; v_ops_id UUID; v_created INTEGER := 0;
BEGIN
  FOR v_position IN SELECT * FROM public.commerce_inventory_positions WHERE NOT reconciled ORDER BY location_id, variant_id
  LOOP
    SELECT * INTO v_location FROM public.inventory_locations WHERE id = v_position.location_id;
    UPDATE public.inventory_levels SET incident_blocked = true WHERE id = v_position.inventory_level_id;
    IF NOT EXISTS (
      SELECT 1 FROM public.inventory_incidents
      WHERE inventory_level_id = v_position.inventory_level_id
        AND incident_type = 'reconciliation_mismatch' AND status = 'open'
    ) THEN
      INSERT INTO public.ops_incidents (
        venue_id, severity, title, status, affected_route, affected_ids, impact,
        containment, metadata
      ) VALUES (
        v_location.venue_id, 'P1', 'Lageravstämning matchar inte', 'open', '/admin',
        v_position.inventory_level_id::TEXT,
        'Saldo, rörelselogg, reservationer eller allokeringar skiljer sig.',
        'Nya reservationer och vanlig uthämtning är blockerade tills avstämningen är löst.',
        to_jsonb(v_position)
      ) RETURNING id INTO v_ops_id;
      INSERT INTO public.inventory_incidents (
        inventory_level_id, ops_incident_id, incident_type, deficit_quantity
      ) VALUES (
        v_position.inventory_level_id, v_ops_id, 'reconciliation_mismatch',
        GREATEST(abs(v_position.reserved - v_position.active_reservation_quantity),
          abs(v_position.allocated - v_position.open_allocation_quantity), 1)
      );
      v_created := v_created + 1;
    END IF;
  END LOOP;
  RETURN v_created;
END;
$$;

-- Customer and staff applications use Edge Functions. No browser role can mutate R2A state directly.
ALTER TABLE public.product_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_option_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variant_option_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_venue_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_checkout_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_checkout_attempt_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_pickup_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_refund_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_physical_dispositions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.product_options, public.product_option_values, public.product_variants,
  public.product_variant_option_values, public.inventory_locations, public.product_venue_listings,
  public.inventory_levels, public.inventory_commands, public.inventory_movements,
  public.inventory_incidents, public.commerce_checkout_attempts, public.commerce_checkout_attempt_lines,
  public.inventory_reservations, public.inventory_allocations, public.commerce_pickup_commands,
  public.commerce_refunds, public.commerce_refund_lines, public.commerce_physical_dispositions
FROM anon, authenticated;

GRANT ALL ON TABLE public.product_options, public.product_option_values, public.product_variants,
  public.product_variant_option_values, public.inventory_locations, public.product_venue_listings,
  public.inventory_levels, public.inventory_commands, public.inventory_movements,
  public.inventory_incidents, public.commerce_checkout_attempts, public.commerce_checkout_attempt_lines,
  public.inventory_reservations, public.inventory_allocations, public.commerce_pickup_commands,
  public.commerce_refunds, public.commerce_refund_lines, public.commerce_physical_dispositions
TO service_role;

REVOKE ALL ON FUNCTION public.commerce_r2a_assert_staff(UUID, UUID),
  public.commerce_r2a_upsert_variant(UUID, UUID, TEXT, TEXT, INTEGER, TEXT, TEXT, UUID[], UUID),
  public.commerce_r2a_receive_inventory(UUID, UUID, INTEGER, TEXT, TEXT, TEXT, UUID),
  public.commerce_r2a_correct_inventory(UUID, UUID, INTEGER, INTEGER, BOOLEAN, TEXT, TEXT, UUID),
  public.commerce_r2a_resolve_inventory_incident(UUID, JSONB, TEXT, UUID),
  public.commerce_r2a_prepare_checkout(UUID, UUID, INTEGER, JSONB, UUID, UUID, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ),
  public.commerce_r2a_attach_checkout_session(UUID, TEXT, JSONB),
  public.commerce_r2a_mark_provider_unresolved(UUID, TEXT),
  public.commerce_r2a_close_unpaid_attempt(UUID, TEXT, TEXT, TEXT),
  public.commerce_r2a_claim_recovery_attempts(INTEGER, INTEGER, UUID),
  public.commerce_r2a_finish_recovery_lease(UUID, UUID, TEXT, INTEGER),
  public.commerce_r2a_claim_recovery_refunds(INTEGER, INTEGER, UUID),
  public.commerce_r2a_finish_refund_recovery_lease(UUID, UUID, TEXT, INTEGER),
  public.commerce_r2a_scan_inventory_reconciliation(),
  public.commerce_r2a_collect_pickup(UUID, INTEGER, UUID, TEXT, UUID),
  public.commerce_r2a_prepare_refund(UUID, JSONB, INTEGER, TEXT, TEXT, TEXT, TEXT, UUID),
  public.commerce_r2a_reconcile_refund(UUID, TEXT, TEXT, JSONB, TEXT),
  public.commerce_r2a_record_external_refund(UUID, TEXT, INTEGER, TEXT, TEXT, JSONB),
  public.commerce_r2a_record_disposition(UUID, INTEGER, TEXT, UUID, TEXT, TEXT, UUID)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.commerce_r2a_upsert_variant(UUID, UUID, TEXT, TEXT, INTEGER, TEXT, TEXT, UUID[], UUID),
  public.commerce_r2a_receive_inventory(UUID, UUID, INTEGER, TEXT, TEXT, TEXT, UUID),
  public.commerce_r2a_correct_inventory(UUID, UUID, INTEGER, INTEGER, BOOLEAN, TEXT, TEXT, UUID),
  public.commerce_r2a_resolve_inventory_incident(UUID, JSONB, TEXT, UUID),
  public.commerce_r2a_prepare_checkout(UUID, UUID, INTEGER, JSONB, UUID, UUID, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ),
  public.commerce_r2a_attach_checkout_session(UUID, TEXT, JSONB),
  public.commerce_r2a_mark_provider_unresolved(UUID, TEXT),
  public.commerce_r2a_close_unpaid_attempt(UUID, TEXT, TEXT, TEXT),
  public.commerce_r2a_claim_recovery_attempts(INTEGER, INTEGER, UUID),
  public.commerce_r2a_finish_recovery_lease(UUID, UUID, TEXT, INTEGER),
  public.commerce_r2a_claim_recovery_refunds(INTEGER, INTEGER, UUID),
  public.commerce_r2a_finish_refund_recovery_lease(UUID, UUID, TEXT, INTEGER),
  public.commerce_r2a_scan_inventory_reconciliation(),
  public.commerce_r2a_collect_pickup(UUID, INTEGER, UUID, TEXT, UUID),
  public.commerce_r2a_prepare_refund(UUID, JSONB, INTEGER, TEXT, TEXT, TEXT, TEXT, UUID),
  public.commerce_r2a_reconcile_refund(UUID, TEXT, TEXT, JSONB, TEXT),
  public.commerce_r2a_record_external_refund(UUID, TEXT, INTEGER, TEXT, TEXT, JSONB),
  public.commerce_r2a_record_disposition(UUID, INTEGER, TEXT, UUID, TEXT, TEXT, UUID)
TO service_role;

REVOKE ALL ON FUNCTION public.replace_commerce_cart_lines(UUID, INTEGER, JSONB, TEXT, TEXT, TEXT),
  public.finalize_commerce_payment(UUID, INTEGER, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_commerce_cart_lines(UUID, INTEGER, JSONB, TEXT, TEXT, TEXT),
  public.finalize_commerce_payment(UUID, INTEGER, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT)
TO service_role;

COMMENT ON FUNCTION public.commerce_r2a_prepare_checkout IS
  'Transaction A for tracked checkout. Locks order, freezes canonical prices, aggregates demand, reserves all stock atomically, and persists immutable attempt evidence.';
COMMENT ON FUNCTION public.commerce_r2a_close_unpaid_attempt IS
  'Releases tracked stock only after an authoritative provider unpaid/expired result; a local deadline alone is never accepted.';
COMMENT ON FUNCTION public.finalize_commerce_payment(UUID, INTEGER, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT) IS
  'Canonical Commerce financial finalizer, extended in R2A to atomically convert tracked reservations to paid allocations.';
