\set ON_ERROR_STOP on
BEGIN;

DELETE FROM public.stripe_events WHERE id LIKE 'evt_r1_%';

ALTER TABLE public.ledger_entries DISABLE TRIGGER prevent_ledger_entries_update;
ALTER TABLE public.ledger_entries DISABLE TRIGGER prevent_ledger_entries_delete;
DELETE FROM public.ledger_entries WHERE venue_id IN (
  'c2b00000-0000-4000-8000-000000000001',
  'c2b00000-0000-4000-8000-000000000002'
);
ALTER TABLE public.ledger_entries ENABLE TRIGGER prevent_ledger_entries_update;
ALTER TABLE public.ledger_entries ENABLE TRIGGER prevent_ledger_entries_delete;

ALTER TABLE public.audit_log DISABLE TRIGGER prevent_audit_log_update;
ALTER TABLE public.audit_log DISABLE TRIGGER prevent_audit_log_delete;
DELETE FROM public.audit_log WHERE venue_id IN (
  'c2b00000-0000-4000-8000-000000000001',
  'c2b00000-0000-4000-8000-000000000002'
);
ALTER TABLE public.audit_log ENABLE TRIGGER prevent_audit_log_update;
ALTER TABLE public.audit_log ENABLE TRIGGER prevent_audit_log_delete;

DELETE FROM public.commerce_receipt_lines WHERE commerce_order_id IN (
  SELECT id FROM public.commerce_orders WHERE venue_id IN (
    'c2b00000-0000-4000-8000-000000000001',
    'c2b00000-0000-4000-8000-000000000002'
  )
);
DELETE FROM public.booking_receipts WHERE venue_id IN (
  'c2b00000-0000-4000-8000-000000000001',
  'c2b00000-0000-4000-8000-000000000002'
);
ALTER TABLE public.commerce_orders DISABLE TRIGGER trg_commerce_order_lifecycle;
DELETE FROM public.commerce_orders WHERE venue_id IN (
  'c2b00000-0000-4000-8000-000000000001',
  'c2b00000-0000-4000-8000-000000000002'
);
ALTER TABLE public.commerce_orders ENABLE TRIGGER trg_commerce_order_lifecycle;
DELETE FROM public.venues WHERE id IN (
  'c2b00000-0000-4000-8000-000000000001',
  'c2b00000-0000-4000-8000-000000000002'
);
DELETE FROM auth.users WHERE email LIKE '%@commerce-r1.local';
DELETE FROM public.customers WHERE email_normalized LIKE '%@commerce-r1.local';

COMMIT;
