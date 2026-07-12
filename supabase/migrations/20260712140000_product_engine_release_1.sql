-- Product Engine Release 1: canonical commerce order, mixed-VAT receipt lines,
-- and desk pickup fulfillment. This migration is additive and inert until an
-- access_product is explicitly enabled for commerce.

ALTER TABLE public.access_products
  ADD COLUMN IF NOT EXISTS commerce_kind TEXT,
  ADD COLUMN IF NOT EXISTS fulfillment_type TEXT,
  ADD COLUMN IF NOT EXISTS resolver_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS commerce_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.access_products DROP CONSTRAINT IF EXISTS access_products_kind_check;
ALTER TABLE public.access_products ADD CONSTRAINT access_products_kind_check CHECK (
  product_kind IN (
    'day_access', 'session_ticket', 'session_with_day_access', 'voucher', 'membership',
    'rental', 'merchandise'
  )
);

ALTER TABLE public.access_products DROP CONSTRAINT IF EXISTS access_products_commerce_kind_check;
ALTER TABLE public.access_products ADD CONSTRAINT access_products_commerce_kind_check
  CHECK (commerce_kind IS NULL OR commerce_kind IN ('participation', 'rental', 'merchandise'));

ALTER TABLE public.access_products DROP CONSTRAINT IF EXISTS access_products_fulfillment_type_check;
ALTER TABLE public.access_products ADD CONSTRAINT access_products_fulfillment_type_check
  CHECK (fulfillment_type IS NULL OR fulfillment_type IN ('participation', 'desk_pickup'));

-- product_kind remains a legacy access subtype. commerce_kind is the only
-- canonical commerce classification and is frozen onto order lines.
UPDATE public.access_products
SET commerce_kind = 'participation',
    fulfillment_type = 'participation'
WHERE product_kind IN ('day_access', 'session_ticket', 'session_with_day_access')
  AND (commerce_kind IS NULL OR fulfillment_type IS NULL);

CREATE TABLE IF NOT EXISTS public.product_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  source_product_id UUID NOT NULL REFERENCES public.access_products(id) ON DELETE CASCADE,
  target_product_id UUID NOT NULL REFERENCES public.access_products(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL DEFAULT 'offered_with'
    CHECK (relationship_type IN ('offered_with')),
  is_active BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT product_relationships_distinct_products CHECK (source_product_id <> target_product_id),
  UNIQUE (venue_id, source_product_id, target_product_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_product_relationships_source
  ON public.product_relationships (venue_id, source_product_id, is_active, sort_order);

CREATE TABLE IF NOT EXISTS public.commerce_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE RESTRICT,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'checkout_pending', 'paid', 'expired', 'cancelled', 'attention')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  currency TEXT NOT NULL DEFAULT 'SEK' CHECK (currency = upper(currency)),
  subtotal_minor INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_minor >= 0),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  total_inc_vat_minor INTEGER NOT NULL DEFAULT 0 CHECK (total_inc_vat_minor >= 0),
  total_ex_vat_minor INTEGER NOT NULL DEFAULT 0 CHECK (total_ex_vat_minor >= 0),
  vat_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (vat_amount_minor >= 0),
  stripe_session_id TEXT,
  stripe_payment_intent_id TEXT,
  booking_receipt_id UUID REFERENCES public.booking_receipts(id) ON DELETE SET NULL,
  ledger_entry_id UUID REFERENCES public.ledger_entries(id) ON DELETE SET NULL,
  guest_token_hash TEXT NOT NULL,
  receipt_token_hash TEXT,
  guest_name TEXT,
  guest_email TEXT,
  guest_phone TEXT,
  checkout_frozen_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (stripe_session_id),
  UNIQUE (guest_token_hash),
  UNIQUE (receipt_token_hash)
);

