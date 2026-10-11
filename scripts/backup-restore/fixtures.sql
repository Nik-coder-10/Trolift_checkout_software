-- =====================================================================
-- Backup/restore drill — synthetic transactional fixtures
-- =====================================================================
-- Purpose: populate the transactional tables with realistic, clearly
-- synthetic business data so a backup/restore drill proves that money,
-- tax, inventory, shipment and audit relationships survive a restore.
--
-- Rules honoured here:
--   * 100% synthetic. Every name/phone/email/GSTIN/UTR/tracking value
--     is fabricated and namespaced "DRDRILL". No real PII, no real
--     payment references, no credentials.
--   * Foreign keys, unique constraints, CHECK constraints and triggers
--     are respected — nothing is disabled to force an insert.
--   * Fixed (valid hex) UUIDs make the fixture deterministic and
--     re-runnable.
--   * Tax and totals are internally consistent (see comments per row).
--
-- Apply ONCE to a clean fixture database (transactional tables empty).
-- Run with:  psql "$TARGET_URL" -v ON_ERROR_STOP=1 -f fixtures.sql
-- =====================================================================

begin;

-- ── Customers ────────────────────────────────────────────────────────
-- C1: intra-state (GSTIN, state 27, Maharashtra). C2: inter-state (29).
insert into public.customers
  (id, name, phone, email, gstin, billing_name, billing_address_line,
   billing_city, billing_state, billing_state_code, billing_pincode)
values
  ('11111111-1111-4111-8111-000000000001', 'DRDRILL Customer One',
   '+919990000001', 'drdrill.one@example.test', '27ZZZZZ0000Z1Z5',
   'DRDRILL Customer One', '1 Drill Street', 'Pune', 'Maharashtra', '27', '411001'),
  ('11111111-1111-4111-8111-000000000002', 'DRDRILL Customer Two',
   '+919990000002', 'drdrill.two@example.test', null,
   'DRDRILL Customer Two', '2 Drill Avenue', 'Bengaluru', 'Karnataka', '29', '560001');

-- ── Products ─────────────────────────────────────────────────────────
insert into public.products
  (id, name, slug, category, price, stock_quantity, gst_rate, weight_kg,
   low_stock_threshold, images, is_active)
values
  ('22222222-2222-4222-8222-000000000001', 'DRDRILL Widget', 'drdrill-widget',
   'DRDRILL', 500.00, 100, 18.00, 1.50, 5,
   array['https://example.test/drdrill-widget.png'], true),
  ('22222222-2222-4222-8222-000000000002', 'DRDRILL Gadget', 'drdrill-gadget',
   'DRDRILL', 1200.00, 50, 18.00, 2.00, 5,
   array['https://example.test/drdrill-gadget.png'], true);

-- ── Delivery partner + rate + slabs + category rule ──────────────────
insert into public.delivery_partners
  (id, name, contact_name, contact_phone, contact_email, is_active, priority)
values
  ('33333333-3333-4333-8333-000000000001', 'DRDRILL Logistics',
   'Drill Desk', '9000000001', 'drdrill.partner@example.test', true, 10);

insert into public.delivery_pincode_rates
  (pincode, delivery_partner_id, serviceable, delivery_charge, eta_min_days,
   eta_max_days, min_order_amount, max_order_amount, remote_surcharge)
values
  ('411001', '33333333-3333-4333-8333-000000000001', true, 60.00, 2, 4, 0, null, 0);

insert into public.delivery_weight_slabs
  (delivery_partner_id, min_weight_kg, max_weight_kg, charge)
values
  ('33333333-3333-4333-8333-000000000001', 0, 5, 40.00),
  ('33333333-3333-4333-8333-000000000001', 5, null, 80.00);

insert into public.delivery_category_rules (category, surcharge, note)
values ('DRDRILL', 25.00, 'DRDRILL synthetic category surcharge');

