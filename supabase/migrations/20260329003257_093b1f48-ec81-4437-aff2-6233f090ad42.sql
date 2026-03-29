
-- Corporate orders table
CREATE TABLE public.corporate_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_account_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES public.venues(id),
  order_number text NOT NULL UNIQUE,
  order_type text NOT NULL DEFAULT 'hours',
  status text NOT NULL DEFAULT 'pending',
  total_hours numeric NOT NULL DEFAULT 0,
  total_price numeric NOT NULL DEFAULT 0,
  currency text DEFAULT 'SEK',
  notes text,
  recurring_config jsonb,
  created_by uuid NOT NULL,
  invoiced_at timestamptz,
  paid_at timestamptz,
  fulfilled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Corporate order items (individual bookings in a recurring series)
CREATE TABLE public.corporate_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.corporate_orders(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings(id),
  day_of_week integer,
  start_time time,
  end_time time,
  week_number integer,
  scheduled_date date,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Per-employee limits
ALTER TABLE public.corporate_members
  ADD COLUMN monthly_hour_limit numeric DEFAULT NULL,
  ADD COLUMN monthly_cost_limit numeric DEFAULT NULL;

-- RLS for corporate_orders
ALTER TABLE public.corporate_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manages corporate orders"
  ON public.corporate_orders FOR ALL
  TO authenticated
  USING (is_super_admin() OR is_venue_admin(auth.uid(), venue_id))
  WITH CHECK (is_super_admin() OR is_venue_admin(auth.uid(), venue_id));

CREATE POLICY "Corporate admins manage own orders"
  ON public.corporate_orders FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.corporate_members cm
    WHERE cm.corporate_account_id = corporate_orders.corporate_account_id
      AND cm.user_id = auth.uid()
      AND cm.role = 'admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.corporate_members cm
    WHERE cm.corporate_account_id = corporate_orders.corporate_account_id
      AND cm.user_id = auth.uid()
      AND cm.role = 'admin'
  ));

CREATE POLICY "Corporate members read own orders"
  ON public.corporate_orders FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.corporate_members cm
    WHERE cm.corporate_account_id = corporate_orders.corporate_account_id
      AND cm.user_id = auth.uid()
  ));

-- RLS for corporate_order_items
ALTER TABLE public.corporate_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manages order items"
  ON public.corporate_order_items FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.corporate_orders co
    WHERE co.id = corporate_order_items.order_id
      AND (is_super_admin() OR is_venue_admin(auth.uid(), co.venue_id))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.corporate_orders co
    WHERE co.id = corporate_order_items.order_id
      AND (is_super_admin() OR is_venue_admin(auth.uid(), co.venue_id))
  ));

CREATE POLICY "Corporate admins manage own order items"
  ON public.corporate_order_items FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.corporate_orders co
    JOIN public.corporate_members cm ON cm.corporate_account_id = co.corporate_account_id
    WHERE co.id = corporate_order_items.order_id
      AND cm.user_id = auth.uid()
      AND cm.role = 'admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.corporate_orders co
    JOIN public.corporate_members cm ON cm.corporate_account_id = co.corporate_account_id
    WHERE co.id = corporate_order_items.order_id
      AND cm.user_id = auth.uid()
      AND cm.role = 'admin'
  ));

CREATE POLICY "Corporate members read own order items"
  ON public.corporate_order_items FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.corporate_orders co
    JOIN public.corporate_members cm ON cm.corporate_account_id = co.corporate_account_id
    WHERE co.id = corporate_order_items.order_id
      AND cm.user_id = auth.uid()
  ));

-- Order number generation function
CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  _ref TEXT;
  _exists BOOLEAN;
BEGIN
  LOOP
    _ref := 'CO-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    SELECT EXISTS(SELECT 1 FROM public.corporate_orders WHERE order_number = _ref) INTO _exists;
    EXIT WHEN NOT _exists;
  END LOOP;
  NEW.order_number := _ref;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_generate_order_number
  BEFORE INSERT ON public.corporate_orders
  FOR EACH ROW
  WHEN (NEW.order_number IS NULL OR NEW.order_number = '')
  EXECUTE FUNCTION public.generate_order_number();