CREATE INDEX IF NOT EXISTS idx_commerce_orders_venue_status
  ON public.commerce_orders (venue_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commerce_orders_customer
  ON public.commerce_orders (customer_id, created_at DESC) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commerce_orders_user
  ON public.commerce_orders (user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commerce_orders_guest_email
  ON public.commerce_orders (venue_id, lower(guest_email)) WHERE guest_email IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.commerce_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commerce_order_id UUID NOT NULL REFERENCES public.commerce_orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.access_products(id) ON DELETE SET NULL,
  product_key TEXT NOT NULL,
  product_name TEXT NOT NULL,
  commerce_kind TEXT NOT NULL CHECK (commerce_kind IN ('participation', 'rental', 'merchandise')),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0 AND quantity <= 100),
  unit_price_minor INTEGER NOT NULL DEFAULT 0 CHECK (unit_price_minor >= 0),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  line_total_inc_vat_minor INTEGER NOT NULL DEFAULT 0 CHECK (line_total_inc_vat_minor >= 0),
  vat_rate NUMERIC(5,2) NOT NULL CHECK (vat_rate >= 0 AND vat_rate <= 100),
  vat_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (vat_amount_minor >= 0),
  line_total_ex_vat_minor INTEGER NOT NULL DEFAULT 0 CHECK (line_total_ex_vat_minor >= 0),
  source_type TEXT NOT NULL,
  source_id TEXT,
  fulfillment_type TEXT NOT NULL CHECK (fulfillment_type IN ('participation', 'desk_pickup')),
  fulfillment_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (fulfillment_status IN ('not_required', 'pending_pickup', 'collected', 'not_collected', 'attention')),
  fulfilled_at TIMESTAMPTZ,
  fulfilled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  activity_session_id UUID REFERENCES public.activity_sessions(id) ON DELETE SET NULL,
  session_date DATE,
  session_registration_id UUID REFERENCES public.session_registrations(id) ON DELETE SET NULL,
  beneficiary_customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  beneficiary_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  parent_line_id UUID REFERENCES public.commerce_order_lines(id) ON DELETE SET NULL,
  capacity_hold_id UUID REFERENCES public.capacity_holds(id) ON DELETE SET NULL,
  resolver_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  product_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT commerce_order_lines_amounts_balance CHECK (
    line_total_inc_vat_minor = unit_price_minor * quantity - discount_minor
    AND line_total_ex_vat_minor + vat_amount_minor = line_total_inc_vat_minor
  )
);

CREATE INDEX IF NOT EXISTS idx_commerce_order_lines_order
  ON public.commerce_order_lines (commerce_order_id, sort_order, created_at);
CREATE INDEX IF NOT EXISTS idx_commerce_order_lines_participation
  ON public.commerce_order_lines (session_registration_id)
  WHERE session_registration_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commerce_order_lines_fulfillment
  ON public.commerce_order_lines (fulfillment_status, commerce_order_id)
  WHERE fulfillment_type = 'desk_pickup';

CREATE TABLE IF NOT EXISTS public.commerce_receipt_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_receipt_id UUID NOT NULL REFERENCES public.booking_receipts(id) ON DELETE CASCADE,
  commerce_order_id UUID NOT NULL REFERENCES public.commerce_orders(id) ON DELETE RESTRICT,
  commerce_order_line_id UUID NOT NULL REFERENCES public.commerce_order_lines(id) ON DELETE RESTRICT,
  product_id UUID REFERENCES public.access_products(id) ON DELETE SET NULL,
  product_key TEXT NOT NULL,
  product_name TEXT NOT NULL,
  commerce_kind TEXT NOT NULL CHECK (commerce_kind IN ('participation', 'rental', 'merchandise')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  total_inc_vat_minor INTEGER NOT NULL CHECK (total_inc_vat_minor >= 0),
  vat_rate NUMERIC(5,2) NOT NULL,
  vat_amount_minor INTEGER NOT NULL CHECK (vat_amount_minor >= 0),
  total_ex_vat_minor INTEGER NOT NULL CHECK (total_ex_vat_minor >= 0),
  fulfillment_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (commerce_order_line_id)
);

CREATE INDEX IF NOT EXISTS idx_commerce_receipt_lines_receipt
  ON public.commerce_receipt_lines (booking_receipt_id, sort_order);

ALTER TABLE public.booking_receipts
  ADD COLUMN IF NOT EXISTS commerce_order_id UUID REFERENCES public.commerce_orders(id) ON DELETE SET NULL;