-- ── Orders ───────────────────────────────────────────────────────────
-- order_number is left NULL so the BEFORE INSERT trigger
-- public.assign_order_number() assigns a real TS-YYMMDD-NNNN value.
--
-- O1 (intra-state 27): subtotal 1000.00 = 2 x 500.00, delivery 60.00,
--   GST 18% split CGST 90.00 + SGST 90.00 = 180.00,
--   total = 1000 + 60 + 90 + 90 + 0 = 1240.00. Paid + delivered.
-- O2 (inter-state 29): subtotal 2400.00 = 2 x 1200.00, delivery 80.00,
--   GST 18% IGST 432.00, total = 2400 + 80 + 0 + 0 + 432 = 2912.00.
--   Payment submitted + awaiting verification.
insert into public.orders
  (id, customer_id, subtotal, delivery_charge, total_amount,
   delivery_pincode, delivery_partner_id, delivery_partner_name,
   gstin_snapshot, payment_status, order_status, idempotency_key,
   tax_treatment, taxable_amount, cgst_amount, sgst_amount, igst_amount,
   billing_name, billing_address_line, billing_city, billing_state,
   billing_state_code, billing_pincode,
   customer_name_snapshot, customer_phone_snapshot, customer_email_snapshot,
   stock_state, delivery_weight_kg, delivery_rule_summary)
values
  ('44444444-4444-4444-8444-000000000001', '11111111-1111-4111-8111-000000000001',
   1000.00, 60.00, 1240.00, '411001', '33333333-3333-4333-8333-000000000001',
   'DRDRILL Logistics', '27ZZZZZ0000Z1Z5', 'paid', 'delivered',
   'drdrill-idem-0001', 'gst', 1000.00, 90.00, 90.00, 0.00,
   'DRDRILL Customer One', '1 Drill Street', 'Pune', 'Maharashtra', '27',
   '411001', 'DRDRILL Customer One', '+919990000001', 'drdrill.one@example.test',
   'consumed', 3.00, 'weight slab 0-5kg; intra-state'),
  ('44444444-4444-4444-8444-000000000002', '11111111-1111-4111-8111-000000000002',
   2400.00, 80.00, 2912.00, '560001', null, 'DRDRILL Logistics',
   null, 'submitted', 'payment_submitted',
   'drdrill-idem-0002', 'gst', 2400.00, 0.00, 0.00, 432.00,
   'DRDRILL Customer Two', '2 Drill Avenue', 'Bengaluru', 'Karnataka', '29',
   '560001', 'DRDRILL Customer Two', '+919990000002', 'drdrill.two@example.test',
   'reserved', 4.00, 'weight slab 0-5kg; inter-state');

-- ── Frozen order-item snapshots ──────────────────────────────────────
insert into public.order_items
  (id, order_id, product_id, product_name, quantity, unit_price, line_total,
   gst_rate_percent, line_tax_amount)
values
  ('55555555-5555-4555-8555-000000000001', '44444444-4444-4444-8444-000000000001',
   '22222222-2222-4222-8222-000000000001',
   'DRDRILL Widget', 2, 500.00, 1000.00, 18.00, 180.00),
  ('55555555-5555-4555-8555-000000000002', '44444444-4444-4444-8444-000000000002',
   '22222222-2222-4222-8222-000000000002',
   'DRDRILL Gadget', 2, 1200.00, 2400.00, 18.00, 432.00);

-- ── Payments (one verified, one submitted) ───────────────────────────
insert into public.payments
  (id, order_id, amount, method, status, transaction_reference, metadata)
values
  ('66666666-6666-4666-8666-000000000001', '44444444-4444-4444-8444-000000000001',
   1240.00, 'upi', 'paid', 'DRDRILL-UTR-0001',
   '{"source":"drdrill-fixture","verified_by":"drdrill-admin"}'::jsonb),
  ('66666666-6666-4666-8666-000000000002', '44444444-4444-4444-8444-000000000002',
   2912.00, 'upi', 'submitted', 'DRDRILL-UTR-0002',
   '{"source":"drdrill-fixture"}'::jsonb);

