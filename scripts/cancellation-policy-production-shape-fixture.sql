-- LOCAL/STAGE-ONLY, NON-PII fixture. Run after migrations through
-- 20260921140000 and before 20260922120000. Never run in production.
\set ON_ERROR_STOP on

CREATE SCHEMA policy_forward_cert;

INSERT INTO public.organizations (id,name,slug)
VALUES ('91000000-0000-4000-8000-000000000001','Policy Forward Cert','policy-forward-cert');
INSERT INTO public.venues (id,organization_id,name,slug,commerce_enabled)
VALUES ('91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000001','Policy Forward Cert Venue','policy-forward-cert',true);
INSERT INTO auth.users (id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES ('91000000-0000-4000-8000-000000000003','authenticated','authenticated','policy-forward-cert@example.invalid',
  '2026-01-01T00:00:00Z','{}','{}','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
INSERT INTO public.venue_courts (id,venue_id,name,court_number,sport_type)
VALUES ('91000000-0000-4000-8000-000000000004','91000000-0000-4000-8000-000000000002','Cert Court',991,'pickleball');
INSERT INTO public.activity_sessions (id,venue_id,name,session_type,session_date,start_time,end_time,capacity,court_ids)
VALUES ('91000000-0000-4000-8000-000000000005','91000000-0000-4000-8000-000000000002',
  'Cert Open Play','open_play','2030-01-01','18:00','20:00',500,
  ARRAY['91000000-0000-4000-8000-000000000004'::UUID]);

-- 814 paid Commerce participation lines.
INSERT INTO public.commerce_orders (
  id,organization_id,venue_id,user_id,status,guest_token_hash,created_at,updated_at,paid_at
)
SELECT ('92000000-0000-4000-8000-' || lpad(n::TEXT,12,'0'))::UUID,
  '91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000003','draft',md5('policy-forward-order-'||n),
  '2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',NULL
FROM generate_series(1,814) n;
INSERT INTO public.commerce_order_lines (
  id,commerce_order_id,product_key,product_name,commerce_kind,quantity,
  unit_price_minor,discount_minor,line_total_inc_vat_minor,vat_rate,
  vat_amount_minor,line_total_ex_vat_minor,source_type,fulfillment_type,
  activity_session_id,session_date,created_at,updated_at
)
SELECT ('93000000-0000-4000-8000-' || lpad(n::TEXT,12,'0'))::UUID,
  ('92000000-0000-4000-8000-' || lpad(n::TEXT,12,'0'))::UUID,
  'cert-open-play','Cert Open Play','participation',1,0,0,0,6,0,0,
  'activity_session','participation','91000000-0000-4000-8000-000000000005',
  DATE '2027-01-01' + n,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'
FROM generate_series(1,814) n;
UPDATE public.commerce_orders SET status='paid',paid_at='2026-01-01T00:00:00Z'
WHERE venue_id='91000000-0000-4000-8000-000000000002';

-- 273 standalone registrations with no Commerce line.
INSERT INTO public.session_registrations (
  id,venue_id,activity_session_id,session_date,user_id,status,price_paid_sek,registered_at,created_at,updated_at
)
SELECT ('94000000-0000-4000-8000-' || lpad(n::TEXT,12,'0'))::UUID,
  '91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000005',
  DATE '2030-01-01' + n,'91000000-0000-4000-8000-000000000003','confirmed',165,
  '2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'
FROM generate_series(1,273) n;

-- 453 confirmed court bookings.
INSERT INTO public.bookings (
  id,venue_id,venue_court_id,user_id,booked_by,start_time,end_time,status,
  total_price,currency,booking_ref,created_at,updated_at
)
SELECT ('95000000-0000-4000-8000-' || lpad(n::TEXT,12,'0'))::UUID,
  '91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000004',
  '91000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000003',
  '2031-01-01T00:00:00Z'::TIMESTAMPTZ + n*INTERVAL '2 hours',
  '2031-01-01T01:00:00Z'::TIMESTAMPTZ + n*INTERVAL '2 hours','confirmed',
  0,'SEK','CERT-'||n,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'
FROM generate_series(1,453) n;

-- 343 settled co-player records attached to distinct fixture bookings.
INSERT INTO public.booking_participants (
  id,venue_id,booking_id,booking_group_key,user_id,display_name,role,
  price_minor,currency,payment_status,created_at,updated_at
)
SELECT ('96000000-0000-4000-8000-' || lpad(n::TEXT,12,'0'))::UUID,
  '91000000-0000-4000-8000-000000000002',
  ('95000000-0000-4000-8000-' || lpad(n::TEXT,12,'0'))::UUID,
  'cert-booking-'||n,'91000000-0000-4000-8000-000000000003','Cert Player','player',
  9900,'SEK','paid','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'
FROM generate_series(1,343) n;

CREATE TABLE policy_forward_cert.baseline AS
SELECT
  (SELECT count(*) FROM public.commerce_order_lines line JOIN public.commerce_orders order_row ON order_row.id=line.commerce_order_id WHERE order_row.venue_id='91000000-0000-4000-8000-000000000002') AS commerce_rows,
  (SELECT count(*) FROM public.session_registrations WHERE venue_id='91000000-0000-4000-8000-000000000002') AS registration_rows,
  (SELECT count(*) FROM public.bookings WHERE venue_id='91000000-0000-4000-8000-000000000002') AS booking_rows,
  (SELECT count(*) FROM public.booking_participants WHERE venue_id='91000000-0000-4000-8000-000000000002') AS participant_rows,
  (SELECT md5(string_agg(id::TEXT||':'||status,',' ORDER BY id)) FROM public.bookings WHERE venue_id='91000000-0000-4000-8000-000000000002') AS booking_digest,
  (SELECT md5(string_agg(id::TEXT||':'||payment_status,',' ORDER BY id)) FROM public.booking_participants WHERE venue_id='91000000-0000-4000-8000-000000000002') AS participant_digest;

SELECT * FROM policy_forward_cert.baseline;