ALTER TABLE public.booking_receipts ALTER COLUMN vat_rate DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_receipts_commerce_order
  ON public.booking_receipts (commerce_order_id) WHERE commerce_order_id IS NOT NULL;

ALTER TABLE public.ledger_entries
  ADD COLUMN IF NOT EXISTS commerce_order_id UUID REFERENCES public.commerce_orders(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_entries_commerce_order
  ON public.ledger_entries (commerce_order_id) WHERE commerce_order_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_product_relationships_updated_at ON public.product_relationships;
CREATE TRIGGER trg_product_relationships_updated_at
  BEFORE UPDATE ON public.product_relationships
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_commerce_orders_updated_at ON public.commerce_orders;
CREATE TRIGGER trg_commerce_orders_updated_at
  BEFORE UPDATE ON public.commerce_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.enforce_commerce_order_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'commerce_order_is_frozen';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'draft' AND (
    NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
    NEW.venue_id IS DISTINCT FROM OLD.venue_id OR
    NEW.currency IS DISTINCT FROM OLD.currency OR
    NEW.subtotal_minor IS DISTINCT FROM OLD.subtotal_minor OR
    NEW.discount_minor IS DISTINCT FROM OLD.discount_minor OR
    NEW.total_inc_vat_minor IS DISTINCT FROM OLD.total_inc_vat_minor OR
    NEW.total_ex_vat_minor IS DISTINCT FROM OLD.total_ex_vat_minor OR
    NEW.vat_amount_minor IS DISTINCT FROM OLD.vat_amount_minor OR
    NEW.guest_token_hash IS DISTINCT FROM OLD.guest_token_hash OR
    (
      NEW.checkout_frozen_at IS DISTINCT FROM OLD.checkout_frozen_at
      AND NOT (OLD.status = 'checkout_pending' AND NEW.status = 'draft' AND NEW.checkout_frozen_at IS NULL)
    )
  ) THEN
    RAISE EXCEPTION 'commerce_order_is_frozen';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_commerce_order_lifecycle ON public.commerce_orders;
CREATE TRIGGER trg_commerce_order_lifecycle
  BEFORE UPDATE OR DELETE ON public.commerce_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_commerce_order_lifecycle();
DROP TRIGGER IF EXISTS trg_commerce_order_lines_updated_at ON public.commerce_order_lines;
CREATE TRIGGER trg_commerce_order_lines_updated_at
  BEFORE UPDATE ON public.commerce_order_lines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.enforce_commerce_order_line_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status
  FROM public.commerce_orders
  WHERE id = COALESCE(NEW.commerce_order_id, OLD.commerce_order_id);

  IF TG_OP = 'INSERT' AND v_status <> 'draft' THEN
    RAISE EXCEPTION 'commerce_order_not_draft';
  END IF;
  IF TG_OP = 'DELETE' AND v_status <> 'draft' THEN
    RAISE EXCEPTION 'commerce_order_lines_are_frozen';
  END IF;
  IF TG_OP = 'UPDATE' AND v_status <> 'draft' AND (
    NEW.commerce_order_id IS DISTINCT FROM OLD.commerce_order_id OR
    NEW.product_id IS DISTINCT FROM OLD.product_id OR
    NEW.product_key IS DISTINCT FROM OLD.product_key OR
    NEW.product_name IS DISTINCT FROM OLD.product_name OR
    NEW.commerce_kind IS DISTINCT FROM OLD.commerce_kind OR
    NEW.quantity IS DISTINCT FROM OLD.quantity OR
    NEW.unit_price_minor IS DISTINCT FROM OLD.unit_price_minor OR
    NEW.discount_minor IS DISTINCT FROM OLD.discount_minor OR
    NEW.line_total_inc_vat_minor IS DISTINCT FROM OLD.line_total_inc_vat_minor OR
    NEW.vat_rate IS DISTINCT FROM OLD.vat_rate OR
    NEW.vat_amount_minor IS DISTINCT FROM OLD.vat_amount_minor OR
    NEW.line_total_ex_vat_minor IS DISTINCT FROM OLD.line_total_ex_vat_minor OR
    NEW.source_type IS DISTINCT FROM OLD.source_type OR
    NEW.source_id IS DISTINCT FROM OLD.source_id OR
    NEW.fulfillment_type IS DISTINCT FROM OLD.fulfillment_type OR
    NEW.activity_session_id IS DISTINCT FROM OLD.activity_session_id OR
    NEW.session_date IS DISTINCT FROM OLD.session_date OR
    NEW.beneficiary_customer_id IS DISTINCT FROM OLD.beneficiary_customer_id OR
    NEW.beneficiary_user_id IS DISTINCT FROM OLD.beneficiary_user_id OR
    NEW.parent_line_id IS DISTINCT FROM OLD.parent_line_id OR
    NEW.capacity_hold_id IS DISTINCT FROM OLD.capacity_hold_id OR
    NEW.resolver_snapshot IS DISTINCT FROM OLD.resolver_snapshot OR
    NEW.product_snapshot IS DISTINCT FROM OLD.product_snapshot
  ) THEN
    RAISE EXCEPTION 'commerce_order_lines_are_frozen';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_commerce_order_line_lifecycle ON public.commerce_order_lines;
CREATE TRIGGER trg_commerce_order_line_lifecycle
  BEFORE INSERT OR UPDATE OR DELETE ON public.commerce_order_lines
  FOR EACH ROW EXECUTE FUNCTION public.enforce_commerce_order_line_lifecycle();

CREATE OR REPLACE FUNCTION public.replace_commerce_cart_lines(
  p_order_id UUID,
  p_expected_version INTEGER,
  p_lines JSONB,
  p_guest_name TEXT DEFAULT NULL,
  p_guest_email TEXT DEFAULT NULL,
  p_guest_phone TEXT DEFAULT NULL
)
RETURNS TABLE(order_id UUID, version INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.commerce_orders%ROWTYPE;
  v_item JSONB;
BEGIN
  SELECT * INTO v_order FROM public.commerce_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'commerce_order_not_found'; END IF;
  IF v_order.status <> 'draft' THEN RAISE EXCEPTION 'commerce_order_not_draft'; END IF;
  IF v_order.version <> p_expected_version THEN RAISE EXCEPTION 'stale_cart_version'; END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'commerce_order_empty';
  END IF;

  DELETE FROM public.commerce_order_lines WHERE commerce_order_id = p_order_id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    INSERT INTO public.commerce_order_lines (
      id, commerce_order_id, product_id, product_key, product_name, commerce_kind,
      quantity, unit_price_minor, discount_minor, line_total_inc_vat_minor,
      vat_rate, vat_amount_minor, line_total_ex_vat_minor, source_type, source_id,
      fulfillment_type, fulfillment_status, activity_session_id, session_date,
      beneficiary_customer_id, beneficiary_user_id, parent_line_id,
      product_snapshot, metadata, sort_order
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
      COALESCE(v_item->'product_snapshot', '{}'::jsonb),
      COALESCE(v_item->'metadata', '{}'::jsonb),
      COALESCE((v_item->>'sort_order')::INTEGER, 0)
    );
  END LOOP;

  UPDATE public.commerce_orders
  SET version = commerce_orders.version + 1,
      guest_name = COALESCE(NULLIF(BTRIM(p_guest_name), ''), guest_name),
      guest_email = COALESCE(NULLIF(lower(BTRIM(p_guest_email)), ''), guest_email),
      guest_phone = COALESCE(NULLIF(BTRIM(p_guest_phone), ''), guest_phone)
  WHERE id = p_order_id
  RETURNING id, commerce_orders.version INTO order_id, version;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.freeze_commerce_order(
  p_order_id UUID,
  p_expected_version INTEGER,
  p_lines JSONB
)
RETURNS TABLE(order_id UUID, version INTEGER, total_inc_vat_minor INTEGER, currency TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.commerce_orders%ROWTYPE;
  v_item JSONB;
  v_line_id UUID;
  v_unit INTEGER;
  v_quantity INTEGER;
  v_discount INTEGER;
  v_total INTEGER;
  v_vat_rate NUMERIC(5,2);
  v_vat INTEGER;
  v_count INTEGER;
BEGIN
  SELECT * INTO v_order FROM public.commerce_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'commerce_order_not_found'; END IF;
  IF v_order.status <> 'draft' THEN RAISE EXCEPTION 'commerce_order_not_draft'; END IF;
  IF v_order.version <> p_expected_version THEN RAISE EXCEPTION 'stale_cart_version'; END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'commerce_order_empty';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.commerce_order_lines WHERE commerce_order_id = p_order_id;
  IF v_count <> jsonb_array_length(p_lines) THEN RAISE EXCEPTION 'commerce_order_line_mismatch'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_id := (v_item->>'id')::UUID;
    v_unit := GREATEST(COALESCE((v_item->>'unit_price_minor')::INTEGER, 0), 0);
    v_quantity := GREATEST(COALESCE((v_item->>'quantity')::INTEGER, 1), 1);
    v_discount := GREATEST(COALESCE((v_item->>'discount_minor')::INTEGER, 0), 0);
    v_total := v_unit * v_quantity - v_discount;
    IF v_total < 0 THEN RAISE EXCEPTION 'invalid_commerce_line_discount'; END IF;
    v_vat_rate := COALESCE((v_item->>'vat_rate')::NUMERIC, 0);
    IF v_vat_rate < 0 OR v_vat_rate > 100 THEN RAISE EXCEPTION 'invalid_commerce_line_vat'; END IF;
    v_vat := ROUND(v_total * v_vat_rate / (100 + v_vat_rate));

    UPDATE public.commerce_order_lines
    SET product_key = COALESCE(NULLIF(v_item->>'product_key', ''), product_key),
        product_name = COALESCE(NULLIF(v_item->>'product_name', ''), product_name),
        commerce_kind = COALESCE(NULLIF(v_item->>'commerce_kind', ''), commerce_kind),
        quantity = v_quantity,
        unit_price_minor = v_unit,
        discount_minor = v_discount,
        line_total_inc_vat_minor = v_total,
        vat_rate = v_vat_rate,
        vat_amount_minor = v_vat,
        line_total_ex_vat_minor = v_total - v_vat,
        fulfillment_type = COALESCE(NULLIF(v_item->>'fulfillment_type', ''), fulfillment_type),
        fulfillment_status = CASE
          WHEN COALESCE(NULLIF(v_item->>'fulfillment_type', ''), fulfillment_type) = 'desk_pickup'
            THEN 'pending_pickup'
          ELSE 'not_required'
        END,
        beneficiary_customer_id = NULLIF(v_item->>'beneficiary_customer_id', '')::UUID,
        beneficiary_user_id = NULLIF(v_item->>'beneficiary_user_id', '')::UUID,
        capacity_hold_id = NULLIF(v_item->>'capacity_hold_id', '')::UUID,
        resolver_snapshot = COALESCE(v_item->'resolver_snapshot', '{}'::jsonb),
        product_snapshot = COALESCE(v_item->'product_snapshot', '{}'::jsonb)
    WHERE id = v_line_id AND commerce_order_id = p_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'commerce_order_line_not_found'; END IF;
  END LOOP;

  UPDATE public.commerce_orders o
  SET subtotal_minor = totals.subtotal_minor,
      discount_minor = totals.discount_minor,
      total_inc_vat_minor = totals.total_inc_vat_minor,
      vat_amount_minor = totals.vat_amount_minor,
      total_ex_vat_minor = totals.total_ex_vat_minor,
      status = 'checkout_pending',
      version = o.version + 1,
      checkout_frozen_at = now()
  FROM (
    SELECT COALESCE(SUM(unit_price_minor * quantity), 0)::INTEGER AS subtotal_minor,
           COALESCE(SUM(discount_minor), 0)::INTEGER AS discount_minor,
           COALESCE(SUM(line_total_inc_vat_minor), 0)::INTEGER AS total_inc_vat_minor,
           COALESCE(SUM(vat_amount_minor), 0)::INTEGER AS vat_amount_minor,
           COALESCE(SUM(line_total_ex_vat_minor), 0)::INTEGER AS total_ex_vat_minor
    FROM public.commerce_order_lines WHERE commerce_order_id = p_order_id
  ) totals
  WHERE o.id = p_order_id
  RETURNING o.id, o.version, o.total_inc_vat_minor, o.currency
  INTO order_id, version, total_inc_vat_minor, currency;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_commerce_order_stripe_session(
  p_order_id UUID,
  p_version INTEGER,
  p_stripe_session_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.commerce_orders
  SET stripe_session_id = p_stripe_session_id
  WHERE id = p_order_id AND version = p_version AND status = 'checkout_pending'
    AND (stripe_session_id IS NULL OR stripe_session_id = p_stripe_session_id);
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.reopen_commerce_order_after_checkout_failure(
  p_order_id UUID,
  p_version INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.commerce_orders
  SET status = 'draft', version = version + 1, stripe_session_id = NULL, checkout_frozen_at = NULL
  WHERE id = p_order_id AND version = p_version AND status = 'checkout_pending';
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.commerce_order_lines SET capacity_hold_id = NULL WHERE commerce_order_id = p_order_id;
  RETURN true;
END;
$$;

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
)
RETURNS TABLE(order_id UUID, receipt_id UUID, ledger_entry_id UUID, already_finalized BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.commerce_orders%ROWTYPE;
  v_receipt_id UUID;
  v_ledger_id UUID;
  v_receipt_number TEXT;
  v_rate_count INTEGER;
  v_single_rate NUMERIC(5,2);
  v_vat_breakdown JSONB;
BEGIN
  SELECT * INTO v_order FROM public.commerce_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'commerce_order_not_found'; END IF;
  IF v_order.version <> p_order_version THEN RAISE EXCEPTION 'commerce_order_version_mismatch'; END IF;
  IF v_order.stripe_session_id IS DISTINCT FROM p_stripe_session_id THEN
    RAISE EXCEPTION 'commerce_order_stripe_session_mismatch';
  END IF;

  IF v_order.status IN ('paid', 'attention') THEN
    RETURN QUERY SELECT v_order.id, v_order.booking_receipt_id, v_order.ledger_entry_id, true;
    RETURN;
  END IF;
  IF v_order.status <> 'checkout_pending' THEN RAISE EXCEPTION 'commerce_order_not_payable'; END IF;

  SELECT COUNT(DISTINCT vat_rate), MAX(vat_rate) INTO v_rate_count, v_single_rate
  FROM public.commerce_order_lines WHERE commerce_order_id = p_order_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'vat_rate', vat_rate,
    'amount_inc_vat_minor', amount_inc_vat_minor,
    'vat_amount_minor', vat_amount_minor
  ) ORDER BY vat_rate), '[]'::jsonb)
  INTO v_vat_breakdown
  FROM (
    SELECT vat_rate,
           SUM(line_total_inc_vat_minor)::INTEGER AS amount_inc_vat_minor,
           SUM(vat_amount_minor)::INTEGER AS vat_amount_minor
    FROM public.commerce_order_lines
    WHERE commerce_order_id = p_order_id
    GROUP BY vat_rate
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
    ROUND(v_order.total_inc_vat_minor / 100.0), ROUND(v_order.total_ex_vat_minor / 100.0),
    ROUND(v_order.vat_amount_minor / 100.0), v_order.total_inc_vat_minor / 100.0,
    v_order.total_ex_vat_minor / 100.0, v_order.vat_amount_minor / 100.0,
    CASE WHEN v_rate_count = 1 THEN v_single_rate ELSE NULL END,
    v_order.currency,
    jsonb_build_object('product_type', 'commerce_order', 'commerce_order_id', p_order_id, 'vat_breakdown', v_vat_breakdown)
  )
  ON CONFLICT (commerce_order_id) WHERE commerce_order_id IS NOT NULL DO UPDATE
    SET commerce_order_id = EXCLUDED.commerce_order_id
  RETURNING id, receipt_number INTO v_receipt_id, v_receipt_number;

  INSERT INTO public.commerce_receipt_lines (
    booking_receipt_id, commerce_order_id, commerce_order_line_id, product_id,
    product_key, product_name, commerce_kind, quantity, unit_price_minor,
    discount_minor, total_inc_vat_minor, vat_rate, vat_amount_minor,
    total_ex_vat_minor, fulfillment_type, metadata, sort_order
  )
  SELECT v_receipt_id, p_order_id, l.id, l.product_id, l.product_key, l.product_name,
         l.commerce_kind, l.quantity, l.unit_price_minor, l.discount_minor,
         l.line_total_inc_vat_minor, l.vat_rate, l.vat_amount_minor,
         l.line_total_ex_vat_minor, l.fulfillment_type,
         jsonb_build_object('source_type', l.source_type, 'source_id', l.source_id,
           'activity_session_id', l.activity_session_id, 'session_date', l.session_date),
         l.sort_order
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
    jsonb_build_object('commerce_order_id', p_order_id, 'vat_breakdown', v_vat_breakdown)
  )
  ON CONFLICT (commerce_order_id) WHERE commerce_order_id IS NOT NULL DO UPDATE
    SET commerce_order_id = EXCLUDED.commerce_order_id
  RETURNING id INTO v_ledger_id;

  UPDATE public.commerce_orders
  SET status = 'paid', customer_id = p_customer_id, user_id = COALESCE(p_user_id, user_id),
      guest_name = COALESCE(p_customer_name, guest_name),
      guest_email = COALESCE(lower(p_customer_email), guest_email),
      guest_phone = COALESCE(p_customer_phone, guest_phone),
      stripe_payment_intent_id = p_payment_intent_id,
      booking_receipt_id = v_receipt_id, ledger_entry_id = v_ledger_id, paid_at = now()
  WHERE id = p_order_id;

  RETURN QUERY SELECT p_order_id, v_receipt_id, v_ledger_id, false;
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_commerce_fulfillment(
  p_line_id UUID,
  p_next_status TEXT,
  p_actor_user_id UUID,
  p_request_id TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS public.commerce_order_lines
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_before public.commerce_order_lines%ROWTYPE;
  v_after public.commerce_order_lines%ROWTYPE;
  v_order public.commerce_orders%ROWTYPE;
BEGIN
  IF p_next_status NOT IN ('pending_pickup', 'collected', 'not_collected', 'attention') THEN
    RAISE EXCEPTION 'invalid_fulfillment_status';
  END IF;
  SELECT * INTO v_before FROM public.commerce_order_lines WHERE id = p_line_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'commerce_order_line_not_found'; END IF;
  IF v_before.fulfillment_type <> 'desk_pickup' THEN RAISE EXCEPTION 'line_does_not_require_pickup'; END IF;
  SELECT * INTO v_order FROM public.commerce_orders WHERE id = v_before.commerce_order_id;
  IF v_order.status NOT IN ('paid', 'attention') THEN RAISE EXCEPTION 'commerce_order_not_paid'; END IF;

  UPDATE public.commerce_order_lines
  SET fulfillment_status = p_next_status,
      fulfilled_at = CASE WHEN p_next_status IN ('collected', 'not_collected') THEN now() ELSE NULL END,
      fulfilled_by = CASE WHEN p_next_status IN ('collected', 'not_collected') THEN p_actor_user_id ELSE NULL END
  WHERE id = p_line_id RETURNING * INTO v_after;

  INSERT INTO public.audit_log (
    organization_id, venue_id, actor_user_id, actor_type, action,
    entity_table, entity_id, request_id, before, after, metadata
  ) VALUES (
    v_order.organization_id, v_order.venue_id, p_actor_user_id, 'user',
    'commerce.fulfillment.transition', 'commerce_order_lines', p_line_id::TEXT,
    p_request_id, to_jsonb(v_before), to_jsonb(v_after), COALESCE(p_metadata, '{}'::jsonb)
  );
  RETURN v_after;
END;
$$;

ALTER TABLE public.product_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_receipt_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages product relationships" ON public.product_relationships;
CREATE POLICY "Service role manages product relationships" ON public.product_relationships
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role manages commerce orders" ON public.commerce_orders;
CREATE POLICY "Service role manages commerce orders" ON public.commerce_orders
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role manages commerce order lines" ON public.commerce_order_lines;
CREATE POLICY "Service role manages commerce order lines" ON public.commerce_order_lines
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role manages commerce receipt lines" ON public.commerce_receipt_lines;
CREATE POLICY "Service role manages commerce receipt lines" ON public.commerce_receipt_lines
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON FUNCTION public.freeze_commerce_order(UUID, INTEGER, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_commerce_cart_lines(UUID, INTEGER, JSONB, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.attach_commerce_order_stripe_session(UUID, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reopen_commerce_order_after_checkout_failure(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_commerce_payment(UUID, INTEGER, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_commerce_fulfillment(UUID, TEXT, UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.freeze_commerce_order(UUID, INTEGER, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.replace_commerce_cart_lines(UUID, INTEGER, JSONB, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.attach_commerce_order_stripe_session(UUID, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reopen_commerce_order_after_checkout_failure(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_commerce_payment(UUID, INTEGER, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_commerce_fulfillment(UUID, TEXT, UUID, TEXT, JSONB) TO service_role;

DO $$
DECLARE
  v_venue_id UUID;
  v_rental_id UUID;
  v_bag_id UUID;
  v_racket_id UUID;
  v_open_play_id UUID;
BEGIN
  SELECT id INTO v_venue_id FROM public.venues WHERE slug = 'pickla-arena-sthlm' LIMIT 1;
  IF v_venue_id IS NULL THEN
    RAISE NOTICE 'Venue pickla-arena-sthlm missing; commerce seed skipped';
    RETURN;
  END IF;

  INSERT INTO public.access_products (
    venue_id, product_key, name, description, product_kind, commerce_kind,
    fulfillment_type, base_price_sek, vat_rate, grants, resolver_rules,
    is_active, commerce_enabled, sort_order
  ) VALUES
    (v_venue_id, 'rental_racket', 'Hyrrack', 'Hämtas vid disken.', 'rental', 'rental',
      'desk_pickup', 50, 6, '{}'::jsonb, '{"future_rent_to_buy_qualifying":true}'::jsonb, false, false, 200),
    (v_venue_id, 'pink_pickla_bag', 'Pink Pickla Bag', 'Hämtas vid disken.', 'merchandise', 'merchandise',
      'desk_pickup', 200, 25, '{}'::jsonb, '{}'::jsonb, false, false, 210),
    (v_venue_id, 'pickla_racket', 'Pickla-rack', 'Hämtas vid disken.', 'merchandise', 'merchandise',
      'desk_pickup', 499, 25, '{}'::jsonb, '{"future_rent_to_buy_eligible":true}'::jsonb, false, false, 220)
  ON CONFLICT (venue_id, product_key) DO NOTHING;

  SELECT id INTO v_rental_id FROM public.access_products WHERE venue_id = v_venue_id AND product_key = 'rental_racket';
  SELECT id INTO v_bag_id FROM public.access_products WHERE venue_id = v_venue_id AND product_key = 'pink_pickla_bag';
  SELECT id INTO v_racket_id FROM public.access_products WHERE venue_id = v_venue_id AND product_key = 'pickla_racket';
  SELECT id INTO v_open_play_id FROM public.access_products WHERE venue_id = v_venue_id AND product_key = 'open_play_slot';

  IF v_open_play_id IS NOT NULL AND v_rental_id IS NOT NULL THEN
    INSERT INTO public.product_relationships (
      venue_id, source_product_id, target_product_id, relationship_type, is_active, sort_order
    ) VALUES (v_venue_id, v_open_play_id, v_rental_id, 'offered_with', false, 10)
    ON CONFLICT (venue_id, source_product_id, target_product_id, relationship_type) DO NOTHING;
  END IF;
END;
$$;

COMMENT ON COLUMN public.access_products.commerce_kind IS
  'Canonical commerce classification. product_kind remains a legacy access subtype only.';
COMMENT ON TABLE public.commerce_orders IS
  'Canonical cart/order lifecycle. status=draft is the Cart; no separate cart table exists.';
COMMENT ON TABLE public.commerce_receipt_lines IS
  'General immutable receipt lines for participation, rental, and merchandise.';

-- Manual SQL Editor reminder after deployment:
-- NOTIFY pgrst, 'reload schema';