-- ── Invoice (paid/delivered order only) ──────────────────────────────
-- invoice_number format enforced by CHECK: <PREFIX>/FY<yy>-<yy>/<seq>.
insert into public.invoices (id, order_id, invoice_number, invoice_date, data)
values
  ('77777777-7777-4777-8777-000000000001', '44444444-4444-4444-8444-000000000001',
   'DRD/FY25-26/0001', date '2026-10-10',
   '{"seller":{"name":"DRDRILL Synthetic Seller","gstin":"27ZZZZZ0000Z1Z5"},
     "buyer":{"name":"DRDRILL Customer One","gstin":"27ZZZZZ0000Z1Z5"},
     "totals":{"subtotal":1000.00,"delivery":60.00,"cgst":90.00,"sgst":90.00,
     "igst":0.00,"total":1240.00},
     "lines":[{"name":"DRDRILL Widget","quantity":2,"unit_price":500.00,
     "line_total":1000.00,"gst_rate_percent":18.00}]}'::jsonb);

-- ── Inventory reservations + events ──────────────────────────────────
insert into public.stock_reservations
  (id, product_id, order_id, quantity, status, expires_at)
values
  ('88888888-8888-4888-8888-000000000001', '22222222-2222-4222-8222-000000000001',
   '44444444-4444-4444-8444-000000000001', 2, 'consumed',
   timestamptz '2026-10-10 10:00:00+05:30'),
  ('88888888-8888-4888-8888-000000000002', '22222222-2222-4222-8222-000000000002',
   '44444444-4444-4444-8444-000000000002', 2, 'held',
   timestamptz '2027-01-01 00:00:00+05:30');

insert into public.inventory_events
  (id, product_id, order_id, event, quantity, balance_after, note)
values
  ('99999999-9999-4999-8999-000000000001', '22222222-2222-4222-8222-000000000001',
   '44444444-4444-4444-8444-000000000001', 'reserved', 2, 98, 'DRDRILL reserve'),
  ('99999999-9999-4999-8999-000000000002', '22222222-2222-4222-8222-000000000001',
   '44444444-4444-4444-8444-000000000001', 'consumed', 2, 98, 'DRDRILL consume'),
  ('99999999-9999-4999-8999-000000000003', '22222222-2222-4222-8222-000000000002',
   '44444444-4444-4444-8444-000000000002', 'reserved', 2, 48, 'DRDRILL reserve');

-- ── Shipment (delivered) ─────────────────────────────────────────────
insert into public.shipments
  (id, order_id, delivery_partner_id, tracking_reference, dispatch_status,
   dispatched_at, expected_delivery_date, delivered_at, dispatch_notes)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001', '44444444-4444-4444-8444-000000000001',
   '33333333-3333-4333-8333-000000000001', 'DRDRILL-TRK-0001', 'delivered',
   timestamptz '2026-10-09 09:00:00+05:30', timestamptz '2026-10-11 18:00:00+05:30',
   timestamptz '2026-10-10 15:30:00+05:30', 'DRDRILL synthetic shipment');

-- ── Order-event history ──────────────────────────────────────────────
insert into public.order_events
  (id, order_id, actor_user_id, action, from_status, to_status, note,
   event_type, actor_type, metadata)
values
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000001', '44444444-4444-4444-8444-000000000001',
   null, 'order.created', null, 'pending_payment', 'DRDRILL creation',
   'ORDER_CREATED', 'customer', '{}'::jsonb),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000002', '44444444-4444-4444-8444-000000000001',
   null, 'payment.submitted', 'pending_payment', 'payment_submitted', 'UTR DRDRILL-UTR-0001',
   'PAYMENT_SUBMITTED', 'customer', '{}'::jsonb),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000003', '44444444-4444-4444-8444-000000000001',
   'ffffffff-ffff-4fff-8fff-000000000001', 'payment.verified', 'payment_submitted', 'paid',
   'verified against bank statement', 'PAYMENT_VERIFIED', 'admin',
   '{"verified_by":"drdrill-admin"}'::jsonb),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000004', '44444444-4444-4444-8444-000000000001',
   'ffffffff-ffff-4fff-8fff-000000000001', 'order.confirmed', 'paid', 'confirmed',
   'DRDRILL confirm', 'ORDER_CONFIRMED', 'admin', '{}'::jsonb),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000005', '44444444-4444-4444-8444-000000000001',
   'ffffffff-ffff-4fff-8fff-000000000001', 'order.packed', 'confirmed', 'packed',
   'DRDRILL pack', 'PACKED', 'admin', '{}'::jsonb),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000006', '44444444-4444-4444-8444-000000000001',
   'ffffffff-ffff-4fff-8fff-000000000001', 'order.dispatched', 'packed', 'dispatched',
   'DRDRILL-TRK-0001', 'DISPATCHED', 'admin', '{}'::jsonb),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000007', '44444444-4444-4444-8444-000000000001',
   'ffffffff-ffff-4fff-8fff-000000000001', 'order.delivered', 'dispatched', 'delivered',
   'DRDRILL delivered', 'DELIVERED', 'admin', '{}'::jsonb),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000008', '44444444-4444-4444-8444-000000000001',
   null, 'invoice.issued', 'delivered', 'delivered', 'DRD/FY25-26/0001',
   'INVOICE_ISSUED', 'system', '{}'::jsonb),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000009', '44444444-4444-4444-8444-000000000002',
   null, 'order.created', null, 'pending_payment', 'DRDRILL creation',
   'ORDER_CREATED', 'customer', '{}'::jsonb),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000010', '44444444-4444-4444-8444-000000000002',
   null, 'payment.submitted', 'pending_payment', 'payment_submitted', 'UTR DRDRILL-UTR-0002',
   'PAYMENT_SUBMITTED', 'customer', '{}'::jsonb);

-- ── Guest order-access tokens ────────────────────────────────────────
insert into public.order_access_tokens
  (id, order_id, token_hash, expires_at, label)
values
  ('cccccccc-cccc-4ccc-8ccc-000000000001', '44444444-4444-4444-8444-000000000001',
   repeat('a1', 32), timestamptz '2027-01-01 00:00:00+05:30', 'checkout'),
  ('cccccccc-cccc-4ccc-8ccc-000000000002', '44444444-4444-4444-8444-000000000002',
   repeat('b2', 32), timestamptz '2027-01-01 00:00:00+05:30', 'checkout');

-- ── Staff notes (order + customer) ───────────────────────────────────
insert into public.staff_notes
  (id, entity_type, entity_id, author_user_id, body)
values
  ('dddddddd-dddd-4ddd-8ddd-000000000001', 'order',
   '44444444-4444-4444-8444-000000000001', 'ffffffff-ffff-4fff-8fff-000000000001',
   'DRDRILL synthetic note: payment verified against bank statement.'),
  ('dddddddd-dddd-4ddd-8ddd-000000000002', 'customer',
   '11111111-1111-4111-8111-000000000001', 'ffffffff-ffff-4fff-8fff-000000000001',
   'DRDRILL synthetic note: GSTIN supplied by customer.');

-- ── Admin audit log (jsonb summary) ──────────────────────────────────
insert into public.admin_audit_log
  (id, actor_user_id, operation, dataset, total_rows, inserted_rows,
   updated_rows, failed_rows, result, summary)
values
  ('eeeeeeee-eeee-4eee-8eee-000000000001', 'ffffffff-ffff-4fff-8fff-000000000001',
   'drdrill-import', 'DRDRILL', 2, 2, 0, 0, 'success',
   '{"source":"drdrill-fixture"}'::jsonb);

commit;
